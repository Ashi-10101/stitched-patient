import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { initialSessionState, sessionReducer, type SessionAction, type SessionUiState } from '@/lib/sessionState';
import type { SimulationSessionActions, SimulationSessionNotices } from '@/hooks/useSimulationSession';
import { CASE } from '@/test/caseFixtures';
import type { CaseData, SessionMetadata, VitalSigns } from '@/types';
import { CASE_NOT_LOADED_TEXT } from './ClinicianView';
import { SAFETY_NOTICE_TEXT } from './SafetyNotice';
import { CONNECTING_TEXT, LOADING_TEXT, SessionScreen, sessionScreenMode } from './SessionScreen';
import { PLAY_CASE_FAILED_TEXT } from './ViewSwitcher';

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

/** Case and Session loaded with the given stored view; the Vitals_Stream is not open yet. */
function loadedNotConnected(storedView: 'play' | 'clinician'): SessionAction[] {
  return [
    { type: 'caseLoaded', caseData: CASE, storedView },
    { type: 'sessionLoaded', session: SESSION },
    {
      type: 'checkpointsLoaded',
      byBranch: { b1: [{ checkpoint_id: 'c1', simulation_time: 42, created_at: '', is_automatic: true }] },
    },
  ];
}

/** Connected with one sample, in the given view. */
function live(storedView: 'play' | 'clinician'): SessionAction[] {
  return [
    ...loadedNotConnected(storedView),
    { type: 'connectionChanged', connected: true },
    { type: 'sampleReceived', sample: sample(10) },
  ];
}

const DISCONNECTED_AFTER_SAMPLE = (view: 'play' | 'clinician'): SessionAction[] => [
  ...live(view),
  { type: 'connectionChanged', connected: false },
];

