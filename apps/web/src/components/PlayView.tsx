/**
 * Play_View (play-mode design "Play view"; Requirements 5.1, 7.2, 7.7, 7.11,
 * 8.1–8.3, 8.7–8.11, 10.1, 11.2, 11.3, 11.7–11.9).
 *
 * Reads all data and actions from the `useSimulationSession` result and makes
 * no API call of its own. The Safety_Notice and the View_Switcher are not part
 * of this view; the page shows them above it.
 *
 * DOM order equals the visual and focus order: playback controls, the patient
 * column (Avatar, status line), then the action column (goal, "What can you
 * do?", Intervention buttons, Hint button with the revealed Hints, Rewind
 * button). No element sets a tabindex.
 *
 * Layout at widths >= 1024 px (`lg:`): the view fills the height below the
 * Safety_Notice with `overflow: hidden` and two columns. Below 1024 px the
 * columns stack and the page scrolls. Arithmetic for 1280 x 720 (notice
 * 3.5rem = 56 px, so 664 px below it):
 *
 * - Fixed rows: py-2 (16) + playback controls (p-4 32 + 1 px borders 2 +
 *   40 px play button = 74) + gap-2 (8), leaving 566 px for the columns.
 * - Patient column: Avatar width (664 - 168 - 136) * 200 / 280 = 257 px, so the
 *   Avatar is 136 (speech band) + 360 (drawing) = 496 px; StatusLine mt-3 (12)
 *   + two text-lg lines (49.5) = 61.5; total 557.5 <= 566.
 * - Action column (columns 2fr / 3fr, so about 734 px wide), gap-2 (8):
 *   GoalBar 56.75 + heading 28 + InterventionPanel (play variant, two disabled
 *   buttons: 2 x (border 4 + py-2 16 + two 24 px lines) 68 + gap 8 = 144)
 *   + Hint row 171 (Hint button 44 + 12 + three Hints in at most four
 *   full-width lines 115) + 3 gaps 24 = 423.75 <= 566. With the buttons enabled
 *   each is 44, the panel 96 and the column 375.75.
 */

'use client';

