import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  buildExamEntry,
  examRecordKey,
  findingsNewestFirst,
  loadExamRecord,
  parseExamRecord,
  saveExamRecord,
  serializeExamRecord,
} from './examRecord';
import type { ExamRecordEntry } from '@/types';
import { arbExamRecordEntry } from '@/test/generators';
import { PBT_PARAMS } from '@/test/pbt';

const LOOK: ExamRecordEntry = {
  actionId: 'look-chest',
  simulationTime: 90,
  branchId: 'b1',
  sentence: 'One side of his chest hardly moves when he breathes.',
  abnormal: true,
  wallClockTime: '2026-11-21T10:01:30.000Z',
};

const LISTEN_LEFT: ExamRecordEntry = {
  actionId: 'listen',
  side: 'Left',
  simulationTime: 102,
  branchId: 'b1',
  sentence: 'You can barely hear any breathing on this side.',
  abnormal: true,
  wallClockTime: '2026-11-21T10:01:36.000Z',
};

/** Stored example of the design's "Data Models", verbatim. */
const DESIGN_EXAMPLE = `{"v":1,"entries":[
  {"actionId":"look-chest","simulationTime":90,"branchId":"b1","sentence":"One side of his chest hardly moves when he breathes.","abnormal":true,"wallClockTime":"2026-11-21T10:01:30.000Z"},
  {"actionId":"listen","side":"Left","simulationTime":102,"branchId":"b1","sentence":"You can barely hear any breathing on this side.","abnormal":true,"wallClockTime":"2026-11-21T10:01:36.000Z"}
]}`;

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

const throwingGet: Pick<Storage, 'getItem'> = {
  getItem: () => {
    throw new Error('SecurityError: storage disabled');
  },
};

const throwingSet: Pick<Storage, 'setItem'> = {
  setItem: () => {
    throw typeof DOMException === 'function'
      ? new DOMException('quota', 'QuotaExceededError')
      : new Error('quota');
  },
};

describe('examRecordKey (Requirements 7.4, 10.6)', () => {
  it('is the fixed prefix followed by the session_id and nothing else', () => {
    expect(examRecordKey('abc')).toBe('stitched-patient:exam-record:abc');
    expect(examRecordKey('xyz').replace('xyz', 'abc')).toBe(examRecordKey('abc'));
  });
});

describe('buildExamEntry (Requirement 7.1)', () => {
  it('copies the finding and leaves side out when null', () => {
    const entry = buildExamEntry({
      actionId: 'look-chest',
      side: null,
      simulationTime: 90,
      branchId: 'b1',
      finding: { sentence: LOOK.sentence, abnormal: true },
      wallClockTime: LOOK.wallClockTime,
    });
    expect(entry).toStrictEqual(LOOK);
    expect('side' in entry).toBe(false);
  });

  it('keeps a Left or Right side', () => {
    const entry = buildExamEntry({
      actionId: 'listen',
      side: 'Left',
      simulationTime: 102,
      branchId: 'b1',
      finding: { sentence: LISTEN_LEFT.sentence, abnormal: true },
      wallClockTime: LISTEN_LEFT.wallClockTime,
    });
    expect(entry).toStrictEqual(LISTEN_LEFT);
  });
});

describe('serializeExamRecord / parseExamRecord: fixed inputs (Requirements 7.4-7.7)', () => {
  it('parses the stored example of the design to its two entries', () => {
    expect(parseExamRecord(DESIGN_EXAMPLE)).toStrictEqual([LOOK, LISTEN_LEFT]);
  });

  it('writes the versioned format with only the seven fields', () => {
    const extra = { ...LISTEN_LEFT, note: 'x' } as ExamRecordEntry;
    const stored = JSON.parse(serializeExamRecord([LOOK, extra]));
    expect(stored).toEqual({ v: 1, entries: [LOOK, LISTEN_LEFT] });
    expect(Object.keys(stored.entries[1]).sort()).toEqual(
      ['abnormal', 'actionId', 'branchId', 'sentence', 'side', 'simulationTime', 'wallClockTime'],
    );
  });

  it('returns [] for a missing value (null)', () => {
    expect(parseExamRecord(null)).toEqual([]);
  });

  it('returns [] for bad JSON', () => {
    expect(parseExamRecord('{"v":1,"entries":[')).toEqual([]);
    expect(parseExamRecord('')).toEqual([]);
    expect(parseExamRecord('not json')).toEqual([]);
  });

  it('returns [] for a wrong or missing v', () => {
    expect(parseExamRecord(raw(2, [LOOK]))).toEqual([]);
    expect(parseExamRecord(raw('1', [LOOK]))).toEqual([]);
    expect(parseExamRecord(JSON.stringify({ entries: [LOOK] }))).toEqual([]);
  });

  it('returns [] when one entry among valid ones is invalid', () => {
    expect(parseExamRecord(raw(1, [LOOK, { ...LISTEN_LEFT, side: 'left' }]))).toEqual([]);
    expect(parseExamRecord(raw(1, [LOOK, { ...LISTEN_LEFT, abnormal: 'true' }]))).toEqual([]);
    expect(parseExamRecord(raw(1, [LOOK, { ...LISTEN_LEFT, simulationTime: -1 }]))).toEqual([]);
    const { sentence: _omit, ...noSentence } = LISTEN_LEFT;
    expect(parseExamRecord(raw(1, [LOOK, noSentence]))).toEqual([]);
  });
});

