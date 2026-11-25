/**
 * SDK-free tool handlers of the engine tools (engine-mcp design, "`engineTools.ts`", "Progress
 * notifications", "Per-call flow of the tools", "Tool inputs and outputs" and "CLI options").
 *
 * - The `zod/v4` input schemas and the published JSON Schemas (`z.toJSONSchema`) of `list_cases`,
 *   `run_scenario` and `run_calibration`, with the published tool descriptions (1.1, 3.1, 8.1).
 * - `createEngineTools`: one handler per tool. Each validates its arguments with the same schema it
 *   publishes (D15), then runs the local preflight, then the Health_Check, then Sessions (D27), and
 *   returns a plain MCP-shaped tool result (`content`, `structuredContent`, `isError`). A handler
 *   never throws: every failure becomes one error result naming the cause (1.6, 1.7, 3.2).
 * - The Engine_CLI parser and exit code, so both front ends call the same handlers (11.1, 11.4, 11.6).
 *
 * This is the only non-test module under `src/` that imports `zod` (18.3). It imports no `node:`
 * module and no SDK, and uses no global `fetch`, `WebSocket`, clock or file system (D17): the case
 * file, the Git facts, the date, the record file system, the log and the clock all come in through
 * `EngineDeps`. It writes no clinical text. The numbers below are tool constants, not clinical values.
 */

import { z } from 'zod/v4';
import {
  renderCalibrationRecord,
  writeCalibrationRecord,
  type GitInfo,
  type RecordFs,
  type RecordHeader,
} from './calibrationRecord';
import { EngineError, KEBAB, type EngineErrorKind } from './engineClient';
import {
  DEFAULT_DEMO_DECOMPRESSION_TIME,
  DEFAULT_EARLY_DECOMPRESSION_TIME,
  SCENARIO_KINDS,
  evaluateCalibration,
  preflightCalibration,
  readCaseFileFacts,
  runCalibration,
  type CalibrationInput,
  type CalibrationSummary,
  type CaseFileFacts,
} from './engineCalibration';
import {
  runScenario,
  undeletedSessionsOf,
  type RunnerDeps,
  type ScenarioHooks,
  type ScenarioRequest,
  type ScenarioResult,
} from './engineRunner';
import type { SessionSlots } from './engineSlots';
import { VITAL_NAMES } from './vitals';

// ---------------------------------------------------------------------------
// Constants (tool constants, not clinical values)
// ---------------------------------------------------------------------------

/** 8.13: a progress notification every 5 s of clock time, so at least one per 10 s. */
export const PROGRESS_INTERVAL_MS = 5_000;

const MAX_SECONDS_LIMIT = 3600; // 3.1, 8.1
const MAX_SAMPLE_INTERVAL = 60; // 3.1
const DEFAULT_SAMPLE_INTERVAL = 10; // 3.1
const MAX_PLANNED_INTERVENTIONS = 20; // 3.1

const UNKNOWN_GIT: GitInfo = { shortSha: 'unknown', casesDirty: 'unknown', libDirty: 'unknown', has1e71454: 'unknown' };

// ---------------------------------------------------------------------------
// Input schemas (3.1, 8.1)
// ---------------------------------------------------------------------------

/** Error map: "is required" for a missing value, else `expected`. */
function required(expected: string): (issue: { input?: unknown }) => string {
  return (issue) => (issue.input === undefined ? 'is required' : expected);
}

const KEBAB_MESSAGE = 'must be a kebab-case string';
const kebab = z.string({ error: required(KEBAB_MESSAGE) }).regex(KEBAB, KEBAB_MESSAGE);
const whole = z
  .number({ error: required('must be a whole number') })
  .int('must be a whole number')
  .nonnegative('must be >= 0');
const seconds = (max: number) =>
  z
    .number({ error: required('must be a whole number') })
    .int('must be a whole number')
    .min(1, 'must be >= 1')
    .max(max, `must be <= ${max}`);
const flag = z.boolean({ error: required('must be true or false') });
const objectError = (issue: { code?: string; input?: unknown }): string | undefined =>
  issue.code === 'invalid_type' ? (issue.input === undefined ? 'is required' : 'must be an object') : undefined;

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

