/**
 * Type definitions for Stitched Patient web application.
 */

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
  normal: {
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
  alarms: AlarmThresholds;
  interventions: Intervention[];
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