describe('loadExamRecord / saveExamRecord (Requirements 7.4-7.6)', () => {
  it('saveExamRecord writes under examRecordKey(sessionId); loadExamRecord reads it back', () => {
    const storage = memoryStorage();
    saveExamRecord(storage, 'sess-1', [LOOK, LISTEN_LEFT]);
    expect([...storage.data.keys()]).toEqual([examRecordKey('sess-1')]);
    expect(loadExamRecord(storage, 'sess-1')).toStrictEqual([LOOK, LISTEN_LEFT]);
  });

  it('loadExamRecord returns [] when nothing is stored for the session', () => {
    const storage = memoryStorage();
    saveExamRecord(storage, 'sess-1', [LOOK]);
    expect(loadExamRecord(storage, 'sess-2')).toEqual([]);
  });

  it('loadExamRecord returns [] when getItem throws', () => {
    expect(loadExamRecord(throwingGet, 'sess-1')).toEqual([]);
  });

  it('saveExamRecord returns normally when setItem throws', () => {
    expect(() => saveExamRecord(throwingSet, 'sess-1', [LOOK])).not.toThrow();
  });
});

describe('findingsNewestFirst: fixed input (Requirement 6.6)', () => {
  it('orders by time descending, and equal times from the latest recorded', () => {
    const a = { ...LOOK, simulationTime: 30, sentence: 'a' };
    const b = { ...LOOK, simulationTime: 90, sentence: 'b' };
    const c = { ...LOOK, simulationTime: 30, sentence: 'c' };
    const d = { ...LOOK, simulationTime: 90, sentence: 'd' };
    expect(findingsNewestFirst([a, b, c, d]).map((e) => e.sentence)).toEqual(['d', 'b', 'c', 'a']);
  });
});

// ---------------------------------------------------------------------------
// Property 13 generators
// ---------------------------------------------------------------------------

type Json = Record<string, unknown>;

const recordArb = fc.array(arbExamRecordEntry, { maxLength: 30 });

/** Placeholder replaced in the JSON text by a token JSON.stringify cannot write. */
const RAW = '__RAW__';

const set =
  (key: string, value: unknown) =>
  (e: Json): Json => ({ ...e, [key]: value });
const remove =
  (key: string) =>
  (e: Json): Json => {
    const copy = { ...e };
    delete copy[key];
    return copy;
  };

type Corruption = { kind: string; apply: (e: Json) => unknown; token?: string };

const REQUIRED_FIELDS = [
  'actionId',
  'simulationTime',
  'branchId',
  'sentence',
  'abnormal',
  'wallClockTime',
] as const;

const CORRUPTIONS: Corruption[] = [
  ...REQUIRED_FIELDS.map((f) => ({ kind: `remove:${f}`, apply: remove(f) })),
  { kind: 'actionId:number', apply: set('actionId', 1) },
  { kind: 'branchId:null', apply: set('branchId', null) },
  { kind: 'sentence:number', apply: set('sentence', 0) },
  { kind: 'wallClockTime:number', apply: set('wallClockTime', 1700000000000) },
  { kind: 'abnormal:string', apply: set('abnormal', 'true') },
  { kind: 'abnormal:number', apply: set('abnormal', 1) },
  { kind: 'simulationTime:string', apply: set('simulationTime', '90') },
  { kind: 'simulationTime:negative', apply: set('simulationTime', -0.5) },
  { kind: 'simulationTime:Infinity', apply: set('simulationTime', RAW), token: '1e400' },
  { kind: 'simulationTime:-Infinity', apply: set('simulationTime', RAW), token: '-1e400' },
  { kind: 'side:lowercase', apply: set('side', 'left') },
  { kind: 'side:other', apply: set('side', 'Both') },
  { kind: 'side:null', apply: set('side', null) },
  { kind: 'side:number', apply: set('side', 0) },
  { kind: 'entry:null', apply: () => null },
  { kind: 'entry:array', apply: (e) => [e] },
];

