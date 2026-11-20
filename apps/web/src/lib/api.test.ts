import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  api,
  ApiError,
  CASE_TIMEOUT_MS,
  CHECKPOINTS_TIMEOUT_MS,
  FORK_TIMEOUT_MS,
  INTERVENTION_TIMEOUT_MS,
  PLAYBACK_TIMEOUT_MS,
} from './api';

// No real network: every test stubs the global fetch. The stubs honour the abort
// signal the way a real fetch does (reject with an AbortError), so a timeout test
// proves the request was really aborted.

const BASE = 'http://localhost:8000';

function abortError() {
  return new DOMException('Aborted', 'AbortError');
}

/** Reject with an AbortError once the signal aborts (no-op without a signal). */
function rejectOnAbort(signal: AbortSignal | null | undefined, reject: (e: unknown) => void) {
  if (!signal) return;
  if (signal.aborted) {
    reject(abortError());
    return;
  }
  signal.addEventListener('abort', () => reject(abortError()), { once: true });
}

interface FakeResponseOptions {
  status?: number;
  statusText?: string;
  body?: unknown;
  /** Body read never finishes on its own. */
  stallBody?: boolean;
  /** Stalled body read ignores the abort signal. */
  ignoreSignal?: boolean;
}

function fakeResponse(signal: AbortSignal | null | undefined, opts: FakeResponseOptions = {}) {
  const status = opts.status ?? 200;
  const readBody = (value: () => unknown) => {
    if (!opts.stallBody) return Promise.resolve(value());
    return new Promise((_, reject) => {
      if (!opts.ignoreSignal) rejectOnAbort(signal, reject);
    });
  };
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: opts.statusText ?? 'OK',
    json: () => readBody(() => opts.body),
    text: () => readBody(() => (typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body ?? ''))),
  };
}

type FetchArgs = [string, RequestInit | undefined];

/** Fetch whose headers arrive after `delayMs` (0 = immediately); honours the signal while waiting. */
function respondingFetch(opts: FakeResponseOptions = {}, delayMs = 0) {
  return vi.fn((_url: string, init?: RequestInit) => {
    const response = fakeResponse(init?.signal, opts);
    if (delayMs === 0) return Promise.resolve(response);
    return new Promise((resolve, reject) => {
      setTimeout(() => resolve(response), delayMs);
      rejectOnAbort(init?.signal, reject);
    });
  });
}

/** Fetch that never sends headers; rejects only when its signal aborts. */
function stallingFetch() {
  return vi.fn((_url: string, init?: RequestInit) => new Promise((_, reject) => rejectOnAbort(init?.signal, reject)));
}

function track<T>(promise: Promise<T>) {
  const state: { settled: boolean; value?: T; error?: unknown; done: Promise<void> } = {
    settled: false,
    done: Promise.resolve(),
  };
  state.done = promise.then(
    (value) => {
      state.settled = true;
      state.value = value;
    },
    (error) => {
      state.settled = true;
      state.error = error;
    },
  );
  return state;
}

