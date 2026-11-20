/**
 * Small helpers over the Case_Definition for Play mode.
 */

import type { Intervention, Side, VitalCondition } from '@/types';

/**
 * Button text for an Intervention in the Play_View: the Play_Label when it
 * contains a non-whitespace character, else the clinical `label`
 * (Requirements 8.2, 8.3). The chosen string is returned unchanged.
 */
export function playButtonText(i: Intervention): string {
  const playLabel = i.playLabel;
  return typeof playLabel === 'string' && /\S/.test(playLabel) ? playLabel : i.label;
}

const isLowerBound = (op: VitalCondition['op']): boolean => op === '>' || op === '>=';
const isStrict = (op: VitalCondition['op']): boolean => op === '>' || op === '<';

/**
 * True when both conditions name the same vital and no number satisfies both
 * (Requirement 6.14).
 *
 * Each condition is a half-line. A lower-bounded condition (`>`, `>=`) and an
 * upper-bounded one (`<`, `<=`) are disjoint when the lower value is above the
 * upper value, or the values are equal and at least one operator is strict.
 * Two conditions bounded in the same direction always overlap.
 */
export function conditionsDisjoint(a: VitalCondition, b: VitalCondition): boolean {
  if (a.vital !== b.vital) return false;
  const aLower = isLowerBound(a.op);
  if (aLower === isLowerBound(b.op)) return false;
  const [lower, upper] = aLower ? [a, b] : [b, a];
  if (lower.value > upper.value) return true;
  if (lower.value === upper.value) return isStrict(lower.op) || isStrict(upper.op);
  return false;
}

/** The Intervention's `parameters.side` when it is exactly 'Left' or 'Right', else undefined. */
export function interventionSide(i: Intervention): Side | undefined {
  const side: unknown = i.parameters?.side;
  return side === 'Left' || side === 'Right' ? side : undefined;
}
