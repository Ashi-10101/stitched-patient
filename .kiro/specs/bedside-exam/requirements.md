# Requirements Document

## Introduction

Bedside exam turns the Play_View from "watch and press" into "find out and act". Today the adult tension pneumothorax is always on the patient's left, and the Play_View shows it: the Avatar's left chest half swells as soon as the insult starts, and Hint 2 names the side. A player can press the left needle without examining anyone.

This spec makes three changes:

1. **Side variants.** A Case may list Variants. The adult-tension-pneumothorax Case gets two, `left` and `right`, which set the side of the `SETensionPneumothorax` Scheduled_Insult. The Physiology_Service picks one Variant per Session uniformly at random, unless the create request names one, and serves the Resolved_Case for that Variant.
2. **Bedside examination in the Play_View.** A new group of Exam_Buttons above "What can you do?" lets the player look at the chest, listen to each side, feel the windpipe and look at the neck veins. Each button shows an Exam_Finding chosen by side-relative rules from the Resolved_Case. Exam_Buttons call no engine endpoint and take no Simulation_Time. Each finding is kept in an Exam_Record for scoring later.
3. **No giveaway.** Before an Ending, nothing on screen reveals the Affected_Side unless the player found it by examining, chose it with a needle, or asked for the last Hint. After an Ending, the Ending_Screen states the side.

This spec builds on the play-mode spec (`.kiro/specs/play-mode/requirements.md`) and the core-simulation-loop spec (`.kiro/specs/core-simulation-loop/requirements.md`). It does not edit either spec. Where it changes their behaviour, the criterion names the requirement it changes, and the table "Changes to other specs" lists them all, so that the author can update those specs afterwards.

**Scope boundary.** Play-mode's Introduction states that play-mode changes no code or behaviour in `services/physiology/`. This spec is the one place that lifts that boundary. It may change, in `services/physiology/`: session creation (`main.py`, `models.py`, `session_manager.py`), case loading and validation (`case_loader.py`), the Session metadata, and their pytest tests. It also changes `cases/case-schema.json`, `cases/adult-tension-pneumothorax.yaml`, `scripts/validate-case.py` and `apps/web/`. It changes no Pulse_Engine action, no Intervention and no Scheduled_Insult other than the insult side.

**Clinical safety.** Every exam label, Exam_Finding sentence, Hint text and Side_Reveal_Text in this spec is draft clinical content. In the case file each one carries a `TODO(author)` marker or a citation in a `references` field, for review by the author, a clinical medicine student. This document contains no clinical numbers, and it does not decide which Vital_Bands gate a late sign: those are clinical decision criteria and stay `TODO(author)` in the case file. Pulse_Engine does not model breath sounds, tracheal position or neck veins. Exam_Findings are scripted text chosen from the insult state, the Decompression state and the Vital_Bands, not engine output.

**Out of scope and non-goals:**

- the talking patient (LLM) and the Speech_Bubble_Slot content;
- scoring and debrief, including any use of the Exam_Record beyond recording it;
- new Cases, new Interventions, new Pulse actions, and any change to insult severity, type or timing;
- exam actions in the Clinician_View (decision 9);
- tapping (percussion) in this case's content (decision 8);
- a demo mode that chooses the Variant from the Web_App;
- hiding the Resolved_Case or the Variant_Id from a player who opens the browser's developer tools (decision 12).

### Changes to other specs

| Spec and requirement | Change made by this spec | Where |
|---|---|---|
| play-mode Introduction, scope boundary ("changes no code or behaviour in `services/physiology/`") | Lifted for session creation, case loading and validation, and Session metadata | Introduction |
| play-mode 2.2, 2.3 | The Case_Schema gains optional `variants`, `play.exam` and `play.sideRevealText` | 1.1 to 1.3, 4.1 to 4.6, 12.1 |
| play-mode 2.12, 2.17 | `scripts/validate-case.py` also resolves and checks every Variant | 1.11, 1.12 |
| play-mode 2.13, 2.18 | No longer "with no file under `services/physiology/` changed"; `GET /sessions/{id}/case` returns the Resolved_Case | 3.8 |
| play-mode 2.23 and its test in 12.17 | The single `needle-decompression-left` entry holds for the Base_Case and the `left` Variant; the `right` Variant lists `needle-decompression-right` | 2.3, 2.4, 2.6 |
| play-mode 3.59, 4.13, 4.14, 4.15 (second sentence), 4.17 | The Avatar draws Shown_Swollen_Sides, which hide a side until it is in Found_Sides | 9.1 to 9.4 |
| play-mode 7.3, 7.4 | The Ending_Screen also shows the Side_Reveal_Text and the Avatar with the ungated Swollen_Sides | 9.5, 12.2 |
| play-mode 9.7, 9.8, 12.7 | Hints 1 and 2 become side-neutral and point to the exam; the last Hint is per Variant; the Hint checks run per Resolved_Case | 11.1 to 11.5 |
| play-mode 1.4, 11.2, 11.3, 11.4, 11.7, 11.8, 11.11 | View switches keep the Exam_Record; focus order, keyboard use, text size and the 1280 × 720 layout include the exam group | 6.10 to 6.15 |
| play-mode 12.2 | Side tests cover a `Right` insult as well as a `Left` one | 14.12 |
| play-mode 13 (calibration) and tasks 12.1, 12.2 | Must request each Variant by id and run the scenarios per Variant | Requirement 13 |
| play-mode 14.3, 14.4, 14.7 | The acceptance demo names "the Decompression on the Affected_Side" and "on the Other_Side" in place of left and right | 13.9 |
| core-simulation-loop 1.2, 1.4 | Case validation also covers each Variant's Resolved_Case | 1.7 to 1.10 |
| core-simulation-loop 2.1, 2.2, 2.8 | The create request takes an optional `variant_id`; Session metadata includes `variant_id` | 3.1 to 3.6, 3.9 |
| core-simulation-loop 9.1, 9.5 | Determinism holds per Variant | 3.13 |
| core-simulation-loop 11.2, 11.8 | The acceptance scenario and its test request the `left` Variant | 3.14, 14.8 |

### Decisions

1. **Variant shape: named overrides.** Each Variant has an `id` and an `overrides` object whose keys come from a short, fixed list. Each key replaces exactly one documented Override_Target in the Base_Case. Three alternatives were rejected:
   - JSON Merge Patch (RFC 7396) is generic, but it can touch any field, replaces arrays whole without saying so, and cannot be limited to allowed paths without extra code.
   - A list of JSON Pointer (RFC 6901) `path`/`value` pairs with an allowlist pattern is explicit, but paths with array indexes (such as `/timeline/scheduledInsults/0/parameters/side`) break silently when the base list is reordered, and the allowlist is a regular expression that is harder to review than four property names.
   - String templating (for example `"{side}"` inside sentences) is shorter, but every sentence then becomes a template that the schema cannot check and that must be rendered before the diagnosis-term and side-word checks can run. It also lets a template put a side word into a sentence that must stay side-neutral. Named overrides are as short for this case and keep every final string in the file as written.

   Named overrides are checked by the Case_Schema (`additionalProperties: false`), by the Case_Resolver (which rejects unknown keys even when the schema file is missing), and by validating every Resolved_Case against the Case_Schema.
2. **Allowed overrides.** Only these four keys are allowed, because only these fields must follow the side:
   - `insultSide`: the side of the `SETensionPneumothorax` Scheduled_Insult, which is what the Variant is for.
   - `requiredInterventions`: the rescue gate must name the Decompression on the Affected_Side. This keeps the author's rule of play-mode 2.23 ("rescue counts only after the needle on the affected side") true in both Variants.
   - `hints`: the last Hint names the action, and the action names the side.
   - `sideRevealText`: the Ending_Screen sentence names the side.

   Everything else stays shared: title, patient, engine state, insult time, type and severity, alarms, Interventions and Play_Labels, goal text, Status_Rules, Ending thresholds, diagnosis terms and the exam section. So the two Variants differ only in the side, the calibration of one Variant's thresholds applies to the other's, and the screen cannot differ between Variants except through these four fields. Exam rules need no override because they are side-relative (decision 6).
