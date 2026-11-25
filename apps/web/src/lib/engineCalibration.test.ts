/**
 * Example tests of the calibration plan and evaluation (engine-mcp task 4.1): case-file facts (8.3),
 * the preflight (8.5), the eight-Scenario plan (8.2, 8.7 to 8.9), the Decompression choice (8.4,
 * 8.6), the Play_Section comparison (8.10, 8.11), the first-error stop (8.12) and the evaluation of
 * Scenario_Results (9.2, 9.3, 9.5 to 9.7, 9.10, 9.11).
 *
 * Every run uses the Fake_Service and the fake clock: no socket, no port, no Physiology_Service, no
 * Pulse_Engine and no real time (17.7). Expected values come from the case fixtures. Vitals are
 * synthetic: where a test needs values on one side of a Rescue_Condition or Lost_Condition, it
 * derives them from the fixture's own conditions plus the fixture's per-vital test offsets. No
 * clinical value is written here.
 */
import { describe, expect, it } from 'vitest';
import { BASE_CASE, CASE_LEFT, CASE_RIGHT, CASE_TEXT, VITAL_OFFSETS } from '@/test/caseFixtures';
import { createFakeClock } from '@/test/fakeClock';
import {
  DEFAULT_FAKE_CASES,
  DEFAULT_FAKE_VITALS,
  createFakeService,
  type FakeCase,
  type FakeService,
  type FakeServiceOptions,
} from '@/test/fakePhysiologyService';
import type { CaseData, Intervention, PlaySection, Side, VitalCondition, VitalSigns } from '@/types';
import { compareEarlyWithNone, type MarkSample } from './calibration';
import { EngineError, createPhysiologyClient } from './engineClient';
import {
  CALIBRATION_SAMPLE_INTERVAL,
  DECOMPRESSION_CHECK_COMMIT,
  DEFAULT_DEMO_DECOMPRESSION_TIME,
  DEFAULT_EARLY_DECOMPRESSION_TIME,
  OVERRIDE_TARGET_PLAY_PATHS,
  SCENARIO_KINDS,
  comparePlayWithCaseFile,
  decompressionFor,
  evaluateCalibration,
  planCalibration,
  preflightCalibration,
  readCaseFileFacts,
  runCalibration,
  type CalibrationInput,
  type CaseFileFacts,
  type ScenarioKind,
} from './engineCalibration';
import { buildScenarioResult, type RunnerDeps, type ScenarioResult } from './engineRunner';
import { createSessionRegistry, createSessionSlots } from './engineSlots';
import { conditionHolds } from './endingEvaluator';
import { buildInterventionEntry } from './interventionRecord';
import { interventionSide } from './playCase';
import { DECOMPRESSION_ACTION, PNEUMOTHORAX_ACTION, affectedInsult } from './sides';
import { VITAL_FIELD } from './vitals';

// ---------------------------------------------------------------------------
// Values taken from the case fixture
// ---------------------------------------------------------------------------

function defined<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`case fixture has no ${what}`);
  return value;
}

const SERVICE_URL = 'http://fake-physiology.test:8123';
const CASE_ID = CASE_LEFT.id;
const PLAY: PlaySection = defined(CASE_LEFT.play, 'Play_Section');
const RESCUE = PLAY.endings.rescued;
const LOST_GROUP = defined(PLAY.endings.lost.groups?.[0], 'Lost_Condition group');
const TIME_LIMIT = defined(PLAY.endings.lost.timeLimitSeconds, 'Time_Limit');
const INSULT_TIME = defined(affectedInsult(CASE_LEFT.timeline.scheduledInsults), 'pneumothorax insult').timeSeconds;
const RESOLVED: Record<string, CaseData> = { left: CASE_LEFT, right: CASE_RIGHT };
const VARIANT_IDS = defined(BASE_CASE.variants, 'variants').map((v) => v.id);
const LIMIT_MS = 3_600_000;

const otherSide = (s: Side): Side => (s === 'Left' ? 'Right' : 'Left');
const affectedSideOf = (rc: CaseData): Side =>
  defined(affectedInsult(rc.timeline.scheduledInsults), 'pneumothorax insult').side;

/** The fixture's Decompression for `side`, found by action and side. */
function decompressionOnSide(rc: CaseData, side: Side): Intervention {
  return defined(
    rc.interventions.find((i) => i.action === DECOMPRESSION_ACTION && interventionSide(i) === side),
    `${side} Decompression`,
  );
}

