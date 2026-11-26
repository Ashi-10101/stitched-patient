# Requirements Document

## Introduction

Patient speech lets the stitched patient talk. The Speech_Bubble_Slot on the Avatar (play-mode Requirements 3.9 to 3.12) has stayed empty so far, and bedside-exam Requirement 10.8 keeps it empty. This spec fills it with short pre-written lines from the case file. The lines change with the patient's condition: a breathless "I... can't... get a breath in. My chest-" early on (demo video shot 2), more distressed lines as he gets worse, and a calmer line after the rescue.

This spec makes four changes:

1. **Case data.** The Play_Section gains an optional Speech_Section. Its lines are keyed by the Status_Sentence that the Status_Selector already returns, plus one list for the early phase and one for the `rescued` Ending (decision 1).
2. **Speech_Selector.** A pure function in `apps/web/src/lib/` picks the line, or silence, from the Status_Selector's inputs plus the Ending, the Simulation_Time, the branch_id, the Rescue_Gate_Time and the previous Speech_State. A line stays for a minimum Simulation_Time before it can change.
3. **Speech_Provider seam.** An async interface for a later language model, with one implementation in this spec: the Scripted_Speech_Provider built on the Speech_Selector. Every text passes the Speech_Check before it reaches the bubble.
4. **Display.** The Play_View passes the line into the Speech_Bubble_Slot and announces each new line once. The Ending_Screen shows the `rescued` line. The Clinician_View does not change.

This spec builds on play-mode (`.kiro/specs/play-mode/requirements.md`), bedside-exam (`.kiro/specs/bedside-exam/requirements.md`) and engine-mcp (`.kiro/specs/engine-mcp/requirements.md`). It edits none of them now. Requirement 10 asks a later task to add four one-line pointers: under bedside-exam 10.8, under the play-mode Speech_Bubble_Slot glossary entry, and under engine-mcp 5.1 and 9.4.

**Scope boundary.** This spec changes no file under `services/physiology/`. Outside `apps/web/`, it changes only `cases/case-schema.json`, `cases/adult-tension-pneumothorax.yaml` (an added `play.speech` block, nothing else), `scripts/validate-case.py`, the Calibration_Record under `docs/calibration/` (Requirement 9), and, by Requirement 10, the four pointer lines in `.kiro/specs/bedside-exam/requirements.md`, `.kiro/specs/play-mode/requirements.md` and `.kiro/specs/engine-mcp/requirements.md`. The Physiology_Service reads `cases/` at run time through the read-only volume in `docker-compose.yml`, and the Case_Loader validates against `cases/case-schema.json`, so the new optional field reaches the Web_App through the Case_API with no service change (as play-mode 2.13).

**Clinical safety.** Every Speech_Line and every Forbidden_Speech_Term in the case file is a draft and carries a `TODO(author)` marker for review by the author, a clinical medicine student. The lines describe how the simulated patient feels. They are not clinical claims, not instructions to the reader and not medical advice. This document contains no clinical numbers. The only numbers below are UI constants (lengths, hold times, timeouts) and Pulse_Engine output quoted from a calibration record.

**Engine facts the keying relies on.** From `docs/calibration/adult-tension-pneumothorax-2026-11-25-b55d43e.md` (engine output for draft case values, not clinical advice):

- In all eight Scenarios (both Variants), the Status_Selector returned the `defaultSentence` ("He is breathing calmly and looks comfortable.") at every Mark_Sample from 0 s to 100 s. The first Status_Rule match is at 110 s. The insult `timeSeconds` is 30. So the Status_Sentence does not change in the first 80 s after the insult.
- In the `affected-side` Scenario of each Variant, the Rescue_Gate_Time is 150 s, the Status_Sentence is the `defaultSentence` again at 220 s, and the Ending becomes `rescued` at 230 s.

**Out of scope:**

- any language model call, network request, API key, setting or new runtime dependency (the Speech_Provider is an interface and a test double only);
- speech in the Clinician_View;
- learner input to the patient (typed or spoken questions);
- audio or text-to-speech;
- new Cases, new Status_Rules, and any change to thresholds, Hold_Durations, Time_Limits, Scheduled_Insults, Status_Rules, Hints, Exam_Rules or other existing clinical text.

### Changes to other specs

None of these specs is edited by this spec, except the four pointer lines of Requirement 10, which a later task adds as doc-only changes.

| Spec and requirement | Change made by this spec | Where |
|---|---|---|
| play-mode glossary Speech_Bubble_Slot ("a later spec will show the patient's speech") | This spec is that later spec. Play-mode 3.9 to 3.12 stay true; a pointer line names this spec | 7.1, 7.2, 10.2 |
| play-mode 2.3 | The Case_Schema gains an optional `play.speech` | 1.1 to 1.4 |
| play-mode 1.4 | View switches also keep the Speech_State | 5.9 |
| bedside-exam 10.8 ("The Speech_Bubble_Slot SHALL stay empty") | No longer true; a pointer line names this spec | 10.1 |
| bedside-exam 10.9 (screen symmetry property) | The property also covers the speech bubble | 8.4 |
| bedside-exam out-of-scope list ("the Speech_Bubble_Slot content") | Scripted content is now in scope; the language model stays out of scope | Introduction |
| engine-mcp 5.1 and 9.4 (Scenario_Result, Record_Body) | Each Mark_Sample row gains a `speech` value, and each Scenario gains a speech table; a pointer line under each names this spec | Requirement 9, 10.3, 10.4 |

### Decisions

