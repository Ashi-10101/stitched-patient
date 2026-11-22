/**
 * Shared fast-check generators for play-mode property tests (design "Testing Strategy").
 */

import fc from 'fast-check';
import type {
  AlarmThreshold,
  AvatarParameters,
  BranchMetadata,
  CheckpointMetadata,
  ComparisonOp,
  ConditionGroup,
  ExamAction,
  ExamRecordEntry,
  ExamRule,
  ExamWhen,
  InterventionRecordEntry,
  PlaySection,
  ScheduledInsult,
  Side,
  StatusRule,
  StatusWhen,
  VitalBand,
  VitalCondition,
  VitalName,
  VitalSigns,
} from '@/types';
import { VITAL_FIELD, VITAL_NAMES } from '@/lib/vitals';
import { CASE, VITAL_OFFSETS } from './caseFixtures';

/**
 * Small grid of bound values: integers plus fractions. Drawing every bound from
 * this grid makes equal bounds (e.g. warning.low === normal.low) and crossing
 * bounds (e.g. low > high, warning inside normal) common.
 */
export const THRESHOLD_GRID = [-10, -1, -0.5, 0, 0.5, 0.88, 0.95, 1, 2, 10, 60, 100] as const;

const arbBound = fc.constantFrom(...THRESHOLD_GRID);

/** `low` and `high` each present or absent (absent keys are omitted, not `undefined`). */
const arbBounds = fc.record({ low: arbBound, high: arbBound }, { requiredKeys: [] });

/**
 * Threshold object with each of `critical`, `warning` and `normal` present or
 * absent, and each bound inside them present or absent.
 *
 * `AlarmThreshold.normal` declares both bounds as required, but the
 * Alarm_Function must skip any absent bound (Requirement 15.5), so this
 * generator also omits `normal.low` / `normal.high` and casts the result.
 */
export const arbThreshold: fc.Arbitrary<AlarmThreshold> = fc
  .record(
    { critical: arbBounds, warning: arbBounds, normal: arbBounds },
    { requiredKeys: [] },
  )
  .map((t) => t as AlarmThreshold);

/**
 * Simulation times in half-second steps from 0 to 120 s. The small range makes
 * equal times (insult time === Decompression time === sample time) common.
 */
const arbSideTime = fc.integer({ min: 0, max: 240 }).map((n) => n / 2);

/**
 * Side values: mostly valid sides, plus off-domain strings and an absent side
 * that side handling must ignore. Cast because `Side` only allows the two valid values.
 */
const arbSideValue = fc.constantFrom<unknown>('Left', 'Right', 'Left', 'Right', 'left', 'RIGHT', undefined);

/**
 * Scheduled_Insults: mostly `SETensionPneumothorax`, plus other actions that
 * side handling must ignore.
 */
export const arbInsults: fc.Arbitrary<ScheduledInsult[]> = fc.array(
  fc
    .record({
      timeSeconds: arbSideTime,
      action: fc.constantFrom(
        'SETensionPneumothorax',
        'SETensionPneumothorax',
        'SEHemorrhage',
        'setensionpneumothorax',
      ),
      side: arbSideValue,
      type: fc.constantFrom<'Closed' | 'Open'>('Closed', 'Open'),
      severity: fc.integer({ min: 0, max: 100 }).map((n) => n / 100),
    })
    .map(({ timeSeconds, action, side, type, severity }) => ({
      timeSeconds,
      action,
      parameters: {
        ...(side === undefined ? {} : { side: side as Side }),
        type,
        severity,
      },
    })),
  { maxLength: 4 },
);

/**
 * Active_Interventions: mostly `SENeedleDecompression`, plus other actions that
 * side handling must ignore.
 */
export const arbActiveInterventions: fc.Arbitrary<InterventionRecordEntry[]> = fc.array(
  fc
    .record({
      action: fc.constantFrom(
        'SENeedleDecompression',
        'SENeedleDecompression',
        'SETensionPneumothorax',
        'seneedledecompression',
      ),
      side: arbSideValue,
      simulationTime: arbSideTime,
      branchId: fc.constantFrom('main', 'branch-1'),
    })
    .map(({ action, side, simulationTime, branchId }) => ({
      interventionId: `${action}-${String(side)}`,
      action,
      ...(side === undefined ? {} : { side: side as Side }),
      simulationTime,
      branchId,
    })),
  { maxLength: 4 },
);