3. **Every Variant sets every key, and the Base_Case equals the left Variant.** Both Variants of this case set all four keys, so neither silently inherits a side-specific value from the Base_Case. The Base_Case keeps its left values, so it still validates on its own and play-mode 2.23 still holds for it.
4. **Random pick in the Physiology_Service.** The Web_App names no Variant, so the browser does not choose the side and the page has nothing to show. The service picks with an injectable Variant_Source: a dependency of session creation that tests replace with a stub, with no patching of module globals. The index is `floor(u × n)` for a source value `u` in [0, 1) and `n` Variants in Case_Definition order, so a stub that returns chosen values can prove that each Variant owns an interval of width `1/n`.
5. **Errors.** An unknown `variant_id` returns HTTP 400 with a message that names the id and lists the valid ids, in the style of core-simulation-loop 6.11. A `variant_id` for a Case without Variants also returns 400. An unknown `case_id` still returns 404 (core-simulation-loop 2.9) and is checked first.
6. **Side-relative exam rules.** A sided Exam_Action (listening) has one rule list shared by its Left and Right Exam_Buttons. A rule names the side role (`affected` or `other`), never `Left` or `Right`. One rule set therefore serves both Variants, and the left Variant's findings for the left side equal the right Variant's findings for the right side by construction (Requirement 14.3).
7. **No side word in any finding.** No Exam_Finding sentence, sided or side-neutral, contains "left" or "right". A sided rule list is shared by both buttons, so a side word in it would be wrong on one of them. The Findings_List shows the button text next to each finding, so the player sees which side was examined. The side-neutral windpipe finding therefore says "pushed off to one side", not "pushed to the right". This removes the most direct exam cue for the side. Whether that is acceptable clinically is open question 2.
8. **No tapping (percussion) for now.** Listening to both sides already lets the player find the side. Tapping would add two more buttons to an action column that already uses 423.75 of its 566 px at 1280 × 720 with three Hints revealed (play-mode `PlayView.tsx` layout arithmetic). It would also add more draft clinical text for the author to cite, and the word "tap" means little to a visitor with no medical training. The Case_Schema allows up to 7 Exam_Actions, so the author can add tapping later as case content. That later change must re-check the 1280 × 720 layout (open question 7).
9. **No exam in the Clinician_View.** The exam is how the Play_View player finds the side without numbers. The drafted labels and findings are lay wording. Clinical wording for a monitor view would be new clinical content and need a second layout and giveaway review. The Clinician_View shows no exam control and no finding. It keeps the Exam_Record unchanged when the learner switches views (Requirement 6.14). A later spec can add a clinically worded exam to the Clinician_View (open question 9).
10. **Exam_Record persistence follows the Intervention_Record, not the Hint_Record.** The brief asked to "match how the Hint_Record survives reloads". The Hint_Record does not survive a reload: play-mode 9.4 limits it to one page load, and the play-mode design stores no hints ("Hints are not stored (9.4)"). The Exam_Record must survive a reload, so it uses the Intervention_Record's mechanism instead: sessionStorage under a key that contains the session_id (play-mode 8.12 to 8.14). Whether hints should also persist is open question 11.
11. **Findings_List and Found_Sides follow the Branch_Lineage.** The Exam_Record keeps every entry for the whole Session. The Findings_List, Found_Sides and the Avatar use only the Active_Exam_Entries: entries on the current Branch_Lineage up to each fork time, the same rule as the Active_Interventions (play-mode 10.9). After a rewind to a moment before a finding, that finding leaves the list and the Avatar hides the side again, because in that timeline nobody has examined the patient yet.
12. **Threat model: the Casual_Player.** The "no giveaway" rules protect a player who looks at the screen: the visible page, the page title, the URL and the accessible names that assistive technology reads. They do not protect a player who opens developer tools. The browser calls the Physiology_Service directly (`NEXT_PUBLIC_PHYSIOLOGY_URL` in `apps/web/src/lib/api.ts`), so the Resolved_Case (insult side, Required_Interventions, last Hint, Side_Reveal_Text), the `variant_id` in the Session metadata, and the Exam_Record in sessionStorage are all readable there. Hiding them would mean computing findings and hints on the server and redacting the case, which is a larger change than this spec. The Resolved_Case at least holds only the Session's own Variant, never the other Variant's text. Open question 8 asks the author to confirm.
13. **The last Hint may name the side.** The last Hint names the action (play-mode 9.8), and the action names the side. The player asks for it after two side-neutral Hints, so it is a requested answer, not a giveaway. Revealing it does not add the side to Found_Sides, so the Avatar still waits for an exam finding (open question 5).
14. **What counts as finding the side.** Only an Abnormal_Finding from a sided Exam_Button adds that button's side to Found_Sides. A side-neutral finding ("one side of his chest hardly moves") does not name a side, so it reveals none. A Decompression is the player's own action and draws its needle as today (play-mode 4.23). It does not add a side to Found_Sides.
15. **Exam_Buttons are disabled only during an Ending and during a pending fork.** They stay enabled while playback is paused and while the Vitals_Stream is disconnected. They call no endpoint, and the Exam_Finding_Selector handles a missing sample. During a pending fork the Branch of the new entry would be ambiguous.
16. **Python property tests use Hypothesis.** The Case_Resolver and the Variant pick are pure Python logic with universal properties. Hypothesis is added to `services/physiology/requirements.txt` as a test dependency. pytest stays the runner.

### Draft content for the author (all `TODO(author)`)

These strings are drafts that show the intended tone and length. Each one goes into the case file with a `TODO(author)` marker. None of them is a verified clinical claim.

| Item | Draft text |
|---|---|
| Exam group heading (UI text, not clinical) | "Check on him" |
| Empty Findings_List (UI text, not clinical) | "You haven't checked anything yet." |
| `look-chest` label | "Look at his chest" |
| `look-chest` abnormal finding | "One side of his chest hardly moves when he breathes." |
| `look-chest` default | "Both sides of his chest rise and fall evenly." |
| `listen` labels | Left: "Listen to his chest - left side"; Right: "Listen to his chest - right side" |
| `listen` abnormal finding (affected side, insult started, not decompressed) | "You can barely hear any breathing on this side." |
| `listen` finding after the needle (affected side, decompressed) | "Breathing sounds are coming back on this side." (open question 1) |
| `listen` default | "You hear clear breathing on this side." |
| `windpipe` label | "Feel the position of his windpipe" |
| `windpipe` abnormal finding (late sign) | "His windpipe feels pushed off to one side." (open question 2) |
| `windpipe` default | "His windpipe is in the middle of his neck." |
| `neck-veins` label | "Look at his neck veins" |
| `neck-veins` abnormal finding | "The veins in his neck are bulging." (open question 3) |
| `neck-veins` default | "His neck veins look normal." |
| Hint 1 (both Variants) | "Something is wrong with his breathing. Use the buttons under \"Check on him\" to examine him." |
| Hint 2 (both Variants) | "Listen to both sides of his chest. Is one side quieter than the other?" |
| Hint 3, `left` | 'His left side is the quiet one. Press "Let the trapped air out - left side (needle)".' |
| Hint 3, `right` | 'His right side is the quiet one. Press "Let the trapped air out - right side (needle)".' |
| Side_Reveal_Text, `left` | "The trapped air was in the left side of his chest." |
| Side_Reveal_Text, `right` | "The trapped air was in the right side of his chest." |

The Vital_Band conditions of the late-sign rules (`windpipe`, and `neck-veins` if the author decides it is late) are left for the author. The case file shows them as `TODO(author)` with a placeholder condition.

### Known limitations

