/**
 * Session hook for the play-mode design ("Session hook").
 *
 * `useSimulationSession` owns all I/O of a session page: case and session
 * loading, the Vitals_Stream, playback, Interventions, hints and forks. State
 * lives in `sessionReducer`; this module only feeds it actions.
 *
 * The pure helpers below hold the retry and once-only rules and the per-tab
 * sessionStorage keys. They take their storage, `send` and `sleep` as
 * arguments, so tests need no DOM or network.
 */

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  api,
  CASE_TIMEOUT_MS,
  CHECKPOINTS_TIMEOUT_MS,
  FORK_TIMEOUT_MS,
  INTERVENTION_TIMEOUT_MS,
  PLAYBACK_TIMEOUT_MS,
} from '@/lib/api';
import { activeInterventions as selectActiveInterventions } from '@/lib/branchLineage';
import { loadExamRecord, saveExamRecord } from '@/lib/examRecord';
import { buildInterventionEntry, loadRecord, saveRecord } from '@/lib/interventionRecord';
import { initialSessionState, sessionReducer, type SessionUiState, type View } from '@/lib/sessionState';
import { selectStatus } from '@/lib/statusSelector';
import type {
  BranchMetadata,
  CaseData,
  CheckpointMetadata,
  InterventionRecordEntry,
  PlaybackSpeed,
  SessionMetadata,
  Side,
  VitalSigns,
} from '@/types';

/** Retries after the first pause attempt fails (UI constant, not clinical). */
export const PAUSE_RETRIES = 2;
/** Wait between pause attempts in milliseconds (UI constant, not clinical). */
export const PAUSE_RETRY_DELAY_MS = 2_000;

type CaseStatus = SessionUiState['caseStatus'];

/** sessionStorage key for the last selected view of a session. */
export function viewKey(sessionId: string): string {
  return `stitched-patient:view:${sessionId}`;
}

/** sessionStorage key marking that the default 2x request was sent for a session. */
export function defaultSpeedKey(sessionId: string): string {
  return `stitched-patient:default-speed-sent:${sessionId}`;
}

/**
 * Sends the pause request once and retries at most PAUSE_RETRIES more times,
 * waiting PAUSE_RETRY_DELAY_MS between attempts. Resolves true on the first
 * success and false when every attempt fails. Never throws; a `send` that throws
 * synchronously counts as a failed attempt. The per-attempt timeout belongs to `send`.
 */
export async function runPauseWithRetry(
  send: () => Promise<void>,
  sleep: (ms: number) => Promise<void>,
): Promise<boolean> {
  const attempts = 1 + PAUSE_RETRIES;
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) {
      await sleep(PAUSE_RETRY_DELAY_MS);
    }
    try {
      await send();
      return true;
    } catch {
      // Failed attempt; try again if any are left.
    }
  }
  return false;
}

/**
 * True only when the Play view is shown, the case is loaded and the default 2x
 * request has not been sent for this session in this tab. If storage cannot be
 * read, returns false so the request is never resent when unsure.
 */
export function shouldSendDefaultSpeed(
  storage: Pick<Storage, 'getItem'>,
  sessionId: string,
  view: View,
  caseStatus: CaseStatus,
): boolean {
  if (view !== 'play' || caseStatus !== 'loaded') {
    return false;
  }
  try {
    return storage.getItem(defaultSpeedKey(sessionId)) === null;
  } catch {
    return false;
  }
}

/** Records that the default 2x request is being sent. Written before the request. */
export function markDefaultSpeedSent(storage: Pick<Storage, 'setItem'>, sessionId: string): void {
  try {
    storage.setItem(defaultSpeedKey(sessionId), '1');
  } catch {
    // Storage unavailable or full; the view still works without the flag.
  }
}

/** Stores the selected view for this session. Makes no network request. */
export function persistViewSelection(storage: Pick<Storage, 'setItem'>, sessionId: string, view: View): void {
  try {
    storage.setItem(viewKey(sessionId), view);
  } catch {
    // Storage unavailable or full; the selection still applies in memory.
  }
}

