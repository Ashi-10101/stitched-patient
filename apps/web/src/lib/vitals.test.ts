import { describe, expect, it } from 'vitest';
import type { VitalSigns } from '@/types';
import { VITAL_FIELD, VITAL_NAMES, readVital, type VitalName } from './vitals';

const sample: VitalSigns = {
  simulation_time: 12,
  heart_rate: 72,
  respiratory_rate: 16,
  spo2: 0.974,
  mean_arterial_pressure: 95,
  etco2: 38,
  tidal_volume: 500,
};

describe('VITAL_FIELD', () => {
  it('maps every case vital name to the design table field', () => {
    expect(VITAL_FIELD).toEqual({
      heartRate: 'heart_rate',
      respiratoryRate: 'respiratory_rate',
      spO2: 'spo2',
      meanArterialPressure: 'mean_arterial_pressure',
      etCO2: 'etco2',
      tidalVolume: 'tidal_volume',
    });
    expect(Object.keys(VITAL_FIELD).sort()).toEqual([...VITAL_NAMES].sort());
  });
});

describe('readVital', () => {
  it.each(VITAL_NAMES)('returns the finite value for %s', (vital) => {
    expect(readVital(sample, vital)).toBe(sample[VITAL_FIELD[vital]]);
  });

  it.each([0, -0, -5.5, 1e-9, Number.MAX_VALUE])('returns finite value %d as is', (v) => {
    for (const vital of VITAL_NAMES) {
      const s = { ...sample, [VITAL_FIELD[vital]]: v } as Partial<VitalSigns>;
      expect(readVital(s, vital)).toBe(v);
    }
  });

  it('returns undefined for a missing sample', () => {
    for (const vital of VITAL_NAMES) {
      expect(readVital(null, vital)).toBeUndefined();
      expect(readVital(undefined, vital)).toBeUndefined();
    }
  });

  it('returns undefined for a missing field', () => {
    for (const vital of VITAL_NAMES) {
      const s: Partial<VitalSigns> = { ...sample };
      delete s[VITAL_FIELD[vital]];
      expect(readVital(s, vital)).toBeUndefined();
      expect(readVital({}, vital)).toBeUndefined();
    }
  });

  it.each([
    ['null', null],
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['-Infinity', -Infinity],
    ['undefined', undefined],
  ])('returns undefined for %s', (_name, v) => {
    for (const vital of VITAL_NAMES) {
      const s = { ...sample, [VITAL_FIELD[vital]]: v } as unknown as Partial<VitalSigns>;
      expect(readVital(s, vital as VitalName)).toBeUndefined();
    }
  });
});
