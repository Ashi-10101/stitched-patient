/**
 * Findings_List of the Play_View (bedside-exam Requirement 6, design "FindingsList.tsx").
 *
 * Renders the Active_Exam_Entries in the order given (the caller passes them
 * newest first). Each item shows the stored sentence, never a recomputed one
 * (7.7). When the entry count grows after mount, the first (newest) item is
 * scrolled into view instantly; a list restored on page load is not scrolled.
 */

'use client';

import { useEffect, useRef } from 'react';
import { examButtonText } from '@/lib/examFinding';
import { formatMSS } from '@/lib/timeFormat';
import type { ExamRecordEntry, ExamSection } from '@/types';

export const FINDINGS_EMPTY_TEXT = "You haven't checked anything yet."; // UI text, not clinical

export interface FindingsListProps {
  /** Active_Exam_Entries, newest first (findingsNewestFirst). */
  entries: readonly ExamRecordEntry[];
  exam: ExamSection;
}

/** Caps from design "Layout": 256 px below 1280 px, 200 px from 1280 px. */
export const FINDINGS_BOX_CLASS = 'min-w-0 overflow-y-auto rounded-lg border-2 p-3 max-h-[16rem] xl:max-h-[12.5rem]';

/** True only when the entry count grew since the previous render. */
export function shouldScrollToNewest(prevCount: number, count: number): boolean {
  return count > prevCount;
}

export function FindingsList({ entries, exam }: FindingsListProps) {
  const count = entries.length;
  // Starts at the mount-time count, so the first render never scrolls.
  const prevCountRef = useRef(count);
  const firstItemRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    if (shouldScrollToNewest(prevCountRef.current, count)) {
      firstItemRef.current?.scrollIntoView({ block: 'nearest', behavior: 'auto' });
    }
    prevCountRef.current = count;
  }, [count]);

  return (
    <div data-part="findings-list" className={FINDINGS_BOX_CLASS}>
      {count === 0 ? (
        <p className="text-base break-words">{FINDINGS_EMPTY_TEXT}</p>
      ) : (
        <ol aria-label="Your findings" className="flex flex-col gap-2">
          {entries.map((entry, k) => (
            <li
              key={`${entry.wallClockTime}-${entry.branchId}-${entry.actionId}-${entry.side ?? ''}-${k}`}
              ref={k === 0 ? firstItemRef : undefined}
              className="min-w-0"
            >
              <p className="text-base font-semibold break-words">
                {`${formatMSS(entry.simulationTime)} ${examButtonText(exam, entry.actionId, entry.side ?? null)}`}
              </p>
              <p className="text-base break-words">{entry.sentence}</p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
