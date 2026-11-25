import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  DEMO_RESCUE_BOUND_SECONDS,
  bandsOf,
  checkAffectedRescued,
  checkLostNeverRescued,
  compareEarlyWithNone,
  createOutcomeFold,
  examRows,
  firstAbnormal,
  markSamples,
  overallStatusOf,
  scenarioOutcome,
  sideDifference,
  statusRuleReport,
  type ExamRow,
  type LostCause,
  type MarkSample,
  type ScenarioOutcome,
} from './calibration';
import {
  buildEndingContext,
  conditionHolds,
  earliestInsultTime,
  initialEndingState,
  requiredInterventions,
  rescueGateTime,
  setRescueGate,
  stepEnding,
  type Ending,
  type Sample,
} from './endingEvaluator';
import { examButtons, examFinding } from './examFinding';
import { buildInterventionEntry } from './interventionRecord';
import { DECOMPRESSION_ACTION, affectedInsult } from './sides';
import { getVitalBand, thresholdsFor } from './vitalBands';
import { VITAL_FIELD, VITAL_NAMES } from './vitals';
import type { CaseData, InterventionRecordEntry, PlaySection, VitalCondition, VitalName } from '@/types';
import { CASE_LEFT, CASE_RIGHT, VITAL_OFFSETS } from '@/test/caseFixtures';
import { arbSampleSequence } from '@/test/generators';
import { PBT_PARAMS } from '@/test/pbt';

// ---------------------------------------------------------------------------
// Test values. Every vital value is derived from the case fixtures' own thresholds and
// conditions, or is a synthetic number. Sentences in synthetic Play_Sections are placeholders.
// ---------------------------------------------------------------------------

const ALARMS = CASE_LEFT.alarms;
const PLAY: PlaySection = CASE_LEFT.play!;
const INSULT = affectedInsult(CASE_LEFT.timeline.scheduledInsults)!;
const BRANCH = 'branch-test';
const INTERVAL = 10;

/** A sample with every vital in the middle of its Case normal range. */
function normalSample(t: number): Sample {
  const s: Sample = { simulation_time: t };
  for (const v of VITAL_NAMES) {
    const n = thresholdsFor(ALARMS, v)?.normal;
    if (n) (s as Record<string, number>)[VITAL_FIELD[v]] = (n.low + n.high) / 2;
  }
  return s;
}

function holdingValue(c: VitalCondition): number {
  const off = VITAL_OFFSETS[c.vital];
  switch (c.op) {
    case '<':
      return c.value - off;
    case '>':
      return c.value + off;
    default:
      return c.value;
  }
}

/** `base` with each condition's vital set to a value for which the condition holds. */
function satisfying(base: Sample, conditions: readonly VitalCondition[]): Sample {
  const s: Sample = { ...base };
  for (const c of conditions) (s as Record<string, number>)[VITAL_FIELD[c.vital]] = holdingValue(c);
  return s;
}

/** `base` with `vital` just beyond its Case critical bound in `direction`. */
function critical(base: Sample, vital: VitalName, direction: 'low' | 'high'): Sample {
  const bound = thresholdsFor(ALARMS, vital)!.critical![direction]!;
  const off = VITAL_OFFSETS[vital];
  return { ...base, [VITAL_FIELD[vital]]: direction === 'low' ? bound - off : bound + off };
}

/** Kept samples at every simulated second from 0 to `last`. */
function keptUpTo(last: number, sampleAt: (t: number) => Sample): Sample[] {
  return Array.from({ length: last + 1 }, (_, t) => sampleAt(t));
}

const ceilToInterval = (t: number): number => Math.ceil(t / INTERVAL) * INTERVAL;

const lostGroups = PLAY.endings.lost.groups ?? [];
const rescueConditions = PLAY.endings.rescued.conditions;
const holdsAll = (cs: readonly VitalCondition[], s: Sample): boolean => cs.every((c) => conditionHolds(c, s));

/** A sample for which every rescue condition holds and no Lost_Condition group holds. */
const RESCUE_SAMPLE = (t: number): Sample => satisfying(normalSample(t), rescueConditions);

function requiredEntry(time: number) {
  const id = requiredInterventions(PLAY)[0];
  const intervention = CASE_LEFT.interventions.find((i) => i.id === id)!;
  return buildInterventionEntry(intervention, time, BRANCH);
}

function outcome(o: Partial<ScenarioOutcome>): ScenarioOutcome {
  return {
    ending: 'none',
    endedAt: null,
    lostCause: null,
    finalGate: null,
    endingAfter: [],
    rescueHeldWithoutGate: [],
    ...o,
  };
}

// ---------------------------------------------------------------------------
// Property 5 inputs and reference evaluation
// ---------------------------------------------------------------------------

const FIXTURES = [CASE_LEFT, CASE_RIGHT] as const;

/** Where an Actual_Time lies relative to the marks: on mark k, between mark k and the next
 *  (half-second steps), or after the last mark. `k` is reduced modulo the number of marks. */
