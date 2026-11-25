/**
 * Ending_Evaluator tests (Requirement 6; Properties 12, 13, 14, 24).
 *
 * All Play_Sections here use round test values, not case content.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type {
  CaseData,
  ComparisonOp,
  ConditionGroup,
  InterventionRecordEntry,
  PlaySection,
  ScheduledInsult,
  VitalCondition,
  VitalName,
  VitalSigns,
} from '@/types';
import {
  buildEndingContext,
  conditionHolds,
  earliestInsultTime,
  evaluateEnding,
  initialEndingState,
  requiredInterventions,
  rescueGateTime,
  setRescueGate,
  stepEnding,
  type Ending,
  type EndingContext,
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
// Rescue_Gate_Time (Requirements 6.18-6.24, 12.17)
// ---------------------------------------------------------------------------

/**
 * PLAY_OVERLAP with a Required_Intervention, so `buildEndingContext` gives a
 * `null` gate. Rescue and lost conditions can hold at once.
 */
const PLAY_OVERLAP_REQUIRED = makePlay({
  ...PLAY_OVERLAP.endings,
  rescued: { ...PLAY_OVERLAP.endings.rescued, requiredInterventions: ['needle-decompression-left'] },
});

function entry(interventionId: string, simulationTime: number, branchId = 'main'): InterventionRecordEntry {
  const side = interventionId.endsWith('-right') ? 'Right' : 'Left';
  return { interventionId, action: 'SENeedleDecompression', side, simulationTime, branchId };
}

/** Folds `stepEnding` one sample at a time and returns the state after each sample. */
function states(ctx: EndingContext, samples: Sample[]): EndingState[] {
  const out: EndingState[] = [];
  let s = initialEndingState(ctx);
  for (const sample of samples) {
    s = stepEnding(ctx, s, sample);
    out.push(s);
  }
  return out;
}

