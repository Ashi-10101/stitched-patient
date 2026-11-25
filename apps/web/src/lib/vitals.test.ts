import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { clinicianAlarmState } from '@/components/ClinicianView';
import { CASE } from '@/test/caseFixtures';
import { THRESHOLD_GRID, arbThreshold } from '@/test/generators';
import { PBT_PARAMS } from '@/test/pbt';
import type { AlarmState, AlarmThreshold, AlarmThresholds, StatusWhen, VitalSigns } from '@/types';
import { mapAvatar } from './avatarMapper';
import { bandsOf } from './calibration';
import { conditionHolds } from './endingEvaluator';
import { statusItemMatches } from './statusSelector';
import { getVitalBand } from './vitalBands';
import {
  DISPLAY_PRECISION,
  VITAL_FIELD,
  VITAL_NAMES,
  displayedValue,
  formatVital,
  readDisplayedVital,
  readVital,
  type VitalName,
} from './vitals';

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

// ---------------------------------------------------------------------------
// Display_Precision and Displayed_Value (play-mode Fix 2, 15.13 to 15.19)
// ---------------------------------------------------------------------------

const PLAY = CASE.play!;

/** Avatar bands for one sample under the case thresholds. */
function avatarBands(s: Partial<VitalSigns> & { simulation_time: number }, alarms: AlarmThresholds = CASE.alarms) {
  return mapAvatar({
    sample: s,
    alarms,
    play: PLAY,
    scheduledInsults: CASE.timeline.scheduledInsults,
    activeInterventions: [],
    previous: null,
    firstPositiveTidalVolumeMl: null,
    revealedSides: 'all',
  }).bands;
}

describe('DISPLAY_PRECISION (15.13)', () => {
  it('has scale 1 / 0 decimals for every vital except SpO2, which has scale 100 / 1 decimal', () => {
    expect(DISPLAY_PRECISION).toEqual({
      heartRate: { scale: 1, decimals: 0 },
      respiratoryRate: { scale: 1, decimals: 0 },
      spO2: { scale: 100, decimals: 1 },
      meanArterialPressure: { scale: 1, decimals: 0 },
      etCO2: { scale: 1, decimals: 0 },
      tidalVolume: { scale: 1, decimals: 0 },
    });
  });
});

describe('displayedValue and formatVital', () => {
  it('raw RR 11.9999 shows "12" and bands normal / none (15.17)', () => {
    expect(displayedValue('respiratoryRate', 11.9999)).toBe(12);
    expect(formatVital('respiratoryRate', 11.9999)).toBe('12');
    const s = { simulation_time: 0, respiratory_rate: 11.9999 };
    expect(readDisplayedVital(s, 'respiratoryRate')).toBe(12);
    expect(avatarBands(s).respiratoryRate).toEqual({ state: 'normal', direction: 'none' });
    expect(clinicianAlarmState(CASE.alarms, 'respiratoryRate', 11.9999)).toBe('normal');
  });

  it('raw SpO2 0.974 shows "97.4"', () => {
    // 97.4 / 100 is 0.9740000000000001 in binary floating point.
    expect(displayedValue('spO2', 0.974)).toBeCloseTo(0.974, 12);
    expect(formatVital('spO2', 0.974)).toBe('97.4');
  });

  it('raw SpO2 0.9496 shows "95.0" and bands normal, while spO2 >= 0.95 does not hold (15.18)', () => {
    expect(displayedValue('spO2', 0.9496)).toBe(0.95);
    expect(formatVital('spO2', 0.9496)).toBe('95.0');
    const s = { simulation_time: 60, spo2: 0.9496 };
    expect(avatarBands(s).spO2).toEqual({ state: 'normal', direction: 'none' });
    expect(clinicianAlarmState(CASE.alarms, 'spO2', 0.9496)).toBe('normal');
    expect(conditionHolds({ vital: 'spO2', op: '>=', value: 0.95 }, s)).toBe(false);
  });

  it.each([NaN, Infinity, -Infinity])('%s has no Displayed_Value and empty text', (raw) => {
    for (const vital of VITAL_NAMES) {
      expect(displayedValue(vital, raw)).toBeUndefined();
      expect(formatVital(vital, raw)).toBe('');
      const s = { ...sample, [VITAL_FIELD[vital]]: raw } as Partial<VitalSigns>;
      expect(readDisplayedVital(s, vital)).toBeUndefined();
    }
  });

  it('a missing field or sample has no Displayed_Value', () => {
    for (const vital of VITAL_NAMES) {
      expect(readDisplayedVital({}, vital)).toBeUndefined();
      expect(readDisplayedVital(null, vital)).toBeUndefined();
    }
  });

  it('writes negative raw values that round to zero without a minus sign (15.14)', () => {
    for (const vital of VITAL_NAMES.filter((v) => v !== 'spO2')) {
      for (const raw of [-0.3, -0.49, -0]) {
        expect(Object.is(displayedValue(vital, raw), 0), `${vital} ${raw}`).toBe(true);
        expect(formatVital(vital, raw)).toBe('0');
      }
    }
    for (const raw of [-0.0004, -0.0001, -0]) {
      expect(Object.is(displayedValue('spO2', raw), 0), `spO2 ${raw}`).toBe(true);
      expect(formatVital('spO2', raw)).toBe('0.0');
    }
  });

  it('keeps the old toFixed text for the baseline sample', () => {
    expect(formatVital('heartRate', 72)).toBe('72');
    expect(formatVital('respiratoryRate', 16)).toBe('16');
    expect(formatVital('meanArterialPressure', 95)).toBe('95');
    expect(formatVital('etCO2', 38)).toBe('38');
    expect(formatVital('tidalVolume', 500)).toBe('500');
  });
});

