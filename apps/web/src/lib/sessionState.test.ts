import { describe, expect, it } from 'vitest';
import { DEFAULT_BEAT_PERIOD_S, mapAvatar } from './avatarMapper';
import { buildLineage } from './branchLineage';
import { buildEndingContext, evaluateEnding } from './endingEvaluator';
import {
  HISTORY_LIMIT,
  STALE_TOLERANCE_S,
  initialSessionState,
  sessionReducer,
  type SessionAction,
  type SessionUiState,
} from './sessionState';
import type {
  AvatarParameters,
  CaseData,
  CheckpointMetadata,
  InterventionRecordEntry,
  PlaySection,
  SessionMetadata,
  VitalSigns,
} from '@/types';
import { CASE } from '@/test/caseFixtures';

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
