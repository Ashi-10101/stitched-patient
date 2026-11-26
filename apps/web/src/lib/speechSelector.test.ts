/**
 * Speech_Selector unit tests (patient-speech Requirements 4.2, 4.7, 5.1 to 5.4,
 * 6.4, 12.2, 12.3; design "speechSelector.ts" and "Testing Strategy").
 *
 * The case is the `left` Resolved_Case of the shipped case file. Every expected
 * line is read from its `play.speech` block, so these tests check the selection
 * rules, not the draft wording. The samples are test inputs chosen by the case
 * alarm thresholds; they are not clinical values.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  SPEECH_HOLD_SECONDS,
  SPEECH_ROTATE_SECONDS,
  checkedScriptedLine,
  foldSpeech,
  selectSpeech,
  speechRequestKey,
  targetSpeechKey,
  type SpeechInput,
  type SpeechKey,
  type SpeechState,
  type SpeechStep,
} from './speechSelector';
import { selectStatus } from './statusSelector';
import { earliestInsultTime, type Ending } from './endingEvaluator';
import type { CaseData, PlaySection, SpeechSection, VitalSigns } from '@/types';
import { CASE_LEFT, CASE_RIGHT } from '@/test/caseFixtures';
import {
  arbEnding,
  arbGate,
  arbSample,
  arbSampleSequence,
  arbSpeechBranchId,
  arbSpeechState,
  arbSpeechTime,
} from '@/test/generators';
import { PBT_PARAMS } from '@/test/pbt';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CASE: CaseData = CASE_LEFT;
const BRANCH = 'branch-a';
const OTHER_BRANCH = 'branch-b';

function playOf(caseData: CaseData): PlaySection {
  if (caseData.play === undefined) throw new Error('fixture: case has no play section');
  return caseData.play;
}

function speechOf(caseData: CaseData): SpeechSection {
  const speech = playOf(caseData).speech;
  if (speech === undefined) throw new Error('fixture: case has no play.speech');
  return speech;
}

/** Status_Rule sentence at `index` of the case's `play.status.rules`. */
function ruleSentence(index: number): string {
  const rule = playOf(CASE).status.rules[index];
  if (rule === undefined) throw new Error(`fixture: no Status_Rule at index ${index}`);
  return rule.sentence;
}

/** Lines of the Status_Speech_Entry for `sentence`. */
function statusLines(sentence: string): string[] {
  const entry = speechOf(CASE).status?.find((e) => e.sentence === sentence);
  if (entry === undefined) throw new Error(`fixture: no Status_Speech_Entry for "${sentence}"`);
  return entry.lines;
}

function listOf(lines: string[] | undefined, name: string): string[] {
  if (lines === undefined || lines.length === 0) throw new Error(`fixture: play.speech.${name} is empty`);
  return lines;
}

const EARLY = listOf(speechOf(CASE).early, 'early');
const RESCUED = listOf(speechOf(CASE).rescued, 'rescued');

// Status_Rule order of the case: 0 SpO2 critical, 1 SpO2 warning, 2 heart rate
// critical high, 3 heart rate warning high, 4 respiratory rate warning high.
const SPO2_CRITICAL = ruleSentence(0);
const SPO2_WARNING = ruleSentence(1);
const HR_CRITICAL_HIGH = ruleSentence(2);
const HR_WARNING_HIGH = ruleSentence(3);
const RR_WARNING_HIGH = ruleSentence(4);

const statusKey = (sentence: string): SpeechKey => `status:${sentence}`;

/** Every vital inside the case `normal` range: the Status_Selector returns the `defaultSentence`. */
const NORMAL_SAMPLE: Partial<VitalSigns> = {
  heart_rate: 72,
  respiratory_rate: 14,
  spo2: 0.97,
  mean_arterial_pressure: 90,
  etco2: 38,
  tidal_volume: 500,
};
const sampleWith = (overrides: Partial<VitalSigns>): Partial<VitalSigns> => ({
  ...NORMAL_SAMPLE,
  ...overrides,
});
/** SpO2 below the critical low limit: Status_Rule 0. */
const SPO2_CRITICAL_SAMPLE = sampleWith({ spo2: 0.8 });
/** SpO2 between the critical and warning low limits: Status_Rule 1. */
const SPO2_WARNING_SAMPLE = sampleWith({ spo2: 0.9 });
/** Heart rate above the critical high limit: Status_Rule 2 (one line). */
const HR_CRITICAL_SAMPLE = sampleWith({ heart_rate: 150 });
/** Heart rate above the normal high limit, below the warning high limit: Status_Rule 3. */
const HR_WARNING_SAMPLE = sampleWith({ heart_rate: 110 });
/** Respiratory rate above the warning high limit: Status_Rule 4. */
const RR_WARNING_SAMPLE = sampleWith({ respiratory_rate: 28 });

/** A deep copy of `CASE` with `edit` applied to its Speech_Section; `CASE` is not changed. */
function caseWithSpeech(edit: (speech: SpeechSection) => void): CaseData {
  const copy = structuredClone(CASE);
  edit(speechOf(copy));
  return copy;
}

type Args = Partial<SpeechInput>;

/** A full SpeechInput: the shipped case, a normal sample at 60 s, Ending `none`, gate `null`, no previous. */
function input(args: Args = {}): SpeechInput {
  return {
    sample: NORMAL_SAMPLE,
    caseData: CASE,
    ending: 'none',
    simulationTime: 60,
    branchId: BRANCH,
    rescueGateTime: null,
    previous: null,
    ...args,
  };
}

const target = (args: Args = {}): SpeechKey => targetSpeechKey(input(args));
const select = (args: Args = {}): SpeechState => selectSpeech(input(args));

function state(key: SpeechKey, index: number, since: number, line: string | null, branchId = BRANCH): SpeechState {
  return { branchId, key, index, since, line };
}

// ---------------------------------------------------------------------------
// Fixture sanity: the samples hit the intended Status_Rules
// ---------------------------------------------------------------------------

