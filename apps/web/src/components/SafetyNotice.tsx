/**
 * Safety notice: sticky bar at the top of every session view (Requirement 1.8).
 *
 * The bar has a fixed height that is published on :root as `--notice-h`, so
 * sibling content (e.g. `<main className="pt-[var(--notice-h)]">`) can read it.
 * The height fits two lines of 16 px text, so the notice still fits when it
 * wraps at a 320 px viewport.
 */

'use client';

export const SAFETY_NOTICE_TEXT = 'Educational simulation, not for clinical use';

/** Bar height: 2 lines × 1.25rem line height + 2 × 0.5rem padding. */
export const NOTICE_HEIGHT = '3.5rem';

export function SafetyNotice() {
  return (
    <>
      <style>{`:root{--notice-h:${NOTICE_HEIGHT};}`}</style>
      <div
        role="note"
        aria-label="Safety notice"
        className="sticky top-0 z-50 w-full flex items-center justify-center px-4 py-2 bg-yellow-300 text-gray-900 border-b-2 border-yellow-500 text-base leading-5 font-semibold text-center"
        style={{ height: 'var(--notice-h)' }}
      >
        <span aria-hidden="true" className="mr-2">
          ⚠
        </span>
        <span>{SAFETY_NOTICE_TEXT}</span>
      </div>
    </>
  );
}
