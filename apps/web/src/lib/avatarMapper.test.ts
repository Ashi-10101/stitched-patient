import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { getAlarmState } from './alarms';
import {
  BREATH_DEPTH_DEFAULT,
  BREATH_DEPTH_MAX,
  BREATH_DEPTH_MIN,
  DEFAULT_BEAT_PERIOD_S,
  DEFAULT_BREATH_PERIOD_S,
  mapAvatar,
  type AvatarInput,
} from './avatarMapper';
import { foundSides } from './sides';
import { VITAL_FIELD, VITAL_NAMES } from './vitals';
import type {
  AlarmState,
  AlarmThresholds,
  AvatarParameters,
  ExamRecordEntry,
  PlaybackSpeed,
  PlaySection,
  VitalName,
  VitalSigns,
} from '@/types';
import { CASE, CASE_LEFT, CASE_RIGHT, VITAL_OFFSETS } from '@/test/caseFixtures';
import {
  arbActiveInterventions,
  arbAvatarParameters,
  arbExamRecordEntry,
  arbInsults,
  arbSample,
  arbThreshold,
} from '@/test/generators';
import { PBT_PARAMS } from '@/test/pbt';

// ---------------------------------------------------------------------------
// Fixtures. The case file has no Play_Section yet, so tests build their own.
// These values are test placeholders, not clinical content.
// ---------------------------------------------------------------------------

const PLAY: PlaySection = {
  goalText: 'Test goal',
  diagnosisTerms: ['test-term'],
  endings: {
    rescued: { conditions: [{ vital: 'spO2', op: '>=', value: 0.95 }], holdSeconds: 10 },
    lost: { timeLimitSeconds: 600 },
  },
  hints: [{ text: 'Test hint' }],
  status: { rules: [], defaultSentence: 'Test status' },
};

const ALARMS: AlarmThresholds = CASE.alarms;
const INSULTS = CASE.timeline.scheduledInsults;

/** Every vital inside its case `normal` range. */
const BASELINE: Omit<VitalSigns, 'systolic_pressure' | 'diastolic_pressure'> = {
  simulation_time: 0,
  heart_rate: 72,
  respiratory_rate: 16,
  spo2: 0.974,
  mean_arterial_pressure: 95,
  etco2: 40,
  tidal_volume: 500,
};

function makeInput(
  sample: Partial<VitalSigns> = {},
  rest: Partial<Omit<AvatarInput, 'sample'>> = {},
): AvatarInput {
  return {
    sample: { ...BASELINE, ...sample },
    alarms: ALARMS,
    play: PLAY,
    scheduledInsults: [],
    activeInterventions: [],
    previous: null,
    firstPositiveTidalVolumeMl: null,
    revealedSides: 'all',
    ...rest,
  };
}

/** Guard: a fixed test value has the intended Alarm_State under the case thresholds. */
function expectState(vital: VitalName, value: number, state: AlarmState): void {
  expect(getAlarmState(value, ALARMS[vital]!), `${vital} ${value}`).toBe(state);
}

// ---------------------------------------------------------------------------
// Fixed examples from the case thresholds
// ---------------------------------------------------------------------------

describe('mapAvatar: Skin_Tone', () => {
  it.each([
    [0.974, 'normal', 'healthy'],
    [0.93, 'warning', 'pale'],
    [0.85, 'critical', 'cyanotic'],
  ] as const)('SpO2 %s (%s) gives %s', (spo2, state, tone) => {
    expectState('spO2', spo2, state);
    expect(mapAvatar(makeInput({ spo2 })).skinTone).toBe(tone);
  });
});

