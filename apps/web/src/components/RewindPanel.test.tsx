import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { CheckpointMetadata, RewindMoment, SessionMetadata, VitalSigns } from '@/types';
import { activeInterventions } from '@/lib/branchLineage';
import { labelRewindMoment } from '@/lib/rewindMoments';
import { initialSessionState, sessionReducer, type SessionAction, type SessionUiState } from '@/lib/sessionState';
import { CASE } from '@/test/caseFixtures';
import {
  acceptsSelection,
  buildRewindMoments,
  initialRewindPanelState,
  rewindPanelReducer,
  type RewindPanelEvent,
  type RewindPanelState,
  CHOOSE_MOMENT_TEXT,
  DIALOG_LABEL,
  FORKING_TEXT,
  FORK_ERROR_TEXT,
  LOADING_TEXT,
  LOAD_ERROR_TEXT,
  NO_MOMENTS_TEXT,
  RewindPanelBody,
  canSelectMoment,
  rewindStatusText,
  selectIfAllowed,
  type RewindStatus,
} from './RewindPanel';

const ALL_STATUSES: readonly RewindStatus[] = ['loading', 'loadError', 'ready', 'forking', 'forkError'];

/** Moments newest first, as the panel receives them. */
const MOMENTS: RewindMoment[] = [
  { checkpointId: 'cp-3', simulationTime: 150, label: '2:30 - before you chose: X' },
  { checkpointId: 'cp-2', simulationTime: 90, label: '1:30' },
  { checkpointId: 'cp-1', simulationTime: 0, label: '0:00 - at the start' },
];

/** Same escaping as React's server renderer for text content. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

function render(status: RewindStatus, moments: RewindMoment[] = MOMENTS): string {
  return renderToStaticMarkup(
    <RewindPanelBody status={status} moments={moments} onSelect={vi.fn()} onClose={vi.fn()} />,
  );
}

function statusInner(html: string): string {
  const match = /<p[^>]*role="status"[^>]*>([\s\S]*?)<\/p>/.exec(html);
  expect(match).not.toBeNull();
  return match![1];
}

/** Opening tags of the buttons inside the moment list. */
function momentButtons(html: string): string[] {
  const list = /<ol[\s\S]*?<\/ol>/.exec(html);
  if (!list) return [];
  return list[0].match(/<button[^>]*>/g) ?? [];
}

describe('RewindPanelBody status line', () => {
  it.each([
    ['loading', MOMENTS, LOADING_TEXT],
    ['loadError', MOMENTS, LOAD_ERROR_TEXT],
    ['ready', [], NO_MOMENTS_TEXT],
    ['ready', MOMENTS, CHOOSE_MOMENT_TEXT],
    ['forking', MOMENTS, FORKING_TEXT],
    ['forkError', MOMENTS, FORK_ERROR_TEXT],
  ] as const)('%s shows the matching text', (status, moments, text) => {
    expect(statusInner(render(status, [...moments]))).toBe(escapeHtml(text));
  });

  it('uses the exact literal strings', () => {
    expect(LOADING_TEXT).toBe('Loading earlier moments\u2026');
    expect(LOAD_ERROR_TEXT).toBe("Couldn't load earlier moments. Please try again.");
    expect(NO_MOMENTS_TEXT).toBe('No earlier moments yet.');
    expect(CHOOSE_MOMENT_TEXT).toBe('Choose a moment to go back to.');
    expect(FORKING_TEXT).toBe('Rewinding\u2026');
    expect(FORK_ERROR_TEXT).toBe("Couldn't rewind. Please try again.");
    for (const text of [LOADING_TEXT, FORKING_TEXT]) expect(text).not.toContain('...');
    expect(statusInner(render('loadError'))).toBe('Couldn&#x27;t load earlier moments. Please try again.');
    expect(statusInner(render('forking'))).toBe('Rewinding\u2026');
  });
});