interface Issue {
  path: readonly PropertyKey[];
  message: string;
}

const AT_SECONDS_MESSAGE = 'must be <= max_seconds';

/**
 * 3.2: every Planned_Intervention whose `at_seconds` is greater than `max_seconds`. Works on the raw
 * value too, so the check also reports when other fields are invalid (Property 1 names every
 * invalid field). Values that are not finite numbers are left to the field schemas.
 */
function atSecondsIssues(value: unknown): Issue[] {
  if (!isPlainObject(value)) return [];
  const max = value.max_seconds;
  const list = value.interventions;
  if (typeof max !== 'number' || !Number.isFinite(max) || !Array.isArray(list)) return [];
  const issues: Issue[] = [];
  list.forEach((p, i) => {
    if (!isPlainObject(p)) return;
    const at = p.at_seconds;
    if (typeof at === 'number' && Number.isFinite(at) && at > max) {
      issues.push({ path: ['interventions', i, 'at_seconds'], message: AT_SECONDS_MESSAGE });
    }
  });
  return issues;
}

export const ListCasesInput = z.strictObject({}, { error: objectError });

export const RunScenarioInput = z
  .strictObject(
    {
      case_id: kebab,
      variant_id: kebab, // required string, null rejected (D10)
      interventions: z
        .array(z.strictObject({ intervention_id: kebab, at_seconds: whole }, { error: objectError }), {
          error: required('must be a list'),
        })
        .max(MAX_PLANNED_INTERVENTIONS, `must have at most ${MAX_PLANNED_INTERVENTIONS} items`)
        .default([]),
      max_seconds: seconds(MAX_SECONDS_LIMIT),
      sample_interval_seconds: seconds(MAX_SAMPLE_INTERVAL).default(DEFAULT_SAMPLE_INTERVAL),
      stop_at_ending: flag.default(false),
    },
    { error: objectError },
  )
  .superRefine(
    (v, ctx) => {
      for (const issue of atSecondsIssues(v)) {
        ctx.addIssue({ code: 'custom', path: [...issue.path], message: issue.message });
      }
    },
    { when: (payload) => isPlainObject(payload.value) },
  );

export const RunCalibrationInput = z.strictObject(
  {
    case_id: kebab,
    decompress_at_seconds: whole.default(DEFAULT_DEMO_DECOMPRESSION_TIME),
    early_decompress_at_seconds: whole.default(DEFAULT_EARLY_DECOMPRESSION_TIME),
    max_seconds: seconds(MAX_SECONDS_LIMIT).optional(),
    write: flag.default(false),
  },
  { error: objectError },
);

// ---------------------------------------------------------------------------
// Output schemas (Data Models, "Scenario_Result" and "Calibration evaluation")
// ---------------------------------------------------------------------------

const SideSchema = z.enum(['Left', 'Right']);
const AlarmStateSchema = z.enum(['normal', 'warning', 'critical']);
const EndingSchema = z.enum(['none', 'rescued', 'lost']);
const VitalConditionSchema = z.object({
  vital: z.enum(VITAL_NAMES),
  op: z.enum(['<', '<=', '>=', '>']),
  value: z.number(),
});
const BoundsSchema = z.object({ low: z.number().optional(), high: z.number().optional() });
const AlarmThresholdSchema = z.object({
  critical: BoundsSchema.optional(),
  warning: BoundsSchema.optional(),
  normal: z.object({ low: z.number(), high: z.number() }).optional(),
});
const VitalBandSchema = z.object({ state: AlarmStateSchema, direction: z.enum(['low', 'high', 'none']) });

const MarkRowSchema = z.object({
  time: z.number(),
  substituted: z.boolean(),
  source_time: z.number(),
  vitals: z.object({
    heart_rate: z.number().optional(),
    respiratory_rate: z.number().optional(),
    spo2: z.number().optional(),
    mean_arterial_pressure: z.number().optional(),
    systolic_pressure: z.number().optional(),
    diastolic_pressure: z.number().optional(),
    etco2: z.number().optional(),
    tidal_volume: z.number().optional(),
  }),
  bands: z.object({
    heartRate: VitalBandSchema.optional(),
    respiratoryRate: VitalBandSchema.optional(),
    spO2: VitalBandSchema.optional(),
    meanArterialPressure: VitalBandSchema.optional(),
    etCO2: VitalBandSchema.optional(),
    tidalVolume: VitalBandSchema.optional(),
  }),
  overall_status: AlarmStateSchema,
  status_sentence: z.string().nullable(),
  ending: EndingSchema,
  exam: z.array(
    z.object({ action_id: z.string(), side: SideSchema.nullable(), sentence: z.string(), abnormal: z.boolean() }),
  ),
});