type TimeSpec = { kind: 'at'; k: number } | { kind: 'between'; k: number; steps: number } | { kind: 'after'; steps: number };

const arbTimeSpec: fc.Arbitrary<TimeSpec> = fc.oneof(
  fc.record({ kind: fc.constant('at' as const), k: fc.nat() }),
  fc.record({ kind: fc.constant('between' as const), k: fc.nat(), steps: fc.nat() }),
  fc.record({ kind: fc.constant('after' as const), steps: fc.integer({ min: 1, max: 240 }) }),
);

function resolveTime(spec: TimeSpec, markCount: number, interval: number): number {
  if (markCount === 0) return spec.kind === 'after' ? spec.steps / 2 : 0;
  const last = (markCount - 1) * interval;
  switch (spec.kind) {
    case 'at':
      return (spec.k % markCount) * interval;
    case 'between':
      // 0.5 to interval - 0.5 s after the mark: strictly between two marks (or after the last).
      return (spec.k % markCount) * interval + 0.5 + (spec.steps % (2 * interval - 1)) * 0.5;
    case 'after':
      return last + spec.steps / 2;
  }
}

interface FoldInput {
  rc: CaseData;
  marks: MarkSample[];
  /** Runner_Intervention_Record, Actual_Times not decreasing. */
  entries: InterventionRecordEntry[];
  /** entries[i] is added to the fold before the push of marks[addBefore[i]] (marks.length: after all). */
  addBefore: number[];
}

/**
 * Mark_Samples: the vitals of an `arbSampleSequence` sample at marks 0, interval, 2·interval, …
 * (the sequence's own times are replaced, since marks increase). One run of consecutive marks is
 * set to meet the fixture's rescue conditions, so rescues happen. Entries name the fixture's
 * Required_Intervention (weight 2) or any Intervention; their Actual_Times fall on a mark, between
 * marks or after the last mark. Each entry's add point is random, in record order, and no later
 * than the first mark at or after its Actual_Time.
 */
const arbFoldInput: fc.Arbitrary<FoldInput> = fc
  .record({
    fixture: fc.constantFrom(0, 1),
    samples: arbSampleSequence,
    interval: fc.integer({ min: 5, max: 30 }),
    substituted: fc.array(fc.boolean(), { minLength: 60, maxLength: 60 }),
    rescueFrom: fc.nat({ max: 60 }),
    rescueLength: fc.nat({ max: 60 }),
    entries: fc.array(
      fc.record({
        pick: fc.oneof({ weight: 2, arbitrary: fc.constant(-1) }, { weight: 1, arbitrary: fc.nat() }),
        time: arbTimeSpec,
        add: fc.nat(),
      }),
      { maxLength: 6 },
    ),
  })
  .map(({ fixture, samples, interval, substituted, rescueFrom, rescueLength, entries }) => {
    const rc = FIXTURES[fixture];
    const rescue = rc.play!.endings.rescued.conditions;
    const marks = samples.map((s, i): MarkSample => {
      const mark = i * interval;
      const vitals = i >= rescueFrom && i < rescueFrom + rescueLength ? satisfying(s, rescue) : s;
      const sub = substituted[i];
      return { mark, sample: { ...vitals, simulation_time: sub ? mark + 0.5 : mark }, substituted: sub };
    });
    const requiredId = requiredInterventions(rc.play)[0];
    const timed = entries
      .map((e) => ({
        intervention:
          e.pick < 0
            ? rc.interventions.find((i) => i.id === requiredId)!
            : rc.interventions[e.pick % rc.interventions.length],
        time: resolveTime(e.time, marks.length, interval),
        add: e.add % (marks.length + 1),
      }))
      .sort((a, b) => a.time - b.time);
    const record = timed.map((e) => buildInterventionEntry(e.intervention, e.time, BRANCH));
    const adds = timed.map((e) => e.add).sort((a, b) => a - b);
    const addBefore = timed.map((e, i) => {
      const first = marks.findIndex((m) => m.mark >= e.time);
      return Math.min(adds[i], first === -1 ? marks.length : first);
    });
    return { rc, marks, entries: record, addBefore };
  });

/** Property 5 reference: before each Mark_Sample at mark m, setRescueGate with rescueGateTime over
 *  the entries with Actual_Time <= m, then stepEnding at the mark. Uses endingEvaluator only. */
