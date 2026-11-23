import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { DEFAULT_BEAT_PERIOD_S, mapAvatar } from './avatarMapper';
import { activeInterventions, buildLineage } from './branchLineage';
import {
  buildEndingContext,
  evaluateEnding,
  initialEndingState,
  requiredInterventions,
  rescueGateTime,
} from './endingEvaluator';
import {
  HISTORY_LIMIT,
  STALE_TOLERANCE_S,
  initialSessionState,
  sessionReducer,
  type SessionAction,
  type SessionUiState,
  type View,
} from './sessionState';
import type {
  AvatarParameters,
  CaseData,
  CheckpointMetadata,
  Hint,
  InterventionRecordEntry,
  PlaybackSpeed,
  PlaySection,
  SessionMetadata,
  Side,
  VitalSigns,
} from '@/types';
import { CASE } from '@/test/caseFixtures';
import { arbLineage, type LineageCase } from '@/test/generators';
import { PBT_PARAMS } from '@/test/pbt';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Freezes an object graph so any mutation by the reducer throws (ESM is strict mode). */
function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const key of Reflect.ownKeys(value)) deepFreeze((value as Record<PropertyKey, unknown>)[key]);
  return Object.freeze(value);
}

/** Runs the reducer with a frozen state and a frozen action. */
function reduce(state: SessionUiState, action: SessionAction): SessionUiState {
  return sessionReducer(deepFreeze(state), deepFreeze(action));
}

const CASE_WITH_PLAY: CaseData = structuredClone(CASE);
const CASE_WITHOUT_PLAY: CaseData = (() => {
  const { play: _play, ...rest } = structuredClone(CASE);
  return rest;
})();

/** Every vital inside its case `normal` range. */
function sample(t: number, overrides: Partial<VitalSigns> = {}): VitalSigns {
  return {
    simulation_time: t,
    heart_rate: 72,
    respiratory_rate: 16,
    spo2: 0.974,
    mean_arterial_pressure: 95,
    etco2: 40,
    tidal_volume: 500,
    ...overrides,
  };
}

const SESSION: SessionMetadata = {
  session_id: 's1',
  case_id: 'adult-tension-pneumothorax',
  created_at: '2026-11-20T10:00:00Z',
  current_branch_id: 'child',
  branches: [
    { branch_id: 'main', created_at: '2026-11-20T10:00:00Z', event_count: 0 },
    {
      branch_id: 'child',
      parent_branch_id: 'main',
      forked_from_checkpoint: 'cp-main-60',
      created_at: '2026-11-20T10:05:00Z',
      event_count: 0,
    },
  ],
};

const CHECKPOINTS: Record<string, CheckpointMetadata[]> = {
  main: [
    { checkpoint_id: 'cp-main-30', simulation_time: 30, created_at: '2026-11-20T10:01:00Z', is_automatic: true },
    { checkpoint_id: 'cp-main-60', simulation_time: 60, created_at: '2026-11-20T10:02:00Z', is_automatic: true },
  ],
};

function loaded(caseData: CaseData = CASE_WITH_PLAY): SessionUiState {
  return reduce(initialSessionState(), { type: 'caseLoaded', caseData, storedView: null });
}

// ---------------------------------------------------------------------------
// caseLoaded / caseFailed
// ---------------------------------------------------------------------------

describe('caseLoaded', () => {
  it('shows Play when the case has a Play_Section and no view was stored (1.1)', () => {
    const next = reduce(initialSessionState(), { type: 'caseLoaded', caseData: CASE_WITH_PLAY, storedView: null });
    expect(next.view).toBe('play');
    expect(next.caseStatus).toBe('loaded');
    expect(next.caseData).toBe(CASE_WITH_PLAY);
    expect(next.endingCtx).toEqual(buildEndingContext(CASE_WITH_PLAY));
    expect(next.ending.ending).toBe('none');
    expect(next.ending.lostStarts).toHaveLength(CASE_WITH_PLAY.play!.endings.lost.groups!.length);
  });

  it('shows the stored Clinician view when the case has a Play_Section (1.9)', () => {
    const next = reduce(initialSessionState(), {
      type: 'caseLoaded',
      caseData: CASE_WITH_PLAY,
      storedView: 'clinician',
    });
    expect(next.view).toBe('clinician');
  });

  it('shows Clinician when the case has no Play_Section, even with a stored Play view (1.2, 1.9)', () => {
    const next = reduce(initialSessionState(), {
      type: 'caseLoaded',
      caseData: CASE_WITHOUT_PLAY,
      storedView: 'play',
    });
    expect(next.view).toBe('clinician');
    expect(next.endingCtx.play).toBeUndefined();
  });
});

describe('caseFailed', () => {
  it('switches to Clinician and keeps session, branch and connection (1.11)', () => {
    let state = reduce(initialSessionState(), { type: 'sessionLoaded', session: SESSION });
    state = reduce(state, { type: 'connectionChanged', connected: true });

    const next = reduce(state, { type: 'caseFailed', message: 'timeout' });

    expect(next.view).toBe('clinician');
    expect(next.caseStatus).toBe('failed');
    expect(next.caseError).toBe('timeout');
    expect(next.session).toBe(state.session);
    expect(next.currentBranchId).toBe('child');
    expect(next.connected).toBe(true);
    expect(next.lineage).toBe(state.lineage);
  });
});

// ---------------------------------------------------------------------------
// sessionLoaded / checkpointsLoaded / connectionChanged
// ---------------------------------------------------------------------------

describe('sessionLoaded and checkpointsLoaded', () => {
  it('sets the session and current Branch, then recomputes the lineage when Checkpoints load', () => {
    const withSession = reduce(initialSessionState(), { type: 'sessionLoaded', session: SESSION });
    expect(withSession.session).toBe(SESSION);
    expect(withSession.currentBranchId).toBe('child');
    // No Checkpoint lists yet: the lineage is the current Branch alone.
    expect(withSession.lineage).toEqual(buildLineage(SESSION.branches, 'child', {}));
    expect(withSession.lineage).toHaveLength(1);

    const next = reduce(withSession, { type: 'checkpointsLoaded', byBranch: CHECKPOINTS });
    expect(next.checkpointsByBranch).toEqual(CHECKPOINTS);
    expect(next.lineage).toEqual(buildLineage(SESSION.branches, 'child', CHECKPOINTS));
    expect(next.lineage).toEqual([
      { branchId: 'child', upperBound: Number.POSITIVE_INFINITY, forkCheckpointId: 'cp-main-60', forkTime: 60 },
      { branchId: 'main', upperBound: 60 },
    ]);
  });

  it('keeps an empty lineage when Checkpoints load before the session', () => {
    const next = reduce(initialSessionState(), { type: 'checkpointsLoaded', byBranch: CHECKPOINTS });
    expect(next.checkpointsByBranch).toEqual(CHECKPOINTS);
    expect(next.lineage).toEqual([]);
  });
});

describe('connectionChanged', () => {
  it('sets the flag and returns the same state when it does not change', () => {
    const state = initialSessionState();
    const next = reduce(state, { type: 'connectionChanged', connected: true });
    expect(next.connected).toBe(true);
    expect(reduce(next, { type: 'connectionChanged', connected: true })).toBe(next);
  });
});

