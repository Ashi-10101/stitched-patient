import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  affectedInsult,
  computeSides,
  foundSides,
  shownSwollenSides,
  sideGeometry,
  viewerHalf,
} from './sides';
import type { ExamRecordEntry, InterventionRecordEntry, ScheduledInsult, Side } from '@/types';
import { arbActiveInterventions, arbInsults } from '@/test/generators';
import { PBT_PARAMS } from '@/test/pbt';

const leftInsult = (timeSeconds = 30): ScheduledInsult => ({
  timeSeconds,
  action: 'SETensionPneumothorax',
  parameters: { side: 'Left', type: 'Closed', severity: 0.75 },
});

const decompression = (side: Side, simulationTime: number): InterventionRecordEntry => ({
  interventionId: `needle-decompression-${side.toLowerCase()}`,
  action: 'SENeedleDecompression',
  side,
  simulationTime,
  branchId: 'main',
});

describe('computeSides: fixed inputs (Requirement 12.2)', () => {
  it('a Left insult adds Left to Swollen_Sides at and after timeSeconds, not before', () => {
    const insults = [leftInsult(30)];
    expect(computeSides(29.9, insults, []).swollenSides).toEqual([]);
    expect(computeSides(30, insults, []).swollenSides).toEqual(['Left']);
    expect(computeSides(240, insults, []).swollenSides).toEqual(['Left']);
    expect(computeSides(30, insults, []).decompressedSides).toEqual([]);
  });

  it('a Left Decompression removes Left from Swollen_Sides and adds it to Decompressed_Sides', () => {
    const result = computeSides(120, [leftInsult(30)], [decompression('Left', 90)]);
    expect(result).toEqual({ swollenSides: [], decompressedSides: ['Left'] });
  });

  it('a Right Decompression with an untreated Left insult keeps Left swollen (Requirement 4.16)', () => {
    const result = computeSides(120, [leftInsult(30)], [decompression('Right', 90)]);
    expect(result).toEqual({ swollenSides: ['Left'], decompressedSides: ['Right'] });
  });

  it('a Left Decompression earlier than the Left insult keeps Left swollen once applied (Requirement 4.18)', () => {
    const active = [decompression('Left', 10)];
    expect(computeSides(20, [leftInsult(30)], active)).toEqual({
      swollenSides: [],
      decompressedSides: ['Left'],
    });
    expect(computeSides(30, [leftInsult(30)], active)).toEqual({
      swollenSides: ['Left'],
      decompressedSides: ['Left'],
    });
  });

  it('ignores other actions and side strings that are not exactly Left or Right', () => {
    const insults: ScheduledInsult[] = [
      { timeSeconds: 0, action: 'SEHemorrhage', parameters: { side: 'Right' } },
      { timeSeconds: 0, action: 'SETensionPneumothorax', parameters: { side: 'left' as Side } },
    ];
    const active: InterventionRecordEntry[] = [
      { ...decompression('Left', 5), action: 'seneedledecompression' },
      { ...decompression('Right', 5), side: 'RIGHT' as Side },
    ];
    expect(computeSides(60, insults, active)).toEqual({ swollenSides: [], decompressedSides: [] });
  });

  it('returns sides sorted and without duplicates', () => {
    const insults: ScheduledInsult[] = [
      { timeSeconds: 0, action: 'SETensionPneumothorax', parameters: { side: 'Right' } },
      leftInsult(0),
      leftInsult(10),
    ];
    const active = [decompression('Right', 50), decompression('Left', 1), decompression('Right', 60)];
    expect(computeSides(60, insults, active)).toEqual({
      swollenSides: ['Left'],
      decompressedSides: ['Left', 'Right'],
    });
  });

  const rightInsult = (timeSeconds = 30): ScheduledInsult => ({
    timeSeconds,
    action: 'SETensionPneumothorax',
    parameters: { side: 'Right', type: 'Closed', severity: 0.75 },
  });

  it.each<[string, ScheduledInsult[]]>([
    ['Left first', [leftInsult(30), rightInsult(40)]],
    ['Right first', [rightInsult(40), leftInsult(30)]],
  ])('two untreated insults listed %s give swollenSides exactly [Left, Right]', (_order, insults) => {
    const result = computeSides(60, insults, []);
    expect(result.swollenSides).toEqual(['Left', 'Right']);
    expect(result.decompressedSides).toEqual([]);
  });

  it.each<[string, InterventionRecordEntry[]]>([
    ['Right first', [decompression('Right', 20), decompression('Left', 10)]],
    ['Left first', [decompression('Left', 10), decompression('Right', 20)]],
  ])('Decompressions listed %s give decompressedSides exactly [Left, Right]', (_order, active) => {
    const result = computeSides(60, [], active);
    expect(result.decompressedSides).toEqual(['Left', 'Right']);
    expect(result.swollenSides).toEqual([]);
  });
});