describe('mapAvatar: breathing and heartbeat', () => {
  it('breathing period is 60 / RR and heartbeat period is 60 / HR', () => {
    const out = mapAvatar(makeInput({ respiratory_rate: 15, heart_rate: 75 }));
    expect(out.breathing).toMatchObject({ stopped: false, periodS: 4 });
    expect(out.heartbeat).toEqual({ stopped: false, periodS: 0.8 });
  });

  it('gives the same output at 1x, 2x and 4x because the mapper has no Playback_Speed input', () => {
    expect(mapAvatar.length).toBe(1);
    const speeds: PlaybackSpeed[] = ['1x', '2x', '4x'];
    const outputs = speeds.map(() => mapAvatar(makeInput({ respiratory_rate: 15, heart_rate: 75 })));
    for (const out of outputs) {
      expect(out).toStrictEqual(outputs[0]);
      expect(out.breathing.periodS).toBe(4);
      expect(out.heartbeat.periodS).toBe(0.8);
    }
  });

  it('breathing is stopped at RR 0', () => {
    const out = mapAvatar(makeInput({ respiratory_rate: 0 }));
    expect(out.breathing.stopped).toBe(true);
    expect(out.breathing.periodS).toBe(DEFAULT_BREATH_PERIOD_S);
    expect(out.heartbeat.stopped).toBe(false);
  });

  it('heartbeat is stopped at HR 0', () => {
    const out = mapAvatar(makeInput({ heart_rate: 0 }));
    expect(out.heartbeat.stopped).toBe(true);
    expect(out.heartbeat.periodS).toBe(DEFAULT_BEAT_PERIOD_S);
    expect(out.breathing.stopped).toBe(false);
  });
});

describe('mapAvatar: sweat flag', () => {
  it.each([
    ['MAP warning', { mean_arterial_pressure: 105 }, true],
    ['MAP critical', { mean_arterial_pressure: 55 }, true],
    ['HR critical with MAP normal', { heart_rate: 150 }, true],
    ['MAP normal with HR normal', {}, false],
    ['MAP normal with HR warning', { heart_rate: 130 }, false],
  ] as const)('%s gives %s', (_label, sample, sweating) => {
    const s = { ...BASELINE, ...sample };
    expect(mapAvatar(makeInput(s)).sweating).toBe(sweating);
  });

  it('the fixed sweat values have the intended states', () => {
    expectState('meanArterialPressure', 105, 'warning');
    expectState('meanArterialPressure', 55, 'critical');
    expectState('meanArterialPressure', 95, 'normal');
    expectState('heartRate', 150, 'critical');
    expectState('heartRate', 130, 'warning');
    expectState('heartRate', 72, 'normal');
  });
});

describe('mapAvatar: breathing depth', () => {
  const withRef = (ref: number): PlaySection => ({ ...PLAY, avatar: { referenceTidalVolumeMl: ref } });

  it.each([
    [50, BREATH_DEPTH_MIN],
    [400, 0.8],
    [500, 1],
    [1000, BREATH_DEPTH_MAX],
  ])('TV %s with reference 500 gives depth %s (clamped to the display range)', (tv, depth) => {
    const out = mapAvatar(makeInput({ tidal_volume: tv }, { play: withRef(500) }));
    expect(out.breathing.depth).toBeCloseTo(depth, 12);
  });

  it('uses referenceTidalVolumeMl before the first positive tidal volume', () => {
    const out = mapAvatar(
      makeInput({ tidal_volume: 500 }, { play: withRef(400), firstPositiveTidalVolumeMl: 250 }),
    );
    expect(out.breathing.depth).toBeCloseTo(1.25, 12);
  });

  it('uses the first positive tidal volume when the Play_Section has no reference', () => {
    const out = mapAvatar(makeInput({ tidal_volume: 500 }, { firstPositiveTidalVolumeMl: 400 }));
    expect(out.breathing.depth).toBeCloseTo(1.25, 12);
  });

  it('gives the default depth while no reference exists', () => {
    const out = mapAvatar(makeInput({ tidal_volume: 900 }));
    expect(out.breathing.depth).toBe(BREATH_DEPTH_DEFAULT);
  });
});

