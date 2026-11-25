/**
 * Example tests of the Calibration_Record and the record writer (engine-mcp task 4.2; Requirement
 * 17.5): each item of Requirement 9 on synthetic Scenario_Results, "NOT calibrated" only on
 * failure, the Requirement 4.18 flag only when the early Scenario shows no worsening, the
 * determinism and id-free body of Requirement 12 (Property 9), and the record file name, suffixes,
 * Calibration_Index and path refusal of Requirement 10 with an in-memory RecordFs (Property 10).
 *
 * Scenario_Results are built by the shipped buildScenarioResult from synthetic kept samples, as in
 * engineCalibration.test.ts. Vitals are synthetic: where a test needs values on one side of a
 * Rescue_Condition or Lost_Condition, it derives them from the fixture's own conditions plus the
 * fixture's per-vital test offsets. Sentences come from the case fixtures. No clinical value is
 * written here, nothing touches the real file system and no network connection is opened (17.7).
 */
import { describe, expect, it } from 'vitest';
import { SAFETY_NOTICE_TEXT } from '@/components/SafetyNotice';
import { BASE_CASE, CASE_LEFT, CASE_RIGHT, CASE_TEXT, VITAL_OFFSETS } from '@/test/caseFixtures';
import { DEFAULT_FAKE_VITALS } from '@/test/fakePhysiologyService';
import type { CaseData, Intervention, PlaySection, Side, VitalCondition, VitalSigns } from '@/types';
import {
  ALL_PASSED_LINE,
  DECIMALS,
  NOT_ADVICE,
  NOT_CALIBRATED_LINE,
  SAFETY_NOTICE,
  assertCalibrationPath,
  indexLine,
  recordFileName,
  renderCalibrationRecord,
  renderRecordBody,
  renderRecordHeader,
  writeCalibrationRecord,
  type RecordFs,
  type RecordHeader,
} from './calibrationRecord';
import { EngineError } from './engineClient';
import {
  CALIBRATION_SAMPLE_INTERVAL,
  DEFAULT_DEMO_DECOMPRESSION_TIME,
  DEFAULT_EARLY_DECOMPRESSION_TIME,
  SCENARIO_KINDS,
  evaluateCalibration,
  readCaseFileFacts,
  type CalibrationEvaluation,
  type CalibrationInput,
  type CaseFileFacts,
  type ScenarioKind,
} from './engineCalibration';
import { buildScenarioResult, type ScenarioResult } from './engineRunner';
import { conditionHolds } from './endingEvaluator';
import { buildInterventionEntry } from './interventionRecord';
import { interventionSide } from './playCase';
import { DECOMPRESSION_ACTION, affectedInsult } from './sides';
import { VITAL_FIELD, VITAL_NAMES, type VitalName } from './vitals';

// ---------------------------------------------------------------------------
// Values taken from the case fixture (copied from engineCalibration.test.ts)
// ---------------------------------------------------------------------------

function defined<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`case fixture has no ${what}`);
  return value;
}

/** Marker values that must never reach the Record_Body (12.2). */
const SERVICE_URL = 'http://service-url-marker.test:8123';
const SESSION_MARKER = 'SESSION-MARKER';
const BRANCH_MARKER = 'BRANCH-MARKER';
const DATE = '2026-11-22';
const SHA = 'abc1234';

const CASE_ID = CASE_LEFT.id;
const PLAY: PlaySection = defined(CASE_LEFT.play, 'Play_Section');
const RESCUE = PLAY.endings.rescued;
const LOST_GROUP = defined(PLAY.endings.lost.groups?.[0], 'Lost_Condition group');
const TIME_LIMIT = defined(PLAY.endings.lost.timeLimitSeconds, 'Time_Limit');
const INSULT_TIME = defined(affectedInsult(CASE_LEFT.timeline.scheduledInsults), 'pneumothorax insult').timeSeconds;
const RESOLVED: Record<string, CaseData> = { left: CASE_LEFT, right: CASE_RIGHT };
const VARIANT_IDS = defined(BASE_CASE.variants, 'variants').map((v) => v.id);

const otherSide = (s: Side): Side => (s === 'Left' ? 'Right' : 'Left');
const affectedSideOf = (rc: CaseData): Side =>
  defined(affectedInsult(rc.timeline.scheduledInsults), 'pneumothorax insult').side;

function decompressionOnSide(rc: CaseData, side: Side): Intervention {
  return defined(
    rc.interventions.find((i) => i.action === DECOMPRESSION_ACTION && interventionSide(i) === side),
    `${side} Decompression`,
  );
}

/** Values that meet every condition: the bound for <= and >=, the bound moved by the test offset for < and >. */
function meeting(conditions: readonly VitalCondition[]): Partial<VitalSigns> {
  const out: Record<string, number> = {};
  for (const c of conditions) {
    const off = VITAL_OFFSETS[c.vital];
    out[VITAL_FIELD[c.vital]] = c.op === '>' ? c.value + off : c.op === '<' ? c.value - off : c.value;
  }
  return out as Partial<VitalSigns>;
}

const HEALTHY: Partial<VitalSigns> = { ...DEFAULT_FAKE_VITALS, ...meeting(RESCUE.conditions) };
const FAILING: Partial<VitalSigns> = { ...DEFAULT_FAKE_VITALS, ...meeting(LOST_GROUP.conditions) };
const MIDDLE: Partial<VitalSigns> = (() => {
  const c = RESCUE.conditions[0];
  const off = VITAL_OFFSETS[c.vital];
  const missed = c.op === '>=' || c.op === '>' ? c.value - off : c.value + off;
  const v = { ...HEALTHY, [VITAL_FIELD[c.vital]]: missed };
  const sample = { ...v, simulation_time: 0 };
  if (RESCUE.conditions.every((x) => conditionHolds(x, sample))) throw new Error('MIDDLE meets the rescue conditions');
  if (LOST_GROUP.conditions.every((x) => conditionHolds(x, sample))) throw new Error('MIDDLE meets a lost group');
  return v;
})();

