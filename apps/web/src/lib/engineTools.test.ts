/**
 * Example tests of the SDK-free tool handlers (engine-mcp task 5.1): the tool definitions (1.1),
 * the Unreachable_Error with only the Health_Check sent (1.6, 17.3), `list_cases` (2.1, 2.2),
 * the `run_scenario` result (5.7), the `run_calibration` record writes (10.1, 10.6), the check
 * order of D27 and the progress notifications (8.13). Property 1 (task 5.2): invalid input fails
 * before any request (1.5, 3.1, 3.2, 8.1).
 *
 * Every test runs on the Fake_Service, the fake clock and in-memory doubles for the case file, the
 * Git facts and the record file system: no socket, no port, no real file system, no
 * Physiology_Service, no Pulse_Engine and no real time (17.7). Expected values come from the case
 * fixture or from synthetic numbers; no clinical value is written here.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CASE_LEFT, CASE_TEXT } from '@/test/caseFixtures';
import { createFakeClock, type FakeClock } from '@/test/fakeClock';
import {
  DEFAULT_FAKE_CASES,
  createFakeService,
  type FakeCase,
  type FakeService,
  type FakeServiceOptions,
} from '@/test/fakePhysiologyService';
import { PBT_PARAMS } from '@/test/pbt';
import type { Intervention } from '@/types';
import type { GitInfo, RecordFs } from './calibrationRecord';
import { HEALTH_TIMEOUT_MS, KEBAB, createPhysiologyClient, unreachableMessage } from './engineClient';
import { SCENARIO_KINDS } from './engineCalibration';
import type { ScenarioResult } from './engineRunner';
import { createSessionRegistry, createSessionSlots } from './engineSlots';
import {
  PROGRESS_INTERVAL_MS,
  RunCalibrationInput,
  RunScenarioInput,
  ScenarioResultSchema,
  TOOL_DEFINITIONS,
  createEngineTools,
  formatIssues,
  type EngineDeps,
  type HandlerOutcome,
  type ToolCallContext,
} from './engineTools';
import { interventionSide } from './playCase';
import { DECOMPRESSION_ACTION, affectedInsult } from './sides';

// ---------------------------------------------------------------------------
// Values taken from the case fixture
// ---------------------------------------------------------------------------

function defined<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`case fixture has no ${what}`);
  return value;
}

const SERVICE_URL = 'http://fake-physiology.test:8123';
const REPO_ROOT = '/repo';
const TODAY = '2026-11-22';
const CASE_ID = CASE_LEFT.id;
const INSULT_TIME = defined(affectedInsult(CASE_LEFT.timeline.scheduledInsults), 'pneumothorax insult').timeSeconds;
const LEFT: Intervention = defined(
  CASE_LEFT.interventions.find((i) => i.action === DECOMPRESSION_ACTION && interventionSide(i) === 'Left'),
  'Left Decompression',
);
const VARIANT_COUNT = defined(DEFAULT_FAKE_CASES[CASE_ID]?.variants, 'variants').length;
const SCENARIO_COUNT = VARIANT_COUNT * SCENARIO_KINDS.length;

/** Short calibration runs: the early Decompression at 0 (before the insult), the demo one after it. */
const CAL_MAX = INSULT_TIME + 30;
const CAL_ARGS = {
  case_id: CASE_ID,
  max_seconds: CAL_MAX,
  decompress_at_seconds: INSULT_TIME + 10,
  early_decompress_at_seconds: 0,
};

const GIT: GitInfo = { shortSha: 'abc1234', casesDirty: false, libDirty: false, has1e71454: true };
const LIMIT_MS = 3_600_000;

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

interface Harness {
  clock: FakeClock;
  fake: FakeService;
  deps: EngineDeps;
  logs: string[];
  files: Map<string, string>;
  fsCalls: string[];
  /** Fake_Service call count when the case file was read, and when the Git facts were read. */
  callsAtRead: number[];
  callsAtGit: number[];
}

function codeError(code: string, path: string): Error {
  return Object.assign(new Error(`${code}: ${path}`), { code });
}

/** In-memory RecordFs that records every call. */
function memoryFs(files: Map<string, string>, calls: string[]): RecordFs {
  return {
    async mkdir(path) {
      calls.push(`mkdir ${path}`);
    },
    async readFile(path) {
      calls.push(`readFile ${path}`);
      const text = files.get(path);
      if (text === undefined) throw codeError('ENOENT', path);
      return text;
    },
    async writeFile(path, data) {
      calls.push(`writeFile ${path}`);
      if (files.has(path)) throw codeError('EEXIST', path);
      files.set(path, data);
    },
    async appendFile(path, data) {
      calls.push(`appendFile ${path}`);
      files.set(path, (files.get(path) ?? '') + data);
    },
  };
}