function referenceOutcome(rc: CaseData, marks: readonly MarkSample[], entries: readonly InterventionRecordEntry[]) {
  const required = requiredInterventions(rc.play);
  const earliestInsult = earliestInsultTime(rc);
  let ctx = buildEndingContext(rc);
  let state = initialEndingState(ctx);
  const endingAfter: Ending[] = [];
  for (const m of marks) {
    const upToMark = entries.filter((e) => e.simulationTime <= m.mark);
    ({ ctx, state } = setRescueGate(ctx, state, rescueGateTime(required, upToMark, earliestInsult)));
    state = stepEnding(ctx, state, { ...m.sample, simulation_time: m.mark });
    endingAfter.push(state.ending);
  }
  let lostCause: LostCause | null = null;
  if (state.ending === 'lost') {
    const groups = rc.play?.endings.lost.groups ?? [];
    const end = state.endedAt!;
    const hit = groups.findIndex((g, i) => {
      const start = state.lostStarts[i];
      return start !== null && end - start >= g.holdSeconds;
    });
    lostCause = hit === -1 ? 'Time_Limit' : hit + 1;
  }
  return { ending: state.ending, endedAt: state.endedAt, lostCause, finalGate: ctx.rescueGateTime, endingAfter };
}

// ---------------------------------------------------------------------------

describe('markSamples', () => {
  it('uses the kept sample at each mark and substitutes the next kept sample for a gap (4.8)', () => {
    const kept = [0, 13, 25].map((t) => ({ simulation_time: t }));
    expect(markSamples(kept, INTERVAL)).toEqual([
      { mark: 0, sample: kept[0], substituted: false },
      { mark: 10, sample: kept[1], substituted: true },
      { mark: 20, sample: kept[2], substituted: true },
    ]);
  });

  it('gives one unsubstituted Mark_Sample per mark up to the last kept time', () => {
    const kept = [0, 10, 13, 20, 25].map((t) => ({ simulation_time: t }));
    const marks = markSamples(kept, INTERVAL);
    expect(marks.map((m) => [m.mark, m.sample.simulation_time, m.substituted])).toEqual([
      [0, 0, false],
      [10, 10, false],
      [20, 20, false],
    ]);
  });

  it('returns [] for no kept samples and rejects an interval below 1', () => {
    expect(markSamples([], INTERVAL)).toEqual([]);
    expect(() => markSamples([{ simulation_time: 0 }], 0)).toThrow(RangeError);
  });

  // Feature: engine-mcp, Property 4: Mark_Samples cover every Sample_Mark
  // **Validates: Requirements 4.8, 5.1**
  it('Property 4: Mark_Samples cover every Sample_Mark', () => {
    // Strictly increasing kept times from 0: cumulative sums of gaps from 1 to 90 s, so some gaps
    // are shorter and some longer than the interval. Each sample carries its index as a synthetic
    // marker value, so a wrong pick shows in the failure output.
    const arbKept = fc.array(fc.integer({ min: 1, max: 90 }), { maxLength: 40 }).map((gaps) => {
      const times = [0];
      for (const g of gaps) times.push(times[times.length - 1] + g);
      return times.map((t, i): Sample => ({ simulation_time: t, heart_rate: i }));
    });
    fc.assert(
      fc.property(arbKept, fc.integer({ min: 1, max: 60 }), (kept, interval) => {
        const last = kept[kept.length - 1].simulation_time;
        const expected: MarkSample[] = [];
        for (let k = 0; k * interval <= last; k += 1) {
          const mark = k * interval;
          const exact = kept.find((s) => s.simulation_time === mark);
          const sample = exact ?? kept.find((s) => s.simulation_time > mark)!;
          expected.push({ mark, sample, substituted: exact === undefined });
        }
        const actual = markSamples(kept, interval);
        expect(actual).toEqual(expected);
        actual.forEach((m, i) => expect(m.sample).toBe(expected[i].sample));
      }),
      PBT_PARAMS,
    );
  });
});

