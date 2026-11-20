import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { CheckpointMetadata, Intervention, InterventionRecordEntry } from '@/types';
import { PBT_PARAMS } from '@/test/pbt';
import { formatMSS, remainingSeconds } from './timeFormat';
import {
  MAX_REWIND_MOMENTS,
  labelRewindMoment,
  selectRewindCheckpoints,
  type LineageCheckpoint,
} from './rewindMoments';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function cp(id: string, time: number): CheckpointMetadata {
  return { checkpoint_id: id, simulation_time: time, created_at: '2026-10-31T00:00:00Z', is_automatic: true };
}

function lc(id: string, time: number, depth = 0): LineageCheckpoint {
  return { checkpoint: cp(id, time), branchId: `branch-${depth}`, depth };
}

function entry(interventionId: string, simulationTime: number): InterventionRecordEntry {
  return { interventionId, action: 'Action', simulationTime, branchId: 'branch-0' };
}

const times = (list: LineageCheckpoint[]) => list.map((c) => c.checkpoint.simulation_time);
const ids = (list: LineageCheckpoint[]) => list.map((c) => c.checkpoint.checkpoint_id);

/** Checkpoints every 10 s from 10 to 100 on the current Branch. */
const TEN_CHECKPOINTS = Array.from({ length: 10 }, (_, i) => lc(`cp-${(i + 1) * 10}`, (i + 1) * 10));

const INTERVENTIONS: Intervention[] = [
  { id: 'needle', label: 'Needle decompression (left)', playLabel: 'Let the trapped air out', action: 'NeedleDecompression' },
  { id: 'oxygen', label: 'Oxygen via non-rebreather', playLabel: '   ', action: 'SupplementalOxygen' },
  { id: 'fluids', label: 'IV fluid bolus', action: 'Infusion' },
];

// ---------------------------------------------------------------------------
// selectRewindCheckpoints
// ---------------------------------------------------------------------------

