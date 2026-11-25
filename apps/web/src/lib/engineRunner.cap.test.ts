/**
 * Property 2 of engine-mcp (task 3.2): the Session_Cap holds and every created Session is deleted
 * (Requirements 6.1, 6.4, 6.5, 7.1, 7.3, 17.4).
 *
 * Runs on the Fake_Service and the fake clock only: no socket, no port, no Physiology_Service, no
 * Pulse_Engine and no real time (17.7). Vitals are the Fake_Service's placeholder numbers; no
 * clinical value is written here.
 *
 * The Fake_Service scripts failures per service, so each Scenario gets its own `RunnerDeps` with a
 * scripted `fetch` and socket factory around the shared Fake_Service:
 * - Intervention_API error: the wrapper answers `POST /sessions/{id}/interventions` with HTTP 422.
 * - Socket close: the wrapper replaces the first message at or after the scripted time with a
 *   close event (code 4000) and closes the inner socket.
 * - DELETE failure: the wrapper answers `DELETE /sessions/{id}` with HTTP 500 without forwarding,
 *   so the Session stays live in the Fake_Service, as the Fake_Service's own `deleteFails` does.
 * Every other request goes to the Fake_Service unchanged. All Scenarios share one Session_Cap
 * (`createSessionSlots(cap)`), one registry, one clock and one Fake_Service; the Scenarios of one
 * call share that call's AbortSignal.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CASE_LEFT } from '@/test/caseFixtures';
import { createFakeClock } from '@/test/fakeClock';
import { createFakeService } from '@/test/fakePhysiologyService';
import { PBT_PARAMS } from '@/test/pbt';
import {
  EngineError,
  createPhysiologyClient,
  type FetchLike,
  type SocketFactory,
  type VitalsSocket,
} from './engineClient';
import { runScenario, undeletedSessionsOf, type RunnerDeps, type ScenarioResult } from './engineRunner';
import { createSessionRegistry, createSessionSlots } from './engineSlots';

const SERVICE_URL = 'http://fake-physiology.test:8123';
const LIMIT_MS = 600_000; // virtual ms
const INTERVENTION_IDS = CASE_LEFT.interventions.map((i) => i.id);
const SCRIPTED_CLOSE_CODE = 4000;

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

type Outcome = 'success' | 'interventionError' | 'socketClose';

interface ScenarioSpec {
  maxSeconds: number; // Max_Time, 1 to 5 s
  outcome: Outcome;
  deleteFails: boolean;
  /** Planned_Intervention at this Simulation_Time; always set for 'interventionError'. */
  interventionAt: number | null;
  interventionId: string;
  closeAt: number; // used only for 'socketClose'; 0..maxSeconds
}

interface CallSpec {
  startMs: number; // virtual time at which the call starts all its Scenarios
  cancelAfterMs: number | null; // the call is cancelled this long after it starts; null: never
  scenarios: ScenarioSpec[];
}

interface Plan {
  cap: number;
  calls: CallSpec[];
}

const scenarioArb: fc.Arbitrary<ScenarioSpec> = fc.integer({ min: 1, max: 5 }).chain((maxSeconds) =>
  fc
    .record({
      outcome: fc.constantFrom<Outcome>('success', 'interventionError', 'socketClose'),
      deleteFails: fc.oneof({ arbitrary: fc.constant(false), weight: 2 }, { arbitrary: fc.constant(true), weight: 1 }),
      withIntervention: fc.boolean(),
      at: fc.integer({ min: 0, max: maxSeconds }),
      interventionId: fc.constantFrom(...INTERVENTION_IDS),
      closeAt: fc.integer({ min: 0, max: maxSeconds }),
    })
    .map(({ outcome, deleteFails, withIntervention, at, interventionId, closeAt }) => ({
      maxSeconds,
      outcome,
      deleteFails,
      interventionAt: outcome === 'interventionError' || withIntervention ? at : null,
      interventionId,
      closeAt,
    })),
);

const callArb: fc.Arbitrary<CallSpec> = fc.record({
  startMs: fc.integer({ min: 0, max: 3_000 }),
  cancelAfterMs: fc.oneof(
    { arbitrary: fc.constant(null), weight: 2 },
    { arbitrary: fc.integer({ min: 0, max: 12_000 }), weight: 1 },
  ),
  scenarios: fc.array(scenarioArb, { minLength: 1, maxLength: 4 }),
});