describe('mapAvatar: sides, Overall_Status and bands', () => {
  it('takes Swollen_Sides and Decompressed_Sides from the case insult and Active_Interventions', () => {
    const before = mapAvatar(makeInput({ simulation_time: 10 }, { scheduledInsults: INSULTS }));
    expect(before.swollenSides).toEqual([]);
    const after = mapAvatar(makeInput({ simulation_time: 40 }, { scheduledInsults: INSULTS }));
    expect(after.swollenSides).toEqual(['Left']);
    const treated = mapAvatar(
      makeInput(
        { simulation_time: 70 },
        {
          scheduledInsults: INSULTS,
          activeInterventions: [
            {
              interventionId: 'needle-decompression-left',
              action: 'SENeedleDecompression',
              side: 'Left',
              simulationTime: 60,
              branchId: 'main',
            },
          ],
        },
      ),
    );
    expect(treated.swollenSides).toEqual([]);
    expect(treated.decompressedSides).toEqual(['Left']);
  });

  it('revealedSides gates only swollenSides; decompressedSides is ungated', () => {
    // Left insult at 30 s is untreated at 40 s; a Right needle leaves Left swollen.
    const rest = {
      scheduledInsults: INSULTS,
      activeInterventions: [
        {
          interventionId: 'needle-decompression-right',
          action: 'SENeedleDecompression',
          side: 'Right' as const,
          simulationTime: 35,
          branchId: 'main',
        },
      ],
    };
    const sample = { simulation_time: 40, heart_rate: 130, spo2: 0.85 };
    const found = mapAvatar(makeInput(sample, { ...rest, revealedSides: ['Left'] }));
    const none = mapAvatar(makeInput(sample, { ...rest, revealedSides: [] }));
    const wrong = mapAvatar(makeInput(sample, { ...rest, revealedSides: ['Right'] }));
    const all = mapAvatar(makeInput(sample, { ...rest, revealedSides: 'all' }));

    expect(found.swollenSides).toEqual(['Left']);
    expect(none.swollenSides).toEqual([]);
    expect(wrong.swollenSides).toEqual([]);
    expect(all.swollenSides).toEqual(['Left']);

    const { swollenSides: _a, ...allOthers } = all;
    for (const out of [found, none, wrong]) {
      const { swollenSides: _s, ...others } = out;
      expect(others).toStrictEqual(allOthers);
      expect(out.decompressedSides).toEqual(['Right']);
    }
  });

  it('Overall_Status is the most severe band', () => {
    expect(mapAvatar(makeInput()).overallStatus).toBe('normal');
    expect(mapAvatar(makeInput({ heart_rate: 130 })).overallStatus).toBe('warning');
    expect(mapAvatar(makeInput({ heart_rate: 130, spo2: 0.85 })).overallStatus).toBe('critical');
  });

  it('has bands only for vitals with thresholds', () => {
    const { etCO2: _e, tidalVolume: _t, ...partial } = ALARMS;
    const out = mapAvatar(makeInput({}, { alarms: partial as AlarmThresholds }));
    expect(Object.keys(out.bands).sort()).toEqual(
      ['heartRate', 'meanArterialPressure', 'respiratoryRate', 'spO2'].sort(),
    );
  });
});