1. **Keying by Status_Sentence, plus `early` and `rescued`.** A Status_Speech_Entry names the exact `sentence` of a Status_Rule and lists its lines. The Speech_Selector calls the existing `selectStatus` and looks up the returned sentence, so it needs no matcher of its own, follows the same Vital_Bands (computed from Displayed_Values, play-mode 15.16) and does not depend on the Status_Rule order. A sentence key breaks loudly if the author edits a Status_Rule sentence: the content test of Requirement 2.4 fails. An index key (`rules[2]`) would silently point to another rule after a reorder, and a Status_Rule `id` would change every Status_Rule, which this spec must not do. The `defaultSentence` has no Status_Speech_Entry. It is split by phase (decisions 2 and 4), because the engine returns it both before the insult, in the first 80 s after the insult, and while the patient recovers.
2. **Before the insult: silence.** Before the Earliest_Insult_Time the engine reports baseline vitals and the Status_Sentence is the calm `defaultSentence`. A line there would not follow the body. Silence also makes the first line a clear sign that something has changed, which helps the visitor notice that the patient is getting worse (play-mode 14.2).
3. **`lost` Ending: silence.** The Ending_Screen already shows the sleepy Avatar and the "Rewind and try again" button. A last line from a patient who is lost is the most distressing text a visitor could see, conflicts with the friendly tone of play-mode 3.4, and is the hardest text to review clinically. The Case_Schema therefore has no `lost` list.
4. **`defaultSentence` while the Rescue_Gate_Time is open: silence.** After the affected-side Decompression, the Status_Sentence returns to the `defaultSentence` about 10 s before the Ending becomes `rescued` (engine facts above). Repeating "can't get a breath in" then would contradict the recovery. The `early` lines therefore show only while the Rescue_Gate_Time is `null` or later than the Simulation_Time. In a case without Required_Interventions the gate is always open, so `early` never shows there.
5. **Inputs beyond the Status_Selector's.** The request asked for the Status_Selector's inputs plus the Ending and the Simulation_Time. The Speech_Selector also needs the branch_id (so that no hold crosses Branches), the Rescue_Gate_Time (decision 4) and the previous Speech_State (decision 9). The Earliest_Insult_Time comes from the Case_Definition, which is already an input.
6. **Minimum hold 10 s, rotation 30 s (UI constants).** A new Speech_Key replaces the shown line only after the line has shown for at least Speech_Hold_Seconds = 10 s of Simulation_Time (5 s of Wall_Clock_Time at the default 2x Playback_Speed, 2.5 s at 4x). While the key stays the same, the next line of a list with two or three lines replaces the current one after Speech_Rotate_Seconds = 30 s. Both values are UI display constants defined once in `apps/web/src/lib/`, not clinical values, so they carry no `TODO(author)` marker and stay design-tunable.
7. **An Ending overrides the hold at once.** The `rescued` line appears in the same sample in which the Ending changes, and `lost` silences the bubble at once, because the Ending_Screen opens then (play-mode 7.2).
8. **Deterministic choice.** A new key starts at its first line and rotates in list order (decision 6). The Speech_Selector uses no random value, so tests and recordings repeat.
9. **The hold as a fold.** The caller passes the previous Speech_State and gets the next one. This keeps the Speech_Selector pure and constant-time per sample, and matches the fold style of the Ending_Evaluator (`createOutcomeFold`). Deriving the hold from the full sample history on every call was rejected: it repeats work on every sample and needs the same Branch rules anyway.
10. **Provider results.** The Web_App shows the scripted line at once and asks the Speech_Provider only when the scripted Speech_State changes, not on every sample. A provider result replaces the scripted line only when it passes the Speech_Check, is not stale and arrives within the Provider_Timeout. A provider that resolves with nothing silences the bubble, because silence is always safe. A provider that rejects, throws, times out or returns failing text leaves the scripted line in place.
11. **What is machine-checked.** Machine-checked, in the Case_Schema (and so by `scripts/validate-case.py` and the Case_Loader): the shape, at most 3 lines per key, 1 to 200 characters per line, no `lost` or pre-insult key, and `speech` not being a Variant_Overrides key. Machine-checked by the Speech_Check, in `caseContent.test.ts`, in `scripts/validate-case.py` and at run time: not blank, at most 200 characters, no Diagnosis_Term, no Side_Word, no Forbidden_Speech_Term, no Third_Person_Word. Machine-checked by the case-content test only: every Status_Speech_Entry names an existing Status_Rule sentence, and every line has its `TODO(author)` marker. Author review only: that a line is really first person, short and plain, does not hint at a treatment or exam step in words the Forbidden_Speech_Terms miss, is not advice, fits its Status_Rule, and keeps a friendly tone. The Forbidden_Speech_Terms check is only a partial check for "does not hint at a treatment": it catches the listed words and the exact button texts, not paraphrases.
12. **"chest" is allowed.** The requested early line says "My chest-". The word names where it hurts, as Hint 1 points to the exam, and names no exam step or treatment. It is not in the draft Forbidden_Speech_Terms. Exam_Button texts such as "Look at his chest" are forbidden only as whole phrases.
13. **Calibration record: included.** Adding one value per Mark_Sample and one table per Scenario is small, because the Scenario_Runner already computes the Status_Sentence, the Ending and the Rescue_Gate_Time per Mark_Sample. It is Requirement 9 and stays in this spec (answered question 7).
14. **Python duplicates the text checks.** `scripts/validate-case.py` cannot import the TypeScript Speech_Check, and the request asks for the checks in the script. The script gets its own copy of checks (a) to (f) of Requirement 2.1. This spec adds no Python test and no pytest for the script (answered question 6). The script is verified by running it in a one-off physiology container, the way the case-check hook runs it, and not with the host Python (Requirement 11.6).
15. **The Ending_Screen shows the `rescued` line.** Today the Ending_Screen pulls the Avatar's empty speech band up behind its heading (`EndingScreen.tsx`, "never shows speech"). The `rescued` line would be invisible behind the modal Ending_Screen otherwise, so the Ending_Screen layout changes for `rescued` only.

### Draft content for the author (all `TODO(author)`)

These strings go into `play.speech` of `cases/adult-tension-pneumothorax.yaml`, each with a `TODO(author)` marker that contains "patient-speech spec". None is a verified clinical claim. Each describes how the patient feels in the state named by the Status_Rule; the author checks that each fits.