// 1 to 3 calls of 1 to 4 Scenarios: 1 to 12 Scenarios in total.
const planArb: fc.Arbitrary<Plan> = fc.record({
  cap: fc.integer({ min: 1, max: 8 }),
  calls: fc.array(callArb, { minLength: 1, maxLength: 3 }),
});

// ---------------------------------------------------------------------------
// Per-Scenario scripted seams
// ---------------------------------------------------------------------------

interface SentRequest {
  scenario: number;
  method: string;
  path: string;
}

function respond(status: number, body: unknown): { ok: boolean; status: number; text(): Promise<string> } {
  const text = JSON.stringify(body);
  return { ok: status >= 200 && status < 300, status, text: async () => text };
}

const SESSION_PATH = /^\/sessions\/([^/]+)/;

function sessionIdOf(path: string): string | null {
  const m = SESSION_PATH.exec(path);
  return m ? decodeURIComponent(m[1]) : null;
}

/** Closes the stream in place of the first message whose simulation_time is at or after `closeAt`. */
function closingSocket(inner: SocketFactory, closeAt: number | null): SocketFactory {
  return (url) => {
    const s = inner(url);
    let fired = false;
    const outer: VitalsSocket = {
      onopen: null,
      onmessage: null,
      onerror: null,
      onclose: null,
      close: (code, reason) => {
        if (!fired) s.close(code, reason);
      },
    };
    s.onopen = (ev) => {
      if (!fired) outer.onopen?.(ev);
    };
    s.onerror = (ev) => {
      if (!fired) outer.onerror?.(ev);
    };
    s.onclose = (ev) => {
      if (!fired) outer.onclose?.(ev);
    };
    s.onmessage = (ev) => {
      if (fired) return;
      if (closeAt !== null) {
        const t = (JSON.parse(String(ev.data)) as { simulation_time?: unknown }).simulation_time;
        if (typeof t === 'number' && t >= closeAt) {
          fired = true;
          s.close(1000, 'scripted close');
          queueMicrotask(() => outer.onclose?.({ code: SCRIPTED_CLOSE_CODE, reason: 'scripted close' }));
          return;
        }
      }
      outer.onmessage?.(ev);
    };
    return outer;
  };
}

// ---------------------------------------------------------------------------
// One property run
// ---------------------------------------------------------------------------

type Settled =
  | { state: 'pending' }
  | { state: 'resolved'; beforeAbort: boolean; result: ScenarioResult }
  | { state: 'rejected'; beforeAbort: boolean; error: unknown };

interface Coverage {
  queuedCancelled: number; // Scenarios cancelled before they created a Session
  runningCancelled: number; // Scenarios cancelled after they created a Session
  capReached: number; // runs where the runner held cap Sessions at once with work still queued
  leaked: number; // Sessions whose DELETE failed
}