- **The browser can see the answer.** See decision 12. A player who opens developer tools can read the insult side, the `variant_id` and the stored Exam_Record.
- **Pulse has not run a right-sided case yet.** The steering spike and every play-mode measurement used a left insult. `SETensionPneumothorax` accepts `side: Right` (steering `tech.md`), but nobody has measured whether the right Variant's vitals match the left Variant's. If they differ, the Ending timing differs between Variants, and the vitals themselves could hint at the side. The calibration in Requirement 13 measures this.
- **Findings are scripted.** Pulse_Engine does not output breath sounds, tracheal position or neck-vein filling. Exam_Findings come from rules over the insult state, the Decompression state and the Vital_Bands (Requirement 5).
- **A new tab loses the Exam_Record.** Like the Intervention_Record, it lives in the browser tab's sessionStorage (play-mode known limitation).
- **Tight layout.** The exam group must fit into the play-mode 1280 × 720 layout, whose action column already uses 423.75 of 566 px with three Hints revealed. The design may need to rearrange the columns or shrink the Avatar. This is also why tapping is left out (decision 8).
- **Clinician_View learners cannot examine.** A learner who stays in the Clinician_View has no exam and must switch to the Play_View to find the side (decision 9).

### Open questions for the author

1. **Breath sounds after the needle.** After a needle decompression on the Affected_Side, what should listening to that side show? Normal breath sounds, still reduced, or something else? Does it depend on the Vital_Bands? Please cite a source.
2. **Windpipe.** May the windpipe finding name the direction ("pushed to the right")? That would reveal the side on its own, so the side-word check would need an exception for this one action and a per-Variant sentence. Is tracheal deviation a late and unreliable sign, and which Vital_Bands should gate it?
3. **Neck veins.** Is distended neck veins an early or a late sign in this case? Should it be gated by Vital_Bands, for example a low blood pressure band? Should it stay absent in some patients?
4. **Chest look.** What does a learner see on the affected side: reduced movement, a bigger side, or both? Is it visible from the insult start or only later?
5. **The last Hint.** May the last Hint name the side (decision 13)? Should revealing it also count as finding the side, so that the Avatar shows the swelling?
6. **Side_Reveal_Text and the diagnosis.** After an Ending, may the Side_Reveal_Text name the diagnosis as a teaching moment? This spec applies the Diagnosis_Terms check to it for now (Requirement 12.5).
7. **Tapping (percussion).** Should tapping on the left and right be added later as case content (decision 8)? It needs a citation for the percussion finding and a layout check.
8. **Threat model.** Do you accept that a player with developer tools can read the side (decision 12)? Or should a later spec move finding selection to the server and redact the case?
9. **Clinician_View exam.** Should a later spec add exam actions with clinical wording to the Clinician_View (decision 9)?
10. **Wrong-side needle.** Pulse does not model a pneumothorax caused by a needle on the healthy side (play-mode open question 1, item c, is unmeasured). What should listening to a needled Other_Side show? This spec leaves Other_Side findings unchanged by a Decompression.
11. **Hint persistence.** The brief assumed the Hint_Record survives reloads, but play-mode 9.4 keeps it for one page load only. Should hints persist like the Exam_Record, so that scoring can count them after a reload? This spec does not change play-mode.
12. **Breath sounds at insult start.** The insult starts at Simulation_Time 30 s with severity 0.75. Should "barely any breathing" show from the insult start, or only after a Vital_Band changes? The draft rule shows it from the insult start.

## Glossary

Terms from core-simulation-loop and play-mode keep their meaning in those specs: **Case**, **Case_Definition**, **Case_Loader**, **Case_Schema**, **Session**, **Branch**, **Checkpoint**, **Pulse_Engine**, **Physiology_Service**, **Web_App**, **Intervention**, **Scheduled_Insult**, **Simulation_Time**, **Wall_Clock_Time**, **Vitals_Stream**, **VitalSigns**, **Alarm_State**, **Alarm_Function**, **Event_Log**, **Timeline**, **Fork_API**, **Playback_API**, **Intervention_API**, **Clinician_View**, **Play_View**, **View_Switcher**, **Play_Section**, **Play_Label**, **Avatar**, **Avatar_Parameters**, **Avatar_Mapper**, **Vital_Band**, **Status_Rule**, **Status_Sentence**, **Status_Selector**, **Diagnosis_Terms**, **Required_Interventions**, **Rescue_Gate_Time**, **Ending**, **Ending_Evaluator**, **Ending_Screen**, **Goal_Text**, **Hint**, **Hint_Panel**, **Hint_Record**, **Intervention_Record**, **Branch_Lineage**, **Active_Interventions**, **Rewind_Panel**, **Rewind_Moment**, **Swollen_Sides**, **Decompression**, **Decompressed_Sides**, **Anatomical_Side**, **Speech_Bubble_Slot**, **Safety_Notice**.

- **Session_API**: The existing `POST /sessions` endpoint, which creates a Session (core-simulation-loop Requirement 2)
- **Session_Metadata**: The object that the Session_API and `GET /sessions/{session_id}` return (core-simulation-loop Requirement 2.8)
- **Case_API**: The existing `GET /sessions/{session_id}/case` endpoint
- **Base_Case**: The document parsed from a case file in `cases/`, including its `variants` list when it has one
- **Variant**: One entry of the Base_Case's optional `variants` list, with an `id` and Variant_Overrides
- **Variant_Id**: The `id` of a Variant, a kebab-case string unique within its Base_Case
- **Variant_Overrides**: The `overrides` object of a Variant, holding one or more of the keys `insultSide`, `requiredInterventions`, `hints` and `sideRevealText`
- **Override_Target**: The field that a Variant_Overrides key replaces. `insultSide` targets `parameters.side` of every Scheduled_Insult whose `action` is `SETensionPneumothorax`. `requiredInterventions` targets `play.endings.rescued.requiredInterventions`. `hints` targets `play.hints`. `sideRevealText` targets `play.sideRevealText`
- **Case_Resolver**: The Physiology_Service logic that builds a Resolved_Case from a Base_Case and a Variant
- **Resolved_Case**: The Case_Definition of a Session. For a Base_Case without Variants it equals the Base_Case. For a Base_Case with Variants it is a copy of the Base_Case without the `variants` property, in which each Variant_Overrides key has replaced its Override_Target (or added it, if absent) and every other field is unchanged
- **Variant_Source**: The injectable source of random values in [0, 1) that the Physiology_Service uses to pick a Variant
- **Affected_Side**: The `side` parameter of the first Scheduled_Insult with action `SETensionPneumothorax` in the Resolved_Case's `timeline.scheduledInsults` order, or none when there is no such insult
- **Other_Side**: The Anatomical_Side that is not the Affected_Side
- **Insult_Started**: For a Simulation_Time, true when that Simulation_Time is greater than or equal to the `timeSeconds` of the Affected_Side's insult, following play-mode decision 1 ("a Scheduled_Insult is applied once the Simulation_Time is greater than or equal to its `timeSeconds`"); false otherwise and when there is no Affected_Side
- **Affected_Side_Decompressed**: For a Simulation_Time, true when the Active_Interventions contain a Decompression on the Affected_Side whose Simulation_Time is greater than or equal to the Affected_Side insult's `timeSeconds` and less than or equal to the given Simulation_Time. This matches the Decompression rule of Swollen_Sides (play-mode 4.13)
- **Exam_Section**: The optional `exam` object in the Play_Section, holding the Exam_Actions
- **Exam_Action**: One entry in the Exam_Section. A Side_Neutral_Action has one `label`. A Sided_Action has `labels` for `Left` and `Right` and one shared list of Exam_Rules
- **Side_Neutral_Action**: An Exam_Action with a single `label`, for example "Look at his chest"
- **Sided_Action**: An Exam_Action with a `labels` object for `Left` and `Right`, for example listening
- **Exam_Button**: A Play_View button for one Exam_Action and side: one per Side_Neutral_Action, and two (Left, then Right) per Sided_Action
- **Exam_Rule**: An entry in an Exam_Action's `rules` with a `when` object, a `sentence` and an optional `abnormal` flag
- **Exam_Finding**: The sentence and the abnormal flag that the Exam_Finding_Selector returns for one Exam_Button activation
- **Abnormal_Finding**: An Exam_Finding whose abnormal flag is true
- **Exam_Finding_Selector**: The pure function that chooses the Exam_Finding for an Exam_Button
- **Exam_Record**: The Web_App's client-side, Session-scoped record of each Exam_Button activation
- **Active_Exam_Entries**: The Exam_Record entries that belong to the current Branch_Lineage, under the same rule as the Active_Interventions (play-mode 10.9)
- **Findings_List**: The Play_View list of the Active_Exam_Entries, newest first
- **Found_Sides**: The Anatomical_Sides for which the Active_Exam_Entries contain an Abnormal_Finding from a Sided_Action's Exam_Button on that side
- **Shown_Swollen_Sides**: The sides that the Avatar draws swollen. While the Ending is `none` they are the Swollen_Sides that are also in Found_Sides. While the Ending is `rescued` or `lost` they are the Swollen_Sides
- **Side_Reveal_Text**: The optional `play.sideRevealText` string that the Ending_Screen shows to name the Affected_Side
- **Side_Word**: The word "left" or "right" as a whole word, compared case-insensitively
- **Casual_Player**: A player who uses only what the page shows (the visible page, the page title, the URL and the accessible names) and does not open the browser's developer tools
- **Calibration_Run**: The engine calibration of play-mode Requirement 13, run by the play-mode calibration script (play-mode tasks 12.1 and 12.2)
  - Since engine-mcp: "the play-mode calibration script" and play-mode task 12.3 here mean the engine-mcp `run_calibration` tool and the Calibration_Record of engine-mcp Requirement 13.

