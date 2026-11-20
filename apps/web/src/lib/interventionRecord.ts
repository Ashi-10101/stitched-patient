/**
 * Intervention_Record: the session's list of successful Interventions, kept in
 * the browser tab's sessionStorage (play-mode Requirements 8.6, 8.12-8.14).
 *
 * Stored format: `{"v":1,"entries":[...]}` under `recordKey(sessionId)`.
 * Reading is strict: any invalid entry drops the whole record, so a partially
 * corrupted record cannot produce wrong sides.
 */

import { interventionSide } from './playCase';
import type { Intervention, InterventionRecordEntry, Side } from '@/types';

export type { InterventionRecordEntry };

const RECORD_VERSION = 1;

/** sessionStorage key for a session's Intervention_Record; contains the session_id (8.12). */
export const recordKey = (sessionId: string): string =>
  `stitched-patient:intervention-record:${sessionId}`;

const isPlainObject = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);

const hasOwn = (o: object, key: string): boolean => Object.prototype.hasOwnProperty.call(o, key);

/** Copy of an entry with only the five record fields; `side` is left out when absent. */
function pickEntry(e: {
  interventionId: string;
  action: string;
  side?: Side;
  simulationTime: number;
  branchId: string;
}): InterventionRecordEntry {
  const entry: InterventionRecordEntry = {
    interventionId: e.interventionId,
    action: e.action,
    simulationTime: e.simulationTime,
    branchId: e.branchId,
  };
  if (e.side !== undefined) entry.side = e.side;
  return entry;
}

/** A validated entry, or `undefined` when any field is missing or has the wrong type. */
function validEntry(x: unknown): InterventionRecordEntry | undefined {
  if (!isPlainObject(x)) return undefined;
  const { interventionId, action, branchId, simulationTime, side } = x;
  if (typeof interventionId !== 'string') return undefined;
  if (typeof action !== 'string') return undefined;
  if (typeof branchId !== 'string') return undefined;
  if (typeof simulationTime !== 'number' || !Number.isFinite(simulationTime) || simulationTime < 0) {
    return undefined;
  }
  if (hasOwn(x, 'side') && side !== 'Left' && side !== 'Right') return undefined;
  return pickEntry({
    interventionId,
    action,
    branchId,
    simulationTime,
    side: side === 'Left' || side === 'Right' ? side : undefined,
  });
}

/** `{"v":1,"entries":[...]}`; each entry carries only the five record fields. */
export function serializeRecord(record: InterventionRecordEntry[]): string {
  return JSON.stringify({ v: RECORD_VERSION, entries: record.map(pickEntry) });
}

/**
 * The stored record, or `[]` for `null`, a non-string, bad JSON, a wrong
 * version, a non-array `entries`, or any invalid entry (8.13, 8.14).
 * Never throws.
 */
export function parseRecord(raw: string | null): InterventionRecordEntry[] {
  try {
    if (typeof raw !== 'string') return [];
    const data: unknown = JSON.parse(raw);
    if (!isPlainObject(data) || data.v !== RECORD_VERSION || !Array.isArray(data.entries)) return [];
    const entries: InterventionRecordEntry[] = [];
    for (const item of data.entries) {
      const entry = validEntry(item);
      if (!entry) return [];
      entries.push(entry);
    }
    return entries;
  } catch {
    return [];
  }
}

/** The session's stored record, or `[]` when nothing is stored or storage cannot be read (8.13, 8.14). */
export function loadRecord(
  storage: Pick<Storage, 'getItem'>,
  sessionId: string,
): InterventionRecordEntry[] {
  try {
    return parseRecord(storage.getItem(recordKey(sessionId)));
  } catch {
    return [];
  }
}

/**
 * Stores the full record (8.12). Storage errors (private mode, quota) are
 * swallowed: the caller keeps using its in-memory record.
 */
export function saveRecord(
  storage: Pick<Storage, 'setItem'>,
  sessionId: string,
  record: InterventionRecordEntry[],
): void {
  try {
    storage.setItem(recordKey(sessionId), serializeRecord(record));
  } catch {
    // Keep the in-memory record only.
  }
}

/**
 * Intervention_Record entry for a successful Intervention (8.6). `side` comes
 * from `interventionSide` and is left out when the Intervention has none.
 */
export function buildInterventionEntry(
  intervention: Intervention,
  simulationTime: number,
  branchId: string,
): InterventionRecordEntry {
  return pickEntry({
    interventionId: intervention.id,
    action: intervention.action,
    side: interventionSide(intervention),
    simulationTime,
    branchId,
  });
}