/** Every bound of a vital's case threshold, or `[]` when the case defines none. */
function caseBounds(vital: VitalName): number[] {
  const t = CASE.alarms[vital];
  if (!t) return [];
  return [t.critical?.low, t.critical?.high, t.warning?.low, t.warning?.high, t.normal?.low, t.normal?.high].filter(
    (b): b is number => b !== undefined,
  );
}

/**
 * One vital's value: non-finite (`NaN`, `±Infinity`), zero, negative, a case
 * boundary or boundary ± the per-vital offset, or a value in the range from
 * 50% of the lowest to 150% of the highest case boundary.
 */
function arbVitalValue(vital: VitalName): fc.Arbitrary<number> {
  const bounds = caseBounds(vital);
  const lo = bounds.length ? Math.min(...bounds) : 1;
  const hi = bounds.length ? Math.max(...bounds) : 100;
  const offset = VITAL_OFFSETS[vital];
  const nearBoundary = bounds.length
    ? fc.constantFrom(...bounds).chain((b) => fc.constantFrom(b - offset, b, b + offset))
    : fc.constant(lo);
  return fc.oneof(
    { weight: 1, arbitrary: fc.constantFrom(Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY) },
    { weight: 1, arbitrary: fc.constant(0) },
    { weight: 1, arbitrary: fc.double({ min: -2 * hi, max: -offset, noNaN: true }) },
    { weight: 3, arbitrary: nearBoundary },
    { weight: 3, arbitrary: fc.double({ min: 0.5 * lo, max: 1.5 * hi, noNaN: true }) },
  );
}

/**
 * VitalSigns sample with a finite `simulation_time` (0 to 600 s in half-second
 * steps). Each case vital, `systolic_pressure` and `diastolic_pressure` is
 * present or absent (absent keys are omitted); a present case vital may be
 * `NaN`, `±Infinity`, zero, negative or near a case boundary.
 */
export const arbSample: fc.Arbitrary<Partial<VitalSigns> & { simulation_time: number }> = fc
  .record(
    {
      simulation_time: fc.integer({ min: 0, max: 1200 }).map((n) => n / 2),
      ...Object.fromEntries(VITAL_NAMES.map((v) => [VITAL_FIELD[v], arbVitalValue(v)])),
      systolic_pressure: fc.double({ min: 40, max: 200, noNaN: true }),
      diastolic_pressure: fc.double({ min: 20, max: 120, noNaN: true }),
    },
    { requiredKeys: ['simulation_time'] },
  )
  .map((s) => s as Partial<VitalSigns> & { simulation_time: number });

/** Vital_Band: `normal` with direction `none`, or `warning`/`critical` with `low`/`high`. */
const arbVitalBand: fc.Arbitrary<VitalBand> = fc.oneof(
  fc.constant<VitalBand>({ state: 'normal', direction: 'none' }),
  fc.record({
    state: fc.constantFrom<VitalBand['state']>('warning', 'critical'),
    direction: fc.constantFrom<VitalBand['direction']>('low', 'high'),
  }),
);

/** Period in seconds, as `60 / rate` gives for rates from 3 to 300 per minute. */
const arbPeriod = fc.double({ min: 0.2, max: 20, noNaN: true });

/**
 * Avatar_Parameters with valid field shapes: depth inside [0.25, 1.75],
 * positive periods, side lists sorted and unique, and any subset of vitals in
 * `bands`. Fields are drawn independently, so `skinTone`, `sweating` and
 * `overallStatus` need not match `bands`.
 */
