/**
 * "Check on him" group of the Play_View (bedside-exam Requirement 6, design "ExamPanel.tsx").
 *
 * One row per Exam_Action in Case_Definition order; a Sided_Action row holds
 * its Left button before its Right button. Every button text comes from the
 * case unchanged (6.2). The buttons carry no data attribute that names the
 * Affected_Side or the Variant.
 */

'use client';

import { examButtons, type ExamButtonSpec } from '@/lib/examFinding';
import type { ExamSection, Side } from '@/types';
import {
  PLAY_BUTTON_CLASS,
  PLAY_BUTTON_DISABLED_CLASS,
  PLAY_BUTTON_ENABLED_CLASS,
  PlayLockIcon,
} from './InterventionPanel';

export const EXAM_HEADING_TEXT = 'Check on him'; // UI text, not clinical

export interface ExamPanelProps {
  exam: ExamSection;
  /** Ending set, or a fork pending from the Play_View (6.9). */
  disabled: boolean;
  onExamine: (actionId: string, side: Side | null) => void;
}

const SIDED_ROW_CLASS = 'grid grid-cols-1 gap-2 sm:grid-cols-2';

export function ExamPanel({ exam, disabled, onExamine }: ExamPanelProps) {
  const buttonClass = `${PLAY_BUTTON_CLASS} min-w-0 ${disabled ? PLAY_BUTTON_DISABLED_CLASS : PLAY_BUTTON_ENABLED_CLASS}`;

  const renderButton = (spec: ExamButtonSpec) => (
    <button
      key={spec.key}
      type="button"
      data-control="exam"
      onClick={() => onExamine(spec.actionId, spec.side)}
      disabled={disabled}
      className={buttonClass}
    >
      {disabled && <PlayLockIcon />}
      <span className="min-w-0">{spec.text}</span>
    </button>
  );

  return (
    <section data-part="exam-panel" className="flex flex-col gap-2">
      <h2 className="text-lg font-semibold">{EXAM_HEADING_TEXT}</h2>
      {examButtons(exam).map((group) => (
        <div
          key={group[0].actionId}
          data-part="exam-row"
          className={group[0].side !== null ? SIDED_ROW_CLASS : undefined}
        >
          {group.map(renderButton)}
        </div>
      ))}
    </section>
  );
}
