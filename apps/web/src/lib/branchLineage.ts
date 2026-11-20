/**
 * Branch_Lineage and Active_Interventions (design "branchLineage.ts").
 *
 * The lineage is the current Branch followed by its parent, grandparent, ...
 * Each ancestor is limited to the Simulation_Time at which its child on the
 * lineage was forked (Requirements 4.15, 10.9).
 */

import type { BranchMetadata, CheckpointMetadata, InterventionRecordEntry, LineageSegment } from '@/types';

/** Simulation_Time of the earliest Checkpoint in a list, or `undefined` when there is none. */
function earliestTime(checkpoints: CheckpointMetadata[] | undefined): number | undefined {
  let earliest: number | undefined;
  for (const c of checkpoints ?? []) {
    if (!Number.isFinite(c.simulation_time)) continue;
    if (earliest === undefined || c.simulation_time < earliest) earliest = c.simulation_time;
  }
  return earliest;
}

/**
 * Fork time of `branch`: the Simulation_Time of the Checkpoint named by
 * `forked_from_checkpoint` in the parent's list. When that Checkpoint is not
 * in the list (for example, evicted), the child's earliest Checkpoint is used,
 * because the service copies the fork Checkpoint into the child at the same
 * Simulation_Time. `undefined` when neither list gives a time.
 */
function forkTimeOf(
  branch: BranchMetadata,
  parentId: string,
  checkpointsByBranch: Record<string, CheckpointMetadata[]>,
): number | undefined {
  const source = branch.forked_from_checkpoint;
  if (source !== undefined) {
    const found = checkpointsByBranch[parentId]?.find((c) => c.checkpoint_id === source);
    if (found && Number.isFinite(found.simulation_time)) return found.simulation_time;
  }
  return earliestTime(checkpointsByBranch[branch.branch_id]);
}

/**
 * Builds the Branch_Lineage, current Branch first. The walk stops on a cycle,
 * a missing parent, or a fork time that cannot be found, so before the
 * Checkpoint lists load the lineage is the current Branch alone.
 */
export function buildLineage(
  branches: BranchMetadata[],
  currentBranchId: string,
  checkpointsByBranch: Record<string, CheckpointMetadata[]>,
): LineageSegment[] {
  const byId = new Map<string, BranchMetadata>();
  for (const b of branches) if (!byId.has(b.branch_id)) byId.set(b.branch_id, b);

  const lineage: LineageSegment[] = [];
  const visited = new Set<string>();
  let branchId = currentBranchId;
  let upperBound = Number.POSITIVE_INFINITY;

  for (;;) {
    visited.add(branchId);
    const segment: LineageSegment = { branchId, upperBound };
    lineage.push(segment);

    const branch = byId.get(branchId);
    const parentId = branch?.parent_branch_id;
    if (!branch || parentId === undefined || visited.has(parentId) || !byId.has(parentId)) break;

    const forkTime = forkTimeOf(branch, parentId, checkpointsByBranch);
    if (forkTime === undefined) break;

    if (branch.forked_from_checkpoint !== undefined) segment.forkCheckpointId = branch.forked_from_checkpoint;
    segment.forkTime = forkTime;

    branchId = parentId;
    upperBound = forkTime;
  }
  return lineage;
}

/**
 * Intervention_Record entries whose `branchId` is in the lineage and whose
 * `simulationTime` is less than or equal to that Branch's upper bound, in
 * their original order.
 */
export function activeInterventions(
  record: InterventionRecordEntry[],
  lineage: LineageSegment[],
): InterventionRecordEntry[] {
  const bounds = new Map<string, number>();
  for (const s of lineage) if (!bounds.has(s.branchId)) bounds.set(s.branchId, s.upperBound);
  // Known limitation: the service copies parent events by the checkpoint's
  // event count, not by time. An automatic checkpoint is saved before any
  // intervention at the same tick, so after a rewind to that exact checkpoint
  // an entry at the same simulation_time counts as active here although the
  // engine never received it.
  return record.filter((e) => {
    const bound = bounds.get(e.branchId);
    return bound !== undefined && e.simulationTime <= bound;
  });
}