describe('Rescue_Gate_Time in the Ending_Evaluator', () => {
  it('with a fixed finite gate, samples before it add no rescue hold time; a holdSeconds stretch from it returns rescued (6.3)', () => {
    const ctx: EndingContext = { ...CTX, rescueGateTime: 20 };
    expect(ctx.rescueFromTime).toBe(0);
    // GOOD satisfies the Rescue_Condition at every sample from t = 0.
    const before = evaluateEnding(ctx, run(0, 19, GOOD));
    expect(before.rescueStart).toBeNull();
    expect(before.ending).toBe('none');
    expect(evaluateEnding(ctx, run(0, 29, GOOD))).toMatchObject({ ending: 'none', rescueStart: 20 });
    expect(evaluateEnding(ctx, run(0, 30, GOOD))).toMatchObject({ ending: 'rescued', endedAt: 30, rescueStart: 20 });
    // The same stretch starting exactly at the gate, without earlier samples.
    expect(evaluateEnding(ctx, run(20, 30, GOOD))).toMatchObject({ ending: 'rescued', endedAt: 30, rescueStart: 20 });
    expect(evaluateEnding(ctx, run(20, 29, GOOD)).ending).toBe('none');
  });

  it('with Required_Interventions and a null gate, rescue never holds; lost still comes through a group and the Time_Limit', () => {
    const ctx = buildEndingContext(caseWith(PLAY_OVERLAP_REQUIRED));
    expect(ctx.rescueGateTime).toBeNull();

    // Every sample satisfies the Rescue_Condition (spO2 >= 0.5) and the lost group (MAP <= 60).
    const byGroup = states(ctx, run(0, 10, { spo2: 0.9, mean_arterial_pressure: 50 }));
    expect(byGroup.every((s) => s.ending !== 'rescued' && s.rescueStart === null)).toBe(true);
    expect(byGroup[byGroup.length - 1]).toMatchObject({ ending: 'lost', endedAt: 10 });

    // Every sample satisfies the Rescue_Condition only; the Time_Limit is 100 s.
    const byLimit = states(ctx, run(0, 100, { spo2: 0.9, mean_arterial_pressure: 90 }));
    expect(byLimit.every((s) => s.ending !== 'rescued' && s.rescueStart === null)).toBe(true);
    expect(byLimit[byLimit.length - 2].ending).toBe('none');
    expect(byLimit[byLimit.length - 1]).toMatchObject({ ending: 'lost', endedAt: 100 });
  });

  it('a sequence modelled on the 2026-11-20 run, with no Intervention, returns none at 61 s and later (6.3, 6.18)', () => {
    // The real case: insult at 30 s, Required_Interventions listed, no Intervention applied.
    const ctx = buildEndingContext(CASE);
    expect(ctx.rescueFromTime).toBe(30);
    expect(requiredInterventions(CASE.play)).toEqual(['needle-decompression-left']);
    expect(ctx.rescueGateTime).toBeNull();
    const rescue = CASE.play!.endings.rescued;

    // Vitals that satisfy every rescue condition at every sample, from the insult time onward.
    const vitals = { spo2: 0.974, heart_rate: 72, mean_arterial_pressure: 95, respiratory_rate: 16 };
    const samples = run(0, 300, vitals);
    expect(samples.every((s) => rescue.conditions.every((c) => conditionHolds(c, s)))).toBe(true);

    const all = states(ctx, samples);
    samples.forEach((s, i) => {
      if (s.simulation_time >= 61) expect(all[i].ending).toBe('none');
    });
    // Without the gate the same sequence was rescued once the hold completed after the insult.
    expect(evaluateEnding({ ...ctx, rescueGateTime: Number.NEGATIVE_INFINITY }, samples)).toMatchObject({
      ending: 'rescued',
      endedAt: 30 + rescue.holdSeconds,
    });
  });

  it('rescueGateTime is the largest earliest entry time, null for a missing id, and ignores the other side (6.18, 6.19)', () => {
    const left = 'needle-decompression-left';
    const right = 'needle-decompression-right';
    // No Earliest_Insult_Time here, so every entry is a Gate_Entry (6.26).
    // Earliest per id: left 5, right 20; the gate is the largest of those.
    expect(
      rescueGateTime([left, right], [entry(left, 10), entry(right, 30), entry(left, 5), entry(right, 20)], undefined),
    ).toBe(20);
    expect(rescueGateTime([left, right], [entry(right, 20), entry(left, 40)], undefined)).toBe(40);
    expect(rescueGateTime([left], [entry(left, 42.5)], undefined)).toBe(42.5);
    // One required id has no entry.
    expect(rescueGateTime([left, right], [entry(left, 10)], undefined)).toBeNull();
    expect(rescueGateTime([left], [], undefined)).toBeNull();
    // Only the right side is active while the left one is required.
    expect(rescueGateTime([left], [entry(right, 10), entry(right, 50)], undefined)).toBeNull();
    // No Required_Interventions.
    expect(rescueGateTime([], [entry(left, 10)], undefined)).toBe(Number.NEGATIVE_INFINITY);
  });

  it('only Gate_Entries at or after the Earliest_Insult_Time open the gate (6.25, 12.18)', () => {
    const left = 'needle-decompression-left';
    const right = 'needle-decompression-right';
    // Insult at 30 s, as in the shipped case.
    expect(rescueGateTime([left], [entry(left, 20)], 30)).toBeNull();
    expect(rescueGateTime([left], [entry(left, 30)], 30)).toBe(30);
    expect(rescueGateTime([left], [entry(left, 20), entry(left, 150)], 30)).toBe(150);
    expect(rescueGateTime([left], [entry(left, 150), entry(left, 20)], 30)).toBe(150);
    // A right entry after the insult still does not open a left gate (6.19).
    expect(rescueGateTime([left], [entry(left, 20), entry(right, 60)], 30)).toBeNull();
    // Without Required_Interventions the gate stays open whatever the entries.
    expect(rescueGateTime([], [entry(left, 20)], 30)).toBe(Number.NEGATIVE_INFINITY);
  });

  it('with no finite insult time every entry counts, as before 6.25 (6.26)', () => {
    const left = 'needle-decompression-left';
    expect(rescueGateTime([left], [entry(left, 20)], undefined)).toBe(20);
    expect(rescueGateTime([left], [entry(left, 20), entry(left, 150)], undefined)).toBe(20);
    expect(rescueGateTime([left], [entry(left, 0)], undefined)).toBe(0);
    // buildEndingContext of a case without insults passes `undefined`.
    const ctx = buildEndingContext(caseWith(PLAY_OVERLAP_REQUIRED));
    expect(earliestInsultTime(caseWith(PLAY_OVERLAP_REQUIRED))).toBeUndefined();
    expect(ctx.rescueFromTime).toBe(0);
    expect(ctx.rescueGateTime).toBeNull();
  });

  it('earliestInsultTime is the smallest finite insult time, or undefined without one', () => {
    expect(earliestInsultTime(CASE)).toBe(30);
    expect(buildEndingContext(CASE).rescueFromTime).toBe(30);
    expect(earliestInsultTime(caseWith(PLAY))).toBeUndefined();
    expect(earliestInsultTime(caseWith(PLAY, insultsAt([45, 30, 60])))).toBe(30);
    const noTimeline = { ...caseWith(PLAY), timeline: undefined } as unknown as CaseData;
    expect(earliestInsultTime(noTimeline)).toBeUndefined();
    const noList = { ...caseWith(PLAY), timeline: {} } as unknown as CaseData;
    expect(earliestInsultTime(noList)).toBeUndefined();
    // Non-finite times are skipped.
    const nonFinite = insultsAt([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]);
    expect(earliestInsultTime(caseWith(PLAY, nonFinite))).toBeUndefined();
    expect(buildEndingContext(caseWith(PLAY, nonFinite)).rescueFromTime).toBe(0);
    expect(earliestInsultTime(caseWith(PLAY, [...nonFinite, ...insultsAt([42])]))).toBe(42);
  });

  it('without Required_Interventions the gate is -Infinity and the Endings equal those without a gate (6.20)', () => {
    expect(requiredInterventions(PLAY)).toEqual([]);
    expect(requiredInterventions(undefined)).toEqual([]);
    const sequences: Sample[][] = [
      run(0, 10, GOOD),
      run(0, 40, GOOD),
      [...run(0, 5, GOOD), at(6, NEUTRAL), ...run(7, 17, GOOD)],
      run(0, 10, LOW_SPO2),
      run(0, 100, NEUTRAL),
      [...run(0, 89, NEUTRAL), ...run(90, 100, GOOD)],
    ];
    for (const insults of [[], [20]]) {
      const ctx = buildEndingContext(caseWith(PLAY, insultsAt(insults)));
      expect(ctx.rescueGateTime).toBe(Number.NEGATIVE_INFINITY);
      for (const samples of sequences) {
        const state = evaluateEnding(ctx, samples);
        expect({ ending: state.ending, endedAt: state.endedAt }).toEqual(refEnding(PLAY, insults, samples));
      }
    }
  });

  it('setRescueGate ends an open stretch before a later or null gate and keeps the other fields (6.24)', () => {
    const ctx = buildEndingContext(caseWith(PLAY_OVERLAP));
    expect(ctx.rescueGateTime).toBe(Number.NEGATIVE_INFINITY);
    // Both the rescue and the lost stretch are open from t = 0.
    const open = evaluateEnding(ctx, run(0, 5, { spo2: 0.9, mean_arterial_pressure: 50 }));
    expect(open).toMatchObject({ ending: 'none', rescueStart: 0, lastTime: 5, lostStarts: [0] });

    for (const gate of [3, null]) {
      const next = setRescueGate(ctx, open, gate);
      expect(next.ctx.rescueGateTime).toBe(gate);
      expect(next.ctx.rescueFromTime).toBe(ctx.rescueFromTime);
      expect(next.state.rescueStart).toBeNull();
      expect(next.state.ending).toBe(open.ending);
      expect(next.state.endedAt).toBe(open.endedAt);
      expect(next.state.lastTime).toBe(open.lastTime);
      expect(next.state.lostStarts).toBe(open.lostStarts);
    }

    // A gate at or before the stretch start leaves it open; an unchanged gate returns the same objects.
    const atStart = setRescueGate(ctx, open, 0);
    expect(atStart.state).toBe(open);
    expect(atStart.ctx.rescueGateTime).toBe(0);
    const same = setRescueGate(ctx, open, Number.NEGATIVE_INFINITY);
    expect(same.ctx).toBe(ctx);
    expect(same.state).toBe(open);

    // After a later gate, a new stretch starts only at a sample at or after it.
    const later = setRescueGate(ctx, open, 8);
    const resumed = evaluateEnding(later.ctx, run(6, 9, { spo2: 0.9, mean_arterial_pressure: 90 }), later.state);
    expect(resumed).toMatchObject({ ending: 'none', rescueStart: 8 });

    // An Ending already set is never changed.
    const rescued = evaluateEnding(ctx, run(0, 10, GOOD));
    expect(rescued.ending).toBe('rescued');
    expect(setRescueGate(ctx, rescued, null).state).toBe(rescued);
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
 *
 * With a `gate`, a rescue run counts only from samples at or after it, and no
 * rescue run counts when it is `null`. Without a `gate` (omitted) this is the
 * ungated reference that applies only the earliest-insult bound.
 */
function refEnding(
  play: PlaySection | undefined,
  insultTimes: number[],
  samples: Sample[],
  gate?: number | null,
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

  const afterGate = (t: number) => gate === undefined || (gate !== null && t >= gate);
  const rescueAt = (s: Sample) =>
    s.simulation_time >= from && afterGate(s.simulation_time) && refAll(play.endings.rescued.conditions, s);
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
  /** Fixed Rescue_Gate_Time put in the context: `-Infinity`, `null` or a finite time. */
  gate: number | null;
}

/**
 * Fixed Rescue_Gate_Time: `-Infinity` (no Required_Interventions), `null`
 * (one not active) or a finite time. Finite gates fall mostly on 5 s steps, so
 * they often coincide with the start of a focused segment or a rescue stretch.
 */
const arbGate: fc.Arbitrary<number | null> = fc.oneof(
  { weight: 2, arbitrary: fc.constant(Number.NEGATIVE_INFINITY) },
  { weight: 1, arbitrary: fc.constant(null) },
  { weight: 2, arbitrary: fc.integer({ min: 0, max: 12 }).map((n) => n * 5) },
  { weight: 1, arbitrary: fc.integer({ min: 0, max: 120 }).map((n) => n / 2) },
);

/** Generic scenario from the shared generators: random conditions over random vitals. */
const arbGenericScenario: fc.Arbitrary<Scenario> = fc.record({
  play: fc.option(arbPlaySection, { nil: undefined, freq: 10 }),
  insults: arbInsults,
  samples: arbSampleSequence,
  gate: arbGate,
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
      gate: arbGate,
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
      const r = refEnding(rescueOnly, sc.insults.map((i) => i.timeSeconds), sc.samples, sc.gate);
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

/** The scenario's context with its fixed Rescue_Gate_Time. */
function contextOf(sc: Scenario): EndingContext {
  return { ...buildEndingContext(caseWith(sc.play, sc.insults)), rescueGateTime: sc.gate };
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
          sc.gate,
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

  // Feature: play-mode, Property 24: Rescue never comes before the Rescue_Gate_Time
  it('Property 24: Rescue never comes before the Rescue_Gate_Time', () => {
    /** Validates: Requirements 6.3, 6.18, 6.19, 6.20, 6.22, 6.24, 6.25, 6.26, 12.18 */
    fc.assert(
      fc.property(
        arbGateIds,
        arbGateEntries,
        arbGateEntries,
        arbEarliestInsult,
        arbScenario,
        fc.nat(),
        arbGate,
        fc.constantFrom<'absolute' | 'afterLast'>('absolute', 'afterLast'),
        fc.constantFrom(0, 0.5, 1, 3),
        fc.boolean(),
        (ids, entries, others, earliest, sc, rawCut, absoluteGate, gateKind, shift, prefixUngated) => {
          // rescueGateTime against an independent model; entries of other ids change nothing.
          const gate = rescueGateTime(ids, entries, earliest);
          expect(gate).toBe(refGate(ids, entries, earliest));
          const required = entries.filter((e) => ids.includes(e.interventionId));
          const notRequired = others.filter((e) => !ids.includes(e.interventionId));
          expect(rescueGateTime(ids, required, earliest)).toBe(gate);
          expect(rescueGateTime(ids, [...notRequired, ...entries, ...notRequired], earliest)).toBe(gate);

          // Gate_Entry rule (6.25, 6.26).
          if (earliest === undefined) {
            // Every entry counts: the result equals the pre-6.25 rule with no entry left out.
            expect(gate).toBe(refGate(ids, entries, Number.NEGATIVE_INFINITY));
          } else {
            // A finite gate is never below the Earliest_Insult_Time.
            if (gate !== null && Number.isFinite(gate)) expect(gate).toBeGreaterThanOrEqual(earliest);
            // Adding entries before the insult time, of any id, leaves the result unchanged.
            const preInsult = others.map((e) => ({
              ...e,
              simulationTime: Number.isNaN(e.simulationTime) ? e.simulationTime : Math.min(e.simulationTime, earliest - 0.5),
            }));
            expect(rescueGateTime(ids, [...preInsult, ...entries, ...preInsult], earliest)).toBe(gate);
            // Removing the entries before the insult time leaves it unchanged too.
            const gateEntries = entries.filter((e) => !(e.simulationTime < earliest));
            expect(rescueGateTime(ids, gateEntries, earliest)).toBe(gate);
          }

          const ctx = contextOf(sc);
          const withGate = (g: number | null): EndingState =>
            evaluateEnding({ ...ctx, rescueGateTime: g }, sc.samples);

          // A -Infinity gate gives the ungated reference fold (earliest-insult bound only).
          const ungated = withGate(Number.NEGATIVE_INFINITY);
          expect({ ending: ungated.ending, endedAt: ungated.endedAt }).toEqual(
            refEnding(sc.play, sc.insults.map((i) => i.timeSeconds), sc.samples),
          );
          // A null gate never rescues.
          expect(withGate(null).ending).not.toBe('rescued');

          // Finite gates: the scenario's own, and one at or just after the ungated rescue stretch start.
          const finiteGates: number[] = [];
          if (sc.gate !== null && Number.isFinite(sc.gate)) finiteGates.push(sc.gate);
          if (ungated.ending === 'rescued' && ungated.rescueStart !== null) finiteGates.push(ungated.rescueStart + shift);
          for (const g of finiteGates) {
            const state = withGate(g);
            if (state.ending !== 'rescued') continue;
            const hold = sc.play!.endings.rescued.holdSeconds;
            expect(state.rescueStart).not.toBeNull();
            expect(state.rescueStart!).toBeGreaterThanOrEqual(g);
            expect(state.endedAt!).toBeGreaterThanOrEqual(g + hold);
          }

          // setRescueGate on the state after any prefix of the samples (under the
          // scenario's gate, or -Infinity so open stretches are common), with an
          // absolute new gate or one just after the last accepted time.
          const prefixCtx: EndingContext = prefixUngated ? { ...ctx, rescueGateTime: Number.NEGATIVE_INFINITY } : ctx;
          // An even rawCut picks a prefix that ends inside an open rescue stretch, when one exists.
          const prefixStates = [initialEndingState(prefixCtx)];
          for (const s of sc.samples) prefixStates.push(stepEnding(prefixCtx, prefixStates[prefixStates.length - 1], s));
          const openAt = prefixStates.flatMap((s, i) => (s.ending === 'none' && s.rescueStart !== null ? [i] : []));
          const pick = Math.floor(rawCut / 2);
          const cut =
            rawCut % 2 === 0 && openAt.length > 0 ? openAt[pick % openAt.length] : pick % (sc.samples.length + 1);
          const prefix = evaluateEnding(prefixCtx, sc.samples.slice(0, cut));
          const newGate = gateKind === 'afterLast' ? (prefix.lastTime ?? 0) + 0.5 : absoluteGate;
          const next = setRescueGate(prefixCtx, prefix, newGate);
          expect(next.ctx.rescueGateTime).toBe(newGate);
          expect(next.state.ending).toBe(prefix.ending);
          expect(next.state.endedAt).toBe(prefix.endedAt);
          expect(next.state.lastTime).toBe(prefix.lastTime);
          expect(next.state.lostStarts).toEqual(prefix.lostStarts);
          if (next.state.ending === 'none' && next.state.rescueStart !== null) {
            expect(newGate).not.toBeNull();
            expect(next.state.rescueStart).toBeGreaterThanOrEqual(newGate!);
          }
        },
      ),
      PBT_PARAMS,
    );
  });
});

// ---------------------------------------------------------------------------
// Property 24 generators and gate model
// ---------------------------------------------------------------------------

const GATE_IDS = ['needle-decompression-left', 'needle-decompression-right', 'id-a', 'id-b'] as const;

/** Required ids: 0 to 3 unique ids from a small pool, so entries often match them. */
const arbGateIds: fc.Arbitrary<string[]> = fc.uniqueArray(fc.constantFrom(...GATE_IDS), { maxLength: 3 });

/** Active_Interventions entries over the pool and one more id; times on a small grid, sometimes non-finite. */
const arbGateEntries: fc.Arbitrary<InterventionRecordEntry[]> = fc.array(
  fc
    .record({
      id: fc.constantFrom(...GATE_IDS, 'id-other'),
      time: fc.oneof(
        { weight: 8, arbitrary: fc.integer({ min: 0, max: 120 }).map((n) => n / 2) },
        { weight: 1, arbitrary: fc.constantFrom(Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY) },
      ),
      branchId: fc.constantFrom('main', 'branch-1'),
    })
    .map(({ id, time, branchId }) => entry(id, time, branchId)),
  { maxLength: 8 },
);

/**
 * Earliest_Insult_Time: `undefined` (no finite insult time) or a time on a 5 s grid
 * inside the entry-time range, so entries before, at and after it are common.
 */
const arbEarliestInsult: fc.Arbitrary<number | undefined> = fc.option(
  fc.integer({ min: 0, max: 12 }).map((n) => n * 5),
  { nil: undefined, freq: 4 },
);

/**
 * Independent model of the Rescue_Gate_Time (6.18-6.20, 6.25, 6.26): only entries
 * at or after `earliestInsult` count, or every entry when it is `undefined`.
 */
function refGate(
  ids: readonly string[],
  entries: readonly InterventionRecordEntry[],
  earliestInsult: number | undefined,
): number | null {
  if (ids.length === 0) return Number.NEGATIVE_INFINITY;
  const earliest: number[] = [];
  for (const id of ids) {
    const times = entries
      .filter((e) => e.interventionId === id && Number.isFinite(e.simulationTime))
      .filter((e) => earliestInsult === undefined || e.simulationTime >= earliestInsult)
      .map((e) => e.simulationTime);
    if (times.length === 0) return null;
    earliest.push(Math.min(...times));
  }
  return Math.max(...earliest);
}
