import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  buildInterventionEntry,
  loadRecord,
  parseRecord,
  recordKey,
  saveRecord,
  serializeRecord,
} from './interventionRecord';
import type { Intervention, InterventionRecordEntry } from '@/types';
import { CASE } from '@/test/caseFixtures';
import { PBT_PARAMS } from '@/test/pbt';

const LEFT: InterventionRecordEntry = {
  interventionId: 'needle-decompression-left',
  action: 'SENeedleDecompression',
  side: 'Left',
  simulationTime: 0,
  branchId: 'main',
};
const RIGHT: InterventionRecordEntry = {
  interventionId: 'needle-decompression-right',
  action: 'SENeedleDecompression',
  side: 'Right',
  simulationTime: 312.5,
  branchId: 'branch-2',
};
const NO_SIDE: InterventionRecordEntry = {
  interventionId: 'oxygen',
  action: 'SESupplementalOxygen',
  simulationTime: 60,
  branchId: 'main',
};

const raw = (v: unknown, entries: unknown): string => JSON.stringify({ v, entries });

/** In-memory Storage stand-in exposing only the methods the module uses. */
function memoryStorage(): Pick<Storage, 'getItem' | 'setItem'> & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => (data.has(key) ? (data.get(key) as string) : null),
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
}

const quotaError = (): Error =>
  typeof DOMException === 'function'
    ? new DOMException('quota', 'QuotaExceededError')
    : new Error('quota');

describe('recordKey (Requirement 8.12)', () => {
  it('contains the session_id', () => {
    expect(recordKey('sess-abc-123')).toContain('sess-abc-123');
    expect(recordKey('a')).not.toBe(recordKey('b'));
  });
});

describe('serializeRecord / parseRecord: fixed inputs (Requirements 8.13, 8.14)', () => {
  it('writes the versioned format', () => {
    expect(JSON.parse(serializeRecord([LEFT]))).toEqual({ v: 1, entries: [LEFT] });
  });

  it('round-trips left, right and no-side entries', () => {
    const parsed = parseRecord(serializeRecord([LEFT, RIGHT, NO_SIDE]));
    expect(parsed).toStrictEqual([LEFT, RIGHT, NO_SIDE]);
    expect('side' in parsed[2]).toBe(false);
  });

  it('returns [] for a missing key (null)', () => {
    expect(parseRecord(null)).toEqual([]);
  });

  it('returns [] for bad JSON', () => {
    expect(parseRecord('{"v":1,"entries":[')).toEqual([]);
    expect(parseRecord('')).toEqual([]);
    expect(parseRecord('not json')).toEqual([]);
  });

  it('returns [] for a wrong or missing version', () => {
    expect(parseRecord(raw(2, [LEFT]))).toEqual([]);
    expect(parseRecord(raw('1', [LEFT]))).toEqual([]);
    expect(parseRecord(JSON.stringify({ entries: [LEFT] }))).toEqual([]);
  });

  it('returns [] when the top level is not a plain object or entries is not an array', () => {
    expect(parseRecord(JSON.stringify([LEFT]))).toEqual([]);
    expect(parseRecord('null')).toEqual([]);
    expect(parseRecord(raw(1, { 0: LEFT }))).toEqual([]);
    expect(parseRecord(JSON.stringify({ v: 1 }))).toEqual([]);
  });

  it('returns [] when one entry among valid ones is invalid', () => {
    expect(parseRecord(raw(1, [LEFT, { ...RIGHT, side: 'right' }, NO_SIDE]))).toEqual([]);
    expect(parseRecord(raw(1, [LEFT, { ...RIGHT, side: null }]))).toEqual([]);
    expect(parseRecord(raw(1, [LEFT, { ...RIGHT, simulationTime: -1 }]))).toEqual([]);
    expect(parseRecord(raw(1, [LEFT, { ...RIGHT, branchId: 7 }]))).toEqual([]);
  });

  it('never throws for non-string input', () => {
    expect(parseRecord(undefined as unknown as string)).toEqual([]);
    expect(parseRecord(42 as unknown as string)).toEqual([]);
    expect(parseRecord({} as unknown as string)).toEqual([]);
  });

  it('drops extra keys on entries and at the top level', () => {
    const stored = JSON.stringify({
      v: 1,
      extra: 'top',
      entries: [{ ...LEFT, note: 'x', __proto__x: 1 }, { ...NO_SIDE, side2: 'Left' }],
    });
    const parsed = parseRecord(stored);
    expect(parsed).toStrictEqual([LEFT, NO_SIDE]);
    expect(Object.keys(parsed[0]).sort()).toEqual(
      ['action', 'branchId', 'interventionId', 'side', 'simulationTime'],
    );
    expect(Object.keys(parsed[1]).sort()).toEqual(
      ['action', 'branchId', 'interventionId', 'simulationTime'],
    );
  });
});