describe('selectRewindCheckpoints (Requirements 10.2, 10.3, 10.4, 10.12, 10.13)', () => {
  it('exports MAX_REWIND_MOMENTS = 5', () => {
    expect(MAX_REWIND_MOMENTS).toBe(5);
  });

  it('returns at most 5, newest first', () => {
    const result = selectRewindCheckpoints({
      checkpoints: TEN_CHECKPOINTS,
      latestSampleTime: 200,
      lineageInterventions: [],
    });
    expect(times(result)).toEqual([100, 90, 80, 70, 60]);
  });

  it('lists only Checkpoints below the latest sample time', () => {
    const result = selectRewindCheckpoints({
      checkpoints: TEN_CHECKPOINTS,
      latestSampleTime: 50,
      lineageInterventions: [],
    });
    expect(times(result)).toEqual([40, 30, 20, 10]);
  });

  it('lists only Checkpoints below timeLimitSeconds', () => {
    const result = selectRewindCheckpoints({
      checkpoints: TEN_CHECKPOINTS,
      latestSampleTime: 200,
      timeLimitSeconds: 40,
      lineageInterventions: [],
    });
    expect(times(result)).toEqual([30, 20, 10]);
  });

  it('puts the newest Checkpoint older than the newest entry in place of the oldest of the 5', () => {
    const result = selectRewindCheckpoints({
      checkpoints: TEN_CHECKPOINTS,
      latestSampleTime: 200,
      lineageInterventions: [entry('needle', 15), entry('oxygen', 25)],
    });
    expect(times(result)).toEqual([100, 90, 80, 70, 20]);
  });

  it('keeps the 5 newest when the required Checkpoint is already among them', () => {
    const result = selectRewindCheckpoints({
      checkpoints: TEN_CHECKPOINTS,
      latestSampleTime: 200,
      lineageInterventions: [entry('needle', 75)],
    });
    expect(times(result)).toEqual([100, 90, 80, 70, 60]);
  });

  it('lists the fork copy and its source at the same time once, keeping the current-Branch copy', () => {
    const forkCopy = lc('fork-copy', 60, 0);
    const source = lc('source', 60, 1);
    const result = selectRewindCheckpoints({
      checkpoints: [source, lc('older', 30, 1), forkCopy],
      latestSampleTime: 120,
      lineageInterventions: [],
    });
    expect(result[0]).toBe(forkCopy);
    expect(ids(result)).toEqual(['fork-copy', 'older']);
  });

  it('lists a Checkpoint id seen on two Branches once', () => {
    const near = lc('shared', 30, 0);
    const far = lc('shared', 30, 2);
    const result = selectRewindCheckpoints({
      checkpoints: [far, near],
      latestSampleTime: 120,
      lineageInterventions: [],
    });
    expect(result).toEqual([near]);
  });

  it('swaps in the kept copy, not a deeper copy at the same time', () => {
    const near = lc('near-20', 20, 0);
    const deep = lc('deep-20', 20, 1);
    const result = selectRewindCheckpoints({
      checkpoints: [...TEN_CHECKPOINTS.filter((c) => c.checkpoint.simulation_time !== 20), deep, near],
      latestSampleTime: 200,
      lineageInterventions: [entry('needle', 25)],
    });
    expect(ids(result)).toEqual(['cp-100', 'cp-90', 'cp-80', 'cp-70', 'near-20']);
  });

  it('returns [] when no Checkpoint qualifies', () => {
    expect(
      selectRewindCheckpoints({
        checkpoints: TEN_CHECKPOINTS,
        latestSampleTime: 10,
        lineageInterventions: [entry('needle', 5)],
      }),
    ).toEqual([]);
    expect(
      selectRewindCheckpoints({ checkpoints: [], latestSampleTime: 100, lineageInterventions: [] }),
    ).toEqual([]);
  });

  it('returns [] when there is no VitalSigns sample', () => {
    expect(
      selectRewindCheckpoints({
        checkpoints: TEN_CHECKPOINTS,
        latestSampleTime: null,
        lineageInterventions: [entry('needle', 50)],
      }),
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// labelRewindMoment
// ---------------------------------------------------------------------------

describe('labelRewindMoment (Requirement 10.5)', () => {
  it('labels time 0 "0:00 - at the start"', () => {
    expect(labelRewindMoment(cp('a', 0), [], INTERVENTIONS)).toBe('0:00 - at the start');
  });

  it('uses "at the start" for any time below 1 s, even with a later entry', () => {
    expect(labelRewindMoment(cp('a', 0.7), [entry('needle', 30)], INTERVENTIONS)).toBe('0:00 - at the start');
  });

  it('names the Play_Label of the earliest later entry', () => {
    const entries = [entry('fluids', 200), entry('needle', 95), entry('oxygen', 40)];
    expect(labelRewindMoment(cp('a', 90), entries, INTERVENTIONS)).toBe(
      '1:30 - before you chose: Let the trapped air out',
    );
  });

  it('takes the first entry in record order when later entries share a time', () => {
    const entries = [entry('fluids', 100), entry('needle', 100)];
    expect(labelRewindMoment(cp('a', 90), entries, INTERVENTIONS)).toBe('1:30 - before you chose: IV fluid bolus');
  });

  it('falls back to the clinical label when the Play_Label is blank or missing', () => {
    expect(labelRewindMoment(cp('a', 90), [entry('oxygen', 100)], INTERVENTIONS)).toBe(
      '1:30 - before you chose: Oxygen via non-rebreather',
    );
    expect(labelRewindMoment(cp('a', 725), [entry('fluids', 800)], INTERVENTIONS)).toBe(
      '12:05 - before you chose: IV fluid bolus',
    );
  });

  it('shows the raw interventionId when the entry is not in the interventions list', () => {
    expect(labelRewindMoment(cp('a', 90), [entry('ghost', 100)], INTERVENTIONS)).toBe(
      '1:30 - before you chose: ghost',
    );
  });

  it('shows the time alone when no entry is later', () => {
    const entries = [entry('needle', 30), entry('oxygen', 90)];
    expect(labelRewindMoment(cp('a', 90.9), entries, INTERVENTIONS)).toBe('1:30');
    expect(labelRewindMoment(cp('a', 90), [], INTERVENTIONS)).toBe('1:30');
  });
});

// ---------------------------------------------------------------------------
// Generators (kept local to this file)
// ---------------------------------------------------------------------------

/** Small grid with sub-second, minute-boundary and fractional values so equal times are common. */
const TIME_GRID = [0, 0.4, 0.99, 1, 15, 30, 45, 59.9, 60, 90, 120, 150, 180, 240, 300, 600, 725] as const;
const arbTime = fc.oneof(
  { weight: 4, arbitrary: fc.constantFrom(...TIME_GRID) },
  { weight: 1, arbitrary: fc.double({ min: 0, max: 900, noNaN: true }) },
);

/**
 * Checkpoints of a lineage. Each saved state has one id and one time; a state
 * placed at several depths repeats its checkpoint_id, and distinct states drawn
 * at the same grid time model a fork copy and its source.
 */
const arbDepth = fc.integer({ min: 0, max: 3 });
const arbLineageCheckpoints: fc.Arbitrary<LineageCheckpoint[]> = fc
  .array(arbTime, { maxLength: 16, size: 'max' })
  .chain((stateTimes) =>
    stateTimes.length === 0
      ? fc.constant([] as LineageCheckpoint[])
      : fc
          .tuple(
            fc.array(arbDepth, { minLength: stateTimes.length, maxLength: stateTimes.length }),
            fc.array(fc.record({ state: fc.nat(stateTimes.length - 1), depth: arbDepth }), { maxLength: 8 }),
          )
          .chain(([depths, repeats]) => {
            const all = [...depths.map((depth, state) => ({ state, depth })), ...repeats].map(({ state, depth }) =>
              lc(`cp-${state}`, stateTimes[state], depth),
            );
            // Every placement, in shuffled input order.
            return fc.shuffledSubarray(all, { minLength: all.length, maxLength: all.length });
          }),
  );

const ENTRY_IDS = ['needle', 'oxygen', 'fluids', 'ghost'] as const;
const arbEntries = fc.array(
  fc.record({ id: fc.constantFrom(...ENTRY_IDS), time: arbTime }).map(({ id, time }) => entry(id, time)),
  { maxLength: 6 },
);

/** Bounds biased high so that more than 5 Checkpoints are often eligible. */
const arbBound = fc.oneof(
  { weight: 3, arbitrary: fc.constantFrom(600, 725, 900, 1000) },
  { weight: 2, arbitrary: arbTime },
);
/** Entry times biased low so that the inclusion rule (step 6) often has to swap a Checkpoint in. */
const arbSelectionEntries = fc.array(
  fc
    .record({
      id: fc.constantFrom(...ENTRY_IDS),
      time: fc.oneof({ weight: 3, arbitrary: fc.constantFrom(1, 15, 30, 45, 60) }, { weight: 1, arbitrary: arbTime }),
    })
    .map(({ id, time }) => entry(id, time)),
  { maxLength: 3 },
);

const arbSelectionArgs = fc.record({
  checkpoints: arbLineageCheckpoints,
  latestSampleTime: fc.option(arbBound, { nil: null, freq: 6 }),
  timeLimitSeconds: fc.option(arbBound, { nil: undefined, freq: 3 }),
  lineageInterventions: arbSelectionEntries,
});

/** Interventions with a present, empty, blank or missing Play_Label; 'ghost' is never listed. */
const arbInterventions: fc.Arbitrary<Intervention[]> = fc.tuple(
  ...(['needle', 'oxygen', 'fluids'] as const).map((id) =>
    fc
      .constantFrom<string | undefined>(undefined, '', ' \t ', `Plain ${id}`)
      .map((playLabel): Intervention => ({ id, label: `Clinical ${id}`, playLabel, action: 'Action' })),
  ),
);

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

describe('rewindMoments properties', () => {
  // Feature: play-mode, Property 16: Rewind selection invariants
  // **Validates: Requirements 10.2, 10.3, 10.4, 10.12, 10.13**
  it('Property 16: Rewind selection invariants', () => {
    fc.assert(
      fc.property(arbSelectionArgs, (args) => {
        const result = selectRewindCheckpoints(args);
        const { checkpoints, latestSampleTime, timeLimitSeconds, lineageInterventions } = args;

        if (latestSampleTime === null) {
          expect(result).toEqual([]);
          return;
        }

        const isEligible = (c: LineageCheckpoint) =>
          c.checkpoint.simulation_time < latestSampleTime &&
          (timeLimitSeconds === undefined || c.checkpoint.simulation_time < timeLimitSeconds);
        const eligible = checkpoints.filter(isEligible);

        expect(result.length).toBeLessThanOrEqual(5);
        expect(result.length === 0).toBe(eligible.length === 0);

        const resultTimes = times(result);
        for (let i = 1; i < resultTimes.length; i++) {
          expect(resultTimes[i]).toBeLessThan(resultTimes[i - 1]);
        }
        expect(new Set(ids(result)).size).toBe(result.length);
        expect(new Set(resultTimes).size).toBe(result.length);

        for (const c of result) {
          expect(c.checkpoint.simulation_time).toBeLessThan(latestSampleTime);
          if (timeLimitSeconds !== undefined) expect(c.checkpoint.simulation_time).toBeLessThan(timeLimitSeconds);
          expect(eligible).toContain(c);
        }

        if (lineageInterventions.length > 0) {
          let newestEntry = -Infinity;
          for (const e of lineageInterventions) newestEntry = Math.max(newestEntry, e.simulationTime);
          let required = -Infinity;
          for (const c of eligible) {
            const t = c.checkpoint.simulation_time;
            if (t < newestEntry && t > required) required = t;
          }
          if (required !== -Infinity) expect(resultTimes).toContain(required);
        }
      }),
      PBT_PARAMS,
    );
  });

  // Feature: play-mode, Property 17: Time labels and rewind labels follow the format rules
  // **Validates: Requirements 5.15, 10.5**
  it('Property 17: Time labels and rewind labels follow the format rules', () => {
    const arbSeconds = fc.oneof(
      fc.constantFrom(...TIME_GRID),
      fc.double({ min: 0, max: 1e6, noNaN: true, noDefaultInfinity: true }),
    );

    fc.assert(
      fc.property(arbSeconds, (s) => {
        const label = formatMSS(s);
        expect(label).toMatch(/^\d+:\d{2}$/);
        const [m, sec] = label.split(':').map(Number);
        expect(sec).toBeLessThan(60);
        expect(m * 60 + sec).toBe(Math.floor(s) + 0);
      }),
      PBT_PARAMS,
    );

    fc.assert(
      fc.property(arbSeconds, arbSeconds, (limit, t) => {
        expect(remainingSeconds(limit, t)).toBe(Math.max(0, limit - t));
      }),
      PBT_PARAMS,
    );

    fc.assert(
      fc.property(arbTime, arbEntries, arbInterventions, (time, entries, interventions) => {
        const whole = Math.floor(time);
        const mss = `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;

        let expected: string;
        if (whole === 0) {
          expected = `${mss} - at the start`;
        } else {
          const later = entries.filter((e) => e.simulationTime > time);
          if (later.length === 0) {
            expected = mss;
          } else {
            const minTime = Math.min(...later.map((e) => e.simulationTime));
            const first = later.find((e) => e.simulationTime === minTime)!;
            const match = interventions.find((i) => i.id === first.interventionId);
            const text =
              match === undefined
                ? first.interventionId
                : match.playLabel !== undefined && match.playLabel.trim() !== ''
                  ? match.playLabel
                  : match.label;
            expected = `${mss} - before you chose: ${text}`;
          }
        }

        expect(labelRewindMoment(cp('x', time), entries, interventions)).toBe(expected);
      }),
      PBT_PARAMS,
    );
  });
});
