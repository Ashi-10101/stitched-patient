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
 *
 * patient-speech task 7.4 adds Property 9 at the end of this file: the same
 * symmetry with speech, over runs that cross the insult time, the hold,
 * rotation, the mirrored needle and both Endings (Requirement 8.4).
 */

import { describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import { renderToStaticMarkup } from 'react-dom/server';
import { examButtons, isSidedAction } from '@/lib/examFinding';
import { buildInterventionEntry } from '@/lib/interventionRecord';
import { interventionSide, playButtonText } from '@/lib/playCase';
import {
  initialSessionState,
  sessionReducer,
  type SessionAction,
  type SessionUiState,
  type View,
} from '@/lib/sessionState';
import { computeSides } from '@/lib/sides';
import { checkedScriptedLine, targetSpeechKey } from '@/lib/speechSelector';
import { selectStatus } from '@/lib/statusSelector';
import { formatMSS, remainingSeconds } from '@/lib/timeFormat';
import type { SimulationSessionActions, SimulationSessionNotices } from '@/hooks/useSimulationSession';
import { CASE_LEFT, CASE_RIGHT } from '@/test/caseFixtures';
import { PBT_PARAMS } from '@/test/pbt';
import type { CaseData, PlaybackSpeed, SessionMetadata, Side, VitalSigns } from '@/types';
import { ClinicianView } from './ClinicianView';
import { hintButtonText, NO_HINTS_LEFT_TEXT } from './HintPanel';
import { NOT_AVAILABLE_TEXT, PlayView } from './PlayView';

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
    play: renderToStaticMarkup(
      <PlayView
        sim={{
          state,
          statusSentence,
          speech: checkedScriptedLine(state.speech, state.caseData),
          actions: stubActions(),
          notices: NOTICES,
        }}
      />,
    ),
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

// ---------------------------------------------------------------------------
// patient-speech task 7.4: Property 9, screen symmetry with speech
//
// The generator of Property 17 above, extended so that runs cross the
// Earliest_Insult_Time and the hold, stay on one Speech_Key long enough to
// rotate and wrap, apply the needle and reach both Endings:
// - `burst`: `count` samples `step` s apart with the same vitals;
// - `needle`: the needle on the Variant's affected side, or on the other side.
//   The same op is the left needle in the `left` run and the right needle in
//   the `right` run (or the reverse for `other`), so the two runs stay mirror
//   images of each other;
// - a sample of SpO2 0.8, below the Lost_Condition, so `lost` is reachable.
// The vitals are test inputs, not clinical values.
//
// Before a needle and without an Ending both views must render the same
// markup string, as in Property 17. A needle or an Ending puts side-specific
// marks on the chest drawing and shows the Variant's own Side_Reveal_Text, so
// from then on the markup is compared after `mirrorNormalised`, which changes
// only those marks and that one element. The speech bubble and the speech live
// region are never normalised, and their texts are also compared directly.
// ---------------------------------------------------------------------------

type SampleOp = Extract<Op, { kind: 'sample' }>;
type SampleVitals = Omit<SampleOp, 'kind' | 'offset'>;
type NeedleOp = { kind: 'needle'; which: 'affected' | 'other' };

type Op9 =
  | Op
  /** `count` samples `step` s apart with the same vitals: a steady stretch. */
  | { kind: 'burst'; step: number; count: number; vitals: SampleVitals }
  | NeedleOp;

/** Every vital in its normal band: the `defaultSentence`, and the rescue conditions hold. */
const CALM: SampleVitals = { heartRate: 80, spo2: 0.97, map: 90, tidalVolume: 500 };
/** SpO2 below the case's Lost_Condition (SpO2 < 0.85). */
const LOW_SPO2: SampleVitals = { heartRate: 125, spo2: 0.8, map: 90, tidalVolume: 480 };

const arbVitals9: fc.Arbitrary<SampleVitals> = fc.oneof(
  { weight: 3, arbitrary: fc.constant(CALM) },
  {
    weight: 3,
    arbitrary: fc.record({
      heartRate: fc.constantFrom(80, 125, 170),
      spo2: fc.constantFrom(0.97, 0.9, 0.86),
      map: fc.constantFrom(90, 65),
      tidalVolume: fc.constantFrom(0, 480, 500),
    }),
  },
  { weight: 1, arbitrary: fc.constant(LOW_SPO2) },
);

function arbSample9(offset: fc.Arbitrary<number>): fc.Arbitrary<Op9> {
  return fc.tuple(offset, arbVitals9).map(([o, v]): Op9 => ({ kind: 'sample', offset: o, ...v }));
}

/** Steps of 2 to 6 s: up to 5 s a burst also starts a new Branch (STALE_TOLERANCE_S). */
const arbBurstOp: fc.Arbitrary<Op9> = fc.record({
  kind: fc.constant('burst' as const),
  step: fc.integer({ min: 2, max: 6 }),
  count: fc.integer({ min: 2, max: 12 }),
  vitals: arbVitals9,
});
const arbNeedleOp: fc.Arbitrary<Op9> = fc.oneof(
  { weight: 3, arbitrary: fc.constant<Op9>({ kind: 'needle', which: 'affected' }) },
  { weight: 1, arbitrary: fc.constant<Op9>({ kind: 'needle', which: 'other' }) },
);

/** Up to three samples 1 to 9 s apart from t = 0, so all of them lie before INSULT_TIME (30 s). */
const arbPreInsult: fc.Arbitrary<Op9[]> = fc.array(arbSample9(fc.integer({ min: 1, max: 9 })), { maxLength: 3 });

const arbMixed9: fc.Arbitrary<Op9[]> = fc
  .array(
    fc.oneof(
      { weight: 3, arbitrary: arbSample9(fc.integer({ min: 1, max: 24 }).map((n) => n / 2)) },
      { weight: 2, arbitrary: arbSample9(fc.integer({ min: 60, max: 80 }).map((n) => n / 2)) },
      { weight: 4, arbitrary: arbBurstOp },
      { weight: 2, arbitrary: arbNeedleOp },
      { weight: 2, arbitrary: arbExamOp },
      { weight: 1, arbitrary: arbViewOp },
      { weight: 1, arbitrary: arbPlaybackOp },
      { weight: 2, arbitrary: arbForkOp },
      { weight: 1, arbitrary: arbHintOp },
    ),
    { maxLength: 8, size: 'max' },
  )
  .map((ops) => {
    let hints = 0;
    return ops.filter((op) => op.kind !== 'hint' || ++hints <= MAX_HINT_REVEALS);
  });

/**
 * Tail toward `rescued`: 35 to 70 s of calm vitals (past INSULT_TIME, so the
 * needle is a Gate_Entry; long enough for the `early` lines to rotate and often
 * to wrap), the affected-side needle, then calm vitals for longer than the
 * rescue Hold_Duration (30 s). Steps of at most 5 s, so the tail also runs on a
 * Branch that a fork has just started.
 */
const arbRescueTail: fc.Arbitrary<Op9[]> = fc
  .tuple(fc.integer({ min: 7, max: 14 }), fc.integer({ min: 3, max: 5 }))
  .map(([calmCount, step]): Op9[] => [
    { kind: 'burst', step: 5, count: calmCount, vitals: CALM },
    { kind: 'needle', which: 'affected' },
    { kind: 'burst', step, count: Math.ceil(30 / step) + 2, vitals: CALM },
  ]);
/** Tail toward `lost`: SpO2 below the Lost_Condition for longer than its Hold_Duration (30 s). */
const arbLostTail: fc.Arbitrary<Op9[]> = fc.constant<Op9[]>([{ kind: 'burst', step: 5, count: 8, vitals: LOW_SPO2 }]);

const arbOps9: fc.Arbitrary<Op9[]> = fc
  .tuple(
    arbPreInsult,
    arbMixed9,
    fc.oneof(
      { weight: 3, arbitrary: arbRescueTail },
      { weight: 1, arbitrary: arbLostTail },
      { weight: 1, arbitrary: fc.constant<Op9[]>([]) },
    ),
  )
  .map(([pre, mixed, tail]) => [...pre, ...mixed, ...tail]);

/** A burst becomes its samples; every other op stays one step. */
function microOps(op: Op9): (Op | NeedleOp)[] {
  if (op.kind !== 'burst') return [op];
  return Array.from({ length: op.count }, (): Op => ({ kind: 'sample', offset: op.step, ...op.vitals }));
}

/** `parameters.side` of the Variant's Tension Pneumothorax insult. */
function affectedSide(caseData: CaseData): Side {
  const side = caseData.timeline!.scheduledInsults.find((i) => i.action === 'SETensionPneumothorax')!.parameters.side;
  if (side !== 'Left' && side !== 'Right') throw new Error(`unexpected insult side ${String(side)}`);
  return side;
}

/**
 * The needle Intervention as the hook records it (`buildInterventionEntry` at
 * the current Simulation_Time on the current Branch). `null` after an Ending,
 * because the Play_View disables the Intervention buttons then (play-mode 7.7).
 */
function needleAction(run: Run, op: NeedleOp): SessionAction | null {
  const { state } = run;
  if (state.ending.ending !== 'none') return null;
  const caseData = state.caseData!;
  const affected = affectedSide(caseData);
  const side: Side = op.which === 'affected' ? affected : affected === 'Left' ? 'Right' : 'Left';
  const intervention = caseData.interventions.find((i) => interventionSide(i) === side)!;
  const now = state.latestSample?.simulation_time ?? run.branchStart;
  return { type: 'interventionSucceeded', entry: buildInterventionEntry(intervention, now, state.currentBranchId!) };
}

function step9(run: Run, op: Op | NeedleOp, i: number): void {
  if (op.kind !== 'needle') {
    step(run, op, i);
    return;
  }
  const action = needleAction(run, op);
  if (action !== null) run.state = sessionReducer(run.state, action);
}

const SIDE_MARK = /<(?:rect|line)\s[^>]*?data-side="(Left|Right)"[^>]*>(?:<\/(?:rect|line)>)?/g;
const SIDE_MARK_TOKEN = /<side-mark [^>]*><\/side-mark>/g;
const SIDE_MARK_RUN = /(?:<side-mark [^>]*><\/side-mark>)+/g;
const SIDE_REVEAL_OPEN = '<p data-part="side-reveal" class="text-base">';

/**
 * Mirror normalisation for one Variant's markup. Changes only:
 * - each chest element with `data-side` (chest half, needle, bandage): it
 *   becomes a token with its `data-part` and whether its side is the Variant's
 *   affected side or the other side; the tokens of one block are sorted,
 *   because the Avatar draws the sides in a fixed Left, Right order;
 * - the Variant's own Side_Reveal_Text inside the `side-reveal` element.
 * Text anywhere else, the speech bubble and the speech live region included,
 * stays as rendered.
 */
function mirrorNormalised(html: string, caseData: CaseData): string {
  const affected = affectedSide(caseData);
  const tokens = html.replace(SIDE_MARK, (mark: string, side: string) => {
    const part = /data-part="([^"]*)"/.exec(mark)?.[1] ?? '';
    return `<side-mark data-part="${part}" data-relative="${side === affected ? 'affected' : 'other'}"></side-mark>`;
  });
  const sorted = tokens.replace(SIDE_MARK_RUN, (block) => (block.match(SIDE_MARK_TOKEN) ?? []).sort().join(''));
  const reveal = `${SIDE_REVEAL_OPEN}${escapeHtml(caseData.play!.sideRevealText!)}</p>`;
  return sorted.split(reveal).join(`${SIDE_REVEAL_OPEN}[Side_Reveal_Text]</p>`);
}

