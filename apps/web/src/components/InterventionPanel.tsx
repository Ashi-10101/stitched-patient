/**
 * Panel showing available interventions.
 *
 * Buttons follow the order of `interventions` (Case_Definition order).
 * A disabled button shows a lock icon and the visible text
 * "Not available right now", so the state does not rely on colour (play-mode 11.11).
 */

'use client';

import { Intervention } from '@/types';

export const NOT_AVAILABLE_TEXT = 'Not available right now';

interface InterventionPanelProps {
  interventions: Intervention[];
  onApply: (interventionId: string) => void;
  disabled?: boolean;
  /** Button text for an intervention; defaults to the clinical `label` (play-mode 8.2–8.4). */
  getLabel?: (intervention: Intervention) => string;
  /**
   * When it contains a non-whitespace character, every button is disabled and
   * the reason is shown as visible text below the buttons.
   */
  disabledReason?: string;
  /**
   * 'clinician' (default): the grey panel with its "Interventions" heading.
   * 'play': no box and no heading; buttons styled like the Play view's Hint and
   * Rewind buttons, and a disabled button is drawn like the exhausted Hint
   * button (dashed border, lock icon) with "Not available right now" inside.
   */
  variant?: 'clinician' | 'play';
}

const clinicalLabel = (intervention: Intervention): string => intervention.label;

/** Play button classes, shared with ExamPanel (bedside-exam design "ExamPanel.tsx"). */
export const PLAY_BUTTON_CLASS =
  'flex w-full items-start gap-2 whitespace-normal break-words rounded-lg border-2 border-[var(--sp-accent)] px-4 py-2 text-left text-base font-semibold text-[var(--sp-text)]';
export const PLAY_BUTTON_ENABLED_CLASS = 'hover:bg-[var(--sp-accent)] hover:text-[var(--sp-bg)]';
export const PLAY_BUTTON_DISABLED_CLASS = 'cursor-not-allowed border-dashed';

/** Same drawing as the exhausted Hint button's lock (HintPanel); decorative only. */
export function PlayLockIcon() {
  return (
    <svg
      data-part="intervention-lock"
      aria-hidden="true"
      viewBox="0 0 24 24"
      width={20}
      height={20}
      className="mt-0.5 shrink-0"
    >
      <rect x={5} y={11} width={14} height={10} rx={2} fill="none" stroke="currentColor" strokeWidth={2} />
      <path d="M 8 11 V 7.5 a 4 4 0 0 1 8 0 V 11" fill="none" stroke="currentColor" strokeWidth={2} />
    </svg>
  );
}

export function InterventionPanel({
  interventions,
  onApply,
  disabled = false,
  getLabel = clinicalLabel,
  disabledReason,
  variant = 'clinician',
}: InterventionPanelProps) {
  const hasReason = typeof disabledReason === 'string' && /\S/.test(disabledReason);
  const isDisabled = disabled || hasReason;

  if (variant === 'play') {
    return (
      <div data-part="intervention-panel" className="flex flex-col gap-2 text-base text-[var(--sp-text)]">
        {interventions.map((intervention) => (
          <button
            key={intervention.id}
            type="button"
            onClick={() => onApply(intervention.id)}
            disabled={isDisabled}
            className={`${PLAY_BUTTON_CLASS} ${isDisabled ? PLAY_BUTTON_DISABLED_CLASS : PLAY_BUTTON_ENABLED_CLASS}`}
          >
            {isDisabled && <PlayLockIcon />}
            <span className="min-w-0">
              {getLabel(intervention)}
              {isDisabled && <span className="block text-base font-normal">{NOT_AVAILABLE_TEXT}</span>}
            </span>
          </button>
        ))}
        {hasReason && <p className="text-base">{disabledReason}</p>}
      </div>
    );
  }

  return (
    <div className="bg-gray-800 p-4 rounded-lg border border-gray-700">
      <h3 className="text-lg font-semibold mb-4">Interventions</h3>
      <div className="grid grid-cols-1 gap-2">
        {interventions.map((intervention) => (
          <button
            key={intervention.id}
            onClick={() => onApply(intervention.id)}
            disabled={isDisabled}
            className="px-4 py-3 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:text-gray-500 disabled:cursor-not-allowed rounded text-left transition-colors font-medium"
          >
            {isDisabled ? (
              <>
                <span aria-hidden="true" className="mr-2">
                  🔒
                </span>
                {getLabel(intervention)}
                <span className="block text-sm font-normal">{NOT_AVAILABLE_TEXT}</span>
              </>
            ) : (
              getLabel(intervention)
            )}
          </button>
        ))}
      </div>
      {hasReason && <p className="mt-3 text-sm text-gray-300">{disabledReason}</p>}
    </div>
  );
}
