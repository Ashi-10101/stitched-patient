/**
 * Test double: an `EngineClock` with virtual time (engine-mcp design, "Test doubles").
 *
 * Timers run only inside `advance` and `runUntilSettled`, in due-time order (ties in the order
 * they were set). Between two timers every pending microtask chain runs to completion, so the
 * code under test reacts to one timer before the next one fires. No real time passes: the
 * microtask drain uses `setImmediate`, which waits for no timer.
 */

import type { EngineClock } from '@/lib/engineClient';

export interface FakeClock extends EngineClock {
  /** Runs due timers in time order and awaits pending microtasks between them. */
  advance(ms: number): Promise<void>;
  /** Advances in 250 ms steps until `p` settles; rejects after `limitMs` virtual ms (default 3,600,000). */
  runUntilSettled<T>(p: Promise<T>, limitMs?: number): Promise<T>;
}

const STEP_MS = 250;
const DEFAULT_LIMIT_MS = 3_600_000;

// Captured at import, so a later `vi.useFakeTimers()` in some test cannot replace it.
const realSetImmediate = globalThis.setImmediate;

/** Resolves once every microtask queued so far (and every one those queue) has run. */
export function drainMicrotasks(): Promise<void> {
  return new Promise((resolve) => {
    realSetImmediate(resolve);
  });
}

interface Timer {
  id: number;
  due: number;
  seq: number;
  fn: () => void;
}

export function createFakeClock(startMs = 0): FakeClock {
  let now = startMs;
  let nextId = 1;
  let nextSeq = 0;
  const timers = new Map<number, Timer>();

  function nextDue(limit: number): Timer | undefined {
    let best: Timer | undefined;
    for (const t of timers.values()) {
      if (t.due > limit) continue;
      if (!best || t.due < best.due || (t.due === best.due && t.seq < best.seq)) best = t;
    }
    return best;
  }

  async function advance(ms: number): Promise<void> {
    if (!Number.isFinite(ms) || ms < 0) throw new RangeError(`FakeClock.advance: invalid ms ${ms}`);
    const target = now + ms;
    await drainMicrotasks();
    for (;;) {
      const timer = nextDue(target);
      if (!timer) break;
      timers.delete(timer.id);
      now = Math.max(now, timer.due);
      timer.fn();
      await drainMicrotasks();
    }
    now = target;
    await drainMicrotasks();
  }

  return {
    now: () => now,

    setTimeout(fn, ms) {
      const id = nextId++;
      const delay = Number.isFinite(ms) && ms > 0 ? ms : 0;
      timers.set(id, { id, due: now + delay, seq: nextSeq++, fn });
      return id;
    },

    clearTimeout(handle) {
      if (typeof handle === 'number') timers.delete(handle);
    },

    advance,

    async runUntilSettled<T>(p: Promise<T>, limitMs = DEFAULT_LIMIT_MS): Promise<T> {
      let settled = false;
      let ok = false;
      let value: T | undefined;
      let error: unknown;
      p.then(
        (v) => {
          settled = true;
          ok = true;
          value = v;
        },
        (e: unknown) => {
          settled = true;
          error = e;
        },
      );
      const start = now;
      await drainMicrotasks();
      while (!settled) {
        const elapsed = now - start;
        if (elapsed >= limitMs) {
          throw new Error(`FakeClock.runUntilSettled: still pending after ${limitMs} virtual ms`);
        }
        await advance(Math.min(STEP_MS, limitMs - elapsed));
      }
      if (ok) return value as T;
      throw error;
    },
  };
}
