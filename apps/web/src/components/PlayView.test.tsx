import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import fc from 'fast-check';
import { renderToStaticMarkup } from 'react-dom/server';
import { activeExamEntries } from '@/lib/branchLineage';
import { examButtons } from '@/lib/examFinding';
import { buildExamEntry } from '@/lib/examRecord';
import { buildInterventionEntry } from '@/lib/interventionRecord';
import { PBT_PARAMS } from '@/test/pbt';
import { playButtonText } from '@/lib/playCase';
import type { Ending } from '@/lib/endingEvaluator';
import { initialSessionState, sessionReducer, type SessionAction, type SessionUiState } from '@/lib/sessionState';
import { checkedScriptedLine } from '@/lib/speechSelector';
import type { SimulationSessionActions, SimulationSessionNotices } from '@/hooks/useSimulationSession';
import { CASE } from '@/test/caseFixtures';
import type { CaseData, SessionMetadata, VitalSigns } from '@/types';
import { SKIN_PALETTES } from './StitchedPatient';
import {
  INTERVENTION_ERROR_TEXT,
  NOT_AVAILABLE_TEXT,
  PAUSE_FAILED_TEXT,
  PlayView,
  REWIND_BUTTON_TEXT,
  STREAM_STOPPED_TEXT,
  WHAT_CAN_YOU_DO_TEXT,
  examButtonsDisabled,
  interventionDoneText,
  interventionsDisabled,
  initialRewindOpener,
  rewindPanelOpenerReducer,
  type InterventionsDisabledInput,
} from './PlayView';

const SESSION: SessionMetadata = {
  session_id: 's1',
  case_id: CASE.id,
  created_at: '',
  current_branch_id: 'b1',
  branches: [{ branch_id: 'b1', created_at: '', event_count: 0 }],
};

/** Normal-band vitals for the fixture case, at time `t`. */
function sample(t: number, over: Partial<VitalSigns> = {}): VitalSigns {
  return {
    simulation_time: t,
    heart_rate: 80,
    respiratory_rate: 16,
    spo2: 0.97,
    mean_arterial_pressure: 90,
    etco2: 40,
    tidal_volume: 500,
    ...over,
  };
}

function build(...actions: SessionAction[]): SessionUiState {
  return actions.reduce(sessionReducer, initialSessionState());
}

function loaded(caseData: CaseData = CASE): SessionAction[] {
  return [
    { type: 'caseLoaded', caseData, storedView: 'play' },
    { type: 'sessionLoaded', session: SESSION },
    {
      type: 'checkpointsLoaded',
      byBranch: { b1: [{ checkpoint_id: 'c1', simulation_time: 42, created_at: '', is_automatic: true }] },
    },
    { type: 'connectionChanged', connected: true },
  ];
}

const LOADED = loaded();

/** Lost by the case's 600 s Time_Limit, on a critical-SpO2 sample (cyanotic Avatar snapshot). */
const LOST: SessionAction[] = [
  ...LOADED,
  { type: 'sampleReceived', sample: sample(10) },
  { type: 'sampleReceived', sample: sample(600, { spo2: 0.8 }) },
];

/** Rescue conditions held from t = 40 s for the case's 30 s hold. */
const RESCUED: SessionAction[] = [
  ...LOADED,
  // The case's Required_Intervention, so the Rescue_Gate_Time opens at 40 s (6.18).
  {
    type: 'interventionSucceeded',
    entry: buildInterventionEntry(CASE.interventions.find((i) => i.id === 'needle-decompression-left')!, 40, 'b1'),
  },
  { type: 'sampleReceived', sample: sample(40) },
  { type: 'sampleReceived', sample: sample(70) },
];

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

function render(
  state: SessionUiState,
  notices: Partial<SimulationSessionNotices> = {},
  statusSentence: string | null = null,
  /** The Displayed_Speech; by default the checked Scripted_Line, as the hook shows it. */
  speech: string | null = checkedScriptedLine(state.speech, state.caseData),
): string {
  return renderToStaticMarkup(
    <PlayView
      sim={{
        state,
        statusSentence,
        speech,
        actions: stubActions(),
        notices: { pauseFailed: false, streamError: null, ...notices },
      }}
    />,
  );
}

const ENDING_ROOT = 'data-part="ending-screen"';

/** Markup before the Ending_Screen root, and the Ending_Screen markup from its root on. */
function splitAtEnding(html: string): { view: string; ending: string | null } {
  const at = html.indexOf(ENDING_ROOT);
  if (at < 0) return { view: html, ending: null };
  const root = html.lastIndexOf('<div', at);
  return { view: html.slice(0, root), ending: html.slice(root) };
}

/**
 * End of the Intervention wrapper's markup: the findings column when present
 * (exam layout, where it follows the Intervention buttons), else the Hint panel.
 */
function interventionsEnd(html: string, start: number): number {
  const findings = html.indexOf('data-part="findings-column"', start);
  return findings >= 0 ? findings : html.indexOf('data-part="hint-panel"', start);
}

/** The Intervention buttons' markup, in render order. */
function interventionButtons(html: string): string[] {
  const start = html.indexOf('data-part="play-interventions"');
  const end = interventionsEnd(html, start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return html.slice(start, end).match(/<button[^>]*>.*?<\/button>/g) ?? [];
}

const textOf = (markup: string): string => markup.replace(/<[^>]+>/g, '');

/** aria-label of the Avatar SVG in the patient column. */
function patientAvatarName(html: string): string | undefined {
  const column = html.slice(html.indexOf('data-part="patient-column"'), html.indexOf('data-part="action-column"'));
  return /<svg role="img" aria-label="([^"]*)"/.exec(column)?.[1];
}

