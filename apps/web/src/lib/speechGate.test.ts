/**
 * Speech gate unit tests (patient-speech Requirements 6.3 to 6.9, 6.11, 12.5;
 * design "speechGate.ts" and "Testing Strategy").
 *
 * Every test drives the gate with `FakeClock`, so no real time passes. The
 * provider test doubles live in this file only (6.11). `fetch` is replaced by a
 * spy that rejects, and every test checks after it runs that the spy was never
 * called. The case is the `left` Resolved_Case of the shipped case file; the
 * spoken texts are test inputs, not clinical content.
 */
import fc from 'fast-check';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Ending } from './endingEvaluator';
import { PROVIDER_TIMEOUT_MS, createSpeechGate, type SpeechClock, type SpeechGate } from './speechGate';
import { SPEECH_RULE_TEXT, speechCheck } from './speechCheck';
import { scriptedSpeechProvider, type SpeechContext, type SpeechProvider } from './speechProvider';
import { checkedScriptedLine, type SpeechState } from './speechSelector';
import { CASE_LEFT } from '@/test/caseFixtures';
import { createFakeClock, drainMicrotasks, type FakeClock } from '@/test/fakeClock';
import {
  arbEnding,
  arbProviderOutcome,
  arbSpeechText,
  type GeneratedSpeechText,
  type ProviderOutcome,
  type SpeechTextRule,
} from '@/test/generators';
import { PBT_PARAMS } from '@/test/pbt';

const CASE = CASE_LEFT;
const BRANCH_A = 'branch-a';
const BRANCH_B = 'branch-b';

/** A Scripted_Line of the shipped case that passes the Speech_Check. */
const SCRIPTED = CASE.play!.speech!.early![0];
/** A provider text that passes the Speech_Check and differs from SCRIPTED. */
const VALID = 'Please... stay with me.';
/** A second passing provider text, to tell two requests apart. */
const VALID_2 = 'I am so scared.';
/** A Scripted_Line that fails rule (d), so its checked form is null. */
const FAILING_SCRIPTED = 'My left side hurts.';

type GateContext = Omit<SpeechContext, 'requestNumber'>;

function speechState(line: string | null, branchId = BRANCH_A): SpeechState {
  return { branchId, key: line === null ? 'silent' : 'early', index: 0, since: 30, line };
}

