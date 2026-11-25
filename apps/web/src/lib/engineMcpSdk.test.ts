/**
 * SDK behaviour the Engine_MCP_Server relies on (engine-mcp task 5.5, open item O1, design
 * "Test files": `engineMcpSdk.test.ts`), checked against the installed @modelcontextprotocol/sdk
 * 1.32.2 through `InMemoryTransport.createLinkedPair()`:
 *
 * - a low-level `Server` with `createEngineTools` over the Fake_Service lists the 3 tools (1.1);
 * - `tools/call` returns tool results with `isError: true` (1.6, 3.2), not JSON-RPC errors;
 * - `extra.signal` aborts on `notifications/cancelled`, the call's Session is deleted within 5 s,
 *   and no response arrives for the cancelled request (6.2);
 * - `_meta.progressToken` reaches the handler and `notifications/progress` arrive (8.13).
 *
 * The server below is wired the way `scripts/engineMcp.ts` wires it (the handler wiring of the
 * entry point itself is checked in Kiro, O3). The client side speaks raw JSON-RPC over the linked
 * transport, so the test sees every message the server sends. Everything runs on the Fake_Service
 * and the fake clock: no socket, no port, no Physiology_Service and no real time (17.7). No
 * clinical value is written here.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  CallToolRequestSchema,
  LATEST_PROTOCOL_VERSION,
  ListToolsRequestSchema,
  type CallToolResult,
  type JSONRPCMessage,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it } from 'vitest';
import { CASE_LEFT } from '@/test/caseFixtures';
import { createFakeClock, drainMicrotasks, type FakeClock } from '@/test/fakeClock';
import { DEFAULT_FAKE_CASES, createFakeService, type FakeService, type FakeServiceOptions } from '@/test/fakePhysiologyService';
import type { GitInfo, RecordFs } from './calibrationRecord';
import { createPhysiologyClient, unreachableMessage } from './engineClient';
import { createSessionRegistry, createSessionSlots } from './engineSlots';
import {
  PROGRESS_INTERVAL_MS,
  TOOL_DEFINITIONS,
  createEngineTools,
  type EngineDeps,
  type ToolCallContext,
  type ToolName,
} from './engineTools';

const SERVICE_URL = 'http://fake-physiology.test:8123';
const CASE_ID = CASE_LEFT.id;
const GIT: GitInfo = { shortSha: 'abc1234', casesDirty: false, libDirty: false, has1e71454: true };
const LIMIT_MS = 3_600_000;
/** 6.2: a cancelled call stops and deletes its Sessions within 5 s of wall-clock time. */
const CANCEL_BUDGET_MS = 5_000;

/** A record file system that must not be used: no test here writes a record. */
const NO_FS: RecordFs = {
  mkdir: () => Promise.reject(new Error('RecordFs is not used in this test')),
  readFile: () => Promise.reject(new Error('RecordFs is not used in this test')),
  writeFile: () => Promise.reject(new Error('RecordFs is not used in this test')),
  appendFile: () => Promise.reject(new Error('RecordFs is not used in this test')),
};

interface CallRecord {
  name: string;
  token: string | number | undefined;
  signal: AbortSignal | undefined;
  hadReporter: boolean;
  done: Promise<unknown>;
}

interface Harness {
  clock: FakeClock;
  fake: FakeService;
  deps: EngineDeps;
  calls: CallRecord[];
  received: JSONRPCMessage[];
  send(message: JSONRPCMessage): Promise<void>;
  /** Sends a request and resolves with its response, advancing the fake clock until it arrives. */
  request(method: string, params?: Record<string, unknown>): Promise<{ id: number; response: Record<string, unknown> }>;
  /** Sends a request without waiting; returns its id. */
  start(method: string, params?: Record<string, unknown>): Promise<number>;
  responseTo(id: number): Promise<Record<string, unknown>>;
}

function errorResult(text: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text }] };
}

/** The wiring of `scripts/engineMcp.ts`, with each call recorded for the assertions. */
function createServer(deps: EngineDeps, calls: CallRecord[], processSignal: AbortSignal): Server {
  const tools = createEngineTools(deps);
  const names: ReadonlySet<string> = new Set(TOOL_DEFINITIONS.map((t) => t.name));
  const server = new Server({ name: 'stitched-patient-engine', version: '0.1.0' }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOL_DEFINITIONS.map((def): Tool => {
      const tool: Tool = { name: def.name, description: def.description, inputSchema: def.inputSchema as Tool['inputSchema'] };
      if (def.outputSchema !== undefined) tool.outputSchema = def.outputSchema as Tool['outputSchema'];
      return tool;
    }),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (req, extra): Promise<CallToolResult> => {
    const name = req.params.name;
    const token = req.params._meta?.progressToken;
    if (!names.has(name)) {
      calls.push({ name, token, signal: undefined, hadReporter: false, done: Promise.resolve() });
      return errorResult(`Unknown tool: ${name}`);
    }
    const ctx: ToolCallContext = {
      signal: AbortSignal.any([extra.signal, processSignal]),
      reportProgress:
        token === undefined
          ? undefined
          : (p) => {
              void extra
                .sendNotification({ method: 'notifications/progress', params: { progressToken: token, ...p } })
                .catch((err: unknown) => deps.log(`Could not send a progress notification: ${String(err)}`));
            },
    };
    const run = tools[name as ToolName](req.params.arguments ?? {}, ctx).then((o) => ({ ...o.result }));
    calls.push({ name, token, signal: extra.signal, hadReporter: ctx.reportProgress !== undefined, done: run });
    return run;
  });
  return server;
}