const FAILED: SessionAction[] = [
  { type: 'caseFailed', message: 'boom' },
  { type: 'sessionLoaded', session: SESSION },
  { type: 'connectionChanged', connected: true },
  { type: 'sampleReceived', sample: sample(10) },
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

function render(state: SessionUiState, notices: Partial<SimulationSessionNotices> = {}): string {
  return renderToStaticMarkup(
    <SessionScreen
      sim={{
        state,
        activeInterventions: [],
        statusSentence: null,
        speech: null,
        actions: stubActions(),
        notices: { pauseFailed: false, streamError: null, ...notices },
      }}
    />,
  );
}

const count = (html: string, needle: string): number => html.split(needle).length - 1;
const textOf = (markup: string): string => markup.replace(/<[^>]+>/g, '');

const PLAY_ROOT = 'data-part="play-view"';
const TOOLBAR = 'data-part="play-toolbar"';
const RADIOGROUP = 'role="radiogroup"';

/** The View_Switcher's option buttons, keyed by their visible label. */
function switcherOptions(html: string): Record<string, string> {
  const buttons = html.match(/<button[^>]*role="radio"[^>]*>.*?<\/button>/g) ?? [];
  return Object.fromEntries(buttons.map((b) => [textOf(b).replace('✓', '').trim(), b]));
}

const ALL_STATES: Array<[string, SessionUiState]> = [
  ['loading', initialSessionState()],
  ['connecting', build(...loadedNotConnected('play'))],
  ['play view', build(...live('play'))],
  ['clinician view', build(...live('clinician'))],
  ['failed case', build(...FAILED)],
  ['play view disconnected after a sample', build(...DISCONNECTED_AFTER_SAMPLE('play'))],
  ['clinician view disconnected after a sample', build(...DISCONNECTED_AFTER_SAMPLE('clinician'))],
];

describe('SessionScreen', () => {
  it.each(ALL_STATES)('shows the Safety_Notice text exactly once (%s)', (_name, state) => {
    expect(SAFETY_NOTICE_TEXT).toBe('Educational simulation, not for clinical use');
    expect(count(render(state), SAFETY_NOTICE_TEXT)).toBe(1);
  });

  it.each(ALL_STATES)('renders <main> without the pt-[var(--notice-h)] class (%s)', (_name, state) => {
    const html = render(state);
    const mains = html.match(/<main[^>]*>/g) ?? [];
    expect(mains).toHaveLength(1);
    expect(mains[0]).not.toContain('pt-[var(--notice-h)]');
  });

  it('while loading shows the loading text, a fully disabled View_Switcher and no view', () => {
    const state = initialSessionState();
    expect(state.caseStatus).toBe('loading');
    const html = render(state);
    expect(html).toMatch(new RegExp(`<div role="status"[^>]*><div[^>]*>${LOADING_TEXT}</div></div>`));
    expect(html).toContain(RADIOGROUP);
    const options = switcherOptions(html);
    expect(Object.keys(options).sort()).toEqual(['Clinician', 'Play']);
    expect(options.Play).toContain('aria-disabled="true"');
    expect(options.Clinician).toContain('aria-disabled="true"');
    expect(html).not.toContain(PLAY_ROOT);
    expect(html).not.toContain('Heart Rate');
    expect(html).not.toContain(CONNECTING_TEXT);
  });

  it('while connecting shows the connecting text and the View_Switcher, no view', () => {
    const html = render(build(...loadedNotConnected('play')));
    expect(html).toMatch(new RegExp(`<div role="status"[^>]*><div[^>]*>${CONNECTING_TEXT}</div></div>`));
    expect(html).toContain(RADIOGROUP);
    expect(html).not.toContain(PLAY_ROOT);
    expect(html).not.toContain('Heart Rate');
    expect(html).not.toContain(LOADING_TEXT);
  });

  it('while connecting shows notices.streamError under the connecting text', () => {
    const message = 'WebSocket error - connection lost';
    const html = render(build(...loadedNotConnected('play')), { streamError: message });
    expect(html).toMatch(
      new RegExp(
        `<div role="status"[^>]*><div[^>]*>${CONNECTING_TEXT}</div><div class="mt-2 text-base text-red-400">${message}</div></div>`,
      ),
    );
    expect(render(build(...loadedNotConnected('play')))).not.toContain('text-red-400');
  });

  it.each(['play', 'clinician'] as const)(
    'keeps the %s view after a sample when the stream disconnects',
    (view) => {
      const state = build(...DISCONNECTED_AFTER_SAMPLE(view));
      expect(state.connected).toBe(false);
      const html = render(state);
      expect(html).not.toContain(CONNECTING_TEXT);
      if (view === 'play') {
        expect(html).toContain(PLAY_ROOT);
      } else {
        expect(html).toContain('Heart Rate');
        expect(html).not.toContain(PLAY_ROOT);
      }
    },
  );

  it('in the Play view renders PlayView with the View_Switcher inside the playback row, before the play button', () => {
    const html = render(build(...live('play')));
    expect(html).toContain('What can you do?');
    expect(html).toContain('class="sp-play ');
    expect(count(html, RADIOGROUP)).toBe(1);

    const root = html.indexOf(PLAY_ROOT);
    const toolbar = html.indexOf(TOOLBAR);
    const switcher = html.indexOf(RADIOGROUP);
    const controlsWrapper = html.indexOf('<div class="min-w-0 flex-1">', toolbar);
    const playButton = html.indexOf('aria-label="Play"');
    expect(root).toBeGreaterThanOrEqual(0);
    expect(toolbar).toBeGreaterThan(root);
    expect(switcher).toBeGreaterThan(toolbar);
    expect(controlsWrapper).toBeGreaterThan(switcher);
    expect(playButton).toBeGreaterThan(controlsWrapper);
    expect(html).not.toContain('Heart Rate');
  });

  it('in the Clinician view renders ClinicianView after the View_Switcher, with no play toolbar', () => {
    const html = render(build(...live('clinician')));
    const switcher = html.indexOf(RADIOGROUP);
    const title = html.indexOf(`<h1 class="text-2xl font-bold">${CASE.title}</h1>`);
    const heartRate = html.indexOf('Heart Rate');
    expect(switcher).toBeGreaterThanOrEqual(0);
    expect(title).toBeGreaterThan(switcher);
    expect(heartRate).toBeGreaterThan(title);
    expect(html).not.toContain(TOOLBAR);
    expect(html).not.toContain(PLAY_ROOT);
  });

  it('for a failed case renders ClinicianView with the message and a disabled Play option with its reason', () => {
    const html = render(build(...FAILED));
    expect(html).toContain(CASE_NOT_LOADED_TEXT);
    expect(html).toContain('Heart Rate');
    expect(html).not.toContain(PLAY_ROOT);

    const play = switcherOptions(html).Play;
    expect(play).toContain('aria-disabled="true"');
    const describedBy = /aria-describedby="([^"]+)"/.exec(play)?.[1];
    expect(describedBy).toBeDefined();
    expect(html).toContain(`<p id="${describedBy}" class="text-base text-gray-300">${PLAY_CASE_FAILED_TEXT}</p>`);
  });
});

