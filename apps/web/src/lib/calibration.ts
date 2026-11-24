/**
 * Calibration helpers (engine-mcp design, "`calibration.ts`"; supersedes play-mode task 12.1).
 *
 * Pure functions over recorded samples: Mark_Samples, the outcome fold, Calibration_Checks, the
 * early comparison (D23), Vital_Bands and Overall_Status, the Status_Rule report, Exam_Finding rows
 * and the left/right difference. Every decision is made by the shipped modules (Ending_Evaluator,
 * Status_Selector, Vital_Band functions, Exam_Finding_Selector); this module only calls them (1.2).
 * Sentences come from the Resolved_Case unchanged (9.13). No clock, network or file system (D17).
 */

import {
  buildEndingContext,
  conditionHolds,
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
import { examButtons, examFinding } from './examFinding';
import { selectStatus, statusItemMatches } from './statusSelector';
import { getVitalBand, overallStatus, thresholdsFor } from './vitalBands';
import { VITAL_NAMES, readVital, type VitalName } from './vitals';
import type {
  AlarmState,
  AlarmThresholds,
  CaseData,
  InterventionRecordEntry,
  PlaySection,
  Side,
  VitalBand,
  VitalSigns,
} from '@/types';

/** Latest Ending time that `affected-side-rescued` accepts, in simulated seconds (play-mode 13.5). */
export const DEMO_RESCUE_BOUND_SECONDS = 300;

// ---------------------------------------------------------------------------
// Mark_Samples (4.8)
// ---------------------------------------------------------------------------

export interface MarkSample {
  mark: number;
  sample: Sample;
  substituted: boolean;
}

/** One Mark_Sample per multiple of `interval` from 0 to the last kept time: the kept sample at the mark,
 *  else the next kept sample, flagged (4.8). `kept` is strictly increasing in simulation_time. */
export function markSamples(kept: readonly Sample[], interval: number): MarkSample[] {
  if (!Number.isInteger(interval) || interval < 1) {
    throw new RangeError(`Sample_Interval must be a whole number of at least 1, got ${String(interval)}`);
  }
  if (kept.length === 0) return [];
  const last = kept[kept.length - 1].simulation_time;
  const marks: MarkSample[] = [];
  let j = 0;
  for (let mark = 0; mark <= last; mark += interval) {
    // kept[last].simulation_time >= mark, so j stays in range.
    while (kept[j].simulation_time < mark) j += 1;
    const sample = kept[j];
    marks.push({ mark, sample, substituted: sample.simulation_time !== mark });
  }
  return marks;
}

// ---------------------------------------------------------------------------
// Outcome fold (D3, 4.6, 4.7, 5.4, 5.5)
// ---------------------------------------------------------------------------

export type LostCause = number /* 1-based Lost_Condition group */ | 'Time_Limit';

export interface OutcomeFold {
  /** Records a Runner_Intervention_Record entry; its gate change applies before the first pushed
   *  Mark_Sample with mark >= entry.simulationTime (D3, 4.6). */
  addEntry(entry: InterventionRecordEntry): void;
  push(m: MarkSample): void;
  readonly ending: Ending;
  readonly endedAt: number | null;
  readonly lostCause: LostCause | null;
  /** Current Rescue_Gate_Time: -Infinity without Required_Interventions, null while closed. */
  readonly gate: number | null;
  /** The Ending after each pushed Mark_Sample, in push order (5.1). */
  readonly endingAfter: readonly Ending[];
}

/**
 * Cause of a `lost` Ending, read from the state `stepEnding` returned for the sample that set it:
 * the first Lost_Condition group (1-based) whose stretch reached its Hold_Duration, else the
 * Time_Limit. When a group and the Time_Limit are reached on the same sample, the group is named.
 */
function lostCauseOf(ctx: EndingContext, s: EndingState): LostCause {
  const groups = ctx.play?.endings.lost.groups ?? [];
  const t = s.endedAt;
  if (t !== null) {
    for (let i = 0; i < groups.length; i += 1) {
      const start = s.lostStarts[i];
      if (start !== null && start !== undefined && t - start >= groups[i].holdSeconds) return i + 1;
    }
  }
  return 'Time_Limit';
}

/** Uses buildEndingContext, initialEndingState, stepEnding, setRescueGate, rescueGateTime,
 *  requiredInterventions from endingEvaluator.ts. Mark_Samples are evaluated with `simulation_time`
 *  set to their mark, so a substituted sample stands for its Sample_Mark. */
export function createOutcomeFold(rc: CaseData): OutcomeFold {
  const required = requiredInterventions(rc.play);
  let ctx = buildEndingContext(rc);
  let state = initialEndingState(ctx);
  /** Entries added but not yet applied, in record order. */
  const pending: InterventionRecordEntry[] = [];
  /** Entries whose gate change has been applied, in record order. */
  const applied: InterventionRecordEntry[] = [];
  const endingAfter: Ending[] = [];
  let lostCause: LostCause | null = null;

  return {
    addEntry(entry) {
      pending.push(entry);
    },
    push(m) {
      // D3: every entry with Actual_Time <= mark, in record order, before this Mark_Sample.
      let i = 0;
      while (i < pending.length) {
        if (pending[i].simulationTime <= m.mark) {
          applied.push(pending.splice(i, 1)[0]);
          ({ ctx, state } = setRescueGate(ctx, state, rescueGateTime(required, applied)));
        } else {
          i += 1;
        }
      }
      const before = state.ending;
      state = stepEnding(ctx, state, { ...m.sample, simulation_time: m.mark });
      if (before === 'none' && state.ending === 'lost') lostCause = lostCauseOf(ctx, state);
      endingAfter.push(state.ending);
    },
    get ending() {
      return state.ending;
    },
    get endedAt() {
      return state.endedAt;
    },
    get lostCause() {
      return lostCause;
    },
    get gate() {
      return ctx.rescueGateTime;
    },
    get endingAfter() {
      return endingAfter;
    },
  };
}

export interface ScenarioOutcome {
  ending: Ending;
  endedAt: number | null;
  lostCause: LostCause | null;
  finalGate: number | null;
  endingAfter: Ending[];
  /** Marks at which every rescue Vital_Condition held, ignoring the gate and the insult bound (13.15). */
  rescueHeldWithoutGate: number[];
}

/** Post-hoc fold; equal to the incremental fold for the same entries and marks (D3).
 *  `finalGate` covers the entries with Actual_Time at or before the last mark, as in the incremental fold. */
export function scenarioOutcome(
  rc: CaseData,
  marks: readonly MarkSample[],
  entries: readonly InterventionRecordEntry[],
): ScenarioOutcome {
  const fold = createOutcomeFold(rc);
  for (const entry of entries) fold.addEntry(entry);
  for (const m of marks) fold.push(m);

  const rescueConditions = rc.play?.endings.rescued.conditions;
  const rescueHeldWithoutGate =
    rescueConditions === undefined
      ? []
      : marks
          .filter((m) => {
            const sample = { ...m.sample, simulation_time: m.mark };
            return rescueConditions.every((c) => conditionHolds(c, sample));
          })
          .map((m) => m.mark);

  return {
    ending: fold.ending,
    endedAt: fold.endedAt,
    lostCause: fold.lostCause,
    finalGate: fold.gate,
    endingAfter: [...fold.endingAfter],
    rescueHeldWithoutGate,
  };
}

// ---------------------------------------------------------------------------
// Calibration_Checks (9.5; play-mode 13.5 to 13.7, 13.14, 13.15)
// ---------------------------------------------------------------------------

export type CheckId = 'affected-side-rescued' | 'other-side-only-lost' | 'no-intervention-lost';

export interface CheckResult {
  check: CheckId;
  variantId: string;
  pass: boolean;
  /** "rescued at 230 s; gate 150 s + hold 30 s = 180 s ≤ 230 s ≤ 300 s" style basis (9.5). */
  basis: string;
}

const isFiniteNumber = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

const cmp = (a: number, b: number): string => (a <= b ? '≤' : '>');

/** Rescue_Gate_Time in the Calibration_Record's words. */
function gateText(gate: number | null): string {
  if (gate === null) return 'closed';
  if (gate === -Infinity) return 'open from the start (no Required_Interventions)';
  return `${gate} s`;
}

function lostCauseText(cause: LostCause | null): string {
  if (cause === null) return 'unknown';
  return cause === 'Time_Limit' ? 'Time_Limit' : `Lost_Condition group ${cause}`;
}

function endingText(o: ScenarioOutcome): string {
  if (o.ending === 'none' || o.endedAt === null) return 'Ending stayed none';
  if (o.ending === 'rescued') return `rescued at ${o.endedAt} s`;
  return `lost at ${o.endedAt} s (cause: ${lostCauseText(o.lostCause)})`;
}

/** 13.5 + 13.14: rescued, endedAt <= DEMO_RESCUE_BOUND_SECONDS and endedAt >= gate + holdSeconds (gate finite). */
export function checkAffectedRescued(variantId: string, o: ScenarioOutcome, holdSeconds: number): CheckResult {
  const bound = DEMO_RESCUE_BOUND_SECONDS;
  const gate = o.finalGate;
  const t = o.endedAt;
  const rescued = o.ending === 'rescued' && t !== null;
  const parts = [endingText(o)];
  if (rescued && isFiniteNumber(gate)) {
    const earliest = gate + holdSeconds;
    parts.push(`gate ${gate} s + hold ${holdSeconds} s = ${earliest} s ${cmp(earliest, t)} ${t} s ${cmp(t, bound)} ${bound} s`);
  } else if (rescued) {
    parts.push(`gate ${gateText(gate)}`, `hold ${holdSeconds} s`, `${t} s ${cmp(t, bound)} ${bound} s`);
  } else {
    parts.push(`gate ${gateText(gate)}`, `hold ${holdSeconds} s`, `bound ${bound} s`);
  }
  const pass = rescued && isFiniteNumber(gate) && t <= bound && t >= gate + holdSeconds;
  return { check: 'affected-side-rescued', variantId, pass, basis: parts.join('; ') };
}

/** 13.6 / 13.7 + 13.15: never rescued, lost, endedAt <= limit. The basis names the lost cause and the gate. */
export function checkLostNeverRescued(
  check: 'other-side-only-lost' | 'no-intervention-lost',
  variantId: string,
  o: ScenarioOutcome,
  limit: { seconds: number; source: 'Time_Limit' | 'max_seconds' },
): CheckResult {
  const t = o.endedAt;
  const lost = o.ending === 'lost' && t !== null;
  const neverRescued = o.ending !== 'rescued' && !o.endingAfter.includes('rescued');
  const limitText = `limit ${limit.seconds} s (${limit.source})`;
  const held = o.rescueHeldWithoutGate;
  const parts = [
    endingText(o),
    lost ? `${t} s ${cmp(t, limit.seconds)} ${limitText}` : limitText,
    `gate ${gateText(o.finalGate)}`,
    `rescue held without the gate at: ${held.length > 0 ? `${held.join(', ')} s` : 'none'}`,
  ];
  if (check === 'other-side-only-lost') parts.push('answers open question 1, item c');
  const pass = neverRescued && lost && t <= limit.seconds;
  return { check, variantId, pass, basis: parts.join('; ') };
}

// ---------------------------------------------------------------------------
// Vital_Bands, Overall_Status (9.8, 5.1)
// ---------------------------------------------------------------------------

/** 9.8 / 5.1, using getVitalBand, thresholdsFor and overallStatus. */
export function bandsOf(sample: Sample, alarms: AlarmThresholds): Partial<Record<VitalName, VitalBand>> {
  const bands: Partial<Record<VitalName, VitalBand>> = {};
  for (const vital of VITAL_NAMES) {
    const threshold = thresholdsFor(alarms, vital);
    const value = readVital(sample, vital);
    if (threshold !== undefined && value !== undefined) bands[vital] = getVitalBand(value, threshold);
  }
  return bands;
}

export function overallStatusOf(sample: Sample, alarms: AlarmThresholds): AlarmState {
  return overallStatus(bandsOf(sample, alarms));
}

// ---------------------------------------------------------------------------
// Early Decompression compared with no intervention (D23, 9.6, 9.7)
// ---------------------------------------------------------------------------

export interface EarlyComparison {
  /** Marks after the insult's timeSeconds present in both Scenarios. */
  rows: { time: number; early: Sample; none: Sample }[];
  /** D23 rule. */
  develops: boolean;
  firstWorseAt: number | null;
  worseVital: VitalName | null;
  /** 9.7: true when develops is false. */
  flagRequirement418: boolean;
}

/** True when `a` is more severe than `b` in the order of `overallStatus` (normal < warning < critical). */
function moreSevere(a: AlarmState, b: AlarmState): boolean {
  if (a === b) return false;
  return overallStatus({ heartRate: { state: a, direction: 'none' }, spO2: { state: b, direction: 'none' } }) === a;
}

/**
 * D23: in the `affected-side-early` Scenario, the tension pneumothorax develops when, at one or more
 * Mark_Samples after `insultTime`, a vital sign with Case thresholds has a more severe Alarm_State than
 * at the last Mark_Sample at or before `insultTime`. A vital without a value at either Mark_Sample is
 * not compared. Without a Mark_Sample at or before `insultTime`, `develops` is false.
 */
export function compareEarlyWithNone(
  early: readonly MarkSample[],
  none: readonly MarkSample[],
  insultTime: number,
  alarms: AlarmThresholds,
): EarlyComparison {
  const noneByMark = new Map(none.map((m) => [m.mark, m] as const));
  const rows: EarlyComparison['rows'] = [];
  for (const e of early) {
    const n = noneByMark.get(e.mark);
    if (e.mark > insultTime && n !== undefined) rows.push({ time: e.mark, early: e.sample, none: n.sample });
  }

  let baseline: MarkSample | undefined;
  for (const e of early) if (e.mark <= insultTime) baseline = e;

  let firstWorseAt: number | null = null;
  let worseVital: VitalName | null = null;
  if (baseline !== undefined) {
    const baseBands = bandsOf(baseline.sample, alarms);
    for (const e of early) {
      if (e.mark <= insultTime) continue;
      const bands = bandsOf(e.sample, alarms);
      const vital = VITAL_NAMES.find((v) => {
        const now = bands[v];
        const base = baseBands[v];
        return now !== undefined && base !== undefined && moreSevere(now.state, base.state);
      });
      if (vital !== undefined) {
        firstWorseAt = e.mark;
        worseVital = vital;
        break;
      }
    }
  }
  const develops = firstWorseAt !== null;
  return { rows, develops, firstWorseAt, worseVital, flagRequirement418: !develops };
}

// ---------------------------------------------------------------------------
// Status_Rule report (9.8)
// ---------------------------------------------------------------------------

export interface StatusRuleReport {
  rules: { index: number; sentence: string; matchedAt: number[]; returnedAt: number[] }[]; // only rules that matched
  onlyDefault: boolean;
}

/** matchedAt: every `when` item passes statusItemMatches; returnedAt: selectStatus returned that sentence (9.8).
 *  `index` is 0-based in `play.status.rules`. `onlyDefault` is true when selectStatus returned the
 *  `defaultSentence` at every mark. */
export function statusRuleReport(
  marks: readonly MarkSample[],
  alarms: AlarmThresholds,
  play: PlaySection,
): StatusRuleReport {
  const returned = marks.map((m) => selectStatus(m.sample, alarms, play));
  const rules: StatusRuleReport['rules'] = [];
  play.status.rules.forEach((rule, index) => {
    const matchedAt: number[] = [];
    const returnedAt: number[] = [];
    marks.forEach((m, k) => {
      if (!rule.when.every((item) => statusItemMatches(m.sample, alarms, item))) return;
      matchedAt.push(m.mark);
      if (returned[k] === rule.sentence) returnedAt.push(m.mark);
    });
    if (matchedAt.length > 0) rules.push({ index, sentence: rule.sentence, matchedAt, returnedAt });
  });
  const onlyDefault = returned.every((s) => s === play.status.defaultSentence);
  return { rules, onlyDefault };
}

// ---------------------------------------------------------------------------
// Exam_Findings (5.2, 5.3, 9.9)
// ---------------------------------------------------------------------------

export interface ExamRow {
  actionId: string;
  side: Side | null;
  sentence: string;
  abnormal: boolean;
}

/** One row per Exam_Button in examButtons order, from examFinding with the entries whose
 *  simulationTime <= mark (5.2); [] without an Exam_Section (5.3). */
export function examRows(rc: CaseData, m: MarkSample, entries: readonly InterventionRecordEntry[]): ExamRow[] {
  const exam = rc.play?.exam;
  if (exam === undefined) return [];
  const active = entries.filter((e) => e.simulationTime <= m.mark);
  // examButtons maps exam.actions in order, so group i belongs to exam.actions[i].
  return examButtons(exam).flatMap((group, i) =>
    group.map((button) => {
      const finding = examFinding({
        action: exam.actions[i],
        side: button.side,
        caseData: rc,
        simulationTime: m.mark,
        sample: m.sample,
        activeInterventions: active,
      });
      return { actionId: button.actionId, side: button.side, sentence: finding.sentence, abnormal: finding.abnormal };
    }),
  );
}

/** 9.9: first mark per Exam_Button with an Abnormal_Finding, or null. Buttons in the order of the
 *  first mark's rows; [] for no marks. */
export function firstAbnormal(
  perMark: readonly { mark: number; rows: readonly ExamRow[] }[],
): { actionId: string; side: Side | null; firstAt: number | null }[] {
  if (perMark.length === 0) return [];
  return perMark[0].rows.map(({ actionId, side }) => {
    const hit = perMark.find((p) => p.rows.some((r) => r.actionId === actionId && r.side === side && r.abnormal));
    return { actionId, side, firstAt: hit === undefined ? null : hit.mark };
  });
}

// ---------------------------------------------------------------------------
// Difference between Variants left and right (9.10)
// ---------------------------------------------------------------------------

/** Numeric VitalSigns fields, in the order of the `VitalSigns` type. */
const NUMERIC_VITAL_FIELDS = [
  'heart_rate',
  'respiratory_rate',
  'spo2',
  'mean_arterial_pressure',
  'systolic_pressure',
  'diastolic_pressure',
  'etco2',
  'tidal_volume',
] as const satisfies readonly Exclude<keyof VitalSigns, 'simulation_time'>[];

/** 9.10: largest |left - right| per numeric VitalSigns field over marks present in both; null if none.
 *  Every numeric field is present in the result; a pair counts only when both values are finite. */
export function sideDifference(
  left: readonly MarkSample[],
  right: readonly MarkSample[],
): Partial<Record<keyof VitalSigns, number | null>> {
  const rightByMark = new Map(right.map((m) => [m.mark, m] as const));
  const result: Partial<Record<keyof VitalSigns, number | null>> = {};
  for (const field of NUMERIC_VITAL_FIELDS) {
    let max: number | null = null;
    for (const l of left) {
      const r = rightByMark.get(l.mark);
      if (r === undefined) continue;
      const a: unknown = l.sample[field];
      const b: unknown = r.sample[field];
      if (!isFiniteNumber(a) || !isFiniteNumber(b)) continue;
      const diff = Math.abs(a - b);
      if (max === null || diff > max) max = diff;
    }
    result[field] = max;
  }
  return result;
}
