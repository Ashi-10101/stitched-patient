/**
 * Test fixture: the `adult-tension-pneumothorax` case file, parsed with the
 * `yaml` package (YAML 1.2, so quoted "On" stays a string).
 *
 * The path is resolved from this file's location, not from process.cwd(),
 * so tests pass wherever Vitest is started.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import type { CaseData, Hint, Side, VitalName } from '@/types';

// apps/web/src/test/ -> repository root -> cases/
export const CASE_PATH = fileURLToPath(
  new URL('../../../../cases/adult-tension-pneumothorax.yaml', import.meta.url),
);

export const CASE_TEXT = readFileSync(CASE_PATH, 'utf8');

/**
 * Variant_Overrides (bedside-exam Requirement 1.3). Each key replaces one
 * Override_Target. Test-only: app code sees only the Resolved_Case (`CaseData`).
 */
export interface VariantOverrides {
  /** `parameters.side` of every `SETensionPneumothorax` Scheduled_Insult. */
  insultSide?: Side;
  /** `play.endings.rescued.requiredInterventions`. */
  requiredInterventions?: string[];
  /** `play.hints`. */
  hints?: Hint[];
  /** `play.sideRevealText`. */
  sideRevealText?: string;
}

/** One Variant of a Base_Case. Test-only. */
export interface CaseVariant {
  id: string;
  overrides: VariantOverrides;
}

/** A Base_Case: the case file as parsed, which may hold `variants`. */
type BaseCaseData = CaseData & { variants?: CaseVariant[] };

/** The parsed case file (the Base_Case, with `variants`). */
export const BASE_CASE: BaseCaseData = parse(CASE_TEXT) as BaseCaseData;

const TENSION_PNEUMOTHORAX_ACTION = 'SETensionPneumothorax';

/**
 * Test-only resolver (bedside-exam 14.6, design "Checks that the schema cannot
 * express"). Returns the Resolved_Case of `variantId`: a deep copy of `base`
 * without `variants`, in which each Override_Target holds the value from the
 * Variant_Overrides, or the Base_Case value when the key is absent.
 * Independent of `case_resolver.py`, so the two implementations check each other.
 * Never mutates `base`; the result shares no object with `base`.
 */
export function resolveCaseForTest(base: BaseCaseData, variantId: string): CaseData {
  const variant = base.variants?.find((v) => v.id === variantId);
  if (!variant) {
    throw new Error(`resolveCaseForTest: unknown variant_id "${variantId}"`);
  }
  const overrides = structuredClone(variant.overrides);
  const copy = structuredClone(base);
  delete copy.variants;
  const resolved: CaseData = copy;

  if (overrides.insultSide !== undefined) {
    const side = overrides.insultSide;
    const insults = resolved.timeline.scheduledInsults.filter((i) => i.action === TENSION_PNEUMOTHORAX_ACTION);
    if (insults.length === 0) {
      throw new Error(`resolveCaseForTest: variant "${variantId}" sets insultSide, but the case has no ${TENSION_PNEUMOTHORAX_ACTION} insult`);
    }
    for (const insult of insults) insult.parameters.side = side;
  }

  const playKeys = (['requiredInterventions', 'hints', 'sideRevealText'] as const).filter(
    (k) => overrides[k] !== undefined,
  );
  if (playKeys.length > 0) {
    const play = resolved.play;
    if (!play) {
      throw new Error(`resolveCaseForTest: variant "${variantId}" sets ${playKeys.join(', ')}, but the case has no play section`);
    }
    if (overrides.requiredInterventions !== undefined) {
      play.endings.rescued.requiredInterventions = overrides.requiredInterventions;
    }
    if (overrides.hints !== undefined) play.hints = overrides.hints;
    if (overrides.sideRevealText !== undefined) play.sideRevealText = overrides.sideRevealText;
  }

  return resolved;
}

/** Resolved_Case of the `left` Variant; equals the Base_Case without `variants` (2.5). */
export const CASE_LEFT: CaseData = resolveCaseForTest(BASE_CASE, 'left');

/** Resolved_Case of the `right` Variant. */
export const CASE_RIGHT: CaseData = resolveCaseForTest(BASE_CASE, 'right');

/** The case most tests use: the `left` Resolved_Case. */
export const CASE: CaseData = CASE_LEFT;

/**
 * Per-vital test offsets (design "Per-vital test offsets", Requirement 12.6, 15.10).
 * Tests check `boundary ± offset`; each offset must be smaller than half the
 * smallest gap between distinct boundaries of that vital.
 */
export const VITAL_OFFSETS: Record<VitalName, number> = {
  heartRate: 0.5,
  respiratoryRate: 0.5,
  spO2: 0.001,
  meanArterialPressure: 0.5,
  etCO2: 0.5,
  tidalVolume: 1,
};
