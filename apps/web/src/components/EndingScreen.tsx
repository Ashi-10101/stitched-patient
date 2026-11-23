/**
 * Ending screen for the Play view (play-mode Requirements 1.8, 7.2–7.6, 7.9,
 * 7.11, 7.12, 10.1, 11.5, 11.10, 11.11; design "Ending screen").
 *
 * A modal overlay below the Safety_Notice (fixed, z-30 under the Rewind_Panel's
 * z-40 and the notice's z-50). It shows the heading, the Avatar in its ending
 * variant and two controls: Rewind (first in DOM order, so the focus trap
 * focuses it) and "Show the monitor". Escape does not close an Ending.
 *
 * The only decoration is a static corner cobweb; the window, moon and bats come
 * from the Avatar's own scene. Markup is pure and deterministic.
 *
 * A non-blank `sideRevealText` (bedside-exam 12.2, 12.3) is shown in full
 * between the heading block and the Avatar, and the Avatar shrinks to make room.
 */

'use client';

import { useRef, type Ref } from 'react';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { SPEECH_BAND_HEIGHT, StitchedPatient } from '@/components/StitchedPatient';
import type { AvatarParameters } from '@/types';

export type EndingKind = 'rescued' | 'lost';

export const ENDING_HEADING: Record<EndingKind, string> = { rescued: 'Rescued', lost: 'Lost' };
export const RESCUED_TEXT = "He's breathing again.";
export const REWIND_LABEL: Record<EndingKind, string> = { rescued: 'Rewind', lost: 'Rewind and try again' };
export const SHOW_MONITOR_LABEL = 'Show the monitor';

export type EndingControlId = 'rewind' | 'monitor';

export interface EndingControl {
  id: EndingControlId;
  label: string;
}

/** The Ending_Screen's controls in render order: Rewind first, then "Show the monitor". Pure. */
export function endingControls(ending: EndingKind): readonly EndingControl[] {
  return [
    { id: 'rewind', label: REWIND_LABEL[ending] },
    { id: 'monitor', label: SHOW_MONITOR_LABEL },
  ];
}

export interface EndingScreenProps {
  ending: EndingKind;
  /** Avatar_Parameters to draw (the page passes endingSnapshot, falling back to the latest). */
  params: AvatarParameters;
  /** Accessible name of the Avatar. */
  statusSentence: string;
  /** Opens the Rewind_Panel on top of this screen. */
  onRewind: () => void;
  /** Switches to the Clinician view. */
  onShowMonitor: () => void;
  /** Attached to the Rewind control, so the Rewind_Panel can return focus to it. */
  rewindButtonRef?: Ref<HTMLButtonElement>;
  /**
   * play.sideRevealText of the Resolved_Case; shown in full when it contains a
   * non-whitespace character (bedside-exam 12.2, 12.3).
   */
  sideRevealText?: string;
}

/** Static corner cobweb: spokes from the top-right corner joined by sagging threads. */
function Cobweb() {
  return (
    <svg
      data-part="cobweb"
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 96 96"
      width="96"
      height="96"
      className="pointer-events-none absolute right-0 top-0 opacity-50"
      fill="none"
      stroke="currentColor"
      strokeWidth={1}
      strokeLinecap="round"
    >
      <path d="M 96 0 L 0 0 M 96 0 L 14 40 M 96 0 L 48 72 M 96 0 L 82 96 M 96 0 L 96 96" />
      <path d="M 76 0 Q 80 6 79 8 Q 84 12 86 16 Q 92 16 96 20" />
      <path d="M 56 0 Q 60 12 61 16 Q 70 22 72 32 Q 84 34 96 40" />
      <path d="M 34 0 Q 40 18 41 26 Q 54 36 58 48 Q 78 52 96 62" />
      <path d="M 12 0 Q 20 24 22 36 Q 40 50 44 64 Q 70 70 96 84" />
    </svg>
  );
}

