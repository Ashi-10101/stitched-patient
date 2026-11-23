import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { activeEntries, activeExamEntries, activeInterventions, buildLineage } from './branchLineage';
import type { BranchMetadata, CheckpointMetadata, ExamRecordEntry, InterventionRecordEntry, Side } from '@/types';
import { arbExamRecordEntry, arbLineage, type LineageCase } from '@/test/generators';
import { PBT_PARAMS } from '@/test/pbt';

const CREATED_AT = '2026-10-31T00:00:00.000Z';

const branch = (branch_id: string, parent?: string, forkedFrom?: string): BranchMetadata => ({
  branch_id,
  ...(parent === undefined ? {} : { parent_branch_id: parent }),
  ...(forkedFrom === undefined ? {} : { forked_from_checkpoint: forkedFrom }),
  created_at: CREATED_AT,
  event_count: 0,
});

const cp = (checkpoint_id: string, simulation_time: number): CheckpointMetadata => ({
  checkpoint_id,
  simulation_time,
  created_at: CREATED_AT,
  is_automatic: true,
});

const decompression = (side: Side, simulationTime: number, branchId: string): InterventionRecordEntry => ({
  interventionId: `needle-decompression-${side.toLowerCase()}`,
  action: 'SENeedleDecompression',
  side,
  simulationTime,
  branchId,
});

const lineageIds = (lineage: { branchId: string; upperBound: number }[]) =>
  lineage.map(({ branchId, upperBound }) => ({ branchId, upperBound }));

describe('buildLineage: fixed inputs (Requirement 12.2)', () => {
  const branches = [branch('main'), branch('branch-1', 'main', 'main-cp-30')];

  it('looks up the fork time in the parent Checkpoint list', () => {
    const lineage = buildLineage(branches, 'branch-1', {
      main: [cp('main-cp-0', 0), cp('main-cp-30', 30), cp('main-cp-60', 60)],
      // Child's earliest Checkpoint is later here, so only the parent lookup gives 30.
      'branch-1': [cp('branch-1-cp-a', 45)],
    });
    expect(lineage).toEqual([
      { branchId: 'branch-1', upperBound: Infinity, forkCheckpointId: 'main-cp-30', forkTime: 30 },
      { branchId: 'main', upperBound: 30 },
    ]);
  });

  it("falls back to the child's earliest Checkpoint when the fork Checkpoint is missing", () => {
    const lineage = buildLineage(branches, 'branch-1', {
      main: [cp('main-cp-0', 0), cp('main-cp-60', 60)],
      'branch-1': [cp('branch-1-cp-b', 50), cp('branch-1-cp-fork', 30)],
    });
    expect(lineageIds(lineage)).toEqual([
      { branchId: 'branch-1', upperBound: Infinity },
      { branchId: 'main', upperBound: 30 },
    ]);
    expect(lineage[0].forkTime).toBe(30);
  });

  it('stops the walk on a cycle', () => {
    const cyclic = [branch('a', 'b', 'b-cp-10'), branch('b', 'a', 'a-cp-5')];
    const checkpoints = { a: [cp('a-cp-5', 5), cp('a-cp-20', 20)], b: [cp('b-cp-10', 10)] };
    expect(lineageIds(buildLineage(cyclic, 'a', checkpoints))).toEqual([
      { branchId: 'a', upperBound: Infinity },
      { branchId: 'b', upperBound: 10 },
    ]);
    const selfParent = [branch('a', 'a', 'a-cp-5')];
    expect(lineageIds(buildLineage(selfParent, 'a', checkpoints))).toEqual([{ branchId: 'a', upperBound: Infinity }]);
  });

  it('stops the walk on a missing parent', () => {
    const orphan = [branch('branch-2', 'gone', 'gone-cp-10')];
    expect(buildLineage(orphan, 'branch-2', { 'branch-2': [cp('branch-2-cp-fork', 10)] })).toEqual([
      { branchId: 'branch-2', upperBound: Infinity },
    ]);
  });

  it('is the current Branch alone before the Checkpoint lists load', () => {
    expect(buildLineage(branches, 'branch-1', {})).toEqual([{ branchId: 'branch-1', upperBound: Infinity }]);
  });
});

describe('activeInterventions: fixed inputs (Requirements 4.15, 10.9, 12.2)', () => {
  const branches = [
    branch('main'),
    branch('branch-1', 'main', 'main-cp-60'),
    branch('sibling', 'main', 'main-cp-30'),
  ];
  const checkpoints = {
    main: [cp('main-cp-0', 0), cp('main-cp-30', 30), cp('main-cp-60', 60), cp('main-cp-90', 90)],
    'branch-1': [cp('branch-1-cp-fork', 60)],
    sibling: [cp('sibling-cp-fork', 30)],
  };
  const lineage = buildLineage(branches, 'branch-1', checkpoints);

  it('after a fork to a Checkpoint earlier than a Decompression, that Decompression is not active', () => {
    const late = decompression('Left', 75, 'main');
    expect(activeInterventions([late], lineage)).toEqual([]);
  });

  it('an entry exactly at the fork time is active', () => {
    const atFork = decompression('Left', 60, 'main');
    expect(activeInterventions([atFork], lineage)).toEqual([atFork]);
  });

  it('excludes entries on Branches outside the lineage and keeps the original order', () => {
    const onSibling = decompression('Left', 40, 'sibling');
    const onChild = decompression('Right', 120, 'branch-1');
    const early = decompression('Left', 20, 'main');
    const record = [onChild, onSibling, early, decompression('Right', 61, 'main')];
    expect(activeInterventions(record, lineage)).toEqual([onChild, early]);
  });

  it('activeEntries gives the same result as activeInterventions for Intervention entries', () => {
    const record = [
      decompression('Right', 120, 'branch-1'),
      decompression('Left', 40, 'sibling'),
      decompression('Left', 20, 'main'),
      decompression('Left', 60, 'main'),
      decompression('Right', 61, 'main'),
    ];
    const viaGeneric = activeEntries(record, lineage);
    const viaInterventions = activeInterventions(record, lineage);
    expect(viaGeneric).toHaveLength(3);
    expect(viaGeneric).toHaveLength(viaInterventions.length);
    viaInterventions.forEach((e, i) => expect(viaGeneric[i]).toBe(e));
  });
});