// ---------------------------------------------------------------------------
// viewSelected / playbackChanged
// ---------------------------------------------------------------------------

describe('viewSelected', () => {
  it('changes only the view (1.4)', () => {
    let state = reduce(loaded(), { type: 'sessionLoaded', session: SESSION });
    state = reduce(state, { type: 'connectionChanged', connected: true });
    state = reduce(state, { type: 'sampleReceived', sample: sample(10) });

    const next = reduce(state, { type: 'viewSelected', view: 'clinician' });

    expect(next.view).toBe('clinician');
    for (const key of Object.keys(state) as (keyof SessionUiState)[]) {
      if (key !== 'view') expect(next[key]).toBe(state[key]);
    }
    expect(reduce(next, { type: 'viewSelected', view: 'clinician' })).toBe(next);
  });

  it('keeps Clinician when Play is selected for a case without a Play_Section (1.2)', () => {
    const state = loaded(CASE_WITHOUT_PLAY);
    expect(reduce(state, { type: 'viewSelected', view: 'play' })).toBe(state);
  });
});

describe('playbackChanged', () => {
  it('updates only the given fields', () => {
    const state = initialSessionState();
    const playing = reduce(state, { type: 'playbackChanged', playing: true });
    expect(playing.playing).toBe(true);
    expect(playing.speed).toBe(state.speed);

    const faster = reduce(playing, { type: 'playbackChanged', speed: '4x' });
    expect(faster.playing).toBe(true);
    expect(faster.speed).toBe('4x');

    expect(reduce(faster, { type: 'playbackChanged' })).toBe(faster);
  });
});

// ---------------------------------------------------------------------------
// sampleReceived
// ---------------------------------------------------------------------------

describe('sampleReceived: stale-sample guard', () => {
  it('drops an old-Branch sample above forkTime + 5 before the first accepted sample, then disarms', () => {
    const forkTime = 120;
    const maxTime = forkTime + STALE_TOLERANCE_S;
    const armed: SessionUiState = { ...loaded(), staleGuard: { maxTime } };

    // Old-Branch sample just above the tolerance: dropped, state unchanged.
    const dropped = reduce(armed, { type: 'sampleReceived', sample: sample(maxTime + 0.5) });
    expect(dropped).toBe(armed);

    // First new-Branch sample at the tolerance: accepted, guard disarmed.
    const accepted = reduce(dropped, { type: 'sampleReceived', sample: sample(maxTime) });
    expect(accepted.staleGuard).toBeNull();
    expect(accepted.latestSample?.simulation_time).toBe(maxTime);
    expect(accepted.history).toHaveLength(1);

    // After disarming, a later sample above the old limit is accepted.
    const later = reduce(accepted, { type: 'sampleReceived', sample: sample(maxTime + 30) });
    expect(later.latestSample?.simulation_time).toBe(maxTime + 30);
    expect(later.history.map((s) => s.simulation_time)).toEqual([maxTime, maxTime + 30]);
  });
});

describe('sampleReceived: history, Ending and Ending snapshot', () => {
  // Test values with round numbers, not clinical content. Rescue never holds
  // long enough; Lost holds after 20 s of SpO2 < 0.85.
  const PLAY: PlaySection = {
    goalText: 'Test goal',
    diagnosisTerms: ['test-term'],
    endings: {
      rescued: { conditions: [{ vital: 'spO2', op: '>=', value: 0.99 }], holdSeconds: 10_000 },
      lost: { groups: [{ conditions: [{ vital: 'spO2', op: '<', value: 0.85 }], holdSeconds: 20 }] },
    },
    hints: [{ text: 'Test hint' }],
    status: { rules: [], defaultSentence: 'Test status' },
  };
  const caseData: CaseData = { ...structuredClone(CASE), play: PLAY };

  // t = 1..400 s. SpO2 drops below 0.85 at t = 251, so the Lost group holds
  // from 251 and the Ending becomes `lost` at t = 271. Tidal volume is 0 for
  // the first 10 samples, so the first positive value (480) arrives at t = 11.
  const SAMPLES: VitalSigns[] = Array.from({ length: 400 }, (_, i) => {
    const t = i + 1;
    return sample(t, {
      heart_rate: 60 + (t % 50),
      spo2: t <= 250 ? 0.97 : 0.8,
      tidal_volume: t <= 10 ? 0 : 480 + (t % 7),
    });
  });
  const LOST_AT = 271;

  it('keeps the last 300 samples while the Ending equals evaluateEnding over all 400 (6.13)', () => {
    let state = loaded(caseData);
    SAMPLES.forEach((s, i) => {
      state = reduce(state, { type: 'sampleReceived', sample: s });
      const n = i + 1;
      expect(state.history.length).toBe(Math.min(n, HISTORY_LIMIT));
    });

    expect(state.history).toHaveLength(HISTORY_LIMIT);
    expect(state.history).toEqual(SAMPLES.slice(-HISTORY_LIMIT));
    expect(state.latestSample).toEqual(SAMPLES[SAMPLES.length - 1]);

    const expected = evaluateEnding(buildEndingContext(caseData), SAMPLES);
    expect(state.ending).toEqual(expected);
    expect(state.ending.ending).toBe('lost');
    expect(state.ending.endedAt).toBe(LOST_AT);
    expect(state.firstPositiveTidalVolumeMl).toBe(480 + (11 % 7));
  });

  it('snapshots the Avatar of the sample at which the Ending changed and keeps it (7.3)', () => {
    // Independent fold of mapAvatar with the previous parameters and the first positive tidal volume.
    const initial = loaded(caseData);
    let previous: AvatarParameters = initial.avatar;
    let firstTv: number | null = null;
    const avatars = new Map<number, AvatarParameters>();
    for (const s of SAMPLES) {
      if (firstTv === null && s.tidal_volume > 0) firstTv = s.tidal_volume;
      previous = mapAvatar({
        sample: s,
        alarms: caseData.alarms,
        play: PLAY,
        scheduledInsults: caseData.timeline.scheduledInsults,
        activeInterventions: [],
        previous,
        firstPositiveTidalVolumeMl: firstTv,
        revealedSides: 'all',
      });
      avatars.set(s.simulation_time, previous);
    }

    let state = initial;
    for (const s of SAMPLES) {
      state = reduce(state, { type: 'sampleReceived', sample: s });
      expect(state.avatar).toEqual(avatars.get(s.simulation_time));
      if (s.simulation_time < LOST_AT) expect(state.endingSnapshot).toBeNull();
      if (s.simulation_time >= LOST_AT) expect(state.endingSnapshot).toEqual(avatars.get(LOST_AT));
    }

    // The snapshot stayed at t = 271 although the live Avatar moved on.
    expect(state.avatar).not.toEqual(avatars.get(LOST_AT));
    expect(state.endingSnapshot).toEqual(avatars.get(LOST_AT));
  });
});

