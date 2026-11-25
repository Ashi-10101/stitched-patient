/**
 * Scenario_Runner (engine-mcp design, "`engineRunner.ts`", "One Scenario", "Message loop",
 * "Cleanup and cancellation", "Mark rows", "Scenario_Result").
 *
 * One Scenario runs one Session from `POST /sessions` to `DELETE /sessions/{id}`. Every effect
 * comes in through `RunnerDeps`: the HTTP client, the socket factory, the Session_Cap slots, the
 * Session registry, the clock and the log line sink. This module imports no `node:` module, no SDK
 * and no `zod`, and uses no global `fetch`, `WebSocket`, clock or file system (D17).
 *
 * Every decision about Mark_Samples, the Ending, Vital_Bands, Overall_Status, Status_Sentences and
 * Exam_Findings is made by `calibration.ts` and the shipped modules it wraps; this module only
 * orders the calls (D3, D4). The numbers below are tool constants, not clinical values.
 */

import {
  CLEANUP_REQUEST_TIMEOUT_MS,
  EngineError,
  vitalsUrl,
  type EngineClock,
  type PhysiologyClient,
  type SocketFactory,
  type VitalsSocket,
} from './engineClient';
import type { SessionRegistry, SessionSlots } from './engineSlots';
import {
  bandsOf,
  createOutcomeFold,
  examRows,
  firstAbnormal,
  markSamples,
  overallStatusOf,
  scenarioOutcome,
  statusRuleReport,
  type MarkSample,
  type OutcomeFold,
} from './calibration';
import { requiredInterventions, type Ending, type Sample } from './endingEvaluator';
import { buildInterventionEntry } from './interventionRecord';
import { affectedInsult } from './sides';
import { selectStatus } from './statusSelector';
import type { VitalName } from './vitals';
import type {
  AlarmState,
  AlarmThresholds,
  CaseData,
  CheckpointMetadata,
  InterventionRecordEntry,
  PlaybackSpeed,
  PlaySection,
  Side,
  VitalBand,
  VitalCondition,
  VitalSigns,
} from '@/types';

export type { EngineClock } from './engineClient';

// ---------------------------------------------------------------------------
// Constants (tool constants, not clinical values)
// ---------------------------------------------------------------------------

export const STALL_TIMEOUT_MS = 30_000; // Stall_Timeout (glossary)
export const FIRST_SAMPLE_TIMEOUT_MS = 30_000; // wait for the sample at Simulation_Time 0
export const RUN_SPEED: PlaybackSpeed = '4x';
export const APPROACH_SPEED: PlaybackSpeed = '1x';
export const APPROACH_WINDOW_S = 4; // D26

/** The VitalSigns fields a Mark_Sample may carry, in the order of the `VitalSigns` type. */
const VITAL_SIGNS_FIELDS = [
  'heart_rate',
  'respiratory_rate',
  'spo2',
  'mean_arterial_pressure',
  'systolic_pressure',
  'diastolic_pressure',
  'etco2',
  'tidal_volume',
] as const satisfies readonly Exclude<keyof VitalSigns, 'simulation_time'>[];

// ---------------------------------------------------------------------------
// Requests and dependencies
// ---------------------------------------------------------------------------

export interface PlannedIntervention {
  interventionId: string;
  atSeconds: number;
}
export type PlanSource = readonly PlannedIntervention[] | ((rc: CaseData) => readonly PlannedIntervention[]);

export interface ScenarioRequest {
  caseId: string;
  variantId: string;
  plan: PlanSource; // a function lets calibration choose Decompressions from the Resolved_Case (8.4)
  maxSeconds: number;
  sampleIntervalSeconds: number;
  stopAtEnding: boolean;
  /** Runs after GET case and before the first play request; throws EngineError to fail (8.10, 8.11). */
  beforePlay?: (rc: CaseData) => void;
  /** Scenario name for errors and the record, e.g. "left / affected-side". */
  name?: string;
}

export interface RunnerDeps {
  serviceUrl: string;
  client: PhysiologyClient;
  openSocket: SocketFactory;
  slots: SessionSlots;
  registry: SessionRegistry;
  clock: EngineClock;
  log(line: string): void; // stderr in Node
}

