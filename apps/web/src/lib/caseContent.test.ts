/**
 * Content checks for the Play_Section and Play_Labels of
 * `cases/adult-tension-pneumothorax.yaml` (Requirements 2.14, 2.15, 2.16,
 * 2.19, 2.22, 2.23, 5.9, 6.14, 9.8).
 *
 * The case is read with `yaml` parseDocument and a LineCounter so the
 * TODO(author) check can map each value to its source line.
 *
 * Every checker returns a list of failure messages. An empty list means the
 * check passed. A missing Play_Section is a failure for every checker.
 */

import { describe, expect, it } from 'vitest';
import {
  LineCounter,
  isMap,
  isScalar,
  isSeq,
  parseDocument,
  type Document,
  type Scalar,
} from 'yaml';
import type { CaseData } from '@/types';
import { CASE_TEXT } from '@/test/caseFixtures';
import { conditionsDisjoint, interventionSide, playButtonText } from './playCase';

const MISSING = 'Play_Section is missing';
const DRAFT_SUFFIX =
  'draft from engine runs on 2026-11-20 (commit 1e71454), pending author review';

interface ParsedCase {
  doc: Document;
  lineCounter: LineCounter;
  lines: string[];
  data: CaseData;
}

function parseCase(text: string): ParsedCase {
  const lineCounter = new LineCounter();
  const doc = parseDocument(text, { lineCounter });
  return { doc, lineCounter, lines: text.split(/\r?\n/), data: doc.toJS() as CaseData };
}

const PARSED = parseCase(CASE_TEXT);

// ---------------------------------------------------------------------------
// Checkers over the parsed data
// ---------------------------------------------------------------------------

/** No Status_Rule sentence or defaultSentence contains a Diagnosis_Term (2.19, 5.9). */
function checkNoDiagnosisTermsInSentences(c: CaseData): string[] {
  const play = c.play;
  if (!play) return [MISSING];
  const terms = (play.diagnosisTerms ?? []).filter((t) => typeof t === 'string' && t.length > 0);
  if (terms.length === 0) return ['play.diagnosisTerms is empty'];
  const sentences: Array<{ path: string; text: unknown }> = [
    ...(play.status?.rules ?? []).map((r, i) => ({
      path: `play.status.rules[${i}].sentence`,
      text: r?.sentence,
    })),
    { path: 'play.status.defaultSentence', text: play.status?.defaultSentence },
  ];
  const failures: string[] = [];
  for (const { path, text } of sentences) {
    if (typeof text !== 'string') {
      failures.push(`${path} is not a string`);
      continue;
    }
    for (const term of terms) {
      if (text.toLowerCase().includes(term.toLowerCase())) {
        failures.push(`${path} "${text}" contains Diagnosis_Term "${term}"`);
      }
    }
  }
  return failures;
}

/** diagnosisTerms lists "pneumothorax" and "tension" (2.16). */
function checkRequiredDiagnosisTerms(c: CaseData): string[] {
  const play = c.play;
  if (!play) return [MISSING];
  const terms = (play.diagnosisTerms ?? []).map((t) => String(t).toLowerCase());
  return ['pneumothorax', 'tension']
    .filter((required) => !terms.includes(required))
    .map((required) => `play.diagnosisTerms does not contain "${required}"`);
}

/**
 * Each Lost_Condition group has a condition on a vital that the
 * Rescue_Condition also names, with the two conditions disjoint (6.14).
 */
function checkLostGroupsDisjointFromRescue(c: CaseData): string[] {
  const play = c.play;
  if (!play) return [MISSING];
  const rescue = play.endings?.rescued?.conditions ?? [];
  if (rescue.length === 0) return ['play.endings.rescued.conditions is empty'];
  const failures: string[] = [];
  (play.endings?.lost?.groups ?? []).forEach((group, i) => {
    const conditions = group?.conditions ?? [];
    const ok = conditions.some((lost) =>
      rescue.some((r) => r.vital === lost.vital && conditionsDisjoint(r, lost)),
    );
    if (!ok) {
      const described = conditions.map((l) => `${l.vital} ${l.op} ${l.value}`).join(', ');
      failures.push(
        `play.endings.lost.groups[${i}] (${described}) shares no vital with the Rescue_Condition whose conditions are disjoint`,
      );
    }
  });
  return failures;
}

