import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { DEFAULT_BEAT_PERIOD_S, mapAvatar } from './avatarMapper';
import { activeExamEntries, activeInterventions, buildLineage } from './branchLineage';
import { examFinding, isSidedAction } from './examFinding';
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
import { affectedInsult, computeSides, foundSides } from './sides';
import type {
  AvatarParameters,
  CaseData,
  CheckpointMetadata,
  ExamRecordEntry,
  Hint,
  InterventionRecordEntry,
  PlaybackSpeed,
  PlaySection,
  SessionMetadata,
  Side,
  VitalSigns,
} from '@/types';
import { CASE, CASE_LEFT, CASE_RIGHT } from '@/test/caseFixtures';
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

/**
 * The case without its Exam_Section: the shipped Exam_Section turns the side
 * gate on (bedside-exam 9.1), and these play-mode tests expect play-mode
 * behaviour, which 4.6 keeps for a case without one.
 */
const CASE_WITH_PLAY: CaseData = (() => {
  const c = structuredClone(CASE);
  delete c.play!.exam;
  return c;
})();
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

// ---------------------------------------------------------------------------
// bedside-exam task 12.1: the Exam_Record and the side gate
// (Requirements 4.6, 6.3, 6.5, 6.8, 6.9, 6.14, 7.1, 7.2, 7.5, 9.2, 9.4, 9.5)
// ---------------------------------------------------------------------------

/** The case with its shipped Exam_Section: the side gate is on. The Left insult starts at t = 30. */
const CASE_EXAM: CaseData = structuredClone(CASE);

/** Test values: PLAY_P20's quick Lost Ending (5 s of SpO2 < 0.85) with the shipped Exam_Section. */
const CASE_EXAM_LOST: CaseData = (() => {
  const c = structuredClone(CASE);
  c.play = { ...PLAY_P20, exam: c.play!.exam };
  return c;
})();

const WALL = '2026-11-20T10:03:00.000Z';

function exam(state: SessionUiState, actionId: string, side: Side | null, wallClockTime = WALL): SessionUiState {
  return reduce(state, { type: 'examPerformed', actionId, side, wallClockTime });
}

/** A test entry; the sentence is a placeholder, not case content. */
function examEntry(actionId: string, side: Side | undefined, simulationTime: number, branchId: string, abnormal: boolean): ExamRecordEntry {
  return {
    actionId,
    ...(side === undefined ? {} : { side }),
    simulationTime,
    branchId,
    sentence: 'Test finding',
    abnormal,
    wallClockTime: WALL,
  };
}

describe('examRecordRestored', () => {
  it('replaces the record rather than merging, so a second dispatch gives the same record (7.5)', () => {
    const before = exam(feed(onMain(CASE_EXAM), [40]), 'look-chest', null);
    expect(before.examRecord).toHaveLength(1);
    expect(before.examRecordLoaded).toBe(false);

    const record = [examEntry('listen', 'Right', 35, 'main', false)];
    const once = reduce(before, { type: 'examRecordRestored', record });
    const twice = reduce(once, { type: 'examRecordRestored', record });

    expect(once.examRecord).toEqual(record);
    expect(twice.examRecord).toEqual(record);
    expect(once.examRecordLoaded).toBe(true);
    expect(twice.examRecordLoaded).toBe(true);
  });

  it('draws a restored Found_Side at once (9.2)', () => {
    const before = feed(onMain(CASE_EXAM), [40]);
    expect(before.avatar.swollenSides).toEqual([]);
    const next = reduce(before, { type: 'examRecordRestored', record: [examEntry('listen', 'Left', 35, 'main', true)] });
    expect(next.avatar.swollenSides).toEqual(['Left']);
  });
});

