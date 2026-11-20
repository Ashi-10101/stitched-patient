/**
 * Ending_Evaluator tests (Requirement 6; Properties 12, 13, 14).
 *
 * All Play_Sections here use round test values, not case content.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type {
  CaseData,
  ComparisonOp,
  ConditionGroup,
  PlaySection,
  ScheduledInsult,
  VitalCondition,
  VitalName,
  VitalSigns,
} from '@/types';
import {
  buildEndingContext,
  conditionHolds,
  evaluateEnding,
  initialEndingState,
  stepEnding,
  type Ending,
  type EndingState,
  type Sample,
} from './endingEvaluator';
import { VITAL_FIELD, VITAL_NAMES } from './vitals';
import { CASE } from '@/test/caseFixtures';
import { arbInsults, arbPlaySection, arbSampleSequence } from '@/test/generators';
import { PBT_PARAMS } from '@/test/pbt';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePlay(endings: PlaySection['endings']): PlaySection {
  return {
    goalText: 'Test goal.',
    diagnosisTerms: ['test-diagnosis-term'],
    endings,
    hints: [{ text: 'Test hint.' }],
    status: { rules: [], defaultSentence: 'Test status.' },
  };
}

function insultsAt(times: number[]): ScheduledInsult[] {
  return times.map((timeSeconds) => ({
    timeSeconds,
    action: 'SETensionPneumothorax',
    parameters: { side: 'Left', type: 'Closed', severity: 0.5 },
  }));
}

/** The case file with a test timeline and Play_Section (or none). */
function caseWith(play: PlaySection | undefined, insults: ScheduledInsult[] = []): CaseData {
  const { play: _ignored, ...rest } = CASE;
  return { ...rest, timeline: { scheduledInsults: insults }, ...(play === undefined ? {} : { play }) };
}

/** Samples with the given vitals at each integer time from `from` to `to` inclusive. */
function run(from: number, to: number, vitals: Partial<VitalSigns>): Sample[] {
  const out: Sample[] = [];
  for (let t = from; t <= to; t++) out.push({ ...vitals, simulation_time: t });
  return out;
}

