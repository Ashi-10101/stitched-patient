import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { getAlarmState } from './alarms';
import { VITAL_NAMES } from './vitals';
import type { AlarmState, AlarmThreshold, VitalName } from '@/types';
import { CASE, VITAL_OFFSETS } from '@/test/caseFixtures';
import { THRESHOLD_GRID, arbThreshold } from '@/test/generators';
import { PBT_PARAMS } from '@/test/pbt';

type Kind = 'critical' | 'warning' | 'normal';
type Side = 'low' | 'high';
interface Bound {
  kind: Kind;
  side: Side;
  value: number;
}

const KINDS: Kind[] = ['critical', 'warning', 'normal'];
const SIDES: Side[] = ['low', 'high'];

/** Every bound present in a threshold object. */
function presentBounds(t: AlarmThreshold): Bound[] {
  const out: Bound[] = [];
  for (const kind of KINDS) {
    const obj = t[kind] as { low?: number; high?: number } | undefined;
    if (!obj) continue;
    for (const side of SIDES) {
      const value = obj[side];
      if (value !== undefined) out.push({ kind, side, value });
    }
  }
  return out;
}

/**
 * Reference reading of Requirement 15.1 to 15.5: a bound is violated when the
 * value is strictly beyond it; any violated critical bound gives `critical`,
 * any other violated bound gives `warning`, otherwise `normal`.
 */
function expectedState(value: number, t: AlarmThreshold): AlarmState {
  const violated = presentBounds(t).filter((b) =>
    b.side === 'low' ? value < b.value : value > b.value,
  );
  if (violated.some((b) => b.kind === 'critical')) return 'critical';
  if (violated.length > 0) return 'warning';
  return 'normal';
}

function deepFreeze<T>(obj: T): T {
  if (obj !== null && typeof obj === 'object') {
    for (const v of Object.values(obj)) deepFreeze(v);
    Object.freeze(obj);
  }
  return obj;
}

const vitalsWithThresholds = VITAL_NAMES.filter((v) => CASE.alarms[v] !== undefined);

describe('getAlarmState: case thresholds', () => {
  it('the case file defines thresholds for every vital', () => {
    expect(vitalsWithThresholds).toEqual([...VITAL_NAMES]);
  });

  describe.each(vitalsWithThresholds)('per-vital offset for %s', (vital: VitalName) => {
    it('is smaller than half the smallest gap between distinct boundaries', () => {
      const distinct = [...new Set(presentBounds(CASE.alarms[vital]!).map((b) => b.value))].sort(
        (a, b) => a - b,
      );
      expect(distinct.length, `${vital}: needs at least two distinct boundaries`).toBeGreaterThan(1);
      let minGap = Infinity;
      for (let i = 1; i < distinct.length; i++) minGap = Math.min(minGap, distinct[i] - distinct[i - 1]);
      expect(
        VITAL_OFFSETS[vital],
        `${vital}: offset ${VITAL_OFFSETS[vital]} must be < half the smallest boundary gap ${minGap}`,
      ).toBeLessThan(minGap / 2);
    });
  });

  describe.each(vitalsWithThresholds)('boundaries of %s', (vital: VitalName) => {
    const t = CASE.alarms[vital]!;
    const offset = VITAL_OFFSETS[vital];

    it.each(presentBounds(t).map((b) => [`${b.kind}.${b.side} = ${b.value}`, b] as const))(
      '%s: at, just inside and just outside',
      (_label, b) => {
        const inside = b.side === 'low' ? b.value + offset : b.value - offset;
        const outside = b.side === 'low' ? b.value - offset : b.value + offset;

        const atState = getAlarmState(b.value, t);
        const insideState = getAlarmState(inside, t);
        const outsideState = getAlarmState(outside, t);

        // 15.1 to 15.4 via the reference reading
        expect(atState).toBe(expectedState(b.value, t));
        expect(insideState).toBe(expectedState(inside, t));
        expect(outsideState).toBe(expectedState(outside, t));

        // 15.4: a value equal to the bound is not beyond it, so it bands like a value just inside
        expect(atState).toBe(insideState);
        // 15.1 / 15.2: just outside a bound is at least that bound's band
        if (b.kind === 'critical') {
          expect(outsideState).toBe('critical');
        } else {
          expect(outsideState).not.toBe('normal');
        }
      },
    );
  });

  it('baseline vitals are normal (15.9)', () => {
    const baseline: Record<VitalName, number> = {
      heartRate: 72,
      respiratoryRate: 12,
      spO2: 0.974,
      meanArterialPressure: 95,
      etCO2: 36,
      tidalVolume: 535,
    };
    for (const vital of VITAL_NAMES) {
      expect(getAlarmState(baseline[vital], CASE.alarms[vital]!), vital).toBe('normal');
    }
  });

  it('design before/after examples', () => {
    expect(getAlarmState(0.93, CASE.alarms.spO2)).toBe('warning');
    expect(getAlarmState(110, CASE.alarms.heartRate)).toBe('warning');
    expect(getAlarmState(105, CASE.alarms.meanArterialPressure)).toBe('warning');
    expect(getAlarmState(12, CASE.alarms.respiratoryRate)).toBe('normal');
  });
});

