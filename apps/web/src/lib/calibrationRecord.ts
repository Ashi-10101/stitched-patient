/**
 * Calibration_Record and Calibration_Index (engine-mcp design, "`calibrationRecord.ts`",
 * "Record_Header", "Record_Body layout", "Calibration_Index" and the Error Handling section
 * "Record writer").
 *
 * - The Record_Header holds the run facts of 9.1: date, commit, Git answers, Service_URL, speeds,
 *   Session_Cap and the two Decompression times. It is the only part with a date, a commit or a URL.
 * - The Record_Body renders a `CalibrationEvaluation` (9.2 to 9.13). It holds no session_id,
 *   branch_id, checkpoint_id, wall-clock value, date, commit or Service_URL, and renders vital sign
 *   values with `DECIMALS` (12.1, 12.2).
 * - The record holds only the fixed texts below, engine numbers, case values, and Status_Sentences,
 *   Exam_Finding sentences and Check bases as the Resolved_Case and `calibration.ts` hold them (9.13).
 * - `writeCalibrationRecord` writes only under `<repoRoot>/docs/calibration/`, never overwrites a
 *   record, and appends one Calibration_Index line (10.2 to 10.5).
 *
 * This module imports no `node:` module, no SDK and no `zod`, and uses no global clock or file
 * system (D17). The date and the Git facts come in through `RecordHeader`; file access goes through
 * the injected `RecordFs`.
 */

import {
  DECOMPRESSION_CHECK_COMMIT,
  SCENARIO_KINDS,
  type CalibrationEvaluation,
  type ScenarioKind,
  type VariantEvaluation,
} from './engineCalibration';
import { EngineError } from './engineClient';
import type { Sample } from './endingEvaluator';
import {
  APPROACH_SPEED,
  APPROACH_WINDOW_S,
  RUN_SPEED,
  type EndingTimelineJson,
  type GateJson,
  type MarkRow,
  type PlayValuesJson,
  type ScenarioResult,
} from './engineRunner';
import { thresholdsFor } from './vitalBands';
import { VITAL_FIELD, VITAL_NAMES, type VitalName } from './vitals';
import type { Side, VitalCondition, VitalSigns } from '@/types';

// ---------------------------------------------------------------------------
// Types and fixed texts
// ---------------------------------------------------------------------------

export interface GitInfo {
  shortSha: string | 'unknown';
  casesDirty: boolean | 'unknown';
  libDirty: boolean | 'unknown';
  has1e71454: boolean | 'unknown';
}

export interface RecordHeader {
  caseId: string;
  date: string /* YYYY-MM-DD, host local time */;
  git: GitInfo;
  serviceUrl: string;
  sessionCap: number;
  demoTime: number;
  earlyTime: number;
}

/** Equal to SAFETY_NOTICE_TEXT of `components/SafetyNotice.tsx` (test-checked). */
export const SAFETY_NOTICE = 'Educational simulation, not for clinical use';
export const NOT_ADVICE = 'Engine results for draft case values. Not clinical advice.';
export const NOT_CALIBRATED_LINE = 'Play_Section values NOT calibrated';
export const ALL_PASSED_LINE =
  'All calibration checks passed. The author reviews the values and their citations before removing any TODO(author) marker.';

/** Fixed decimals per field (12.2): rates and pressures 1, spo2 3, tidal_volume 0, times 0. */
export const DECIMALS: Readonly<Record<keyof VitalSigns, number>> = {
  simulation_time: 0,
  heart_rate: 1,
  respiratory_rate: 1,
  spo2: 3,
  mean_arterial_pressure: 1,
  systolic_pressure: 1,
  diastolic_pressure: 1,
  etco2: 1,
  tidal_volume: 0,
};

/** D23 rule, as the design states it. */
const D23_RULE =
  "In the `affected-side-early` Scenario, the tension pneumothorax counts as developing when at one or more Mark_Samples after the insult's `timeSeconds`, at least one vital sign with Case thresholds has an Alarm_State more severe (`normal < warning < critical`) than its Alarm_State at the last Mark_Sample at or before `timeSeconds`.";