describe('viewerHalf and sideGeometry (Requirements 3.7, 4.17, 4.23)', () => {
  it("maps the patient's Left to the viewer's right and Right to the viewer's left", () => {
    expect(viewerHalf('Left')).toBe('viewerRight');
    expect(viewerHalf('Right')).toBe('viewerLeft');
  });

  const halves: Array<[Side, number, number]> = [
    ['Left', 100, 200],
    ['Right', 0, 100],
  ];

  it.each(halves)('every %s element lies in x [%d, %d]', (side, min, max) => {
    const g = sideGeometry(side);
    for (const r of [g.chest, g.swollenChest, g.bandage]) {
      expect(r.x).toBeGreaterThanOrEqual(min);
      expect(r.x + r.width).toBeLessThanOrEqual(max);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.y + r.height).toBeLessThanOrEqual(280);
    }
    for (const x of [g.needle.x1, g.needle.x2]) {
      expect(x).toBeGreaterThanOrEqual(min);
      expect(x).toBeLessThanOrEqual(max);
    }
  });

  it.each(['Left', 'Right'] as Side[])('the %s swollen chest is wider and taller than the normal chest', (side) => {
    const { chest, swollenChest } = sideGeometry(side);
    expect(swollenChest.width).toBeGreaterThan(chest.width);
    expect(swollenChest.height).toBeGreaterThan(chest.height);
  });
});

// Feature: play-mode, Property 6: Swollen and decompressed sides follow insults and Decompressions
/**
 * **Validates: Requirements 4.13, 4.14, 4.16, 4.18**
 */
