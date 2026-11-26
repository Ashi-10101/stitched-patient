/**
 * Tests of the Speech_Context builder and the Scripted_Speech_Provider
 * (patient-speech Requirements 6.1 and 6.2).
 *
 * States are built with `sessionReducer`, so each field is checked against the
 * reducer state it comes from. The helpers below are small local copies of the
 * ones in `sessionState.test.ts`, which does not export them.
 */

import { describe, expect, it } from 'vitest';
import { initialSessionState, sessionReducer, type SessionAction, type SessionUiState } from './sessionState';
import { speechCheck } from './speechCheck';
import { buildSpeechContext, scriptedSpeechProvider, type SpeechContext } from './speechProvider';
import type {
  CaseData,
  CheckpointMetadata,
  InterventionRecordEntry,
  SessionMetadata,
  Side,
  VitalSigns,
} from '@/types';
import { CASE } from '@/test/caseFixtures';

// ---------------------------------------------------------------------------
// Helpers (local equivalents of the sessionState.test.ts helpers)
// ---------------------------------------------------------------------------

const reduce = (state: SessionUiState, action: SessionAction): SessionUiState => sessionReducer(state, action);

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

const CHECKPOINTS: Record<string, CheckpointMetadata[]> = {
  main: [
    { checkpoint_id: 'cp-main-30', simulation_time: 30, created_at: '2026-11-20T10:01:00Z', is_automatic: true },
    { checkpoint_id: 'cp-main-60', simulation_time: 60, created_at: '2026-11-20T10:02:00Z', is_automatic: true },
  ],
};

/** Session after forking `fork1` from `cp-main-60` of `main`. */
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

function loaded(caseData: CaseData = CASE): SessionUiState {
  return reduce(initialSessionState(), { type: 'caseLoaded', caseData, storedView: null });
}

/** Case loaded and the Session on its first Branch `main`, with its Checkpoints. */
function onMain(caseData: CaseData = CASE): SessionUiState {
  const state = reduce(loaded(caseData), { type: 'sessionLoaded', session: SESSION_MAIN });
  return reduce(state, { type: 'checkpointsLoaded', byBranch: CHECKPOINTS });
}

/** Forks `fork1` from the Checkpoint of `main` at t = 60. */
function forkAt60(state: SessionUiState): SessionUiState {
  return reduce(state, { type: 'forkSucceeded', session: SESSION_FORKED, newBranchId: 'fork1', forkTime: 60 });
}

function feed(state: SessionUiState, times: number[]): SessionUiState {
  return times.reduce((s, t) => reduce(s, { type: 'sampleReceived', sample: sample(t) }), state);
}

const range = (from: number, to: number): number[] => Array.from({ length: to - from + 1 }, (_, i) => from + i);

function decompression(side: Side, simulationTime: number, branchId: string): InterventionRecordEntry {
  return {
    interventionId: `needle-decompression-${side.toLowerCase()}`,
    action: 'SENeedleDecompression',
    side,
    simulationTime,
    branchId,
  };
}

