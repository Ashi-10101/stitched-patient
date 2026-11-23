import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { getAlarmState } from './alarms';
import { examButtonText, examButtons, examFinding } from './examFinding';
import type { ExamFindingInput } from './examFinding';
import { VITAL_FIELD, VITAL_NAMES } from './vitals';
import type {
  AlarmState,
  AlarmThreshold,
  AlarmThresholds,
  CaseData,
  ExamAction,
  ExamFinding,
  ExamRule,
  ExamWhen,
  InterventionRecordEntry,
  ScheduledInsult,
  SideNeutralExamAction,
  Side,
  SidedExamAction,
  StatusWhen,
  VitalName,
  VitalSigns,
} from '@/types';
import { CASE_LEFT, CASE_RIGHT } from '@/test/caseFixtures';
import {
  arbActiveInterventions,
  arbExamAction,
  arbInsults,
  arbSample,
  arbThreshold,
} from '@/test/generators';
import { PBT_PARAMS } from '@/test/pbt';

// ---------------------------------------------------------------------------
// Fixed test values. Sentences are placeholders, not clinical text.
// ---------------------------------------------------------------------------

const ALARMS = CASE_LEFT.alarms;
const INSULT_TIME = 30;
const MATCH = 'rule sentence';
const DEFAULT = 'default sentence';

/** Every vital inside the case `normal` range (as in statusSelector.test.ts). */
const NORMAL_SAMPLE: Partial<VitalSigns> = {
  simulation_time: 10,
  heart_rate: 72,
  respiratory_rate: 14,
  spo2: 0.97,
  mean_arterial_pressure: 90,
  etco2: 38,
  tidal_volume: 500,
};

/** Heart rate above the case `critical.high` bound of 140. */
const HIGH_HR_SAMPLE: Partial<VitalSigns> = { ...NORMAL_SAMPLE, heart_rate: 150 };

/** Resolved_Case parts the selector reads: one SETensionPneumothorax insult on `side`, or none. */
function caseOn(side: Side | null, time = INSULT_TIME): Pick<CaseData, 'timeline' | 'alarms'> {
  const scheduledInsults: ScheduledInsult[] =
    side === null
      ? []
      : [{ timeSeconds: time, action: 'SETensionPneumothorax', parameters: { side, type: 'Closed', severity: 0.75 } }];
  return { timeline: { scheduledInsults }, alarms: ALARMS };
}

function decompression(side: Side, simulationTime: number, action = 'SENeedleDecompression'): InterventionRecordEntry {
  return { interventionId: `needle-decompression-${side.toLowerCase()}`, action, side, simulationTime, branchId: 'main' };
}

function sided(rules: ExamRule[], defaultSentence = DEFAULT): SidedExamAction {
  return { id: 'test-sided', labels: { Left: 'Left label', Right: 'Right label' }, rules, defaultSentence };
}

function neutral(rules: ExamRule[], defaultSentence = DEFAULT): SideNeutralExamAction {
  return { id: 'test-neutral', label: 'Neutral label', rules, defaultSentence };
}

interface Call {
  caseSide?: Side | null;
  time?: number;
  sample?: Partial<VitalSigns> | null;
  active?: InterventionRecordEntry[];
}

function find(action: ExamAction, side: Side | null, call: Call = {}): ExamFinding {
  return examFinding({
    action,
    side,
    caseData: caseOn(call.caseSide === undefined ? 'Left' : call.caseSide),
    simulationTime: call.time ?? 60,
    sample: call.sample === undefined ? NORMAL_SAMPLE : call.sample,
    activeInterventions: call.active ?? [],
  });
}

const matched: ExamFinding = { sentence: MATCH, abnormal: true };
const fallback: ExamFinding = { sentence: DEFAULT, abnormal: false };

const other = (side: Side): Side => (side === 'Left' ? 'Right' : 'Left');

// ---------------------------------------------------------------------------
// Fixed cases (Requirement 14.1)
// ---------------------------------------------------------------------------

