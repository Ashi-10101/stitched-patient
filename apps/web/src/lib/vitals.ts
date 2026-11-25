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

/**
 * Display_Precision (play-mode 15.13): the only definition of how the
 * Clinician_View readouts show each vital. `scale` converts the Vitals_Stream
 * unit to the shown unit (SpO2 fraction -> percentage); `decimals` is the
 * number of decimals shown. UI display constants, not clinical values.
 */
export const DISPLAY_PRECISION: Readonly<Record<VitalName, { readonly scale: number; readonly decimals: number }>> = {
  heartRate: { scale: 1, decimals: 0 },
  respiratoryRate: { scale: 1, decimals: 0 },
  spO2: { scale: 100, decimals: 1 },
  meanArterialPressure: { scale: 1, decimals: 0 },
  etCO2: { scale: 1, decimals: 0 },
  tidalVolume: { scale: 1, decimals: 0 },
};

/**
 * Displayed_Value (15.15): the number the readout shows for `raw`, in the
 * Vitals_Stream unit: `Number((raw * scale).toFixed(decimals)) / scale`, with
 * `-0` written as `0`. `undefined` for a non-finite raw value or result.
 */
export function displayedValue(vital: VitalName, raw: number): number | undefined {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return undefined;
  const { scale, decimals } = DISPLAY_PRECISION[vital];
  const result = Number((raw * scale).toFixed(decimals)) / scale;
  if (!Number.isFinite(result)) return undefined;
  return result === 0 ? 0 : result;
}

/**
 * Readout text (15.14): the Displayed_Value written with the Display_Precision,
 * or `""` when there is none. Equals `(raw * scale).toFixed(decimals)` except
 * that a negative raw value that rounds to zero is written without the minus
 * sign ("0", "0.0").
 */
export function formatVital(vital: VitalName, raw: number): string {
  const shown = displayedValue(vital, raw);
  if (shown === undefined) return '';
  const { scale, decimals } = DISPLAY_PRECISION[vital];
  return (shown * scale).toFixed(decimals);
}

/** `displayedValue(vital, readVital(sample, vital))`: the value every Vital_Band caller passes (15.16). */
export function readDisplayedVital(
  sample: Partial<VitalSigns> | null | undefined,
  vital: VitalName,
): number | undefined {
  const raw = readVital(sample, vital);
  return raw === undefined ? undefined : displayedValue(vital, raw);
}