describe('sampleReceived: inputs passed to the Avatar_Mapper', () => {
  it('passes the previous Avatar, so a stopped heartbeat keeps the last period', () => {
    const firstPeriodS = 60 / 75;
    expect(firstPeriodS).not.toBe(DEFAULT_BEAT_PERIOD_S);

    const first = reduce(loaded(), { type: 'sampleReceived', sample: sample(1, { heart_rate: 75 }) });
    expect(first.avatar.heartbeat).toEqual({ stopped: false, periodS: firstPeriodS });

    const second = reduce(first, { type: 'sampleReceived', sample: sample(2, { heart_rate: 0 }) });
    expect(second.avatar.heartbeat.stopped).toBe(true);
    expect(second.avatar.heartbeat.periodS).toBe(firstPeriodS);
    expect(second.avatar.heartbeat.periodS).not.toBe(DEFAULT_BEAT_PERIOD_S);
  });

  it('passes only the Active_Interventions of the Branch_Lineage (4.15)', () => {
    // Lineage: child (unbounded) -> main (bounded by the fork at t = 60).
    let state = reduce(loaded(), { type: 'sessionLoaded', session: SESSION });
    state = reduce(state, { type: 'checkpointsLoaded', byBranch: CHECKPOINTS });
    expect(state.lineage).toEqual([
      { branchId: 'child', upperBound: Number.POSITIVE_INFINITY, forkCheckpointId: 'cp-main-60', forkTime: 60 },
      { branchId: 'main', upperBound: 60 },
    ]);

    const record: InterventionRecordEntry[] = [
      // Not active: on the parent after the fork time.
      { interventionId: 'i1', action: 'SENeedleDecompression', side: 'Left', simulationTime: 90, branchId: 'main' },
      // Not active: on a Branch outside the lineage.
      { interventionId: 'i2', action: 'SENeedleDecompression', side: 'Left', simulationTime: 40, branchId: 'other' },
      // Active: on the parent before the fork time.
      { interventionId: 'i3', action: 'SENeedleDecompression', side: 'Right', simulationTime: 50, branchId: 'main' },
    ];
    state = { ...state, interventionRecord: record };

    const next = reduce(state, { type: 'sampleReceived', sample: sample(100) });

    expect(next.avatar.decompressedSides).toContain('Right');
    expect(next.avatar.decompressedSides).not.toContain('Left');
    // The case's Left insult at t = 30 stays untreated on this lineage.
    expect(next.avatar.swollenSides).toContain('Left');
  });
});

// ---------------------------------------------------------------------------
// Task 8.2: interventions, forks and hints
// ---------------------------------------------------------------------------

const SESSION_MAIN: SessionMetadata = {
  session_id: 's1',
  case_id: 'adult-tension-pneumothorax',
  created_at: '2026-11-20T10:00:00Z',
  current_branch_id: 'main',
  branches: [{ branch_id: 'main', created_at: '2026-11-20T10:00:00Z', event_count: 0 }],
};

/** Session after forking `fork1` from a Checkpoint of `main`. */
function forkedSession(checkpointId: string): SessionMetadata {
  return {
    ...SESSION_MAIN,
    current_branch_id: 'fork1',
    branches: [
      ...SESSION_MAIN.branches,
      {
        branch_id: 'fork1',
        parent_branch_id: 'main',
        forked_from_checkpoint: checkpointId,
        created_at: '2026-11-20T10:06:00Z',
        event_count: 0,
      },
    ],
  };
}

/** Checkpoint ids in CHECKPOINTS.main by Simulation_Time. */
const CP_AT: Record<number, string> = { 30: 'cp-main-30', 60: 'cp-main-60' };

function fork(state: SessionUiState, forkTime: number): SessionUiState {
  return reduce(state, {
    type: 'forkSucceeded',
    session: forkedSession(CP_AT[forkTime]),
    newBranchId: 'fork1',
    forkTime,
  });
}

/** Case loaded and the Session on its first Branch `main`. */
function onMain(caseData: CaseData = CASE_WITH_PLAY): SessionUiState {
  return reduce(loaded(caseData), { type: 'sessionLoaded', session: SESSION_MAIN });
}

function decompression(side: 'Left' | 'Right', simulationTime: number, branchId: string): InterventionRecordEntry {
  return {
    interventionId: `needle-decompression-${side.toLowerCase()}`,
    action: 'SENeedleDecompression',
    side,
    simulationTime,
    branchId,
  };
}

/** The Avatar without its side fields. */
function withoutSides(a: AvatarParameters): Omit<AvatarParameters, 'swollenSides' | 'decompressedSides'> {
  const { swollenSides: _s, decompressedSides: _d, ...rest } = a;
  return rest;
}

// Test values with round numbers, not clinical content: Lost holds after 20 s
// of SpO2 < 0.85; Rescue never holds long enough.
const PLAY_LOST: PlaySection = {
  goalText: 'Test goal',
  diagnosisTerms: ['test-term'],
  endings: {
    rescued: { conditions: [{ vital: 'spO2', op: '>=', value: 0.99 }], holdSeconds: 10_000 },
    lost: { groups: [{ conditions: [{ vital: 'spO2', op: '<', value: 0.85 }], holdSeconds: 20 }] },
  },
  hints: [{ text: 'Test hint 1' }, { text: 'Test hint 2' }],
  status: { rules: [], defaultSentence: 'Test status' },
};
const CASE_LOST: CaseData = { ...structuredClone(CASE), play: PLAY_LOST };

function feed(state: SessionUiState, times: number[], overrides: Partial<VitalSigns> = {}): SessionUiState {
  return times.reduce((s, t) => reduce(s, { type: 'sampleReceived', sample: sample(t, overrides) }), state);
}

const range = (from: number, to: number): number[] => Array.from({ length: to - from + 1 }, (_, i) => from + i);

describe('interventionSucceeded', () => {
  it('updates Swollen_Sides and Decompressed_Sides without waiting for a sample (4.14, 4.20)', () => {
    // The case's Left insult starts at t = 30.
    const before = feed(onMain(), [40]);
    expect(before.avatar.swollenSides).toEqual(['Left']);
    expect(before.avatar.decompressedSides).toEqual([]);

    const entry = decompression('Left', 40, 'main');
    const next = reduce(before, { type: 'interventionSucceeded', entry });

    expect(next.interventionRecord).toEqual([entry]);
    expect(next.avatar.swollenSides).toEqual([]);
    expect(next.avatar.decompressedSides).toEqual(['Left']);
    // Every other Avatar field is unchanged, with the same nested objects.
    expect(withoutSides(next.avatar)).toEqual(withoutSides(before.avatar));
    expect(next.avatar.breathing).toBe(before.avatar.breathing);
    expect(next.avatar.heartbeat).toBe(before.avatar.heartbeat);
    expect(next.avatar.bands).toBe(before.avatar.bands);
    // No sample was consumed.
    expect(next.latestSample).toBe(before.latestSample);
    expect(next.history).toBe(before.history);
    expect(next.ending).toBe(before.ending);
  });

  it('uses the fork time without a sample on the Branch, and 0 on the first Branch (9.5 fallbacks)', () => {
    // Fork at t = 60, after the Left insult at 30: Left is swollen at the fork time.
    const forked = fork(onMain(), 60);
    expect(forked.latestSample).toBeNull();
    const afterFork = reduce(forked, { type: 'interventionSucceeded', entry: decompression('Right', 60, 'fork1') });
    expect(afterFork.avatar.swollenSides).toEqual(['Left']);
    expect(afterFork.avatar.decompressedSides).toEqual(['Right']);

    // First Branch, no sample: time 0 is before the insult, so nothing is swollen.
    const first = reduce(onMain(), { type: 'interventionSucceeded', entry: decompression('Right', 0, 'main') });
    expect(first.avatar.swollenSides).toEqual([]);
    expect(first.avatar.decompressedSides).toEqual(['Right']);
  });

  it('uses only the Active_Interventions of the lineage (4.15)', () => {
    const before = feed(onMain(), [40]);
    const next = reduce(before, { type: 'interventionSucceeded', entry: decompression('Left', 40, 'other') });
    expect(next.interventionRecord).toHaveLength(1);
    expect(next.avatar.swollenSides).toEqual(['Left']);
    expect(next.avatar.decompressedSides).toEqual([]);
  });
});

