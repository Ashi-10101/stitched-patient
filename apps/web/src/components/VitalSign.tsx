/**
 * Single vital sign display with alarm state.
 *
 * Without `alarmState` the tile uses a neutral grey style and no alarm
 * colour (play-mode 1.7, 1.11).
 */

import { AlarmState } from '@/types';
import { getAlarmColor, getAlarmBgColor } from '@/lib/alarms';

interface VitalSignProps {
  label: string;
  value: number;
  unit: string;
  /** Omit for a neutral tile with no alarm colour. */
  alarmState?: AlarmState;
  decimals?: number;
}

/** Neutral classes; none of them is returned by getAlarmColor or getAlarmBgColor. */
const NEUTRAL_TEXT = 'text-gray-100';
const NEUTRAL_BG = 'bg-gray-900';

export function VitalSign({ label, value, unit, alarmState, decimals = 0 }: VitalSignProps) {
  const colorClass = alarmState ? getAlarmColor(alarmState) : NEUTRAL_TEXT;
  const bgClass = alarmState ? getAlarmBgColor(alarmState) : NEUTRAL_BG;

  return (
    <div className={`flex flex-col items-center justify-center p-6 rounded-lg ${bgClass} border border-gray-700`}>
      <div className="text-sm text-gray-400 mb-2">{label}</div>
      <div className={`text-5xl font-bold tabular-nums ${colorClass}`}>
        {value.toFixed(decimals)}
      </div>
      <div className="text-sm text-gray-400 mt-2">{unit}</div>
    </div>
  );
}
