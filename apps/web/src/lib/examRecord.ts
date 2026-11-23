/**
 * Exam_Record: every Exam_Button activation of the Session, kept in the browser
 * tab's sessionStorage (bedside-exam Requirements 7.1, 7.4-7.7, 10.6).
 *
 * Stored format: `{"v":1,"entries":[...]}` under `examRecordKey(sessionId)`.
 * Reading is strict: any invalid entry drops the whole record, so a partially
 * corrupted record cannot produce a wrong Found_Side. The module mirrors
 * `interventionRecord.ts`.
 */

import type { ExamFinding, ExamRecordEntry, Side } from '@/types';

export type { ExamRecordEntry };

const EXAM_RECORD_VERSION = 1;

/** sessionStorage key; contains the session_id and nothing else that varies (7.4, 10.6). */
export const examRecordKey = (sessionId: string): string =>
  `stitched-patient:exam-record:${sessionId}`;

const isPlainObject = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);

const hasOwn = (o: object, key: string): boolean => Object.prototype.hasOwnProperty.call(o, key);

/** Copy of an entry with only the seven record fields; `side` is left out when absent. */
function pickEntry(e: {
  actionId: string;
  side?: Side;
  simulationTime: number;
  branchId: string;
  sentence: string;
  abnormal: boolean;
  wallClockTime: string;
}): ExamRecordEntry {
  // Key order follows the stored example of the design ("Data Models").
  return {
    actionId: e.actionId,
    ...(e.side === undefined ? {} : { side: e.side }),
    simulationTime: e.simulationTime,
    branchId: e.branchId,
    sentence: e.sentence,
    abnormal: e.abnormal,
    wallClockTime: e.wallClockTime,
  };
}

/** A validated entry, or `undefined` when any field is missing or has the wrong type. */
function validEntry(x: unknown): ExamRecordEntry | undefined {
  if (!isPlainObject(x)) return undefined;
  const { actionId, side, simulationTime, branchId, sentence, abnormal, wallClockTime } = x;
  if (typeof actionId !== 'string') return undefined;
  if (typeof branchId !== 'string') return undefined;
  if (typeof sentence !== 'string') return undefined;
  if (typeof wallClockTime !== 'string') return undefined;
  if (typeof abnormal !== 'boolean') return undefined;
  if (typeof simulationTime !== 'number' || !Number.isFinite(simulationTime) || simulationTime < 0) {
    return undefined;
  }
  if (hasOwn(x, 'side') && side !== 'Left' && side !== 'Right') return undefined;
  return pickEntry({
    actionId,
    side: side === 'Left' || side === 'Right' ? side : undefined,
    simulationTime,
    branchId,
    sentence,
    abnormal,
    wallClockTime,
  });
}

/** Exam_Record entry for one Exam_Button activation (7.1); `side` is left out when null. */
export function buildExamEntry(e: {
  actionId: string;
  side: Side | null;
  simulationTime: number;
  branchId: string;
  finding: ExamFinding;
  wallClockTime: string;
}): ExamRecordEntry {
  return pickEntry({
    actionId: e.actionId,
    side: e.side ?? undefined,
    simulationTime: e.simulationTime,
    branchId: e.branchId,
    sentence: e.finding.sentence,
    abnormal: e.finding.abnormal,
    wallClockTime: e.wallClockTime,
  });
}

/** `{"v":1,"entries":[...]}`; each entry carries only the seven record fields. */
export function serializeExamRecord(record: readonly ExamRecordEntry[]): string {
  return JSON.stringify({ v: EXAM_RECORD_VERSION, entries: record.map(pickEntry) });
}

/**
 * The stored record, or `[]` for `null`, a non-string, bad JSON, a wrong
 * version, a non-array `entries`, or any invalid entry (7.6). Stored
 * `sentence` and `abnormal` are kept as written (7.7). Never throws.
 */
export function parseExamRecord(raw: string | null): ExamRecordEntry[] {
  try {
    if (typeof raw !== 'string') return [];
    const data: unknown = JSON.parse(raw);
    if (!isPlainObject(data) || data.v !== EXAM_RECORD_VERSION || !Array.isArray(data.entries)) {
      return [];
    }
    const entries: ExamRecordEntry[] = [];
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

/** The session's stored record, or `[]` when nothing is stored or `getItem` throws (7.5, 7.6). */
export function loadExamRecord(
  storage: Pick<Storage, 'getItem'>,
  sessionId: string,
): ExamRecordEntry[] {
  try {
    return parseExamRecord(storage.getItem(examRecordKey(sessionId)));
  } catch {
    return [];
  }
}

/**
 * Stores the full record (7.4). Storage errors (private mode, quota) are
 * swallowed: the caller keeps using its in-memory record (7.6).
 */
export function saveExamRecord(
  storage: Pick<Storage, 'setItem'>,
  sessionId: string,
  record: readonly ExamRecordEntry[],
): void {
  try {
    storage.setItem(examRecordKey(sessionId), serializeExamRecord(record));
  } catch {
    // Keep the in-memory record only.
  }
}

/**
 * Findings_List order (6.6): Simulation_Time descending; for equal times the
 * later-recorded entry (higher record index) first. The record is append-only,
 * so the index is the recording order. Returns a new array.
 */
export function findingsNewestFirst(active: readonly ExamRecordEntry[]): ExamRecordEntry[] {
  return active
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => b.entry.simulationTime - a.entry.simulationTime || b.index - a.index)
    .map(({ entry }) => entry);
}