describe('interventionRecordRestored', () => {
  it('replaces the record and recomputes the side fields from the lineage', () => {
    const before = reduce(feed(onMain(), [40]), {
      type: 'interventionSucceeded',
      entry: decompression('Right', 35, 'main'),
    });
    const record = [decompression('Left', 35, 'main'), decompression('Right', 35, 'other')];

    const next = reduce(before, { type: 'interventionRecordRestored', record });

    expect(next.interventionRecord).toEqual(record);
    expect(next.avatar.swollenSides).toEqual([]);
    expect(next.avatar.decompressedSides).toEqual(['Left']);
    expect(withoutSides(next.avatar)).toEqual(withoutSides(before.avatar));
  });
});

describe('forkSucceeded', () => {
  it('resets the per-Branch fields and keeps the session-scoped ones', () => {
    let state = reduce(onMain(CASE_LOST), { type: 'checkpointsLoaded', byBranch: CHECKPOINTS });
    state = feed(state, range(1, 40), { spo2: 0.8, tidal_volume: 480 });
    state = reduce(state, { type: 'interventionSucceeded', entry: decompression('Left', 25, 'main') });
    state = reduce(state, { type: 'hintRevealed', wallClockTime: '2026-11-20T10:03:00Z' });
    state = reduce(state, { type: 'playbackChanged', playing: true, speed: '2x' });
    state = reduce(state, { type: 'viewSelected', view: 'clinician' });
    state = reduce(state, { type: 'connectionChanged', connected: true });
    expect(state.ending.ending).toBe('lost');
    expect(state.endingSnapshot).not.toBeNull();
    expect(state.history).toHaveLength(40);

    const session = forkedSession('cp-main-30');
    const next = reduce(state, { type: 'forkSucceeded', session, newBranchId: 'fork1', forkTime: 30 });

    const lineage = [
      { branchId: 'fork1', upperBound: Number.POSITIVE_INFINITY, forkCheckpointId: 'cp-main-30', forkTime: 30 },
      { branchId: 'main', upperBound: 30 },
    ];
    const avatar = mapAvatar({
      sample: { simulation_time: 30 },
      alarms: CASE_LOST.alarms,
      play: PLAY_LOST,
      scheduledInsults: CASE_LOST.timeline.scheduledInsults,
      activeInterventions: [decompression('Left', 25, 'main')],
      previous: null,
      firstPositiveTidalVolumeMl: 480,
      revealedSides: 'all',
    });
    const { checkpointsByBranch, ...rest } = next;
    const { checkpointsByBranch: _old, ...stateRest } = state;
    expect(rest).toEqual({
      ...stateRest,
      // Reset or recomputed
      session,
      currentBranchId: 'fork1',
      lineage,
      latestSample: null,
      history: [],
      ending: initialEndingState(buildEndingContext(CASE_LOST)),
      endingSnapshot: null,
      staleGuard: { maxTime: 30 + STALE_TOLERANCE_S },
      avatar,
    });
    expect(next.ending.lostStarts).toEqual([null]);
    expect(checkpointsByBranch.main).toBe(state.checkpointsByBranch.main);

    // Kept, as the same objects
    for (const key of [
      'hintsRevealed',
      'hintRecord',
      'interventionRecord',
      'playing',
      'speed',
      'view',
      'firstPositiveTidalVolumeMl',
      'caseData',
      'endingCtx',
      'connected',
    ] as const) {
      expect(next[key]).toBe(state[key]);
    }
    expect(next.hintsRevealed).toBe(1);
    expect(next.playing).toBe(true);
    expect(next.speed).toBe('2x');
    expect(next.view).toBe('clinician');
    expect(next.firstPositiveTidalVolumeMl).toBe(480);
  });

  it("gives the new Branch's Ending `none`, and old samples add no hold time (6.11)", () => {
    // Lost on main at t = 21 (SpO2 < 0.85 from t = 1, hold 20 s).
    let state = feed(onMain(CASE_LOST), range(1, 40), { spo2: 0.8 });
    expect(state.ending.ending).toBe('lost');
    expect(state.ending.endedAt).toBe(21);

    state = fork(state, 30);
    expect(state.ending.ending).toBe('none');

    // A late old-Branch sample above forkTime + 5 is dropped.
    expect(reduce(state, { type: 'sampleReceived', sample: sample(41, { spo2: 0.8 }) })).toBe(state);

    // The new Branch's hold starts at its own first sample, t = 31.
    state = feed(state, range(31, 50), { spo2: 0.8 });
    expect(state.ending.ending).toBe('none');
    state = feed(state, [51], { spo2: 0.8 });
    expect(state.ending.ending).toBe('lost');
    expect(state.ending.endedAt).toBe(51);
  });

  it('bounds the parent at the fork time at once, before any checkpointsLoaded (4.15, 10.9)', () => {
    let state = onMain();
    state = reduce(state, {
      type: 'interventionRecordRestored',
      record: [
        decompression('Left', 45, 'main'), // before the fork time: active
        decompression('Right', 60, 'main'), // at the fork time: active
        decompression('Left', 80, 'main'), // after the fork time: not active
      ],
    });
    // No Checkpoint list is loaded for any Branch.
    expect(state.checkpointsByBranch).toEqual({});

    const next = fork(state, 60);

    const expectedLineage = [
      { branchId: 'fork1', upperBound: Number.POSITIVE_INFINITY, forkCheckpointId: 'cp-main-60', forkTime: 60 },
      { branchId: 'main', upperBound: 60 },
    ];
    expect(next.lineage).toEqual(expectedLineage);
    expect(next.avatar.decompressedSides).toEqual(['Left', 'Right']);
    expect(next.avatar.swollenSides).toEqual([]);

    // The real lists, loaded later, give the same lineage.
    const loadedLater = reduce(next, {
      type: 'checkpointsLoaded',
      byBranch: {
        ...CHECKPOINTS,
        fork1: [
          { checkpoint_id: 'cp-fork1-copy', simulation_time: 60, created_at: '2026-11-20T10:06:00Z', is_automatic: false },
        ],
      },
    });
    expect(loadedLater.lineage).toEqual(next.lineage);
  });

  it('excludes a parent entry after the fork time', () => {
    const state = reduce(onMain(), {
      type: 'interventionRecordRestored',
      record: [decompression('Left', 80, 'main')],
    });
    const next = fork(state, 60);
    expect(next.avatar.decompressedSides).toEqual([]);
    expect(next.avatar.swollenSides).toEqual(['Left']);
  });

  it('shows the side swollen again after a fork to a Checkpoint before the Decompression', () => {
    let state = reduce(onMain(), { type: 'checkpointsLoaded', byBranch: CHECKPOINTS });
    state = feed(state, [100]);
    state = reduce(state, { type: 'interventionSucceeded', entry: decompression('Left', 100, 'main') });
    state = feed(state, [120]);
    expect(state.avatar.swollenSides).toEqual([]);
    expect(state.avatar.decompressedSides).toEqual(['Left']);

    const next = fork(state, 60);
    expect(next.avatar.swollenSides).toEqual(['Left']);
    expect(next.avatar.decompressedSides).toEqual([]);
    expect(next.interventionRecord).toBe(state.interventionRecord);
  });
});