function input(overrides: Partial<CalibrationInput> = {}): CalibrationInput {
  return {
    caseId: CASE_ID,
    decompressAtSeconds: DEFAULT_DEMO_DECOMPRESSION_TIME,
    earlyDecompressAtSeconds: DEFAULT_EARLY_DECOMPRESSION_TIME,
    write: false,
    ...overrides,
  };
}

const FACTS: CaseFileFacts = readCaseFileFacts(CASE_TEXT);
const LIMIT = { seconds: TIME_LIMIT, source: 'Time_Limit' as const };

// ---------------------------------------------------------------------------
// Synthetic Scenario_Results
// ---------------------------------------------------------------------------

type VitalsAt = (t: number) => Partial<VitalSigns>;

/** A Scenario_Result built by the shipped buildScenarioResult from synthetic kept samples, one per
 *  second. Carries the marker values that the Record_Body must not show. */
function synthetic(
  variantId: string,
  kind: ScenarioKind,
  vitalsAt: VitalsAt,
  last: number,
  decompression?: { side: 'affected' | 'other'; at: number; actual?: number },
): ScenarioResult {
  const rc = RESOLVED[variantId];
  const kept = Array.from({ length: last + 1 }, (_, t) => ({ ...vitalsAt(t), simulation_time: t }));
  const affected = affectedSideOf(rc);
  const i =
    decompression === undefined
      ? undefined
      : decompressionOnSide(rc, decompression.side === 'affected' ? affected : otherSide(affected));
  const actual = decompression?.actual ?? decompression?.at;
  const entries =
    i === undefined || actual === undefined ? [] : [buildInterventionEntry(i, actual, `${BRANCH_MARKER}-${variantId}-${kind}`)];
  const applied =
    i === undefined || decompression === undefined || actual === undefined
      ? []
      : [{ interventionId: i.id, requestedTime: decompression.at, actualTime: actual, late: actual > decompression.at }];
  const result = buildScenarioResult(
    {
      req: {
        caseId: CASE_ID,
        variantId,
        plan: [],
        maxSeconds: last,
        sampleIntervalSeconds: CALIBRATION_SAMPLE_INTERVAL,
        stopAtEnding: kind !== 'affected-side-early',
      },
      rc,
      kept,
      entries,
      applied,
    },
    SERVICE_URL,
  );
  return { ...result, undeleted_sessions: [`${SESSION_MARKER}-${variantId}-${kind}`] };
}

const DEMO = DEFAULT_DEMO_DECOMPRESSION_TIME;
const EARLY = DEFAULT_EARLY_DECOMPRESSION_TIME;
const LAST = 250;

/** Each Calibration_Check passes; the early Scenario worsens after the insult. */
function goodSet(variantId: string, shift = 0, demoActual?: number): Record<ScenarioKind, ScenarioResult> {
  const s = (v: Partial<VitalSigns>): Partial<VitalSigns> => ({ ...v, tidal_volume: (v.tidal_volume ?? 0) + shift });
  const lostAfterInsult: VitalsAt = (t) => s(t <= INSULT_TIME ? HEALTHY : FAILING);
  return {
    'no-intervention': synthetic(variantId, 'no-intervention', lostAfterInsult, LAST),
    'affected-side': synthetic(variantId, 'affected-side', (t) => s(t < DEMO ? MIDDLE : HEALTHY), LAST, {
      side: 'affected',
      at: DEMO,
      actual: demoActual,
    }),
    'other-side-only': synthetic(variantId, 'other-side-only', lostAfterInsult, LAST, { side: 'other', at: DEMO }),
    'affected-side-early': synthetic(variantId, 'affected-side-early', (t) => s(t <= INSULT_TIME ? HEALTHY : MIDDLE), LAST, {
      side: 'affected',
      at: EARLY,
    }),
  };
}

/** affected-side never rescued, other-side-only never lost, the early Scenario never worsens. */
function badSet(variantId: string): Record<ScenarioKind, ScenarioResult> {
  return {
    'no-intervention': synthetic(variantId, 'no-intervention', (t) => (t <= INSULT_TIME ? HEALTHY : FAILING), LAST),
    'affected-side': synthetic(variantId, 'affected-side', () => MIDDLE, LAST, { side: 'affected', at: DEMO }),
    'other-side-only': synthetic(variantId, 'other-side-only', () => HEALTHY, LAST, { side: 'other', at: DEMO }),
    'affected-side-early': synthetic(variantId, 'affected-side-early', () => HEALTHY, LAST, { side: 'affected', at: EARLY }),
  };
}

function evaluate(sets: Record<string, Record<ScenarioKind, ScenarioResult>>, facts: CaseFileFacts = FACTS): CalibrationEvaluation {
  return evaluateCalibration(input(), facts, LIMIT, new Map(Object.entries(sets)));
}

const GOOD = evaluate({ left: goodSet('left'), right: goodSet('right', 7) });
const BAD = evaluate({ left: badSet('left'), right: goodSet('right') });

const HEADER: RecordHeader = {
  caseId: CASE_ID,
  date: DATE,
  git: { shortSha: SHA, casesDirty: false, libDirty: true, has1e71454: true },
  serviceUrl: SERVICE_URL,
  sessionCap: 4,
  demoTime: DEMO,
  earlyTime: EARLY,
};

// ---------------------------------------------------------------------------
// Markdown helpers
// ---------------------------------------------------------------------------

/** Lines from the exact heading line to the next heading of the same or a higher level. */
function section(text: string, heading: string): string {
  const lines = text.split('\n');
  const start = lines.indexOf(heading);
  if (start < 0) throw new Error(`heading not found: ${heading}`);
  const level = /^#+/.exec(heading)?.[0].length ?? 0;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    const m = /^(#+) /.exec(lines[i]);
    if (m !== null && m[1].length <= level) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join('\n');
}

interface Table {
  headings: string[];
  rows: string[][];
}

const splitRow = (line: string): string[] =>
  line
    .slice(2, -2)
    .split(/ (?<!\\)\| /)
    .map((c) => c.trim());

