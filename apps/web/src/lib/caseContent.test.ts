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
 *
 * Bedside-exam checks (Requirements 2.1 to 2.8, 10.1 to 10.3, 11.1 to 11.4,
 * 12.4, 12.5, 14.6, 14.7) run once per Resolved_Case. The Resolved_Cases are
 * built from `BASE_CASE` with the independent test resolver
 * `resolveCaseForTest`, and `perVariant` prefixes each failure with
 * `variant '<id>': `.
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
import type { CaseData, PlaySection, Side } from '@/types';
import { BASE_CASE, CASE_LEFT, CASE_RIGHT, CASE_TEXT, resolveCaseForTest } from '@/test/caseFixtures';
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
 * `playLabel`; the last Hint contains the Play_Label of the case's single
 * Required_Intervention (play-mode 9.8, bedside-exam 11.2, 11.3). Run once per
 * Resolved_Case through `perVariant`. The Side_Word rule for Hints 1 and 2
 * (11.1) is in `checkNoSideWords`.
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

  const required = play.endings?.rescued?.requiredInterventions ?? [];
  const last = hints[hints.length - 1];
  if (required.length !== 1) {
    failures.push(`${REQUIRED_PATH} has ${required.length} entries, expected exactly one`);
  } else {
    const requiredId = required[0];
    const playLabel = (c.interventions ?? []).find((i) => i.id === requiredId)?.playLabel;
    if (typeof playLabel !== 'string' || !/\S/.test(playLabel)) {
      failures.push(`the Required_Intervention "${requiredId}" has no Play_Label`);
    } else if (last) {
      const text = String(last.text ?? '');
      if (!text.toLowerCase().includes(playLabel.toLowerCase())) {
        failures.push(
          `last Hint "${text}" does not contain the Play_Label "${playLabel}" of the Required_Intervention "${requiredId}"`,
        );
      }
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

/**
 * Field paths added by the bedside-exam spec. Their TODO(author) marker must
 * contain `BEDSIDE_EXAM_MARK` instead of ending with the draft suffix
 * (bedside-exam 2.7, 8.4, 8.5).
 */
const BEDSIDE_EXAM_MARK = 'bedside-exam spec';
const BEDSIDE_EXAM_ITEM_PATTERNS: RegExp[] = [
  /^play\.hints\[\d+\]\.text$/,
  /^play\.sideRevealText$/,
  /^play\.exam\.actions\[\d+\]\.label$/,
  /^play\.exam\.actions\[\d+\]\.labels\.(Left|Right)$/,
  /^play\.exam\.actions\[\d+\]\.rules\[\d+\]\.sentence$/,
  /^play\.exam\.actions\[\d+\]\.defaultSentence$/,
  /^play\.exam\.actions\[\d+\]\.rules\[\d+\]\.when\.vitals$/,
  /^variants\[\d+\]\.overrides\.hints\[\d+\]\.text$/,
  /^variants\[\d+\]\.overrides\.sideRevealText$/,
];

/** Field paths that need a TODO(author) marker, besides every number in the Play_Section. */
const TEXT_ITEM_PATTERNS: RegExp[] = [
  ...BEDSIDE_EXAM_ITEM_PATTERNS,
  /^play\.status\.rules\[\d+\]\.sentence$/,
  /^play\.status\.defaultSentence$/,
  // Draft text values (author away): goal text, diagnosis terms.
  /^play\.goalText$/,
  /^play\.diagnosisTerms\[\d+\]$/,
];

/**
 * The `references` paths that cover a field path (play-mode 2.15,
 * bedside-exam 2.7 and 8.5). The item is exempt when any of them is non-empty.
 */
function coveringReferencesPaths(path: string): Array<Array<string | number>> {
  const hint = /^play\.hints\[(\d+)\]/.exec(path);
  if (hint) return [['play', 'hints', Number(hint[1]), 'references']];
  const ending = /^play\.endings\.(rescued|lost)\./.exec(path);
  if (ending) return [['play', 'endings', ending[1], 'references']];
  const examAction = /^play\.exam\.actions\[(\d+)\]/.exec(path);
  if (examAction) {
    return [
      ['play', 'exam', 'actions', Number(examAction[1]), 'references'],
      ['play', 'exam', 'references'],
    ];
  }
  if (path.startsWith('play.exam.')) return [['play', 'exam', 'references']];
  const variantHint = /^variants\[(\d+)\]\.overrides\.hints\[(\d+)\]/.exec(path);
  if (variantHint) {
    return [['variants', Number(variantHint[1]), 'overrides', 'hints', Number(variantHint[2]), 'references']];
  }
  if (path.startsWith('variants')) return [];
  return [['play', 'references']];
}

/**
 * Each `when.vitals` list of an Exam_Rule, positioned at its `vitals` key so
 * that the marker sits on the key line or the line directly above (8.4, 8.5).
 */
function collectWhenVitalsLists(examNode: unknown): ScalarItem[] {
  const out: ScalarItem[] = [];
  if (!isMap(examNode)) return out;
  const actions = examNode.get('actions', true);
  if (!isSeq(actions)) return out;
  actions.items.forEach((action, a) => {
    if (!isMap(action)) return;
    const rules = action.get('rules', true);
    if (!isSeq(rules)) return;
    rules.items.forEach((rule, r) => {
      if (!isMap(rule)) return;
      const when = rule.get('when', true);
      if (!isMap(when)) return;
      for (const pair of when.items) {
        if (isScalar(pair.key) && pair.key.value === 'vitals') {
          out.push({ path: `play.exam.actions[${a}].rules[${r}].when.vitals`, node: pair.key });
        }
      }
    });
  });
  return out;
}

/**
 * Every number in the Play_Section, every Hint text, every Status_Rule
 * sentence, the defaultSentence, the goal text, the diagnosis terms, every
 * Play_Label, and every item added by the bedside-exam spec (Variant Hint
 * texts and Side_Reveal_Texts, the Base_Case Side_Reveal_Text, Exam_Action
 * labels, Exam_Rule sentences, exam `defaultSentence`s and `when.vitals`
 * lists) has a comment containing `TODO(author)` on its source line or on a
 * comment-only line directly above, unless a covering `references` array is
 * non-empty. A marker on an item added by the bedside-exam spec must contain
 * "bedside-exam spec"; every other marker must end with the draft suffix.
 * `insultSide` and `requiredInterventions` inside `variants` need no marker
 * (bedside-exam 2.6).
 */
function checkTodoMarkers(doc: Document, lineCounter: LineCounter, lines: string[]): string[] {
  const playNode = doc.get('play', true);
  if (!isMap(playNode)) return [MISSING];

  const items = [
    ...collectScalars(playNode, 'play'),
    ...collectScalars(doc.get('variants', true), 'variants'),
  ].filter(
    ({ path, node }) =>
      typeof node.value === 'number' || TEXT_ITEM_PATTERNS.some((p) => p.test(path)),
  );
  items.push(...collectWhenVitalsLists(playNode.get('exam', true)));
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
    const covered = coveringReferencesPaths(path).some((refsPath) => {
      const refs = doc.getIn(refsPath, true);
      return isSeq(refs) && refs.items.length > 0;
    });
    if (covered) continue;

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
    } else if (BEDSIDE_EXAM_ITEM_PATTERNS.some((p) => p.test(path))) {
      if (!marker.includes(BEDSIDE_EXAM_MARK)) {
        failures.push(`${path} (line ${lineIdx + 1}) TODO(author) comment does not contain "${BEDSIDE_EXAM_MARK}"`);
      }
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

// ---------------------------------------------------------------------------
// Bedside exam: Variants and Resolved_Cases (Requirements 2, 10, 11, 12, 14.6, 14.7)
// ---------------------------------------------------------------------------

type BaseCase = typeof BASE_CASE;

/** One Resolved_Case with its Variant_Id. */
interface ResolvedEntry {
  id: string;
  data: CaseData;
}

const NO_VARIANTS = 'no variants to check';
const TENSION_ACTION = 'SETensionPneumothorax';
const NEEDLE_ACTION = 'SENeedleDecompression';
const OVERRIDE_KEYS = ['insultSide', 'requiredInterventions', 'hints', 'sideRevealText'] as const;
/** The `insultSide` and `requiredInterventions` of each shipped Variant (2.3, 2.4). */
const EXPECTED_VARIANT_VALUES: Record<string, { insultSide: Side; requiredInterventions: string[] }> = {
  left: { insultSide: 'Left', requiredInterventions: ['needle-decompression-left'] },
  right: { insultSide: 'Right', requiredInterventions: ['needle-decompression-right'] },
};
const NO_INSULT_SIDE = `timeline.scheduledInsults has no single Left or Right ${TENSION_ACTION} side`;

/** Each Variant's Resolved_Case, built with the test resolver (14.6), in file order. */
function resolveAll(base: BaseCase): ResolvedEntry[] {
  return (base.variants ?? []).map((v) => ({ id: v.id, data: resolveCaseForTest(base, v.id) }));
}

const RESOLVED = resolveAll(BASE_CASE);

/**
 * Runs `check` once per Resolved_Case and prefixes each failure with
 * `variant '<id>': `. An empty list fails with `no variants to check` (14.7).
 */
function perVariant(cases: ResolvedEntry[], check: (c: CaseData) => string[]): string[] {
  if (cases.length === 0) return [NO_VARIANTS];
  return cases.flatMap(({ id, data }) => check(data).map((f) => `variant '${id}': ${f}`));
}

/** The Side_Words ("left", "right" as whole words, case-insensitive) in a text, lower-cased, without repeats. */
function sideWordsIn(text: string): string[] {
  return [...new Set([...text.matchAll(/\b(left|right)\b/gi)].map((m) => m[1].toLowerCase()))];
}

/** The side of the case's `SETensionPneumothorax` Scheduled_Insults when they all name one Left or Right side. */
function insultSide(c: CaseData): Side | undefined {
  const sides = new Set(
    (c.timeline?.scheduledInsults ?? []).filter((i) => i.action === TENSION_ACTION).map((i) => i.parameters?.side),
  );
  if (sides.size !== 1) return undefined;
  const [side] = [...sides];
  return side === 'Left' || side === 'Right' ? side : undefined;
}

interface Difference {
  path: string;
  actual: unknown;
  expected: unknown;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** The leaf paths where `actual` and `expected` differ (deep equality, as `toEqual`). */
function differences(actual: unknown, expected: unknown, path: string, out: Difference[] = []): Difference[] {
  if (Object.is(actual, expected)) return out;
  if (Array.isArray(actual) && Array.isArray(expected) && actual.length === expected.length) {
    actual.forEach((v, i) => differences(v, expected[i], `${path}[${i}]`, out));
    return out;
  }
  if (isPlainObject(actual) && isPlainObject(expected)) {
    for (const key of new Set([...Object.keys(actual), ...Object.keys(expected)])) {
      differences(actual[key], expected[key], path ? `${path}.${key}` : key, out);
    }
    return out;
  }
  out.push({ path: path || '(root)', actual, expected });
  return out;
}

/** A short description of a differing value for a failure message. */
function describeValue(v: unknown): string {
  if (v === undefined) return 'absent';
  if (Array.isArray(v)) return `a list of ${v.length}`;
  if (isPlainObject(v)) return 'an object';
  return JSON.stringify(v);
}

/**
 * The Variants are `left` and `right` in that order; each sets all four
 * Variant_Overrides keys; `insultSide` and `requiredInterventions` hold the
 * values of 2.3 and 2.4 (2.1 to 2.4).
 */
function checkVariants(base: BaseCase): string[] {
  const variants = base.variants ?? [];
  if (variants.length === 0) return [NO_VARIANTS];
  const failures: string[] = [];
  const ids = variants.map((v) => v?.id);
  if (JSON.stringify(ids) !== JSON.stringify(['left', 'right'])) {
    failures.push(`variants are ${JSON.stringify(ids)}, expected ["left","right"]`);
  }
  for (const v of variants) {
    const overrides = v?.overrides ?? {};
    for (const key of OVERRIDE_KEYS) {
      if (overrides[key] === undefined) failures.push(`variant '${v.id}': overrides has no ${key}`);
    }
    const expected = EXPECTED_VARIANT_VALUES[v.id];
    if (!expected) continue;
    if (overrides.insultSide !== undefined && overrides.insultSide !== expected.insultSide) {
      failures.push(
        `variant '${v.id}': overrides.insultSide is ${JSON.stringify(overrides.insultSide)}, expected "${expected.insultSide}"`,
      );
    }
    if (
      overrides.requiredInterventions !== undefined &&
      JSON.stringify(overrides.requiredInterventions) !== JSON.stringify(expected.requiredInterventions)
    ) {
      failures.push(
        `variant '${v.id}': overrides.requiredInterventions is ${JSON.stringify(overrides.requiredInterventions)}, expected ${JSON.stringify(expected.requiredInterventions)}`,
      );
    }
  }
  return failures;
}

/** The `left` Resolved_Case deep-equals the Base_Case without `variants` (2.5). */
function checkLeftEqualsBase(base: BaseCase): string[] {
  const variants = base.variants ?? [];
  if (variants.length === 0) return [NO_VARIANTS];
  if (!variants.some((v) => v?.id === 'left')) return ["no variant 'left' to compare"];
  const baseWithout = structuredClone(base);
  delete baseWithout.variants;
  return differences(resolveCaseForTest(base, 'left'), baseWithout, '').map(
    (d) =>
      `variant 'left': ${d.path} is ${describeValue(d.actual)}, ${describeValue(d.expected)} in the Base_Case without variants`,
  );
}

/**
 * The `variants` key has, on its line or the line directly above, a comment
 * stating that the side variants and their `insultSide` and
 * `requiredInterventions` values are the author's game-rule decision recorded
 * in the bedside-exam spec; `insultSide` and `requiredInterventions` inside
 * the Variants carry no `TODO(author)` marker (2.6).
 */
function checkVariantsDecision(doc: Document, lineCounter: LineCounter, lines: string[]): string[] {
  const root = doc.contents;
  if (!isMap(root)) return ['the case is not a map'];
  const pair = root.items.find((p) => isScalar(p.key) && p.key.value === 'variants');
  if (!pair || !isScalar(pair.key)) return ['variants is missing'];
  const keyStart = pair.key.range?.[0];
  if (keyStart === undefined) return ['variants has no source position'];
  const lineIdx = lineCounter.linePos(keyStart).line - 1;
  const failures: string[] = [];
  const decision = commentsAround(lines, lineIdx).some(
    (cm) =>
      /author's game-rule decision/i.test(cm) &&
      cm.includes(BEDSIDE_EXAM_MARK) &&
      /side variants/i.test(cm) &&
      cm.includes('insultSide') &&
      cm.includes('requiredInterventions'),
  );
  if (!decision) {
    failures.push(
      `variants (line ${lineIdx + 1}) has no comment stating the author's game-rule decision recorded in the bedside-exam spec on its line or the line directly above`,
    );
  }
  const seq = pair.value;
  if (!isSeq(seq) || seq.items.length === 0) return [...failures, NO_VARIANTS];
  seq.items.forEach((variant, v) => {
    const overrides = isMap(variant) ? variant.get('overrides', true) : undefined;
    if (!isMap(overrides)) return;
    for (const p of overrides.items) {
      if (!isScalar(p.key)) continue;
      const key = String(p.key.value);
      if (key !== 'insultSide' && key !== 'requiredInterventions') continue;
      const start = p.key.range?.[0];
      if (start === undefined) {
        failures.push(`variants[${v}].overrides.${key} has no source position`);
        continue;
      }
      const idx = lineCounter.linePos(start).line - 1;
      if (commentsAround(lines, idx).some((cm) => cm.includes('TODO(author)'))) {
        failures.push(`variants[${v}].overrides.${key} (line ${idx + 1}) carries a TODO(author) marker`);
      }
    }
  });
  return failures;
}

/** Each needle Required_Intervention's `side` equals the `SETensionPneumothorax` insult side (2.8). */
function checkNeedleSideMatchesInsult(c: CaseData): string[] {
  const play = c.play;
  if (!play) return [MISSING];
  const side = insultSide(c);
  if (!side) return [NO_INSULT_SIDE];
  const failures: string[] = [];
  (play.endings?.rescued?.requiredInterventions ?? []).forEach((id, i) => {
    const intervention = (c.interventions ?? []).find((x) => x.id === id);
    if (!intervention || intervention.action !== NEEDLE_ACTION) return;
    if (interventionSide(intervention) !== side) {
      failures.push(
        `${REQUIRED_PATH}[${i}] "${id}" has side "${String(intervention.parameters?.side)}", expected the insultSide "${side}"`,
      );
    }
  });
  return failures;
}

/**
 * No Side_Word in any Status_Rule sentence, the status `defaultSentence`, the
 * Goal_Text, or any Hint before the last (10.1, 10.2, 11.1).
 */
function checkNoSideWords(c: CaseData): string[] {
  const play = c.play;
  if (!play) return [MISSING];
  const texts: Array<{ path: string; text: unknown }> = [
    ...(play.status?.rules ?? []).map((r, i) => ({ path: `play.status.rules[${i}].sentence`, text: r?.sentence })),
    { path: 'play.status.defaultSentence', text: play.status?.defaultSentence },
    { path: 'play.goalText', text: play.goalText },
    ...(play.hints ?? []).slice(0, -1).map((h, i) => ({ path: `play.hints[${i}].text`, text: h?.text })),
  ];
  const failures: string[] = [];
  for (const { path, text } of texts) {
    if (typeof text !== 'string') {
      failures.push(`${path} is not a string`);
      continue;
    }
    for (const word of sideWordsIn(text)) failures.push(`${path} "${text}" contains Side_Word "${word}"`);
  }
  return failures;
}

/**
 * The `sideRevealText` contains the Side_Word of the insult side and not the
 * other Side_Word (12.4), and no Diagnosis_Term by case-insensitive substring
 * match (12.5).
 */
function checkSideRevealText(c: CaseData): string[] {
  const play = c.play;
  if (!play) return [MISSING];
  const text = play.sideRevealText;
  if (typeof text !== 'string') return ['play.sideRevealText is missing'];
  const side = insultSide(c);
  if (!side) return [NO_INSULT_SIDE];
  const own = side.toLowerCase();
  const other = side === 'Left' ? 'right' : 'left';
  const words = sideWordsIn(text);
  const failures: string[] = [];
  if (!words.includes(own)) {
    failures.push(`play.sideRevealText "${text}" does not contain the Side_Word "${own}" of the insultSide "${side}"`);
  }
  if (words.includes(other)) failures.push(`play.sideRevealText "${text}" contains the other Side_Word "${other}"`);
  const terms = (play.diagnosisTerms ?? []).filter((t) => typeof t === 'string' && t.length > 0);
  if (terms.length === 0) failures.push('play.diagnosisTerms is empty');
  for (const term of terms) {
    if (text.toLowerCase().includes(term.toLowerCase())) {
      failures.push(`play.sideRevealText "${text}" contains Diagnosis_Term "${term}"`);
    }
  }
  return failures;
}

/** A copy of a Resolved_Case without the four Override_Targets. */
function withoutOverrideTargets(c: CaseData): unknown {
  const copy = structuredClone(c);
  for (const insult of copy.timeline?.scheduledInsults ?? []) {
    if (insult.action === TENSION_ACTION) delete insult.parameters.side;
  }
  const play: Partial<PlaySection> | undefined = copy.play;
  if (play) {
    delete play.hints;
    delete play.sideRevealText;
    if (play.endings?.rescued) delete play.endings.rescued.requiredInterventions;
  }
  return copy;
}

/** Every field outside the four Override_Targets is equal in all Resolved_Cases (10.3). */
function checkSharedFieldsEqual(cases: ResolvedEntry[]): string[] {
  if (cases.length === 0) return [NO_VARIANTS];
  const [first, ...rest] = cases;
  const reference = withoutOverrideTargets(first.data);
  return rest.flatMap(({ id, data }) =>
    differences(withoutOverrideTargets(data), reference, '').map(
      (d) => `variant '${id}': ${d.path} is ${describeValue(d.actual)}, ${describeValue(d.expected)} in variant '${first.id}'`,
    ),
  );
}

/** The Hints before the last are equal in all Resolved_Cases (11.4). */
function checkEarlyHintsShared(cases: ResolvedEntry[]): string[] {
  if (cases.length === 0) return [NO_VARIANTS];
  const early = (c: CaseData) => (c.play?.hints ?? []).slice(0, -1);
  const [first, ...rest] = cases;
  return rest.flatMap(({ id, data }) =>
    differences(early(data), early(first.data), 'play.hints').map(
      (d) => `variant '${id}': ${d.path} is ${describeValue(d.actual)}, ${describeValue(d.expected)} in variant '${first.id}'`,
    ),
  );
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

  it('each Play_Label differs from its label and names its own side', () => {
    expect(checkPlayLabels(PARSED.data)).toEqual([]);
  });

  it('every number, sentence and draft text has a TODO(author) marker ending with the draft suffix, and every bedside-exam item has one naming the bedside-exam spec', () => {
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

  it('names the Variant Hint whose TODO(author) marker is missing (bedside-exam 2.7)', () => {
    const marker =
      '        # TODO(author): hint 2 text, right variant (compare both sides) - draft from the bedside-exam spec, pending author review; cite a source (candidate: ATLS 10th ed., verify)\n';
    expect(CASE_TEXT).toContain(marker);
    const parsed = parseCase(CASE_TEXT.replace(marker, ''));
    const failures = checkTodoMarkers(parsed.doc, parsed.lineCounter, parsed.lines);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain('variants[1].overrides.hints[1].text');
    expect(failures[0]).toContain('has no TODO(author) comment');
  });

  it('names the bedside-exam item whose TODO(author) marker does not name the bedside-exam spec, and honours the Exam_Action references (8.5)', () => {
    const marker =
      '          # TODO(author): exam button label, left - draft from the bedside-exam spec, pending author review\n';
    expect(CASE_TEXT).toContain(marker);
    const parsed = parseCase(
      CASE_TEXT.replace(marker, '          # TODO(author): exam button label, left - pending author review\n'),
    );
    const failures = checkTodoMarkers(parsed.doc, parsed.lineCounter, parsed.lines);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain('play.exam.actions[1].labels.Left');
    expect(failures[0]).toContain('does not contain "bedside-exam spec"');

    const listen = parsed.doc.getIn(['play', 'exam', 'actions', 1], true);
    if (!isMap(listen)) throw new Error('play.exam.actions[1] is not a map');
    listen.set('references', parsed.doc.createNode(['A citation']));
    expect(checkTodoMarkers(parsed.doc, parsed.lineCounter, parsed.lines)).toEqual([]);
  });
});

// Feature: bedside-exam, Property 3: Both shipped Variants resolve and validate, and the left Variant equals the Base_Case
// Vitest half, example-based, through the independent test resolver (D7). Schema validation stays in pytest.
describe('Property 3: both shipped Variants resolve, and the left Variant equals the Base_Case', () => {
  it('the Base_Case has two variants and a non-empty play.exam.actions, so no per-Variant check passes on an empty list (14.7)', () => {
    expect(BASE_CASE.variants).toHaveLength(2);
    expect(RESOLVED).toHaveLength(2);
    expect(RESOLVED.map((r) => r.data)).toEqual([CASE_LEFT, CASE_RIGHT]);
    expect(BASE_CASE.play?.exam?.actions.length ?? 0).toBeGreaterThan(0);
  });

  it('the Variants are left and right in that order, and each sets all four keys with the values of 2.3 and 2.4 (2.1 to 2.4)', () => {
    expect(checkVariants(BASE_CASE)).toEqual([]);
  });

  it('the left Resolved_Case deep-equals the Base_Case without variants (2.5)', () => {
    expect(checkLeftEqualsBase(BASE_CASE)).toEqual([]);
  });

  it('the variants key carries the game-rule decision comment, and insultSide and requiredInterventions carry no TODO(author) (2.6)', () => {
    expect(checkVariantsDecision(PARSED.doc, PARSED.lineCounter, PARSED.lines)).toEqual([]);
  });

  it('per Resolved_Case, every requiredInterventions id names an Intervention, and each needle Required_Intervention side equals the insultSide (2.8)', () => {
    expect(perVariant(RESOLVED, checkRequiredInterventionsExist)).toEqual([]);
    expect(perVariant(RESOLVED, checkNeedleSideMatchesInsult)).toEqual([]);
  });
});

// Feature: bedside-exam, Property 18: The shipped case names no side early and no diagnosis in its exam and reveal text
// Hints, Status, Goal and Side_Reveal_Text rules (example-based).
describe('Property 18: the shipped case names no side early (Hints, Status, Goal, Side_Reveal_Text)', () => {
  it('per Resolved_Case, has exactly 3 Hints; only the last names an Intervention, and it names the Play_Label of the single Required_Intervention (11.2, 11.3)', () => {
    expect(perVariant(RESOLVED, checkHints)).toEqual([]);
  });

  it('per Resolved_Case, no Side_Word in a Status_Rule sentence, the status defaultSentence, the Goal_Text or Hints 1 and 2 (10.1, 10.2, 11.1)', () => {
    expect(perVariant(RESOLVED, checkNoSideWords)).toEqual([]);
  });

  it('every field outside the four Override_Targets is equal in both Resolved_Cases (10.3)', () => {
    expect(checkSharedFieldsEqual(RESOLVED)).toEqual([]);
  });

  it('Hints 1 and 2 are equal in both Variants (11.4)', () => {
    expect(checkEarlyHintsShared(RESOLVED)).toEqual([]);
  });

  it('per Resolved_Case, the sideRevealText holds only its own Side_Word and no Diagnosis_Term (12.4, 12.5)', () => {
    expect(perVariant(RESOLVED, checkSideRevealText)).toEqual([]);
  });
});

describe('per-Variant checkers on broken copies', () => {
  const BROKEN_LEFT_NEEDLE_HINT = 'His right side is the quiet one. Press "Let the trapped air out - left side (needle)".';

  it('every per-Variant check fails with "no variants to check" on an empty list (14.7)', () => {
    const noVariants = structuredClone(BASE_CASE);
    noVariants.variants = [];
    expect(resolveAll(noVariants)).toEqual([]);
    for (const check of [checkHints, checkNoSideWords, checkSideRevealText, checkNeedleSideMatchesInsult, checkRequiredInterventionsExist]) {
      expect(perVariant(resolveAll(noVariants), check), check.name).toEqual([NO_VARIANTS]);
    }
    expect(checkVariants(noVariants)).toEqual([NO_VARIANTS]);
    expect(checkLeftEqualsBase(noVariants)).toEqual([NO_VARIANTS]);
    expect(checkSharedFieldsEqual([])).toEqual([NO_VARIANTS]);
    expect(checkEarlyHintsShared([])).toEqual([NO_VARIANTS]);
  });

  it("names the Variant whose overrides miss a key (2.2)", () => {
    const b = structuredClone(BASE_CASE);
    delete b.variants![1].overrides.sideRevealText;
    expect(checkVariants(b)).toEqual(["variant 'right': overrides has no sideRevealText"]);
  });

  it('names the field where the left Resolved_Case differs from the Base_Case (2.5)', () => {
    const b = structuredClone(BASE_CASE);
    b.play!.sideRevealText = 'The trapped air was in his chest.';
    expect(checkLeftEqualsBase(b)).toEqual([
      `variant 'left': play.sideRevealText is "The trapped air was in the left side of his chest.", "The trapped air was in his chest." in the Base_Case without variants`,
    ]);
  });

  it('fails without the game-rule decision comment, or with a TODO(author) marker on insultSide (2.6)', () => {
    const decision = PARSED.lines.find((l) => l.startsWith("# Author's game-rule decision"));
    expect(decision).toBeDefined();
    const variantsLine = PARSED.lines.indexOf('variants:');
    expect(variantsLine).toBeGreaterThan(0);
    const check = (text: string) => {
      const p = parseCase(text);
      return checkVariantsDecision(p.doc, p.lineCounter, p.lines);
    };
    // Removing the comment line moves `variants:` up one line, to line number `variantsLine`.
    expect(check(CASE_TEXT.replace(`${decision}\n`, ''))).toEqual([
      `variants (line ${variantsLine}) has no comment stating the author's game-rule decision recorded in the bedside-exam spec on its line or the line directly above`,
    ]);

    const sideLine = '      insultSide: Right';
    expect(PARSED.lines).toContain(sideLine);
    expect(check(CASE_TEXT.replace(sideLine, `${sideLine} # TODO(author): check the side`))).toEqual([
      `variants[1].overrides.insultSide (line ${PARSED.lines.indexOf(sideLine) + 1}) carries a TODO(author) marker`,
    ]);
  });

  it('names the needle Required_Intervention whose side differs from the insultSide (2.8)', () => {
    const b = structuredClone(BASE_CASE);
    b.variants![1].overrides.requiredInterventions = ['needle-decompression-left'];
    expect(perVariant(resolveAll(b), checkNeedleSideMatchesInsult)).toEqual([
      `variant 'right': play.endings.rescued.requiredInterventions[0] "needle-decompression-left" has side "Left", expected the insultSide "Right"`,
    ]);
  });

  it("names the right Variant's last Hint that names the left Play_Label (11.3)", () => {
    const b = structuredClone(BASE_CASE);
    b.variants![1].overrides.hints![2] = { text: BROKEN_LEFT_NEEDLE_HINT };
    expect(perVariant(resolveAll(b), checkHints)).toEqual([
      `variant 'right': last Hint "${BROKEN_LEFT_NEEDLE_HINT}" does not contain the Play_Label "Let the trapped air out - right side (needle)" of the Required_Intervention "needle-decompression-right"`,
    ]);
  });

  it('names the defaultSentence that contains a Side_Word, once per Variant (10.1)', () => {
    const b = structuredClone(BASE_CASE);
    b.play!.status.defaultSentence = 'He is breathing calmly on his left side.';
    expect(perVariant(resolveAll(b), checkNoSideWords)).toEqual([
      `variant 'left': play.status.defaultSentence "He is breathing calmly on his left side." contains Side_Word "left"`,
      `variant 'right': play.status.defaultSentence "He is breathing calmly on his left side." contains Side_Word "left"`,
    ]);
  });

  it('names the shared field that differs between the Resolved_Cases (10.3)', () => {
    const right = structuredClone(CASE_RIGHT);
    right.title = 'Another title';
    expect(checkSharedFieldsEqual([{ id: 'left', data: CASE_LEFT }, { id: 'right', data: right }])).toEqual([
      `variant 'right': title is "Another title", ${JSON.stringify(CASE_LEFT.title)} in variant 'left'`,
    ]);
  });

  it('names the early Hint that differs between the Variants (11.4)', () => {
    const b = structuredClone(BASE_CASE);
    b.variants![1].overrides.hints![1] = { text: 'Listen to his chest.' };
    expect(checkEarlyHintsShared(resolveAll(b))).toEqual([
      `variant 'right': play.hints[1].text is "Listen to his chest.", "Listen to both sides of his chest. Is one side quieter than the other?" in variant 'left'`,
    ]);
  });

  it('names the sideRevealText with the wrong Side_Word or a Diagnosis_Term (12.4, 12.5)', () => {
    const wrongSide = structuredClone(BASE_CASE);
    const leftText = 'The trapped air was in the left side of his chest.';
    wrongSide.variants![1].overrides.sideRevealText = leftText;
    expect(perVariant(resolveAll(wrongSide), checkSideRevealText)).toEqual([
      `variant 'right': play.sideRevealText "${leftText}" does not contain the Side_Word "right" of the insultSide "Right"`,
      `variant 'right': play.sideRevealText "${leftText}" contains the other Side_Word "left"`,
    ]);

    const diagnosis = structuredClone(BASE_CASE);
    const tensionText = 'The tension was in the left side of his chest.';
    diagnosis.variants![0].overrides.sideRevealText = tensionText;
    expect(perVariant(resolveAll(diagnosis), checkSideRevealText)).toEqual([
      `variant 'left': play.sideRevealText "${tensionText}" contains Diagnosis_Term "tension"`,
    ]);
  });
});
