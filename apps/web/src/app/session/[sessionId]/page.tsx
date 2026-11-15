/**
 * Main simulation view - bedside monitor.
 */

'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import { VitalSigns, CaseData, PlaybackSpeed, CheckpointMetadata, BranchMetadata, SessionMetadata } from '@/types';
import { VitalSign } from '@/components/VitalSign';
import { VitalsTrendChart } from '@/components/VitalsTrendChart';
import { PlaybackControls } from '@/components/PlaybackControls';
import { InterventionPanel } from '@/components/InterventionPanel';
import { Timeline } from '@/components/Timeline';
import { getAlarmState } from '@/lib/alarms';

export default function SessionPage() {
  const params = useParams();
  const sessionId = params.sessionId as string;

  const [caseData, setCaseData] = useState<CaseData | null>(null);
  const [sessionMetadata, setSessionMetadata] = useState<SessionMetadata | null>(null);
  const [vitals, setVitals] = useState<VitalSigns | null>(null);
  const [vitalsHistory, setVitalsHistory] = useState<VitalSigns[]>([]);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<PlaybackSpeed>('1x');
  const [checkpoints, setCheckpoints] = useState<CheckpointMetadata[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);

  // Load case data and session metadata
  useEffect(() => {
    const loadData = async () => {
      try {
        const [caseResp, sessionResp] = await Promise.all([
          api.getCaseData(sessionId),
          api.getSession(sessionId),
        ]);
        setCaseData(caseResp);
        setSessionMetadata(sessionResp);
        
        // Load checkpoints for current branch
        const checkpointsResp = await api.getCheckpoints(sessionId, sessionResp.current_branch_id);
        setCheckpoints(checkpointsResp);
      } catch (err: any) {
        setError(err.message || 'Failed to load session');
      }
    };

    loadData();
  }, [sessionId]);

  // Reload checkpoints when branch changes
  useEffect(() => {
    if (!sessionMetadata) return;

    const reloadCheckpoints = async () => {
      try {
        const checkpointsResp = await api.getCheckpoints(sessionId, sessionMetadata.current_branch_id);
        setCheckpoints(checkpointsResp);
      } catch (err) {
        console.error('Failed to reload checkpoints:', err);
      }
    };

    reloadCheckpoints();
  }, [sessionId, sessionMetadata?.current_branch_id]);

  // WebSocket connection for vitals stream
  useEffect(() => {
    const ws = api.connectVitalsStream(sessionId);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      setError(null);
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        
        if (data.error) {
          setError(data.error);
          return;
        }

        setVitals(data);
        setVitalsHistory((prev) => {
          const newHistory = [...prev, data];
          // Keep last 5 minutes at 1 Hz = 300 points
          return newHistory.slice(-300);
        });
      } catch (err) {
        console.error('Failed to parse vitals:', err);
      }
    };

    ws.onerror = (event) => {
      setError('WebSocket error - connection lost');
      setConnected(false);
    };

    ws.onclose = () => {
      setConnected(false);
    };

    return () => {
      ws.close();
    };
  }, [sessionId]);

  const handlePlayPause = useCallback(async () => {
    try {
      const newPlaying = !playing;
      await api.controlPlayback(sessionId, newPlaying, undefined);
      setPlaying(newPlaying);
    } catch (err) {
      console.error('Failed to control playback:', err);
    }
  }, [sessionId, playing]);

  const handleSpeedChange = useCallback(async (newSpeed: PlaybackSpeed) => {
    try {
      await api.controlPlayback(sessionId, undefined, newSpeed);
      setSpeed(newSpeed);
    } catch (err) {
      console.error('Failed to change speed:', err);
    }
  }, [sessionId]);

  const handleIntervention = useCallback(async (interventionId: string) => {
    try {
      await api.applyIntervention(sessionId, interventionId);
      
      // Reload session metadata and checkpoints
      const [sessionResp, checkpointsResp] = await Promise.all([
        api.getSession(sessionId),
        api.getCheckpoints(sessionId, sessionMetadata?.current_branch_id || ''),
      ]);
      setSessionMetadata(sessionResp);
      setCheckpoints(checkpointsResp);
    } catch (err: any) {
      setError(err.message || 'Failed to apply intervention');
    }
  }, [sessionId, sessionMetadata?.current_branch_id]);

  const handleFork = useCallback(async (checkpointId: string) => {
    try {
      const newBranch = await api.forkBranch(sessionId, checkpointId, 'User fork');
      
      // Reload session metadata and checkpoints for new branch
      const [sessionResp, checkpointsResp] = await Promise.all([
        api.getSession(sessionId),
        api.getCheckpoints(sessionId, newBranch.branch_id),
      ]);
      setSessionMetadata(sessionResp);
      setCheckpoints(checkpointsResp);
      
      // Clear vitals history when forking
      setVitalsHistory([]);
    } catch (err: any) {
      setError(err.message || 'Failed to fork branch');
    }
  }, [sessionId]);

  if (!caseData || !sessionMetadata) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="text-xl mb-2">Loading session...</div>
          {error && <div className="text-red-400 text-sm">{error}</div>}
        </div>
      </main>
    );
  }

  if (!connected) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="text-xl mb-2">Connecting to simulation...</div>
          {error && <div className="text-red-400 text-sm mt-2">{error}</div>}
        </div>
      </main>
    );
  }

  const currentVitals = vitals || {
    simulation_time: 0,
    heart_rate: 0,
    respiratory_rate: 0,
    spo2: 0,
    mean_arterial_pressure: 0,
    etco2: 0,
    tidal_volume: 0,
  };

  return (
    <main className="min-h-screen p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{caseData.title}</h1>
          <p className="text-sm text-gray-400">
            {caseData.patient.age}yo {caseData.patient.sex} • {caseData.patient.summary}
          </p>
        </div>
        <div className="text-xs text-yellow-500 bg-yellow-500/10 px-3 py-2 rounded">
          ⚠️ Educational simulation, not for clinical use
        </div>
      </div>

      {error && (
        <div className="p-3 bg-red-500/10 border border-red-500 rounded text-red-400">
          {error}
        </div>
      )}

      {/* Playback Controls */}
      <PlaybackControls
        playing={playing}
        speed={speed}
        simulationTime={currentVitals.simulation_time}
        onPlayPause={handlePlayPause}
        onSpeedChange={handleSpeedChange}
      />

      {/* Main content grid */}
      <div className="grid grid-cols-12 gap-6">
        {/* Vital signs - 8 columns */}
        <div className="col-span-8 space-y-6">
          {/* Primary vitals */}
          <div className="grid grid-cols-3 gap-4">
            <VitalSign
              label="Heart Rate"
              value={currentVitals.heart_rate}
              unit="bpm"
              alarmState={getAlarmState(currentVitals.heart_rate, caseData.alarms.heartRate)}
            />
            <VitalSign
              label="SpO₂"
              value={currentVitals.spo2 * 100}
              unit="%"
              decimals={1}
              alarmState={getAlarmState(currentVitals.spo2, caseData.alarms.spO2)}
            />
            <VitalSign
              label="MAP"
              value={currentVitals.mean_arterial_pressure}
              unit="mmHg"
              alarmState={getAlarmState(currentVitals.mean_arterial_pressure, caseData.alarms.meanArterialPressure)}
            />
          </div>

          {/* Secondary vitals */}
          <div className="grid grid-cols-3 gap-4">
            <VitalSign
              label="Resp Rate"
              value={currentVitals.respiratory_rate}
              unit="br/min"
              alarmState={getAlarmState(currentVitals.respiratory_rate, caseData.alarms.respiratoryRate)}
            />
            <VitalSign
              label="EtCO₂"
              value={currentVitals.etco2}
              unit="mmHg"
              alarmState={caseData.alarms.etCO2 ? getAlarmState(currentVitals.etco2, caseData.alarms.etCO2) : 'normal'}
            />
            <VitalSign
              label="Tidal Volume"
              value={currentVitals.tidal_volume}
              unit="mL"
              alarmState={caseData.alarms.tidalVolume ? getAlarmState(currentVitals.tidal_volume, caseData.alarms.tidalVolume) : 'normal'}
            />
          </div>

          {/* Trend chart */}
          {vitalsHistory.length > 0 && <VitalsTrendChart history={vitalsHistory} />}
        </div>

        {/* Right sidebar - 4 columns */}
        <div className="col-span-4 space-y-6">
          <InterventionPanel
            interventions={caseData.interventions}
            onApply={handleIntervention}
            disabled={!connected}
          />

          <Timeline
            branches={sessionMetadata.branches}
            currentBranchId={sessionMetadata.current_branch_id}
            checkpoints={checkpoints}
            onFork={handleFork}
          />
        </div>
      </div>
    </main>
  );
}