describe('failed fork', () => {
  it('leaves the state identical: the hook dispatches nothing, and no other action resets the Branch (6.17)', () => {
    let state = reduce(onMain(CASE_LOST), { type: 'checkpointsLoaded', byBranch: CHECKPOINTS });
    state = feed(state, range(1, 40), { spo2: 0.8 });
    state = reduce(state, { type: 'hintRevealed', wallClockTime: '2026-11-20T10:03:00Z' });
    expect(state.ending.ending).toBe('lost');

    // No action dispatched: the state object is the one before the attempt.
    const afterFailure = state;
    expect(afterFailure).toBe(state);

    // Actions the hook may dispatch around a failed attempt never reset Branch state.
    let other = reduce(state, { type: 'playbackChanged', playing: false });
    other = reduce(other, { type: 'connectionChanged', connected: true });
    other = reduce(other, { type: 'sessionLoaded', session: SESSION_MAIN });
    other = reduce(other, { type: 'checkpointsLoaded', byBranch: CHECKPOINTS });
    other = reduce(other, { type: 'viewSelected', view: 'clinician' });
    for (const key of [
      'latestSample',
      'history',
      'staleGuard',
      'avatar',
      'ending',
      'endingSnapshot',
      'hintsRevealed',
      'hintRecord',
      'interventionRecord',
      'currentBranchId',
      'firstPositiveTidalVolumeMl',
    ] as const) {
      expect(other[key]).toBe(state[key]);
    }
    expect(other.lineage).toEqual(state.lineage);
  });
});

describe('hintRevealed', () => {
  const WALL = '2026-11-20T10:04:00Z';

  it('records the latest sample time on the current Branch (9.5)', () => {
    const next = reduce(feed(onMain(), [42]), { type: 'hintRevealed', wallClockTime: WALL });
    expect(next.hintsRevealed).toBe(1);
    expect(next.hintRecord).toEqual([{ hintIndex: 1, branchId: 'main', simulationTime: 42, wallClockTime: WALL }]);
  });

  it("records the Branch's fork time when no sample has arrived on it (9.5)", () => {
    const afterFork = reduce(fork(feed(onMain(), [42]), 60), { type: 'hintRevealed', wallClockTime: WALL });
    expect(afterFork.hintRecord).toEqual([{ hintIndex: 1, branchId: 'fork1', simulationTime: 60, wallClockTime: WALL }]);

    // After a page load on a forked Branch, once the Checkpoint lists are known.
    let reloaded = reduce(loaded(), { type: 'sessionLoaded', session: SESSION });
    reloaded = reduce(reloaded, { type: 'checkpointsLoaded', byBranch: CHECKPOINTS });
    reloaded = reduce(reloaded, { type: 'hintRevealed', wallClockTime: WALL });
    expect(reloaded.hintRecord).toEqual([{ hintIndex: 1, branchId: 'child', simulationTime: 60, wallClockTime: WALL }]);
  });

  it('records the latest sample time after a fork once a new-Branch sample has arrived (9.5)', () => {
    // Fork at t = 60 arms the stale guard (max 65). The sample at 62 is accepted and
    // disarms it, so the later sample at 75 is accepted too.
    let state = fork(feed(onMain(), [42]), 60);
    state = feed(state, [62, 75]);
    expect(state.staleGuard).toBeNull();
    expect(state.latestSample?.simulation_time).toBe(75);

    const next = reduce(state, { type: 'hintRevealed', wallClockTime: WALL });
    expect(next.hintRecord).toEqual([{ hintIndex: 1, branchId: 'fork1', simulationTime: 75, wallClockTime: WALL }]);
  });

  it("records 0 on the Session's first Branch when no sample has arrived (9.5)", () => {
    const next = reduce(onMain(), { type: 'hintRevealed', wallClockTime: WALL });
    expect(next.hintRecord).toEqual([{ hintIndex: 1, branchId: 'main', simulationTime: 0, wallClockTime: WALL }]);
  });

  it('reveals one Hint at a time and none past the last (9.2, 9.3)', () => {
    const hintCount = CASE_WITH_PLAY.play!.hints.length;
    expect(hintCount).toBe(3);
    let state = onMain();
    for (let i = 1; i <= hintCount; i++) {
      state = reduce(state, { type: 'hintRevealed', wallClockTime: `2026-11-20T10:0${i}:00Z` });
      expect(state.hintsRevealed).toBe(i);
    }
    expect(state.hintRecord.map((h) => h.hintIndex)).toEqual([1, 2, 3]);
    expect(reduce(state, { type: 'hintRevealed', wallClockTime: WALL })).toBe(state);
  });

  it('returns the same state for a case without a Play_Section', () => {
    const state = onMain(CASE_WITHOUT_PLAY);
    expect(reduce(state, { type: 'hintRevealed', wallClockTime: WALL })).toBe(state);
  });
});

// ---------------------------------------------------------------------------
// Task 8.2: properties 20 and 21
// ---------------------------------------------------------------------------

/** One step of a generated action sequence; turned into a valid action by `toAction`. */
type OpSpec =
  | { kind: 'view'; view: View }
  | { kind: 'playback'; playing: boolean | undefined; speed: PlaybackSpeed | undefined }
  /** Sample `offset` s after the latest sample (or the Branch start); offsets > 5 s right after a fork pass the stale-guard bound. */
  | { kind: 'sample'; offset: number; spo2: number; tidalVolume: number }
  /** Fork at `at` (0 to 1) of the way from the current Branch's start to its latest time. */
  | { kind: 'fork'; at: number }
  | { kind: 'intervention'; side: Side }
  | { kind: 'hint' };