## Requirements

### Requirement 1: Variants in the case file

**User Story:** As a case author, I want to define side variants of a case as explicit, schema-checked overrides, so that one case file can describe a left and a right tension pneumothorax without copying the whole case.

This requirement extends play-mode Requirement 2 and core-simulation-loop Requirement 1.

#### Acceptance Criteria

1. THE Case_Schema SHALL define `variants` as an optional top-level array of 2 to 10 Variants, so that a Base_Case without `variants` validates with the same result as before this spec (play-mode 2.2).
2. THE Case_Schema SHALL define each Variant as an object with two required properties: `id` (a string of 1 to 40 characters matching `^[a-z0-9-]+$`) and `overrides` (Variant_Overrides). THE Case_Schema SHALL reject any other property of a Variant.
3. THE Case_Schema SHALL define Variant_Overrides as an object with at least one property, using only these optional properties, and SHALL reject any other property:
   - `insultSide`: one of the strings "Left" or "Right";
   - `requiredInterventions`: the same shape as `play.endings.rescued.requiredInterventions` (play-mode 2.21);
   - `hints`: the same shape as `play.hints` (play-mode 2.7);
   - `sideRevealText`: the same shape as `play.sideRevealText` (Requirement 12.1).
4. WHEN the Case_Resolver resolves a Variant, THE Case_Resolver SHALL return a Resolved_Case that has no `variants` property, in which each key of the Variant_Overrides has replaced its Override_Target, and in which every other field equals the field of the Base_Case.
5. WHEN the Case_Resolver resolves a Variant, THE Case_Resolver SHALL leave the Base_Case unchanged, and SHALL return equal Resolved_Cases when called twice with equal inputs.
6. IF a Variant sets `insultSide` and the Base_Case has no Scheduled_Insult with action `SETensionPneumothorax`, or a Variant sets `requiredInterventions`, `hints` or `sideRevealText` and the Base_Case has no Play_Section, THEN THE Case_Loader SHALL refuse to load the Case with its existing case-load error, naming the Variant_Id and the override key.
7. IF two Variants of a Base_Case have the same `id`, THEN THE Case_Loader SHALL refuse to load the Case with its existing case-load error, naming the duplicated Variant_Id.
8. WHEN the Case_Loader loads a Base_Case that has Variants, THE Case_Loader SHALL validate the Base_Case against the Case_Schema, then resolve every Variant and validate each Resolved_Case against the Case_Schema.
9. IF the Base_Case or any Resolved_Case fails Case_Schema validation, THEN THE Case_Loader SHALL refuse to load the Case with its existing case-load error. For a Resolved_Case, the error SHALL name the Variant_Id and the field path that failed. This extends core-simulation-loop 1.2 and 1.4.
10. IF Variant_Overrides contain a key that is not one of the four keys in criterion 3, THEN THE Case_Resolver SHALL reject the Variant and name the key, also when the Case_Loader skips schema validation because the Case_Schema file is missing (play-mode 9.9 notes that behaviour).
11. WHEN `python scripts/validate-case.py <case-file>` is run on a case file with Variants, THE script SHALL apply criteria 6 to 10 and SHALL report each failure with the Variant_Id and the field path, exiting with a non-zero status. This extends play-mode 2.17.
12. WHEN `python scripts/validate-case.py cases/adult-tension-pneumothorax.yaml` is run from the repository root after this spec's case-file changes, THE script SHALL report that the Base_Case and both Resolved_Cases are valid and exit with status 0. This extends play-mode 2.12.
13. WHEN the Case_Loader loads a Base_Case without Variants, THE Case_Loader SHALL accept or reject it with the same result and the same error message as before this spec.

### Requirement 2: Side variants of the tension pneumothorax case

**User Story:** As a case author, I want the adult tension pneumothorax to occur on the left or the right, so that the player has to examine the patient to find the side.

#### Acceptance Criteria

1. THE `cases/adult-tension-pneumothorax.yaml` file SHALL define exactly two Variants, in this order: `left` and `right`.
2. THE `cases/adult-tension-pneumothorax.yaml` file SHALL set all four Variant_Overrides keys (`insultSide`, `requiredInterventions`, `hints` and `sideRevealText`) in both Variants.
3. THE `left` Variant SHALL set `insultSide` to "Left" and `requiredInterventions` to exactly `["needle-decompression-left"]`.
4. THE `right` Variant SHALL set `insultSide` to "Right" and `requiredInterventions` to exactly `["needle-decompression-right"]`.
5. THE Base_Case of `cases/adult-tension-pneumothorax.yaml` SHALL keep its Scheduled_Insult side "Left", its `requiredInterventions` `["needle-decompression-left"]`, and Hints and a Side_Reveal_Text equal to those of the `left` Variant, so that the `left` Resolved_Case equals the Base_Case without its `variants` property.
6. THE `cases/adult-tension-pneumothorax.yaml` file SHALL carry, on the line of the `variants` key or the line directly above it, a comment stating that the side variants and their `insultSide` and `requiredInterventions` values are the author's game-rule decision recorded in the bedside-exam spec. These values SHALL carry no `TODO(author)` marker. This extends play-mode 2.23, whose decision comment stays on the Base_Case entry.
7. THE `cases/adult-tension-pneumothorax.yaml` file SHALL give every Hint `text` and every `sideRevealText` inside the Variants a `TODO(author)` marker on the same line or the line directly above, unless the Hint's own `references` array is non-empty (as in play-mode 2.15).
8. FOR EACH Variant of a Base_Case that sets both `insultSide` and `requiredInterventions`, every Required_Intervention whose Intervention has action `SENeedleDecompression` SHALL have the `side` parameter equal to that Variant's `insultSide`.

### Requirement 3: Variant selection at session creation

**User Story:** As a player, I want each new session to pick the side at random, and as a maintainer, I want to choose the side by id, so that play is not predictable while calibration and tests are repeatable.

This requirement changes core-simulation-loop Requirements 2.1, 2.2, 2.8, 9.1 and 9.5.

#### Acceptance Criteria