export const arbAvatarParameters: fc.Arbitrary<AvatarParameters> = fc.record({
  skinTone: fc.constantFrom<AvatarParameters['skinTone']>('healthy', 'pale', 'cyanotic'),
  breathing: fc.record({
    stopped: fc.boolean(),
    periodS: arbPeriod,
    depth: fc.double({ min: 0.25, max: 1.75, noNaN: true }),
  }),
  heartbeat: fc.record({ stopped: fc.boolean(), periodS: arbPeriod }),
  sweating: fc.boolean(),
  swollenSides: fc.subarray<Side>(['Left', 'Right']),
  decompressedSides: fc.subarray<Side>(['Left', 'Right']),
  overallStatus: fc.constantFrom<AvatarParameters['overallStatus']>('normal', 'warning', 'critical'),
  bands: fc
    .record(
      Object.fromEntries(VITAL_NAMES.map((v) => [v, arbVitalBand])) as Record<VitalName, fc.Arbitrary<VitalBand>>,
      { requiredKeys: [] },
    )
    .map((b) => b as Partial<Record<VitalName, VitalBand>>),
});

/**
 * Status_Rule `when` item: any case vital, band `warning` or `critical`
 * (never `normal`), and a direction that is absent (key omitted), `low` or `high`.
 */
const arbStatusWhen: fc.Arbitrary<StatusWhen> = fc
  .record(
    {
      vital: fc.constantFrom<VitalName>(...VITAL_NAMES),
      band: fc.constantFrom<StatusWhen['band']>('warning', 'critical'),
      direction: fc.constantFrom<'low' | 'high'>('low', 'high'),
    },
    { requiredKeys: ['vital', 'band'] },
  )
  .map((w) => w as StatusWhen);

/**
 * Sentence text: arbitrary strings plus fixed strings with leading/trailing
 * spaces, unusual punctuation, non-ASCII characters and the empty string, so
 * tests can check that the selector returns the text unchanged.
 */
const arbSentence: fc.Arbitrary<string> = fc.oneof(
  { weight: 3, arbitrary: fc.string({ maxLength: 40 }) },
  {
    weight: 1,
    arbitrary: fc.constantFrom(
      '  Leading and trailing spaces.  ',
      '\tTabbed\u00a0and non-breaking\n',
      'Breathing… fast?!',
      '"Quoted" — dash; semi:colon (parens) [brackets] {braces}',
      'Ünïcödé 😮 text',
      '',
    ),
  },
);

/**
 * Status part of a Play_Section: 0 to 20 Status_Rules with 1 to 6 `when`
 * items each, and a `defaultSentence`. All rule sentences and the
 * `defaultSentence` are distinct, so the returned string identifies the rule.
 */
const arbStatus: fc.Arbitrary<PlaySection['status']> = fc
  .uniqueArray(
    fc.record({
      when: fc.array(arbStatusWhen, { minLength: 1, maxLength: 6 }),
      sentence: arbSentence,
    }),
    { maxLength: 20, selector: (r: StatusRule) => r.sentence },
  )
  .chain((rules) =>
    arbSentence
      .filter((s) => !rules.some((r) => r.sentence === s))
      .map((defaultSentence) => ({ rules, defaultSentence })),
  );

/**
 * Vital_Condition on any case vital with any operator. The value is a case
 * boundary or boundary ± the per-vital offset (so generated samples land on
 * both sides of it), or a value from `THRESHOLD_GRID`.
 */
const arbVitalCondition: fc.Arbitrary<VitalCondition> = fc
  .constantFrom<VitalName>(...VITAL_NAMES)
  .chain((vital) => {
    const bounds = caseBounds(vital);
    const offset = VITAL_OFFSETS[vital];
    const nearBoundary = bounds.length
      ? fc.constantFrom(...bounds).chain((b) => fc.constantFrom(b - offset, b, b + offset))
      : fc.constantFrom(...THRESHOLD_GRID);
    return fc.record({
      vital: fc.constant(vital),
      op: fc.constantFrom<ComparisonOp>('<', '<=', '>=', '>'),
      value: fc.oneof({ weight: 3, arbitrary: nearBoundary }, { weight: 1, arbitrary: fc.constantFrom(...THRESHOLD_GRID) }),
    });
  });

/** Hold time in half-second steps from 0.5 to 30 s (always > 0, as the schema requires). */
const arbHoldSeconds = fc.integer({ min: 1, max: 60 }).map((n) => n / 2);

const arbConditionGroup = (maxConditions: number): fc.Arbitrary<ConditionGroup> =>
  fc.record({
    conditions: fc.array(arbVitalCondition, { minLength: 1, maxLength: maxConditions }),
    holdSeconds: arbHoldSeconds,
  });