describe('Property 6: Swollen and decompressed sides follow insults and Decompressions', () => {
  const ORDER: Side[] = ['Left', 'Right'];
  const arbTime = fc.integer({ min: 0, max: 240 }).map((n) => n / 2);

  /** Independent reference: per side, test the definition directly. */
  function reference(time: number, insults: ScheduledInsult[], active: InterventionRecordEntry[]) {
    const isDecompression = (e: InterventionRecordEntry, side: Side) =>
      e.action === 'SENeedleDecompression' && e.side === side;
    const swollenSides = ORDER.filter((side) =>
      insults.some(
        (i) =>
          i.action === 'SETensionPneumothorax' &&
          i.parameters.side === side &&
          i.timeSeconds <= time &&
          !active.some((e) => isDecompression(e, side) && e.simulationTime >= i.timeSeconds),
      ),
    );
    const decompressedSides = ORDER.filter((side) => active.some((e) => isDecompression(e, side)));
    return { swollenSides, decompressedSides };
  }

  it('matches the reference, and extra Decompressions behave as Requirements 4.16 and 4.18 state', () => {
    fc.assert(
      fc.property(
        arbTime,
        arbInsults,
        arbActiveInterventions,
        fc.constantFrom<Side>('Left', 'Right'),
        arbTime,
        (time, insults, active, extraSide, extraTime) => {
          const result = computeSides(time, insults, active);
          const ref = reference(time, insults, active);
          // Exact array comparison: order matters (reference lists sides in [Left, Right] order).
          expect(result.swollenSides).toEqual(ref.swollenSides);
          expect(result.decompressedSides).toEqual(ref.decompressedSides);

          // 4.16: a Decompression on a side that is not swollen leaves Swollen_Sides unchanged.
          if (!result.swollenSides.includes(extraSide)) {
            const after = computeSides(time, insults, [...active, decompression(extraSide, extraTime)]);
            expect(after.swollenSides).toEqual(result.swollenSides);
          }

          // 4.18: a Decompression earlier than the latest applied insult on a swollen side
          // does not remove that side.
          for (const side of result.swollenSides) {
            const latest = Math.max(
              ...insults
                .filter(
                  (i) =>
                    i.action === 'SETensionPneumothorax' &&
                    i.parameters.side === side &&
                    i.timeSeconds <= time,
                )
                .map((i) => i.timeSeconds),
            );
            const after = computeSides(time, insults, [...active, decompression(side, latest - 0.25)]);
            expect(after.swollenSides).toContain(side);
          }
        },
      ),
      PBT_PARAMS,
    );
  });

  /**
   * Inputs that always have both sides swollen: one untreated insult per side,
   * listed in either order among arbitrary extra insults, plus optional
   * Decompressions on each side that are earlier than that side's guaranteed
   * insult (so they do not treat it), listed in either order among arbitrary
   * extra interventions. Extra Decompressions that would treat a guaranteed
   * insult are dropped, so no `fc.pre` is needed.
   */
  const arbBothSwollen = fc
    .record({
      timeHalves: fc.integer({ min: 2, max: 240 }),
      leftFrac: fc.integer({ min: 0, max: 1000 }),
      rightFrac: fc.integer({ min: 0, max: 1000 }),
      leftDecFrac: fc.integer({ min: 0, max: 1000 }),
      rightDecFrac: fc.integer({ min: 0, max: 1000 }),
      withLeftDec: fc.boolean(),
      withRightDec: fc.boolean(),
      leftInsultFirst: fc.boolean(),
      leftDecFirst: fc.boolean(),
      insultCuts: fc.tuple(fc.nat(), fc.nat()),
      activeCuts: fc.tuple(fc.nat(), fc.nat()),
      extraInsults: arbInsults,
      extraActive: arbActiveInterventions,
    })
    .map((g) => {
      const time = g.timeHalves / 2;
      // Guaranteed insult times in [0.5, time]; early Decompression times in [0, insult time - 0.5].
      const pairHalves = (frac: number) => 1 + Math.floor((frac * g.timeHalves) / 1001);
      const decHalves = (frac: number, insultHalves: number) => Math.floor((frac * insultHalves) / 1001);
      const leftHalves = pairHalves(g.leftFrac);
      const rightHalves = pairHalves(g.rightFrac);
      const insultTime: Record<Side, number> = { Left: leftHalves / 2, Right: rightHalves / 2 };

      const insultOf = (side: Side): ScheduledInsult => ({
        timeSeconds: insultTime[side],
        action: 'SETensionPneumothorax',
        parameters: { side, type: 'Closed', severity: 0.75 },
      });
      const insertTwo = <T>(list: T[], first: T, second: T, [a, b]: [number, number]): T[] => {
        const i = a % (list.length + 1);
        const j = i + (b % (list.length - i + 1));
        return [...list.slice(0, i), first, ...list.slice(i, j), second, ...list.slice(j)];
      };
      const [firstInsult, secondInsult] = g.leftInsultFirst
        ? [insultOf('Left'), insultOf('Right')]
        : [insultOf('Right'), insultOf('Left')];
      const insults = insertTwo(g.extraInsults, firstInsult, secondInsult, g.insultCuts);

      const treatsPair = (e: InterventionRecordEntry) =>
        e.action === 'SENeedleDecompression' &&
        (e.side === 'Left' || e.side === 'Right') &&
        e.simulationTime >= insultTime[e.side];
      const extraActive = g.extraActive.filter((e) => !treatsPair(e));
      const earlyLeft = g.withLeftDec ? [decompression('Left', decHalves(g.leftDecFrac, leftHalves) / 2)] : [];
      const earlyRight = g.withRightDec ? [decompression('Right', decHalves(g.rightDecFrac, rightHalves) / 2)] : [];
      const early = g.leftDecFirst ? [...earlyLeft, ...earlyRight] : [...earlyRight, ...earlyLeft];
      const active =
        early.length === 2
          ? insertTwo(extraActive, early[0], early[1], g.activeCuts)
          : [...extraActive, ...early];

      return { time, insults, active };
    });

  it('matches the reference when both sides are swollen, whatever the listing order', () => {
    fc.assert(
      fc.property(arbBothSwollen, ({ time, insults, active }) => {
        const result = computeSides(time, insults, active);
        const ref = reference(time, insults, active);
        expect(ref.swollenSides).toEqual(['Left', 'Right']);
        expect(result.swollenSides).toEqual(ref.swollenSides);
        expect(result.decompressedSides).toEqual(ref.decompressedSides);
      }),
      PBT_PARAMS,
    );
  });
});