/**
 * Exactly 3 Hints; Hints before the last name no Intervention `label` or
 * `playLabel`; the last Hint contains the left Play_Label (9.8).
 */
function checkHints(c: CaseData): string[] {
  const play = c.play;
  if (!play) return [MISSING];
  const hints = play.hints ?? [];
  const failures: string[] = [];
  if (hints.length !== 3) failures.push(`play.hints has ${hints.length} Hints, expected exactly 3`);

  const interventionTexts = (c.interventions ?? [])
    .flatMap((i) => [i.label, i.playLabel])
    .filter((s): s is string => typeof s === 'string' && /\S/.test(s));
  hints.slice(0, -1).forEach((hint, idx) => {
    const text = String(hint?.text ?? '');
    for (const name of interventionTexts) {
      if (text.toLowerCase().includes(name.toLowerCase())) {
        failures.push(`Hint ${idx + 1} "${text}" contains the Intervention text "${name}"`);
      }
    }
  });

  const left = (c.interventions ?? []).find((i) => interventionSide(i) === 'Left');
  const leftPlayLabel = left?.playLabel;
  const last = hints[hints.length - 1];
  if (typeof leftPlayLabel !== 'string' || !/\S/.test(leftPlayLabel)) {
    failures.push('no left Intervention has a Play_Label');
  } else if (last) {
    const text = String(last.text ?? '');
    if (!text.toLowerCase().includes(leftPlayLabel.toLowerCase())) {
      failures.push(`last Hint "${text}" does not contain the left Play_Label "${leftPlayLabel}"`);
    }
  }
  return failures;
}

/** Each Play_Label differs from its `label` and names its own side (2.14). */
function checkPlayLabels(c: CaseData): string[] {
  if (!c.play) return [MISSING];
  const interventions = c.interventions ?? [];
  if (interventions.length === 0) return ['the case has no Interventions'];
  const failures: string[] = [];
  interventions.forEach((i, idx) => {
    const path = `interventions[${idx}] (${i.id})`;
    const playLabel = i.playLabel;
    if (typeof playLabel !== 'string' || playButtonText(i) !== playLabel) {
      failures.push(`${path} has no Play_Label`);
      return;
    }
    if (playLabel.trim().toLowerCase() === String(i.label).trim().toLowerCase()) {
      failures.push(`${path} Play_Label "${playLabel}" equals its label`);
    }
    const side = interventionSide(i);
    if (!side) {
      failures.push(`${path} has no Left/Right side parameter`);
      return;
    }
    const own = side.toLowerCase();
    const other = side === 'Left' ? 'right' : 'left';
    if (!new RegExp(`\\b${own}\\b`, 'i').test(playLabel)) {
      failures.push(`${path} Play_Label "${playLabel}" does not contain "${own}"`);
    }
    if (new RegExp(`\\b${other}\\b`, 'i').test(playLabel)) {
      failures.push(`${path} Play_Label "${playLabel}" contains the other side "${other}"`);
    }
  });
  return failures;
}

// ---------------------------------------------------------------------------
// TODO(author) markers (Requirement 2.15) over the YAML AST
// ---------------------------------------------------------------------------

interface ScalarItem {
  path: string;
  node: Scalar;
}

function collectScalars(node: unknown, path: string, out: ScalarItem[] = []): ScalarItem[] {
  if (isMap(node)) {
    for (const pair of node.items) {
      const key = isScalar(pair.key) ? String(pair.key.value) : String(pair.key);
      collectScalars(pair.value, `${path}.${key}`, out);
    }
  } else if (isSeq(node)) {
    node.items.forEach((item, i) => collectScalars(item, `${path}[${i}]`, out));
  } else if (isScalar(node)) {
    out.push({ path, node });
  }
  return out;
}

/** The comment on a source line (from an unquoted `#` to the end), or undefined. */
function lineComment(line: string): string | undefined {
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote === '"') {
      if (ch === '\\') i++;
      else if (ch === '"') quote = null;
    } else if (quote === "'") {
      if (ch === "'") quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '#' && (i === 0 || /\s/.test(line[i - 1]))) {
      return line.slice(i);
    }
  }
  return undefined;
}

/** Field paths that need a TODO(author) marker, besides every number in the Play_Section. */
const TEXT_ITEM_PATTERNS: RegExp[] = [
  /^play\.hints\[\d+\]\.text$/,
  /^play\.status\.rules\[\d+\]\.sentence$/,
  /^play\.status\.defaultSentence$/,
  // Draft text values (author away): goal text, diagnosis terms.
  /^play\.goalText$/,
  /^play\.diagnosisTerms\[\d+\]$/,
];