describe('createOutcomeFold and scenarioOutcome', () => {
  it('precondition: the rescue sample meets every rescue condition and no Lost_Condition group', () => {
    const s = RESCUE_SAMPLE(0);
    expect(holdsAll(rescueConditions, s)).toBe(true);
    expect(lostGroups.some((g) => holdsAll(g.conditions, s))).toBe(false);
  });

  it('applies the gate at the first mark at or after the Actual_Time and then rescues (D3, 4.6)', () => {
    const actual = INSULT.timeSeconds + 7; // synthetic, between two marks
    const gateMark = ceilToInterval(actual);
    const hold = PLAY.endings.rescued.holdSeconds;
    const marks = markSamples(keptUpTo(gateMark + hold + 2 * INTERVAL, RESCUE_SAMPLE), INTERVAL);
    const entry = requiredEntry(actual);

    const fold = createOutcomeFold(CASE_LEFT);
    for (const m of marks) {
      if (m.mark < actual) {
        fold.push(m);
        expect(fold.gate).toBeNull();
      } else {
        if (m.mark === gateMark) fold.addEntry(entry);
        fold.push(m);
        expect(fold.gate).toBe(actual);
      }
    }
    const rescuedAt = marks.find((m) => m.mark - gateMark >= hold)!.mark;
    expect(fold.ending).toBe('rescued');
    expect(fold.endedAt).toBe(rescuedAt);
    expect(fold.lostCause).toBeNull();
    expect(fold.endingAfter).toEqual(marks.map((m) => (m.mark >= rescuedAt ? 'rescued' : 'none')));

    const post = scenarioOutcome(CASE_LEFT, marks, [entry]);
    expect(post).toEqual({
      ending: 'rescued',
      endedAt: rescuedAt,
      lostCause: null,
      finalGate: actual,
      endingAfter: [...fold.endingAfter],
      rescueHeldWithoutGate: marks.map((m) => m.mark),
    });
  });

  it('keeps the gate closed for an entry that is not a Required_Intervention and ends lost at the Time_Limit', () => {
    const limit = PLAY.endings.lost.timeLimitSeconds!;
    const marks = markSamples(keptUpTo(limit + INTERVAL, RESCUE_SAMPLE), INTERVAL);
    const required = new Set(requiredInterventions(PLAY));
    const other = CASE_LEFT.interventions.find((i) => !required.has(i.id))!;
    const o = scenarioOutcome(CASE_LEFT, marks, [buildInterventionEntry(other, INSULT.timeSeconds, BRANCH)]);
    expect(o.ending).toBe('lost');
    expect(o.endedAt).toBe(ceilToInterval(limit));
    expect(o.lostCause).toBe('Time_Limit');
    expect(o.finalGate).toBeNull();
    expect(o.rescueHeldWithoutGate).toEqual(marks.map((m) => m.mark));
  });

  it('names the Lost_Condition group as the cause', () => {
    const group = lostGroups[0];
    const lostSample = (t: number): Sample => satisfying(normalSample(t), group.conditions);
    const marks = markSamples(keptUpTo(ceilToInterval(group.holdSeconds) + INTERVAL, lostSample), INTERVAL);
    const o = scenarioOutcome(CASE_LEFT, marks, []);
    expect(o.ending).toBe('lost');
    expect(o.endedAt).toBe(ceilToInterval(group.holdSeconds));
    expect(o.lostCause).toBe(1);
  });

  it('lists a mark in rescueHeldWithoutGate only when every rescue condition holds', () => {
    expect(rescueConditions.length).toBeGreaterThanOrEqual(2);
    const [held, ...failed] = rescueConditions;
    /** A value for which the condition does not hold. */
    const failingValue = (c: VitalCondition): number =>
      c.op === '<' || c.op === '<=' ? c.value + VITAL_OFFSETS[c.vital] : c.value - VITAL_OFFSETS[c.vital];
    const partly = (t: number): Sample => {
      const s = RESCUE_SAMPLE(t);
      for (const c of failed) (s as Record<string, number>)[VITAL_FIELD[c.vital]] = failingValue(c);
      return s;
    };
    const marks: MarkSample[] = [
      { mark: 0, sample: partly(0), substituted: false },
      { mark: INTERVAL, sample: RESCUE_SAMPLE(INTERVAL), substituted: false },
    ];
    // Preconditions: at mark 0 some but not all rescue conditions hold; at the control mark all hold.
    expect(conditionHolds(held, marks[0].sample)).toBe(true);
    expect(failed.every((c) => !conditionHolds(c, marks[0].sample))).toBe(true);
    expect(holdsAll(rescueConditions, marks[1].sample)).toBe(true);

    expect(scenarioOutcome(CASE_LEFT, marks, []).rescueHeldWithoutGate).toEqual([INTERVAL]);
  });

  it('applies an entry whose Actual_Time equals a mark before that mark is evaluated (D3, 4.6)', () => {
    const actual = ceilToInterval(INSULT.timeSeconds) + INTERVAL; // synthetic, exactly on a mark
    const hold = PLAY.endings.rescued.holdSeconds;
    const marks = markSamples(keptUpTo(actual + hold + 2 * INTERVAL, RESCUE_SAMPLE), INTERVAL);
    expect(marks.some((m) => m.mark === actual)).toBe(true);
    const entry = requiredEntry(actual);

    const fold = createOutcomeFold(CASE_LEFT);
    const gates: [number, number | null][] = [];
    for (const m of marks) {
      if (m.mark === actual) fold.addEntry(entry);
      fold.push(m);
      gates.push([m.mark, fold.gate]);
    }
    expect(gates).toEqual(marks.map((m) => [m.mark, m.mark >= actual ? actual : null]));
    const rescuedAt = marks.find((m) => m.mark - actual >= hold)!.mark;
    expect(fold.endedAt).toBe(rescuedAt);
    expect(fold.endingAfter).toEqual(marks.map((m) => (m.mark >= rescuedAt ? 'rescued' : 'none')));

    const upToActual = marks.filter((m) => m.mark <= actual);
    expect(scenarioOutcome(CASE_LEFT, upToActual, [entry]).finalGate).toBe(actual);
  });

  it('keeps the gate closed in the affected-side-early fixture, through createOutcomeFold and scenarioOutcome (play-mode 6.25, 13.18)', () => {
    // Modelled on the `affected-side-early` Scenario of
    // docs/calibration/adult-tension-pneumothorax-2026-11-25-161c754.md: the affected-side
    // Decompression at 20 s, the insult at 30 s, and every rescue condition held from 0 s on.
    for (const rc of FIXTURES) {
      const play = rc.play!;
      const insult = affectedInsult(rc.timeline.scheduledInsults)!;
      expect(earliestInsultTime(rc)).toBe(30);
      expect(insult.timeSeconds).toBe(30);
      const id = requiredInterventions(play)[0];
      const intervention = rc.interventions.find((i) => i.id === id)!;
      expect(intervention.parameters?.side).toBe(insult.side);
      const entry = buildInterventionEntry(intervention, 20, BRANCH);

      const rescueAt = (t: number): Sample => satisfying(normalSample(t), play.endings.rescued.conditions);
      expect(holdsAll(play.endings.rescued.conditions, rescueAt(0))).toBe(true);
      const limit = play.endings.lost.timeLimitSeconds!;
      const marks = markSamples(keptUpTo(limit + INTERVAL, rescueAt), INTERVAL);

      const fold = createOutcomeFold(rc);
      for (const m of marks) {
        if (m.mark === 20) fold.addEntry(entry);
        fold.push(m);
        expect(fold.gate).toBeNull();
        expect(fold.ending).not.toBe('rescued');
      }
      expect(fold.endingAfter).not.toContain('rescued');

      const post = scenarioOutcome(rc, marks, [entry]);
      expect(post.finalGate).toBeNull();
      expect(post.ending).not.toBe('rescued');
      expect(post.endingAfter).not.toContain('rescued');
      // The gate excluded every mark at which the rescue conditions held.
      expect(post.rescueHeldWithoutGate).toEqual(marks.map((m) => m.mark));
      expect({ ending: post.ending, endedAt: post.endedAt, lostCause: post.lostCause }).toEqual({
        ending: 'lost',
        endedAt: ceilToInterval(limit),
        lostCause: 'Time_Limit',
      });
    }
  });

  it('evaluates a substituted Mark_Sample at its mark', () => {
    const limitMark = ceilToInterval(PLAY.endings.lost.timeLimitSeconds!);
    // Every mark after 0 is substituted by the one sample one second after the Time_Limit mark.
    const kept = [normalSample(0), normalSample(limitMark + 1)];
    const marks = markSamples(kept, INTERVAL);
    const fold = createOutcomeFold(CASE_LEFT);
    for (const m of marks) fold.push(m);
    expect(marks.slice(1).every((m) => m.substituted)).toBe(true);
    expect(fold.ending).toBe('lost');
    expect(fold.endedAt).toBe(limitMark);
  });

  // Feature: engine-mcp, Property 5: The incremental outcome fold equals the post-hoc fold
  // **Validates: Requirements 4.6, 4.7, 5.4, 5.5**
  it('Property 5: The incremental outcome fold equals the post-hoc fold', () => {
    fc.assert(
      fc.property(arbFoldInput, ({ rc, marks, entries, addBefore }) => {
        const fold = createOutcomeFold(rc);
        let next = 0;
        for (let k = 0; k <= marks.length; k += 1) {
          while (next < entries.length && addBefore[next] === k) fold.addEntry(entries[next++]);
          if (k < marks.length) fold.push(marks[k]);
        }
        expect(next).toBe(entries.length);
        const incremental = {
          ending: fold.ending,
          endedAt: fold.endedAt,
          lostCause: fold.lostCause,
          finalGate: fold.gate,
          endingAfter: [...fold.endingAfter],
        };

        const post = scenarioOutcome(rc, marks, entries);
        expect(incremental).toEqual({
          ending: post.ending,
          endedAt: post.endedAt,
          lostCause: post.lostCause,
          finalGate: post.finalGate,
          endingAfter: post.endingAfter,
        });
        expect(incremental).toEqual(referenceOutcome(rc, marks, entries));
      }),
      PBT_PARAMS,
    );
  });
});