/**
 * Intervention ids for `endings.rescued.requiredInterventions`: mostly the
 * case's two Decompression ids, sometimes another non-empty string.
 */
const arbRequiredInterventionId: fc.Arbitrary<string> = fc.oneof(
  { weight: 3, arbitrary: fc.constantFrom('needle-decompression-left', 'needle-decompression-right') },
  { weight: 1, arbitrary: fc.string({ minLength: 1, maxLength: 12 }) },
);

/** Required_Interventions: absent (key omitted) or 1 to 3 unique non-empty ids. */
const arbRequiredInterventions: fc.Arbitrary<string[] | undefined> = fc.option(
  fc.uniqueArray(arbRequiredInterventionId, { minLength: 1, maxLength: 3 }),
  { nil: undefined },
);

/**
 * Endings part of a Play_Section: 1 to 6 rescue conditions, sometimes
 * Required_Interventions (1 or more unique non-empty ids), 0 to 5
 * Lost_Condition groups, and an optional Time_Limit (1 to 80 s), with at least
 * one group or a Time_Limit. An empty group list is sometimes `[]` and
 * sometimes omitted.
 */
const arbEndings: fc.Arbitrary<PlaySection['endings']> = fc
  .record({
    rescued: arbConditionGroup(6),
    requiredInterventions: arbRequiredInterventions,
    groups: fc.array(arbConditionGroup(6), { maxLength: 5 }),
    omitEmptyGroups: fc.boolean(),
    timeLimitSeconds: fc.option(fc.integer({ min: 1, max: 80 }), { nil: undefined }),
  })
  .filter(({ groups, timeLimitSeconds }) => groups.length > 0 || timeLimitSeconds !== undefined)
  .map(({ rescued, requiredInterventions, groups, omitEmptyGroups, timeLimitSeconds }) => ({
    rescued: requiredInterventions === undefined ? rescued : { ...rescued, requiredInterventions },
    lost: {
      ...(groups.length === 0 && omitEmptyGroups ? {} : { groups }),
      ...(timeLimitSeconds === undefined ? {} : { timeLimitSeconds }),
    },
  }));

/**
 * Play_Section with generated `status` and `endings` parts (see `arbStatus` and
 * `arbEndings`). The other fields hold fixed minimal valid test values (not case content).
 */
export const arbPlaySection: fc.Arbitrary<PlaySection> = fc
  .record({ status: arbStatus, endings: arbEndings })
  .map(
    ({ status, endings }): PlaySection => ({
      goalText: 'Test goal.',
      diagnosisTerms: ['test-diagnosis-term'],
      endings,
      hints: [{ text: 'Test hint.' }],
      status,
    }),
  );

/** Non-finite Simulation_Times that the Ending_Evaluator must ignore. */
const NON_FINITE_TIMES = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY] as const;

/**
 * Ordered VitalSigns samples (0 to 60) with vitals as in `arbSample`.
 * Simulation_Times start between 0 and 20 s and mostly increase by 1 s, with
 * injected repeats (+0), decreases (−1 to −5 s) and non-finite times
 * (`NaN`, `±Infinity`; the running time is unchanged by them).
 */
export const arbSampleSequence: fc.Arbitrary<(Partial<VitalSigns> & { simulation_time: number })[]> = fc
  .record({
    start: fc.integer({ min: 0, max: 20 }),
    items: fc.array(
      fc.record({
        sample: arbSample,
        step: fc.oneof(
          { weight: 12, arbitrary: fc.constant(1) },
          { weight: 1, arbitrary: fc.constant(0) },
          { weight: 1, arbitrary: fc.integer({ min: -5, max: -1 }) },
          { weight: 1, arbitrary: fc.constantFrom(...NON_FINITE_TIMES) },
        ),
      }),
      { maxLength: 60 },
    ),
  })
  .map(({ start, items }) => {
    let t = start;
    return items.map(({ sample, step }, i) => {
      if (!Number.isFinite(step)) return { ...sample, simulation_time: step };
      if (i > 0) t += step;
      return { ...sample, simulation_time: t };
    });
  });