1. THE Session_API SHALL accept an optional `variant_id` field in the create request, as a string or `null`, next to the existing `case_id`.
2. WHEN the Session_API receives a create request with no `variant_id`, or with `variant_id` `null`, for a Case that has Variants, THE Physiology_Service SHALL read one value `u` in [0, 1) from the Variant_Source and SHALL select the Variant at index `floor(u × n)`, where `n` is the number of Variants and the index counts from 0 in Case_Definition order.
3. WHEN the Session_API receives a create request whose `variant_id` equals the `id` of a Variant of the Case, THE Physiology_Service SHALL select that Variant and SHALL not read the Variant_Source.
4. IF the create request's `variant_id` is a string that is not the `id` of any Variant of the Case, THEN THE Physiology_Service SHALL return HTTP 400 with an error message that names the unknown `variant_id` and lists the valid Variant_Ids in Case_Definition order, and SHALL create no Session and start no Pulse_Engine.
5. IF the create request has a `variant_id` string and the Case has no Variants, THEN THE Physiology_Service SHALL return HTTP 400 with an error message stating that the Case has no variants, and SHALL create no Session and start no Pulse_Engine.
6. IF the create request's `case_id` does not exist, THEN THE Physiology_Service SHALL return the existing 404 case-not-found response of core-simulation-loop 2.9, whatever the `variant_id`.
7. WHEN the Physiology_Service creates a Session, THE Physiology_Service SHALL store the selected Variant's Resolved_Case with the Session, and SHALL initialise the Pulse_Engine and the Session's Scheduled_Insults from that Resolved_Case.
8. WHEN the Case_API is called for a Session, THE Physiology_Service SHALL return that Session's Resolved_Case, with no `variants` property, and SHALL return an equal document on every call for the life of the Session, including after forks.
9. THE Session_Metadata returned by the Session_API and by `GET /sessions/{session_id}` SHALL include `variant_id`: the selected Variant_Id, or `null` for a Case without Variants. This changes core-simulation-loop 2.8.
10. WHEN a Branch is forked through the Fork_API, THE Physiology_Service SHALL run the new Branch from the Session's Resolved_Case, so that the Session's Variant, Affected_Side and Resolved_Case never change during the Session.
11. THE Physiology_Service SHALL take randomness for the Variant pick only from the Variant_Source. Tests SHALL be able to replace the Variant_Source without patching module globals. THE default Variant_Source SHALL be the Python standard library's random generator, not seeded with a fixed value.
12. WHEN the Physiology_Service creates a Session for a Case without Variants, THE Physiology_Service SHALL store the Base_Case unchanged as the Resolved_Case, SHALL not read the Variant_Source, and SHALL behave as before this spec in every other respect.
13. WHEN two Branches of Sessions with the same Variant start from the same Checkpoint and receive the same Interventions at the same Simulation_Time values, THE Pulse_Engine SHALL produce VitalSigns whose fields differ by no more than 0.001 (core-simulation-loop 9.1 and 9.5, applied per Variant).
14. WHEN the core-simulation-loop acceptance scenario (core-simulation-loop 11.2 to 11.7), or any existing test that depends on the insult being on the left, creates a Session of `adult-tension-pneumothorax`, THE test SHALL request the `left` Variant by `variant_id`.
15. WHEN the Web_App creates a Session from the case selection page, THE Web_App SHALL send a create request with no `variant_id`.

### Requirement 4: Exam actions in the case file

**User Story:** As a case author, I want to define bedside exam actions and their findings in the case file, so that exam wording and rules are reviewable clinical content and not hard-coded in the UI.

This requirement extends play-mode Requirements 2.2 and 2.3.

#### Acceptance Criteria

1. THE Case_Schema SHALL define `exam` as an optional property of the Play_Section: an object with `actions` (an array of 1 to 7 Exam_Actions) and an optional `references` array of 1 or more non-empty citation strings. THE Case_Schema SHALL reject any other property of `exam`.
2. THE Case_Schema SHALL define each Exam_Action with these properties, and SHALL reject any other property:
   - `id`: a string of 1 to 40 characters matching `^[a-z0-9-]+$`;
   - exactly one of `label` (a string of 1 to 60 characters) or `labels` (an object with exactly the two required properties `Left` and `Right`, each a string of 1 to 60 characters);
   - `rules`: an array of 0 to 10 Exam_Rules;
   - `defaultSentence`: a string of 1 to 100 characters;
   - `references`: an optional array of 1 or more non-empty citation strings.
3. THE Case_Schema SHALL define each Exam_Rule with these properties, and SHALL reject any other property:
   - `when`: an object with at least one of these optional properties, and no other property: `side` (`affected` or `other`), `insult` (`started` or `notStarted`), `decompressed` (a boolean) and `vitals` (an array of 1 to 6 items with the shape of a Status_Rule `when` item, play-mode 2.9);
   - `sentence`: a string of 1 to 100 characters;
   - `abnormal`: an optional boolean; an absent `abnormal` means false.
4. THE Case_Schema SHALL reject a `when.side` condition in an Exam_Rule of a Side_Neutral_Action.
5. THE Case_Schema SHALL define `exam` as optional, so that a Play_Section without `exam` validates with the same result as before this spec.
6. WHERE the Resolved_Case's Play_Section has no `exam`, THE Play_View SHALL show no exam group and SHALL keep the play-mode layout and behaviour unchanged.

### Requirement 5: Choosing an exam finding

**User Story:** As a player, I want each exam to tell me what I would find right now, so that the findings follow the patient's state and change after treatment.

#### Acceptance Criteria

1. THE Exam_Finding_Selector SHALL be a pure function of the Exam_Action, the Exam_Button's side (`Left`, `Right` or none), the Resolved_Case, a Simulation_Time, the most recent VitalSigns sample of the current Branch (or none) and the Active_Interventions. It SHALL read no Wall_Clock_Time, network, Variant_Id or state outside these inputs.
2. WHEN the Exam_Finding_Selector is called, THE Exam_Finding_Selector SHALL evaluate the Exam_Action's `rules` in Case_Definition order and SHALL return the `sentence` and the abnormal flag of the first Exam_Rule whose `when` conditions all match.
3. IF no Exam_Rule matches, or `rules` is empty, THEN THE Exam_Finding_Selector SHALL return the Exam_Action's `defaultSentence` with the abnormal flag false.
4. THE Exam_Finding_Selector SHALL treat `side: affected` as matching only when the Exam_Button's side equals the Affected_Side, and `side: other` as matching only when the Exam_Button has a side and that side differs from the Affected_Side (including when there is no Affected_Side).
5. THE Exam_Finding_Selector SHALL treat `insult: started` as matching only when Insult_Started holds at the given Simulation_Time, and `insult: notStarted` as matching only when Insult_Started does not hold.
6. THE Exam_Finding_Selector SHALL treat `decompressed: true` as matching only when Affected_Side_Decompressed holds at the given Simulation_Time, and `decompressed: false` as matching only when it does not hold.
7. THE Exam_Finding_Selector SHALL treat each `vitals` item as matching under the Status_Selector's rules (play-mode 5.3 and 5.4), using the Vital_Bands of the given VitalSigns sample (play-mode 4.2). IF no VitalSigns sample is given, THEN THE Exam_Finding_Selector SHALL treat every `vitals` item as not matching.
8. FOR ALL inputs, THE Exam_Finding_Selector SHALL return a sentence that is character-for-character equal to one `rules[].sentence` or the `defaultSentence` of the given Exam_Action, and SHALL compose, alter or generate no other text.
9. FOR ALL inputs, THE Exam_Finding_Selector SHALL return equal Exam_Findings when called twice with equal inputs (determinism property).

### Requirement 6: Bedside exam in the Play view

**User Story:** As a visitor, I want buttons to examine the patient and a list of what I found, so that I can work out what is wrong before I act.

#### Acceptance Criteria