describe('checkAffectedRescued (9.5)', () => {
  const hold = 30; // synthetic Hold_Duration

  it('passes with the basis text when rescued after gate + hold and within the bound', () => {
    const r = checkAffectedRescued('left', outcome({ ending: 'rescued', endedAt: 230, finalGate: 150 }), hold);
    expect(r).toEqual({
      check: 'affected-side-rescued',
      variantId: 'left',
      pass: true,
      basis: `rescued at 230 s; gate 150 s + hold 30 s = 180 s ≤ 230 s ≤ ${DEMO_RESCUE_BOUND_SECONDS} s`,
    });
  });

  it('fails after the bound and before gate + hold', () => {
    const late = checkAffectedRescued('left', outcome({ ending: 'rescued', endedAt: 320, finalGate: 150 }), hold);
    expect(late.pass).toBe(false);
    expect(late.basis).toBe('rescued at 320 s; gate 150 s + hold 30 s = 180 s ≤ 320 s > 300 s');
    const early = checkAffectedRescued('left', outcome({ ending: 'rescued', endedAt: 170, finalGate: 150 }), hold);
    expect(early.pass).toBe(false);
    expect(early.basis).toBe('rescued at 170 s; gate 150 s + hold 30 s = 180 s > 170 s ≤ 300 s');
  });

  it('fails without a finite gate or without a rescue', () => {
    const open = checkAffectedRescued('right', outcome({ ending: 'rescued', endedAt: 100, finalGate: -Infinity }), hold);
    expect(open.pass).toBe(false);
    expect(open.basis).toBe(
      'rescued at 100 s; gate open from the start (no Required_Interventions); hold 30 s; 100 s ≤ 300 s',
    );
    const lost = checkAffectedRescued('right', outcome({ ending: 'lost', endedAt: 400, lostCause: 1 }), hold);
    expect(lost.pass).toBe(false);
    expect(lost.basis).toBe('lost at 400 s (cause: Lost_Condition group 1); gate closed; hold 30 s; bound 300 s');
    const none = checkAffectedRescued('right', outcome({ finalGate: 150 }), hold);
    expect(none.pass).toBe(false);
    expect(none.basis).toBe('Ending stayed none; gate 150 s; hold 30 s; bound 300 s');
  });
});

