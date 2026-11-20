import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { conditionsDisjoint, interventionSide, playButtonText } from './playCase';
import { VITAL_NAMES } from './vitals';
import type { ComparisonOp, Intervention, VitalCondition, VitalName } from '@/types';
import { CASE } from '@/test/caseFixtures';
import { PBT_PARAMS } from '@/test/pbt';

const cond = (vital: VitalName, op: ComparisonOp, value: number): VitalCondition => ({ vital, op, value });

const OPS: ComparisonOp[] = ['<', '<=', '>=', '>'];

describe('conditionsDisjoint: fixed inputs (Requirement 6.14)', () => {
  // [opA, opB, expected when a.value === b.value, when a.value < b.value, when a.value > b.value]
  const OPPOSITE: Array<[ComparisonOp, ComparisonOp, boolean, boolean, boolean]> = [
    ['>', '<', true, false, true],
    ['>', '<=', true, false, true],
    ['>=', '<', true, false, true],
    ['>=', '<=', false, false, true],
    ['<', '>', true, true, false],
    ['<', '>=', true, true, false],
    ['<=', '>', true, true, false],
    ['<=', '>=', false, true, false],
  ];

  it.each(OPPOSITE)('heartRate %s / %s: equal=%s, a<b=%s, a>b=%s', (opA, opB, eq, less, greater) => {
    expect(conditionsDisjoint(cond('heartRate', opA, 90), cond('heartRate', opB, 90))).toBe(eq);
    expect(conditionsDisjoint(cond('heartRate', opA, 90), cond('heartRate', opB, 95))).toBe(less);
    expect(conditionsDisjoint(cond('heartRate', opA, 95), cond('heartRate', opB, 90))).toBe(greater);
  });

  it.each(OPPOSITE)('spO2 fractions %s / %s: equal=%s, a<b=%s, a>b=%s', (opA, opB, eq, less, greater) => {
    expect(conditionsDisjoint(cond('spO2', opA, 0.9), cond('spO2', opB, 0.9))).toBe(eq);
    expect(conditionsDisjoint(cond('spO2', opA, 0.9), cond('spO2', opB, 0.94))).toBe(less);
    expect(conditionsDisjoint(cond('spO2', opA, 0.94), cond('spO2', opB, 0.9))).toBe(greater);
  });

  const SAME_DIRECTION: Array<[ComparisonOp, ComparisonOp]> = [
    ['>', '>'],
    ['>', '>='],
    ['>=', '>'],
    ['>=', '>='],
    ['<', '<'],
    ['<', '<='],
    ['<=', '<'],
    ['<=', '<='],
  ];

  it.each(SAME_DIRECTION)('same-direction bounds %s / %s are never disjoint', (opA, opB) => {
    for (const [va, vb] of [
      [90, 90],
      [90, 95],
      [95, 90],
    ]) {
      expect(conditionsDisjoint(cond('heartRate', opA, va), cond('heartRate', opB, vb))).toBe(false);
    }
  });

  it('conditions on different vitals are never disjoint', () => {
    expect(conditionsDisjoint(cond('spO2', '>=', 0.95), cond('heartRate', '<', 50))).toBe(false);
    // Would be disjoint if both named the same vital.
    expect(conditionsDisjoint(cond('spO2', '>', 0.95), cond('meanArterialPressure', '<', 0.9))).toBe(false);
    expect(conditionsDisjoint(cond('heartRate', '>', 100), cond('respiratoryRate', '<', 100))).toBe(false);
  });
});

describe('playButtonText: fixed inputs (Requirements 8.2, 8.3)', () => {
  const base: Intervention = {
    id: 'needle-decompression-left',
    label: 'Needle decompression - left',
    action: 'SENeedleDecompression',
    parameters: { side: 'Left', state: 'On' },
  };

  it('returns the Play_Label when it has text', () => {
    expect(playButtonText({ ...base, playLabel: 'Let the trapped air out - left side (needle)' })).toBe(
      'Let the trapped air out - left side (needle)',
    );
  });

  it('returns the Play_Label untrimmed', () => {
    expect(playButtonText({ ...base, playLabel: '  Let air out \n' })).toBe('  Let air out \n');
  });

  it('returns the label when there is no Play_Label', () => {
    expect(playButtonText(base)).toBe('Needle decompression - left');
  });

  it('returns the label when the Play_Label is empty', () => {
    expect(playButtonText({ ...base, playLabel: '' })).toBe('Needle decompression - left');
  });

  it('returns the label when the Play_Label is whitespace only', () => {
    for (const playLabel of [' ', '   ', '\t', '\n', ' \t\r\n ', '\u00a0']) {
      expect(playButtonText({ ...base, playLabel })).toBe('Needle decompression - left');
    }
  });
});

