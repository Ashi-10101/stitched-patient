/**
 * Speech_Check (patient-speech Requirement 2.1, design "speechCheck.ts").
 *
 * Lists the failures of a text against rules (a) to (f) for a Case_Definition.
 * The same patterns and message texts are copied in `scripts/validate-case.py`
 * (decision 14, D11). The checks are partial word lists: passing them does not
 * prove that a line is first person or hints at nothing (Requirement 2.7).
 * Pure: reads no clock, network, storage or randomness.
 */

import { examButtons } from './examFinding';
import type { CaseData } from '@/types';

/** Rule (b): the Case_Schema `maxLength` of a Speech_Line, in code points. */
export const SPEECH_MAX_CODE_POINTS = 200;

/** Whole-word, case-insensitive. No look-behind, so Python and every browser agree (D11). */
export const SIDE_WORD_PATTERN = /(^|[^A-Za-z0-9_])(left|right)(?=$|[^A-Za-z0-9_])/gi;
export const THIRD_PERSON_PATTERN = /(^|[^A-Za-z0-9_])(he|his|him|himself)(?=$|[^A-Za-z0-9_])/gi;

/** Rule message texts, identical in validate-case.py. */
export const SPEECH_RULE_TEXT = {
  blank: 'is empty or contains only whitespace',
  tooLong: 'has more than 200 characters',
  diagnosis: (term: string) => `contains Diagnosis_Term "${term}"`,
  side: (word: string) => `contains Side_Word "${word}"`,
  forbidden: (term: string) => `contains Forbidden_Speech_Term "${term}"`,
  thirdPerson: (word: string) => `contains Third_Person_Word "${word}"`,
} as const;

type SpeechCheckCase = Pick<CaseData, 'interventions' | 'play'>;

function isNonBlank(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

/** Non-blank strings of `values`, in order, without repeats. */
function nonBlankUnique(values: readonly unknown[]): string[] {
  return [...new Set(values.filter(isNonBlank))];
}

/** Each distinct lower-cased whole-word match of `pattern` (group 2), in first-match order. */
function wordMatches(text: string, pattern: RegExp): string[] {
  return [...new Set([...text.matchAll(pattern)].map((m) => m[2].toLowerCase()))];
}

function containsIgnoringCase(text: string, term: string): boolean {
  return text.toLowerCase().includes(term.toLowerCase());
}

/**
 * Forbidden_Speech_Terms: `play.speech.forbiddenTerms`, every Intervention
 * `label` and Play_Label, every Exam_Button text (in `examButtons` order).
 * Non-blank, without repeats, in that order. Empty without a Play_Section.
 */
export function forbiddenSpeechTerms(caseData: SpeechCheckCase): string[] {
  const play = caseData.play;
  if (play === undefined || play === null) return [];
  const terms: unknown[] = [...(play.speech?.forbiddenTerms ?? [])];
  for (const intervention of caseData.interventions ?? []) {
    terms.push(intervention?.label, intervention?.playLabel);
  }
  const exam = play.exam;
  if (exam !== undefined && exam !== null && Array.isArray(exam.actions)) {
    for (const group of examButtons(exam)) {
      for (const button of group) terms.push(button.text);
    }
  }
  return nonBlankUnique(terms);
}

/** One message per broken rule (a) to (f), in that order; [] when the text passes. Pure. */
export function speechCheck(text: string, caseData: SpeechCheckCase): string[] {
  // (a) A blank text reports only this rule.
  if (text.trim() === '') return [SPEECH_RULE_TEXT.blank];

  const failures: string[] = [];

  // (b) Code points, as JSON Schema `maxLength` counts them.
  if ([...text].length > SPEECH_MAX_CODE_POINTS) failures.push(SPEECH_RULE_TEXT.tooLong);

  // (c) Diagnosis_Terms, case-insensitive substring (play-mode 2.19).
  const diagnosisTerms = nonBlankUnique(caseData.play?.diagnosisTerms ?? []);
  for (const term of diagnosisTerms) {
    if (containsIgnoringCase(text, term)) failures.push(SPEECH_RULE_TEXT.diagnosis(term));
  }

  // (d) Side_Words, whole words.
  for (const word of wordMatches(text, SIDE_WORD_PATTERN)) failures.push(SPEECH_RULE_TEXT.side(word));

  // (e) Forbidden_Speech_Terms, case-insensitive substring.
  for (const term of forbiddenSpeechTerms(caseData)) {
    if (containsIgnoringCase(text, term)) failures.push(SPEECH_RULE_TEXT.forbidden(term));
  }

  // (f) Third_Person_Words, whole words.
  for (const word of wordMatches(text, THIRD_PERSON_PATTERN)) failures.push(SPEECH_RULE_TEXT.thirdPerson(word));

  return failures;
}