/** Values that meet every condition: the bound for <= and >=, the bound moved by the test offset for < and >. */
function meeting(conditions: readonly VitalCondition[]): Partial<VitalSigns> {
  const out: Record<string, number> = {};
  for (const c of conditions) {
    const off = VITAL_OFFSETS[c.vital];
    out[VITAL_FIELD[c.vital]] = c.op === '>' ? c.value + off : c.op === '<' ? c.value - off : c.value;
  }
  return out as Partial<VitalSigns>;
}

const HEALTHY: Partial<VitalSigns> = { ...DEFAULT_FAKE_VITALS, ...meeting(RESCUE.conditions) };
const FAILING: Partial<VitalSigns> = { ...DEFAULT_FAKE_VITALS, ...meeting(LOST_GROUP.conditions) };
/** HEALTHY with the first rescue condition just missed: neither a rescue nor a lost condition group holds. */
const MIDDLE: Partial<VitalSigns> = (() => {
  const c = RESCUE.conditions[0];
  const off = VITAL_OFFSETS[c.vital];
  const missed = c.op === '>=' || c.op === '>' ? c.value - off : c.value + off;
  const v = { ...HEALTHY, [VITAL_FIELD[c.vital]]: missed };
  const sample = { ...v, simulation_time: 0 };
  if (RESCUE.conditions.every((x) => conditionHolds(x, sample))) throw new Error('MIDDLE meets the rescue conditions');
  if (LOST_GROUP.conditions.every((x) => conditionHolds(x, sample))) throw new Error('MIDDLE meets a lost group');
  return v;
})();

function input(overrides: Partial<CalibrationInput> = {}): CalibrationInput {
  return {
    caseId: CASE_ID,
    decompressAtSeconds: DEFAULT_DEMO_DECOMPRESSION_TIME,
    earlyDecompressAtSeconds: DEFAULT_EARLY_DECOMPRESSION_TIME,
    write: false,
    ...overrides,
  };
}

const FACTS: CaseFileFacts = readCaseFileFacts(CASE_TEXT);

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

interface Harness {
  clock: ReturnType<typeof createFakeClock>;
  fake: FakeService;
  deps: RunnerDeps;
}

function harness(opts: { cap?: number; cases?: Record<string, FakeCase>; vitals?: FakeServiceOptions['vitals']; failures?: FakeServiceOptions['failures'] } = {}): Harness {
  const clock = createFakeClock();
  const fake = createFakeService({ clock, cases: opts.cases ?? DEFAULT_FAKE_CASES, vitals: opts.vitals, failures: opts.failures });
  const deps: RunnerDeps = {
    serviceUrl: SERVICE_URL,
    client: createPhysiologyClient({ serviceUrl: SERVICE_URL, fetch: fake.fetch }),
    openSocket: fake.openSocket,
    slots: createSessionSlots(opts.cap ?? 4),
    registry: createSessionRegistry(),
    clock,
    log: () => undefined,
  };
  return { clock, fake, deps };
}

async function engineError(p: Promise<unknown>): Promise<EngineError> {
  try {
    await p;
  } catch (err) {
    expect(err).toBeInstanceOf(EngineError);
    return err as EngineError;
  }
  throw new Error('expected an EngineError');
}