describe('checkLostNeverRescued (9.5)', () => {
  const limit = { seconds: 600, source: 'Time_Limit' as const }; // synthetic

  it('passes other-side-only-lost with the cause, gate, held marks and the open-question label', () => {
    const o = outcome({ ending: 'lost', endedAt: 400, lostCause: 1, rescueHeldWithoutGate: [200, 210] });
    expect(checkLostNeverRescued('other-side-only-lost', 'left', o, limit)).toEqual({
      check: 'other-side-only-lost',
      variantId: 'left',
      pass: true,
      basis:
        'lost at 400 s (cause: Lost_Condition group 1); 400 s ≤ limit 600 s (Time_Limit); gate closed; ' +
        'rescue held without the gate at: 200, 210 s; answers open question 1, item c',
    });
  });

  it('passes no-intervention-lost at the Time_Limit without the label', () => {
    const o = outcome({ ending: 'lost', endedAt: 600, lostCause: 'Time_Limit' });
    const r = checkLostNeverRescued('no-intervention-lost', 'right', o, limit);
    expect(r.pass).toBe(true);
    expect(r.basis).toBe(
      'lost at 600 s (cause: Time_Limit); 600 s ≤ limit 600 s (Time_Limit); gate closed; rescue held without the gate at: none',
    );
  });

  it('fails when rescued, lost after the limit, or never ended', () => {
    const rescued = checkLostNeverRescued(
      'other-side-only-lost',
      'left',
      outcome({ ending: 'rescued', endedAt: 230, finalGate: 150, endingAfter: ['none', 'rescued'] }),
      limit,
    );
    expect(rescued.pass).toBe(false);
    expect(rescued.basis).toBe(
      'rescued at 230 s; limit 600 s (Time_Limit); gate 150 s; rescue held without the gate at: none; ' +
        'answers open question 1, item c',
    );
    const late = checkLostNeverRescued(
      'no-intervention-lost',
      'left',
      outcome({ ending: 'lost', endedAt: 700, lostCause: 1 }),
      { seconds: 600, source: 'max_seconds' },
    );
    expect(late.pass).toBe(false);
    expect(late.basis).toBe(
      'lost at 700 s (cause: Lost_Condition group 1); 700 s > limit 600 s (max_seconds); gate closed; ' +
        'rescue held without the gate at: none',
    );
    const none = checkLostNeverRescued('no-intervention-lost', 'left', outcome({}), limit);
    expect(none.pass).toBe(false);
    expect(none.basis).toBe('Ending stayed none; limit 600 s (Time_Limit); gate closed; rescue held without the gate at: none');
  });
});

describe('bandsOf and overallStatusOf', () => {
  it('gives a band only for vitals with Case thresholds and a value', () => {
    const value = thresholdsFor(ALARMS, 'heartRate')!.normal!.low;
    const bands = bandsOf({ simulation_time: 0, heart_rate: value }, ALARMS);
    expect(bands).toEqual({ heartRate: getVitalBand(value, ALARMS.heartRate) });
  });

  it('is normal in the middle of every normal range and critical beyond a critical bound', () => {
    expect(overallStatusOf(normalSample(0), ALARMS)).toBe('normal');
    expect(overallStatusOf(critical(normalSample(0), 'spO2', 'low'), ALARMS)).toBe('critical');
  });
});