const insultOn = (side: Side, timeSeconds = 30): ScheduledInsult => ({
  timeSeconds,
  action: 'SETensionPneumothorax',
  parameters: { side, type: 'Closed', severity: 0.75 },
});

const examEntry = (overrides: Partial<ExamRecordEntry> = {}): ExamRecordEntry => ({
  actionId: 'listen-chest',
  side: 'Left',
  simulationTime: 60,
  branchId: 'main',
  sentence: 'A finding sentence.',
  abnormal: true,
  wallClockTime: '2026-11-15T12:00:00.000Z',
  ...overrides,
});

describe('affectedInsult (bedside-exam glossary Affected_Side)', () => {
  it('returns null when there is no SETensionPneumothorax insult', () => {
    expect(affectedInsult([])).toBeNull();
    expect(
      affectedInsult([{ timeSeconds: 10, action: 'SEHemorrhage', parameters: { side: 'Left' } }]),
    ).toBeNull();
  });

  it('skips an insult with an invalid side', () => {
    const insults: ScheduledInsult[] = [
      { timeSeconds: 10, action: 'SETensionPneumothorax', parameters: { side: 'left' as Side } },
      { timeSeconds: 10, action: 'SETensionPneumothorax', parameters: {} },
    ];
    expect(affectedInsult(insults)).toBeNull();
    expect(affectedInsult([...insults, insultOn('Right', 45)])).toEqual({ side: 'Right', timeSeconds: 45 });
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'skips an insult whose timeSeconds is %s',
    (t) => {
      expect(affectedInsult([insultOn('Left', t)])).toBeNull();
      expect(affectedInsult([insultOn('Left', t), insultOn('Right', 20)])).toEqual({
        side: 'Right',
        timeSeconds: 20,
      });
    },
  );

  it('returns the first valid insult in list order when there are two', () => {
    expect(affectedInsult([insultOn('Right', 40), insultOn('Left', 30)])).toEqual({
      side: 'Right',
      timeSeconds: 40,
    });
    expect(affectedInsult([insultOn('Left', 30), insultOn('Right', 40)])).toEqual({
      side: 'Left',
      timeSeconds: 30,
    });
  });
});

describe('foundSides (bedside-exam 9.1, decision 14)', () => {
  it('is empty for an empty list', () => {
    expect(foundSides([])).toEqual([]);
  });

  it('ignores side-neutral and non-abnormal entries', () => {
    const entries = [
      examEntry({ side: undefined, abnormal: true }),
      examEntry({ side: 'Left', abnormal: false }),
      examEntry({ side: 'Right', abnormal: false }),
    ];
    expect(foundSides(entries)).toEqual([]);
    expect(foundSides([...entries, examEntry({ side: 'Right', abnormal: true })])).toEqual(['Right']);
  });

  it("returns sides in ['Left', 'Right'] order without duplicates", () => {
    const entries = [
      examEntry({ side: 'Right' }),
      examEntry({ side: 'Left' }),
      examEntry({ side: 'Right', simulationTime: 90 }),
    ];
    expect(foundSides(entries)).toEqual(['Left', 'Right']);
  });
});

describe('shownSwollenSides (bedside-exam 9.1)', () => {
  it("returns the Swollen_Sides for 'all'", () => {
    expect(shownSwollenSides([], 'all')).toEqual([]);
    expect(shownSwollenSides(['Left'], 'all')).toEqual(['Left']);
    expect(shownSwollenSides(['Left', 'Right'], 'all')).toEqual(['Left', 'Right']);
  });

  it('returns nothing when no side is revealed', () => {
    expect(shownSwollenSides(['Left', 'Right'], [])).toEqual([]);
  });

  it('returns only revealed Swollen_Sides when one side is revealed', () => {
    expect(shownSwollenSides(['Left'], ['Left'])).toEqual(['Left']);
    expect(shownSwollenSides(['Right'], ['Left'])).toEqual([]);
    expect(shownSwollenSides(['Left', 'Right'], ['Right'])).toEqual(['Right']);
    expect(shownSwollenSides([], ['Right'])).toEqual([]);
  });

  it('returns the sides in both lists, in swollen order, when both are revealed', () => {
    expect(shownSwollenSides(['Left', 'Right'], ['Right', 'Left'])).toEqual(['Left', 'Right']);
    expect(shownSwollenSides(['Right'], ['Left', 'Right'])).toEqual(['Right']);
  });
});

describe('computeSides: fixed inputs with a Right insult (bedside-exam 14.12, play-mode 12.2)', () => {
  it('a Right insult adds Right to Swollen_Sides at and after timeSeconds, not before', () => {
    const insults = [insultOn('Right', 30)];
    expect(computeSides(29.9, insults, []).swollenSides).toEqual([]);
    expect(computeSides(30, insults, []).swollenSides).toEqual(['Right']);
    expect(computeSides(240, insults, []).swollenSides).toEqual(['Right']);
    expect(computeSides(30, insults, []).decompressedSides).toEqual([]);
  });

  it('a Right Decompression removes Right from Swollen_Sides and adds it to Decompressed_Sides', () => {
    const result = computeSides(120, [insultOn('Right', 30)], [decompression('Right', 90)]);
    expect(result).toEqual({ swollenSides: [], decompressedSides: ['Right'] });
  });

  it('a Left Decompression with an untreated Right insult keeps Right swollen (Requirement 4.16)', () => {
    const result = computeSides(120, [insultOn('Right', 30)], [decompression('Left', 90)]);
    expect(result).toEqual({ swollenSides: ['Right'], decompressedSides: ['Left'] });
  });

  it('a Right Decompression earlier than the Right insult keeps Right swollen once applied (Requirement 4.18)', () => {
    const active = [decompression('Right', 10)];
    expect(computeSides(20, [insultOn('Right', 30)], active)).toEqual({
      swollenSides: [],
      decompressedSides: ['Right'],
    });
    expect(computeSides(30, [insultOn('Right', 30)], active)).toEqual({
      swollenSides: ['Right'],
      decompressedSides: ['Right'],
    });
  });

  it('ignores other actions and side strings that are not exactly Left or Right', () => {
    const insults: ScheduledInsult[] = [
      { timeSeconds: 0, action: 'SEHemorrhage', parameters: { side: 'Left' } },
      { timeSeconds: 0, action: 'SETensionPneumothorax', parameters: { side: 'right' as Side } },
    ];
    const active: InterventionRecordEntry[] = [
      { ...decompression('Right', 5), action: 'seneedledecompression' },
      { ...decompression('Left', 5), side: 'LEFT' as Side },
    ];
    expect(computeSides(60, insults, active)).toEqual({ swollenSides: [], decompressedSides: [] });
  });

  it('returns sides sorted and without duplicates', () => {
    const insults: ScheduledInsult[] = [insultOn('Left', 0), insultOn('Right', 0), insultOn('Right', 10)];
    const active = [decompression('Left', 50), decompression('Right', 1), decompression('Left', 60)];
    expect(computeSides(60, insults, active)).toEqual({
      swollenSides: ['Right'],
      decompressedSides: ['Left', 'Right'],
    });
  });
});