describe('mapAvatar: missing vitals', () => {
  it('works without systolic_pressure and diastolic_pressure', () => {
    const without = makeInput();
    expect('systolic_pressure' in without.sample).toBe(false);
    expect('diastolic_pressure' in without.sample).toBe(false);
    const withBp = makeInput({ systolic_pressure: 120, diastolic_pressure: 80 });
    expect(mapAvatar(without)).toStrictEqual(mapAvatar(withBp));
  });

  // Previous result with every field away from its default.
  const PREVIOUS = mapAvatar(
    makeInput(
      {
        heart_rate: 150,
        respiratory_rate: 30,
        spo2: 0.85,
        mean_arterial_pressure: 55,
        etco2: 20,
        tidal_volume: 900,
      },
      { play: { ...PLAY, avatar: { referenceTidalVolumeMl: 500 } } },
    ),
  );

  /** Fields of the result that are derived only from `vital`. */
  const derived = (p: AvatarParameters, vital: VitalName): unknown => {
    switch (vital) {
      case 'heartRate':
        return p.heartbeat;
      case 'respiratoryRate':
        return { stopped: p.breathing.stopped, periodS: p.breathing.periodS };
      case 'spO2':
        return p.skinTone;
      case 'tidalVolume':
        return p.breathing.depth;
      default:
        return undefined;
    }
  };

  describe.each(VITAL_NAMES)('%s missing', (vital) => {
    const field = VITAL_FIELD[vital];
    const variants: [string, Partial<VitalSigns>][] = [
      ['absent', (() => {
        const s: Partial<VitalSigns> = { ...BASELINE };
        delete s[field];
        return s;
      })()],
      ['NaN', { ...BASELINE, [field]: Number.NaN }],
      ['Infinity', { ...BASELINE, [field]: Number.POSITIVE_INFINITY }],
    ];

    it.each(variants)('(%s) keeps the previous values', (_label, sample) => {
      const input = makeInput({}, { previous: PREVIOUS, firstPositiveTidalVolumeMl: 500 });
      input.sample = { simulation_time: 1, ...sample };
      const out = mapAvatar(input);
      expect(out.bands[vital]).toEqual(PREVIOUS.bands[vital]);
      expect(derived(out, vital)).toEqual(derived(PREVIOUS, vital));
    });

    it.each(variants)('(%s) gives the defaults with no previous sample', (_label, sample) => {
      const input = makeInput({}, { firstPositiveTidalVolumeMl: 500 });
      input.sample = { simulation_time: 1, ...sample };
      const out = mapAvatar(input);
      expect(out.bands[vital]).toEqual({ state: 'normal', direction: 'none' });
      if (vital === 'heartRate') expect(out.heartbeat).toEqual({ stopped: false, periodS: DEFAULT_BEAT_PERIOD_S });
      if (vital === 'respiratoryRate') {
        expect(out.breathing).toMatchObject({ stopped: false, periodS: DEFAULT_BREATH_PERIOD_S });
      }
      if (vital === 'tidalVolume') expect(out.breathing.depth).toBe(BREATH_DEPTH_DEFAULT);
      if (vital === 'spO2') expect(out.skinTone).toBe('healthy');
    });
  });

  it('the previous fixture differs from the defaults in every checked field', () => {
    expect(PREVIOUS.heartbeat.periodS).not.toBe(DEFAULT_BEAT_PERIOD_S);
    expect(PREVIOUS.breathing.periodS).not.toBe(DEFAULT_BREATH_PERIOD_S);
    expect(PREVIOUS.breathing.depth).not.toBe(BREATH_DEPTH_DEFAULT);
    expect(PREVIOUS.skinTone).not.toBe('healthy');
    for (const v of VITAL_NAMES) expect(PREVIOUS.bands[v]?.state, v).not.toBe('normal');
  });
});

// ---------------------------------------------------------------------------
// Property tests
// ---------------------------------------------------------------------------

/** Independent reference: Alarm_State to Skin_Tone (Requirements 4.3-4.5). */
const EXPECTED_TONE: Record<AlarmState, AvatarParameters['skinTone']> = {
  normal: 'healthy',
  warning: 'pale',
  critical: 'cyanotic',
};
const SEVERITY: Record<AlarmState, number> = { normal: 0, warning: 1, critical: 2 };

/** Case vital bounds (all defined in the case file). */
function bounds(vital: VitalName): number[] {
  const t = ALARMS[vital]!;
  return [t.critical?.low, t.critical?.high, t.warning?.low, t.warning?.high, t.normal?.low, t.normal?.high].filter(
    (b): b is number => b !== undefined,
  );
}