function hasStatusNotice(html: string, text: string): boolean {
  return new RegExp(`<p role="status"[^>]*>${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</p>`).test(html);
}

describe('PlayView', () => {
  it('shows one button per Intervention in case order with the Play_Labels, no clinical labels', () => {
    const buttons = interventionButtons(render(build(...LOADED, { type: 'sampleReceived', sample: sample(10) })));
    expect(buttons).toHaveLength(CASE.interventions.length);
    CASE.interventions.forEach((intervention, k) => {
      const text = textOf(buttons[k]);
      expect(text).toBe(playButtonText(intervention));
      expect(text).not.toContain(intervention.label);
    });
  });

  it('builds the Ending states through the reducer', () => {
    expect(build(...LOADED).ending.ending).toBe('none');
    expect(build(...LOST).ending.ending).toBe('lost');
    expect(build(...RESCUED).ending.ending).toBe('rescued');
  });

  it('shows the Rewind button with and without an Ending', () => {
    for (const actions of [LOADED, LOST, RESCUED]) {
      const { view } = splitAtEnding(render(build(...actions)));
      expect(view).toContain('data-control="rewind"');
      expect(view).toContain(`<span>${REWIND_BUTTON_TEXT}</span>`);
    }
  });

  it('renders the Ending_Screen only with an Ending', () => {
    const none = render(build(...LOADED));
    expect(none).not.toContain(ENDING_ROOT);
    expect(none).not.toContain('role="dialog"');

    for (const [actions, ending] of [
      [LOST, 'lost'],
      [RESCUED, 'rescued'],
    ] as const) {
      const html = render(build(...actions));
      const split = splitAtEnding(html);
      expect(split.ending).not.toBeNull();
      expect(split.ending).toMatch(/^<div role="dialog"[^>]*data-part="ending-screen"/);
      expect(split.ending).toContain(`data-ending="${ending}"`);
    }
  });

  it('draws the Ending_Screen Avatar from endingSnapshot', () => {
    // Lost on a critical-SpO2 sample, then a normal sample: the live Avatar is
    // healthy again while the snapshot stays cyanotic.
    const state = build(...LOST, { type: 'sampleReceived', sample: sample(610) });
    expect(state.endingSnapshot?.skinTone).toBe('cyanotic');
    expect(state.avatar.skinTone).toBe('healthy');

    const { view, ending } = splitAtEnding(render(state));
    expect(ending).not.toBeNull();
    expect(ending).toContain(SKIN_PALETTES.cyanotic.lips);
    expect(ending).not.toContain(SKIN_PALETTES.healthy.lips);
    expect(view).toContain(SKIN_PALETTES.healthy.lips);
    expect(view).not.toContain(SKIN_PALETTES.cyanotic.lips);
  });

  it('orders the controls: playback, Intervention buttons, Hint button, Rewind button', () => {
    const html = render(build(...LOADED));
    const playback = html.indexOf('aria-label="Play"');
    const firstIntervention = html.indexOf(playButtonText(CASE.interventions[0]));
    const lastIntervention = html.indexOf(playButtonText(CASE.interventions[CASE.interventions.length - 1]));
    const hint = html.indexOf('Hint (3 left)');
    const rewind = html.indexOf('data-control="rewind"');
    expect(playback).toBeGreaterThanOrEqual(0);
    expect(firstIntervention).toBeGreaterThan(playback);
    expect(lastIntervention).toBeGreaterThanOrEqual(firstIntervention);
    expect(hint).toBeGreaterThan(lastIntervention);
    expect(rewind).toBeGreaterThan(hint);
  });

  it('interventionsDisabled is false only when connected, nothing pending and no Ending', () => {
    const endings: Ending[] = ['none', 'rescued', 'lost'];
    for (const connected of [false, true]) {
      for (const interventionPending of [false, true]) {
        for (const forkPending of [false, true]) {
          for (const ending of endings) {
            const expected = !(connected && !interventionPending && !forkPending && ending === 'none');
            expect(interventionsDisabled({ connected, interventionPending, forkPending, ending })).toBe(expected);
          }
        }
      }
    }
  });

  it('disables the Intervention buttons with "Not available right now" when disconnected', () => {
    const off = interventionButtons(render(build(...LOADED, { type: 'connectionChanged', connected: false })));
    expect(off).toHaveLength(CASE.interventions.length);
    for (const b of off) {
      expect(b).toMatch(/^<button[^>]*\sdisabled=""/);
      expect(b).toContain(NOT_AVAILABLE_TEXT);
    }

    const on = interventionButtons(render(build(...LOADED)));
    expect(on).toHaveLength(CASE.interventions.length);
    for (const b of on) {
      expect(b).not.toMatch(/^<button[^>]*\sdisabled=""/);
      expect(b).not.toContain(NOT_AVAILABLE_TEXT);
    }
  });

  it("names the patient-column Avatar with statusSentence, else the case's defaultSentence", () => {
    const state = build(...LOADED);
    const sentence = 'He looks pale and is struggling to breathe.';
    expect(patientAvatarName(render(state, {}, sentence))).toBe(sentence);
    expect(patientAvatarName(render(state, {}, null))).toBe(CASE.play?.status.defaultSentence);
  });

  it('shows the pause-failed notice only when notices.pauseFailed is true', () => {
    const state = build(...LOADED);
    expect(hasStatusNotice(render(state, { pauseFailed: true }), PAUSE_FAILED_TEXT)).toBe(true);
    expect(render(state, { pauseFailed: false })).not.toContain(PAUSE_FAILED_TEXT);
  });

  it('shows the stream-stopped notice only with a stream error while disconnected', () => {
    const connected = build(...LOADED);
    const disconnected = build(...LOADED, { type: 'connectionChanged', connected: false });
    expect(hasStatusNotice(render(disconnected, { streamError: 'closed' }), STREAM_STOPPED_TEXT)).toBe(true);
    expect(render(connected, { streamError: 'closed' })).not.toContain(STREAM_STOPPED_TEXT);
    expect(render(disconnected, { streamError: null })).not.toContain(STREAM_STOPPED_TEXT);
    expect(render(connected, { streamError: null })).not.toContain(STREAM_STOPPED_TEXT);
  });

  it('renders nothing without a Play_Section or without case data', () => {
    const noPlay: CaseData = { ...CASE };
    delete noPlay.play;
    expect(render(build(...loaded(noPlay)))).toBe('');
    expect(render(initialSessionState())).toBe('');
  });

  it('has no tabindex and a root with class sp-play', () => {
    for (const actions of [LOADED, LOST]) {
      const html = render(build(...actions), { pauseFailed: true });
      expect(html.toLowerCase()).not.toContain('tabindex');
      expect(html).toMatch(/^<div data-part="play-view" class="sp-play /);
    }
  });

  it('exports the spec texts', () => {
    expect(interventionDoneText('Let the trapped air out - left side (needle)')).toBe(
      'Done: Let the trapped air out - left side (needle).',
    );
    expect(INTERVENTION_ERROR_TEXT).toBe("That didn't work. Please try again.");
    expect(PAUSE_FAILED_TEXT).toBe('The simulation could not be paused.');
    expect(STREAM_STOPPED_TEXT).toBe('The simulation stopped. Please reload the page.');
    expect(WHAT_CAN_YOU_DO_TEXT).toBe('What can you do?');
    expect(render(build(...LOADED))).toContain(WHAT_CAN_YOU_DO_TEXT);
  });
});

describe('rewindPanelOpenerReducer', () => {
  it('starts closed with origin view', () => {
    expect(initialRewindOpener).toEqual({ open: false, origin: 'view' });
  });

  it('open sets open and the origin', () => {
    for (const origin of ['view', 'ending'] as const) {
      expect(rewindPanelOpenerReducer(initialRewindOpener, { type: 'open', origin })).toEqual({ open: true, origin });
    }
  });

  it('close keeps the origin', () => {
    const opened = rewindPanelOpenerReducer(initialRewindOpener, { type: 'open', origin: 'ending' });
    expect(rewindPanelOpenerReducer(opened, { type: 'close' })).toEqual({ open: false, origin: 'ending' });
  });

  it('close when already closed returns the same object', () => {
    expect(rewindPanelOpenerReducer(initialRewindOpener, { type: 'close' })).toBe(initialRewindOpener);
    const closedEnding = { open: false, origin: 'ending' } as const;
    expect(rewindPanelOpenerReducer(closedEnding, { type: 'close' })).toBe(closedEnding);
  });

  it('a later open with view switches the origin', () => {
    let s = rewindPanelOpenerReducer(initialRewindOpener, { type: 'open', origin: 'ending' });
    s = rewindPanelOpenerReducer(s, { type: 'close' });
    s = rewindPanelOpenerReducer(s, { type: 'open', origin: 'view' });
    expect(s).toEqual({ open: true, origin: 'view' });
  });
});

describe('PlayView messages stack, Intervention variant and Hint row', () => {
  const STACK = 'data-part="play-messages"';
  const count = (html: string, needle: string): number => html.split(needle).length - 1;

  /** Markup of the single messages stack (it holds only <p> notices here; no toast in a static render). */
  function stackOf(html: string): string {
    const start = html.indexOf(STACK);
    expect(start).toBeGreaterThanOrEqual(0);
    return html.slice(start, html.indexOf('</div>', start));
  }

  const connected = build(...LOADED);
  const disconnected = build(...LOADED, { type: 'connectionChanged', connected: false });

  it('shows only the stream-stopped notice when only that condition holds', () => {
    const html = render(disconnected, { streamError: 'closed', pauseFailed: false });
    expect(count(html, STACK)).toBe(1);
    const stack = stackOf(html);
    expect(stack).toContain(STREAM_STOPPED_TEXT);
    expect(html).not.toContain(PAUSE_FAILED_TEXT);
  });

  it('shows only the pause-failed notice when only pauseFailed holds', () => {
    const html = render(connected, { pauseFailed: true, streamError: null });
    expect(count(html, STACK)).toBe(1);
    const stack = stackOf(html);
    expect(stack).toContain(PAUSE_FAILED_TEXT);
    expect(html).not.toContain(STREAM_STOPPED_TEXT);
  });

  it('shows both notices in the one stack when both conditions hold', () => {
    const html = render(disconnected, { pauseFailed: true, streamError: 'closed' });
    expect(count(html, STACK)).toBe(1);
    const stack = stackOf(html);
    expect(stack).toContain(PAUSE_FAILED_TEXT);
    expect(stack).toContain(STREAM_STOPPED_TEXT);
    expect(count(html, PAUSE_FAILED_TEXT)).toBe(1);
    expect(count(html, STREAM_STOPPED_TEXT)).toBe(1);
  });

  it('renders no messages stack when no message shows', () => {
    expect(render(connected)).not.toContain(STACK);
    expect(render(disconnected)).not.toContain(STACK);
  });

  it('when disconnected, "Not available right now" appears once per Intervention button and nowhere else', () => {
    const html = render(disconnected);
    expect(count(html, NOT_AVAILABLE_TEXT)).toBe(CASE.interventions.length);
    const buttons = interventionButtons(html);
    expect(buttons).toHaveLength(CASE.interventions.length);
    for (const b of buttons) {
      expect(b).toMatch(/^<button[^>]*\sdisabled=""/);
      expect(count(b, NOT_AVAILABLE_TEXT)).toBe(1);
    }
    expect(html).not.toMatch(new RegExp(`<p[\\s>][^<]*${NOT_AVAILABLE_TEXT}`));
  });

  it('uses the play variant of the InterventionPanel: no heading, no clinician box classes', () => {
    for (const state of [connected, disconnected]) {
      const html = render(state);
      const start = html.indexOf('data-part="play-interventions"');
      const wrapper = html.slice(start, interventionsEnd(html, start));
      expect(wrapper).toContain('data-part="intervention-panel"');
      expect(wrapper).not.toContain('<h3');
      expect(textOf(wrapper)).not.toContain('Interventions');
      const tokens = new Set(
        [...wrapper.matchAll(/class="([^"]*)"/g)].flatMap((m) => m[1].split(/\s+/).filter(Boolean)),
      );
      for (const cls of ['bg-gray-800', 'bg-gray-700', 'border-gray-700', 'hover:bg-gray-600', 'p-4', 'grid-cols-1']) {
        expect(tokens.has(cls)).toBe(false);
      }
    }
  });

  it('renders the HintPanel without its top margin (noTopMargin)', () => {
    const html = render(connected);
    const cls = /<section[^>]*data-part="hint-panel"[^>]*class="([^"]*)"/.exec(html)?.[1];
    expect(cls).toBeDefined();
    expect(cls?.split(/\s+/)).not.toContain('mt-4');
  });
});

