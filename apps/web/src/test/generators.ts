/**
 * Shared fast-check generators for play-mode property tests (design "Testing Strategy").
 */

import fc from 'fast-check';
import type {
  AlarmThreshold,
  AvatarParameters,
  InterventionRecordEntry,
  ScheduledInsult,
  Side,
  VitalBand,
  VitalName,
  VitalSigns,
} from '@/types';
import { VITAL_FIELD, VITAL_NAMES } from '@/lib/vitals';
import { CASE, VITAL_OFFSETS } from './caseFixtures';

/**
 * Small grid of bound values: integers plus fractions. Drawing every bound from
 * this grid makes equal bounds (e.g. warning.low === normal.low) and crossing
 * bounds (e.g. low > high, warning inside normal) common.
 */
export const THRESHOLD_GRID = [-10, -1, -0.5, 0, 0.5, 0.88, 0.95, 1, 2, 10, 60, 100] as const;

const arbBound = fc.constantFrom(...THRESHOLD_GRID);

/** `low` and `high` each present or absent (absent keys are omitted, not `undefined`). */
const arbBounds = fc.record({ low: arbBound, high: arbBound }, { requiredKeys: [] });

/**
 * Threshold object with each of `critical`, `warning` and `normal` present or
 * absent, and each bound inside them present or absent.
 *
 * `AlarmThreshold.normal` declares both bounds as required, but the
 * Alarm_Function must skip any absent bound (Requirement 15.5), so this
 * generator also omits `normal.low` / `normal.high` and casts the result.
 */
export const arbThreshold: fc.Arbitrary<AlarmThreshold> = fc
  .record(
    { critical: arbBounds, warning: arbBounds, normal: arbBounds },
    { requiredKeys: [] },
  )
  .map((t) => t as AlarmThreshold);

/**
 * Simulation times in half-second steps from 0 to 120 s. The small range makes
 * equal times (insult time === Decompression time === sample time) common.
 */
const arbSideTime = fc.integer({ min: 0, max: 240 }).map((n) => n / 2);

/**
 * Side values: mostly valid sides, plus off-domain strings and an absent side
 * that side handling must ignore. Cast because `Side` only allows the two valid values.
 */
const arbSideValue = fc.constantFrom<unknown>('Left', 'Right', 'Left', 'Right', 'left', 'RIGHT', undefined);

/**
 * Scheduled_Insults: mostly `SETensionPneumothorax`, plus other actions that
 * side handling must ignore.
 */
export const arbInsults: fc.Arbitrary<ScheduledInsult[]> = fc.array(
  fc
    .record({
      timeSeconds: arbSideTime,
      action: fc.constantFrom(
        'SETensionPneumothorax',
        'SETensionPneumothorax',
        'SEHemorrhage',
        'setensionpneumothorax',
      ),
      side: arbSideValue,
      type: fc.constantFrom<'Closed' | 'Open'>('Closed', 'Open'),
      severity: fc.integer({ min: 0, max: 100 }).map((n) => n / 100),
    })
    .map(({ timeSeconds, action, side, type, severity }) => ({
      timeSeconds,
      action,
      parameters: {
        ...(side === undefined ? {} : { side: side as Side }),
        type,
        severity,
      },
    })),
  { maxLength: 4 },
);

/**
 * Active_Interventions: mostly `SENeedleDecompression`, plus other actions that
 * side handling must ignore.
 */
export const arbActiveInterventions: fc.Arbitrary<InterventionRecordEntry[]> = fc.array(
  fc
    .record({
      action: fc.constantFrom(
        'SENeedleDecompression',
        'SENeedleDecompression',
        'SETensionPneumothorax',
        'seneedledecompression',
      ),
      side: arbSideValue,
      simulationTime: arbSideTime,
      branchId: fc.constantFrom('main', 'branch-1'),
    })
    .map(({ action, side, simulationTime, branchId }) => ({
      interventionId: `${action}-${String(side)}`,
      action,
      ...(side === undefined ? {} : { side: side as Side }),
      simulationTime,
      branchId,
    })),
  { maxLength: 4 },
);

/** Every bound of a vital's case threshold, or `[]` when the case defines none. */
function caseBounds(vital: VitalName): number[] {
  const t = CASE.alarms[vital];
  if (!t) return [];
  return [t.critical?.low, t.critical?.high, t.warning?.low, t.warning?.high, t.normal?.low, t.normal?.high].filter(
    (b): b is number => b !== undefined,
  );
}