const arbViewOp: fc.Arbitrary<OpSpec> = fc.record({
  kind: fc.constant('view' as const),
  view: fc.constantFrom<View>('play', 'clinician'),
});
const arbPlaybackOp: fc.Arbitrary<OpSpec> = fc.record({
  kind: fc.constant('playback' as const),
  playing: fc.option(fc.boolean(), { nil: undefined }),
  speed: fc.option(fc.constantFrom<PlaybackSpeed>('1x', '2x', '4x'), { nil: undefined }),
});
const arbSampleOp: fc.Arbitrary<OpSpec> = fc.record({
  kind: fc.constant('sample' as const),
  offset: fc.integer({ min: 1, max: 24 }).map((n) => n / 2),
  spo2: fc.constantFrom(0.97, 0.8),
  tidalVolume: fc.constantFrom(0, 0, 480, 500),
});
const arbForkOp: fc.Arbitrary<OpSpec> = fc.record({
  kind: fc.constant('fork' as const),
  at: fc.integer({ min: 0, max: 4 }).map((n) => n / 4),
});
const arbInterventionOp: fc.Arbitrary<OpSpec> = fc.record({
  kind: fc.constant('intervention' as const),
  side: fc.constantFrom<Side>('Left', 'Right'),
});
const arbHintOp: fc.Arbitrary<OpSpec> = fc.constant({ kind: 'hint' as const });

/** Mixed sequence for Property 20: mostly samples, view switches and forks. */
const arbP20Ops: fc.Arbitrary<OpSpec[]> = fc.array(
  fc.oneof(
    { weight: 3, arbitrary: arbViewOp },
    { weight: 2, arbitrary: arbPlaybackOp },
    { weight: 6, arbitrary: arbSampleOp },
    { weight: 3, arbitrary: arbForkOp },
    { weight: 1, arbitrary: arbInterventionOp },
    { weight: 1, arbitrary: arbHintOp },
  ),
  { minLength: 1, maxLength: 30 },
);

/** Mixed sequence for Property 21: hints interleaved with samples, view switches and forks. */
const arbP21Ops: fc.Arbitrary<OpSpec[]> = fc.array(
  fc.oneof(
    { weight: 4, arbitrary: arbHintOp },
    { weight: 4, arbitrary: arbSampleOp },
    { weight: 2, arbitrary: arbViewOp },
    { weight: 2, arbitrary: arbForkOp },
    { weight: 1, arbitrary: arbPlaybackOp },
  ),
  { minLength: 1, maxLength: 25 },
);

/** Test values with round numbers, not clinical content: Lost holds after 5 s of SpO2 < 0.85. */
const PLAY_P20: PlaySection = {
  ...PLAY_LOST,
  endings: {
    ...PLAY_LOST.endings,
    lost: { groups: [{ conditions: [{ vital: 'spO2', op: '<', value: 0.85 }], holdSeconds: 5 }] },
  },
};
const CASE_P20: CaseData = { ...structuredClone(CASE), play: PLAY_P20 };

/** Case for Property 20: usually with a Play_Section, sometimes without. */
const arbP20Case: fc.Arbitrary<CaseData> = fc.oneof(
  { weight: 3, arbitrary: fc.constant(CASE_P20) },
  { weight: 1, arbitrary: fc.constant(CASE_WITHOUT_PLAY) },
);

/** Play_Section for Property 21: PLAY_LOST with 1 to 3 test Hints. */
const arbP21Play: fc.Arbitrary<PlaySection> = fc
  .integer({ min: 1, max: 3 })
  .map((n): PlaySection => ({
    ...PLAY_LOST,
    hints: Array.from({ length: n }, (_, i): Hint => ({ text: `Test hint ${i + 1}` })),
  }));

/** Running facts the reducer state does not hold directly: the current Branch's start and the fork count. */
interface OpModel {
  branchStart: number;
  forks: number;
}

/**
 * Turns an OpSpec into a valid action for `state`: sample times increase from
 * the latest sample (or the Branch start); a fork names a new Branch whose
 * parent is the current Branch, a Checkpoint id of the parent, and a fork time
 * between the current Branch's start and its latest time.
 */