const corruptedEntryArb = fc
  .tuple(
    fc.constantFrom(...CORRUPTIONS),
    fc.array(arbExamRecordEntry, { minLength: 1, maxLength: 30 }),
    fc.nat(),
  )
  .map(([c, record, n]) => {
    const at = n % record.length;
    const entries: unknown[] = record.map((e) => ({ ...e }));
    entries[at] = c.apply(entries[at] as Json);
    let text = raw(1, entries);
    if (c.token !== undefined) text = text.replace(`"${RAW}"`, c.token);
    return text as unknown;
  });

const wrongVersionArb = fc
  .tuple(fc.oneof(fc.integer().filter((v) => v !== 1), fc.constant('1'), fc.constant(null)), recordArb)
  .map(([v, record]) => raw(v, record) as unknown);

const malformedArb: fc.Arbitrary<unknown> = fc.oneof(
  { weight: 1, arbitrary: fc.string() },
  { weight: 1, arbitrary: fc.constant(null) },
  { weight: 1, arbitrary: fc.anything() },
  { weight: 2, arbitrary: wrongVersionArb },
  { weight: 5, arbitrary: corruptedEntryArb },
);

describe('Property 13: The Exam_Record storage round trip, and malformed data gives an empty record', () => {
  // Feature: bedside-exam, Property 13: The Exam_Record storage round trip, and malformed data gives an empty record
  // **Validates: Requirements 7.4, 7.5, 7.6, 7.7, 10.6**
  it('round-trips through serialize/parse and through save/load on a memory storage', () => {
    fc.assert(
      fc.property(recordArb, fc.string({ minLength: 1 }), (record, sessionId) => {
        const parsed = parseExamRecord(serializeExamRecord(record));
        expect(parsed).toStrictEqual(record);
        record.forEach((entry, i) => {
          expect('side' in parsed[i]).toBe('side' in entry);
        });

        const storage = memoryStorage();
        saveExamRecord(storage, sessionId, record);
        expect([...storage.data.keys()]).toEqual([`stitched-patient:exam-record:${sessionId}`]);
        const loaded = loadExamRecord(storage, sessionId);
        expect(loaded).toStrictEqual(record);
        expect(loaded.map((e) => e.sentence)).toEqual(record.map((e) => e.sentence));
      }),
      PBT_PARAMS,
    );
  });

  // Feature: bedside-exam, Property 13: The Exam_Record storage round trip, and malformed data gives an empty record
  // **Validates: Requirements 7.6**
  it('returns [] without throwing for malformed data and for throwing storage', () => {
    fc.assert(
      fc.property(malformedArb, recordArb, (input, record) => {
        let result: unknown;
        expect(() => {
          result = parseExamRecord(input as string | null);
        }).not.toThrow();
        // A random string or value is practically never a valid non-empty record;
        // when it parses as an empty valid record, [] is still the right answer.
        expect(result).toEqual([]);
        expect(loadExamRecord(throwingGet, 'sess')).toEqual([]);
        expect(() => saveExamRecord(throwingSet, 'sess', record)).not.toThrow();
      }),
      PBT_PARAMS,
    );
  });
});

describe('Property 14: The Findings_List is newest first', () => {
  // Feature: bedside-exam, Property 14: The Findings_List is newest first
  // **Validates: Requirements 6.6**
  it('returns a permutation ordered by time descending, equal times latest recorded first', () => {
    const tagged = fc
      .array(
        fc.tuple(arbExamRecordEntry, fc.option(fc.constantFrom(0, 30, 90), { nil: undefined })),
        { maxLength: 30 },
      )
      .map((items) =>
        // A unique sentence per record index lets the test recover each entry's index;
        // the optional small time pool makes repeated Simulation_Times common.
        items.map(([e, t], i) => ({ ...e, simulationTime: t ?? e.simulationTime, sentence: `#${i}` })),
      );
    fc.assert(
      fc.property(tagged, (record) => {
        const input = record.map((e) => ({ ...e }));
        const result = findingsNewestFirst(record);
        expect(record).toStrictEqual(input); // input not mutated
        const indices = result.map((e) => Number(e.sentence.slice(1)));
        expect([...indices].sort((a, b) => a - b)).toEqual(record.map((_, i) => i));
        result.forEach((e, k) => expect(e).toStrictEqual(record[indices[k]]));
        for (let k = 1; k < result.length; k += 1) {
          const prev = result[k - 1];
          const cur = result[k];
          expect(prev.simulationTime).toBeGreaterThanOrEqual(cur.simulationTime);
          if (prev.simulationTime === cur.simulationTime) {
            expect(indices[k - 1]).toBeGreaterThan(indices[k]);
          }
        }
      }),
      PBT_PARAMS,
    );
  });
});
