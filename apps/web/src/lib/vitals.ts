/**
 * Case vital names and safe reading of values from a Vitals_Stream sample.
 */

import type { VitalSigns } from '@/types';

export const VITAL_NAMES = [
  'heartRate',
  'respiratoryRate',
  'spO2',
  'meanArterialPressure',
  'etCO2',
  'tidalVolume',
] as const;

export type VitalName = (typeof VITAL_NAMES)[number];

/** Case vital name -> VitalSigns field (units as the Vitals_Stream reports; SpO2 is a fraction). */
export const VITAL_FIELD: Record<VitalName, keyof VitalSigns> = {
  heartRate: 'heart_rate',
  respiratoryRate: 'respiratory_rate',
  spO2: 'spo2',
  meanArterialPressure: 'mean_arterial_pressure',
  etCO2: 'etco2',
  tidalVolume: 'tidal_volume',
};

/** Finite number or undefined. Missing, null, NaN and ±Infinity all give undefined. */
export function readVital(
  sample: Partial<VitalSigns> | null | undefined,
  vital: VitalName,
): number | undefined {
  if (sample == null) return undefined;
  const value: unknown = sample[VITAL_FIELD[vital]];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