| Key | Draft line(s) |
|---|---|
| `early` (`defaultSentence` after the insult, gate closed) | "I... can't... get a breath in. My chest-" (requested, demo shot 2); "It hurts... when I try to breathe in." |
| Status_Rule "His lips are turning blue and he is fighting for breath." | "Can't... breathe..."; "Help... me..." |
| Status_Rule "He looks pale and is struggling to breathe." | "It's getting worse... I can't catch my breath."; "Why can't I breathe properly?" |
| Status_Rule "His heart is racing and he looks frightened." | "My heart... it's pounding so hard..." |
| Status_Rule "His heart is beating fast and he looks uneasy." | "My heart's racing. What's happening to me?" |
| Status_Rule "He is breathing faster than normal." | "I can't... slow my breathing down." |
| Status_Rule "He looks clammy and a little faint." | "I feel dizzy... like I might pass out." |
| `rescued` | "Oh... I can breathe again. Thank you." |
| `forbiddenTerms` | "needle", "decompress", "drain", "chest tube", "trapped air", "let the air out", "oxygen", "listen", "stethoscope", "windpipe", "trachea", "neck vein" |

Checked against Requirement 2.1 while drafting: no line contains "pneumothorax", "tension", "left", "right", a listed Forbidden_Speech_Term, "he", "his", "him" or "himself", and the longest line has 46 characters. Note that the Diagnosis_Term check is a substring match, so a line with "extension" would fail on "tension", and a line with "all right" fails the Side_Word check.

### Known limitations

- **The browser can read the lines.** The Speech_Section arrives with the Resolved_Case (bedside-exam decision 12). It is the same in every Variant, so it reveals no side.
- **A reload restarts the speech.** The Speech_State is not stored. After a reload the bubble is empty until the first sample, and the hold starts again.
- **Calibration resolution.** The calibration record folds the Speech_Selector over 10 s Mark_Samples, so its line-change times can differ from the Web_App's, which folds over every received sample (Requirement 9.3).
- **The checks are partial.** The Forbidden_Speech_Terms and the Third_Person_Word checks are word lists. They cannot prove that a line is first person or hints at nothing.
- **A later model provider sees the side.** The Speech_Context holds the Resolved_Case, which names the Affected_Side. The Speech_Check catches only the Side_Words "left" and "right" in the output. The later spec that adds a model provider must address this.
- **The right-side needle gives feedback.** The `early` lines stop when the Rescue_Gate_Time opens, that is, after the Required_Intervention on the Affected_Side. A player who needles the correct side early learns from the silence that it was correct. This is feedback on the player's own action, which bedside-exam Requirement 10 allows, and the exam's "Breathing sounds are coming back on this side." finding already gives the same feedback.

### Answered questions (user review of this document)

1. **Keying (decision 1).** Accepted: key by Status_Sentence, with `early` and `rescued` lists.
2. **Silence before the insult and at `lost` (decisions 2 and 3).** Accepted: silence in both. The Case_Schema has no `lost` list.
3. **Silence while recovering (decision 4).** Accepted: silence for the `defaultSentence` once the Rescue_Gate_Time is open. No `recovering` list.
4. **Hold and rotation values (decision 6).** Accepted: 10 s hold and 30 s rotation of Simulation_Time, as UI constants.
5. **Provider returning nothing (decision 10).** Accepted: a provider result of nothing silences the bubble.
6. **Python test for `validate-case.py` (decision 14).** No pytest. The script is verified by running it in a one-off physiology container, as the case-check hook does, never with the host Python (Requirement 11.6).
7. **Calibration record (decision 13).** Accepted: the speech table is part of this spec. Because the Engine_MCP_Server is currently disconnected from Kiro, the recording uses the Engine_CLI (Requirement 9.6, 9.7).
8. **Further pointer lines.** Accepted: one-line pointers in the style of the bedside-exam 10.8 pointer also go under the play-mode Speech_Bubble_Slot glossary entry and under engine-mcp 5.1 and 9.4, and nothing else changes in those specs (Requirement 10).

### Still open

1. **Forbidden_Speech_Terms (decision 11).** The author confirms or edits the draft list. Until then every entry keeps its `TODO(author)` marker.

## Glossary

Terms from core-simulation-loop, play-mode, bedside-exam and engine-mcp keep their meaning in those specs: **Case**, **Case_Definition**, **Case_Loader**, **Case_Schema**, **Case_API**, **Session**, **Branch**, **Checkpoint**, **Pulse_Engine**, **Physiology_Service**, **Web_App**, **Intervention**, **Scheduled_Insult**, **Simulation_Time**, **Wall_Clock_Time**, **Playback_Speed**, **Vitals_Stream**, **VitalSigns**, **Fork_API**, **Clinician_View**, **Play_View**, **View_Switcher**, **Play_Section**, **Play_Label**, **Avatar**, **Speech_Bubble_Slot**, **Vital_Band**, **Displayed_Value**, **Status_Rule**, **Status_Sentence**, **Status_Selector**, **Diagnosis_Terms**, **Required_Interventions**, **Rescue_Gate_Time**, **Earliest_Insult_Time**, **Gate_Entry**, **Ending**, **Ending_Evaluator**, **Ending_Screen**, **Hint**, **Branch_Lineage**, **Active_Interventions**, **Safety_Notice**, **Variant**, **Variant_Id**, **Variant_Overrides**, **Override_Target**, **Case_Resolver**, **Resolved_Case**, **Affected_Side**, **Exam_Action**, **Exam_Button**, **Active_Exam_Entries**, **Side_Word**, **Engine_MCP_Server**, **Engine_CLI**, **Scenario_Runner**, **Scenario_Result**, **Mark_Sample**, **Sample_Interval**, **Calibration_Record**, **Record_Body**, **Calibration_Checks**.