function toAction(state: SessionUiState, model: OpModel, op: OpSpec, step: number): SessionAction {
  const now = state.latestSample?.simulation_time ?? model.branchStart;
  switch (op.kind) {
    case 'view':
      return { type: 'viewSelected', view: op.view };
    case 'playback':
      return { type: 'playbackChanged', playing: op.playing, speed: op.speed };
    case 'sample':
      return {
        type: 'sampleReceived',
        sample: sample(now + op.offset, { spo2: op.spo2, tidal_volume: op.tidalVolume }),
      };
    case 'intervention':
      return { type: 'interventionSucceeded', entry: decompression(op.side, now, state.currentBranchId!) };
    case 'hint':
      return { type: 'hintRevealed', wallClockTime: new Date(Date.UTC(2026, 10, 20, 10, 0, step)).toISOString() };
    case 'fork': {
      const parentId = state.currentBranchId!;
      const forkTime = model.branchStart + Math.round(op.at * (now - model.branchStart) * 2) / 2;
      const newBranchId = `fork${model.forks + 1}`;
      const session: SessionMetadata = {
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
      return { type: 'forkSucceeded', session, newBranchId, forkTime };
    }
  }
}

/** Runs the ops from `start`, calling `check` with the state before and after every action. */
function runOps(
  start: SessionUiState,
  ops: OpSpec[],
  check: (prev: SessionUiState, action: SessionAction, next: SessionUiState) => void,
): SessionUiState {
  const model: OpModel = { branchStart: 0, forks: 0 };
  let state = start;
  ops.forEach((op, i) => {
    const action = toAction(state, model, op, i);
    const next = reduce(state, action);
    check(state, action, next);
    if (action.type === 'forkSucceeded') {
      model.branchStart = action.forkTime;
      model.forks += 1;
    }
    state = next;
  });
  return state;
}

const KEPT_ON_FORK = [
  'hintsRevealed',
  'hintRecord',
  'interventionRecord',
  'playing',
  'speed',
  'view',
  'firstPositiveTidalVolumeMl',
] as const;

describe('sessionReducer properties', () => {
  // Feature: play-mode, Property 20: View switches and forks preserve session-scoped state
  it('Property 20: View switches and forks preserve session-scoped state', () => {
    /** Validates: Requirements 1.4, 6.11, 9.4, 10.8 */
    fc.assert(
      fc.property(arbP20Case, arbP20Ops, (caseData, ops) => {
        runOps(onMain(caseData), ops, (prev, action, next) => {
          if (action.type === 'viewSelected') {
            if (action.view === 'play' && prev.caseData?.play === undefined) {
              expect(next).toBe(prev);
              return;
            }
            expect(next.view).toBe(action.view);
            for (const key of Object.keys(prev) as (keyof SessionUiState)[]) {
              if (key !== 'view') expect(next[key]).toBe(prev[key]);
            }
          }
          if (action.type === 'forkSucceeded') {
            for (const key of KEPT_ON_FORK) expect(next[key]).toBe(prev[key]);
            expect(next.latestSample).toBeNull();
            expect(next.history).toEqual([]);
            expect(next.ending).toEqual(initialEndingState(prev.endingCtx));
            expect(next.ending.ending).toBe('none');
            expect(next.endingSnapshot).toBeNull();
            expect(next.staleGuard).toEqual({ maxTime: action.forkTime + STALE_TOLERANCE_S });
            expect(next.currentBranchId).toBe(action.newBranchId);
          }
        });
      }),
      PBT_PARAMS,
    );
  });

  // Feature: play-mode, Property 21: Hints reveal one at a time in order
  it('Property 21: Hints reveal one at a time in order', () => {
    /** Validates: Requirements 9.1, 9.2, 9.3, 9.5 */
    fc.assert(
      fc.property(arbP21Play, arbP21Ops, (play, ops) => {
        const caseData: CaseData = { ...structuredClone(CASE), play };
        const total = play.hints.length;
        let k = 0;
        runOps(onMain(caseData), ops, (prev, action, next) => {
          if (action.type === 'hintRevealed') {
            k += 1;
            if (prev.hintsRevealed >= total) expect(next).toBe(prev);
          }
          const revealed = Math.min(k, total);
          expect(next.hintsRevealed).toBe(revealed);
          expect(next.hintRecord.map((h) => h.hintIndex)).toEqual(Array.from({ length: revealed }, (_, i) => i + 1));
          expect(total - next.hintsRevealed).toBeGreaterThanOrEqual(0);
        });
      }),
      PBT_PARAMS,
    );
  });
});

// ---------------------------------------------------------------------------
// Task 11.3: Rescue_Gate_Time in the reducer (Requirements 6.21, 6.23, 6.24)
// ---------------------------------------------------------------------------

const gateOf = (state: SessionUiState): number | null => state.endingCtx.rescueGateTime;

/** The gate the reducer must hold for the state's case, record and lineage. */
function expectedGate(state: SessionUiState): number | null {
  return rescueGateTime(
    requiredInterventions(state.caseData?.play),
    activeInterventions(state.interventionRecord, state.lineage),
  );
}

describe('Rescue_Gate_Time in the reducer', () => {
  it('the case requires the left Decompression', () => {
    expect(requiredInterventions(CASE_WITH_PLAY.play)).toEqual(['needle-decompression-left']);
  });

  it('is null after a fork to a Checkpoint before the left Decompression, and the new entry time after it is applied again (6.21)', () => {
    let state = reduce(onMain(), { type: 'checkpointsLoaded', byBranch: CHECKPOINTS });
    state = feed(state, [100]);
    state = reduce(state, { type: 'interventionSucceeded', entry: decompression('Left', 100, 'main') });
    expect(gateOf(state)).toBe(100);

    const forked = fork(state, 60);
    expect(gateOf(forked)).toBeNull();

    // Rescue-range samples on the new Branch cannot rescue while the gate is closed.
    const waiting = feed(forked, range(61, 120));
    expect(waiting.ending.ending).toBe('none');
    expect(waiting.ending.rescueStart).toBeNull();

    const again = decompression('Left', 120, 'fork1');
    const reopened = reduce(waiting, { type: 'interventionSucceeded', entry: again });
    expect(gateOf(reopened)).toBe(again.simulationTime);
  });

  it('is recomputed on caseLoaded, sessionLoaded, checkpointsLoaded, interventionRecordRestored, interventionSucceeded and forkSucceeded (6.23)', () => {
    // caseLoaded: the record restored before the case is used at once.
    let state = reduce(initialSessionState(), { type: 'sessionLoaded', session: SESSION_MAIN });
    state = reduce(state, { type: 'interventionRecordRestored', record: [decompression('Left', 40, 'main')] });
    expect(gateOf(state)).toBe(Number.NEGATIVE_INFINITY);
    state = reduce(state, { type: 'caseLoaded', caseData: CASE_WITH_PLAY, storedView: null });
    expect(gateOf(state)).toBe(40);

    // checkpointsLoaded: on `child` with no lists, `main` is outside the lineage; the lists bound it at 60.
    let child = reduce(loaded(), { type: 'sessionLoaded', session: SESSION });
    child = reduce(child, { type: 'interventionRecordRestored', record: [decompression('Left', 50, 'main')] });
    expect(gateOf(child)).toBeNull();
    child = reduce(child, { type: 'checkpointsLoaded', byBranch: CHECKPOINTS });
    expect(gateOf(child)).toBe(50);

    // sessionLoaded: an entry on `main` after the fork time is inactive on `child`, active on `main`.
    let reloaded = reduce(loaded(), { type: 'sessionLoaded', session: SESSION });
    reloaded = reduce(reloaded, { type: 'checkpointsLoaded', byBranch: CHECKPOINTS });
    reloaded = reduce(reloaded, { type: 'interventionRecordRestored', record: [decompression('Left', 80, 'main')] });
    expect(gateOf(reloaded)).toBeNull();
    reloaded = reduce(reloaded, { type: 'sessionLoaded', session: SESSION_MAIN });
    expect(gateOf(reloaded)).toBe(80);

    // interventionRecordRestored and interventionSucceeded.
    let main = onMain();
    expect(gateOf(main)).toBeNull();
    main = reduce(main, { type: 'interventionSucceeded', entry: decompression('Right', 35, 'main') });
    expect(gateOf(main)).toBeNull();
    main = reduce(main, { type: 'interventionSucceeded', entry: decompression('Left', 45, 'main') });
    expect(gateOf(main)).toBe(45);
    main = reduce(main, { type: 'interventionRecordRestored', record: [decompression('Left', 20, 'main')] });
    expect(gateOf(main)).toBe(20);

    // forkSucceeded: a fork after the entry keeps it active.
    const afterFork = fork(reduce(main, { type: 'checkpointsLoaded', byBranch: CHECKPOINTS }), 30);
    expect(gateOf(afterFork)).toBe(20);

    for (const s of [state, child, reloaded, main, afterFork]) expect(gateOf(s)).toBe(expectedGate(s));
  });

  it('ends an open rescue stretch when the gate closes, and samples, hints and views leave the gate as is (6.24)', () => {
    let state = reduce(onMain(), { type: 'interventionSucceeded', entry: decompression('Left', 40, 'main') });
    state = feed(state, range(40, 50));
    expect(state.ending).toMatchObject({ ending: 'none', rescueStart: 40 });
    const ctx = state.endingCtx;

    // Actions outside Requirement 6.23 keep the same context object.
    const others: SessionAction[] = [
      { type: 'sampleReceived', sample: sample(51) },
      { type: 'hintRevealed', wallClockTime: '2026-11-20T10:04:00Z' },
      { type: 'viewSelected', view: 'clinician' },
      { type: 'playbackChanged', playing: true },
      { type: 'connectionChanged', connected: true },
    ];
    for (const action of others) {
      state = reduce(state, action);
      expect(state.endingCtx).toBe(ctx);
    }

    const lostStarts = state.ending.lostStarts;
    const closed = reduce(state, { type: 'interventionRecordRestored', record: [] });
    expect(gateOf(closed)).toBeNull();
    expect(closed.ending.rescueStart).toBeNull();
    expect(closed.ending.ending).toBe('none');
    expect(closed.ending.lastTime).toBe(state.ending.lastTime);
    expect(closed.ending.lostStarts).toBe(lostStarts);
  });
});

/** One step of a generated action sequence for Property 25; turned into an action by `toGateAction`. */
type GateOpSpec =
  | { kind: 'case'; variant: number }
  | { kind: 'session'; branchPick: number }
  | { kind: 'checkpoints'; mask: number }
  | { kind: 'restore'; mask: number }
  | { kind: 'intervention'; side: Side }
  | { kind: 'fork'; at: number }
  | { kind: 'sample'; offset: number; rescueRange: boolean };

/**
 * Cases for Property 25, all listing Required_Interventions: the case file
 * itself, and test variants (not case content) with the insult at 5 s and a
 * 2 s rescue hold, so rescues occur often within a short action sequence.
 */
const GATE_CASES: CaseData[] = [
  CASE_WITH_PLAY,
  ...[['needle-decompression-left'], ['needle-decompression-left', 'needle-decompression-right']].map(
    (ids): CaseData => {
      const c = structuredClone(CASE);
      c.timeline.scheduledInsults = c.timeline.scheduledInsults.map((insult) => ({ ...insult, timeSeconds: 5 }));
      c.play!.endings.rescued = { ...c.play!.endings.rescued, holdSeconds: 2, requiredInterventions: ids };
      return c;
    },
  ),
];

/** Mostly samples, Interventions and forks; caseLoaded and sessionLoaded are rare because each resets the Ending or switches the Branch. */
const arbGateOp: fc.Arbitrary<GateOpSpec> = fc.oneof(
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('case' as const), variant: fc.nat() }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('session' as const), branchPick: fc.nat() }) },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant('checkpoints' as const), mask: fc.nat({ max: 63 }) }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('restore' as const), mask: fc.nat({ max: 1023 }) }) },
  {
    weight: 3,
    arbitrary: fc.record({
      kind: fc.constant('intervention' as const),
      side: fc.constantFrom<Side>('Left', 'Left', 'Right'),
    }),
  },
  {
    weight: 3,
    arbitrary: fc.record({ kind: fc.constant('fork' as const), at: fc.integer({ min: 0, max: 4 }).map((n) => n / 4) }),
  },
  {
    weight: 8,
    arbitrary: fc.record({
      kind: fc.constant('sample' as const),
      offset: fc.integer({ min: 1, max: 12 }).map((n) => n / 2),
      rescueRange: fc.oneof({ weight: 4, arbitrary: fc.constant(true) }, { weight: 1, arbitrary: fc.constant(false) }),
    }),
  },
);

