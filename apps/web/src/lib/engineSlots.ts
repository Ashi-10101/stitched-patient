/**
 * Session_Cap slots and the Session registry (engine-mcp design, "`engineSlots.ts`").
 *
 * `SessionSlots` is a FIFO semaphore with abortable waits (7.1, 7.3, 7.4). `SessionRegistry` holds
 * the Sessions this process created and has not deleted (6.3, 6.5). Pure: no timers, no I/O.
 */

import { EngineError } from './engineClient';

export interface SessionSlots {
  readonly cap: number;
  readonly held: number;
  readonly waiting: number;
  /** Resolves with a release function once a slot is free, in FIFO order (7.1, 7.3).
   *  Rejects with EngineError('cancelled') and leaves the queue if `signal` aborts first (7.4).
   *  Calling release twice is a no-op. */
  acquire(signal: AbortSignal): Promise<() => void>;
}

interface Waiter {
  grant(): void;
}

export function createSessionSlots(cap: number): SessionSlots {
  if (!Number.isInteger(cap) || cap < 1) {
    throw new EngineError('internal', `Session_Cap must be a whole number of at least 1, got ${String(cap)}`);
  }

  let held = 0;
  const queue: Waiter[] = [];

  function makeRelease(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      held -= 1;
      const next = queue.shift();
      if (next) next.grant();
    };
  }

  return {
    cap,
    get held() {
      return held;
    },
    get waiting() {
      return queue.length;
    },
    acquire(signal) {
      if (signal.aborted) {
        return Promise.reject(new EngineError('cancelled', 'Cancelled'));
      }
      if (held < cap && queue.length === 0) {
        held += 1;
        return Promise.resolve(makeRelease());
      }
      return new Promise<() => void>((resolve, reject) => {
        const waiter: Waiter = {
          grant() {
            signal.removeEventListener('abort', onAbort);
            held += 1;
            resolve(makeRelease());
          },
        };
        function onAbort(): void {
          const i = queue.indexOf(waiter);
          if (i >= 0) queue.splice(i, 1);
          reject(new EngineError('cancelled', 'Cancelled'));
        }
        signal.addEventListener('abort', onAbort, { once: true });
        queue.push(waiter);
      });
    },
  };
}

export interface SessionRegistry {
  add(sessionId: string): void;
  remove(sessionId: string): void;
  ids(): readonly string[];
}

/** Insertion-ordered set of session ids; adding an id twice or removing an unknown id is a no-op. */
export function createSessionRegistry(): SessionRegistry {
  const ids = new Set<string>();
  return {
    add(sessionId) {
      ids.add(sessionId);
    },
    remove(sessionId) {
      ids.delete(sessionId);
    },
    ids() {
      return [...ids];
    },
  };
}