/** Text of every speech bubble, in markup order (the Avatar's `speech-bubble` part). */
function bubbleTexts(html: string): string[] {
  return [...html.matchAll(/data-part="speech-bubble"[^>]*><p class="whitespace-pre-wrap">([^<]*)<\/p>/g)].map((m) =>
    decodeHtml(m[1]),
  );
}

/** Text of every speech live region (`speech-live`), in markup order; '' for an empty region. */
function liveRegionTexts(html: string): string[] {
  return [...html.matchAll(/<div data-part="speech-live"[^>]*>(.*?)<\/div>/g)].map((m) =>
    decodeHtml(m[1].replace(/<[^>]*>/g, '')),
  );
}

/** The markup from the Ending_Screen's dialog element on, or '' without an Ending_Screen. */
function endingScreenMarkup(html: string): string {
  const at = html.indexOf('data-part="ending-screen"');
  return at < 0 ? '' : html.slice(at);
}

const GUARDS = [
  'speechShown',
  'silenceBeforeInsult',
  'firstEarly',
  'keyChange',
  'held',
  'rotation',
  'rotationFromZero',
  'wrap',
  'statusLine',
  'rescuedOnEndingScreen',
  'lostEnding',
  'silenceAfterGateOpens',
] as const;
type Guard = (typeof GUARDS)[number];
type Coverage = Record<Guard, number>;

