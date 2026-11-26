/**
 * Example tests of the Scenario_Runner (engine-mcp task 3.1): Requirement 17.1 and 17.2, the start
 * order of 4.1, the result fields of 5.1 to 5.6, and Properties 7 and 8.
 *
 * Every test runs on the Fake_Service and the fake clock: no socket, no port, no Physiology_Service,
 * no Pulse_Engine and no real time (17.7). Vitals are synthetic formulas. Where a test needs values
 * on one side of a Rescue_Condition or Lost_Condition, it derives them from the case fixture's own
 * conditions plus the fixture's per-vital test offsets; no clinical value is written here.
 */
import { describe, expect, it } from 'vitest';
import { CASE_LEFT, CASE_RIGHT, VITAL_OFFSETS } from '@/test/caseFixtures';
import { createFakeClock, type FakeClock } from '@/test/fakeClock';
import {
  DEFAULT_FAKE_CASES,
  DEFAULT_FAKE_VITALS,
  SCRIPTED_CLOSE_CODE,
  SCRIPTED_CLOSE_REASON,
  SCRIPTED_ERROR_MESSAGE,
  createFakeService,
  type FakeCase,
  type FakeService,
  type FakeServiceOptions,
} from '@/test/fakePhysiologyService';
import type { CaseData, Intervention, PlaySection, VitalCondition, VitalSigns } from '@/types';
import { bandsOf, examRows, overallStatusOf, type MarkSample } from './calibration';
import {
  EngineError,
  createPhysiologyClient,
  type SocketFactory,
  type VitalsSocket,
} from './engineClient';
import {
  APPROACH_WINDOW_S,
  FIRST_SAMPLE_TIMEOUT_MS,
  STALL_TIMEOUT_MS,
  buildScenarioResult,
  runScenario,
  undeletedSessionsOf,
  validatePlan,
  type RunnerDeps,
  type ScenarioRequest,
  type ScenarioResult,
} from './engineRunner';
import { createSessionRegistry, createSessionSlots } from './engineSlots';
import { ScenarioResultSchema } from './engineTools';
import { conditionHolds } from './endingEvaluator';
import { examButtons } from './examFinding';
import { buildInterventionEntry } from './interventionRecord';
import { interventionSide } from './playCase';
import { DECOMPRESSION_ACTION, affectedInsult } from './sides';
import { SPEECH_HOLD_SECONDS } from './speechSelector';
import { selectStatus } from './statusSelector';
import { thresholdsFor } from './vitalBands';
import { VITAL_FIELD, VITAL_NAMES } from './vitals';

// ---------------------------------------------------------------------------
// Values taken from the case fixture
// ---------------------------------------------------------------------------

function defined<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`case fixture has no ${what}`);
  return value;
}

const SERVICE_URL = 'http://fake-physiology.test:8123';
const CASE_ID = CASE_LEFT.id;
const PLAY: PlaySection = defined(CASE_LEFT.play, 'Play_Section');
const RESCUE = PLAY.endings.rescued;
const HOLD = RESCUE.holdSeconds;
const LOST_GROUP = defined(PLAY.endings.lost.groups?.[0], 'Lost_Condition group');
const INSULT_TIME = defined(affectedInsult(CASE_LEFT.timeline.scheduledInsults), 'pneumothorax insult').timeSeconds;

function decompression(rc: CaseData, side: 'Left' | 'Right'): Intervention {
  return defined(
    rc.interventions.find((i) => i.action === DECOMPRESSION_ACTION && interventionSide(i) === side),
    `${side} Decompression`,
  );
}
const LEFT = decompression(CASE_LEFT, 'Left');
const RIGHT = decompression(CASE_LEFT, 'Right');

/** Values that meet every condition: the bound for <= and >=, the bound moved by the test offset for < and >. */
function meeting(conditions: readonly VitalCondition[]): Partial<VitalSigns> {
  const out: Record<string, number> = {};
  for (const c of conditions) {
    const off = VITAL_OFFSETS[c.vital];
    const value = c.op === '>' ? c.value + off : c.op === '<' ? c.value - off : c.value;
    out[VITAL_FIELD[c.vital]] = value;
  }
  return out as Partial<VitalSigns>;
}

const HEALTHY = meeting(RESCUE.conditions);
const FAILING = meeting(LOST_GROUP.conditions);
type VitalsFormula = NonNullable<FakeServiceOptions['vitals']>;
/** Rescue conditions hold; the tidal volume follows the time so samples differ (synthetic). */
const healthy: VitalsFormula = (_variant, t, applied) => ({ ...HEALTHY, tidal_volume: 100 + t + applied.length });
/** The first Lost_Condition group holds. */
const failing: VitalsFormula = (_variant, t) => ({ ...FAILING, tidal_volume: 100 + t });

const withDefaults = (v: Partial<VitalSigns>): Partial<VitalSigns> => ({ ...DEFAULT_FAKE_VITALS, ...v });

function variantCase(rc: CaseData): FakeCase {
  return { variants: ['left'], resolve: () => rc };
}
const NO_EXAM: CaseData = structuredClone(CASE_LEFT);
delete (NO_EXAM.play as PlaySection).exam;
const NO_PLAY: CaseData = structuredClone(CASE_LEFT);
delete NO_PLAY.play;
/** A Resolved_Case whose Play_Section lacks `status`: the run works, building the result throws. */
const NO_STATUS: CaseData = structuredClone(CASE_LEFT);
delete (NO_STATUS.play as Partial<PlaySection>).status;
const EXTRA_CASES: Record<string, FakeCase> = {
  ...DEFAULT_FAKE_CASES,
  'no-exam': variantCase(NO_EXAM),
  'no-play': variantCase(NO_PLAY),
  'no-status': variantCase(NO_STATUS),
};

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const LIMIT_MS = 600_000;

