/**
 * Pure time helpers for the Play_View (Requirements 5.15, 10.5, 12.5).
 */

/**
 * Formats a Simulation_Time in seconds as `M:SS`: rounded down to the whole
 * second, minutes unpadded, seconds zero-padded to two digits.
 * Negative, -0 and non-finite inputs give `"0:00"`.
 */
export function formatMSS(seconds: number): string {
  const total = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const minutes = Math.floor(total / 60);
  const secs = total % 60;
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Remaining Simulation_Time before `endings.lost.timeLimitSeconds`:
 * `max(0, limit - latest)`, unrounded (the caller formats it).
 * A `null` or non-finite `latest` counts as no sample yet, so it is treated as 0.
 */
export function remainingSeconds(timeLimitSeconds: number, latestTime: number | null): number {
  const latest = latestTime !== null && Number.isFinite(latestTime) ? latestTime : 0;
  return Math.max(0, timeLimitSeconds - latest);
}
