/**
 * Check-then-fallback gate for Speech_Provider results (patient-speech
 * Requirement 6.4 to 6.9, design "speechGate.ts", D6).
 *
 * Each `request` shows the checked Scripted_Line at once, then asks the
 * provider. A provider result replaces it only when the result is fresh (not a
 * Stale_Result), arrives within the Provider_Timeout and passes the
 * Speech_Check; `null` or `undefined` silences the bubble. Every other outcome
 * keeps the fallback. The gate shows no error message and logs nothing (6.8).
 *
 * The gate has no React dependency, so tests drive it with `FakeClock`. Its
 * output goes only to `onDisplay`, the Displayed_Speech (6.10).
 */

import type { Ending } from './endingEvaluator';
import { speechCheck } from './speechCheck';
import type { SpeechContext, SpeechProvider } from './speechProvider';
import { checkedScriptedLine } from './speechSelector';

/** Provider_Timeout: Wall_Clock_Time from a Speech_Request; a UI constant. */
export const PROVIDER_TIMEOUT_MS = 5000;

/** Timer seam; `FakeClock` from `src/test/fakeClock.ts` fits it. */
export interface SpeechClock {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface SpeechGateOptions {
  provider: SpeechProvider;
  /** Default: the global timers, looked up at each call. */
  clock?: SpeechClock;
  /** Default: PROVIDER_TIMEOUT_MS. */
  timeoutMs?: number;
  /** Current Branch and Ending, read when a result arrives (Stale_Result). */
  current: () => { branchId: string | null; ending: Ending };
  onDisplay: (text: string | null) => void;
}

export interface SpeechGate {
  request(context: Omit<SpeechContext, 'requestNumber'>): void;
  /** Aborts the pending request and clears its timer; its result is discarded. */
  dispose(): void;
}

const globalClock: SpeechClock = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
};

/** One issued Speech_Request until it settles, is replaced, times out or is disposed. */
interface PendingRequest {
  readonly n: number;
  readonly controller: AbortController;
  timer: unknown;
  timedOut: boolean;
}

export function createSpeechGate(options: SpeechGateOptions): SpeechGate {
  const { provider, current, onDisplay } = options;
  const clock = options.clock ?? globalClock;
  const timeoutMs = options.timeoutMs ?? PROVIDER_TIMEOUT_MS;

  let counter = 0;
  let pending: PendingRequest | null = null;

  function clearTimer(p: PendingRequest): void {
    if (p.timer !== null) {
      clock.clearTimeout(p.timer);
      p.timer = null;
    }
  }

  /** Ends the pending request: clears its timer and aborts its signal. */
  function cancelPending(): void {
    const p = pending;
    if (p === null) return;
    pending = null;
    clearTimer(p);
    p.controller.abort();
  }

  function request(context: Omit<SpeechContext, 'requestNumber'>): void {
    // 1. Abort the previous request and clear its timer (6.4).
    cancelPending();

    // 2. Number the request and note the Branch and Ending it was issued for.
    counter += 1;
    const n = counter;
    const issued = { branchId: context.branchId, ending: context.ending };

    // 3. Show the checked Scripted_Line at once, without waiting (6.5, 4.7).
    const fallback = checkedScriptedLine(context.speechState, context.caseData);
    onDisplay(fallback);

    const p: PendingRequest = { n, controller: new AbortController(), timer: null, timedOut: false };
    pending = p;

    // 4. Provider_Timeout: mark the request as timed out and abort it; the fallback stays (6.8).
    p.timer = clock.setTimeout(() => {
      p.timer = null;
      p.timedOut = true;
      if (pending === p) pending = null;
      p.controller.abort();
    }, timeoutMs);

    // 6. Accept a result only from the fresh, in-time request (6.9).
    const settle = (accept: () => void): void => {
      const fresh = pending === p && p.n === counter && !p.timedOut;
      if (pending === p) pending = null;
      clearTimer(p);
      if (!fresh) return;
      const now = current();
      if (now.branchId !== issued.branchId || now.ending !== issued.ending) return;
      accept();
    };

    const onResult = (value: unknown): void => {
      settle(() => {
        if (value === null || value === undefined) {
          onDisplay(null); // 6.7: nothing silences the bubble.
        } else if (typeof value === 'string' && speechCheck(value, context.caseData).length === 0) {
          onDisplay(value); // 6.6: passing text shows.
        }
        // Failing text or any other value: the fallback stays (6.8).
      });
    };
    const onRejection = (): void => {
      settle(() => {
        // 6.8: a rejection keeps the fallback, with no message.
      });
    };

    // 5. Ask the provider; a synchronous throw counts as a rejection.
    let result: unknown;
    try {
      result = provider.speak({ ...context, requestNumber: n }, p.controller.signal);
    } catch {
      onRejection();
      return;
    }
    Promise.resolve(result).then(onResult, onRejection);
  }

  return {
    request,
    dispose: cancelPending,
  };
}