type Transform = (msg: unknown) => unknown[];

/** Socket seam around the Fake_Service socket: each server message becomes the messages `transform` returns. */
function transformed(inner: SocketFactory, transform: Transform): SocketFactory {
  return (url) => {
    const s = inner(url);
    const outer: VitalsSocket = {
      onopen: null,
      onmessage: null,
      onerror: null,
      onclose: null,
      close: (code, reason) => s.close(code, reason),
    };
    s.onopen = (ev) => outer.onopen?.(ev);
    s.onerror = (ev) => outer.onerror?.(ev);
    s.onclose = (ev) => outer.onclose?.(ev);
    s.onmessage = (ev) => {
      for (const m of transform(JSON.parse(String(ev.data)))) outer.onmessage?.({ data: JSON.stringify(m) });
    };
    return outer;
  };
}

interface Script {
  vitals?: VitalsFormula;
  failures?: FakeServiceOptions['failures'];
  cases?: Record<string, FakeCase>;
  transform?: Transform;
  cap?: number;
  req?: Partial<ScenarioRequest>;
}

interface Harness {
  clock: FakeClock;
  fake: FakeService;
  deps: RunnerDeps;
  logs: string[];
}

function harness(script: Script = {}): Harness {
  const clock = createFakeClock();
  const fake = createFakeService({
    clock,
    vitals: script.vitals,
    failures: script.failures,
    cases: script.cases ?? EXTRA_CASES,
  });
  const logs: string[] = [];
  const deps: RunnerDeps = {
    serviceUrl: SERVICE_URL,
    client: createPhysiologyClient({ serviceUrl: SERVICE_URL, fetch: fake.fetch }),
    openSocket: script.transform ? transformed(fake.openSocket, script.transform) : fake.openSocket,
    slots: createSessionSlots(script.cap ?? 4),
    registry: createSessionRegistry(),
    clock,
    log: (line) => logs.push(line),
  };
  return { clock, fake, deps, logs };
}

function request(overrides: Partial<ScenarioRequest> = {}): ScenarioRequest {
  return {
    caseId: CASE_ID,
    variantId: 'left',
    plan: [],
    maxSeconds: 20,
    sampleIntervalSeconds: 10,
    stopAtEnding: false,
    ...overrides,
  };
}

function live(): AbortSignal {
  return new AbortController().signal;
}

async function engineError(p: Promise<unknown>): Promise<EngineError> {
  try {
    await p;
  } catch (err) {
    expect(err).toBeInstanceOf(EngineError);
    return err as EngineError;
  }
  throw new Error('expected an EngineError');
}

/** Runs one Scenario of `script` on a fresh Fake_Service and clock. */
async function runScript(script: Script): Promise<{ h: Harness; result: ScenarioResult }> {
  const h = harness(script);
  const result = await h.clock.runUntilSettled(runScenario(request(script.req), h.deps, live()), LIMIT_MS);
  return { h, result };
}

async function failScript(script: Script): Promise<{ h: Harness; err: EngineError }> {
  const h = harness(script);
  const err = await engineError(h.clock.runUntilSettled(runScenario(request(script.req), h.deps, live()), LIMIT_MS));
  return { h, err };
}

