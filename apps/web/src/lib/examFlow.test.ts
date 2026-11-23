import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api', () => ({
  api: {
    createSession: vi.fn(),
    getSession: vi.fn(),
    getCaseData: vi.fn(),
    controlPlayback: vi.fn(),
    applyIntervention: vi.fn(),
    forkBranch: vi.fn(),
    getCheckpoints: vi.fn(),
    connectVitalsStream: vi.fn(),
  },
}));

import { api } from '@/lib/api';
import { examButtonsDisabled } from '@/components/PlayView';
import type { Ending } from './endingEvaluator';
import { loadExamRecord, saveExamRecord } from './examRecord';
import { initialSessionState, sessionReducer, type SessionAction, type SessionUiState } from './sessionState';
import type { CheckpointMetadata, SessionMetadata, VitalSigns } from '@/types';
import { CASE } from '@/test/caseFixtures';

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => (data.has(key) ? (data.get(key) as string) : null),
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
}

/** Every vital inside its case `normal` range. */
function sample(t: number): VitalSigns {
  return {
    simulation_time: t,
    heart_rate: 72,
    respiratory_rate: 16,
    spo2: 0.974,
    mean_arterial_pressure: 95,
    etco2: 40,
    tidal_volume: 500,
  };
}

const SESSION_MAIN: SessionMetadata = {
  session_id: 's1',
  case_id: 'adult-tension-pneumothorax',
  created_at: '2026-11-20T10:00:00Z',
  current_branch_id: 'main',
  branches: [{ branch_id: 'main', created_at: '2026-11-20T10:00:00Z', event_count: 0 }],
};

const SESSION_FORKED: SessionMetadata = {
  ...SESSION_MAIN,
  current_branch_id: 'fork1',
  branches: [
    ...SESSION_MAIN.branches,
    {
      branch_id: 'fork1',
      parent_branch_id: 'main',
      forked_from_checkpoint: 'cp-main-60',
      created_at: '2026-11-20T10:06:00Z',
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

const run = (state: SessionUiState, actions: SessionAction[]): SessionUiState =>
  actions.reduce(sessionReducer, state);

afterEach(() => {
  vi.clearAllMocks();
});

describe('examButtonsDisabled (6.9)', () => {
  const ENDINGS: Ending[] = ['none', 'rescued', 'lost'];
  const BOOLS = [false, true];

  it('is true for every Ending other than none and for a pending fork, whatever connected, playing and interventionPending are', () => {
    for (const ending of ENDINGS) {
      for (const forkPending of BOOLS) {
        for (const connected of BOOLS) {
          for (const playing of BOOLS) {
            for (const interventionPending of BOOLS) {
              // The extra fields are passed to show that the result ignores them.
              const input = { ending, forkPending, connected, playing, interventionPending };
              expect(examButtonsDisabled(input)).toBe(ending !== 'none' || forkPending);
            }
          }
        }
      }
    }
  });

  it('is false only with no Ending and no pending fork', () => {
    expect(examButtonsDisabled({ ending: 'none', forkPending: false })).toBe(false);
    expect(examButtonsDisabled({ ending: 'none', forkPending: true })).toBe(true);
    expect(examButtonsDisabled({ ending: 'rescued', forkPending: false })).toBe(true);
    expect(examButtonsDisabled({ ending: 'lost', forkPending: false })).toBe(true);
  });
});

describe('exam flow: reducer and Exam_Record storage', () => {
  it('sends no request, adds one entry, changes nothing else, and keeps the record across a fork and a view switch (6.4, 6.5, 6.14, 7.2, 14.4)', () => {
    const before = run(initialSessionState(), [
      { type: 'caseLoaded', caseData: structuredClone(CASE), storedView: null },
      { type: 'sessionLoaded', session: SESSION_MAIN },
      { type: 'checkpointsLoaded', byBranch: CHECKPOINTS },
      { type: 'examRecordRestored', record: [] },
      { type: 'sampleReceived', sample: sample(40) },
    ]);

    const afterExam = sessionReducer(before, {
      type: 'examPerformed',
      actionId: 'listen',
      side: 'Left',
      wallClockTime: '2026-11-20T10:03:00.000Z',
    });

    // Exactly one entry was added (7.1).
    expect(afterExam.examRecord).toHaveLength(before.examRecord.length + 1);
    expect(afterExam.examRecord[0]).toMatchObject({ actionId: 'listen', side: 'Left', simulationTime: 40, branchId: 'main' });

    // The fields of 6.5 are the same objects.
    for (const key of [
      'playing',
      'speed',
      'latestSample',
      'history',
      'connected',
      'ending',
      'interventionRecord',
      'hintRecord',
      'hintsRevealed',
    ] as const) {
      expect(afterExam[key]).toBe(before[key]);
    }

    // The record survives a fork and a view switch (6.14, 7.2).
    const afterFork = sessionReducer(afterExam, {
      type: 'forkSucceeded',
      session: SESSION_FORKED,
      newBranchId: 'fork1',
      forkTime: 60,
    });
    expect(afterFork.examRecord).toBe(afterExam.examRecord);
    const afterView = sessionReducer(afterFork, { type: 'viewSelected', view: 'clinician' });
    expect(afterView.examRecord).toBe(afterExam.examRecord);
    const backToPlay = sessionReducer(afterView, { type: 'viewSelected', view: 'play' });
    expect(backToPlay.examRecord).toBe(afterExam.examRecord);

    // The stored record round-trips (7.4, 7.5).
    const storage = memoryStorage();
    saveExamRecord(storage, 's1', backToPlay.examRecord);
    expect(loadExamRecord(storage, 's1')).toEqual(afterExam.examRecord);

    // No api function was called (6.4).
    for (const fn of Object.values(api)) expect(fn).not.toHaveBeenCalled();
  });
});
