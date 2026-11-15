/**
 * API client for physiology service.
 */

const PHYSIOLOGY_URL = process.env.NEXT_PUBLIC_PHYSIOLOGY_URL || 'http://localhost:8000';

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

async function fetchApi<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${PHYSIOLOGY_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new ApiError(response.status, error || response.statusText);
  }

  return response.json();
}

export const api = {
  async createSession(caseId: string) {
    return fetchApi<any>('/sessions', {
      method: 'POST',
      body: JSON.stringify({ case_id: caseId }),
    });
  },

  async getSession(sessionId: string) {
    return fetchApi<any>(`/sessions/${sessionId}`);
  },

  async getCaseData(sessionId: string) {
    return fetchApi<any>(`/sessions/${sessionId}/case`);
  },

  async controlPlayback(sessionId: string, playing?: boolean, speed?: string) {
    return fetchApi<any>(`/sessions/${sessionId}/playback`, {
      method: 'POST',
      body: JSON.stringify({ playing, speed }),
    });
  },

  async applyIntervention(sessionId: string, interventionId: string, parameters?: Record<string, any>) {
    return fetchApi<any>(`/sessions/${sessionId}/interventions`, {
      method: 'POST',
      body: JSON.stringify({ intervention_id: interventionId, parameters }),
    });
  },

  async forkBranch(sessionId: string, checkpointId: string, description?: string) {
    return fetchApi<any>(`/sessions/${sessionId}/fork`, {
      method: 'POST',
      body: JSON.stringify({ checkpoint_id: checkpointId, description }),
    });
  },

  async getCheckpoints(sessionId: string, branchId: string) {
    return fetchApi<any>(`/sessions/${sessionId}/branches/${branchId}/checkpoints`);
  },

  connectVitalsStream(sessionId: string): WebSocket {
    const wsUrl = PHYSIOLOGY_URL.replace(/^http/, 'ws');
    return new WebSocket(`${wsUrl}/sessions/${sessionId}/vitals`);
  },
};