describe('examPerformed: refusals return the same state object', () => {
  it('without an Exam_Section', () => {
    const state = feed(onMain(CASE_WITH_PLAY), [40]);
    expect(exam(state, 'look-chest', null)).toBe(state);
  });

  it('without a current Branch', () => {
    const state = loaded(CASE_EXAM);
    expect(state.currentBranchId).toBeNull();
    expect(exam(state, 'look-chest', null)).toBe(state);
  });

  it('after an Ending (6.9)', () => {
    const state = feed(onMain(CASE_EXAM_LOST), range(40, 50), { spo2: 0.8 });
    expect(state.ending.ending).toBe('lost');
    expect(exam(state, 'listen', 'Left')).toBe(state);
    expect(exam(state, 'look-chest', null)).toBe(state);
  });

  it('for an unknown action id', () => {
    const state = feed(onMain(CASE_EXAM), [40]);
    expect(exam(state, 'no-such-action', null)).toBe(state);
    expect(exam(state, 'no-such-action', 'Left')).toBe(state);
  });

  it('for a side on a Side_Neutral_Action', () => {
    const state = feed(onMain(CASE_EXAM), [40]);
    expect(exam(state, 'look-chest', 'Left')).toBe(state);
  });

  it('for no side on a Sided_Action', () => {
    const state = feed(onMain(CASE_EXAM), [40]);
    expect(exam(state, 'listen', null)).toBe(state);
  });
});

