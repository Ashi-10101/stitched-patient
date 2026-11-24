/**
 * Tests of `engineClient.ts` against the Fake_Service and the fake clock (engine-mcp task 1.3).
 *
 * No test opens a socket, listens on a port or reaches the Physiology_Service (17.7). The last
 * group checks the Fake_Service behaviour that the runner tests of later tasks rely on. Vitals
 * numbers here are synthetic test values, not clinical values.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { CASE_LEFT, CASE_RIGHT } from '@/test/caseFixtures';
import { createFakeClock, type FakeClock } from '@/test/fakeClock';
import {
  createFakeService,
  DEFAULT_FAKE_VITALS,
  SCRIPTED_CLOSE_CODE,
  SCRIPTED_ERROR_MESSAGE,
  type FakeService,
  type FakeServiceOptions,
} from '@/test/fakePhysiologyService';
import {
  CLEANUP_REQUEST_TIMEOUT_MS,
  CREATE_SESSION_TIMEOUT_MS,
  DEFAULT_SERVICE_URL,
  DEFAULT_SESSION_CAP,
  EngineError,
  HEALTH_TIMEOUT_MS,
  REQUEST_TIMEOUT_MS,
  createPhysiologyClient,
  parseServiceUrl,
  parseSessionCap,
  unreachableMessage,
  vitalsUrl,
  type FetchLike,
  type PhysiologyClient,
} from './engineClient';

const SERVICE_URL = 'http://fake-physiology.test:8123';
const CASE_ID = CASE_LEFT.id;
const LEFT_INTERVENTION = CASE_LEFT.interventions[0];

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

interface Setup {
  clock: FakeClock;
  fake: FakeService;
  client: PhysiologyClient;
}

function setup(opts: Omit<FakeServiceOptions, 'clock'> = {}): Setup {
  const clock = createFakeClock();
  const fake = createFakeService({ ...opts, clock });
  const client = createPhysiologyClient({ serviceUrl: SERVICE_URL, fetch: fake.fetch });
  return { clock, fake, client };
}

/** A FetchLike that always answers `status` with `body`, for answers the Fake_Service never gives. */
function fixedAnswer(status: number, body: string): FetchLike {
  return async () => ({ ok: status >= 200 && status < 300, status, text: async () => body });
}

type SocketEvent =
  | { type: 'open' }
  | { type: 'message'; data: Record<string, unknown> }
  | { type: 'error' }
  | { type: 'close'; code: number; reason: string };

function listen(fake: FakeService, sessionId: string) {
  const socket = fake.openSocket(vitalsUrl(SERVICE_URL, sessionId));
  const events: SocketEvent[] = [];
  socket.onopen = () => events.push({ type: 'open' });
  socket.onmessage = (ev) => events.push({ type: 'message', data: JSON.parse(String(ev.data)) });
  socket.onerror = () => events.push({ type: 'error' });
  socket.onclose = (ev) => events.push({ type: 'close', code: ev.code, reason: ev.reason });
  const messages = () =>
    events.flatMap((e) => (e.type === 'message' ? [e.data] : []));
  const times = () => messages().map((m) => m.simulation_time);
  return { socket, events, messages, times };
}