/** A zod object that mirrors ScenarioResult (Data Models); run_scenario's outputSchema is
 *  z.toJSONSchema(ScenarioResultSchema, { io: 'output' }). */
export const ScenarioResultSchema: z.ZodType<ScenarioResult> = z.object({
  case_id: z.string(),
  variant_id: z.string(),
  affected_side: SideSchema.nullable(),
  sample_interval_seconds: z.number().int(),
  max_seconds: z.number().int(),
  stop_at_ending: z.boolean(),
  last_time: z.number(),
  service_url: z.string(),
  alarm_thresholds: z.object({
    heartRate: AlarmThresholdSchema,
    respiratoryRate: AlarmThresholdSchema,
    spO2: AlarmThresholdSchema,
    meanArterialPressure: AlarmThresholdSchema,
    etCO2: AlarmThresholdSchema.optional(),
    tidalVolume: AlarmThresholdSchema.optional(),
  }),
  play_values: z
    .object({
      rescue: z.object({
        conditions: z.array(VitalConditionSchema),
        hold_seconds: z.number(),
        required_interventions: z.array(z.string()),
      }),
      lost_groups: z.array(z.object({ conditions: z.array(VitalConditionSchema), hold_seconds: z.number() })),
      time_limit_seconds: z.number().nullable(),
    })
    .nullable(),
  interventions: z.array(
    z.object({
      intervention_id: z.string(),
      requested_time: z.number(),
      actual_time: z.number(),
      late: z.boolean(),
    }),
  ),
  rescue_gate_time: z.union([z.number(), z.null(), z.literal('no-required-interventions')]),
  ending: z.discriminatedUnion('ending', [
    z.object({ ending: z.literal('none'), stayed_none: z.literal(true), until: z.number() }),
    z.object({ ending: z.literal('rescued'), stayed_none: z.literal(false), first_time: z.number() }),
    z.object({
      ending: z.literal('lost'),
      stayed_none: z.literal(false),
      first_time: z.number(),
      lost_cause: z.union([z.number().int(), z.literal('Time_Limit')]),
    }),
  ]),
  rescue_held_without_gate: z.array(z.number()),
  status_rules: z.object({
    rules: z.array(
      z.object({
        index: z.number().int(),
        sentence: z.string(),
        matched_at: z.array(z.number()),
        returned_at: z.array(z.number()),
      }),
    ),
    only_default: z.boolean(),
    default_sentence: z.string().nullable(),
  }),
  first_abnormal: z.array(
    z.object({ action_id: z.string(), side: SideSchema.nullable(), first_at: z.number().nullable() }),
  ),
  marks: z.array(MarkRowSchema),
  undeleted_sessions: z.array(z.string()).optional(),
});

/** The run_calibration structuredContent (10.6); run_calibration's outputSchema. */
export const CalibrationSummarySchema: z.ZodType<CalibrationSummary> = z.object({
  case_id: z.string(),
  calibrated: z.boolean(),
  failing_scenarios: z.array(z.string()),
  requirement_4_18_flagged: z.boolean(),
  record_path: z.string().optional(),
  index_path: z.string().optional(),
  undeleted_sessions: z.array(z.string()).optional(),
});

// ---------------------------------------------------------------------------
// Tool definitions (1.1)
// ---------------------------------------------------------------------------

export type ToolName = 'list_cases' | 'run_scenario' | 'run_calibration';

export interface ToolDefinition {
  name: ToolName;
  description: string;
  inputSchema: Record<string, unknown>; // z.toJSONSchema(schema, { io: 'input' })
  outputSchema?: Record<string, unknown>; // run_scenario: ScenarioResult; run_calibration: CalibrationSummary
}

function jsonSchema(schema: z.ZodType, io: 'input' | 'output'): Record<string, unknown> {
  return z.toJSONSchema(schema, { io }) as Record<string, unknown>;
}

