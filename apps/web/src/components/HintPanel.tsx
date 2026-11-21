/**
 * Hint panel for the Play view (play-mode Requirements 9.1, 9.2, 9.3, 9.6,
 * 9.9, 11.3, 11.11; design "Hint panel").
 *
 * A native `<button>` handles Enter and Space (9.2, 11.3). Activation goes
 * through `revealIfAllowed`, which calls `onReveal` only while Hints remain,
 * and makes no network call (9.6). The whole panel is omitted when the case
 * has no Hints (9.9).
 */

'use client';

import type { Hint } from '@/types';

export const NO_HINTS_LEFT_TEXT = 'No hints left';

/**
 * Number of Hints to show: `hintsRevealed` clamped to [0, hints.length].
 * Negative or non-finite values count as 0.
 */
export function shownHintCount(hints: readonly Hint[] | undefined, hintsRevealed: number): number {
  const total = hints?.length ?? 0;
  if (!Number.isFinite(hintsRevealed) || hintsRevealed <= 0) return 0;
  return Math.min(Math.floor(hintsRevealed), total);
}

/** Whether another Hint may be revealed. */
export function canRevealHint(hints: readonly Hint[] | undefined, hintsRevealed: number): boolean {
  const total = hints?.length ?? 0;
  return shownHintCount(hints, hintsRevealed) < total;
}

/**
 * Calls `onReveal()` only when another Hint may be revealed. Returns whether
 * `onReveal` was called.
 */
export function revealIfAllowed(
  hints: readonly Hint[] | undefined,
  hintsRevealed: number,
  onReveal: () => void,
): boolean {
  if (!canRevealHint(hints, hintsRevealed)) return false;
  onReveal();
  return true;
}

/** Button text for the number of Hints not yet revealed (9.1, 9.3). */
export function hintButtonText(remaining: number): string {
  return remaining > 0 ? `Hint (${remaining} left)` : NO_HINTS_LEFT_TEXT;
}

export interface HintPanelProps {
  hints: Hint[] | undefined;
  hintsRevealed: number;
  onReveal: () => void;
  /**
   * Drops the panel's own top margin (`mt-4`), so a parent can line the Hint
   * button up with a neighbour. Omitted or false: unchanged output.
   */
  noTopMargin?: boolean;
}

function LockIcon() {
  return (
    <svg data-part="hint-lock" aria-hidden="true" viewBox="0 0 24 24" width={20} height={20} className="shrink-0">
      <rect x={5} y={11} width={14} height={10} rx={2} fill="none" stroke="currentColor" strokeWidth={2} />
      <path d="M 8 11 V 7.5 a 4 4 0 0 1 8 0 V 11" fill="none" stroke="currentColor" strokeWidth={2} />
    </svg>
  );
}

export function HintPanel({ hints, hintsRevealed, onReveal, noTopMargin = false }: HintPanelProps) {
  if (!hints || hints.length === 0) return null;

  const shown = shownHintCount(hints, hintsRevealed);
  const remaining = hints.length - shown;
  const exhausted = remaining === 0;

  return (
    <section
      data-part="hint-panel"
      aria-label="Hints"
      className={`${noTopMargin ? '' : 'mt-4 '}flex flex-col gap-3 text-base text-[var(--sp-text)]`}
    >
      <button
        type="button"
        disabled={exhausted}
        onClick={() => revealIfAllowed(hints, hintsRevealed, onReveal)}
        className={`inline-flex self-start items-center gap-2 rounded-lg border-2 border-[var(--sp-accent)] px-4 py-2 text-base font-semibold text-[var(--sp-text)] ${
          exhausted ? 'cursor-not-allowed border-dashed' : 'hover:bg-[var(--sp-accent)] hover:text-[var(--sp-bg)]'
        }`}
      >
        {exhausted && <LockIcon />}
        <span>{hintButtonText(remaining)}</span>
      </button>
      {shown > 0 && (
        <ol className="list-decimal space-y-2 pl-6 text-lg leading-snug">
          {hints.slice(0, shown).map((hint, i) => (
            <li key={i} className="whitespace-normal break-words">
              {hint.text}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export default HintPanel;