describe('examPerformed and the side gate', () => {
  it('draws the Affected_Side swollen in the same step after an abnormal finding there (6.3, 7.1, 9.2)', () => {
    const before = feed(onMain(CASE_EXAM), [40]);
    // The insult has started, but no side is found yet.
    expect(before.avatar.swollenSides).toEqual([]);

    const next = exam(before, 'listen', 'Left');

    expect(next.examRecord).toHaveLength(1);
    expect(next.examRecord[0]).toMatchObject({
      actionId: 'listen',
      side: 'Left',
      simulationTime: 40,
      branchId: 'main',
      abnormal: true,
      wallClockTime: WALL,
    });
    expect(next.avatar.swollenSides).toEqual(['Left']);
    expect(withoutSides(next.avatar)).toEqual(withoutSides(before.avatar));
    expect(next.avatar.decompressedSides).toBe(before.avatar.decompressedSides);
  });

  it('adds no side for a normal finding on the Other_Side or a side-neutral finding, and keeps the Avatar object', () => {
    const before = feed(onMain(CASE_EXAM), [40]);
    const other = exam(before, 'listen', 'Right');
    expect(other.examRecord[0].abnormal).toBe(false);
    expect(other.avatar).toBe(before.avatar);

    const neutral = exam(before, 'look-chest', null);
    expect(neutral.examRecord[0].abnormal).toBe(true);
    expect(neutral.avatar).toBe(before.avatar);
  });

  it('no longer draws a side found only after the fork time once forked (9.4)', () => {
    const late = exam(feed(onMain(CASE_EXAM), [40, 70]), 'listen', 'Left');
    expect(late.avatar.swollenSides).toEqual(['Left']);
    const forkedLate = fork(late, 60);
    expect(forkedLate.examRecord).toBe(late.examRecord);
    expect(forkedLate.avatar.swollenSides).toEqual([]);

    // Found before the fork time: still drawn on the new Branch.
    const early = fork(exam(feed(onMain(CASE_EXAM), [40]), 'listen', 'Left'), 60);
    expect(early.avatar.swollenSides).toEqual(['Left']);
  });

  it('makes a restored ancestor entry active when the lineage grows on checkpointsLoaded (9.2)', () => {
    let child = reduce(loaded(CASE_EXAM), { type: 'sessionLoaded', session: SESSION });
    child = reduce(child, { type: 'examRecordRestored', record: [examEntry('listen', 'Left', 50, 'main', true)] });
    child = feed(child, [70]);
    // Without Checkpoint lists, `main` is outside the lineage.
    expect(child.avatar.swollenSides).toEqual([]);
    const next = reduce(child, { type: 'checkpointsLoaded', byBranch: CHECKPOINTS });
    expect(next.avatar.swollenSides).toEqual(['Left']);
  });

  it('draws the Swollen_Sides ungated from the sample that sets an Ending, and snapshots them (9.5)', () => {
    let before = onMain(CASE_EXAM_LOST);
    let ended = before;
    for (const t of range(40, 60)) {
      ended = feed(before, [t], { spo2: 0.8 });
      if (ended.ending.ending !== 'none') break;
      before = ended;
    }
    expect(before.latestSample?.simulation_time).toBeGreaterThanOrEqual(40);
    expect(before.ending.ending).toBe('none');
    expect(before.avatar.swollenSides).toEqual([]);
    expect(ended.ending.ending).toBe('lost');
    expect(ended.avatar.swollenSides).toEqual(['Left']);
    expect(ended.endingSnapshot?.swollenSides).toEqual(['Left']);
  });

  it('gates the Swollen_Sides again right after a fork past the insult time from an Ending (9.4, 9.5)', () => {
    // Lost on main with nothing found: the Ending draws Left ungated.
    const ended = feed(onMain(CASE_EXAM_LOST), range(40, 50), { spo2: 0.8 });
    expect(ended.ending.ending).not.toBe('none');
    expect(ended.examRecord).toEqual([]);
    expect(ended.avatar.swollenSides).toEqual(['Left']);

    // Fork at t = 60, after the Left insult at 30: the new Branch's Ending is `none`, so the gate is on again.
    const next = fork(ended, 60);
    expect(next.ending.ending).toBe('none');
    expect(next.avatar.swollenSides).toEqual([]);
  });

  it('chooses a `decompressed: true` finding only for a Decompression on the lineage (5.1, 4.15)', () => {
    // Test-only case: placeholder text, not case content.
    const caseDecompressedRule: CaseData = structuredClone(CASE_EXAM);
    const lookChest = caseDecompressedRule.play!.exam!.actions.find((a) => a.id === 'look-chest')!;
    lookChest.rules = [{ when: { decompressed: true }, sentence: 'rule: decompressed', abnormal: true }];
    lookChest.defaultSentence = 'default: not decompressed';
    const before = feed(onMain(caseDecompressedRule), [40]);

    // A left Decompression at t = 35 (after the insult at 30, before the exam at 40) on a Branch outside the lineage.
    const offLineage = reduce(before, { type: 'interventionSucceeded', entry: decompression('Left', 35, 'other') });
    const offEntry = exam(offLineage, 'look-chest', null).examRecord[0];
    expect(offEntry.simulationTime).toBe(40);
    expect(offEntry.sentence).not.toBe('rule: decompressed');
    expect(offEntry.sentence).toBe('default: not decompressed');

    // The same Decompression on the current Branch `main`: the decompressed rule matches.
    const onLineage = reduce(before, { type: 'interventionSucceeded', entry: decompression('Left', 35, 'main') });
    expect(exam(onLineage, 'look-chest', null).examRecord[0].sentence).toBe('rule: decompressed');
  });

  it('draws a restored Found_Side on sessionLoaded without a new sample (9.2)', () => {
    // A sample at t = 40, after the Left insult at 30, but no Session yet: the lineage is empty.
    let state = feed(loaded(CASE_EXAM), [40]);
    state = reduce(state, { type: 'examRecordRestored', record: [examEntry('listen', 'Left', 35, 'main', true)] });
    expect(state.lineage).toEqual([]);
    expect(state.avatar.swollenSides).toEqual([]);

    const next = reduce(state, { type: 'sessionLoaded', session: SESSION_MAIN });
    expect(next.latestSample).toBe(state.latestSample);
    expect(next.avatar.swollenSides).toEqual(['Left']);
  });
});

describe('withSides returns the same state when no side changes', () => {
  it('keeps the Avatar object on sessionLoaded and checkpointsLoaded when both side lists are equal', () => {
    // Without an Exam_Section the gate is 'all', and shownSwollenSides returns a new array with the same sides.
    const before = feed(onMain(), [40]);
    expect(before.avatar.swollenSides).toEqual(['Left']);
    const reloaded = reduce(before, { type: 'sessionLoaded', session: SESSION_MAIN });
    expect(reloaded.avatar).toBe(before.avatar);
    const withLists = reduce(reloaded, { type: 'checkpointsLoaded', byBranch: CHECKPOINTS });
    expect(withLists.avatar).toBe(before.avatar);

    // With the gate on and a Found_Side.
    const gated = exam(feed(onMain(CASE_EXAM), [40]), 'listen', 'Left');
    expect(reduce(gated, { type: 'checkpointsLoaded', byBranch: CHECKPOINTS }).avatar).toBe(gated.avatar);
  });
});

