/**
 * Session UI state and its reducer (design "sessionState.ts — the reducer").
 *
 * Pure: no Wall_Clock_Time, storage, network or randomness. The reducer never
 * mutates its input and returns the same state object when an action changes
 * nothing.
 */

import { BREATH_DEPTH_DEFAULT, DEFAULT_BEAT_PERIOD_S, DEFAULT_BREATH_PERIOD_S, mapAvatar } from './avatarMapper';
import { activeInterventions, buildLineage } from './branchLineage';
import { buildEndingContext, initialEndingState, stepEnding, type EndingContext, type EndingState } from './endingEvaluator';
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
  const endingCtx: EndingContext = { play: undefined, rescueFromTime: 0 };
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
      return {
        ...state,
        caseStatus: 'loaded',
        caseData,
        caseError: null,
        endingCtx,
        ending: initialEndingState(endingCtx),
        endingSnapshot: null,
        view,
      };
    }

    case 'caseFailed':
      return { ...state, caseStatus: 'failed', caseError: action.message, view: 'clinician' };

    case 'sessionLoaded': {
      const { session } = action;
      const currentBranchId = session.current_branch_id;
      return {
        ...state,
        session,
        currentBranchId,
        lineage: lineageFor(session, currentBranchId, state.checkpointsByBranch),
      };
    }

    case 'checkpointsLoaded': {
      // A newly loaded list replaces that Branch's earlier list; other Branches keep theirs.
      const checkpointsByBranch = { ...state.checkpointsByBranch, ...action.byBranch };
      return {
        ...state,
        checkpointsByBranch,
        lineage: lineageFor(state.session, state.currentBranchId, checkpointsByBranch),
      };
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

    case 'interventionRecordRestored': // implemented in task 8.2
    case 'interventionSucceeded': // implemented in task 8.2
    case 'forkSucceeded': // implemented in task 8.2
    case 'hintRevealed': // implemented in task 8.2
      return state;

    default: {
      const unreachable: never = action;
      return unreachable;
    }
  }
}