describe('PlayView toolbarStart', () => {
  const TOOLBAR = 'data-part="play-toolbar"';

  function renderWith(state: SessionUiState, props: Partial<Pick<Parameters<typeof PlayView>[0], 'toolbarStart'>>): string {
    return renderToStaticMarkup(
      <PlayView
        sim={{
          state,
          statusSentence: null,
          speech: checkedScriptedLine(state.speech, state.caseData),
          actions: stubActions(),
          notices: { pauseFailed: false, streamError: null },
        }}
        {...props}
      />,
    );
  }

  const state = build(...LOADED, { type: 'sampleReceived', sample: sample(10) });

  it('renders toolbarStart inside the playback row, before the play button', () => {
    const html = renderWith(state, { toolbarStart: <span data-test="tb">X</span> });
    const toolbar = html.indexOf(TOOLBAR);
    const start = html.indexOf('<span data-test="tb">X</span>');
    const controlsWrapper = html.indexOf('<div class="min-w-0 flex-1">', toolbar);
    const playButton = html.indexOf('aria-label="Play"');
    expect(toolbar).toBeGreaterThan(html.indexOf('data-part="play-view"'));
    expect(start).toBeGreaterThan(toolbar);
    expect(controlsWrapper).toBeGreaterThan(start);
    expect(playButton).toBeGreaterThan(controlsWrapper);
  });

  it('without toolbarStart renders no toolbar, the same as undefined or null', () => {
    const without = renderWith(state, {});
    expect(without).not.toContain(TOOLBAR);
    expect(without).toContain('aria-label="Play"');
    expect(renderWith(state, { toolbarStart: undefined })).toBe(without);
    expect(renderWith(state, { toolbarStart: null })).toBe(without);
  });
});