describe('parseServiceUrl (1.9)', () => {
  it('returns the default when PHYSIOLOGY_URL is unset', () => {
    expect(parseServiceUrl(undefined)).toBe(DEFAULT_SERVICE_URL);
  });

  it.each([
    ['http://localhost:8000', 'http://localhost:8000'],
    ['http://localhost:8000/', 'http://localhost:8000'],
    ['http://192.168.1.20:8000', 'http://192.168.1.20:8000'],
    ['https://physio.example.test:9443/base/', 'https://physio.example.test:9443/base'],
  ])('accepts %s', (raw, expected) => {
    expect(parseServiceUrl(raw)).toBe(expected);
  });

  it.each([
    '',
    'localhost:8000',
    'ftp://localhost:8000',
    'ws://localhost:8000',
    'http://',
    ' http://localhost:8000',
    'http://localhost:8000?x=1',
    'http://localhost:8000#top',
    'http://user:pw@localhost:8000',
  ])('rejects %j with a config error naming the value', (raw) => {
    let caught: unknown;
    try {
      parseServiceUrl(raw);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(EngineError);
    expect((caught as EngineError).kind).toBe('config');
    expect((caught as EngineError).message).toContain(JSON.stringify(raw));
  });
});

describe('parseSessionCap (7.2)', () => {
  it('returns the default when ENGINE_MCP_MAX_SESSIONS is unset', () => {
    expect(parseSessionCap(undefined)).toBe(DEFAULT_SESSION_CAP);
  });

  it('accepts every whole number from 1 to 8', () => {
    for (let n = 1; n <= 8; n += 1) expect(parseSessionCap(String(n))).toBe(n);
  });

  it.each(['0', '9', '-1', '1.5', '', ' 3', 'four', '1e1'])(
    'rejects %j with a config error naming the value and the range',
    (raw) => {
      let caught: unknown;
      try {
        parseSessionCap(raw);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(EngineError);
      expect((caught as EngineError).kind).toBe('config');
      expect((caught as EngineError).message).toContain(JSON.stringify(raw));
      expect((caught as EngineError).message).toContain('from 1 to 8');
    },
  );
});

describe('unreachableMessage and vitalsUrl', () => {
  it('gives the Unreachable_Error text for the Service_URL (1.6)', () => {
    expect(unreachableMessage(SERVICE_URL)).toBe(
      `The Physiology_Service at ${SERVICE_URL} is not reachable. Start it in your own terminal ` +
        '(for example: docker compose up physiology) or set PHYSIOLOGY_URL to its address. ' +
        'This tool does not start the service.',
    );
  });

  it('builds the stream URL from the Service_URL with the id encoded (F5)', () => {
    expect(vitalsUrl('http://localhost:8000', 'abc')).toBe('ws://localhost:8000/sessions/abc/vitals');
    expect(vitalsUrl('https://physio.example.test/base', 'a/b c')).toBe(
      'wss://physio.example.test/base/sessions/a%2Fb%20c/vitals',
    );
  });
});

describe('createPhysiologyClient against the Fake_Service', () => {
  it('runs every endpoint and parses the answers', async () => {
    const { client, fake } = setup();
    const signal = live();
    await client.health(signal);
    expect(await client.listCases(signal)).toEqual([CASE_ID]);

    const meta = await client.createSession(CASE_ID, 'right', signal);
    expect(meta.case_id).toBe(CASE_ID);
    expect(meta.variant_id).toBe('right');
    expect(await client.getCase(meta.session_id, signal)).toEqual(CASE_RIGHT);

    expect(await client.setPlayback(meta.session_id, { speed: '4x' }, signal)).toEqual({
      playing: false,
      speed: '4x',
      simulation_time: 0,
    });

    const intervention = CASE_RIGHT.interventions[0];
    await client.applyIntervention(meta.session_id, intervention.id, signal);
    const checkpoints = await client.listCheckpoints(meta.session_id, meta.current_branch_id, signal);
    expect(checkpoints.map((c) => [c.simulation_time, c.is_automatic, c.description])).toEqual([
      [0, true, 'Initial state'],
      [0, false, `After ${intervention.label}`],
    ]);

    expect(fake.liveSessions()).toEqual([meta.session_id]);
    await client.deleteSession(meta.session_id, signal);
    expect(fake.liveSessions()).toEqual([]);
    expect(fake.deleted).toEqual([meta.session_id]);
  });

  it('sends every request to the Service_URL (1.4)', async () => {
    const { fake } = setup();
    const urls: string[] = [];
    const recording: FetchLike = (url, init) => {
      urls.push(url);
      return fake.fetch(url, init);
    };
    const client = createPhysiologyClient({ serviceUrl: SERVICE_URL, fetch: recording });
    const signal = live();

    await client.health(signal);
    await client.listCases(signal);
    const meta = await client.createSession(CASE_ID, 'left', signal);
    const id = meta.session_id;
    await client.getCase(id, signal);
    await client.setPlayback(id, { playing: false }, signal);
    await client.applyIntervention(id, LEFT_INTERVENTION.id, signal);
    await client.listCheckpoints(id, meta.current_branch_id, signal);
    await client.deleteSession(id, signal);

    expect(urls).toHaveLength(8);
    for (const url of urls) expect(url.startsWith(`${SERVICE_URL}/`)).toBe(true);
    expect(urls.map((u) => u.slice(SERVICE_URL.length))).toEqual([
      '/',
      '/cases',
      '/sessions',
      `/sessions/${id}/case`,
      `/sessions/${id}/playback`,
      `/sessions/${id}/interventions`,
      `/sessions/${id}/branches/${meta.current_branch_id}/checkpoints`,
      `/sessions/${id}`,
    ]);
    expect(fake.calls.map((c) => [c.method, c.path])).toEqual([
      ['GET', '/'],
      ['GET', '/cases'],
      ['POST', '/sessions'],
      ['GET', `/sessions/${id}/case`],
      ['POST', `/sessions/${id}/playback`],
      ['POST', `/sessions/${id}/interventions`],
      ['GET', `/sessions/${id}/branches/${meta.current_branch_id}/checkpoints`],
      ['DELETE', `/sessions/${id}`],
    ]);
    expect(fake.calls[2].body).toEqual({ case_id: CASE_ID, variant_id: 'left' });
    expect(vitalsUrl(SERVICE_URL, id).startsWith('ws://fake-physiology.test:8123/sessions/')).toBe(true);
  });
});

describe('createPhysiologyClient error mapping', () => {
  it('maps a network failure of every request to the Unreachable_Error (1.6)', async () => {
    const { client, fake } = setup({ failures: { unreachable: true } });
    const signal = live();
    const requests: Array<() => Promise<unknown>> = [
      () => client.health(signal),
      () => client.listCases(signal),
      () => client.createSession(CASE_ID, 'left', signal),
      () => client.getCase('s', signal),
      () => client.setPlayback('s', { playing: true }, signal),
      () => client.applyIntervention('s', LEFT_INTERVENTION.id, signal),
      () => client.listCheckpoints('s', 'b', signal),
      () => client.deleteSession('s', signal),
    ];
    for (const request of requests) {
      const err = await engineError(request());
      expect(err.kind).toBe('unreachable');
      expect(err.message).toBe(unreachableMessage(SERVICE_URL));
    }
    expect(fake.calls).toHaveLength(requests.length);
  });

  it('maps a Health_Check timeout to the Unreachable_Error after 3 s of fake time', async () => {
    const { client, clock, fake } = setup({ failures: { healthDelayMs: HEALTH_TIMEOUT_MS } });
    const err = await clock.runUntilSettled(engineError(client.health(live())));
    expect(err.kind).toBe('unreachable');
    expect(err.message).toBe(unreachableMessage(SERVICE_URL));
    expect(clock.now()).toBe(HEALTH_TIMEOUT_MS);
    expect(fake.calls).toEqual([{ method: 'GET', path: '/' }]);
  });

  it('answers a slow Health_Check that stays under the limit', async () => {
    const delay = HEALTH_TIMEOUT_MS - 1000;
    const { client, clock } = setup({ failures: { healthDelayMs: delay } });
    await clock.runUntilSettled(client.health(live()));
    expect(clock.now()).toBe(delay);
  });

  it('maps a non-2xx Health_Check to the Unreachable_Error', async () => {
    const { client } = setup({
      failures: { http: [{ method: 'GET', pathTemplate: '/', status: 503, detail: 'starting' }] },
    });
    const err = await engineError(client.health(live()));
    expect(err.kind).toBe('unreachable');
    expect(err.message).toBe(unreachableMessage(SERVICE_URL));
  });

  it('maps a TimeoutError of any other request to kind timeout naming the endpoint and the limit', async () => {
    const timingOut: FetchLike = async () => {
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    };
    const client = createPhysiologyClient({ serviceUrl: SERVICE_URL, fetch: timingOut });
    const signal = live();
    const cases: Array<[Promise<unknown>, string]> = [
      [client.getCase('secret-id', signal), `GET /sessions/{id}/case did not answer within ${REQUEST_TIMEOUT_MS / 1000} s`],
      [client.createSession(CASE_ID, 'left', signal), `POST /sessions did not answer within ${CREATE_SESSION_TIMEOUT_MS / 1000} s`],
      [
        client.deleteSession('secret-id', signal, CLEANUP_REQUEST_TIMEOUT_MS),
        `DELETE /sessions/{id} did not answer within ${CLEANUP_REQUEST_TIMEOUT_MS / 1000} s`,
      ],
    ];
    for (const [p, message] of cases) {
      const err = await engineError(p);
      expect(err.kind).toBe('timeout');
      expect(err.message).toBe(message);
      expect(err.message).not.toContain('secret-id');
    }
  });

  it("maps the caller's abort to kind cancelled", async () => {
    const before = setup();
    const aborted = new AbortController();
    aborted.abort();
    const early = await engineError(before.client.listCases(aborted.signal));
    expect(early.kind).toBe('cancelled');
    expect(before.fake.calls).toEqual([]);

    const { client, clock } = setup({ failures: { healthDelayMs: HEALTH_TIMEOUT_MS } });
    const controller = new AbortController();
    const pending = engineError(client.health(controller.signal));
    await clock.advance(1000);
    controller.abort();
    const err = await clock.runUntilSettled(pending);
    expect(err.kind).toBe('cancelled');
    expect(clock.now()).toBeLessThan(HEALTH_TIMEOUT_MS);
  });

  it('maps a non-2xx answer to kind http with the path template and the FastAPI detail (1.7)', async () => {
    const { client } = setup({
      failures: {
        http: [{ method: 'POST', pathTemplate: '/sessions/{id}/interventions', status: 422, detail: 'scripted detail' }],
      },
    });
    const signal = live();
    const meta = await client.createSession(CASE_ID, 'left', signal);
    const err = await engineError(client.applyIntervention(meta.session_id, LEFT_INTERVENTION.id, signal));
    expect(err.kind).toBe('http');
    expect(err.message).toBe('POST /sessions/{id}/interventions returned HTTP 422: scripted detail');
    expect(err.message).not.toContain(meta.session_id);
    expect(err.details).toEqual({
      endpoint: 'POST /sessions/{id}/interventions',
      status: 422,
      serviceMessage: 'scripted detail',
    });
  });

  it("reports the Fake_Service's own 404 and 400 answers", async () => {
    const { client } = setup();
    const signal = live();
    const missing = await engineError(client.getCase('missing', signal));
    expect(missing.message).toBe('GET /sessions/{id}/case returned HTTP 404: Session not found');

    const noCase = await engineError(client.createSession('no-such-case', 'left', signal));
    expect(noCase.details?.status).toBe(404);
    expect(noCase.message.startsWith('POST /sessions returned HTTP 404: ')).toBe(true);

    const badVariant = await engineError(client.createSession(CASE_ID, 'middle', signal));
    expect(badVariant.details?.status).toBe(400);
    expect(badVariant.message).toContain("Unknown variant_id: 'middle'");

    const meta = await client.createSession(CASE_ID, 'left', signal);
    const badIntervention = await engineError(client.applyIntervention(meta.session_id, 'no-such-step', signal));
    expect(badIntervention.details?.status).toBe(400);
    expect(badIntervention.message).toContain("Unknown intervention: 'no-such-step'");
  });

  it('cuts a body that is not JSON to 500 characters in the detail', async () => {
    const body = 'x'.repeat(600);
    const client = createPhysiologyClient({ serviceUrl: SERVICE_URL, fetch: fixedAnswer(502, body) });
    const err = await engineError(client.listCases(live()));
    expect(err.kind).toBe('http');
    expect(err.message).toBe(`GET /cases returned HTTP 502: ${'x'.repeat(500)}`);
  });

  it('maps a 2xx answer that is not JSON to kind http', async () => {
    const client = createPhysiologyClient({ serviceUrl: SERVICE_URL, fetch: fixedAnswer(200, '<html>') });
    const err = await engineError(client.getCase('s', live()));
    expect(err.kind).toBe('http');
    expect(err.message).toBe('GET /sessions/{id}/case returned HTTP 200: the response is not JSON');
  });

  it('fails only the nth matching request of an http script', async () => {
    const { client } = setup({
      failures: { http: [{ method: 'POST', pathTemplate: '/sessions/{id}/playback', status: 500, detail: 'nth', nth: 2 }] },
    });
    const signal = live();
    const { session_id: id } = await client.createSession(CASE_ID, 'left', signal);
    await client.setPlayback(id, { speed: '2x' }, signal);
    const err = await engineError(client.setPlayback(id, { speed: '4x' }, signal));
    expect(err.message).toBe('POST /sessions/{id}/playback returned HTTP 500: nth');
    expect((await client.setPlayback(id, {}, signal)).speed).toBe('2x');
  });

  it('keeps the Session live when DELETE fails', async () => {
    const { client, fake } = setup({ failures: { deleteFails: true } });
    const signal = live();
    const { session_id: id } = await client.createSession(CASE_ID, 'left', signal);
    const err = await engineError(client.deleteSession(id, signal));
    expect(err.kind).toBe('http');
    expect(err.details?.status).toBe(500);
    expect(fake.liveSessions()).toEqual([id]);
    expect(fake.deleted).toEqual([]);
  });
});

describe("createPhysiologyClient attaches its own timeout signal", () => {
  /** Replaces `AbortSignal.timeout` with signals the test aborts by hand, and records each `ms`. */
  function controlTimeouts() {
    const controllers: AbortController[] = [];
    const ms: number[] = [];
    const spy = vi.spyOn(AbortSignal, 'timeout').mockImplementation((delay: number) => {
      ms.push(delay);
      const controller = new AbortController();
      controllers.push(controller);
      return controller.signal;
    });
    return { spy, ms, controllers };
  }

  /** A FetchLike that never answers by itself and rejects with the reason of the signal it received. */
  function hangingFetch() {
    const received: AbortSignal[] = [];
    const fetch: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        const signal = init?.signal;
        if (signal === undefined) return;
        received.push(signal);
        if (signal.aborted) {
          reject(signal.reason);
          return;
        }
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    return { fetch, received };
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('passes the limit of each request to AbortSignal.timeout', async () => {
    const { ms } = controlTimeouts();
    const client = createPhysiologyClient({ serviceUrl: SERVICE_URL, fetch: fixedAnswer(200, '{}') });
    const signal = live();

    await client.health(signal);
    await client.createSession(CASE_ID, 'left', signal);
    await client.getCase('s', signal);
    await client.applyIntervention('s', LEFT_INTERVENTION.id, signal);
    await client.listCheckpoints('s', 'b', signal);
    await client.setPlayback('s', { playing: false }, signal);
    await client.setPlayback('s', { playing: false }, signal, CLEANUP_REQUEST_TIMEOUT_MS);
    await client.deleteSession('s', signal);
    await client.deleteSession('s', signal, CLEANUP_REQUEST_TIMEOUT_MS);

    expect(ms).toEqual([
      HEALTH_TIMEOUT_MS,
      CREATE_SESSION_TIMEOUT_MS,
      REQUEST_TIMEOUT_MS,
      REQUEST_TIMEOUT_MS,
      REQUEST_TIMEOUT_MS,
      REQUEST_TIMEOUT_MS,
      CLEANUP_REQUEST_TIMEOUT_MS,
      REQUEST_TIMEOUT_MS,
      CLEANUP_REQUEST_TIMEOUT_MS,
    ]);
  });

  it('maps the firing of its own Health_Check timeout to the Unreachable_Error', async () => {
    const { ms, controllers } = controlTimeouts();
    const { fetch, received } = hangingFetch();
    const client = createPhysiologyClient({ serviceUrl: SERVICE_URL, fetch });
    const caller = live();

    const pending = engineError(client.health(caller));
    expect(ms).toEqual([HEALTH_TIMEOUT_MS]);
    expect(received).toHaveLength(1);
    expect(received[0]).not.toBe(caller);
    expect(received[0].aborted).toBe(false);

    const reason = new DOMException('timed out', 'TimeoutError');
    controllers[0].abort(reason);
    expect(received[0].aborted).toBe(true);
    expect(received[0].reason).toBe(reason);
    expect(caller.aborted).toBe(false);

    const err = await pending;
    expect(err.kind).toBe('unreachable');
    expect(err.message).toBe(unreachableMessage(SERVICE_URL));
  });

  it.each([
    ['createSession', 'POST /sessions', CREATE_SESSION_TIMEOUT_MS],
    ['getCase', 'GET /sessions/{id}/case', REQUEST_TIMEOUT_MS],
    ['deleteSession', 'DELETE /sessions/{id}', CLEANUP_REQUEST_TIMEOUT_MS],
  ] as const)(
    'maps the firing of its own %s timeout to kind timeout naming %s and the limit',
    async (method, endpoint, limit) => {
      const { ms, controllers } = controlTimeouts();
      const { fetch, received } = hangingFetch();
      const client = createPhysiologyClient({ serviceUrl: SERVICE_URL, fetch });
      const caller = live();

      const call: Record<typeof method, () => Promise<unknown>> = {
        createSession: () => client.createSession(CASE_ID, 'left', caller),
        getCase: () => client.getCase('secret-id', caller),
        deleteSession: () => client.deleteSession('secret-id', caller, CLEANUP_REQUEST_TIMEOUT_MS),
      };
      const pending = engineError(call[method]());
      expect(ms).toEqual([limit]);
      expect(received).toHaveLength(1);
      expect(received[0]).not.toBe(caller);
      expect(received[0].aborted).toBe(false);

      const reason = new DOMException('timed out', 'TimeoutError');
      controllers[0].abort(reason);
      expect(received[0].aborted).toBe(true);
      expect(received[0].reason).toBe(reason);
      expect(caller.aborted).toBe(false);

      const err = await pending;
      expect(err.kind).toBe('timeout');
      expect(err.message).toBe(`${endpoint} did not answer within ${limit / 1000} s`);
      expect(err.message).not.toContain('secret-id');
    },
  );
});

describe('Fake_Service behaviour used by the runner tests', () => {
  it('echoes variant_id, reports a scripted mismatch and counts live Sessions', async () => {
    const plain = setup();
    const signal = live();
    const a = await plain.client.createSession(CASE_ID, 'left', signal);
    const b = await plain.client.createSession(CASE_ID, 'right', signal);
    expect([a.variant_id, b.variant_id]).toEqual(['left', 'right']);
    await plain.client.deleteSession(a.session_id, signal);
    await plain.client.createSession(CASE_ID, 'left', signal);
    expect(plain.fake.maxConcurrentSessions).toBe(2);
    expect(plain.fake.liveSessions()).toHaveLength(2);

    const mismatch = setup({ failures: { variantMismatch: 'right' } });
    const m = await mismatch.client.createSession(CASE_ID, 'left', signal);
    expect(m.variant_id).toBe('right');
    expect(await mismatch.client.getCase(m.session_id, signal)).toEqual(CASE_LEFT);
  });

  it('re-sends the paused sample at 1 Hz with an unchanged simulation_time', async () => {
    const { client, clock, fake } = setup();
    const { session_id: id } = await client.createSession(CASE_ID, 'left', live());
    const stream = listen(fake, id);
    await clock.advance(3000);
    expect(stream.events[0]).toEqual({ type: 'open' });
    expect(stream.messages()).toEqual([
      { ...DEFAULT_FAKE_VITALS, simulation_time: 0 },
      { ...DEFAULT_FAKE_VITALS, simulation_time: 0 },
      { ...DEFAULT_FAKE_VITALS, simulation_time: 0 },
    ]);
  });

  it('sends one tick per simulated second every 1000 / speed ms while playing, from the vitals formula', async () => {
    const { client, clock, fake } = setup({
      vitals: (variantId, t) => ({ heart_rate: t + (variantId === 'right' ? 1000 : 0) }),
    });
    const signal = live();
    const { session_id: id } = await client.createSession(CASE_ID, 'right', signal);
    const stream = listen(fake, id);
    await client.setPlayback(id, { playing: true, speed: '4x' }, signal);
    await clock.advance(1000); // the paused wait of the loop ends at 1000 ms, then the first tick
    expect(stream.times()).toEqual([1]);
    await clock.advance(1000);
    expect(stream.times()).toEqual([1, 2, 3, 4, 5]);
    await client.setPlayback(id, { speed: '1x' }, signal);
    await clock.advance(2000);
    expect(stream.times()).toEqual([1, 2, 3, 4, 5, 6, 7]);
    for (const m of stream.messages()) expect(m.heart_rate).toBe((m.simulation_time as number) + 1000);
  });

  it('pauses when the last socket closes', async () => {
    const { client, clock, fake } = setup();
    const signal = live();
    const { session_id: id } = await client.createSession(CASE_ID, 'left', signal);
    const stream = listen(fake, id);
    await client.setPlayback(id, { playing: true, speed: '4x' }, signal);
    await clock.advance(1000);
    stream.socket.close();
    await clock.advance(1000);
    expect(await client.setPlayback(id, {}, signal)).toEqual({ playing: false, speed: '4x', simulation_time: 1 });
    expect(stream.events.at(-1)).toEqual({ type: 'close', code: 1005, reason: '' });
  });

  it('closes a socket for an unknown Session with code 1008', async () => {
    const { clock, fake } = setup();
    const stream = listen(fake, 'no-such-session');
    await clock.advance(0);
    expect(stream.events).toEqual([
      { type: 'open' },
      { type: 'close', code: 1008, reason: 'Session not found' },
    ]);
    expect(fake.calls).toEqual([{ method: 'WS', path: '/sessions/no-such-session/vitals' }]);
  });

  it('saves a manual Checkpoint After <label> at the current time and passes the applied Interventions to the formula', async () => {
    const { client, clock, fake } = setup({
      vitals: (_v, _t, applied) => ({ tidal_volume: applied.length === 0 ? 1 : 2 }),
    });
    const signal = live();
    const meta = await client.createSession(CASE_ID, 'left', signal);
    const id = meta.session_id;
    const stream = listen(fake, id);
    await client.setPlayback(id, { playing: true, speed: '4x' }, signal);
    await clock.advance(1500); // ticks at 1000, 1250 and 1500 ms
    await client.setPlayback(id, { playing: false }, signal);
    await client.applyIntervention(id, LEFT_INTERVENTION.id, signal);
    await clock.advance(1000); // the next paused re-send carries the new state
    const last = stream.messages().at(-1);
    expect(last).toMatchObject({ simulation_time: 3, tidal_volume: 2 });
    const checkpoints = await client.listCheckpoints(id, meta.current_branch_id, signal);
    expect(checkpoints.at(-1)).toMatchObject({
      simulation_time: 3,
      is_automatic: false,
      description: `After ${LEFT_INTERVENTION.label}`,
    });
  });

  it('runs lateTicksAfterPause further ticks before a pause lands', async () => {
    const { client, clock, fake } = setup({ failures: { lateTicksAfterPause: 2 } });
    const signal = live();
    const { session_id: id } = await client.createSession(CASE_ID, 'left', signal);
    const stream = listen(fake, id);
    await client.setPlayback(id, { playing: true, speed: '4x' }, signal);
    await clock.advance(1000);
    const paused = await client.setPlayback(id, { playing: false }, signal);
    expect(paused).toMatchObject({ playing: false, simulation_time: 3 });
    await clock.advance(0);
    expect(stream.times()).toEqual([1, 2, 3]);
  });

  it('socketClose closes every socket with code 1011 instead of the sample at that time', async () => {
    const { client, clock, fake } = setup({ failures: { socketClose: { atTime: 3 } } });
    const signal = live();
    const { session_id: id } = await client.createSession(CASE_ID, 'left', signal);
    const stream = listen(fake, id);
    await client.setPlayback(id, { playing: true, speed: '4x' }, signal);
    await clock.advance(2000);
    expect(stream.times()).toEqual([1, 2]);
    expect(stream.events.at(-1)).toMatchObject({ type: 'close', code: SCRIPTED_CLOSE_CODE });
    expect((await client.setPlayback(id, {}, signal)).playing).toBe(false);
    expect(fake.liveSessions()).toEqual([id]);
  });

  it('socketError sends an error message instead of the sample at that time and pauses', async () => {
    const { client, clock, fake } = setup({ failures: { socketError: { atTime: 2 } } });
    const signal = live();
    const { session_id: id } = await client.createSession(CASE_ID, 'left', signal);
    const stream = listen(fake, id);
    await client.setPlayback(id, { playing: true, speed: '4x' }, signal);
    await clock.advance(2250);
    const messages = stream.messages();
    expect(messages[0].simulation_time).toBe(1);
    expect(messages[1]).toEqual({ error: SCRIPTED_ERROR_MESSAGE });
    expect(messages.slice(2).map((m) => m.simulation_time)).toEqual([1]);
    expect((await client.setPlayback(id, {}, signal)).playing).toBe(false);
  });

  it('stallAtTime stops every message from that time on', async () => {
    const { client, clock, fake } = setup({ failures: { stallAtTime: 3 } });
    const signal = live();
    const { session_id: id } = await client.createSession(CASE_ID, 'left', signal);
    const stream = listen(fake, id);
    await client.setPlayback(id, { playing: true, speed: '4x' }, signal);
    await clock.advance(10_000);
    expect(stream.times()).toEqual([1, 2]);
    expect(stream.events.some((e) => e.type === 'close')).toBe(false);
  });

  it('gives an unreachable socket an error and then an abnormal close', async () => {
    const { clock, fake } = setup({ failures: { unreachable: true } });
    const stream = listen(fake, 'any');
    await clock.advance(0);
    expect(stream.events).toEqual([{ type: 'error' }, { type: 'close', code: 1006, reason: '' }]);
  });
});