describe('single Display_Precision definition (15.19)', () => {
  const source = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

  it.each(['../components/VitalSign.tsx', '../components/ClinicianView.tsx'])(
    '%s has no toFixed and no * 100',
    (rel) => {
      const text = source(rel);
      expect(text).not.toContain('toFixed');
      expect(text).not.toMatch(/\*\s*100/);
    },
  );

  it('displayedValue and formatVital read DISPLAY_PRECISION', () => {
    const text = source('./vitals.ts');
    const body = (name: string) => text.split(`export function ${name}(`)[1]?.split('\nexport ')[0] ?? '';
    expect(body('displayedValue')).toContain('DISPLAY_PRECISION[vital]');
    expect(body('formatVital')).toContain('DISPLAY_PRECISION[vital]');
    expect(text.match(/export const DISPLAY_PRECISION\b/g)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Property 26
// ---------------------------------------------------------------------------

/** Every bound of the case thresholds and the shared threshold grid. */
const BOUNDS: number[] = [
  ...THRESHOLD_GRID,
  ...VITAL_NAMES.flatMap((v) => {
    const t = CASE.alarms[v];
    return t ? [t.critical, t.warning, t.normal].flatMap((o) => [o?.low, o?.high]) : [];
  }),
].filter((b): b is number => b !== undefined);

/** Finite raw value with magnitude at most 1e9, often close to a bound (within one display step). */
const arbRaw = fc.oneof(
  { weight: 1, arbitrary: fc.double({ min: -1e9, max: 1e9, noNaN: true }) },
  {
    weight: 3,
    arbitrary: fc
      .constantFrom(...BOUNDS)
      .chain((b) => fc.oneof(fc.double({ min: b - 1, max: b + 1, noNaN: true }), fc.double({ min: b - 0.001, max: b + 0.001, noNaN: true }))),
  },
);

const arbVital = fc.constantFrom(...VITAL_NAMES);

/** Each vital has the case threshold, a generated threshold, or none. */
const arbAlarms: fc.Arbitrary<AlarmThresholds> = fc
  .record(
    Object.fromEntries(
      VITAL_NAMES.map((v) => [v, fc.oneof(fc.constant(CASE.alarms[v] ?? {}), arbThreshold)]),
    ) as Record<VitalName, fc.Arbitrary<AlarmThreshold>>,
    { requiredKeys: [] },
  )
  .map((a) => a as unknown as AlarmThresholds);

const arbRawSample = fc.record(
  Object.fromEntries(VITAL_NAMES.map((v) => [VITAL_FIELD[v], arbRaw])) as Record<string, fc.Arbitrary<number>>,
);

const STATES: AlarmState[] = ['normal', 'warning', 'critical'];
const DIRECTIONS = [undefined, 'low', 'high'] as const;

describe('Displayed_Value properties', () => {
  // Feature: play-mode, Property 26: Readouts and Vital_Bands come from one Displayed_Value
  it('Property 26: Readouts and Vital_Bands come from one Displayed_Value', () => {
    /** Validates: Requirements 4.2, 15.7, 15.13, 15.14, 15.15, 15.16, 15.19 */
    fc.assert(
      fc.property(arbVital, arbRaw, arbRawSample, arbAlarms, (oneVital, oneRaw, raws, alarms) => {
        // Round trip: text and Displayed_Value agree, and rounding twice changes nothing.
        const shown = displayedValue(oneVital, oneRaw);
        expect(shown).toBeTypeOf('number');
        expect(formatVital(oneVital, shown!)).toBe(formatVital(oneVital, oneRaw));
        expect(displayedValue(oneVital, shown!)).toBe(shown);

        // Every band caller uses the Displayed_Value.
        const s = { simulation_time: 0, ...raws } as VitalSigns;
        const avatar = avatarBands(s, alarms);
        const calibration = bandsOf(s, alarms);
        for (const vital of VITAL_NAMES) {
          const t = alarms[vital];
          const raw = readVital(s, vital)!;
          if (t === undefined) {
            expect(clinicianAlarmState(alarms, vital, raw)).toBe('normal');
            continue;
          }
          const expected = getVitalBand(displayedValue(vital, raw)!, t);
          expect(avatar[vital], vital).toEqual(expected);
          expect(calibration[vital], vital).toEqual(expected);
          expect(clinicianAlarmState(alarms, vital, raw), vital).toBe(expected.state);
          for (const band of STATES) {
            for (const direction of DIRECTIONS) {
              const item = (direction === undefined ? { vital, band } : { vital, band, direction }) as StatusWhen;
              const matches = band === expected.state && (direction === undefined || direction === expected.direction);
              expect(statusItemMatches(s, alarms, item), `${vital} ${band} ${direction}`).toBe(matches);
            }
          }
        }
      }),
      PBT_PARAMS,
    );
  });
});
