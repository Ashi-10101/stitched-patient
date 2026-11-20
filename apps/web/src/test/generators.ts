/**
 * Shared fast-check generators for play-mode property tests (design "Testing Strategy").
 */

import fc from 'fast-check';
import type { AlarmThreshold } from '@/types';

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