export interface ScenarioHooks {
  onSampleKept?(): void;
}

// ---------------------------------------------------------------------------
// Scenario_Result (snake_case JSON, the run_scenario output)
// ---------------------------------------------------------------------------

/** One Exam_Button at one Mark_Sample (5.2). Converted from calibration.ts `ExamRow`. */
export interface ExamRowJson {
  action_id: string;
  side: Side | null;
  sentence: string;
  abnormal: boolean;
}

/** One Mark_Sample (4.8, 5.1, 5.2, 5.3). */
export interface MarkRow {
  time: number; // the Sample_Mark, simulated seconds
  substituted: boolean; // true when no kept sample had simulation_time === time
  source_time: number; // simulation_time of the sample used; equals time unless substituted
  vitals: Partial<Omit<VitalSigns, 'simulation_time'>>; // every field the Vitals_Stream sent
  bands: Partial<Record<VitalName, VitalBand>>; // only vitals with Case thresholds, VITAL_NAMES order
  overall_status: AlarmState;
  status_sentence: string | null; // selectStatus on this sample; null without a Play_Section
  ending: Ending; // the Ending after this Mark_Sample (OutcomeFold.endingAfter)
  exam: ExamRowJson[]; // examButtons order; [] without an Exam_Section (5.3)
}

export interface PlayValuesJson {
  // 9.3, from the Resolved_Case
  rescue: { conditions: VitalCondition[]; hold_seconds: number; required_interventions: string[] };
  lost_groups: { conditions: VitalCondition[]; hold_seconds: number }[];
  time_limit_seconds: number | null;
}
export interface StatusRuleReportJson {
  // 9.8, from statusRuleReport
  rules: {
    index: number /* 0-based in play.status.rules */;
    sentence: string;
    matched_at: number[];
    returned_at: number[];
  }[]; // only rules that matched
  only_default: boolean;
  default_sentence: string | null;
}
export interface FirstAbnormalJson {
  action_id: string;
  side: Side | null;
  first_at: number | null;
} // 9.9

export type GateJson = number | null | 'no-required-interventions'; // null: closed; string: -Infinity
export type EndingTimelineJson = // 5.4
  | { ending: 'none'; stayed_none: true; until: number }
  | { ending: 'rescued'; stayed_none: false; first_time: number }
  | { ending: 'lost'; stayed_none: false; first_time: number; lost_cause: number | 'Time_Limit' };

export interface AppliedInterventionJson {
  // 5.5
  intervention_id: string;
  requested_time: number;
  actual_time: number;
  late: boolean;
}

export interface ScenarioResult {
  case_id: string;
  variant_id: string;
  affected_side: Side | null; // affectedInsult(rc); null without a pneumothorax insult
  sample_interval_seconds: number;
  max_seconds: number;
  stop_at_ending: boolean;
  last_time: number; // last kept simulation_time
  service_url: string; // 5.6
  alarm_thresholds: AlarmThresholds; // of the Resolved_Case, as returned by the Case_API
  play_values: PlayValuesJson | null; // null without a Play_Section
  interventions: AppliedInterventionJson[]; // Intervention_Plan order
  rescue_gate_time: GateJson; // final value
  ending: EndingTimelineJson;
  rescue_held_without_gate: number[]; // marks where every rescue condition held, gate ignored (13.15 basis)
  status_rules: StatusRuleReportJson;
  first_abnormal: FirstAbnormalJson[]; // examButtons order
  marks: MarkRow[]; // Sample_Mark order
  undeleted_sessions?: string[]; // only when a DELETE failed (6.4); never rendered in the Record_Body
}

export interface AppliedIntervention {
  interventionId: string;
  requestedTime: number;
  actualTime: number;
  late: boolean;
}
export interface RawScenario {
  req: ScenarioRequest;
  rc: CaseData;
  kept: readonly Sample[];
  entries: readonly InterventionRecordEntry[];
  /** Intervention_Plan order; only Planned_Interventions that were applied before the Scenario stopped. */
  applied: readonly AppliedIntervention[];
}