describe('compareEarlyWithNone (D23, 9.6, 9.7)', () => {
  const insultTime = INSULT.timeSeconds;
  const times = (last: number): number[] => Array.from({ length: last / INTERVAL + 1 }, (_, i) => i * INTERVAL);
  const lastEarly = ceilToInterval(insultTime) + 6 * INTERVAL;
  const marksOf = (ts: number[], at: (t: number) => Sample): MarkSample[] =>
    ts.map((t) => ({ mark: t, sample: at(t), substituted: false }));

  it('does not develop without a worse Alarm_State, raises the 4.18 flag, and lists marks present in both', () => {
    const early = marksOf(times(lastEarly), normalSample);
    const none = marksOf(times(lastEarly - 2 * INTERVAL), normalSample);
    const c = compareEarlyWithNone(early, none, insultTime, ALARMS);
    expect(c.develops).toBe(false);
    expect(c.firstWorseAt).toBeNull();
    expect(c.worseVital).toBeNull();
    expect(c.flagRequirement418).toBe(true);
    const expectedTimes = none.map((m) => m.mark).filter((t) => t > insultTime);
    expect(c.rows.map((r) => r.time)).toEqual(expectedTimes);
    for (const r of c.rows) {
      expect(r.early).toBe(early.find((m) => m.mark === r.time)!.sample);
      expect(r.none).toBe(none.find((m) => m.mark === r.time)!.sample);
    }
  });

  it('develops at the first mark after the insult with a more severe Alarm_State', () => {
    const worseAt = times(lastEarly).filter((t) => t > insultTime)[1];
    const early = marksOf(times(lastEarly), (t) =>
      t >= worseAt ? critical(normalSample(t), 'spO2', 'low') : normalSample(t),
    );
    const c = compareEarlyWithNone(early, early, insultTime, ALARMS);
    expect(c).toMatchObject({ develops: true, firstWorseAt: worseAt, worseVital: 'spO2', flagRequirement418: false });
  });

  it('compares with the last mark at or before the insult, not the first', () => {
    const ts = times(lastEarly);
    const lastPre = ts.filter((t) => t <= insultTime).at(-1)!;
    const worseAt = ts.filter((t) => t > insultTime)[1];
    const early = marksOf(ts, (t) =>
      t === 0 || t >= worseAt ? critical(normalSample(t), 'spO2', 'low') : normalSample(t),
    );
    // Preconditions: mark 0 is worse than the last pre-insult mark, and worseAt is as severe as mark 0.
    expect(lastPre).toBeGreaterThan(0);
    const bandAt = (t: number) => bandsOf(early.find((m) => m.mark === t)!.sample, ALARMS).spO2!.state;
    expect([bandAt(0), bandAt(lastPre), bandAt(worseAt)]).toEqual(['critical', 'normal', 'critical']);

    const c = compareEarlyWithNone(early, early, insultTime, ALARMS);
    expect(c).toMatchObject({ develops: true, firstWorseAt: worseAt, worseVital: 'spO2', flagRequirement418: false });
  });

  it('does not count a state that was already as severe at the last mark at or before the insult', () => {
    const early = marksOf(times(lastEarly), (t) => critical(normalSample(t), 'heartRate', 'high'));
    const c = compareEarlyWithNone(early, [], insultTime, ALARMS);
    expect(c.develops).toBe(false);
    expect(c.rows).toEqual([]);
    expect(c.flagRequirement418).toBe(true);
  });
});

describe('statusRuleReport (9.8)', () => {
  const play: PlaySection = {
    ...PLAY,
    status: {
      rules: [
        { when: [{ vital: 'spO2', band: 'critical' }], sentence: 'Synthetic sentence A' },
        { when: [{ vital: 'heartRate', band: 'critical', direction: 'high' }], sentence: 'Synthetic sentence B' },
        { when: [{ vital: 'heartRate', band: 'critical', direction: 'low' }], sentence: 'Synthetic sentence C' },
      ],
      defaultSentence: 'Synthetic default',
    },
  };

  it('separates the marks where a rule matched from those where its sentence was returned', () => {
    const marks: MarkSample[] = [
      { mark: 0, sample: normalSample(0), substituted: false },
      { mark: 10, sample: critical(critical(normalSample(10), 'spO2', 'low'), 'heartRate', 'high'), substituted: false },
      { mark: 20, sample: critical(normalSample(20), 'heartRate', 'high'), substituted: false },
    ];
    expect(statusRuleReport(marks, ALARMS, play)).toEqual({
      rules: [
        { index: 0, sentence: 'Synthetic sentence A', matchedAt: [10], returnedAt: [10] },
        { index: 1, sentence: 'Synthetic sentence B', matchedAt: [10, 20], returnedAt: [20] },
      ],
      onlyDefault: false,
    });
  });

  it('reports onlyDefault when no rule matched', () => {
    const marks: MarkSample[] = [0, 10].map((t) => ({ mark: t, sample: normalSample(t), substituted: false }));
    expect(statusRuleReport(marks, ALARMS, play)).toEqual({ rules: [], onlyDefault: true });
  });

  it('quotes the case sentences unchanged', () => {
    const marks: MarkSample[] = [{ mark: 0, sample: critical(normalSample(0), 'spO2', 'low'), substituted: false }];
    const report = statusRuleReport(marks, ALARMS, PLAY);
    for (const r of report.rules) expect(r.sentence).toBe(PLAY.status.rules[r.index].sentence);
  });
});

