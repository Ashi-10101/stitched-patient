import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { getAlarmState } from './alarms';
import { selectStatus, statusItemMatches } from './statusSelector';
import { VITAL_FIELD, VITAL_NAMES } from './vitals';
import type {
  AlarmState,
  AlarmThreshold,
  AlarmThresholds,
  PlaySection,
  StatusRule,
  StatusWhen,
  VitalName,
  VitalSigns,
} from '@/types';
import { CASE } from '@/test/caseFixtures';
import { arbPlaySection, arbSample, arbThreshold } from '@/test/generators';
import { PBT_PARAMS } from '@/test/pbt';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const DEFAULT = 'The patient seems okay for now.';

/** Play_Section with the given status part and fixed minimal test values elsewhere. */
function playWith(rules: StatusRule[], defaultSentence = DEFAULT): PlaySection {
  return {
    goalText: 'Test goal.',
    diagnosisTerms: ['test-diagnosis-term'],
    endings: {
      rescued: { conditions: [{ vital: 'heartRate', op: '<', value: 1 }], holdSeconds: 1 },
      lost: { timeLimitSeconds: 60 },
    },
    hints: [{ text: 'Test hint.' }],
    status: { rules, defaultSentence },
  };
}

/** Every vital inside the case `normal` range; systolic and diastolic absent. */
const NORMAL_SAMPLE: Partial<VitalSigns> = {
  simulation_time: 10,
  heart_rate: 72,
  respiratory_rate: 14,
  spo2: 0.97,
  mean_arterial_pressure: 90,
  etco2: 38,
  tidal_volume: 500,
};

const sampleWith = (overrides: Partial<VitalSigns>): Partial<VitalSigns> => ({
  ...NORMAL_SAMPLE,
  ...overrides,
});

const ALARMS = CASE.alarms;

// ---------------------------------------------------------------------------
// Examples
// ---------------------------------------------------------------------------