/** `METHOD /path/{id}/...` plus the JSON body, for comparing call logs. */
function callLog(fake: FakeService): string[] {
  return fake.calls.map((c) => {
    const path = c.path
      .replace(/^\/sessions\/[^/]+/, '/sessions/{id}')
      .replace(/\/branches\/[^/]+\//, '/branches/{branch_id}/');
    return c.body === undefined ? `${c.method} ${path}` : `${c.method} ${path} ${JSON.stringify(c.body)}`;
  });
}

const PLAY_4X = 'POST /sessions/{id}/playback {"playing":true,"speed":"4x"}';
const SPEED_1X = 'POST /sessions/{id}/playback {"speed":"1x"}';
const PAUSE = 'POST /sessions/{id}/playback {"playing":false}';
const CHECKPOINTS = 'GET /sessions/{id}/branches/{branch_id}/checkpoints';
const DELETE = 'DELETE /sessions/{id}';
const apply = (i: Intervention): string => `POST /sessions/{id}/interventions {"intervention_id":"${i.id}"}`;

/** The cleanup guarantees of Property 7: the Session is deleted, no Session is live, the slot and registry are empty. */
function expectCleanedUp(h: Harness): void {
  expect(h.fake.deleted).toEqual(['fake-session-1']);
  expect(h.fake.liveSessions()).toEqual([]);
  expect(h.deps.registry.ids()).toEqual([]);
  expect(h.deps.slots.held).toBe(0);
  expect(callLog(h.fake).at(-1)).toBe(DELETE);
}

// ---------------------------------------------------------------------------
// The Fake_Service scripts of the 17.1 tests (also run twice by Property 8)
// ---------------------------------------------------------------------------

const DECOMP_AT = INSULT_TIME + 15;

const SCRIPTS = {
  variantRight: { vitals: healthy, req: { variantId: 'right' } },
  atZero: { vitals: healthy, req: { plan: [{ interventionId: LEFT.id, atSeconds: 0 }] } },
  later: { vitals: healthy, req: { plan: [{ interventionId: LEFT.id, atSeconds: 10 }] } },
  sameTime: {
    vitals: healthy,
    req: {
      plan: [
        { interventionId: LEFT.id, atSeconds: 10 },
        { interventionId: RIGHT.id, atSeconds: 10 },
      ],
    },
  },
  late: {
    vitals: healthy,
    failures: { lateTicksAfterPause: 2 },
    req: {
      plan: [{ interventionId: LEFT.id, atSeconds: DECOMP_AT }],
      sampleIntervalSeconds: 1,
      maxSeconds: DECOMP_AT + 2 + HOLD + 5,
    },
  },
  checkpointList: {
    vitals: healthy,
    req: {
      plan: [
        { interventionId: LEFT.id, atSeconds: 10 },
        { interventionId: LEFT.id, atSeconds: 30 },
      ],
      maxSeconds: 40,
    },
  },
  repeated: {
    vitals: healthy,
    // Every sample arrives twice, the second copy with other values, plus one message without a time.
    transform: (m: unknown) => {
      const sample = m as VitalSigns;
      const out: unknown[] = [sample, { ...sample, heart_rate: sample.heart_rate + 1000 }];
      if (sample.simulation_time === 3) out.push({ note: 'no simulation_time' });
      return out;
    },
  },
  substituted: {
    vitals: healthy,
    transform: (m: unknown) => ((m as VitalSigns).simulation_time === 10 ? [] : [m]),
  },
  stopAtEnding: { vitals: failing, req: { stopAtEnding: true, maxSeconds: 120 } },
  gate: {
    vitals: healthy,
    req: {
      plan: [{ interventionId: LEFT.id, atSeconds: DECOMP_AT }],
      sampleIntervalSeconds: 1,
      maxSeconds: DECOMP_AT + HOLD + 5,
    },
  },
} satisfies Record<string, Script>;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('synthetic vitals derived from the case fixture', () => {
  it('meet every rescue condition and no Lost_Condition group, or the first Lost_Condition group', () => {
    const h = withDefaults(healthy('left', 0, []));
    const f = withDefaults(failing('left', 0, []));
    expect(RESCUE.conditions.every((c) => conditionHolds(c, h))).toBe(true);
    for (const g of PLAY.endings.lost.groups ?? []) expect(g.conditions.every((c) => conditionHolds(c, h))).toBe(false);
    expect(LOST_GROUP.conditions.every((c) => conditionHolds(c, f))).toBe(true);
    // The time-varying field is referenced by no rescue or lost condition.
    const referenced = [...RESCUE.conditions, ...(PLAY.endings.lost.groups ?? []).flatMap((g) => g.conditions)];
    expect(referenced.some((c) => c.vital === 'tidalVolume')).toBe(false);
    expect(DECOMP_AT).toBeGreaterThan(INSULT_TIME);
    expect(RESCUE.requiredInterventions).toEqual([LEFT.id]);
  });
});

describe('validatePlan', () => {
  it('accepts known ids within max_seconds and names an unknown id with the valid ids (3.3)', () => {
    expect(() => validatePlan([{ interventionId: LEFT.id, atSeconds: 5 }], 5, CASE_LEFT)).not.toThrow();
    const valid = CASE_LEFT.interventions.map((i) => i.id).join(', ');
    expect(() => validatePlan([{ interventionId: 'no-such-intervention', atSeconds: 1 }], 5, CASE_LEFT)).toThrow(
      `Unknown intervention_id "no-such-intervention". Valid ids: ${valid}`,
    );
    expect(() => validatePlan([{ interventionId: LEFT.id, atSeconds: 6 }], 5, CASE_LEFT)).toThrow(
      'interventions[0].at_seconds (6) must be a whole number from 0 to max_seconds (5)',
    );
  });
});

describe('runScenario: Requirement 17.1 examples', () => {
  it('creates the Session with the requested variant_id (3.4)', async () => {
    const { h, result } = await runScript(SCRIPTS.variantRight);
    expect(h.fake.calls[0]).toEqual({ method: 'POST', path: '/sessions', body: { case_id: CASE_ID, variant_id: 'right' } });
    expect(result.variant_id).toBe('right');
    expect(result.affected_side).toBe(affectedInsult(CASE_RIGHT.timeline.scheduledInsults)?.side);
  });

  it('deletes the Session and names both values on a variant_id mismatch (3.5)', async () => {
    const { h, err } = await failScript({ failures: { variantMismatch: 'right' } });
    expect(err.kind).toBe('variant');
    expect(err.message).toBe('The Session has variant_id "right", but "left" was requested');
    expect(callLog(h.fake)).toEqual([`POST /sessions {"case_id":"${CASE_ID}","variant_id":"left"}`, DELETE]);
    expectCleanedUp(h);
  });

  it('rejects an unknown intervention_id before the first play request and deletes the Session (3.3)', async () => {
    const { h, err } = await failScript({ req: { plan: [{ interventionId: 'no-such-intervention', atSeconds: 5 }] } });
    expect(err.kind).toBe('plan');
    expect(err.message).toBe(
      `Unknown intervention_id "no-such-intervention". Valid ids: ${CASE_LEFT.interventions.map((i) => i.id).join(', ')}`,
    );
    expect(callLog(h.fake).filter((c) => c.includes('/playback') || c.startsWith('WS'))).toEqual([]);
    expectCleanedUp(h);
  });

  it('applies a Requested_Time 0 item after the sample at 0 and before playing at 4x (4.1)', async () => {
    const { h, result } = await runScript(SCRIPTS.atZero);
    expect(callLog(h.fake).slice(0, 7)).toEqual([
      `POST /sessions {"case_id":"${CASE_ID}","variant_id":"left"}`,
      'GET /sessions/{id}/case',
      'WS /sessions/{id}/vitals',
      CHECKPOINTS,
      apply(LEFT),
      CHECKPOINTS,
      PLAY_4X,
    ]);
    expect(result.interventions).toEqual([{ intervention_id: LEFT.id, requested_time: 0, actual_time: 0, late: false }]);
  });

  it('pauses on the sample at a later Requested_Time, applies, resumes, and slows to 1x just before it (4.3, D26)', async () => {
    const h = harness(SCRIPTS.later);
    const callsWhenKept: number[] = [];
    const result = await h.clock.runUntilSettled(
      runScenario(request(SCRIPTS.later.req), h.deps, live(), { onSampleKept: () => callsWhenKept.push(h.fake.calls.length) }),
      LIMIT_MS,
    );
    const log = callLog(h.fake);
    const slow = log.indexOf(SPEED_1X);
    const pause = log.indexOf(PAUSE);
    expect(slow).toBeGreaterThan(log.indexOf(PLAY_4X));
    // The 1x request follows the sample at T - APPROACH_WINDOW_S.
    expect(callsWhenKept.filter((n) => n <= slow).length - 1).toBe(10 - APPROACH_WINDOW_S);
    expect(log.slice(pause, pause + 5)).toEqual([PAUSE, CHECKPOINTS, apply(LEFT), CHECKPOINTS, PLAY_4X]);
    // The pause follows the sample at the Requested_Time.
    expect(callsWhenKept.filter((n) => n <= pause).length - 1).toBe(10);
    expect(result.interventions).toEqual([{ intervention_id: LEFT.id, requested_time: 10, actual_time: 10, late: false }]);
  });

  it('applies items with the same Requested_Time in plan order within one pause (4.3)', async () => {
    const { h, result } = await runScript(SCRIPTS.sameTime);
    const log = callLog(h.fake);
    const pause = log.indexOf(PAUSE);
    expect(log.filter((c) => c === PAUSE)).toHaveLength(2); // this pause and the cleanup pause
    expect(log.slice(pause, pause + 8)).toEqual([
      PAUSE,
      CHECKPOINTS,
      apply(LEFT),
      CHECKPOINTS,
      CHECKPOINTS,
      apply(RIGHT),
      CHECKPOINTS,
      PLAY_4X,
    ]);
    expect(result.interventions).toEqual([
      { intervention_id: LEFT.id, requested_time: 10, actual_time: 10, late: false },
      { intervention_id: RIGHT.id, requested_time: 10, actual_time: 10, late: false },
    ]);
  });

  it('flags a Late_Intervention and uses its Actual_Time for the gate and the Ending (4.5, 4.6)', async () => {
    const { result } = await runScript(SCRIPTS.late);
    const actual = DECOMP_AT + 2;
    expect(result.interventions).toEqual([
      { intervention_id: LEFT.id, requested_time: DECOMP_AT, actual_time: actual, late: true },
    ]);
    expect(result.rescue_gate_time).toBe(actual);
    expect(result.ending).toEqual({ ending: 'rescued', stayed_none: false, first_time: actual + HOLD });
    // The ticks that ran inside the pause request were kept after the Intervention, not lost.
    expect(result.marks.filter((m) => m.time > DECOMP_AT && m.time <= actual).map((m) => m.substituted)).toEqual([
      false,
      false,
    ]);
  });

  it('reads each Actual_Time from the one new manual Checkpoint, not an older one (4.4, D2)', async () => {
    const { h, result } = await runScript(SCRIPTS.checkpointList);
    expect(result.interventions.map((i) => i.actual_time)).toEqual([10, 30]);
    const log = callLog(h.fake);
    log.forEach((c, i) => {
      if (c === apply(LEFT)) expect([log[i - 1], log[i + 1]]).toEqual([CHECKPOINTS, CHECKPOINTS]);
    });
  });

  it('keeps the first sample per simulation_time and ignores repeats and messages without a time (4.2)', async () => {
    const h = harness(SCRIPTS.repeated);
    let keptCount = 0;
    const result = await h.clock.runUntilSettled(
      runScenario(request(), h.deps, live(), { onSampleKept: () => (keptCount += 1) }),
      LIMIT_MS,
    );
    expect(keptCount).toBe(result.last_time + 1);
    for (const m of result.marks) expect(m.vitals.heart_rate).toBe(withDefaults(healthy('left', m.time, [])).heart_rate);
    expect(h.logs).toContain('Ignored a Vitals_Stream message without simulation_time');
  });

  it('substitutes the next sample for a Sample_Mark without one and flags it (4.8)', async () => {
    const { result } = await runScript(SCRIPTS.substituted);
    expect(result.marks.map((m) => [m.time, m.substituted, m.source_time])).toEqual([
      [0, false, 0],
      [10, true, 11],
      [20, false, 20],
    ]);
    expect(result.marks[1].vitals.tidal_volume).toBe(healthy('left', 11, []).tidal_volume);
  });

  it('stops at the first Mark_Sample whose Ending is not none when stop_at_ending is true (4.7)', async () => {
    const lostAt = Math.ceil(LOST_GROUP.holdSeconds / 10) * 10;
    expect(lostAt).toBeLessThan(120);
    const { result } = await runScript(SCRIPTS.stopAtEnding);
    expect(result.ending).toEqual({ ending: 'lost', stayed_none: false, first_time: lostAt, lost_cause: 1 });
    expect(result.last_time).toBe(lostAt);
    expect(result.marks.at(-1)?.time).toBe(lostAt);
    const { result: full } = await runScript({ ...SCRIPTS.stopAtEnding, req: { stopAtEnding: false, maxSeconds: 120 } });
    expect(full.last_time).toBe(120);
    expect(full.ending).toEqual(result.ending);
  });

  it('applies the Rescue_Gate_Time before the first Mark_Sample at or after the Actual_Time (4.6)', async () => {
    const { result } = await runScript(SCRIPTS.gate);
    expect(result.rescue_gate_time).toBe(DECOMP_AT);
    expect(result.ending).toEqual({ ending: 'rescued', stayed_none: false, first_time: DECOMP_AT + HOLD });
    const firstRescued = result.marks.find((m) => m.ending === 'rescued');
    expect(firstRescued?.time).toBe(DECOMP_AT + HOLD);
    // Without the Required_Intervention the gate stays closed and the Ending stays none.
    const { result: other } = await runScript({
      ...SCRIPTS.gate,
      req: { ...SCRIPTS.gate.req, plan: [{ interventionId: RIGHT.id, atSeconds: DECOMP_AT }] },
    });
    expect(other.rescue_gate_time).toBeNull();
    expect(other.ending).toEqual({ ending: 'none', stayed_none: true, until: DECOMP_AT + HOLD + 5 });
    expect(other.rescue_held_without_gate.length).toBeGreaterThan(0);
  });

  it('applies the entry and its gate change before the Mark_Sample at its Actual_Time, so stop_at_ending stops at mark + Hold_Duration (D3)', async () => {
    const interval = 10;
    // A Sample_Mark at or after DECOMP_AT; the Planned_Intervention is requested and applied exactly there.
    const mark = Math.ceil(DECOMP_AT / interval) * interval;
    const limit = PLAY.endings.lost.timeLimitSeconds;
    if (typeof limit === 'number') expect(mark + interval + HOLD).toBeLessThan(limit);
    // `healthy` meets every rescue condition at every sample, so only the gate decides when the
    // Hold_Duration starts: at `mark` when the gate is applied before that Mark_Sample is evaluated,
    // one interval later when the Mark_Sample is evaluated first.
    const { result } = await runScript({
      vitals: healthy,
      req: {
        plan: [{ interventionId: LEFT.id, atSeconds: mark }],
        sampleIntervalSeconds: interval,
        maxSeconds: mark + HOLD + 3 * interval,
        stopAtEnding: true,
      },
    });
    const actual = result.interventions[0]?.actual_time;
    expect(actual).toBe(mark);
    expect((actual as number) % interval).toBe(0);
    expect(result.interventions).toEqual([
      { intervention_id: LEFT.id, requested_time: mark, actual_time: mark, late: false },
    ]);
    expect(result.rescue_gate_time).toBe(mark);
    expect(result.ending).toEqual({ ending: 'rescued', stayed_none: false, first_time: mark + HOLD });
    // The incremental fold that drives stop_at_ending saw the gate at `mark`, so the run stopped there.
    expect(result.last_time).toBe(mark + HOLD);
    expect(result.marks.at(-1)?.time).toBe(mark + HOLD);
    expect(result.marks.find((m) => m.time === mark)?.ending).toBe('none');
    expect(result.marks.find((m) => m.ending === 'rescued')?.time).toBe(mark + HOLD);
  });
});

describe('runScenario: Scenario_Result fields (5.1 to 5.6)', () => {
  it('reports per Mark_Sample vitals, Vital_Bands, Overall_Status, Status_Sentence, Ending and exam rows', async () => {
    const plan = [{ interventionId: LEFT.id, atSeconds: INSULT_TIME + 5 }];
    const { result } = await runScript({ vitals: healthy, req: { plan, maxSeconds: 60 } });

    expect(result.case_id).toBe(CASE_ID);
    expect(result.variant_id).toBe('left');
    expect(result.affected_side).toBe(affectedInsult(CASE_LEFT.timeline.scheduledInsults)?.side);
    expect(result.sample_interval_seconds).toBe(10);
    expect(result.max_seconds).toBe(60);
    expect(result.stop_at_ending).toBe(false);
    expect(result.last_time).toBe(60);
    expect(result.service_url).toBe(SERVICE_URL);
    expect(result.alarm_thresholds).toEqual(CASE_LEFT.alarms);
    expect(result.play_values).toEqual({
      rescue: { conditions: RESCUE.conditions, hold_seconds: HOLD, required_interventions: [LEFT.id] },
      lost_groups: (PLAY.endings.lost.groups ?? []).map((g) => ({ conditions: g.conditions, hold_seconds: g.holdSeconds })),
      time_limit_seconds: PLAY.endings.lost.timeLimitSeconds ?? null,
    });
    expect(result.undeleted_sessions).toBeUndefined();

    const withThresholds = VITAL_NAMES.filter((v) => thresholdsFor(CASE_LEFT.alarms, v) !== undefined);
    const buttons = examButtons(defined(PLAY.exam, 'Exam_Section')).flat();
    const entries = result.interventions.map((i) =>
      buildInterventionEntry(LEFT, i.actual_time, 'fake-branch-1-1'),
    );
    expect(result.marks.map((m) => m.time)).toEqual([0, 10, 20, 30, 40, 50, 60]);
    for (const row of result.marks) {
      const expected = withDefaults(healthy('left', row.time, row.time >= INSULT_TIME + 5 ? [{ id: LEFT.id, at: 0 }] : []));
      const sample = { ...expected, simulation_time: row.time };
      const { simulation_time: _t, ...vitals } = sample;
      expect(row.vitals).toEqual(vitals);
      expect(Object.keys(row.bands)).toEqual(withThresholds);
      expect(row.bands).toEqual(bandsOf(sample, CASE_LEFT.alarms));
      expect(row.overall_status).toBe(overallStatusOf(sample, CASE_LEFT.alarms));
      expect(row.status_sentence).toBe(selectStatus(sample, CASE_LEFT.alarms, PLAY));
      expect(row.exam.map((e) => [e.action_id, e.side])).toEqual(buttons.map((b) => [b.actionId, b.side]));
      const mark: MarkSample = { mark: row.time, sample, substituted: false };
      expect(row.exam).toEqual(
        examRows(CASE_LEFT, mark, entries).map((r) => ({
          action_id: r.actionId,
          side: r.side,
          sentence: r.sentence,
          abnormal: r.abnormal,
        })),
      );
    }
    expect(result.first_abnormal.map((f) => [f.action_id, f.side])).toEqual(buttons.map((b) => [b.actionId, b.side]));
    for (const f of result.first_abnormal) {
      const first = result.marks.find((m) => m.exam.some((e) => e.action_id === f.action_id && e.side === f.side && e.abnormal));
      expect(f.first_at).toBe(first === undefined ? null : first.time);
    }
    expect(result.status_rules.default_sentence).toBe(PLAY.status.defaultSentence);
    for (const r of result.status_rules.rules) expect(r.sentence).toBe(PLAY.status.rules[r.index].sentence);
  });

  it('gives an empty exam list per Mark_Sample without an Exam_Section (5.3)', async () => {
    const { result } = await runScript({ vitals: healthy, req: { caseId: 'no-exam' } });
    expect(result.marks.length).toBeGreaterThan(0);
    for (const m of result.marks) expect(m.exam).toEqual([]);
    expect(result.first_abnormal).toEqual([]);
  });

  it('reports no Play_Section values, sentences, Ending or gate without a Play_Section', async () => {
    const { result } = await runScript({ vitals: failing, req: { caseId: 'no-play', maxSeconds: 40 } });
    expect(result.play_values).toBeNull();
    expect(result.rescue_gate_time).toBeNull();
    expect(result.ending).toEqual({ ending: 'none', stayed_none: true, until: 40 });
    expect(result.status_rules).toEqual({ rules: [], only_default: false, default_sentence: null });
    for (const m of result.marks) {
      expect(m.status_sentence).toBeNull();
      expect(m.ending).toBe('none');
      expect(m.exam).toEqual([]);
    }
  });

  it('builds the same result from raw samples as the runner did', async () => {
    const { result } = await runScript(SCRIPTS.gate);
    expect(result.marks.every((m) => !m.substituted)).toBe(true);
    const kept = result.marks.map((m) => ({ ...m.vitals, simulation_time: m.time }));
    const entries = result.interventions.map((i) => buildInterventionEntry(LEFT, i.actual_time, 'fake-branch-1-1'));
    const applied = result.interventions.map((i) => ({
      interventionId: i.intervention_id,
      requestedTime: i.requested_time,
      actualTime: i.actual_time,
      late: i.late,
    }));
    const rebuilt = buildScenarioResult(
      { req: request(SCRIPTS.gate.req), rc: CASE_LEFT, kept, entries, applied },
      SERVICE_URL,
    );
    expect(rebuilt).toEqual(result);
  });
});

// ---------------------------------------------------------------------------
// Speech values (patient-speech 9.1, 9.5, 12.8)
// ---------------------------------------------------------------------------

describe('buildScenarioResult: speech values (patient-speech 9.1, 9.5)', () => {
  const INTERVAL = 10;
  const RULES = PLAY.status.rules;
  /** Test-only lines (not case content), so every expected row names its source. */
  const EARLY = ['Test early line one.', 'Test early line two.'];
  const STATUS_LINE = 'Test status line.';
  const RESCUED_LINE = 'Test rescued line.';

  /** The `left` Resolved_Case with a test Speech_Section; rule 4 gets rule 2's sentence, so the
   *  first rule with a sentence (2) differs from the rule that matched (4). */
  const SPEECH_CASE: CaseData = structuredClone(CASE_LEFT);
  const speechPlay = SPEECH_CASE.play as PlaySection;
  speechPlay.status.rules[4].sentence = RULES[2].sentence;
  speechPlay.speech = {
    status: [{ sentence: RULES[2].sentence, lines: [STATUS_LINE] }],
    early: EARLY,
    rescued: [RESCUED_LINE],
  };
  const NO_SPEECH: CaseData = structuredClone(SPEECH_CASE);
  delete (NO_SPEECH.play as PlaySection).speech;

  /** Every vital with Case thresholds in the middle of its normal range. */
  const NORMAL: Partial<VitalSigns> = {};
  for (const v of VITAL_NAMES) {
    const n = thresholdsFor(CASE_LEFT.alarms, v)?.normal;
    if (n) (NORMAL as Record<string, number>)[VITAL_FIELD[v]] = (n.low + n.high) / 2;
  }
  const hr = defined(thresholdsFor(CASE_LEFT.alarms, 'heartRate'), 'heart rate thresholds');
  const HR_CRITICAL = { ...NORMAL, heart_rate: defined(hr.critical?.high, 'critical high') + VITAL_OFFSETS.heartRate };
  const rr = defined(thresholdsFor(CASE_LEFT.alarms, 'respiratoryRate'), 'respiratory rate thresholds');
  const RR_WARNING = {
    ...NORMAL,
    respiratory_rate: (defined(rr.normal, 'normal').high + defined(rr.critical?.high, 'critical high')) / 2,
  };

  const I = INSULT_TIME;
  const ENTRY_AT = I + 25; // synthetic Actual_Time between two marks; the gate applies at mark I + 30
  /** Vitals per mark: normal, then the rule-2 and rule-4 samples, then normal (rescue conditions hold). */
  const vitalsAt = (t: number): Partial<VitalSigns> => (t === I + 10 ? HR_CRITICAL : t === I + 20 ? RR_WARNING : NORMAL);
  const LAST = I + 30 + Math.ceil(HOLD / INTERVAL) * INTERVAL + INTERVAL;

  function build(rc: CaseData): ScenarioResult {
    const kept = Array.from({ length: LAST / INTERVAL + 1 }, (_, k) => ({ ...vitalsAt(k * INTERVAL), simulation_time: k * INTERVAL }));
    return buildScenarioResult(
      {
        req: request({ maxSeconds: LAST, sampleIntervalSeconds: INTERVAL }),
        rc,
        kept,
        entries: [buildInterventionEntry(LEFT, ENTRY_AT, 'fake-branch-1-1')],
        applied: [{ interventionId: LEFT.id, requestedTime: ENTRY_AT, actualTime: ENTRY_AT, late: false }],
      },
      SERVICE_URL,
    );
  }

  it('preconditions: the synthetic vitals select the intended Status_Sentences and Ending inputs', () => {
    expect(I % INTERVAL).toBe(0);
    expect(INTERVAL).toBeGreaterThanOrEqual(SPEECH_HOLD_SECONDS);
    const at = (v: Partial<VitalSigns>) => ({ ...v, simulation_time: 0 });
    expect(selectStatus(at(NORMAL), CASE_LEFT.alarms, PLAY)).toBe(PLAY.status.defaultSentence);
    expect(selectStatus(at(HR_CRITICAL), CASE_LEFT.alarms, PLAY)).toBe(RULES[2].sentence);
    expect(selectStatus(at(RR_WARNING), CASE_LEFT.alarms, PLAY)).toBe(RULES[4].sentence);
    expect(RULES.findIndex((r) => r.sentence === RULES[2].sentence)).toBe(2);
    expect(RULES[4].sentence).not.toBe(RULES[2].sentence);
    expect(RESCUE.conditions.every((c) => conditionHolds(c, at(NORMAL)))).toBe(true);
    expect(LOST_GROUP.conditions.every((c) => conditionHolds(c, at(NORMAL)))).toBe(false);
  });

  it('gives speech and speech_key per Mark_Sample from the Ending after it and the gate before it', () => {
    const result = build(SPEECH_CASE);
    const rescuedAt = I + 30 + Math.ceil(HOLD / INTERVAL) * INTERVAL;
    expect(result.marks.map((m) => [m.time, m.ending])).toEqual(
      result.marks.map((m) => [m.time, m.time >= rescuedAt ? 'rescued' : 'none']),
    );
    const expected = result.marks.map((m): [number, string, string | null] => {
      const t = m.time;
      if (t < I) return [t, 'silent', null]; // before the Earliest_Insult_Time
      if (t === I) return [t, 'early', EARLY[0]]; // default sentence, gate closed
      if (t === I + 10) return [t, 'play.status.rules[2]', STATUS_LINE]; // rule 2 matched
      if (t === I + 20) return [t, 'play.status.rules[2]', STATUS_LINE]; // rule 4 matched, same sentence
      if (t < rescuedAt) return [t, 'silent', null]; // default sentence, gate open since I + 30
      return [t, 'rescued', RESCUED_LINE]; // the Ending overrides the hold
    });
    expect(result.marks.map((m) => [m.time, m.speech_key, m.speech])).toEqual(expected);
    expect(result.has_speech_section).toBe(true);
  });

  it('reports has_speech_section false and silence without a Speech_Section, and no other change (9.5)', () => {
    const withSpeech = build(SPEECH_CASE);
    const without = build(NO_SPEECH);
    expect(without.has_speech_section).toBe(false);
    expect(without.marks.map((m) => [m.speech_key, m.speech])).toEqual(without.marks.map(() => ['silent', null]));

    const noPlay = build(NO_PLAY);
    expect(noPlay.has_speech_section).toBe(false);
    expect(noPlay.marks.map((m) => [m.speech_key, m.speech])).toEqual(noPlay.marks.map(() => ['silent', null]));

    const strip = (r: ScenarioResult) => {
      const { has_speech_section: _h, marks, ...rest } = r;
      return { ...rest, marks: marks.map(({ speech: _s, speech_key: _k, ...row }) => row) };
    };
    expect(strip(withSpeech)).toEqual(strip(without));
    expect(ScenarioResultSchema.parse(withSpeech)).toEqual(withSpeech);
  });
});

// Feature: engine-mcp, Property 7: Every Scenario ends with its Session deleted and the original outcome
describe('Property 7: every Scenario ends with its Session deleted and the original outcome', () => {
  it('success: pauses, deletes and returns the result', async () => {
    const { h, result } = await runScript({ vitals: healthy });
    expect(result.last_time).toBe(20);
    expect(callLog(h.fake).slice(-2)).toEqual([PAUSE, DELETE]);
    expectCleanedUp(h);
  });

  it('stop_at_ending: deletes after stopping early', async () => {
    const { h, result } = await runScript(SCRIPTS.stopAtEnding);
    expect(result.ending.ending).toBe('lost');
    expect(callLog(h.fake).slice(-2)).toEqual([PAUSE, DELETE]);
    expectCleanedUp(h);
  });

  it('an Intervention_API HTTP error: rethrows it after pause and DELETE', async () => {
    const { h, err } = await failScript({
      vitals: healthy,
      failures: {
        http: [{ method: 'POST', pathTemplate: '/sessions/{id}/interventions', status: 422, detail: 'scripted rejection' }],
      },
      req: { plan: [{ interventionId: LEFT.id, atSeconds: 5 }] },
    });
    expect(err.kind).toBe('http');
    expect(err.message).toBe('POST /sessions/{id}/interventions returned HTTP 422: scripted rejection');
    expect(callLog(h.fake).slice(-2)).toEqual([PAUSE, DELETE]);
    expectCleanedUp(h);
  });

  it('a Vitals_Stream close: names the code, reason and last Simulation_Time (4.9)', async () => {
    const { h, err } = await failScript({ vitals: healthy, failures: { socketClose: { atTime: 3 } } });
    expect(err.kind).toBe('stream');
    expect(err.message).toBe(
      `Vitals_Stream closed (code ${SCRIPTED_CLOSE_CODE}: ${SCRIPTED_CLOSE_REASON}) at Simulation_Time 2 s`,
    );
    expect(callLog(h.fake).slice(-2)).toEqual([PAUSE, DELETE]);
    expectCleanedUp(h);
  });

  it('a Vitals_Stream error message: names the error and last Simulation_Time (4.9)', async () => {
    const { h, err } = await failScript({ vitals: healthy, failures: { socketError: { atTime: 3 } } });
    expect(err.kind).toBe('stream');
    expect(err.message).toBe(`Vitals_Stream sent an error at Simulation_Time 2 s: ${SCRIPTED_ERROR_MESSAGE}`);
    expect(callLog(h.fake).slice(-2)).toEqual([PAUSE, DELETE]);
    expectCleanedUp(h);
  });

  it('the Stall_Timeout: fails after 30 s of clock time without a new sample (4.9)', async () => {
    const h = harness({ vitals: healthy, failures: { stallAtTime: 3 } });
    let lastKeptAt = 0;
    const err = await engineError(
      h.clock.runUntilSettled(
        runScenario(request(), h.deps, live(), { onSampleKept: () => (lastKeptAt = h.clock.now()) }),
        LIMIT_MS,
      ),
    );
    expect(err.kind).toBe('stall');
    expect(err.message).toBe('No new sample for 30 s at Simulation_Time 2 s (Stall_Timeout)');
    expect(h.clock.now() - lastKeptAt).toBeGreaterThanOrEqual(STALL_TIMEOUT_MS);
    expect(callLog(h.fake).slice(-2)).toEqual([PAUSE, DELETE]);
    expectCleanedUp(h);
  });

  it('no sample at Simulation_Time 0: fails after the first-sample wait without any play request', async () => {
    const h = harness({ vitals: healthy, failures: { stallAtTime: 0 } });
    const err = await engineError(h.clock.runUntilSettled(runScenario(request(), h.deps, live()), LIMIT_MS));
    expect(err.kind).toBe('stall');
    expect(err.message).toBe('No sample at Simulation_Time 0 within 30 s');
    expect(h.clock.now()).toBeGreaterThanOrEqual(FIRST_SAMPLE_TIMEOUT_MS);
    expect(callLog(h.fake).filter((c) => c.includes('/playback'))).toEqual([]);
    expectCleanedUp(h);
  });

  it('an exception in buildScenarioResult: an internal error after the DELETE', async () => {
    const { h, err } = await failScript({ vitals: healthy, req: { caseId: 'no-status' } });
    expect(err.kind).toBe('internal');
    expect(err.message.startsWith('Internal error while building the Scenario_Result: ')).toBe(true);
    expectCleanedUp(h);
  });

  it('cancellation through the AbortSignal: only DELETE after the abort, within 5 s of clock time (6.2)', async () => {
    const h = harness({ vitals: healthy });
    const controller = new AbortController();
    const p = runScenario(request({ maxSeconds: 100 }), h.deps, controller.signal);
    let settledAt = -1;
    p.catch(() => {
      settledAt = h.clock.now();
    });
    await h.clock.advance(5_000);
    const callsAtAbort = h.fake.calls.length;
    const abortAt = h.clock.now();
    controller.abort();
    const err = await engineError(h.clock.runUntilSettled(p, LIMIT_MS));
    expect(err.kind).toBe('cancelled');
    expect(settledAt - abortAt).toBeGreaterThanOrEqual(0);
    expect(settledAt - abortAt).toBeLessThanOrEqual(5_000);
    expect(callLog(h.fake).slice(callsAtAbort)).toEqual([DELETE]);
    expectCleanedUp(h);
  });

  it('a queued Scenario cancelled before it starts creates no Session (7.4)', async () => {
    const h = harness({ vitals: healthy, cap: 1 });
    const first = runScenario(request({ maxSeconds: 8 }), h.deps, live());
    const controller = new AbortController();
    const queued = runScenario(request(), h.deps, controller.signal);
    await h.clock.advance(500);
    expect(h.deps.slots.waiting).toBe(1);
    controller.abort();
    const err = await engineError(h.clock.runUntilSettled(queued, LIMIT_MS));
    expect(err.kind).toBe('cancelled');
    const result = await h.clock.runUntilSettled(first, LIMIT_MS);
    expect(result.last_time).toBe(8);
    expect(h.fake.calls.filter((c) => c.method === 'POST' && c.path === '/sessions')).toHaveLength(1);
    expectCleanedUp(h);
    expect(h.deps.slots.waiting).toBe(0);
  });

  it('a failed DELETE: reports the session_id in the result, on the log and in the registry (6.4)', async () => {
    const { h, result } = await runScript({ vitals: healthy, failures: { deleteFails: true } });
    expect(result.undeleted_sessions).toEqual(['fake-session-1']);
    expect(h.logs.some((l) => l.startsWith('Session fake-session-1 was not deleted: DELETE /sessions/{id} returned HTTP 500'))).toBe(true);
    expect(h.deps.registry.ids()).toEqual(['fake-session-1']);
    expect(h.deps.slots.held).toBe(0);

    const failed = await failScript({ vitals: healthy, failures: { deleteFails: true, socketClose: { atTime: 3 } } });
    expect(failed.err.kind).toBe('stream');
    expect(undeletedSessionsOf(failed.err)).toEqual(['fake-session-1']);
  });
});

// Feature: engine-mcp, Property 8: Equal Fake_Service scripts give equal Scenario_Results
describe('Property 8: equal Fake_Service scripts give equal Scenario_Results', () => {
  for (const [name, script] of Object.entries(SCRIPTS)) {
    it(`script "${name}" run twice on fresh Fake_Services`, async () => {
      const a = (await runScript(script)).result;
      const b = (await runScript(script)).result;
      expect(b).toEqual(a);
      expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    });
  }
});

// The published run_scenario outputSchema is z.toJSONSchema(ScenarioResultSchema) (engineTools.ts).
describe('ScenarioResultSchema: the outputSchema of run_scenario', () => {
  const scripts: Record<string, Script> = {
    ...SCRIPTS,
    noExam: { vitals: healthy, req: { caseId: 'no-exam' } },
    noPlay: { vitals: failing, req: { caseId: 'no-play', maxSeconds: 40 } },
    deleteFails: { vitals: healthy, failures: { deleteFails: true } },
  };
  for (const [name, script] of Object.entries(scripts)) {
    it(`parses the Scenario_Result of script "${name}" without dropping or changing a field`, async () => {
      const { result } = await runScript(script);
      expect(ScenarioResultSchema.parse(result)).toEqual(result);
    });
  }
});
