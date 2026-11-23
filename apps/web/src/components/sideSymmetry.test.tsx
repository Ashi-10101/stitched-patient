/**
 * bedside-exam task 16.1: screen symmetry (Property 17).
 *
 * The same generated action sequence drives `sessionReducer` on the `left`
 * and the `right` Resolved_Case, with Session_Metadata that differs only in
 * `variant_id`. Before the side is found (no sided exam), without an Ending
 * and without an Intervention, both views must render the same markup in
 * both Variants, show no Variant_Id and no Side_Reveal_Text, and name a side
 * only in the Exam_Button and Intervention texts and in the app's fixed
 * "remaining" wording (Goal bar `M:SS left` and `Time left`, Hint button texts).
 *
 * Requirements 9.6, 10.4, 10.6, 10.7, 10.8, 10.9, 11.5, 12.6, 14.2.
 */

import { describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import { renderToStaticMarkup } from 'react-dom/server';
import { examButtons, isSidedAction } from '@/lib/examFinding';
import { playButtonText } from '@/lib/playCase';
import {
  initialSessionState,
  sessionReducer,
  type SessionAction,
  type SessionUiState,
  type View,
} from '@/lib/sessionState';
import { computeSides } from '@/lib/sides';
import { selectStatus } from '@/lib/statusSelector';
import { formatMSS, remainingSeconds } from '@/lib/timeFormat';
import type { SimulationSessionActions, SimulationSessionNotices } from '@/hooks/useSimulationSession';
import { CASE_LEFT, CASE_RIGHT } from '@/test/caseFixtures';
import { PBT_PARAMS } from '@/test/pbt';
import type { CaseData, PlaybackSpeed, SessionMetadata, VitalSigns } from '@/types';
import { ClinicianView } from './ClinicianView';
import { hintButtonText, NO_HINTS_LEFT_TEXT } from './HintPanel';
import { PlayView } from './PlayView';

// ---------------------------------------------------------------------------
// Fixtures and helpers (copied in small form from PlayView.test.tsx and sessionState.test.ts)
// ---------------------------------------------------------------------------

const VARIANTS = [
  { id: 'left', caseData: CASE_LEFT },
  { id: 'right', caseData: CASE_RIGHT },
] as const;

const HINT_COUNT = CASE_LEFT.play!.hints.length;
/** Fewer Hint reveals than the Play_Section defines. */
const MAX_HINT_REVEALS = HINT_COUNT - 1;

const NEUTRAL_EXAM_IDS: string[] = CASE_LEFT.play!.exam!.actions.filter((a) => !isSidedAction(a)).map((a) => a.id);

function session(variantId: string): SessionMetadata {
  return {
    session_id: 's1',
    case_id: CASE_LEFT.id,
    created_at: '',
    current_branch_id: 'b1',
    branches: [{ branch_id: 'b1', created_at: '', event_count: 0 }],
    variant_id: variantId,
  };
}

function stubActions(): SimulationSessionActions {
  return {
    selectView: vi.fn(),
    setPlaying: vi.fn(async () => {}),
    setSpeed: vi.fn(async () => {}),
    applyIntervention: vi.fn(async () => 'ok' as const),
    revealHint: vi.fn(),
    loadLineageCheckpoints: vi.fn(async () => 'ok' as const),
    fork: vi.fn(async () => 'ok' as const),
    performExam: vi.fn(),
  };
}

const NOTICES: SimulationSessionNotices = { pauseFailed: false, streamError: null };

/** Markup of both views for `state`; the Status_Sentence is computed as useSimulationSession does. */
function renderBoth(state: SessionUiState): { play: string; clinician: string } {
  const caseData = state.caseData;
  const statusSentence =
    caseData !== null && caseData.play !== undefined
      ? selectStatus(state.latestSample, caseData.alarms, caseData.play)
      : null;
  return {
    play: renderToStaticMarkup(<PlayView sim={{ state, statusSentence, actions: stubActions(), notices: NOTICES }} />),
    clinician: renderToStaticMarkup(<ClinicianView sim={{ state, actions: stubActions(), notices: NOTICES }} />),
  };
}

// ---------------------------------------------------------------------------
// Generated sequence: samples, side-neutral exams, view switches, playback
// changes, forks and at most MAX_HINT_REVEALS Hint reveals (at most 12 actions).
// Forks go back in time, but never past the latest sample, so the latest
// Simulation_Time stays at most 12 x 40 s.
// ---------------------------------------------------------------------------

type Op =
  /** Sample `offset` s after the latest sample (or the Branch start). */
  | { kind: 'sample'; offset: number; heartRate: number; spo2: number; map: number; tidalVolume: number }
  /** A Side_Neutral_Action, or an unknown id (refused); never a sided exam. */
  | { kind: 'exam'; actionId: string }
  | { kind: 'view'; view: View }
  | { kind: 'playback'; playing: boolean | undefined; speed: PlaybackSpeed | undefined }
  /** Fork at `at` (0 to 1) of the way from the current Branch's start to its latest time. */
  | { kind: 'fork'; at: number }
  | { kind: 'hint' };

/** Simulation_Time of the case's Tension Pneumothorax insult (the same in both Variants). */
const INSULT_TIME = CASE_LEFT.timeline!.scheduledInsults.find((i) => i.action === 'SETensionPneumothorax')!.timeSeconds;

/**
 * Sample values: SpO2 stays at or above 0.86, so the case's Lost group
 * (SpO2 < 0.85) can never hold; Rescued needs the Required_Intervention, which
 * is never applied. The values still cover the normal, warning and critical
 * SpO2 bands for the Status_Sentence.
 */
function arbSample(offset: fc.Arbitrary<number>): fc.Arbitrary<Op> {
  return fc.record({
    kind: fc.constant('sample' as const),
    offset,
    heartRate: fc.constantFrom(80, 125, 170),
    spo2: fc.constantFrom(0.97, 0.9, 0.86),
    map: fc.constantFrom(90, 65),
    tidalVolume: fc.constantFrom(0, 480, 500),
  });
}
/** A short step of 0.5 to 12 s. */
const arbSampleOp = arbSample(fc.integer({ min: 1, max: 24 }).map((n) => n / 2));
/**
 * A jump of 30 to 40 s, so most runs end past INSULT_TIME with no Found_Side
 * (the state in which only the side gate keeps the Variants equal).
 * 12 x 40 s = 480 s stays below the 600 s Time_Limit, so no Lost Ending by time.
 */
const arbJumpOp = arbSample(fc.integer({ min: 60, max: 80 }).map((n) => n / 2));
const arbExamOp: fc.Arbitrary<Op> = fc.record({
  kind: fc.constant('exam' as const),
  actionId: fc.constantFrom(...NEUTRAL_EXAM_IDS, 'no-such-action'),
});
const arbViewOp: fc.Arbitrary<Op> = fc.record({
  kind: fc.constant('view' as const),
  view: fc.constantFrom<View>('play', 'clinician'),
});
const arbPlaybackOp: fc.Arbitrary<Op> = fc.record({
  kind: fc.constant('playback' as const),
  playing: fc.option(fc.boolean(), { nil: undefined }),
  speed: fc.option(fc.constantFrom<PlaybackSpeed>('1x', '2x', '4x'), { nil: undefined }),
});
const arbForkOp: fc.Arbitrary<Op> = fc.record({
  kind: fc.constant('fork' as const),
  at: fc.integer({ min: 0, max: 4 }).map((n) => n / 4),
});
const arbHintOp: fc.Arbitrary<Op> = fc.constant({ kind: 'hint' as const });

/**
 * At most 12 actions: up to 11 mixed ops, then in about 4 runs of 5 a final
 * jump, so most runs end past INSULT_TIME (a fork clears the latest sample;
 * without the final jump 43 of the 100 PBT_PARAMS runs ended with none and only
 * 49 past INSULT_TIME; with it, 68 of 100 end past INSULT_TIME with no
 * Found_Side, measured once). Hint ops past MAX_HINT_REVEALS are dropped.
 */
const arbMixedOps: fc.Arbitrary<Op[]> = fc
  .array(
    fc.oneof(
      { weight: 3, arbitrary: arbSampleOp },
      { weight: 6, arbitrary: arbJumpOp },
      { weight: 4, arbitrary: arbExamOp },
      { weight: 1, arbitrary: arbViewOp },
      { weight: 1, arbitrary: arbPlaybackOp },
      { weight: 2, arbitrary: arbForkOp },
      { weight: 2, arbitrary: arbHintOp },
    ),
    // `size: 'max'` draws lengths over the whole 0..12 range instead of mostly short ones.
    { maxLength: 11, size: 'max' },
  )
  .map((ops) => {
    let hints = 0;
    return ops.filter((op) => op.kind !== 'hint' || ++hints <= MAX_HINT_REVEALS);
  });
const arbOps: fc.Arbitrary<Op[]> = fc
  .tuple(arbMixedOps, fc.option(arbJumpOp, { freq: 5, nil: undefined }))
  .map(([ops, last]) => (last === undefined ? ops : [...ops, last]));

interface Run {
  state: SessionUiState;
  branchStart: number;
  forks: number;
}

function startRun(caseData: CaseData, variantId: string): Run {
  const setup: SessionAction[] = [
    { type: 'caseLoaded', caseData, storedView: 'play' },
    { type: 'sessionLoaded', session: session(variantId) },
    {
      type: 'checkpointsLoaded',
      byBranch: { b1: [{ checkpoint_id: 'c1', simulation_time: 42, created_at: '', is_automatic: true }] },
    },
    { type: 'connectionChanged', connected: true },
  ];
  return { state: setup.reduce(sessionReducer, initialSessionState()), branchStart: 0, forks: 0 };
}

function sample(t: number, op: Extract<Op, { kind: 'sample' }>): VitalSigns {
  return {
    simulation_time: t,
    heart_rate: op.heartRate,
    respiratory_rate: 16,
    spo2: op.spo2,
    mean_arterial_pressure: op.map,
    etco2: 40,
    tidal_volume: op.tidalVolume,
  };
}

/** Turns an Op into a valid action for the run's state (as `toAction` in sessionState.test.ts). */
function toAction(run: Run, op: Op, step: number): SessionAction {
  const { state } = run;
  const now = state.latestSample?.simulation_time ?? run.branchStart;
  const wallClockTime = new Date(Date.UTC(2026, 10, 20, 10, 0, step)).toISOString();
  switch (op.kind) {
    case 'sample':
      return { type: 'sampleReceived', sample: sample(now + op.offset, op) };
    case 'exam':
      return { type: 'examPerformed', actionId: op.actionId, side: null, wallClockTime };
    case 'view':
      return { type: 'viewSelected', view: op.view };
    case 'playback':
      return { type: 'playbackChanged', playing: op.playing, speed: op.speed };
    case 'hint':
      return { type: 'hintRevealed', wallClockTime };
    case 'fork': {
      const parentId = state.currentBranchId!;
      const forkTime = run.branchStart + Math.round(op.at * (now - run.branchStart) * 2) / 2;
      const newBranchId = `fork${run.forks + 1}`;
      const next: SessionMetadata = {
        ...state.session!,
        current_branch_id: newBranchId,
        branches: [
          ...(state.session!.branches ?? []),
          {
            branch_id: newBranchId,
            parent_branch_id: parentId,
            forked_from_checkpoint: `${parentId}-cp-${forkTime}`,
            created_at: '2026-11-20T10:06:00Z',
            event_count: 0,
          },
        ],
      };
      return { type: 'forkSucceeded', session: next, newBranchId, forkTime };
    }
  }
}

function step(run: Run, op: Op, i: number): void {
  const action = toAction(run, op, i);
  run.state = sessionReducer(run.state, action);
  if (action.type === 'forkSucceeded') {
    run.branchStart = action.forkTime;
    run.forks += 1;
  }
}

// ---------------------------------------------------------------------------
// Markup checks
// ---------------------------------------------------------------------------

/** HTML escaping as renderToStaticMarkup does it for text and attribute values. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

function decodeHtml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, '&');
}

/** Attributes that give an accessible name or other text a Casual_Player can perceive. */
const ACCESSIBLE_TEXT_ATTRS = new Set(['aria-label', 'aria-description', 'aria-valuetext', 'title', 'alt', 'placeholder']);

/** Every attribute of every tag, decoded. */
function attributes(html: string): { name: string; value: string }[] {
  const out: { name: string; value: string }[] = [];
  for (const tag of html.match(/<[^>]*>/g) ?? []) {
    for (const m of tag.matchAll(/\s([^\s="'<>/]+)="([^"]*)"/g)) out.push({ name: m[1], value: decodeHtml(m[2]) });
  }
  return out;
}

/**
 * What a Casual_Player perceives as text: every text node (tags removed,
 * entities decoded) and the value of every accessible-text attribute.
 */
function perceivableTexts(html: string): string[] {
  const nodes = html
    .split(/<[^>]*>/)
    .map(decodeHtml)
    .filter((t) => t.trim() !== '');
  const attrs = attributes(html)
    .filter((a) => ACCESSIBLE_TEXT_ATTRS.has(a.name))
    .map((a) => a.value);
  return [...nodes, ...attrs];
}

/** The Exam_Button and Intervention texts of a Resolved_Case (Play_Label and clinical `label`). */
function sideTextsAllowed(caseData: CaseData): string[] {
  const exam = examButtons(caseData.play!.exam!)
    .flat()
    .map((b) => b.text);
  const interventions = caseData.interventions.flatMap((i) => [i.label, playButtonText(i)]);
  // Longest first, so a text that contains a shorter one is removed whole.
  return [...new Set([...exam, ...interventions])].sort((a, b) => b.length - a.length);
}

/**
 * The app's fixed "remaining" wording as rendered for `state` (design Property 17):
 * - the Hint button text for every count 0..hints.length, from HintPanel's own
 *   `hintButtonText` and `NO_HINTS_LEFT_TEXT`;
 * - the Goal bar time label. GoalBar exports neither its `M:SS left` template
 *   nor its `Time left` aria-label, so the label is built here from the same
 *   helpers (`formatMSS`, `remainingSeconds`) and inputs GoalBar gets from
 *   PlayView (the Time_Limit and the latest sample's Simulation_Time), and
 *   `Time left` is a literal copy of the aria-label.
 * Only these exact strings are removed, so a Side_Word next to them still counts.
 */
function fixedRemainingTexts(state: SessionUiState): string[] {
  const play = state.caseData!.play!;
  const hintTexts = Array.from({ length: play.hints.length + 1 }, (_, n) => hintButtonText(n));
  const out = [...hintTexts, NO_HINTS_LEFT_TEXT];
  const limit = play.endings.lost.timeLimitSeconds;
  if (limit !== undefined) {
    const latestTime = state.latestSample?.simulation_time ?? null;
    out.push(`${formatMSS(remainingSeconds(limit, latestTime))} left`, 'Time left');
  }
  return out;
}

/** Every text allowed to hold a Side_Word in `state`'s markup, longest first. */
function allowedTexts(caseData: CaseData, state: SessionUiState): string[] {
  return [...new Set([...sideTextsAllowed(caseData), ...fixedRemainingTexts(state)])].sort(
    (a, b) => b.length - a.length,
  );
}

const SIDE_WORD = /\b(left|right)\b/gi;

/** Side_Words left after removing every allowed text, with 40 characters of context each. */
function straySideWords(html: string, allowed: string[]): string[] {
  const found: string[] = [];
  for (const text of perceivableTexts(html)) {
    let rest = text;
    for (const a of allowed) rest = rest.split(a).join(' ');
    for (const m of rest.matchAll(SIDE_WORD)) {
      const at = m.index ?? 0;
      found.push(`"${m[0]}" in …${rest.slice(Math.max(0, at - 40), at + 40)}…`);
    }
  }
  return found;
}

/** Throws with a short window around the first difference of two markup strings. */
function expectSameMarkup(view: string, left: string, right: string): void {
  if (left === right) return;
  let i = 0;
  while (i < left.length && i < right.length && left[i] === right[i]) i++;
  const from = Math.max(0, i - 120);
  throw new Error(
    `${view} markup differs at index ${i} (lengths ${left.length} and ${right.length})\n` +
      `left : …${left.slice(from, i + 120)}…\n` +
      `right: …${right.slice(from, i + 120)}…`,
  );
}

/** Runs one generated sequence on both Variants; returns the final states. */
function runBoth(ops: Op[]): { id: string; caseData: CaseData; state: SessionUiState }[] {
  return VARIANTS.map(({ id, caseData }) => {
    const run = startRun(caseData, id);
    ops.forEach((op, i) => {
      step(run, op, i);
      // Guard: no Ending in either run (the generator cannot reach one), and fewer Hint reveals than defined.
      expect(run.state.ending.ending).toBe('none');
      expect(run.state.hintsRevealed).toBeLessThan(HINT_COUNT);
      expect(run.state.interventionRecord).toEqual([]);
    });
    return { id, caseData, state: run.state };
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('screen symmetry across Variants (bedside-exam 16.1)', () => {
  it('the fixtures differ only where the Variants differ, and the views render the exam layout', () => {
    expect(CASE_LEFT.play!.hints).toHaveLength(CASE_RIGHT.play!.hints.length);
    expect(HINT_COUNT).toBeGreaterThan(1);
    expect(NEUTRAL_EXAM_IDS.length).toBeGreaterThan(0);
    expect(CASE_RIGHT.play!.exam).toEqual(CASE_LEFT.play!.exam);
    expect(CASE_LEFT.play!.sideRevealText).toBeTruthy();
    expect(CASE_RIGHT.play!.sideRevealText).toBeTruthy();
    expect(CASE_RIGHT.play!.sideRevealText).not.toBe(CASE_LEFT.play!.sideRevealText);
    expect(sideTextsAllowed(CASE_RIGHT)).toEqual(sideTextsAllowed(CASE_LEFT));

    const [left, right] = runBoth([]);
    expect(left.state.session?.variant_id).toBe('left');
    expect(right.state.session?.variant_id).toBe('right');
    const markup = renderBoth(left.state);
    // No empty pass: the Play markup holds the exam layout, the Clinician markup the Intervention panel.
    expect(markup.play).toContain('data-control="exam"');
    expect(markup.play).toContain('data-part="findings-column"');
    expect(markup.clinician).toContain('Interventions');
  });

  it('at t = 60 s the insult has made a different side swollen, yet the side gate keeps the markup equal', () => {
    expect(INSULT_TIME).toBeLessThan(60);
    const at60: Op = { kind: 'sample', offset: 60, heartRate: 125, spo2: 0.9, map: 90, tidalVolume: 480 };
    const [left, right] = runBoth([at60]);
    expect(left.state.latestSample?.simulation_time).toBe(60);
    expect(right.state.latestSample?.simulation_time).toBe(60);

    // Ungated, the Variants differ: the insult has started on each Variant's side.
    expect(computeSides(60, left.caseData.timeline!.scheduledInsults, []).swollenSides).toEqual(['Left']);
    expect(computeSides(60, right.caseData.timeline!.scheduledInsults, []).swollenSides).toEqual(['Right']);
    // Gated: no side is found, so neither Avatar draws a swollen side.
    expect(left.state.avatar.swollenSides).toEqual([]);
    expect(right.state.avatar.swollenSides).toEqual([]);

    const a = renderBoth(left.state);
    const b = renderBoth(right.state);
    expectSameMarkup('PlayView', a.play, b.play);
    expectSameMarkup('ClinicianView', a.clinician, b.clinician);
  });


  // Feature: bedside-exam, Property 17: Both views render the same markup in both Variants before the side is found
  describe('Property 17: Both views render the same markup in both Variants before the side is found', () => {
    it('equal markup strings, no Side_Reveal_Text and no Variant_Id in any attribute', () => {
      /** Validates: Requirements 9.6, 10.4, 10.6, 10.7, 10.8, 10.9, 11.5, 12.6, 14.2 */
      fc.assert(
        fc.property(arbOps, (ops) => {
          const [left, right] = runBoth(ops);
          const a = renderBoth(left.state);
          const b = renderBoth(right.state);

          expectSameMarkup('PlayView', a.play, b.play);
          expectSameMarkup('ClinicianView', a.clinician, b.clinician);

          for (const html of [a.play, a.clinician]) {
            // No Side_Reveal_Text of either Variant and no side-reveal element.
            expect(html).not.toContain('data-part="side-reveal"');
            for (const v of VARIANTS) expect(html).not.toContain(escapeHtml(v.caseData.play!.sideRevealText!));

            // No Variant_Id as a whole token in any attribute value. `class` is
            // skipped (CSS utilities such as `text-left`); accessible-text attributes
            // are covered with the text nodes by the Side_Word test below.
            for (const attr of attributes(html)) {
              if (attr.name === 'class' || ACCESSIBLE_TEXT_ATTRS.has(attr.name)) continue;
              for (const v of VARIANTS) {
                const token = new RegExp(`(^|[^A-Za-z0-9_-])${v.id}($|[^A-Za-z0-9_-])`);
                if (token.test(attr.value)) {
                  throw new Error(`Variant_Id "${v.id}" in ${attr.name}="${attr.value}"`);
                }
              }
            }
          }
        }),
        PBT_PARAMS,
      );
    });

    it('Side_Words only in the Exam_Button and Intervention texts and the fixed "remaining" wording', () => {
      /** Validates: Requirements 9.6, 10.4, 10.6, 10.7, 10.8, 10.9, 11.5, 12.6, 14.2 */
      fc.assert(
        fc.property(arbOps, (ops) => {
          for (const run of runBoth(ops)) {
            const markup = renderBoth(run.state);
            const allowed = allowedTexts(run.caseData, run.state);
            for (const [view, html] of [
              ['PlayView', markup.play],
              ['ClinicianView', markup.clinician],
            ] as const) {
              const stray = straySideWords(html, allowed);
              if (stray.length > 0) {
                throw new Error(`variant '${run.id}', ${view}: Side_Words outside the allowed texts:\n${stray.join('\n')}`);
              }
            }
          }
        }),
        PBT_PARAMS,
      );
    });
  });
});