/** 9.6 open-question sentence. */
const OPEN_QUESTION_LINE = "The early Scenario's Ending is not evidence for play-mode open question 1, item d.";

const PLAYBACK_LINE = `Playback speed: ${RUN_SPEED}, ${APPROACH_SPEED} within ${APPROACH_WINDOW_S} s before each Decompression; the speed affects wall-clock time only`;

const CALIBRATION_DIR = 'docs/calibration';
const INDEX_FILE = 'README.md';
const INDEX_TITLE = '# Calibration records';
/** Largest suffix tried before the writer gives up (Error Handling, "Record writer"). */
const MAX_RECORD_SUFFIX = 99;
const NAME_PATTERN = /^[A-Za-z0-9._-]+$/;

/** Numeric VitalSigns fields, in the order of the `VitalSigns` type (9.10). */
const NUMERIC_VITAL_FIELDS = [
  'heart_rate',
  'respiratory_rate',
  'spo2',
  'mean_arterial_pressure',
  'systolic_pressure',
  'diastolic_pressure',
  'etco2',
  'tidal_volume',
] as const satisfies readonly Exclude<keyof VitalSigns, 'simulation_time'>[];

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function fixed(value: number, decimals: number): string {
  const text = value.toFixed(decimals);
  // -0.0 and similar come from tiny negative values; they read as 0.
  return /^-0(\.0+)?$/.test(text) ? text.slice(1) : text;
}

/** A vital sign value with the decimals of its field, or `n/a`. */
function vitalText(field: keyof VitalSigns, value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? fixed(value, DECIMALS[field]) : 'n/a';
}

/** A Simulation_Time in whole seconds. */
function timeText(t: number): string {
  return Number.isFinite(t) ? fixed(t, DECIMALS.simulation_time) : 'n/a';
}

function timesText(ts: readonly number[], empty: string): string {
  return ts.length === 0 ? empty : ts.map(timeText).join(', ');
}

/** Table cell: a `|` is escaped as `\|`; the text is not otherwise changed. */
function cell(text: string): string {
  return text.replace(/\|/g, '\\|');
}

function row(cells: readonly string[]): string {
  return `| ${cells.join(' | ')} |`;
}

function table(headings: readonly string[], rows: readonly (readonly string[])[]): string {
  return [row(headings), row(headings.map(() => '---')), ...rows.map(row)].join('\n');
}

function yesNoUnknown(x: boolean | 'unknown'): string {
  return x === 'unknown' ? 'unknown' : x ? 'yes' : 'no';
}

function scenarioTitle(variantId: string, kind: ScenarioKind): string {
  return `\`${variantId}\` / ${kind}`;
}

/** "affected side", "other side", or `n/a` for no side (9.2). */
function sideWords(side: Side | null | undefined, affected: Side): string {
  if (side === null || side === undefined) return 'n/a';
  return side === affected ? 'affected side' : 'other side';
}

function conditionText(c: VitalCondition): string {
  return `${c.vital} ${c.op} ${String(c.value)}`;
}

function conditionsText(cs: readonly VitalCondition[]): string {
  return cs.length === 0 ? 'none' : cs.map(conditionText).join('; ');
}

function gateText(g: GateJson): string {
  if (g === null) return 'closed';
  if (g === 'no-required-interventions') return 'open from the start (no Required_Interventions)';
  return `${timeText(g)} s`;
}

function endingText(e: EndingTimelineJson): string {
  switch (e.ending) {
    case 'rescued':
      return `rescued at ${timeText(e.first_time)} s`;
    case 'lost': {
      const cause = e.lost_cause === 'Time_Limit' ? 'Time_Limit' : `Lost_Condition group ${e.lost_cause}`;
      return `lost at ${timeText(e.first_time)} s (cause: ${cause})`;
    }
    case 'none':
      return `stayed none up to ${timeText(e.until)} s`;
  }
}

/** Vitals referenced by a Rescue_Condition or a Lost_Condition, VITAL_NAMES order (9.4). */
function referencedVitals(play: PlayValuesJson | null): VitalName[] {
  if (play === null) return [];
  const used = new Set<VitalName>();
  for (const c of play.rescue.conditions) used.add(c.vital);
  for (const g of play.lost_groups) for (const c of g.conditions) used.add(c.vital);
  return VITAL_NAMES.filter((v) => used.has(v));
}

