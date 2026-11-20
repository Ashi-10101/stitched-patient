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
}

const clinicalLabel = (intervention: Intervention): string => intervention.label;

export function InterventionPanel({
  interventions,
  onApply,
  disabled = false,
  getLabel = clinicalLabel,
  disabledReason,
}: InterventionPanelProps) {
  const hasReason = typeof disabledReason === 'string' && /\S/.test(disabledReason);
  const isDisabled = disabled || hasReason;

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
