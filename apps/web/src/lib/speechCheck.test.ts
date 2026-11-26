/**
 * Speech_Check unit tests (patient-speech Requirement 2.1, 12.1; design
 * "speechCheck.ts" and "Testing Strategy").
 *
 * The test case is the `left` Resolved_Case of the shipped case file with a
 * `play.speech.forbiddenTerms` list added here. The texts below are test inputs
 * only; they are not Speech_Lines and not clinical content.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { SPEECH_MAX_CODE_POINTS, SPEECH_RULE_TEXT, forbiddenSpeechTerms, speechCheck } from './speechCheck';
import type { CaseData, ExamAction, Intervention } from '@/types';
import { CASE_LEFT } from '@/test/caseFixtures';
import { PBT_PARAMS } from '@/test/pbt';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Forbidden_Speech_Terms added by this test as `play.speech.forbiddenTerms`. */
const TEST_FORBIDDEN_TERMS = ['stethoscope', 'oxygen'];

/** A deep copy of `CASE_LEFT` with `play.speech.forbiddenTerms` set; `CASE_LEFT` is not changed. */
function caseWithForbiddenTerms(terms: string[]): CaseData {
  const copy = structuredClone(CASE_LEFT);
  if (copy.play === undefined) throw new Error('fixture: CASE_LEFT has no play section');
  copy.play.speech = { forbiddenTerms: [...terms] };
  return copy;
}

const TEST_CASE = caseWithForbiddenTerms(TEST_FORBIDDEN_TERMS);

/** A deep copy of `CASE_LEFT` without a Play_Section. */
function caseWithoutPlay(): CaseData {
  const copy = structuredClone(CASE_LEFT);
  delete copy.play;
  return copy;
}

function intervention(id: string): Intervention {
  const found = TEST_CASE.interventions.find((i) => i.id === id);
  if (found === undefined) throw new Error(`fixture: no intervention "${id}"`);
  return found;
}

function examAction(id: string): ExamAction {
  const found = TEST_CASE.play?.exam?.actions.find((a) => a.id === id);
  if (found === undefined) throw new Error(`fixture: no exam action "${id}"`);
  return found;
}

/** An astral character: one code point, two UTF-16 units. */
const ASTRAL = '\u{1F62E}';

/** A text that breaks no rule for `TEST_CASE`. */
const PASSING_TEXT = "I... can't... get a breath in. My chest-";

// ---------------------------------------------------------------------------
// forbiddenSpeechTerms
// ---------------------------------------------------------------------------