function harness(
  opts: {
    failures?: FakeServiceOptions['failures'];
    cases?: Record<string, FakeCase>;
    git?: GitInfo | Error;
  } = {},
): Harness {
  const clock = createFakeClock();
  const fake = createFakeService({ clock, cases: opts.cases ?? DEFAULT_FAKE_CASES, failures: opts.failures });
  const logs: string[] = [];
  const files = new Map<string, string>();
  const fsCalls: string[] = [];
  const callsAtRead: number[] = [];
  const callsAtGit: number[] = [];
  const deps: EngineDeps = {
    serviceUrl: SERVICE_URL,
    client: createPhysiologyClient({ serviceUrl: SERVICE_URL, fetch: fake.fetch }),
    openSocket: fake.openSocket,
    slots: createSessionSlots(4),
    registry: createSessionRegistry(),
    clock,
    log: (line) => logs.push(line),
    sessionCap: 4,
    repoRoot: REPO_ROOT,
    async readCaseFile(caseId) {
      callsAtRead.push(fake.calls.length);
      if (caseId === CASE_ID) return CASE_TEXT;
      throw codeError('ENOENT', `${REPO_ROOT}/cases/${caseId}.yaml`);
    },
    async gitInfo() {
      callsAtGit.push(fake.calls.length);
      const git = opts.git ?? GIT;
      if (git instanceof Error) throw git;
      return git;
    },
    today: () => TODAY,
    recordFs: memoryFs(files, fsCalls),
  };
  return { clock, fake, deps, logs, files, fsCalls, callsAtRead, callsAtGit };
}

function ctx(extra: Partial<ToolCallContext> = {}): ToolCallContext {
  return { signal: new AbortController().signal, ...extra };
}

type ToolName = 'list_cases' | 'run_scenario' | 'run_calibration';

async function call(h: Harness, tool: ToolName, args: unknown, c: ToolCallContext = ctx()): Promise<HandlerOutcome> {
  const tools = createEngineTools(h.deps);
  return h.clock.runUntilSettled(tools[tool](args, c), LIMIT_MS);
}

function text(outcome: HandlerOutcome): string {
  expect(outcome.result.content).toHaveLength(1);
  return outcome.result.content[0].text;
}

function calls(fake: FakeService): string[] {
  return fake.calls.map((c) => `${c.method} ${c.path}`);
}

function expectAllDeleted(h: Harness): void {
  const created = h.fake.calls.filter((c) => c.method === 'POST' && c.path === '/sessions').length;
  expect(created).toBeGreaterThan(0);
  expect(h.fake.deleted).toHaveLength(created);
  expect(h.fake.liveSessions()).toEqual([]);
  expect(h.deps.registry.ids()).toEqual([]);
  expect(h.deps.slots.held).toBe(0);
}

const SCENARIO_ARGS = {
  case_id: CASE_ID,
  variant_id: 'left',
  interventions: [{ intervention_id: LEFT.id, at_seconds: 5 }],
  max_seconds: 20,
};

const VALID_ARGS: Record<ToolName, unknown> = {
  list_cases: {},
  run_scenario: SCENARIO_ARGS,
  run_calibration: CAL_ARGS,
};

// ---------------------------------------------------------------------------
// Tool definitions (1.1)
// ---------------------------------------------------------------------------