/**
 * Fixed height above and below the drawing: p-4 top and bottom (2rem),
 * text-2xl heading (2rem), text-base sentence (1.5rem), a button row
 * (py-2 + 1.5rem line + 2px borders = 2.75rem), three gap-3 gaps (2.25rem),
 * plus a 0.5rem safety margin.
 */
const ENDING_OVERHEAD = '11rem';

/**
 * With a Side_Reveal_Text: ENDING_OVERHEAD plus a two-line text-base budget
 * (3rem) and one more gap-3 (0.75rem). At 1280 × 720 the Avatar becomes
 * 305.7 px wide instead of 348.6 px (bedside-exam design "Layout").
 */
export const ENDING_OVERHEAD_WITH_SIDE = '14.75rem';

/**
 * The Ending_Screen never shows speech, so the Avatar's empty speech band is
 * pulled up behind the heading, and the width comes from the height left below
 * the notice (drawing aspect 200 × 280), capped at 22rem.
 */
function avatarWrapperStyle(overhead: string) {
  return {
    marginTop: `calc(-1 * ${SPEECH_BAND_HEIGHT})`,
    width: `min(22rem, calc((100vh - var(--notice-h) - ${overhead}) * 200 / 280))`,
  } as const;
}

const AVATAR_WRAPPER_STYLE = avatarWrapperStyle(ENDING_OVERHEAD);
const AVATAR_WRAPPER_STYLE_WITH_SIDE = avatarWrapperStyle(ENDING_OVERHEAD_WITH_SIDE);

const BUTTON_CLASS =
  'rounded-lg border-2 border-[var(--sp-accent)] px-4 py-2 text-base font-semibold text-[var(--sp-text)] hover:bg-[var(--sp-accent)] hover:text-[var(--sp-bg)]';

export function EndingScreen({
  ending,
  params,
  statusSentence,
  onRewind,
  onShowMonitor,
  rewindButtonRef,
  sideRevealText,
}: EndingScreenProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  useFocusTrap(containerRef, { active: true });
  const showSide = sideRevealText !== undefined && sideRevealText.trim() !== '';

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-modal="true"
      aria-label={ENDING_HEADING[ending]}
      data-part="ending-screen"
      data-ending={ending}
      className="sp-play sp-ending fixed inset-x-0 bottom-0 z-30 overflow-y-auto bg-[var(--sp-bg)] text-base text-[var(--sp-text)]"
      style={{ top: 'var(--notice-h)' }}
    >
      <Cobweb />
      <div className="relative mx-auto flex w-full max-w-lg flex-col items-center gap-3 p-4 text-center">
        <h2 className="text-2xl font-semibold">{ENDING_HEADING[ending]}</h2>
        {ending === 'rescued' && <p className="text-base">{RESCUED_TEXT}</p>}
        {showSide && (
          <p data-part="side-reveal" className="text-base">
            {sideRevealText}
          </p>
        )}
        <div
          data-part="ending-avatar"
          className="max-w-full [&_[data-part=speech-band]]:pointer-events-none"
          style={showSide ? AVATAR_WRAPPER_STYLE_WITH_SIDE : AVATAR_WRAPPER_STYLE}
        >
          <StitchedPatient params={params} statusSentence={statusSentence} variant={ending} />
        </div>
        <div className="flex flex-wrap justify-center gap-3">
          {endingControls(ending).map((control) =>
            control.id === 'rewind' ? (
              <button
                key={control.id}
                ref={rewindButtonRef}
                type="button"
                data-control={control.id}
                onClick={onRewind}
                className={BUTTON_CLASS}
              >
                {control.label}
              </button>
            ) : (
              <button
                key={control.id}
                type="button"
                data-control={control.id}
                onClick={onShowMonitor}
                className={BUTTON_CLASS}
              >
                {control.label}
              </button>
            ),
          )}
        </div>
      </div>
    </div>
  );
}

export default EndingScreen;