/** A generated Branch tree with its ground truth, for Property 7. */
export interface LineageCase {
  branches: BranchMetadata[];
  currentBranchId: string;
  checkpointsByBranch: Record<string, CheckpointMetadata[]>;
  record: InterventionRecordEntry[];
  /** Ground truth: Simulation_Time at which each non-root Branch was forked. */
  forkTimeByBranch: Record<string, number>;
  /** Branches whose source Checkpoint was evicted from the parent's list. */
  evictedSources: string[];
}

/** Checkpoints fall on multiples of 5 s, so many entries share a Checkpoint's time. */
const CHECKPOINT_STEP_S = 5;

const arbLaterCheckpointOffsets = fc.uniqueArray(
  fc.integer({ min: 1, max: 12 }).map((n) => n * CHECKPOINT_STEP_S),
  { maxLength: 5 },
);

/** How a Branch is forked: which parent Checkpoint, its later Checkpoints, and whether the source is evicted. */
const arbForkSpec = fc.record({
  sourcePick: fc.nat(),
  laterOffsets: arbLaterCheckpointOffsets,
  evictSource: fc.oneof({ weight: 2, arbitrary: fc.constant(false) }, { weight: 1, arbitrary: fc.constant(true) }),
});

/**
 * One Intervention_Record entry: a Branch, an anchor time (one of that
 * Branch's Checkpoint times, or a time at which a child was forked from it)
 * plus a delta, and a sort key that sets the entry's place in the record.
 */
const arbEntrySpec = fc.record({
  branchPick: fc.nat(),
  anchorKind: fc.constantFrom<'checkpoint' | 'forkTime'>('checkpoint', 'forkTime', 'forkTime'),
  anchorPick: fc.nat(),
  delta: fc.oneof(
    { weight: 3, arbitrary: fc.constant(0) },
    { weight: 1, arbitrary: fc.constantFrom(-1, 0.5, 1) },
    { weight: 2, arbitrary: fc.integer({ min: 1, max: 30 }) },
  ),
  action: fc.constantFrom('SENeedleDecompression', 'SENeedleDecompression', 'SETensionPneumothorax'),
  side: fc.constantFrom<Side>('Left', 'Right'),
  sortKey: fc.nat(),
});

const LINEAGE_CREATED_AT = '2026-10-31T00:00:00.000Z';

interface LineageNode {
  id: string;
  parentId?: string;
  sourceId?: string;
  startTime: number;
  /** Every Checkpoint the Branch ever had, before any eviction. */
  allCheckpoints: CheckpointMetadata[];
  childForkTimes: number[];
}

const checkpoint = (checkpoint_id: string, simulation_time: number): CheckpointMetadata => ({
  checkpoint_id,
  simulation_time,
  created_at: LINEAGE_CREATED_AT,
  is_automatic: true,
});

/**
 * Branch tree: a parent chain of 1 to 4 Branches from the root `main` to the
 * current Branch, plus 0 to 2 sibling Branches forked from any chain Branch
 * (outside the lineage). Each forked Branch is modelled as the service forks:
 * its first Checkpoint is a copy of the parent's source Checkpoint with a new
 * id and the same Simulation_Time, and `forked_from_checkpoint` names the
 * source id, which stays in the parent's list unless it is evicted (about one
 * fork in three; a fork copy is never evicted). Intervention_Record entries (0 to 10) sit on any of these
 * Branches, often exactly at a Checkpoint or fork time, in shuffled order.
 */
