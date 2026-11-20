import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { getAlarmState } from './alarms';
import { getVitalBand, overallStatus, thresholdsFor } from './vitalBands';
import { VITAL_NAMES } from './vitals';
import type { AlarmThreshold, VitalBand, VitalName } from '@/types';
import { CASE, VITAL_OFFSETS } from '@/test/caseFixtures';
import { THRESHOLD_GRID, arbThreshold } from '@/test/generators';
import { PBT_PARAMS } from '@/test/pbt';

const lowBounds = (t: AlarmThreshold): number[] =>
  [t.critical?.low, t.warning?.low, t.normal?.low].filter((b): b is number => b !== undefined);
const highBounds = (t: AlarmThreshold): number[] =>
  [t.critical?.high, t.warning?.high, t.normal?.high].filter((b): b is number => b !== undefined);

/** Requirement 4.2 / Property 2 checks for one value. */
function checkBand(value: number, t: AlarmThreshold): void {
  const band = getVitalBand(value, t);
  const label = `value ${value}`;
  expect(band.state, label).toBe(getAlarmState(value, t));
  expect(band.direction === 'none', label).toBe(band.state === 'normal');
  if (band.direction === 'low') {
    expect(lowBounds(t).some((b) => value < b), label).toBe(true);
  }
  if (band.direction === 'high') {
    expect(highBounds(t).some((b) => value > b), label).toBe(true);
  }
}

const vitalsWithThresholds = VITAL_NAMES.filter((v) => thresholdsFor(CASE.alarms, v) !== undefined);

describe('getVitalBand: case thresholds', () => {
  it('the case file defines thresholds for every vital', () => {
    expect(vitalsWithThresholds).toEqual([...VITAL_NAMES]);
  });

  describe.each(vitalsWithThresholds)('%s', (vital: VitalName) => {
    const t = thresholdsFor(CASE.alarms, vital)!;
    const offset = VITAL_OFFSETS[vital];
    const bounds = [...lowBounds(t), ...highBounds(t)];

    it('agrees with getAlarmState at each boundary and boundary ± offset', () => {
      expect(bounds.length).toBeGreaterThan(0);
      for (const b of bounds) {
        checkBand(b, t);
        checkBand(b - offset, t);
        checkBand(b + offset, t);
      }
    });

    it('agrees with getAlarmState at 101 evenly spaced values from 50% of the lowest to 150% of the highest boundary', () => {
      const start = 0.5 * Math.min(...bounds);
      const end = 1.5 * Math.max(...bounds);
      const steps = 100;
      for (let i = 0; i <= steps; i++) checkBand(start + ((end - start) * i) / steps, t);
    });

    it('gives low below the range and high above it', () => {
      expect(getVitalBand(0.5 * Math.min(...bounds), t).direction).toBe('low');
      expect(getVitalBand(1.5 * Math.max(...bounds), t).direction).toBe('high');
    });
  });

  it('baseline vitals are normal with direction none', () => {
    const baseline: Record<VitalName, number> = {
      heartRate: 72,
      respiratoryRate: 12,
      spO2: 0.974,
      meanArterialPressure: 95,
      etCO2: 36,
      tidalVolume: 535,
    };
    for (const vital of VITAL_NAMES) {
      expect(getVitalBand(baseline[vital], CASE.alarms[vital]!), vital).toEqual({
        state: 'normal',
        direction: 'none',
      });
    }
  });
});

describe('getVitalBand: examples', () => {
  const t: AlarmThreshold = {
    critical: { low: 40, high: 140 },
    warning: { low: 50, high: 120 },
    normal: { low: 60, high: 100 },
  };

  it('maps each band and side', () => {
    expect(getVitalBand(80, t)).toEqual({ state: 'normal', direction: 'none' });
    expect(getVitalBand(60, t)).toEqual({ state: 'normal', direction: 'none' });
    expect(getVitalBand(55, t)).toEqual({ state: 'warning', direction: 'low' });
    expect(getVitalBand(110, t)).toEqual({ state: 'warning', direction: 'high' });
    expect(getVitalBand(30, t)).toEqual({ state: 'critical', direction: 'low' });
    expect(getVitalBand(150, t)).toEqual({ state: 'critical', direction: 'high' });
  });

  it('low wins when a malformed threshold is crossed on both sides', () => {
    const malformed: AlarmThreshold = { normal: { low: 100, high: 60 } };
    expect(getVitalBand(80, malformed)).toEqual({ state: 'warning', direction: 'low' });
    const crossedCritical: AlarmThreshold = { critical: { low: 10, high: 0 } };
    expect(getVitalBand(5, crossedCritical)).toEqual({ state: 'critical', direction: 'low' });
  });

  it('returns normal / none when every object is absent', () => {
    expect(getVitalBand(-1e9, {})).toEqual({ state: 'normal', direction: 'none' });
    expect(getVitalBand(1e9, {})).toEqual({ state: 'normal', direction: 'none' });
  });
});

describe('thresholdsFor', () => {
  it('returns the case threshold object for a vital', () => {
    expect(thresholdsFor(CASE.alarms, 'heartRate')).toBe(CASE.alarms.heartRate);
  });

  it('returns undefined for a vital without thresholds', () => {
    const { etCO2: _omit, ...rest } = CASE.alarms;
    expect(thresholdsFor(rest, 'etCO2')).toBeUndefined();
  });
});

describe('overallStatus', () => {
  const n: VitalBand = { state: 'normal', direction: 'none' };
  const w: VitalBand = { state: 'warning', direction: 'low' };
  const c: VitalBand = { state: 'critical', direction: 'high' };

  it('returns normal for an empty map', () => {
    expect(overallStatus({})).toBe('normal');
  });

  it('returns the most severe state', () => {
    expect(overallStatus({ heartRate: n, spO2: n })).toBe('normal');
    expect(overallStatus({ heartRate: n, spO2: w })).toBe('warning');
    expect(overallStatus({ heartRate: c, spO2: w, etCO2: n })).toBe('critical');
    expect(overallStatus({ tidalVolume: w, meanArterialPressure: c })).toBe('critical');
    expect(overallStatus({ spO2: c, heartRate: n })).toBe('critical');
  });
});

const arbFiniteValue = fc.oneof(
  fc.constantFrom(...THRESHOLD_GRID),
  fc
    .tuple(fc.constantFrom(...THRESHOLD_GRID), fc.constantFrom(-0.25, -0.001, 0.001, 0.25))
    .map(([g, d]) => g + d),
  fc.double({ noNaN: true, noDefaultInfinity: true }),
);

describe('getVitalBand: properties', () => {
  // Feature: play-mode, Property 2: Vital_Band agrees with the Alarm_Function
  it('Property 2: Vital_Band agrees with the Alarm_Function', () => {
    fc.assert(
      fc.property(arbThreshold, arbFiniteValue, (threshold, value) => {
        checkBand(value, threshold);
      }),
      PBT_PARAMS,
    );
  });
});