describe('selectStatus: examples', () => {
  it('returns the first of two matching rules, in Case_Definition order', () => {
    // HR 110 is warning/high and SpO2 0.90 is warning/low under the case thresholds.
    const sample = sampleWith({ heart_rate: 110, spo2: 0.9 });
    const first: StatusRule = { when: [{ vital: 'heartRate', band: 'warning' }], sentence: 'First.' };
    const second: StatusRule = { when: [{ vital: 'spO2', band: 'warning', direction: 'low' }], sentence: 'Second.' };
    expect(selectStatus(sample, ALARMS, playWith([first, second]))).toBe('First.');
    expect(selectStatus(sample, ALARMS, playWith([second, first]))).toBe('Second.');
  });

  it('skips a non-matching rule and returns a later matching one', () => {
    const sample = sampleWith({ heart_rate: 150 }); // critical/high
    const rules: StatusRule[] = [
      { when: [{ vital: 'heartRate', band: 'warning' }], sentence: 'Warning.' },
      { when: [{ vital: 'heartRate', band: 'critical', direction: 'low' }], sentence: 'Critical low.' },
      { when: [{ vital: 'heartRate', band: 'critical', direction: 'high' }], sentence: 'Critical high.' },
    ];
    expect(selectStatus(sample, ALARMS, playWith(rules))).toBe('Critical high.');
  });

  it('does not match a rule with several when items when only some match', () => {
    const sample = sampleWith({ heart_rate: 110, spo2: 0.9 });
    const partial: StatusRule = {
      when: [
        { vital: 'heartRate', band: 'warning', direction: 'high' }, // matches
        { vital: 'spO2', band: 'critical' }, // SpO2 is warning, not critical
      ],
      sentence: 'Partial.',
    };
    const full: StatusRule = {
      when: [
        { vital: 'heartRate', band: 'warning', direction: 'high' },
        { vital: 'spO2', band: 'warning', direction: 'low' },
        { vital: 'respiratoryRate', band: 'warning' }, // RR 14 is normal
      ],
      sentence: 'Three items.',
    };
    expect(selectStatus(sample, ALARMS, playWith([partial, full]))).toBe(DEFAULT);
    const allMatch: StatusRule = { when: full.when.slice(0, 2), sentence: 'Two items.' };
    expect(selectStatus(sample, ALARMS, playWith([partial, full, allMatch]))).toBe('Two items.');
  });

  it('matches an item without direction on both low and high', () => {
    const rules: StatusRule[] = [{ when: [{ vital: 'heartRate', band: 'warning' }], sentence: 'Any side.' }];
    expect(selectStatus(sampleWith({ heart_rate: 55 }), ALARMS, playWith(rules))).toBe('Any side.');
    expect(selectStatus(sampleWith({ heart_rate: 110 }), ALARMS, playWith(rules))).toBe('Any side.');
  });

  it('does not match an item whose direction differs from the band direction', () => {
    const rules: StatusRule[] = [
      { when: [{ vital: 'heartRate', band: 'warning', direction: 'low' }], sentence: 'Low.' },
    ];
    expect(selectStatus(sampleWith({ heart_rate: 110 }), ALARMS, playWith(rules))).toBe(DEFAULT);
    expect(selectStatus(sampleWith({ heart_rate: 55 }), ALARMS, playWith(rules))).toBe('Low.');
  });

  it('never matches an item on a vital in the normal band', () => {
    const rules: StatusRule[] = [{ when: [{ vital: 'heartRate', band: 'warning' }], sentence: 'Warning.' }];
    expect(selectStatus(NORMAL_SAMPLE, ALARMS, playWith(rules))).toBe(DEFAULT);
  });

  it('returns defaultSentence when no rule matches, when rules is empty and for a null sample', () => {
    const rules: StatusRule[] = [{ when: [{ vital: 'spO2', band: 'critical' }], sentence: 'Very low oxygen.' }];
    expect(selectStatus(NORMAL_SAMPLE, ALARMS, playWith(rules))).toBe(DEFAULT);
    expect(selectStatus(sampleWith({ spo2: 0.5 }), ALARMS, playWith([]))).toBe(DEFAULT);
    expect(selectStatus(null, ALARMS, playWith(rules))).toBe(DEFAULT);
  });

  it('does not match an item whose vital is missing or non-finite in the sample', () => {
    const rules: StatusRule[] = [{ when: [{ vital: 'spO2', band: 'critical' }], sentence: 'Very low oxygen.' }];
    const { spo2: _omit, ...withoutSpO2 } = sampleWith({});
    expect(selectStatus(withoutSpO2, ALARMS, playWith(rules))).toBe(DEFAULT);
    for (const bad of [Number.NaN, Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY]) {
      expect(selectStatus(sampleWith({ spo2: bad }), ALARMS, playWith(rules)), String(bad)).toBe(DEFAULT);
    }
    expect(selectStatus(sampleWith({ spo2: 0.5 }), ALARMS, playWith(rules))).toBe('Very low oxygen.');
  });

  it('does not match an item whose vital has no thresholds in the case', () => {
    const { etCO2: _omit, ...rest } = ALARMS;
    const alarmsWithoutEtCO2 = rest as AlarmThresholds;
    const rules: StatusRule[] = [{ when: [{ vital: 'etCO2', band: 'critical' }], sentence: 'EtCO2.' }];
    const sample = sampleWith({ etco2: 80 }); // critical/high under the case thresholds
    expect(selectStatus(sample, ALARMS, playWith(rules))).toBe('EtCO2.');
    expect(selectStatus(sample, alarmsWithoutEtCO2, playWith(rules))).toBe(DEFAULT);
  });

  it('returns without throwing for samples without systolic and diastolic pressure', () => {
    expect('systolic_pressure' in NORMAL_SAMPLE).toBe(false);
    expect('diastolic_pressure' in NORMAL_SAMPLE).toBe(false);
    const rules: StatusRule[] = [{ when: [{ vital: 'meanArterialPressure', band: 'critical' }], sentence: 'Low MAP.' }];
    expect(() => selectStatus(NORMAL_SAMPLE, ALARMS, playWith(rules))).not.toThrow();
    expect(selectStatus(sampleWith({ mean_arterial_pressure: 50 }), ALARMS, playWith(rules))).toBe('Low MAP.');
    expect(selectStatus({ simulation_time: 0 }, ALARMS, playWith(rules))).toBe(DEFAULT);
  });

  it('returns the sentence exactly as written, including spaces and unusual punctuation', () => {
    const odd = '  "Ouch!" — breathing… fast?!\t(very)  ';
    const oddDefault = ' \u00a0Default; still okay… ';
    const rules: StatusRule[] = [{ when: [{ vital: 'heartRate', band: 'warning' }], sentence: odd }];
    const play = playWith(rules, oddDefault);
    const matched = selectStatus(sampleWith({ heart_rate: 110 }), ALARMS, play);
    expect(matched).toBe(odd);
    expect(matched).toBe(play.status.rules[0].sentence);
    expect(matched.length).toBe(odd.length);
    const fallback = selectStatus(NORMAL_SAMPLE, ALARMS, play);
    expect(fallback).toBe(oddDefault);
    expect(fallback.length).toBe(oddDefault.length);
  });
});