/** The `references` path that covers a field path (Requirement 2.15). */
function coveringReferencesPath(path: string): Array<string | number> {
  const hint = /^play\.hints\[(\d+)\]/.exec(path);
  if (hint) return ['play', 'hints', Number(hint[1]), 'references'];
  const ending = /^play\.endings\.(rescued|lost)\./.exec(path);
  if (ending) return ['play', 'endings', ending[1], 'references'];
  return ['play', 'references'];
}

/**
 * Every number in the Play_Section, every Hint text, every Status_Rule
 * sentence, the defaultSentence, the goal text, the diagnosis terms and every
 * Play_Label has a comment containing `TODO(author)` on its source line or on
 * a comment-only line directly above, unless its covering `references` array
 * is non-empty. Each such marker must end with the draft suffix.
 */
function checkTodoMarkers(doc: Document, lineCounter: LineCounter, lines: string[]): string[] {
  const playNode = doc.get('play', true);
  if (!isMap(playNode)) return [MISSING];

  const items = collectScalars(playNode, 'play').filter(
    ({ path, node }) =>
      typeof node.value === 'number' || TEXT_ITEM_PATTERNS.some((p) => p.test(path)),
  );
  const interventions = doc.get('interventions', true);
  if (isSeq(interventions)) {
    interventions.items.forEach((item, i) => {
      if (!isMap(item)) return;
      const node = item.get('playLabel', true);
      if (isScalar(node)) items.push({ path: `interventions[${i}].playLabel`, node });
    });
  }

  const failures: string[] = [];
  for (const { path, node } of items) {
    const refs = doc.getIn(coveringReferencesPath(path), true);
    if (isSeq(refs) && refs.items.length > 0) continue;

    const start = node.range?.[0];
    if (start === undefined) {
      failures.push(`${path} has no source position`);
      continue;
    }
    const lineIdx = lineCounter.linePos(start).line - 1;
    const sameLine = lineComment(lines[lineIdx] ?? '');
    const above = lines[lineIdx - 1] ?? '';
    const aboveComment = above.trimStart().startsWith('#') ? above.trim() : undefined;
    const marker = [sameLine, aboveComment].find((cm) => cm?.includes('TODO(author)'));
    if (!marker) {
      failures.push(
        `${path} (line ${lineIdx + 1}) has no TODO(author) comment on its line or the line directly above`,
      );
    } else if (!marker.trimEnd().endsWith(DRAFT_SUFFIX)) {
      failures.push(`${path} (line ${lineIdx + 1}) TODO(author) comment does not end with "${DRAFT_SUFFIX}"`);
    }
  }
  return failures;
}

// ---------------------------------------------------------------------------
// Required_Interventions (Requirements 2.22, 2.23)
// ---------------------------------------------------------------------------

const REQUIRED_PATH = 'play.endings.rescued.requiredInterventions';

/** Every entry of `endings.rescued.requiredInterventions` is the `id` of an Intervention of the case (2.22). */
function checkRequiredInterventionsExist(c: CaseData): string[] {
  const play = c.play;
  if (!play) return [MISSING];
  const ids = new Set((c.interventions ?? []).map((i) => i.id));
  const failures: string[] = [];
  (play.endings?.rescued?.requiredInterventions ?? []).forEach((id, i) => {
    if (!ids.has(id)) failures.push(`${REQUIRED_PATH}[${i}] "${id}" is not the id of an Intervention in the case`);
  });
  return failures;
}

/** The comment on a line, or the comment-only line directly above it. */
function commentsAround(lines: string[], lineIdx: number): string[] {
  const above = lines[lineIdx - 1] ?? '';
  return [lineComment(lines[lineIdx] ?? ''), above.trimStart().startsWith('#') ? above.trim() : undefined].filter(
    (cm): cm is string => cm !== undefined,
  );
}

/**
 * `requiredInterventions` lists exactly `needle-decompression-left`, with a
 * comment on its line or the line directly above that states the author's
 * decision of 2026-11-20, and no `TODO(author)` marker there (2.23).
 */