describe('forbiddenSpeechTerms', () => {
  it('lists speech.forbiddenTerms, then every Intervention label and Play_Label, then every Exam_Button text', () => {
    const interventionTexts = TEST_CASE.interventions.flatMap((i) => [i.label, i.playLabel ?? '']);
    const examTexts = (TEST_CASE.play?.exam?.actions ?? []).flatMap((a) =>
      a.labels !== undefined ? [a.labels.Left, a.labels.Right] : [a.label],
    );
    const expected = [...TEST_FORBIDDEN_TERMS, ...interventionTexts, ...examTexts].filter((t) => t.trim() !== '');

    expect(interventionTexts.length).toBeGreaterThan(0);
    expect(examTexts.length).toBeGreaterThan(0);
    expect(forbiddenSpeechTerms(TEST_CASE)).toEqual([...new Set(expected)]);
  });

  it('drops blank and repeated entries', () => {
    const caseData = caseWithForbiddenTerms(['oxygen', '  ', 'oxygen', '', 'stethoscope']);
    const terms = forbiddenSpeechTerms(caseData);
    expect(terms.slice(0, 2)).toEqual(['oxygen', 'stethoscope']);
    expect(terms.filter((t) => t === 'oxygen')).toHaveLength(1);
    expect(terms.every((t) => t.trim() !== '')).toBe(true);
  });

  it('is empty without a Play_Section', () => {
    expect(forbiddenSpeechTerms(caseWithoutPlay())).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// speechCheck: one failing text per rule
// ---------------------------------------------------------------------------

describe('speechCheck rules (a) to (f)', () => {
  it('(a) reports a blank text, and only rule (a)', () => {
    expect(speechCheck('', TEST_CASE)).toEqual([SPEECH_RULE_TEXT.blank]);
    expect(speechCheck(' \t\n ', TEST_CASE)).toEqual([SPEECH_RULE_TEXT.blank]);
  });

  it('(b) reports a text of more than 200 code points', () => {
    expect(speechCheck('a'.repeat(SPEECH_MAX_CODE_POINTS + 1), TEST_CASE)).toEqual([SPEECH_RULE_TEXT.tooLong]);
  });

  it('(b) counts code points, not UTF-16 units: 200 passes and 201 fails with an astral character', () => {
    const exactly200 = ASTRAL + 'a'.repeat(199);
    const exactly201 = ASTRAL + 'a'.repeat(200);

    expect([...exactly200]).toHaveLength(200);
    expect(exactly200.length).toBe(201); // UTF-16 units
    expect([...exactly201]).toHaveLength(201);

    expect(speechCheck(exactly200, TEST_CASE)).toEqual([]);
    expect(speechCheck(exactly201, TEST_CASE)).toEqual([SPEECH_RULE_TEXT.tooLong]);
  });

  it('(c) reports a Diagnosis_Term by case-insensitive substring', () => {
    expect(speechCheck('Is it a Pneumothorax?', TEST_CASE)).toEqual([SPEECH_RULE_TEXT.diagnosis('pneumothorax')]);
    // Substring, not whole word: "extension" contains "tension".
    expect(speechCheck('Can I get an extension?', TEST_CASE)).toEqual([SPEECH_RULE_TEXT.diagnosis('tension')]);
  });

  it('(d) reports a Side_Word as a whole word, lower-cased', () => {
    expect(speechCheck('My LEFT arm feels heavy.', TEST_CASE)).toEqual([SPEECH_RULE_TEXT.side('left')]);
  });

  it('(d) "alright" passes and "all right" fails', () => {
    expect(speechCheck('I feel alright.', TEST_CASE)).toEqual([]);
    expect(speechCheck('I feel all right.', TEST_CASE)).toEqual([SPEECH_RULE_TEXT.side('right')]);
  });

  it('(e) reports a Forbidden_Speech_Term of speech.forbiddenTerms by case-insensitive substring', () => {
    expect(speechCheck('Is that a STETHOSCOPE?', TEST_CASE)).toEqual([SPEECH_RULE_TEXT.forbidden('stethoscope')]);
  });

  it('(f) reports a Third_Person_Word as a whole word', () => {
    expect(speechCheck('Is he going to be okay?', TEST_CASE)).toEqual([SPEECH_RULE_TEXT.thirdPerson('he')]);
  });

  it('(f) "the", "here" and "them" pass and "he\'s" fails', () => {
    expect(speechCheck('Tell them the pain is here.', TEST_CASE)).toEqual([]);
    expect(speechCheck("I think he's scared.", TEST_CASE)).toEqual([SPEECH_RULE_TEXT.thirdPerson('he')]);
  });

  it('reports each distinct lower-cased whole-word match once', () => {
    expect(speechCheck('He said he was fine, and HE was.', TEST_CASE)).toEqual([SPEECH_RULE_TEXT.thirdPerson('he')]);
  });

  it('a passing text gives []', () => {
    expect(speechCheck(PASSING_TEXT, TEST_CASE)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// speechCheck: Forbidden_Speech_Terms from the case
// ---------------------------------------------------------------------------

describe('speechCheck Forbidden_Speech_Terms from the case', () => {
  it('reports an Intervention label', () => {
    const { label } = intervention('needle-decompression-left');
    expect(label).toBe('Needle decompression - left');
    expect(speechCheck(`Is a ${label.toLowerCase()} going to hurt?`, TEST_CASE)).toEqual([
      SPEECH_RULE_TEXT.side('left'),
      SPEECH_RULE_TEXT.forbidden(label),
    ]);
  });

  it('reports a Play_Label', () => {
    const { playLabel } = intervention('needle-decompression-left');
    expect(playLabel).toBe('Let the trapped air out - left side (needle)');
    expect(speechCheck(`${playLabel}?`, TEST_CASE)).toEqual([
      SPEECH_RULE_TEXT.side('left'),
      SPEECH_RULE_TEXT.forbidden(playLabel ?? ''),
    ]);
  });

  it('reports a side-neutral Exam_Button text', () => {
    const action = examAction('look-chest');
    expect(action.label).toBe('Look at his chest');
    expect(speechCheck('Look at his chest, please.', TEST_CASE)).toEqual([
      SPEECH_RULE_TEXT.forbidden('Look at his chest'),
      SPEECH_RULE_TEXT.thirdPerson('his'),
    ]);
  });

  it('reports a sided Exam_Button text', () => {
    const action = examAction('listen');
    expect(action.labels?.Right).toBe('Listen to his chest - right side');
    expect(speechCheck('Listen to his chest - right side', TEST_CASE)).toEqual([
      SPEECH_RULE_TEXT.side('right'),
      SPEECH_RULE_TEXT.forbidden('Listen to his chest - right side'),
      SPEECH_RULE_TEXT.thirdPerson('his'),
    ]);
  });

  it('does not forbid a single word of an Exam_Button text ("chest", decision 12)', () => {
    expect(speechCheck('My chest hurts.', TEST_CASE)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// speechCheck: a case without a Play_Section
// ---------------------------------------------------------------------------

describe('speechCheck without a Play_Section', () => {
  const noPlay = caseWithoutPlay();

  it('uses empty lists for rules (c) and (e) and still checks (a), (b), (d) and (f)', () => {
    expect(speechCheck('Needle decompression - left for a pneumothorax?', noPlay)).toEqual([
      SPEECH_RULE_TEXT.side('left'),
    ]);
    expect(speechCheck('', noPlay)).toEqual([SPEECH_RULE_TEXT.blank]);
    expect(speechCheck('a'.repeat(SPEECH_MAX_CODE_POINTS + 1), noPlay)).toEqual([SPEECH_RULE_TEXT.tooLong]);
    expect(speechCheck('Is he okay?', noPlay)).toEqual([SPEECH_RULE_TEXT.thirdPerson('he')]);
    expect(speechCheck(PASSING_TEXT, noPlay)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Property 1
// ---------------------------------------------------------------------------
//
// The case is `TEST_CASE` (`CASE_LEFT` with `TEST_FORBIDDEN_TERMS` as its
// `play.speech.forbiddenTerms`), so the "case list" pieces are never empty.
// Every generated text is a test input only, not a Speech_Line.

function requirePlay(caseData: CaseData): NonNullable<CaseData['play']> {
  if (caseData.play === undefined || caseData.play === null) throw new Error('fixture: no play section');
  return caseData.play;
}

const TEST_PLAY = requirePlay(TEST_CASE);

function uniqueNonBlank(values: readonly (string | undefined)[]): string[] {
  return [...new Set(values.filter((v): v is string => typeof v === 'string' && v.trim() !== ''))];
}

/** The inputs of each rule, read from the case data without `forbiddenSpeechTerms`. */
const DIAGNOSIS_TERMS = uniqueNonBlank(TEST_PLAY.diagnosisTerms ?? []);
const INTERVENTION_LABELS = uniqueNonBlank(TEST_CASE.interventions.map((i) => i.label));
const PLAY_LABELS = uniqueNonBlank(TEST_CASE.interventions.map((i) => i.playLabel));
const EXAM_TEXTS = uniqueNonBlank(
  (TEST_PLAY.exam?.actions ?? []).flatMap((a) => (a.labels !== undefined ? [a.labels.Left, a.labels.Right] : [a.label])),
);
/** Forbidden_Speech_Terms in rule (e) order: the case list, the Intervention texts, the Exam_Button texts. */
const ALL_FORBIDDEN = uniqueNonBlank([
  ...TEST_FORBIDDEN_TERMS,
  ...TEST_CASE.interventions.flatMap((i) => [i.label, i.playLabel]),
  ...EXAM_TEXTS,
]);
const SIDE_WORDS = ['left', 'right'];
const THIRD_PERSON_WORDS = ['he', 'his', 'him', 'himself'];

/** Clean fragments, including near misses of rules (c), (d) and (f). */
const CLEAN_WORDS = [
  'I', 'feel', "can't", 'breathe', 'my', 'chest', 'hurts', 'please', 'help', 'so', 'tight', 'air', 'wait', 'Ow',
  'the', 'THE', 'here', 'them', 'she', 'her', 'they', 'theme', 'whim', 'hiss', 'alright', 'lefty', 'bright',
  'outright', 'attention', ASTRAL,
];
/** Each starts and ends with a non-word character and is contained in no term, so no match crosses it. */
const SEPARATORS = [', ', '... ', '; ', '? ', '! ', ' / ', "'s ", ' + '];
/** One code point each; repeated to fill a text up to or past 200 code points. */
const FILL_UNITS = ['a', '.', ' ', ASTRAL];

/** Lower-cased whole words, split as the Speech_Check patterns split them. */
function wordTokens(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9_]+/).filter((t) => t !== '');
}

function includesIgnoringCase(text: string, term: string): boolean {
  return text.toLowerCase().includes(term.toLowerCase());
}

/**
 * The failures, in rule order, that the inserted `pieces` (in text order) cause.
 * Clean words, separators and fill add none (checked below), so this is the
 * expected Speech_Check result of the whole text.
 */
function expectedFailures(pieces: readonly string[], tooLong: boolean): string[] {
  const words = pieces.flatMap(wordTokens);
  const firstSeen = (set: readonly string[]) => [...new Set(words.filter((w) => set.includes(w)))];
  return [
    ...(tooLong ? [SPEECH_RULE_TEXT.tooLong] : []),
    ...DIAGNOSIS_TERMS.filter((t) => pieces.some((p) => includesIgnoringCase(p, t))).map((t) =>
      SPEECH_RULE_TEXT.diagnosis(t),
    ),
    ...firstSeen(SIDE_WORDS).map((w) => SPEECH_RULE_TEXT.side(w)),
    ...ALL_FORBIDDEN.filter((t) => pieces.some((p) => includesIgnoringCase(p, t))).map((t) =>
      SPEECH_RULE_TEXT.forbidden(t),
    ),
    ...firstSeen(THIRD_PERSON_WORDS).map((w) => SPEECH_RULE_TEXT.thirdPerson(w)),
  ];
}

type CaseVariant = 'asIs' | 'lower' | 'upper' | 'capital';

function applyCase(text: string, variant: CaseVariant): string {
  switch (variant) {
    case 'lower':
      return text.toLowerCase();
    case 'upper':
      return text.toUpperCase();
    case 'capital':
      return text.charAt(0).toUpperCase() + text.slice(1);
    default:
      return text;
  }
}

const arbCaseVariant = fc.constantFrom<CaseVariant>('asIs', 'lower', 'upper', 'capital');

/** One inserted piece, taken from one rule, in any letter case. */
const arbPiece = fc
  .tuple(
    fc.oneof(
      fc.constantFrom(...DIAGNOSIS_TERMS),
      fc.constantFrom(...SIDE_WORDS),
      fc.constantFrom(...TEST_FORBIDDEN_TERMS),
      fc.constantFrom(...INTERVENTION_LABELS),
      fc.constantFrom(...PLAY_LABELS),
      fc.constantFrom(...EXAM_TEXTS),
      fc.constantFrom(...THIRD_PERSON_WORDS),
    ),
    arbCaseVariant,
  )
  .map(([text, variant]) => applyCase(text, variant));

const arbFill = fc.oneof(
  fc.constant(null),
  // Up to at most 200 code points: no rule (b) failure.
  fc.record({ unit: fc.constantFrom(...FILL_UNITS), target: fc.integer({ min: 0, max: SPEECH_MAX_CODE_POINTS }) }),
  // Padding past 200 code points: a rule (b) failure.
  fc.record({
    unit: fc.constantFrom(...FILL_UNITS),
    target: fc.integer({ min: SPEECH_MAX_CODE_POINTS + 1, max: SPEECH_MAX_CODE_POINTS + 60 }),
  }),
);

interface BuiltText {
  text: string;
  pieces: string[];
  tooLong: boolean;
}

/** At most 3 clean words and 3 pieces keep an unpadded text under 200 code points. */
const arbBuiltText: fc.Arbitrary<BuiltText> = fc
  .record({
    clean: fc.array(fc.constantFrom(...CLEAN_WORDS), { minLength: 1, maxLength: 3 }),
    pieces: fc.array(arbPiece, { maxLength: 3 }),
    positions: fc.array(fc.nat(), { minLength: 3, maxLength: 3 }),
    separators: fc.array(fc.constantFrom(...SEPARATORS), { minLength: 6, maxLength: 6 }),
    fill: arbFill,
  })
  .map(({ clean, pieces, positions, separators, fill }) => {
    const items = clean.map((text) => ({ text, piece: false }));
    pieces.forEach((text, i) => items.splice(positions[i] % (items.length + 1), 0, { text, piece: true }));
    let text = items.map((item, i) => (i === 0 ? '' : separators[i - 1]) + item.text).join('');
    if (fill !== null) {
      const withSeparator = text + separators[5];
      const missing = fill.target - [...withSeparator].length;
      if (missing > 0) text = withSeparator + fill.unit.repeat(missing);
    }
    return {
      text,
      pieces: items.filter((item) => item.piece).map((item) => item.text),
      tooLong: fill !== null && fill.target > SPEECH_MAX_CODE_POINTS,
    };
  });

/** Empty or whitespace only, of any length up to past 200 code points. */
const arbBlankText = fc
  .array(fc.constantFrom(' ', '\t', '\n', '\r', '\u00a0'), { maxLength: SPEECH_MAX_CODE_POINTS + 60 })
  .map((chars) => chars.join(''));

type Property1Input = { kind: 'blank'; text: string } | ({ kind: 'built' } & BuiltText);

const arbProperty1Input: fc.Arbitrary<Property1Input> = fc.oneof(
  { arbitrary: arbBlankText.map((text): Property1Input => ({ kind: 'blank', text })), weight: 1 },
  { arbitrary: arbBuiltText.map((built): Property1Input => ({ kind: 'built', ...built })), weight: 4 },
);

describe('speechCheck property', () => {
  it('the generator parts are clean: no clean word, fill or separator breaks a rule, and no match crosses a separator', () => {
    for (const list of [DIAGNOSIS_TERMS, INTERVENTION_LABELS, PLAY_LABELS, EXAM_TEXTS]) {
      expect(list.length).toBeGreaterThan(0);
    }
    for (const word of CLEAN_WORDS) expect(expectedFailures([word], false)).toEqual([]);
    for (const unit of FILL_UNITS) expect(expectedFailures([unit.repeat(SPEECH_MAX_CODE_POINTS + 60)], false)).toEqual([]);
    for (const separator of SEPARATORS) {
      expect(expectedFailures([separator], false)).toEqual([]);
      expect(separator).toMatch(/^[^A-Za-z0-9_]/);
      expect(separator).toMatch(/[^A-Za-z0-9_]$/);
      for (const term of [...DIAGNOSIS_TERMS, ...ALL_FORBIDDEN].map((t) => t.toLowerCase())) {
        expect(term.includes(separator)).toBe(false);
        for (let k = 1; k < separator.length; k += 1) {
          expect(term.startsWith(separator.slice(k))).toBe(false); // a match starting inside the separator
          expect(term.endsWith(separator.slice(0, k))).toBe(false); // a match ending inside the separator
        }
      }
    }
  });

  // Feature: patient-speech, Property 1: The Speech_Check reports exactly the broken rules
  it('Property 1: reports exactly the rules of the inserted pieces, only rule (a) for a blank text, and [] for a clean text of at most 200 code points', () => {
    fc.assert(
      fc.property(arbProperty1Input, (input) => {
        const result = speechCheck(input.text, TEST_CASE);
        if (input.kind === 'blank') {
          expect(result).toEqual([SPEECH_RULE_TEXT.blank]);
          return;
        }
        // Generator check: padding, and only padding, goes past 200 code points.
        expect([...input.text].length > SPEECH_MAX_CODE_POINTS).toBe(input.tooLong);
        expect(result).toEqual(expectedFailures(input.pieces, input.tooLong));
        if (input.pieces.length === 0 && !input.tooLong) expect(result).toEqual([]);
      }),
      PBT_PARAMS,
    );
  });
});
