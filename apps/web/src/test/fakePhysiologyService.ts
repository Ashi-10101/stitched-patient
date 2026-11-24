/**
 * Test double: the Fake_Service (engine-mcp design, "Fake_Service" and "Test doubles").
 *
 * An in-memory model of the parts of the Physiology_Service HTTP and WebSocket contract (F4)
 * that the engine tools depend on. It implements `FetchLike` and `SocketFactory`, so it opens no
 * socket, listens on no port and starts no Pulse_Engine (17.7). All time is the injected
 * FakeClock's virtual time.
 *
 * Modelled behaviour, following `services/physiology/main.py` and `session_manager.py`:
 * - One clock loop per Session. Paused: re-send the cached vitals every 1000 ms with an unchanged
 *   `simulation_time`. Playing: advance one simulated second, send the sample, wait 1000 / speed ms.
 *   The loop starts paused at creation; its first re-send is 1000 ms later.
 * - `POST /sessions` echoes `variant_id`; 404 for an unknown case, 400 for a bad `variant_id`.
 *   A `null` or omitted `variant_id` picks the first Variant (a deterministic Variant_Source).
 * - `POST /sessions/{id}/interventions` returns no Checkpoint but saves a manual Checkpoint
 *   `After <label>` at the current Simulation_Time; 400 for an unknown intervention id.
 * - Automatic Checkpoints: "Initial state" at 0 and one every 30 simulated seconds.
 * - The last socket that closes sets `playing = false`. A socket for an unknown Session is accepted
 *   and then closed with code 1008.
 * - Messages are delivered as JSON text (`ev.data` is a string), in order, on the microtask queue.
 *
 * Scripted failures (`failures`), as in the design table "Fake_Service scripts used":
 * - `unreachable`: every `fetch` rejects with `TypeError('fetch failed')`; a socket gets `error`
 *   then `close` (1006). Calls are still recorded.
 * - `healthDelayMs`: `GET /` answers after that many virtual ms. At or above HEALTH_TIMEOUT_MS it
 *   rejects with a `TimeoutError` DOMException at HEALTH_TIMEOUT_MS, as `AbortSignal.timeout` would.
 * - `http`: the matching request (method and path template; the `nth` matching one, 1-based, or
 *   every one without `nth`) answers `status` with `{"detail": detail}` and has no other effect.
 * - `socketClose`, `socketError`, `stallAtTime`: replace the first sample, tick or re-send, whose
 *   `simulation_time` is at or after the given time while a socket is subscribed. Close: every
 *   socket of the Session is closed with code 1011 (then the Session pauses). Error: an
 *   `{"error": "Simulation error: ..."}` message is sent and the Session pauses, like an engine
 *   error. Stall: the Session sends nothing more. In all three the sample is not sent and the
 *   time does not advance. Each fires once per Session.
 * - `deleteFails`: every `DELETE /sessions/{id}` answers 500 and the Session stays live.
 * - `lateTicksAfterPause`: a pause request on a playing Session first runs that many further
 *   ticks, so an Intervention applied right after the pause lands later than requested.
 * - `variantMismatch`: SessionMetadata reports this `variant_id` instead of the chosen one.
 *   The Session still uses the chosen Variant's Resolved_Case and vitals.
 *
 * Vitals come from `vitals(variantId, t, applied)` merged over DEFAULT_FAKE_VITALS. For a case
 * without Variants `variantId` is the empty string. No case value is derived from the vitals.
 */

import {
  HEALTH_TIMEOUT_MS,
  type FetchLike,
  type SocketFactory,
  type VitalsSocket,
} from '@/lib/engineClient';
import type { CaseData, PlaybackSpeed, VitalSigns } from '@/types';
import { CASE_LEFT, CASE_RIGHT } from './caseFixtures';
import type { FakeClock } from './fakeClock';

export interface FakeCase {
  variants?: string[];
  resolve(variantId: string | null): CaseData;
}

