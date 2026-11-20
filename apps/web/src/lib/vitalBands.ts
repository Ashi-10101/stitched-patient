/**
 * Vital_Band calculation (play-mode Requirements 4.1, 4.2, 4.19, 15.7).
 *
 * The band state always comes from `getAlarmState`, so Play mode and the
 * Clinician view cannot disagree about a vital's Alarm_State.
 */

import { getAlarmState } from './alarms';
import type { AlarmState, AlarmThreshold, AlarmThresholds, VitalBand, VitalName } from '@/types';

export type { VitalBand };

/** Same type as `VitalBand['direction']` in `@/types`. */
export type Direction = VitalBand['direction'];

const SEVERITY: Record<AlarmState, number> = { normal: 0, warning: 1, critical: 2 };

/** Strictly below a present bound (an absent bound is skipped). */
const below = (value: number, bound?: number): boolean => bound !== undefined && value < bound;

/**
 * State from `getAlarmState`. Direction is `none` when the state is `normal`;
 * otherwise `low` when the value is strictly below a present `critical.low`,
 * `warning.low` or `normal.low`, and `high` otherwise. A non-normal state means
 * some bound was crossed, so a value that is not below a low bound is above a
 * high bound. Tie rule: if a malformed threshold makes the value both below a
 * low bound and above a high bound, `low` wins.
 */
export function getVitalBand(value: number, t: AlarmThreshold): VitalBand {
  const state = getAlarmState(value, t);
  if (state === 'normal') return { state, direction: 'none' };
  const isLow =
    below(value, t.critical?.low) || below(value, t.warning?.low) || below(value, t.normal?.low);
  return { state, direction: isLow ? 'low' : 'high' };
}

/** Thresholds for a vital, or `undefined` when the case defines none. */
export function thresholdsFor(
  alarms: AlarmThresholds,
  vital: VitalName,
): AlarmThreshold | undefined {
  return alarms[vital];
}

/** Most severe state by `normal < warning < critical`; `normal` for an empty map (4.19). */
export function overallStatus(bands: Partial<Record<VitalName, VitalBand>>): AlarmState {
  let worst: AlarmState = 'normal';
  for (const band of Object.values(bands)) {
    if (band && SEVERITY[band.state] > SEVERITY[worst]) worst = band.state;
  }
  return worst;
}
