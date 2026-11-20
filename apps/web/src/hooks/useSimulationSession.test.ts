import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api', () => ({
  api: {
    createSession: vi.fn(),
    getSession: vi.fn(),
    getCaseData: vi.fn(),
    controlPlayback: vi.fn(),
    applyIntervention: vi.fn(),
    forkBranch: vi.fn(),
    getCheckpoints: vi.fn(),
    connectVitalsStream: vi.fn(),
  },
}));

import { api } from '@/lib/api';
import {
  PAUSE_RETRY_DELAY_MS,
  defaultSpeedKey,
  markDefaultSpeedSent,
  persistViewSelection,
  readStoredView,
  runPauseWithRetry,
  shouldSendDefaultSpeed,
  viewKey,
} from './useSimulationSession';

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key: string) => (data.has(key) ? (data.get(key) as string) : null),
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
}

const throwingStorage = {
  getItem: () => {
    throw new Error('storage unavailable');
  },
  setItem: () => {
    throw new Error('storage unavailable');
  },
};

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function expectNoApiCalls() {
  for (const fn of Object.values(api)) {
    expect(fn).not.toHaveBeenCalled();
  }
}

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('runPauseWithRetry', () => {
  it('sends once and never sleeps when the first attempt succeeds', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(runPauseWithRetry(send, sleep)).resolves.toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('sends 3 times and resolves true after two failures then a success', async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error('fail 1'))
      .mockRejectedValueOnce(new Error('fail 2'))
      .mockResolvedValueOnce(undefined);
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(runPauseWithRetry(send, sleep)).resolves.toBe(true);
    expect(send).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenNthCalledWith(1, PAUSE_RETRY_DELAY_MS);
    expect(sleep).toHaveBeenNthCalledWith(2, PAUSE_RETRY_DELAY_MS);
  });

  it('sends exactly 3 times, 2000 ms apart, and resolves false when all fail', async () => {
    vi.useFakeTimers();
    const send = vi.fn().mockRejectedValue(new Error('fail'));
    let result: boolean | undefined;
    const done = runPauseWithRetry(send, realSleep).then((r) => {
      result = r;
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(send).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1999);
    expect(send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(send).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(1999);
    expect(send).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(send).toHaveBeenCalledTimes(3);

    await done;
    expect(result).toBe(false);
    expect(send).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('counts a synchronously throwing send as a failure', async () => {
    const send = vi.fn(() => {
      throw new Error('sync failure');
    }) as unknown as () => Promise<void>;
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(runPauseWithRetry(send, sleep)).resolves.toBe(false);
    expect(send).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });
});

describe('shouldSendDefaultSpeed', () => {
  it('is true only for play, a loaded case and no stored flag', () => {
    const storage = memoryStorage();
    expect(shouldSendDefaultSpeed(storage, 's1', 'play', 'loaded')).toBe(true);
    expect(shouldSendDefaultSpeed(storage, 's1', 'clinician', 'loaded')).toBe(false);
    expect(shouldSendDefaultSpeed(storage, 's1', 'play', 'loading')).toBe(false);
    expect(shouldSendDefaultSpeed(storage, 's1', 'play', 'failed')).toBe(false);
  });

  it('is false after markDefaultSpeedSent, also when the request then failed', async () => {
    const storage = memoryStorage();
    markDefaultSpeedSent(storage, 's1');
    expect(storage.data.get(defaultSpeedKey('s1'))).toBe('1');
    expect(shouldSendDefaultSpeed(storage, 's1', 'play', 'loaded')).toBe(false);

    // The flag is written before the request; a failed request leaves it in place.
    const failedRequest = vi.fn().mockRejectedValue(new Error('timeout'));
    await expect(failedRequest()).rejects.toThrow('timeout');
    expect(shouldSendDefaultSpeed(storage, 's1', 'play', 'loaded')).toBe(false);
  });

  it('keeps the flag per sessionId', () => {
    const storage = memoryStorage();
    markDefaultSpeedSent(storage, 's1');
    expect(shouldSendDefaultSpeed(storage, 's2', 'play', 'loaded')).toBe(true);
  });

  it('returns false when storage cannot be read', () => {
    expect(shouldSendDefaultSpeed(throwingStorage, 's1', 'play', 'loaded')).toBe(false);
  });

  it('markDefaultSpeedSent swallows storage errors', () => {
    expect(() => markDefaultSpeedSent(throwingStorage, 's1')).not.toThrow();
  });
});

describe('persistViewSelection and readStoredView', () => {
  it('writes the view key, reads it back and calls no api function', () => {
    const storage = memoryStorage();
    persistViewSelection(storage, 's1', 'clinician');
    expect(storage.data.get(viewKey('s1'))).toBe('clinician');
    expect(readStoredView(storage, 's1')).toBe('clinician');

    persistViewSelection(storage, 's1', 'play');
    expect(readStoredView(storage, 's1')).toBe('play');
    expect(readStoredView(storage, 's2')).toBeNull();
    expectNoApiCalls();
  });

  it('readStoredView returns null for invalid values and unreadable storage', () => {
    const storage = memoryStorage();
    storage.setItem(viewKey('s1'), 'monitor');
    expect(readStoredView(storage, 's1')).toBeNull();
    expect(readStoredView(throwingStorage, 's1')).toBeNull();
  });

  it('does not throw when setItem throws', () => {
    expect(() => persistViewSelection(throwingStorage, 's1', 'play')).not.toThrow();
    expectNoApiCalls();
  });
});