describe('examRows and firstAbnormal (5.2, 5.3, 9.9)', () => {
  const exam = PLAY.exam!;
  const decompression = CASE_LEFT.interventions.find(
    (i) => i.action === DECOMPRESSION_ACTION && i.parameters?.side === INSULT.side,
  )!;
  const entryTime = INSULT.timeSeconds + 5 * INTERVAL + 5; // synthetic
  const entry = buildInterventionEntry(decompression, entryTime, BRANCH);

  function expectedRows(rc: CaseData, m: MarkSample, active: InterventionRecordEntry[]): ExamRow[] {
    return examButtons(rc.play!.exam!)
      .flat()
      .map((b) => {
        const action = rc.play!.exam!.actions.find((a) => a.id === b.actionId)!;
        const f = examFinding({
          action,
          side: b.side,
          caseData: rc,
          simulationTime: m.mark,
          sample: m.sample,
          activeInterventions: active,
        });
        return { actionId: b.actionId, side: b.side, sentence: f.sentence, abnormal: f.abnormal };
      });
  }

  it('gives one row per Exam_Button in examButtons order, with entries up to the mark only', () => {
    for (const rc of [CASE_LEFT, CASE_RIGHT]) {
      const before: MarkSample = { mark: entryTime - 5, sample: normalSample(entryTime - 5), substituted: false };
      const after: MarkSample = { mark: entryTime + 5, sample: normalSample(entryTime + 5), substituted: false };
      const rowsBefore = examRows(rc, before, [entry]);
      expect(rowsBefore.map((r) => [r.actionId, r.side])).toEqual(
        examButtons(rc.play!.exam!).flat().map((b) => [b.actionId, b.side]),
      );
      expect(rowsBefore).toEqual(expectedRows(rc, before, []));
      expect(examRows(rc, after, [entry])).toEqual(expectedRows(rc, after, [entry]));
    }
  });

  it('returns [] without an Exam_Section or without a Play_Section', () => {
    const m: MarkSample = { mark: 0, sample: normalSample(0), substituted: false };
    const noExam = structuredClone(CASE_LEFT);
    delete noExam.play!.exam;
    expect(examRows(noExam, m, [])).toEqual([]);
    expect(examRows({ ...CASE_LEFT, play: undefined }, m, [])).toEqual([]);
  });

  it('firstAbnormal gives the first abnormal mark per Exam_Button, or null', () => {
    const row = (actionId: string, side: 'Left' | 'Right' | null, abnormal: boolean): ExamRow => ({
      actionId,
      side,
      sentence: `synthetic ${actionId}`,
      abnormal,
    });
    const perMark = [
      { mark: 0, rows: [row('a', null, false), row('b', 'Left', false), row('b', 'Right', false)] },
      { mark: 10, rows: [row('a', null, false), row('b', 'Left', true), row('b', 'Right', false)] },
      { mark: 20, rows: [row('a', null, true), row('b', 'Left', true), row('b', 'Right', false)] },
    ];
    expect(firstAbnormal(perMark)).toEqual([
      { actionId: 'a', side: null, firstAt: 20 },
      { actionId: 'b', side: 'Left', firstAt: 10 },
      { actionId: 'b', side: 'Right', firstAt: null },
    ]);
    expect(firstAbnormal([])).toEqual([]);
  });

  it('firstAbnormal over examRows keeps examButtons order', () => {
    const perMark = [0, 10].map((t) => {
      const m: MarkSample = { mark: t, sample: normalSample(t), substituted: false };
      return { mark: t, rows: examRows(CASE_LEFT, m, []) };
    });
    expect(firstAbnormal(perMark).map((f) => [f.actionId, f.side])).toEqual(
      examButtons(exam).flat().map((b) => [b.actionId, b.side]),
    );
  });
});

describe('sideDifference (9.10)', () => {
  it('takes the largest absolute difference over marks present in both, null without a pair', () => {
    const m = (mark: number, s: Partial<Sample>): MarkSample => ({
      mark,
      sample: { simulation_time: mark, ...s },
      substituted: false,
    });
    const left = [m(0, { heart_rate: 1 }), m(10, { heart_rate: 70, tidal_volume: 5 }), m(20, { heart_rate: 80 })];
    const right = [m(10, { heart_rate: 75 }), m(20, { heart_rate: 72, tidal_volume: 9 }), m(30, { heart_rate: 0 })];
    expect(sideDifference(left, right)).toEqual({
      heart_rate: 8,
      respiratory_rate: null,
      spo2: null,
      mean_arterial_pressure: null,
      systolic_pressure: null,
      diastolic_pressure: null,
      etco2: null,
      tidal_volume: null,
    });
  });
});
