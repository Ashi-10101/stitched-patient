/**
 * Shared fast-check generators for play-mode property tests (design "Testing Strategy").
 */

import fc from 'fast-check';
import type { AlarmThreshold, InterventionRecordEntry, ScheduledInsult, Side } from '@/types';

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