/** The first Markdown table in `text`. */
function firstTable(text: string): Table {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l.startsWith('| '));
  if (start < 0) throw new Error('no table');
  const tableLines: string[] = [];
  for (let i = start; i < lines.length && lines[i].startsWith('| '); i += 1) tableLines.push(lines[i]);
  return { headings: splitRow(tableLines[0]), rows: tableLines.slice(2).map(splitRow) };
}

/** Every Markdown table in `text`, in order. */
function allTables(text: string): Table[] {
  const out: Table[] = [];
  const lines = text.split('\n');
  let i = 0;
  while (i < lines.length) {
    if (!lines[i].startsWith('| ')) {
      i += 1;
      continue;
    }
    const block: string[] = [];
    while (i < lines.length && lines[i].startsWith('| ')) block.push(lines[i++]);
    out.push({ headings: splitRow(block[0]), rows: block.slice(2).map(splitRow) });
  }
  return out;
}

const unescape = (s: string): string => s.replace(/\\\|/g, '|');

function scenarioText(body: string, variantId: string, kind: ScenarioKind): string {
  return section(section(body, `## Variant \`${variantId}\` (Affected_Side: ${affectedSideOf(RESOLVED[variantId])})`), `### Scenario \`${variantId}\` / ${kind}`);
}

function referenced(play: PlaySection): VitalName[] {
  const used = new Set<VitalName>([
    ...play.endings.rescued.conditions.map((c) => c.vital),
    ...(play.endings.lost.groups ?? []).flatMap((g) => g.conditions.map((c) => c.vital)),
  ]);
  return VITAL_NAMES.filter((v) => used.has(v));
}

function examSentences(rc: CaseData): Set<string> {
  const actions = defined(rc.play?.exam, 'Exam_Section').actions;
  return new Set(actions.flatMap((a) => [a.defaultSentence, ...a.rules.map((r) => r.sentence)]));
}

// ---------------------------------------------------------------------------
// Fixed texts
// ---------------------------------------------------------------------------

describe('fixed texts', () => {
  it('uses the Safety_Notice of the Web_App and the fixed sentences of the design', () => {
    expect(SAFETY_NOTICE).toBe(SAFETY_NOTICE_TEXT);
    expect(NOT_ADVICE).toBe('Engine results for draft case values. Not clinical advice.');
    expect(NOT_CALIBRATED_LINE).toBe('Play_Section values NOT calibrated');
    expect(ALL_PASSED_LINE).toBe(
      'All calibration checks passed. The author reviews the values and their citations before removing any TODO(author) marker.',
    );
    expect(DECIMALS).toEqual({
      simulation_time: 0,
      heart_rate: 1,
      respiratory_rate: 1,
      spo2: 3,
      mean_arterial_pressure: 1,
      systolic_pressure: 1,
      diastolic_pressure: 1,
      etco2: 1,
      tidal_volume: 0,
    });
  });
});

// ---------------------------------------------------------------------------
// Record_Header (9.1)
// ---------------------------------------------------------------------------

