/**
 * Status_Selector (play-mode Requirement 5.2–5.8).
 *
 * Picks the Status_Sentence for the latest VitalSigns sample. Every sentence
 * comes from the Play_Section and is returned unchanged; this module never
 * composes text. Unlike the Avatar_Mapper, it keeps no previous values: a
 * missing or non-finite vital makes a `when` item not match (5.4).
 */

import { getVitalBand, thresholdsFor } from './vitalBands';
import { readDisplayedVital } from './vitals';
import type { AlarmThresholds, PlaySection, StatusWhen, VitalSigns } from '@/types';

/** 5.3, 5.4: thresholds and a finite value present, band equal, direction absent or equal. */
export function statusItemMatches(
  sample: Partial<VitalSigns>,
  alarms: AlarmThresholds,
  item: StatusWhen,
): boolean {
  const threshold = thresholdsFor(alarms, item.vital);
  if (threshold === undefined) return false;
  // Band of the Displayed_Value (play-mode 15.16).
  const value = readDisplayedVital(sample, item.vital);
  if (value === undefined) return false;
  const band = getVitalBand(value, threshold);
  if (band.state !== item.band) return false;
  return item.direction === undefined || item.direction === band.direction;
}

/**
 * Sentence of the first Status_Rule (in Case_Definition order) whose `when`
 * items all match, or `defaultSentence` for a `null` sample, an empty `rules`
 * array or no match (5.2, 5.5, 5.6, 5.7). Pure and deterministic (5.8).
 */
export function selectStatus(
  sample: Partial<VitalSigns> | null,
  alarms: AlarmThresholds,
  play: PlaySection,
): string {
  const { rules, defaultSentence } = play.status;
  if (sample === null) return defaultSentence;
  for (const rule of rules) {
    if (rule.when.every((item) => statusItemMatches(sample, alarms, item))) return rule.sentence;
  }
  return defaultSentence;
}
