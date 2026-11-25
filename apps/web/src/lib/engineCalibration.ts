/**
 * Calibration plan and evaluation (engine-mcp design, "`engineCalibration.ts`", "The eight
 * calibration Scenarios", "Calibration_Checks per Variant", "Calibration evaluation" and the Error
 * Handling section "Calibration").
 *
 * - Case-file facts from the YAML text of `cases/<case_id>.yaml` (8.3). Reading the file is the
 *   Node adapter's job; this module only receives the text.
 * - The `run_calibration` preflight, which fails before any Session is created (8.5, D27).
 * - The four Scenario_Kinds per Variant, with Decompressions chosen from the Resolved_Case by
 *   action and side, never by id (8.2, 8.4, 8.6 to 8.9).
 * - The comparison of the Resolved_Case's Play_Section and Play_Labels with the case file (8.10, 8.11).
 * - Running the plan, where the first Scenario error stops the others (8.12).
 * - The pure evaluation of the Scenario_Results (9.2 to 9.12).
 *
 * Every decision about Endings, Calibration_Checks, the early comparison and side differences is
 * made by `calibration.ts` and the shipped modules it wraps; this module only orders the calls.
 * It imports no `node:` module, no SDK and no `zod`, and uses no global `fetch`, `WebSocket`, clock
 * or file system (D17). The numbers below are tool constants, not clinical values.
 */

import { parse } from 'yaml';
import {
  checkAffectedRescued,
  checkLostNeverRescued,
  compareEarlyWithNone,
  sideDifference,
  type CheckId,
  type CheckResult,
  type EarlyComparison,
  type MarkSample,
  type ScenarioOutcome,
} from './calibration';
import { EngineError } from './engineClient';
import {
  runScenario,
  type GateJson,
  type PlannedIntervention,
  type PlayValuesJson,
  type RunnerDeps,
  type ScenarioHooks,
  type ScenarioRequest,
  type ScenarioResult,
} from './engineRunner';
import { interventionSide } from './playCase';
import { DECOMPRESSION_ACTION, PNEUMOTHORAX_ACTION, affectedInsult } from './sides';
import type { CaseData, Intervention, PlaySection, Side, VitalSigns } from '@/types';

// ---------------------------------------------------------------------------
// Constants (tool constants, not clinical values)
// ---------------------------------------------------------------------------

/** Sample_Interval of every calibration Scenario (8.9, play-mode 13.2). */
export const CALIBRATION_SAMPLE_INTERVAL = 10;
/** Demo_Decompression_Time default (play-mode task 12.3). */
export const DEFAULT_DEMO_DECOMPRESSION_TIME = 150;
/** Early_Decompression_Time default (play-mode task 12.3). */
export const DEFAULT_EARLY_DECOMPRESSION_TIME = 20;
/** The commit whose ancestry the Record_Header reports (play-mode 13.1). */
export const DECOMPRESSION_CHECK_COMMIT = '1e71454';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ScenarioKind = 'no-intervention' | 'affected-side' | 'other-side-only' | 'affected-side-early';
export const SCENARIO_KINDS: readonly ScenarioKind[] = [
  'no-intervention',
  'affected-side',
  'other-side-only',
  'affected-side-early',
];

export interface CalibrationInput {
  caseId: string;
  decompressAtSeconds: number;
  earlyDecompressAtSeconds: number;
  maxSeconds?: number;
  write: boolean;
}

/** 8.3: from cases/<case_id>.yaml, parsed with `yaml`. */
export interface CaseFileFacts {
  variantIds: string[];
  play: PlaySection | undefined;
  playLabels: Record<string /* intervention id */, string | undefined>;
  timeLimitSeconds: number | undefined;
  /** timeSeconds of the first SETensionPneumothorax Scheduled_Insult, or null. */
  pneumothoraxTimeSeconds: number | null;
}

export interface PlannedScenario {
  variantId: string;
  kind: ScenarioKind;
  request: ScenarioRequest;
}

type Limit = { seconds: number; source: 'Time_Limit' | 'max_seconds' };

