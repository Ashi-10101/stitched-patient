/**
 * Rewind panel for the Play view (play-mode Requirements 10.2, 10.5, 10.6,
 * 10.7, 10.10, 10.11, 10.12, 11.2, 11.5, 11.6, 11.10; design "Rewind panel").
 *
 * `RewindPanelBody` is presentational and pure: no hooks, no ids, no network.
 * It renders a modal dialog below the Safety_Notice (fixed, z-40 under the
 * notice's z-50). Moment buttons are native `<button>`s and go through
 * `selectIfAllowed`, so a selection is only reported while the status allows
 * one ('ready' or 'forkError').
 */

'use client';

import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type Ref, type RefObject } from 'react';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import type { SimulationSession } from '@/hooks/useSimulationSession';
import { activeInterventions } from '@/lib/branchLineage';
import { labelRewindMoment, selectRewindCheckpoints, type LineageCheckpoint } from '@/lib/rewindMoments';
import type { SessionUiState } from '@/lib/sessionState';
import type { Intervention, RewindMoment } from '@/types';

export type RewindStatus = 'loading' | 'loadError' | 'ready' | 'forking' | 'forkError';

export const LOADING_TEXT = 'Loading earlier moments\u2026';
export const LOAD_ERROR_TEXT = "Couldn't load earlier moments. Please try again.";
export const NO_MOMENTS_TEXT = 'No earlier moments yet.';
export const CHOOSE_MOMENT_TEXT = 'Choose a moment to go back to.';
export const FORKING_TEXT = 'Rewinding\u2026';
export const FORK_ERROR_TEXT = "Couldn't rewind. Please try again.";
export const DIALOG_LABEL = 'Rewind to an earlier moment';

/** Whether a moment may be selected in this status. */
export function canSelectMoment(status: RewindStatus): boolean {
  return status === 'ready' || status === 'forkError';
}

/**
 * Calls `onSelect(moment)` once only when `canSelectMoment(status)`.
 * Returns whether `onSelect` was called.
 */
export function selectIfAllowed(
  status: RewindStatus,
  moment: RewindMoment,
  onSelect: (moment: RewindMoment) => void,
): boolean {
  if (!canSelectMoment(status)) return false;
  onSelect(moment);
  return true;
}

/** Text for the status line. */
export function rewindStatusText(status: RewindStatus, momentCount: number): string {
  switch (status) {
    case 'loading':
      return LOADING_TEXT;
    case 'loadError':
      return LOAD_ERROR_TEXT;
    case 'ready':
      return momentCount === 0 ? NO_MOMENTS_TEXT : CHOOSE_MOMENT_TEXT;
    case 'forking':
      return FORKING_TEXT;
    case 'forkError':
      return FORK_ERROR_TEXT;
  }
}

/** Whether the moment list is shown in this status (never while loading or after a load error). */
function showsMoments(status: RewindStatus): boolean {
  return status === 'ready' || status === 'forking' || status === 'forkError';
}

export interface RewindPanelBodyProps {
  status: RewindStatus;
  moments: RewindMoment[];
  onSelect: (moment: RewindMoment) => void;
  onClose: () => void;
  containerRef?: Ref<HTMLDivElement>;
}