export const arbLineage: fc.Arbitrary<LineageCase> = fc
  .record({
    rootLaterOffsets: arbLaterCheckpointOffsets,
    chain: fc.array(arbForkSpec, { maxLength: 3 }),
    siblings: fc.array(fc.record({ parentPick: fc.nat(), fork: arbForkSpec }), { maxLength: 2 }),
    entries: fc.array(arbEntrySpec, { maxLength: 10 }),
    branchOrder: fc.array(fc.nat(), { minLength: 6, maxLength: 6 }),
  })
  .map(({ rootLaterOffsets, chain, siblings, entries, branchOrder }) => {
    const root: LineageNode = {
      id: 'main',
      startTime: 0,
      allCheckpoints: [0, ...rootLaterOffsets].sort((a, b) => a - b).map((t, k) => checkpoint(`main-cp-${k}`, t)),
      childForkTimes: [],
    };
    const nodes: LineageNode[] = [root];
    const evicted = new Set<string>();
    const evictedSources: string[] = [];
    const forkTimeByBranch: Record<string, number> = {};

    const fork = (id: string, parent: LineageNode, spec: (typeof chain)[number]): LineageNode => {
      const source = parent.allCheckpoints[spec.sourcePick % parent.allCheckpoints.length];
      const forkTime = source.simulation_time;
      // A Branch's fork copy is never evicted, so its earliest Checkpoint stays at its fork time.
      if (spec.evictSource && source.checkpoint_id !== `${parent.id}-cp-fork`) {
        evicted.add(source.checkpoint_id);
        evictedSources.push(id);
      }
      parent.childForkTimes.push(forkTime);
      forkTimeByBranch[id] = forkTime;
      const node: LineageNode = {
        id,
        parentId: parent.id,
        sourceId: source.checkpoint_id,
        startTime: forkTime,
        allCheckpoints: [
          checkpoint(`${id}-cp-fork`, forkTime),
          ...[...spec.laterOffsets].sort((a, b) => a - b).map((o, k) => checkpoint(`${id}-cp-${k}`, forkTime + o)),
        ],
        childForkTimes: [],
      };
      nodes.push(node);
      return node;
    };

    const chainNodes = [root];
    chain.forEach((spec, i) => chainNodes.push(fork(`branch-${i + 1}`, chainNodes[i], spec)));
    siblings.forEach(({ parentPick, fork: spec }, j) =>
      fork(`sibling-${j + 1}`, chainNodes[parentPick % chainNodes.length], spec),
    );

    const record = entries
      .map((e) => {
        const node = nodes[e.branchPick % nodes.length];
        const anchors =
          e.anchorKind === 'forkTime' && node.childForkTimes.length > 0
            ? node.childForkTimes
            : node.allCheckpoints.map((c) => c.simulation_time);
        const simulationTime = Math.max(node.startTime, anchors[e.anchorPick % anchors.length] + e.delta);
        const entry: InterventionRecordEntry = {
          interventionId:
            e.action === 'SENeedleDecompression' ? `needle-decompression-${e.side.toLowerCase()}` : 'tension-pneumothorax',
          action: e.action,
          side: e.side,
          simulationTime,
          branchId: node.id,
        };
        return { entry, sortKey: e.sortKey };
      })
      .sort((a, b) => a.sortKey - b.sortKey)
      .map(({ entry }) => entry);

    const branches = nodes
      .map((n, i) => ({ n, key: branchOrder[i] }))
      .sort((a, b) => a.key - b.key)
      .map(
        ({ n }): BranchMetadata => ({
          branch_id: n.id,
          ...(n.parentId === undefined ? {} : { parent_branch_id: n.parentId, forked_from_checkpoint: n.sourceId }),
          created_at: LINEAGE_CREATED_AT,
          event_count: 0,
        }),
      );

    const checkpointsByBranch = Object.fromEntries(
      nodes.map((n) => [n.id, n.allCheckpoints.filter((c) => !evicted.has(c.checkpoint_id))]),
    );

    return {
      branches,
      currentBranchId: chainNodes[chainNodes.length - 1].id,
      checkpointsByBranch,
      record,
      forkTimeByBranch,
      evictedSources,
    };
  });

// ---------------------------------------------------------------------------
// Bedside exam (bedside-exam design "Property test settings")
// ---------------------------------------------------------------------------

/** Exam text: `arbSentence` without the empty string (the schema needs 1 to 100 characters). */
const arbExamText: fc.Arbitrary<string> = arbSentence.filter((s) => s.length >= 1 && s.length <= 100);

/** Exam_Action id: 1 to 40 characters matching `^[a-z0-9-]+$`. */
const arbExamActionId: fc.Arbitrary<string> = fc.stringOf(fc.constantFrom(...'abcxyz019-'), {
  minLength: 1,
  maxLength: 40,
});

