/**
 * Status line under the Avatar (play-mode Requirements 4.19, 5.1, 5.6, 5.11,
 * 5.13, 11.1; design "Play view", `StatusLine`).
 *
 * A pure function of its props. The Overall_Status badge pairs a shape with a
 * visible word so the state does not rely on colour, and it sits outside the
 * live region. The `<p aria-live="polite">` holds only the Status_Sentence as
 * a single text node, so React leaves it untouched when the sentence is
 * unchanged and assistive technology does not announce it again (5.13).
 *
 * The badge SVGs have no ids, <defs>, hrefs or url() references, because
 * more than one badge can be on screen.
 */
import type { AlarmState } from '@/types';

export type BadgeShape = 'circle-check' | 'triangle' | 'octagon';

export interface StatusBadge {
  label: 'OK' | 'Worried' | 'Danger';
  shape: BadgeShape;
}

/** Overall_Status to badge word and shape (4.19, 11.1). */
export const STATUS_BADGE: Record<AlarmState, StatusBadge> = {
  normal: { label: 'OK', shape: 'circle-check' },
  warning: { label: 'Worried', shape: 'triangle' },
  critical: { label: 'Danger', shape: 'octagon' },
};

export interface StatusLineProps {
  overallStatus: AlarmState;
  statusSentence: string;
}

const STROKE = 'var(--sp-text)';
const ACCENT = 'var(--sp-accent)';

function BadgeIcon({ shape }: { shape: BadgeShape }) {
  return (
    <svg data-shape={shape} aria-hidden="true" viewBox="0 0 24 24" width={24} height={24} className="shrink-0">
      {shape === 'circle-check' && (
        <>
          <circle cx={12} cy={12} r={10} fill="none" stroke={STROKE} strokeWidth={2} />
          <path
            data-part="check"
            d="M 7 12.5 L 10.5 16 L 17 8.5"
            fill="none"
            stroke={STROKE}
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      )}
      {shape === 'triangle' && (
        <polygon points="12,2 22.5,21 1.5,21" fill={ACCENT} stroke={STROKE} strokeWidth={1.5} strokeLinejoin="round" />
      )}
      {shape === 'octagon' && (
        <polygon
          points="7.9,2 16.1,2 22,7.9 22,16.1 16.1,22 7.9,22 2,16.1 2,7.9"
          fill={ACCENT}
          stroke={STROKE}
          strokeWidth={1.5}
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}

export function StatusLine({ overallStatus, statusSentence }: StatusLineProps) {
  const badge = STATUS_BADGE[overallStatus];
  return (
    <div data-part="status-line" className="mt-3 flex items-start gap-3 text-base text-[var(--sp-text)]">
      <span
        data-part="status-badge"
        data-status={overallStatus}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-[var(--sp-accent)] px-3 py-1 font-semibold"
      >
        <BadgeIcon shape={badge.shape} />
        <span>{badge.label}</span>
      </span>
      <p aria-live="polite" className="min-w-0 flex-1 whitespace-normal break-words text-lg leading-snug">
        {statusSentence}
      </p>
    </div>
  );
}

export default StatusLine;