/** Finite value: zero, negative, a case boundary ± offset, or inside 50%-150% of the boundary span. */
function arbFiniteVital(vital: VitalName): fc.Arbitrary<number> {
  const b = bounds(vital);
  const lo = Math.min(...b);
  const hi = Math.max(...b);
  const off = VITAL_OFFSETS[vital];
  return fc.oneof(
    { weight: 1, arbitrary: fc.constant(0) },
    { weight: 1, arbitrary: fc.double({ min: -2 * hi, max: -off, noNaN: true }) },
    { weight: 3, arbitrary: fc.constantFrom(...b).chain((x) => fc.constantFrom(x - off, x, x + off)) },
    { weight: 3, arbitrary: fc.double({ min: 0.5 * lo, max: 1.5 * hi, noNaN: true }) },
  );
}

/** Sample with all six case vitals present and finite (Property 3 domain). */
const arbFiniteSample = fc.record({
  simulation_time: fc.integer({ min: 0, max: 1200 }).map((n) => n / 2),
  heart_rate: arbFiniteVital('heartRate'),
  respiratory_rate: arbFiniteVital('respiratoryRate'),
  spo2: arbFiniteVital('spO2'),
  mean_arterial_pressure: arbFiniteVital('meanArterialPressure'),
  etco2: arbFiniteVital('etCO2'),
  tidal_volume: arbFiniteVital('tidalVolume'),
});

/** Play_Section with no `avatar`, an empty `avatar`, or a reference tidal volume. */
const arbPlay: fc.Arbitrary<PlaySection> = fc
  .oneof(
    fc.constant<PlaySection['avatar'] | undefined>(undefined),
    fc.constant<PlaySection['avatar']>({}),
    fc.double({ min: 100, max: 1000, noNaN: true }).map((r) => ({ referenceTidalVolumeMl: r })),
  )
  .map((avatar) => (avatar === undefined ? { ...PLAY } : { ...PLAY, avatar }));

const arbFirstPositive = fc.oneof(fc.constant(null), fc.double({ min: 100, max: 1000, noNaN: true }));

const arbPrevious = fc.oneof(fc.constant(null), arbAvatarParameters);

