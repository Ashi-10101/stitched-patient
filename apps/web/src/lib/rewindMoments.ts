/**
 * Pure helpers for the Rewind_Panel in the Play_View
 * (Requirements 10.2, 10.3, 10.4, 10.5, 10.12, 10.13).
 */

import type { CheckpointMetadata, Intervention, InterventionRecordEntry } from '@/types';
import { formatMSS } from './timeFormat';
import { playButtonText } from './playCase';

/** The Rewind_Panel lists at most this many Rewind_Moments (Requirement 10.2). */
export const MAX_REWIND_MOMENTS = 5;

/** A Checkpoint of one Branch in the Branch_Lineage. `depth` 0 is the current Branch. */
export interface LineageCheckpoint {
  checkpoint: CheckpointMetadata;
  branchId: string;
  depth: number;
}

/** Order: newest first; equal times by depth, then by checkpoint_id. */
function compareNewestFirst(a: LineageCheckpoint, b: LineageCheckpoint): number {
  const dt = b.checkpoint.simulation_time - a.checkpoint.simulation_time;
  if (dt !== 0) return dt;
  if (a.depth !== b.depth) return a.depth - b.depth;
  const ia = a.checkpoint.checkpoint_id;
  const ib = b.checkpoint.checkpoint_id;
  return ia < ib ? -1 : ia > ib ? 1 : 0;
}

/**
 * Keeps one item per key: the one with the lowest depth. Equal depths keep the
 * smaller checkpoint_id, then the first in input order. Output keeps input order.
 */
function keepLowestDepth<K>(
  items: LineageCheckpoint[],
  keyOf: (c: LineageCheckpoint) => K,
): LineageCheckpoint[] {
  const best = new Map<K, LineageCheckpoint>();
  for (const c of items) {
    const key = keyOf(c);
    const kept = best.get(key);
    if (
      kept === undefined ||
      c.depth < kept.depth ||
      (c.depth === kept.depth && c.checkpoint.checkpoint_id < kept.checkpoint.checkpoint_id)
    ) {
      best.set(key, c);
    }
  }
  const winners = new Set(best.values());
  return items.filter((c) => winners.has(c));
}

/**
 * Chooses the Checkpoints listed as Rewind_Moments, newest first (design "rewindMoments.ts").
 *
 * 1. No latest VitalSigns sample: `[]` (10.12).
 * 2. Eligible: time below the latest sample time and below `timeLimitSeconds` when defined (10.2, 10.3).
 * 3. De-duplicate by `checkpoint_id`, then by equal `simulation_time`, keeping the lowest depth.
 * 4. Sort by time descending; ties by depth, then `checkpoint_id`.
 * 5. Take the first {@link MAX_REWIND_MOMENTS}.
 * 6. With lineage entries, the newest de-duplicated eligible Checkpoint older than the newest
 *    entry replaces the oldest kept one when it is not already kept (10.4).
 *
 * Returned items are the input objects, unchanged.
 */
export function selectRewindCheckpoints(args: {
  checkpoints: LineageCheckpoint[];
  latestSampleTime: number | null;
  timeLimitSeconds?: number;
  lineageInterventions: InterventionRecordEntry[];
}): LineageCheckpoint[] {
  const { checkpoints, latestSampleTime, timeLimitSeconds, lineageInterventions } = args;

  // Step 1
  if (latestSampleTime === null) return [];

  // Step 2
  const eligible = checkpoints.filter((c) => {
    const t = c.checkpoint.simulation_time;
    return t < latestSampleTime && (timeLimitSeconds === undefined || t < timeLimitSeconds);
  });

  // Step 3: the fork copy and its source share a time and a saved state; list it once.
  const byId = keepLowestDepth(eligible, (c) => c.checkpoint.checkpoint_id);
  const unique = keepLowestDepth(byId, (c) => c.checkpoint.simulation_time);

  // Step 4
  const sorted = [...unique].sort(compareNewestFirst);

  // Step 5
  const selected = sorted.slice(0, MAX_REWIND_MOMENTS);

  // Step 6: pick from the de-duplicated list so no second copy of a kept time can enter.
  if (lineageInterventions.length > 0 && selected.length > 0) {
    const newestEntryTime = Math.max(...lineageInterventions.map((e) => e.simulationTime));
    const required = sorted.find((c) => c.checkpoint.simulation_time < newestEntryTime);
    if (
      required !== undefined &&
      !selected.some((c) => c.checkpoint.checkpoint_id === required.checkpoint.checkpoint_id)
    ) {
      selected[selected.length - 1] = required;
    }
  }

  return selected;
}

/**
 * Label of a Rewind_Moment (Requirement 10.5), first matching rule:
 * - `"<M:SS> - at the start"` when the time rounded down is 0;
 * - `"<M:SS> - before you chose: <text>"` with the button text of the earliest lineage entry
 *   later than the Checkpoint (equal times: first in record order);
 * - `"<M:SS>"` otherwise.
 */
export function labelRewindMoment(
  checkpoint: CheckpointMetadata,
  lineageInterventions: InterventionRecordEntry[],
  interventions: Intervention[],
): string {
  const time = checkpoint.simulation_time;
  const mss = formatMSS(time);
  if (Math.floor(time) === 0) return `${mss} - at the start`;

  let earliest: InterventionRecordEntry | undefined;
  for (const entry of lineageInterventions) {
    if (entry.simulationTime > time && (earliest === undefined || entry.simulationTime < earliest.simulationTime)) {
      earliest = entry;
    }
  }
  if (earliest === undefined) return mss;

  const chosenId = earliest.interventionId;
  const intervention = interventions.find((i) => i.id === chosenId);
  // Unknown interventionId (not in the Case_Definition): show the raw id instead of throwing.
  const text = intervention !== undefined ? playButtonText(intervention) : chosenId;
  return `${mss} - before you chose: ${text}`;
}