/** OpSpec plus an Exam_Button activation; unknown ids and sides that do not fit are generated on purpose. */
type ExamOpSpec = OpSpec | { kind: 'exam'; actionId: string; side: Side | null };

const EXAM_ACTION_IDS: string[] = [...CASE.play!.exam!.actions.map((a) => a.id), 'no-such-action'];

const arbExamOp: fc.Arbitrary<ExamOpSpec> = fc.record({
  kind: fc.constant('exam' as const),
  actionId: fc.constantFrom(...EXAM_ACTION_IDS),
  side: fc.constantFrom<Side | null>(null, 'Left', 'Right'),
});

/** Mixed sequence for Property 11: exams interleaved with every other generated action. */
const arbP11Ops: fc.Arbitrary<ExamOpSpec[]> = fc.array(
  fc.oneof(
    { weight: 5, arbitrary: arbExamOp },
    { weight: 5, arbitrary: arbSampleOp },
    { weight: 2, arbitrary: arbInterventionOp },
    { weight: 1, arbitrary: arbHintOp },
    { weight: 2, arbitrary: arbViewOp },
    { weight: 1, arbitrary: arbPlaybackOp },
    { weight: 2, arbitrary: arbForkOp },
  ),
  { minLength: 1, maxLength: 30 },
);

describe('sessionReducer: Exam_Record property', () => {
  // Feature: bedside-exam, Property 11: An exam changes only the Exam_Record and the drawn sides
  it('Property 11: An exam changes only the Exam_Record and the drawn sides', () => {
    /** Validates: Requirements 6.3, 6.5, 6.8, 6.9, 6.14, 7.1, 7.2 */
    fc.assert(
      fc.property(fc.constantFrom(CASE_EXAM, CASE_EXAM_LOST), arbP11Ops, (caseData, ops) => {
        const model: OpModel = { branchStart: 0, forks: 0 };
        let state = onMain(caseData);
        ops.forEach((op, i) => {
          const wallClockTime = new Date(Date.UTC(2026, 10, 20, 10, 0, i)).toISOString();
          const action: SessionAction =
            op.kind === 'exam'
              ? { type: 'examPerformed', actionId: op.actionId, side: op.side, wallClockTime }
              : toAction(state, model, op, i);
          const prev = state;
          const next = reduce(prev, action);

          if (action.type !== 'examPerformed') {
            // No other action removes or rewrites an entry, across forks and view switches too.
            expect(next.examRecord).toBe(prev.examRecord);
          } else {
            const examAction = caseData.play!.exam!.actions.find((a) => a.id === action.actionId);
            const fits =
              examAction !== undefined && (isSidedAction(examAction) ? action.side !== null : action.side === null);
            if (prev.ending.ending !== 'none' || !fits) {
              expect(next).toBe(prev);
            } else {
              const t = prev.latestSample?.simulation_time ?? prev.lineage[0]?.forkTime ?? 0;
              const finding = examFinding({
                action: examAction!,
                side: action.side,
                caseData,
                simulationTime: t,
                sample: prev.latestSample,
                activeInterventions: activeInterventions(prev.interventionRecord, prev.lineage),
              });
              expect(next.examRecord).toHaveLength(prev.examRecord.length + 1);
              prev.examRecord.forEach((entry, k) => expect(next.examRecord[k]).toBe(entry));
              expect(next.examRecord[prev.examRecord.length]).toEqual({
                actionId: action.actionId,
                ...(action.side === null ? {} : { side: action.side }),
                simulationTime: t,
                branchId: prev.currentBranchId,
                sentence: finding.sentence,
                abnormal: finding.abnormal,
                wallClockTime,
              });
              // Every other field, including playing, speed, latestSample, history, connected,
              // ending, interventionRecord, hintRecord, hintsRevealed and view, is the same object.
              for (const key of Object.keys(prev) as (keyof SessionUiState)[]) {
                if (key !== 'examRecord' && key !== 'avatar') expect(next[key]).toBe(prev[key]);
              }
              // Only avatar.swollenSides may differ.
              for (const key of Object.keys(prev.avatar) as (keyof AvatarParameters)[]) {
                if (key !== 'swollenSides') expect(next.avatar[key]).toBe(prev.avatar[key]);
              }
            }
          }

          if (action.type === 'forkSucceeded') {
            model.branchStart = action.forkTime;
            model.forks += 1;
          }
          state = next;
        });
      }),
      PBT_PARAMS,
    );
  });
});