function lastInit(fetchMock: { mock: { calls: unknown[][] } }): RequestInit {
  const calls = fetchMock.mock.calls as FetchArgs[];
  return calls[calls.length - 1][1] as RequestInit;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('timeout constants', () => {
  it('match the design table', () => {
    expect(CASE_TIMEOUT_MS).toBe(10_000);
    expect(INTERVENTION_TIMEOUT_MS).toBe(10_000);
    expect(FORK_TIMEOUT_MS).toBe(30_000);
    expect(PLAYBACK_TIMEOUT_MS).toBe(5_000);
    expect(CHECKPOINTS_TIMEOUT_MS).toBe(10_000);
  });
});

describe('fetchApi with timeoutMs', () => {
  it('resolves when the response arrives before the timeout and leaves no timer', async () => {
    const fetchMock = respondingFetch({ body: { case_id: 'c1' } }, 1_000);
    vi.stubGlobal('fetch', fetchMock);

    const call = track(api.getCaseData('s1', { timeoutMs: CASE_TIMEOUT_MS }));
    await vi.advanceTimersByTimeAsync(1_000);
    await call.done;

    expect(call.error).toBeUndefined();
    expect(call.value).toEqual({ case_id: 'c1' });
    expect(lastInit(fetchMock).signal?.aborted).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects with ApiError(0, "timeout") and aborts the request when no response arrives', async () => {
    const fetchMock = stallingFetch();
    vi.stubGlobal('fetch', fetchMock);

    const call = track(api.getCaseData('s1', { timeoutMs: CASE_TIMEOUT_MS }));
    await vi.advanceTimersByTimeAsync(CASE_TIMEOUT_MS - 1);
    expect(call.settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await call.done;

    expect(call.error).toBeInstanceOf(ApiError);
    expect((call.error as ApiError).status).toBe(0);
    expect((call.error as ApiError).message).toBe('timeout');
    expect(lastInit(fetchMock).signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('times out when headers arrive in time but the body read stalls', async () => {
    const fetchMock = respondingFetch({ stallBody: true });
    vi.stubGlobal('fetch', fetchMock);

    const call = track(api.applyIntervention('s1', 'needle', undefined, { timeoutMs: INTERVENTION_TIMEOUT_MS }));
    await vi.advanceTimersByTimeAsync(INTERVENTION_TIMEOUT_MS);
    await call.done;

    expect(call.error).toBeInstanceOf(ApiError);
    expect((call.error as ApiError).status).toBe(0);
    expect((call.error as ApiError).message).toBe('timeout');
    expect(lastInit(fetchMock).signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('times out even if the stalled body read ignores the abort signal', async () => {
    vi.stubGlobal('fetch', respondingFetch({ stallBody: true, ignoreSignal: true }));

    const call = track(api.forkBranch('s1', 'cp1', undefined, { timeoutMs: FORK_TIMEOUT_MS }));
    await vi.advanceTimersByTimeAsync(FORK_TIMEOUT_MS);
    await call.done;

    expect(call.error).toBeInstanceOf(ApiError);
    expect((call.error as ApiError).status).toBe(0);
    expect((call.error as ApiError).message).toBe('timeout');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('still throws ApiError with the response status on an error status', async () => {
    vi.stubGlobal('fetch', respondingFetch({ status: 500, statusText: 'Internal Server Error', body: 'boom' }));

    const call = track(api.getSession('s1', { timeoutMs: 10_000 }));
    await call.done;

    expect(call.error).toBeInstanceOf(ApiError);
    expect((call.error as ApiError).status).toBe(500);
    expect((call.error as ApiError).message).toBe('boom');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('falls back to statusText when the error body is empty', async () => {
    vi.stubGlobal('fetch', respondingFetch({ status: 404, statusText: 'Not Found', body: '' }));

    const call = track(api.getCheckpoints('s1', 'b1', { timeoutMs: CHECKPOINTS_TIMEOUT_MS }));
    await call.done;

    expect(call.error).toBeInstanceOf(ApiError);
    expect((call.error as ApiError).status).toBe(404);
    expect((call.error as ApiError).message).toBe('Not Found');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rethrows a network error unchanged', async () => {
    const networkError = new TypeError('fetch failed');
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(networkError)),
    );

    const call = track(api.controlPlayback('s1', false, undefined, { timeoutMs: PLAYBACK_TIMEOUT_MS }));
    await call.done;

    expect(call.error).toBe(networkError);
    expect(call.error).not.toBeInstanceOf(ApiError);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('fetchApi without timeoutMs', () => {
  it('creates no timer, passes no signal and never aborts', async () => {
    let resolveFetch: (value: unknown) => void = () => {};
    const fetchMock = vi.fn(
      (_url: string, _init?: RequestInit) =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const call = track(api.getCaseData('s1'));
    await Promise.resolve();

    expect(vi.getTimerCount()).toBe(0);
    expect('signal' in lastInit(fetchMock)).toBe(false);

    await vi.advanceTimersByTimeAsync(120_000);
    expect(call.settled).toBe(false);

    resolveFetch(fakeResponse(undefined, { body: { ok: 1 } }));
    await call.done;

    expect(call.error).toBeUndefined();
    expect(call.value).toEqual({ ok: 1 });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rethrows a network error unchanged', async () => {
    const networkError = new TypeError('fetch failed');
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(networkError)),
    );

    await expect(api.getSession('s1')).rejects.toBe(networkError);
  });
});

describe('each function passes { timeoutMs } through and keeps its request init', () => {
  const cases: Array<{
    name: string;
    call: (opts?: { timeoutMs?: number }) => Promise<unknown>;
    url: string;
    method?: string;
    body?: unknown;
  }> = [
    {
      name: 'getSession',
      call: (o) => api.getSession('s1', o),
      url: `${BASE}/sessions/s1`,
    },
    {
      name: 'getCaseData',
      call: (o) => api.getCaseData('s1', o),
      url: `${BASE}/sessions/s1/case`,
    },
    {
      name: 'controlPlayback',
      call: (o) => api.controlPlayback('s1', true, '2x', o),
      url: `${BASE}/sessions/s1/playback`,
      method: 'POST',
      body: { playing: true, speed: '2x' },
    },
    {
      name: 'applyIntervention',
      call: (o) => api.applyIntervention('s1', 'needle', { side: 'Left' }, o),
      url: `${BASE}/sessions/s1/interventions`,
      method: 'POST',
      body: { intervention_id: 'needle', parameters: { side: 'Left' } },
    },
    {
      name: 'forkBranch',
      call: (o) => api.forkBranch('s1', 'cp1', 'try again', o),
      url: `${BASE}/sessions/s1/fork`,
      method: 'POST',
      body: { checkpoint_id: 'cp1', description: 'try again' },
    },
    {
      name: 'getCheckpoints',
      call: (o) => api.getCheckpoints('s1', 'b1', o),
      url: `${BASE}/sessions/s1/branches/b1/checkpoints`,
    },
  ];

  it.each(cases)('$name', async ({ call, url, method, body }) => {
    const fetchMock = respondingFetch({ body: { ok: true } });
    vi.stubGlobal('fetch', fetchMock);

    await expect(call()).resolves.toEqual({ ok: true });
    await expect(call({ timeoutMs: 5_000 })).resolves.toEqual({ ok: true });

    const calls = fetchMock.mock.calls as FetchArgs[];
    const [withoutUrl, withoutInit] = calls[0];
    const [withUrl, withInit] = calls[1];

    for (const [u, init] of [
      [withoutUrl, withoutInit],
      [withUrl, withInit],
    ] as FetchArgs[]) {
      expect(u).toBe(url);
      expect(init?.method).toBe(method);
      expect(init?.headers).toEqual({ 'Content-Type': 'application/json' });
      if (body === undefined) {
        expect(init?.body).toBeUndefined();
      } else {
        expect(JSON.parse(init?.body as string)).toEqual(body);
      }
    }

    expect('signal' in (withoutInit as RequestInit)).toBe(false);
    expect(withInit?.signal).toBeInstanceOf(AbortSignal);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('applyIntervention sends the same body string with and without timeoutMs', async () => {
    const fetchMock = respondingFetch({ body: {} });
    vi.stubGlobal('fetch', fetchMock);

    await api.applyIntervention('s1', 'needle');
    await api.applyIntervention('s1', 'needle', undefined, { timeoutMs: INTERVENTION_TIMEOUT_MS });

    const calls = fetchMock.mock.calls as FetchArgs[];
    expect(calls[0][1]?.body).toBe(JSON.stringify({ intervention_id: 'needle', parameters: undefined }));
    expect(calls[1][1]?.body).toBe(calls[0][1]?.body);
  });
});
