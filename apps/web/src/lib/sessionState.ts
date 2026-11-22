/**
 * Session UI state and its reducer (design "sessionState.ts — the reducer").
 *
 * Pure: no Wall_Clock_Time, storage, network or randomness. The reducer never
 * mutates its input and returns the same state object when an action changes
 * nothing.
 */

import { BREATH_DEPTH_DEFAULT, DEFAULT_BEAT_PERIOD_S, DEFAULT_BREATH_PERIOD_S, mapAvatar } from './avatarMapper';
import { activeInterventions, buildLineage } from './branchLineage';
import {
  buildEndingContext,
  initialEndingState,
  requiredInterventions,
  rescueGateTime,
  setRescueGate,
  stepEnding,
  type EndingContext,
  type EndingState,
} from './endingEvaluator';
import { computeSides } from './sides';
import { readVital } from './vitals';
import type {
  AvatarParameters,
  CaseData,
  CheckpointMetadata,
  HintRecordEntry,
  InterventionRecordEntry,
  LineageSegment,
  PlaybackSpeed,
  SessionMetadata,
  VitalSigns,
} from '@/types';

export type View = 'play' | 'clinician';

/** Samples kept for the trend chart. */
export const HISTORY_LIMIT = 300;
/** UI constant: after a fork, samples above `forkTime + STALE_TOLERANCE_S` are old-Branch messages. */
export const STALE_TOLERANCE_S = 5;

export interface SessionUiState {
  caseStatus: 'loading' | 'loaded' | 'failed';
  caseData: CaseData | null;
  caseError: string | null;
  session: SessionMetadata | null;
  currentBranchId: string | null;
  lineage: LineageSegment[];
  checkpointsByBranch: Record<string, CheckpointMetadata[]>;
  connected: boolean;
  /** Latest accepted sample on the current Branch. */
  latestSample: VitalSigns | null;
  /** Last HISTORY_LIMIT samples, for the trend chart. */
  history: VitalSigns[];
  /** Armed after a fork. */
  staleGuard: { maxTime: number } | null;
  firstPositiveTidalVolumeMl: number | null;
  avatar: AvatarParameters;
  endingCtx: EndingContext;
  ending: EndingState;
  /** Avatar at the sample that changed the Ending (7.3). */
  endingSnapshot: AvatarParameters | null;
  hintsRevealed: number;
  hintRecord: HintRecordEntry[];
  interventionRecord: InterventionRecordEntry[];
  playing: boolean;
  speed: PlaybackSpeed;
  view: View;
}

export type SessionAction =
  | { type: 'caseLoaded'; caseData: CaseData; storedView: View | null }
  | { type: 'caseFailed'; message: string }
  | { type: 'sessionLoaded'; session: SessionMetadata }
  | { type: 'checkpointsLoaded'; byBranch: Record<string, CheckpointMetadata[]> }
  | { type: 'connectionChanged'; connected: boolean }
  | { type: 'sampleReceived'; sample: VitalSigns }
  | { type: 'interventionRecordRestored'; record: InterventionRecordEntry[] }
  | { type: 'interventionSucceeded'; entry: InterventionRecordEntry }
  | { type: 'forkSucceeded'; session: SessionMetadata; newBranchId: string; forkTime: number }
  | { type: 'hintRevealed'; wallClockTime: string }
  | { type: 'viewSelected'; view: View }
  | { type: 'playbackChanged'; playing?: boolean; speed?: PlaybackSpeed };

/** Avatar shown before the first sample: the mapper's defaults with no bands. */
function defaultAvatar(): AvatarParameters {
  return {
    skinTone: 'healthy',
    breathing: { stopped: false, periodS: DEFAULT_BREATH_PERIOD_S, depth: BREATH_DEPTH_DEFAULT },
    heartbeat: { stopped: false, periodS: DEFAULT_BEAT_PERIOD_S },
    sweating: false,
    swollenSides: [],
    decompressedSides: [],
    overallStatus: 'normal',
    bands: {},
  };
}

export function initialSessionState(): SessionUiState {
  // Same gate as `buildEndingContext` gives without a Play_Section: -Infinity.
  const endingCtx: EndingContext = {
    play: undefined,
    rescueFromTime: 0,
    rescueGateTime: rescueGateTime(requiredInterventions(undefined), []),
  };
  return {
    caseStatus: 'loading',
    caseData: null,
    caseError: null,
    session: null,
    currentBranchId: null,
    lineage: [],
    checkpointsByBranch: {},
    connected: false,
    latestSample: null,
    history: [],
    staleGuard: null,
    firstPositiveTidalVolumeMl: null,
    avatar: defaultAvatar(),
    endingCtx,
    ending: initialEndingState(endingCtx),
    endingSnapshot: null,
    hintsRevealed: 0,
    hintRecord: [],
    interventionRecord: [],
    playing: false,
    speed: '1x',
    view: 'play',
  };
}