describe('PlayView exam layout (bedside-exam)', () => {
  const EXAM = CASE.play!.exam!;
  const EXAM_BUTTON = /<button[^>]*data-control="exam"[^>]*>.*?<\/button>/g;

  /** CASE without an Exam_Section (the `exam` key is left out). */
  function withoutExam(): CaseData {
    const play = { ...CASE.play! };
    delete play.exam;
    return { ...CASE, play };
  }

  /** CASE with another play.sideRevealText. */
  function withSideReveal(sideRevealText: string): CaseData {
    return { ...CASE, play: { ...CASE.play!, sideRevealText } };
  }

  const classOf = (html: string, part: string): string | undefined =>
    new RegExp(`<div[^>]*data-part="${part}"[^>]*class="([^"]*)"`).exec(html)?.[1] ??
    new RegExp(`<div[^>]*class="([^"]*)"[^>]*data-part="${part}"`).exec(html)?.[1];

  /** Class of the grid that holds the columns: the div right before the patient column. */
  function gridClass(html: string): string | undefined {
    const before = html.slice(0, html.indexOf('data-part="patient-column"'));
    const divs = [...before.matchAll(/<div class="([^"]*)">/g)];
    return divs[divs.length - 1]?.[1];
  }

  const liveRegion = (html: string): string | undefined =>
    /<div data-part="exam-live"[^>]*>(.*?)<\/div>/.exec(html)?.[1];

  const running = build(...LOADED, { type: 'sampleReceived', sample: sample(10) });

  it('shows the exam group above "What can you do?" with the five Exam_Buttons in case order', () => {
    const html = render(running);
    const column = html.indexOf('data-part="action-column"');
    const panel = html.indexOf('data-part="exam-panel"');
    const heading = html.indexOf(`>${WHAT_CAN_YOU_DO_TEXT}</h2>`);
    expect(column).toBeGreaterThanOrEqual(0);
    expect(panel).toBeGreaterThan(column);
    expect(heading).toBeGreaterThan(panel);

    const buttons = html.match(EXAM_BUTTON) ?? [];
    const expected = examButtons(EXAM).flat().map((s) => s.text);
    expect(expected).toHaveLength(5);
    expect(buttons.map(textOf)).toEqual(expected);
    // Every Exam_Button sits between the action column start and the heading.
    for (const b of buttons) {
      const at = html.indexOf(b);
      expect(at).toBeGreaterThan(panel);
      expect(at).toBeLessThan(heading);
    }
  });

  it('uses three columns with an Exam_Section: patient, action, then findings with the Hint and Rewind row', () => {
    const html = render(running);
    expect(gridClass(html)).toBe(
      'grid grid-cols-1 gap-6 xl:min-h-0 xl:flex-1 xl:grid-cols-[minmax(0,5fr)_minmax(0,6fr)_minmax(0,4fr)]',
    );
    expect(classOf(html, 'play-view')).toBe(
      'sp-play flex min-h-[calc(100vh-var(--notice-h))] flex-col gap-2 bg-[var(--sp-bg)] px-4 py-2 text-base text-[var(--sp-text)] [@media(min-width:1280px)_and_(min-height:720px)]:h-[calc(100vh-var(--notice-h))] [@media(min-width:1280px)_and_(min-height:720px)]:overflow-hidden',
    );
    expect(classOf(html, 'play-avatar')).toBe('mx-auto w-[min(100%,20rem)] max-w-full xl:w-[var(--sp-avatar-w-lg)]');

    const order = [
      'data-part="patient-column"',
      'data-part="action-column"',
      'data-part="exam-panel"',
      'data-part="play-interventions"',
      'data-part="findings-column"',
      'data-part="findings-list"',
      'data-part="hint-panel"',
      'data-control="rewind"',
      'data-part="exam-live"',
    ].map((p) => html.indexOf(p));
    for (const at of order) expect(at).toBeGreaterThanOrEqual(0);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html.split('data-part="findings-list"')).toHaveLength(2);
    expect(html.split('data-part="hint-panel"')).toHaveLength(2);
  });

  it("keeps today's two-column markup without an Exam_Section (4.6)", () => {
    const html = render(build(...loaded(withoutExam()), { type: 'sampleReceived', sample: sample(10) }));
    expect(classOf(html, 'play-view')).toBe(
      'sp-play flex min-h-[calc(100vh-var(--notice-h))] flex-col gap-2 bg-[var(--sp-bg)] px-4 py-2 text-base text-[var(--sp-text)] lg:h-[calc(100vh-var(--notice-h))] lg:overflow-hidden',
    );
    expect(gridClass(html)).toBe('grid grid-cols-1 gap-6 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]');
    expect(classOf(html, 'play-avatar')).toBe('mx-auto w-[min(100%,20rem)] max-w-full lg:w-[var(--sp-avatar-w-lg)]');
    for (const part of ['findings-column', 'findings-list', 'exam-panel', 'exam-live']) {
      expect(html).not.toContain(`data-part="${part}"`);
    }
    expect(html).not.toContain('data-control="exam"');

    // Action column: goal, heading, Intervention buttons, then the Hint and Rewind row.
    const column = html.indexOf('data-part="action-column"');
    const order = [
      column,
      html.indexOf(`>${WHAT_CAN_YOU_DO_TEXT}</h2>`),
      html.indexOf('data-part="play-interventions"'),
      html.indexOf('data-part="hint-panel"'),
      html.indexOf('data-control="rewind"'),
    ];
    for (const at of order) expect(at).toBeGreaterThanOrEqual(0);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // The grid holds exactly the patient and action columns.
    expect(html.split('-column"')).toHaveLength(3);
  });

  it('has an exam live region separate from the StatusLine region, empty for restored entries', () => {
    const restored = buildExamEntry({
      actionId: EXAM.actions[0].id,
      side: null,
      simulationTime: 5,
      branchId: 'b1',
      finding: { sentence: 'Placeholder restored finding.', abnormal: false },
      wallClockTime: '2026-11-20T10:00:00Z',
    });
    const html = render(build(...LOADED, { type: 'examRecordRestored', record: [restored] }));

    // The restored entry is active and listed, but not announced.
    const findingsList = html.slice(html.indexOf('data-part="findings-list"'), html.indexOf('data-part="hint-panel"'));
    expect(findingsList).toContain('Placeholder restored finding.');
    expect(liveRegion(html)).toBe('');
    expect(html).toContain('<div data-part="exam-live" class="sr-only" aria-live="polite" aria-atomic="true"></div>');

    // Separate from the StatusLine's own polite region, which is in the patient column.
    const statusLine = html.slice(html.indexOf('data-part="status-line"'), html.indexOf('data-part="action-column"'));
    expect(statusLine).toContain('aria-live="polite"');
    expect(statusLine).not.toContain('exam-live');
    expect(html.indexOf('data-part="exam-live"')).toBeGreaterThan(html.indexOf('data-part="findings-column"'));
  });

  it('lists only the Active_Exam_Entries of the lineage, not findings from an abandoned Branch (7.3)', () => {
    // Lineage: child (unbounded) -> main (bounded by the fork at t = 60). The
    // Branch "abandoned" was forked from main at t = 30 and is not on the lineage.
    const session: SessionMetadata = {
      session_id: 's1',
      case_id: CASE.id,
      created_at: '',
      current_branch_id: 'child',
      branches: [
        { branch_id: 'main', created_at: '', event_count: 0 },
        { branch_id: 'abandoned', parent_branch_id: 'main', forked_from_checkpoint: 'cp-main-30', created_at: '', event_count: 0 },
        { branch_id: 'child', parent_branch_id: 'main', forked_from_checkpoint: 'cp-main-60', created_at: '', event_count: 0 },
      ],
    };
    const entry = (branchId: string, simulationTime: number, sentence: string) =>
      buildExamEntry({
        actionId: EXAM.actions[0].id,
        side: null,
        simulationTime,
        branchId,
        finding: { sentence, abnormal: false },
        wallClockTime: '2026-11-20T10:00:00Z',
      });
    const onLineage = entry('main', 20, 'finding: on lineage');
    const abandoned = entry('abandoned', 45, 'finding: abandoned branch');
    const state = build(
      { type: 'caseLoaded', caseData: CASE, storedView: 'play' },
      { type: 'sessionLoaded', session },
      {
        type: 'checkpointsLoaded',
        byBranch: {
          main: [
            { checkpoint_id: 'cp-main-30', simulation_time: 30, created_at: '', is_automatic: true },
            { checkpoint_id: 'cp-main-60', simulation_time: 60, created_at: '', is_automatic: true },
          ],
        },
      },
      { type: 'connectionChanged', connected: true },
      { type: 'examRecordRestored', record: [onLineage, abandoned] },
    );

    // Not vacuous: a real two-Branch lineage, and the abandoned entry is recorded but not active.
    expect(state.lineage.map((s) => s.branchId)).toEqual(['child', 'main']);
    expect(state.examRecord).toContainEqual(abandoned);
    expect(activeExamEntries(state.examRecord, state.lineage)).toHaveLength(1);

    const html = render(state);
    const findingsList = html.slice(html.indexOf('data-part="findings-list"'), html.indexOf('data-part="hint-panel"'));
    expect(findingsList).toContain('finding: on lineage');
    expect(findingsList).not.toContain('finding: abandoned branch');
  });

  it('disables the Exam_Buttons during an Ending and during a pending fork, not while disconnected', () => {
    const enabled = render(running).match(EXAM_BUTTON) ?? [];
    expect(enabled).toHaveLength(5);
    for (const b of enabled) expect(b).not.toMatch(/\sdisabled=""/);

    const disconnected = render(build(...LOADED.slice(0, 3))).match(EXAM_BUTTON) ?? [];
    expect(disconnected).toHaveLength(5);
    for (const b of disconnected) expect(b).not.toMatch(/\sdisabled=""/);

    for (const actions of [LOST, RESCUED]) {
      const state = build(...actions);
      expect(state.ending.ending).not.toBe('none');
      const { view } = splitAtEnding(render(state));
      const buttons = view.match(EXAM_BUTTON) ?? [];
      expect(buttons).toHaveLength(5);
      for (const b of buttons) expect(b).toMatch(/\sdisabled=""/);
    }

    // The pending fork is PlayView's own state; the view passes it to this helper.
    expect(examButtonsDisabled({ ending: 'none', forkPending: true })).toBe(true);
    expect(examButtonsDisabled({ ending: 'none', forkPending: false })).toBe(false);
  });

  it("passes play.sideRevealText to the Ending_Screen", () => {
    const { ending } = splitAtEnding(render(build(...RESCUED)));
    expect(ending).not.toBeNull();
    expect(ending).toContain(`<p data-part="side-reveal" class="text-base">${CASE.play!.sideRevealText}</p>`);
  });

  // Feature: bedside-exam, Property 19: The Side_Reveal_Text appears only on the Ending_Screen, in full
  it('Property 19 (PlayView half): no side-reveal element while the Ending is none', () => {
    // **Validates: Requirements 12.2**
    const text = fc
      .string({ minLength: 1, maxLength: 120 })
      .filter((s) => s.trim() !== '');
    fc.assert(
      fc.property(text, fc.integer({ min: 0, max: 300 }), (sideRevealText, t) => {
        const state = build(...loaded(withSideReveal(sideRevealText)), { type: 'sampleReceived', sample: sample(t) });
        expect(state.ending.ending).toBe('none');
        expect(render(state)).not.toContain('data-part="side-reveal"');
      }),
      PBT_PARAMS,
    );
  });
});

