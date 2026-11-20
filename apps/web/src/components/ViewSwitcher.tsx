/**
 * View switcher: two-option segmented control for Play and Clinician
 * (Requirements 1.2, 1.3, 1.10, 1.11).
 *
 * Disabled options use `aria-disabled` rather than the HTML `disabled`
 * attribute, so they stay focusable and the reason text stays discoverable.
 * Activation goes through `selectIfAllowed`, which ignores disabled options.
 */

'use client';

import { useId } from 'react';
import type { SessionUiState, View } from '@/lib/sessionState';

export type CaseStatus = SessionUiState['caseStatus'];

export const PLAY_NOT_AVAILABLE_TEXT = 'Play mode is not available for this case';
export const PLAY_CASE_FAILED_TEXT = 'Play mode is unavailable: the case could not be loaded.';

const OPTIONS: ReadonlyArray<{ view: View; label: string }> = [
  { view: 'play', label: 'Play' },
  { view: 'clinician', label: 'Clinician' },
];

/**
 * Whether an option may be selected. Nothing is selectable while the case is
 * loading; Clinician is selectable otherwise; Play only when the case loaded
 * and has a Play_Section.
 */
export function canSelectView(option: View, caseStatus: CaseStatus, hasPlay: boolean): boolean {
  if (caseStatus === 'loading') return false;
  if (option === 'clinician') return true;
  return caseStatus === 'loaded' && hasPlay;
}

/** Reason shown next to a disabled Play option, or null when none applies. */
export function playUnavailableReason(caseStatus: CaseStatus, hasPlay: boolean): string | null {
  if (caseStatus === 'failed') return PLAY_CASE_FAILED_TEXT;
  if (caseStatus === 'loaded' && !hasPlay) return PLAY_NOT_AVAILABLE_TEXT;
  return null;
}

/**
 * Calls `onSelect(option)` only when the option may be selected and is not
 * already the current view. Returns whether `onSelect` was called.
 */
export function selectIfAllowed(
  option: View,
  current: View,
  caseStatus: CaseStatus,
  hasPlay: boolean,
  onSelect: (view: View) => void,
): boolean {
  if (option === current) return false;
  if (!canSelectView(option, caseStatus, hasPlay)) return false;
  onSelect(option);
  return true;
}

interface ViewSwitcherProps {
  view: View;
  caseStatus: CaseStatus;
  hasPlay: boolean;
  onSelect: (view: View) => void;
}

export function ViewSwitcher({ view, caseStatus, hasPlay, onSelect }: ViewSwitcherProps) {
  const reasonId = useId();
  const reason = playUnavailableReason(caseStatus, hasPlay);

  return (
    <div className="flex flex-col gap-1">
      <div
        role="radiogroup"
        aria-label="View"
        className="inline-flex self-start rounded-lg border border-gray-700 bg-gray-800 p-1"
      >
        {OPTIONS.map(({ view: option, label }) => {
          const selected = option === view;
          const allowed = canSelectView(option, caseStatus, hasPlay);
          const describedBy = option === 'play' && reason ? reasonId : undefined;
          return (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-disabled={!allowed || undefined}
              aria-describedby={describedBy}
              onClick={() => selectIfAllowed(option, view, caseStatus, hasPlay, onSelect)}
              className={`flex items-center gap-2 px-4 py-2 rounded text-base font-semibold transition-colors ${
                selected
                  ? 'bg-blue-600 text-white underline underline-offset-4'
                  : 'text-gray-300'
              } ${allowed ? (selected ? '' : 'hover:bg-gray-700') : 'opacity-50 cursor-not-allowed'}`}
            >
              {selected && <span aria-hidden="true">✓</span>}
              <span>{label}</span>
            </button>
          );
        })}
      </div>
      {reason && (
        <p id={reasonId} className="text-base text-gray-300">
          {reason}
        </p>
      )}
    </div>
  );
}
