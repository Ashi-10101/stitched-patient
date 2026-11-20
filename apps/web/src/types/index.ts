/**
 * Type definitions for Stitched Patient web application.
 */

import type { VitalName } from '@/lib/vitals';

export type { VitalName };

export type AlarmState = 'normal' | 'warning' | 'critical';

export type PlaybackSpeed = '1x' | '2x' | '4x';

export interface VitalSigns {
  simulation_time: number;
  heart_rate: number;
  respiratory_rate: number;
  spo2: number;
  mean_arterial_pressure: number;
  systolic_pressure?: number;
  diastolic_pressure?: number;
  etco2: number;
  tidal_volume: number;
}

export interface AlarmThreshold {
  critical?: {
    low?: number;
    high?: number;
  };
  warning?: {
    low?: number;
    high?: number;
  };
  normal?: {
    low: number;
    high: number;
  };
}

export interface AlarmThresholds {
  heartRate: AlarmThreshold;
  respiratoryRate: AlarmThreshold;
  spO2: AlarmThreshold;
  meanArterialPressure: AlarmThreshold;
  etCO2?: AlarmThreshold;
  tidalVolume?: AlarmThreshold;
}

export interface Intervention {
  id: string;
  label: string;
  /** Plain-language label shown in Play mode; falls back to `label`. */
  playLabel?: string;
  action: string;
  parameters?: Record<string, any>;
}

export interface InterventionEvent {
  simulation_time: number;
  wall_clock_time: string;
  intervention_id: string;
  parameters: Record<string, any>;
}

export interface CheckpointMetadata {
  checkpoint_id: string;
  simulation_time: number;
  created_at: string;
  is_automatic: boolean;
  description?: string;
}

export interface BranchMetadata {
  branch_id: string;
  parent_branch_id?: string;
  forked_from_checkpoint?: string;
  created_at: string;
  event_count: number;
}

export interface SessionMetadata {
  session_id: string;
  case_id: string;
  created_at: string;
  current_branch_id: string;
  branches: BranchMetadata[];
}

export interface CaseData {
  id: string;
  title: string;
  patient: {
    age: number;
    sex: string;
    summary: string;
  };
  timeline: {
    scheduledInsults: ScheduledInsult[];
  };
  alarms: AlarmThresholds;
  interventions: Intervention[];
  play?: PlaySection;
  references: Array<{
    citation: string;
    url?: string;
  }>;
}

export interface PlaybackState {
  playing: boolean;
  speed: PlaybackSpeed;
  simulation_time: number;
}

// ---------------------------------------------------------------------------
// Play mode
// ---------------------------------------------------------------------------

export type Side = 'Left' | 'Right';
export type ComparisonOp = '<' | '<=' | '>=' | '>';

export interface VitalCondition {
  vital: VitalName;
  op: ComparisonOp;
  value: number;
}

export interface ConditionGroup {
  conditions: VitalCondition[];
  holdSeconds: number;
}

export interface StatusWhen {
  vital: VitalName;
  band: AlarmState;
  direction?: 'low' | 'high';
}

export interface StatusRule {
  when: StatusWhen[];
  sentence: string;
}

export interface Hint {
  text: string;
  references?: string[];
}

export interface PlaySection {
  goalText: string;
  diagnosisTerms: string[];
  avatar?: { referenceTidalVolumeMl?: number };
  endings: {
    rescued: ConditionGroup & { references?: string[] };
    lost: { groups?: ConditionGroup[]; timeLimitSeconds?: number; references?: string[] };
  };
  hints: Hint[];
  status: { rules: StatusRule[]; defaultSentence: string };
  references?: string[];
}

export interface ScheduledInsult {
  timeSeconds: number;
  action: string;
  parameters: {
    side?: Side;
    type?: 'Closed' | 'Open';
    severity?: number;
    [k: string]: unknown;
  };
}

export interface VitalBand {
  state: AlarmState;
  direction: 'low' | 'high' | 'none';
}

export interface AvatarParameters {
  skinTone: 'healthy' | 'pale' | 'cyanotic';
  /** depth in [0.25, 1.75] */
  breathing: { stopped: boolean; periodS: number; depth: number };
  heartbeat: { stopped: boolean; periodS: number };
  sweating: boolean;
  /** sorted, unique */
  swollenSides: Side[];
  /** sorted, unique */
  decompressedSides: Side[];
  overallStatus: AlarmState;
  /** only vitals with thresholds */
  bands: Partial<Record<VitalName, VitalBand>>;
}

export interface InterventionRecordEntry {
  interventionId: string;
  action: string;
  side?: Side;
  simulationTime: number;
  branchId: string;
}

export interface HintRecordEntry {
  /** 1-based */
  hintIndex: number;
  branchId: string;
  simulationTime: number;
  /** ISO 8601, passed in by the hook */
  wallClockTime: string;
}

export interface LineageSegment {
  branchId: string;
  upperBound: number;
  forkCheckpointId?: string;
  forkTime?: number;
}

export interface RewindMoment {
  checkpointId: string;
  simulationTime: number;
  label: string;
}