1. WHERE the Resolved_Case's Play_Section has an Exam_Section, THE Play_View SHALL show an exam group with the heading "Check on him" above the "What can you do?" heading. The group SHALL contain one Exam_Button per Side_Neutral_Action and two Exam_Buttons per Sided_Action (Left first, then Right), in Case_Definition order.
2. THE Play_View SHALL show the `label` of a Side_Neutral_Action, and the `labels.Left` or `labels.Right` of a Sided_Action, as the full text of the matching Exam_Button.
3. WHEN the learner activates an enabled Exam_Button, THE Web_App SHALL call the Exam_Finding_Selector with the Simulation_Time defined in play-mode 9.5 for Hints, the most recent VitalSigns sample of the current Branch (or none) and the Active_Interventions. THE Web_App SHALL then add exactly one Exam_Record entry (Requirement 7.1) and show the new finding at the top of the Findings_List within 500 ms of Wall_Clock_Time.
4. WHEN the learner activates an Exam_Button, THE Web_App SHALL send no request to any Physiology_Service endpoint and SHALL open no connection.
5. WHEN the learner activates an Exam_Button, THE Web_App SHALL leave these unchanged: the playing or paused state, the Playback_Speed, the Simulation_Time, the Vitals_Stream connection, the VitalSigns history, the Ending, the Intervention_Record and the Hint_Record.
6. THE Play_View SHALL show the Active_Exam_Entries in the Findings_List, ordered by Simulation_Time from newest to oldest and, for equal Simulation_Times, from the latest recorded to the earliest. Each item SHALL show the entry's Simulation_Time in the `M:SS` format of play-mode 10.5, the Exam_Button text and the finding sentence.
7. WHILE the Active_Exam_Entries are empty, THE Findings_List SHALL show the text "You haven't checked anything yet."
8. WHEN the learner activates the same Exam_Button again, THE Web_App SHALL add a new Exam_Record entry with the Exam_Finding computed at that moment, which may differ from the earlier finding.
9. WHILE the Ending of the current Branch is `rescued` or `lost`, or a Fork_API request from the Play_View is pending, THE Play_View SHALL disable every Exam_Button, so that activating one adds no Exam_Record entry. THE Play_View SHALL keep the Exam_Buttons enabled in every other state, including while playback is paused and while the Web_App is not connected to the Vitals_Stream.
10. WHEN an Exam_Record entry is added, THE Play_View SHALL announce the new finding sentence in an ARIA live region with `polite` priority that is separate from the Status_Sentence live region, so that play-mode 5.11 stays true.
11. THE Play_View SHALL make every Exam_Button reachable with the Tab key, in visual order between the Goal_Text and the Intervention buttons, and SHALL perform the Exam_Button's action on Enter or Space, with the focus indicator of play-mode 11.4. This extends play-mode 11.2 and 11.3.
12. THE Play_View SHALL show the disabled state of an Exam_Button with a text label or icon in addition to colour, and SHALL render the exam heading, the Exam_Button texts and the Findings_List at a font size of at least 16 CSS pixels with a contrast ratio of at least 4.5:1 against its background. This extends play-mode 11.8 and 11.11.
13. WHILE the browser viewport is 1280 × 720 CSS pixels at 100% zoom, THE Play_View SHALL show everything that play-mode 11.7 lists, plus the exam heading, every Exam_Button and the full text of the newest Findings_List item, inside the viewport with no page scrolling. This SHALL hold with zero to three Hints revealed, with any number of Exam_Record entries and with the Exam_Actions of `cases/adult-tension-pneumothorax.yaml`. Older Findings_List items may be reached by scrolling inside the Findings_List. This extends play-mode 11.7, verified through manual inspection during acceptance testing.
14. WHEN the learner switches view with the View_Switcher, THE Web_App SHALL keep the Exam_Record unchanged. This extends play-mode 1.4.
15. WHILE the browser viewport is 320 CSS pixels wide, THE Play_View SHALL show every Exam_Button and the full text of the newest Findings_List item without horizontal scrolling. Vertical page scrolling is allowed, as in the play-mode layout below 1024 px. This is verified through manual inspection during acceptance testing.

### Requirement 7: Exam record

**User Story:** As a future scoring feature, I want every exam the player did to be recorded with its time, branch and finding, so that a debrief can later judge whether the player examined before treating.

#### Acceptance Criteria

1. WHEN an Exam_Button is activated while enabled, THE Web_App SHALL add exactly one entry to the Exam_Record containing the Exam_Action `id`, the Exam_Button's side (or no side for a Side_Neutral_Action), the Simulation_Time used for the finding (Requirement 6.3), the current branch_id, the finding sentence, the abnormal flag and the Wall_Clock_Time.
2. THE Web_App SHALL keep every Exam_Record entry for the whole Session. Forks through the Rewind_Panel or the Fork_API, and view switches, SHALL remove no entry.
3. THE Web_App SHALL compute the Active_Exam_Entries as the Exam_Record entries in the current Branch_Lineage. For an ancestor Branch, only entries whose Simulation_Time is less than or equal to the Simulation_Time of the Checkpoint that its child Branch in the lineage was forked from count. This is the rule of play-mode 10.9.
4. WHEN an entry is added to the Exam_Record, THE Web_App SHALL store the full Exam_Record of the Session in the browser tab's sessionStorage under a key that contains the session_id, as play-mode 8.12 does for the Intervention_Record.
5. WHEN the session page opens and the browser tab's sessionStorage holds an Exam_Record for the session_id, THE Web_App SHALL restore that Exam_Record before it computes the Active_Exam_Entries, Found_Sides or the Findings_List.
6. IF the session page opens and the browser tab's sessionStorage holds no Exam_Record for the session_id, or the stored value cannot be read, THEN THE Web_App SHALL start with an empty Exam_Record and continue without an error message, as play-mode 8.14 does for the Intervention_Record.
7. WHEN the Web_App restores an Exam_Record, THE Web_App SHALL show each restored entry with its stored finding sentence and SHALL not recompute it.

### Requirement 8: Exam content for the tension pneumothorax case

**User Story:** As a case author, I want the first case to ship with a small, reviewable set of exam actions, so that a visitor can find the side and every finding is marked for clinical review.

#### Acceptance Criteria

1. THE `cases/adult-tension-pneumothorax.yaml` file SHALL define an Exam_Section with exactly these Exam_Actions in this order: `look-chest` (Side_Neutral_Action), `listen` (Sided_Action), `windpipe` (Side_Neutral_Action) and `neck-veins` (Side_Neutral_Action). The Play_View therefore shows five Exam_Buttons.
2. THE `listen` Exam_Action SHALL define an Exam_Rule with `abnormal: true` whose `when` contains `side: affected`, `insult: started` and `decompressed: false`. It SHALL also define an Exam_Rule whose `when` contains `side: affected` and `decompressed: true`, whose wording and abnormal flag the author decides (open question 1). Its `defaultSentence` SHALL describe the normal finding.
3. THE `look-chest` and `neck-veins` Exam_Actions SHALL each define an Exam_Rule with `abnormal: true` whose `when` contains `insult: started` and `decompressed: false`, and a `defaultSentence` that describes the normal finding.
4. THE `windpipe` Exam_Action SHALL define an Exam_Rule with `abnormal: true` whose `when` contains `insult: started`, `decompressed: false` and at least one `vitals` item, so that the late sign appears only once the Vital_Bands show the patient worse. The `vitals` items SHALL carry a `TODO(author)` marker (open question 2).
5. THE `cases/adult-tension-pneumothorax.yaml` file SHALL give every item below a `TODO(author)` comment, on the same line or the line directly above, that names the review or citation needed: every Exam_Action `label` and `labels` entry, every Exam_Rule `sentence`, every `when.vitals` list, and every `defaultSentence`. An item is exempt only when the Exam_Action's own `references` or the Exam_Section's `references` is non-empty (as in play-mode 2.15).
6. THE Exam_Section SHALL contain no Side_Word in any Exam_Rule `sentence`, any `defaultSentence` or any Side_Neutral_Action `label` (decision 7).
7. THE `labels.Left` of every Sided_Action SHALL contain the Side_Word "left" and not "right", and the `labels.Right` SHALL contain "right" and not "left".
8. THE Exam_Section SHALL contain no Diagnosis_Term, by case-insensitive substring match, in any label, Exam_Rule `sentence` or `defaultSentence`.
9. THE Exam_Section SHALL set `abnormal: true` only on Exam_Rules whose `when` contains `insult: started`. On a Sided_Action, `when` SHALL also contain `side: affected`, so that Found_Sides can only ever contain the Affected_Side.
10. THE Exam_Section SHALL name in `when.vitals` only vitals that have thresholds in the Case's `alarms`, and SHALL use unique Exam_Action `id` values.
11. THE draft texts SHALL follow the table "Draft content for the author" in this document until the author replaces them.