export const TOOL_DEFINITIONS: readonly ToolDefinition[] = [
  {
    name: 'list_cases',
    description:
      'List the case ids offered by the running Physiology_Service. Creates no Session and does not start the service.',
    inputSchema: jsonSchema(ListCasesInput, 'input'),
  },
  {
    name: 'run_scenario',
    description:
      'Run one Scenario of one case Variant on the real Pulse engine through the running Physiology_Service. ' +
      'Creates one Session, applies each planned intervention at its simulated second, samples the vitals every ' +
      'sample_interval_seconds up to max_seconds, and returns per-sample vitals, Vital_Bands, Overall_Status, ' +
      'Status_Sentence, exam findings and the Ending. Deletes the Session afterwards. ' +
      'Engine results for training only, not clinical advice.',
    inputSchema: jsonSchema(RunScenarioInput, 'input'),
    outputSchema: jsonSchema(ScenarioResultSchema, 'output'),
  },
  {
    name: 'run_calibration',
    description:
      'Run the four calibration Scenarios for every Variant of a case (eight for adult-tension-pneumothorax) and ' +
      'return the Calibration_Record in markdown. Writes the record under docs/calibration/ only when write is true. ' +
      'Can take many minutes. Engine results for draft case values, not clinical advice.',
    inputSchema: jsonSchema(RunCalibrationInput, 'input'),
    outputSchema: jsonSchema(CalibrationSummarySchema, 'output'),
  },
];

// ---------------------------------------------------------------------------
// Handler types
// ---------------------------------------------------------------------------

