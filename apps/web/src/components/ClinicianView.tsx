/**
 * Clinician_View: the bedside monitor (play-mode design "ClinicianView").
 *
 * Reads all data and actions from the `useSimulationSession` result and makes
 * no API call of its own. The safety notice is not part of this view; the
 * page shows `SafetyNotice` above both views.
 */

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getAlarmState } from '@/lib/alarms';
import type { SessionUiState } from '@/lib/sessionState';
import type { SimulationSession } from '@/hooks/useSimulationSession';
import type { AlarmState, AlarmThreshold, CheckpointMetadata } from '@/types';
import { EndingBanner } from './EndingBanner';
import { InterventionPanel } from './InterventionPanel';
import { PlaybackControls } from './PlaybackControls';
import { Timeline } from './Timeline';
import { VitalSign } from './VitalSign';
import { VitalsTrendChart } from './VitalsTrendChart';

export const CASE_NOT_LOADED_TEXT = 'The case could not be loaded.';
export const ACTION_ERROR_TEXT = "That didn't work. Please try again.";
export const PAUSE_FAILED_TEXT = 'The simulation could not be paused.';

/** Result of an Intervention or fork request from this view; 'skipped' means no request was sent. */
export type ActionOutcome = 'ok' | 'error' | 'skipped';

const NO_CHECKPOINTS: CheckpointMetadata[] = [];

/** Checkpoints of the current Branch, or `[]` when not loaded. */
export function currentCheckpoints(state: SessionUiState): CheckpointMetadata[] {
  if (state.currentBranchId === null) return NO_CHECKPOINTS;
  return state.checkpointsByBranch[state.currentBranchId] ?? NO_CHECKPOINTS;
}

/** Simulation_Time of a Checkpoint of the current Branch, or undefined when not found. */
export function forkTimeFor(state: SessionUiState, checkpointId: string): number | undefined {
  return currentCheckpoints(state).find((c) => c.checkpoint_id === checkpointId)?.simulation_time;
}

/** Intervention buttons are disabled while not connected or while a request from this view is pending. */
export function interventionsDisabled(connected: boolean, pending: boolean): boolean {
  return !connected || pending;
}

/**
 * Forks at a Checkpoint of the current Branch, chosen on the Timeline. Calls
 * `fork(checkpointId, simulation_time)` only when the Checkpoint is found and
 * returns whether it did.
 */
export function forkFromTimeline(
  state: SessionUiState,
  fork: (checkpointId: string, forkTime: number) => unknown,
  checkpointId: string,
): boolean {
  const forkTime = forkTimeFor(state, checkpointId);
  if (forkTime === undefined) return false;
  void fork(checkpointId, forkTime);
  return true;
}

/**
 * Forks at a Checkpoint of the current Branch, chosen on the Timeline, and
 * waits for the result. Returns 'skipped' without calling `fork` when the
 * Checkpoint is not in the current Branch's list; otherwise the outcome of
 * `fork(checkpointId, simulation_time)`, or 'error' when it throws.
 */
export async function runTimelineFork(
  state: SessionUiState,
  fork: (checkpointId: string, forkTime: number) => Promise<'ok' | 'error'>,
  checkpointId: string,
): Promise<ActionOutcome> {
  const forkTime = forkTimeFor(state, checkpointId);
  if (forkTime === undefined) return 'skipped';
  try {
    return await fork(checkpointId, forkTime);
  } catch {
    return 'error';
  }
}

/** Whether the action error box shows after an outcome: set on 'error', cleared on 'ok', unchanged on 'skipped'. */
export function nextActionError(previous: boolean, outcome: ActionOutcome): boolean {
  if (outcome === 'error') return true;
  if (outcome === 'ok') return false;
  return previous;
}

export interface ClinicianViewProps {
  sim: Pick<SimulationSession, 'state' | 'actions' | 'notices'>;
}

