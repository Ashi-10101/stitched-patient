/**
 * Single vital sign display with alarm state.
 */

import { AlarmState } from '@/types';
import { getAlarmColor, getAlarmBgColor } from '@/lib/alarms';

interface VitalSignProps {
  label: string;
  value: number;
  unit: string;
  alarmState: AlarmState;
  decimals?: number;
}

export function VitalSign({ label, value, unit, alarmState, decimals = 0 }: VitalSignProps) {
  const colorClass = getAlarmColor(alarmState);
  const bgClass = getAlarmBgColor(alarmState);

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