### Requirement 9: The Avatar shows the side only after it is found

**User Story:** As a visitor, I want the patient's chest to look the same on both sides until I find the problem, so that the cartoon does not give away the answer.

This requirement changes play-mode Requirements 3.59, 4.13, 4.14, 4.15 and 4.17.

#### Acceptance Criteria

1. WHILE the Ending of the current Branch is `none`, THE Avatar_Mapper SHALL set the swollen-sides field of the Avatar_Parameters to the Shown_Swollen_Sides: the Swollen_Sides (play-mode 4.13 and 4.14) that are also in Found_Sides. The Avatar SHALL draw a chest half swollen (play-mode 3.59 and 4.17) only for a side in that field.
2. WHEN an Exam_Record entry is added, the Exam_Record is restored, or the Fork_API returns a new current Branch, THE Web_App SHALL recompute Found_Sides from the Active_Exam_Entries and show the Avatar drawn with the new Shown_Swollen_Sides within 500 ms of Wall_Clock_Time.
3. THE Avatar_Mapper SHALL keep computing Decompressed_Sides as play-mode 4.15 defines, and THE Avatar SHALL keep drawing the needle and bandage on each side in Decompressed_Sides (play-mode 4.23), whether or not that side is in Found_Sides.
4. WHEN the Fork_API returns a Branch whose Branch_Lineage holds no Abnormal_Finding for a side, THE Avatar SHALL stop drawing that side swollen, even if it was drawn swollen on the previous Branch (decision 11).
5. WHILE the Ending of the current Branch is `rescued` or `lost`, THE Ending_Screen SHALL draw the Avatar with the Swollen_Sides of the VitalSigns sample at which the Ending changed, ignoring Found_Sides. This extends play-mode 7.3 and 7.4.
6. THE Avatar SHALL draw the breathing movement with the same animation, period and depth for both chest halves, and SHALL draw no other side-specific element than the swollen chest half and the Decompressed_Sides marks.
7. FOR ALL VitalSigns samples, Case thresholds and Play_Sections, WHEN the Active_Interventions contain no Decompression and the Active_Exam_Entries contain no Abnormal_Finding from a Sided_Action, THE Avatar_Mapper SHALL return equal Avatar_Parameters for the `left` and the `right` Resolved_Case while the Ending is `none` (side symmetry property).

### Requirement 10: No other giveaway before an Ending

**User Story:** As a visitor, I want nothing on the screen to tell me the side before I find it, so that the exam is worth doing.

The rules in this requirement protect the Casual_Player (decision 12). Every place that reveals the Affected_Side today is listed in the criteria below, together with how it is handled. A side named by the player's own actions (an Exam_Button text, an Exam_Finding from a Sided_Action, a Decompression and its Play_Label, its needle mark, its "Done" message, its Rewind_Moment label and its Checkpoint description) is allowed. So is the side named by the last Hint (decision 13).

#### Acceptance Criteria

1. THE Status_Rule sentences and the `defaultSentence` of every Resolved_Case SHALL contain no Side_Word, so that the Status_Sentence and the Avatar's accessible name (play-mode 3.8) name no side.
2. THE Goal_Text of every Resolved_Case SHALL contain no Side_Word.
3. FOR ALL pairs of Resolved_Cases of one Base_Case, every field outside the four Override_Targets SHALL be equal, so that the title, patient summary, Intervention buttons and their order, Play_Labels, alarms, Status_Rules, Goal_Text and Exam_Section are the same in every Variant.
4. THE Clinician_View SHALL show no Scheduled_Insult or its side, and no Variant_Id. Its Timeline SHALL show only Checkpoint descriptions created by the Physiology_Service, which name a side only through the clinical `label` of an Intervention the learner applied ("After <label>").
5. THE Physiology_Service SHALL create no Checkpoint description, Branch description or other text returned to the Web_App that names the side of a Scheduled_Insult.
6. THE Web_App SHALL show the Variant_Id nowhere on the page, and SHALL put neither the Variant_Id nor the Affected_Side in the page title, the URL, a browser storage key or an accessible name.
7. THE session page SHALL keep the page title "Stitched Patient" and the URL `/session/<session_id>` for every Variant.
8. THE Speech_Bubble_Slot SHALL stay empty, as in play-mode, so that no patient speech names the side.
   - Since patient-speech: the Speech_Bubble_Slot shows the scripted speech lines of `.kiro/specs/patient-speech/`. They contain no Side_Word and are the same in every Variant (patient-speech Requirements 2 and 8).
9. WHILE the Ending of the current Branch is `none`, the Intervention_Record is empty, the Active_Exam_Entries hold no entry from a Sided_Action, and fewer Hints are revealed than the Play_Section defines, THE Play_View and the Clinician_View SHALL render the same markup for the `left` and the `right` Resolved_Case when given the same VitalSigns samples, Session_Metadata other than `variant_id`, Checkpoint lists and records (screen symmetry property).

### Requirement 11: Hints without the side

**User Story:** As a visitor, I want the first hints to tell me how to find the problem, not where it is, so that I learn to examine before I act.

This requirement changes play-mode Requirements 9.7, 9.8 and 12.7.

#### Acceptance Criteria

1. THE Hints of every Resolved_Case, except the last Hint, SHALL contain no Side_Word.
2. THE Hints of every Resolved_Case, except the last Hint, SHALL contain no Intervention's Play_Label or `label`, compared case-insensitively. This applies play-mode 9.8 to each Resolved_Case.
3. THE last Hint of every Resolved_Case SHALL contain, compared case-insensitively, the Play_Label of the Intervention named by that Resolved_Case's single Required_Intervention. This applies play-mode 9.8 to each Resolved_Case.
4. THE `cases/adult-tension-pneumothorax.yaml` file SHALL define exactly 3 Hints in each Variant, in this order: (1) a pointer to the exam group; (2) a suggestion to listen to both sides of the chest and compare them; (3) a statement that names the action on the Affected_Side. Hints 1 and 2 SHALL be equal in both Variants. This replaces the content order of play-mode 9.7.
5. THE Hint_Panel SHALL keep the behaviour of play-mode 9.1 to 9.6, so that both Variants show the same number of Hints and the same remaining count.

### Requirement 12: Naming the side after an Ending

**User Story:** As a visitor, I want the ending screen to tell me which side it was, so that I learn the answer whether I saved the patient or not.

This requirement extends play-mode Requirements 2.3, 7.3 and 7.4.

#### Acceptance Criteria

1. THE Case_Schema SHALL define `sideRevealText` as an optional string of 1 to 120 characters in the Play_Section.
2. WHILE the Ending_Screen shows the `rescued` or the `lost` Ending and the Resolved_Case's Play_Section has a `sideRevealText`, THE Ending_Screen SHALL show the Side_Reveal_Text in full, without truncation.
3. WHERE the Resolved_Case's Play_Section has no `sideRevealText`, THE Ending_Screen SHALL show no side text and SHALL keep the play-mode behaviour.
4. THE `sideRevealText` of each Variant of `cases/adult-tension-pneumothorax.yaml` SHALL contain the Side_Word of that Variant's `insultSide` and not the other Side_Word.
5. THE `sideRevealText` of each Resolved_Case SHALL contain no Diagnosis_Term, by case-insensitive substring match (open question 6).
6. THE Clinician_View's Ending banner (play-mode 7.8) SHALL keep its current content and SHALL show no side.

### Requirement 13: What the Play mode calibration needs

**User Story:** As the case author, I want the Play mode calibration to cover both sides, so that the thresholds I approve work whichever side the Session picks.