describe('getAlarmState: absent bounds and objects (15.5)', () => {
  it('skips absent low bounds', () => {
    const t: AlarmThreshold = { critical: { high: 140 }, warning: { high: 120 } };
    expect(getAlarmState(-1000, t)).toBe('normal');
    expect(getAlarmState(120, t)).toBe('normal');
    expect(getAlarmState(121, t)).toBe('warning');
    expect(getAlarmState(141, t)).toBe('critical');

    const withNormal: AlarmThreshold = { ...t, normal: { low: 60, high: 100 } };
    expect(getAlarmState(0, withNormal)).toBe('warning');
    expect(getAlarmState(101, withNormal)).toBe('warning');
  });

  it('skips absent high bounds', () => {
    const t: AlarmThreshold = { critical: { low: 40 }, warning: { low: 50 } };
    expect(getAlarmState(1e6, t)).toBe('normal');
    expect(getAlarmState(50, t)).toBe('normal');
    expect(getAlarmState(49, t)).toBe('warning');
    expect(getAlarmState(39, t)).toBe('critical');

    const withNormal: AlarmThreshold = { ...t, normal: { low: 60, high: 100 } };
    expect(getAlarmState(1e6, withNormal)).toBe('warning');
    expect(getAlarmState(59, withNormal)).toBe('warning');
  });

  it('skips an absent warning object', () => {
    const t: AlarmThreshold = { critical: { low: 40, high: 140 }, normal: { low: 60, high: 100 } };
    expect(getAlarmState(80, t)).toBe('normal');
    expect(getAlarmState(60, t)).toBe('normal');
    expect(getAlarmState(59, t)).toBe('warning');
    expect(getAlarmState(140, t)).toBe('warning');
    expect(getAlarmState(141, t)).toBe('critical');
    expect(getAlarmState(39, t)).toBe('critical');
  });

  it('returns normal when every object is absent', () => {
    expect(getAlarmState(-1e9, {})).toBe('normal');
    expect(getAlarmState(1e9, {})).toBe('normal');
  });
});

const arbFiniteValue = fc.oneof(
  fc.constantFrom(...THRESHOLD_GRID),
  fc
    .tuple(fc.constantFrom(...THRESHOLD_GRID), fc.constantFrom(-0.25, -0.001, 0.001, 0.25))
    .map(([g, d]) => g + d),
  fc.double({ noNaN: true, noDefaultInfinity: true }),
);

describe('getAlarmState: properties', () => {
  // Feature: play-mode, Property 1: Alarm_Function matches the band specification
  it('Property 1: Alarm_Function matches the band specification', () => {
    fc.assert(
      fc.property(arbThreshold, arbFiniteValue, (threshold, value) => {
        const snapshot = structuredClone(threshold);
        const frozen = deepFreeze(structuredClone(threshold));

        const first = getAlarmState(value, frozen);
        const second = getAlarmState(value, frozen);

        expect(first).toBe(expectedState(value, snapshot));
        expect(second).toBe(first);
        expect(frozen).toEqual(snapshot);
      }),
      PBT_PARAMS,
    );
  });
});
