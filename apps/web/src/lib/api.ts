/**
 * API client for physiology service.
 */

const PHYSIOLOGY_URL = process.env.NEXT_PUBLIC_PHYSIOLOGY_URL || 'http://localhost:8000';

/**
 * Per-request timeouts (milliseconds) from the play-mode design, "API client change".
 * These are UI constants, not clinical values.
 */
export const CASE_TIMEOUT_MS = 10_000;
export const INTERVENTION_TIMEOUT_MS = 10_000;
export const FORK_TIMEOUT_MS = 30_000;
export const PLAYBACK_TIMEOUT_MS = 5_000;
export const CHECKPOINTS_TIMEOUT_MS = 10_000;

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface RequestOptions {
  /** Abort the whole call (headers and body) after this many milliseconds. */
  timeoutMs?: number;
}

async function sendRequest<T>(path: string, options: RequestInit | undefined, signal?: AbortSignal): Promise<T> {
  const init: RequestInit = {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  };
  if (signal) {
    init.signal = signal;
  }

  const response = await fetch(`${PHYSIOLOGY_URL}${path}`, init);

  if (!response.ok) {
    const error = await response.text();
    throw new ApiError(response.status, error || response.statusText);
  }

  return response.json();
}

async function fetchApi<T>(path: string, options?: RequestInit, timeoutMs?: number): Promise<T> {
  if (timeoutMs === undefined) {
    return sendRequest<T>(path, options);
  }

  const controller = new AbortController();
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  // Rejects when the timer fires. Racing against it makes the timeout hold even if a
  // body read ignores the abort signal.
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(new ApiError(0, 'timeout'));
    }, timeoutMs);
  });

  try {
    return await Promise.race([sendRequest<T>(path, options, controller.signal), timeout]);
  } catch (err) {
    if (timedOut) {
      throw new ApiError(0, 'timeout');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export const api = {
  async createSession(caseId: string) {
    return fetchApi<any>('/sessions', {
      method: 'POST',
      body: JSON.stringify({ case_id: caseId }),
    });
  },

  async getSession(sessionId: string, opts?: RequestOptions) {
    return fetchApi<any>(`/sessions/${sessionId}`, undefined, opts?.timeoutMs);
  },

  async getCaseData(sessionId: string, opts?: RequestOptions) {
    return fetchApi<any>(`/sessions/${sessionId}/case`, undefined, opts?.timeoutMs);
  },

  async controlPlayback(sessionId: string, playing?: boolean, speed?: string, opts?: RequestOptions) {
    return fetchApi<any>(
      `/sessions/${sessionId}/playback`,
      {
        method: 'POST',
        body: JSON.stringify({ playing, speed }),
      },
      opts?.timeoutMs,
    );
  },

  async applyIntervention(
    sessionId: string,
    interventionId: string,
    parameters?: Record<string, any>,
    opts?: RequestOptions,
  ) {
    return fetchApi<any>(
      `/sessions/${sessionId}/interventions`,
      {
        method: 'POST',
        body: JSON.stringify({ intervention_id: interventionId, parameters }),
      },
      opts?.timeoutMs,
    );
  },

  async forkBranch(sessionId: string, checkpointId: string, description?: string, opts?: RequestOptions) {
    return fetchApi<any>(
      `/sessions/${sessionId}/fork`,
      {
        method: 'POST',
        body: JSON.stringify({ checkpoint_id: checkpointId, description }),
      },
      opts?.timeoutMs,
    );
  },

  async getCheckpoints(sessionId: string, branchId: string, opts?: RequestOptions) {
    return fetchApi<any>(`/sessions/${sessionId}/branches/${branchId}/checkpoints`, undefined, opts?.timeoutMs);
  },

  connectVitalsStream(sessionId: string): WebSocket {
    const wsUrl = PHYSIOLOGY_URL.replace(/^http/, 'ws');
    return new WebSocket(`${wsUrl}/sessions/${sessionId}/vitals`);
  },
};