// ---------------------------------------------------------------------------
// bedside-exam task 12.2: properties 15 and 16 (reducer half)
// (Requirements 4.6, 8.9, 9.1, 9.2, 9.3, 9.4, 9.5, 9.7, 14.2)
// ---------------------------------------------------------------------------

/** The Resolved_Case with PLAY_P20's quick Lost (test values: 5 s of SpO2 < 0.85), so Endings come often. */
function withQuickLost(caseData: CaseData): CaseData {
  const c = structuredClone(caseData);
  c.play = { ...c.play!, endings: { ...c.play!.endings, lost: PLAY_P20.endings.lost } };
  return c;
}

/** The Resolved_Case without its Exam_Section: the side gate is off (4.6). */
function withoutExam(caseData: CaseData): CaseData {
  const c = structuredClone(caseData);
  delete c.play!.exam;
  return c;
}

const SIDED_EXAM_IDS: string[] = CASE.play!.exam!.actions.filter((a) => isSidedAction(a)).map((a) => a.id);
const NEUTRAL_EXAM_IDS: string[] = CASE.play!.exam!.actions.filter((a) => !isSidedAction(a)).map((a) => a.id);

/** One restored Exam_Record entry; resolved against the case and the state by `restoredEntry`. */
interface RestoredSpec {
  actionId: string;
  side: Side | null;
  abnormal: boolean;
  /** Simulation_Time as a fraction (0 to 1) of the latest time. */
  at: number;
  /** Index (mod the Branch count) of the entry's Branch in the Session. */
  branchPick: number;
}

/** ExamOpSpec plus `examRecordRestored` and `checkpointsLoaded`. */
type SideOpSpec =
  | ExamOpSpec
  /** Restores a prefix (`keep`, 0 to 1) of the current record plus `extra` entries. */
  | { kind: 'restore'; keep: number; extra: RestoredSpec[] }
  /** Loads one Branch's Checkpoint list: the fork Checkpoints it holds, or an empty list. */
  | { kind: 'checkpoints'; branchPick: number; empty: boolean };

/** A sided exam; half of them on the Affected_Side, so Found_Sides come often. */
const arbSidedExamOp: fc.Arbitrary<SideOpSpec> = fc.record({
  kind: fc.constant('exam' as const),
  actionId: fc.constantFrom(...SIDED_EXAM_IDS),
  side: fc.constantFrom<Side | null>('Left', 'Right'),
});

/** A side-neutral exam, or an unknown id (refused); never a sided exam. */
const arbNeutralExamOp: fc.Arbitrary<SideOpSpec> = fc.record({
  kind: fc.constant('exam' as const),
  actionId: fc.constantFrom(...NEUTRAL_EXAM_IDS, 'no-such-action'),
  side: fc.constant(null),
});

function arbRestoreOp(neutralOnly: boolean): fc.Arbitrary<SideOpSpec> {
  return fc.record({
    kind: fc.constant('restore' as const),
    keep: fc.integer({ min: 0, max: 4 }).map((n) => n / 4),
    extra: fc.array(
      fc.record({
        actionId: fc.constantFrom(...(neutralOnly ? NEUTRAL_EXAM_IDS : [...SIDED_EXAM_IDS, ...NEUTRAL_EXAM_IDS])),
        side: fc.constantFrom<Side | null>(null, 'Left', 'Right'),
        abnormal: fc.boolean(),
        at: fc.integer({ min: 0, max: 4 }).map((n) => n / 4),
        branchPick: fc.nat({ max: 7 }),
      }),
      { maxLength: 3 },
    ),
  });
}