function emptyCoverage(): Coverage {
  return Object.fromEntries(GUARDS.map((g) => [g, 0])) as Coverage;
}

/**
 * Counts what one accepted step of one run reached. `prev` and `next` are the
 * run's states around the step; `play` is `next`'s Play_View markup.
 */
function observe(cov: Coverage, prev: SessionUiState, next: SessionUiState, op: Op | NeedleOp, play: string): void {
  const caseData = next.caseData!;
  const speech = checkedScriptedLine(next.speech, caseData);
  const bubbles = bubbleTexts(play);
  const ending = next.ending.ending;
  if (speech !== null && bubbles.includes(speech)) cov.speechShown += 1;
  if (ending === 'lost' && bubbles.length === 0) cov.lostEnding += 1;
  if (
    ending === 'rescued' &&
    next.speech?.key === 'rescued' &&
    speech !== null &&
    bubbleTexts(endingScreenMarkup(play)).includes(speech)
  ) {
    cov.rescuedOnEndingScreen += 1;
  }

  // The rest needs a sample that was folded into the Speech_State.
  const folded = op.kind === 'sample' && next.speechLastTime !== prev.speechLastTime && next.latestSample !== null;
  if (!folded || next.speech === null) return;
  const t = next.latestSample!.simulation_time;
  const before = prev.speech;
  const after = next.speech;
  const gate = prev.endingCtx.rescueGateTime;
  const sameBranch = before !== null && before.branchId === after.branchId;

  if (t < INSULT_TIME && after.key === 'silent' && bubbles.length === 0) cov.silenceBeforeInsult += 1;
  if (after.key === 'early' && after.index === 0 && (!sameBranch || before!.key !== 'early')) cov.firstEarly += 1;
  if (sameBranch && before!.key !== after.key) cov.keyChange += 1;
  if (
    sameBranch &&
    after === before &&
    targetSpeechKey({ sample: next.latestSample, caseData, ending, simulationTime: t, rescueGateTime: gate }) !==
      before!.key
  ) {
    cov.held += 1;
  }
  if (sameBranch && before!.key === after.key && before!.index !== after.index) {
    cov.rotation += 1;
    if (before!.index === 0) cov.rotationFromZero += 1;
    if (after.index === 0) cov.wrap += 1;
  }
  if (after.key.startsWith('status:') && speech !== null && bubbles.includes(speech)) cov.statusLine += 1;
  if (
    ending === 'none' &&
    gate !== null &&
    Number.isFinite(gate) &&
    gate <= t &&
    after.key === 'silent' &&
    bubbles.length === 0
  ) {
    cov.silenceAfterGateOpens += 1;
  }
}

