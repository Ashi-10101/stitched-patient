/**
 * Avatar_Mapper (play-mode Requirement 4, design "avatarMapper.ts").
 *
 * Pure function from one VitalSigns sample (plus case data and the previous
 * result) to Avatar_Parameters. Bands come from `getVitalBand` of the
 * Displayed_Value (`readDisplayedVital`, play-mode 15.16), sides from
 * `computeSides`, and rates and tidal volume are read raw with `readVital`. There is no
 * Playback_Speed input, so periods are wall-clock seconds and identical at
 * every speed (4.6, 4.10).
 */

import { computeSides, shownSwollenSides, type RevealedSides } from './sides';
import { getVitalBand, overallStatus, thresholdsFor } from './vitalBands';
import { VITAL_NAMES, readDisplayedVital, readVital } from './vitals';
import type {
  AlarmState,
  AlarmThresholds,
  AvatarParameters,
  InterventionRecordEntry,
  PlaySection,
  ScheduledInsult,
  VitalBand,
  VitalName,
  VitalSigns,
} from '@/types';

export type SkinTone = AvatarParameters['skinTone'];

// UI display constants, not clinical values.
export const BREATH_DEPTH_MIN = 0.25;
export const BREATH_DEPTH_MAX = 1.75;
export const BREATH_DEPTH_DEFAULT = 1.0;
/** Shown until a respiratory rate arrives. */
export const DEFAULT_BREATH_PERIOD_S = 4;
/** Shown until a heart rate arrives. */
export const DEFAULT_BEAT_PERIOD_S = 1;

export interface AvatarInput {
  sample: Partial<VitalSigns> & { simulation_time: number };
  alarms: AlarmThresholds;
  play: PlaySection;
  scheduledInsults: ScheduledInsult[];
  activeInterventions: InterventionRecordEntry[];
  /** Avatar_Parameters of the previous sample on the current Branch. */
  previous: AvatarParameters | null;
  /** Tidal volume of the first sample of the Session with TV > 0. */
  firstPositiveTidalVolumeMl: number | null;
  /**
   * Which Swollen_Sides may be drawn; `'all'` keeps play-mode behaviour.
   * Required, so no caller forgets the gate (bedside-exam 9.1).
   */
  revealedSides: RevealedSides;
}

const SKIN_TONE: Record<AlarmState, SkinTone> = {
  normal: 'healthy',
  warning: 'pale',
  critical: 'cyanotic',
};

const NORMAL_BAND: VitalBand = { state: 'normal', direction: 'none' };

const clamp = (x: number, min: number, max: number): number => Math.min(max, Math.max(min, x));

/** A usable reference volume: finite and greater than 0. */
const positive = (x: number | null | undefined): number | undefined =>
  typeof x === 'number' && Number.isFinite(x) && x > 0 ? x : undefined;

/**
 * Period and stopped flag for a rate (breaths or beats per minute).
 * Rate > 0 gives 60 / rate; rate <= 0 stops and keeps the previous period
 * (or the default); a missing rate keeps the previous value (or the default).
 */
function rhythm(
  rate: number | undefined,
  previous: { stopped: boolean; periodS: number } | undefined,
  defaultPeriodS: number,
): { stopped: boolean; periodS: number } {
  if (rate === undefined) {
    return previous
      ? { stopped: previous.stopped, periodS: previous.periodS }
      : { stopped: false, periodS: defaultPeriodS };
  }
  if (rate > 0) return { stopped: false, periodS: 60 / rate };
  return { stopped: true, periodS: previous?.periodS ?? defaultPeriodS };
}

/**
 * Breathing depth: tidal volume / reference, clamped to the display range.
 * Reference is `play.avatar.referenceTidalVolumeMl`, else the first positive
 * tidal volume; the default depth while neither exists. A missing tidal volume
 * keeps the previous depth (or the default). A reference that is not a finite
 * number above 0 counts as absent.
 */
function breathDepth(
  tidalVolume: number | undefined,
  input: AvatarInput,
): number {
  if (tidalVolume === undefined) return input.previous?.breathing.depth ?? BREATH_DEPTH_DEFAULT;
  const ref =
    positive(input.play.avatar?.referenceTidalVolumeMl) ??
    positive(input.firstPositiveTidalVolumeMl);
  if (ref === undefined) return BREATH_DEPTH_DEFAULT;
  return clamp(tidalVolume / ref, BREATH_DEPTH_MIN, BREATH_DEPTH_MAX);
}

export function mapAvatar(input: AvatarInput): AvatarParameters {
  const { sample, alarms, previous } = input;

  const bands: Partial<Record<VitalName, VitalBand>> = {};
  for (const vital of VITAL_NAMES) {
    const threshold = thresholdsFor(alarms, vital);
    if (threshold === undefined) continue;
    // Bands from the Displayed_Value (15.16); periods and depth below stay raw (D10).
    const value = readDisplayedVital(sample, vital);
    const kept = previous?.bands[vital];
    bands[vital] =
      value !== undefined ? getVitalBand(value, threshold) : { ...(kept ?? NORMAL_BAND) };
  }

  const breathing = rhythm(
    readVital(sample, 'respiratoryRate'),
    previous?.breathing,
    DEFAULT_BREATH_PERIOD_S,
  );
  const heartbeat = rhythm(readVital(sample, 'heartRate'), previous?.heartbeat, DEFAULT_BEAT_PERIOD_S);
  const depth = breathDepth(readVital(sample, 'tidalVolume'), input);

  const mapState = bands.meanArterialPressure?.state ?? 'normal';
  const hrState = bands.heartRate?.state ?? 'normal';

  const sides = computeSides(
    sample.simulation_time,
    input.scheduledInsults,
    input.activeInterventions,
  );

  return {
    skinTone: SKIN_TONE[bands.spO2?.state ?? 'normal'],
    breathing: { ...breathing, depth },
    heartbeat,
    sweating: mapState !== 'normal' || hrState === 'critical',
    // Only found sides are drawn swollen (bedside-exam 9.1); needles are ungated (9.3).
    swollenSides: shownSwollenSides(sides.swollenSides, input.revealedSides),
    decompressedSides: sides.decompressedSides,
    overallStatus: overallStatus(bands),
    bands,
  };
}