/**
 * One vital's value: non-finite (`NaN`, `±Infinity`), zero, negative, a case
 * boundary or boundary ± the per-vital offset, or a value in the range from
 * 50% of the lowest to 150% of the highest case boundary.
 */
function arbVitalValue(vital: VitalName): fc.Arbitrary<number> {
  const bounds = caseBounds(vital);
  const lo = bounds.length ? Math.min(...bounds) : 1;
  const hi = bounds.length ? Math.max(...bounds) : 100;
  const offset = VITAL_OFFSETS[vital];
  const nearBoundary = bounds.length
    ? fc.constantFrom(...bounds).chain((b) => fc.constantFrom(b - offset, b, b + offset))
    : fc.constant(lo);
  return fc.oneof(
    { weight: 1, arbitrary: fc.constantFrom(Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY) },
    { weight: 1, arbitrary: fc.constant(0) },
    { weight: 1, arbitrary: fc.double({ min: -2 * hi, max: -offset, noNaN: true }) },
    { weight: 3, arbitrary: nearBoundary },
    { weight: 3, arbitrary: fc.double({ min: 0.5 * lo, max: 1.5 * hi, noNaN: true }) },
  );
}

/**
 * VitalSigns sample with a finite `simulation_time` (0 to 600 s in half-second
 * steps). Each case vital, `systolic_pressure` and `diastolic_pressure` is
 * present or absent (absent keys are omitted); a present case vital may be
 * `NaN`, `±Infinity`, zero, negative or near a case boundary.
 */
export const arbSample: fc.Arbitrary<Partial<VitalSigns> & { simulation_time: number }> = fc
  .record(
    {
      simulation_time: fc.integer({ min: 0, max: 1200 }).map((n) => n / 2),
      ...Object.fromEntries(VITAL_NAMES.map((v) => [VITAL_FIELD[v], arbVitalValue(v)])),
      systolic_pressure: fc.double({ min: 40, max: 200, noNaN: true }),
      diastolic_pressure: fc.double({ min: 20, max: 120, noNaN: true }),
    },
    { requiredKeys: ['simulation_time'] },
  )
  .map((s) => s as Partial<VitalSigns> & { simulation_time: number });

/** Vital_Band: `normal` with direction `none`, or `warning`/`critical` with `low`/`high`. */
const arbVitalBand: fc.Arbitrary<VitalBand> = fc.oneof(
  fc.constant<VitalBand>({ state: 'normal', direction: 'none' }),
  fc.record({
    state: fc.constantFrom<VitalBand['state']>('warning', 'critical'),
    direction: fc.constantFrom<VitalBand['direction']>('low', 'high'),
  }),
);

/** Period in seconds, as `60 / rate` gives for rates from 3 to 300 per minute. */
const arbPeriod = fc.double({ min: 0.2, max: 20, noNaN: true });

/**
 * Avatar_Parameters with valid field shapes: depth inside [0.25, 1.75],
 * positive periods, side lists sorted and unique, and any subset of vitals in
 * `bands`. Fields are drawn independently, so `skinTone`, `sweating` and
 * `overallStatus` need not match `bands`.
 */
export const arbAvatarParameters: fc.Arbitrary<AvatarParameters> = fc.record({
  skinTone: fc.constantFrom<AvatarParameters['skinTone']>('healthy', 'pale', 'cyanotic'),
  breathing: fc.record({
    stopped: fc.boolean(),
    periodS: arbPeriod,
    depth: fc.double({ min: 0.25, max: 1.75, noNaN: true }),
  }),
  heartbeat: fc.record({ stopped: fc.boolean(), periodS: arbPeriod }),
  sweating: fc.boolean(),
  swollenSides: fc.subarray<Side>(['Left', 'Right']),
  decompressedSides: fc.subarray<Side>(['Left', 'Right']),
  overallStatus: fc.constantFrom<AvatarParameters['overallStatus']>('normal', 'warning', 'critical'),
  bands: fc
    .record(
      Object.fromEntries(VITAL_NAMES.map((v) => [v, arbVitalBand])) as Record<VitalName, fc.Arbitrary<VitalBand>>,
      { requiredKeys: [] },
    )
    .map((b) => b as Partial<Record<VitalName, VitalBand>>),
});