export interface AppliedIntervention {
  id: string;
  at: number;
}

export interface FakeHttpFailure {
  method: string;
  pathTemplate: string;
  status: number;
  detail: string;
  nth?: number;
}

export interface FakeServiceFailures {
  unreachable?: boolean;
  healthDelayMs?: number;
  http?: FakeHttpFailure[];
  socketError?: { atTime: number };
  socketClose?: { atTime: number };
  stallAtTime?: number;
  deleteFails?: boolean;
  lateTicksAfterPause?: number;
  variantMismatch?: string;
}

export interface FakeServiceOptions {
  cases?: Record<string, FakeCase>;
  vitals?: (variantId: string, t: number, applied: readonly AppliedIntervention[]) => Partial<VitalSigns>;
  clock: FakeClock; // advances ticks at 1000 / speed ms while playing
  failures?: FakeServiceFailures;
}

export interface FakeCall {
  method: string;
  path: string;
  body?: unknown;
}

export interface FakeService {
  fetch: FetchLike;
  openSocket: SocketFactory;
  readonly calls: readonly FakeCall[];
  readonly liveSessions: () => readonly string[];
  readonly maxConcurrentSessions: number;
  readonly deleted: readonly string[];
}

/** Arbitrary placeholder numbers, not clinical values. Tests that care pass their own `vitals`. */
export const DEFAULT_FAKE_VITALS: Readonly<Omit<VitalSigns, 'simulation_time'>> = {
  heart_rate: 100,
  respiratory_rate: 10,
  spo2: 0.5,
  mean_arterial_pressure: 50,
  etco2: 10,
  tidal_volume: 100,
};

/** The shipped case's Variants, from the case fixtures. */
export const DEFAULT_FAKE_CASES: Readonly<Record<string, FakeCase>> = {
  [CASE_LEFT.id]: {
    variants: ['left', 'right'],
    resolve(variantId) {
      if (variantId === 'left') return CASE_LEFT;
      if (variantId === 'right') return CASE_RIGHT;
      throw new Error(`DEFAULT_FAKE_CASES: no fixture for variant ${String(variantId)}`);
    },
  },
};

export const SCRIPTED_CLOSE_CODE = 1011;
export const SCRIPTED_CLOSE_REASON = 'Fake_Service: scripted close';
export const SCRIPTED_ERROR_MESSAGE = 'Simulation error: Fake_Service scripted error';

const SPEED_MULTIPLIER: Record<PlaybackSpeed, number> = { '1x': 1, '2x': 2, '4x': 4 };
const PAUSED_RESEND_MS = 1000;
const AUTO_CHECKPOINT_INTERVAL_S = 30;

interface FakeCheckpoint {
  checkpoint_id: string;
  simulation_time: number;
  created_at: string;
  is_automatic: boolean;
  description: string | null;
}

interface Session {
  id: string;
  caseId: string;
  variantId: string | null;
  reportedVariantId: string | null;
  caseData: CaseData;
  branchId: string;
  createdAt: string;
  t: number;
  playing: boolean;
  speed: PlaybackSpeed;
  applied: AppliedIntervention[];
  checkpoints: FakeCheckpoint[];
  lastCheckpointTime: number;
  lastVitals: VitalSigns;
  subscribers: Set<FakeSocket>;
  timer: unknown;
  alive: boolean;
  stalled: boolean;
  closeFired: boolean;
  errorFired: boolean;
}

interface FakeResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

function respond(status: number, body: unknown): FakeResponse {
  const text = JSON.stringify(body);
  return { ok: status >= 200 && status < 300, status, text: async () => text };
}

function validationError(loc: string[], msg: string): FakeResponse {
  return respond(422, { detail: [{ loc, msg, type: 'value_error' }] });
}

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

class FakeSocket implements VitalsSocket {
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onclose: ((ev: { code: number; reason: string }) => void) | null = null;
  state: 'connecting' | 'open' | 'closed' = 'connecting';