// ---------------------------------------------------------------------------
// Plan validation (3.3, and 3.2's at_seconds <= max_seconds for internally built plans)
// ---------------------------------------------------------------------------

/** 3.3 and 3.2's at_seconds <= max_seconds for internally built plans: unknown ids name the id and list valid ids. */
export function validatePlan(plan: readonly PlannedIntervention[], maxSeconds: number, rc: CaseData): void {
  const valid = rc.interventions.map((i) => i.id);
  plan.forEach((p, i) => {
    if (!valid.includes(p.interventionId)) {
      throw new EngineError(
        'plan',
        `Unknown intervention_id "${p.interventionId}". Valid ids: ${valid.join(', ')}`,
      );
    }
    if (!Number.isInteger(p.atSeconds) || p.atSeconds < 0 || p.atSeconds > maxSeconds) {
      throw new EngineError(
        'plan',
        `interventions[${i}].at_seconds (${String(p.atSeconds)}) must be a whole number from 0 to max_seconds (${maxSeconds})`,
      );
    }
  });
}

// ---------------------------------------------------------------------------
// Errors carried next to a rejection
// ---------------------------------------------------------------------------

const UNDELETED = new WeakMap<object, readonly string[]>();

/**
 * Session ids whose DELETE failed while the Scenario that rejected with `err` cleaned up (6.4).
 * The rejection itself is the original error, unchanged; this side table lets a tool handler put
 * the ids into its error result. `[]` when every DELETE succeeded.
 */