function intervene(state: SessionUiState, entry: InterventionRecordEntry): SessionUiState {
  return reduce(state, { type: 'interventionSucceeded', entry });
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** One Exam_Button activation at the latest sample's time; alternates a side-neutral and a sided action. */
function exam(state: SessionUiState, n: number): SessionUiState {
  const sided = n % 2 === 1;
  return reduce(state, {
    type: 'examPerformed',
    actionId: sided ? 'listen' : 'look-chest',
    side: sided ? 'Left' : null,
    wallClockTime: `2026-11-20T10:${pad2(Math.floor(n / 60))}:${pad2(n % 60)}.000Z`,
  });
}

/**
 * At each time: one sample, then one Right needle decompression and one exam
 * at that time on `branchId`. Right decompressions keep the Left case's
 * Rescue_Gate_Time closed, so the Ending stays `none` and no exam is refused.
 */
function recordAt(state: SessionUiState, times: number[], branchId: string): SessionUiState {
  return times.reduce((s, t) => {
    const withSample = feed(s, [t]);
    return exam(intervene(withSample, decompression('Right', t, branchId)), t);
  }, state);
}

function context(state: SessionUiState): Omit<SpeechContext, 'requestNumber'> {
  const ctx = buildSpeechContext(state);
  if (ctx === null) throw new Error('expected a Speech_Context');
  return ctx;
}

const PLAY = CASE.play!;
const SPEECH = PLAY.speech!;

/** The case without Required_Interventions: the Rescue_Gate_Time is always open (-Infinity). */
const CASE_NO_REQUIRED: CaseData = (() => {
  const c = structuredClone(CASE);
  delete c.play!.endings.rescued.requiredInterventions;
  return c;
})();

/** Test-only line that names a side, so it breaks the Side_Word rule; not case content. */
const FAILING_LINE = 'My left side hurts.';
const CASE_FAILING_LINE: CaseData = (() => {
  const c = structuredClone(CASE);
  c.play!.speech!.early = [FAILING_LINE];
  return c;
})();

// ---------------------------------------------------------------------------
// buildSpeechContext
// ---------------------------------------------------------------------------

describe('buildSpeechContext: null until the case and the current Branch are known (6.2)', () => {
  it('is null before the case is loaded', () => {
    expect(buildSpeechContext(initialSessionState())).toBeNull();
    // A known Branch without a case is still null.
    const branchOnly = reduce(initialSessionState(), { type: 'sessionLoaded', session: SESSION_MAIN });
    expect(branchOnly.currentBranchId).toBe('main');
    expect(buildSpeechContext(branchOnly)).toBeNull();
  });

  it('is null while the current Branch is not known', () => {
    const state = loaded();
    expect(state.caseData).toBe(CASE);
    expect(state.currentBranchId).toBeNull();
    expect(buildSpeechContext(state)).toBeNull();
  });
});

describe('buildSpeechContext: each field equals its source in the state (6.2)', () => {
  it('copies the Branch, case, latest sample, Ending, gate and Speech_State', () => {
    const state = feed(onMain(), range(31, 42));
    expect(state.speech?.key).toBe('early');

    const ctx = context(state);

    expect(ctx.branchId).toBe('main');
    expect(ctx.caseData).toBe(state.caseData);
    expect(ctx.caseData).toBe(CASE);
    expect(ctx.sample).toBe(state.latestSample);
    expect(ctx.sample).toEqual(sample(42));
    expect(ctx.simulationTime).toBe(42);
    expect(ctx.ending).toBe('none');
    // Closed: no Required_Intervention yet.
    expect(state.endingCtx.rescueGateTime).toBeNull();
    expect(ctx.rescueGateTime).toBeNull();
    expect(ctx.speechState).toBe(state.speech);
    expect(ctx.scriptedLine).toBe(SPEECH.early![0]);
    expect(ctx.scriptedLine).toBe(state.speech!.line);
  });

  it('gives null sample, Simulation_Time, Speech_State and Scripted_Line without a sample', () => {
    const state = onMain();
    expect(state.latestSample).toBeNull();
    const ctx = context(state);
    expect(ctx.branchId).toBe('main');
    expect(ctx.sample).toBeNull();
    expect(ctx.simulationTime).toBeNull();
    expect(ctx.speechState).toBeNull();
    expect(ctx.scriptedLine).toBeNull();
  });

  it('follows the current Branch after a fork, with no sample on the new Branch yet', () => {
    const state = forkAt60(feed(onMain(), range(31, 80)));
    expect(state.currentBranchId).toBe('fork1');
    const ctx = context(state);
    expect(ctx.branchId).toBe('fork1');
    expect(ctx.sample).toBeNull();
    expect(ctx.simulationTime).toBeNull();
    expect(ctx.speechState).toBeNull();
    expect(ctx.scriptedLine).toBeNull();

    const next = context(feed(state, [61]));
    expect(next.branchId).toBe('fork1');
    expect(next.simulationTime).toBe(61);
    expect(next.speechState?.branchId).toBe('fork1');
  });

  it('gives the numeric Rescue_Gate_Time once the Required_Intervention is active', () => {
    const state = intervene(feed(onMain(), range(31, 44)), decompression('Left', 45, 'main'));
    expect(state.endingCtx.rescueGateTime).toBe(45);
    expect(context(state).rescueGateTime).toBe(45);
  });

  it('gives -Infinity for a case without Required_Interventions', () => {
    const state = feed(onMain(CASE_NO_REQUIRED), [31]);
    expect(state.endingCtx.rescueGateTime).toBe(-Infinity);
    const ctx = context(state);
    expect(ctx.rescueGateTime).toBe(-Infinity);
    expect(ctx.caseData).toBe(CASE_NO_REQUIRED);
  });

  it('gives the Ending and the rescued Scripted_Line after the rescue', () => {
    let state = feed(onMain(), range(31, 39));
    state = intervene(state, decompression('Left', 40, 'main'));
    state = feed(state, range(40, 100));
    expect(state.ending.ending).toBe('rescued');

    const ctx = context(state);
    expect(ctx.ending).toBe('rescued');
    expect(ctx.rescueGateTime).toBe(40);
    expect(ctx.simulationTime).toBe(100);
    expect(ctx.speechState).toBe(state.speech);
    expect(ctx.speechState?.key).toBe('rescued');
    expect(ctx.scriptedLine).toBe(SPEECH.rescued![0]);
  });

  it('passes the raw Scripted_Line, even one that fails the Speech_Check', () => {
    const state = feed(onMain(CASE_FAILING_LINE), [31]);
    expect(state.speech?.line).toBe(FAILING_LINE);
    expect(speechCheck(FAILING_LINE, CASE_FAILING_LINE).length).toBeGreaterThan(0);

    const ctx = context(state);
    expect(ctx.scriptedLine).toBe(FAILING_LINE);
    expect(ctx.speechState).toBe(state.speech);
  });
});

describe('buildSpeechContext: newest 5 Active_Interventions and Active_Exam_Entries (6.2)', () => {
  it('holds exactly the newest 5 of 7, in recording order', () => {
    const state = recordAt(onMain(), range(31, 37), 'main');
    expect(state.interventionRecord).toHaveLength(7);
    expect(state.examRecord).toHaveLength(7);

    const ctx = context(state);

    expect(ctx.activeInterventions).toEqual(range(33, 37).map((t) => decompression('Right', t, 'main')));
    expect(ctx.activeExamEntries).toEqual(state.examRecord.slice(2, 7));
    expect(ctx.activeExamEntries.map((e) => e.simulationTime)).toEqual([33, 34, 35, 36, 37]);
  });

  it('holds all of them when there are 3', () => {
    const state = recordAt(onMain(), range(31, 33), 'main');
    const ctx = context(state);
    expect(ctx.activeInterventions).toEqual(range(31, 33).map((t) => decompression('Right', t, 'main')));
    expect(ctx.activeExamEntries).toEqual(state.examRecord);
    expect(ctx.activeExamEntries.map((e) => e.simulationTime)).toEqual([31, 32, 33]);
  });

  it('holds only entries of the current Branch_Lineage after a fork', () => {
    // main: 31, 32, 33 (before the fork time 60) and 70, 80 (after it).
    let state = recordAt(onMain(), [31, 32, 33, 70, 80], 'main');
    state = forkAt60(state);
    // fork1: 61, 62, 63; plus one entry of a Branch outside the lineage.
    state = recordAt(state, [61, 62, 63], 'fork1');
    state = intervene(state, decompression('Right', 63, 'other'));
    expect(state.interventionRecord).toHaveLength(9);
    expect(state.examRecord).toHaveLength(8);

    const ctx = context(state);

    // Active, in recording order: main 31, 32, 33, then fork1 61, 62, 63; the newest 5 of these 6.
    expect(ctx.activeInterventions).toEqual([
      decompression('Right', 32, 'main'),
      decompression('Right', 33, 'main'),
      decompression('Right', 61, 'fork1'),
      decompression('Right', 62, 'fork1'),
      decompression('Right', 63, 'fork1'),
    ]);
    expect(ctx.activeExamEntries.map((e) => [e.branchId, e.simulationTime])).toEqual([
      ['main', 32],
      ['main', 33],
      ['fork1', 61],
      ['fork1', 62],
      ['fork1', 63],
    ]);
    expect(ctx.activeExamEntries).toEqual([...state.examRecord.slice(1, 3), ...state.examRecord.slice(5, 8)]);
  });
});

describe('buildSpeechContext: requestNumber', () => {
  it('leaves requestNumber out, for the gate to fill in', () => {
    const ctx = context(feed(onMain(), [31]));
    // The return type omits the property, so it is absent, not set to undefined.
    expect('requestNumber' in ctx).toBe(false);
    expect((ctx as Partial<SpeechContext>).requestNumber).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// scriptedSpeechProvider
// ---------------------------------------------------------------------------

describe('scriptedSpeechProvider (6.1)', () => {
  const signal = new AbortController().signal;

  it('resolves with the Scripted_Line of the Speech_Context', async () => {
    const ctx: SpeechContext = { ...context(feed(onMain(), [31])), requestNumber: 1 };
    expect(ctx.scriptedLine).toBe(SPEECH.early![0]);
    await expect(scriptedSpeechProvider.speak(ctx, signal)).resolves.toBe(SPEECH.early![0]);
    // It reads `scriptedLine`, not the Speech_State's line.
    const other = { ...ctx, scriptedLine: 'Test line' };
    await expect(scriptedSpeechProvider.speak(other, signal)).resolves.toBe('Test line');
  });

  it('resolves with null when the Scripted_Line is null', async () => {
    const ctx: SpeechContext = { ...context(onMain()), requestNumber: 1 };
    expect(ctx.scriptedLine).toBeNull();
    await expect(scriptedSpeechProvider.speak(ctx, signal)).resolves.toBeNull();
  });

  it('resolves with a failing line unchanged; the gate applies the Speech_Check', async () => {
    const ctx: SpeechContext = { ...context(feed(onMain(CASE_FAILING_LINE), [31])), requestNumber: 2 };
    expect(speechCheck(FAILING_LINE, CASE_FAILING_LINE).length).toBeGreaterThan(0);
    await expect(scriptedSpeechProvider.speak(ctx, signal)).resolves.toBe(FAILING_LINE);
  });
});