describe('examFinding: side conditions (5.4)', () => {
  const affectedRule = sided([{ when: { side: 'affected' }, sentence: MATCH, abnormal: true }]);
  const otherRule = sided([{ when: { side: 'other' }, sentence: MATCH, abnormal: true }]);

  describe.each<Side>(['Left', 'Right'])('Affected_Side %s', (affected) => {
    it('side: affected matches only the Affected_Side button', () => {
      expect(find(affectedRule, affected, { caseSide: affected })).toEqual(matched);
      expect(find(affectedRule, other(affected), { caseSide: affected })).toEqual(fallback);
    });

    it('side: other matches only the Other_Side button', () => {
      expect(find(otherRule, other(affected), { caseSide: affected })).toEqual(matched);
      expect(find(otherRule, affected, { caseSide: affected })).toEqual(fallback);
    });
  });

  it('with no Affected_Side, side: affected never matches and side: other matches both buttons', () => {
    for (const side of ['Left', 'Right'] as const) {
      expect(find(affectedRule, side, { caseSide: null })).toEqual(fallback);
      expect(find(otherRule, side, { caseSide: null })).toEqual(matched);
    }
  });

  it('a side condition never matches a button without a side', () => {
    expect(find(affectedRule, null)).toEqual(fallback);
    expect(find(otherRule, null)).toEqual(fallback);
  });
});

describe('examFinding: insult conditions (5.5)', () => {
  const started = neutral([{ when: { insult: 'started' }, sentence: MATCH, abnormal: true }]);
  const notStarted = neutral([{ when: { insult: 'notStarted' }, sentence: MATCH, abnormal: true }]);

  it.each([
    [INSULT_TIME - 0.5, false],
    [INSULT_TIME, true],
    [INSULT_TIME + 0.5, true],
  ])('at Simulation_Time %s, Insult_Started is %s', (time, isStarted) => {
    expect(find(started, null, { time })).toEqual(isStarted ? matched : fallback);
    expect(find(notStarted, null, { time })).toEqual(isStarted ? fallback : matched);
  });

  it('with no Affected_Side the insult has not started', () => {
    expect(find(started, null, { caseSide: null, time: 600 })).toEqual(fallback);
    expect(find(notStarted, null, { caseSide: null, time: 600 })).toEqual(matched);
  });
});

describe('examFinding: decompressed conditions (5.6)', () => {
  const yes = neutral([{ when: { decompressed: true }, sentence: MATCH, abnormal: true }]);
  const no = neutral([{ when: { decompressed: false }, sentence: MATCH, abnormal: true }]);

  const expectDecompressed = (call: Call, isDecompressed: boolean) => {
    expect(find(yes, null, call)).toEqual(isDecompressed ? matched : fallback);
    expect(find(no, null, call)).toEqual(isDecompressed ? fallback : matched);
  };

  it('a Decompression on the Affected_Side after the insult counts', () => {
    expectDecompressed({ caseSide: 'Left', time: 60, active: [decompression('Left', 40)] }, true);
    expectDecompressed({ caseSide: 'Right', time: 60, active: [decompression('Right', 40)] }, true);
  });

  it('a Decompression at the insult time and at the given Simulation_Time counts', () => {
    expectDecompressed({ time: 60, active: [decompression('Left', INSULT_TIME)] }, true);
    expectDecompressed({ time: 60, active: [decompression('Left', 60)] }, true);
  });

  it('a Decompression on the Other_Side does not count', () => {
    expectDecompressed({ caseSide: 'Left', time: 60, active: [decompression('Right', 40)] }, false);
    expectDecompressed({ caseSide: 'Right', time: 60, active: [decompression('Left', 40)] }, false);
  });

  it('a Decompression before the insult time does not count', () => {
    expectDecompressed({ time: 60, active: [decompression('Left', INSULT_TIME - 10)] }, false);
  });

  it('a Decompression after the given Simulation_Time does not count', () => {
    expectDecompressed({ time: 60, active: [decompression('Left', 60.5)] }, false);
  });

  it('no Decompression, another action, or no Affected_Side gives false', () => {
    expectDecompressed({ time: 60, active: [] }, false);
    expectDecompressed({ time: 60, active: [decompression('Left', 40, 'SETensionPneumothorax')] }, false);
    expectDecompressed({ caseSide: null, time: 60, active: [decompression('Left', 40)] }, false);
  });
});