  constructor(private readonly onClientClose: (socket: FakeSocket) => void) {}

  close(code?: number, reason?: string): void {
    if (this.state === 'closed') return;
    this.state = 'closed';
    this.onClientClose(this);
    const ev = { code: code ?? 1005, reason: reason ?? '' };
    queueMicrotask(() => this.onclose?.(ev));
  }

  /** Server side: deliver one text message, unless the socket has closed by then. */
  deliver(payload: unknown): void {
    const data = JSON.stringify(payload);
    queueMicrotask(() => {
      if (this.state === 'open') this.onmessage?.({ data });
    });
  }

  /** Server side: close the connection. */
  serverClose(code: number, reason: string): void {
    if (this.state === 'closed') return;
    this.state = 'closed';
    queueMicrotask(() => this.onclose?.({ code, reason }));
  }
}

export function createFakeService(opts: FakeServiceOptions): FakeService {
  const { clock } = opts;
  const cases = opts.cases ?? DEFAULT_FAKE_CASES;
  const failures = opts.failures ?? {};
  const vitalsFormula = opts.vitals ?? (() => ({}));

  const calls: FakeCall[] = [];
  const deleted: string[] = [];
  const sessions = new Map<string, Session>();
  const httpCounts = new Map<FakeHttpFailure, number>();
  let sessionCount = 0;
  let checkpointCount = 0;
  let maxConcurrentSessions = 0;

  const isoNow = (): string => new Date(clock.now()).toISOString();

  function vitalsAt(s: Session, t: number): VitalSigns {
    const applied = s.applied.map((a) => ({ ...a }));
    return { ...DEFAULT_FAKE_VITALS, ...vitalsFormula(s.variantId ?? '', t, applied), simulation_time: t };
  }

  function addCheckpoint(s: Session, isAutomatic: boolean, description: string | null): void {
    checkpointCount += 1;
    s.checkpoints.push({
      checkpoint_id: `fake-checkpoint-${checkpointCount}`,
      simulation_time: s.t,
      created_at: isoNow(),
      is_automatic: isAutomatic,
      description,
    });
    s.lastCheckpointTime = s.t;
  }

  function broadcast(s: Session, payload: unknown): void {
    for (const socket of s.subscribers) socket.deliver(payload);
  }

  function unsubscribe(s: Session, socket: FakeSocket): void {
    if (!s.subscribers.delete(socket)) return;
    if (s.subscribers.size === 0) s.playing = false;
  }

  /** A scripted stream event replaces the sample at `time`. Returns true when one fired. */
  function scriptedStreamEvent(s: Session, time: number): boolean {
    if (s.subscribers.size === 0) return false;
    if (failures.stallAtTime !== undefined && time >= failures.stallAtTime) {
      s.stalled = true;
      return true;
    }
    if (failures.socketClose && !s.closeFired && time >= failures.socketClose.atTime) {
      s.closeFired = true;
      for (const socket of [...s.subscribers]) {
        socket.serverClose(SCRIPTED_CLOSE_CODE, SCRIPTED_CLOSE_REASON);
        unsubscribe(s, socket);
      }
      return true;
    }
    if (failures.socketError && !s.errorFired && time >= failures.socketError.atTime) {
      s.errorFired = true;
      s.playing = false;
      broadcast(s, { error: SCRIPTED_ERROR_MESSAGE });
      return true;
    }
    return false;
  }

  function tick(s: Session): void {
    if (!s.alive || s.stalled) return;
    const target = s.t + 1;
    if (scriptedStreamEvent(s, target)) return;
    s.t = target;
    s.lastVitals = vitalsAt(s, target);
    if (target - s.lastCheckpointTime >= AUTO_CHECKPOINT_INTERVAL_S) addCheckpoint(s, true, null);
    broadcast(s, s.lastVitals);
  }

  function loopIteration(s: Session): void {
    s.timer = undefined;
    if (!s.alive || s.stalled) return;
    if (s.playing) {
      tick(s);
      if (!s.alive || s.stalled) return;
      s.timer = clock.setTimeout(() => loopIteration(s), PAUSED_RESEND_MS / SPEED_MULTIPLIER[s.speed]);
      return;
    }
    if (!scriptedStreamEvent(s, s.lastVitals.simulation_time)) broadcast(s, s.lastVitals);
    if (!s.alive || s.stalled) return;
    s.timer = clock.setTimeout(() => loopIteration(s), PAUSED_RESEND_MS);
  }

  function metadata(s: Session): unknown {
    return {
      session_id: s.id,
      case_id: s.caseId,
      variant_id: s.reportedVariantId,
      created_at: s.createdAt,
      current_branch_id: s.branchId,
      branches: [
        {
          branch_id: s.branchId,
          parent_branch_id: null,
          forked_from_checkpoint: null,
          created_at: s.createdAt,
          event_count: s.applied.length,
        },
      ],
    };
  }

  function liveCount(): number {
    let n = 0;
    for (const s of sessions.values()) if (s.alive) n += 1;
    return n;
  }

  function createSession(body: unknown): FakeResponse {
    if (!isObject(body) || typeof body.case_id !== 'string') {
      return validationError(['body', 'case_id'], 'Field required');
    }
    const requested = body.variant_id;
    if (requested !== undefined && requested !== null && typeof requested !== 'string') {
      return validationError(['body', 'variant_id'], 'Input should be a valid string');
    }
    const caseId = body.case_id;
    const fakeCase = Object.prototype.hasOwnProperty.call(cases, caseId) ? cases[caseId] : undefined;
    if (!fakeCase) return respond(404, { detail: `Case not found: ${caseId}` });
    const ids = fakeCase.variants ?? [];
    let variantId: string | null;
    if (ids.length === 0) {
      if (typeof requested === 'string') {
        return respond(400, {
          detail: `Case '${caseId}' has no variants; omit variant_id or send null (got '${requested}')`,
        });
      }
      variantId = null;
    } else if (typeof requested === 'string') {
      if (!ids.includes(requested)) {
        return respond(400, {
          detail: `Unknown variant_id: '${requested}'. Valid variant ids: ${ids.join(', ')}`,
        });
      }
      variantId = requested;
    } else {
      variantId = ids[0];
    }

    sessionCount += 1;
    const id = `fake-session-${sessionCount}`;
    const createdAt = isoNow();
    const s: Session = {
      id,
      caseId,
      variantId,
      reportedVariantId: failures.variantMismatch ?? variantId,
      caseData: structuredClone(fakeCase.resolve(variantId)),
      branchId: `fake-branch-${sessionCount}-1`,
      createdAt,
      t: 0,
      playing: false,
      speed: '1x',
      applied: [],
      checkpoints: [],
      lastCheckpointTime: 0,
      lastVitals: { ...DEFAULT_FAKE_VITALS, simulation_time: 0 },
      subscribers: new Set(),
      timer: undefined,
      alive: true,
      stalled: false,
      closeFired: false,
      errorFired: false,
    };
    s.lastVitals = vitalsAt(s, 0);
    addCheckpoint(s, true, 'Initial state');
    sessions.set(id, s);
    maxConcurrentSessions = Math.max(maxConcurrentSessions, liveCount());
    s.timer = clock.setTimeout(() => loopIteration(s), PAUSED_RESEND_MS);
    return respond(200, metadata(s));
  }

  function deleteSession(s: Session): FakeResponse {
    if (failures.deleteFails) return respond(500, { detail: 'Fake_Service: scripted DELETE failure' });
    s.alive = false;
    if (s.timer !== undefined) clock.clearTimeout(s.timer);
    s.timer = undefined;
    deleted.push(s.id);
    return respond(200, { status: 'deleted' });
  }

  function setPlayback(s: Session, body: unknown): FakeResponse {
    if (!isObject(body)) return validationError(['body'], 'Input should be a valid object');
    const { playing, speed } = body;
    if (playing !== undefined && playing !== null && typeof playing !== 'boolean') {
      return validationError(['body', 'playing'], 'Input should be a valid boolean');
    }
    if (speed !== undefined && speed !== null && !(typeof speed === 'string' && speed in SPEED_MULTIPLIER)) {
      return validationError(['body', 'speed'], "Input should be '1x', '2x' or '4x'");
    }
    if (playing === false && s.playing) {
      for (let i = 0; i < (failures.lateTicksAfterPause ?? 0); i += 1) tick(s);
    }
    if (typeof playing === 'boolean') s.playing = playing;
    if (typeof speed === 'string') s.speed = speed as PlaybackSpeed;
    return respond(200, { playing: s.playing, speed: s.speed, simulation_time: s.t });
  }

  function applyIntervention(s: Session, body: unknown): FakeResponse {
    if (!isObject(body) || typeof body.intervention_id !== 'string') {
      return validationError(['body', 'intervention_id'], 'Field required');
    }
    const interventionId = body.intervention_id;
    const intervention = s.caseData.interventions.find((i) => i.id === interventionId);
    if (!intervention) {
      const valid = s.caseData.interventions.map((i) => i.id).join(', ');
      return respond(400, { detail: `Unknown intervention: '${interventionId}'. Valid ids: ${valid}` });
    }
    s.applied.push({ id: interventionId, at: s.t });
    s.lastVitals = vitalsAt(s, s.t);
    addCheckpoint(s, false, `After ${intervention.label}`);
    return respond(200, { status: 'applied', intervention_id: interventionId });
  }

  interface Route {
    template: string;
    handle: () => FakeResponse;
  }

  /** Finds the route of a request: its path template and handler, or a 404 or 405 answer. */
  function route(method: string, path: string, body: unknown): Route | { template: string; status: 404 | 405 } {
    const parts = path.split('/').slice(1).map((p) => {
      try {
        return decodeURIComponent(p);
      } catch {
        return p;
      }
    });
    const notFound = (): FakeResponse => respond(404, { detail: 'Session not found' });
    const session = (id: string): Session | undefined => {
      const s = sessions.get(id);
      return s && s.alive ? s : undefined;
    };
    const one = (template: string, allowed: string, handle: () => FakeResponse) =>
      method === allowed ? { template, handle } : { template, status: 405 as const };

    if (path === '/') {
      return one('/', 'GET', () => respond(200, { service: 'fake-physiology', status: 'running', version: '0' }));
    }
    if (path === '/cases') return one('/cases', 'GET', () => respond(200, Object.keys(cases)));
    if (path === '/sessions') return one('/sessions', 'POST', () => createSession(body));
    if (parts[0] === 'sessions' && parts.length === 2) {
      const template = '/sessions/{id}';
      const s = session(parts[1]);
      if (method === 'GET') return { template, handle: () => (s ? respond(200, metadata(s)) : notFound()) };
      if (method === 'DELETE') return { template, handle: () => (s ? deleteSession(s) : notFound()) };
      return { template, status: 405 };
    }
    if (parts[0] === 'sessions' && parts.length === 3) {
      const s = session(parts[1]);
      const withSession = (f: (x: Session) => FakeResponse) => () => (s ? f(s) : notFound());
      if (parts[2] === 'case') {
        return one('/sessions/{id}/case', 'GET', withSession((x) => respond(200, structuredClone(x.caseData))));
      }
      if (parts[2] === 'playback') {
        return one('/sessions/{id}/playback', 'POST', withSession((x) => setPlayback(x, body)));
      }
      if (parts[2] === 'interventions') {
        return one('/sessions/{id}/interventions', 'POST', withSession((x) => applyIntervention(x, body)));
      }
    }
    if (parts[0] === 'sessions' && parts.length === 5 && parts[2] === 'branches' && parts[4] === 'checkpoints') {
      const s = session(parts[1]);
      const branchId = parts[3];
      return one('/sessions/{id}/branches/{branch_id}/checkpoints', 'GET', () => {
        if (!s) return notFound();
        if (branchId !== s.branchId) return respond(404, { detail: 'Branch not found' });
        return respond(200, s.checkpoints.map((c) => ({ ...c })));
      });
    }
    return { template: path, status: 404 };
  }

  function scriptedHttp(method: string, template: string): FakeHttpFailure | undefined {
    let hit: FakeHttpFailure | undefined;
    for (const f of failures.http ?? []) {
      if (f.method !== method || f.pathTemplate !== template) continue;
      const n = (httpCounts.get(f) ?? 0) + 1;
      httpCounts.set(f, n);
      if (!hit && (f.nth === undefined || f.nth === n)) hit = f;
    }
    return hit;
  }

  function wait(ms: number, signal: AbortSignal | undefined): Promise<void> {
    return new Promise((resolve, reject) => {
      const onAbort = (): void => {
        clock.clearTimeout(handle);
        reject(signal?.reason);
      };
      const handle = clock.setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  const fetch: FetchLike = async (url, init = {}) => {
    const method = init.method ?? 'GET';
    const parsed = new URL(url);
    const path = parsed.pathname;
    let body: unknown;
    let badJson = false;
    if (init.body !== undefined) {
      try {
        body = JSON.parse(init.body);
      } catch {
        badJson = true;
        body = init.body;
      }
    }
    calls.push(init.body === undefined ? { method, path } : { method, path, body });

    if (init.signal?.aborted) throw init.signal.reason;
    if (failures.unreachable) throw new TypeError('fetch failed');

    const r = route(method, path, body);
    const failure = scriptedHttp(method, r.template);
    if (failure) return respond(failure.status, { detail: failure.detail });

    if (r.template === '/' && method === 'GET' && failures.healthDelayMs !== undefined) {
      if (failures.healthDelayMs >= HEALTH_TIMEOUT_MS) {
        await wait(HEALTH_TIMEOUT_MS, init.signal);
        throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
      }
      await wait(failures.healthDelayMs, init.signal);
    }

    if ('status' in r) return respond(r.status, { detail: r.status === 404 ? 'Not Found' : 'Method Not Allowed' });
    if (badJson) return validationError(['body'], 'JSON decode error');
    return r.handle();
  };

  const openSocket: SocketFactory = (url) => {
    let parsed: URL | undefined;
    try {
      parsed = new URL(url);
    } catch {
      parsed = undefined;
    }
    calls.push({ method: 'WS', path: parsed ? parsed.pathname : url });

    let target: Session | undefined;
    const socket = new FakeSocket((sock) => {
      if (target) unsubscribe(target, sock);
    });
    const match = parsed ? /^\/sessions\/([^/]+)\/vitals$/.exec(parsed.pathname) : null;
    const wsScheme = parsed !== undefined && (parsed.protocol === 'ws:' || parsed.protocol === 'wss:');

    if (failures.unreachable || !wsScheme || !match) {
      // The handshake fails: error, then an abnormal close.
      socket.state = 'closed';
      queueMicrotask(() => {
        socket.onerror?.({ type: 'error' });
        socket.onclose?.({ code: 1006, reason: '' });
      });
      return socket;
    }

    const id = decodeURIComponent(match[1]);
    queueMicrotask(() => {
      if (socket.state !== 'connecting') return;
      socket.state = 'open';
      const s = sessions.get(id);
      socket.onopen?.({ type: 'open' });
      if (!s || !s.alive) {
        socket.serverClose(1008, 'Session not found');
        return;
      }
      target = s;
      s.subscribers.add(socket);
    });
    return socket;
  };

  return {
    fetch,
    openSocket,
    calls,
    liveSessions: () => [...sessions.values()].filter((s) => s.alive).map((s) => s.id),
    get maxConcurrentSessions() {
      return maxConcurrentSessions;
    },
    deleted,
  };
}