describe('interventionSide (Requirement 8.4 support)', () => {
  const byId = (id: string): Intervention => {
    const found = CASE.interventions.find((i) => i.id === id);
    if (!found) throw new Error(`case intervention ${id} not found`);
    return found;
  };

  it('reads Left and Right from the two case Interventions', () => {
    expect(CASE.interventions).toHaveLength(2);
    expect(interventionSide(byId('needle-decompression-left'))).toBe('Left');
    expect(interventionSide(byId('needle-decompression-right'))).toBe('Right');
  });

  it('returns undefined for an Intervention without parameters', () => {
    expect(interventionSide({ id: 'x', label: 'X', action: 'SEHemorrhage' })).toBeUndefined();
  });

  it('returns undefined when side is missing, not exactly Left/Right, or not a string', () => {
    const withSide = (side: unknown): Intervention => ({
      id: 'x',
      label: 'X',
      action: 'SENeedleDecompression',
      parameters: side === undefined ? { state: 'On' } : { side, state: 'On' },
    });
    for (const side of [undefined, 'left', 'RIGHT', ' Left', 'Both', '', 1, true, null, ['Left']]) {
      expect(interventionSide(withSide(side))).toBeUndefined();
    }
  });
});

// Feature: play-mode, Property 15: Condition disjointness is exact
/**
 * **Validates: Requirements 6.14**
 */
describe('Property 15: Condition disjointness is exact', () => {
  /** Direct evaluation of a condition's operator; independent of playCase.ts. */
  const holds = (c: VitalCondition, x: number): boolean => {
    switch (c.op) {
      case '<':
        return x < c.value;
      case '<=':
        return x <= c.value;
      case '>=':
        return x >= c.value;
      case '>':
        return x > c.value;
    }
  };

  /**
   * Values lie on the grid k / divisor. Divisor 100 gives two-decimal fractions
   * such as SpO2. Epsilon is 1/1000 of the grid step, so `threshold ± epsilon`
   * can never reach a different grid value.
   */
  const arbPair = fc
    .record({
      divisor: fc.constantFrom(1, 2, 100),
      ka: fc.integer({ min: 0, max: 200 }),
      delta: fc.oneof(
        { arbitrary: fc.constant(0), weight: 2 },
        { arbitrary: fc.integer({ min: -3, max: 3 }), weight: 2 },
        { arbitrary: fc.integer({ min: -100, max: 100 }), weight: 1 },
      ),
      opA: fc.constantFrom(...OPS),
      opB: fc.constantFrom(...OPS),
      vitalA: fc.constantFrom(...VITAL_NAMES),
      // undefined = same vital as `a` (most runs); otherwise any vital, which may also match.
      vitalB: fc.oneof(
        { arbitrary: fc.constant(undefined), weight: 4 },
        { arbitrary: fc.constantFrom(...VITAL_NAMES), weight: 1 },
      ),
    })
    .map((g) => ({
      a: cond(g.vitalA, g.opA, g.ka / g.divisor),
      b: cond(g.vitalB ?? g.vitalA, g.opB, (g.ka + g.delta) / g.divisor),
      epsilon: 1 / (g.divisor * 1000),
    }));

  it('equals a brute-force check over a dense test set', () => {
    fc.assert(
      fc.property(arbPair, ({ a, b, epsilon }) => {
        const lo = Math.min(a.value, b.value);
        const hi = Math.max(a.value, b.value);
        const testSet = [
          a.value,
          a.value - epsilon,
          a.value + epsilon,
          b.value,
          b.value - epsilon,
          b.value + epsilon,
          (a.value + b.value) / 2,
          lo - 1000,
          hi + 1000,
        ];
        const expected = a.vital === b.vital && !testSet.some((x) => holds(a, x) && holds(b, x));
        expect(conditionsDisjoint(a, b)).toBe(expected);
      }),
      PBT_PARAMS,
    );
  });
});

// Feature: play-mode, Property 18: Play button text falls back to the clinical label
/**
 * **Validates: Requirements 8.2, 8.3**
 */
describe('Property 18: Play button text falls back to the clinical label', () => {
  const arbWhitespace = fc.stringOf(fc.constantFrom(' ', '\t', '\n', '\r', '\u00a0'), { minLength: 1, maxLength: 6 });
  const arbNonBlank = fc
    .tuple(fc.string(), fc.string({ minLength: 1 }).filter((s) => /\S/.test(s)), fc.string())
    .map(([pre, core, post]) => pre + core + post);
  const arbPlayLabel = fc.oneof(
    fc.constant(undefined),
    fc.constant(''),
    arbWhitespace,
    fc.tuple(arbWhitespace, arbNonBlank, arbWhitespace).map(([pre, core, post]) => pre + core + post),
    arbNonBlank,
  );

  it('returns playLabel exactly when it has a non-whitespace character, else label exactly', () => {
    fc.assert(
      fc.property(fc.string(), arbPlayLabel, (label, playLabel) => {
        const intervention: Intervention = {
          id: 'x',
          label,
          action: 'SENeedleDecompression',
          ...(playLabel === undefined ? {} : { playLabel }),
        };
        const expected = playLabel !== undefined && /\S/.test(playLabel) ? playLabel : label;
        expect(playButtonText(intervention)).toBe(expected);
      }),
      PBT_PARAMS,
    );
  });
});