describe('PlayView Intervention buttons after a Decompression and during a fork (8.15, 8.16)', () => {
  const LEFT = CASE.interventions.find((i) => i.id === 'needle-decompression-left')!;

  /** Connected, a sample, then the left Decompression accepted at 40 s (after the 30 s insult), Ending none. */
  const DECOMPRESSED: SessionAction[] = [
    ...LOADED,
    { type: 'sampleReceived', sample: sample(10) },
    { type: 'sampleReceived', sample: sample(40) },
    { type: 'interventionSucceeded', entry: buildInterventionEntry(LEFT, 40, 'b1') },
    { type: 'sampleReceived', sample: sample(50) },
  ];

  /** A Branch b2 forked from Checkpoint c1 (42 s) of b1. */
  const FORKED_SESSION: SessionMetadata = {
    ...SESSION,
    current_branch_id: 'b2',
    branches: [
      ...SESSION.branches!,
      { branch_id: 'b2', parent_branch_id: 'b1', forked_from_checkpoint: 'c1', created_at: '', event_count: 0 },
    ],
  };

  function expectAllEnabled(html: string): void {
    const buttons = interventionButtons(html);
    expect(buttons).toHaveLength(CASE.interventions.length);
    for (const b of buttons) {
      expect(b).not.toMatch(/^<button[^>]*\sdisabled=""/);
      expect(b).not.toContain(NOT_AVAILABLE_TEXT);
    }
  }

  const inputOf = (state: SessionUiState, forkPending: boolean): InterventionsDisabledInput => ({
    connected: state.connected,
    interventionPending: false,
    forkPending,
    ending: state.ending.ending,
  });

  it('InterventionsDisabledInput has exactly connected, interventionPending, forkPending and ending', () => {
    expectTypeOf<keyof InterventionsDisabledInput>().toEqualTypeOf<
      'connected' | 'interventionPending' | 'forkPending' | 'ending'
    >();
    // One destructured object parameter.
    expect(interventionsDisabled.length).toBe(1);
  });

  it('keeps the left button enabled after an accepted left Decompression (8.15)', () => {
    const state = build(...DECOMPRESSED);
    // Not vacuous: connected, the Decompression is recorded, and there is no Ending.
    expect(state.connected).toBe(true);
    expect(state.latestSample?.simulation_time).toBe(50);
    expect(state.interventionRecord.map((e) => e.interventionId)).toEqual(['needle-decompression-left']);
    expect(state.ending.ending).toBe('none');

    expect(interventionsDisabled({ connected: true, interventionPending: false, forkPending: false, ending: 'none' })).toBe(
      false,
    );
    expect(interventionsDisabled(inputOf(state, false))).toBe(false);
    // Intervention_Record fields passed in anyway are ignored: no earlier entry can disable a button.
    const withRecord = {
      ...inputOf(state, false),
      interventionRecord: state.interventionRecord,
      lineage: state.lineage,
    } as InterventionsDisabledInput;
    expect(interventionsDisabled(withRecord)).toBe(false);

    const html = render(state);
    expectAllEnabled(html);
    const left = interventionButtons(html).find((b) => textOf(b) === playButtonText(LEFT));
    expect(left).toBeDefined();
    expect(left).not.toMatch(/^<button[^>]*\sdisabled=""/);
    expect(left).not.toContain(NOT_AVAILABLE_TEXT);
  });

  it('disables the buttons while a fork is pending and enables them after a successful fork (8.16)', () => {
    const before = build(...DECOMPRESSED);
    expect(interventionsDisabled(inputOf(before, true))).toBe(true);

    const after = sessionReducer(before, {
      type: 'forkSucceeded',
      session: FORKED_SESSION,
      newBranchId: 'b2',
      forkTime: 42,
    });
    expect(after.currentBranchId).toBe('b2');
    expect(after.connected).toBe(true);
    expect(after.ending.ending).toBe('none');

    expect(interventionsDisabled(inputOf(after, true))).toBe(true);
    expect(interventionsDisabled(inputOf(after, false))).toBe(false);
    expectAllEnabled(render(after));
  });

  it('disables the buttons while a fork is pending and enables them after a failed fork (8.16)', () => {
    const before = build(...DECOMPRESSED);
    // A failed fork dispatches no action, so the state after it is `before` itself.
    const afterFailedFork = before;
    expect(afterFailedFork.currentBranchId).toBe('b1');
    expect(afterFailedFork.connected).toBe(true);
    expect(afterFailedFork.ending.ending).toBe('none');

    expect(interventionsDisabled(inputOf(afterFailedFork, true))).toBe(true);
    expect(interventionsDisabled(inputOf(afterFailedFork, false))).toBe(false);
    expectAllEnabled(render(afterFailedFork));
  });
});