describe('examFinding: vitals conditions (5.7)', () => {
  const vitalsRule = (vitals: StatusWhen[]) =>
    neutral([{ when: { vitals }, sentence: MATCH, abnormal: true }]);

  it('an item without direction matches on the band alone', () => {
    expect(find(vitalsRule([{ vital: 'heartRate', band: 'critical' }]), null, { sample: HIGH_HR_SAMPLE })).toEqual(
      matched,
    );
    expect(find(vitalsRule([{ vital: 'heartRate', band: 'warning' }]), null, { sample: HIGH_HR_SAMPLE })).toEqual(
      fallback,
    );
  });

  it('an item with direction also needs the direction', () => {
    const sample = HIGH_HR_SAMPLE;
    expect(find(vitalsRule([{ vital: 'heartRate', band: 'critical', direction: 'high' }]), null, { sample })).toEqual(
      matched,
    );
    expect(find(vitalsRule([{ vital: 'heartRate', band: 'critical', direction: 'low' }]), null, { sample })).toEqual(
      fallback,
    );
  });

  it('every item must match', () => {
    const rule = vitalsRule([
      { vital: 'heartRate', band: 'critical' },
      { vital: 'spO2', band: 'normal' },
    ]);
    expect(find(rule, null, { sample: HIGH_HR_SAMPLE })).toEqual(matched);
    expect(find(rule, null, { sample: { ...HIGH_HR_SAMPLE, spo2: 0.8 } })).toEqual(fallback);
  });

  it('a missing vital value does not match', () => {
    const { heart_rate: _omitted, ...withoutHeartRate } = HIGH_HR_SAMPLE;
    expect(find(vitalsRule([{ vital: 'heartRate', band: 'normal' }]), null, { sample: withoutHeartRate })).toEqual(
      fallback,
    );
  });

  it('with no sample, a vitals item never matches but other conditions still do', () => {
    expect(find(vitalsRule([{ vital: 'heartRate', band: 'normal' }]), null, { sample: null })).toEqual(fallback);
    const insultOnly = neutral([{ when: { insult: 'started' }, sentence: MATCH, abnormal: true }]);
    expect(find(insultOnly, null, { sample: null })).toEqual(matched);
  });
});

describe('examFinding: rule order, abnormal flag and default (5.2, 5.3, 5.8)', () => {
  it('the first of two matching rules wins', () => {
    const action = neutral([
      { when: { insult: 'started' }, sentence: 'first', abnormal: true },
      { when: { decompressed: false }, sentence: 'second', abnormal: false },
    ]);
    expect(find(action, null)).toEqual({ sentence: 'first', abnormal: true });
    const reversed = neutral([...action.rules].reverse());
    expect(find(reversed, null)).toEqual({ sentence: 'second', abnormal: false });
  });

  it('an absent abnormal flag gives false', () => {
    expect(find(neutral([{ when: { insult: 'started' }, sentence: MATCH }]), null)).toEqual({
      sentence: MATCH,
      abnormal: false,
    });
  });

  it('returns the defaultSentence when nothing matches', () => {
    const action = sided([
      { when: { insult: 'notStarted' }, sentence: 'a', abnormal: true },
      { when: { side: 'affected', decompressed: true }, sentence: 'b', abnormal: true },
    ]);
    expect(find(action, 'Left')).toEqual(fallback);
  });

  it('returns the defaultSentence for empty rules', () => {
    expect(find(neutral([]), null)).toEqual(fallback);
    expect(find(sided([]), 'Right')).toEqual(fallback);
  });

  it('returns the case string unchanged', () => {
    const sentence = '  Two  spaces, and "quotes".  ';
    expect(find(neutral([{ when: { insult: 'started' }, sentence }]), null).sentence).toBe(sentence);
    expect(find(neutral([], sentence), null).sentence).toBe(sentence);
  });
});

// ---------------------------------------------------------------------------
// Exam_Buttons (6.1, 6.2)
// ---------------------------------------------------------------------------