- **Speech_Section**: The optional `speech` object in the Play_Section, holding the Status_Speech_Entries, the Early_Lines, the Rescued_Lines, the case's Forbidden_Speech_Terms list and optional `references`
- **Speech_Line**: One string in a list of the Speech_Section, shown as the patient's speech
- **Status_Speech_Entry**: An entry of `speech.status`: a `sentence`, which names one Status_Rule `sentence` exactly, and its `lines`
- **Early_Lines**: The optional `speech.early` list, used for the `defaultSentence` after the Earliest_Insult_Time while the Rescue_Gate_Time is not open
- **Rescued_Lines**: The optional `speech.rescued` list, used while the Ending is `rescued`
- **Speech_Key**: The list that the Speech_Selector uses for a sample: `silent`, `early`, `rescued`, or `status:<sentence>` for a Status_Speech_Entry. `silent` has no lines
- **Speech_State**: The Speech_Selector's output and its next previous-state input: the branch_id, the Speech_Key, the line index, the Simulation_Time from which the current line has shown (`since`), and the Speech_Line or none
- **Speech_Selector**: The pure function that computes the next Speech_State (Requirements 4 and 5)
- **Scripted_Line**: The Speech_Line of the current Speech_State, or none
- **Speech_Check**: The pure function that lists the failures of a text against the rules of Requirement 2.1 for a Case_Definition
- **Forbidden_Speech_Terms**: The strings that no spoken text may contain: the case's `speech.forbiddenTerms`, every Intervention `label` and Play_Label, and every Exam_Button text (`label`, `labels.Left`, `labels.Right`) of the Case_Definition
- **Third_Person_Word**: One of the words "he", "his", "him" or "himself" as a whole word, compared case-insensitively
- **Speech_Hold_Seconds**: The minimum Simulation_Time a line shows before another Speech_Key can replace it; 10 s, a UI constant (decision 6)
- **Speech_Rotate_Seconds**: The Simulation_Time after which the next line of the same Speech_Key replaces the current one; 30 s, a UI constant (decision 6)
- **Speech_Provider**: The async interface that turns a Speech_Context into a text or nothing
- **Scripted_Speech_Provider**: The Speech_Provider of this spec, which returns the Scripted_Line of the Speech_Context
- **Speech_Context**: The object a Speech_Provider receives (Requirement 6.2)
- **Speech_Request**: One call of the Speech_Provider by the Web_App, identified by the branch_id and a request number that increases within the Session
- **Stale_Result**: A Speech_Provider result for a Speech_Request after which the current Branch changed, the Ending changed, or a newer Speech_Request was issued
- **Provider_Timeout**: 5 seconds of Wall_Clock_Time from a Speech_Request; a UI constant
- **Displayed_Speech**: The text that the Speech_Bubble_Slot shows, or none

## Requirements

### Requirement 1: Speech section in the case file

**User Story:** As a case author, I want the patient's lines in the case file, so that every line is reviewable content and not hard-coded in the UI.

This requirement extends play-mode Requirement 2.

#### Acceptance Criteria

1. THE Case_Schema SHALL define `speech` as an optional property of the Play_Section, so that a Play_Section without `speech` validates with the same result as before this spec.
2. THE Case_Schema SHALL define the Speech_Section as an object with only these optional properties, and SHALL reject any other property in the Speech_Section and in every object nested inside it:
   - `status`: an array of 0 to 20 Status_Speech_Entries, each with the required properties `sentence` (a string of 1 to 80 characters, the length limit of a Status_Rule sentence in play-mode 2.9) and `lines` (a Speech_Line list);
   - `early`: a Speech_Line list;
   - `rescued`: a Speech_Line list;
   - `forbiddenTerms`: an array of 1 to 30 strings, each 1 to 60 characters;
   - `references`: an array of 1 or more non-empty citation strings.
3. THE Case_Schema SHALL define a Speech_Line list as an array of 1 to 3 strings, each 1 to 200 characters, the text limit of play-mode 3.9.
4. THE Case_Schema SHALL define no list for the `lost` Ending and no list for the time before the insult (decisions 2 and 3), so that a Speech_Section with such a property is rejected under criterion 2.
5. THE Case_Schema SHALL keep `speech` out of the Variant_Overrides properties, so that the Speech_Section is not an Override_Target, and a Variant whose `overrides` contain `speech` is rejected by the Case_Schema and, when the schema file is missing, by the Case_Resolver's unknown-key rule (bedside-exam 1.10), with no file under `services/physiology/` changed.
6. WHEN the Physiology_Service creates a Session for a case file with a Speech_Section, THE Case_API SHALL return the Speech_Section in the Resolved_Case with values equal to those in the case file, with no file under `services/physiology/` changed.
7. IF a case file contains a Speech_Section that violates the Case_Schema, THEN `scripts/validate-case.py` SHALL report a validation failure that names the path of the violating field and SHALL exit with a non-zero status, and THE Case_Loader SHALL refuse the Case with its existing case-load error (play-mode 2.17, 2.18).

### Requirement 2: Speech checks

**User Story:** As a case author, I want the lines checked automatically where a machine can check them, so that no line names the diagnosis, the side, or a button the learner must find.

#### Acceptance Criteria

1. THE Web_App SHALL define the Speech_Check once, as a pure function in `apps/web/src/lib/`, that takes a text and a Case_Definition and returns one failure message for each of these rules the text breaks:
   - (a) the text is empty or contains only whitespace;
   - (b) the text has more than 200 characters, counted as Unicode code points as the Case_Schema `maxLength` counts them;
   - (c) the text contains a Diagnosis_Term of the Play_Section, by case-insensitive substring match (as play-mode 2.19);
   - (d) the text contains a Side_Word;
   - (e) the text contains a Forbidden_Speech_Term, by case-insensitive substring match;
   - (f) the text contains a Third_Person_Word.
