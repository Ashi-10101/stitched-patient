/**
 * Shared fast-check settings. Pass these to every `fc.assert` so each run
 * uses the same generated inputs (Requirement 12.10).
 */
export const PBT_PARAMS = { seed: 20261031, numRuns: 100 } as const;