describe('mapAvatar properties', () => {
  // Feature: play-mode, Property 3: Avatar fields follow their vital bands and rates
  it('Property 3: Avatar fields follow their vital bands and rates', () => {
    /** Validates: Requirements 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10, 4.11, 4.12, 4.24 */
    fc.assert(
      fc.property(
        arbFiniteSample,
        arbPlay,
        arbFirstPositive,
        arbPrevious,
        (sample, play, firstPositiveTidalVolumeMl, previous) => {
          const out = mapAvatar({
            sample,
            alarms: ALARMS,
            play,
            scheduledInsults: INSULTS,
            activeInterventions: [],
            previous,
            firstPositiveTidalVolumeMl,
            revealedSides: 'all',
          });

          const state = (v: VitalName): AlarmState =>
            getAlarmState((sample as Partial<VitalSigns>)[VITAL_FIELD[v]] as number, ALARMS[v]!);

          for (const v of VITAL_NAMES) expect(out.bands[v]?.state, v).toBe(state(v));
          expect(out.skinTone).toBe(EXPECTED_TONE[state('spO2')]);

          const rr = sample.respiratory_rate;
          if (rr > 0) {
            expect(out.breathing.stopped).toBe(false);
            expect(out.breathing.periodS).toBe(60 / rr);
          } else {
            expect(out.breathing.stopped).toBe(true);
            expect(out.breathing.periodS).toBe(previous?.breathing.periodS ?? DEFAULT_BREATH_PERIOD_S);
          }

          const hr = sample.heart_rate;
          if (hr > 0) {
            expect(out.heartbeat).toEqual({ stopped: false, periodS: 60 / hr });
          } else {
            expect(out.heartbeat.stopped).toBe(true);
            expect(out.heartbeat.periodS).toBe(previous?.heartbeat.periodS ?? DEFAULT_BEAT_PERIOD_S);
          }

          expect(out.sweating).toBe(
            state('meanArterialPressure') !== 'normal' || state('heartRate') === 'critical',
          );

          const ref = play.avatar?.referenceTidalVolumeMl ?? firstPositiveTidalVolumeMl;
          const ratio = ref == null ? BREATH_DEPTH_DEFAULT : sample.tidal_volume / ref;
          const depth = Math.min(BREATH_DEPTH_MAX, Math.max(BREATH_DEPTH_MIN, ratio));
          expect(out.breathing.depth).toBe(depth);
          expect(out.breathing.depth).toBeGreaterThanOrEqual(BREATH_DEPTH_MIN);
          expect(out.breathing.depth).toBeLessThanOrEqual(BREATH_DEPTH_MAX);

          const worst = VITAL_NAMES.map(state).reduce((a, b) => (SEVERITY[b] > SEVERITY[a] ? b : a));
          expect(out.overallStatus).toBe(worst);
        },
      ),
      PBT_PARAMS,
    );
  });

  /** Thresholds: the case file, or random thresholds with the optional vitals present or absent. */
  const arbAlarms: fc.Arbitrary<AlarmThresholds> = fc.oneof(
    fc.constant(ALARMS),
    fc.record(
      {
        heartRate: arbThreshold,
        respiratoryRate: arbThreshold,
        spO2: arbThreshold,
        meanArterialPressure: arbThreshold,
        etCO2: arbThreshold,
        tidalVolume: arbThreshold,
      },
      { requiredKeys: ['heartRate', 'respiratoryRate', 'spO2', 'meanArterialPressure'] },
    ),
  );

  const arbInput: fc.Arbitrary<AvatarInput> = fc.record({
    sample: arbSample,
    alarms: arbAlarms,
    play: arbPlay,
    scheduledInsults: arbInsults,
    activeInterventions: arbActiveInterventions,
    previous: arbPrevious,
    firstPositiveTidalVolumeMl: fc.oneof(
      arbFirstPositive,
      fc.constantFrom(0, -5, Number.NaN, Number.POSITIVE_INFINITY),
    ),
    revealedSides: fc.constant<AvatarInput['revealedSides']>('all'),
  });

  function deepFreeze<T>(value: T): T {
    if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
      Object.freeze(value);
      for (const v of Object.values(value)) deepFreeze(v);
    }
    return value;
  }

  // Feature: play-mode, Property 4: Avatar_Mapper determinism
  it('Property 4: Avatar_Mapper determinism', () => {
    /** Validates: Requirements 4.22 */
    fc.assert(
      fc.property(arbInput, (input) => {
        const copy = structuredClone(input);
        const frozen = deepFreeze(structuredClone(input));
        // A frozen input throws in strict mode if mapAvatar tries to mutate it.
        const a = mapAvatar(frozen);
        const b = mapAvatar(copy);
        expect(a).toStrictEqual(b);
        expect(copy).toStrictEqual(input);
      }),
      PBT_PARAMS,
    );
  });

  const isMissing = (sample: Partial<VitalSigns>, v: VitalName): boolean => {
    const value: unknown = sample[VITAL_FIELD[v]];
    return typeof value !== 'number' || !Number.isFinite(value);
  };

  // Feature: play-mode, Property 5: Missing vitals keep the previous values
  it('Property 5: Missing vitals keep the previous values', () => {
    /** Validates: Requirements 4.25, 12.14 */
    fc.assert(
      fc.property(arbSample, arbPlay, arbFirstPositive, arbPrevious, (sample, play, first, previous) => {
        let out: AvatarParameters | undefined;
        expect(() => {
          out = mapAvatar({
            sample,
            alarms: ALARMS,
            play,
            scheduledInsults: INSULTS,
            activeInterventions: [],
            previous,
            firstPositiveTidalVolumeMl: first,
            revealedSides: 'all',
          });
        }).not.toThrow();
        const p = out!;

        for (const v of VITAL_NAMES) {
          if (!isMissing(sample, v)) continue;
          expect(p.bands[v], v).toEqual(previous?.bands[v] ?? { state: 'normal', direction: 'none' });
        }
        if (isMissing(sample, 'respiratoryRate')) {
          expect({ stopped: p.breathing.stopped, periodS: p.breathing.periodS }).toEqual(
            previous
              ? { stopped: previous.breathing.stopped, periodS: previous.breathing.periodS }
              : { stopped: false, periodS: DEFAULT_BREATH_PERIOD_S },
          );
        }
        if (isMissing(sample, 'heartRate')) {
          expect(p.heartbeat).toEqual(previous?.heartbeat ?? { stopped: false, periodS: DEFAULT_BEAT_PERIOD_S });
        }
        if (isMissing(sample, 'tidalVolume')) {
          expect(p.breathing.depth).toBe(previous?.breathing.depth ?? BREATH_DEPTH_DEFAULT);
        }
        // Skin_Tone and the sweat flag follow the kept bands.
        expect(p.skinTone).toBe(EXPECTED_TONE[p.bands.spO2!.state]);
        expect(p.sweating).toBe(
          p.bands.meanArterialPressure!.state !== 'normal' || p.bands.heartRate!.state === 'critical',
        );
        expect(p.breathing.depth).toBeGreaterThanOrEqual(BREATH_DEPTH_MIN);
        expect(p.breathing.depth).toBeLessThanOrEqual(BREATH_DEPTH_MAX);
      }),
      PBT_PARAMS,
    );
  });

  /** Exam_Record entries of Side_Neutral_Actions (no `side` key), abnormal or not. */
  const arbSideNeutralRecord: fc.Arbitrary<ExamRecordEntry[]> = fc.array(
    arbExamRecordEntry.map(({ side: _side, ...entry }) => entry),
    { maxLength: 6 },
  );

  /** Play_Section with the shipped Exam_Section. */
  const arbPlayWithExam: fc.Arbitrary<PlaySection> = arbPlay.map((play) => ({
    ...play,
    exam: CASE_LEFT.play!.exam,
  }));

  /** Active_Interventions without any Decompression. */
  const arbNoDecompression = arbActiveInterventions.map((list) =>
    list.filter((e) => e.action !== 'SENeedleDecompression'),
  );

  // Feature: bedside-exam, Property 16: The Avatar is the same in both Variants until a side is found or a needle is used
  it('Property 16: The Avatar is the same in both Variants until a side is found or a needle is used (mapper)', () => {
    /** Validates: Requirements 9.1, 9.3, 14.2 */
    expect(CASE_LEFT.play?.exam).toBeDefined();
    expect(CASE_LEFT.timeline.scheduledInsults).not.toEqual(CASE_RIGHT.timeline.scheduledInsults);
    fc.assert(
      fc.property(
        arbSample,
        arbAlarms,
        arbPlayWithExam,
        arbSideNeutralRecord,
        arbNoDecompression,
        arbPrevious,
        arbFirstPositive,
        (sample, alarms, play, record, activeInterventions, previous, firstPositiveTidalVolumeMl) => {
          const revealedSides = foundSides(record);
          const base = { sample, alarms, play, activeInterventions, previous, firstPositiveTidalVolumeMl, revealedSides };
          const left = mapAvatar({ ...base, scheduledInsults: CASE_LEFT.timeline.scheduledInsults });
          const right = mapAvatar({ ...base, scheduledInsults: CASE_RIGHT.timeline.scheduledInsults });
          expect(left).toStrictEqual(right);
        },
      ),
      PBT_PARAMS,
    );
  });
});