function at(t: number, vitals: Partial<VitalSigns>): Sample {
  return { ...vitals, simulation_time: t };
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

// Rescue: spO2 >= 0.5 and heartRate <= 100 for 10 s.
// Lost: spO2 < 0.3 for 10 s, or heartRate > 150 for 20 s, or time >= 100 s.
const PLAY = makePlay({
  rescued: {
    conditions: [
      { vital: 'spO2', op: '>=', value: 0.5 },
      { vital: 'heartRate', op: '<=', value: 100 },
    ],
    holdSeconds: 10,
  },
  lost: {
    groups: [
      { conditions: [{ vital: 'spO2', op: '<', value: 0.3 }], holdSeconds: 10 },
      { conditions: [{ vital: 'heartRate', op: '>', value: 150 }], holdSeconds: 20 },
    ],
    timeLimitSeconds: 100,
  },
});

// Rescue and lost conditions can hold at once: spO2 >= 0.5 vs MAP <= 60, both for 10 s.
const PLAY_OVERLAP = makePlay({
  rescued: { conditions: [{ vital: 'spO2', op: '>=', value: 0.5 }], holdSeconds: 10 },
  lost: {
    groups: [{ conditions: [{ vital: 'meanArterialPressure', op: '<=', value: 60 }], holdSeconds: 10 }],
    timeLimitSeconds: 100,
  },
});

const GOOD = { spo2: 0.9, heart_rate: 80 };
const NEUTRAL = { spo2: 0.4, heart_rate: 120 };
const LOW_SPO2 = { spo2: 0.2, heart_rate: 120 };
const HIGH_HR = { spo2: 0.4, heart_rate: 160 };

const CTX = buildEndingContext(caseWith(PLAY));

// ---------------------------------------------------------------------------
// Fixed sequences
// ---------------------------------------------------------------------------

describe('buildEndingContext and initialEndingState', () => {
  it('rescueFromTime is the earliest insult time, or 0 without insults', () => {
    expect(buildEndingContext(caseWith(PLAY)).rescueFromTime).toBe(0);
    expect(buildEndingContext(caseWith(PLAY, insultsAt([30, 20, 45]))).rescueFromTime).toBe(20);
  });

  it('a missing timeline counts as no insults', () => {
    const noTimeline = { ...caseWith(PLAY), timeline: undefined } as unknown as CaseData;
    expect(buildEndingContext(noTimeline).rescueFromTime).toBe(0);
  });

  it('starts at none with one empty lost stretch per group, and a missing groups list counts as []', () => {
    expect(initialEndingState(CTX)).toEqual({
      ending: 'none',
      endedAt: null,
      lastTime: null,
      rescueStart: null,
      lostStarts: [null, null],
    });
    const noGroups = buildEndingContext(
      caseWith(makePlay({ rescued: PLAY.endings.rescued, lost: { timeLimitSeconds: 100 } })),
    );
    expect(initialEndingState(noGroups).lostStarts).toEqual([]);
    const state = evaluateEnding(noGroups, run(0, 99, LOW_SPO2));
    expect(state.ending).toBe('none');
    expect(evaluateEnding(noGroups, run(0, 100, LOW_SPO2)).ending).toBe('lost');
  });
});

describe('evaluateEnding: none', () => {
  it('returns none for no samples', () => {
    expect(evaluateEnding(CTX, [])).toEqual(initialEndingState(CTX));
  });

  it('returns none without a Play_Section', () => {
    const ctx = buildEndingContext(caseWith(undefined));
    expect(ctx.play).toBeUndefined();
    const state = evaluateEnding(ctx, run(0, 200, GOOD));
    expect(state.ending).toBe('none');
    expect(state.endedAt).toBeNull();
  });

  it('returns none when no condition is met', () => {
    const state = evaluateEnding(CTX, run(0, 99, NEUTRAL));
    expect(state.ending).toBe('none');
    expect(state.endedAt).toBeNull();
  });
});

describe('evaluateEnding: rescue', () => {
  it('a rescue stretch exactly holdSeconds long returns rescued; without its last sample, none', () => {
    const samples = run(0, 10, GOOD);
    expect(evaluateEnding(CTX, samples)).toMatchObject({ ending: 'rescued', endedAt: 10 });
    expect(evaluateEnding(CTX, samples.slice(0, -1)).ending).toBe('none');
  });

  it('samples below the earliest insult time add no rescue hold time', () => {
    const ctx = buildEndingContext(caseWith(PLAY, insultsAt([20])));
    expect(ctx.rescueFromTime).toBe(20);
    const before = evaluateEnding(ctx, run(0, 19, GOOD));
    expect(before.rescueStart).toBeNull();
    expect(evaluateEnding(ctx, run(0, 29, GOOD)).ending).toBe('none');
    expect(evaluateEnding(ctx, run(0, 30, GOOD))).toMatchObject({ ending: 'rescued', endedAt: 30, rescueStart: 20 });
  });
});

describe('evaluateEnding: lost', () => {
  it('a stretch exactly the first group holdSeconds long returns lost', () => {
    expect(evaluateEnding(CTX, run(0, 10, LOW_SPO2))).toMatchObject({ ending: 'lost', endedAt: 10 });
    expect(evaluateEnding(CTX, run(0, 9, LOW_SPO2)).ending).toBe('none');
  });

  it('a stretch exactly the second group holdSeconds long returns lost', () => {
    expect(evaluateEnding(CTX, run(0, 20, HIGH_HR))).toMatchObject({ ending: 'lost', endedAt: 20 });
    expect(evaluateEnding(CTX, run(0, 19, HIGH_HR)).ending).toBe('none');
  });

  it('a sample exactly at timeLimitSeconds returns lost; one below returns none', () => {
    expect(evaluateEnding(CTX, run(0, 100, NEUTRAL))).toMatchObject({ ending: 'lost', endedAt: 100 });
    expect(evaluateEnding(CTX, run(0, 99, NEUTRAL)).ending).toBe('none');
    expect(evaluateEnding(CTX, [at(99.5, NEUTRAL)]).ending).toBe('none');
    expect(evaluateEnding(CTX, [at(100, NEUTRAL)])).toMatchObject({ ending: 'lost', endedAt: 100 });
  });
});

describe('evaluateEnding: stretches and ignored samples', () => {
  it('one failing sample restarts a stretch', () => {
    const broken = [...run(0, 5, GOOD), at(6, NEUTRAL), ...run(7, 16, GOOD)];
    expect(evaluateEnding(CTX, broken)).toMatchObject({ ending: 'none', rescueStart: 7 });
    expect(evaluateEnding(CTX, [...broken, at(17, GOOD)])).toMatchObject({ ending: 'rescued', endedAt: 17 });
  });

  it('equal and decreasing times add no hold time and break no stretch', () => {
    const samples = [...run(0, 5, GOOD), at(5, NEUTRAL), at(3, NEUTRAL), at(5, GOOD), ...run(6, 9, GOOD)];
    expect(evaluateEnding(CTX, samples)).toMatchObject({ ending: 'none', rescueStart: 0, lastTime: 9 });
    expect(evaluateEnding(CTX, [...samples, at(10, GOOD)])).toMatchObject({ ending: 'rescued', endedAt: 10 });
    // A decreasing time after a lost stretch neither completes nor breaks it.
    const lost = [...run(0, 9, LOW_SPO2), at(2, GOOD), at(10, LOW_SPO2)];
    expect(evaluateEnding(CTX, lost)).toMatchObject({ ending: 'lost', endedAt: 10 });
  });

  it('a non-finite time is ignored and returns the state unchanged', () => {
    const state = evaluateEnding(CTX, run(0, 5, GOOD));
    for (const t of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(stepEnding(CTX, state, at(t, NEUTRAL))).toBe(state);
    }
    const samples = [
      ...run(0, 5, GOOD),
      at(Number.NaN, NEUTRAL),
      at(Number.POSITIVE_INFINITY, NEUTRAL),
      at(Number.NEGATIVE_INFINITY, NEUTRAL),
      ...run(6, 10, GOOD),
    ];
    expect(evaluateEnding(CTX, samples)).toMatchObject({ ending: 'rescued', endedAt: 10 });
    // +Infinity would reach the Time_Limit if it were accepted.
    expect(evaluateEnding(CTX, [at(0, NEUTRAL), at(Number.POSITIVE_INFINITY, NEUTRAL)]).ending).toBe('none');
  });
});

describe('evaluateEnding: rescue wins and the Ending stays', () => {
  it('one sample completing both rescue and lost returns rescued', () => {
    const ctx = buildEndingContext(caseWith(PLAY_OVERLAP));
    const samples = run(0, 10, { spo2: 0.9, mean_arterial_pressure: 50 });
    const before = evaluateEnding(ctx, samples.slice(0, -1));
    expect(before.ending).toBe('none');
    expect(before.lostStarts).toEqual([0]);
    expect(evaluateEnding(ctx, samples)).toMatchObject({ ending: 'rescued', endedAt: 10 });
  });

  it('rescue completing at the Time_Limit returns rescued', () => {
    const samples = [...run(0, 89, NEUTRAL), ...run(90, 100, GOOD)];
    expect(evaluateEnding(CTX, samples)).toMatchObject({ ending: 'rescued', endedAt: 100 });
  });

  it('the Ending stays once set', () => {
    const rescued = evaluateEnding(CTX, [...run(0, 10, GOOD), ...run(11, 200, LOW_SPO2)]);
    expect(rescued).toMatchObject({ ending: 'rescued', endedAt: 10, lastTime: 10 });
    const lost = evaluateEnding(CTX, [...run(0, 10, LOW_SPO2), ...run(11, 50, GOOD)]);
    expect(lost).toMatchObject({ ending: 'lost', endedAt: 10, lastTime: 10 });
    expect(stepEnding(CTX, lost, at(60, GOOD))).toBe(lost);
  });
});

describe('conditionHolds and missing vitals', () => {
  it('compares the sample value with the condition value using the operator', () => {
    const c = (op: ComparisonOp): VitalCondition => ({ vital: 'heartRate', op, value: 100 });
    const hr = (heart_rate: number) => ({ heart_rate });
    expect([99, 100, 101].map((v) => conditionHolds(c('<'), hr(v)))).toEqual([true, false, false]);
    expect([99, 100, 101].map((v) => conditionHolds(c('<='), hr(v)))).toEqual([true, true, false]);
    expect([99, 100, 101].map((v) => conditionHolds(c('>='), hr(v)))).toEqual([false, true, true]);
    expect([99, 100, 101].map((v) => conditionHolds(c('>'), hr(v)))).toEqual([false, false, true]);
    expect(conditionHolds({ vital: 'spO2', op: '>=', value: 0.5 }, { spo2: 0.5 })).toBe(true);
  });

  it('a missing or non-finite vital makes its condition not held', () => {
    expect(conditionHolds({ vital: 'spO2', op: '>=', value: 0.5 }, {})).toBe(false);
    expect(conditionHolds({ vital: 'spO2', op: '>=', value: 0.5 }, { spo2: Number.NaN })).toBe(false);
    expect(conditionHolds({ vital: 'spO2', op: '>=', value: 0.5 }, { spo2: Number.POSITIVE_INFINITY })).toBe(false);
    expect(conditionHolds({ vital: 'spO2', op: '<', value: 0.3 }, { spo2: Number.NEGATIVE_INFINITY })).toBe(false);
    expect(
      conditionHolds({ vital: 'spO2', op: '>=', value: 0.5 }, { spo2: null } as unknown as Partial<VitalSigns>),
    ).toBe(false);
    expect(evaluateEnding(CTX, run(0, 50, { heart_rate: 80 })).ending).toBe('none');
    expect(evaluateEnding(CTX, run(0, 50, { heart_rate: 80, spo2: Number.NaN })).ending).toBe('none');
  });

  it('samples without systolic and diastolic pressure return without throwing', () => {
    const samples = run(0, 10, { ...GOOD, mean_arterial_pressure: 90, respiratory_rate: 14 });
    expect(samples.every((s) => !('systolic_pressure' in s) && !('diastolic_pressure' in s))).toBe(true);
    expect(() => evaluateEnding(CTX, samples)).not.toThrow();
    expect(evaluateEnding(CTX, samples).ending).toBe('rescued');
  });

  it('stepEnding does not mutate its inputs', () => {
    const ctx = deepFreeze(buildEndingContext(caseWith(structuredClone(PLAY))));
    const state = deepFreeze(evaluateEnding(ctx, run(0, 5, LOW_SPO2)));
    const next = stepEnding(ctx, state, deepFreeze(at(6, LOW_SPO2)));
    expect(next).not.toBe(state);
    expect(next.lostStarts).not.toBe(state.lostStarts);
    expect(state).toMatchObject({ lastTime: 5, lostStarts: [0, null] });
    expect(next).toMatchObject({ lastTime: 6, lostStarts: [0, null] });
  });
});

// ---------------------------------------------------------------------------
// Reference model (independent of endingEvaluator.ts)
// ---------------------------------------------------------------------------

function refValue(sample: Sample, vital: VitalName): number | undefined {
  const v: unknown = (sample as Record<string, unknown>)[VITAL_FIELD[vital]];
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function refCompare(a: number, op: ComparisonOp, b: number): boolean {
  if (op === '<') return a < b;
  if (op === '<=') return a <= b;
  if (op === '>=') return a >= b;
  return a > b;
}

function refAll(conditions: VitalCondition[], sample: Sample): boolean {
  for (const c of conditions) {
    const v = refValue(sample, c.vital);
    if (v === undefined || !refCompare(v, c.op, c.value)) return false;
  }
  return true;
}

/**
 * Filters the accepted samples, then returns the Ending at the first accepted
 * sample where a rescue run, a lost-group run or the Time_Limit is reached.
 */
function refEnding(
  play: PlaySection | undefined,
  insultTimes: number[],
  samples: Sample[],
): { ending: Ending; endedAt: number | null } {
  if (play === undefined) return { ending: 'none', endedAt: null };
  const finiteInsults = insultTimes.filter((t) => Number.isFinite(t));
  const from = finiteInsults.length === 0 ? 0 : finiteInsults.reduce((a, b) => (b < a ? b : a));

  const accepted: Sample[] = [];
  for (const s of samples) {
    const t = s.simulation_time;
    if (!Number.isFinite(t)) continue;
    if (accepted.length > 0 && t <= accepted[accepted.length - 1].simulation_time) continue;
    accepted.push(s);
  }

  const rescueAt = (s: Sample) => s.simulation_time >= from && refAll(play.endings.rescued.conditions, s);
  const groups: ConditionGroup[] = play.endings.lost.groups ?? [];
  const limit = play.endings.lost.timeLimitSeconds;

  /** Whether the unbroken run of `holds` samples ending at index j spans at least `hold` seconds. */
  const runReached = (j: number, holds: (s: Sample) => boolean, hold: number): boolean => {
    if (!holds(accepted[j])) return false;
    let k = j;
    while (k > 0 && holds(accepted[k - 1])) k--;
    return accepted[j].simulation_time - accepted[k].simulation_time >= hold;
  };

  for (let j = 0; j < accepted.length; j++) {
    const t = accepted[j].simulation_time;
    const rescueHit = runReached(j, rescueAt, play.endings.rescued.holdSeconds);
    const groupHit = groups.some((g) => runReached(j, (s) => refAll(g.conditions, s), g.holdSeconds));
    const timeHit = limit !== undefined && t >= limit;
    if (rescueHit) return { ending: 'rescued', endedAt: t };
    if (groupHit || timeHit) return { ending: 'lost', endedAt: t };
  }
  return { ending: 'none', endedAt: null };
}

// ---------------------------------------------------------------------------
// Scenario generators
// ---------------------------------------------------------------------------

interface Scenario {
  play: PlaySection | undefined;
  insults: ScheduledInsult[];
  samples: Sample[];
}

/** Generic scenario from the shared generators: random conditions over random vitals. */
const arbGenericScenario: fc.Arbitrary<Scenario> = fc.record({
  play: fc.option(arbPlaySection, { nil: undefined, freq: 10 }),
  insults: arbInsults,
  samples: arbSampleSequence,
});

/**
 * Focused scenario so that every Ending occurs often: conditions on 2 or 3
 * vitals with thresholds 25/50/75, and piecewise-constant vitals drawn from
 * 0/25/50/75/100 (sometimes missing or non-finite). Hold times, Time_Limits and
 * segment lengths come from small aligned sets, so rescue and lost (group or
 * Time_Limit) sometimes complete on the same sample.
 * Times mostly step by 1 s, with repeats, decreases and non-finite times.
 */
const FOCUS_THRESHOLDS = [25, 50, 75] as const;
const FOCUS_VALUES = [0, 25, 50, 75, 100] as const;
const MISSING = Symbol('missing');

const arbFocusStep = fc.oneof(
  { weight: 10, arbitrary: fc.constant(1) },
  { weight: 1, arbitrary: fc.constant(0) },
  { weight: 1, arbitrary: fc.integer({ min: -3, max: -1 }) },
  { weight: 1, arbitrary: fc.constantFrom(Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY) },
);

/** Segment lengths: mostly 5 or 10 samples, so stretches start on 5 s boundaries and line up with Time_Limits. */
const arbFocusSegmentLength = fc.oneof(
  { weight: 2, arbitrary: fc.constantFrom(5, 10) },
  { weight: 1, arbitrary: fc.integer({ min: 1, max: 15 }) },
);

function arbFocusGroup(pool: VitalName[]): fc.Arbitrary<ConditionGroup> {
  return fc.record({
    conditions: fc.array(
      fc.record({
        vital: fc.constantFrom(...pool),
        op: fc.constantFrom<ComparisonOp>('<', '<=', '>=', '>'),
        value: fc.constantFrom(...FOCUS_THRESHOLDS),
      }),
      { minLength: 1, maxLength: 2 },
    ),
    holdSeconds: fc.constantFrom(2, 5, 10),
  });
}

function arbFocusVitals(pool: VitalName[]): fc.Arbitrary<Partial<VitalSigns>> {
  const value: fc.Arbitrary<number | typeof MISSING> = fc.oneof(
    { weight: 12, arbitrary: fc.constantFrom(...FOCUS_VALUES) },
    { weight: 1, arbitrary: fc.constantFrom(Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY) },
    { weight: 1, arbitrary: fc.constant(MISSING) },
  );
  return fc.array(value, { minLength: pool.length, maxLength: pool.length }).map((values) => {
    const out: Record<string, number> = {};
    pool.forEach((vital, i) => {
      const v = values[i];
      if (v !== MISSING) out[VITAL_FIELD[vital]] = v;
    });
    return out as Partial<VitalSigns>;
  });
}

const arbFocusBase: fc.Arbitrary<Scenario> = fc
  .shuffledSubarray([...VITAL_NAMES], { minLength: 2, maxLength: 3 })
  .chain((pool) =>
    fc.record({
      play: fc
        .record({
          rescued: arbFocusGroup(pool),
          groups: fc.array(arbFocusGroup(pool), { maxLength: 2 }),
          timeLimitSeconds: fc.option(fc.constantFrom(10, 20, 30, 60, 90), { nil: undefined }),
        })
        .filter(({ groups, timeLimitSeconds }) => groups.length > 0 || timeLimitSeconds !== undefined)
        .map(({ rescued, groups, timeLimitSeconds }) =>
          makePlay({
            rescued,
            lost: { ...(groups.length ? { groups } : {}), ...(timeLimitSeconds ? { timeLimitSeconds } : {}) },
          }),
        ),
      insults: fc.array(fc.constantFrom(0, 5, 15, 30), { maxLength: 2 }).map(insultsAt),
      samples: fc
        .record({
          start: fc.constantFrom(0, 0, 3),
          segments: fc.array(fc.record({ vitals: arbFocusVitals(pool), length: arbFocusSegmentLength }), {
            minLength: 1,
            maxLength: 8,
          }),
          steps: fc.array(arbFocusStep, { minLength: 120, maxLength: 120 }),
        })
        .map(({ start, segments, steps }) => {
          const vitals = segments.flatMap((seg) => Array.from({ length: seg.length }, () => seg.vitals));
          let t = start;
          return vitals.map((v, i): Sample => {
            const step = steps[i];
            if (!Number.isFinite(step)) return { ...v, simulation_time: step };
            if (i > 0) t += step;
            return { ...v, simulation_time: t };
          });
        }),
    }),
  );

/**
 * Steers some focused scenarios to the tie cases of Requirement 6.9:
 * - `limit`: the Time_Limit is set to the time at which the rescue stretch
 *   would complete (found with the reference model using rescue only);
 * - `group`: a lost group with the same conditions and hold as the rescue is added.
 * The evaluator is still checked against the reference model on the result.
 */
const arbFocusScenario: fc.Arbitrary<Scenario> = fc
  .tuple(arbFocusBase, fc.constantFrom('keep', 'keep', 'limit', 'group'))
  .map(([sc, steer]): Scenario => {
    const play = sc.play!;
    const { rescued, lost } = play.endings;
    if (steer === 'limit') {
      const rescueOnly = makePlay({ rescued, lost: {} });
      const r = refEnding(rescueOnly, sc.insults.map((i) => i.timeSeconds), sc.samples);
      if (r.ending !== 'rescued' || r.endedAt === null) return sc;
      return { ...sc, play: makePlay({ rescued, lost: { ...lost, timeLimitSeconds: r.endedAt } }) };
    }
    if (steer === 'group') {
      const groups = [...(lost.groups ?? []), { conditions: rescued.conditions, holdSeconds: rescued.holdSeconds }];
      return { ...sc, play: makePlay({ rescued, lost: { ...lost, groups } }) };
    }
    return sc;
  });

const arbScenario: fc.Arbitrary<Scenario> = fc.oneof(
  { weight: 1, arbitrary: arbGenericScenario },
  { weight: 3, arbitrary: arbFocusScenario },
);

function contextOf(sc: Scenario) {
  return buildEndingContext(caseWith(sc.play, sc.insults));
}

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

describe('Ending_Evaluator: properties', () => {
  // Feature: play-mode, Property 12: Ending matches the reference model
  it('Property 12: Ending matches the reference model', () => {
    fc.assert(
      fc.property(arbScenario, (sc) => {
        const state = evaluateEnding(contextOf(sc), sc.samples);
        const ref = refEnding(
          sc.play,
          sc.insults.map((i) => i.timeSeconds),
          sc.samples,
        );
        expect({ ending: state.ending, endedAt: state.endedAt }).toEqual(ref);
      }),
      PBT_PARAMS,
    );
  });

  // Feature: play-mode, Property 13: The Ending is monotonic
  it('Property 13: The Ending is monotonic', () => {
    fc.assert(
      fc.property(arbScenario, arbSampleSequence, fc.boolean(), (sc, more, shift) => {
        const ctx = contextOf(sc);
        const ended = evaluateEnding(ctx, sc.samples);
        fc.pre(ended.ending !== 'none');
        // Optionally move the appended samples after the last accepted time so they would be accepted.
        const offset = shift ? (ended.lastTime ?? 0) + 1 : 0;
        const appended = more.map((s) => ({ ...s, simulation_time: s.simulation_time + offset }));
        let state: EndingState = ended;
        for (const s of appended) {
          state = stepEnding(ctx, state, s);
          expect(state.ending).toBe(ended.ending);
          expect(state.endedAt).toBe(ended.endedAt);
        }
        const longer = evaluateEnding(ctx, [...sc.samples, ...appended]);
        expect(longer.ending).toBe(ended.ending);
        expect(longer.endedAt).toBe(ended.endedAt);
      }),
      PBT_PARAMS,
    );
  });

  // Feature: play-mode, Property 14: Incremental evaluation equals batch evaluation
  it('Property 14: Incremental evaluation equals batch evaluation', () => {
    fc.assert(
      fc.property(arbScenario, fc.array(fc.nat(), { maxLength: 6 }), (sc, rawCuts) => {
        const ctx = contextOf(sc);
        const n = sc.samples.length;
        const cuts = [...new Set(rawCuts.map((c) => c % (n + 1)))].sort((a, b) => a - b);
        const bounds = [0, ...cuts, n];

        let oneByOne = initialEndingState(ctx);
        for (const s of sc.samples) oneByOne = stepEnding(ctx, oneByOne, s);

        let chunked = initialEndingState(ctx);
        for (let i = 0; i + 1 < bounds.length; i++) {
          chunked = evaluateEnding(ctx, sc.samples.slice(bounds[i], bounds[i + 1]), chunked);
        }

        const batch = evaluateEnding(ctx, sc.samples);
        expect(oneByOne).toEqual(batch);
        expect(chunked).toEqual(batch);
      }),
      PBT_PARAMS,
    );
  });
});