async function harness(failures?: FakeServiceOptions['failures']): Promise<Harness> {
  const clock = createFakeClock();
  const fake = createFakeService({ clock, cases: DEFAULT_FAKE_CASES, failures });
  const logs: string[] = [];
  const deps: EngineDeps = {
    serviceUrl: SERVICE_URL,
    client: createPhysiologyClient({ serviceUrl: SERVICE_URL, fetch: fake.fetch }),
    openSocket: fake.openSocket,
    slots: createSessionSlots(4),
    registry: createSessionRegistry(),
    clock,
    log: (line) => logs.push(line),
    sessionCap: 4,
    repoRoot: '/repo',
    readCaseFile: () => Promise.reject(new Error('the case file is not read in this test')),
    gitInfo: async () => GIT,
    today: () => '2026-11-22',
    recordFs: NO_FS,
  };
  const calls: CallRecord[] = [];
  const server = createServer(deps, calls, new AbortController().signal);

  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const received: JSONRPCMessage[] = [];
  const waiters = new Map<number, (response: Record<string, unknown>) => void>();
  clientSide.onmessage = (message) => {
    received.push(message);
    const id = (message as { id?: unknown }).id;
    if (typeof id === 'number' && !('method' in message)) waiters.get(id)?.(message as Record<string, unknown>);
  };
  await clientSide.start();
  await server.connect(serverSide);

  let nextId = 1;
  const send = (message: JSONRPCMessage): Promise<void> => clientSide.send(message);
  const responseTo = (id: number): Promise<Record<string, unknown>> => {
    const already = received.find((m) => (m as { id?: unknown }).id === id && !('method' in m));
    if (already) return Promise.resolve(already as Record<string, unknown>);
    return new Promise((resolve) => waiters.set(id, resolve));
  };
  const start = async (method: string, params?: Record<string, unknown>): Promise<number> => {
    const id = nextId++;
    await send({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) } as JSONRPCMessage);
    return id;
  };
  const request = async (method: string, params?: Record<string, unknown>) => {
    const id = await start(method, params);
    const response = await clock.runUntilSettled(responseTo(id), LIMIT_MS);
    return { id, response };
  };

  const h: Harness = { clock, fake, deps, calls, received, send, request, start, responseTo };
  const init = await request('initialize', {
    protocolVersion: LATEST_PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: 'engine-mcp-sdk-test', version: '0.0.0' },
  });
  expect((init.response.result as { protocolVersion: string }).protocolVersion).toBe(LATEST_PROTOCOL_VERSION);
  await send({ jsonrpc: '2.0', method: 'notifications/initialized' } as JSONRPCMessage);
  return h;
}

function toolResult(response: Record<string, unknown>): CallToolResult {
  expect(response.error).toBeUndefined();
  return response.result as CallToolResult;
}

function progressNotifications(h: Harness): { progressToken: unknown; progress: number; total: number; message: string }[] {
  return h.received
    .filter((m) => (m as { method?: unknown }).method === 'notifications/progress')
    .map((m) => (m as unknown as { params: { progressToken: unknown; progress: number; total: number; message: string } }).params);
}

