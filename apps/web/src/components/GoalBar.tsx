/**
 * Goal bar (play-mode Requirements 5.14, 5.15; design "Play view", `GoalBar`).
 *
 * A pure function of its props. Shows the Goal_Text in full and, when the
 * Case defines `endings.lost.timeLimitSeconds`, a progress bar of the time
 * left with a visible `M:SS left` label. The bar's value is the remaining
 * Simulation_Time and its max is the Time_Limit, so it empties as time runs out.
 */
import { formatMSS, remainingSeconds } from '@/lib/timeFormat';

export interface GoalBarProps {
  goalText: string;
  /** `endings.lost.timeLimitSeconds`; no bar when undefined. */
  timeLimitSeconds?: number;
  /** Simulation_Time of the most recent VitalSigns sample of the current Branch. */
  latestTime: number | null;
}

export function GoalBar({ goalText, timeLimitSeconds, latestTime }: GoalBarProps) {
  const hasLimit = timeLimitSeconds !== undefined;
  const remaining = hasLimit ? remainingSeconds(timeLimitSeconds, latestTime) : 0;

  return (
    <section data-part="goal-bar" className="text-base text-[var(--sp-text)]">
      <p className="whitespace-normal break-words text-lg leading-snug">
        <span className="font-semibold text-[var(--sp-accent)]">Goal: </span>
        <span data-part="goal-text">{goalText}</span>
      </p>
      {hasLimit && (
        <div data-part="time-left" className="mt-2 flex items-center gap-3">
          <progress
            aria-label="Time left"
            value={remaining}
            max={timeLimitSeconds}
            className="h-3 w-full flex-1 accent-[var(--sp-accent)]"
          />
          <span className="shrink-0 font-semibold tabular-nums">{`${formatMSS(remaining)} left`}</span>
        </div>
      )}
    </section>
  );
}

export default GoalBar;