/** Reads the stored view for this session; null when missing, invalid or unreadable. */
export function readStoredView(storage: Pick<Storage, 'getItem'>, sessionId: string): View | null {
  try {
    const value = storage.getItem(viewKey(sessionId));
    return value === 'play' || value === 'clinician' ? value : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// The hook
// ---------------------------------------------------------------------------

type Outcome = 'ok' | 'error';

/** Fallback stream error text, as shown by the session page before this hook. */
const STREAM_ERROR_MESSAGE = 'WebSocket error - connection lost';

/** The tab's sessionStorage, or null during server rendering or when the browser blocks it. */
function tabStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

/** Simulation_Time "now": latest sample, else the current Branch's fork time, else 0 (as for hints). */
function nowSimulationTime(state: SessionUiState): number {
  return state.latestSample?.simulation_time ?? state.lineage[0]?.forkTime ?? 0;
}

/** Current Branch followed by its ancestors, from `session.branches`; stops on a cycle or a missing parent. */
function lineageBranchIds(session: SessionMetadata): string[] {
  const byId = new Map<string, BranchMetadata>();
  for (const b of session.branches ?? []) if (!byId.has(b.branch_id)) byId.set(b.branch_id, b);
  const ids: string[] = [];
  const seen = new Set<string>();
  let id: string | undefined = session.current_branch_id;
  while (typeof id === 'string' && !seen.has(id)) {
    seen.add(id);
    ids.push(id);
    id = byId.get(id)?.parent_branch_id ?? undefined;
  }
  return ids;
}

/** A Vitals_Stream message that can be passed to the reducer as a sample. */
function isSample(data: unknown): data is VitalSigns {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return false;
  const t = (data as { simulation_time?: unknown }).simulation_time;
  return typeof t === 'number' && Number.isFinite(t);
}

export interface SimulationSessionActions {
  /** Switches the view and stores it for this tab; no network (1.5). */
  selectView(view: View): void;
  setPlaying(playing: boolean): Promise<void>;
  setSpeed(speed: PlaybackSpeed): Promise<void>;
  applyIntervention(id: string): Promise<Outcome>;
  revealHint(): void;
  loadLineageCheckpoints(): Promise<Outcome>;
  fork(checkpointId: string, forkTime: number): Promise<Outcome>;
  /** Records a bedside exam on the current Branch; no network, ignored while a fork is pending (6.4, 6.9). */
  performExam(actionId: string, side: Side | null): void;
}

export interface SimulationSessionNotices {
  /** All pause attempts after an Ending failed on the current Branch (7.10). */
  pauseFailed: boolean;
  /** Last Vitals_Stream error, cleared when the stream opens again. */
  streamError: string | null;
}

export interface SimulationSession {
  state: SessionUiState;
  activeInterventions: InterventionRecordEntry[];
  /** `null` when the case has no Play_Section. */
  statusSentence: string | null;
  actions: SimulationSessionActions;
  notices: SimulationSessionNotices;
}

export function useSimulationSession(sessionId: string): SimulationSession {
  const [state, dispatch] = useReducer(sessionReducer, undefined, initialSessionState);
  const [pauseFailed, setPauseFailed] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);

  // Refs read by async callbacks, so they see current values after an await.
  const stateRef = useRef(state);
  stateRef.current = state;
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;
  const mountedRef = useRef(false);
  /** True while an Intervention or a fork request is in flight. */
  const pendingRef = useRef(false);
  /** True while a fork request is in flight; exams are refused meanwhile (6.9). */
  const forkPendingRef = useRef(false);
  /** Branch for which the pause-on-Ending request was already started. */
  const pausedBranchRef = useRef<string | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  /** A result for `sid` may still be dispatched: mounted and the session unchanged. */
  const isCurrent = useCallback((sid: string) => mountedRef.current && sessionIdRef.current === sid, []);

  /**
   * Loads the Checkpoint lists of `session`'s current Branch and its ancestors
   * and dispatches the lists that loaded. 'error' when any list failed.
   */
  const fetchLineageCheckpoints = useCallback(
    async (sid: string, session: SessionMetadata): Promise<Outcome> => {
      const ids = lineageBranchIds(session);
      const results = await Promise.allSettled(
        ids.map((id) => api.getCheckpoints(sid, id, { timeoutMs: CHECKPOINTS_TIMEOUT_MS })),
      );
      const byBranch: Record<string, CheckpointMetadata[]> = {};
      let failed = false;
      results.forEach((r, i) => {
        if (r.status === 'fulfilled' && Array.isArray(r.value)) byBranch[ids[i]] = r.value;
        else failed = true;
      });
      if (!isCurrent(sid)) return 'error';
      if (Object.keys(byBranch).length > 0) dispatch({ type: 'checkpointsLoaded', byBranch });
      return failed ? 'error' : 'ok';
    },
    [isCurrent],
  );

  // Restore the Intervention_Record first, before any sample can use it (8.13).
  useEffect(() => {
    const storage = tabStorage();
    const record = storage === null ? [] : loadRecord(storage, sessionId);
    dispatch({ type: 'interventionRecordRestored', record });
  }, [sessionId]);

  // Restore the Exam_Record on mount, before any user input can use it (7.5).
  useEffect(() => {
    const storage = tabStorage();
    const record = storage === null ? [] : loadExamRecord(storage, sessionId);
    dispatch({ type: 'examRecordRestored', record });
  }, [sessionId]);

  // Persist the Exam_Record once restored, so the initial empty record never
  // overwrites the stored one (7.4, 7.6).
  const examRecord = state.examRecord;
  const examRecordLoaded = state.examRecordLoaded;
  useEffect(() => {
    if (!examRecordLoaded) return;
    const storage = tabStorage();
    if (storage !== null) saveExamRecord(storage, sessionId, examRecord);
  }, [examRecord, examRecordLoaded, sessionId]);

  // Load case.
  useEffect(() => {
    let active = true;
    api.getCaseData(sessionId, { timeoutMs: CASE_TIMEOUT_MS }).then(
      (caseData: CaseData) => {
        if (!active) return;
        const storage = tabStorage();
        const storedView = storage === null ? null : readStoredView(storage, sessionId);
        dispatch({ type: 'caseLoaded', caseData, storedView });
      },
      (err: unknown) => {
        if (!active) return;
        dispatch({ type: 'caseFailed', message: errorMessage(err, 'Failed to load case') });
      },
    );
    return () => {
      active = false;
    };
  }, [sessionId]);

  // Load session, then the lineage Checkpoints.
  useEffect(() => {
    let active = true;
    api.getSession(sessionId).then(
      (session: SessionMetadata) => {
        if (!active) return;
        dispatch({ type: 'sessionLoaded', session });
        void fetchLineageCheckpoints(sessionId, session);
      },
      (err: unknown) => {
        console.error('Failed to load session:', err);
      },
    );
    return () => {
      active = false;
    };
  }, [sessionId, fetchLineageCheckpoints]);

  // Vitals_Stream: one socket per sessionId; never depends on the view (1.4, 1.5).
  useEffect(() => {
    let closed = false;
    let ws: WebSocket;
    try {
      ws = api.connectVitalsStream(sessionId);
    } catch (err) {
      setStreamError(errorMessage(err, STREAM_ERROR_MESSAGE));
      return;
    }

    ws.onopen = () => {
      if (closed) return;
      dispatch({ type: 'connectionChanged', connected: true });
      setStreamError(null);
    };
    ws.onmessage = (event: MessageEvent) => {
      if (closed) return;
      let data: unknown;
      try {
        data = JSON.parse(event.data);
      } catch (err) {
        console.error('Failed to parse vitals:', err);
        return;
      }
      if (typeof data === 'object' && data !== null && 'error' in data && (data as { error: unknown }).error) {
        setStreamError(String((data as { error: unknown }).error));
        return;
      }
      if (isSample(data)) dispatch({ type: 'sampleReceived', sample: data });
    };
    ws.onerror = () => {
      if (closed) return;
      setStreamError(STREAM_ERROR_MESSAGE);
      dispatch({ type: 'connectionChanged', connected: false });
    };
    ws.onclose = () => {
      if (closed) return;
      dispatch({ type: 'connectionChanged', connected: false });
    };

    return () => {
      closed = true;
      ws.close();
    };
  }, [sessionId]);

  // A new Branch starts without a pause failure notice.
  useEffect(() => {
    setPauseFailed(false);
  }, [state.currentBranchId]);

  // Pause on Ending, once per Branch (7.1, 7.10). The ref is set before the
  // request, so Strict Mode's second effect run does not send it again.
  const endingValue = state.ending.ending;
  const currentBranchId = state.currentBranchId;
  useEffect(() => {
    if (endingValue === 'none' || currentBranchId === null) return;
    if (pausedBranchRef.current === currentBranchId) return;
    pausedBranchRef.current = currentBranchId;
    const sid = sessionId;
    const branchId = currentBranchId;
    void runPauseWithRetry(async () => {
      await api.controlPlayback(sid, false, undefined, { timeoutMs: PLAYBACK_TIMEOUT_MS });
    }, sleep).then((ok) => {
      if (!isCurrent(sid)) return;
      if (ok) dispatch({ type: 'playbackChanged', playing: false });
      else if (stateRef.current.currentBranchId === branchId) setPauseFailed(true);
    });
  }, [endingValue, currentBranchId, sessionId, isCurrent]);

  // Default 2x in Play, once per Session in this tab (11.12, 11.13). The flag
  // is written before the request, so neither a failure nor a later view
  // switch resends it.
  const view = state.view;
  const caseStatus = state.caseStatus;
  useEffect(() => {
    const storage = tabStorage();
    if (storage === null || !shouldSendDefaultSpeed(storage, sessionId, view, caseStatus)) return;
    markDefaultSpeedSent(storage, sessionId);
    const sid = sessionId;
    api.controlPlayback(sid, undefined, '2x', { timeoutMs: PLAYBACK_TIMEOUT_MS }).then(
      () => {
        if (isCurrent(sid)) dispatch({ type: 'playbackChanged', speed: '2x' });
      },
      (err: unknown) => {
        console.error('Failed to set default speed:', err);
      },
    );
  }, [view, caseStatus, sessionId, isCurrent]);

  const selectView = useCallback(
    (next: View) => {
      // The reducer ignores Play without a Play_Section; store only what applies.
      if (next === 'play' && stateRef.current.caseData?.play === undefined) return;
      dispatch({ type: 'viewSelected', view: next });
      const storage = tabStorage();
      if (storage !== null) persistViewSelection(storage, sessionId, next);
    },
    [sessionId],
  );

  const setPlaying = useCallback(
    async (playing: boolean) => {
      const sid = sessionId;
      try {
        await api.controlPlayback(sid, playing, undefined, { timeoutMs: PLAYBACK_TIMEOUT_MS });
        if (isCurrent(sid)) dispatch({ type: 'playbackChanged', playing });
      } catch (err) {
        console.error('Failed to control playback:', err);
      }
    },
    [sessionId, isCurrent],
  );

  const setSpeed = useCallback(
    async (speed: PlaybackSpeed) => {
      const sid = sessionId;
      try {
        await api.controlPlayback(sid, undefined, speed, { timeoutMs: PLAYBACK_TIMEOUT_MS });
        if (isCurrent(sid)) dispatch({ type: 'playbackChanged', speed });
      } catch (err) {
        console.error('Failed to change speed:', err);
      }
    },
    [sessionId, isCurrent],
  );

  const applyIntervention = useCallback(
    async (id: string): Promise<Outcome> => {
      const sid = sessionId;
      const atCall = stateRef.current;
      if (pendingRef.current) return 'error';
      const branchId = atCall.currentBranchId;
      if (branchId === null) return 'error';
      if (atCall.caseStatus !== 'loaded' || atCall.caseData === null) return 'error';
      const intervention = atCall.caseData.interventions.find((i) => i.id === id);
      if (intervention === undefined) return 'error';

      pendingRef.current = true;
      try {
        // Same intervention_id and no extra parameters as the Clinician_View sends (8.5).
        await api.applyIntervention(sid, id, undefined, { timeoutMs: INTERVENTION_TIMEOUT_MS });
        const storage = tabStorage();
        if (isCurrent(sid)) {
          const now = stateRef.current;
          // Forks are refused while this request is pending, so `branchId` is still current.
          const entry = buildInterventionEntry(intervention, nowSimulationTime(now), branchId);
          dispatch({ type: 'interventionSucceeded', entry });
          if (storage !== null) saveRecord(storage, sid, [...now.interventionRecord, entry]);
        } else if (storage !== null) {
          // Unmounted meanwhile: keep the stored record complete for the next mount.
          const entry = buildInterventionEntry(intervention, nowSimulationTime(atCall), branchId);
          saveRecord(storage, sid, [...loadRecord(storage, sid), entry]);
        }
        return 'ok';
      } catch (err) {
        console.error('Failed to apply intervention:', err);
        return 'error';
      } finally {
        pendingRef.current = false;
      }
    },
    [sessionId, isCurrent],
  );

  const revealHint = useCallback(() => {
    if (stateRef.current.currentBranchId === null) return;
    dispatch({ type: 'hintRevealed', wallClockTime: new Date().toISOString() });
  }, []);

  const loadLineageCheckpoints = useCallback(async (): Promise<Outcome> => {
    const session = stateRef.current.session;
    if (session === null) return 'error';
    return fetchLineageCheckpoints(sessionId, session);
  }, [sessionId, fetchLineageCheckpoints]);

  const fork = useCallback(
    async (checkpointId: string, forkTime: number): Promise<Outcome> => {
      const sid = sessionId;
      if (pendingRef.current || !Number.isFinite(forkTime)) return 'error';
      if (stateRef.current.session === null) return 'error';

      pendingRef.current = true;
      forkPendingRef.current = true;
      try {
        const created: unknown = await api.forkBranch(sid, checkpointId, 'User fork', {
          timeoutMs: FORK_TIMEOUT_MS,
        });
        const newBranch = created as BranchMetadata | null;
        if (newBranch === null || typeof newBranch !== 'object' || typeof newBranch.branch_id !== 'string') {
          return 'error';
        }

        let session: SessionMetadata;
        try {
          session = await api.getSession(sid, { timeoutMs: FORK_TIMEOUT_MS });
        } catch (err) {
          console.error('Failed to reload session after fork:', err);
          // Previous metadata plus the returned Branch.
          const prev = stateRef.current.session;
          if (prev === null) return 'error';
          session = {
            ...prev,
            current_branch_id: newBranch.branch_id,
            branches: [...(prev.branches ?? []).filter((b) => b.branch_id !== newBranch.branch_id), newBranch],
          };
        }

        if (!isCurrent(sid)) return 'ok';
        dispatch({ type: 'forkSucceeded', session, newBranchId: newBranch.branch_id, forkTime });
        void fetchLineageCheckpoints(sid, { ...session, current_branch_id: newBranch.branch_id });
        return 'ok';
      } catch (err) {
        console.error('Failed to fork branch:', err);
        return 'error';
      } finally {
        pendingRef.current = false;
        forkPendingRef.current = false;
      }
    },
    [sessionId, isCurrent, fetchLineageCheckpoints],
  );

  // No api call and no pendingRef: a pending Intervention does not block an exam (6.4).
  const performExam = useCallback((actionId: string, side: Side | null) => {
    if (forkPendingRef.current) return;
    if (stateRef.current.currentBranchId === null) return;
    dispatch({ type: 'examPerformed', actionId, side, wallClockTime: new Date().toISOString() });
  }, []);

  const activeInterventions = useMemo(
    () => selectActiveInterventions(state.interventionRecord, state.lineage),
    [state.interventionRecord, state.lineage],
  );

  const caseData = state.caseData;
  const latestSample = state.latestSample;
  const statusSentence = useMemo(() => {
    if (caseData === null || caseData.play === undefined) return null;
    return selectStatus(latestSample, caseData.alarms, caseData.play);
  }, [caseData, latestSample]);

  const actions = useMemo<SimulationSessionActions>(
    () => ({
      selectView,
      setPlaying,
      setSpeed,
      applyIntervention,
      revealHint,
      loadLineageCheckpoints,
      fork,
      performExam,
    }),
    [selectView, setPlaying, setSpeed, applyIntervention, revealHint, loadLineageCheckpoints, fork, performExam],
  );

  const notices = useMemo<SimulationSessionNotices>(
    () => ({ pauseFailed, streamError }),
    [pauseFailed, streamError],
  );

  return { state, activeInterventions, statusSentence, actions, notices };
}