describe('examButtons', () => {
  const exam = CASE_LEFT.play!.exam!;

  it('gives five buttons for the shipped Exam_Section, in the order of 8.1, Left before Right', () => {
    const groups = examButtons(exam);
    expect(groups.map((g) => g.map((b) => [b.actionId, b.side]))).toEqual([
      [['look-chest', null]],
      [
        ['listen', 'Left'],
        ['listen', 'Right'],
      ],
      [['windpipe', null]],
      [['neck-veins', null]],
    ]);
    expect(groups.flat()).toHaveLength(5);
    expect(groups.flat().map((b) => b.key)).toEqual([
      'look-chest',
      'listen:Left',
      'listen:Right',
      'windpipe',
      'neck-veins',
    ]);
  });

  it('uses label, labels.Left and labels.Right unchanged as button texts', () => {
    const texts = examButtons(exam).flat().map((b) => b.text);
    const expected = exam.actions.flatMap((a) => (a.labels ? [a.labels.Left, a.labels.Right] : [a.label]));
    expect(texts).toEqual(expected);
  });
});

describe('examButtonText', () => {
  const exam = CASE_LEFT.play!.exam!;
  const listen = exam.actions.find((a) => a.id === 'listen') as SidedExamAction;
  const look = exam.actions.find((a) => a.id === 'look-chest') as SideNeutralExamAction;

  it('gives the Exam_Button text of a recorded entry', () => {
    expect(examButtonText(exam, 'listen', 'Left')).toBe(listen.labels.Left);
    expect(examButtonText(exam, 'listen', 'Right')).toBe(listen.labels.Right);
    expect(examButtonText(exam, 'look-chest', null)).toBe(look.label);
  });

  it('falls back to the action id for an unknown action or a missing Exam_Section', () => {
    expect(examButtonText(exam, 'tap-chest', 'Left')).toBe('tap-chest');
    expect(examButtonText(exam, 'tap-chest', null)).toBe('tap-chest');
    expect(examButtonText(undefined, 'listen', 'Left')).toBe('listen');
  });
});

// ---------------------------------------------------------------------------
// Reference matcher for Property 8, built from the glossary definitions
// ---------------------------------------------------------------------------

/** Affected_Side insult: first SETensionPneumothorax insult (exact name) with a valid side and finite time. */
function refAffected(insults: ScheduledInsult[]): { side: Side; timeSeconds: number } | null {
  const insult = insults.find(
    (i) =>
      i.action === 'SETensionPneumothorax' &&
      (i.parameters.side === 'Left' || i.parameters.side === 'Right') &&
      Number.isFinite(i.timeSeconds),
  );
  return insult ? { side: insult.parameters.side as Side, timeSeconds: insult.timeSeconds } : null;
}

