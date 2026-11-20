/**
 * Clinician_View: the bedside monitor (play-mode design "ClinicianView").
 *
 * Reads all data and actions from the `useSimulationSession` result and makes
 * no API call of its own. The safety notice is not part of this view; the
 * page shows `SafetyNotice` above both views.
 */

'use client';

import { useCallback, useState } from 'react';
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

export interface ClinicianViewProps {
  sim: Pick<SimulationSession, 'state' | 'actions' | 'notices'>;
}

export function ClinicianView({ sim }: ClinicianViewProps) {
  const { state, actions, notices } = sim;
  const { caseData, latestSample } = state;
  const [pending, setPending] = useState(false);

  const handleIntervention = useCallback(
    async (id: string) => {
      setPending(true);
      try {
        await actions.applyIntervention(id);
      } finally {
        setPending(false);
      }
    },
    [actions],
  );

  const handleFork = useCallback(
    (checkpointId: string) => {
      forkFromTimeline(state, actions.fork, checkpointId);
    },
    [state, actions],
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
            onFork={handleFork}
          />
        </div>
      </div>
    </div>
  );
}
