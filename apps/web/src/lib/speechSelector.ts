/**
 * Speech_Selector (patient-speech Requirements 4 and 5, design "speechSelector.ts").
 *
 * A pure fold step: from the latest VitalSigns sample, the Case_Definition, the
 * Ending, the Simulation_Time, the branch_id, the Rescue_Gate_Time and the
 * previous Speech_State it computes the next Speech_State. Every line comes
 * from the Speech_Section and is returned unchanged; this module never composes
 * text (4.5).
 *
 * Pure: reads no Wall_Clock_Time, network, storage or randomness, and no
 * Variant_Id, Affected_Side, Scheduled_Insult side, Intervention_Record or
 * Exam_Record (4.1, 8.2). The Status_Sentence comes from `selectStatus` (4.3);
 * the only read of the Scheduled_Insults is `earliestInsultTime`, which reads
 * their times only.
 */

import { earliestInsultTime, type Ending } from './endingEvaluator';
import { speechCheck } from './speechCheck';
import { selectStatus } from './statusSelector';
import type { CaseData, SpeechSection, VitalSigns } from '@/types';

/** UI display constants, not clinical values (decision 6, 5.10). */
export const SPEECH_HOLD_SECONDS = 10;
export const SPEECH_ROTATE_SECONDS = 30;

/** Speech_Key (D4): two Status_Rules with the same sentence share one entry. */
export type SpeechKey = 'silent' | 'early' | 'rescued' | `status:${string}`;

const STATUS_PREFIX = 'status:';

export interface SpeechState {
  branchId: string;
  key: SpeechKey;
  /** Line index in the key's list; 0 for silent. */
  index: number;
  /** Simulation_Time from which this line has shown. */
  since: number;
  /** The Speech_Line, or null for silence. */
  line: string | null;
}

export interface SpeechInput {
  sample: Partial<VitalSigns> | null;
  caseData: CaseData;
  ending: Ending;
  simulationTime: number;
  branchId: string;
  /** `-Infinity`: no Required_Interventions (always open); `null`: closed. */
  rescueGateTime: number | null;
  previous: SpeechState | null;
}

/** One step of `foldSpeech`, in the order the samples were accepted. */
export interface SpeechStep {
  sample: Partial<VitalSigns>;
  simulationTime: number;
  ending: Ending;
  rescueGateTime: number | null;
}

const NO_LINES: readonly string[] = [];

/** The Speech_Lines of a Speech_Key; `silent`, a missing list or no Speech_Section give []. */
export function speechLines(speech: SpeechSection | undefined, key: SpeechKey): readonly string[] {
  if (speech === undefined || key === 'silent') return NO_LINES;
  if (key === 'early') return speech.early ?? NO_LINES;
  if (key === 'rescued') return speech.rescued ?? NO_LINES;
  const sentence = key.slice(STATUS_PREFIX.length);
  return speech.status?.find((entry) => entry.sentence === sentence)?.lines ?? NO_LINES;
}

/** Target Speech_Key: the first rule of Requirement 4.2 that applies (design steps 1 to 7). */
export function targetSpeechKey(input: Omit<SpeechInput, 'branchId' | 'previous'>): SpeechKey {
  const { sample, caseData, ending, simulationTime, rescueGateTime } = input;
  const play = caseData.play;
  const speech = play?.speech;

  // 1. rescued Ending (decision 7).
  if (ending === 'rescued') return speechLines(speech, 'rescued').length > 0 ? 'rescued' : 'silent';
  // 2. lost Ending (decision 3).
  if (ending === 'lost') return 'silent';
  // 3. No sample, or no Speech_Section.
  if (sample === null || play === undefined || speech === undefined) return 'silent';
  // 4. Before the Earliest_Insult_Time (decision 2).
  const insultAt = earliestInsultTime(caseData);
  if (insultAt !== undefined && simulationTime < insultAt) return 'silent';
  // 5. A Status_Rule sentence: its Status_Speech_Entry, or silence (4.3).
  const sentence = selectStatus(sample, caseData.alarms, play);
  if (sentence !== play.status.defaultSentence) {
    return speech.status?.some((entry) => entry.sentence === sentence) ? `status:${sentence}` : 'silent';
  }
  // 6. The defaultSentence while the Rescue_Gate_Time is not open (decision 4).
  if (
    speechLines(speech, 'early').length > 0 &&
    (rescueGateTime === null || rescueGateTime > simulationTime)
  ) {
    return 'early';
  }
  // 7. Every other case.
  return 'silent';
}

/**
 * Next Speech_State: the target Speech_Key with the hold (5.1), the Ending
 * override (5.2), rotation (5.3) and Branch isolation (5.4). Returns
 * `input.previous` itself when nothing changes.
 */
export function selectSpeech(input: SpeechInput): SpeechState {
  const { caseData, ending, simulationTime: t, branchId, previous: prev } = input;
  const speech = caseData.play?.speech;
  const target = targetSpeechKey(input);

  const fresh = (key: SpeechKey): SpeechState => ({
    branchId,
    key,
    index: 0,
    since: t,
    line: speechLines(speech, key)[0] ?? null,
  });

  // 5.4: no previous state, another Branch, or a previous state from the future.
  if (prev === null || prev.branchId !== branchId || prev.since > t) return fresh(target);

  if (target !== prev.key) {
    // 5.2: an Ending overrides the hold.
    if (ending !== 'none') return fresh(target);
    // 5.1: held until the line has shown for SPEECH_HOLD_SECONDS.
    if (t - prev.since < SPEECH_HOLD_SECONDS) return prev;
    return fresh(target);
  }

  // 5.3: same key; rotate a list of two or more lines after SPEECH_ROTATE_SECONDS.
  const lines = speechLines(speech, prev.key);
  if (lines.length > 1 && t - prev.since >= SPEECH_ROTATE_SECONDS) {
    const next = (prev.index + 1) % lines.length;
    return { ...prev, index: next, since: t, line: lines[next] ?? null };
  }
  return prev;
}

/**
 * Fold of `selectSpeech` over ordered steps on one Branch, starting with no
 * previous Speech_State. Returns one Speech_State per step, in step order.
 * Used by the reducer tests and the Scenario_Runner.
 */
export function foldSpeech(
  caseData: CaseData,
  branchId: string,
  steps: readonly SpeechStep[],
): SpeechState[] {
  const states: SpeechState[] = [];
  let previous: SpeechState | null = null;
  for (const step of steps) {
    previous = selectSpeech({
      sample: step.sample,
      caseData,
      ending: step.ending,
      simulationTime: step.simulationTime,
      branchId,
      rescueGateTime: step.rescueGateTime,
      previous,
    });
    states.push(previous);
  }
  return states;
}

/** The Scripted_Line when it passes the Speech_Check, else null (4.7). */
export function checkedScriptedLine(state: SpeechState | null, caseData: CaseData | null): string | null {
  if (state === null || caseData === null || state.line === null) return null;
  return speechCheck(state.line, caseData).length === 0 ? state.line : null;
}

/**
 * Changes exactly when a Speech_Request is due (6.4, D7): on a change of the
 * current Branch, or of the Speech_State's branch_id, key, index or `since`.
 */
export function speechRequestKey(currentBranchId: string | null, state: SpeechState | null): string {
  return JSON.stringify([
    currentBranchId,
    state?.branchId ?? null,
    state?.key ?? null,
    state?.index ?? null,
    state?.since ?? null,
  ]);
}
