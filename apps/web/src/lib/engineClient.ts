/**
 * HTTP client and seams for the engine tools (engine-mcp design, "`engineClient.ts`").
 *
 * Every effect comes in through an argument: the `FetchLike` passed to `createPhysiologyClient`
 * and the `SocketFactory` and `EngineClock` passed to the runner. This module imports no `node:`
 * module, no SDK and no `zod`, and uses no global `fetch`, `WebSocket`, clock or file system (D17).
 * The numbers below are tool constants, not clinical values.
 */

import type { CaseData, CheckpointMetadata, PlaybackSpeed, PlaybackState, SessionMetadata } from '@/types';

export const DEFAULT_SERVICE_URL = 'http://localhost:8000';
export const DEFAULT_SESSION_CAP = 4; // 1..8 (7.2)
export const HEALTH_TIMEOUT_MS = 3_000; // Health_Check (glossary)
export const REQUEST_TIMEOUT_MS = 30_000; // every other request
export const CREATE_SESSION_TIMEOUT_MS = 120_000; // engine load under emulation
export const CLEANUP_REQUEST_TIMEOUT_MS = 4_000; // pause and DELETE in cleanup (6.2: 5 s budget)
export const SHUTDOWN_BUDGET_MS = 10_000; // 6.3
export const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const MIN_SESSION_CAP = 1;
const MAX_SESSION_CAP = 8;
const DETAIL_MAX_CHARS = 500;

export type FetchLike = (
  url: string,
  init?: {
    method?: 'GET' | 'POST' | 'DELETE';
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

/** The subset of the WHATWG WebSocket that the runner uses. */
export interface VitalsSocket {
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onclose: ((ev: { code: number; reason: string }) => void) | null;
  close(code?: number, reason?: string): void;
}
export type SocketFactory = (url: string) => VitalsSocket;

/** Wall-clock seam. Defined here so the fake clock can exist before the runner; `engineRunner.ts` re-exports it. */
export interface EngineClock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export type EngineErrorKind =
  | 'config'
  | 'input'
  | 'case'
  | 'unreachable'
  | 'http'
  | 'timeout'
  | 'variant'
  | 'plan'
  | 'checkpoint'
  | 'stream'
  | 'stall'
  | 'cancelled'
  | 'internal';

export class EngineError extends Error {
  constructor(
    readonly kind: EngineErrorKind,
    message: string,
    readonly details?: { endpoint?: string; status?: number; serviceMessage?: string },
  ) {
    super(message);
    this.name = 'EngineError';
  }
}

/** 1.9: absolute http(s) URL; trailing slash removed. Throws EngineError('config') naming the value. */
export function parseServiceUrl(raw: string | undefined): string {
  if (raw === undefined) return DEFAULT_SERVICE_URL;
  const invalid = (): EngineError =>
    new EngineError(
      'config',
      `Invalid Physiology_Service URL ${JSON.stringify(raw)}: expected an absolute http or https URL ` +
        'such as http://localhost:8000, with no query, fragment or credentials',
    );
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw invalid();
  }
  if (
    raw !== raw.trim() ||
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.hostname === '' ||
    url.search !== '' ||
    url.hash !== '' ||
    url.username !== '' ||
    url.password !== ''
  ) {
    throw invalid();
  }
  return `${url.origin}${url.pathname}`.replace(/\/+$/, '');
}

/** 1.9, 7.2: whole number 1..8; undefined gives DEFAULT_SESSION_CAP. Throws EngineError('config') naming value and range. */
export function parseSessionCap(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_SESSION_CAP;
  const value = /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isInteger(value) || value < MIN_SESSION_CAP || value > MAX_SESSION_CAP) {
    throw new EngineError(
      'config',
      `Invalid Session_Cap ${JSON.stringify(raw)}: expected a whole number from ${MIN_SESSION_CAP} to ${MAX_SESSION_CAP}`,
    );
  }
  return value;
}

/** The Unreachable_Error text (glossary). */
export function unreachableMessage(serviceUrl: string): string {
  return (
    `The Physiology_Service at ${serviceUrl} is not reachable. Start it in your own terminal ` +
    '(for example: docker compose up physiology) or set PHYSIOLOGY_URL to its address. ' +
    'This tool does not start the service.'
  );
}

/** `serviceUrl.replace(/^http/, 'ws') + '/sessions/' + encodeURIComponent(id) + '/vitals'` (F5). */
export function vitalsUrl(serviceUrl: string, sessionId: string): string {
  return serviceUrl.replace(/^http/, 'ws') + '/sessions/' + encodeURIComponent(sessionId) + '/vitals';
}

export interface PhysiologyClient {
  readonly serviceUrl: string;
  health(signal: AbortSignal): Promise<void>; // GET /
  listCases(signal: AbortSignal): Promise<string[]>; // GET /cases
  createSession(caseId: string, variantId: string, signal: AbortSignal): Promise<SessionMetadata>;
  getCase(sessionId: string, signal: AbortSignal): Promise<CaseData>; // GET /sessions/{id}/case
  setPlayback(
    sessionId: string,
    body: { playing?: boolean; speed?: PlaybackSpeed },
    signal: AbortSignal,
    timeoutMs?: number,
  ): Promise<PlaybackState>;
  applyIntervention(sessionId: string, interventionId: string, signal: AbortSignal): Promise<void>;
  listCheckpoints(sessionId: string, branchId: string, signal: AbortSignal): Promise<CheckpointMetadata[]>;
  deleteSession(sessionId: string, signal: AbortSignal, timeoutMs?: number): Promise<void>;
}

type Method = 'GET' | 'POST' | 'DELETE';