describe('sessionScreenMode', () => {
  const noPlay: CaseData = { ...CASE };
  delete noPlay.play;
  const base = {
    caseStatus: 'loaded' as const,
    connected: true,
    latestSample: sample(10),
    view: 'play' as const,
    caseData: CASE,
  };

  it('is loading while the case loads', () => {
    expect(sessionScreenMode(initialSessionState())).toBe('loading');
    expect(sessionScreenMode({ ...base, caseStatus: 'loading', caseData: null })).toBe('loading');
  });

  it('is connecting while not connected and no sample has arrived', () => {
    expect(sessionScreenMode(build(...loadedNotConnected('play')))).toBe('connecting');
    expect(sessionScreenMode({ ...base, connected: false, latestSample: null })).toBe('connecting');
  });

  it('is play for the Play view with a Play_Section', () => {
    expect(sessionScreenMode(build(...live('play')))).toBe('play');
    expect(sessionScreenMode(base)).toBe('play');
  });

  it('is clinician for the Clinician view, a case without a Play_Section, and a failed case', () => {
    expect(sessionScreenMode(build(...live('clinician')))).toBe('clinician');
    expect(sessionScreenMode({ ...base, view: 'clinician' })).toBe('clinician');
    expect(sessionScreenMode({ ...base, caseData: noPlay })).toBe('clinician');
    expect(sessionScreenMode(build(...FAILED))).toBe('clinician');
  });

  it('keeps the view mode when disconnected after a sample', () => {
    expect(sessionScreenMode(build(...DISCONNECTED_AFTER_SAMPLE('play')))).toBe('play');
    expect(sessionScreenMode(build(...DISCONNECTED_AFTER_SAMPLE('clinician')))).toBe('clinician');
    expect(sessionScreenMode({ ...base, connected: false })).toBe('play');
  });
});

describe('session page source', () => {
  const PAGE = readFileSync(path.resolve(__dirname, '../app/session/[sessionId]/page.tsx'), 'utf8');

  it('calls useSimulationSession exactly once', () => {
    expect(count(PAGE, 'useSimulationSession(')).toBe(1);
  });

  it('holds no I/O or state of its own', () => {
    for (const needle of ['WebSocket', 'useState', 'useEffect', 'api.', 'connectVitalsStream']) {
      expect(PAGE).not.toContain(needle);
    }
  });

  it('has exactly one export, the default export', () => {
    const exports = PAGE.match(/\bexport\b.*/g) ?? [];
    expect(exports).toHaveLength(1);
    expect(exports[0]).toMatch(/^export default /);
  });

  it('does not render the Safety_Notice text itself', () => {
    expect(PAGE).not.toContain('Educational simulation');
  });
});
