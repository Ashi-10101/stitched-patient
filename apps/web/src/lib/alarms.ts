/**
 * Alarm state calculation.
 */

import { AlarmState, AlarmThreshold } from '@/types';

export function getAlarmState(value: number, threshold: AlarmThreshold): AlarmState {
  // Check critical ranges first
  if (threshold.critical) {
    if (threshold.critical.low !== undefined && value < threshold.critical.low) {
      return 'critical';
    }
    if (threshold.critical.high !== undefined && value > threshold.critical.high) {
      return 'critical';
    }
  }

  // Check warning ranges
  if (threshold.warning) {
    if (threshold.warning.low !== undefined && value < threshold.warning.low) {
      return 'warning';
    }
    if (threshold.warning.high !== undefined && value > threshold.warning.high) {
      return 'warning';
    }
  }

  // Otherwise normal
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