import { useCallback, useMemo, useReducer, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { SimulationSession, SimulationSessionActions } from '@/hooks/useSimulationSession';
import type { Ending } from '@/lib/endingEvaluator';
import { playButtonText } from '@/lib/playCase';
import { EndingScreen } from './EndingScreen';
import { GoalBar } from './GoalBar';
import { HintPanel } from './HintPanel';
import { InterventionPanel, NOT_AVAILABLE_TEXT } from './InterventionPanel';
import { PlaybackControls } from './PlaybackControls';
import { RewindPanel } from './RewindPanel';
import { StatusLine } from './StatusLine';
import { SPEECH_BAND_HEIGHT, StitchedPatient } from './StitchedPatient';
import { Toast } from './Toast';

export { NOT_AVAILABLE_TEXT };

export const WHAT_CAN_YOU_DO_TEXT = 'What can you do?';
export const REWIND_BUTTON_TEXT = 'Rewind';
export const INTERVENTION_ERROR_TEXT = "That didn't work. Please try again.";
export const PAUSE_FAILED_TEXT = 'The simulation could not be paused.';
export const STREAM_STOPPED_TEXT = 'The simulation stopped. Please reload the page.';

/** Success toast for an applied Intervention, "Done: <button text>." (8.7). */
export function interventionDoneText(buttonText: string): string {
  return `Done: ${buttonText}.`;
}

export interface InterventionsDisabledInput {
  connected: boolean;
  interventionPending: boolean;
  forkPending: boolean;
  ending: Ending;
}

/**
 * Intervention buttons are disabled while the Vitals_Stream is not connected,
 * while an Intervention or fork request from this view is pending, and while
 * there is an Ending (7.7, 8.9, 8.10).
 */
export function interventionsDisabled({
  connected,
  interventionPending,
  forkPending,
  ending,
}: InterventionsDisabledInput): boolean {
  return !connected || interventionPending || forkPending || ending !== 'none';
}

/**
 * Height in the patient column that is not the Avatar (see the file comment):
 * py-2 (1rem) + playback controls (4.625rem) + gap-2 (0.5rem) + StatusLine
 * (0.75rem + two text-lg lines, 3.09rem) = 9.97rem, rounded up to 10.5rem.
 */
const PATIENT_OVERHEAD = '10.5rem';

/**
 * Avatar width at lg: the height left for the drawing (aspect 200 x 280) after
 * the overhead and the Avatar's own speech band, capped at 28rem (the Avatar's
 * max-w-md) and at the column width. Below lg the page scrolls, so the width is
 * simply min(100%, 20rem).
 */
const AVATAR_WRAPPER_STYLE = {
  '--sp-avatar-w-lg': `min(100%, 28rem, calc((100vh - var(--notice-h) - ${PATIENT_OVERHEAD} - ${SPEECH_BAND_HEIGHT}) * 200 / 280))`,
} as CSSProperties;

const REWIND_BUTTON_CLASS =
  'inline-flex items-center gap-2 rounded-lg border-2 border-[var(--sp-accent)] px-4 py-2 text-base font-semibold text-[var(--sp-text)] hover:bg-[var(--sp-accent)] hover:text-[var(--sp-bg)]';

const NOTICE_CLASS =
  'rounded-lg border-2 border-[var(--sp-accent)] bg-[var(--sp-bg)] px-4 py-3 text-base font-semibold text-[var(--sp-text)] shadow-lg';

export interface PlayViewProps {
  sim: Pick<SimulationSession, 'state' | 'statusSentence' | 'actions' | 'notices'>;
  /**
   * Optional content at the start of the playback-controls row (e.g. the
   * View_Switcher). When given, it and the playback controls share one flex
   * row; when absent, the playback controls render exactly as before.
   */
  toolbarStart?: ReactNode;
}

/** Which Rewind button opened the Rewind_Panel. */
export type RewindOrigin = 'view' | 'ending';

/**
 * Whether the Rewind_Panel is open and which button opened it. `origin` is kept
 * on close, so the render that closes the panel still hands it the opener's
 * ref and focus returns to that button (not to the main one behind the
 * Ending_Screen).
 */
export interface RewindOpenerState {
  open: boolean;
  origin: RewindOrigin;
}

export type RewindOpenerEvent = { type: 'open'; origin: RewindOrigin } | { type: 'close' };

export const initialRewindOpener: RewindOpenerState = { open: false, origin: 'view' };

/** Pure: 'open' sets open and the origin; 'close' clears open and keeps the origin. */
export function rewindPanelOpenerReducer(state: RewindOpenerState, event: RewindOpenerEvent): RewindOpenerState {
  switch (event.type) {
    case 'open':
      return { open: true, origin: event.origin };
    case 'close':
      return state.open ? { open: false, origin: state.origin } : state;
    default:
      return state;
  }
}

interface ToastMessage {
  id: number;
  message: string;
}

export function PlayView({ sim, toolbarStart }: PlayViewProps) {
  const { state, actions, notices } = sim;
  const [interventionPending, setInterventionPending] = useState(false);
  const [forkPending, setForkPending] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const toastIdRef = useRef(0);
  const [opener, dispatchOpener] = useReducer(rewindPanelOpenerReducer, initialRewindOpener);
  const rewindButtonRef = useRef<HTMLButtonElement>(null);
  const endingRewindButtonRef = useRef<HTMLButtonElement>(null);

  const showToast = useCallback((message: string) => {
    toastIdRef.current += 1;
    setToast({ id: toastIdRef.current, message });
  }, []);
  const closeToast = useCallback(() => setToast(null), []);

  const handleIntervention = useCallback(
    async (id: string) => {
      const intervention = state.caseData?.interventions.find((i) => i.id === id);
      setInterventionPending(true);
      let outcome: 'ok' | 'error' = 'error';
      try {
        outcome = await actions.applyIntervention(id);
      } catch {
        outcome = 'error';
      } finally {
        setInterventionPending(false);
      }
      if (outcome === 'ok' && intervention !== undefined) {
        showToast(interventionDoneText(playButtonText(intervention)));
      } else {
        showToast(INTERVENTION_ERROR_TEXT);
      }
    },
    [state.caseData, actions, showToast],
  );

  // The Rewind_Panel calls `actions.fork` itself; wrapping it makes the pending
  // fork visible here, so the Intervention buttons are disabled meanwhile (8.10).
  const fork = useCallback<SimulationSessionActions['fork']>(
    async (checkpointId, forkTime) => {
      setForkPending(true);
      try {
        return await actions.fork(checkpointId, forkTime);
      } finally {
        setForkPending(false);
      }
    },
    [actions],
  );
  const rewindActions = useMemo<SimulationSessionActions>(() => ({ ...actions, fork }), [actions, fork]);
  const rewindSim = useMemo(() => ({ state, actions: rewindActions }), [state, rewindActions]);

  const openRewindFromView = useCallback(() => dispatchOpener({ type: 'open', origin: 'view' }), []);
  const openRewindFromEnding = useCallback(() => dispatchOpener({ type: 'open', origin: 'ending' }), []);
  const closeRewind = useCallback(() => dispatchOpener({ type: 'close' }), []);
  const showMonitor = useCallback(() => actions.selectView('clinician'), [actions]);

  const caseData = state.caseData;
  const play = caseData?.play;
  if (caseData === null || play === undefined) return null;

  const statusSentence = sim.statusSentence ?? play.status.defaultSentence;
  const latestTime = state.latestSample?.simulation_time ?? null;
  const ending = state.ending.ending;
  const disabled = interventionsDisabled({
    connected: state.connected,
    interventionPending,
    forkPending,
    ending,
  });
  const streamStopped = notices.streamError !== null && notices.streamError !== '' && !state.connected;

  const playbackControls = (
    <PlaybackControls
      variant="play"
      playing={state.playing}
      speed={state.speed}
      simulationTime={state.latestSample?.simulation_time ?? 0}
      onPlayPause={() => void actions.setPlaying(!state.playing)}
      onSpeedChange={(speed) => void actions.setSpeed(speed)}
    />
  );

  return (
    <div
      data-part="play-view"
      className="sp-play flex min-h-[calc(100vh-var(--notice-h))] flex-col gap-2 bg-[var(--sp-bg)] px-4 py-2 text-base text-[var(--sp-text)] lg:h-[calc(100vh-var(--notice-h))] lg:overflow-hidden"
    >
      {toolbarStart === undefined || toolbarStart === null ? (
        playbackControls
      ) : (
        <div data-part="play-toolbar" className="flex flex-wrap items-center gap-2">
          {toolbarStart}
          <div className="min-w-0 flex-1">{playbackControls}</div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div data-part="patient-column" className="flex min-w-0 flex-col">
          <div
            data-part="play-avatar"
            className="mx-auto w-[min(100%,20rem)] max-w-full lg:w-[var(--sp-avatar-w-lg)]"
            style={AVATAR_WRAPPER_STYLE}
          >
            <StitchedPatient params={state.avatar} statusSentence={statusSentence} variant="live" />
          </div>
          <StatusLine overallStatus={state.avatar.overallStatus} statusSentence={statusSentence} />
        </div>

        <div data-part="action-column" className="flex min-w-0 flex-col gap-2">
          <GoalBar goalText={play.goalText} timeLimitSeconds={play.endings.lost.timeLimitSeconds} latestTime={latestTime} />

          <h2 className="text-lg font-semibold">{WHAT_CAN_YOU_DO_TEXT}</h2>

          {/* Each disabled button shows "Not available right now" itself, at 1rem (11.8, 11.11). */}
          <div data-part="play-interventions">
            <InterventionPanel
              variant="play"
              interventions={caseData.interventions}
              onApply={(id) => void handleIntervention(id)}
              getLabel={playButtonText}
              disabled={disabled}
            />
          </div>

          {/* Hint button and Rewind button share a row with the same top (design layout).
              The Hint panel spans both columns of row 1 and the Rewind button sits in
              column 2 of the same row, so the revealed Hints, which start below the
              Hint button (44 px + gap 12 px, the Rewind button is 44 px), run under both
              buttons at full width. DOM and focus order stay Hint button, Hints, Rewind. */}
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 [&>[data-part=hint-panel]]:col-span-2 [&>[data-part=hint-panel]]:col-start-1 [&>[data-part=hint-panel]]:row-start-1">
            <HintPanel
              hints={play.hints}
              hintsRevealed={state.hintsRevealed}
              onReveal={actions.revealHint}
              noTopMargin
            />
            <button
              ref={rewindButtonRef}
              type="button"
              data-control="rewind"
              onClick={openRewindFromView}
              className={`col-start-2 row-start-1 ${REWIND_BUTTON_CLASS}`}
            >
              <span aria-hidden="true">⟲</span>
              <span>{REWIND_BUTTON_TEXT}</span>
            </button>
          </div>
        </div>
      </div>

      {/* One fixed stack, centred at the bottom, so the toast and the lasting notices
          never overlap. The Toast positions itself as fixed; inside the stack it is
          made static and its centring shift is cancelled. The toast sits above the
          notices, so the lasting notices stay put when a toast appears. */}
      {(toast !== null || notices.pauseFailed || streamStopped) && (
        <div
          data-part="play-messages"
          className="fixed bottom-6 left-1/2 z-50 flex w-max max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-col items-center gap-2 [&>[data-part=toast]]:static [&>[data-part=toast]]:translate-x-0"
        >
          {toast !== null && <Toast key={toast.id} message={toast.message} onClose={closeToast} />}
          {notices.pauseFailed && (
            <p role="status" className={NOTICE_CLASS}>
              {PAUSE_FAILED_TEXT}
            </p>
          )}
          {streamStopped && (
            <p role="status" className={NOTICE_CLASS}>
              {STREAM_STOPPED_TEXT}
            </p>
          )}
        </div>
      )}

      {ending !== 'none' && (
        <EndingScreen
          ending={ending}
          params={state.endingSnapshot ?? state.avatar}
          statusSentence={statusSentence}
          onRewind={openRewindFromEnding}
          onShowMonitor={showMonitor}
          rewindButtonRef={endingRewindButtonRef}
        />
      )}

      <RewindPanel
        open={opener.open}
        sim={rewindSim}
        rewindButtonRef={opener.origin === 'ending' ? endingRewindButtonRef : rewindButtonRef}
        onClose={closeRewind}
      />
    </div>
  );
}

export default PlayView;