describe('Engine_MCP_Server over the installed SDK (O1)', () => {
  it('lists exactly the three tools with their published schemas, and sends no request to the service (1.1)', async () => {
    const h = await harness();
    const { response } = await h.request('tools/list', {});
    const tools = (response.result as { tools: Tool[] }).tools;
    expect(tools.map((t) => t.name)).toEqual(['list_cases', 'run_scenario', 'run_calibration']);
    for (const def of TOOL_DEFINITIONS) {
      const tool = tools.find((t) => t.name === def.name);
      expect(tool?.description).toBe(def.description);
      expect(tool?.inputSchema).toEqual(def.inputSchema);
      expect(tool?.outputSchema).toEqual(def.outputSchema);
    }
    expect(h.fake.calls).toEqual([]);
  });

  it('returns failures as tool results with isError, not as JSON-RPC errors (1.6, 3.2)', async () => {
    const down = await harness({ unreachable: true });
    const unreachable = toolResult((await down.request('tools/call', { name: 'list_cases', arguments: {} })).response);
    expect(unreachable.isError).toBe(true);
    expect(unreachable.content).toEqual([{ type: 'text', text: unreachableMessage(SERVICE_URL) }]);
    expect(unreachable.structuredContent).toBeUndefined();
    expect(down.fake.calls.map((c) => `${c.method} ${c.path}`)).toEqual(['GET /']);

    const h = await harness();
    const invalid = toolResult(
      (await h.request('tools/call', { name: 'run_scenario', arguments: { case_id: 'Not Kebab', max_seconds: 0 } })).response,
    );
    expect(invalid.isError).toBe(true);
    const text = (invalid.content[0] as { text: string }).text;
    expect(text).toMatch(/^Invalid input: /);
    for (const field of ['case_id', 'variant_id', 'max_seconds']) expect(text).toContain(`${field}: `);
    expect(h.fake.calls).toEqual([]);

    const unknown = toolResult((await h.request('tools/call', { name: 'no_such_tool', arguments: {} })).response);
    expect(unknown).toMatchObject({ isError: true, content: [{ type: 'text', text: 'Unknown tool: no_such_tool' }] });
    expect(h.fake.calls).toEqual([]);
  });

  it('aborts extra.signal on notifications/cancelled, deletes the Session within 5 s and sends no response (6.2)', async () => {
    const h = await harness();
    const id = await h.start('tools/call', {
      name: 'run_scenario',
      arguments: { case_id: CASE_ID, variant_id: 'left', max_seconds: 600 },
    });
    for (let i = 0; i < 400 && h.fake.liveSessions().length === 0; i += 1) await h.clock.advance(250);
    expect(h.fake.liveSessions()).toHaveLength(1);
    await h.clock.advance(2_000); // playback is running
    const call = h.calls.find((c) => c.name === 'run_scenario');
    expect(call?.signal?.aborted).toBe(false);

    const cancelledAt = h.clock.now();
    await h.send({
      jsonrpc: '2.0',
      method: 'notifications/cancelled',
      params: { requestId: id, reason: 'test cancel' },
    } as JSONRPCMessage);
    expect(call?.signal?.aborted).toBe(true);

    await h.clock.runUntilSettled(call!.done, LIMIT_MS);
    expect(h.clock.now() - cancelledAt).toBeLessThanOrEqual(CANCEL_BUDGET_MS);
    expect(h.fake.liveSessions()).toEqual([]);
    expect(h.fake.deleted).toHaveLength(1);
    expect(h.deps.registry.ids()).toEqual([]);
    expect(h.deps.slots.held).toBe(0);

    await h.clock.advance(10_000);
    await drainMicrotasks();
    expect(h.received.filter((m) => (m as { id?: unknown }).id === id)).toEqual([]);
  });

  it('passes _meta.progressToken to the handler and sends notifications/progress (8.13)', async () => {
    const h = await harness();
    const token = 'engine-progress-1';
    const maxSeconds = 60;
    const { response } = await h.request('tools/call', {
      name: 'run_scenario',
      arguments: { case_id: CASE_ID, variant_id: 'left', max_seconds: maxSeconds },
      _meta: { progressToken: token },
    });
    const result = toolResult(response);
    expect(result.isError).toBeFalsy();
    expect((result.structuredContent as { case_id: string }).case_id).toBe(CASE_ID);

    const call = h.calls.find((c) => c.name === 'run_scenario');
    expect(call?.token).toBe(token);
    expect(call?.hadReporter).toBe(true);

    const notes = progressNotifications(h);
    // 60 simulated seconds at 4x take about 15 s of fake time, so at least two 5 s ticks.
    expect(notes.length).toBeGreaterThanOrEqual(2);
    expect(PROGRESS_INTERVAL_MS).toBeLessThanOrEqual(10_000);
    for (const n of notes) {
      expect(n.progressToken).toBe(token);
      expect(n.total).toBe(maxSeconds + 1);
      expect(n.message).toBe('0 of 1 scenarios completed');
    }
    for (let i = 1; i < notes.length; i += 1) expect(notes[i].progress).toBeGreaterThan(notes[i - 1].progress);

    // Without a token the handler gets no reporter and no progress notification is sent.
    const before = notes.length;
    const plain = await h.request('tools/call', {
      name: 'run_scenario',
      arguments: { case_id: CASE_ID, variant_id: 'left', max_seconds: maxSeconds },
    });
    expect(toolResult(plain.response).isError).toBeFalsy();
    const second = h.calls.filter((c) => c.name === 'run_scenario')[1];
    expect(second.token).toBeUndefined();
    expect(second.hadReporter).toBe(false);
    expect(progressNotifications(h)).toHaveLength(before);
  });
});