function expectAllDeleted(h: Harness): void {
  const created = h.fake.calls.filter((c) => c.method === 'POST' && c.path === '/sessions').length;
  expect(h.fake.deleted).toHaveLength(created);
  expect(h.fake.liveSessions()).toEqual([]);
  expect(h.deps.registry.ids()).toEqual([]);
  expect(h.deps.slots.held).toBe(0);
  expect(h.deps.slots.waiting).toBe(0);
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('constants', () => {
  it('has the tool constants of the design and the four Scenario_Kinds in order', () => {
    expect(CALIBRATION_SAMPLE_INTERVAL).toBe(10);
    expect(DEFAULT_DEMO_DECOMPRESSION_TIME).toBe(150);
    expect(DEFAULT_EARLY_DECOMPRESSION_TIME).toBe(20);
    expect(DECOMPRESSION_CHECK_COMMIT).toBe('1e71454');
    expect(SCENARIO_KINDS).toEqual(['no-intervention', 'affected-side', 'other-side-only', 'affected-side-early']);
    expect(OVERRIDE_TARGET_PLAY_PATHS).toEqual(['endings.rescued.requiredInterventions', 'hints', 'sideRevealText']);
  });
});

// ---------------------------------------------------------------------------
// readCaseFileFacts (8.3)
// ---------------------------------------------------------------------------

describe('readCaseFileFacts', () => {
  it('reads the Variant_Ids, Play_Section, Play_Labels, Time_Limit and insult time of the shipped case', () => {
    const facts = readCaseFileFacts(CASE_TEXT);
    expect(facts.variantIds).toEqual(VARIANT_IDS);
    expect(facts.play).toEqual(BASE_CASE.play);
    expect(facts.playLabels).toEqual(Object.fromEntries(BASE_CASE.interventions.map((i) => [i.id, i.playLabel])));
    expect(facts.timeLimitSeconds).toBe(BASE_CASE.play?.endings.lost.timeLimitSeconds);
    const firstInsult = BASE_CASE.timeline.scheduledInsults.find((i) => i.action === PNEUMOTHORAX_ACTION);
    expect(facts.pneumothoraxTimeSeconds).toBe(firstInsult?.timeSeconds);
  });

  it('gives empty facts for a document without the sections', () => {
    expect(readCaseFileFacts('id: x\n')).toEqual({
      variantIds: [],
      play: undefined,
      playLabels: {},
      timeLimitSeconds: undefined,
      pneumothoraxTimeSeconds: null,
    });
    expect(readCaseFileFacts('').variantIds).toEqual([]);
  });

  it('throws a case error naming the file for invalid YAML', () => {
    const run = (): unknown => readCaseFileFacts('a: [1, 2\n', 'some-case');
    expect(run).toThrow(EngineError);
    expect(run).toThrow(/^Case file cases\/some-case\.yaml is not valid YAML: /);
    try {
      run();
    } catch (err) {
      expect((err as EngineError).kind).toBe('case');
    }
  });
});

// ---------------------------------------------------------------------------
// preflightCalibration (8.5, 8.7)
// ---------------------------------------------------------------------------

describe('preflightCalibration', () => {
  it('uses the Time_Limit as Max_Time and limit by default', () => {
    expect(preflightCalibration(input(), FACTS)).toEqual({
      maxTime: TIME_LIMIT,
      limit: { seconds: TIME_LIMIT, source: 'Time_Limit' },
    });
  });

  it('uses max_seconds as Max_Time and keeps the Time_Limit as the limit', () => {
    expect(preflightCalibration(input({ maxSeconds: 300 }), FACTS)).toEqual({
      maxTime: 300,
      limit: { seconds: TIME_LIMIT, source: 'Time_Limit' },
    });
  });

  it('uses max_seconds as the limit when the Play_Section has no Time_Limit', () => {
    expect(preflightCalibration(input({ maxSeconds: 400 }), { ...FACTS, timeLimitSeconds: undefined })).toEqual({
      maxTime: 400,
      limit: { seconds: 400, source: 'max_seconds' },
    });
  });

  const cases: { name: string; inp: CalibrationInput; facts: CaseFileFacts; kind: string; message: string }[] = [
    {
      name: 'no Variants',
      inp: input(),
      facts: { ...FACTS, variantIds: [] },
      kind: 'case',
      message: `Case ${CASE_ID} has no Variants`,
    },
    {
      name: 'no Play_Section',
      inp: input(),
      facts: { ...FACTS, play: undefined },
      kind: 'case',
      message: `Case ${CASE_ID} has no Play_Section`,
    },
    {
      name: 'no Time_Limit and no max_seconds',
      inp: input(),
      facts: { ...FACTS, timeLimitSeconds: undefined },
      kind: 'case',
      message: `The Play_Section of ${CASE_ID} has no Time_Limit and max_seconds is not given`,
    },
    {
      name: 'no SETensionPneumothorax insult',
      inp: input(),
      facts: { ...FACTS, pneumothoraxTimeSeconds: null },
      kind: 'case',
      message: `Case ${CASE_ID} has no SETensionPneumothorax Scheduled_Insult`,
    },
    {
      name: 'early time not less than the insult time',
      inp: input({ earlyDecompressAtSeconds: INSULT_TIME }),
      facts: FACTS,
      kind: 'case',
      message: `early_decompress_at_seconds (${INSULT_TIME}) must be less than the SETensionPneumothorax timeSeconds (${INSULT_TIME})`,
    },
    {
      name: 'Demo_Decompression_Time above the Max_Time',
      inp: input({ maxSeconds: DEFAULT_DEMO_DECOMPRESSION_TIME - 1 }),
      facts: FACTS,
      kind: 'input',
      message: `decompress_at_seconds (${DEFAULT_DEMO_DECOMPRESSION_TIME}) must not be greater than the Max_Time (${DEFAULT_DEMO_DECOMPRESSION_TIME - 1})`,
    },
  ];

  for (const c of cases) {
    it(`fails before any Fake_Service call: ${c.name}`, async () => {
      expect(() => preflightCalibration(c.inp, c.facts)).toThrow(c.message);
      const h = harness();
      const err = await engineError(h.clock.runUntilSettled(runCalibration(c.inp, c.facts, h.deps, new AbortController().signal), LIMIT_MS));
      expect(err.kind).toBe(c.kind);
      expect(err.message).toBe(c.message);
      expect(h.fake.calls).toEqual([]);
    });
  }
});

// ---------------------------------------------------------------------------
// decompressionFor (8.4, 8.6)
// ---------------------------------------------------------------------------

describe('decompressionFor', () => {
  for (const variantId of ['left', 'right']) {
    const rc = RESOLVED[variantId];
    it(`picks the affected-side and other-side Decompression of Variant ${variantId}`, () => {
      const affected = affectedSideOf(rc);
      expect(decompressionFor(rc, 'affected', variantId)).toEqual(decompressionOnSide(rc, affected));
      expect(decompressionFor(rc, 'other', variantId)).toEqual(decompressionOnSide(rc, otherSide(affected)));
    });

    it(`names the Variant and the side when a Decompression is missing (${variantId})`, () => {
      const affected = affectedSideOf(rc);
      for (const [role, side, words] of [
        ['affected', affected, 'affected side'],
        ['other', otherSide(affected), 'other side'],
      ] as const) {
        const without = structuredClone(rc);
        without.interventions = without.interventions.filter(
          (i) => !(i.action === DECOMPRESSION_ACTION && interventionSide(i) === side),
        );
        const run = (): unknown => decompressionFor(without, role, variantId);
        expect(run).toThrow(EngineError);
        expect(run).toThrow(`${variantId}: no SENeedleDecompression Intervention for the ${words}`);
      }
    });
  }

  it('picks by action and side, not by id', () => {
    const renamed = structuredClone(CASE_LEFT);
    renamed.interventions = renamed.interventions.map((i, k) => ({ ...i, id: `renamed-${k}` })).reverse();
    const affected = affectedSideOf(renamed);
    expect(interventionSide(decompressionFor(renamed, 'affected', 'left'))).toBe(affected);
    expect(interventionSide(decompressionFor(renamed, 'other', 'left'))).toBe(otherSide(affected));
    // An Intervention with another action is never chosen, whatever its side.
    const wrongAction = structuredClone(CASE_LEFT);
    wrongAction.interventions = wrongAction.interventions.map((i) => ({ ...i, action: 'SomethingElse' }));
    expect(() => decompressionFor(wrongAction, 'affected', 'left')).toThrow('left: no SENeedleDecompression');
  });
});

// ---------------------------------------------------------------------------
// comparePlayWithCaseFile (8.10, 8.11)
// ---------------------------------------------------------------------------

describe('comparePlayWithCaseFile', () => {
  it('finds no difference for both Resolved_Case fixtures', () => {
    expect(comparePlayWithCaseFile(CASE_LEFT, FACTS)).toBeNull();
    expect(comparePlayWithCaseFile(CASE_RIGHT, FACTS)).toBeNull();
  });

  it('names the path of one changed Play_Section field', () => {
    const rc = structuredClone(CASE_LEFT);
    defined(rc.play?.endings.lost.groups?.[0], 'group').holdSeconds += 1;
    expect(comparePlayWithCaseFile(rc, FACTS)).toBe('play.endings.lost.groups[0].holdSeconds');

    const sentence = structuredClone(CASE_LEFT);
    defined(sentence.play, 'play').status.rules[1].sentence += ' changed';
    expect(comparePlayWithCaseFile(sentence, FACTS)).toBe('play.status.rules[1].sentence');

    const extra = structuredClone(CASE_LEFT);
    (extra.play as unknown as Record<string, unknown>).extraField = 1;
    expect(comparePlayWithCaseFile(extra, FACTS)).toBe('play.extraField');

    const shorter = structuredClone(CASE_LEFT);
    defined(shorter.play, 'play').diagnosisTerms.pop();
    expect(comparePlayWithCaseFile(shorter, FACTS)).toBe(`play.diagnosisTerms[${PLAY.diagnosisTerms.length - 1}]`);

    const none = structuredClone(CASE_LEFT);
    delete none.play;
    expect(comparePlayWithCaseFile(none, FACTS)).toBe('play');
  });

  it('names the Intervention of a changed Play_Label', () => {
    const rc = structuredClone(CASE_LEFT);
    rc.interventions[1].playLabel = `${rc.interventions[1].playLabel ?? ''} changed`;
    expect(comparePlayWithCaseFile(rc, FACTS)).toBe(`interventions[${rc.interventions[1].id}].playLabel`);
  });

  it('ignores the Override_Targets', () => {
    const rc = structuredClone(CASE_LEFT);
    const play = defined(rc.play, 'play');
    play.endings.rescued.requiredInterventions = [];
    play.hints = [{ text: 'x' }];
    play.sideRevealText = 'y';
    expect(comparePlayWithCaseFile(rc, FACTS)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// planCalibration (8.2, 8.7 to 8.9)
// ---------------------------------------------------------------------------

describe('planCalibration', () => {
  it('gives the eight-Scenario table of the shipped case', () => {
    const { maxTime } = preflightCalibration(input(), FACTS);
    const planned = planCalibration(input(), FACTS, maxTime);
    const rows = planned.map((p) => {
      const rc = RESOLVED[p.variantId];
      const plan = typeof p.request.plan === 'function' ? p.request.plan(rc) : p.request.plan;
      const affected = affectedSideOf(rc);
      return {
        variant: p.variantId,
        kind: p.kind,
        name: p.request.name,
        caseId: p.request.caseId,
        requestVariant: p.request.variantId,
        interventions: plan.map((x) => {
          const side = interventionSide(defined(rc.interventions.find((i) => i.id === x.interventionId), x.interventionId));
          return { id: x.interventionId, side, role: side === affected ? 'affected side' : 'other side', at: x.atSeconds };
        }),
        maxTime: p.request.maxSeconds,
        sampleInterval: p.request.sampleIntervalSeconds,
        stopAtEnding: p.request.stopAtEnding,
      };
    });

    const expected = VARIANT_IDS.flatMap((variantId) => {
      const rc = RESOLVED[variantId];
      const affected = affectedSideOf(rc);
      const at = (side: Side, t: number) => {
        const i = decompressionOnSide(rc, side);
        return [{ id: i.id, side, role: side === affected ? 'affected side' : 'other side', at: t }];
      };
      const byKind: Record<ScenarioKind, ReturnType<typeof at>> = {
        'no-intervention': [],
        'affected-side': at(affected, DEFAULT_DEMO_DECOMPRESSION_TIME),
        'other-side-only': at(otherSide(affected), DEFAULT_DEMO_DECOMPRESSION_TIME),
        'affected-side-early': at(affected, DEFAULT_EARLY_DECOMPRESSION_TIME),
      };
      return SCENARIO_KINDS.map((kind) => ({
        variant: variantId,
        kind,
        name: `${variantId} / ${kind}`,
        caseId: CASE_ID,
        requestVariant: variantId,
        interventions: byKind[kind],
        maxTime: TIME_LIMIT,
        sampleInterval: 10,
        stopAtEnding: kind !== 'affected-side-early',
      }));
    });

    expect(rows).toHaveLength(8);
    expect(rows).toEqual(expected);
  });

  it('uses max_seconds as the Max_Time of every Scenario and the given Decompression times', () => {
    const inp = input({ maxSeconds: 300, decompressAtSeconds: 120, earlyDecompressAtSeconds: 5 });
    const planned = planCalibration(inp, FACTS, preflightCalibration(inp, FACTS).maxTime);
    expect(planned.map((p) => p.request.maxSeconds)).toEqual(Array(8).fill(300));
    const times = planned.map((p) => {
      const plan = typeof p.request.plan === 'function' ? p.request.plan(RESOLVED[p.variantId]) : p.request.plan;
      return plan.map((x) => x.atSeconds);
    });
    expect(times).toEqual([[], [120], [120], [5], [], [120], [120], [5]]);
  });

  it('fails a Scenario whose Resolved_Case differs from the case file in beforePlay', () => {
    const planned = planCalibration(input(), FACTS, TIME_LIMIT);
    const rc = structuredClone(CASE_RIGHT);
    defined(rc.play, 'play').goalText += ' changed';
    const beforePlay = defined(planned[4].request.beforePlay, 'beforePlay');
    expect(() => beforePlay(CASE_RIGHT)).not.toThrow();
    expect(() => beforePlay(rc)).toThrow(`${planned[4].variantId}: play.goalText differs from the case file`);
  });
});

// ---------------------------------------------------------------------------
// runCalibration (8.2, 8.12)
// ---------------------------------------------------------------------------

/** Synthetic vitals: HEALTHY until the insult or after the affected-side Decompression, then MIDDLE, then FAILING from 200 s. */
const calibrationVitals: NonNullable<FakeServiceOptions['vitals']> = (variantId, t, applied) => {
  const rc = RESOLVED[variantId];
  const affectedId = decompressionOnSide(rc, affectedSideOf(rc)).id;
  if (applied.some((a) => a.id === affectedId) || t <= INSULT_TIME) return HEALTHY;
  return t < 200 ? MIDDLE : FAILING;
};

describe('runCalibration', () => {
  it('runs the four Scenario_Kinds per Variant, each in its own Session, and deletes every Session', async () => {
    const h = harness({ vitals: calibrationVitals });
    const inp = input({ maxSeconds: 300 });
    const results = await h.clock.runUntilSettled(runCalibration(inp, FACTS, h.deps, new AbortController().signal), LIMIT_MS);

    expect([...results.keys()]).toEqual(VARIANT_IDS);
    const creates = h.fake.calls.filter((c) => c.method === 'POST' && c.path === '/sessions');
    expect(creates.map((c) => (c.body as { variant_id: string }).variant_id)).toEqual(
      VARIANT_IDS.flatMap((v) => SCENARIO_KINDS.map(() => v)),
    );
    expectAllDeleted(h);
    for (const variantId of VARIANT_IDS) {
      const byKind = defined(results.get(variantId), variantId);
      expect(Object.keys(byKind).sort()).toEqual([...SCENARIO_KINDS].sort());
      for (const kind of SCENARIO_KINDS) {
        const r = byKind[kind];
        expect(r.variant_id).toBe(variantId);
        expect(r.sample_interval_seconds).toBe(CALIBRATION_SAMPLE_INTERVAL);
        expect(r.max_seconds).toBe(300);
        expect(r.stop_at_ending).toBe(kind !== 'affected-side-early');
      }
      const rc = RESOLVED[variantId];
      const affected = affectedSideOf(rc);
      expect(byKind['affected-side'].interventions.map((i) => i.intervention_id)).toEqual([decompressionOnSide(rc, affected).id]);
      expect(byKind['other-side-only'].interventions.map((i) => i.intervention_id)).toEqual([
        decompressionOnSide(rc, otherSide(affected)).id,
      ]);
      expect(byKind['affected-side-early'].interventions.map((i) => i.intervention_id)).toEqual([
        decompressionOnSide(rc, affected).id,
      ]);
      expect(byKind['affected-side-early'].last_time).toBe(300);
    }

    const evaluation = evaluateCalibration(inp, FACTS, preflightCalibration(inp, FACTS).limit, results);
    expect(evaluation.failing).toEqual([]);
    expect(evaluation.calibrated).toBe(true);
  });

  it('stops the running Scenarios after the first error, deletes every Session and names the failing Scenario', async () => {
    const h = harness({
      cap: 8,
      vitals: calibrationVitals,
      failures: {
        http: [{ method: 'POST', pathTemplate: '/sessions/{id}/interventions', status: 422, detail: 'scripted rejection', nth: 1 }],
      },
    });
    let kept = 0;
    const err = await engineError(
      h.clock.runUntilSettled(
        runCalibration(input(), FACTS, h.deps, new AbortController().signal, { onSampleKept: () => (kept += 1) }),
        LIMIT_MS,
      ),
    );
    // The first Intervention_API call is the early Decompression of one Variant.
    expect(err.message).toMatch(
      /^Scenario (left|right) \/ affected-side-early failed: POST \/sessions\/\{id\}\/interventions returned HTTP 422: scripted rejection$/,
    );
    expect(err.kind).toBe('http');
    expect(h.fake.calls.filter((c) => c.method === 'POST' && c.path === '/sessions')).toHaveLength(8);
    expectAllDeleted(h);
    // Every Scenario stopped soon after the early Decompression time. Run to their Ending or
    // Max_Time, they would keep more than 200 samples each.
    expect(kept).toBeLessThan(8 * 60);
  });

  it('never starts the queued Scenarios after the first error', async () => {
    const changed = structuredClone(CASE_LEFT);
    defined(changed.play?.endings.lost.groups?.[0], 'group').holdSeconds += 1;
    const cases: Record<string, FakeCase> = {
      [CASE_ID]: { variants: VARIANT_IDS, resolve: (v) => (v === 'left' ? changed : CASE_RIGHT) },
    };
    const h = harness({ cap: 1, cases });
    const err = await engineError(h.clock.runUntilSettled(runCalibration(input(), FACTS, h.deps, new AbortController().signal), LIMIT_MS));
    expect(err.kind).toBe('case');
    expect(err.message).toBe(
      'Scenario left / no-intervention failed: left: play.endings.lost.groups[0].holdSeconds differs from the case file',
    );
    // The Scenario granted the slot while the first one released it may create its Session; no other does.
    expect(h.fake.calls.filter((c) => c.method === 'POST' && c.path === '/sessions').length).toBeLessThanOrEqual(2);
    expect(h.fake.calls.some((c) => c.path.endsWith('/playback') || c.method === 'WS')).toBe(false);
    expectAllDeleted(h);
  });

  it('rethrows a cancellation by the caller unchanged and deletes every Session', async () => {
    const h = harness({ vitals: calibrationVitals });
    const controller = new AbortController();
    h.clock.setTimeout(() => controller.abort(), 5_000);
    const err = await engineError(h.clock.runUntilSettled(runCalibration(input(), FACTS, h.deps, controller.signal), LIMIT_MS));
    expect(err.kind).toBe('cancelled');
    expect(err.message).toBe('Cancelled');
    expectAllDeleted(h);
  });
});

// ---------------------------------------------------------------------------
// evaluateCalibration on synthetic Scenario_Results (9.2, 9.3, 9.5 to 9.7, 9.10, 9.11)
// ---------------------------------------------------------------------------

type VitalsAt = (t: number) => Partial<VitalSigns>;

/** A Scenario_Result built by the shipped buildScenarioResult from synthetic kept samples, one per second. */
function synthetic(
  variantId: string,
  kind: ScenarioKind,
  vitalsAt: VitalsAt,
  last: number,
  decompression?: { side: 'affected' | 'other'; at: number },
): ScenarioResult {
  const rc = RESOLVED[variantId];
  const kept = Array.from({ length: last + 1 }, (_, t) => ({ ...vitalsAt(t), simulation_time: t }));
  const affected = affectedSideOf(rc);
  const i =
    decompression === undefined
      ? undefined
      : decompressionOnSide(rc, decompression.side === 'affected' ? affected : otherSide(affected));
  const entries = i === undefined || decompression === undefined ? [] : [buildInterventionEntry(i, decompression.at, 'branch-x')];
  const applied =
    i === undefined || decompression === undefined
      ? []
      : [{ interventionId: i.id, requestedTime: decompression.at, actualTime: decompression.at, late: false }];
  return buildScenarioResult(
    {
      req: {
        caseId: CASE_ID,
        variantId,
        plan: [],
        maxSeconds: last,
        sampleIntervalSeconds: CALIBRATION_SAMPLE_INTERVAL,
        stopAtEnding: kind !== 'affected-side-early',
      },
      rc,
      kept,
      entries,
      applied,
    },
    SERVICE_URL,
  );
}

const DEMO = DEFAULT_DEMO_DECOMPRESSION_TIME;
const EARLY = DEFAULT_EARLY_DECOMPRESSION_TIME;
const LAST = 250;

/** Each Calibration_Check passes; the early Scenario worsens after the insult. */
function goodSet(variantId: string, shift = 0): Record<ScenarioKind, ScenarioResult> {
  const s = (v: Partial<VitalSigns>): Partial<VitalSigns> => ({ ...v, tidal_volume: (v.tidal_volume ?? 0) + shift });
  const lostAfterInsult: VitalsAt = (t) => s(t <= INSULT_TIME ? HEALTHY : FAILING);
  return {
    'no-intervention': synthetic(variantId, 'no-intervention', lostAfterInsult, LAST),
    'affected-side': synthetic(variantId, 'affected-side', (t) => s(t < DEMO ? MIDDLE : HEALTHY), LAST, { side: 'affected', at: DEMO }),
    'other-side-only': synthetic(variantId, 'other-side-only', lostAfterInsult, LAST, { side: 'other', at: DEMO }),
    'affected-side-early': synthetic(variantId, 'affected-side-early', (t) => s(t <= INSULT_TIME ? HEALTHY : MIDDLE), LAST, {
      side: 'affected',
      at: EARLY,
    }),
  };
}

/** affected-side never rescued, other-side-only never lost, the early Scenario never worsens. */
function badSet(variantId: string): Record<ScenarioKind, ScenarioResult> {
  return {
    'no-intervention': synthetic(variantId, 'no-intervention', (t) => (t <= INSULT_TIME ? HEALTHY : FAILING), LAST),
    'affected-side': synthetic(variantId, 'affected-side', () => MIDDLE, LAST, { side: 'affected', at: DEMO }),
    'other-side-only': synthetic(variantId, 'other-side-only', () => HEALTHY, LAST, { side: 'other', at: DEMO }),
    'affected-side-early': synthetic(variantId, 'affected-side-early', () => HEALTHY, LAST, { side: 'affected', at: EARLY }),
  };
}

const marksOf = (r: ScenarioResult): MarkSample[] =>
  r.marks.map((row) => ({ mark: row.time, sample: { ...row.vitals, simulation_time: row.source_time }, substituted: row.substituted }));

const LIMIT = { seconds: TIME_LIMIT, source: 'Time_Limit' as const };

describe('evaluateCalibration', () => {
  it('passes every Calibration_Check for good synthetic results, in case-file order', () => {
    const results = new Map([
      ['left', goodSet('left')],
      ['right', goodSet('right', 7)],
    ]);
    const e = evaluateCalibration(input(), FACTS, LIMIT, results);

    expect(e.caseId).toBe(CASE_ID);
    expect(e.limit).toEqual(LIMIT);
    expect(e.insultTimeSeconds).toBe(INSULT_TIME);
    expect(e.demoTime).toBe(DEMO);
    expect(e.earlyTime).toBe(EARLY);
    expect(e.variants.map((v) => v.variantId)).toEqual(VARIANT_IDS);
    expect(e.variants.map((v) => v.affectedSide)).toEqual(VARIANT_IDS.map((v) => affectedSideOf(RESOLVED[v])));
    for (const v of e.variants) {
      const r = defined(results.get(v.variantId), v.variantId);
      expect(v.scenarios).toBe(r);
      expect(v.play).toEqual(r['affected-side'].play_values);
      expect(v.play.rescue.required_interventions).toEqual(RESOLVED[v.variantId].play?.endings.rescued.requiredInterventions);
      expect(v.checks.map((c) => [c.check, c.variantId, c.pass])).toEqual([
        ['affected-side-rescued', v.variantId, true],
        ['other-side-only-lost', v.variantId, true],
        ['no-intervention-lost', v.variantId, true],
      ]);
      expect(v.checks[1].basis).toContain('answers open question 1, item c');
      expect(v.early).toEqual(
        compareEarlyWithNone(marksOf(r['affected-side-early']), marksOf(r['no-intervention']), INSULT_TIME, CASE_LEFT.alarms),
      );
      expect(v.early.develops).toBe(true);
      expect(v.early.firstWorseAt).toBe((Math.floor(INSULT_TIME / 10) + 1) * 10);
      expect(v.early.flagRequirement418).toBe(false);
    }
    expect(e.calibrated).toBe(true);
    expect(e.failing).toEqual([]);
    expect(e.requirement418Flagged).toBe(false);

    // 9.10: the right Variant's tidal volume is shifted by 7 in every Scenario, nothing else differs.
    expect(e.sideDifference?.map((d) => d.kind)).toEqual(SCENARIO_KINDS);
    for (const d of e.sideDifference ?? []) {
      expect(d.maxAbs.tidal_volume).toBe(7);
      expect(d.maxAbs.heart_rate).toBe(0);
      expect(d.maxAbs.spo2).toBe(0);
    }
  });

  it('names each failing Scenario with its outcome and raises the 4.18 flag', () => {
    const results = new Map([
      ['left', badSet('left')],
      ['right', goodSet('right')],
    ]);
    const e = evaluateCalibration(input(), FACTS, LIMIT, results);
    const left = e.variants[0];
    expect(left.checks.map((c) => c.pass)).toEqual([false, false, true]);
    expect(e.calibrated).toBe(false);
    expect(e.failing).toEqual([
      { scenario: 'left / affected-side', check: 'affected-side-rescued', outcome: left.checks[0].basis },
      { scenario: 'left / other-side-only', check: 'other-side-only-lost', outcome: left.checks[1].basis },
    ]);
    expect(e.failing[0].outcome).toMatch(/^Ending stayed none/);
    expect(left.early.develops).toBe(false);
    expect(left.early.flagRequirement418).toBe(true);
    expect(e.variants[1].early.flagRequirement418).toBe(false);
    expect(e.requirement418Flagged).toBe(true);
  });

  it('gives no side difference without Variants left and right', () => {
    const facts: CaseFileFacts = { ...FACTS, variantIds: ['left', 'other'] };
    const results = new Map([
      ['left', goodSet('left')],
      ['other', goodSet('left')],
    ]);
    const e = evaluateCalibration(input(), facts, LIMIT, results);
    expect(e.variants.map((v) => v.variantId)).toEqual(['left', 'other']);
    expect(e.sideDifference).toBeNull();
  });

  it('throws when a Scenario_Result is missing', () => {
    const results = new Map([['left', goodSet('left')]]);
    expect(() => evaluateCalibration(input(), FACTS, LIMIT, results)).toThrow('No Scenario_Result for right / no-intervention');
  });
});