/** Branch_Lineage for the current Branch, or `[]` before the Session is known. */
function lineageFor(
  session: SessionMetadata | null,
  currentBranchId: string | null,
  checkpointsByBranch: Record<string, CheckpointMetadata[]>,
): LineageSegment[] {
  if (session === null || currentBranchId === null) return [];
  return buildLineage(session.branches ?? [], currentBranchId, checkpointsByBranch);
}

/**
 * Simulation_Time "now" on the current Branch when no new sample is at hand
 * (Requirement 9.5): the latest sample's time; else the current Branch's fork
 * time; else 0 (the Session's first Branch).
 */
function currentSimulationTime(state: SessionUiState): number {
  return state.latestSample?.simulation_time ?? state.lineage[0]?.forkTime ?? 0;
}

/**
 * Recomputes only `swollenSides` and `decompressedSides` of the Avatar from the
 * lineage's Active_Interventions, at `currentSimulationTime` (4.14, 4.15, 4.20).
 * Like `onSample`, it leaves the Avatar as is without a loaded Play_Section.
 */
function withSides(
  state: SessionUiState,
  interventionRecord: InterventionRecordEntry[],
): SessionUiState {
  const caseData = state.caseData;
  if (caseData === null || caseData.play === undefined) return { ...state, interventionRecord };
  const sides = computeSides(
    currentSimulationTime(state),
    caseData.timeline?.scheduledInsults ?? [],
    activeInterventions(interventionRecord, state.lineage),
  );
  return { ...state, interventionRecord, avatar: { ...state.avatar, ...sides } };
}

/**
 * Recomputes the Rescue_Gate_Time from the case's Required_Interventions and
 * the lineage's Active_Interventions, and applies it with `setRescueGate`
 * (6.23, 6.24). Returns the same state when the gate is unchanged.
 */
function withRescueGate(state: SessionUiState): SessionUiState {
  const gate = rescueGateTime(
    requiredInterventions(state.caseData?.play),
    activeInterventions(state.interventionRecord, state.lineage),
  );
  const next = setRescueGate(state.endingCtx, state.ending, gate);
  if (next.ctx === state.endingCtx && next.state === state.ending) return state;
  return { ...state, endingCtx: next.ctx, ending: next.state };
}

function onFork(
  state: SessionUiState,
  session: SessionMetadata,
  newBranchId: string,
  forkTime: number,
): SessionUiState {
  // The new Branch's Checkpoint list may not be loaded yet. The service copies
  // the fork Checkpoint into the new Branch at the same Simulation_Time, so a
  // stand-in entry at `forkTime` lets `buildLineage` bound the parent segment
  // at once. A real list loaded later replaces it and gives the same lineage.
  let checkpointsByBranch = state.checkpointsByBranch;
  if (checkpointsByBranch[newBranchId] === undefined) {
    const branch = (session.branches ?? []).find((b) => b.branch_id === newBranchId);
    const forkCopy: CheckpointMetadata = {
      checkpoint_id: branch?.forked_from_checkpoint ?? `${newBranchId}-fork`,
      simulation_time: forkTime,
      created_at: branch?.created_at ?? '',
      is_automatic: false,
    };
    checkpointsByBranch = { ...checkpointsByBranch, [newBranchId]: [forkCopy] };
  }
  const lineage = lineageFor(session, newBranchId, checkpointsByBranch);

  // Avatar at the fork point: default vital-derived fields, sides of the new lineage.
  const caseData = state.caseData;
  const play = caseData?.play;
  const avatar =
    caseData !== null && play !== undefined
      ? mapAvatar({
          sample: { simulation_time: forkTime },
          alarms: caseData.alarms,
          play,
          scheduledInsults: caseData.timeline?.scheduledInsults ?? [],
          activeInterventions: activeInterventions(state.interventionRecord, lineage),
          previous: null,
          firstPositiveTidalVolumeMl: state.firstPositiveTidalVolumeMl,
        })
      : defaultAvatar();

  // A fresh Ending state: stepEnding ignores non-increasing times, so the old
  // Branch's state must not be reused (6.11).
  return {
    ...state,
    session,
    currentBranchId: newBranchId,
    checkpointsByBranch,
    lineage,
    latestSample: null,
    history: [],
    staleGuard: { maxTime: forkTime + STALE_TOLERANCE_S },
    avatar,
    ending: initialEndingState(state.endingCtx),
    endingSnapshot: null,
  };
}