/** Session metadata for a generated Branch tree with the given current Branch. */
function lineageSession(lc: LineageCase, currentBranchId: string): SessionMetadata {
  return {
    session_id: 's1',
    case_id: 'adult-tension-pneumothorax',
    created_at: '2026-11-20T10:00:00Z',
    current_branch_id: currentBranchId,
    branches: lc.branches,
  };
}

/** Turns a GateOpSpec into a valid action for `state`, or `null` when it does not apply yet. */
function toGateAction(state: SessionUiState, lc: LineageCase, op: GateOpSpec, forks: number): SessionAction | null {
  const branchStart = state.lineage[0]?.forkTime ?? 0;
  const now = Math.max(branchStart, state.latestSample?.simulation_time ?? branchStart);
  switch (op.kind) {
    case 'case':
      return { type: 'caseLoaded', caseData: GATE_CASES[op.variant % GATE_CASES.length], storedView: null };
    case 'session': {
      const ids = [lc.currentBranchId, ...lc.branches.map((b) => b.branch_id)];
      return { type: 'sessionLoaded', session: lineageSession(lc, ids[op.branchPick % ids.length]) };
    }
    case 'checkpoints': {
      const ids = Object.keys(lc.checkpointsByBranch).sort();
      const byBranch = Object.fromEntries(
        ids.filter((_, i) => (op.mask >> i) & 1).map((id) => [id, lc.checkpointsByBranch[id]]),
      );
      return { type: 'checkpointsLoaded', byBranch };
    }
    case 'restore':
      return { type: 'interventionRecordRestored', record: lc.record.filter((_, i) => (op.mask >> i) & 1) };
    case 'intervention':
      if (state.currentBranchId === null) return null;
      return { type: 'interventionSucceeded', entry: decompression(op.side, now, state.currentBranchId) };
    case 'fork': {
      if (state.session === null || state.currentBranchId === null) return null;
      const parentId = state.currentBranchId;
      const forkTime = branchStart + Math.round(op.at * (now - branchStart) * 2) / 2;
      const newBranchId = `gate-fork${forks + 1}`;
      const session: SessionMetadata = {
        ...state.session,
        current_branch_id: newBranchId,
        branches: [
          ...(state.session.branches ?? []),
          {
            branch_id: newBranchId,
            parent_branch_id: parentId,
            forked_from_checkpoint: `${parentId}-cp-${forkTime}`,
            created_at: '2026-11-20T10:06:00Z',
            event_count: 0,
          },
        ],
      };
      return { type: 'forkSucceeded', session, newBranchId, forkTime };
    }
    case 'sample':
      // Default vitals satisfy the case's Rescue_Condition; SpO2 0.9 breaks it.
      return { type: 'sampleReceived', sample: sample(now + op.offset, op.rescueRange ? {} : { spo2: 0.9 }) };
  }
}

describe('sessionReducer: Rescue_Gate_Time property', () => {
  // Feature: play-mode, Property 25: The reducer keeps the Rescue_Gate_Time in step with the record and the lineage
  it('Property 25: The reducer keeps the Rescue_Gate_Time in step with the record and the lineage', () => {
    /** Validates: Requirements 6.21, 6.23, 6.24 */
    fc.assert(
      fc.property(
        arbLineage,
        fc.nat(),
        fc.boolean(),
        fc.array(arbGateOp, { minLength: 10, maxLength: 60, size: 'medium' }),
        (lc, variant, warmStart, ops) => {
          // Usually start like a page load: case, session and every Checkpoint list.
          const prefix: GateOpSpec[] = warmStart
            ? [
                { kind: 'case', variant },
                { kind: 'session', branchPick: 0 },
                { kind: 'checkpoints', mask: 63 },
              ]
            : [];
          let state = initialSessionState();
          let forks = 0;
          // Set after a fork leaves a Required_Intervention inactive on the new Branch.
          let closedByFork = false;
          for (const op of [...prefix, ...ops]) {
            const action = toGateAction(state, lc, op, forks);
            if (action === null) continue;
            const next = reduce(state, action);

            const gate = gateOf(next);
            expect(gate).toBe(expectedGate(next));
            // Checked while the Ending is `none` (6.24): once an Ending is set, a gate
            // change leaves the Ending state, including rescueStart, as it is.
            const start = next.ending.rescueStart;
            if (next.ending.ending === 'none' && start !== null) {
              expect(gate).not.toBeNull();
              expect(start).toBeGreaterThanOrEqual(gate!);
            }

            if (action.type === 'forkSucceeded') {
              forks += 1;
              const required = requiredInterventions(next.caseData?.play);
              const active = activeInterventions(next.interventionRecord, next.lineage);
              const missing = required.some((id) => !active.some((e) => e.interventionId === id));
              if (missing) expect(gate).toBeNull();
              closedByFork = missing;
            } else if (closedByFork) {
              const required = requiredInterventions(next.caseData?.play);
              if (
                action.type === 'sampleReceived' ||
                (action.type === 'interventionSucceeded' && !required.includes(action.entry.interventionId))
              ) {
                expect(gate).toBeNull();
                expect(next.ending.ending).not.toBe('rescued');
              }
              if (gate !== null) closedByFork = false;
            }
            state = next;
          }
        },
      ),
      PBT_PARAMS,
    );
  });
});