function markVital(m: MarkRow, vital: VitalName): string {
  const field = VITAL_FIELD[vital];
  return vitalText(field, (m.vitals as Partial<VitalSigns>)[field]);
}

function sampleVital(s: Sample, vital: VitalName): string {
  const field = VITAL_FIELD[vital];
  return vitalText(field, (s as Partial<VitalSigns>)[field]);
}

// ---------------------------------------------------------------------------
// Record_Header (9.1)
// ---------------------------------------------------------------------------

export function renderRecordHeader(h: RecordHeader): string {
  return [
    `# Calibration record: ${h.caseId}`,
    '',
    `> ${SAFETY_NOTICE}`,
    '',
    NOT_ADVICE,
    '',
    `- Date: ${h.date}`,
    `- Commit: ${h.git.shortSha}`,
    `- Files under cases/ differ from the commit: ${yesNoUnknown(h.git.casesDirty)}`,
    `- Files under apps/web/src/lib/ differ from the commit: ${yesNoUnknown(h.git.libDirty)}`,
    `- Commit ${DECOMPRESSION_CHECK_COMMIT} is an ancestor of the commit: ${yesNoUnknown(h.git.has1e71454)}`,
    `- Service_URL: ${h.serviceUrl}`,
    `- ${PLAYBACK_LINE}`,
    `- Session_Cap: ${h.sessionCap}`,
    `- Demo_Decompression_Time: ${h.demoTime} s`,
    `- Early_Decompression_Time: ${h.earlyTime} s`,
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Record_Body (9.2 to 9.13, 12.1, 12.2)
// ---------------------------------------------------------------------------

function resultSection(e: CalibrationEvaluation): string {
  const blocks = ['## Result'];
  if (e.calibrated) {
    blocks.push(ALL_PASSED_LINE);
  } else {
    const lines = [NOT_CALIBRATED_LINE];
    for (const f of e.failing) {
      const at = f.scenario.indexOf(' / ');
      const name = at < 0 ? f.scenario : `\`${f.scenario.slice(0, at)}\`${f.scenario.slice(at)}`;
      lines.push(`- ${name}: ${f.check} failed: ${f.outcome}`);
    }
    blocks.push(lines.join('\n'));
  }
  const flagged = e.variants.filter((v) => v.early.flagRequirement418).map((v) => v.variantId);
  const flag =
    flagged.length > 0
      ? `play-mode Requirement 4.18 flagged for revision: the early Decompression prevented the tension pneumothorax in Variant(s) ${flagged.join(', ')}`
      : 'not raised';
  blocks.push(`Requirement 4.18 flag: ${flag}`);
  return blocks.join('\n\n');
}

function playValuesTable(play: PlayValuesJson): string {
  const rows: string[][] = [
    ['Rescue_Conditions', conditionsText(play.rescue.conditions)],
    ['Rescue Hold_Duration', `${timeText(play.rescue.hold_seconds)} s`],
  ];
  play.lost_groups.forEach((g, i) => {
    rows.push([`Lost_Condition group ${i + 1}`, conditionsText(g.conditions)]);
    rows.push([`Lost_Condition group ${i + 1} Hold_Duration`, `${timeText(g.hold_seconds)} s`]);
  });
  rows.push(['Time_Limit', play.time_limit_seconds === null ? 'n/a' : `${timeText(play.time_limit_seconds)} s`]);
  rows.push([
    'Required_Interventions',
    play.rescue.required_interventions.length === 0 ? 'none' : play.rescue.required_interventions.join(', '),
  ]);
  return table(['Item', 'Value'], rows);
}

const CHECK_KIND: Readonly<Record<string, ScenarioKind>> = {
  'affected-side-rescued': 'affected-side',
  'other-side-only-lost': 'other-side-only',
  'no-intervention-lost': 'no-intervention',
};

function checksTable(v: VariantEvaluation): string {
  return table(
    ['Check', 'Scenario', 'Result', 'Basis'],
    v.checks.map((c) => [
      c.check,
      scenarioTitle(v.variantId, CHECK_KIND[c.check]),
      c.pass ? 'pass' : 'fail',
      cell(c.basis),
    ]),
  );
}

/** Side of a calibration Scenario's Decompression, by Scenario_Kind (8.4 chooses it by side). */
function kindSideWords(kind: ScenarioKind): string {
  if (kind === 'affected-side' || kind === 'affected-side-early') return 'affected side';
  if (kind === 'other-side-only') return 'other side';
  return 'n/a';
}

function scenarioSection(v: VariantEvaluation, kind: ScenarioKind): string {
  const r: ScenarioResult = v.scenarios[kind];
  const blocks = [`### Scenario ${scenarioTitle(v.variantId, kind)}`];

  // 9.4: Requested_Time, Actual_Time and Late flag of each Decompression.
  if (r.interventions.length === 0) {
    blocks.push('Interventions: none');
  } else {
    blocks.push('Interventions:');
    blocks.push(
      table(
        ['Intervention', 'Side', 'Requested_Time (s)', 'Actual_Time (s)', 'Late'],
        r.interventions.map((i) => [
          i.intervention_id,
          kindSideWords(kind),
          timeText(i.requested_time),
          timeText(i.actual_time),
          i.late ? 'yes' : 'no',
        ]),
      ),
    );
  }
  blocks.push(`Rescue_Gate_Time: ${gateText(r.rescue_gate_time)}`);
  blocks.push(`Ending: ${endingText(r.ending)}`);

  // 9.4, 9.8: Mark_Samples with the referenced vitals, Overall_Status and Ending.
  const vitals = referencedVitals(r.play_values ?? v.play);
  blocks.push('#### Vital signs');
  blocks.push(
    table(
      ['Time (s)', 'Substituted', ...vitals, 'Overall_Status', 'Ending'],
      r.marks.map((m) => [
        timeText(m.time),
        m.substituted ? `yes (${timeText(m.source_time)} s)` : 'no',
        ...vitals.map((vital) => markVital(m, vital)),
        m.overall_status,
        m.ending,
      ]),
    ),
  );

  // 9.8: Vital_Bands at Simulation_Time 0.
  const first = r.marks.find((m) => m.time === 0);
  blocks.push('#### Vital_Bands at Simulation_Time 0');
  blocks.push(
    table(
      ['Vital', 'Alarm_State', 'Direction'],
      first === undefined
        ? []
        : VITAL_NAMES.flatMap((vital) => {
            const band = first.bands[vital];
            return band === undefined ? [] : [[vital, band.state, band.direction]];
          }),
    ),
  );

  // 9.8: Status_Rules that matched, or only the defaultSentence.
  blocks.push('#### Status_Rules');
  const sr = r.status_rules;
  if (sr.rules.length > 0 || !sr.only_default) {
    blocks.push(
      table(
        ['Rule', 'Sentence', 'Matched at (s)', 'Returned at (s)'],
        sr.rules.map((rule) => [
          `play.status.rules[${rule.index}]`,
          cell(rule.sentence),
          timesText(rule.matched_at, 'never'),
          timesText(rule.returned_at, 'never'),
        ]),
      ),
    );
  }
  if (sr.only_default && sr.default_sentence !== null) {
    blocks.push(`Only the defaultSentence was returned: "${sr.default_sentence}"`);
  }

  // 9.9: Exam_Findings per Exam_Button and per Mark_Sample.
  blocks.push('#### Exam_Findings');
  blocks.push(
    table(
      ['Exam_Button', 'Side', 'First Abnormal_Finding (s)'],
      r.first_abnormal.map((f) => [
        f.action_id,
        sideWords(f.side, v.affectedSide),
        f.first_at === null ? 'never' : timeText(f.first_at),
      ]),
    ),
  );
  const buttons = r.marks.length > 0 ? r.marks[0].exam : [];
  if (buttons.length > 0) {
    blocks.push(
      table(
        [
          'Time (s)',
          ...buttons.map((b) => (b.side === null ? b.action_id : `${b.action_id} (${sideWords(b.side, v.affectedSide)})`)),
        ],
        r.marks.map((m) => [
          timeText(m.time),
          ...buttons.map((b) => {
            const x = m.exam.find((e) => e.action_id === b.action_id && e.side === b.side);
            if (x === undefined) return 'n/a';
            return cell(x.abnormal ? `**abnormal:** ${x.sentence}` : x.sentence);
          }),
        ]),
      ),
    );
  }
  return blocks.join('\n\n');
}

function earlySection(v: VariantEvaluation): string {
  const early = v.scenarios['affected-side-early'];
  const vitals = VITAL_NAMES.filter((vital) => thresholdsFor(early.alarm_thresholds, vital) !== undefined);
  const headings = ['Time (s)', ...vitals.flatMap((vital) => [`${vital} early`, `${vital} none`])];
  const rows = v.early.rows.map((x) => [
    timeText(x.time),
    ...vitals.flatMap((vital) => [sampleVital(x.early, vital), sampleVital(x.none, vital)]),
  ]);
  const develops =
    v.early.develops && v.early.firstWorseAt !== null
      ? `yes, first at ${timeText(v.early.firstWorseAt)} s (${v.early.worseVital ?? 'n/a'})`
      : 'no';
  return [
    '### Early Decompression compared with no intervention',
    table(headings, rows),
    `Rule: ${D23_RULE}`,
    `The tension pneumothorax still develops after the early Decompression: ${develops}`,
    OPEN_QUESTION_LINE,
  ].join('\n\n');
}

function variantSection(v: VariantEvaluation): string {
  return [
    `## Variant \`${v.variantId}\` (Affected_Side: ${v.affectedSide})`,
    '### Play_Section values used',
    playValuesTable(v.play),
    '### Calibration_Checks',
    checksTable(v),
    ...SCENARIO_KINDS.map((kind) => scenarioSection(v, kind)),
    earlySection(v),
  ].join('\n\n');
}

function differenceSection(e: CalibrationEvaluation): string {
  const heading = '## Difference between Variants `left` and `right`';
  if (e.sideDifference === null) {
    return [heading, 'Not computed: the case has no Variants left and right.'].join('\n\n');
  }
  return [
    heading,
    table(
      ['Scenario_Kind', ...NUMERIC_VITAL_FIELDS],
      e.sideDifference.map((d) => [d.kind, ...NUMERIC_VITAL_FIELDS.map((f) => vitalText(f, d.maxAbs[f]))]),
    ),
  ].join('\n\n');
}

/** 9.2 to 9.13: no session, branch or checkpoint id, no wall-clock value, date, commit or Service_URL (12.2). */
export function renderRecordBody(e: CalibrationEvaluation): string {
  return `${[resultSection(e), ...e.variants.map(variantSection), differenceSection(e)].join('\n\n')}\n`;
}

export function renderCalibrationRecord(h: RecordHeader, e: CalibrationEvaluation): string {
  return `${renderRecordHeader(h)}\n${renderRecordBody(e)}`;
}

// ---------------------------------------------------------------------------
// Writing the record and the Calibration_Index (10.2 to 10.6)
// ---------------------------------------------------------------------------

export interface RecordFs {
  mkdir(path: string, opts: { recursive: true }): Promise<unknown>;
  readFile(path: string, enc: 'utf8'): Promise<string>;
  /** flag 'wx' fails with code EEXIST when the file exists (10.3). */
  writeFile(path: string, data: string, opts: { flag: 'wx' }): Promise<void>;
  appendFile(path: string, data: string): Promise<void>;
}

/** "<case_id>-<date>-<sha>.md", or "<case_id>-<date>-<sha>-<n>.md" for n >= 2 (10.2, 10.3). */
export function recordFileName(caseId: string, date: string, shortSha: string, n: number): string {
  if (!Number.isInteger(n) || n < 1) throw new RangeError(`Record suffix must be a whole number of at least 1, got ${String(n)}`);
  const base = `${caseId}-${date}-${shortSha}`;
  return n === 1 ? `${base}.md` : `${base}-${n}.md`;
}

/** "- <date> | <sha> | <case_id> | [<file>](<file>) | calibrated" or "... | NOT calibrated" (10.2). */
export function indexLine(date: string, shortSha: string, caseId: string, file: string, calibrated: boolean): string {
  return `- ${date} | ${shortSha} | ${caseId} | [${file}](${file}) | ${calibrated ? 'calibrated' : 'NOT calibrated'}`;
}

function trimRoot(repoRoot: string): string {
  return repoRoot.replace(/\/+$/, '');
}

/** Throws EngineError('internal') unless `path` is `${repoRoot}/docs/calibration/<name>` with a name
 *  matching /^[A-Za-z0-9._-]+$/ and not '.' or '..' (10.5). */
export function assertCalibrationPath(repoRoot: string, path: string): void {
  const prefix = `${trimRoot(repoRoot)}/${CALIBRATION_DIR}/`;
  const name = path.startsWith(prefix) ? path.slice(prefix.length) : null;
  if (name === null || !NAME_PATTERN.test(name) || name === '.' || name === '..') {
    throw new EngineError('internal', `Refusing to write outside ${CALIBRATION_DIR}/: ${path}`);
  }
}

function errorCode(err: unknown): string {
  if (typeof err === 'object' && err !== null) {
    const code = (err as { code?: unknown }).code;
    if (typeof code === 'string' && code !== '') return code;
    if (err instanceof Error) return err.message;
  }
  return String(err);
}

/** 10.2 to 10.6: tries n = 1, 2, ... with flag 'wx'; creates README.md with "# Calibration records",
 *  a blank line and the SAFETY_NOTICE line when missing (10.4), then appends indexLine.
 *  Returns repository-relative paths. */
export async function writeCalibrationRecord(args: {
  repoRoot: string;
  fs: RecordFs;
  caseId: string;
  date: string;
  shortSha: string;
  record: string;
  calibrated: boolean;
}): Promise<{ recordPath: string; indexPath: string }> {
  const { fs, caseId, date, shortSha, record, calibrated } = args;
  const root = trimRoot(args.repoRoot);
  const dir = `${root}/${CALIBRATION_DIR}`;
  const indexAbs = `${dir}/${INDEX_FILE}`;
  const indexPath = `${CALIBRATION_DIR}/${INDEX_FILE}`;
  assertCalibrationPath(root, indexAbs);

  const firstRel = `${CALIBRATION_DIR}/${recordFileName(caseId, date, shortSha, 1)}`;
  assertCalibrationPath(root, `${root}/${firstRel}`);
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch (err) {
    throw new EngineError('internal', `Could not write ${firstRel}: ${errorCode(err)}`);
  }

  let file: string | null = null;
  for (let n = 1; n <= MAX_RECORD_SUFFIX && file === null; n += 1) {
    const name = recordFileName(caseId, date, shortSha, n);
    const abs = `${dir}/${name}`;
    assertCalibrationPath(root, abs);
    try {
      await fs.writeFile(abs, record, { flag: 'wx' });
      file = name;
    } catch (err) {
      if (errorCode(err) === 'EEXIST') continue;
      throw new EngineError('internal', `Could not write ${CALIBRATION_DIR}/${name}: ${errorCode(err)}`);
    }
  }
  if (file === null) {
    throw new EngineError('internal', `Too many records named ${caseId}-${date}-${shortSha} on one day`);
  }
  const recordPath = `${CALIBRATION_DIR}/${file}`;

  const line = `${indexLine(date, shortSha, caseId, file, calibrated)}\n`;
  try {
    let existing: string | null;
    try {
      existing = await fs.readFile(indexAbs, 'utf8');
    } catch (err) {
      if (errorCode(err) !== 'ENOENT') throw err;
      existing = null;
    }
    if (existing === null) {
      await fs.appendFile(indexAbs, `${INDEX_TITLE}\n\n${SAFETY_NOTICE}\n\n${line}`);
    } else {
      await fs.appendFile(indexAbs, `${existing === '' || existing.endsWith('\n') ? '' : '\n'}${line}`);
    }
  } catch (err) {
    throw new EngineError('internal', `Wrote ${recordPath} but could not update ${indexPath}: ${errorCode(err)}`);
  }
  return { recordPath, indexPath };
}