export interface ToolResult {
  content: { type: 'text'; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}
export interface HandlerOutcome {
  result: ToolResult;
  errorKind?: EngineErrorKind;
  calibrated?: boolean;
}
export interface ToolCallContext {
  signal: AbortSignal;
  reportProgress?: (p: { progress: number; total: number; message: string }) => void;
}

export interface EngineDeps extends RunnerDeps {
  sessionCap: number;
  repoRoot: string;
  readCaseFile(caseId: string): Promise<string>; // `${repoRoot}/cases/${caseId}.yaml`; caseId is kebab-checked
  gitInfo(): Promise<GitInfo>;
  today(): string;
  recordFs: RecordFs;
}

export interface EngineTools {
  list_cases(args: unknown, ctx: ToolCallContext): Promise<HandlerOutcome>;
  run_scenario(args: unknown, ctx: ToolCallContext): Promise<HandlerOutcome>;
  run_calibration(args: unknown, ctx: ToolCallContext): Promise<HandlerOutcome>;
}

// ---------------------------------------------------------------------------
// Validation (3.2)
// ---------------------------------------------------------------------------

function pathText(path: readonly PropertyKey[]): string {
  if (path.length === 0) return 'arguments';
  let out = '';
  for (const key of path) {
    if (typeof key === 'number') out += `[${key}]`;
    else out += out === '' ? String(key) : `.${String(key)}`;
  }
  return out;
}

/** "Invalid input: max_seconds: must be <= 3600; interventions[0].at_seconds: must be <= max_seconds" (3.2). */
export function formatIssues(issues: readonly { path: readonly PropertyKey[]; message: string }[]): string {
  const lines: string[] = [];
  for (const issue of issues) {
    const line = `${pathText(issue.path)}: ${issue.message}`;
    if (!lines.includes(line)) lines.push(line);
  }
  return `Invalid input: ${lines.join('; ')}`;
}

/** zod issues as field issues; an unknown key becomes one issue at its own path. */
function issuesOf(error: z.ZodError): Issue[] {
  return error.issues.flatMap((issue): Issue[] =>
    issue.code === 'unrecognized_keys'
      ? issue.keys.map((key) => ({ path: [...issue.path, key], message: 'is not a known field' }))
      : [{ path: issue.path, message: issue.message }],
  );
}

function parseArgs<S extends z.ZodType>(schema: S, args: unknown, extra?: (raw: unknown) => Issue[]): z.output<S> {
  const raw = args === undefined ? {} : args;
  const parsed = schema.safeParse(raw);
  if (parsed.success) return parsed.data;
  throw new EngineError('input', formatIssues([...issuesOf(parsed.error), ...(extra?.(raw) ?? [])]));
}

// ---------------------------------------------------------------------------
// Requests built from parsed inputs (Property 3)
// ---------------------------------------------------------------------------

/** Parsed RunScenarioInput to ScenarioRequest: caseId, variantId, plan (interventions mapped to
 *  { interventionId, atSeconds } in order), maxSeconds, sampleIntervalSeconds, stopAtEnding,
 *  name "<variant_id>" (Property 3). */
export function toScenarioRequest(input: z.output<typeof RunScenarioInput>): ScenarioRequest {
  return {
    caseId: input.case_id,
    variantId: input.variant_id,
    plan: input.interventions.map((p) => ({ interventionId: p.intervention_id, atSeconds: p.at_seconds })),
    maxSeconds: input.max_seconds,
    sampleIntervalSeconds: input.sample_interval_seconds,
    stopAtEnding: input.stop_at_ending,
    name: input.variant_id,
  };
}

/** Parsed RunCalibrationInput to CalibrationInput; `maxSeconds` only when given (Property 3). */
export function toCalibrationInput(input: z.output<typeof RunCalibrationInput>): CalibrationInput {
  const out: CalibrationInput = {
    caseId: input.case_id,
    decompressAtSeconds: input.decompress_at_seconds,
    earlyDecompressAtSeconds: input.early_decompress_at_seconds,
    write: input.write,
  };
  if (input.max_seconds !== undefined) out.maxSeconds = input.max_seconds;
  return out;
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function textResult(text: string, structuredContent?: Record<string, unknown>): ToolResult {
  const result: ToolResult = { content: [{ type: 'text', text }] };
  if (structuredContent !== undefined) result.structuredContent = structuredContent;
  return result;
}

function notDeletedLine(ids: readonly string[]): string {
  return `Sessions not deleted: ${ids.join(', ')}`;
}

/** One error item with the message (1.6, 1.7, 3.2); Sessions that were not deleted are named on a second line (6.4). */
function errorOutcome(err: unknown, undeleted: readonly string[] = []): HandlerOutcome {
  const engine = err instanceof EngineError;
  const message = engine ? err.message : `Internal error: ${messageOf(err)}`;
  const text = undeleted.length > 0 ? `${message}\n${notDeletedLine(undeleted)}` : message;
  return {
    result: { content: [{ type: 'text', text }], isError: true },
    errorKind: engine ? err.kind : 'internal',
  };
}

// ---------------------------------------------------------------------------
// Progress notifications (8.13)
// ---------------------------------------------------------------------------

interface ProgressTracker {
  hooks: ScenarioHooks;
  /** The shared slots, wrapped so that each released slot counts as one completed Scenario. */
  slots: SessionSlots;
  stop(): void;
}

/**
 * Every PROGRESS_INTERVAL_MS of clock time while the call runs, when the call has a reporter:
 * `progress` is the number of kept samples across the call's Scenarios plus 0.001 for each tick in
 * which that number did not change, so it increases on every notification; `total` is the
 * Scenarios' Max_Time plus one each; `message` is "<k> of <n> scenarios completed".
 */
function trackProgress(deps: EngineDeps, ctx: ToolCallContext, scenarios: number, maxTime: number): ProgressTracker {
  let kept = 0;
  let completed = 0;
  let staleTicks = 0;
  let lastKept = -1;
  let handle: unknown;
  let stopped = false;

  const shared = deps.slots;
  const slots: SessionSlots = {
    get cap() {
      return shared.cap;
    },
    get held() {
      return shared.held;
    },
    get waiting() {
      return shared.waiting;
    },
    async acquire(signal) {
      const release = await shared.acquire(signal);
      let done = false;
      return () => {
        if (!done) {
          done = true;
          completed += 1;
        }
        release();
      };
    },
  };

  const report = ctx.reportProgress;
  const total = scenarios * (maxTime + 1);
  const tick = (): void => {
    if (stopped || report === undefined) return;
    if (kept === lastKept) staleTicks += 1;
    lastKept = kept;
    try {
      report({ progress: kept + staleTicks / 1000, total, message: `${completed} of ${scenarios} scenarios completed` });
    } catch (err) {
      deps.log(`Could not send a progress notification: ${messageOf(err)}`);
    }
    handle = deps.clock.setTimeout(tick, PROGRESS_INTERVAL_MS);
  };
  if (report !== undefined) handle = deps.clock.setTimeout(tick, PROGRESS_INTERVAL_MS);

  return {
    hooks: { onSampleKept: () => void (kept += 1) },
    slots,
    stop() {
      stopped = true;
      if (handle !== undefined) deps.clock.clearTimeout(handle);
    },
  };
}

// ---------------------------------------------------------------------------
// Handlers (design "Per-call flow of the tools")
// ---------------------------------------------------------------------------

function errorCode(err: unknown): string | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const code = (err as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

/** 8.3, 8.5: the case file's facts, before any request (D27). */
async function caseFileFacts(deps: EngineDeps, caseId: string): Promise<CaseFileFacts> {
  let text: string;
  try {
    text = await deps.readCaseFile(caseId);
  } catch (err) {
    if (err instanceof EngineError) throw err;
    if (errorCode(err) === 'ENOENT') throw new EngineError('case', `Case file cases/${caseId}.yaml not found`);
    throw new EngineError('case', `Could not read cases/${caseId}.yaml: ${errorCode(err) ?? messageOf(err)}`);
  }
  return readCaseFileFacts(text, caseId);
}

/** GitInfo for the Record_Header; a failure gives "unknown" and does not fail the call (D24). */
async function gitFacts(deps: EngineDeps): Promise<GitInfo> {
  try {
    return await deps.gitInfo();
  } catch (err) {
    deps.log(`Could not read the Git facts; the Record_Header says unknown: ${messageOf(err)}`);
    return { ...UNKNOWN_GIT };
  }
}

export function createEngineTools(deps: EngineDeps): EngineTools {
  const { client } = deps;

  async function listCases(args: unknown, ctx: ToolCallContext): Promise<HandlerOutcome> {
    try {
      parseArgs(ListCasesInput, args); // 2.2: no argument
      await client.health(ctx.signal); // 1.5
      const caseIds = await client.listCases(ctx.signal); // 2.1: service order
      return { result: textResult(JSON.stringify(caseIds), { case_ids: caseIds }) };
    } catch (err) {
      return errorOutcome(err);
    }
  }

  async function runScenarioTool(args: unknown, ctx: ToolCallContext): Promise<HandlerOutcome> {
    let progress: ProgressTracker | undefined;
    try {
      const input = parseArgs(RunScenarioInput, args, atSecondsIssues); // 3.1, 3.2
      await client.health(ctx.signal); // 1.5
      progress = trackProgress(deps, ctx, 1, input.max_seconds);
      const result = await runScenario(toScenarioRequest(input), { ...deps, slots: progress.slots }, ctx.signal, progress.hooks);
      progress.stop();
      // 5.7: the same JSON as structured content and as text.
      return {
        result: textResult(JSON.stringify(result, null, 2), result as unknown as Record<string, unknown>),
      };
    } catch (err) {
      return errorOutcome(err, undeletedSessionsOf(err));
    } finally {
      progress?.stop();
    }
  }

  async function runCalibrationTool(args: unknown, ctx: ToolCallContext): Promise<HandlerOutcome> {
    let progress: ProgressTracker | undefined;
    try {
      const input = toCalibrationInput(parseArgs(RunCalibrationInput, args)); // 8.1, 3.2
      // Local preflight before the Health_Check (D27, 8.5).
      const facts = await caseFileFacts(deps, input.caseId);
      const { maxTime, limit } = preflightCalibration(input, facts);
      await client.health(ctx.signal); // 1.5
      // GitInfo before the Scenarios, so a Git failure costs no engine time.
      const git = await gitFacts(deps);

      const scenarios = facts.variantIds.length * SCENARIO_KINDS.length;
      progress = trackProgress(deps, ctx, scenarios, maxTime);
      const results = await runCalibration(input, facts, { ...deps, slots: progress.slots }, ctx.signal, progress.hooks);
      progress.stop();

      const evaluation = evaluateCalibration(input, facts, limit, results);
      const header: RecordHeader = {
        caseId: input.caseId,
        date: deps.today(),
        git,
        serviceUrl: deps.serviceUrl,
        sessionCap: deps.sessionCap,
        demoTime: input.decompressAtSeconds,
        earlyTime: input.earlyDecompressAtSeconds,
      };
      const record = renderCalibrationRecord(header, evaluation);

      const undeleted: string[] = [];
      for (const byKind of results.values()) {
        for (const kind of SCENARIO_KINDS) undeleted.push(...(byKind[kind]?.undeleted_sessions ?? []));
      }

      const summary: CalibrationSummary = {
        case_id: input.caseId,
        calibrated: evaluation.calibrated,
        failing_scenarios: evaluation.failing.map((f) => f.scenario),
        requirement_4_18_flagged: evaluation.requirement418Flagged,
      };
      const extra: string[] = [];
      if (input.write) {
        // 10.2 to 10.6; with write false no RecordFs call is made (10.1).
        const written = await writeCalibrationRecord({
          repoRoot: deps.repoRoot,
          fs: deps.recordFs,
          caseId: input.caseId,
          date: header.date,
          shortSha: git.shortSha,
          record,
          calibrated: evaluation.calibrated,
        });
        summary.record_path = written.recordPath;
        summary.index_path = written.indexPath;
        extra.push(`Written: ${written.recordPath}, ${written.indexPath}`);
      }
      if (undeleted.length > 0) {
        summary.undeleted_sessions = undeleted;
        extra.push(notDeletedLine(undeleted));
      }

      let text = record;
      for (const line of extra) text += `${text.endsWith('\n') ? '\n' : '\n\n'}${line}\n`;
      return {
        result: textResult(text, summary as unknown as Record<string, unknown>),
        calibrated: evaluation.calibrated,
      };
    } catch (err) {
      // runCalibration's "Scenario <name> failed" error is a new EngineError, so it carries no
      // undeleted ids; the runner has already logged each one, and they stay in the registry (6.3, 6.4).
      return errorOutcome(err, undeletedSessionsOf(err));
    } finally {
      progress?.stop();
    }
  }

  return {
    list_cases: listCases,
    run_scenario: runScenarioTool,
    run_calibration: runCalibrationTool,
  };
}

// ---------------------------------------------------------------------------
// Engine_CLI parser and exit code (11.1, 11.4, 11.5, 11.6, O6)
// ---------------------------------------------------------------------------

/** Pure CLI parser (11.1, 11.5, 11.6); drops one leading "--" (O6). Numbers that are not /^\d+$/ are
 *  passed through as strings so the tool schema names the field. */
export type CliParse =
  | {
      ok: true;
      url?: string;
      maxSessions?: string;
      tool: ToolName;
      args: Record<string, unknown>;
    }
  | { ok: false; message: string };

export const CLI_USAGE = [
  'Usage: vite-node --config vitest.config.ts scripts/engineCli.ts -- [--url URL] [--max-sessions N] <command> [flags]',
  '',
  '  list-cases',
  '  run-scenario --case ID --variant ID --max-seconds N [--intervention ID@SECONDS]...',
  '               [--interval N] [--stop-at-ending]',
  '  calibrate    --case ID [--decompress-at N] [--early-decompress-at N] [--max-seconds N] [--write]',
  '',
  'Exit codes: 0 success; 1 error; 2 invalid arguments; 3 calibrate finished with "NOT calibrated".',
].join('\n');

const COMMANDS: Readonly<Record<string, ToolName>> = {
  'list-cases': 'list_cases',
  'run-scenario': 'run_scenario',
  calibrate: 'run_calibration',
};

type FlagKind = 'string' | 'number' | 'boolean' | 'intervention';
interface FlagSpec {
  key: string;
  kind: FlagKind;
}

const COMMAND_FLAGS: Readonly<Record<ToolName, Readonly<Record<string, FlagSpec>>>> = {
  list_cases: {},
  run_scenario: {
    '--case': { key: 'case_id', kind: 'string' },
    '--variant': { key: 'variant_id', kind: 'string' },
    '--intervention': { key: 'interventions', kind: 'intervention' },
    '--max-seconds': { key: 'max_seconds', kind: 'number' },
    '--interval': { key: 'sample_interval_seconds', kind: 'number' },
    '--stop-at-ending': { key: 'stop_at_ending', kind: 'boolean' },
  },
  run_calibration: {
    '--case': { key: 'case_id', kind: 'string' },
    '--decompress-at': { key: 'decompress_at_seconds', kind: 'number' },
    '--early-decompress-at': { key: 'early_decompress_at_seconds', kind: 'number' },
    '--max-seconds': { key: 'max_seconds', kind: 'number' },
    '--write': { key: 'write', kind: 'boolean' },
  },
};

/** A whole number for /^\d+$/, else the text itself, so the schema names the field. */
function cliNumber(text: string): number | string {
  return /^\d+$/.test(text) ? Number(text) : text;
}

export function parseCliArgs(argv: readonly string[]): CliParse {
  const tokens = argv[0] === '--' ? argv.slice(1) : [...argv];
  const fail = (message: string): CliParse => ({ ok: false, message });
  let tool: ToolName | undefined;
  let command = '';
  let url: string | undefined;
  let maxSessions: string | undefined;
  const args: Record<string, unknown> = {};
  const seen = new Set<string>();

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (!token.startsWith('--')) {
      if (tool !== undefined) return fail(`Unexpected argument "${token}"`);
      const named = Object.prototype.hasOwnProperty.call(COMMANDS, token) ? COMMANDS[token] : undefined;
      if (named === undefined) return fail(`Unknown command "${token}"`);
      tool = named;
      command = token;
      continue;
    }

    const eq = token.indexOf('=');
    const name = eq >= 0 ? token.slice(0, eq) : token;
    const inline = eq >= 0 ? token.slice(eq + 1) : undefined;
    const value = (): string | null => {
      if (inline !== undefined) return inline;
      const next = tokens[i + 1];
      if (next === undefined || next.startsWith('--')) return null;
      i += 1;
      return next;
    };
    const once = (): CliParse | null => {
      if (seen.has(name)) return fail(`Option ${name} is given more than once`);
      seen.add(name);
      return null;
    };

    if (name === '--url' || name === '--max-sessions') {
      const repeated = once();
      if (repeated) return repeated;
      const v = value();
      if (v === null) return fail(`Option ${name} needs a value`);
      if (name === '--url') url = v;
      else maxSessions = v;
      continue;
    }

    if (tool === undefined) return fail(`Option ${name} comes before the command, or is unknown`);
    const spec = COMMAND_FLAGS[tool][name];
    if (spec === undefined) return fail(`Unknown option ${name} for ${command}`);

    if (spec.kind === 'boolean') {
      if (inline !== undefined) return fail(`Option ${name} takes no value`);
      const repeated = once();
      if (repeated) return repeated;
      args[spec.key] = true;
      continue;
    }

    const v = value();
    if (v === null) return fail(`Option ${name} needs a value`);
    if (spec.kind === 'intervention') {
      const parts = v.split('@');
      if (parts.length !== 2) return fail(`Option --intervention "${v}" must have the form <intervention_id>@<seconds>`);
      const list = (args[spec.key] as unknown[] | undefined) ?? [];
      list.push({ intervention_id: parts[0], at_seconds: cliNumber(parts[1]) });
      args[spec.key] = list;
      continue;
    }
    const repeated = once();
    if (repeated) return repeated;
    args[spec.key] = spec.kind === 'number' ? cliNumber(v) : v;
  }

  if (tool === undefined) return fail('No command given');
  const parsed: CliParse = { ok: true, tool, args };
  if (url !== undefined) parsed.url = url;
  if (maxSessions !== undefined) parsed.maxSessions = maxSessions;
  return parsed;
}

/** 11.4: 2 for usage, 'input' or 'config' errors; 1 for any other isError; 3 for run_calibration with
 *  calibrated false; else 0. A signal-terminated run exits 1 through installShutdown. */
export function cliExitCode(tool: ToolName, outcome: HandlerOutcome | { usage: true }): 0 | 1 | 2 | 3 {
  if ('usage' in outcome) return 2;
  if (outcome.result.isError) {
    return outcome.errorKind === 'input' || outcome.errorKind === 'config' ? 2 : 1;
  }
  if (tool === 'run_calibration' && outcome.calibrated === false) return 3;
  return 0;
}