/**
 * Independent reference: walk `parent_branch_id` from the current Branch and
 * bound each ancestor by the generator's true fork time of the child below it.
 */
function expectedBounds(c: LineageCase): Map<string, number> {
  const parentOf = new Map(c.branches.map((b) => [b.branch_id, b.parent_branch_id]));
  const bounds = new Map<string, number>();
  let id: string | undefined = c.currentBranchId;
  let bound = Number.POSITIVE_INFINITY;
  while (id !== undefined) {
    bounds.set(id, bound);
    bound = c.forkTimeByBranch[id];
    id = parentOf.get(id);
  }
  return bounds;
}

describe('branchLineage properties', () => {
  // Feature: play-mode, Property 7: Active_Interventions are limited to the Branch_Lineage
  // **Validates: Requirements 4.15, 10.9**
  it('Property 7: Active_Interventions are limited to the Branch_Lineage', () => {
    fc.assert(
      fc.property(arbLineage, (c) => {
        const bounds = expectedBounds(c);
        const lineage = buildLineage(c.branches, c.currentBranchId, c.checkpointsByBranch);
        expect(lineage.map((s) => [s.branchId, s.upperBound])).toEqual([...bounds.entries()]);

        const result = activeInterventions(c.record, lineage);
        const expected = c.record.filter((e) => {
          const bound = bounds.get(e.branchId);
          return bound !== undefined && e.simulationTime <= bound;
        });
        expect(result).toHaveLength(expected.length);
        expected.forEach((e, i) => expect(result[i]).toBe(e));

        // After a fork earlier than a Decompression on an ancestor, that Decompression is absent.
        for (const e of c.record) {
          const bound = bounds.get(e.branchId);
          if (e.action === 'SENeedleDecompression' && bound !== undefined && e.simulationTime > bound) {
            expect(result).not.toContain(e);
          }
        }
      }),
      PBT_PARAMS,
    );
  });

  // Feature: bedside-exam, Property 12: Active_Exam_Entries follow the Branch_Lineage like the Intervention_Record
  // **Validates: Requirements 7.3, 14.2**
  it('Property 12: Active_Exam_Entries follow the Branch_Lineage like the Intervention_Record', () => {
    /**
     * Each exam entry gets a branch id from the lineage case's Branches or one
     * outside it, and a time at, below or above a fork time (or a Checkpoint
     * time), or keeps the time `arbExamRecordEntry` gave it.
     */
    const arbExamSpec = fc.record({
      entry: arbExamRecordEntry,
      branchPick: fc.nat(),
      anchorPick: fc.nat(),
      delta: fc.constantFrom<number | null>(0, 0, -1, -0.5, 0.5, 1, 10, null),
    });

    fc.assert(
      fc.property(arbLineage, fc.array(arbExamSpec, { maxLength: 12 }), (c, specs) => {
        const branchPool = [...c.branches.map((b) => b.branch_id), 'outside-lineage'];
        const anchors = [
          ...Object.values(c.forkTimeByBranch),
          ...Object.values(c.checkpointsByBranch).flatMap((list) => list.map((cpt) => cpt.simulation_time)),
        ];
        const record: ExamRecordEntry[] = specs.map(({ entry, branchPick, anchorPick, delta }) => ({
          ...entry,
          branchId: branchPool[branchPick % branchPool.length],
          simulationTime:
            delta === null || anchors.length === 0
              ? entry.simulationTime
              : Math.max(0, anchors[anchorPick % anchors.length] + delta),
        }));

        const bounds = expectedBounds(c);
        const lineage = buildLineage(c.branches, c.currentBranchId, c.checkpointsByBranch);
        const result = activeExamEntries(record, lineage);

        // Reference filter, record order kept, same objects.
        const expected = record.filter((e) => {
          const bound = bounds.get(e.branchId);
          return bound !== undefined && e.simulationTime <= bound;
        });
        expect(result).toHaveLength(expected.length);
        expected.forEach((e, i) => expect(result[i]).toBe(e));

        // Same indexes as activeInterventions on entries mapped to Intervention entries.
        const mapped: InterventionRecordEntry[] = record.map((e) => ({
          interventionId: e.actionId,
          action: 'SENeedleDecompression',
          ...(e.side === undefined ? {} : { side: e.side }),
          simulationTime: e.simulationTime,
          branchId: e.branchId,
        }));
        const examIndexes = result.map((e) => record.indexOf(e));
        const interventionIndexes = activeInterventions(mapped, lineage).map((e) => mapped.indexOf(e));
        expect(examIndexes).toEqual(interventionIndexes);
      }),
      PBT_PARAMS,
    );
  });
});