function checkRequiredInterventionsDecision(doc: Document, lineCounter: LineCounter, lines: string[]): string[] {
  if (!isMap(doc.get('play', true))) return [MISSING];
  const seq = doc.getIn(['play', 'endings', 'rescued', 'requiredInterventions'], true);
  if (!isSeq(seq)) return [`${REQUIRED_PATH} is missing`];
  const values = seq.items.map((item) => (isScalar(item) ? item.value : item));
  if (values.length !== 1 || values[0] !== 'needle-decompression-left') {
    return [`${REQUIRED_PATH} is ${JSON.stringify(values)}, expected ["needle-decompression-left"]`];
  }
  const item = seq.items[0];
  const start = isScalar(item) ? item.range?.[0] : undefined;
  if (start === undefined) return [`${REQUIRED_PATH}[0] has no source position`];
  const lineIdx = lineCounter.linePos(start).line - 1;
  const comments = commentsAround(lines, lineIdx);
  const failures: string[] = [];
  const decision = comments.some(
    (cm) =>
      /author's decision/i.test(cm) &&
      cm.includes('2026-11-20') &&
      /rescue counts only after the left needle decompression/i.test(cm),
  );
  if (!decision) {
    failures.push(
      `${REQUIRED_PATH} (line ${lineIdx + 1}) has no comment stating the author's decision of 2026-11-20 on its line or the line directly above`,
    );
  }
  if (comments.some((cm) => cm.includes('TODO(author)'))) {
    failures.push(`${REQUIRED_PATH} (line ${lineIdx + 1}) carries a TODO(author) marker`);
  }
  return failures;
}