// ---------------------------------------------------------------------------
// Reference model, written independently of statusSelector.ts
// ---------------------------------------------------------------------------

/** Finite value of the vital's VitalSigns field, or undefined. */
function refValue(sample: Partial<VitalSigns>, vital: VitalName): number | undefined {
  const v: unknown = sample[VITAL_FIELD[vital]];
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/**
 * Band from the Alarm_Function; direction `low` when the value is strictly
 * below any present low bound, `high` otherwise (Requirement 4.2, low wins ties).
 */
function refBand(value: number, t: AlarmThreshold): { state: AlarmState; direction: 'low' | 'high' | 'none' } {
  const state = getAlarmState(value, t);
  if (state === 'normal') return { state, direction: 'none' };
  const lows = [t.critical?.low, t.warning?.low, t.normal?.low];
  return { state, direction: lows.some((b) => b !== undefined && value < b) ? 'low' : 'high' };
}

function refItemMatches(sample: Partial<VitalSigns>, alarms: AlarmThresholds, item: StatusWhen): boolean {
  const t = alarms[item.vital];
  if (t === undefined) return false;
  const value = refValue(sample, item.vital);
  if (value === undefined) return false;
  const band = refBand(value, t);
  return band.state === item.band && (item.direction === undefined || item.direction === band.direction);
}

function refSelect(sample: Partial<VitalSigns> | null, alarms: AlarmThresholds, play: PlaySection): string {
  if (sample === null) return play.status.defaultSentence;
  for (const rule of play.status.rules) {
    if (rule.when.every((item) => refItemMatches(sample, alarms, item))) return rule.sentence;
  }
  return play.status.defaultSentence;
}

// ---------------------------------------------------------------------------
// Test-local generators
// ---------------------------------------------------------------------------

/**
 * Case thresholds where each vital has the case threshold (most often), a
 * random threshold from `arbThreshold`, or no thresholds (key omitted).
 */
const arbAlarms: fc.Arbitrary<AlarmThresholds> = fc
  .record(
    Object.fromEntries(
      VITAL_NAMES.map((v) => [
        v,
        fc.oneof(
          { weight: 3, arbitrary: fc.constant(CASE.alarms[v]!) },
          { weight: 1, arbitrary: arbThreshold },
        ),
      ]),
    ) as Record<VitalName, fc.Arbitrary<AlarmThreshold>>,
    { requiredKeys: [] },
  )
  .map((a) => a as unknown as AlarmThresholds);

type Edit = { mode: 'keep' | 'match' | 'nearMiss'; picks: number[] };

/**
 * Rewrites some rules so that they match the sample (`match`) or match in all
 * items but one (`nearMiss`: wrong direction, wrong band, or a vital without
 * thresholds or without a finite value). Random rules alone rarely match.
 */
function applyEdits(
  sample: Partial<VitalSigns> | null,
  alarms: AlarmThresholds,
  play: PlaySection,
  edits: Edit[],
): PlaySection {
  if (sample === null) return play;
  const matching: StatusWhen[] = [];
  const unusable: VitalName[] = [];
  for (const vital of VITAL_NAMES) {
    const t = alarms[vital];
    const value = refValue(sample, vital);
    if (t === undefined || value === undefined) {
      unusable.push(vital);
      continue;
    }
    const band = refBand(value, t);
    if (band.state === 'normal' || band.direction === 'none') continue;
    matching.push({ vital, band: band.state }, { vital, band: band.state, direction: band.direction });
  }
  if (matching.length === 0) return play;

  const rules = play.status.rules.map((rule, r): StatusRule => {
    const { mode, picks } = edits[r];
    if (mode === 'keep') return rule;
    const when = rule.when.map((_, i) => matching[picks[i] % matching.length]);
    if (mode === 'nearMiss') {
      const i = picks[0] % when.length;
      const item = when[i];
      const kind = picks[1] % 3;
      if (kind === 2 && unusable.length > 0) {
        when[i] = { ...item, vital: unusable[picks[2] % unusable.length] };
      } else if (kind === 1) {
        when[i] = { ...item, band: item.band === 'warning' ? 'critical' : 'warning' };
      } else {
        const actual = matching.find((m) => m.vital === item.vital && m.direction !== undefined)!.direction!;
        when[i] = { ...item, direction: actual === 'low' ? 'high' : 'low' };
      }
    }
    return { ...rule, when };
  });
  return { ...play, status: { ...play.status, rules } };
}

const arbScenario = fc
  .tuple(fc.option(arbSample, { nil: null, freq: 10 }), arbAlarms, arbPlaySection)
  .chain(([sample, alarms, play]) =>
    fc
      .array(
        fc.record({
          mode: fc.constantFrom<Edit['mode']>('keep', 'keep', 'match', 'nearMiss', 'nearMiss'),
          picks: fc.array(fc.nat(), { minLength: 6, maxLength: 6 }),
        }),
        { minLength: play.status.rules.length, maxLength: play.status.rules.length },
      )
      .map((edits) => ({ sample, alarms, play: applyEdits(sample, alarms, play, edits) })),
  );

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

describe('selectStatus: properties', () => {
  // Feature: play-mode, Property 10: Status_Selector returns the first matching case sentence
  it('Property 10: Status_Selector returns the first matching case sentence', () => {
    fc.assert(
      fc.property(arbScenario, ({ sample, alarms, play }) => {
        const result = selectStatus(sample, alarms, play);
        expect(result).toBe(refSelect(sample, alarms, play));
        const sentences = [...play.status.rules.map((r) => r.sentence), play.status.defaultSentence];
        expect(sentences).toContain(result);
      }),
      PBT_PARAMS,
    );
  });

  // Feature: play-mode, Property 11: Status_Selector determinism
  it('Property 11: Status_Selector determinism', () => {
    fc.assert(
      fc.property(arbScenario, ({ sample, alarms, play }) => {
        const first = selectStatus(
          deepFreeze(structuredClone(sample)),
          deepFreeze(structuredClone(alarms)),
          deepFreeze(structuredClone(play)),
        );
        const second = selectStatus(
          deepFreeze(structuredClone(sample)),
          deepFreeze(structuredClone(alarms)),
          deepFreeze(structuredClone(play)),
        );
        expect(second).toBe(first);
      }),
      PBT_PARAMS,
    );
  });

  // Feature: bedside-exam, statusItemMatches agrees with the reference item matcher
  // **Validates: Requirements 5.7**
  it('statusItemMatches agrees with refItemMatches for generated samples, thresholds and items', () => {
    fc.assert(
      fc.property(
        arbScenario.filter((s) => s.sample !== null),
        ({ sample, alarms, play }) => {
          for (const rule of play.status.rules) {
            for (const item of rule.when) {
              expect(statusItemMatches(sample!, alarms, item)).toBe(refItemMatches(sample!, alarms, item));
            }
          }
        },
      ),
      PBT_PARAMS,
    );
  });
});
