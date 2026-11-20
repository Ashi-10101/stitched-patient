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
import type { CaseData, VitalName } from '@/types';

// apps/web/src/test/ -> repository root -> cases/
export const CASE_PATH = fileURLToPath(
  new URL('../../../../cases/adult-tension-pneumothorax.yaml', import.meta.url),
);

export const CASE_TEXT = readFileSync(CASE_PATH, 'utf8');

export const CASE: CaseData = parse(CASE_TEXT) as CaseData;

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