const arbCheckpointsOp: fc.Arbitrary<SideOpSpec> = fc.record({
  kind: fc.constant('checkpoints' as const),
  branchPick: fc.nat({ max: 7 }),
  empty: fc.constantFrom(false, false, true),
});

/**
 * A sample 10 to 30 s after the latest one, so runs pass the insult time
 * (t = 30) often. Right after a fork it is dropped by the stale-sample guard.
 */
const arbLongSampleOp: fc.Arbitrary<SideOpSpec> = fc.record({
  kind: fc.constant('sample' as const),
  offset: fc.integer({ min: 10, max: 30 }),
  spo2: fc.constantFrom(0.97, 0.8),
  tidalVolume: fc.constantFrom(0, 480, 500),
});

/** Mixed sequence for Property 15: Property 11's actions, biased to sided exams, plus restores and Checkpoint loads. */
const arbP15Ops: fc.Arbitrary<SideOpSpec[]> = fc.array(
  fc.oneof(
    { weight: 4, arbitrary: arbExamOp as fc.Arbitrary<SideOpSpec> },
    { weight: 4, arbitrary: arbSidedExamOp },
    { weight: 6, arbitrary: arbSampleOp as fc.Arbitrary<SideOpSpec> },
    { weight: 2, arbitrary: arbLongSampleOp },
    // Rare: a needle on the Affected_Side ends its swelling for good.
    { weight: 1, arbitrary: arbInterventionOp as fc.Arbitrary<SideOpSpec> },
    { weight: 2, arbitrary: arbHintOp as fc.Arbitrary<SideOpSpec> },
    { weight: 1, arbitrary: arbViewOp as fc.Arbitrary<SideOpSpec> },
    { weight: 1, arbitrary: arbPlaybackOp as fc.Arbitrary<SideOpSpec> },
    { weight: 2, arbitrary: arbForkOp as fc.Arbitrary<SideOpSpec> },
    { weight: 2, arbitrary: arbRestoreOp(false) },
    { weight: 2, arbitrary: arbCheckpointsOp },
  ),
  { minLength: 5, maxLength: 50, size: 'medium' },
);

/** Property 16's sequence: as Property 15 without interventions and without sided exams or sided restored entries. */
const arbP16Ops: fc.Arbitrary<SideOpSpec[]> = fc.array(
  fc.oneof(
    { weight: 5, arbitrary: arbNeutralExamOp },
    { weight: 6, arbitrary: arbSampleOp as fc.Arbitrary<SideOpSpec> },
    { weight: 2, arbitrary: arbLongSampleOp },
    { weight: 2, arbitrary: arbHintOp as fc.Arbitrary<SideOpSpec> },
    { weight: 1, arbitrary: arbViewOp as fc.Arbitrary<SideOpSpec> },
    { weight: 1, arbitrary: arbPlaybackOp as fc.Arbitrary<SideOpSpec> },
    { weight: 2, arbitrary: arbForkOp as fc.Arbitrary<SideOpSpec> },
    { weight: 2, arbitrary: arbRestoreOp(true) },
    { weight: 2, arbitrary: arbCheckpointsOp },
  ),
  { minLength: 5, maxLength: 50, size: 'medium' },
);

/** One generated run on one case: the state and the running facts `toAction` needs. */
interface GateRun {
  caseData: CaseData;
  affected: Side;
  state: SessionUiState;
  model: OpModel;
  /** Fork time of every Branch forked in this run. */
  forkTimes: Map<string, number>;
}

function startRun(caseData: CaseData): GateRun {
  const affected = affectedInsult(caseData.timeline?.scheduledInsults ?? [])!.side;
  return { caseData, affected, state: onMain(caseData), model: { branchStart: 0, forks: 0 }, forkTimes: new Map() };
}

/**
 * A restored entry as the service could hold it: a sided action always has a
 * side, a side-neutral action none, and only the Affected_Side can be abnormal
 * for a sided action, as `examFinding` gives (an entry the reducer could have made).
 */