function onHint(state: SessionUiState, wallClockTime: string): SessionUiState {
  const hints = state.caseData?.play?.hints ?? [];
  if (state.hintsRevealed >= hints.length) return state;
  const entry: HintRecordEntry = {
    hintIndex: state.hintsRevealed + 1,
    branchId: state.currentBranchId ?? '',
    simulationTime: currentSimulationTime(state),
    wallClockTime,
  };
  return { ...state, hintsRevealed: state.hintsRevealed + 1, hintRecord: [...state.hintRecord, entry] };
}

function onSample(state: SessionUiState, sample: VitalSigns): SessionUiState {
  // 1. Stale-sample guard: time-only, because messages carry no branch_id.
  const guard = state.staleGuard;
  if (guard !== null && sample.simulation_time > guard.maxTime) return state;

  // 2. Latest sample and capped history.
  const history =
    state.history.length >= HISTORY_LIMIT
      ? [...state.history.slice(state.history.length - HISTORY_LIMIT + 1), sample]
      : [...state.history, sample];

  // 3. First positive tidal volume of the Session.
  let firstPositiveTidalVolumeMl = state.firstPositiveTidalVolumeMl;
  if (firstPositiveTidalVolumeMl === null) {
    const tv = readVital(sample, 'tidalVolume');
    if (tv !== undefined && tv > 0) firstPositiveTidalVolumeMl = tv;
  }

  // 4. Avatar, from the previous sample's parameters. Needs the case's alarms
  //    and Play_Section; without them the Avatar is not shown and stays as is.
  const caseData = state.caseData;
  const play = caseData?.play;
  const avatar =
    caseData !== null && play !== undefined
      ? mapAvatar({
          sample,
          alarms: caseData.alarms,
          play,
          scheduledInsults: caseData.timeline?.scheduledInsults ?? [],
          activeInterventions: activeInterventions(state.interventionRecord, state.lineage),
          previous: state.avatar,
          firstPositiveTidalVolumeMl,
        })
      : state.avatar;

  // 5. Ending, advanced by this sample; snapshot when it leaves `none`.
  const ending = stepEnding(state.endingCtx, state.ending, sample);
  const endingSnapshot =
    state.ending.ending === 'none' && ending.ending !== 'none' ? avatar : state.endingSnapshot;

  return {
    ...state,
    staleGuard: null,
    latestSample: sample,
    history,
    firstPositiveTidalVolumeMl,
    avatar,
    ending,
    endingSnapshot,
  };
}

export function sessionReducer(state: SessionUiState, action: SessionAction): SessionUiState {
  switch (action.type) {
    case 'caseLoaded': {
      const { caseData, storedView } = action;
      const hasPlay = caseData.play !== undefined;
      const view: View = hasPlay ? (storedView ?? 'play') : 'clinician';
      const endingCtx = buildEndingContext(caseData);
      return withRescueGate({
        ...state,
        caseStatus: 'loaded',
        caseData,
        caseError: null,
        endingCtx,
        ending: initialEndingState(endingCtx),
        endingSnapshot: null,
        view,
      });
    }

    case 'caseFailed':
      return { ...state, caseStatus: 'failed', caseError: action.message, view: 'clinician' };

    case 'sessionLoaded': {
      const { session } = action;
      const currentBranchId = session.current_branch_id;
      return withRescueGate({
        ...state,
        session,
        currentBranchId,
        lineage: lineageFor(session, currentBranchId, state.checkpointsByBranch),
      });
    }

    case 'checkpointsLoaded': {
      // A newly loaded list replaces that Branch's earlier list; other Branches keep theirs.
      const checkpointsByBranch = { ...state.checkpointsByBranch, ...action.byBranch };
      return withRescueGate({
        ...state,
        checkpointsByBranch,
        lineage: lineageFor(state.session, state.currentBranchId, checkpointsByBranch),
      });
    }

    case 'connectionChanged':
      return action.connected === state.connected ? state : { ...state, connected: action.connected };

    case 'sampleReceived':
      return onSample(state, action.sample);

    case 'viewSelected': {
      // Play is unavailable without a loaded Play_Section (1.2, 1.11).
      if (action.view === 'play' && state.caseData?.play === undefined) return state;
      return action.view === state.view ? state : { ...state, view: action.view };
    }

    case 'playbackChanged': {
      const playing = action.playing ?? state.playing;
      const speed = action.speed ?? state.speed;
      return playing === state.playing && speed === state.speed ? state : { ...state, playing, speed };
    }

    case 'interventionRecordRestored':
      return withRescueGate(withSides(state, action.record));

    case 'interventionSucceeded':
      return withRescueGate(withSides(state, [...state.interventionRecord, action.entry]));

    case 'forkSucceeded':
      // onFork resets the Ending state; the gate is then recomputed for the new lineage (6.21).
      return withRescueGate(onFork(state, action.session, action.newBranchId, action.forkTime));

    case 'hintRevealed':
      return onHint(state, action.wallClockTime);

    default: {
      const unreachable: never = action;
      return unreachable;
    }
  }
}
