/**
 * Exam_Finding_Selector (bedside-exam Requirement 5, design "examFinding.ts").
 *
 * Picks the finding for one Exam_Button activation from the Resolved_Case.
 * Every sentence comes from the case and is returned unchanged; this module
 * never composes text (5.8). It reads no clock, network, storage, randomness or
 * Variant_Id: its only inputs are the arguments (5.1).
 */

import { statusItemMatches } from './statusSelector';
import { DECOMPRESSION_ACTION, affectedInsult } from './sides';
import type {
  AlarmThresholds,
  CaseData,
  ExamAction,
  ExamFinding,
  ExamSection,
  ExamWhen,
  InterventionRecordEntry,
  Side,
  SidedExamAction,
  VitalSigns,
} from '@/types';

/** Exam_Button sides of a Sided_Action, in display order (6.1). */
const BUTTON_SIDES: readonly Side[] = ['Left', 'Right'];

/** The facts that Exam_Rules test, computed once per Exam_Button activation. */
export interface ExamContext {
  /** Affected_Side, or null when no SETensionPneumothorax insult with a valid side exists. */
  affectedSide: Side | null;
  /** Insult_Started at the given Simulation_Time. */
  insultStarted: boolean;
  /** Affected_Side_Decompressed at the given Simulation_Time. */
  affectedSideDecompressed: boolean;
  /** Most recent VitalSigns sample of the current Branch, or null. */
  sample: Partial<VitalSigns> | null;
  alarms: AlarmThresholds;
}

/** Inputs of Requirement 5.1. There is no Variant_Id, clock or network input. */
export interface ExamFindingInput {
  action: ExamAction;
  /** Exam_Button side; null for a Side_Neutral_Action. */
  side: Side | null;
  /** The Resolved_Case. */
  caseData: Pick<CaseData, 'timeline' | 'alarms'>;
  simulationTime: number;
  sample: Partial<VitalSigns> | null;
  activeInterventions: readonly InterventionRecordEntry[];
}

/**
 * Affected_Side, Insult_Started and Affected_Side_Decompressed (glossary).
 * `activeInterventions` is expected to be limited to the Branch_Lineage. A
 * Decompression on the Other_Side or before the insult time never counts.
 */
export function examContext(
  caseData: Pick<CaseData, 'timeline' | 'alarms'>,
  simulationTime: number,
  sample: Partial<VitalSigns> | null,
  activeInterventions: readonly InterventionRecordEntry[],
): ExamContext {
  const insult = affectedInsult(caseData.timeline?.scheduledInsults ?? []);
  const insultStarted = insult !== null && simulationTime >= insult.timeSeconds;
  const affectedSideDecompressed =
    insult !== null &&
    activeInterventions.some(
      (entry) =>
        entry.action === DECOMPRESSION_ACTION &&
        entry.side === insult.side &&
        entry.simulationTime >= insult.timeSeconds &&
        entry.simulationTime <= simulationTime,
    );
  return {
    affectedSide: insult?.side ?? null,
    insultStarted,
    affectedSideDecompressed,
    sample,
    alarms: caseData.alarms,
  };
}

/** Every present condition must hold; an absent condition is not tested (5.2, 5.4 to 5.7). */
export function examWhenMatches(when: ExamWhen, side: Side | null, ctx: ExamContext): boolean {
  if (when.side === 'affected' && !(side !== null && side === ctx.affectedSide)) return false;
  if (when.side === 'other' && !(side !== null && side !== ctx.affectedSide)) return false;
  if (when.insult === 'started' && !ctx.insultStarted) return false;
  if (when.insult === 'notStarted' && ctx.insultStarted) return false;
  if (when.decompressed === true && !ctx.affectedSideDecompressed) return false;
  if (when.decompressed === false && ctx.affectedSideDecompressed) return false;
  if (when.vitals !== undefined) {
    const sample = ctx.sample;
    if (sample === null) return false;
    if (!when.vitals.every((item) => statusItemMatches(sample, ctx.alarms, item))) return false;
  }
  return true;
}

/**
 * Sentence and abnormal flag of the first Exam_Rule (in Case_Definition order)
 * whose `when` matches, else `defaultSentence` with `abnormal: false` (5.2, 5.3).
 */
export function selectExamFinding(action: ExamAction, side: Side | null, ctx: ExamContext): ExamFinding {
  for (const rule of action.rules) {
    if (examWhenMatches(rule.when, side, ctx)) {
      return { sentence: rule.sentence, abnormal: rule.abnormal === true };
    }
  }
  return { sentence: action.defaultSentence, abnormal: false };
}

/** The Exam_Finding_Selector (5.1). */
export function examFinding(input: ExamFindingInput): ExamFinding {
  const ctx = examContext(input.caseData, input.simulationTime, input.sample, input.activeInterventions);
  return selectExamFinding(input.action, input.side, ctx);
}

export function isSidedAction(action: ExamAction): action is SidedExamAction {
  return action.labels !== undefined;
}

export interface ExamButtonSpec {
  /** "<actionId>" or "<actionId>:<Side>", for React keys. */
  key: string;
  actionId: string;
  side: Side | null;
  /** `label`, `labels.Left` or `labels.Right`, unchanged (6.2). */
  text: string;
}

/** Exam_Buttons grouped by Exam_Action, in Case_Definition order; Left before Right (6.1). */
export function examButtons(exam: ExamSection): ExamButtonSpec[][] {
  return exam.actions.map((action) =>
    isSidedAction(action)
      ? BUTTON_SIDES.map((side) => ({
          key: `${action.id}:${side}`,
          actionId: action.id,
          side,
          text: action.labels[side],
        }))
      : [{ key: action.id, actionId: action.id, side: null, text: action.label }],
  );
}

/**
 * Button text for a recorded entry; the action id when the action is not in
 * the case (or, for a Sided_Action, when the entry has no side).
 */
export function examButtonText(exam: ExamSection | undefined, actionId: string, side: Side | null): string {
  const action = exam?.actions.find((a) => a.id === actionId);
  if (action === undefined) return actionId;
  if (!isSidedAction(action)) return action.label;
  return side === 'Left' || side === 'Right' ? action.labels[side] : actionId;
}