/** Exam_Button label: 1 to 60 characters. */
const arbExamLabel: fc.Arbitrary<string> = fc.string({ minLength: 1, maxLength: 60 });

/**
 * Exam_Rule `when`: every combination of `side` (only when `sided`), `insult`,
 * `decompressed` and `vitals` (1 to 6 Status_Rule `when` items), each present or
 * absent (absent keys are omitted), with at least one present.
 */
const arbExamWhen = (sided: boolean): fc.Arbitrary<ExamWhen> => {
  const conditions = {
    insult: fc.constantFrom<NonNullable<ExamWhen['insult']>>('started', 'notStarted'),
    decompressed: fc.boolean(),
    vitals: fc.array(arbStatusWhen, { minLength: 1, maxLength: 6 }),
  };
  const record = sided
    ? fc.record(
        { ...conditions, side: fc.constantFrom<NonNullable<ExamWhen['side']>>('affected', 'other') },
        { requiredKeys: [] },
      )
    : fc.record(conditions, { requiredKeys: [] });
  return record.filter((w) => Object.keys(w).length > 0).map((w) => w as ExamWhen);
};

/** Exam_Rule with `abnormal` absent (key omitted), `true` or `false`. */
const arbExamRule = (sided: boolean): fc.Arbitrary<ExamRule> =>
  fc
    .record({
      when: arbExamWhen(sided),
      sentence: arbExamText,
      abnormal: fc.constantFrom<boolean | undefined>(undefined, true, false),
    })
    .map(({ when, sentence, abnormal }) => ({
      when,
      sentence,
      ...(abnormal === undefined ? {} : { abnormal }),
    }));

/**
 * Exam_Action: a Sided_Action (`labels.Left` and `labels.Right`) or a
 * Side_Neutral_Action (`label`, and no `side` condition in any rule), with 0 to
 * 10 Exam_Rules. All rule sentences and the `defaultSentence` are distinct, so
 * the returned string identifies the rule.
 */
export const arbExamAction: fc.Arbitrary<ExamAction> = fc.boolean().chain((sided) =>
  fc
    .record({
      id: arbExamActionId,
      rules: fc.uniqueArray(arbExamRule(sided), { maxLength: 10, selector: (r) => r.sentence }),
      labelLeft: arbExamLabel,
      labelRight: arbExamLabel,
    })
    .chain(({ id, rules, labelLeft, labelRight }) =>
      arbExamText
        .filter((s) => !rules.some((r) => r.sentence === s))
        .map((defaultSentence): ExamAction =>
          sided
            ? { id, labels: { Left: labelLeft, Right: labelRight }, rules, defaultSentence }
            : { id, label: labelLeft, rules, defaultSentence },
        ),
    ),
);

/** Wall-clock times from 2026-01-01 to 2027-01-01 as ISO 8601 strings. */
const arbWallClockTime: fc.Arbitrary<string> = fc
  .integer({ min: Date.UTC(2026, 0, 1), max: Date.UTC(2027, 0, 1) })
  .map((ms) => new Date(ms).toISOString());

/**
 * Exam_Record entry: `side` present (`Left`/`Right`) or absent (key omitted);
 * Simulation_Time 0, a value from a small repeated set, or any half-second step
 * from 0 to 600 s; `branchId` from a small pool; any sentence text.
 */
export const arbExamRecordEntry: fc.Arbitrary<ExamRecordEntry> = fc
  .record({
    actionId: fc.constantFrom('listen', 'look-chest', 'neck-veins', 'windpipe', 'skin'),
    side: fc.constantFrom<Side | undefined>('Left', 'Right', undefined),
    simulationTime: fc.oneof(
      { weight: 1, arbitrary: fc.constant(0) },
      { weight: 2, arbitrary: fc.constantFrom(30, 90, 102) },
      { weight: 3, arbitrary: fc.integer({ min: 0, max: 1200 }).map((n) => n / 2) },
    ),
    branchId: fc.constantFrom('main', 'branch-1', 'branch-2'),
    sentence: arbSentence,
    abnormal: fc.boolean(),
    wallClockTime: arbWallClockTime,
  })
  .map(({ side, ...rest }) => ({ ...rest, ...(side === undefined ? {} : { side }) }));