interface RequestSpec {
  method: Method;
  /** Real path, with encoded ids. */
  path: string;
  /** Path with `{id}` and `{branch_id}`, used in every error text so it carries no session id. */
  template: string;
  timeoutMs: number;
  body?: unknown;
  /** The Health_Check: every failure, including a timeout and a non-2xx answer, is the Unreachable_Error (1.6). */
  health?: boolean;
}

function isTimeout(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'TimeoutError';
}

/** FastAPI's string `detail`, else the body text cut to 500 characters (1.7). */
function detailOf(text: string): string {
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed === 'object' && parsed !== null) {
      const detail = (parsed as { detail?: unknown }).detail;
      if (typeof detail === 'string') return detail;
    }
  } catch {
    // Not JSON: fall through to the body text.
  }
  return text === '' ? '(empty response body)' : text.slice(0, DETAIL_MAX_CHARS);
}

function seg(id: string): string {
  return encodeURIComponent(id);
}

export function createPhysiologyClient(opts: { serviceUrl: string; fetch: FetchLike }): PhysiologyClient {
  const { serviceUrl } = opts;
  const fetchImpl = opts.fetch;

  const unreachable = (): EngineError => new EngineError('unreachable', unreachableMessage(serviceUrl));
  const cancelled = (endpoint: string): EngineError => new EngineError('cancelled', 'Cancelled', { endpoint });

  async function request(spec: RequestSpec, signal: AbortSignal): Promise<unknown> {
    const endpoint = `${spec.method} ${spec.template}`;
    if (signal.aborted) throw cancelled(endpoint);

    const init: NonNullable<Parameters<FetchLike>[1]> = {
      method: spec.method,
      signal: AbortSignal.any([signal, AbortSignal.timeout(spec.timeoutMs)]),
    };
    if (spec.body !== undefined) {
      init.headers = { 'Content-Type': 'application/json' };
      init.body = JSON.stringify(spec.body);
    }

    let ok: boolean;
    let status: number;
    let text: string;
    try {
      const res = await fetchImpl(serviceUrl + spec.path, init);
      ok = res.ok;
      status = res.status;
      text = await res.text();
    } catch (err) {
      if (signal.aborted) throw cancelled(endpoint);
      if (spec.health) throw unreachable();
      if (isTimeout(err)) {
        throw new EngineError('timeout', `${endpoint} did not answer within ${spec.timeoutMs / 1000} s`, {
          endpoint,
        });
      }
      // A network failure such as Node's `TypeError: fetch failed` (1.6).
      throw unreachable();
    }

    if (!ok) {
      if (spec.health) throw unreachable();
      const detail = detailOf(text);
      throw new EngineError('http', `${endpoint} returned HTTP ${status}: ${detail}`, {
        endpoint,
        status,
        serviceMessage: detail,
      });
    }
    if (spec.health) return undefined;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new EngineError('http', `${endpoint} returned HTTP ${status}: the response is not JSON`, {
        endpoint,
        status,
      });
    }
  }

  return {
    serviceUrl,

    async health(signal) {
      await request({ method: 'GET', path: '/', template: '/', timeoutMs: HEALTH_TIMEOUT_MS, health: true }, signal);
    },

    async listCases(signal) {
      const data = await request(
        { method: 'GET', path: '/cases', template: '/cases', timeoutMs: REQUEST_TIMEOUT_MS },
        signal,
      );
      if (!Array.isArray(data) || !data.every((x) => typeof x === 'string')) {
        throw new EngineError('http', 'GET /cases returned HTTP 200: the response is not a list of case ids', {
          endpoint: 'GET /cases',
          status: 200,
        });
      }
      return data as string[];
    },

    async createSession(caseId, variantId, signal) {
      return (await request(
        {
          method: 'POST',
          path: '/sessions',
          template: '/sessions',
          timeoutMs: CREATE_SESSION_TIMEOUT_MS,
          body: { case_id: caseId, variant_id: variantId },
        },
        signal,
      )) as SessionMetadata;
    },

    async getCase(sessionId, signal) {
      return (await request(
        {
          method: 'GET',
          path: `/sessions/${seg(sessionId)}/case`,
          template: '/sessions/{id}/case',
          timeoutMs: REQUEST_TIMEOUT_MS,
        },
        signal,
      )) as CaseData;
    },

    async setPlayback(sessionId, body, signal, timeoutMs = REQUEST_TIMEOUT_MS) {
      return (await request(
        {
          method: 'POST',
          path: `/sessions/${seg(sessionId)}/playback`,
          template: '/sessions/{id}/playback',
          timeoutMs,
          body,
        },
        signal,
      )) as PlaybackState;
    },

    async applyIntervention(sessionId, interventionId, signal) {
      await request(
        {
          method: 'POST',
          path: `/sessions/${seg(sessionId)}/interventions`,
          template: '/sessions/{id}/interventions',
          timeoutMs: REQUEST_TIMEOUT_MS,
          body: { intervention_id: interventionId },
        },
        signal,
      );
    },

    async listCheckpoints(sessionId, branchId, signal) {
      return (await request(
        {
          method: 'GET',
          path: `/sessions/${seg(sessionId)}/branches/${seg(branchId)}/checkpoints`,
          template: '/sessions/{id}/branches/{branch_id}/checkpoints',
          timeoutMs: REQUEST_TIMEOUT_MS,
        },
        signal,
      )) as CheckpointMetadata[];
    },

    async deleteSession(sessionId, signal, timeoutMs = REQUEST_TIMEOUT_MS) {
      await request(
        {
          method: 'DELETE',
          path: `/sessions/${seg(sessionId)}`,
          template: '/sessions/{id}',
          timeoutMs,
        },
        signal,
      );
    },
  };
}
