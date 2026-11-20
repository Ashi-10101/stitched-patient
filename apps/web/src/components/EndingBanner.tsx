/**
 * Ending banner for the Clinician_View (play-mode 7.8).
 *
 * Shown while the Ending is not `none`. The Ending is stated in words, so it
 * does not rely on colour. "Open Play view" selects the Play view, which then
 * shows the Ending_Screen because the Ending is still set (7.11).
 */

'use client';

import type { Ending } from '@/lib/endingEvaluator';
import type { View } from '@/lib/sessionState';

export const ENDING_TEXT: Record<Exclude<Ending, 'none'>, string> = {
  rescued: 'Ending: Rescued',
  lost: 'Ending: Lost',
};

export const OPEN_PLAY_TEXT = 'Open Play view';

/** Click handler of the "Open Play view" button. */
export function openPlayView(onSelectView: (view: View) => void): void {
  onSelectView('play');
}

interface EndingBannerProps {
  ending: Ending;
  onSelectView: (view: View) => void;
}

export function EndingBanner({ ending, onSelectView }: EndingBannerProps) {
  if (ending === 'none') return null;

  return (
    <div
      role="status"
      className="flex items-center justify-between gap-4 bg-gray-800 p-4 rounded-lg border border-gray-500"
    >
      <h2 className="text-lg font-semibold">{ENDING_TEXT[ending]}</h2>
      <button
        type="button"
        onClick={() => openPlayView(onSelectView)}
        className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded font-semibold transition-colors"
      >
        {OPEN_PLAY_TEXT}
      </button>
    </div>
  );
}