export function ClinicianView({ sim }: ClinicianViewProps) {
  const { state, actions, notices } = sim;
  const { caseData, latestSample } = state;
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState(false);

  // State updates after an awaited request are skipped once the view is gone.
  const mountedRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const recordOutcome = useCallback((outcome: ActionOutcome) => {
    if (!mountedRef.current) return;
    setActionError((previous) => nextActionError(previous, outcome));
  }, []);

  const handleIntervention = useCallback(
    async (id: string) => {
      setPending(true);
      let outcome: ActionOutcome = 'error';
      try {
        outcome = await actions.applyIntervention(id);
      } catch {
        outcome = 'error';
      } finally {
        if (mountedRef.current) setPending(false);
      }
      recordOutcome(outcome);
    },
    [actions, recordOutcome],
  );

  const handleFork = useCallback(
    async (checkpointId: string) => {
      recordOutcome(await runTimelineFork(state, actions.fork, checkpointId));
    },
    [state, actions, recordOutcome],
  );

  // Alarm colours need the case's thresholds and a real sample; otherwise the
  // readouts are neutral, so a missing value never reads as an alarm (1.11).
  const alarms = caseData !== null && latestSample !== null ? caseData.alarms : null;
  const alarmFor = (value: number, threshold: AlarmThreshold | undefined): AlarmState | undefined => {
    if (alarms === null) return undefined;
    return threshold ? getAlarmState(value, threshold) : 'normal';
  };

  const v = latestSample ?? {
    simulation_time: 0,
    heart_rate: 0,
    respiratory_rate: 0,
    spo2: 0,
    mean_arterial_pressure: 0,
    etco2: 0,
    tidal_volume: 0,
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      {caseData !== null && (
        <div>
          <h1 className="text-2xl font-bold">{caseData.title}</h1>
          <p className="text-sm text-gray-400">
            {caseData.patient.age}yo {caseData.patient.sex} • {caseData.patient.summary}
          </p>
        </div>
      )}

      {notices.streamError && (
        <div className="p-3 bg-red-500/10 border border-red-500 rounded text-red-400">
          {notices.streamError}
        </div>
      )}

      {actionError && (
        <div role="alert" className="p-3 bg-red-500/10 border border-red-500 rounded text-red-400">
          {ACTION_ERROR_TEXT}
        </div>
      )}

      {notices.pauseFailed && (
        <p role="status" className="p-3 bg-gray-800 border border-gray-700 rounded text-gray-300">
          {PAUSE_FAILED_TEXT}
        </p>
      )}

      <EndingBanner ending={state.ending.ending} onSelectView={actions.selectView} />

      <PlaybackControls
        playing={state.playing}
        speed={state.speed}
        simulationTime={latestSample?.simulation_time ?? 0}
        onPlayPause={() => void actions.setPlaying(!state.playing)}
        onSpeedChange={(speed) => void actions.setSpeed(speed)}
      />

      <div className="grid grid-cols-12 gap-6">
        <div className="col-span-8 space-y-6">
          <div className="grid grid-cols-3 gap-4">
            <VitalSign
              label="Heart Rate"
              value={v.heart_rate}
              unit="bpm"
              alarmState={alarmFor(v.heart_rate, alarms?.heartRate)}
            />
            <VitalSign
              label="SpO₂"
              value={v.spo2 * 100}
              unit="%"
              decimals={1}
              alarmState={alarmFor(v.spo2, alarms?.spO2)}
            />
            <VitalSign
              label="MAP"
              value={v.mean_arterial_pressure}
              unit="mmHg"
              alarmState={alarmFor(v.mean_arterial_pressure, alarms?.meanArterialPressure)}
            />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <VitalSign
              label="Resp Rate"
              value={v.respiratory_rate}
              unit="br/min"
              alarmState={alarmFor(v.respiratory_rate, alarms?.respiratoryRate)}
            />
            <VitalSign label="EtCO₂" value={v.etco2} unit="mmHg" alarmState={alarmFor(v.etco2, alarms?.etCO2)} />
            <VitalSign
              label="Tidal Volume"
              value={v.tidal_volume}
              unit="mL"
              alarmState={alarmFor(v.tidal_volume, alarms?.tidalVolume)}
            />
          </div>

          {state.history.length > 0 && <VitalsTrendChart history={state.history} />}
        </div>

        <div className="col-span-4 space-y-6">
          {caseData !== null ? (
            <InterventionPanel
              interventions={caseData.interventions}
              onApply={(id) => void handleIntervention(id)}
              disabled={interventionsDisabled(state.connected, pending)}
            />
          ) : (
            state.caseStatus === 'failed' && (
              <div className="bg-gray-800 p-4 rounded-lg border border-gray-700">
                <p className="text-gray-300">{CASE_NOT_LOADED_TEXT}</p>
              </div>
            )
          )}

          <Timeline
            branches={state.session?.branches ?? []}
            currentBranchId={state.currentBranchId ?? ''}
            checkpoints={currentCheckpoints(state)}
            onFork={(checkpointId) => void handleFork(checkpointId)}
          />
        </div>
      </div>
    </div>
  );
}