function restoredEntry(run: GateRun, spec: RestoredSpec, now: number): ExamRecordEntry {
  // A case without an Exam_Section can still receive a restored record; the shipped actions say which are sided.
  const action = (run.caseData.play?.exam ?? CASE.play!.exam!).actions.find((a) => a.id === spec.actionId)!;
  const branches = run.state.session?.branches ?? [];
  const branchId = branches[spec.branchPick % branches.length].branch_id;
  const t = Math.round(spec.at * now * 2) / 2;
  if (!isSidedAction(action)) return examEntry(spec.actionId, undefined, t, branchId, spec.abnormal);
  const side = spec.side ?? run.affected;
  return examEntry(spec.actionId, side, t, branchId, side === run.affected && spec.abnormal);
}

/** The Checkpoint list of one Branch: its own fork copy and the Checkpoints its children were forked from. */
function checkpointList(run: GateRun, branchId: string): CheckpointMetadata[] {
  const branches = run.state.session?.branches ?? [];
  const list: CheckpointMetadata[] = [];
  for (const b of branches) {
    const forkTime = run.forkTimes.get(b.branch_id);
    if (b.forked_from_checkpoint === undefined || forkTime === undefined) continue;
    if (b.branch_id !== branchId && b.parent_branch_id !== branchId) continue;
    list.push({
      checkpoint_id: b.forked_from_checkpoint,
      simulation_time: forkTime,
      created_at: '2026-11-20T10:06:00Z',
      is_automatic: b.branch_id !== branchId,
    });
  }
  return list;
}

function toSideAction(run: GateRun, op: SideOpSpec, step: number): SessionAction {
  const { state, model } = run;
  const wallClockTime = new Date(Date.UTC(2026, 10, 20, 10, 0, step)).toISOString();
  switch (op.kind) {
    case 'exam':
      return { type: 'examPerformed', actionId: op.actionId, side: op.side, wallClockTime };
    case 'restore': {
      const now = state.latestSample?.simulation_time ?? model.branchStart;
      const kept = state.examRecord.slice(0, Math.round(op.keep * state.examRecord.length));
      return { type: 'examRecordRestored', record: [...kept, ...op.extra.map((s) => restoredEntry(run, s, now))] };
    }
    case 'checkpoints': {
      const branches = state.session?.branches ?? [];
      const branchId = branches[op.branchPick % branches.length].branch_id;
      return { type: 'checkpointsLoaded', byBranch: { [branchId]: op.empty ? [] : checkpointList(run, branchId) } };
    }
    default:
      return toAction(state, model, op, step);
  }
}

/** Applies one op to the run and returns the state before, the action and the state after. */
function stepRun(
  run: GateRun,
  op: SideOpSpec,
  step: number,
): { prev: SessionUiState; action: SessionAction; next: SessionUiState } {
  const prev = run.state;
  const action = toSideAction(run, op, step);
  const next = reduce(prev, action);
  if (action.type === 'forkSucceeded') {
    run.model.branchStart = action.forkTime;
    run.model.forks += 1;
    run.forkTimes.set(action.newBranchId, action.forkTime);
  }
  run.state = next;
  return { prev, action, next };
}

/** The ungated sides for a state: `computeSides` at the reducer's current time over the lineage's Active_Interventions. */
function ungatedSides(caseData: CaseData, state: SessionUiState): { swollenSides: Side[]; decompressedSides: Side[] } {
  const t = state.latestSample?.simulation_time ?? state.lineage[0]?.forkTime ?? 0;
  return computeSides(
    t,
    caseData.timeline?.scheduledInsults ?? [],
    activeInterventions(state.interventionRecord, state.lineage),
  );
}

/** Property 15's cases: both Resolved_Cases, with quick Endings, and without an Exam_Section. */
const arbP15Case: fc.Arbitrary<CaseData> = fc.oneof(
  { weight: 2, arbitrary: fc.constantFrom(CASE_LEFT, CASE_RIGHT) },
  { weight: 2, arbitrary: fc.constantFrom(withQuickLost(CASE_LEFT), withQuickLost(CASE_RIGHT)) },
  { weight: 1, arbitrary: fc.constantFrom(withoutExam(CASE_LEFT), withoutExam(CASE_RIGHT)) },
);

