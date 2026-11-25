/**
 * Single vital sign display with alarm state.
 *
 * The readout text comes from `formatVital`, which writes the Displayed_Value
 * of the raw Vitals_Stream value with the single Display_Precision definition
 * (play-mode 15.13, 15.14). Without `alarmState` the tile uses a neutral grey
 * style and no alarm colour (play-mode 1.7, 1.11).
 */

import { AlarmState } from '@/types';
import { getAlarmColor, getAlarmBgColor } from '@/lib/alarms';
import { formatVital, type VitalName } from '@/lib/vitals';

interface VitalSignProps {
  label: string;
  /** Which vital this tile shows; selects its Display_Precision. */
  vital: VitalName;
  /** Raw value in the Vitals_Stream unit (SpO2 as a fraction). */
  raw: number;
  unit: string;
  /** Omit for a neutral tile with no alarm colour. */
  alarmState?: AlarmState;
}

/** Neutral classes; none of them is returned by getAlarmColor or getAlarmBgColor. */
const NEUTRAL_TEXT = 'text-gray-100';
const NEUTRAL_BG = 'bg-gray-900';

export function VitalSign({ label, vital, raw, unit, alarmState }: VitalSignProps) {
  const colorClass = alarmState ? getAlarmColor(alarmState) : NEUTRAL_TEXT;
  const bgClass = alarmState ? getAlarmBgColor(alarmState) : NEUTRAL_BG;

  return (
    <div className={`flex flex-col items-center justify-center p-6 rounded-lg ${bgClass} border border-gray-700`}>
      <div className="text-sm text-gray-400 mb-2">{label}</div>
      <div className={`text-5xl font-bold tabular-nums ${colorClass}`}>
        {formatVital(vital, raw)}
      </div>
      <div className="text-sm text-gray-400 mt-2">{unit}</div>
    </div>
  );
}