2. THE web test suite SHALL run the Speech_Check on every Speech_Line of every Resolved_Case of `cases/adult-tension-pneumothorax.yaml` and SHALL report each failure with the Variant_Id, the field path, the line text and the broken rule.
3. WHEN `scripts/validate-case.py <case-file>` is run, as Requirement 11.6 describes, on a case file with a Speech_Section, THE script SHALL apply rules (a) to (f) of criterion 1 to every Speech_Line of the Base_Case and of every Resolved_Case, SHALL report each failure with the field path, the line text and the broken rule, and SHALL exit with a non-zero status when any line fails (decision 14).
4. THE web test suite SHALL verify for `cases/adult-tension-pneumothorax.yaml` that each Status_Speech_Entry `sentence` is character-for-character equal to the `sentence` of at least one Status_Rule and differs from the `defaultSentence`, and that no two Status_Speech_Entries have the same `sentence`, and SHALL name each failing entry.
5. THE web test suite SHALL verify for `cases/adult-tension-pneumothorax.yaml` that every Speech_Line and every `forbiddenTerms` entry has a comment containing `TODO(author)` and "patient-speech spec" on its source line or on the comment-only line directly above, unless `play.speech.references` is non-empty, in the style of play-mode 2.15.
6. IF `cases/adult-tension-pneumothorax.yaml` has no Speech_Section, THEN the case-content tests of criteria 2, 4 and 5 SHALL fail and SHALL NOT pass with nothing to check (as play-mode 12.9).
7. THE project SHALL treat these properties of a Speech_Line as author review, recorded by its `TODO(author)` marker or a `references` entry, and SHALL NOT claim them as machine-checked: the line is in the first person; it is short and plain; it names and hints at no treatment and no exam step beyond what the Forbidden_Speech_Terms catch; it contains no instruction or recommendation addressed to the reader and is not medical advice; it fits the state of its Status_Rule or Ending; and it keeps the friendly tone of play-mode 3.4.

### Requirement 3: Speech content for the tension pneumothorax case

**User Story:** As a visitor, I want the patient to say a few short things that match how he is doing, so that I feel his distress and his relief.

#### Acceptance Criteria

1. THE `cases/adult-tension-pneumothorax.yaml` file SHALL define a Speech_Section with one Status_Speech_Entry for each Status_Rule, in Status_Rule order, each with 1 or 2 lines; Early_Lines with 1 or 2 lines, the first of which is "I... can't... get a breath in. My chest-"; Rescued_Lines with 1 line; and a `forbiddenTerms` list.
2. THE draft lines and the draft `forbiddenTerms` SHALL follow the table "Draft content for the author" in this document until the author replaces them.
3. THE `cases/adult-tension-pneumothorax.yaml` file SHALL give every Speech_Line and every `forbiddenTerms` entry the `TODO(author)` marker of Requirement 2.5.
4. THE `cases/adult-tension-pneumothorax.yaml` file SHALL define the Speech_Section once, in the Play_Section of the Base_Case, and in no Variant.

### Requirement 4: Choosing the line

**User Story:** As a visitor, I want the patient's words to follow his condition, so that what he says matches what I see.

#### Acceptance Criteria

1. THE Speech_Selector SHALL be a pure function in `apps/web/src/lib/` of: the most recent VitalSigns sample of the current Branch (or none), the Case_Definition, the Ending, the Simulation_Time of that sample, the current branch_id, the Rescue_Gate_Time, and the previous Speech_State (or none). It SHALL return a Speech_State, and SHALL read no Wall_Clock_Time, network, random value, Variant_Id, Intervention_Record, Exam_Record or state outside these inputs.
2. THE Speech_Selector SHALL choose the target Speech_Key by the first rule in this list that applies:
   - `rescued` WHEN the Ending is `rescued` and the Speech_Section has Rescued_Lines, and `silent` WHEN the Ending is `rescued` without Rescued_Lines;
   - `silent` WHEN the Ending is `lost` (decision 3);
   - `silent` WHEN there is no sample, or the Case_Definition has no Speech_Section;
   - `silent` WHEN the Earliest_Insult_Time is defined and the Simulation_Time is less than it (decision 2);
   - `status:<sentence>` WHEN the Status_Selector (play-mode 5.2 to 5.5) returns a Status_Rule sentence that has a Status_Speech_Entry, and `silent` WHEN that sentence has none;
   - `early` WHEN the Status_Selector returns the `defaultSentence`, the Speech_Section has Early_Lines, and the Rescue_Gate_Time is `null` or greater than the Simulation_Time;
   - `silent` in every other case, including the `defaultSentence` while the Rescue_Gate_Time is less than or equal to the Simulation_Time (decision 4).
3. THE Speech_Selector SHALL obtain the Status_Sentence by calling the existing Status_Selector function `selectStatus` with the same sample, Case thresholds and Play_Section, and SHALL compute no Vital_Band of its own.
4. THE Speech_Selector SHALL set the Speech_Line of the returned Speech_State to the entry at the Speech_State's line index in the list of its Speech_Key, or to none for `silent`.
5. FOR ALL inputs, THE Speech_Selector SHALL return a Speech_Line that is character-for-character equal to one Speech_Line of the Case_Definition's Speech_Section, or none, and SHALL compose, alter or generate no other text.
6. FOR ALL inputs, THE Speech_Selector SHALL return equal Speech_States when called twice with equal inputs (determinism property).
7. IF the Scripted_Line fails the Speech_Check, THEN THE Web_App SHALL show no speech for that line. This is a defensive fallback for a case that the Case_Loader loaded without schema validation.
8. WHERE the Case_Definition has no Speech_Section, THE Play_View SHALL keep the Speech_Bubble_Slot empty, with play-mode 3.10 unchanged.

### Requirement 5: Minimum hold and timeline changes

**User Story:** As a visitor, I want each line to stay long enough to read, and the patient to speak for the timeline I am in, so that the bubble neither flickers nor repeats lines from a timeline I rewound.

#### Acceptance Criteria

