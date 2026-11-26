/**
 * Speech_Provider seam (patient-speech Requirement 6.1 to 6.3, design "speechProvider.ts").
 *
 * The async interface a later spec can implement with a language model, the
 * Scripted_Speech_Provider (the only provider of this spec), and the builder of
 * the Speech_Context from the reducer state. This module makes no network
 * request and reads no setting, environment variable or key (6.3, 6.11).
 */

import { activeExamEntries, activeInterventions } from './branchLineage';
import type { Ending } from './endingEvaluator';
import type { SessionUiState } from './sessionState';
import type { SpeechState } from './speechSelector';
import type { CaseData, ExamRecordEntry, InterventionRecordEntry, VitalSigns } from '@/types';

/** The most Active_Interventions and Active_Exam_Entries a Speech_Context holds (6.2). */
export const SPEECH_CONTEXT_ENTRY_LIMIT = 5;

/** What a Speech_Provider receives for one Speech_Request (6.2). */
export interface SpeechContext {
  /** The current Branch when the Speech_Request was issued. */
  branchId: string;
  /** Increases within the Session; filled in by the gate. */
  requestNumber: number;
  caseData: CaseData;
  /** Most recent VitalSigns sample of the current Branch, or null. */
  sample: VitalSigns | null;
  /** Simulation_Time of `sample`, or null without a sample. */
  simulationTime: number | null;
  ending: Ending;
  /** `-Infinity`: no Required_Interventions (always open); `null`: closed. */
  rescueGateTime: number | null;
  speechState: SpeechState | null;
  /** The raw Scripted_Line, before the Speech_Check. */
  scriptedLine: string | null;
  /** Newest 5 or fewer Active_Interventions, in recording order. */
  activeInterventions: InterventionRecordEntry[];
  /** Newest 5 or fewer Active_Exam_Entries, in recording order. */
  activeExamEntries: ExamRecordEntry[];
}

/** Turns a Speech_Context into a text, or nothing (6.1). */
export interface SpeechProvider {
  speak(context: SpeechContext, signal: AbortSignal): Promise<string | null | undefined>;
}

/** The only provider of this spec: resolves with the Scripted_Line and calls nothing else (6.3). */
export const scriptedSpeechProvider: SpeechProvider = {
  speak: (context) => Promise.resolve(context.scriptedLine),
};

/** The last `SPEECH_CONTEXT_ENTRY_LIMIT` entries, as a new array. */
function newest<T>(entries: readonly T[]): T[] {
  return entries.slice(-SPEECH_CONTEXT_ENTRY_LIMIT);
}

/**
 * The Speech_Context of the reducer state (6.2), without `requestNumber`, which
 * the gate fills in. `null` before the case and the current Branch are known.
 * Active entries are in recording order, so the newest are the last ones.
 */
export function buildSpeechContext(state: SessionUiState): Omit<SpeechContext, 'requestNumber'> | null {
  const { caseData, currentBranchId } = state;
  if (caseData === null || currentBranchId === null) return null;
  const sample = state.latestSample;
  return {
    branchId: currentBranchId,
    caseData,
    sample,
    simulationTime: sample?.simulation_time ?? null,
    ending: state.ending.ending,
    rescueGateTime: state.endingCtx.rescueGateTime,
    speechState: state.speech,
    scriptedLine: state.speech?.line ?? null,
    activeInterventions: newest(activeInterventions(state.interventionRecord, state.lineage)),
    activeExamEntries: newest(activeExamEntries(state.examRecord, state.lineage)),
  };
}