async function runPlan(plan: Plan, coverage: Coverage): Promise<void> {
  const clock = createFakeClock();
  const fake = createFakeService({ clock });
  const slots = createSessionSlots(plan.cap);
  const registry = createSessionRegistry();

  const specs: ScenarioSpec[] = [];
  const callOf: number[] = [];
  plan.calls.forEach((c, ci) =>
    c.scenarios.forEach((s) => {
      specs.push(s);
      callOf.push(ci);
    }),
  );

  const sent: SentRequest[] = [];
  const logs: { scenario: number; line: string }[] = [];
  const created = new Map<number, string>(); // scenario -> session_id
  const leaked = new Set<string>(); // DELETE refused by the script
  const queueOrder: number[] = []; // scenarios in the order runScenario was called
  const settled: Settled[] = specs.map(() => ({ state: 'pending' }));
  const callAborted = plan.calls.map(() => false);
  const sentAtAbort = new Map<number, number>(); // scenario -> its requests sent when its call was cancelled
  let maxHeld = 0; // Sessions created by the runner and not yet sent a DELETE, at most
  let capHitWithQueue = false;

  const heldNow = (): number => fake.liveSessions().length - leaked.size;

  function depsFor(i: number): RunnerDeps {
    const spec = specs[i];
    const fetch: FetchLike = async (url, init) => {
      const method = init?.method ?? 'GET';
      const path = new URL(url).pathname;
      sent.push({ scenario: i, method, path });
      if (method === 'DELETE' && spec.deleteFails) {
        const id = sessionIdOf(path);
        if (id !== null) leaked.add(id);
        return respond(500, { detail: 'scripted DELETE failure' });
      }
      if (spec.outcome === 'interventionError' && method === 'POST' && path.endsWith('/interventions')) {
        return respond(422, { detail: 'scripted rejection' });
      }
      // The Fake_Service handles a request synchronously when called; measure right after creation.
      const pending = fake.fetch(url, init);
      const creating = method === 'POST' && path === '/sessions';
      if (creating) {
        maxHeld = Math.max(maxHeld, heldNow());
        if (heldNow() === plan.cap && slots.waiting > 0) capHitWithQueue = true;
      }
      const res = await pending;
      if (creating && res.ok) {
        const id = (JSON.parse(await res.text()) as { session_id: string }).session_id;
        expect(created.has(i)).toBe(false); // at most one Session per Scenario
        created.set(i, id);
      }
      return res;
    };
    const sock = closingSocket(fake.openSocket, spec.outcome === 'socketClose' ? spec.closeAt : null);
    return {
      serviceUrl: SERVICE_URL,
      client: createPhysiologyClient({ serviceUrl: SERVICE_URL, fetch }),
      openSocket: (url) => {
        sent.push({ scenario: i, method: 'WS', path: new URL(url).pathname });
        return sock(url);
      },
      slots,
      registry,
      clock,
      log: (line) => logs.push({ scenario: i, line }),
    };
  }

  const controllers = plan.calls.map(() => new AbortController());
  let next = 0;
  const firstOfCall = plan.calls.map((c) => {
    const first = next;
    next += c.scenarios.length;
    return first;
  });

  // Cancellation timers first, so a cancel due at the same time as the start fires first.
  plan.calls.forEach((c, ci) => {
    if (c.cancelAfterMs === null) return;
    clock.setTimeout(() => {
      callAborted[ci] = true;
      c.scenarios.forEach((_, k) => {
        const i = firstOfCall[ci] + k;
        sentAtAbort.set(i, sent.filter((r) => r.scenario === i).length);
      });
      controllers[ci].abort();
    }, c.startMs + c.cancelAfterMs);
  });

  const callsDone = plan.calls.map(
    (c, ci) =>
      new Promise<void>((resolve) => {
        clock.setTimeout(() => {
          const ps = c.scenarios.map((spec, k) => {
            const i = firstOfCall[ci] + k;
            queueOrder.push(i);
            const p = runScenario(
              {
                caseId: CASE_LEFT.id,
                variantId: 'left',
                plan:
                  spec.interventionAt === null ? [] : [{ interventionId: spec.interventionId, atSeconds: spec.interventionAt }],
                maxSeconds: spec.maxSeconds,
                sampleIntervalSeconds: 1,
                stopAtEnding: false,
                name: `scenario ${i}`,
              },
              depsFor(i),
              controllers[ci].signal,
            );
            return p.then(
              (result) => {
                settled[i] = { state: 'resolved', beforeAbort: !callAborted[ci], result };
              },
              (error: unknown) => {
                settled[i] = { state: 'rejected', beforeAbort: !callAborted[ci], error };
              },
            );
          });
          void Promise.all(ps).then(() => resolve());
        }, c.startMs);
      }),
  );

  await clock.runUntilSettled(Promise.all(callsDone), LIMIT_MS);

  // --- Per-Scenario outcome, computed from the script alone ---
  specs.forEach((spec, i) => {
    const s = settled[i];
    expect(s.state).not.toBe('pending');
    if (s.state === 'pending') return;
    const id = created.get(i);
    const expectedUndeleted = spec.deleteFails && id !== undefined ? [id] : [];
    const cancelled = callAborted[callOf[i]] && !s.beforeAbort;
    if (cancelled) {
      // Not settled when its call was cancelled: it rejects with kind 'cancelled' (6.2, 7.4).
      expect(s.state).toBe('rejected');
      if (s.state !== 'rejected') return;
      expect(s.error).toBeInstanceOf(EngineError);
      expect((s.error as EngineError).kind).toBe('cancelled');
      expect(undeletedSessionsOf(s.error)).toEqual(expectedUndeleted);
      if (id === undefined) coverage.queuedCancelled += 1;
      else coverage.runningCancelled += 1;
      return;
    }
    expect(id).toBeDefined();
    if (spec.outcome === 'success') {
      expect(s.state).toBe('resolved');
      if (s.state !== 'resolved') return;
      expect(s.result.last_time).toBe(spec.maxSeconds);
      expect(s.result.interventions).toHaveLength(spec.interventionAt === null ? 0 : 1);
      expect(s.result.undeleted_sessions).toEqual(spec.deleteFails ? [id] : undefined);
    } else {
      expect(s.state).toBe('rejected');
      if (s.state !== 'rejected') return;
      expect(s.error).toBeInstanceOf(EngineError);
      expect((s.error as EngineError).kind).toBe(spec.outcome === 'interventionError' ? 'http' : 'stream');
      expect(undeletedSessionsOf(s.error)).toEqual(expectedUndeleted);
    }
  });

  // Queued-cancelled Scenarios: nothing sent before the cancel means nothing sent at all (7.4).
  for (const [i, n] of sentAtAbort) {
    if (n === 0) expect(sent.filter((r) => r.scenario === i)).toEqual([]);
  }

  // --- Bullet 1: never more than the cap of live Sessions created by the runner (7.1) ---
  // A Session whose DELETE failed stays live in the Fake_Service after the runner released its
  // slot (6.4), so the Fake_Service's own peak may exceed the cap by at most those Sessions.
  expect(maxHeld).toBeLessThanOrEqual(plan.cap);
  expect(fake.maxConcurrentSessions).toBeLessThanOrEqual(plan.cap + leaked.size);
  if (leaked.size === 0) expect(fake.maxConcurrentSessions).toBeLessThanOrEqual(plan.cap);
  if (capHitWithQueue) coverage.capReached += 1;

  // --- Bullet 2: Scenarios start in queue order (7.3) ---
  const startOrder = sent.filter((r) => r.method === 'POST' && r.path === '/sessions').map((r) => r.scenario);
  const queuePos = startOrder.map((i) => queueOrder.indexOf(i));
  for (let k = 1; k < queuePos.length; k += 1) expect(queuePos[k]).toBeGreaterThan(queuePos[k - 1]);
  expect(new Set(startOrder).size).toBe(startOrder.length);

  // --- Bullet 3: every Session the runner created gets one DELETE, the last request naming it (6.1, 6.5) ---
  for (const [i, id] of created) {
    const naming = sent.filter((r) => sessionIdOf(r.path) === id);
    expect(naming.every((r) => r.scenario === i)).toBe(true);
    expect(naming.filter((r) => r.method === 'DELETE')).toHaveLength(1);
    expect(naming.at(-1)?.method).toBe('DELETE');
  }

  // --- Bullet 4: after all calls settle, every Session is deleted except the scripted DELETE failures,
  // and those appear in undeleted_sessions (or on the error) and on the log (6.4) ---
  const createdIds = [...created.values()];
  const expectedLeaked = [...created].filter(([i]) => specs[i].deleteFails).map(([, id]) => id);
  expect([...leaked].sort()).toEqual([...expectedLeaked].sort());
  expect([...fake.liveSessions()].sort()).toEqual([...expectedLeaked].sort());
  expect([...fake.deleted].sort()).toEqual(createdIds.filter((id) => !leaked.has(id)).sort());
  expect([...registry.ids()].sort()).toEqual([...expectedLeaked].sort());
  for (const [i, id] of created) {
    if (!specs[i].deleteFails) continue;
    coverage.leaked += 1;
    expect(logs.some((l) => l.scenario === i && l.line.startsWith(`Session ${id} was not deleted`))).toBe(true);
  }
  expect(slots.held).toBe(0);
  expect(slots.waiting).toBe(0);

  // --- Bullet 5: no request names a session_id that the runner did not create (6.5) ---
  const known = new Set(createdIds);
  for (const r of [...sent, ...fake.calls]) {
    const id = sessionIdOf(r.path);
    if (id !== null) expect(known.has(id)).toBe(true);
  }
}

// ---------------------------------------------------------------------------
// Property 2
// ---------------------------------------------------------------------------

describe('Scenario_Runner: Session_Cap and cleanup across concurrent calls', () => {
  // Feature: engine-mcp, Property 2: The Session_Cap holds and every created Session is deleted
  it('Property 2: the Session_Cap holds and every created Session is deleted', async () => {
    const coverage: Coverage = { queuedCancelled: 0, runningCancelled: 0, capReached: 0, leaked: 0 };
    await fc.assert(
      fc.asyncProperty(planArb, async (plan) => {
        await runPlan(plan, coverage);
      }),
      PBT_PARAMS,
    );
    // The generated runs reach the cases the property is about.
    expect(coverage.queuedCancelled).toBeGreaterThan(0);
    expect(coverage.runningCancelled).toBeGreaterThan(0);
    expect(coverage.capReached).toBeGreaterThan(0);
    expect(coverage.leaked).toBeGreaterThan(0);
  }, 120_000);
});