1. WHILE the Ending is `none` and the previous Speech_State has the current branch_id and a `since` less than or equal to the Simulation_Time, WHEN the target Speech_Key differs from the previous Speech_Key, THE Speech_Selector SHALL keep the previous Speech_State if the Simulation_Time minus `since` is less than Speech_Hold_Seconds, and SHALL otherwise return the target Speech_Key with line index 0 and `since` equal to the Simulation_Time.
2. WHEN the Ending is `rescued` or `lost` and the target Speech_Key differs from the previous Speech_Key, THE Speech_Selector SHALL return the target Speech_Key with line index 0 and `since` equal to the Simulation_Time, whatever the hold (decision 7).
3. WHEN the target Speech_Key equals the previous Speech_Key on the same Branch, THE Speech_Selector SHALL keep the previous line index and `since`, unless the key's list has more than one line and the Simulation_Time minus `since` is at least Speech_Rotate_Seconds, in which case it SHALL return the next line index in list order, wrapping from the last line to the first, with `since` equal to the Simulation_Time.
4. IF the previous Speech_State is none, has a branch_id other than the current branch_id, or has a `since` greater than the Simulation_Time, THEN THE Speech_Selector SHALL ignore it and return the target Speech_Key with line index 0 and `since` equal to the Simulation_Time, so that no hold or line index is carried from another Branch.
5. WHEN the Fork_API returns a new current Branch, THE Web_App SHALL show no speech until the first VitalSigns sample of the new Branch arrives, and SHALL then show the Speech_State that the Speech_Selector computes from that sample with no previous Speech_State.
6. IF the Fork_API request fails, THEN THE Web_App SHALL keep the Speech_State and the Displayed_Speech unchanged.
7. THE Web_App SHALL compute the Speech_State by folding the Speech_Selector over the VitalSigns samples of the current Branch in the order the Ending_Evaluator accepts them (play-mode 6.8), so that the same sample sequence, Ending sequence and Rescue_Gate_Time sequence give the same sequence of Speech_Lines at every Playback_Speed and on every replay.
8. WHILE playback is paused, THE Web_App SHALL keep the Displayed_Speech unchanged, because no new sample arrives.
9. WHEN the learner switches view with the View_Switcher, THE Web_App SHALL keep the Speech_State and the Displayed_Speech unchanged (extends play-mode 1.4).
10. THE Web_App SHALL define Speech_Hold_Seconds (10) and Speech_Rotate_Seconds (30) once, as UI constants in `apps/web/src/lib/`, and SHALL read neither from the case file.

### Requirement 6: Speech_Provider seam

**User Story:** As a maintainer, I want one interface for where the patient's words come from, so that a later spec can add a language model without changing the Play_View or weakening the checks.

#### Acceptance Criteria

1. THE Web_App SHALL define a `SpeechProvider` interface in `apps/web/src/lib/` with one method that takes a Speech_Context and an `AbortSignal` and returns a promise of a text or nothing.
2. THE Speech_Context SHALL contain: the Speech_Request's branch_id and request number; the Case_Definition; the most recent VitalSigns sample of the current Branch (or none); its Simulation_Time; the Ending; the Rescue_Gate_Time; the current Speech_State and Scripted_Line; the newest 5 or fewer Active_Interventions; and the newest 5 or fewer Active_Exam_Entries.
3. THE Web_App SHALL use the Scripted_Speech_Provider as its only Speech_Provider, which SHALL resolve with the Scripted_Line of the Speech_Context and make no other call. This spec SHALL add no setting, environment variable or API key that selects another provider.
4. WHEN the Speech_Key or the line index of the Speech_State changes, or the current Branch changes, THE Web_App SHALL issue exactly one Speech_Request, SHALL abort the signal of the previous pending Speech_Request, and SHALL issue no Speech_Request for a sample that leaves the Speech_State unchanged or for a view switch.
5. WHEN the Web_App issues a Speech_Request, THE Web_App SHALL show the Scripted_Line (after Requirement 4.7) as the Displayed_Speech within 500 ms of Wall_Clock_Time of receiving the sample, without waiting for the Speech_Provider.
6. WHEN a Speech_Provider resolves within the Provider_Timeout with a text that passes the Speech_Check, and the result is not a Stale_Result, THE Web_App SHALL show that text as the Displayed_Speech.
7. WHEN a Speech_Provider resolves within the Provider_Timeout with nothing, and the result is not a Stale_Result, THE Web_App SHALL show no speech (decision 10).
8. IF a Speech_Provider rejects, throws, does not resolve within the Provider_Timeout, or resolves with a text that fails the Speech_Check, THEN THE Web_App SHALL keep the Scripted_Line as the Displayed_Speech and SHALL show no error message to the learner.
9. IF a Speech_Provider result is a Stale_Result, THEN THE Web_App SHALL discard it and leave the Displayed_Speech unchanged.
10. THE Web_App SHALL use no Speech_Provider result for anything other than the Displayed_Speech: not for the Ending, the Status_Sentence, the Avatar_Parameters or any record.
11. THE Web_App SHALL implement this requirement with no model call, no network request, no API key, no new setting and no new runtime dependency in `apps/web/package.json`. Test doubles for a Speech_Provider SHALL live in test code only.

### Requirement 7: Showing speech

**User Story:** As a visitor, I want to see and hear each new line once, so that I notice what the patient says without being flooded.

#### Acceptance Criteria