const DATA_CHECKERS: Array<[string, (c: CaseData) => string[]]> = [
  ['checkNoDiagnosisTermsInSentences', checkNoDiagnosisTermsInSentences],
  ['checkRequiredDiagnosisTerms', checkRequiredDiagnosisTerms],
  ['checkLostGroupsDisjointFromRescue', checkLostGroupsDisjointFromRescue],
  ['checkHints', checkHints],
  ['checkPlayLabels', checkPlayLabels],
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('adult-tension-pneumothorax case content', () => {
  it('parses without YAML errors and has a Play_Section', () => {
    expect(PARSED.doc.errors).toEqual([]);
    expect(PARSED.data.play).toBeDefined();
    expect(isMap(PARSED.doc.get('play', true))).toBe(true);
  });

  it('no Status_Rule sentence or defaultSentence contains a Diagnosis_Term', () => {
    expect(checkNoDiagnosisTermsInSentences(PARSED.data)).toEqual([]);
  });

  it('diagnosisTerms contains "pneumothorax" and "tension"', () => {
    expect(checkRequiredDiagnosisTerms(PARSED.data)).toEqual([]);
  });

  it('each Lost_Condition group is disjoint from the Rescue_Condition on a shared vital', () => {
    expect(PARSED.data.play?.endings.lost.groups?.length ?? 0).toBeGreaterThan(0);
    expect(checkLostGroupsDisjointFromRescue(PARSED.data)).toEqual([]);
  });

  it('has exactly 3 Hints; only the last names an Intervention, and it names the left Play_Label', () => {
    expect(checkHints(PARSED.data)).toEqual([]);
  });

  it('each Play_Label differs from its label and names its own side', () => {
    expect(checkPlayLabels(PARSED.data)).toEqual([]);
  });

  it('every number, Hint text, sentence and draft text has a TODO(author) marker ending with the draft suffix', () => {
    expect(checkTodoMarkers(PARSED.doc, PARSED.lineCounter, PARSED.lines)).toEqual([]);
  });

  it('every requiredInterventions entry is the id of an Intervention in the case (2.22)', () => {
    expect(PARSED.data.play?.endings.rescued.requiredInterventions?.length ?? 0).toBeGreaterThan(0);
    expect(checkRequiredInterventionsExist(PARSED.data)).toEqual([]);
  });

  it('requiredInterventions is exactly needle-decompression-left, with the 2026-11-20 decision comment and no TODO(author) (2.23)', () => {
    expect(PARSED.data.play?.endings.rescued.requiredInterventions).toEqual(['needle-decompression-left']);
    expect(checkRequiredInterventionsDecision(PARSED.doc, PARSED.lineCounter, PARSED.lines)).toEqual([]);
  });
});

describe('Required_Interventions checkers', () => {
  it('names each unknown requiredInterventions entry (2.22)', () => {
    const c = structuredClone(PARSED.data);
    c.play!.endings.rescued.requiredInterventions = ['needle-decompression-left', 'chest-tube', 'needle-left'];
    expect(checkRequiredInterventionsExist(c)).toEqual([
      'play.endings.rescued.requiredInterventions[1] "chest-tube" is not the id of an Intervention in the case',
      'play.endings.rescued.requiredInterventions[2] "needle-left" is not the id of an Intervention in the case',
    ]);
  });

  it('fails without the decision comment, with a TODO(author) marker, or with another list (2.23)', () => {
    const decision = CASE_TEXT.split(/\r?\n/).find((l) => l.includes("Author's decision of 2026-11-20"));
    expect(decision).toBeDefined();
    const entryLine = '      requiredInterventions: ["needle-decompression-left"]';
    expect(CASE_TEXT).toContain(entryLine);

    const check = (text: string) => {
      const p = parseCase(text);
      return checkRequiredInterventionsDecision(p.doc, p.lineCounter, p.lines);
    };
    const noComment = check(CASE_TEXT.replace(`${decision}\n`, ''));
    expect(noComment).toHaveLength(1);
    expect(noComment[0]).toContain("has no comment stating the author's decision of 2026-11-20");

    const withTodo = check(CASE_TEXT.replace(entryLine, `${entryLine} # TODO(author): review`));
    expect(withTodo).toEqual([`${REQUIRED_PATH} (line ${PARSED.lines.indexOf(entryLine) + 1}) carries a TODO(author) marker`]);

    const both = check(
      CASE_TEXT.replace(entryLine, '      requiredInterventions: ["needle-decompression-left", "needle-decompression-right"]'),
    );
    expect(both).toEqual([
      `${REQUIRED_PATH} is ["needle-decompression-left","needle-decompression-right"], expected ["needle-decompression-left"]`,
    ]);
  });
});

describe('case content checkers', () => {
  it('every check fails when the Play_Section is missing', () => {
    const noPlay = structuredClone(PARSED.data);
    delete noPlay.play;
    for (const [name, check] of DATA_CHECKERS) {
      expect(check(noPlay), name).toEqual([MISSING]);
    }
    const docNoPlay = PARSED.doc.clone();
    docNoPlay.delete('play');
    expect(checkTodoMarkers(docNoPlay, PARSED.lineCounter, PARSED.lines)).toEqual([MISSING]);
  });

  it('names the sentence that contains a Diagnosis_Term', () => {
    const c = structuredClone(PARSED.data);
    c.play!.status.defaultSentence = 'He has a Tension problem.';
    expect(checkNoDiagnosisTermsInSentences(c)).toEqual([
      'play.status.defaultSentence "He has a Tension problem." contains Diagnosis_Term "tension"',
    ]);
  });

  it('names the Lost_Condition group that overlaps the Rescue_Condition', () => {
    const c = structuredClone(PARSED.data);
    c.play!.endings.lost.groups = [
      { conditions: [{ vital: 'spO2', op: '<', value: 0.97 }], holdSeconds: 30 },
    ];
    const failures = checkLostGroupsDisjointFromRescue(c);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain('play.endings.lost.groups[0] (spO2 < 0.97)');
  });

  it('names the Hint text that gives the answer early', () => {
    const c = structuredClone(PARSED.data);
    c.play!.hints[0] = { text: 'Try NEEDLE DECOMPRESSION - LEFT now.' };
    expect(checkHints(c)).toEqual([
      'Hint 1 "Try NEEDLE DECOMPRESSION - LEFT now." contains the Intervention text "Needle decompression - left"',
    ]);
  });

  it('names the field path whose TODO(author) marker is missing, and honours covering references', () => {
    const marker =
      '    # TODO(author): default status sentence - draft from engine runs on 2026-11-20 (commit 1e71454), pending author review\n';
    expect(CASE_TEXT).toContain(marker);
    const parsed = parseCase(CASE_TEXT.replace(marker, ''));
    const failures = checkTodoMarkers(parsed.doc, parsed.lineCounter, parsed.lines);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain('play.status.defaultSentence');

    const play = parsed.doc.get('play', true);
    if (!isMap(play)) throw new Error('play is not a map');
    play.set('references', parsed.doc.createNode(['A citation']));
    expect(checkTodoMarkers(parsed.doc, parsed.lineCounter, parsed.lines)).toEqual([]);
  });
});