function context(line: string | null = SCRIPTED, overrides: Partial<GateContext> = {}): GateContext {
  const branchId = overrides.branchId ?? BRANCH_A;
  const state = speechState(line, branchId);
  return {
    branchId,
    caseData: CASE,
    sample: null,
    simulationTime: 30,
    ending: 'none',
    rescueGateTime: null,
    speechState: state,
    scriptedLine: state.line,
    activeInterventions: [],
    activeExamEntries: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

/** A SpeechClock over a FakeClock that counts the gate's live timers. */
interface TrackingClock extends SpeechClock {
  fake: FakeClock;
  /** Timers set and neither fired nor cleared. */
  active(): number;
}

function trackingClock(): TrackingClock {
  const fake = createFakeClock();
  const live = new Set<unknown>();
  return {
    fake,
    setTimeout(fn, ms) {
      const handle = fake.setTimeout(() => {
        live.delete(handle);
        fn();
      }, ms);
      live.add(handle);
      return handle;
    },
    clearTimeout(handle) {
      live.delete(handle);
      fake.clearTimeout(handle);
    },
    active: () => live.size,
  };
}

/** One `speak` call of a deferred provider, settled by the test. */
interface ProviderCall {
  context: SpeechContext;
  signal: AbortSignal;
  /** The Displayed_Speech calls made before `speak` was called. */
  displaysAtCall: (string | null)[];
  resolve(value: unknown): void;
  reject(reason: unknown): void;
}

interface Harness {
  clock: TrackingClock;
  displays: (string | null)[];
  /** What `current()` returns; tests change it to make a result stale. */
  now: { branchId: string | null; ending: Ending };
  gate: SpeechGate;
  /** Calls of the default deferred provider. */
  calls: ProviderCall[];
}

/**
 * The default provider is deferred: each `speak` call waits until the test
 * settles it. `makeProvider` replaces it; it gets the clock and the displays.
 */
function setup(
  makeProvider?: (env: { clock: TrackingClock; displays: (string | null)[] }) => SpeechProvider,
  now: Harness['now'] = { branchId: BRANCH_A, ending: 'none' },
): Harness {
  const clock = trackingClock();
  const displays: (string | null)[] = [];
  const calls: ProviderCall[] = [];
  const deferred: SpeechProvider = {
    speak: (ctx, signal) =>
      new Promise<string | null | undefined>((resolve, reject) => {
        calls.push({
          context: ctx,
          signal,
          displaysAtCall: [...displays],
          resolve: resolve as (value: unknown) => void,
          reject,
        });
      }),
  };
  const provider = makeProvider ? makeProvider({ clock, displays }) : deferred;
  const gate = createSpeechGate({
    provider,
    clock,
    current: () => ({ ...now }),
    onDisplay: (text) => displays.push(text),
  });
  return { clock, displays, now, gate, calls };
}

/** A provider that resolves with `value` after `ms` of FakeClock time (on the raw FakeClock, so `active()` counts only the gate's timers). */
function delayedProvider(clock: TrackingClock, value: string | null, ms: number): SpeechProvider {
  return {
    speak: () =>
      new Promise((resolve) => {
        clock.fake.setTimeout(() => resolve(value), ms);
      }),
  };
}

function spyOnFetch() {
  return vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('fetch must not be called by the speech gate'));
}

let fetchSpy: ReturnType<typeof spyOnFetch>;

beforeEach(() => {
  fetchSpy = spyOnFetch();
});

afterEach(() => {
  // 6.3, 6.11: no test makes a network call.
  expect(fetchSpy).not.toHaveBeenCalled();
  fetchSpy.mockRestore();
});

// ---------------------------------------------------------------------------
// Fixture preconditions
// ---------------------------------------------------------------------------

describe('fixtures', () => {
  it('SCRIPTED, VALID and VALID_2 pass the Speech_Check and FAILING_SCRIPTED fails rule (d)', () => {
    expect(speechCheck(SCRIPTED, CASE)).toEqual([]);
    expect(speechCheck(VALID, CASE)).toEqual([]);
    expect(speechCheck(VALID_2, CASE)).toEqual([]);
    expect(speechCheck(FAILING_SCRIPTED, CASE)).toEqual([SPEECH_RULE_TEXT.side('left')]);
    expect(new Set([SCRIPTED, VALID, VALID_2]).size).toBe(3);
  });

  it('the Provider_Timeout is 5000 ms', () => {
    expect(PROVIDER_TIMEOUT_MS).toBe(5000);
  });
});

// ---------------------------------------------------------------------------
// Request: fallback first, provider call, numbering (6.4, 6.5)
// ---------------------------------------------------------------------------

describe('request', () => {
  it('shows the checked Scripted_Line synchronously, before the provider is called and before it resolves (6.5)', async () => {
    const h = setup();
    h.gate.request(context());
    expect(h.displays).toEqual([SCRIPTED]);
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0].displaysAtCall).toEqual([SCRIPTED]);
    await drainMicrotasks();
    expect(h.displays).toEqual([SCRIPTED]);
  });

  it('shows null as the fallback when the Scripted_Line fails the Speech_Check (4.7)', () => {
    const h = setup();
    h.gate.request(context(FAILING_SCRIPTED));
    expect(h.displays).toEqual([null]);
  });

  it('shows null as the fallback when the Speech_State is silent', () => {
    const h = setup();
    h.gate.request(context(null));
    expect(h.displays).toEqual([null]);
  });

  it('passes the context with an increasing request number and a live signal to the provider', () => {
    const h = setup();
    const first = context();
    const second = context(SCRIPTED, { simulationTime: 40 });
    h.gate.request(first);
    h.gate.request(second);
    expect(h.calls).toHaveLength(2);
    expect(h.calls[0].context).toEqual({ ...first, requestNumber: 1 });
    expect(h.calls[1].context).toEqual({ ...second, requestNumber: 2 });
    expect(h.calls[1].signal.aborted).toBe(false);
    expect(h.calls[0].signal).not.toBe(h.calls[1].signal);
  });

  it('sets one timer per pending request', () => {
    const h = setup();
    h.gate.request(context());
    expect(h.clock.active()).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Fresh results within the Provider_Timeout (6.6, 6.7, 6.8)
// ---------------------------------------------------------------------------

describe('fresh result within the Provider_Timeout', () => {
  it('shows a valid text and clears the timer (6.6)', async () => {
    const h = setup();
    h.gate.request(context());
    h.calls[0].resolve(VALID);
    await drainMicrotasks();
    expect(h.displays).toEqual([SCRIPTED, VALID]);
    expect(h.clock.active()).toBe(0);
    expect(h.calls[0].signal.aborted).toBe(false);
  });

  it('shows a valid text over a null fallback', async () => {
    const h = setup();
    h.gate.request(context(FAILING_SCRIPTED));
    h.calls[0].resolve(VALID);
    await drainMicrotasks();
    expect(h.displays).toEqual([null, VALID]);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
  ])('shows no speech for %s and clears the timer (6.7)', async (_name, value) => {
    const h = setup();
    h.gate.request(context());
    h.calls[0].resolve(value);
    await drainMicrotasks();
    expect(h.displays).toEqual([SCRIPTED, null]);
    expect(h.clock.active()).toBe(0);
  });

  const failingTexts: [string, string, string][] = [
    ['(a) blank', '   ', SPEECH_RULE_TEXT.blank],
    ['(a) empty', '', SPEECH_RULE_TEXT.blank],
    ['(b) 201 code points', 'a'.repeat(201), SPEECH_RULE_TEXT.tooLong],
    ['(c) Diagnosis_Term', 'Is this a pneumothorax?', SPEECH_RULE_TEXT.diagnosis('pneumothorax')],
    ['(d) Side_Word', 'My left side hurts.', SPEECH_RULE_TEXT.side('left')],
    ['(e) Forbidden_Speech_Term', 'Is that a needle?', SPEECH_RULE_TEXT.forbidden('needle')],
    ['(f) Third_Person_Word', 'Tell him I am scared.', SPEECH_RULE_TEXT.thirdPerson('him')],
  ];

  it.each(failingTexts)('keeps the fallback for a text failing rule %s and clears the timer (6.8)', async (_rule, text, message) => {
    expect(speechCheck(text, CASE)).toEqual([message]);
    const h = setup();
    h.gate.request(context());
    h.calls[0].resolve(text);
    await drainMicrotasks();
    expect(h.displays).toEqual([SCRIPTED]);
    expect(h.clock.active()).toBe(0);
    await h.clock.fake.advance(PROVIDER_TIMEOUT_MS);
    expect(h.displays).toEqual([SCRIPTED]);
  });

  it('keeps the null fallback for a failing text', async () => {
    const h = setup();
    h.gate.request(context(FAILING_SCRIPTED));
    h.calls[0].resolve('Tell him I am scared.');
    await drainMicrotasks();
    expect(h.displays).toEqual([null]);
  });

  it('keeps the fallback for a non-string value (6.8)', async () => {
    const h = setup();
    h.gate.request(context());
    h.calls[0].resolve(42);
    await drainMicrotasks();
    expect(h.displays).toEqual([SCRIPTED]);
    expect(h.clock.active()).toBe(0);
  });

  it('keeps the fallback on a rejection and clears the timer (6.8)', async () => {
    const h = setup();
    h.gate.request(context());
    h.calls[0].reject(new Error('provider failed'));
    await drainMicrotasks();
    expect(h.displays).toEqual([SCRIPTED]);
    expect(h.clock.active()).toBe(0);
    await h.clock.fake.advance(PROVIDER_TIMEOUT_MS);
    expect(h.displays).toEqual([SCRIPTED]);
  });

  it('keeps the fallback on a synchronous throw, does not throw from request, and clears the timer (6.8)', async () => {
    const h = setup(() => ({
      speak: () => {
        throw new Error('provider threw');
      },
    }));
    expect(() => h.gate.request(context())).not.toThrow();
    expect(h.displays).toEqual([SCRIPTED]);
    expect(h.clock.active()).toBe(0);
    await h.clock.fake.advance(PROVIDER_TIMEOUT_MS);
    expect(h.displays).toEqual([SCRIPTED]);
  });

  it('a request after a synchronous throw still shows its provider result', async () => {
    let throws = true;
    const h = setup(() => ({
      speak: () => {
        if (throws) throw new Error('provider threw');
        return Promise.resolve(VALID);
      },
    }));
    h.gate.request(context());
    throws = false;
    h.gate.request(context(SCRIPTED, { simulationTime: 40 }));
    await drainMicrotasks();
    expect(h.displays).toEqual([SCRIPTED, SCRIPTED, VALID]);
  });
});

// ---------------------------------------------------------------------------
// Provider_Timeout (6.8)
// ---------------------------------------------------------------------------

describe('Provider_Timeout', () => {
  it('shows a valid text that resolves at 4999 ms', async () => {
    const h = setup(({ clock }) => delayedProvider(clock, VALID, PROVIDER_TIMEOUT_MS - 1));
    h.gate.request(context());
    await h.clock.fake.advance(PROVIDER_TIMEOUT_MS - 1);
    expect(h.displays).toEqual([SCRIPTED, VALID]);
    expect(h.clock.active()).toBe(0);
  });

  it('keeps the fallback for a valid text that resolves at exactly 5000 ms, and aborts the signal', async () => {
    let signal: AbortSignal | undefined;
    const h = setup(({ clock }) => ({
      speak: (ctx, s) => {
        signal = s;
        return delayedProvider(clock, VALID, PROVIDER_TIMEOUT_MS).speak(ctx, s);
      },
    }));
    h.gate.request(context());
    await h.clock.fake.advance(PROVIDER_TIMEOUT_MS);
    expect(h.displays).toEqual([SCRIPTED]);
    expect(signal?.aborted).toBe(true);
    expect(h.clock.active()).toBe(0);
  });

  it('keeps the fallback for null that resolves after 5 s', async () => {
    const h = setup();
    h.gate.request(context());
    await h.clock.fake.advance(PROVIDER_TIMEOUT_MS - 1);
    expect(h.calls[0].signal.aborted).toBe(false);
    await h.clock.fake.advance(1);
    expect(h.calls[0].signal.aborted).toBe(true);
    expect(h.clock.active()).toBe(0);
    h.calls[0].resolve(null);
    await drainMicrotasks();
    expect(h.displays).toEqual([SCRIPTED]);
  });

  it('a request after a timed-out one still shows its provider result', async () => {
    const h = setup();
    h.gate.request(context());
    await h.clock.fake.advance(PROVIDER_TIMEOUT_MS);
    h.gate.request(context(SCRIPTED, { simulationTime: 40 }));
    h.calls[0].resolve(VALID);
    h.calls[1].resolve(VALID_2);
    await drainMicrotasks();
    expect(h.displays).toEqual([SCRIPTED, SCRIPTED, VALID_2]);
    expect(h.calls[1].signal.aborted).toBe(false);
  });

  it('times each request from its own start', async () => {
    const h = setup();
    h.gate.request(context());
    await h.clock.fake.advance(3000);
    h.gate.request(context(SCRIPTED, { simulationTime: 40 }));
    await h.clock.fake.advance(PROVIDER_TIMEOUT_MS - 1);
    expect(h.calls[1].signal.aborted).toBe(false);
    h.calls[1].resolve(VALID);
    await drainMicrotasks();
    expect(h.displays).toEqual([SCRIPTED, SCRIPTED, VALID]);
  });
});

// ---------------------------------------------------------------------------
// Stale_Result (6.9)
// ---------------------------------------------------------------------------

describe('Stale_Result', () => {
  it('discards a result that arrives after a Branch change, and clears the timer', async () => {
    const h = setup();
    h.gate.request(context());
    h.now.branchId = BRANCH_B;
    h.calls[0].resolve(VALID);
    await drainMicrotasks();
    expect(h.displays).toEqual([SCRIPTED]);
    expect(h.clock.active()).toBe(0);
  });

  it('discards null that arrives after a Branch change', async () => {
    const h = setup();
    h.gate.request(context());
    h.now.branchId = BRANCH_B;
    h.calls[0].resolve(null);
    await drainMicrotasks();
    expect(h.displays).toEqual([SCRIPTED]);
  });

  it('discards a result that arrives after the current Branch becomes null', async () => {
    const h = setup();
    h.gate.request(context());
    h.now.branchId = null;
    h.calls[0].resolve(VALID);
    await drainMicrotasks();
    expect(h.displays).toEqual([SCRIPTED]);
  });

  it('discards a result that arrives after an Ending change', async () => {
    const h = setup();
    h.gate.request(context());
    h.now.ending = 'rescued';
    h.calls[0].resolve(VALID);
    await drainMicrotasks();
    expect(h.displays).toEqual([SCRIPTED]);
    expect(h.clock.active()).toBe(0);
  });

  it('discards null that arrives after an Ending change', async () => {
    const h = setup();
    h.gate.request(context());
    h.now.ending = 'lost';
    h.calls[0].resolve(null);
    await drainMicrotasks();
    expect(h.displays).toEqual([SCRIPTED]);
  });

  it('shows a result for a request issued under an Ending that is still current', async () => {
    const h = setup(undefined, { branchId: BRANCH_A, ending: 'rescued' });
    h.gate.request(context(SCRIPTED, { ending: 'rescued' }));
    h.calls[0].resolve(VALID);
    await drainMicrotasks();
    expect(h.displays).toEqual([SCRIPTED, VALID]);
  });

  it('shows a result for a request issued on another Branch once that Branch is current', async () => {
    const h = setup(undefined, { branchId: BRANCH_B, ending: 'none' });
    h.gate.request(context(SCRIPTED, { branchId: BRANCH_B }));
    h.calls[0].resolve(VALID);
    await drainMicrotasks();
    expect(h.displays).toEqual([SCRIPTED, VALID]);
  });

  it('discards a result of an older request that arrives after a newer request, and shows the newer one', async () => {
    const h = setup();
    h.gate.request(context());
    h.gate.request(context(SCRIPTED, { simulationTime: 40 }));
    expect(h.displays).toEqual([SCRIPTED, SCRIPTED]);
    h.calls[0].resolve(VALID);
    await drainMicrotasks();
    expect(h.displays).toEqual([SCRIPTED, SCRIPTED]);
    // The stale result leaves the newer request pending with its timer.
    expect(h.clock.active()).toBe(1);
    h.calls[1].resolve(VALID_2);
    await drainMicrotasks();
    expect(h.displays).toEqual([SCRIPTED, SCRIPTED, VALID_2]);
    expect(h.clock.active()).toBe(0);
  });

  it('discards null and rejections of an older request after a newer request', async () => {
    const h = setup();
    h.gate.request(context());
    h.gate.request(context(SCRIPTED, { simulationTime: 40 }));
    h.gate.request(context(SCRIPTED, { simulationTime: 50 }));
    h.calls[0].resolve(null);
    h.calls[1].reject(new Error('late failure'));
    await drainMicrotasks();
    expect(h.displays).toEqual([SCRIPTED, SCRIPTED, SCRIPTED]);
    expect(h.clock.active()).toBe(1);
  });

  it('discards an older result even when the newer request has already settled', async () => {
    const h = setup();
    h.gate.request(context());
    h.gate.request(context(SCRIPTED, { simulationTime: 40 }));
    h.calls[1].resolve(VALID_2);
    await drainMicrotasks();
    h.calls[0].resolve(VALID);
    await drainMicrotasks();
    expect(h.displays).toEqual([SCRIPTED, SCRIPTED, VALID_2]);
  });
});

// ---------------------------------------------------------------------------
// Abort on a new request and on dispose (6.4)
// ---------------------------------------------------------------------------

describe('abort', () => {
  it('a new request aborts the previous signal, clears its timer, and leaves the new signal live (6.4)', () => {
    const h = setup();
    h.gate.request(context());
    expect(h.calls[0].signal.aborted).toBe(false);
    h.gate.request(context(SCRIPTED, { simulationTime: 40 }));
    expect(h.calls[0].signal.aborted).toBe(true);
    expect(h.calls[1].signal.aborted).toBe(false);
    expect(h.clock.active()).toBe(1);
  });

  it('a new request after a settled one does not abort the settled signal', async () => {
    const h = setup();
    h.gate.request(context());
    h.calls[0].resolve(VALID);
    await drainMicrotasks();
    h.gate.request(context(SCRIPTED, { simulationTime: 40 }));
    expect(h.calls[0].signal.aborted).toBe(false);
    expect(h.calls[1].signal.aborted).toBe(false);
  });

  it('dispose aborts the pending signal and clears its timer; a later result is discarded', async () => {
    const h = setup();
    h.gate.request(context());
    h.gate.dispose();
    expect(h.calls[0].signal.aborted).toBe(true);
    expect(h.clock.active()).toBe(0);
    h.calls[0].resolve(VALID);
    await drainMicrotasks();
    await h.clock.fake.advance(PROVIDER_TIMEOUT_MS);
    expect(h.displays).toEqual([SCRIPTED]);
  });

  it('dispose discards a later null', async () => {
    const h = setup();
    h.gate.request(context());
    h.gate.dispose();
    h.calls[0].resolve(null);
    await drainMicrotasks();
    expect(h.displays).toEqual([SCRIPTED]);
  });

  it('dispose without a pending request does nothing', () => {
    const h = setup();
    expect(() => h.gate.dispose()).not.toThrow();
    expect(h.displays).toEqual([]);
    expect(h.clock.active()).toBe(0);
  });

  it('a request after dispose works again (StrictMode remount)', async () => {
    const h = setup();
    h.gate.request(context());
    h.gate.dispose();
    h.gate.request(context(SCRIPTED, { simulationTime: 40 }));
    expect(h.calls[1].signal.aborted).toBe(false);
    expect(h.clock.active()).toBe(1);
    h.calls[1].resolve(VALID);
    await drainMicrotasks();
    expect(h.displays).toEqual([SCRIPTED, SCRIPTED, VALID]);
    expect(h.calls[1].context.requestNumber).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Scripted_Speech_Provider (6.3)
// ---------------------------------------------------------------------------

describe('Scripted_Speech_Provider', () => {
  it('resolves with the raw Scripted_Line of the context', async () => {
    const signal = new AbortController().signal;
    await expect(
      scriptedSpeechProvider.speak({ ...context(FAILING_SCRIPTED), requestNumber: 1 }, signal),
    ).resolves.toBe(FAILING_SCRIPTED);
    await expect(scriptedSpeechProvider.speak({ ...context(null), requestNumber: 1 }, signal)).resolves.toBeNull();
  });

  it('through the gate shows the checked Scripted_Line', async () => {
    const h = setup(() => scriptedSpeechProvider);
    h.gate.request(context());
    await drainMicrotasks();
    expect(checkedScriptedLine(speechState(SCRIPTED), CASE)).toBe(SCRIPTED);
    expect(h.displays).toEqual([SCRIPTED, SCRIPTED]);
    expect(h.clock.active()).toBe(0);
    await h.clock.fake.advance(PROVIDER_TIMEOUT_MS);
    expect(h.displays).toEqual([SCRIPTED, SCRIPTED]);
  });

  it('through the gate shows null for a Scripted_Line that fails the Speech_Check', async () => {
    const h = setup(() => scriptedSpeechProvider);
    h.gate.request(context(FAILING_SCRIPTED));
    await drainMicrotasks();
    expect(h.displays).toEqual([null]);
    expect(h.clock.active()).toBe(0);
  });

  it('through the gate shows null for a silent Speech_State', async () => {
    const h = setup(() => scriptedSpeechProvider);
    h.gate.request(context(null));
    await drainMicrotasks();
    expect(h.displays).toEqual([null, null]);
  });

  it('calls no fetch', async () => {
    const h = setup(() => scriptedSpeechProvider);
    h.gate.request(context());
    h.gate.request(context(FAILING_SCRIPTED));
    await h.clock.fake.advance(PROVIDER_TIMEOUT_MS);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Property 7 (design "Correctness Properties")
// ---------------------------------------------------------------------------

describe('Property 7', () => {
  const T = PROVIDER_TIMEOUT_MS;

  /** The messages `speechCheck` gives on the shipped case for a text built to break `t.rule`. */
  function expectedMessages(t: GeneratedSpeechText): string[] {
    const term = t.term ?? '';
    switch (t.rule) {
      case 'pass':
        return [];
      case 'a':
        return [SPEECH_RULE_TEXT.blank];
      case 'b':
        return [SPEECH_RULE_TEXT.tooLong];
      case 'c':
        return [SPEECH_RULE_TEXT.diagnosis(term)];
      case 'd':
        return [SPEECH_RULE_TEXT.side(term)];
      case 'e':
        return [SPEECH_RULE_TEXT.forbidden(term)];
      case 'f':
        return [SPEECH_RULE_TEXT.thirdPerson(term)];
    }
  }

  /** Every Speech_Line of the shipped case, as passing Scripted_Lines. */
  const CASE_SPEECH_LINES: GeneratedSpeechText[] = [
    ...(CASE.play?.speech?.early ?? []),
    ...(CASE.play?.speech?.rescued ?? []),
    ...(CASE.play?.speech?.status ?? []).flatMap((entry) => entry.lines),
  ].map((text) => ({ text, rule: 'pass', term: null }));

  /** Scripted_Line of a request: silence, a line of the case, or a generated passing or failing text. */
  const arbScriptedLine: fc.Arbitrary<GeneratedSpeechText | null> = fc.oneof(
    { weight: 1, arbitrary: fc.constant(null) },
    { weight: 2, arbitrary: fc.constantFrom(...CASE_SPEECH_LINES) },
    { weight: 2, arbitrary: arbSpeechText },
  );

  type GateStep =
    | {
        type: 'request';
        /** `current`: the current Branch (BRANCH_A while it is null) or Ending. */
        branch: 'current' | string;
        ending: 'current' | Ending;
        /** Make the request's Branch and Ending current first, as the hook does after a fork or an Ending. */
        adopt: boolean;
        scripted: GeneratedSpeechText | null;
        outcome: ProviderOutcome;
      }
    | { type: 'advance'; ms: number }
    | { type: 'setCurrent'; branchId?: string | null; ending?: Ending }
    | { type: 'dispose' };

  const arbGateStep: fc.Arbitrary<GateStep> = fc.oneof(
    {
      weight: 4,
      arbitrary: fc.record({
        type: fc.constant('request' as const),
        branch: fc.oneof(
          { weight: 3, arbitrary: fc.constant('current' as const) },
          { weight: 1, arbitrary: fc.constantFrom(BRANCH_A, BRANCH_B) },
        ),
        ending: fc.oneof(
          { weight: 3, arbitrary: fc.constant('current' as const) },
          { weight: 1, arbitrary: arbEnding },
        ),
        adopt: fc.boolean(),
        scripted: arbScriptedLine,
        outcome: arbProviderOutcome,
      }),
    },
    {
      weight: 4,
      arbitrary: fc.record({
        type: fc.constant('advance' as const),
        ms: fc.constantFrom(0, 1, 1000, T / 2, T - 1, T, T + 1, 2 * T),
      }),
    },
    {
      weight: 1,
      arbitrary: fc.record(
        {
          type: fc.constant('setCurrent' as const),
          branchId: fc.constantFrom<string | null>(BRANCH_A, BRANCH_B, null),
          ending: arbEnding,
        },
        { requiredKeys: ['type'] },
      ),
    },
    { weight: 1, arbitrary: fc.constant({ type: 'dispose' as const }) },
  );

  /** How a modelled request ended: still pending, settled by its provider, or ended by the gate. */
  type ModelState = 'pending' | 'settled' | 'superseded' | 'timedOut' | 'disposed';

  interface ModelRequest {
    issuedAt: number;
    issued: { branchId: string; ending: Ending };
    outcome: ProviderOutcome;
    fallback: string | null;
    state: ModelState;
    /** The provider has settled (or thrown). */
    arrived: boolean;
    /** The gate must have aborted the signal: superseded, timed out or disposed while pending. */
    aborted: boolean;
    /** `dispose` was called while this was the newest request. */
    disposeCalled: boolean;
    /** The Displayed_Speech this request's provider result set, if any. */
    shown?: string | null;
  }

  /** The value a test provider resolves with. */
  function providerValue(o: Exclude<ProviderOutcome, { kind: 'reject' } | { kind: 'throw' }>): unknown {
    switch (o.kind) {
      case 'text':
        return o.text.text;
      case 'null':
        return null;
      case 'undefined':
        return undefined;
      case 'nonString':
        return o.value;
    }
  }

  /** What a fresh, in-time result of `o` shows: `{ value }`, or null when the fallback stays. */
  function freshDisplay(o: ProviderOutcome): { value: string | null } | null {
    if (o.kind === 'null' || o.kind === 'undefined') return { value: null };
    if (o.kind === 'text' && o.text.rule === 'pass') return { value: o.text.text };
    return null;
  }

  // Feature: patient-speech, Property 7: The Displayed_Speech is never stale, late or unchecked
  // **Validates: Requirements 6.5, 6.6, 6.7, 6.8, 6.9, 6.11**
  it('Property 7: The Displayed_Speech is never stale, late or unchecked', async () => {
    // Guards against a vacuous pass: each path must be reached in some run.
    const guards = {
      shownText: 0,
      silencedByNull: 0,
      silencedByUndefined: 0,
      keptNonString: 0,
      keptOnRejection: 0,
      keptOnSyncThrow: 0,
      shownAt4999: 0,
      discardedLate: 0,
      discardedAt5000: 0,
      staleByBranch: 0,
      staleByEnding: 0,
      staleByNewerRequest: 0,
      discardedAfterDispose: 0,
      nullFallbackForFailingLine: 0,
    };
    const keptFailing: Record<Exclude<SpeechTextRule, 'pass'>, number> = { a: 0, b: 0, c: 0, d: 0, e: 0, f: 0 };

    await fc.assert(
      fc.asyncProperty(fc.array(arbGateStep, { minLength: 1, maxLength: 40, size: 'max' }), async (steps) => {
        let nextOutcome: ProviderOutcome = { kind: 'throw' };
        const signals: AbortSignal[] = [];
        const h = setup(({ clock }) => ({
          speak: (_ctx, signal) => {
            signals.push(signal);
            const o = nextOutcome;
            if (o.kind === 'throw') throw new Error('provider threw');
            return new Promise<string | null | undefined>((resolve, reject) => {
              const settle = () => {
                if (o.kind === 'reject') reject(new Error('provider failed'));
                else resolve(providerValue(o) as string | null | undefined);
              };
              if (o.delay === 'immediate') settle();
              else clock.fake.setTimeout(settle, o.delay);
            });
          },
        }));

        // The model.
        const displays: (string | null)[] = [];
        const requests: ModelRequest[] = [];
        let latest: ModelRequest | null = null;
        let time = 0;

        /** The provider of `req` settles now (FakeClock time, with `h.now` current). */
        function arrive(req: ModelRequest): void {
          req.arrived = true;
          const o = req.outcome;
          const delay = o.kind === 'throw' ? 'immediate' : o.delay;
          const inTime = delay === 'immediate' || delay < T;
          const branchSame = h.now.branchId === req.issued.branchId;
          const endingSame = h.now.ending === req.issued.ending;
          const display = freshDisplay(o);

          if (req.state === 'pending') {
            if (!inTime) throw new Error('model: a late result must have timed out first');
            req.state = 'settled';
            if (branchSame && endingSame) {
              if (display !== null) {
                displays.push(display.value);
                req.shown = display.value;
                if (delay === T - 1) guards.shownAt4999 += 1;
              }
              if (o.kind === 'text' && o.text.rule === 'pass') guards.shownText += 1;
              else if (o.kind === 'text' && o.text.rule !== 'pass') keptFailing[o.text.rule] += 1;
              else if (o.kind === 'null') guards.silencedByNull += 1;
              else if (o.kind === 'undefined') guards.silencedByUndefined += 1;
              else if (o.kind === 'nonString') guards.keptNonString += 1;
              else if (o.kind === 'reject') guards.keptOnRejection += 1;
              else guards.keptOnSyncThrow += 1;
            } else if (display !== null) {
              if (!branchSame && endingSame) guards.staleByBranch += 1;
              if (branchSame && !endingSame) guards.staleByEnding += 1;
            }
            return;
          }

          // Discarded by the gate. Count the cases where this is the only reason, so the result would show otherwise.
          if (display === null || !branchSame || !endingSame) return;
          if (req.state === 'superseded' && inTime) guards.staleByNewerRequest += 1;
          if (req.state === 'disposed' && inTime && req === latest) guards.discardedAfterDispose += 1;
          if (req.state === 'timedOut' && req === latest && !req.disposeCalled) {
            guards.discardedLate += 1;
            if (delay === T) guards.discardedAt5000 += 1;
          }
        }

        for (const step of steps) {
          if (step.type === 'request') {
            const branchId = step.branch === 'current' ? (h.now.branchId ?? BRANCH_A) : step.branch;
            const ending = step.ending === 'current' ? h.now.ending : step.ending;
            if (step.adopt) {
              h.now.branchId = branchId;
              h.now.ending = ending;
            }
            // Self-check of the generated labels.
            if (step.scripted !== null) expect(speechCheck(step.scripted.text, CASE)).toEqual(expectedMessages(step.scripted));
            if (step.outcome.kind === 'text') {
              expect(speechCheck(step.outcome.text.text, CASE)).toEqual(expectedMessages(step.outcome.text));
            }

            const previous: ModelRequest | null = latest;
            if (previous !== null && previous.state === 'pending') {
              previous.state = 'superseded';
              previous.aborted = true;
            }
            const req: ModelRequest = {
              issuedAt: time,
              issued: { branchId, ending },
              outcome: step.outcome,
              fallback: step.scripted !== null && step.scripted.rule === 'pass' ? step.scripted.text : null,
              state: 'pending',
              arrived: false,
              aborted: false,
              disposeCalled: false,
            };
            requests.push(req);
            latest = req;
            displays.push(req.fallback);
            if (step.outcome.kind === 'throw') arrive(req);

            if (step.scripted !== null && step.scripted.rule !== 'pass') guards.nullFallbackForFailingLine += 1;

            nextOutcome = step.outcome;
            h.gate.request(
              context(step.scripted?.text ?? null, { branchId, ending, simulationTime: 10 * requests.length }),
            );
            // 6.5: the checked Scripted_Line shows synchronously, before any provider result.
            expect(h.displays).toStrictEqual(displays);
            await drainMicrotasks();
            if (step.outcome.kind !== 'throw' && step.outcome.delay === 'immediate') arrive(req);
          } else if (step.type === 'advance') {
            const target = time + step.ms;
            for (const req of requests) {
              const o = req.outcome;
              if (req.arrived || o.kind === 'throw' || o.delay === 'immediate') continue;
              if (req.state === 'pending' && o.delay >= T && req.issuedAt + T <= target) {
                req.state = 'timedOut';
                req.aborted = true;
              }
              if (req.issuedAt + o.delay <= target) arrive(req);
            }
            time = target;
            await h.clock.fake.advance(step.ms);
          } else if (step.type === 'setCurrent') {
            if (step.branchId !== undefined) h.now.branchId = step.branchId;
            if (step.ending !== undefined) h.now.ending = step.ending;
          } else {
            const current: ModelRequest | null = latest;
            if (current !== null) {
              current.disposeCalled = true;
              if (current.state === 'pending') {
                current.state = 'disposed';
                current.aborted = true;
              }
            }
            h.gate.dispose();
            await drainMicrotasks();
          }

          // The exact Displayed_Speech sequence of the model.
          expect(h.displays).toStrictEqual(displays);
          // Never a text that fails the Speech_Check.
          for (const shown of h.displays) {
            if (shown !== null) expect(speechCheck(shown, CASE)).toEqual([]);
          }
          // The Displayed_Speech is the newest request's fallback, null, or its own accepted result.
          const newest: ModelRequest | null = latest;
          if (newest !== null) {
            expect([newest.fallback, null, newest.shown]).toContain(h.displays[h.displays.length - 1]);
          }
          // One live timer exactly while the newest request is pending; signals aborted exactly as modelled.
          expect(h.clock.active()).toBe(newest !== null && newest.state === 'pending' ? 1 : 0);
          expect(signals.map((s) => s.aborted)).toEqual(requests.map((r) => r.aborted));
          expect(h.clock.fake.now()).toBe(time);
          expect(fetchSpy).not.toHaveBeenCalled();
        }
      }),
      PBT_PARAMS,
    );

    for (const [name, count] of Object.entries(guards)) expect(count, name).toBeGreaterThan(0);
    for (const [rule, count] of Object.entries(keptFailing)) expect(count, `keptFailing ${rule}`).toBeGreaterThan(0);
  });
});