describe('renderRecordHeader (9.1)', () => {
  it('lists the run facts in the order of the design', () => {
    expect(renderRecordHeader(HEADER)).toBe(
      [
        `# Calibration record: ${CASE_ID}`,
        '',
        '> Educational simulation, not for clinical use',
        '',
        'Engine results for draft case values. Not clinical advice.',
        '',
        `- Date: ${DATE}`,
        `- Commit: ${SHA}`,
        '- Files under cases/ differ from the commit: no',
        '- Files under apps/web/src/lib/ differ from the commit: yes',
        '- Commit 1e71454 is an ancestor of the commit: yes',
        `- Service_URL: ${SERVICE_URL}`,
        '- Playback speed: 4x, 1x within 4 s before each Decompression; the speed affects wall-clock time only',
        '- Session_Cap: 4',
        `- Demo_Decompression_Time: ${DEMO} s`,
        `- Early_Decompression_Time: ${EARLY} s`,
        '',
      ].join('\n'),
    );
  });

  it('says unknown for every Git fact Git did not give', () => {
    const text = renderRecordHeader({
      ...HEADER,
      git: { shortSha: 'unknown', casesDirty: 'unknown', libDirty: 'unknown', has1e71454: 'unknown' },
    });
    expect(text).toContain('- Commit: unknown\n');
    expect(text).toContain('- Files under cases/ differ from the commit: unknown\n');
    expect(text).toContain('- Files under apps/web/src/lib/ differ from the commit: unknown\n');
    expect(text).toContain('- Commit 1e71454 is an ancestor of the commit: unknown\n');
    expect(renderRecordHeader({ ...HEADER, git: { ...HEADER.git, has1e71454: false } })).toContain(
      '- Commit 1e71454 is an ancestor of the commit: no\n',
    );
  });

  it('puts the header before the body, which starts at the first ## heading', () => {
    const record = renderCalibrationRecord(HEADER, GOOD);
    expect(record).toBe(`${renderRecordHeader(HEADER)}\n${renderRecordBody(GOOD)}`);
    const firstH2 = record.indexOf('\n## ');
    expect(record.slice(firstH2 + 1)).toBe(renderRecordBody(GOOD));
    expect(renderRecordBody(GOOD).startsWith('## Result\n')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Record_Body (9.2 to 9.13)
// ---------------------------------------------------------------------------

describe('renderRecordBody', () => {
  const body = renderRecordBody(GOOD);
  const badBody = renderRecordBody(BAD);

  it('9.2: names each Variant with its Affected_Side and each Scenario by Variant_Id and Scenario_Kind', () => {
    const headings = body.split('\n').filter((l) => l.startsWith('## ') || l.startsWith('### Scenario'));
    const expected = [
      '## Result',
      ...VARIANT_IDS.flatMap((v) => [
        `## Variant \`${v}\` (Affected_Side: ${affectedSideOf(RESOLVED[v])})`,
        ...SCENARIO_KINDS.map((k) => `### Scenario \`${v}\` / ${k}`),
      ]),
      '## Difference between Variants `left` and `right`',
    ];
    expect(headings).toEqual(expected);
    // Sides appear as "affected side" and "other side" in every Side column.
    for (const v of VARIANT_IDS) {
      for (const kind of SCENARIO_KINDS) {
        for (const t of allTables(scenarioText(body, v, kind))) {
          const col = t.headings.indexOf('Side');
          if (col < 0) continue;
          for (const r of t.rows) expect(['affected side', 'other side', 'n/a']).toContain(r[col]);
        }
      }
      const interventions = firstTable(scenarioText(body, v, 'other-side-only'));
      expect(interventions.headings).toEqual(['Intervention', 'Side', 'Requested_Time (s)', 'Actual_Time (s)', 'Late']);
      expect(interventions.rows.map((r) => r[1])).toEqual(['other side']);
      expect(firstTable(scenarioText(body, v, 'affected-side')).rows.map((r) => r[1])).toEqual(['affected side']);
    }
  });

  it('9.3: lists the Play_Section values used per Variant', () => {
    for (const v of GOOD.variants) {
      const t = firstTable(section(section(body, `## Variant \`${v.variantId}\` (Affected_Side: ${v.affectedSide})`), '### Play_Section values used'));
      const play = defined(RESOLVED[v.variantId].play, 'play');
      const cond = (cs: readonly VitalCondition[]): string => cs.map((c) => `${c.vital} ${c.op} ${c.value}`).join('; ');
      const groups = play.endings.lost.groups ?? [];
      expect(t.headings).toEqual(['Item', 'Value']);
      expect(t.rows).toEqual([
        ['Rescue_Conditions', cond(play.endings.rescued.conditions)],
        ['Rescue Hold_Duration', `${play.endings.rescued.holdSeconds} s`],
        ...groups.flatMap((g, i) => [
          [`Lost_Condition group ${i + 1}`, cond(g.conditions)],
          [`Lost_Condition group ${i + 1} Hold_Duration`, `${g.holdSeconds} s`],
        ]),
        ['Time_Limit', `${defined(play.endings.lost.timeLimitSeconds, 'Time_Limit')} s`],
        ['Required_Interventions', defined(play.endings.rescued.requiredInterventions, 'Required_Interventions').join(', ')],
      ]);
    }
  });

  it('9.4: shows the Mark_Samples, Decompression times, Late flag, Rescue_Gate_Time and Ending of each Scenario', () => {
    const vitals = referenced(PLAY);
    expect(vitals.length).toBeGreaterThan(0);
    for (const v of GOOD.variants) {
      for (const kind of SCENARIO_KINDS) {
        const r = v.scenarios[kind];
        const text = scenarioText(body, v.variantId, kind);
        const t = firstTable(section(text, '#### Vital signs'));
        expect(t.headings).toEqual(['Time (s)', 'Substituted', ...vitals, 'Overall_Status', 'Ending']);
        expect(t.rows.map((row) => row[0])).toEqual(r.marks.map((m) => String(m.time)));
        expect(t.rows.map((row) => row[row.length - 2])).toEqual(r.marks.map((m) => m.overall_status));
        expect(t.rows.map((row) => row[row.length - 1])).toEqual(r.marks.map((m) => m.ending));
        expect(t.rows.every((row) => row[1] === 'no')).toBe(true);
        if (r.interventions.length === 0) expect(text).toContain('\nInterventions: none\n');
      }
      const affected = scenarioText(body, v.variantId, 'affected-side');
      const r = v.scenarios['affected-side'];
      expect(firstTable(affected).rows).toEqual([[r.interventions[0].intervention_id, 'affected side', String(DEMO), String(DEMO), 'no']]);
      expect(affected).toContain(`\nRescue_Gate_Time: ${DEMO} s\n`);
      expect(r.ending.ending).toBe('rescued');
      if (r.ending.ending === 'rescued') expect(affected).toContain(`\nEnding: rescued at ${r.ending.first_time} s\n`);
      const none = v.scenarios['no-intervention'];
      expect(none.ending.ending).toBe('lost');
      if (none.ending.ending === 'lost') {
        const cause = none.ending.lost_cause === 'Time_Limit' ? 'Time_Limit' : `Lost_Condition group ${none.ending.lost_cause}`;
        expect(scenarioText(body, v.variantId, 'no-intervention')).toContain(`\nEnding: lost at ${none.ending.first_time} s (cause: ${cause})\n`);
      }
      expect(scenarioText(body, v.variantId, 'no-intervention')).toContain('\nRescue_Gate_Time: closed\n');
    }
    // Ending that stayed none.
    const stayed = BAD.variants[0].scenarios['affected-side'];
    expect(stayed.ending.ending).toBe('none');
    expect(scenarioText(badBody, 'left', 'affected-side')).toContain(`\nEnding: stayed none up to ${LAST - (LAST % 10)} s\n`);
  });

  it('9.4: marks a Late_Intervention and a substituted Mark_Sample', () => {
    const late = evaluate({ left: goodSet('left', 0, DEMO + 3), right: goodSet('right') });
    const text = scenarioText(renderRecordBody(late), 'left', 'affected-side');
    expect(firstTable(text).rows[0].slice(2)).toEqual([String(DEMO), String(DEMO + 3), 'yes']);

    const sub = structuredClone(GOOD);
    const mark = sub.variants[0].scenarios['no-intervention'].marks[3];
    mark.substituted = true;
    mark.source_time = mark.time + 2;
    const t = firstTable(section(scenarioText(renderRecordBody(sub), 'left', 'no-intervention'), '#### Vital signs'));
    expect(t.rows[3][1]).toBe(`yes (${mark.time + 2} s)`);
    expect(t.rows[2][1]).toBe('no');
  });

  it('9.5: states pass or fail for each Calibration_Check with its basis', () => {
    for (const [e, text] of [
      [GOOD, body],
      [BAD, badBody],
    ] as const) {
      for (const v of e.variants) {
        const t = firstTable(section(section(text, `## Variant \`${v.variantId}\` (Affected_Side: ${v.affectedSide})`), '### Calibration_Checks'));
        expect(t.headings).toEqual(['Check', 'Scenario', 'Result', 'Basis']);
        expect(t.rows).toEqual([
          ['affected-side-rescued', `\`${v.variantId}\` / affected-side`, v.checks[0].pass ? 'pass' : 'fail', v.checks[0].basis],
          ['other-side-only-lost', `\`${v.variantId}\` / other-side-only`, v.checks[1].pass ? 'pass' : 'fail', v.checks[1].basis],
          ['no-intervention-lost', `\`${v.variantId}\` / no-intervention`, v.checks[2].pass ? 'pass' : 'fail', v.checks[2].basis],
        ]);
      }
    }
    expect(BAD.variants[0].checks.map((c) => c.pass)).toEqual([false, false, true]);
  });

  it('9.6: compares the early Scenario with no intervention after the insult and states the D23 answer', () => {
    for (const v of GOOD.variants) {
      const text = section(section(body, `## Variant \`${v.variantId}\` (Affected_Side: ${v.affectedSide})`), '### Early Decompression compared with no intervention');
      const t = firstTable(text);
      const withThresholds = VITAL_NAMES.filter((n) => CASE_LEFT.alarms[n] !== undefined);
      expect(t.headings).toEqual(['Time (s)', ...withThresholds.flatMap((n) => [`${n} early`, `${n} none`])]);
      expect(t.rows.map((r) => Number(r[0]))).toEqual(v.early.rows.map((r) => r.time));
      expect(t.rows.every((r) => Number(r[0]) > INSULT_TIME)).toBe(true);
      expect(text).toContain(
        "\nRule: In the `affected-side-early` Scenario, the tension pneumothorax counts as developing when at one or more Mark_Samples after the insult's `timeSeconds`, at least one vital sign with Case thresholds has an Alarm_State more severe (`normal < warning < critical`) than its Alarm_State at the last Mark_Sample at or before `timeSeconds`.\n",
      );
      expect(text).toContain(
        `\nThe tension pneumothorax still develops after the early Decompression: yes, first at ${v.early.firstWorseAt} s (${v.early.worseVital})\n`,
      );
      expect(text.trimEnd().endsWith("\nThe early Scenario's Ending is not evidence for play-mode open question 1, item d.")).toBe(true);
    }
    expect(section(badBody, '## Variant `left` (Affected_Side: Left)')).toContain(
      '\nThe tension pneumothorax still develops after the early Decompression: no\n',
    );
  });

  it('9.7: flags Requirement 4.18 only when the early Scenario shows no worsening', () => {
    expect(section(body, '## Result')).toContain('\nRequirement 4.18 flag: not raised');
    expect(section(badBody, '## Result')).toContain(
      '\nRequirement 4.18 flag: play-mode Requirement 4.18 flagged for revision: the early Decompression prevented the tension pneumothorax in Variant(s) left',
    );
    const both = renderRecordBody(evaluate({ left: badSet('left'), right: badSet('right') }));
    expect(both).toContain('the early Decompression prevented the tension pneumothorax in Variant(s) left, right');
  });

  it('9.8: shows the Vital_Bands at time 0 and the matched Status_Rules or only the defaultSentence', () => {
    let sawRules = false;
    let sawOnlyDefault = false;
    // A synthetic Scenario_Result in which selectStatus returned only the defaultSentence.
    const onlyDefault = structuredClone(GOOD);
    const od = onlyDefault.variants[1].scenarios['no-intervention'];
    od.status_rules = { rules: [], only_default: true, default_sentence: PLAY.status.defaultSentence };
    for (const e of [GOOD, BAD, onlyDefault]) {
      const text = renderRecordBody(e);
      for (const v of e.variants) {
        for (const kind of SCENARIO_KINDS) {
          const r = v.scenarios[kind];
          const sc = scenarioText(text, v.variantId, kind);
          const bands = firstTable(section(sc, '#### Vital_Bands at Simulation_Time 0'));
          expect(bands.headings).toEqual(['Vital', 'Alarm_State', 'Direction']);
          const b0 = r.marks[0].bands;
          expect(bands.rows).toEqual(
            VITAL_NAMES.filter((n) => b0[n] !== undefined).map((n) => [n, b0[n]?.state, b0[n]?.direction]),
          );
          expect(bands.rows.length).toBeGreaterThan(0);

          const status = section(sc, '#### Status_Rules');
          const play = defined(RESOLVED[v.variantId].play, 'play');
          if (r.status_rules.rules.length > 0) {
            sawRules = true;
            const t = firstTable(status);
            expect(t.headings).toEqual(['Rule', 'Sentence', 'Matched at (s)', 'Returned at (s)']);
            expect(t.rows).toEqual(
              r.status_rules.rules.map((x) => [
                `play.status.rules[${x.index}]`,
                play.status.rules[x.index].sentence,
                x.matched_at.join(', '),
                x.returned_at.length === 0 ? 'never' : x.returned_at.join(', '),
              ]),
            );
          }
          const line = `Only the defaultSentence was returned: "${play.status.defaultSentence}"`;
          if (r.status_rules.only_default) {
            sawOnlyDefault = true;
            expect(status).toContain(line);
            expect(status).not.toContain('| Rule |');
          } else {
            expect(status).not.toContain(line);
          }
        }
      }
    }
    expect(sawRules).toBe(true);
    expect(sawOnlyDefault).toBe(true);
  });

  it('9.9: shows each Exam_Finding per Mark_Sample and the first Abnormal_Finding per Exam_Button', () => {
    let sawAbnormal = false;
    let sawNever = false;
    for (const v of GOOD.variants) {
      const sentences = examSentences(RESOLVED[v.variantId]);
      for (const kind of SCENARIO_KINDS) {
        const r = v.scenarios[kind];
        const [first, perMark] = allTables(section(scenarioText(body, v.variantId, kind), '#### Exam_Findings'));
        expect(first.headings).toEqual(['Exam_Button', 'Side', 'First Abnormal_Finding (s)']);
        const words = (s: Side | null): string => (s === null ? 'n/a' : s === v.affectedSide ? 'affected side' : 'other side');
        expect(first.rows).toEqual(
          r.first_abnormal.map((f) => [f.action_id, words(f.side), f.first_at === null ? 'never' : String(f.first_at)]),
        );
        if (r.first_abnormal.some((f) => f.first_at === null)) sawNever = true;

        const buttons = r.marks[0].exam;
        expect(buttons.length).toBeGreaterThan(0);
        expect(perMark.headings).toEqual([
          'Time (s)',
          ...buttons.map((b) => (b.side === null ? b.action_id : `${b.action_id} (${words(b.side)})`)),
        ]);
        expect(perMark.rows).toHaveLength(r.marks.length);
        perMark.rows.forEach((row, k) => {
          expect(row[0]).toBe(String(r.marks[k].time));
          r.marks[k].exam.forEach((x, j) => {
            const shown = unescape(row[j + 1]);
            expect(shown).toBe(x.abnormal ? `**abnormal:** ${x.sentence}` : x.sentence);
            expect(sentences.has(shown.replace(/^\*\*abnormal:\*\* /, ''))).toBe(true);
            if (x.abnormal) sawAbnormal = true;
          });
        });
      }
    }
    expect(sawAbnormal).toBe(true);
    expect(sawNever).toBe(true);
  });

  it('9.10: shows the largest left-right difference per Scenario_Kind, or that it was not computed', () => {
    const t = firstTable(section(body, '## Difference between Variants `left` and `right`'));
    const fields = [
      'heart_rate',
      'respiratory_rate',
      'spo2',
      'mean_arterial_pressure',
      'systolic_pressure',
      'diastolic_pressure',
      'etco2',
      'tidal_volume',
    ] as const;
    expect(t.headings).toEqual(['Scenario_Kind', ...fields]);
    expect(t.rows.map((r) => r[0])).toEqual([...SCENARIO_KINDS]);
    for (const [k, r] of t.rows.entries()) {
      const d = defined(GOOD.sideDifference, 'sideDifference')[k];
      fields.forEach((f, j) => {
        const x = d.maxAbs[f];
        expect(r[j + 1]).toBe(x === null || x === undefined ? 'n/a' : x.toFixed(DECIMALS[f]));
      });
      expect(r[1 + fields.indexOf('tidal_volume')]).toBe('7');
      expect(r[1 + fields.indexOf('heart_rate')]).toBe('0.0');
    }

    const noPair = renderRecordBody(evaluate({ left: goodSet('left'), other: goodSet('left') }, { ...FACTS, variantIds: ['left', 'other'] }));
    expect(section(noPair, '## Difference between Variants `left` and `right`')).toBe(
      '## Difference between Variants `left` and `right`\n\nNot computed: the case has no Variants left and right.\n',
    );
  });

  it('9.11: says NOT calibrated only on failure and names each failing Scenario with its outcome', () => {
    expect(body).not.toContain(NOT_CALIBRATED_LINE);
    const result = section(badBody, '## Result');
    const left = BAD.variants[0];
    expect(result).toContain(
      [
        NOT_CALIBRATED_LINE,
        `- \`left\` / affected-side: affected-side-rescued failed: ${left.checks[0].basis}`,
        `- \`left\` / other-side-only: other-side-only-lost failed: ${left.checks[1].basis}`,
      ].join('\n') + '\n\nRequirement 4.18 flag: ',
    );
    expect(badBody.split(NOT_CALIBRATED_LINE)).toHaveLength(2);
    expect(badBody).not.toContain(ALL_PASSED_LINE);
  });

  it('9.12: says that all checks passed only when every Calibration_Check passes', () => {
    expect(GOOD.calibrated).toBe(true);
    expect(section(body, '## Result')).toBe(`## Result\n\n${ALL_PASSED_LINE}\n\nRequirement 4.18 flag: not raised\n`);
  });

  it('9.13: quotes sentences exactly and escapes only a | inside a table cell', () => {
    const piped = structuredClone(GOOD);
    const r = piped.variants[0].scenarios['affected-side'];
    const rule = defined(r.status_rules.rules[0], 'matched Status_Rule');
    rule.sentence = `${rule.sentence} | x`;
    r.marks[0].exam[0].sentence = `${r.marks[0].exam[0].sentence} | y`;
    const sc = scenarioText(renderRecordBody(piped), 'left', 'affected-side');
    const statusRow = firstTable(section(sc, '#### Status_Rules')).rows[0];
    expect(statusRow[1]).toBe(rule.sentence.replace('|', '\\|'));
    expect(unescape(statusRow[1])).toBe(rule.sentence);
    const examRow = allTables(section(sc, '#### Exam_Findings'))[1].rows[0];
    expect(unescape(examRow[1]).replace(/^\*\*abnormal:\*\* /, '')).toBe(r.marks[0].exam[0].sentence);

    // Every Status_Sentence shown is a sentence of the Resolved_Case.
    const caseSentences = new Set([...PLAY.status.rules.map((x) => x.sentence), PLAY.status.defaultSentence]);
    for (const v of GOOD.variants) {
      for (const kind of SCENARIO_KINDS) {
        const status = section(scenarioText(body, v.variantId, kind), '#### Status_Rules');
        if (status.includes('| Rule |')) for (const row of firstTable(status).rows) expect(caseSentences.has(unescape(row[1]))).toBe(true);
      }
    }
  });

  // Feature: engine-mcp, Property 9: The Record_Body is deterministic and free of ids and clock values
  describe('Property 9: The Record_Body is deterministic and free of ids and clock values', () => {
    it('renders equal text twice from equal inputs', () => {
      expect(renderRecordBody(GOOD)).toBe(renderRecordBody(structuredClone(GOOD)));
      expect(renderCalibrationRecord(HEADER, BAD)).toBe(renderCalibrationRecord({ ...HEADER }, structuredClone(BAD)));
    });

    it('holds no session id, branch id, date, commit or Service_URL; the header holds the run facts', () => {
      for (const e of [GOOD, BAD]) {
        const all = e.variants.flatMap((v) => SCENARIO_KINDS.map((k) => v.scenarios[k]));
        expect(all.every((r) => (r.undeleted_sessions ?? []).length === 1 && r.service_url === SERVICE_URL)).toBe(true);
        const text = renderRecordBody(e);
        for (const marker of [SESSION_MARKER, BRANCH_MARKER, SERVICE_URL, 'service-url-marker', DATE, SHA]) {
          expect(text).not.toContain(marker);
        }
        expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}/);
        const header = renderRecordHeader(HEADER);
        for (const fact of [DATE, SHA, SERVICE_URL]) expect(header).toContain(fact);
      }
    });

    it('renders every vital sign value with the decimals of DECIMALS', () => {
      const e = structuredClone(GOOD);
      const jitter: Partial<Record<keyof VitalSigns, number>> = {
        heart_rate: 0.123456,
        respiratory_rate: 0.987654,
        spo2: 0.000123456,
        mean_arterial_pressure: -0.04321,
        etco2: 0.55555,
        tidal_volume: 0.4999,
      };
      for (const v of e.variants) {
        for (const kind of SCENARIO_KINDS) {
          for (const m of v.scenarios[kind].marks) {
            const vit = m.vitals as Record<string, number>;
            for (const [f, d] of Object.entries(jitter)) if (typeof vit[f] === 'number') vit[f] += d as number;
          }
        }
      }
      const text = renderRecordBody(e);
      const vitals = referenced(PLAY);
      let checked = 0;
      for (const v of e.variants) {
        for (const kind of SCENARIO_KINDS) {
          const r = v.scenarios[kind];
          const t = firstTable(section(scenarioText(text, v.variantId, kind), '#### Vital signs'));
          t.rows.forEach((row, k) => {
            vitals.forEach((name, j) => {
              const field = VITAL_FIELD[name];
              const value = (r.marks[k].vitals as Partial<VitalSigns>)[field];
              const decimals = DECIMALS[field];
              const shown = row[j + 2];
              expect(shown).toMatch(decimals === 0 ? /^-?\d+$/ : new RegExp(`^-?\\d+\\.\\d{${decimals}}$`));
              expect(Number(shown)).toBeCloseTo(defined(value, field), decimals);
              checked += 1;
            });
          });
        }
      }
      expect(checked).toBeGreaterThan(100);
    });
  });
});

// ---------------------------------------------------------------------------
// Writing the record (10.2 to 10.5)
// ---------------------------------------------------------------------------

interface MemFs extends RecordFs {
  files: Map<string, string>;
  calls: string[];
}

function codeError(code: string): Error {
  return Object.assign(new Error(code), { code });
}

function memFs(initial: Record<string, string> = {}, fail: { write?: string; append?: string; mkdir?: string } = {}): MemFs {
  const files = new Map(Object.entries(initial));
  const calls: string[] = [];
  return {
    files,
    calls,
    async mkdir(path) {
      calls.push(`mkdir ${path}`);
      if (fail.mkdir !== undefined) throw codeError(fail.mkdir);
      return undefined;
    },
    async readFile(path) {
      calls.push(`read ${path}`);
      const text = files.get(path);
      if (text === undefined) throw codeError('ENOENT');
      return text;
    },
    async writeFile(path, data, opts) {
      calls.push(`write ${path}`);
      expect(opts).toEqual({ flag: 'wx' });
      if (files.has(path)) throw codeError('EEXIST');
      if (fail.write !== undefined) throw codeError(fail.write);
      files.set(path, data);
    },
    async appendFile(path, data) {
      calls.push(`append ${path}`);
      if (fail.append !== undefined) throw codeError(fail.append);
      files.set(path, (files.get(path) ?? '') + data);
    },
  };
}

const ROOT = '/repo/stitched-patient';
const DIR = `${ROOT}/docs/calibration`;
const BASE = `${CASE_ID}-${DATE}-${SHA}`;
const INDEX = `${DIR}/README.md`;
const INDEX_HEAD = '# Calibration records\n\nEducational simulation, not for clinical use\n\n';

function write(fs: RecordFs, overrides: Partial<Parameters<typeof writeCalibrationRecord>[0]> = {}) {
  return writeCalibrationRecord({
    repoRoot: ROOT,
    fs,
    caseId: CASE_ID,
    date: DATE,
    shortSha: SHA,
    record: 'RECORD TEXT\n',
    calibrated: false,
    ...overrides,
  });
}

async function internalError(p: Promise<unknown>): Promise<EngineError> {
  try {
    await p;
  } catch (err) {
    expect(err).toBeInstanceOf(EngineError);
    expect((err as EngineError).kind).toBe('internal');
    return err as EngineError;
  }
  throw new Error('expected an EngineError');
}

// Feature: engine-mcp, Property 10: Record writes stay in docs/calibration/ and never overwrite
describe('Property 10: Record writes stay in docs/calibration/ and never overwrite', () => {
  it('builds the record file name and the Calibration_Index line', () => {
    expect(recordFileName(CASE_ID, DATE, SHA, 1)).toBe(`${BASE}.md`);
    expect(recordFileName(CASE_ID, DATE, SHA, 2)).toBe(`${BASE}-2.md`);
    expect(recordFileName(CASE_ID, DATE, SHA, 3)).toBe(`${BASE}-3.md`);
    expect(recordFileName(CASE_ID, DATE, 'unknown', 1)).toBe(`${CASE_ID}-${DATE}-unknown.md`);
    expect(() => recordFileName(CASE_ID, DATE, SHA, 0)).toThrow(RangeError);
    expect(indexLine(DATE, SHA, CASE_ID, `${BASE}.md`, false)).toBe(
      `- ${DATE} | ${SHA} | ${CASE_ID} | [${BASE}.md](${BASE}.md) | NOT calibrated`,
    );
    expect(indexLine(DATE, SHA, CASE_ID, `${BASE}-2.md`, true)).toBe(
      `- ${DATE} | ${SHA} | ${CASE_ID} | [${BASE}-2.md](${BASE}-2.md) | calibrated`,
    );
  });

  it('writes the record and creates the Calibration_Index with its title and the Safety_Notice', async () => {
    const fs = memFs();
    const out = await write(fs, { calibrated: true });
    expect(out).toEqual({ recordPath: `docs/calibration/${BASE}.md`, indexPath: 'docs/calibration/README.md' });
    expect(fs.files.get(`${DIR}/${BASE}.md`)).toBe('RECORD TEXT\n');
    expect(fs.files.get(INDEX)).toBe(`${INDEX_HEAD}${indexLine(DATE, SHA, CASE_ID, `${BASE}.md`, true)}\n`);
    expect([...fs.files.keys()].sort()).toEqual([`${DIR}/${BASE}.md`, INDEX].sort());
    expect(fs.calls[0]).toBe(`mkdir ${DIR}`);
  });

  it('adds -2 and -3 instead of overwriting, leaves existing files unchanged and appends one index line', async () => {
    const existingIndex = `${INDEX_HEAD}- old line\n`;
    const fs = memFs({ [`${DIR}/${BASE}.md`]: 'FIRST', [INDEX]: existingIndex, [`${DIR}/other.md`]: 'OTHER' });
    const second = await write(fs, { record: 'SECOND' });
    expect(second.recordPath).toBe(`docs/calibration/${BASE}-2.md`);
    const third = await write(fs, { record: 'THIRD', calibrated: true });
    expect(third.recordPath).toBe(`docs/calibration/${BASE}-3.md`);

    expect(fs.files.get(`${DIR}/${BASE}.md`)).toBe('FIRST');
    expect(fs.files.get(`${DIR}/other.md`)).toBe('OTHER');
    expect(fs.files.get(`${DIR}/${BASE}-2.md`)).toBe('SECOND');
    expect(fs.files.get(`${DIR}/${BASE}-3.md`)).toBe('THIRD');
    expect(fs.files.get(INDEX)).toBe(
      `${existingIndex}${indexLine(DATE, SHA, CASE_ID, `${BASE}-2.md`, false)}\n${indexLine(DATE, SHA, CASE_ID, `${BASE}-3.md`, true)}\n`,
    );
  });

  it('starts the index line on a new line when the index does not end with one', async () => {
    const fs = memFs({ [INDEX]: '# Calibration records' });
    await write(fs);
    expect(fs.files.get(INDEX)).toBe(`# Calibration records\n${indexLine(DATE, SHA, CASE_ID, `${BASE}.md`, false)}\n`);
  });

  it('accepts a repository root with a trailing slash', async () => {
    const fs = memFs();
    const out = await write(fs, { repoRoot: `${ROOT}/` });
    expect(out.recordPath).toBe(`docs/calibration/${BASE}.md`);
    expect(fs.files.has(`${DIR}/${BASE}.md`)).toBe(true);
  });

  it('gives up after -99 without overwriting', async () => {
    const initial: Record<string, string> = {};
    for (let n = 1; n <= 99; n += 1) initial[`${DIR}/${recordFileName(CASE_ID, DATE, SHA, n)}`] = `R${n}`;
    const fs = memFs(initial);
    const err = await internalError(write(fs));
    expect(err.message).toBe(`Too many records named ${BASE} on one day`);
    expect(fs.files.size).toBe(99);
    expect(fs.calls.some((c) => c.startsWith('append'))).toBe(false);
  });

  it('reports a failed record write and does not touch the index', async () => {
    const fs = memFs({}, { write: 'EACCES' });
    const err = await internalError(write(fs));
    expect(err.message).toBe(`Could not write docs/calibration/${BASE}.md: EACCES`);
    expect(fs.files.size).toBe(0);
    expect(fs.calls.some((c) => c.includes('README.md'))).toBe(false);
  });

  it('names the written record when the index cannot be updated', async () => {
    const fs = memFs({}, { append: 'ENOSPC' });
    const err = await internalError(write(fs));
    expect(err.message).toBe(`Wrote docs/calibration/${BASE}.md but could not update docs/calibration/README.md: ENOSPC`);
    expect(fs.files.get(`${DIR}/${BASE}.md`)).toBe('RECORD TEXT\n');
  });

  it('refuses every path outside docs/calibration/', () => {
    const ok = [`${DIR}/a.md`, `${DIR}/README.md`, `${DIR}/${BASE}-2.md`];
    for (const p of ok) {
      expect(() => assertCalibrationPath(ROOT, p)).not.toThrow();
      expect(() => assertCalibrationPath(`${ROOT}/`, p)).not.toThrow();
    }
    const bad = [
      `${DIR}/../a.md`,
      `${DIR}/..`,
      `${DIR}/.`,
      `${DIR}/`,
      `${DIR}`,
      `${DIR}/sub/a.md`,
      `${DIR}/a/../b.md`,
      `${ROOT}/docs/other/a.md`,
      `${ROOT}/docs/calibrationx/a.md`,
      `${ROOT}/a.md`,
      '/etc/passwd',
      `/elsewhere/docs/calibration/a.md`,
      'docs/calibration/a.md',
      '',
    ];
    for (const p of bad) {
      expect(() => assertCalibrationPath(ROOT, p)).toThrow(EngineError);
      expect(() => assertCalibrationPath(ROOT, p)).toThrow(`Refusing to write outside docs/calibration/: ${p}`);
    }
  });

  it('writes nothing for a case id that would leave docs/calibration/', async () => {
    for (const caseId of ['../escape', 'sub/dir', 'a b']) {
      const fs = memFs();
      const err = await internalError(write(fs, { caseId }));
      expect(err.message).toBe(`Refusing to write outside docs/calibration/: ${DIR}/${caseId}-${DATE}-${SHA}.md`);
      expect(fs.calls).toEqual([]);
      expect(fs.files.size).toBe(0);
    }
  });
});