1. WHILE the Play_View is displayed, THE Play_View SHALL pass the Displayed_Speech into the Speech_Bubble_Slot of its Avatar, so that the bubble shows the full text as play-mode 3.9 and 3.11 require.
2. WHILE there is no Displayed_Speech, THE Play_View SHALL leave the Speech_Bubble_Slot empty, as play-mode 3.10 requires.
3. WHILE the Ending_Screen shows the `rescued` Ending and there is a Displayed_Speech, THE Ending_Screen SHALL show the Displayed_Speech in full in the Speech_Bubble_Slot of its Avatar. At a 1280 × 720 CSS pixel viewport at 100% zoom, the bubble SHALL overlap none of the heading, the text "He's breathing again.", the Side_Reveal_Text and the controls, and all of them SHALL be visible without scrolling, verified through manual inspection during acceptance testing.
4. WHILE the Ending_Screen shows the `lost` Ending, THE Ending_Screen SHALL show no speech bubble and SHALL keep its current layout.
5. THE Play_View SHALL contain one ARIA live region with `polite` priority that contains only the Displayed_Speech, separate from the Status_Sentence live region (play-mode 5.11) and the exam live region (bedside-exam 6.10).
6. WHEN the Displayed_Speech changes to a new text, THE live region of criterion 5 SHALL contain that text, so that assistive technology announces it once. WHEN a sample leaves the Displayed_Speech unchanged, THE live region text SHALL stay unchanged. WHEN the Displayed_Speech becomes none, THE live region SHALL become empty.
7. WHILE the Ending_Screen is open, THE live region of criterion 5 SHALL be inside the Ending_Screen dialog, so that the `rescued` line is announced while the dialog is modal.
8. THE Clinician_View SHALL show no speech and no speech live region, and SHALL render the same markup with and without a Speech_Section in the Case_Definition.
9. THE Avatar SHALL keep its accessible name equal to the Status_Sentence (play-mode 3.8); the Displayed_Speech SHALL not change it.
10. WHILE the browser viewport is 1280 × 720 CSS pixels at 100% zoom, THE Play_View SHALL keep play-mode 11.7 and 11.8 true with a 200-character Displayed_Speech, verified through manual inspection during acceptance testing.

### Requirement 8: The same words on both sides

**User Story:** As a visitor, I want nothing the patient says to tell me the side, so that the bedside exam is still worth doing.

#### Acceptance Criteria

1. FOR ALL pairs of Resolved_Cases of one Base_Case, the Speech_Sections SHALL be deep-equal, and the web test suite SHALL verify this for `cases/adult-tension-pneumothorax.yaml`, naming the differing path.
2. THE Speech_Selector SHALL read no Variant_Id, no Affected_Side and no Scheduled_Insult side.
3. FOR ALL VitalSigns samples, Endings, Simulation_Times, branch_ids, Rescue_Gate_Times and previous Speech_States, THE Speech_Selector SHALL return equal Speech_States for the `left` and the `right` Resolved_Case (side symmetry property).
4. THE screen symmetry property of bedside-exam 10.9 SHALL also hold with the Speech_Section present, including the Speech_Bubble_Slot and the speech live region.

### Requirement 9: Speech in the calibration record

**User Story:** As the case author, I want the calibration record to show when each line appears in a real engine run, so that I can review the lines against the engine's timeline.

This requirement extends engine-mcp Requirements 5.1 and 9.4.

#### Acceptance Criteria

1. THE Scenario_Result SHALL contain, for each Mark_Sample, a `speech` value: the Scripted_Line that the Speech_Selector returns when folded over the Scenario's Mark_Samples in order, with the Ending after each Mark_Sample and the Rescue_Gate_Time the Scenario_Runner applies before it, or `null` for silence.
2. THE Record_Body SHALL contain, for each Scenario, a speech table with one row for each Mark_Sample at which the Scripted_Line changes, including the first Mark_Sample, holding its Simulation_Time, the Speech_Key (`silent`, `early`, `rescued`, or the Status_Rule path `play.status.rules[<index>]`) and the line, or "silent".
3. THE Record_Body SHALL state, under each speech table, the fixed sentence: "Speech lines are computed on the Mark_Samples; the Web_App computes them on every received sample, so its line changes can come up to one Sample_Interval earlier or later."
4. WHERE the Resolved_Case has no Speech_Section, THE Record_Body SHALL state "Speech: none (the case has no speech section)" for each Scenario.
5. THE speech values SHALL change no Calibration_Check, no Ending and no other content of the Scenario_Result or the Record_Body.
6. THE calibration recording of this spec SHALL use the Engine_CLI by default: from `apps/web/`, the command `./node_modules/.bin/vite-node --config vitest.config.ts scripts/engineCli.ts -- calibrate --case adult-tension-pneumothorax`, run first without `--write` and then exactly once with `--write`, each through a shell command with a timeout of at least 1,800,000 ms, against a Physiology_Service that is already running and that the run does not start, stop or restart; IF the Engine_MCP_Server process started after the last code commit of this spec AND its tools respond, THEN the recording MAY use the MCP tool `run_calibration` instead, and the run report SHALL state which of the two paths was used.
7. WHEN the calibration run with `--write` ends, THE run report SHALL contain the speech table of Requirement 9.2 for each Scenario of the new Calibration_Record, and the CLI exit code.

### Requirement 10: Pointers in other specs

**User Story:** As a maintainer, I want the older specs to point to this spec where they describe the empty speech slot or the calibration output, so that a reader does not take those statements as complete.

#### Acceptance Criteria

1. A later task of this spec SHALL add, directly under bedside-exam Requirement 10.8 in `.kiro/specs/bedside-exam/requirements.md`, exactly one indented line: "   - Since patient-speech: the Speech_Bubble_Slot shows the scripted speech lines of `.kiro/specs/patient-speech/`. They contain no Side_Word and are the same in every Variant (patient-speech Requirements 2 and 8)."
2. The same task SHALL add, directly under the glossary entry **Speech_Bubble_Slot** in `.kiro/specs/play-mode/requirements.md`, exactly one indented line: "  - Since patient-speech: the Speech_Bubble_Slot shows the scripted speech lines of `.kiro/specs/patient-speech/` in the Play_View and on the `rescued` Ending_Screen (patient-speech Requirements 4 and 7)."
3. The same task SHALL add, directly under engine-mcp Requirement 5.1 in `.kiro/specs/engine-mcp/requirements.md`, exactly one indented line: "   - Since patient-speech: each Mark_Sample also has a `speech` value, the Scripted_Line or `null` (patient-speech Requirement 9.1)."
4. The same task SHALL add, directly under engine-mcp Requirement 9.4 in `.kiro/specs/engine-mcp/requirements.md`, exactly one indented line: "   - Since patient-speech: the Record_Body also contains a speech table for each Scenario (patient-speech Requirements 9.2 to 9.4)."
5. The task of criteria 1 to 4 SHALL be a doc-only change and SHALL change no other line of any other spec.