describe('sessionReducer: side gate properties', () => {
  it('the Variants differ in the Affected_Side and both have an Exam_Section', () => {
    expect(affectedInsult(CASE_LEFT.timeline?.scheduledInsults ?? [])?.side).toBe('Left');
    expect(affectedInsult(CASE_RIGHT.timeline?.scheduledInsults ?? [])?.side).toBe('Right');
    expect(CASE_LEFT.play?.exam).toBeDefined();
    expect(CASE_RIGHT.play?.exam).toBeDefined();
    expect(SIDED_EXAM_IDS.length).toBeGreaterThan(0);
    expect(NEUTRAL_EXAM_IDS.length).toBeGreaterThan(0);
  });

  // Feature: bedside-exam, Property 15: Before an Ending, only found sides are drawn swollen
  it('Property 15: Before an Ending, only found sides are drawn swollen', () => {
    /** Validates: Requirements 4.6, 8.9, 9.1, 9.2, 9.3, 9.4, 9.5 */
    fc.assert(
      fc.property(arbP15Case, arbP15Ops, (caseData, ops) => {
        const gated = caseData.play!.exam !== undefined;
        const run = startRun(caseData);
        ops.forEach((op, i) => {
          const { prev, action, next } = stepRun(run, op, i);
          const ungated = ungatedSides(caseData, next);
          const found = foundSides(activeExamEntries(next.examRecord, next.lineage));

          // Found_Sides holds only the Affected_Side.
          expect(found.filter((s) => s !== run.affected)).toEqual([]);
          // Needles are never gated.
          expect(next.avatar.decompressedSides).toEqual(ungated.decompressedSides);

          if (!gated) {
            // A case without an Exam_Section is never gated.
            expect(next.avatar.swollenSides).toEqual(ungated.swollenSides);
          } else if (next.ending.ending === 'none') {
            expect(next.avatar.swollenSides).toEqual(ungated.swollenSides.filter((s) => found.includes(s)));
          }

          if (action.type === 'hintRevealed') {
            expect(next.avatar.swollenSides).toEqual(prev.avatar.swollenSides);
          }

          if (prev.ending.ending === 'none' && next.ending.ending !== 'none') {
            expect(next.endingSnapshot?.swollenSides).toEqual(ungated.swollenSides);
          }

          if (action.type === 'forkSucceeded') {
            // Sides whose abnormal active entries all lie after the fork time.
            const prevActive = activeExamEntries(prev.examRecord, prev.lineage);
            const onlyAfter = foundSides(prevActive).filter((s) =>
              prevActive
                .filter((e) => e.side === s && e.abnormal)
                .every((e) => e.simulationTime > action.forkTime),
            );
            for (const s of onlyAfter) {
              expect(found).not.toContain(s);
              if (gated) expect(next.avatar.swollenSides).not.toContain(s);
            }
          }
        });
      }),
      PBT_PARAMS,
    );
  });

  // Feature: bedside-exam, Property 16: The Avatar is the same in both Variants until a side is found or a needle is used
  it('Property 16: The Avatar is the same in both Variants until a side is found or a needle is used', () => {
    /** Validates: Requirements 9.7 */
    fc.assert(
      fc.property(
        fc.constantFrom<[CaseData, CaseData]>(
          [CASE_LEFT, CASE_RIGHT],
          [withQuickLost(CASE_LEFT), withQuickLost(CASE_RIGHT)],
        ),
        arbP16Ops,
        ([leftCase, rightCase], ops) => {
          const left = startRun(leftCase);
          const right = startRun(rightCase);
          expect(right.state.avatar).toEqual(left.state.avatar);
          ops.forEach((op, i) => {
            const a = stepRun(left, op, i).next;
            const b = stepRun(right, op, i).next;
            if (a.ending.ending === 'none' && b.ending.ending === 'none') {
              expect(b.avatar).toEqual(a.avatar);
            }
          });
        },
      ),
      PBT_PARAMS,
    );
  });
});
