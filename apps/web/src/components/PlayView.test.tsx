import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { playButtonText } from '@/lib/playCase';
import type { Ending } from '@/lib/endingEvaluator';
import { initialSessionState, sessionReducer, type SessionAction, type SessionUiState } from '@/lib/sessionState';
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
  interventionDoneText,
  interventionsDisabled,
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
  };
}

function render(
  state: SessionUiState,
  notices: Partial<SimulationSessionNotices> = {},
  statusSentence: string | null = null,
): string {
  return renderToStaticMarkup(
    <PlayView
      sim={{
        state,
        statusSentence,
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

/** The Intervention buttons' markup, in render order. */
function interventionButtons(html: string): string[] {
  const start = html.indexOf('data-part="play-interventions"');
  const end = html.indexOf('data-part="hint-panel"', start);
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