export function undeletedSessionsOf(err: unknown): readonly string[] {
  return typeof err === 'object' && err !== null ? (UNDELETED.get(err) ?? []) : [];
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ---------------------------------------------------------------------------
// Scenario_Result (pure)
// ---------------------------------------------------------------------------

function conditionJson(c: VitalCondition): VitalCondition {
  return { vital: c.vital, op: c.op, value: c.value };
}

function playValuesOf(play: PlaySection): PlayValuesJson {
  return {
    rescue: {
      conditions: play.endings.rescued.conditions.map(conditionJson),
      hold_seconds: play.endings.rescued.holdSeconds,
      required_interventions: [...requiredInterventions(play)],
    },
    lost_groups: (play.endings.lost.groups ?? []).map((g) => ({
      conditions: g.conditions.map(conditionJson),
      hold_seconds: g.holdSeconds,
    })),
    time_limit_seconds: play.endings.lost.timeLimitSeconds ?? null,
  };
}

function vitalsOf(sample: Sample): Partial<Omit<VitalSigns, 'simulation_time'>> {
  const out: Partial<Omit<VitalSigns, 'simulation_time'>> = {};
  for (const field of VITAL_SIGNS_FIELDS) {
    const value = sample[field];
    if (typeof value === 'number') out[field] = value;
  }
  return out;
}

function gateJson(gate: number | null): GateJson {
  if (gate === null) return null;
  return gate === -Infinity ? 'no-required-interventions' : gate;
}

/** Pure: Mark_Samples, bands, Overall_Status, Status_Sentence, Exam rows, Ending timeline (5.1 to 5.6). */
export function buildScenarioResult(raw: RawScenario, serviceUrl: string): ScenarioResult {
  const { req, rc, kept, entries, applied } = raw;
  const play = rc.play;
  const alarms = rc.alarms;
  const marks: MarkSample[] = markSamples(kept, req.sampleIntervalSeconds);
  const outcome = scenarioOutcome(rc, marks, entries);

  const perMark = marks.map((m) => ({ mark: m.mark, rows: examRows(rc, m, entries) }));
  const rows: MarkRow[] = marks.map((m, i) => ({
    time: m.mark,
    substituted: m.substituted,
    source_time: m.sample.simulation_time,
    vitals: vitalsOf(m.sample),
    bands: bandsOf(m.sample, alarms),
    overall_status: overallStatusOf(m.sample, alarms),
    status_sentence: play === undefined ? null : selectStatus(m.sample, alarms, play),
    ending: outcome.endingAfter[i],
    exam: perMark[i].rows.map((r) => ({
      action_id: r.actionId,
      side: r.side,
      sentence: r.sentence,
      abnormal: r.abnormal,
    })),
  }));

  let ending: EndingTimelineJson;
  if (outcome.ending === 'rescued' && outcome.endedAt !== null) {
    ending = { ending: 'rescued', stayed_none: false, first_time: outcome.endedAt };
  } else if (outcome.ending === 'lost' && outcome.endedAt !== null) {
    ending = {
      ending: 'lost',
      stayed_none: false,
      first_time: outcome.endedAt,
      lost_cause: outcome.lostCause ?? 'Time_Limit',
    };
  } else {
    ending = { ending: 'none', stayed_none: true, until: marks.length > 0 ? marks[marks.length - 1].mark : 0 };
  }

  let statusRules: StatusRuleReportJson;
  if (play === undefined) {
    statusRules = { rules: [], only_default: false, default_sentence: null };
  } else {
    const report = statusRuleReport(marks, alarms, play);
    statusRules = {
      rules: report.rules.map((r) => ({
        index: r.index,
        sentence: r.sentence,
        matched_at: [...r.matchedAt],
        returned_at: [...r.returnedAt],
      })),
      only_default: report.onlyDefault,
      default_sentence: play.status.defaultSentence,
    };
  }

  return {
    case_id: req.caseId,
    variant_id: req.variantId,
    affected_side: affectedInsult(rc.timeline?.scheduledInsults ?? [])?.side ?? null,
    sample_interval_seconds: req.sampleIntervalSeconds,
    max_seconds: req.maxSeconds,
    stop_at_ending: req.stopAtEnding,
    last_time: kept.length > 0 ? kept[kept.length - 1].simulation_time : 0,
    service_url: serviceUrl,
    alarm_thresholds: alarms,
    play_values: play === undefined ? null : playValuesOf(play),
    interventions: applied.map((a) => ({
      intervention_id: a.interventionId,
      requested_time: a.requestedTime,
      actual_time: a.actualTime,
      late: a.late,
    })),
    rescue_gate_time: play === undefined ? null : gateJson(outcome.finalGate),
    ending,
    rescue_held_without_gate: [...outcome.rescueHeldWithoutGate],
    status_rules: statusRules,
    first_abnormal: firstAbnormal(perMark).map((f) => ({
      action_id: f.actionId,
      side: f.side,
      first_at: f.firstAt,
    })),
    marks: rows,
  };
}

// ---------------------------------------------------------------------------
// Vitals_Stream events
// ---------------------------------------------------------------------------

type StreamEvent =
  | { type: 'message'; data: unknown }
  | { type: 'error' }
  | { type: 'close'; code: number; reason: string };

type ParsedMessage =
  | { kind: 'sample'; sample: Sample }
  | { kind: 'error'; error: string }
  | { kind: 'ignored' };

function parseMessage(data: unknown): ParsedMessage {
  if (typeof data !== 'string') return { kind: 'ignored' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return { kind: 'ignored' };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return { kind: 'ignored' };
  const obj = parsed as Record<string, unknown>;
  if ('error' in obj && obj.error !== undefined && obj.error !== null) {
    return { kind: 'error', error: typeof obj.error === 'string' ? obj.error : JSON.stringify(obj.error) };
  }
  const t = obj.simulation_time;
  if (typeof t !== 'number' || !Number.isFinite(t)) return { kind: 'ignored' };
  const sample: Sample = { simulation_time: t };
  for (const field of VITAL_SIGNS_FIELDS) {
    const value = obj[field];
    if (typeof value === 'number') sample[field] = value;
  }
  return { kind: 'sample', sample };
}

const IGNORED_MESSAGE_LINE = 'Ignored a Vitals_Stream message without simulation_time';

/** A signal that never aborts, for cleanup requests that must run after the caller's abort (6.2). */
function neverAborts(): AbortSignal {
  return new AbortController().signal;
}

// ---------------------------------------------------------------------------
// runScenario
// ---------------------------------------------------------------------------

interface PendingItem {
  index: number; // position in the Intervention_Plan
  interventionId: string;
  atSeconds: number;
}

/** 4.1 to 4.9, 6.1, 6.2, 6.4, 6.5, 7.x. Resolves with the result or rejects with an EngineError;
 *  the Session is deleted in both cases. */
export async function runScenario(
  req: ScenarioRequest,
  deps: RunnerDeps,
  signal: AbortSignal,
  hooks?: ScenarioHooks,
): Promise<ScenarioResult> {
  if (!Number.isInteger(req.maxSeconds) || req.maxSeconds < 1) {
    throw new EngineError('input', `max_seconds must be a whole number of at least 1, got ${String(req.maxSeconds)}`);
  }
  if (!Number.isInteger(req.sampleIntervalSeconds) || req.sampleIntervalSeconds < 1) {
    throw new EngineError(
      'input',
      `sample_interval_seconds must be a whole number of at least 1, got ${String(req.sampleIntervalSeconds)}`,
    );
  }

  const { client, clock } = deps;
  // 7.1, 7.3, 7.4: a Scenario cancelled while queued rejects here and creates no Session.
  const release = await deps.slots.acquire(signal);

  let sessionId: string | null = null;
  let socket: VitalsSocket | null = null;
  let socketClosed = false;
  let playRequested = false;
  const undeleted: string[] = [];

  // --- Vitals_Stream event queue: socket callbacks only append and wake the loop. ---
  const events: StreamEvent[] = [];
  let wake: (() => void) | null = null;
  const enqueue = (ev: StreamEvent): void => {
    events.push(ev);
    wake?.();
  };

  const cancelled = (): EngineError => new EngineError('cancelled', 'Cancelled');

  /** Next event, or 'timeout' after `timeoutMs` of clock time; rejects with kind `cancelled` on abort. */
  function nextEvent(timeoutMs: number): Promise<StreamEvent | 'timeout'> {
    if (signal.aborted) return Promise.reject(cancelled());
    const queued = events.shift();
    if (queued) return Promise.resolve(queued);
    if (timeoutMs <= 0) return Promise.resolve('timeout');
    return new Promise((resolve, reject) => {
      const finish = (): void => {
        wake = null;
        clock.clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
      };
      const onAbort = (): void => {
        finish();
        reject(cancelled());
      };
      const timer = clock.setTimeout(() => {
        finish();
        resolve('timeout');
      }, timeoutMs);
      wake = () => {
        const ev = events.shift();
        if (!ev) return;
        finish();
        resolve(ev);
      };
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  async function body(): Promise<RawScenario> {
    // 1. Session with the requested Variant (3.4, 3.5).
    const meta = await client.createSession(req.caseId, req.variantId, signal);
    sessionId = meta.session_id;
    deps.registry.add(sessionId);
    const id = sessionId;
    const gotVariant = meta.variant_id ?? null;
    if (gotVariant !== req.variantId) {
      throw new EngineError(
        'variant',
        `The Session has variant_id ${JSON.stringify(gotVariant)}, but ${JSON.stringify(req.variantId)} was requested`,
      );
    }
    const branchId = meta.current_branch_id;

    // 2. Resolved_Case, plan check (3.3) and the beforePlay hook (8.10), all before the first play request.
    const rc = await client.getCase(id, signal);
    const plan = typeof req.plan === 'function' ? req.plan(rc) : req.plan;
    validatePlan(plan, req.maxSeconds, rc);
    req.beforePlay?.(rc);

    const fold: OutcomeFold = createOutcomeFold(rc);
    const kept: Sample[] = [];
    const entries: InterventionRecordEntry[] = [];
    const appliedByIndex = new Map<number, AppliedIntervention>();
    const pending: PendingItem[] = plan.map((p, index) => ({
      index,
      interventionId: p.interventionId,
      atSeconds: p.atSeconds,
    }));
    let pushedMarks = 0;
    let playing = false;
    let speed: PlaybackSpeed = RUN_SPEED;
    let lastProgressAt = clock.now();

    const lastTime = (): number => (kept.length > 0 ? kept[kept.length - 1].simulation_time : 0);

    /** D26: 1x while a pending Requested_Time T satisfies T - 4 <= t < T, else 4x. */
    const desiredSpeed = (t: number): PlaybackSpeed =>
      pending.some((p) => p.atSeconds > t && p.atSeconds - APPROACH_WINDOW_S <= t) ? APPROACH_SPEED : RUN_SPEED;

    /** D2: Checkpoint list before and after the Intervention_API call; Actual_Time from the one new manual Checkpoint. */
    async function applyOne(p: PendingItem): Promise<void> {
      const intervention = rc.interventions.find((i) => i.id === p.interventionId);
      if (!intervention) throw new EngineError('plan', `Unknown intervention_id "${p.interventionId}"`);
      const listed = async (): Promise<CheckpointMetadata[]> => {
        const list = await client.listCheckpoints(id, branchId, signal);
        if (!Array.isArray(list)) {
          throw new EngineError(
            'http',
            'GET /sessions/{id}/branches/{branch_id}/checkpoints returned HTTP 200: the response is not a list of Checkpoints',
          );
        }
        return list;
      };
      const before = new Set((await listed()).map((c) => c.checkpoint_id));
      await client.applyIntervention(id, p.interventionId, signal);
      const after = await listed();
      const description = `After ${intervention.label}`;
      const hits = after.filter(
        (c) => !before.has(c.checkpoint_id) && !c.is_automatic && c.description === description,
      );
      if (hits.length !== 1) {
        throw new EngineError(
          'checkpoint',
          `Expected one new "${description}" Checkpoint after applying ${p.interventionId}, found ${hits.length}`,
        );
      }
      const actualTime = hits[0].simulation_time;
      const entry = buildInterventionEntry(intervention, actualTime, branchId);
      entries.push(entry);
      fold.addEntry(entry);
      appliedByIndex.set(p.index, {
        interventionId: p.interventionId,
        requestedTime: p.atSeconds,
        actualTime,
        late: actualTime > p.atSeconds,
      });
    }

    /** Message loop steps 2 to 5 for one kept sample (design "Message loop"). Returns true to stop. */
    async function onKept(sample: Sample): Promise<boolean> {
      kept.push(sample);
      lastProgressAt = clock.now();
      hooks?.onSampleKept?.();
      const t = sample.simulation_time;

      // Step 3 (4.3, 4.4, D2): pause, apply every due item in plan order. Samples that arrive
      // meanwhile wait in the event queue, so their Mark_Samples reach the fold after the entries.
      const due = pending.filter((p) => p.atSeconds <= t);
      if (due.length > 0) {
        if (playing) {
          await client.setPlayback(id, { playing: false }, signal);
          playing = false;
        }
        for (const p of due) {
          await applyOne(p);
          pending.splice(pending.indexOf(p), 1);
        }
      }

      // Step 4 (4.8, 4.6): Mark_Samples for every Sample_Mark up to t, after the entries above.
      const marks = markSamples(kept, req.sampleIntervalSeconds);
      for (; pushedMarks < marks.length; pushedMarks += 1) fold.push(marks[pushedMarks]);

      // Step 5 (4.7).
      if (t >= req.maxSeconds || (req.stopAtEnding && fold.ending !== 'none')) return true;

      // Start (4.1, at 4x), resume after a pause, and the approach speed (D26).
      const wanted = desiredSpeed(t);
      if (!playing) {
        const startSpeed = playRequested ? wanted : RUN_SPEED;
        await client.setPlayback(id, { playing: true, speed: startSpeed }, signal);
        playRequested = true;
        playing = true;
        speed = startSpeed;
        lastProgressAt = clock.now();
      }
      if (wanted !== speed) {
        await client.setPlayback(id, { speed: wanted }, signal);
        speed = wanted;
      }
      return false;
    }

    // 3. Vitals_Stream: open before the first play request and keep it open (D1).
    const s = deps.openSocket(vitalsUrl(deps.serviceUrl, id));
    socket = s;
    s.onmessage = (ev) => enqueue({ type: 'message', data: ev?.data });
    s.onerror = () => enqueue({ type: 'error' });
    s.onclose = (ev) => enqueue({ type: 'close', code: ev?.code ?? 1006, reason: ev?.reason ?? '' });
    const firstDeadline = clock.now() + FIRST_SAMPLE_TIMEOUT_MS;

    for (;;) {
      const waitingFirst = kept.length === 0;
      const deadline = waitingFirst ? firstDeadline : lastProgressAt + STALL_TIMEOUT_MS;
      const ev = await nextEvent(deadline - clock.now());
      const at = `at Simulation_Time ${lastTime()} s`;
      if (ev === 'timeout') {
        throw waitingFirst
          ? new EngineError('stall', `No sample at Simulation_Time 0 within ${FIRST_SAMPLE_TIMEOUT_MS / 1000} s`)
          : new EngineError('stall', `No new sample for ${STALL_TIMEOUT_MS / 1000} s ${at} (Stall_Timeout)`);
      }
      if (ev.type === 'error') throw new EngineError('stream', `Vitals_Stream error ${at}`);
      if (ev.type === 'close') {
        socketClosed = true;
        const reason = ev.reason !== '' ? `: ${ev.reason}` : '';
        const unknown = ev.code === 1008 ? '; the service does not know the Session' : '';
        throw new EngineError('stream', `Vitals_Stream closed (code ${ev.code}${reason}) ${at}${unknown}`);
      }
      const msg = parseMessage(ev.data);
      if (msg.kind === 'error') throw new EngineError('stream', `Vitals_Stream sent an error ${at}: ${msg.error}`);
      if (msg.kind === 'ignored') {
        deps.log(IGNORED_MESSAGE_LINE);
        continue;
      }
      // 4.2: the first sample per distinct simulation_time; paused re-sends and out-of-order messages are dropped.
      if (kept.length > 0 && msg.sample.simulation_time <= lastTime()) continue;
      if (await onKept(msg.sample)) break;
    }

    const applied = [...appliedByIndex.entries()].sort((a, b) => a[0] - b[0]).map(([, a]) => a);
    return { req, rc, kept, entries, applied };
  }

  /** 6.1, 6.2, 6.4, 6.5: pause (not after cancel), close, DELETE with the 4 s timeout. Never throws. */
  async function cleanup(): Promise<void> {
    const quiet = neverAborts();
    const id = sessionId;
    if (id !== null && playRequested && !signal.aborted) {
      try {
        await client.setPlayback(id, { playing: false }, quiet, CLEANUP_REQUEST_TIMEOUT_MS);
      } catch (err) {
        deps.log(`Could not pause the Session during cleanup: ${messageOf(err)}`);
      }
    }
    if (socket !== null) {
      const s = socket;
      s.onmessage = null;
      s.onerror = null;
      s.onclose = null;
      if (!socketClosed) {
        try {
          s.close(1000, 'Scenario ended');
        } catch (err) {
          deps.log(`Could not close the Vitals_Stream: ${messageOf(err)}`);
        }
      }
    }
    if (id !== null) {
      try {
        await client.deleteSession(id, quiet, CLEANUP_REQUEST_TIMEOUT_MS);
        deps.registry.remove(id);
      } catch (err) {
        // The id stays in the registry, so process shutdown retries it once (6.3).
        deps.log(`Session ${id} was not deleted: ${messageOf(err)}`);
        undeleted.push(id);
      }
    }
  }

  let raw: RawScenario | undefined;
  let failure: unknown;
  let failed = false;
  try {
    raw = await body();
  } catch (err) {
    failed = true;
    failure = err;
  }
  try {
    await cleanup();
  } finally {
    release();
  }

  if (failed) {
    if (undeleted.length > 0 && typeof failure === 'object' && failure !== null) {
      UNDELETED.set(failure, [...undeleted]);
    }
    throw failure;
  }

  let result: ScenarioResult;
  try {
    result = buildScenarioResult(raw as RawScenario, deps.serviceUrl);
  } catch (err) {
    const wrapped = new EngineError('internal', `Internal error while building the Scenario_Result: ${messageOf(err)}`);
    if (undeleted.length > 0) UNDELETED.set(wrapped, [...undeleted]);
    throw wrapped;
  }
  if (undeleted.length > 0) result.undeleted_sessions = [...undeleted];
  return result;
}