describe('loadRecord / saveRecord (Requirements 8.12-8.14)', () => {
  it('saveRecord writes serializeRecord(record) under recordKey(sessionId); loadRecord reads it', () => {
    const storage = memoryStorage();
    saveRecord(storage, 'sess-1', [LEFT, NO_SIDE]);
    expect([...storage.data.keys()]).toEqual([recordKey('sess-1')]);
    expect(storage.data.get(recordKey('sess-1'))).toBe(serializeRecord([LEFT, NO_SIDE]));
    expect(loadRecord(storage, 'sess-1')).toStrictEqual([LEFT, NO_SIDE]);
  });

  it('loadRecord returns [] when nothing is stored for the session', () => {
    const storage = memoryStorage();
    saveRecord(storage, 'sess-1', [LEFT]);
    expect(loadRecord(storage, 'sess-2')).toEqual([]);
  });

  it('loadRecord returns [] when getItem throws', () => {
    const storage: Pick<Storage, 'getItem'> = {
      getItem: () => {
        throw new Error('SecurityError: storage disabled');
      },
    };
    expect(loadRecord(storage, 'sess-1')).toEqual([]);
  });

  it('saveRecord does not throw when setItem throws a quota error', () => {
    const storage: Pick<Storage, 'setItem'> = {
      setItem: () => {
        throw quotaError();
      },
    };
    const record = [LEFT];
    expect(() => saveRecord(storage, 'sess-1', record)).not.toThrow();
    expect(record).toEqual([LEFT]);
  });
});