### Requirement 11: Constraints

**User Story:** As the author, I want this feature to change nothing else, so that the calibrated case and the other specs stay as they are.

#### Acceptance Criteria

1. THE implementation SHALL change no file under `services/physiology/`.
2. THE implementation SHALL change no threshold, Hold_Duration, Time_Limit, Scheduled_Insult, Status_Rule, Hint, Exam_Rule, Play_Label, Goal_Text, Side_Reveal_Text, Variant or other existing text or comment in `cases/adult-tension-pneumothorax.yaml`, and SHALL remove no `TODO(author)` marker anywhere. The diff of the case file SHALL consist only of the added `play.speech` block.
3. THE implementation SHALL add no runtime dependency to `apps/web/package.json` and SHALL make no network request for speech.
4. WHEN an implementation task of this spec ends, `npx tsc --noEmit` and `npx vitest --run`, run from `apps/web/`, SHALL both pass.
5. THE web tests of this spec SHALL run while the Physiology_Service and the Pulse_Engine are not running and SHALL open no HTTP or WebSocket connection (play-mode 12.11).
6. WHEN `scripts/validate-case.py` is run on `cases/adult-tension-pneumothorax.yaml` after the case-file change, THE script SHALL report that the Base_Case and both Resolved_Cases are valid and that every Speech_Line passes, and SHALL exit with status 0. WHEN it is run on a copy of the case file with one Speech_Line containing a Side_Word, THE script SHALL exit with a non-zero status. Both runs SHALL use a one-off physiology container in the way of `scripts/hooks/case-check.mjs` (the command of `.kiro/hooks/case-check.json`), and not the host Python:
   - the image `stitched-patient-physiology` is built beforehand by the user in their own terminal (`docker compose build physiology`); the run builds no image;
   - the command, from the repository root, is `docker compose run -T --rm --no-deps -v "<repository root>:/repo:ro" -w /repo -e PYTHONDONTWRITEBYTECODE=1 physiology python3 scripts/validate-case.py cases/adult-tension-pneumothorax.yaml`;
   - the copy for the failing run lies outside the repository, is added with one more read-only mount (`-v "<copy>:/tmp/speech-side-word.yaml:ro"`), and is passed as `/tmp/speech-side-word.yaml`;
   - no run uses `docker compose up`, `down`, `stop` or `restart`.
7. THE Web_App SHALL keep the Safety_Notice visible in the Play_View, the Clinician_View and the Ending_Screen (play-mode 1.8), and no code comment or document of this spec SHALL present a Speech_Line as clinical fact or advice.

### Requirement 12: Automated tests

**User Story:** As a maintainer, I want the speech logic covered by fast tests, so that later changes cannot make the bubble flicker, leak the side or show unchecked text.

#### Acceptance Criteria

1. THE web test suite SHALL include Vitest unit tests for the Speech_Check with one failing text per rule (a) to (f) of Requirement 2.1, a text of exactly 200 and one of 201 code points, a Side_Word inside a longer word ("alright" passes), a Forbidden_Speech_Term taken from an Intervention `label`, a Play_Label and an Exam_Button text, and a passing text.
2. THE web test suite SHALL include Vitest unit tests for the Speech_Selector with fixed inputs for each rule of Requirement 4.2, including: silence before the Earliest_Insult_Time and at exactly that time the `early` key; a Status_Rule sentence without a Status_Speech_Entry; the `defaultSentence` with the Rescue_Gate_Time `null`, greater than, equal to and less than the Simulation_Time; `rescued` with and without Rescued_Lines; `lost`; no sample; and no Speech_Section.
3. THE web test suite SHALL include Vitest unit tests for Requirement 5: a key change at Speech_Hold_Seconds minus 1 s is held and at exactly Speech_Hold_Seconds is not; an Ending overrides the hold; rotation at Speech_Rotate_Seconds and wrapping; a one-line list never rotates; a previous Speech_State from another Branch or with a later `since` is ignored; and a fixed sequence modelled on the `left` affected-side Scenario of the engine facts in the Introduction (default sentence 0 to 100 s, Status_Rules from 110 s, Rescue_Gate_Time 150 s, default sentence at 220 s, `rescued` at 230 s) that gives silence before 30 s, the `early` line from 30 s, silence at 220 s and the Rescued_Lines line at 230 s.
4. THE web test suite SHALL include Vitest property tests, each against no fewer than 100 generated inputs from a fixed seed (play-mode 12.10), for: determinism (4.6); line membership (4.5); the hold, that on one Branch with the Ending `none` two consecutive Speech_Key changes are at least Speech_Hold_Seconds of Simulation_Time apart; Branch isolation, that a previous Speech_State from another Branch gives the same result as none; and side symmetry (8.3).
5. THE web test suite SHALL include Vitest tests of the Speech_Provider handling with test doubles that resolve with valid text, resolve with nothing, resolve with text that fails each Speech_Check rule, reject, throw, resolve after the Provider_Timeout, and resolve after a fork, after an Ending change and after a newer Speech_Request; each SHALL show the Displayed_Speech that Requirement 6 requires, with the API client mocked and no network function called.
6. THE web test suite SHALL include Vitest tests of the rendered Play_View and Ending_Screen for Requirement 7.1, 7.2, 7.4 to 7.9: the bubble text, the empty slot, the single speech live region and its contents across repeated and changed lines, the live region inside the Ending_Screen, no bubble on the `lost` Ending_Screen, and equal Clinician_View markup with and without a Speech_Section.
7. THE web test suite SHALL include the case-content tests of Requirements 2.2, 2.4, 2.5, 2.6, 3.1, 3.4 and 8.1, and a test that reads `cases/case-schema.json` and checks that the Variant_Overrides definition has no `speech` property and rejects additional properties (Requirement 1.5).
8. WHERE the engine-mcp tests cover the Scenario_Result and the Record_Body, THE web test suite SHALL extend them with fixed Mark_Samples for Requirement 9.1 to 9.4.