describe('fixture samples', () => {
  it('select the intended Status_Sentence', () => {
    const play = playOf(CASE);
    const status = (s: Partial<VitalSigns>) => selectStatus(s, CASE.alarms, play);
    expect(status(NORMAL_SAMPLE)).toBe(play.status.defaultSentence);
    expect(status(SPO2_CRITICAL_SAMPLE)).toBe(SPO2_CRITICAL);
    expect(status(SPO2_WARNING_SAMPLE)).toBe(SPO2_WARNING);
    expect(status(HR_CRITICAL_SAMPLE)).toBe(HR_CRITICAL_HIGH);
    expect(status(HR_WARNING_SAMPLE)).toBe(HR_WARNING_HIGH);
    expect(status(RR_WARNING_SAMPLE)).toBe(RR_WARNING_HIGH);
  });

  it('use a case whose Earliest_Insult_Time is 30 s, with two early lines and one rescued line', () => {
    expect(earliestInsultTime(CASE)).toBe(30);
    expect(EARLY.length).toBe(2);
    expect(RESCUED.length).toBe(1);
    expect(statusLines(SPO2_CRITICAL).length).toBe(2);
    expect(statusLines(HR_CRITICAL_HIGH).length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Requirement 4.2: the target Speech_Key, rule by rule
// ---------------------------------------------------------------------------

describe('targetSpeechKey and selectSpeech without a previous state (4.2, 12.2)', () => {
  it('is silent before the Earliest_Insult_Time and early at exactly that time', () => {
    expect(target({ simulationTime: 29 })).toBe('silent');
    expect(select({ simulationTime: 29 })).toEqual(state('silent', 0, 29, null));
    expect(target({ simulationTime: 30 })).toBe('early');
    expect(select({ simulationTime: 30 })).toEqual(state('early', 0, 30, EARLY[0]));
  });

  it('is silent before the insult even for a Status_Rule sentence', () => {
    expect(target({ sample: SPO2_CRITICAL_SAMPLE, simulationTime: 29 })).toBe('silent');
  });

  it('uses the Status_Speech_Entry of a Status_Rule sentence', () => {
    expect(target({ sample: SPO2_CRITICAL_SAMPLE })).toBe(statusKey(SPO2_CRITICAL));
    expect(select({ sample: SPO2_CRITICAL_SAMPLE })).toEqual(
      state(statusKey(SPO2_CRITICAL), 0, 60, statusLines(SPO2_CRITICAL)[0]),
    );
  });

  it('uses a Status_Speech_Entry whatever the Rescue_Gate_Time', () => {
    for (const gate of [null, -Infinity, 0, 60, 61]) {
      expect(target({ sample: HR_WARNING_SAMPLE, rescueGateTime: gate })).toBe(statusKey(HR_WARNING_HIGH));
    }
  });

  it('is silent for a Status_Rule sentence without a Status_Speech_Entry', () => {
    const noEntry = caseWithSpeech((speech) => {
      speech.status = speech.status?.filter((entry) => entry.sentence !== RR_WARNING_HIGH);
    });
    expect(target({ caseData: noEntry, sample: RR_WARNING_SAMPLE })).toBe('silent');
    expect(select({ caseData: noEntry, sample: RR_WARNING_SAMPLE })).toEqual(state('silent', 0, 60, null));
    // The early list does not stand in for the missing entry.
    expect(target({ caseData: noEntry, sample: RR_WARNING_SAMPLE, rescueGateTime: null })).not.toBe('early');
  });

  it('uses early for the defaultSentence while the Rescue_Gate_Time is null or later than the time', () => {
    expect(target({ simulationTime: 60, rescueGateTime: null })).toBe('early');
    expect(target({ simulationTime: 60, rescueGateTime: 61 })).toBe('early');
  });

  it('is silent for the defaultSentence once the Rescue_Gate_Time is open', () => {
    expect(target({ simulationTime: 60, rescueGateTime: 60 })).toBe('silent');
    expect(target({ simulationTime: 60, rescueGateTime: 59 })).toBe('silent');
    expect(target({ simulationTime: 60, rescueGateTime: -Infinity })).toBe('silent');
    expect(select({ simulationTime: 60, rescueGateTime: -Infinity })).toEqual(state('silent', 0, 60, null));
  });

  it('is silent for the defaultSentence when the case has no Early_Lines', () => {
    const noEarly = caseWithSpeech((speech) => {
      delete speech.early;
    });
    expect(target({ caseData: noEarly, rescueGateTime: null })).toBe('silent');
  });

  it('uses rescued for the rescued Ending with Rescued_Lines, before every other rule', () => {
    expect(target({ ending: 'rescued' })).toBe('rescued');
    expect(target({ ending: 'rescued', sample: SPO2_CRITICAL_SAMPLE })).toBe('rescued');
    expect(target({ ending: 'rescued', sample: null })).toBe('rescued');
    expect(target({ ending: 'rescued', simulationTime: 10 })).toBe('rescued');
    expect(select({ ending: 'rescued', simulationTime: 230 })).toEqual(state('rescued', 0, 230, RESCUED[0]));
  });

  it('is silent for the rescued Ending without Rescued_Lines', () => {
    const noRescued = caseWithSpeech((speech) => {
      delete speech.rescued;
    });
    expect(target({ caseData: noRescued, ending: 'rescued' })).toBe('silent');
    expect(target({ caseData: noRescued, ending: 'rescued', sample: SPO2_CRITICAL_SAMPLE })).toBe('silent');
    expect(select({ caseData: noRescued, ending: 'rescued' })).toEqual(state('silent', 0, 60, null));
  });

  it('is silent for the lost Ending', () => {
    expect(target({ ending: 'lost' })).toBe('silent');
    expect(target({ ending: 'lost', sample: SPO2_CRITICAL_SAMPLE })).toBe('silent');
    expect(select({ ending: 'lost', sample: SPO2_CRITICAL_SAMPLE })).toEqual(state('silent', 0, 60, null));
  });

  it('is silent with no sample', () => {
    expect(target({ sample: null })).toBe('silent');
    expect(target({ sample: null, rescueGateTime: null, simulationTime: 60 })).toBe('silent');
    expect(select({ sample: null })).toEqual(state('silent', 0, 60, null));
  });

  it('is silent with no Speech_Section, and with no Play_Section', () => {
    const noSpeech = structuredClone(CASE);
    delete playOf(noSpeech).speech;
    const noPlay = structuredClone(CASE);
    delete noPlay.play;
    for (const caseData of [noSpeech, noPlay]) {
      expect(target({ caseData })).toBe('silent');
      expect(target({ caseData, sample: SPO2_CRITICAL_SAMPLE })).toBe('silent');
      expect(target({ caseData, ending: 'rescued' })).toBe('silent');
      expect(select({ caseData, sample: SPO2_CRITICAL_SAMPLE })).toEqual(state('silent', 0, 60, null));
    }
  });
});

// ---------------------------------------------------------------------------
// Requirement 5: hold, Ending override, rotation, Branch isolation
// ---------------------------------------------------------------------------

describe('selectSpeech with a previous state (5.1 to 5.4, 12.3)', () => {
  it('uses the UI constants 10 s and 30 s', () => {
    expect(SPEECH_HOLD_SECONDS).toBe(10);
    expect(SPEECH_ROTATE_SECONDS).toBe(30);
  });

  it('holds a key change at 9 s and makes it at 10 s', () => {
    const prev = select({ simulationTime: 100 });
    expect(prev).toEqual(state('early', 0, 100, EARLY[0]));

    const held = select({ sample: SPO2_CRITICAL_SAMPLE, simulationTime: 109, previous: prev });
    expect(held).toBe(prev);

    const changed = select({ sample: SPO2_CRITICAL_SAMPLE, simulationTime: 110, previous: prev });
    expect(changed).toEqual(state(statusKey(SPO2_CRITICAL), 0, 110, statusLines(SPO2_CRITICAL)[0]));
  });

  it('holds a change to silent as well', () => {
    const prev = select({ sample: HR_WARNING_SAMPLE, simulationTime: 200 });
    expect(select({ simulationTime: 209, rescueGateTime: 150, previous: prev })).toBe(prev);
    expect(select({ simulationTime: 210, rescueGateTime: 150, previous: prev })).toEqual(
      state('silent', 0, 210, null),
    );
  });

  it('keeps holding when the held state is passed back in', () => {
    const prev = select({ simulationTime: 100 });
    const at105 = select({ sample: SPO2_CRITICAL_SAMPLE, simulationTime: 105, previous: prev });
    const at109 = select({ sample: SPO2_CRITICAL_SAMPLE, simulationTime: 109, previous: at105 });
    expect(at109).toBe(prev);
  });

  it('lets an Ending override the hold', () => {
    const prev = select({ simulationTime: 100 });
    expect(select({ ending: 'rescued', simulationTime: 101, previous: prev })).toEqual(
      state('rescued', 0, 101, RESCUED[0]),
    );
    expect(select({ ending: 'lost', sample: SPO2_CRITICAL_SAMPLE, simulationTime: 101, previous: prev })).toEqual(
      state('silent', 0, 101, null),
    );
  });

  it('rotates after 30 s on the same key and wraps from the last line to the first', () => {
    const at30 = select({ simulationTime: 30 });
    expect(at30).toEqual(state('early', 0, 30, EARLY[0]));

    expect(select({ simulationTime: 59, previous: at30 })).toBe(at30);

    const at60 = select({ simulationTime: 60, previous: at30 });
    expect(at60).toEqual(state('early', 1, 60, EARLY[1]));

    expect(select({ simulationTime: 89, previous: at60 })).toBe(at60);

    const at90 = select({ simulationTime: 90, previous: at60 });
    expect(at90).toEqual(state('early', 0, 90, EARLY[0]));
  });

  it('rotates a Status_Speech_Entry with two lines', () => {
    const lines = statusLines(SPO2_WARNING);
    const first = select({ sample: SPO2_WARNING_SAMPLE, simulationTime: 150 });
    const second = select({ sample: SPO2_WARNING_SAMPLE, simulationTime: 180, previous: first });
    expect(second).toEqual(state(statusKey(SPO2_WARNING), 1, 180, lines[1]));
  });

  it('never rotates a one-line list', () => {
    const prev = select({ sample: HR_CRITICAL_SAMPLE, simulationTime: 110 });
    expect(prev).toEqual(state(statusKey(HR_CRITICAL_HIGH), 0, 110, statusLines(HR_CRITICAL_HIGH)[0]));
    for (const t of [140, 170, 200, 1000]) {
      expect(select({ sample: HR_CRITICAL_SAMPLE, simulationTime: t, previous: prev })).toBe(prev);
    }
    const rescued = select({ ending: 'rescued', simulationTime: 230 });
    expect(select({ ending: 'rescued', simulationTime: 300, previous: rescued })).toBe(rescued);
  });

  it('never rotates silence', () => {
    const prev = select({ simulationTime: 10 });
    expect(select({ simulationTime: 100, previous: prev, sample: null })).toBe(prev);
  });

  it('ignores a previous state from another Branch', () => {
    const prev = state('early', 1, 60, EARLY[1], OTHER_BRANCH);
    // A different target inside the hold is not held.
    const changed = select({ sample: SPO2_CRITICAL_SAMPLE, simulationTime: 65, previous: prev });
    expect(changed).toEqual(state(statusKey(SPO2_CRITICAL), 0, 65, statusLines(SPO2_CRITICAL)[0]));
    expect(changed).toEqual(select({ sample: SPO2_CRITICAL_SAMPLE, simulationTime: 65 }));
    // The same key does not carry the line index or `since`.
    const same = select({ simulationTime: 65, previous: prev });
    expect(same).toEqual(state('early', 0, 65, EARLY[0]));
    expect(same).toEqual(select({ simulationTime: 65 }));
  });

  it('ignores a previous state with a later since', () => {
    const prev = state('early', 1, 200, EARLY[1]);
    const changed = select({ sample: SPO2_CRITICAL_SAMPLE, simulationTime: 100, previous: prev });
    expect(changed).toEqual(select({ sample: SPO2_CRITICAL_SAMPLE, simulationTime: 100 }));
    expect(changed.since).toBe(100);
    const same = select({ simulationTime: 100, previous: prev });
    expect(same).toEqual(state('early', 0, 100, EARLY[0]));
  });

  it('accepts a previous state whose since equals the time', () => {
    const prev = select({ simulationTime: 100 });
    expect(select({ sample: SPO2_CRITICAL_SAMPLE, simulationTime: 100, previous: prev })).toBe(prev);
  });
});

// ---------------------------------------------------------------------------
// Engine-facts sequence of the `left` affected-side Scenario (12.3)
// ---------------------------------------------------------------------------

describe('foldSpeech over the engine-facts sequence of the left affected-side Scenario (12.3)', () => {
  // Modelled on the Introduction of the requirements: the defaultSentence from
  // 0 to 100 s, Status_Rules from 110 s, the Rescue_Gate_Time 150 s, the
  // defaultSentence at 220 s and the rescued Ending at 230 s, in 10 s steps.
  // Which Status_Rules apply between 110 and 210 s is a test choice.
  const GATE_TIME = 150;
  function sampleAt(t: number): Partial<VitalSigns> {
    if (t <= 100) return NORMAL_SAMPLE;
    if (t <= 140) return HR_WARNING_SAMPLE;
    if (t <= 210) return SPO2_WARNING_SAMPLE;
    return NORMAL_SAMPLE;
  }
  const times = Array.from({ length: 24 }, (_, i) => i * 10); // 0, 10, ..., 230
  const steps: SpeechStep[] = times.map((t) => ({
    sample: sampleAt(t),
    simulationTime: t,
    ending: (t >= 230 ? 'rescued' : 'none') as Ending,
    rescueGateTime: t >= GATE_TIME ? GATE_TIME : null,
  }));
  const states = foldSpeech(CASE, BRANCH, steps);
  const at = (t: number): SpeechState => {
    const s = states[times.indexOf(t)];
    if (s === undefined) throw new Error(`no state at ${t} s`);
    return s;
  };

  it('returns one Speech_State per step on the given Branch', () => {
    expect(states).toHaveLength(steps.length);
    for (const s of states) expect(s.branchId).toBe(BRANCH);
  });

  it('is silent before 30 s', () => {
    for (const t of [0, 10, 20]) expect(at(t)).toEqual(state('silent', 0, 0, null));
  });

  it('shows the first early line from 30 s and keeps early up to 100 s', () => {
    expect(at(30)).toEqual(state('early', 0, 30, EARLY[0]));
    for (const t of [40, 50]) expect(at(t).line).toBe(EARLY[0]);
    for (const t of [60, 70, 80]) expect(at(t)).toEqual(state('early', 1, 60, EARLY[1]));
    for (const t of [90, 100]) expect(at(t)).toEqual(state('early', 0, 90, EARLY[0]));
  });

  it('follows the Status_Rules from 110 s', () => {
    const hr = statusLines(HR_WARNING_HIGH);
    const spo2 = statusLines(SPO2_WARNING);
    for (const t of [110, 120, 130, 140]) expect(at(t)).toEqual(state(statusKey(HR_WARNING_HIGH), 0, 110, hr[0]));
    for (const t of [150, 160, 170]) expect(at(t)).toEqual(state(statusKey(SPO2_WARNING), 0, 150, spo2[0]));
    for (const t of [180, 190, 200]) expect(at(t)).toEqual(state(statusKey(SPO2_WARNING), 1, 180, spo2[1]));
    expect(at(210)).toEqual(state(statusKey(SPO2_WARNING), 0, 210, spo2[0]));
  });

  it('is silent at 220 s and shows the Rescued_Lines line at 230 s', () => {
    expect(at(220)).toEqual(state('silent', 0, 220, null));
    expect(at(230)).toEqual(state('rescued', 0, 230, RESCUED[0]));
  });

  it('gives the same lines when folded again', () => {
    expect(foldSpeech(CASE, BRANCH, steps)).toEqual(states);
  });
});

// ---------------------------------------------------------------------------
// checkedScriptedLine (4.7)
// ---------------------------------------------------------------------------

describe('checkedScriptedLine (4.7)', () => {
  it('returns a Scripted_Line that passes the Speech_Check', () => {
    expect(checkedScriptedLine(select({ simulationTime: 30 }), CASE)).toBe(EARLY[0]);
    expect(checkedScriptedLine(select({ ending: 'rescued' }), CASE)).toBe(RESCUED[0]);
  });

  it('returns null for a line that fails the Speech_Check', () => {
    // A case loaded without schema validation, with a third-person early line
    // and a Side_Word rescued line (test texts, not Speech_Lines of the case).
    const broken = caseWithSpeech((speech) => {
      speech.early = ['His chest feels tight.'];
      speech.rescued = ['The left side is fine now.'];
    });
    const early = select({ caseData: broken, simulationTime: 30 });
    expect(early.line).toBe('His chest feels tight.');
    expect(checkedScriptedLine(early, broken)).toBeNull();
    const rescued = select({ caseData: broken, ending: 'rescued' });
    expect(rescued.line).toBe('The left side is fine now.');
    expect(checkedScriptedLine(rescued, broken)).toBeNull();
  });

  it('returns null for silence, no state or no case', () => {
    expect(checkedScriptedLine(select({ simulationTime: 10 }), CASE)).toBeNull();
    expect(checkedScriptedLine(null, CASE)).toBeNull();
    expect(checkedScriptedLine(select({ simulationTime: 30 }), null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// speechRequestKey (6.4)
// ---------------------------------------------------------------------------

describe('speechRequestKey (6.4)', () => {
  const base = state('early', 0, 30, EARLY[0]);
  const key = speechRequestKey(BRANCH, base);

  it('is equal for an equal Branch and an equal Speech_State in another object', () => {
    expect(speechRequestKey(BRANCH, { ...base })).toBe(key);
  });

  it('does not change when only the line text differs', () => {
    expect(speechRequestKey(BRANCH, { ...base, line: EARLY[1] })).toBe(key);
  });

  it('does not change for a held or unchanged sample', () => {
    const held = select({ sample: SPO2_CRITICAL_SAMPLE, simulationTime: 35, previous: base });
    expect(speechRequestKey(BRANCH, held)).toBe(key);
    const unchanged = select({ simulationTime: 50, previous: base });
    expect(speechRequestKey(BRANCH, unchanged)).toBe(key);
  });

  it('changes on a key, index or since change', () => {
    expect(speechRequestKey(BRANCH, { ...base, key: 'rescued' })).not.toBe(key);
    expect(speechRequestKey(BRANCH, { ...base, index: 1 })).not.toBe(key);
    expect(speechRequestKey(BRANCH, { ...base, since: 40 })).not.toBe(key);
  });

  it('changes when a rotation happens', () => {
    const rotated = select({ simulationTime: 60, previous: base });
    expect(speechRequestKey(BRANCH, rotated)).not.toBe(key);
  });

  it('changes on a current Branch change or a Speech_State Branch change', () => {
    expect(speechRequestKey(OTHER_BRANCH, base)).not.toBe(key);
    expect(speechRequestKey(BRANCH, { ...base, branchId: OTHER_BRANCH })).not.toBe(key);
    expect(speechRequestKey(null, base)).not.toBe(key);
  });

  it('changes when the Speech_State becomes none and back', () => {
    expect(speechRequestKey(BRANCH, null)).not.toBe(key);
    expect(speechRequestKey(BRANCH, null)).toBe(speechRequestKey(BRANCH, null));
  });
});

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

describe('selectSpeech: properties', () => {
  const SPEECH = speechOf(CASE);

  /** Speech_Lines of a key, read from the case's `play.speech` (not from `speechLines`). */
  function caseLinesOf(key: SpeechKey): readonly string[] | undefined {
    if (key === 'early') return SPEECH.early;
    if (key === 'rescued') return SPEECH.rescued;
    if (key.startsWith('status:')) {
      const sentence = key.slice('status:'.length);
      return SPEECH.status?.find((entry) => entry.sentence === sentence)?.lines;
    }
    return undefined;
  }

  /** Every Speech_Line of the case's Speech_Section. */
  const ALL_LINES: readonly string[] = [
    ...(SPEECH.early ?? []),
    ...(SPEECH.rescued ?? []),
    ...(SPEECH.status ?? []).flatMap((entry) => entry.lines),
  ];

  /**
   * SpeechInput on the shipped case. The Simulation_Time is any time, or the
   * previous state's `since` plus a delta at or around the hold and rotation
   * limits; the branch_id is any id, or the previous state's. This makes held,
   * unchanged and rotated previous states common next to fresh ones.
   */
  const arbSpeechInput: fc.Arbitrary<SpeechInput> = fc
    .record({
      sample: fc.option(arbSample, { nil: null }),
      ending: arbEnding,
      time: arbSpeechTime,
      branchId: arbSpeechBranchId,
      rescueGateTime: arbGate,
      previous: fc.option(arbSpeechState, { nil: null }),
      timeFromPrevious: fc.boolean(),
      delta: fc.constantFrom(-1, 0, 1, 9, 10, 29, 30, 31, 60),
      branchFromPrevious: fc.boolean(),
    })
    .map(({ sample, ending, time, branchId, rescueGateTime, previous, timeFromPrevious, delta, branchFromPrevious }) => {
      const simulationTime = previous !== null && timeFromPrevious ? previous.since + delta : time;
      return {
        sample: sample === null ? null : { ...sample, simulation_time: simulationTime },
        caseData: CASE,
        ending,
        simulationTime,
        branchId: previous !== null && branchFromPrevious ? previous.branchId : branchId,
        rescueGateTime,
        previous,
      };
    });

  it('the case has Speech_Lines to check against', () => {
    expect(ALL_LINES.length).toBeGreaterThan(0);
  });

  // Feature: patient-speech, Property 2: Every returned line is a case line at its index
  // **Validates: Requirements 4.4, 4.5**
  it('Property 2: Every returned line is a case line at its index', () => {
    fc.assert(
      fc.property(arbSpeechInput, (speechInput) => {
        const result = selectSpeech(speechInput);
        if (result.key === 'silent') {
          expect(result.line).toBeNull();
          return;
        }
        const lines = caseLinesOf(result.key);
        expect(lines).toBeDefined();
        expect(result.line).not.toBeNull();
        expect(result.line).toBe(lines?.[result.index]);
        expect(ALL_LINES).toContain(result.line);
      }),
      PBT_PARAMS,
    );
  });

  /**
   * One Branch, the Ending `none` throughout and one fixed Rescue_Gate_Time.
   * The steps are the samples of an `arbSampleSequence` that the reducer would
   * fold (a finite `simulation_time` greater than the last folded one, design
   * D2), so their times strictly increase. `scale` stretches the mostly 1 s
   * steps so that runs also cross the gate grid around 150 and 220 s; it keeps
   * the order, and the 1 s and 0.5 s scales hit the hold limit exactly.
   */
  const arbHoldRun: fc.Arbitrary<{ branchId: string; steps: SpeechStep[] }> = fc
    .record({
      samples: arbSampleSequence,
      scale: fc.constantFrom(0.5, 1, 2, 4),
      rescueGateTime: arbGate,
      branchId: arbSpeechBranchId,
    })
    .map(({ samples, scale, rescueGateTime, branchId }) => {
      const steps: SpeechStep[] = [];
      let lastTime = Number.NEGATIVE_INFINITY;
      for (const sample of samples) {
        if (!Number.isFinite(sample.simulation_time) || sample.simulation_time <= lastTime) continue;
        lastTime = sample.simulation_time;
        const simulationTime = sample.simulation_time * scale;
        steps.push({
          sample: { ...sample, simulation_time: simulationTime },
          simulationTime,
          ending: 'none',
          rescueGateTime,
        });
      }
      return { branchId, steps };
    });

  // Feature: patient-speech, Property 4: Key changes on one Branch are at least the hold apart
  // **Validates: Requirements 5.1**
  it('Property 4: Key changes on one Branch are at least the hold apart', () => {
    // Guards against a vacuous pass: some runs must have two or more key changes.
    let runsWithTwoChanges = 0;
    fc.assert(
      fc.property(arbHoldRun, ({ branchId, steps }) => {
        const states = foldSpeech(CASE, branchId, steps);
        const first = steps[0];
        if (first === undefined) return;
        // The first change counts from the first sample; each later one from the change before it.
        let lastChangeTime = first.simulationTime;
        let changes = 0;
        for (let i = 1; i < states.length; i += 1) {
          const before = states[i - 1];
          const after = states[i];
          const step = steps[i];
          if (before === undefined || after === undefined || step === undefined) throw new Error('fold length');
          if (after.key === before.key) continue;
          expect(step.simulationTime - lastChangeTime).toBeGreaterThanOrEqual(SPEECH_HOLD_SECONDS);
          lastChangeTime = step.simulationTime;
          changes += 1;
        }
        if (changes >= 2) runsWithTwoChanges += 1;
      }),
      PBT_PARAMS,
    );
    expect(runsWithTwoChanges).toBeGreaterThan(0);
  });

  /**
   * SpeechInput on the shipped case whose previous Speech_State must be ignored
   * (Requirement 5.4): its branch_id differs from the current one, or its
   * `since` is greater than the Simulation_Time, or both.
   *
   * "The future" means `since` strictly greater than the Simulation_Time. A
   * `since` equal to the time is a valid previous state on the same Branch
   * (5.1 and 5.3 say "less than or equal to"; the 3.2 unit test "accepts a
   * previous state whose since equals the time"), so the `future` reason never
   * gives it. Another Branch may carry any `since`, including the time itself.
   *
   * For another Branch the `since` is often the time minus a delta at or around
   * the hold and rotation limits, so that the same previous state on the
   * current Branch would have been held, kept or rotated. The future delta is
   * a half-second multiple, so `t + delta` is exactly greater than `t`.
   */
  const arbForeignPreviousInput: fc.Arbitrary<SpeechInput> = fc
    .record({
      sample: fc.option(arbSample, { nil: null }),
      ending: arbEnding,
      simulationTime: arbSpeechTime,
      branchId: arbSpeechBranchId,
      otherBranchId: arbSpeechBranchId,
      rescueGateTime: arbGate,
      previous: arbSpeechState,
      reason: fc.constantFrom('branch', 'future', 'both'),
      keepSince: fc.boolean(),
      pastDelta: fc.constantFrom(0, 1, 9, 10, 29, 30, 31, 60),
      futureDelta: fc.constantFrom(0.5, 1, 9, 10, 29, 30, 31, 60),
    })
    .filter(({ branchId, otherBranchId }) => branchId !== otherBranchId)
    .map((r): SpeechInput => {
      const t = r.simulationTime;
      const future = t + r.futureDelta;
      const past = r.keepSince ? r.previous.since : Math.max(0, t - r.pastDelta);
      const previous: SpeechState =
        r.reason === 'branch'
          ? { ...r.previous, branchId: r.otherBranchId, since: past }
          : r.reason === 'future'
            ? { ...r.previous, branchId: r.branchId, since: future }
            : { ...r.previous, branchId: r.otherBranchId, since: future };
      return {
        sample: r.sample === null ? null : { ...r.sample, simulation_time: t },
        caseData: CASE,
        ending: r.ending,
        simulationTime: t,
        branchId: r.branchId,
        rescueGateTime: r.rescueGateTime,
        previous,
      };
    });

  // Feature: patient-speech, Property 5: A previous Speech_State from another Branch or the future is ignored
  // **Validates: Requirements 5.4**
  it('Property 5: A previous Speech_State from another Branch or the future is ignored', () => {
    // Guards against a vacuous pass: some runs must have a previous state that,
    // if it were carried, would change the result (same key with another index
    // or `since`, or another key inside the hold).
    let sameKeyRuns = 0;
    let otherKeyInsideHoldRuns = 0;
    fc.assert(
      fc.property(arbForeignPreviousInput, (speechInput) => {
        const prev = speechInput.previous;
        const t = speechInput.simulationTime;
        if (prev === null) throw new Error('generator: previous must be set');
        expect(prev.branchId !== speechInput.branchId || prev.since > t).toBe(true);

        const withoutPrevious = selectSpeech({ ...speechInput, previous: null });
        const result = selectSpeech(speechInput);

        expect(result).toStrictEqual(withoutPrevious);
        expect(result.index).toBe(0);
        expect(result.since).toBe(t);
        expect(result.branchId).toBe(speechInput.branchId);

        if (prev.key === result.key && (prev.index !== 0 || prev.since !== t)) sameKeyRuns += 1;
        if (prev.key !== result.key && t - prev.since < SPEECH_HOLD_SECONDS) otherKeyInsideHoldRuns += 1;
      }),
      PBT_PARAMS,
    );
    expect(sameKeyRuns).toBeGreaterThan(0);
    expect(otherKeyInsideHoldRuns).toBeGreaterThan(0);
  });

  /** Paths, in `a.b[0].c` form, at which two parsed YAML values differ. */
  function differingPaths(a: unknown, b: unknown, path = ''): string[] {
    if (Object.is(a, b)) return [];
    if (
      typeof a !== 'object' ||
      typeof b !== 'object' ||
      a === null ||
      b === null ||
      Array.isArray(a) !== Array.isArray(b)
    ) {
      return [path];
    }
    const ra = a as Record<string, unknown>;
    const rb = b as Record<string, unknown>;
    const keys = [...new Set([...Object.keys(ra), ...Object.keys(rb)])];
    return keys.flatMap((k) =>
      differingPaths(ra[k], rb[k], Array.isArray(a) ? `${path}[${k}]` : path === '' ? k : `${path}.${k}`),
    );
  }

  /** The Override_Targets of the Variants (bedside-exam 1.3), as `differingPaths` names them. */
  const OVERRIDE_TARGET_PATH =
    /^(timeline\.scheduledInsults\[\d+\]\.parameters\.side|play\.endings\.rescued\.requiredInterventions(\[\d+\])?|play\.hints(\[.*)?|play\.sideRevealText)$/;
  const INSULT_SIDE_PATH = /^timeline\.scheduledInsults\[\d+\]\.parameters\.side$/;

  it('Property 6 fixtures: CASE_LEFT and CASE_RIGHT differ only in Override_Targets, the insult side among them', () => {
    const paths = differingPaths(CASE_LEFT, CASE_RIGHT);
    expect(paths.filter((p) => !OVERRIDE_TARGET_PATH.test(p))).toEqual([]);
    // Not a vacuous comparison: the side-dependent inputs do differ.
    expect(paths.some((p) => INSULT_SIDE_PATH.test(p))).toBe(true);
    expect(paths.some((p) => p.startsWith('play.endings.rescued.requiredInterventions'))).toBe(true);
    expect(paths).toContain('play.sideRevealText');
    // The side-free inputs the Speech_Selector reads are equal.
    expect(earliestInsultTime(CASE_RIGHT)).toBe(earliestInsultTime(CASE_LEFT));
    expect(CASE_RIGHT.play?.speech).toEqual(CASE_LEFT.play?.speech);
  });

  /**
   * A fold run for Property 6: the steps of `arbHoldRun` (one Branch, strictly
   * increasing times), with the Ending set from step `endingAt` on (`rescued`
   * or `lost`; never when `endingAt` is null or past the last step) and the
   * Rescue_Gate_Time replaced from step `gateAt` on. So runs also cross an
   * Ending and a gate change, as the reducer's sample sequences do.
   */
  const arbSymmetryRun: fc.Arbitrary<{ branchId: string; steps: SpeechStep[] }> = fc
    .record({
      run: arbHoldRun,
      endingAt: fc.option(fc.nat({ max: 60 }), { nil: null }),
      endingKind: fc.constantFrom<Ending>('rescued', 'lost'),
      gateAt: fc.nat({ max: 60 }),
      gateAfter: arbGate,
    })
    .map(({ run, endingAt, endingKind, gateAt, gateAfter }) => ({
      branchId: run.branchId,
      steps: run.steps.map(
        (s, i): SpeechStep => ({
          ...s,
          ending: endingAt !== null && i >= endingAt ? endingKind : 'none',
          rescueGateTime: i >= gateAt ? gateAfter : s.rescueGateTime,
        }),
      ),
    }));

  /**
   * Samples chosen by the case alarm thresholds whose target Speech_Key has two
   * Speech_Lines from the Earliest_Insult_Time on with the Ending `none`: the
   * defaultSentence (early, while the gate is not open), SpO2 critical and SpO2
   * warning. Test inputs, not clinical values.
   */
  const ROTATING_SAMPLES: readonly Partial<VitalSigns>[] = [NORMAL_SAMPLE, SPO2_CRITICAL_SAMPLE, SPO2_WARNING_SAMPLE];

  /** Seconds from `since` to the Simulation_Time: the rotation limit and past it, up to four limits. */
  const ROTATION_DELTAS = [30, 30.5, 31, 45, 59.5, 60, 61, 90, 120] as const;

  /** A sample that usually gives a two-line Speech_Key, sometimes any `arbSample`. */
  const arbRotatingSample: fc.Arbitrary<Partial<VitalSigns>> = fc.oneof(
    { weight: 3, arbitrary: fc.constantFrom(...ROTATING_SAMPLES) },
    { weight: 1, arbitrary: arbSample },
  );

  /** Rescue_Gate_Time: mostly closed, so early can hold; sometimes any `arbGate`. */
  const arbRotationGate: fc.Arbitrary<number | null> = fc.oneof(
    { weight: 2, arbitrary: fc.constant(null) },
    { weight: 1, arbitrary: arbGate },
  );

  /**
   * SpeechInput that reaches rotation (Requirement 5.3) on the left case: the
   * previous Speech_State has the target Speech_Key of this same input
   * (`targetSpeechKey` on CASE_LEFT), that key has two or more Speech_Lines,
   * the branch_id is the current one, and `since` is 30 s or more before the
   * Simulation_Time. The line index is any index of the list, so both index 0
   * (rotates to 1) and the last index (wraps to 0) occur. `laterDeltas` are
   * further rotation deltas for a chain of inputs (see Property 6).
   */
  const arbRotationInput: fc.Arbitrary<{ input: SpeechInput; laterDeltas: number[] }> = fc
    .record({
      sample: arbRotatingSample,
      ending: fc.oneof(
        { weight: 3, arbitrary: fc.constant<Ending>('none') },
        { weight: 1, arbitrary: arbEnding },
      ),
      since: arbSpeechTime,
      delta: fc.constantFrom(...ROTATION_DELTAS),
      branchId: arbSpeechBranchId,
      rescueGateTime: arbRotationGate,
      indexSeed: fc.nat({ max: 11 }),
      laterDeltas: fc.array(fc.constantFrom(...ROTATION_DELTAS), { minLength: 1, maxLength: 3 }),
    })
    .map((r) => {
      const simulationTime = r.since + r.delta;
      const sample = { ...r.sample, simulation_time: simulationTime };
      const key = targetSpeechKey({
        sample,
        caseData: CASE_LEFT,
        ending: r.ending,
        simulationTime,
        rescueGateTime: r.rescueGateTime,
      });
      return { r, simulationTime, sample, key, lines: caseLinesOf(key) ?? [] };
    })
    .filter(({ lines }) => lines.length >= 2)
    .map(({ r, simulationTime, sample, key, lines }) => {
      const index = r.indexSeed % lines.length;
      const previous: SpeechState = { branchId: r.branchId, key, index, since: r.since, line: lines[index] ?? null };
      return {
        input: {
          sample,
          caseData: CASE_LEFT,
          ending: r.ending,
          simulationTime,
          branchId: r.branchId,
          rescueGateTime: r.rescueGateTime,
          previous,
        },
        laterDeltas: r.laterDeltas,
      };
    });

  /** Step spacing of a rotation run, in seconds; 7 s does not divide the 30 s limit. */
  const ROTATION_RUN_STEPS = [1, 2.5, 5, 7, 10, 15, 30] as const;

  /**
   * A fold run that holds one sample for more than 60 s on one Branch, the
   * Ending `none` and one Rescue_Gate_Time: from `start` (30 s or later, so
   * after the Earliest_Insult_Time) to `start + 60 + 2 * step + extra`, every
   * `step` seconds. When the key holds, the first rotation comes at most
   * `30 + step` after `start` and the second at most `30 + step` after the
   * first, so a two-line key rotates 0 to 1 and wraps 1 to 0 within the run.
   */
  const arbRotationRun: fc.Arbitrary<{ branchId: string; steps: SpeechStep[] }> = fc
    .record({
      sample: arbRotatingSample,
      start: fc.integer({ min: 60, max: 400 }).map((n) => n / 2),
      step: fc.constantFrom(...ROTATION_RUN_STEPS),
      extra: fc.integer({ min: 1, max: 60 }),
      rescueGateTime: arbRotationGate,
      branchId: arbSpeechBranchId,
    })
    .map(({ sample, start, step, extra, rescueGateTime, branchId }) => {
      const end = start + 60 + 2 * step + extra;
      const steps: SpeechStep[] = [];
      for (let i = 0; start + i * step <= end; i += 1) {
        const simulationTime = start + i * step;
        steps.push({
          sample: { ...sample, simulation_time: simulationTime },
          simulationTime,
          ending: 'none',
          rescueGateTime,
        });
      }
      return { branchId, steps };
    });

  // Feature: patient-speech, Property 6: Speech is the same on both sides
  // **Validates: Requirements 8.2, 8.3**
  it('Property 6: Speech is the same on both sides', () => {
    // Every input except the Resolved_Case is the same object for both sides:
    // sample (or none), Ending, Simulation_Time, branch_id, Rescue_Gate_Time
    // and previous Speech_State.
    let spokenInputs = 0;
    fc.assert(
      fc.property(arbSpeechInput, (speechInput) => {
        const left = selectSpeech({ ...speechInput, caseData: CASE_LEFT });
        const right = selectSpeech({ ...speechInput, caseData: CASE_RIGHT });
        expect(right).toStrictEqual(left);
        if (left.line !== null) spokenInputs += 1;
      }),
      PBT_PARAMS,
    );
    // Guards against a vacuous pass: some inputs must give a Speech_Line.
    expect(spokenInputs).toBeGreaterThan(0);

    // The same steps and branch_id folded on both sides.
    let changingRuns = 0;
    fc.assert(
      fc.property(arbSymmetryRun, ({ branchId, steps }) => {
        const left = foldSpeech(CASE_LEFT, branchId, steps);
        const right = foldSpeech(CASE_RIGHT, branchId, steps);
        expect(right).toStrictEqual(left);
        if (new Set(left.map((s) => s.key)).size >= 2) changingRuns += 1;
      }),
      PBT_PARAMS,
    );
    // Guards against a vacuous pass: some runs must change the Speech_Key.
    expect(changingRuns).toBeGreaterThan(0);

    // Rotation (5.3) on both sides: a chain of inputs on one Branch, each with
    // the previous left result as its previous Speech_State (the same object for
    // both sides), the same sample, Ending and gate, and the time moved on by
    // the next delta. The first input always reaches the rotation branch.
    let rotations = 0;
    let rotationsFromZero = 0;
    let wraps = 0;
    fc.assert(
      fc.property(arbRotationInput, ({ input: first, laterDeltas }) => {
        let speechInput = first;
        for (let i = 0; ; i += 1) {
          const left = selectSpeech({ ...speechInput, caseData: CASE_LEFT });
          const right = selectSpeech({ ...speechInput, caseData: CASE_RIGHT });
          expect(right).toStrictEqual(left);
          const prev = speechInput.previous;
          if (prev !== null && left.key === prev.key && left.index !== prev.index) {
            rotations += 1;
            if (prev.index === 0) rotationsFromZero += 1;
            if (left.index === 0) wraps += 1;
          }
          const delta = laterDeltas[i];
          if (delta === undefined) break;
          const simulationTime = speechInput.simulationTime + delta;
          const sample = speechInput.sample === null ? null : { ...speechInput.sample, simulation_time: simulationTime };
          speechInput = { ...speechInput, sample, simulationTime, previous: left };
        }
      }),
      PBT_PARAMS,
    );
    // Guards against a vacuous pass: some inputs must rotate on the same key,
    // some from index 0 (to 1 on a two-line list) and some wrap back to 0.
    expect(rotations).toBeGreaterThan(0);
    expect(rotationsFromZero).toBeGreaterThan(0);
    expect(wraps).toBeGreaterThan(0);

    // Fold runs that hold one sample for more than 60 s.
    let rotatingRuns = 0;
    let runsRotatingFromZero = 0;
    let wrappingRuns = 0;
    fc.assert(
      fc.property(arbRotationRun, ({ branchId, steps }) => {
        const left = foldSpeech(CASE_LEFT, branchId, steps);
        const right = foldSpeech(CASE_RIGHT, branchId, steps);
        expect(right).toStrictEqual(left);
        let rotated = false;
        let fromZero = false;
        let wrapped = false;
        for (let i = 1; i < left.length; i += 1) {
          const before = left[i - 1];
          const after = left[i];
          if (before === undefined || after === undefined) throw new Error('fold length');
          if (after.key !== before.key || after.index === before.index) continue;
          rotated = true;
          if (before.index === 0) fromZero = true;
          if (after.index === 0) wrapped = true;
        }
        if (rotated) rotatingRuns += 1;
        if (fromZero) runsRotatingFromZero += 1;
        if (wrapped) wrappingRuns += 1;
      }),
      PBT_PARAMS,
    );
    // Guards against a vacuous pass: some runs must rotate (same key between
    // consecutive steps, index changes), some from index 0 and some wrap to 0.
    expect(rotatingRuns).toBeGreaterThan(0);
    expect(runsRotatingFromZero).toBeGreaterThan(0);
    expect(wrappingRuns).toBeGreaterThan(0);
  });
});