export function RewindPanelBody({ status, moments, onSelect, onClose, containerRef }: RewindPanelBodyProps) {
  const selectable = canSelectMoment(status);
  const listed = showsMoments(status) && moments.length > 0;

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-modal="true"
      aria-label={DIALOG_LABEL}
      data-part="rewind-panel"
      className="sp-play fixed inset-x-0 z-40 mx-auto flex max-h-[80vh] w-full max-w-lg flex-col gap-3 overflow-y-auto rounded-b-lg border-2 border-t-0 border-[var(--sp-accent)] bg-[var(--sp-bg)] p-4 text-base text-[var(--sp-text)] shadow-lg"
      style={{ top: 'var(--notice-h)' }}
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">{DIALOG_LABEL}</h2>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border-2 border-[var(--sp-accent)] px-3 py-1 text-base font-semibold text-[var(--sp-text)] hover:bg-[var(--sp-accent)] hover:text-[var(--sp-bg)]"
        >
          Close
        </button>
      </div>
      <p role="status" className="text-base">
        {rewindStatusText(status, moments.length)}
      </p>
      {listed && (
        <ol className="flex flex-col gap-2">
          {moments.map((moment) => (
            <li key={moment.checkpointId}>
              <button
                type="button"
                disabled={!selectable}
                onClick={() => selectIfAllowed(status, moment, onSelect)}
                className={`w-full whitespace-normal break-words rounded-lg border-2 border-[var(--sp-accent)] px-4 py-2 text-left text-base text-[var(--sp-text)] ${
                  selectable ? 'hover:bg-[var(--sp-accent)] hover:text-[var(--sp-bg)]' : 'cursor-not-allowed opacity-60'
                }`}
              >
                {moment.label}
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export default RewindPanelBody;

// ---------------------------------------------------------------------------
// Container state (pure)
// ---------------------------------------------------------------------------

export interface RewindPanelState {
  status: RewindStatus | 'closed';
  moments: RewindMoment[];
  /** Number of the current load or fork request. Results with another number are stale. */
  request: number;
}

export type RewindPanelEvent =
  | { type: 'open' }
  | { type: 'close' }
  | { type: 'loadDone'; request: number; ok: boolean; moments: RewindMoment[] }
  | { type: 'select' }
  | { type: 'forkDone'; request: number; ok: boolean };

export const initialRewindPanelState: RewindPanelState = { status: 'closed', moments: [], request: 0 };

/** Whether a 'select' event would be accepted in this state (an open panel in 'ready' or 'forkError'). */
export function acceptsSelection(state: RewindPanelState): boolean {
  return state.status !== 'closed' && canSelectMoment(state.status);
}

/**
 * Status of the Rewind_Panel container. Pure; never mutates `state`.
 *
 * - `open` (from any status, also when already open): 'loading', moments [], request + 1.
 *   A new load starts; results of earlier requests become stale.
 * - `loadDone` with the current request while 'loading': ok → 'ready' with the given
 *   moments; not ok → 'loadError' with moments [] (nothing listed until reopened, 10.11).
 * - `select` in 'ready' or 'forkError' ({@link acceptsSelection}): 'forking', request + 1,
 *   moments unchanged. In any other status the same state object is returned, so the
 *   container calls fork exactly once per accepted selection (10.6, 10.7).
 * - `forkDone` with the current request while 'forking': ok → 'closed', moments [];
 *   not ok → 'forkError' with the same moments, which stay selectable (10.10).
 * - `close`: 'closed', moments [], request + 1, so in-flight results become stale.
 * - A `loadDone` or `forkDone` whose request differs from the current one, or that arrives
 *   while the status is not 'loading' or 'forking' respectively, returns the same state object.
 */
export function rewindPanelReducer(state: RewindPanelState, event: RewindPanelEvent): RewindPanelState {
  switch (event.type) {
    case 'open':
      return { status: 'loading', moments: [], request: state.request + 1 };
    case 'close':
      return { status: 'closed', moments: [], request: state.request + 1 };
    case 'loadDone':
      if (state.status !== 'loading' || event.request !== state.request) return state;
      return event.ok
        ? { status: 'ready', moments: event.moments, request: state.request }
        : { status: 'loadError', moments: [], request: state.request };
    case 'select':
      if (!acceptsSelection(state)) return state;
      return { status: 'forking', moments: state.moments, request: state.request + 1 };
    case 'forkDone':
      if (state.status !== 'forking' || event.request !== state.request) return state;
      return event.ok
        ? { status: 'closed', moments: [], request: state.request }
        : { status: 'forkError', moments: state.moments, request: state.request };
  }
}

/**
 * Rewind_Moments for the current session state, newest first, at most five
 * (Requirements 10.2–10.5, 10.12). Pure.
 *
 * Each lineage segment contributes the Checkpoints of its Branch with
 * `simulation_time <= upperBound`; `depth` is the segment's index (current Branch 0).
 * Ordering and the limit come from `selectRewindCheckpoints`.
 */
export function buildRewindMoments(state: SessionUiState, interventions: Intervention[]): RewindMoment[] {
  const checkpoints: LineageCheckpoint[] = [];
  state.lineage.forEach((segment, depth) => {
    for (const checkpoint of state.checkpointsByBranch[segment.branchId] ?? []) {
      if (checkpoint.simulation_time <= segment.upperBound) {
        checkpoints.push({ checkpoint, branchId: segment.branchId, depth });
      }
    }
  });
  const lineageInterventions = activeInterventions(state.interventionRecord, state.lineage);
  const selected = selectRewindCheckpoints({
    checkpoints,
    latestSampleTime: state.latestSample?.simulation_time ?? null,
    timeLimitSeconds: state.caseData?.play?.endings.lost.timeLimitSeconds,
    lineageInterventions,
  });
  return selected.map(({ checkpoint }) => ({
    checkpointId: checkpoint.checkpoint_id,
    simulationTime: checkpoint.simulation_time,
    label: labelRewindMoment(checkpoint, lineageInterventions, interventions),
  }));
}

// ---------------------------------------------------------------------------
// Container
// ---------------------------------------------------------------------------

export interface RewindPanelProps {
  /** The parent shows the panel while this is true. */
  open: boolean;
  sim: Pick<SimulationSession, 'state' | 'actions'>;
  /** The Rewind button outside the panel; gets focus back when the panel closes without a fork. */
  rewindButtonRef: RefObject<HTMLElement>;
  /** Asks the parent to set `open` to false. */
  onClose: () => void;
}

/**
 * Rewind_Panel container (design "Rewind panel"; Requirements 10.6, 10.7, 10.10,
 * 10.11, 11.5, 11.6, 11.10).
 *
 * Panel state: every event goes through `send`, which applies the pure reducer to
 * `latestRef` synchronously and then dispatches the same event to React. Because the
 * reducer is pure and sees the same events in the same order, `latestRef` is always
 * the state React will render, so request numbers and the "was the select accepted"
 * check never read a stale render.
 *
 * Moments from the latest session state: the hook dispatches `checkpointsLoaded`
 * before `loadLineageCheckpoints()` resolves, but this component may not have
 * re-rendered with the new `sim.state` yet when the promise callback runs. So the
 * callback only stores the result (`loadResult` state). React renders that update
 * together with every update queued before it, including the hook's
 * `checkpointsLoaded`, so the effect that follows reads the new session state from
 * `simStateRef` (updated each render), builds the moments once and dispatches
 * `loadDone`. The list is then fixed until the next open.
 */
export function RewindPanel({ open, sim, rewindButtonRef, onClose }: RewindPanelProps) {
  const [panel, dispatch] = useReducer(rewindPanelReducer, initialRewindPanelState);
  const [loadResult, setLoadResult] = useState<{ request: number; ok: boolean } | null>(null);
  const latestRef = useRef<RewindPanelState>(initialRewindPanelState);
  const simStateRef = useRef(sim.state);
  simStateRef.current = sim.state;
  const actionsRef = useRef(sim.actions);
  actionsRef.current = sim.actions;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const mountedRef = useRef(false);
  /** True after a successful fork until the next open; suppresses the focus return. */
  const forkedRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const send = useCallback((event: RewindPanelEvent): RewindPanelState => {
    const next = rewindPanelReducer(latestRef.current, event);
    latestRef.current = next;
    dispatch(event);
    return next;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Open: start a load. Close (open becomes false): make in-flight results stale.
  useEffect(() => {
    if (!open) {
      if (latestRef.current.status !== 'closed') send({ type: 'close' });
      return;
    }
    forkedRef.current = false;
    const { request } = send({ type: 'open' });
    const finish = (ok: boolean) => {
      if (!mountedRef.current) return;
      const now = latestRef.current;
      if (now.status !== 'loading' || now.request !== request) return;
      setLoadResult({ request, ok });
    };
    actionsRef.current.loadLineageCheckpoints().then(
      (outcome) => finish(outcome === 'ok'),
      () => finish(false),
    );
  }, [open, send]);

  // Build the moments after the render that holds the load result (see the comment above).
  useEffect(() => {
    if (loadResult === null) return;
    setLoadResult(null);
    const { request, ok } = loadResult;
    const state = simStateRef.current;
    const moments = ok ? buildRewindMoments(state, state.caseData?.interventions ?? []) : [];
    send({ type: 'loadDone', request, ok, moments });
  }, [loadResult, send]);

  const handleClose = useCallback(() => {
    send({ type: 'close' });
    onCloseRef.current();
  }, [send]);

  const handleSelect = useCallback(
    (moment: RewindMoment) => {
      if (!acceptsSelection(latestRef.current)) return;
      const { request } = send({ type: 'select' });
      const finish = (ok: boolean) => {
        if (!mountedRef.current) return;
        const now = latestRef.current;
        if (now.status !== 'forking' || now.request !== request) return;
        // Set before the 'closed' render so the focus trap's cleanup sees it.
        if (ok) forkedRef.current = true;
        send({ type: 'forkDone', request, ok });
        if (ok) onCloseRef.current();
      };
      actionsRef.current.fork(moment.checkpointId, moment.simulationTime).then(
        (outcome) => finish(outcome === 'ok'),
        () => finish(false),
      );
    },
    [send],
  );

  // useFocusTrap resolves `returnFocusTo` only in its cleanup, when the trap deactivates.
  // This stable ref-like object reads `forkedRef` at that moment, so focus goes back to the
  // Rewind button on Close or Escape but not after a successful fork, whatever the render order.
  const returnFocusTo = useMemo<RefObject<HTMLElement>>(
    () => ({
      get current() {
        return forkedRef.current ? null : rewindButtonRef.current;
      },
    }),
    [rewindButtonRef],
  );

  const status = panel.status;
  useFocusTrap(containerRef, { active: open && status !== 'closed', onEscape: handleClose, returnFocusTo });

  if (!open || status === 'closed') return null;
  return (
    <RewindPanelBody
      status={status}
      moments={panel.moments}
      onSelect={handleSelect}
      onClose={handleClose}
      containerRef={containerRef}
    />
  );
}
