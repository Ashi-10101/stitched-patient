import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { PBT_PARAMS } from './pbt';

describe('PBT_PARAMS', () => {
  it('uses the fixed seed and run count', () => {
    expect(PBT_PARAMS).toEqual({ seed: 20261031, numRuns: 100 });
  });

  it('runs a fast-check property with the shared settings', () => {
    let runs = 0;
    fc.assert(
      fc.property(fc.integer(), fc.integer(), (a, b) => {
        runs += 1;
        return a + b === b + a;
      }),
      PBT_PARAMS,
    );
    expect(runs).toBe(PBT_PARAMS.numRuns);
  });
});
