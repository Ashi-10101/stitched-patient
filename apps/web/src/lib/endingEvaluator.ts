/**
 * Ending_Evaluator (Requirement 6): decides from the ordered VitalSigns samples
 * of the current Branch whether the patient is `rescued`, `lost` or neither yet.
 *
 * Pure: no Wall_Clock_Time, network or outside state. `stepEnding` never
 * mutates its input state; it returns the same object when nothing changes and
 * a new object otherwise.
 */

import type {
  CaseData,
  ConditionGroup,
  InterventionRecordEntry,
  PlaySection,
  VitalCondition,
  VitalSigns,
} from '@/types';
import { readVital } from './vitals';

export type Ending = 'none' | 'rescued' | 'lost';

/** One Vitals_Stream sample; every vital may be missing. */
export type Sample = Partial<VitalSigns> & { simulation_time: number };

export interface EndingContext {
  play: PlaySection | undefined;
  /** Earliest Scheduled_Insult `timeSeconds`, or 0 if none (6.3). */
  rescueFromTime: number;
  /**
   * Rescue_Gate_Time (6.18-6.20): `-Infinity` without Required_Interventions,
   * `null` while a Required_Intervention is not active.
   */
  rescueGateTime: number | null;
}

export interface EndingState {
  ending: Ending;
  /** Simulation_Time of the sample that changed the Ending. */
  endedAt: number | null;
  /** Last accepted sample time. */
  lastTime: number | null;
  /** Start of the current rescue stretch. */
  rescueStart: number | null;
  /** One per Lost_Condition group. */
  lostStarts: (number | null)[];
}

/** Lost_Condition groups of a Play_Section; a missing `groups` counts as `[]`. */
function lostGroups(play: PlaySection | undefined): ConditionGroup[] {
  return play?.endings.lost.groups ?? [];
}

export function buildEndingContext(caseData: CaseData): EndingContext {
  // A missing timeline or insult list counts as no insults; non-finite times are skipped.
  const times = (caseData.timeline?.scheduledInsults ?? [])
    .map((insult) => insult.timeSeconds)
    .filter((t) => typeof t === 'number' && Number.isFinite(t));
  return {
    play: caseData.play,
    rescueFromTime: times.length > 0 ? Math.min(...times) : 0,
    rescueGateTime: rescueGateTime(requiredInterventions(caseData.play), []),
  };
}

/** Required_Interventions of a Play_Section, or `[]` when the field or the Play_Section is absent. */
export function requiredInterventions(play: PlaySection | undefined): readonly string[] {
  return play?.endings?.rescued?.requiredInterventions ?? [];
}

/**
 * Rescue_Gate_Time (6.18-6.20). `-Infinity` for no Required_Interventions.
 * Otherwise the latest, over the required ids, of the earliest finite
 * `simulationTime` of an active entry with that id; `null` if one id has none.
 * Entries with other ids are ignored (6.19). `active` is the output of
 * `activeInterventions(record, lineage)`.
 */
export function rescueGateTime(
  requiredIds: readonly string[],
  active: readonly InterventionRecordEntry[],
): number | null {
  if (requiredIds.length === 0) return -Infinity;
  let gate = -Infinity;
  for (const id of requiredIds) {
    let earliest: number | null = null;
    for (const entry of active) {
      const t = entry.simulationTime;
      if (entry.interventionId !== id || typeof t !== 'number' || !Number.isFinite(t)) continue;
      if (earliest === null || t < earliest) earliest = t;
    }
    if (earliest === null) return null;
    if (earliest > gate) gate = earliest;
  }
  return gate;
}

/**
 * Applies a new Rescue_Gate_Time (6.24). Returns the same `ctx` and `s` when the
 * gate is unchanged. Otherwise returns `ctx` with the new gate and ends an open
 * rescue stretch that starts before the new gate (or any stretch when the gate
 * is `null`). `ending`, `endedAt`, `lastTime` and `lostStarts` never change, and
 * no sample is evaluated again.
 */
export function setRescueGate(
  ctx: EndingContext,
  s: EndingState,
  gate: number | null,
): { ctx: EndingContext; state: EndingState } {
  if (gate === ctx.rescueGateTime) return { ctx, state: s };
  const nextCtx: EndingContext = { ...ctx, rescueGateTime: gate };
  const endStretch =
    s.ending === 'none' && s.rescueStart !== null && (gate === null || s.rescueStart < gate);
  return { ctx: nextCtx, state: endStretch ? { ...s, rescueStart: null } : s };
}

export function initialEndingState(ctx: EndingContext): EndingState {
  return {
    ending: 'none',
    endedAt: null,
    lastTime: null,
    rescueStart: null,
    lostStarts: lostGroups(ctx.play).map(() => null),
  };
}

/** True only when the sample's finite value of the vital compares true with `c.value` (6.15, 6.16). */
export function conditionHolds(c: VitalCondition, sample: Partial<VitalSigns>): boolean {
  const v = readVital(sample, c.vital);
  if (v === undefined) return false;
  switch (c.op) {
    case '<':
      return v < c.value;
    case '<=':
      return v <= c.value;
    case '>=':
      return v >= c.value;
    case '>':
      return v > c.value;
    default:
      return false;
  }
}

function allHold(conditions: VitalCondition[], sample: Partial<VitalSigns>): boolean {
  return conditions.every((c) => conditionHolds(c, sample));
}

export function stepEnding(ctx: EndingContext, s: EndingState, sample: Sample): EndingState {
  // 1. No Play_Section, or the Ending is already set (6.2, 6.10).
  const play = ctx.play;
  if (play === undefined || s.ending !== 'none') return s;

  // 2. Ignore non-finite and non-increasing times (6.8).
  const t = sample.simulation_time;
  if (typeof t !== 'number' || !Number.isFinite(t) || (s.lastTime !== null && t <= s.lastTime)) return s;

  // 3.
  const lastTime = t;

  // 4. Rescue stretch, counted only from rescueFromTime and the Rescue_Gate_Time
  //    (6.3, 6.6, 6.7, 6.18-6.20). A null gate means rescue never holds.
  const { rescued: rescue, lost } = play.endings;
  const gate = ctx.rescueGateTime;
  const rescueHolds =
    t >= ctx.rescueFromTime && gate !== null && t >= gate && allHold(rescue.conditions, sample);
  const rescueStart = rescueHolds ? (s.rescueStart ?? t) : null;
  const rescued = rescueStart !== null && t - rescueStart >= rescue.holdSeconds;

  // 5. Lost groups (6.4, 6.6).
  let lostHit = false;
  const lostStarts = lostGroups(play).map((group, i) => {
    const start = allHold(group.conditions, sample) ? (s.lostStarts[i] ?? t) : null;
    if (start !== null && t - start >= group.holdSeconds) lostHit = true;
    return start;
  });

  // 6. Time_Limit (6.5).
  const timeHit = lost.timeLimitSeconds !== undefined && t >= lost.timeLimitSeconds;

  // 7. Rescue wins on the same sample (6.9).
  const ending: Ending = rescued ? 'rescued' : lostHit || timeHit ? 'lost' : 'none';
  const endedAt = ending !== s.ending ? t : s.endedAt;

  return { ending, endedAt, lastTime, rescueStart, lostStarts };
}

/** Fold of `stepEnding` over `samples`, starting from `from` (default: the initial state). */
export function evaluateEnding(
  ctx: EndingContext,
  samples: readonly Sample[],
  from: EndingState = initialEndingState(ctx),
): EndingState {
  return samples.reduce((state, sample) => stepEnding(ctx, state, sample), from);
}