export interface VariantEvaluation {
  variantId: string;
  affectedSide: Side;
  play: PlayValuesJson; // from the Variant's affected-side Scenario (9.3)
  scenarios: Record<ScenarioKind, ScenarioResult>;
  checks: CheckResult[]; // order: affected-side-rescued, other-side-only-lost, no-intervention-lost
  early: EarlyComparison; // D23, 9.6, 9.7
}

export interface CalibrationEvaluation {
  caseId: string;
  limit: Limit;
  insultTimeSeconds: number;
  demoTime: number;
  earlyTime: number;
  variants: VariantEvaluation[]; // case-file order
  /** 9.10, SCENARIO_KINDS order; null when the case has no Variants `left` and `right`. */
  sideDifference: { kind: ScenarioKind; maxAbs: Partial<Record<keyof VitalSigns, number | null>> }[] | null;
  calibrated: boolean; // every CheckResult of every Variant passes
  failing: { scenario: string; check: CheckId; outcome: string }[]; // 9.11; scenario = "<variant_id> / <kind>"
  requirement418Flagged: boolean; // some Variant has early.flagRequirement418
}

/** The run_calibration structuredContent (the exact type of the shape listed under engineTools.ts). */
export interface CalibrationSummary {
  case_id: string;
  calibrated: boolean;
  failing_scenarios: string[];
  requirement_4_18_flagged: boolean;
  record_path?: string;
  index_path?: string;
  undeleted_sessions?: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function scenarioName(variantId: string, kind: ScenarioKind): string {
  return `${variantId} / ${kind}`;
}

const CHECK_SCENARIO: Readonly<Record<CheckId, ScenarioKind>> = {
  'affected-side-rescued': 'affected-side',
  'other-side-only-lost': 'other-side-only',
  'no-intervention-lost': 'no-intervention',
};

// ---------------------------------------------------------------------------
// Case-file facts (8.3)
// ---------------------------------------------------------------------------

/**
 * 8.3: the Variant_Ids, Play_Section, Play_Labels, Time_Limit and first `SETensionPneumothorax`
 * insult time of the case file. A document that is not a mapping gives empty facts, which the
 * preflight then reports. A YAML syntax error throws EngineError('case'); with `caseId` the message
 * is the design's `Case file cases/<case_id>.yaml is not valid YAML: <parser message>`.
 */
export function readCaseFileFacts(yamlText: string, caseId?: string): CaseFileFacts {
  let doc: unknown;
  try {
    doc = parse(yamlText);
  } catch (err) {
    const file = caseId === undefined ? 'Case file' : `Case file cases/${caseId}.yaml`;
    throw new EngineError('case', `${file} is not valid YAML: ${messageOf(err)}`);
  }
  const root = isPlainObject(doc) ? doc : {};

  const variantIds = Array.isArray(root.variants)
    ? root.variants.flatMap((v) => (isPlainObject(v) && typeof v.id === 'string' ? [v.id] : []))
    : [];

  const play = isPlainObject(root.play) ? (root.play as unknown as PlaySection) : undefined;

  const playLabels: Record<string, string | undefined> = {};
  if (Array.isArray(root.interventions)) {
    for (const i of root.interventions) {
      if (!isPlainObject(i) || typeof i.id !== 'string') continue;
      playLabels[i.id] = typeof i.playLabel === 'string' ? i.playLabel : undefined;
    }
  }

  let timeLimitSeconds: number | undefined;
  const endings = isPlainObject(root.play) ? root.play.endings : undefined;
  const lost = isPlainObject(endings) ? endings.lost : undefined;
  if (isPlainObject(lost) && typeof lost.timeLimitSeconds === 'number' && Number.isFinite(lost.timeLimitSeconds)) {
    timeLimitSeconds = lost.timeLimitSeconds;
  }

  let pneumothoraxTimeSeconds: number | null = null;
  const timeline = isPlainObject(root.timeline) ? root.timeline : undefined;
  const insults = timeline !== undefined && Array.isArray(timeline.scheduledInsults) ? timeline.scheduledInsults : [];
  for (const insult of insults) {
    if (!isPlainObject(insult) || insult.action !== PNEUMOTHORAX_ACTION) continue;
    if (typeof insult.timeSeconds === 'number' && Number.isFinite(insult.timeSeconds)) {
      pneumothoraxTimeSeconds = insult.timeSeconds;
      break;
    }
  }

  return { variantIds, play, playLabels, timeLimitSeconds, pneumothoraxTimeSeconds };
}

// ---------------------------------------------------------------------------
// Preflight (8.5, D27)
// ---------------------------------------------------------------------------

/** 8.5, before any Session. Throws EngineError('case') naming the failed condition.
 *  Returns the Max_Time of every calibration Scenario and the limit for the lost checks.
 *  Also throws EngineError('input') when a Decompression time is above the Max_Time, which
 *  `validatePlan` would otherwise reject only after the Sessions exist. */
export function preflightCalibration(
  input: CalibrationInput,
  facts: CaseFileFacts,
): { maxTime: number; limit: Limit } {
  const id = input.caseId;
  if (facts.variantIds.length === 0) throw new EngineError('case', `Case ${id} has no Variants`);
  if (facts.play === undefined) throw new EngineError('case', `Case ${id} has no Play_Section`);
  const timeLimit = facts.timeLimitSeconds;
  if (timeLimit === undefined && input.maxSeconds === undefined) {
    throw new EngineError('case', `The Play_Section of ${id} has no Time_Limit and max_seconds is not given`);
  }
  const insultTime = facts.pneumothoraxTimeSeconds;
  if (insultTime === null) {
    throw new EngineError('case', `Case ${id} has no ${PNEUMOTHORAX_ACTION} Scheduled_Insult`);
  }
  if (input.earlyDecompressAtSeconds >= insultTime) {
    throw new EngineError(
      'case',
      `early_decompress_at_seconds (${input.earlyDecompressAtSeconds}) must be less than the ${PNEUMOTHORAX_ACTION} timeSeconds (${insultTime})`,
    );
  }

  // 8.7: the Time_Limit, or max_seconds when given. The limit of the lost checks stays the
  // Time_Limit when there is one, so a run cut short fails visibly.
  const maxTime = input.maxSeconds ?? (timeLimit as number);
  const limit: Limit =
    timeLimit !== undefined ? { seconds: timeLimit, source: 'Time_Limit' } : { seconds: maxTime, source: 'max_seconds' };

  const times: [string, number][] = [
    ['decompress_at_seconds', input.decompressAtSeconds],
    ['early_decompress_at_seconds', input.earlyDecompressAtSeconds],
  ];
  for (const [field, value] of times) {
    if (value > maxTime) {
      throw new EngineError('input', `${field} (${value}) must not be greater than the Max_Time (${maxTime})`);
    }
  }
  return { maxTime, limit };
}

// ---------------------------------------------------------------------------
// Decompression choice (8.4, 8.6)
// ---------------------------------------------------------------------------

/** 8.4, 8.6: the first Intervention in Resolved_Case order with action SENeedleDecompression whose
 *  parameters.side (interventionSide) is the Affected_Side ('affected') or the Other_Side ('other').
 *  Throws EngineError('case') naming the Variant_Id and the side. */
export function decompressionFor(rc: CaseData, role: 'affected' | 'other', variantId: string): Intervention {
  const insult = affectedInsult(rc.timeline?.scheduledInsults ?? []);
  if (insult === null) {
    throw new EngineError(
      'case',
      `${variantId}: the Resolved_Case has no ${PNEUMOTHORAX_ACTION} Scheduled_Insult with a side, so the affected side is unknown`,
    );
  }
  const side: Side = role === 'affected' ? insult.side : insult.side === 'Left' ? 'Right' : 'Left';
  const found = rc.interventions.find((i) => i.action === DECOMPRESSION_ACTION && interventionSide(i) === side);
  if (found === undefined) {
    const words = role === 'affected' ? 'affected side' : 'other side';
    throw new EngineError('case', `${variantId}: no ${DECOMPRESSION_ACTION} Intervention for the ${words}`);
  }
  return found;
}

// ---------------------------------------------------------------------------
// Play_Section comparison with the case file (8.10, 8.11)
// ---------------------------------------------------------------------------

/** bedside-exam Override_Target paths inside the Play_Section. */
export const OVERRIDE_TARGET_PLAY_PATHS = ['endings.rescued.requiredInterventions', 'hints', 'sideRevealText'] as const;

const SKIPPED_PLAY_PATHS: ReadonlySet<string> = new Set(OVERRIDE_TARGET_PLAY_PATHS.map((p) => `play.${p}`));

/**
 * First path at which `fromFile` and `resolved` differ, or null. Objects are compared key by key
 * (case-file key order, then keys only the Resolved_Case has); a missing key equals `undefined`.
 * Arrays are compared element by element; a missing element is reported at its index. Primitives
 * are compared with `===`.
 */
function firstDifference(fromFile: unknown, resolved: unknown, path: string): string | null {
  if (SKIPPED_PLAY_PATHS.has(path)) return null;
  if (Array.isArray(fromFile) || Array.isArray(resolved)) {
    if (!Array.isArray(fromFile) || !Array.isArray(resolved)) return path;
    const n = Math.max(fromFile.length, resolved.length);
    for (let i = 0; i < n; i += 1) {
      const at = `${path}[${i}]`;
      if (i >= fromFile.length || i >= resolved.length) return at;
      const d = firstDifference(fromFile[i], resolved[i], at);
      if (d !== null) return d;
    }
    return null;
  }
  if (isPlainObject(fromFile) || isPlainObject(resolved)) {
    if (!isPlainObject(fromFile) || !isPlainObject(resolved)) return path;
    const keys = [...Object.keys(fromFile), ...Object.keys(resolved).filter((k) => !(k in fromFile))];
    for (const k of keys) {
      const d = firstDifference(fromFile[k], resolved[k], `${path}.${k}`);
      if (d !== null) return d;
    }
    return null;
  }
  return fromFile === resolved ? null : path;
}

/** 8.10: deep comparison of rc.play with facts.play outside OVERRIDE_TARGET_PLAY_PATHS, and of each
 *  Intervention's playLabel with the case file. Returns the first differing path
 *  (e.g. "play.endings.lost.groups[0].holdSeconds", "interventions[needle-decompression-left].playLabel") or null. */
export function comparePlayWithCaseFile(rc: CaseData, facts: CaseFileFacts): string | null {
  const playDiff = firstDifference(facts.play, rc.play, 'play');
  if (playDiff !== null) return playDiff;

  const has = (id: string): boolean => Object.prototype.hasOwnProperty.call(facts.playLabels, id);
  for (const i of rc.interventions) {
    const fromFile = has(i.id) ? facts.playLabels[i.id] : undefined;
    if (!has(i.id) || fromFile !== i.playLabel) return `interventions[${i.id}].playLabel`;
  }
  const resolvedIds = new Set(rc.interventions.map((i) => i.id));
  for (const id of Object.keys(facts.playLabels)) {
    if (!resolvedIds.has(id)) return `interventions[${id}].playLabel`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// The eight calibration Scenarios (8.2, 8.4, 8.7 to 8.9, 8.11)
// ---------------------------------------------------------------------------

/** 8.2, 8.7 to 8.9: Variant order of the case file, then SCENARIO_KINDS order (this is also the queue order). */
export function planCalibration(input: CalibrationInput, facts: CaseFileFacts, maxTime: number): PlannedScenario[] {
  const planned: PlannedScenario[] = [];
  for (const variantId of facts.variantIds) {
    const beforePlay = (rc: CaseData): void => {
      const path = comparePlayWithCaseFile(rc, facts);
      if (path !== null) throw new EngineError('case', `${variantId}: ${path} differs from the case file`);
    };
    for (const kind of SCENARIO_KINDS) {
      const plan = (rc: CaseData): readonly PlannedIntervention[] => {
        switch (kind) {
          case 'no-intervention':
            return [];
          case 'affected-side':
            return [{ interventionId: decompressionFor(rc, 'affected', variantId).id, atSeconds: input.decompressAtSeconds }];
          case 'other-side-only':
            return [{ interventionId: decompressionFor(rc, 'other', variantId).id, atSeconds: input.decompressAtSeconds }];
          case 'affected-side-early':
            return [
              { interventionId: decompressionFor(rc, 'affected', variantId).id, atSeconds: input.earlyDecompressAtSeconds },
            ];
        }
      };
      planned.push({
        variantId,
        kind,
        request: {
          caseId: input.caseId,
          variantId,
          plan,
          maxSeconds: maxTime,
          sampleIntervalSeconds: CALIBRATION_SAMPLE_INTERVAL,
          stopAtEnding: kind !== 'affected-side-early', // 8.7, 8.8
          beforePlay,
          name: scenarioName(variantId, kind),
        },
      });
    }
  }
  return planned;
}

// ---------------------------------------------------------------------------
// Running the plan (8.12)
// ---------------------------------------------------------------------------

/** 8.2 to 8.12: runs the plan through runScenario; the first error aborts the others and is rethrown
 *  with the failing Scenario's name. Resolves only after every Scenario has settled, so every
 *  Session of the call has had its DELETE. A cancellation by the caller is rethrown unchanged. */
export async function runCalibration(
  input: CalibrationInput,
  facts: CaseFileFacts,
  deps: RunnerDeps,
  signal: AbortSignal,
  hooks?: ScenarioHooks,
): Promise<Map<string, Record<ScenarioKind, ScenarioResult>>> {
  const { maxTime } = preflightCalibration(input, facts);
  const planned = planCalibration(input, facts, maxTime);

  // Call-internal controller linked to the caller's signal (design "Cleanup and cancellation").
  const controller = new AbortController();
  const onAbort = (): void => controller.abort();
  if (signal.aborted) controller.abort();
  else signal.addEventListener('abort', onAbort, { once: true });

  const failure: { value: { name: string; error: unknown } | null } = { value: null };
  try {
    // runScenario takes its slot in call order, so the queue order is the plan order.
    const outcomes = await Promise.all(
      planned.map((p) =>
        runScenario(p.request, deps, controller.signal, hooks).then(
          (result) => ({ p, result }),
          (error: unknown) => {
            if (failure.value === null) {
              failure.value = { name: scenarioName(p.variantId, p.kind), error };
              controller.abort();
            }
            return { p, result: null };
          },
        ),
      ),
    );

    const first = failure.value;
    if (first !== null) {
      const err = first.error;
      if (signal.aborted && err instanceof EngineError && err.kind === 'cancelled') throw err;
      const message = `Scenario ${first.name} failed: ${messageOf(err)}`;
      throw err instanceof EngineError
        ? new EngineError(err.kind, message, err.details)
        : new EngineError('internal', message);
    }

    const results = new Map<string, Record<ScenarioKind, ScenarioResult>>();
    for (const { p, result } of outcomes) {
      if (result === null) continue; // not reached: any rejection throws above
      const byKind = results.get(p.variantId) ?? ({} as Record<ScenarioKind, ScenarioResult>);
      byKind[p.kind] = result;
      results.set(p.variantId, byKind);
    }
    return results;
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

// ---------------------------------------------------------------------------
// Evaluation (9.2 to 9.12)
// ---------------------------------------------------------------------------

/** Mark_Samples rebuilt from the Scenario_Result's mark rows (design "Calibration evaluation"). */
function marksOf(r: ScenarioResult): MarkSample[] {
  return r.marks.map((row) => ({
    mark: row.time,
    sample: { ...row.vitals, simulation_time: row.source_time },
    substituted: row.substituted,
  }));
}

function gateOf(g: GateJson): number | null {
  return g === 'no-required-interventions' ? -Infinity : g;
}

/** ScenarioOutcome rebuilt from `ending`, `rescue_gate_time`, `rescue_held_without_gate` and the marks. */
function outcomeOf(r: ScenarioResult): ScenarioOutcome {
  const e = r.ending;
  return {
    ending: e.ending,
    endedAt: e.ending === 'none' ? null : e.first_time,
    lostCause: e.ending === 'lost' ? e.lost_cause : null,
    finalGate: gateOf(r.rescue_gate_time),
    endingAfter: r.marks.map((m) => m.ending),
    rescueHeldWithoutGate: [...r.rescue_held_without_gate],
  };
}

/** Pure: Calibration_Checks, early comparison, 4.18 flag, side differences, status and exam reports (9.2 to 9.12). */
export function evaluateCalibration(
  input: CalibrationInput,
  facts: CaseFileFacts,
  limit: { seconds: number; source: 'Time_Limit' | 'max_seconds' },
  results: Map<string, Record<ScenarioKind, ScenarioResult>>,
): CalibrationEvaluation {
  const insultTime = facts.pneumothoraxTimeSeconds;
  if (insultTime === null) {
    throw new EngineError('case', `Case ${input.caseId} has no ${PNEUMOTHORAX_ACTION} Scheduled_Insult`);
  }

  const scenariosOf = (variantId: string): Record<ScenarioKind, ScenarioResult> => {
    const byKind = results.get(variantId);
    const missing = SCENARIO_KINDS.find((k) => byKind?.[k] === undefined);
    if (byKind === undefined || missing !== undefined) {
      throw new EngineError('internal', `No Scenario_Result for ${scenarioName(variantId, missing ?? 'no-intervention')}`);
    }
    return byKind;
  };

  const variants: VariantEvaluation[] = facts.variantIds.map((variantId) => {
    const scenarios = scenariosOf(variantId);
    const affected = scenarios['affected-side'];
    const affectedSide = affected.affected_side;
    if (affectedSide === null) {
      throw new EngineError('internal', `${scenarioName(variantId, 'affected-side')}: the Scenario_Result has no Affected_Side`);
    }
    const play = affected.play_values;
    if (play === null) {
      throw new EngineError('internal', `${scenarioName(variantId, 'affected-side')}: the Scenario_Result has no Play_Section values`);
    }
    const checks: CheckResult[] = [
      checkAffectedRescued(variantId, outcomeOf(affected), play.rescue.hold_seconds),
      checkLostNeverRescued('other-side-only-lost', variantId, outcomeOf(scenarios['other-side-only']), limit),
      checkLostNeverRescued('no-intervention-lost', variantId, outcomeOf(scenarios['no-intervention']), limit),
    ];
    const earlyResult = scenarios['affected-side-early'];
    const early = compareEarlyWithNone(
      marksOf(earlyResult),
      marksOf(scenarios['no-intervention']),
      insultTime,
      earlyResult.alarm_thresholds,
    );
    return { variantId, affectedSide, play, scenarios, checks, early };
  });

  const byId = new Map(variants.map((v) => [v.variantId, v] as const));
  const left = byId.get('left');
  const right = byId.get('right');
  const sideDiff =
    left !== undefined && right !== undefined
      ? SCENARIO_KINDS.map((kind) => ({
          kind,
          maxAbs: sideDifference(marksOf(left.scenarios[kind]), marksOf(right.scenarios[kind])),
        }))
      : null;

  const failing: CalibrationEvaluation['failing'] = variants.flatMap((v) =>
    v.checks
      .filter((c) => !c.pass)
      .map((c) => ({ scenario: scenarioName(v.variantId, CHECK_SCENARIO[c.check]), check: c.check, outcome: c.basis })),
  );

  return {
    caseId: input.caseId,
    limit,
    insultTimeSeconds: insultTime,
    demoTime: input.decompressAtSeconds,
    earlyTime: input.earlyDecompressAtSeconds,
    variants,
    sideDifference: sideDiff,
    calibrated: failing.length === 0,
    failing,
    requirement418Flagged: variants.some((v) => v.early.flagRequirement418),
  };
}