describe('TOOL_DEFINITIONS', () => {
  it('has exactly the three tools with the published descriptions (1.1)', () => {
    expect(TOOL_DEFINITIONS.map((t) => t.name)).toEqual(['list_cases', 'run_scenario', 'run_calibration']);
    const byName = Object.fromEntries(TOOL_DEFINITIONS.map((t) => [t.name, t]));
    expect(byName.list_cases.description).toBe(
      'List the case ids offered by the running Physiology_Service. Creates no Session and does not start the service.',
    );
    expect(byName.run_scenario.description).toBe(
      'Run one Scenario of one case Variant on the real Pulse engine through the running Physiology_Service. Creates one Session, applies each planned intervention at its simulated second, samples the vitals every sample_interval_seconds up to max_seconds, and returns per-sample vitals, Vital_Bands, Overall_Status, Status_Sentence, exam findings and the Ending. Deletes the Session afterwards. Engine results for training only, not clinical advice.',
    );
    expect(byName.run_calibration.description).toBe(
      'Run the four calibration Scenarios for every Variant of a case (eight for adult-tension-pneumothorax) and return the Calibration_Record in markdown. Writes the record under docs/calibration/ only when write is true. Can take many minutes. Engine results for draft case values, not clinical advice.',
    );
  });

  it('publishes strict object input schemas with the required fields and defaults of 3.1 and 8.1', () => {
    const byName = Object.fromEntries(TOOL_DEFINITIONS.map((t) => [t.name, t.inputSchema as Record<string, any>]));
    for (const schema of Object.values(byName)) {
      expect(schema.type).toBe('object');
      expect(schema.additionalProperties).toBe(false);
    }
    expect(byName.list_cases.properties).toEqual({});
    expect(byName.list_cases.required).toBeUndefined();

    const scenario = byName.run_scenario;
    expect(Object.keys(scenario.properties)).toEqual([
      'case_id',
      'variant_id',
      'interventions',
      'max_seconds',
      'sample_interval_seconds',
      'stop_at_ending',
    ]);
    expect(scenario.required).toEqual(['case_id', 'variant_id', 'max_seconds']);
    expect(scenario.properties.interventions).toMatchObject({ type: 'array', maxItems: 20, default: [] });
    expect(scenario.properties.interventions.items).toMatchObject({
      type: 'object',
      required: ['intervention_id', 'at_seconds'],
      additionalProperties: false,
    });
    expect(scenario.properties.max_seconds).toMatchObject({ type: 'integer', minimum: 1, maximum: 3600 });
    expect(scenario.properties.sample_interval_seconds).toMatchObject({ type: 'integer', minimum: 1, maximum: 60, default: 10 });
    expect(scenario.properties.stop_at_ending).toMatchObject({ type: 'boolean', default: false });
    expect(scenario.properties.case_id).toMatchObject({ type: 'string', pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$' });

    const calibration = byName.run_calibration;
    expect(Object.keys(calibration.properties)).toEqual([
      'case_id',
      'decompress_at_seconds',
      'early_decompress_at_seconds',
      'max_seconds',
      'write',
    ]);
    expect(calibration.required).toEqual(['case_id']);
    expect(calibration.properties.decompress_at_seconds).toMatchObject({ type: 'integer', minimum: 0, default: 150 });
    expect(calibration.properties.early_decompress_at_seconds).toMatchObject({ type: 'integer', minimum: 0, default: 20 });
    expect(calibration.properties.write).toMatchObject({ type: 'boolean', default: false });
  });

  it('publishes object output schemas for run_scenario and run_calibration', () => {
    const byName = Object.fromEntries(TOOL_DEFINITIONS.map((t) => [t.name, t.outputSchema as Record<string, any> | undefined]));
    expect(byName.list_cases).toBeUndefined();
    const scenario = defined(byName.run_scenario, 'run_scenario outputSchema');
    expect(scenario.type).toBe('object');
    expect(scenario.required).toContain('marks');
    expect(scenario.required).not.toContain('undeleted_sessions');
    const calibration = defined(byName.run_calibration, 'run_calibration outputSchema');
    expect(calibration.type).toBe('object');
    expect(calibration.required).toEqual(['case_id', 'calibrated', 'failing_scenarios', 'requirement_4_18_flagged']);
  });
});

describe('formatIssues', () => {
  it('names each field path once, with list indexes in brackets (3.2)', () => {
    expect(
      formatIssues([
        { path: ['max_seconds'], message: 'must be <= 3600' },
        { path: ['interventions', 0, 'at_seconds'], message: 'must be <= max_seconds' },
        { path: ['max_seconds'], message: 'must be <= 3600' },
      ]),
    ).toBe('Invalid input: max_seconds: must be <= 3600; interventions[0].at_seconds: must be <= max_seconds');
    expect(formatIssues([{ path: [], message: 'must be an object' }])).toBe('Invalid input: arguments: must be an object');
  });

  it('is what run_scenario returns for that input, before any request', async () => {
    const h = harness();
    const outcome = await call(h, 'run_scenario', {
      ...SCENARIO_ARGS,
      max_seconds: 4000,
      interventions: [{ intervention_id: LEFT.id, at_seconds: 5000 }],
    });
    expect(outcome.result.isError).toBe(true);
    expect(outcome.errorKind).toBe('input');
    expect(text(outcome)).toBe(
      'Invalid input: max_seconds: must be <= 3600; interventions[0].at_seconds: must be <= max_seconds',
    );
    expect(h.fake.calls).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Unreachable_Error (1.6, 17.3)
// ---------------------------------------------------------------------------

describe('Unreachable_Error', () => {
  for (const tool of ['list_cases', 'run_scenario', 'run_calibration'] as const) {
    it(`${tool}: names the Service_URL and sends only the Health_Check when the service is down (1.6, 17.3)`, async () => {
      const h = harness({ failures: { unreachable: true } });
      const outcome = await call(h, tool, VALID_ARGS[tool]);
      expect(outcome.result.isError).toBe(true);
      expect(outcome.result.structuredContent).toBeUndefined();
      expect(outcome.errorKind).toBe('unreachable');
      expect(text(outcome)).toBe(unreachableMessage(SERVICE_URL));
      expect(text(outcome)).toContain(SERVICE_URL);
      expect(h.fake.calls).toEqual([{ method: 'GET', path: '/' }]);
    });

    it(`${tool}: returns the Unreachable_Error when the Health_Check times out (1.6)`, async () => {
      const h = harness({ failures: { healthDelayMs: HEALTH_TIMEOUT_MS } });
      const outcome = await call(h, tool, VALID_ARGS[tool]);
      expect(outcome.result.isError).toBe(true);
      expect(text(outcome)).toBe(unreachableMessage(SERVICE_URL));
      expect(h.fake.calls).toEqual([{ method: 'GET', path: '/' }]);
    });
  }
});

// ---------------------------------------------------------------------------
// list_cases (2.1, 2.2)
// ---------------------------------------------------------------------------

describe('list_cases', () => {
  it('returns the case ids in service order and creates no Session (2.1, 2.2)', async () => {
    const cases: Record<string, FakeCase> = {
      'zeta-case': DEFAULT_FAKE_CASES[CASE_ID],
      [CASE_ID]: DEFAULT_FAKE_CASES[CASE_ID],
      'alpha-case': DEFAULT_FAKE_CASES[CASE_ID],
    };
    const h = harness({ cases });
    const outcome = await call(h, 'list_cases', {});
    const ids = ['zeta-case', CASE_ID, 'alpha-case'];
    expect(outcome.result.isError).toBeUndefined();
    expect(text(outcome)).toBe(JSON.stringify(ids));
    expect(outcome.result.structuredContent).toEqual({ case_ids: ids });
    expect(calls(h.fake)).toEqual(['GET /', 'GET /cases']);
    expect(h.fake.liveSessions()).toEqual([]);
  });

  it('takes no argument', async () => {
    const h = harness();
    const outcome = await call(h, 'list_cases', { case_id: CASE_ID });
    expect(outcome.result.isError).toBe(true);
    expect(text(outcome)).toBe('Invalid input: case_id: is not a known field');
    expect(h.fake.calls).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// run_scenario (5.7, 1.7)
// ---------------------------------------------------------------------------

describe('run_scenario', () => {
  it('returns the Scenario_Result as structured content and as the same JSON text (5.7)', async () => {
    const h = harness();
    const outcome = await call(h, 'run_scenario', SCENARIO_ARGS);
    expect(outcome.result.isError).toBeUndefined();
    const structured = defined(outcome.result.structuredContent, 'structuredContent');
    expect(text(outcome)).toBe(JSON.stringify(structured, null, 2));
    expect(JSON.parse(text(outcome))).toEqual(structured);
    expect(ScenarioResultSchema.parse(structured)).toEqual(structured);
    expect(structured).toMatchObject({
      has_speech_section: true,
      case_id: CASE_ID,
      variant_id: 'left',
      max_seconds: 20,
      sample_interval_seconds: 10,
      stop_at_ending: false,
      service_url: SERVICE_URL,
      interventions: [{ intervention_id: LEFT.id, requested_time: 5, actual_time: 5, late: false }],
    });
    // D27: the Health_Check first, then the Session with the requested Variant.
    expect(h.fake.calls.slice(0, 2)).toEqual([
      { method: 'GET', path: '/' },
      { method: 'POST', path: '/sessions', body: { case_id: CASE_ID, variant_id: 'left' } },
    ]);
    expectAllDeleted(h);
  });

  it('ScenarioResultSchema accepts and keeps speech, speech_key and has_speech_section (patient-speech 9.1)', async () => {
    const h = harness();
    const outcome = await call(h, 'run_scenario', SCENARIO_ARGS);
    const structured = defined(outcome.result.structuredContent, 'structuredContent') as unknown as ScenarioResult;
    const marks = structured.marks;
    expect(marks.length).toBeGreaterThanOrEqual(2);
    for (const m of marks) expect(m).toHaveProperty('speech_key');
    const spoken: ScenarioResult = {
      ...structured,
      has_speech_section: false,
      marks: [
        { ...marks[0], speech: 'A test line.', speech_key: 'play.status.rules[3]' },
        { ...marks[1], speech: null, speech_key: 'silent' },
        ...marks.slice(2),
      ],
    };
    expect(ScenarioResultSchema.parse(spoken)).toEqual(spoken);
    expect(ScenarioResultSchema.safeParse({ ...spoken, has_speech_section: 'yes' }).success).toBe(false);
    const { has_speech_section: _h, ...noFlag } = spoken;
    expect(ScenarioResultSchema.safeParse(noFlag).success).toBe(false);
    const badRow = (row: Record<string, unknown>) => ({ ...spoken, marks: [row, ...spoken.marks.slice(1)] });
    expect(ScenarioResultSchema.safeParse(badRow({ ...marks[0], speech: 5 })).success).toBe(false);
    const { speech_key: _k, ...noKey } = marks[0];
    expect(ScenarioResultSchema.safeParse(badRow(noKey)).success).toBe(false);
    expectAllDeleted(h);
  });

  it('names the endpoint, HTTP status and service message of an HTTP error (1.7)', async () => {
    const h = harness();
    const outcome = await call(h, 'run_scenario', { ...SCENARIO_ARGS, case_id: 'no-such-case' });
    expect(outcome.result.isError).toBe(true);
    expect(outcome.errorKind).toBe('http');
    expect(text(outcome)).toBe('POST /sessions returned HTTP 404: Case not found: no-such-case');
    expect(calls(h.fake)).toEqual(['GET /', 'POST /sessions']);
  });

  it('names a Session whose DELETE failed in the error result (6.4)', async () => {
    const h = harness({ failures: { deleteFails: true, socketClose: { atTime: 3 } } });
    const outcome = await call(h, 'run_scenario', SCENARIO_ARGS);
    expect(outcome.result.isError).toBe(true);
    expect(outcome.errorKind).toBe('stream');
    const lines = text(outcome).split('\n');
    expect(lines[0].startsWith('Vitals_Stream closed')).toBe(true);
    expect(lines[1]).toBe('Sessions not deleted: fake-session-1');
  });
});

// ---------------------------------------------------------------------------
// run_calibration (10.1, 10.6, D27)
// ---------------------------------------------------------------------------

describe('run_calibration', () => {
  it('with write false: returns the record, makes no RecordFs call, and says unknown when Git fails (10.1, D24)', async () => {
    const h = harness({ git: new Error('git is not installed') });
    const outcome = await call(h, 'run_calibration', CAL_ARGS);
    expect(outcome.result.isError).toBeUndefined();
    expect(h.fsCalls).toEqual([]);
    const record = text(outcome);
    expect(record.startsWith(`# Calibration record: ${CASE_ID}\n`)).toBe(true);
    expect(record).toContain('- Commit: unknown');
    expect(record).toContain('- Files under cases/ differ from the commit: unknown');
    expect(record).toContain(`- Service_URL: ${SERVICE_URL}`);
    expect(record).not.toContain('Written:');
    expect(h.logs.some((l) => l.includes('git is not installed'))).toBe(true);

    const summary = defined(outcome.result.structuredContent, 'structuredContent');
    expect(summary.case_id).toBe(CASE_ID);
    expect(summary.record_path).toBeUndefined();
    expect(summary.index_path).toBeUndefined();
    expect(outcome.calibrated).toBe(summary.calibrated);
    expect(record.includes('Play_Section values NOT calibrated')).toBe(summary.calibrated === false);

    // D27: the case file before any request, the Git facts after the Health_Check and before any Session.
    expect(h.callsAtRead).toEqual([0]);
    expect(h.callsAtGit).toEqual([1]);
    expect(calls(h.fake)[0]).toBe('GET /');
    expect(h.fake.calls.filter((c) => c.method === 'POST' && c.path === '/sessions')).toHaveLength(SCENARIO_COUNT);
    expectAllDeleted(h);
  });

  it('with write true: writes the record and the index and returns both repository-relative paths (10.2, 10.6)', async () => {
    const h = harness();
    const outcome = await call(h, 'run_calibration', { ...CAL_ARGS, write: true });
    expect(outcome.result.isError).toBeUndefined();
    const recordPath = `docs/calibration/${CASE_ID}-${TODAY}-${GIT.shortSha}.md`;
    const indexPath = 'docs/calibration/README.md';
    const summary = defined(outcome.result.structuredContent, 'structuredContent');
    expect(summary.record_path).toBe(recordPath);
    expect(summary.index_path).toBe(indexPath);

    const out = text(outcome);
    expect(out.endsWith(`\n\nWritten: ${recordPath}, ${indexPath}\n`)).toBe(true);
    const record = defined(h.files.get(`${REPO_ROOT}/${recordPath}`), 'written record');
    expect(out.startsWith(record)).toBe(true);
    expect(record).toContain(`- Commit: ${GIT.shortSha}`);
    const index = defined(h.files.get(`${REPO_ROOT}/${indexPath}`), 'written index');
    const status = summary.calibrated ? 'calibrated' : 'NOT calibrated';
    expect(index.trimEnd().split('\n').at(-1)).toBe(
      `- ${TODAY} | ${GIT.shortSha} | ${CASE_ID} | [${CASE_ID}-${TODAY}-${GIT.shortSha}.md](${CASE_ID}-${TODAY}-${GIT.shortSha}.md) | ${status}`,
    );
    expect(h.fsCalls.every((c) => c.split(' ')[1].startsWith(`${REPO_ROOT}/docs/calibration`))).toBe(true);
    expectAllDeleted(h);
  });

  it('fails a local preflight check before the Health_Check (D27, 8.5)', async () => {
    const h = harness();
    const missing = await call(h, 'run_calibration', { case_id: 'no-such-case' });
    expect(missing.result.isError).toBe(true);
    expect(missing.errorKind).toBe('case');
    expect(text(missing)).toBe('Case file cases/no-such-case.yaml not found');

    const early = await call(h, 'run_calibration', { ...CAL_ARGS, early_decompress_at_seconds: INSULT_TIME });
    expect(early.result.isError).toBe(true);
    expect(text(early)).toBe(
      `early_decompress_at_seconds (${INSULT_TIME}) must be less than the SETensionPneumothorax timeSeconds (${INSULT_TIME})`,
    );
    expect(h.fake.calls).toEqual([]);
    expect(h.callsAtGit).toEqual([]);
  });

  it('rejects invalid input before reading the case file', async () => {
    const h = harness();
    const outcome = await call(h, 'run_calibration', { case_id: CASE_ID, write: 'yes', extra: 1 });
    expect(outcome.result.isError).toBe(true);
    expect(outcome.errorKind).toBe('input');
    expect(text(outcome)).toBe('Invalid input: write: must be true or false; extra: is not a known field');
    expect(h.callsAtRead).toEqual([]);
    expect(h.fake.calls).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Progress notifications (8.13)
// ---------------------------------------------------------------------------

describe('progress notifications', () => {
  it('run_calibration reports at least once per 10 s of clock time with increasing progress, and stops at the result (8.13)', async () => {
    const h = harness();
    const seen: { at: number; progress: number; total: number; message: string }[] = [];
    const tools = createEngineTools(h.deps);
    const start = h.clock.now();
    let endedAt = -1;
    const p = tools
      .run_calibration(CAL_ARGS, ctx({ reportProgress: (n) => seen.push({ at: h.clock.now(), ...n }) }))
      .then((outcome) => {
        endedAt = h.clock.now();
        return outcome;
      });
    const outcome = await h.clock.runUntilSettled(p, LIMIT_MS);
    expect(outcome.result.isError).toBeUndefined();

    expect(seen.length).toBeGreaterThanOrEqual(2);
    const times = [start, ...seen.map((s) => s.at), endedAt];
    for (let i = 1; i < times.length; i += 1) expect(times[i] - times[i - 1]).toBeLessThanOrEqual(10_000);
    expect(seen[0].at - start).toBe(PROGRESS_INTERVAL_MS);
    for (let i = 1; i < seen.length; i += 1) expect(seen[i].progress).toBeGreaterThan(seen[i - 1].progress);
    for (const s of seen) {
      expect(s.total).toBe(SCENARIO_COUNT * (CAL_MAX + 1));
      expect(s.message).toMatch(new RegExp(`^\\d+ of ${SCENARIO_COUNT} scenarios completed$`));
    }
    const completed = seen.map((s) => Number(s.message.split(' ')[0]));
    for (let i = 1; i < completed.length; i += 1) expect(completed[i]).toBeGreaterThanOrEqual(completed[i - 1]);

    const count = seen.length;
    await h.clock.advance(3 * PROGRESS_INTERVAL_MS);
    expect(seen).toHaveLength(count);
  });

  it('a progress callback that throws is logged and the call goes on', async () => {
    const h = harness();
    const outcome = await call(
      h,
      'run_scenario',
      { ...SCENARIO_ARGS, max_seconds: 60 },
      ctx({
        reportProgress: () => {
          throw new Error('transport closed');
        },
      }),
    );
    expect(outcome.result.isError).toBeUndefined();
    expect(h.logs.some((l) => l === 'Could not send a progress notification: transport closed')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Property 1: invalid input fails before any request (1.5, 3.1, 3.2, 8.1)
// ---------------------------------------------------------------------------

type Args = Record<string, unknown>;

/** The kinds of violation the property names. */
type Why =
  | 'wrong-type'
  | 'missing'
  | 'non-kebab'
  | 'null-variant'
  | 'out-of-range'
  | 'non-whole'
  | 'too-many'
  | 'unknown-field'
  | 'above-max';

/**
 * One mutation of a valid input. Plain data, so fast-check prints a readable counterexample.
 * `set` / `remove` change a top-level field (an unknown field is a `set` of a new key);
 * `set-item` / `remove-item` change Planned_Intervention `pick % n` (`field: null` replaces the
 * whole item); `above-max` sets that item's `at_seconds` to `max_seconds + by`.
 */
type Mutation =
  | { op: 'set'; why: Why; field: string; value: unknown }
  | { op: 'remove'; why: 'missing'; field: string }
  | { op: 'set-item'; why: Why; pick: number; field: string | null; value: unknown }
  | { op: 'remove-item'; why: 'missing'; pick: number; field: string }
  | { op: 'above-max'; why: 'above-max'; pick: number; by: number };

/**
 * The input fields a mutation reads or writes. Mutations in one call use disjoint slots, so none
 * can hide another: every item mutation and the whole-list mutations share `interventions`, and
 * `above-max` also holds `max_seconds` (removing or changing `max_seconds` would hide it).
 */
function slotsOf(m: Mutation): string[] {
  switch (m.op) {
    case 'set':
    case 'remove':
      return [m.field];
    case 'set-item':
    case 'remove-item':
      return ['interventions'];
    case 'above-max':
      return ['interventions', 'max_seconds'];
  }
}

/** Keeps the first mutation and every later one whose slots are still free (1 to 3 remain). */
function disjoint(mutations: readonly Mutation[]): Mutation[] {
  const used = new Set<string>();
  const kept: Mutation[] = [];
  for (const m of mutations) {
    const slots = slotsOf(m);
    if (slots.some((s) => used.has(s))) continue;
    for (const s of slots) used.add(s);
    kept.push(m);
  }
  return kept;
}

const FILLER_ITEM = { intervention_id: 'planned-item', at_seconds: 0 };

/** The index an item mutation targets; adds one valid item when the list is absent or empty. */
function itemIndex(args: Args, pick: number): { list: unknown[]; i: number } {
  if (!Array.isArray(args.interventions) || args.interventions.length === 0) args.interventions = [{ ...FILLER_ITEM }];
  const list = args.interventions as unknown[];
  return { list, i: pick % list.length };
}

/** Applies the mutation to `args` and returns the field path it makes invalid, as the tools print it. */
function applyMutation(args: Args, m: Mutation): string {
  switch (m.op) {
    case 'set':
      args[m.field] = m.value;
      return m.field;
    case 'remove':
      delete args[m.field];
      return m.field;
    case 'set-item': {
      const { list, i } = itemIndex(args, m.pick);
      if (m.field === null) {
        list[i] = m.value;
        return `interventions[${i}]`;
      }
      (list[i] as Args)[m.field] = m.value;
      return `interventions[${i}].${m.field}`;
    }
    case 'remove-item': {
      const { list, i } = itemIndex(args, m.pick);
      delete (list[i] as Args)[m.field];
      return `interventions[${i}].${m.field}`;
    }
    case 'above-max': {
      const { list, i } = itemIndex(args, m.pick);
      (list[i] as Args).at_seconds = (args.max_seconds as number) + m.by;
      return `interventions[${i}].at_seconds`;
    }
  }
}

/** The field paths an "Invalid input: <path>: <message>; ..." text names. */
function namedPaths(message: string): string[] {
  const prefix = 'Invalid input: ';
  expect(message.startsWith(prefix)).toBe(true);
  return message
    .slice(prefix.length)
    .split('; ')
    .map((issue) => issue.slice(0, issue.indexOf(': ')));
}

// --- Values ---

const SCENARIO_FIELDS = ['case_id', 'variant_id', 'interventions', 'max_seconds', 'sample_interval_seconds', 'stop_at_ending'];
const ITEM_FIELDS = ['intervention_id', 'at_seconds'];
const CALIBRATION_FIELDS = ['case_id', 'decompress_at_seconds', 'early_decompress_at_seconds', 'max_seconds', 'write'];

const arbKebab = fc
  .array(fc.stringMatching(/^[a-z0-9]{1,6}$/), { minLength: 1, maxLength: 3 })
  .map((parts) => parts.join('-'));
const arbNonKebab = fc.oneof(
  fc.constantFrom('', 'Left', 'left_side', 'a--b', '-left', 'left-', 'left side'),
  fc.string({ maxLength: 12 }).filter((s) => !KEBAB.test(s)),
);
const arbNotString = fc.oneof(fc.integer(), fc.boolean(), fc.constant(null), fc.constant([]), fc.constant({}));
const arbNotNumber = fc.oneof(fc.string({ maxLength: 6 }), fc.boolean(), fc.constant(null), fc.constant([]), fc.constant({}));
const arbNotBoolean = fc.oneof(fc.string({ maxLength: 6 }), fc.integer(), fc.constant(null), fc.constant([]));
const arbNotList = fc.oneof(fc.string({ maxLength: 6 }), fc.integer(), fc.boolean(), fc.constant(null), fc.constant({}));
const arbNotObject = fc.oneof(fc.string({ maxLength: 6 }), fc.integer(), fc.constant(null), fc.constant([]));
const arbNonWhole = fc.double({ min: 0.001, max: 5000, noNaN: true }).filter((x) => !Number.isInteger(x));
const arbNegative = fc.integer({ min: -10_000, max: -1 });
const arbOutOfRange = (max: number) =>
  fc.oneof(fc.integer({ min: -100, max: 0 }), fc.integer({ min: max + 1, max: max + 10_000 }));
const arbAnyValue = fc.oneof(fc.integer(), fc.string({ maxLength: 6 }), fc.boolean(), fc.constant(null));
const arbUnknownKey = (known: readonly string[]) =>
  fc
    .oneof(fc.constantFrom('extra', 'caseId', 'variant', 'seed', 'notes'), fc.stringMatching(/^[a-z_]{1,10}$/))
    .filter((key) => !known.includes(key) && key !== '__proto__');
/** 21 to 25 valid Planned_Interventions, each at second 0. */
const arbTooMany = fc
  .integer({ min: 21, max: 25 })
  .map((n) => Array.from({ length: n }, (_, k) => ({ intervention_id: `planned-${k + 1}`, at_seconds: 0 })));

// --- Mutations ---

const set = (why: Why, field: string, value: fc.Arbitrary<unknown>): fc.Arbitrary<Mutation> =>
  value.map((v): Mutation => ({ op: 'set', why, field, value: v }));
const remove = (field: string): fc.Arbitrary<Mutation> => fc.constant<Mutation>({ op: 'remove', why: 'missing', field });
const setItem = (why: Why, field: string | null, value: fc.Arbitrary<unknown>): fc.Arbitrary<Mutation> =>
  fc
    .record({ pick: fc.nat(5), value })
    .map(({ pick, value: v }): Mutation => ({ op: 'set-item', why, pick, field, value: v }));
const removeItem = (field: string): fc.Arbitrary<Mutation> =>
  fc.nat(5).map((pick): Mutation => ({ op: 'remove-item', why: 'missing', pick, field }));
const setUnknown = (known: readonly string[]): fc.Arbitrary<Mutation> =>
  fc
    .record({ key: arbUnknownKey(known), value: arbAnyValue })
    .map(({ key, value }): Mutation => ({ op: 'set', why: 'unknown-field', field: key, value }));

/** run_scenario mutations, grouped by kind so each kind is picked about equally often. */
const arbScenarioMutation: fc.Arbitrary<Mutation> = fc.oneof(
  fc.oneof(
    set('wrong-type', 'case_id', arbNotString),
    set('wrong-type', 'variant_id', arbNotString),
    set('wrong-type', 'interventions', arbNotList),
    setItem('wrong-type', null, arbNotObject),
    setItem('wrong-type', 'intervention_id', arbNotString),
    setItem('wrong-type', 'at_seconds', arbNotNumber),
    set('wrong-type', 'max_seconds', arbNotNumber),
    set('wrong-type', 'sample_interval_seconds', arbNotNumber),
    set('wrong-type', 'stop_at_ending', arbNotBoolean),
  ),
  fc.oneof(remove('case_id'), remove('variant_id'), removeItem('intervention_id'), removeItem('at_seconds'), remove('max_seconds')),
  fc.oneof(
    set('non-kebab', 'case_id', arbNonKebab),
    set('non-kebab', 'variant_id', arbNonKebab),
    setItem('non-kebab', 'intervention_id', arbNonKebab),
  ),
  set('null-variant', 'variant_id', fc.constant(null)),
  fc.oneof(
    setItem('out-of-range', 'at_seconds', arbNegative),
    set('out-of-range', 'max_seconds', arbOutOfRange(3600)),
    set('out-of-range', 'sample_interval_seconds', arbOutOfRange(60)),
  ),
  fc.oneof(
    setItem('non-whole', 'at_seconds', arbNonWhole),
    set('non-whole', 'max_seconds', arbNonWhole),
    set('non-whole', 'sample_interval_seconds', arbNonWhole),
  ),
  set('too-many', 'interventions', arbTooMany),
  fc.oneof(
    setUnknown(SCENARIO_FIELDS),
    fc
      .record({ pick: fc.nat(5), key: arbUnknownKey(ITEM_FIELDS), value: arbAnyValue })
      .map(({ pick, key, value }): Mutation => ({ op: 'set-item', why: 'unknown-field', pick, field: key, value })),
  ),
  fc
    .record({ pick: fc.nat(5), by: fc.integer({ min: 1, max: 1000 }) })
    .map(({ pick, by }): Mutation => ({ op: 'above-max', why: 'above-max', pick, by })),
);

/** run_calibration mutations, grouped by kind. */
const arbCalibrationMutation: fc.Arbitrary<Mutation> = fc.oneof(
  fc.oneof(
    set('wrong-type', 'case_id', arbNotString),
    set('wrong-type', 'decompress_at_seconds', arbNotNumber),
    set('wrong-type', 'early_decompress_at_seconds', arbNotNumber),
    set('wrong-type', 'max_seconds', arbNotNumber),
    set('wrong-type', 'write', arbNotBoolean),
  ),
  remove('case_id'),
  set('non-kebab', 'case_id', arbNonKebab),
  fc.oneof(
    set('out-of-range', 'decompress_at_seconds', arbNegative),
    set('out-of-range', 'early_decompress_at_seconds', arbNegative),
    set('out-of-range', 'max_seconds', arbOutOfRange(3600)),
  ),
  fc.oneof(
    set('non-whole', 'decompress_at_seconds', arbNonWhole),
    set('non-whole', 'early_decompress_at_seconds', arbNonWhole),
    set('non-whole', 'max_seconds', arbNonWhole),
  ),
  setUnknown(CALIBRATION_FIELDS),
);

// --- Valid inputs ---

/** A valid run_scenario input; the optional fields are present or absent. */
const arbScenarioBase: fc.Arbitrary<Args> = fc.integer({ min: 1, max: 3600 }).chain((max) =>
  fc.record(
    {
      case_id: arbKebab,
      variant_id: arbKebab,
      interventions: fc.array(fc.record({ intervention_id: arbKebab, at_seconds: fc.integer({ min: 0, max }) }), {
        maxLength: 3,
      }),
      max_seconds: fc.constant(max),
      sample_interval_seconds: fc.integer({ min: 1, max: 60 }),
      stop_at_ending: fc.boolean(),
    },
    { requiredKeys: ['case_id', 'variant_id', 'max_seconds'] },
  ),
);

/** A valid run_calibration input; the optional fields are present or absent. */
const arbCalibrationBase: fc.Arbitrary<Args> = fc.record(
  {
    case_id: arbKebab,
    decompress_at_seconds: fc.nat(3600),
    early_decompress_at_seconds: fc.nat(3600),
    max_seconds: fc.integer({ min: 1, max: 3600 }),
    write: fc.boolean(),
  },
  { requiredKeys: ['case_id'] },
);

const arbInvalidCall = fc.oneof(
  fc.record({
    tool: fc.constant('run_scenario' as const),
    base: arbScenarioBase,
    mutations: fc.array(arbScenarioMutation, { minLength: 1, maxLength: 3 }).map(disjoint),
  }),
  fc.record({
    tool: fc.constant('run_calibration' as const),
    base: arbCalibrationBase,
    mutations: fc.array(arbCalibrationMutation, { minLength: 1, maxLength: 3 }).map(disjoint),
  }),
);

const SCENARIO_WHYS: readonly Why[] = [
  'wrong-type',
  'missing',
  'non-kebab',
  'null-variant',
  'out-of-range',
  'non-whole',
  'too-many',
  'unknown-field',
  'above-max',
];
const CALIBRATION_WHYS: readonly Why[] = ['wrong-type', 'missing', 'non-kebab', 'out-of-range', 'non-whole', 'unknown-field'];

describe('input validation', () => {
  // Feature: engine-mcp, Property 1: Invalid input fails before any request
  it('Property 1: invalid input fails before any request', async () => {
    const seen = new Set<string>();
    const sizes = new Set<number>();
    await fc.assert(
      fc.asyncProperty(arbInvalidCall, async ({ tool, base, mutations }) => {
        // The unmutated input is valid, so every reported field comes from a mutation.
        const schema = tool === 'run_scenario' ? RunScenarioInput : RunCalibrationInput;
        expect(schema.safeParse(base).success).toBe(true);

        const args: Args = structuredClone(base);
        const expected = mutations.map((m) => applyMutation(args, m));

        const h = harness();
        const outcome = await call(h, tool, args);
        expect(outcome.result.isError).toBe(true);
        expect(outcome.errorKind).toBe('input');
        expect(outcome.result.structuredContent).toBeUndefined();
        const named = namedPaths(text(outcome));
        for (const path of expected) expect(named).toContain(path);

        // No request (not even the Health_Check), no Session, and no local preflight.
        expect(h.fake.calls).toEqual([]);
        expect(h.fake.liveSessions()).toEqual([]);
        expect(h.deps.registry.ids()).toEqual([]);
        expect(h.deps.slots.held).toBe(0);
        expect(h.callsAtRead).toEqual([]);
        expect(h.callsAtGit).toEqual([]);
        expect(h.fsCalls).toEqual([]);

        for (const m of mutations) seen.add(`${tool}:${m.why}`);
        sizes.add(mutations.length);
      }),
      PBT_PARAMS,
    );
    // The generated calls reach every kind of mutation, and combinations of two and three.
    for (const why of SCENARIO_WHYS) expect(seen).toContain(`run_scenario:${why}`);
    for (const why of CALIBRATION_WHYS) expect(seen).toContain(`run_calibration:${why}`);
    expect([...sizes].sort()).toEqual([1, 2, 3]);
  }, 60_000);
});