describe('RewindPanelBody moment list', () => {
  it.each(['loading', 'loadError'] as const)('%s lists no moments, only the Close button', (status) => {
    const html = render(status);
    expect(html).not.toContain('<ol');
    expect(html.match(/<button/g)).toHaveLength(1);
    for (const m of MOMENTS) expect(html).not.toContain(m.label);
  });

  it('ready with no moments shows the empty text and no moment buttons', () => {
    const html = render('ready', []);
    expect(statusInner(html)).toBe(NO_MOMENTS_TEXT);
    expect(html).not.toContain('<ol');
    expect(html.match(/<button/g)).toHaveLength(1);
  });

  it('forking disables every moment button', () => {
    const buttons = momentButtons(render('forking'));
    expect(buttons).toHaveLength(MOMENTS.length);
    for (const b of buttons) expect(b).toMatch(/\sdisabled=""/);
  });

  it('ready and forkError list the same enabled moments', () => {
    const ready = render('ready');
    const forkError = render('forkError');
    for (const html of [ready, forkError]) {
      const buttons = momentButtons(html);
      expect(buttons).toHaveLength(MOMENTS.length);
      for (const b of buttons) expect(b).not.toMatch(/\sdisabled/);
    }
    const list = (html: string) => /<ol[\s\S]*?<\/ol>/.exec(html)![0];
    expect(list(forkError)).toBe(list(ready));
  });

  it('shows labels in the given order', () => {
    const html = render('ready');
    const positions = MOMENTS.map((m) => html.indexOf(`>${escapeHtml(m.label)}</button>`));
    for (const p of positions) expect(p).toBeGreaterThan(-1);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });
});

describe('RewindPanelBody dialog', () => {
  it('is a labelled modal dialog below the Safety_Notice', () => {
    const html = render('ready');
    const root = /^<div[^>]*>/.exec(html)![0];
    expect(root).toContain('role="dialog"');
    expect(root).toContain('aria-modal="true"');
    expect(root).toContain(`aria-label="${DIALOG_LABEL}"`);
    expect(root).toMatch(/style="[^"]*top:\s*var\(--notice-h\)/);
    expect(root).toMatch(/class="[^"]*\bz-40\b/);
    expect(root).not.toMatch(/\bz-50\b/);
    expect(root).toMatch(/class="[^"]*\bsp-play\b/);
    expect(html).toMatch(/<button[^>]*>Close<\/button>/);
  });
});