/** Before any needle and without an Ending, the conditions of Property 17 hold. */
function unmirrored(state: SessionUiState): boolean {
  return state.ending.ending === 'none' && state.interventionRecord.length === 0;
}

describe('screen symmetry with speech (patient-speech 7.4)', () => {
  // Feature: patient-speech, Property 9: Screen symmetry holds with speech
  it('Property 9: Screen symmetry holds with speech', () => {
    /** Validates: Requirements 8.4 */
    const coverage: Record<string, Coverage> = { left: emptyCoverage(), right: emptyCoverage() };
    expect(CASE_RIGHT.play!.speech).toEqual(CASE_LEFT.play!.speech);
    expect(affectedSide(CASE_LEFT)).toBe('Left');
    expect(affectedSide(CASE_RIGHT)).toBe('Right');

    fc.assert(
      fc.property(arbOps9, (ops) => {
        const runs = VARIANTS.map(({ id, caseData }) => ({ id, caseData, run: startRun(caseData, id) }));
        let i = 0;
        for (const op of ops.flatMap(microOps)) {
          const prevStates = runs.map((r) => r.run.state);
          for (const r of runs) step9(r.run, op, i);
          i += 1;
          expect(runs.every((r) => r.run.state.hintsRevealed < HINT_COUNT)).toBe(true);

          const [left, right] = runs;
          const a = renderBoth(left.run.state);
          const b = renderBoth(right.run.state);

          // The speech itself: the same Displayed_Speech, bubbles and live region.
          expect(checkedScriptedLine(right.run.state.speech, right.caseData)).toBe(
            checkedScriptedLine(left.run.state.speech, left.caseData),
          );
          expect(bubbleTexts(b.play)).toEqual(bubbleTexts(a.play));
          expect(liveRegionTexts(b.play)).toEqual(liveRegionTexts(a.play));
          // Exactly one speech live region at a time (patient-speech 7.5, 7.7, D8).
          expect(liveRegionTexts(a.play)).toHaveLength(1);

          // The whole markup: exactly equal under the conditions of Property 17,
          // and equal after the mirror normalisation always.
          if (unmirrored(left.run.state) && unmirrored(right.run.state)) {
            expectSameMarkup('PlayView', a.play, b.play);
            expectSameMarkup('ClinicianView', a.clinician, b.clinician);
          }
          expectSameMarkup('PlayView (mirrored)', mirrorNormalised(a.play, left.caseData), mirrorNormalised(b.play, right.caseData));
          expectSameMarkup(
            'ClinicianView (mirrored)',
            mirrorNormalised(a.clinician, left.caseData),
            mirrorNormalised(b.clinician, right.caseData),
          );

          runs.forEach((r, k) => {
            const markup = k === 0 ? a : b;
            const other = VARIANTS[1 - k].caseData.play!.sideRevealText!;
            // The own Side_Reveal_Text only on an Ending_Screen; the other Variant's never.
            const ownReveal = `${SIDE_REVEAL_OPEN}${escapeHtml(r.caseData.play!.sideRevealText!)}</p>`;
            expect(markup.play.split(ownReveal).length - 1).toBe(r.run.state.ending.ending === 'none' ? 0 : 1);
            for (const html of [markup.play, markup.clinician]) expect(html).not.toContain(escapeHtml(other));
            // Side_Words only in the allowed texts of Property 17, speech included,
            // plus the disabled Intervention button text "Not available right now"
            // (after an Ending), whose "right" names no side; it is equal in both Variants.
            const allowed = [...allowedTexts(r.caseData, r.run.state), NOT_AVAILABLE_TEXT].sort(
              (x, y) => y.length - x.length,
            );
            for (const [view, html] of [
              ['PlayView', markup.play],
              ['ClinicianView', markup.clinician],
            ] as const) {
              const stray = straySideWords(mirrorNormalised(html, r.caseData), allowed);
              if (stray.length > 0) {
                throw new Error(`variant '${r.id}', ${view}: Side_Words outside the allowed texts:\n${stray.join('\n')}`);
              }
            }
            observe(coverage[r.id], prevStates[k], r.run.state, op, markup.play);
          });
        }
      }),
      PBT_PARAMS,
    );

    // Non-vacuity: every guard was reached on both sides.
    for (const id of ['left', 'right']) {
      for (const g of GUARDS) {
        if (coverage[id][g] <= 0) throw new Error(`guard '${g}' never reached in variant '${id}'`);
      }
    }
  }, 300_000);
});