/** Finite value of the vital's VitalSigns field, or undefined (copy of the play-mode reference). */
function refValue(sample: Partial<VitalSigns>, vital: VitalName): number | undefined {
  const v: unknown = sample[VITAL_FIELD[vital]];
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/** Band from the Alarm_Function; direction `low` when below any present low bound (copy of the play-mode reference). */
function refBand(value: number, t: AlarmThreshold): { state: AlarmState; direction: 'low' | 'high' | 'none' } {
  const state = getAlarmState(value, t);
  if (state === 'normal') return { state, direction: 'none' };
  const lows = [t.critical?.low, t.warning?.low, t.normal?.low];
  return { state, direction: lows.some((b) => b !== undefined && value < b) ? 'low' : 'high' };
}

/** The play-mode reference item matcher `refItemMatches` of statusSelector.test.ts. */
function refItemMatches(sample: Partial<VitalSigns>, alarms: AlarmThresholds, item: StatusWhen): boolean {
  const t = alarms[item.vital];
  if (t === undefined) return false;
  const value = refValue(sample, item.vital);
  if (value === undefined) return false;
  const band = refBand(value, t);
  return band.state === item.band && (item.direction === undefined || item.direction === band.direction);
}

interface Scenario {
  action: ExamAction;
  side: Side | null;
  insults: ScheduledInsult[];
  time: number;
  sample: Partial<VitalSigns> | null;
  alarms: AlarmThresholds;
  active: InterventionRecordEntry[];
}

function refFinding(s: Scenario): ExamFinding {
  const affected = refAffected(s.insults);
  const insultStarted = affected !== null && s.time >= affected.timeSeconds;
  const decompressed =
    affected !== null &&
    s.active.some(
      (e) =>
        e.action === 'SENeedleDecompression' &&
        e.side === affected.side &&
        e.simulationTime >= affected.timeSeconds &&
        e.simulationTime <= s.time,
    );
  const matches = (when: ExamWhen): boolean => {
    if (when.side === 'affected' && (s.side === null || affected === null || s.side !== affected.side)) return false;
    if (when.side === 'other' && (s.side === null || (affected !== null && s.side === affected.side))) return false;
    if (when.insult !== undefined && (when.insult === 'started') !== insultStarted) return false;
    if (when.decompressed !== undefined && when.decompressed !== decompressed) return false;
    if (when.vitals !== undefined) {
      if (s.sample === null) return false;
      for (const item of when.vitals) if (!refItemMatches(s.sample, s.alarms, item)) return false;
    }
    return true;
  };
  const rule = s.action.rules.find((r) => matches(r.when));
  return rule ? { sentence: rule.sentence, abnormal: rule.abnormal === true } : { sentence: s.action.defaultSentence, abnormal: false };
}

// ---------------------------------------------------------------------------
// Test-local generators for Property 8
// ---------------------------------------------------------------------------

/** Case thresholds for each vital (most often), a random threshold, or none (key omitted). */
const arbAlarms: fc.Arbitrary<AlarmThresholds> = fc
  .record(
    Object.fromEntries(
      VITAL_NAMES.map((v) => [
        v,
        fc.oneof({ weight: 3, arbitrary: fc.constant(ALARMS[v]!) }, { weight: 1, arbitrary: arbThreshold }),
      ]),
    ) as Record<VitalName, fc.Arbitrary<AlarmThreshold>>,
    { requiredKeys: [] },
  )
  .map((a) => a as unknown as AlarmThresholds);

/**
 * Rewrites the `vitals` items of the chosen rules so that each item matches the
 * sample, because random `vitals` items alone rarely match.
 */
function matchVitals(
  action: ExamAction,
  sample: Partial<VitalSigns> | null,
  alarms: AlarmThresholds,
  edits: { match: boolean; picks: number[] }[],
): ExamAction {
  if (sample === null) return action;
  const items: StatusWhen[] = [];
  for (const vital of VITAL_NAMES) {
    const t = alarms[vital];
    const value = refValue(sample, vital);
    if (t === undefined || value === undefined) continue;
    const band = refBand(value, t);
    items.push({ vital, band: band.state });
    if (band.direction !== 'none') items.push({ vital, band: band.state, direction: band.direction });
  }
  if (items.length === 0) return action;
  const rules = action.rules.map((rule, r): ExamRule => {
    const { match, picks } = edits[r];
    if (!match || rule.when.vitals === undefined) return rule;
    const vitals = rule.when.vitals.map((_, i) => items[picks[i % picks.length] % items.length]);
    return { ...rule, when: { ...rule.when, vitals } };
  });
  return { ...action, rules } as ExamAction;
}

const arbHalfSeconds = fc.integer({ min: 0, max: 300 }).map((n) => n / 2);

const arbScenario: fc.Arbitrary<Scenario> = fc
  .record({
    action: arbExamAction,
    insults: arbInsults,
    sample: fc.option(arbSample, { nil: null, freq: 5 }),
    alarms: arbAlarms,
    active: arbActiveInterventions,
  })
  .chain((base) => {
    const anchors = [...base.insults.map((i) => i.timeSeconds), ...base.active.map((e) => e.simulationTime)];
    const arbTime =
      anchors.length === 0
        ? arbHalfSeconds
        : fc.oneof(
            {
              weight: 3,
              arbitrary: fc
                .constantFrom(...anchors)
                .chain((a) => fc.constantFrom(a - 0.5, a - 1e-6, a, a + 1e-6, a + 0.5)),
            },
            { weight: 1, arbitrary: arbHalfSeconds },
          );
    const arbSide: fc.Arbitrary<Side | null> =
      base.action.labels !== undefined ? fc.constantFrom<Side>('Left', 'Right') : fc.constant(null);
    const n = base.action.rules.length;
    const arbEdits = fc.array(
      fc.record({ match: fc.boolean(), picks: fc.array(fc.nat(), { minLength: 6, maxLength: 6 }) }),
      { minLength: n, maxLength: n },
    );
    return fc.record({ time: arbTime, side: arbSide, edits: arbEdits }).map(({ time, side, edits }) => ({
      action: matchVitals(base.action, base.sample, base.alarms, edits),
      side,
      insults: base.insults,
      time,
      sample: base.sample,
      alarms: base.alarms,
      active: base.active,
    }));
  });

describe('examFinding properties', () => {
  // Feature: bedside-exam, Property 8: The Exam_Finding_Selector returns the first matching rule, else the default
  // **Validates: Requirements 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8**
  it('returns the first rule accepted by the reference matcher, else the default', () => {
    fc.assert(
      fc.property(arbScenario, (s) => {
        const got = examFinding({
          action: s.action,
          side: s.side,
          caseData: { timeline: { scheduledInsults: s.insults }, alarms: s.alarms },
          simulationTime: s.time,
          sample: s.sample,
          activeInterventions: s.active,
        });
        const expected = refFinding(s);
        expect(got).toEqual(expected);
        expect(got.sentence).toBe(expected.sentence);
        expect([...s.action.rules.map((r) => r.sentence), s.action.defaultSentence]).toContain(got.sentence);
      }),
      PBT_PARAMS,
    );
  });
});

// ---------------------------------------------------------------------------
// Helpers for Properties 9 and 10
// ---------------------------------------------------------------------------

function toInput(s: Scenario): ExamFindingInput {
  return {
    action: s.action,
    side: s.side,
    caseData: { timeline: { scheduledInsults: s.insults }, alarms: s.alarms },
    simulationTime: s.time,
    sample: s.sample,
    activeInterventions: s.active,
  };
}

/** Freezes `value` and every object reachable from it (the data has no cycles). */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

/**
 * Runs `fn` with `globalThis.fetch` and `Date.now` replaced by functions that
 * throw, and restores both afterwards, also when `fn` throws.
 */
function withoutClockOrNetwork<T>(fn: () => T): T {
  const realFetch = globalThis.fetch;
  const realNow = Date.now;
  globalThis.fetch = (() => {
    throw new Error('examFinding must not call fetch');
  }) as typeof fetch;
  Date.now = () => {
    throw new Error('examFinding must not read Date.now');
  };
  try {
    return fn();
  } finally {
    globalThis.fetch = realFetch;
    Date.now = realNow;
  }
}

/** Mirrors a valid side; an off-domain value is left unchanged. */
function mirror<T>(side: T): T {
  return (side === 'Left' ? 'Right' : side === 'Right' ? 'Left' : side) as T;
}

/** Every `side` of the insults mirrored; an absent side stays absent. */
function mirrorInsults(insults: ScheduledInsult[]): ScheduledInsult[] {
  return insults.map((i) =>
    'side' in i.parameters ? { ...i, parameters: { ...i.parameters, side: mirror(i.parameters.side) } } : i,
  );
}

/** Every `side` of the Active_Interventions mirrored; an absent side stays absent. */
function mirrorActive(active: InterventionRecordEntry[]): InterventionRecordEntry[] {
  return active.map((e) => ('side' in e ? { ...e, side: mirror(e.side) } : e));
}

const SHIPPED_ACTIONS: ExamAction[] = CASE_LEFT.play!.exam!.actions;

interface CaseScenario {
  action: ExamAction;
  side: Side | null;
  time: number;
  sample: Partial<VitalSigns> | null;
  alarms: AlarmThresholds;
  active: InterventionRecordEntry[];
}

/**
 * Inputs for the `left` and `right` Resolved_Cases: an Exam_Action from the
 * shipped Exam_Section or from `arbExamAction`, with times near the case insult
 * time and the Decompression times.
 */
const arbCaseScenario: fc.Arbitrary<CaseScenario> = fc
  .record({
    action: fc.oneof(fc.constantFrom(...SHIPPED_ACTIONS), arbExamAction),
    sample: fc.option(arbSample, { nil: null, freq: 5 }),
    alarms: arbAlarms,
    active: arbActiveInterventions,
  })
  .chain((base) => {
    const anchors = [
      ...CASE_LEFT.timeline.scheduledInsults.map((i) => i.timeSeconds),
      ...base.active.map((e) => e.simulationTime),
    ];
    const arbTime = fc.oneof(
      {
        weight: 3,
        arbitrary: fc.constantFrom(...anchors).chain((a) => fc.constantFrom(a - 0.5, a - 1e-6, a, a + 1e-6, a + 0.5)),
      },
      { weight: 1, arbitrary: arbHalfSeconds },
    );
    const arbSide: fc.Arbitrary<Side | null> =
      base.action.labels !== undefined ? fc.constantFrom<Side>('Left', 'Right') : fc.constant(null);
    const n = base.action.rules.length;
    const arbEdits = fc.array(
      fc.record({ match: fc.boolean(), picks: fc.array(fc.nat(), { minLength: 6, maxLength: 6 }) }),
      { minLength: n, maxLength: n },
    );
    return fc.record({ time: arbTime, side: arbSide, edits: arbEdits }).map(({ time, side, edits }) => ({
      action: matchVitals(base.action, base.sample, base.alarms, edits),
      side,
      time,
      sample: base.sample,
      alarms: base.alarms,
      active: base.active,
    }));
  });

describe('examFinding purity and side symmetry', () => {
  // Feature: bedside-exam, Property 9: The Exam_Finding_Selector is deterministic and pure
  // **Validates: Requirements 5.1, 5.9**
  it('gives deep-equal results for a deep-frozen input and its structured clone, without Date.now or fetch', () => {
    fc.assert(
      fc.property(arbScenario, (s) => {
        const input = toInput(s);
        const frozen = deepFreeze(structuredClone(input));
        const clone = structuredClone(input);
        const [fromFrozen, fromClone] = withoutClockOrNetwork((): [ExamFinding, ExamFinding] => [
          examFinding(frozen),
          examFinding(clone),
        ]);
        expect(fromClone).toEqual(fromFrozen);
        expect(clone).toEqual(input);
      }),
      PBT_PARAMS,
    );
  });

  // Feature: bedside-exam, Property 10: Findings are side-relative
  // **Validates: Requirements 5.4, 5.6, 14.3**
  it('gives the same finding for the left case with side S and the right case with the mirrored side', () => {
    expect(refAffected(CASE_LEFT.timeline.scheduledInsults)?.side).toBe('Left');
    expect(refAffected(CASE_RIGHT.timeline.scheduledInsults)?.side).toBe('Right');
    fc.assert(
      fc.property(arbCaseScenario, (s) => {
        const mirroredSide = s.side === null ? null : mirror(s.side);
        if (s.action.labels === undefined) expect(mirroredSide).toBeNull();
        const left = examFinding({
          action: s.action,
          side: s.side,
          caseData: { timeline: CASE_LEFT.timeline, alarms: s.alarms },
          simulationTime: s.time,
          sample: s.sample,
          activeInterventions: s.active,
        });
        const right = examFinding({
          action: s.action,
          side: mirroredSide,
          caseData: { timeline: CASE_RIGHT.timeline, alarms: s.alarms },
          simulationTime: s.time,
          sample: s.sample,
          activeInterventions: mirrorActive(s.active),
        });
        expect(right).toEqual(left);
      }),
      PBT_PARAMS,
    );
  });

  // Feature: bedside-exam, Property 10: Findings are side-relative
  // **Validates: Requirements 5.4, 5.6, 14.3**
  it('gives the same finding when every side of generated insults, interventions and the button is mirrored', () => {
    fc.assert(
      fc.property(arbScenario, (s) => {
        const mirrored: Scenario = {
          ...s,
          side: s.side === null ? null : mirror(s.side),
          insults: mirrorInsults(s.insults),
          active: mirrorActive(s.active),
        };
        expect(examFinding(toInput(mirrored))).toEqual(examFinding(toInput(s)));
      }),
      PBT_PARAMS,
    );
  });
});