describe('PlayView speech (patient-speech 4.8, 7.1, 7.2, 7.5 to 7.7, 7.9)', () => {
  const SPEECH = CASE.play!.speech!;
  const EARLY = SPEECH.early!;
  const RESCUED_LINE = SPEECH.rescued![0];
  const PLACEHOLDER = 'Placeholder speech line.';
  const LIVE = 'data-part="speech-live"';

  /** The escaping renderToStaticMarkup applies to text content. */
  const esc = (text: string): string =>
    text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');

  const count = (html: string, needle: string): number => html.split(needle).length - 1;

  /** Text of every speech bubble in `html`, in order. */
  const bubbles = (html: string): string[] =>
    [...html.matchAll(/<div data-part="speech-bubble"[^>]*><p class="whitespace-pre-wrap">([^<]*)<\/p>/g)].map((m) => m[1]);

  /** Content of every speech live region in `html`, in order. */
  const liveRegions = (html: string): string[] =>
    [...html.matchAll(/<div data-part="speech-live" class="sr-only" aria-live="polite" aria-atomic="true">(.*?)<\/div>/g)].map(
      (m) => m[1],
    );

  const patientColumn = (html: string): string =>
    html.slice(html.indexOf('data-part="patient-column"'), html.indexOf('data-part="action-column"'));

  const at = (...times: number[]): SessionAction[] =>
    times.map((t) => ({ type: 'sampleReceived', sample: sample(t) }) as SessionAction);

  /** Before the 30 s insult: silent. From 30 s: the first `early` line. */
  const BEFORE_INSULT = build(...LOADED, ...at(10));
  const EARLY_0 = build(...LOADED, ...at(10, 30));

  it('shows the Displayed_Speech in the patient-column bubble and in exactly one live region', () => {
    // Not vacuous: the reducer fold gives the first `early` line, which passes the Speech_Check.
    expect(EARLY_0.speech?.key).toBe('early');
    expect(checkedScriptedLine(EARLY_0.speech, EARLY_0.caseData)).toBe(EARLY[0]);

    const html = render(EARLY_0);
    expect(bubbles(patientColumn(html))).toEqual([esc(EARLY[0])]);
    expect(bubbles(html)).toHaveLength(1);
    expect(count(html, LIVE)).toBe(1);
    expect(liveRegions(html)).toEqual([`<p>${esc(EARLY[0])}</p>`]);
    // The region follows the exam region and is not part of the StatusLine.
    expect(html.indexOf(LIVE)).toBeGreaterThan(html.indexOf('data-part="exam-live"'));
    expect(patientColumn(html)).not.toContain(LIVE);

    // The bubble shows sim.speech (the Displayed_Speech), not the reducer's line.
    const other = render(EARLY_0, {}, null, PLACEHOLDER);
    expect(bubbles(other)).toEqual([PLACEHOLDER]);
    expect(liveRegions(other)).toEqual([`<p>${PLACEHOLDER}</p>`]);
  });

  it('leaves the slot empty and the one live region empty without a Displayed_Speech', () => {
    expect(BEFORE_INSULT.speech?.line).toBeNull();
    for (const html of [render(BEFORE_INSULT), render(EARLY_0, {}, null, null)]) {
      expect(html).not.toContain('data-part="speech-bubble"');
      expect(count(html, LIVE)).toBe(1);
      expect(liveRegions(html)).toEqual(['']);
    }
  });

  it('renders the same markup for a repeated sample and new region content for a changed line', () => {
    // The same sample again is not folded: the whole markup is equal.
    const repeated = sessionReducer(EARLY_0, { type: 'sampleReceived', sample: sample(30) });
    expect(render(repeated)).toBe(render(EARLY_0));

    // A later sample with the same line keeps the same Speech_State and the same region.
    const later = build(...LOADED, ...at(10, 30, 45));
    expect(later.speech).toEqual(EARLY_0.speech);
    expect(liveRegions(render(later))).toEqual(liveRegions(render(EARLY_0)));

    // 30 s later the `early` list rotates to its second line: new content.
    expect(EARLY.length).toBeGreaterThan(1);
    const rotated = build(...LOADED, ...at(10, 30, 45, 60));
    expect(rotated.speech?.index).toBe(1);
    const html = render(rotated);
    expect(liveRegions(html)).toEqual([`<p>${esc(EARLY[1])}</p>`]);
    expect(liveRegions(html)).not.toEqual(liveRegions(render(EARLY_0)));
    expect(bubbles(html)).toEqual([esc(EARLY[1])]);
  });

  it('keeps the Avatar aria-label equal to the Status_Sentence while speech shows', () => {
    const sentence = 'He looks pale and is struggling to breathe.';
    const html = render(EARLY_0, {}, sentence);
    expect(bubbles(html)).toEqual([esc(EARLY[0])]);
    expect(patientAvatarName(html)).toBe(sentence);
    expect(patientAvatarName(render(EARLY_0, {}, null))).toBe(CASE.play?.status.defaultSentence);
  });

  it('with an Ending, the one live region is inside the Ending_Screen dialog and empty in static markup', () => {
    for (const actions of [LOST, RESCUED]) {
      const html = render(build(...actions));
      const { view, ending } = splitAtEnding(html);
      expect(ending).toMatch(/^<div role="dialog"/);
      expect(count(html, LIVE)).toBe(1);
      expect(view).not.toContain(LIVE);
      expect(liveRegions(ending!)).toEqual(['']);
    }
  });

  it('passes the rescued line to the Ending_Screen, and the lost screen shows no bubble', () => {
    const rescued = build(...RESCUED);
    expect(checkedScriptedLine(rescued.speech, rescued.caseData)).toBe(RESCUED_LINE);
    const rescuedEnding = splitAtEnding(render(rescued)).ending!;
    expect(bubbles(rescuedEnding)).toEqual([esc(RESCUED_LINE)]);
    expect(rescuedEnding.match(/<div data-part="ending-avatar"[^>]*>/)![0]).not.toContain('margin-top');

    const lost = build(...LOST);
    expect(lost.speech?.line).toBeNull();
    // Even with a Displayed_Speech, the lost screen shows no bubble.
    for (const speech of [null, PLACEHOLDER]) {
      const lostEnding = splitAtEnding(render(lost, {}, null, speech)).ending!;
      expect(lostEnding).not.toContain('data-part="speech-bubble"');
    }
  });

  it('renders no bubble and an empty live region for a case without play.speech (4.8)', () => {
    const play = { ...CASE.play! };
    delete play.speech;
    const noSpeech: CaseData = { ...CASE, play };
    const state = build(...loaded(noSpeech), ...at(10, 30, 60, 120));
    expect(state.speech?.line ?? null).toBeNull();
    const html = render(state);
    expect(html).not.toContain('data-part="speech-bubble"');
    expect(liveRegions(html)).toEqual(['']);
  });
});
