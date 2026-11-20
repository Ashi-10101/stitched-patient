/**
 * Alarm state calculation (play-mode Requirement 15).
 *
 * Both views compute every Alarm_State with `getAlarmState`.
 */

import { AlarmState, AlarmThreshold } from '@/types';

/** Strictly below a present bound; a value equal to the bound is inside it (15.4). */
const below = (value: number, bound?: number): boolean => bound !== undefined && value < bound;
/** Strictly above a present bound (15.4). */
const above = (value: number, bound?: number): boolean => bound !== undefined && value > bound;

/**
 * Pure function of `value` and `threshold` (15.6). Any of `critical`, `warning`
 * and `normal`, and any bound inside them, may be absent; absent bounds are skipped (15.5).
 */
export function getAlarmState(value: number, threshold: AlarmThreshold): AlarmState {
  const c = threshold.critical;
  const w = threshold.warning;
  const n = threshold.normal;

  // 15.1: beyond a critical limit
  if (below(value, c?.low) || above(value, c?.high)) return 'critical';

  // 15.2: outside the normal range or beyond a warning limit
  if (
    below(value, n?.low) ||
    above(value, n?.high) ||
    below(value, w?.low) ||
    above(value, w?.high)
  ) {
    return 'warning';
  }

  // 15.3
  return 'normal';
}

export function getAlarmColor(state: AlarmState): string {
  switch (state) {
    case 'critical':
      return 'text-red-500';
    case 'warning':
      return 'text-yellow-500';
    case 'normal':
      return 'text-green-400';
  }
}

export function getAlarmBgColor(state: AlarmState): string {
  switch (state) {
    case 'critical':
      return 'bg-red-500/20';
    case 'warning':
      return 'bg-yellow-500/20';
    case 'normal':
      return 'bg-gray-800';
  }
}