describe('canSelectMoment / selectIfAllowed', () => {
  it('allows selection only in ready and forkError', () => {
    const allowed = ALL_STATUSES.filter(canSelectMoment);
    expect(allowed).toEqual(['ready', 'forkError']);
  });

  it.each(['ready', 'forkError'] as const)('%s calls onSelect once with the moment', (status) => {
    const onSelect = vi.fn();
    expect(selectIfAllowed(status, MOMENTS[1], onSelect)).toBe(true);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(MOMENTS[1]);
  });

  it.each(['loading', 'loadError', 'forking'] as const)('%s never calls onSelect', (status) => {
    const onSelect = vi.fn();
    expect(selectIfAllowed(status, MOMENTS[0], onSelect)).toBe(false);
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe('rewindStatusText', () => {
  it.each([
    ['loading', 0, LOADING_TEXT],
    ['loading', 3, LOADING_TEXT],
    ['loadError', 0, LOAD_ERROR_TEXT],
    ['loadError', 3, LOAD_ERROR_TEXT],
    ['ready', 0, NO_MOMENTS_TEXT],
    ['ready', 1, CHOOSE_MOMENT_TEXT],
    ['ready', 3, CHOOSE_MOMENT_TEXT],
    ['forking', 0, FORKING_TEXT],
    ['forking', 3, FORKING_TEXT],
    ['forkError', 0, FORK_ERROR_TEXT],
    ['forkError', 3, FORK_ERROR_TEXT],
  ] as const)('%s with %i moments', (status, count, text) => {
    expect(rewindStatusText(status, count)).toBe(text);
  });
});

// ---------------------------------------------------------------------------
// Container state (pure)
// ---------------------------------------------------------------------------

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}

/** A frozen panel state with its own copy of the moments. */
function panel(
  status: RewindPanelState['status'],
  request: number,
  moments: RewindMoment[] = MOMENTS,
): RewindPanelState {
  return deepFreeze({ status, request, moments: moments.map((m) => ({ ...m })) });
}

const OPEN_STATUSES: readonly RewindStatus[] = ALL_STATUSES;

describe('rewindPanelReducer', () => {
  it('open from closed starts a load', () => {
    const next = rewindPanelReducer(deepFreeze({ ...initialRewindPanelState }), { type: 'open' });
    expect(next).toEqual({ status: 'loading', moments: [], request: initialRewindPanelState.request + 1 });
  });

  it.each(['ready', 'loadError'] as const)('open while %s starts a new load (10.11)', (status) => {
    const next = rewindPanelReducer(panel(status, 4, status === 'ready' ? MOMENTS : []), { type: 'open' });
    expect(next).toEqual({ status: 'loading', moments: [], request: 5 });
  });

  it('loadDone ok with the current request lists exactly the given moments', () => {
    const given = deepFreeze(MOMENTS.map((m) => ({ ...m })));
    const next = rewindPanelReducer(panel('loading', 2, []), { type: 'loadDone', request: 2, ok: true, moments: given });
    expect(next).toEqual({ status: 'ready', moments: given, request: 2 });
  });

  it('loadDone not ok shows the load error with no moments', () => {
    const next = rewindPanelReducer(panel('loading', 2, []), {
      type: 'loadDone',
      request: 2,
      ok: false,
      moments: MOMENTS,
    });
    expect(next).toEqual({ status: 'loadError', moments: [], request: 2 });
  });

  it.each(['ready', 'forkError'] as const)('select in %s starts forking with the same moments', (status) => {
    const state = panel(status, 3);
    const next = rewindPanelReducer(state, { type: 'select' });
    expect(next).toEqual({ status: 'forking', moments: state.moments, request: 4 });
  });

  it.each(['loading', 'loadError', 'forking', 'closed'] as const)('select in %s returns the same state', (status) => {
    const state = panel(status, 3, status === 'forking' ? MOMENTS : []);
    expect(rewindPanelReducer(state, { type: 'select' })).toBe(state);
  });

  it('forkDone ok with the current request closes the panel', () => {
    const next = rewindPanelReducer(panel('forking', 6), { type: 'forkDone', request: 6, ok: true });
    expect(next).toEqual({ status: 'closed', moments: [], request: 6 });
  });

  it('forkDone not ok keeps the same moments for a retry', () => {
    const state = panel('forking', 6);
    const next = rewindPanelReducer(state, { type: 'forkDone', request: 6, ok: false });
    expect(next).toEqual({ status: 'forkError', moments: state.moments, request: 6 });
  });

  it.each(OPEN_STATUSES)('close from %s closes and invalidates the request', (status) => {
    const next = rewindPanelReducer(panel(status, 7), { type: 'close' });
    expect(next).toEqual({ status: 'closed', moments: [], request: 8 });
  });

  it('ignores stale or out-of-status results', () => {
    const stale: Array<[RewindPanelState, RewindPanelEvent]> = [
      [panel('closed', 2, []), { type: 'loadDone', request: 1, ok: true, moments: MOMENTS }],
      [panel('loading', 3, []), { type: 'loadDone', request: 1, ok: true, moments: MOMENTS }],
      [panel('ready', 3), { type: 'loadDone', request: 3, ok: false, moments: [] }],
      [panel('forking', 4), { type: 'loadDone', request: 4, ok: true, moments: [] }],
      [panel('forking', 5), { type: 'forkDone', request: 4, ok: false }],
      [panel('closed', 5, []), { type: 'forkDone', request: 4, ok: true }],
      [panel('ready', 5), { type: 'forkDone', request: 5, ok: false }],
      [panel('forkError', 5), { type: 'forkDone', request: 5, ok: true }],
    ];
    for (const [state, event] of stale) expect(rewindPanelReducer(state, event)).toBe(state);
  });

  it('open → close → open ignores the first load and applies the second', () => {
    let state = deepFreeze(rewindPanelReducer(initialRewindPanelState, { type: 'open' }));
    const r1 = state.request;
    state = deepFreeze(rewindPanelReducer(state, { type: 'close' }));
    state = deepFreeze(rewindPanelReducer(state, { type: 'open' }));
    const r2 = state.request;
    expect(r2).not.toBe(r1);

    const afterStale = rewindPanelReducer(state, { type: 'loadDone', request: r1, ok: true, moments: MOMENTS });
    expect(afterStale).toBe(state);

    const fresh = [MOMENTS[0]];
    const applied = rewindPanelReducer(afterStale, { type: 'loadDone', request: r2, ok: true, moments: fresh });
    expect(applied).toEqual({ status: 'ready', moments: fresh, request: r2 });
  });

  it('accepts exactly one select per fork attempt (10.6, 10.7)', () => {
    let state: RewindPanelState = panel('ready', 1);
    let forks = 0;
    const selectThrice = () => {
      for (let i = 0; i < 3; i++) {
        if (acceptsSelection(state)) forks++;
        state = deepFreeze(rewindPanelReducer(state, { type: 'select' }));
      }
    };

    selectThrice();
    expect(forks).toBe(1);
    expect(state.status).toBe('forking');

    state = deepFreeze(rewindPanelReducer(state, { type: 'forkDone', request: state.request, ok: false }));
    expect(state.status).toBe('forkError');
    selectThrice();
    expect(forks).toBe(2);
    expect(state.status).toBe('forking');
  });
});

describe('acceptsSelection', () => {
  it('is true only for an open panel in ready or forkError', () => {
    for (const status of [...ALL_STATUSES, 'closed'] as const) {
      expect(acceptsSelection(panel(status, 1))).toBe(status === 'ready' || status === 'forkError');
    }
  });
});

// ---------------------------------------------------------------------------
// buildRewindMoments
// ---------------------------------------------------------------------------

/** Parent b1 → child b2, forked at b1's checkpoint p120 (t=120). */
const FORKED_SESSION: SessionMetadata = {
  session_id: 's1',
  case_id: CASE.id,
  created_at: '',
  current_branch_id: 'b2',
  branches: [
    { branch_id: 'b1', created_at: '', event_count: 0 },
    { branch_id: 'b2', parent_branch_id: 'b1', forked_from_checkpoint: 'p120', created_at: '', event_count: 0 },
  ],
};

function cp(id: string, t: number): CheckpointMetadata {
  return { checkpoint_id: id, simulation_time: t, created_at: '', is_automatic: true };
}

const PARENT_CPS = [cp('p0', 0), cp('p60', 60), cp('p120', 120), cp('p180', 180), cp('p240', 240)];
const CHILD_CPS = [cp('k120', 120), cp('k300', 300), cp('k360', 360), cp('k420', 420), cp('k540', 540), cp('k660', 660)];

function vitals(t: number): VitalSigns {
  return {
    simulation_time: t,
    heart_rate: 80,
    respiratory_rate: 16,
    spo2: 0.97,
    mean_arterial_pressure: 90,
    etco2: 40,
    tidal_volume: 500,
  };
}

const LEFT = CASE.interventions.find((i) => i.id === 'needle-decompression-left')!;
const RIGHT = CASE.interventions.find((i) => i.id === 'needle-decompression-right')!;

function sessionActions(childCps: CheckpointMetadata[], withSamples: boolean): SessionAction[] {
  return [
    { type: 'sessionLoaded', session: FORKED_SESSION },
    { type: 'checkpointsLoaded', byBranch: { b1: PARENT_CPS, b2: childCps } },
    ...(withSamples
      ? ([0, 250, 500].map((t) => ({ type: 'sampleReceived', sample: vitals(t) })) as SessionAction[])
      : []),
    {
      type: 'interventionSucceeded',
      entry: { interventionId: LEFT.id, action: LEFT.action, simulationTime: 90, branchId: 'b1' },
    },
    {
      type: 'interventionSucceeded',
      entry: { interventionId: RIGHT.id, action: RIGHT.action, simulationTime: 400, branchId: 'b2' },
    },
  ];
}

function buildSession(actions: SessionAction[], withCase = true): SessionUiState {
  const all: SessionAction[] = withCase
    ? [{ type: 'caseLoaded', caseData: CASE, storedView: 'play' }, ...actions]
    : actions;
  return deepFreeze(all.reduce(sessionReducer, initialSessionState()));
}

/** Labels from labelRewindMoment for the same checkpoints and lineage interventions. */
function expectedLabels(state: SessionUiState, ids: string[]): string[] {
  const all = Object.values(state.checkpointsByBranch).flat();
  const active = activeInterventions(state.interventionRecord, state.lineage);
  return ids.map((id) => labelRewindMoment(all.find((c) => c.checkpoint_id === id)!, active, CASE.interventions));
}

/** Like `sessionActions`, with the session, both Checkpoint lists and the sample times as inputs. */
function forkedSession(
  session: SessionMetadata,
  parentCps: CheckpointMetadata[],
  childCps: CheckpointMetadata[],
  sampleTimes: number[],
): SessionUiState {
  return buildSession([
    { type: 'sessionLoaded', session },
    { type: 'checkpointsLoaded', byBranch: { b1: parentCps, b2: childCps } },
    ...sampleTimes.map((t): SessionAction => ({ type: 'sampleReceived', sample: vitals(t) })),
    {
      type: 'interventionSucceeded',
      entry: { interventionId: LEFT.id, action: LEFT.action, simulationTime: 90, branchId: 'b1' },
    },
    {
      type: 'interventionSucceeded',
      entry: { interventionId: RIGHT.id, action: RIGHT.action, simulationTime: 400, branchId: 'b2' },
    },
  ]);
}

describe('buildRewindMoments', () => {
  it('lists lineage checkpoints newest first, at most five, within the bounds', () => {
    const state = buildSession(sessionActions(CHILD_CPS, true));
    const moments = buildRewindMoments(state, CASE.interventions);
    const limit = CASE.play!.endings.lost.timeLimitSeconds!;

    expect(moments.map((m) => m.checkpointId)).toEqual(['k420', 'k360', 'k300', 'k120', 'p60']);
    expect(moments.length).toBeLessThanOrEqual(5);
    const times = moments.map((m) => m.simulationTime);
    expect(times).toEqual([...times].sort((a, b) => b - a));
    for (const t of times) {
      expect(t).toBeLessThan(state.latestSample!.simulation_time);
      expect(t).toBeLessThan(limit);
    }
    // The parent's checkpoints after the fork time (120) are not part of the lineage.
    for (const id of ['p180', 'p240']) expect(moments.map((m) => m.checkpointId)).not.toContain(id);

    expect(moments.map((m) => m.label)).toEqual(expectedLabels(state, moments.map((m) => m.checkpointId)));
    expect(moments.find((m) => m.checkpointId === 'k360')!.label).toBe(
      `6:00 - before you chose: ${RIGHT.playLabel}`,
    );
    expect(moments.find((m) => m.checkpointId === 'p60')!.label).toBe(`1:00 - before you chose: ${LEFT.playLabel}`);
  });

  it('labels a selected t=0 checkpoint "at the start"', () => {
    const state = buildSession(sessionActions([cp('k120', 120), cp('k360', 360), cp('k540', 540)], true));
    const moments = buildRewindMoments(state, CASE.interventions);
    expect(moments.map((m) => m.checkpointId)).toEqual(['k360', 'k120', 'p60', 'p0']);
    expect(moments[3].label.startsWith('0:00 - at the start')).toBe(true);
    expect(moments.map((m) => m.label)).toEqual(expectedLabels(state, moments.map((m) => m.checkpointId)));
  });

  it('is empty without a latest sample', () => {
    expect(buildRewindMoments(buildSession(sessionActions(CHILD_CPS, false)), CASE.interventions)).toEqual([]);
  });

  it('does not throw without case data', () => {
    const withCase = buildRewindMoments(buildSession(sessionActions(CHILD_CPS, true)), CASE.interventions);
    const state = buildSession(sessionActions(CHILD_CPS, true), false);
    expect(state.caseData).toBeNull();
    // No time limit applies; every checkpoint here is below 600 anyway, so the moments match.
    expect(buildRewindMoments(state, CASE.interventions)).toEqual(withCase);
  });

  it("gives each moment its checkpoint's simulation_time", () => {
    // A constant simulationTime (e.g. 0) breaks the equality for every non-zero checkpoint.
    const state = buildSession(sessionActions(CHILD_CPS, true));
    const all = Object.values(state.checkpointsByBranch).flat();
    const moments = buildRewindMoments(state, CASE.interventions);
    expect(moments.length).toBeGreaterThan(0);
    for (const m of moments) {
      expect(m.simulationTime).toBe(all.find((c) => c.checkpoint_id === m.checkpointId)!.simulation_time);
    }
    expect(moments.some((m) => m.simulationTime !== 0)).toBe(true);
  });

  it('lists the parent checkpoint at exactly the fork time when the child has none there', () => {
    // A strict `<` upper bound drops p120 (time 120 = the parent's bound 120).
    const state = forkedSession(FORKED_SESSION, PARENT_CPS, [cp('k300', 300), cp('k360', 360)], [0, 250, 500]);
    const ids = buildRewindMoments(state, CASE.interventions).map((m) => m.checkpointId);
    expect(ids).toContain('p120');
    expect(ids).toEqual(['k360', 'k300', 'p120', 'p60', 'p0']);
  });

  it("prefers the current Branch's checkpoint at an equal time even when the parent's id sorts first", () => {
    // With depth 0 for every segment the tie falls to checkpoint_id, and 'a120' < 'k120' would win.
    const session: SessionMetadata = {
      ...FORKED_SESSION,
      branches: [
        FORKED_SESSION.branches[0],
        { ...FORKED_SESSION.branches[1], forked_from_checkpoint: 'a120' },
      ],
    };
    const state = forkedSession(
      session,
      [cp('p0', 0), cp('p60', 60), cp('a120', 120)],
      [cp('k120', 120), cp('k300', 300), cp('k360', 360)],
      [0, 250, 500],
    );
    const ids = buildRewindMoments(state, CASE.interventions).map((m) => m.checkpointId);
    expect(ids).toContain('k120');
    expect(ids).not.toContain('a120');
  });

  it("omits checkpoints at or after the case's lost time limit", () => {
    // Without the time limit, k660 and k600 (both below the latest sample 700) would be listed.
    const limit = CASE.play!.endings.lost.timeLimitSeconds!;
    expect(limit).toBe(600);
    const state = forkedSession(
      FORKED_SESSION,
      PARENT_CPS,
      [cp('k120', 120), cp('k540', 540), cp('k600', 600), cp('k660', 660)],
      [0, 250, 500, 700],
    );
    expect(state.latestSample!.simulation_time).toBe(700);
    const moments = buildRewindMoments(state, CASE.interventions);
    const ids = moments.map((m) => m.checkpointId);
    expect(ids).not.toContain('k600');
    expect(ids).not.toContain('k660');
    expect(ids).toContain('k540');
    for (const m of moments) expect(m.simulationTime).toBeLessThan(limit);
  });
});