describe('buildInterventionEntry (Requirement 8.6)', () => {
  const byId = (id: string): Intervention => {
    const found = CASE.interventions.find((i) => i.id === id);
    if (!found) throw new Error(`case intervention ${id} missing`);
    return found;
  };

  it('uses the left case Intervention', () => {
    const entry = buildInterventionEntry(byId('needle-decompression-left'), 245.5, 'main');
    expect(entry).toStrictEqual({
      interventionId: 'needle-decompression-left',
      action: 'SENeedleDecompression',
      side: 'Left',
      simulationTime: 245.5,
      branchId: 'main',
    });
  });

  it('uses the right case Intervention', () => {
    const entry = buildInterventionEntry(byId('needle-decompression-right'), 0, 'branch-3');
    expect(entry).toStrictEqual({
      interventionId: 'needle-decompression-right',
      action: 'SENeedleDecompression',
      side: 'Right',
      simulationTime: 0,
      branchId: 'branch-3',
    });
  });

  it('leaves the side key out for an Intervention without a side', () => {
    const oxygen: Intervention = {
      id: 'oxygen',
      label: 'Oxygen',
      action: 'SESupplementalOxygen',
      parameters: { flow: 15 },
    };
    const entry = buildInterventionEntry(oxygen, 60, 'main');
    expect('side' in entry).toBe(false);
    expect(entry).toStrictEqual(NO_SIDE);
  });

  it('leaves the side key out when parameters.side is not Left or Right', () => {
    const odd: Intervention = { id: 'x', label: 'X', action: 'A', parameters: { side: 'left' } };
    expect('side' in buildInterventionEntry(odd, 1, 'main')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Property 19
// ---------------------------------------------------------------------------

/**
 * Times >= 0: exact 0, whole seconds, tenths, and arbitrary doubles. `-0` is
 * mapped to `0` because JSON writes `-0` as `0` and toStrictEqual tells them apart.
 */
const timeArb: fc.Arbitrary<number> = fc
  .oneof(
    fc.constant(0),
    fc.integer({ min: 0, max: 7200 }),
    fc.integer({ min: 0, max: 72000 }).map((n) => n / 10),
    fc.double({ min: 0, max: 1e7, noNaN: true, noDefaultInfinity: true }),
  )
  .map((t) => (t === 0 ? 0 : t));

const branchArb = fc.oneof(fc.constantFrom('main', 'branch-1', 'branch-2', 'branch-3'), fc.string());

const entryArb: fc.Arbitrary<InterventionRecordEntry> = fc
  .tuple(
    fc.oneof(fc.constantFrom('needle-decompression-left', 'needle-decompression-right'), fc.string()),
    fc.oneof(fc.constant('SENeedleDecompression'), fc.string()),
    fc.constantFrom<'Left' | 'Right' | undefined>('Left', 'Right', undefined),
    timeArb,
    branchArb,
  )
  .map(([interventionId, action, side, simulationTime, branchId]) => {
    const entry: InterventionRecordEntry = { interventionId, action, simulationTime, branchId };
    if (side !== undefined) entry.side = side;
    return entry;
  });

const recordArb = fc.array(entryArb, { maxLength: 8 });

type Json = Record<string, unknown>;
/** Placeholder replaced by a raw JSON number token after stringify. */
const RAW = '__RAW_NUMBER_TOKEN__';

/** One way to break one field (or the whole entry) of a valid entry. */
interface FieldBreak {
  kind: string;
  /** Returns the broken entry value; may mutate `e`. */
  apply: (e: Json) => unknown;
  /** Raw JSON token substituted for the RAW placeholder. */
  token?: string;
}

const set = (field: string, value: unknown) => (e: Json) => ({ ...e, [field]: value });
const drop = (field: string) => (e: Json) => {
  const copy = { ...e };
  delete copy[field];
  return copy;
};

const stringFieldBreaks = (field: string): FieldBreak[] => [
  { kind: `${field}:number`, apply: set(field, 1) },
  { kind: `${field}:null`, apply: set(field, null) },
  { kind: `${field}:missing`, apply: drop(field) },
  { kind: `${field}:object`, apply: set(field, { s: 'x' }) },
];

const FIELD_BREAKS: Record<string, FieldBreak[]> = {
  interventionId: stringFieldBreaks('interventionId'),
  action: stringFieldBreaks('action'),
  branchId: stringFieldBreaks('branchId'),
  simulationTime: [
    { kind: 'simulationTime:negative', apply: set('simulationTime', -0.5) },
    { kind: 'simulationTime:string', apply: set('simulationTime', '12') },
    { kind: 'simulationTime:null', apply: set('simulationTime', null) },
    { kind: 'simulationTime:missing', apply: drop('simulationTime') },
    { kind: 'simulationTime:NaN-raw', apply: set('simulationTime', RAW), token: 'NaN' },
    { kind: 'simulationTime:Infinity-raw', apply: set('simulationTime', RAW), token: '1e400' },
    { kind: 'simulationTime:-Infinity-raw', apply: set('simulationTime', RAW), token: '-1e400' },
  ],
  side: [
    { kind: 'side:lowercase', apply: set('side', 'left') },
    { kind: 'side:other-string', apply: set('side', 'Both') },
    { kind: 'side:empty', apply: set('side', '') },
    { kind: 'side:null', apply: set('side', null) },
    { kind: 'side:number', apply: set('side', 0) },
  ],
  entry: [
    { kind: 'entry:null', apply: () => null },
    { kind: 'entry:array', apply: (e) => [e] },
    { kind: 'entry:string', apply: () => 'needle-decompression-left' },
  ],
};

const brokenFieldArb = fc
  .constantFrom(...Object.keys(FIELD_BREAKS))
  .chain((field) => fc.constantFrom(...FIELD_BREAKS[field]))
  .chain((brk) =>
    fc
      .tuple(fc.array(entryArb, { minLength: 1, maxLength: 6 }), fc.nat())
      .map(([record, n]) => {
        const at = n % record.length;
        const entries: unknown[] = record.map((e) => ({ ...e }));
        entries[at] = brk.apply(entries[at] as Json);
        let text = raw(1, entries);
        if (brk.token !== undefined) text = text.replace(`"${RAW}"`, brk.token);
        return { kind: brk.kind, input: text as unknown };
      }),
  );

const TOP_BREAKS: Array<[string, (entries: InterventionRecordEntry[]) => string]> = [
  ['top:array', (entries) => JSON.stringify(entries)],
  ['top:v0', (entries) => raw(0, entries)],
  ['top:v2', (entries) => raw(2, entries)],
  ['top:v-string', (entries) => raw('1', entries)],
  ['top:v-missing', (entries) => JSON.stringify({ entries })],
  ['top:entries-object', (entries) => raw(1, { ...entries })],
  ['top:entries-string', () => raw(1, 'entries')],
  ['top:entries-null', () => raw(1, null)],
  ['top:entries-missing', () => JSON.stringify({ v: 1 })],
  ['top:null', () => 'null'],
];

const brokenTopArb = fc
  .tuple(fc.constantFrom(...TOP_BREAKS), recordArb)
  .map(([[kind, build], record]) => ({ kind, input: build(record) as unknown }));

const invalidArb: fc.Arbitrary<{ kind: string; input: unknown }> = fc.oneof(
  { arbitrary: fc.string().map((s) => ({ kind: 'string', input: s as unknown })), weight: 1 },
  {
    arbitrary: fc.jsonValue().map((v) => ({ kind: 'json-value', input: JSON.stringify(v) as unknown })),
    weight: 1,
  },
  { arbitrary: fc.anything().map((v) => ({ kind: 'non-string', input: v })), weight: 1 },
  { arbitrary: fc.constant({ kind: 'null', input: null as unknown }), weight: 1 },
  { arbitrary: brokenTopArb, weight: 2 },
  { arbitrary: brokenFieldArb, weight: 6 },
);

describe('Property 19: Intervention_Record storage round trip', () => {
  // Feature: play-mode, Property 19: Intervention_Record storage round trip
  // **Validates: Requirements 8.12, 8.13, 8.14**
  it('parseRecord(serializeRecord(r)) deep-equals r and keeps absent sides absent', () => {
    fc.assert(
      fc.property(recordArb, (record) => {
        const parsed = parseRecord(serializeRecord(record));
        expect(parsed).toStrictEqual(record);
        record.forEach((entry, i) => {
          expect('side' in parsed[i]).toBe('side' in entry);
        });
      }),
      PBT_PARAMS,
    );
  });

  // Feature: play-mode, Property 19: Intervention_Record storage round trip
  // **Validates: Requirements 8.13, 8.14**
  it('parseRecord returns [] without throwing for anything that is not a valid serialized record', () => {
    fc.assert(
      fc.property(invalidArb, ({ kind, input }) => {
        let result: unknown;
        expect(() => {
          result = parseRecord(input as string | null);
        }).not.toThrow();
        expect(result).toEqual([]);
      }),
      PBT_PARAMS,
    );
  });
});