This spec does not change play-mode. The play-mode calibration (Requirement 13, tasks 12.1 and 12.2) has not run yet. These criteria state what it needs from this spec, so that the author can update play-mode afterwards. "The Calibration_Run" means the updated play-mode calibration.

#### Acceptance Criteria

1. WHEN the Calibration_Run creates the Session for a scenario, THE Calibration_Run SHALL name the scenario's Variant with `variant_id` (Requirement 3.3) and SHALL not rely on the random pick.
2. THE Calibration_Run SHALL run the four scenarios of play-mode 13.1 for each Variant, with sides named relative to the Variant: no Intervention; Decompression on the Affected_Side; Decompression on the Other_Side only; and Decompression on the Affected_Side before the insult. For this case, that is eight scenarios.
3. THE Calibration_Run SHALL read each scenario's Resolved_Case from the Case_API and SHALL compute the Rescue_Gate_Time (play-mode 13.13) from that Resolved_Case's Required_Interventions, not from the case file's Base_Case. (Since the author's decision of 2026-11-25, the Rescue_Gate_Time counts only Gate_Entries as play-mode defines them, play-mode 6.25, 6.26 and 13.18.)
4. THE calibration record SHALL state the Variant_Id and the Affected_Side of each scenario, and SHALL name the scenarios "affected side" and "other side" instead of "left" and "right".
5. THE calibration record SHALL apply the outcome checks of play-mode 13.5 to 13.7, 13.14 and 13.15 to every Variant. IF any Variant fails one, THEN THE calibration record SHALL mark the drafted Play_Section values as not calibrated (play-mode 13.8).
6. THE calibration record SHALL compare, for each scenario kind, the `left` and the `right` Variant's samples at the same Simulation_Times and SHALL state the largest absolute difference per vital sign. This answers whether Pulse models the two sides alike (known limitation).
7. THE calibration record SHALL list, for each scenario and each recorded sample, the Exam_Finding sentence and abnormal flag that each Exam_Button would show, computed with the shipped Exam_Finding_Selector. This lets the author see when each late sign appears.
8. IF a Variant, an Exam_Rule or an Exam_Action of the Case changes after a calibration record was written, THEN THE project SHALL record a new Calibration_Run before any `TODO(author)` marker is removed from a changed value. This extends play-mode 13.9.
9. THE play-mode acceptance demonstration (play-mode 14.3, 14.4 and 14.7) SHALL be restated per Variant: "the Play_Label for the Decompression on the Affected_Side" replaces "the left needle decompression", and "on the Other_Side" replaces "the right needle decompression".

### Requirement 14: Automated tests

**User Story:** As a maintainer, I want the variant and exam logic covered by fast tests, so that later changes cannot leak the side or break the findings.

#### Acceptance Criteria

1. THE web test suite SHALL include Vitest unit tests for the Exam_Finding_Selector with fixed inputs that cover each of these cases: `side: affected` and `side: other` with both Affected_Sides; `insult: started` and `notStarted` at, just before and after the insult `timeSeconds`; `decompressed` true and false, including a Decompression on the Other_Side and a Decompression before the insult time; `vitals` items with and without `direction`; a missing VitalSigns sample; two matching Exam_Rules, where the first in Case_Definition order wins; and the `defaultSentence` when no Exam_Rule matches (Requirements 5.2 to 5.7).
2. THE web test suite SHALL include Vitest property tests for Requirements 5.8 and 5.9, 7.3, 9.1 and 9.7, 10.9, and the storage round trip of Requirement 7.4 and 7.5 (storing then restoring an Exam_Record yields an equal Exam_Record). Each property SHALL run against no fewer than 100 generated inputs created from a fixed seed, as play-mode 12.10 requires.
3. THE web test suite SHALL include a Vitest property test of side-relative symmetry. FOR ALL Exam_Actions, VitalSigns samples, Simulation_Times and Active_Interventions, the Exam_Finding for the `left` Resolved_Case and an Exam_Button on side S SHALL equal the Exam_Finding for the `right` Resolved_Case, the Exam_Button on the mirrored side of S (or the same Side_Neutral_Action), and the Active_Interventions with every side mirrored. The test SHALL use the settings of criterion 2.
4. THE web test suite SHALL include Vitest tests showing that activating an Exam_Button calls no `api` function (with the API client mocked), adds one Exam_Record entry, leaves the state fields of Requirement 6.5 unchanged, and keeps the Exam_Record across a fork and a view switch (Requirements 6.4, 6.5, 6.14, 7.2).
5. THE web test suite SHALL include Vitest tests of the rendered Play_View for: the exam group above "What can you do?" with five Exam_Buttons in order; the Findings_List newest first with `M:SS` times; the empty-list text; disabled Exam_Buttons during an Ending and a pending fork; the separate live region; the Ending_Screen with the Side_Reveal_Text; and a Clinician_View that renders no Exam_Button (Requirements 6.1 to 6.10, 9.5, 12.2, decision 9).
6. THE web test suite SHALL include Vitest case-content tests for `cases/adult-tension-pneumothorax.yaml` that check Requirements 2.1 to 2.8, 8.1 to 8.10, 10.1 to 10.3, 11.1 to 11.4, 12.4 and 12.5. The tests SHALL check each Resolved_Case by taking each Override_Target's value from the Variant_Overrides or, when absent, from the Base_Case, and SHALL name the failing Variant_Id, field path and text in the failure output. They replace the left-only checks of play-mode 12.7 and 12.17 for Hints and Required_Interventions.
7. IF `cases/adult-tension-pneumothorax.yaml` has no `variants` or no Exam_Section, THEN THE case-content tests of criterion 6 SHALL fail and SHALL NOT pass with nothing to check.
8. THE physiology test suite SHALL include pytest tests for the Session_API and the Case_API: no `variant_id` with a stub Variant_Source selects the Variant at index `floor(u × n)` for stub values at 0, just below each `k/n`, at each `k/n` and just below 1; a named `variant_id` selects that Variant without reading the Variant_Source; an unknown `variant_id` returns 400 with the message of Requirement 3.4; a `variant_id` for a Case without Variants returns 400; an unknown `case_id` returns 404; Session_Metadata includes `variant_id`; the Case_API returns the Resolved_Case without `variants`, also after a fork; and a Case without Variants behaves as before (Requirements 3.1 to 3.12). Existing tests that depend on the left side SHALL request `variant_id` `left` (Requirement 3.14).
9. THE physiology test suite SHALL include pytest tests for the Case_Loader and the Case_Resolver that cover each rejection in Requirements 1.6, 1.7, 1.9 and 1.10, each naming the Variant_Id and field path or key, and the unchanged result for a Base_Case without Variants (Requirement 1.13).
10. THE physiology test suite SHALL include pytest property tests, using Hypothesis with no fewer than 100 examples per property, for Requirements 1.4 and 1.5 (the Resolved_Case differs from the Base_Case only at the Override_Targets and in the removed `variants` property, the Base_Case is unchanged, and resolution is deterministic) and for Requirement 3.2 (for all `n` from 2 to 10 and all `u` in [0, 1), the selected index is `floor(u × n)` and lies in 0 to `n - 1`).
11. THE physiology test suite SHALL include a pytest test with the default Variant_Source that makes at least 200 Variant selections for `adult-tension-pneumothorax`, without starting a Pulse_Engine for any of them, and checks that both Variants are selected.
12. THE physiology test suite SHALL include a Pulse_Engine determinism test for the `right` Variant, applying Requirement 3.13 with the tolerance and failure message of core-simulation-loop 9.6 to 9.8. THE web test suite SHALL extend the side tests of play-mode 12.2 with a `Right` insult.
13. THE web test suite SHALL run the tests of this requirement with `vitest --run` while the Physiology_Service and the Pulse_Engine are not running, and SHALL open no HTTP or WebSocket connection (play-mode 12.11). THE pytest tests of criteria 9 to 11 SHALL start no Pulse_Engine; the tests of criteria 8 and 12 run in the physiology container like the existing Session tests.
