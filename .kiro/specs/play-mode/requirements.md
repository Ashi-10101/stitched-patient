# Requirements Document

## Introduction

Play mode gives Stitched Patient a second way to view the same simulation: a stitched patient anyone can save. Judges and curious visitors with no medical training must understand within a minute what is happening, without reading numbers. They see a cartoon patient whose look follows the live vitals, a one-line plain-language status, a goal with an ending, up to three hints, and a Rewind button. Medical learners keep the full bedside monitor as the Clinician view. Both views run on the same Session, the same Branches and the same Pulse_Engine.

This spec changes presentation only and adds a per-case goal. It builds on the core-simulation-loop spec (`.kiro/specs/core-simulation-loop/requirements.md`), which another session is still executing. Play mode reuses the existing Physiology_Service API as it is today:

- `GET /sessions/{id}/case` returns the full Case_Definition, so new optional case-file fields reach the Web_App without a service change.
- `GET /sessions/{id}` returns Branch metadata, including `parent_branch_id`, `forked_from_checkpoint` and `event_count`.
- `GET /sessions/{id}/branches/{branch_id}/checkpoints` lists Checkpoints with `simulation_time`, `is_automatic` and `description`.
- `POST /sessions/{id}/interventions`, `POST /sessions/{id}/fork` and `POST /sessions/{id}/playback` apply Interventions, fork Branches and control playback.
- `WS /sessions/{id}/vitals` streams VitalSigns.

**Scope boundary.** This spec changes no code or behaviour in `services/physiology/`. The only non-web files it changes are `cases/adult-tension-pneumothorax.yaml` and `cases/case-schema.json`. All new case-file fields are optional, so the existing Case_Loader keeps accepting the case.

**Clinical safety.** Every clinical value in the Play_Section (ending thresholds, hold durations, Time_Limit, hint text, status sentences, reference tidal volume) needs a citation in a `references` field or a `TODO(author)` marker for review by the author, a clinical medicine student. This document contains no clinical numbers. The only numbers below are taken from the steering spike results, are engine measurements recorded in this Introduction, or are UI and display constants. Engine measurements are Pulse_Engine output, not clinical thresholds.

**Out of scope:** the talking patient (LLM), scoring and debrief beyond the Ending_Screen, new cases, accounts, and any change to Physiology_Service behaviour.

### Dependencies and confirmed decisions

1. **Insult application time (confirmed).** Since core-simulation-loop task 3.1, the simulation tick that reaches a Scheduled_Insult's `timeSeconds` applies the insult. The Vitals_Stream does not report which Scheduled_Insults have been applied, so the Web_App treats a Scheduled_Insult as applied once the Simulation_Time is greater than or equal to its `timeSeconds`.
2. **Ending precedence (confirmed).** If one VitalSigns sample satisfies both the Rescue_Condition and the Lost_Condition, the Ending is `rescued` (Requirement 6.9).
3. **Alarm band semantics (changed by this spec).** The current `getAlarmState` in `apps/web/src/lib/alarms.ts` returns `normal` for values between `warning.low` and `normal.low`. Example: SpO2 0.93 with `warning.low` 0.92 and `normal.low` 0.95 is `normal`. Requirement 15 fixes this for both views: a value outside the normal range is at least `warning`. Coordination note for the core-simulation-loop session, which is still executing: this is a deliberate change to the alarm colours of that spec's Monitor_UI (core-simulation-loop Requirement 8.3 and 8.4), and this spec owns it. Both sessions edit `apps/web/src/lib/alarms.ts` only through Requirement 15.
4. **Thresholds in the existing case without markers (agreed: stay `TODO(author)`).** The heart rate, respiratory rate, SpO2 and MAP thresholds in `cases/adult-tension-pneumothorax.yaml` have no `TODO(author)` marker and no specific citation. The only reference is the ATLS 10th edition manual in general. The Avatar and the Status_Sentence depend on these thresholds. TODO(author): verify them and cite a source.
5. **Needle decompression parameters (follow-up from core-simulation-loop task 3.4).** Until commit 1e71454, the case file's unquoted `state: On` loaded as a YAML boolean, so Pulse received the decompression switched off. Requirement 2.20 makes the Case_Schema reject such values.
6. **Rescue gate and two calibration findings (author's decision, 2026-11-20).** In a real run with no Intervention, the Ending became `rescued` at about Simulation_Time 60 s, because the rescue Vital_Conditions already held before the tension pneumothorax had changed any vital (engine output at 1:01: HR 77, SpO2 0.975, MAP 94, RR 12, EtCO2 35, TV 490). The author decided that rescue counts only after the left needle decompression (Requirements 2.21 to 2.23, 6.3 and 6.18 to 6.24). The same run showed that the Overall_Status was `warning` from Simulation_Time 0, because the baseline RR (about 12/min) and EtCO2 (about 35 mmHg) sit on the lower bounds of their normal bands, and that the Status_Sentence stayed at the `defaultSentence` for the whole run because no Status_Rule matched. No threshold changes now: the calibration record reports both findings for the author (Requirement 13.17).

### Known limitations

- **Hints are not recorded on the server.** The server Event_Log does not record Hints. Hints live only in the client-side Hint_Record, which lasts for one page load (Requirement 9.4).
- **Applied Interventions after a reload.** No API reads Event_Log entries, so the Web_App works out the Active_Interventions from its own Intervention_Record and the Branch_Lineage. The Web_App keeps the Intervention_Record in sessionStorage keyed by session_id (Requirement 8.12 to 8.14), so a reload in the same browser tab keeps it. A new browser tab or a cleared sessionStorage loses it, and the Swollen_Sides, Decompressed_Sides and Rewind_Moment labels for that Session can then be wrong.

### Open questions

1. **Engine behaviour the acceptance demo depends on (partially measured).** Needle decompression had no effect until core-simulation-loop task 3.4 (commit 1e71454) fixed the YAML boolean described in item 5 of "Dependencies and confirmed decisions". After that fix, these values were measured through `SessionManager.step()` for `adult-tension-pneumothorax`:
   - Left Decompression applied at Simulation_Time 150 s:
     - t=150 s: HR 127.5, SpO2 0.919, MAP 85.6;
     - t=180 s: HR 120.8, SpO2 0.953, MAP 89.8;
     - t=210 s: HR 102.5, SpO2 0.967, MAP 94.7;
     - t=240 s: HR 95.2, SpO2 0.968, MAP 94.4;
     - t=300 s: HR 91.6, SpO2 0.968, MAP 94.3.
   - Fork from the automatic Checkpoint at t=150 s, no treatment:
     - t=210 s: HR 160.4, SpO2 0.898;
     - t=270 s: HR 174.2, SpO2 0.875, MAP 81.0;
     - t=300 s: HR 177.0, SpO2 0.855, MAP 78.6.

   Still unmeasured:
   - (c) what a right-side-only Decompression does while the left pneumothorax is untreated (Requirement 13.6 records it);
   - (d) what Pulse does when a left Decompression comes before the insult's `timeSeconds` (Requirement 13.11 records it, and the result decides whether Requirement 4.18 stays).

## Glossary

Terms reused from core-simulation-loop keep that spec's meaning: **Case**, **Case_Definition**, **Case_Loader**, **Session**, **Branch**, **Checkpoint**, **Pulse_Engine**, **Physiology_Service**, **Web_App**, **Intervention**, **Scheduled_Insult**, **Simulation_Time**, **Wall_Clock_Time**, **Playback_Speed**, **Monitor_UI**, **Vitals_Stream**, **VitalSigns**, **Alarm_State**, **Event_Log**, **Timeline**.

- **Fork_API**: The existing `POST /sessions/{session_id}/fork` endpoint, which takes a `checkpoint_id` and creates a new Branch that becomes the Session's current Branch
- **Playback_API**: The existing `POST /sessions/{session_id}/playback` endpoint
- **Intervention_API**: The existing `POST /sessions/{session_id}/interventions` endpoint
- **Alarm_Function**: The existing `getAlarmState(value, threshold)` function in `apps/web/src/lib/alarms.ts`, which returns the Alarm_State of a vital sign value for the Case thresholds, with the band semantics defined in Requirement 15
- **Clinician_View**: The current bedside Monitor_UI on the session page, with numeric readouts, trend chart, playback controls, intervention panel and Timeline
- **Play_View**: The plain-language presentation of a Session with the Avatar, Status_Sentence, Goal_Text, Hint_Panel, Rewind_Panel and Play_Labels
- **View_Switcher**: The control that switches between the Play_View and the Clinician_View
- **Play_Section**: The optional `play` object in a Case_Definition, which holds the Goal_Text, Ending definitions, Hints, Status_Rules, diagnosis terms and avatar reference values
- **Play_Label**: The optional `playLabel` string on an Intervention in the Case_Definition. The Play_View shows it in place of the clinical `label`
- **Avatar**: The original cartoon stitched patient, drawn as a parameterized SVG React component
- **Avatar_Parameters**: The data structure that drives the Avatar. Fields: Skin_Tone, breathing period, breathing depth, heartbeat period, sweat flag, Swollen_Sides, Decompressed_Sides and Overall_Status
- **Avatar_Mapper**: The pure function that computes Avatar_Parameters from a VitalSigns sample, the Case thresholds, the Play_Section, the applied Scheduled_Insults and the Active_Interventions
- **Avatar_Variant**: The existing `variant` prop of the Avatar: `live` in the Play_View, and `rescued` or `lost` on the Ending_Screen
- **Expression**: The face the Avatar shows, one of `calm`, `worried`, `alarmed`, `joyful` or `sleepy`, chosen from the Avatar_Variant and the Overall_Status (Requirements 3.13 to 3.18)
- **Face_Feature_Region**: A rectangle in the Avatar's 200 × 280 viewBox, defined as a design constant, that contains the eyes, brows and mouth of every Expression
- **Chest_Region**: A rectangle in the Avatar's 200 × 280 viewBox, defined as a design constant, that contains both chest halves and every Swollen_Sides and Decompressed_Sides mark
- **Avatar_Scene**: The night hospital room drawn behind the character inside the Avatar's SVG: a window with a full moon and the two bats, an IV pole with a bag and a tube, a metal bed headboard and a pillow, all in one group with `data-part="scene"`
- **Quilt**: The patchwork blanket over the character's lap, drawn as its own group with `data-part="quilt"` in front of the character's torso and chest (Requirement 3.36)
- **Outline_Colour**: The single outline colour of the Avatar's character and Avatar_Scene, exported from the Avatar component as the design constant `OUTLINE_COLOUR`
- **Outline_Width**: The single outline stroke width of the Avatar's character and Avatar_Scene, exported from the Avatar component as the design constant `OUTLINE_WIDTH`
- **Shade_Shape**: A flat, darker shape with `data-part="shade"` that draws the shadow side of a part of the Avatar in two-tone cel shading
- **Window_Region**: A rectangle in the Avatar's viewBox, defined as the design constant `WINDOW_BOX`, that contains the window, the moon and both bats
- **IV_Region**: A rectangle in the Avatar's viewBox, defined as the design constant `IV_BOX`, that contains the IV pole, the IV bag and the IV tube
- **Gown_Opening**: A rectangle in the Avatar's viewBox, defined as the design constant `GOWN_OPENING`, that spans the gap between the inner edges of the two chest halves over their height
- **Conservative_Bounding_Box**: The smallest axis-aligned rectangle that contains every coordinate of a shape, including the control points of path curves, so that it is never smaller than the drawn shape
- **Sleeve_Hem_Centre**: For one arm group, the mean x coordinate of the vertices of that group's shapes that lie within 0.5 viewBox units of a vertex of the gown panel in the same half, that is, the middle of the sleeve-hem join of Requirement 3.45
- **Quilt_Fold_Shade**: A Shade_Shape inside the Quilt that is a `path` filled with the quilt shade colour, whose path data contains at least one `Q` or `C` command, and whose Conservative_Bounding_Box is at least 60 viewBox units wide with its top edge at or below y = 204, so that it lies across the quilt patches and not on the turned-down hem
- **Skin_Tone**: One of `healthy`, `pale` or `cyanotic`. `cyanotic` means pale skin with blue lips
- **Vital_Band**: The pair (Alarm_State, direction) for one vital sign. The direction is `low` or `high` when the Alarm_State is `warning` or `critical`, according to whether a low boundary or a high boundary was crossed. The direction is `none` when the Alarm_State is `normal`
- **Overall_Status**: The most severe Alarm_State across the vital signs that have thresholds in the Case, with order `normal` < `warning` < `critical`
- **Status_Sentence**: One short plain-language sentence shown under the Avatar, for example "He is breathing fast and getting pale."
- **Status_Rule**: An entry in the Play_Section with a list of Vital_Band conditions and a Status_Sentence
- **Status_Selector**: The pure function that selects the Status_Sentence from the Vital_Bands and the Status_Rules
- **Diagnosis_Terms**: A list of words in the Play_Section that name the diagnosis (for example "pneumothorax"). Status_Sentences must not contain them
- **Vital_Condition**: A comparison of one vital sign with a number. It has a vital name, an operator (`<`, `<=`, `>=` or `>`) and a value
- **Rescue_Condition**: The Play_Section definition of the `rescued` Ending: a list of Vital_Conditions that must all hold continuously for a Hold_Duration, counted only after the first Scheduled_Insult has been applied and only from the Rescue_Gate_Time
- **Required_Interventions**: The optional list `endings.rescued.requiredInterventions` in the Play_Section: the intervention_ids of the Interventions that must all be in the Active_Interventions before a sample can count toward the Rescue_Condition
- **Rescue_Gate_Time**: For the current Branch_Lineage, the earliest Simulation_Time from which samples can count toward the Rescue_Condition. When the Play_Section lists Required_Interventions, it is the largest, over the Required_Interventions, of the smallest Simulation_Time of an Active_Interventions entry with that intervention_id, and it is `null` (the gate is closed) when any Required_Intervention has no such entry. When the Play_Section lists no Required_Interventions, it is minus infinity (the gate is always open)
- **Lost_Condition**: The Play_Section definition of the `lost` Ending: one or more groups of Vital_Conditions, each with its own Hold_Duration, plus an optional Time_Limit
- **Hold_Duration**: A length of Simulation_Time in seconds during which a group of Vital_Conditions must hold without interruption
- **Time_Limit**: A Simulation_Time in seconds, measured from Session start. When the Simulation_Time reaches it and the Rescue_Condition has not been met, the Ending is `lost`
- **Ending**: The outcome of a Branch: `none`, `rescued` or `lost`
- **Ending_Evaluator**: The pure function that computes the Ending from the ordered VitalSigns samples of the current Branch, the Play_Section and the Rescue_Gate_Time
- **Ending_Screen**: The Halloween-styled overlay shown when the Ending becomes `rescued` or `lost`
- **Goal_Text**: The plain-language goal from the Play_Section, shown in the Play_View
- **Hint**: One of up to three escalating plain-language hints in the Play_Section. Hint 1 says where to look and the last Hint names the action
- **Hint_Panel**: The Play_View control that reveals Hints one at a time
- **Hint_Record**: The Web_App's client-side record of each revealed Hint: hint index, Simulation_Time, branch_id and Wall_Clock_Time
- **Intervention_Record**: The Web_App's client-side record of each Intervention the Intervention_API accepted: intervention_id, action, side, Simulation_Time and branch_id
- **Branch_Lineage**: The current Branch plus its chain of parent Branches, each limited to the Simulation_Time at which its child Branch was forked
- **Active_Interventions**: The Intervention_Record entries that belong to the current Branch_Lineage
- **Rewind_Panel**: The Play_View control that lists Rewind_Moments and forks through the Fork_API
- **Rewind_Moment**: A Checkpoint from the Branch_Lineage shown with a time label and an optional plain-language phrase, for example "0:00 - at the start" (Requirement 10.5)
- **Swollen_Sides**: The anatomical sides (`Left` or `Right`) on which a tension pneumothorax Scheduled_Insult (action `SETensionPneumothorax`) has been applied and no Decompression on that side has been applied since
- **Decompression**: An Active_Intervention with action `SENeedleDecompression`
- **Decompressed_Sides**: The anatomical sides on which a Decompression has been applied in the current Branch_Lineage
- **Anatomical_Side**: A side named from the patient's point of view. The Avatar faces the viewer, so the patient's `Left` is drawn on the viewer's right and the patient's `Right` on the viewer's left
- **Speech_Bubble_Slot**: The empty, reserved place on the Avatar where a later spec will show the patient's speech
- **Reduced_Motion_Preference**: The user's operating-system setting exposed through the CSS media query `prefers-reduced-motion: reduce`
- **Safety_Notice**: The text "Educational simulation, not for clinical use"
- **Case_Schema**: The JSON Schema at `cases/case-schema.json`

## Requirements

### Requirement 1: Two views of one Session

**User Story:** As a visitor or a medical learner, I want to switch between Play and Clinician views of the same patient, so that I can follow the case in plain language or with the full monitor without losing my place.

#### Acceptance Criteria

1. WHEN the session page opens, the Case_Definition contains a Play_Section, and the learner has not selected a view for that Session earlier in the same browser tab, THE Web_App SHALL display the Play_View.
2. IF the Case_Definition has no Play_Section, THEN THE Web_App SHALL display the Clinician_View, SHALL show the View_Switcher's Play option as visible but disabled with the text "Play mode is not available for this case", and SHALL keep the Clinician_View displayed when the learner activates the disabled Play option.
3. THE Web_App SHALL display the View_Switcher in both the Play_View and the Clinician_View, and the View_Switcher SHALL indicate which of the two views is currently displayed.
4. WHEN the learner switches view with the View_Switcher, THE Web_App SHALL keep all of the following unchanged: the session_id, the current branch_id, the Vitals_Stream connection, every VitalSigns sample received before and during the switch, the Hint_Record, the Intervention_Record, the Ending, the Playback_Speed and the paused or running playback state. This includes Intervention_API and Fork_API responses that arrive after the switch for requests sent before it.
5. WHEN the learner switches view with the View_Switcher, THE Web_App SHALL send no request to the Playback_API, Intervention_API or Fork_API, SHALL create no new Session, SHALL open no new Vitals_Stream connection and SHALL not reload the page.
6. WHEN the learner switches view with the View_Switcher, THE Web_App SHALL show the new view, displaying the most recent VitalSigns sample received, within 500 ms of Wall_Clock_Time measured from activation of the View_Switcher.
7. THE Clinician_View SHALL keep the existing Monitor_UI behaviour defined in core-simulation-loop Requirement 8, including the clinical Intervention labels, except that every Alarm_State SHALL follow Requirement 15.
8. THE Web_App SHALL display the Safety_Notice at the top of the viewport in the Play_View, in the Clinician_View and on the Ending_Screen. The Safety_Notice SHALL be visible without scrolling and SHALL stay visible while the page content scrolls, at viewport widths from 320 px to 1920 px, and no overlay, including the Ending_Screen, SHALL cover it.
9. WHEN the session page opens and the learner selected a view for that Session earlier in the same browser tab, THE Web_App SHALL display the most recently selected view, unless criterion 2 applies, in which case it SHALL display the Clinician_View.
10. WHILE the Case_Definition request for the Session is pending, THE Web_App SHALL show a loading indicator in place of the Play_View and the Clinician_View and SHALL keep the View_Switcher disabled.
11. IF the Case_Definition request fails or returns no response within 10 seconds of Wall_Clock_Time, THEN THE Web_App SHALL display the Clinician_View, SHALL show the View_Switcher's Play option as disabled with an error message indicating that the case could not be loaded, and SHALL keep the session_id, current branch_id and Vitals_Stream connection unchanged.

### Requirement 2: Case file additions for Play mode

**User Story:** As a case author, I want to define Play mode content in the case file, so that goals, hints and plain-language text are reviewable clinical content and not hard-coded in the UI.

#### Acceptance Criteria

1. THE Case_Schema SHALL define `playLabel` as an optional string of 1 to 80 characters on each Intervention.
2. THE Case_Schema SHALL define `play` as an optional top-level object and `playLabel` as an optional Intervention field, so that a Case_Definition with neither field validates with the same result against the updated Case_Schema as against the current one, apart from the `SENeedleDecompression` parameter rule in criterion 20.
3. THE Case_Schema SHALL require these fields in the Play_Section: `goalText` (string of 1 to 120 characters), `endings`, `hints`, `status` and `diagnosisTerms` (array of 1 to 10 strings, each 1 to 40 characters). It SHALL also reject any property that this requirement does not define, both in the Play_Section and in every object nested inside it.
4. THE Case_Schema SHALL define `endings.rescued` with `conditions` (array of 1 to 6 Vital_Conditions) and `holdSeconds` (number greater than 0).
5. THE Case_Schema SHALL define `endings.lost` with `groups` (array of 0 to 5 entries, each with `conditions` as an array of 1 to 6 Vital_Conditions and `holdSeconds` greater than 0) and an optional `timeLimitSeconds` (number greater than 0). It SHALL reject an `endings.lost` that has neither at least one entry in `groups` nor a `timeLimitSeconds`.
6. THE Case_Schema SHALL define a Vital_Condition with three fields, using the same vital names as the `alarms` object:
   - `vital`: one of `heartRate`, `respiratoryRate`, `spO2`, `meanArterialPressure`, `etCO2` or `tidalVolume`
   - `op`: one of `<`, `<=`, `>=` or `>`
   - `value`: a number greater than or equal to 0. When `vital` is `spO2`, `value` SHALL be between 0 and 1 inclusive, because VitalSigns reports SpO2 as a fraction.
7. THE Case_Schema SHALL define `hints` as an array of 1 to 3 items in reveal order, with the first item as Hint 1. Each item SHALL have `text` (string of 1 to 160 characters) and an optional `references` array of 1 or more non-empty citation strings.
8. THE Case_Schema SHALL define `status` with `rules` (array of 0 to 20 Status_Rules) and `defaultSentence` (string of 1 to 80 characters).
9. THE Case_Schema SHALL define each Status_Rule with two fields:
   - `when`: array of 1 to 6 items. Each item has `vital` (a Vital_Condition vital name), `band` (one of `normal`, `warning` or `critical`) and an optional `direction` (`low` or `high`). The Case_Schema SHALL reject a `direction` on an item whose `band` is `normal`.
   - `sentence`: string of 1 to 80 characters.
10. THE Case_Schema SHALL define an optional `avatar.referenceTidalVolumeMl` (number greater than 0) in the Play_Section.
11. THE Case_Schema SHALL define an optional `references` array of 1 or more non-empty citation strings on the Play_Section, on `endings.rescued` and on `endings.lost`.
12. WHEN `python scripts/validate-case.py cases/adult-tension-pneumothorax.yaml` is run from the repository root against the updated Case_Schema, THE script SHALL report that the case file is valid and exit with status 0.
13. WHEN the Physiology_Service creates a Session for `adult-tension-pneumothorax` from the updated case files, THE Case_Definition returned by `GET /sessions/{id}/case` SHALL contain the Play_Section and every Play_Label with values equal to those in `cases/adult-tension-pneumothorax.yaml`, with no file under `services/physiology/` changed.
14. THE `cases/adult-tension-pneumothorax.yaml` file SHALL define a Play_Label for each of its two Interventions. Each Play_Label SHALL differ from the Intervention's clinical `label` and SHALL contain the word "left" or "right" matching the Intervention's `side` parameter, for example "Let the trapped air out - left side (needle)" for `needle-decompression-left` and "Let the trapped air out - right side (needle)" for `needle-decompression-right`.
15. THE `cases/adult-tension-pneumothorax.yaml` file SHALL give every item below a `TODO(author)` comment, on the same line or the line directly above, that names the clinical review or citation needed. The items are every number in the Play_Section, every Hint `text`, every Status_Rule `sentence` and the `defaultSentence`. An item is exempt only when the `references` array that covers it is non-empty:
   - a Hint is covered by its own `references`;
   - a number inside `endings.rescued` or `endings.lost` is covered by that object's `references`;
   - Status_Rule sentences, the `defaultSentence` and `avatar.referenceTidalVolumeMl` are covered by the Play_Section `references`.
16. THE `cases/adult-tension-pneumothorax.yaml` file SHALL list "pneumothorax" and "tension" in `diagnosisTerms`.
17. IF a case file contains a Play_Section or Play_Label that violates the Case_Schema, THEN `scripts/validate-case.py` SHALL report a validation failure that names the path of the violating field, and SHALL exit with a non-zero status.
18. IF a case file contains a Play_Section or Play_Label that violates the Case_Schema, THEN THE Case_Loader SHALL refuse to load the Case with its existing case-load error and SHALL not start a Session from that file, with no file under `services/physiology/` changed.
19. THE `cases/adult-tension-pneumothorax.yaml` file SHALL contain no Diagnosis_Term in any Status_Rule `sentence` or in the `defaultSentence`. The check SHALL be a case-insensitive substring match, and the automated test in Requirement 5.9 checks this rule.
20. THE Case_Schema SHALL restrict the `parameters` of every Intervention whose `action` is `SENeedleDecompression` so that `side` is one of the strings "Left" or "Right" and `state` is one of the strings "On" or "Off". A case file whose `state` is an unquoted YAML value that loads as a boolean (for example `state: On` loading as `true`) SHALL then be rejected by the existing Case_Loader validation, as in criterion 18, and by `scripts/validate-case.py`, as in criterion 17. This is the follow-up from core-simulation-loop task 3.4.
21. THE Case_Schema SHALL define an optional `requiredInterventions` field on `endings.rescued`: an array of 1 or more unique strings, each at least 1 character long, that lists the Required_Interventions.
22. THE web test suite SHALL verify for `cases/adult-tension-pneumothorax.yaml` that every entry of `endings.rescued.requiredInterventions` equals the `id` of an Intervention in the same case file, and SHALL name each unknown entry in the failure output. The Case_Schema checks only the shape of the list, so this case-content test is the existence check.
23. THE `cases/adult-tension-pneumothorax.yaml` file SHALL list exactly one entry, `needle-decompression-left`, in `endings.rescued.requiredInterventions`, which is the Intervention on the side of the case's `SETensionPneumothorax` Scheduled_Insult. A comment on the same line or the line directly above SHALL state that this is the author's decision of 2026-11-20 that rescue counts only after the left needle decompression. This entry is a game rule decided by the author and SHALL carry no `TODO(author)` marker; every other drafted Play_Section value keeps the marker that criterion 15 requires.

### Requirement 3: The stitched patient Avatar

**User Story:** As a visitor, I want to see a friendly cartoon patient, so that I can tell at a glance how the patient is doing without reading numbers.

#### Acceptance Criteria

1. THE Avatar SHALL be a React component that renders exactly one inline SVG element from Avatar_Parameters and that contains no raster image elements, no references to raster image files and no references to external image URLs.
2. THE Avatar SHALL depict a small patchwork person with at least three visible cross-stitch marks on the skin, exactly two bolts on the neck (one on each side of the neck) and a light blue hospital gown that covers the shoulders, the upper arms and the sides of the torso and is open at the front, so that the chest shows as skin between the gown edges, verified through manual inspection during acceptance testing.
3. THE Play_View SHALL use deep purple as the dominant background colour and pumpkin orange as the accent colour, verified through manual inspection during acceptance testing.
4. THE Avatar SHALL show no blood, open wounds, exposed bone, fangs or skulls in any combination of Avatar_Parameters, so that the Avatar reads as friendly and not frightening.
5. THE Avatar SHALL be built only from artwork created for this project and SHALL contain no artwork, traced outlines or SVG paths copied from third-party sources.
6. WHEN the Avatar is reviewed during acceptance testing, THE reviewer SHALL record a confirmation that the Avatar does not reproduce any character from an existing film, game or franchise, for example the 1931 Universal Pictures design of Frankenstein's monster.
7. THE Avatar SHALL contain an Anatomical_Side-aware chest region in which every element drawn for the patient's `Left` (including Swollen_Sides and Decompressed_Sides marks) lies within the viewer's right half of the Avatar, and every element drawn for the patient's `Right` lies within the viewer's left half.
8. WHEN the Status_Sentence changes, THE Avatar SHALL set the accessible name of its SVG element, which carries `role="img"`, to the new Status_Sentence within 1 second of Wall_Clock_Time, and before any Status_Sentence has been selected, the accessible name SHALL be the Play_Section `status.defaultSentence`.
9. WHEN the Speech_Bubble_Slot receives non-empty text of up to 200 characters, THE Avatar SHALL render a visible speech bubble that contains the full text, wrapped across lines and not cut off.
10. WHILE the Speech_Bubble_Slot has no content, or its content is empty or contains only whitespace, THE Avatar SHALL render no visible speech bubble and SHALL leave the Avatar's layout and size unchanged.
11. WHILE the Speech_Bubble_Slot shows text of up to 200 characters, THE Avatar SHALL place the speech bubble so that its bounding box does not overlap the bounding box of the Avatar's face or of the chest region, at viewport widths of 320 CSS pixels and 1280 CSS pixels.
12. WHEN the Avatar is rendered twice with equal Avatar_Parameters and equal Speech_Bubble_Slot content, THE Avatar SHALL produce identical SVG markup.
13. THE Avatar SHALL draw its eyes, brows and mouth inside exactly one group that carries a `data-expression` attribute whose value is the current Expression, one of `calm`, `worried`, `alarmed`, `joyful` or `sleepy`.
14. WHILE the Avatar_Variant is `live` and the Overall_Status is `normal`, THE Avatar SHALL show the `calm` Expression: open eyes and a small smile.
15. WHILE the Avatar_Variant is `live` and the Overall_Status is `warning`, THE Avatar SHALL show the `worried` Expression: open eyes, brows drawn together with their inner ends lower than their outer ends, and a small frown.
16. WHILE the Avatar_Variant is `live` and the Overall_Status is `critical`, THE Avatar SHALL show the `alarmed` Expression: wide eyes whose eye whites are larger than in the `calm` Expression, and a small open round mouth.
17. WHILE the Avatar_Variant is `rescued`, THE Avatar SHALL show the `joyful` Expression, whatever the Overall_Status: crescent eyes, a big grin, and at least three sparkles placed outside the Face_Feature_Region.
18. WHILE the Avatar_Variant is `lost`, THE Avatar SHALL show the `sleepy` Expression, whatever the Overall_Status: closed, drooping eyes, a small sad mouth and exactly one tear, drawn as a single small light-blue drop.
19. THE Avatar SHALL draw the eyes of every Expression without crossed strokes, X shapes or any other symbol of death, and SHALL place no cross-stitch mark inside the bounding box of an eye.
20. THE Avatar SHALL draw, for every combination of Avatar_Parameters and Avatar_Variant, a snug knitted pumpkin beanie with a ribbed brim, pumpkin ridges and a short green stem that overlaps the top of the head (`data-part="hat"`, Requirement 3.43), exactly two small bats flying inside the window of the Avatar_Scene in front of the moon (`data-part="bat"`, Requirement 3.54) and exactly two groups of sparks, one next to each neck bolt (`data-part="spark"`).
21. THE Avatar SHALL draw the hat, the bats and the sparks so that the bounding box of each lies outside the Face_Feature_Region and outside the Chest_Region, and SHALL give none of them a `data-side` attribute.
22. WHILE the Expression is `calm`, `worried` or `alarmed`, THE Avatar SHALL animate an eye blink (class `sp-blink`) as a repeating CSS animation with a period between 4 and 10 seconds of Wall_Clock_Time.
23. WHILE the Avatar_Variant is `live` or `rescued`, THE Avatar SHALL animate a head tilt of at most 2 degrees (class `sp-tilt`) as a repeating CSS animation with a period between 6 and 15 seconds of Wall_Clock_Time, on one group that contains the head, the face and the hat.
24. THE Avatar SHALL draw every element that carries a `data-side` attribute as a direct child of its SVG element, outside the head-tilt group and outside every other group.
25. THE Avatar SHALL animate the sparks (class `sp-spark`) and the bats (class `sp-bat`) as repeating CSS animations with periods of at least 5 seconds of Wall_Clock_Time, in which no bat moves more than 3 viewBox units from its drawn position and the sparks change only their opacity.
26. WHILE Decompressed_Sides is not empty, THE Avatar SHALL give both neck bolts the class `sp-celebrate-bolt` and the group around the heart patch the class `sp-celebrate-heart`, whose CSS animations run exactly once (`animation-iteration-count: 1`) for at most 1 second of Wall_Clock_Time, so that the bolts flash once and the heart patch hops once when the decompression marks first appear.
27. WHILE Decompressed_Sides is empty, THE Avatar SHALL draw no element with the class `sp-celebrate-bolt` or `sp-celebrate-heart`.
28. WHILE the Reduced_Motion_Preference is `reduce`, THE Avatar SHALL show the eyes, head, sparks, bats, bolts and heart patch with no blink, tilt, spark, bat or celebration animation, drawn still at their drawn positions.
29. THE Avatar SHALL draw blush on both cheeks (exactly two elements with `data-part="blush"`) and at least three freckles (`data-part="freckle"`), SHALL draw no sticking plaster (no element with `data-part="plaster"`), and SHALL draw the checked fabric look (`data-part="fabric-check"`) and the striped fabric look (`data-part="fabric-stripe"`) each on one patch of the Quilt and on no skin piece.
30. THE Avatar SHALL draw the checked and striped fabric looks only with plain SVG lines and shapes inside each quilt patch, and, in every combination of Avatar_Parameters and Avatar_Variant, SHALL contain no `id` attribute, no gradient, and no `<pattern>`, `<clipPath>`, `<mask>`, `<filter>` or `<defs>` element.
31. THE Avatar SHALL derive the Expression, the dress-up parts, the idle motions and the celebration only from its existing Avatar_Parameters and Avatar_Variant props, with no new prop on the Avatar component, no new field in Avatar_Parameters and no random or time-dependent value, so that Requirement 3.12 continues to hold.
32. THE Avatar SHALL apply Requirements 3.4, 3.5 and 3.6 to all artwork added by criteria 13 to 30 and 34 to 56: the beanie, hair locks, eyes, nose, bats, sparks, sparkles, tear, blush, freckles, fabric looks, gown print, window, moon, IV pole, headboard, pillow and Quilt are original, show no blood, wounds, bone, fangs or skulls, the skin is never green and the head is never flat, verified through manual inspection during acceptance testing.
33. THE Avatar SHALL draw the mouth of every Expression as, or with, exactly one element with `data-part="lips"` whose fill (or stroke, for a mouth drawn as a single curve) is the Skin_Tone's lips colour, so that the cyanotic blue lips stay visible (Requirement 4.5).
34. THE Avatar SHALL draw every element that has a stroke with a stroke colour equal to the Outline_Colour and a stroke width equal to the Outline_Width, and SHALL set `stroke-linejoin="round"` and `stroke-linecap="round"` on its SVG element with no descendant setting another value for either. Only these elements, and their descendants, keep their own stroke colour and width:
   - the face group, whose strokes Requirements 3.13 to 3.19 and 3.33 define;
   - seams (`data-part="seam"`), cross-stitch marks (`data-part="stitch"`) and the stitched heart (`data-part="heart"`), which use the seam colour;
   - the fabric lines (`fabric-check`, `fabric-stripe`), the bolt sparks (`spark`), the joyful sparkles (`sparkle`) and the IV tube (`data-part="iv-tube"`), which are thin detail lines;
   - the sweat drops (`data-part="sweat"`) and every element with a `data-side` attribute, whose strokes are vital-sign cues (Requirements 4.11, 4.17 and 4.23).
35. THE Avatar SHALL draw the Avatar_Scene as exactly one group with `data-part="scene"` that is the first child element of its SVG element and that contains, in this document order, the window (`data-part="window"`), the moon (`data-part="moon"`), the two bats (`data-part="bat"`), the IV pole (`data-part="iv-pole"`), the IV bag (`data-part="iv-bag"`), the IV tube (`data-part="iv-tube"`), the bed headboard (`data-part="headboard"`) and the pillow (`data-part="pillow"`).
36. THE Avatar SHALL draw the Quilt as exactly one group with `data-part="quilt"` that is a direct child of its SVG element, that comes after the torso group, the head-tilt group, every element with a `data-side` attribute and the heart-hop group in document order, and that is followed only by the `hands` skin piece group, which holds both arm groups, so that the mitten hands rest on the Quilt.
37. THE Avatar SHALL draw the Quilt with at least four quilt patches (`data-part="quilt-patch"`) joined by seams with at least two cross-stitch marks, and SHALL draw the `fabric-check` and `fabric-stripe` groups each inside the Conservative_Bounding_Box of one quilt patch.
38. THE Avatar SHALL draw every shape element (`rect`, `circle`, `ellipse`, `line`, `polygon` or `path`) of the Avatar_Scene with a Conservative_Bounding_Box that is disjoint from the Face_Feature_Region.
39. THE Avatar SHALL draw the Quilt so that the top edge of its Conservative_Bounding_Box lies below the bottom edge of the Chest_Region, so that the Quilt covers no chest half, Swollen_Sides mark or Decompressed_Sides mark.
40. THE Avatar SHALL draw the window and the moon inside the Window_Region, which lies in the viewer's left half of the viewBox (right edge at most x = 100) and above the Chest_Region.
41. THE Avatar SHALL draw the IV pole, the IV bag and the IV tube inside the IV_Region, which lies in the viewer's right half of the viewBox (left edge at least x = 100) and is disjoint from the Conservative_Bounding_Boxes of the torso group, the head-tilt group and the `hands` skin piece group.
42. THE Avatar SHALL draw the head as one circle (`data-part="head"`) with a diameter of at least 70 viewBox units.
43. THE Avatar SHALL draw the hat with a Conservative_Bounding_Box that lies entirely above the centre of the head circle and whose bottom edge lies at least 8 viewBox units below the top of the head circle, so that the hat sits on the head.
44. THE Avatar SHALL draw at least six hair locks (`data-part="hair-lock"`), each with a Conservative_Bounding_Box disjoint from the Face_Feature_Region, and at least one of them with a bottom edge below the bottom edge of the hat's Conservative_Bounding_Box, so that hair shows below the brim.
45. THE Avatar SHALL draw exactly two arm groups (`data-part="arm"`), one in each half of the viewBox. Each arm group SHALL contain an arm shape with at least two vertices that each lie within 0.5 viewBox units of a vertex of the gown panel in the same half, a seam (`data-part="seam"`) with at least one cross-stitch mark along that join, and a mitten hand (`data-part="mitten"`) whose Conservative_Bounding_Box intersects the Quilt's Conservative_Bounding_Box.
46. THE Avatar SHALL draw every shape element of both arm groups with a Conservative_Bounding_Box disjoint from the Conservative_Bounding_Box of every element with a `data-side` attribute, for both the normal and the swollen chest geometry, so that the arms, which are drawn after the chest elements, hide no chest half or side mark.
47. THE Avatar SHALL draw each Shade_Shape with a solid fill and with no stroke and no opacity attribute, SHALL fill each Shade_Shape with the current Skin_Tone's `shade` colour, the gown shade colour or the quilt shade colour, and SHALL draw at least three skin-coloured Shade_Shapes inside the head-tilt group (on the far side of the head, under the hat brim and under the chin), at least one gown-coloured Shade_Shape inside the torso group and at least one quilt-coloured Shade_Shape inside the Quilt.
48. THE Avatar SHALL use, for each Skin_Tone, a `shade` colour whose relative luminance (WCAG 2.2 formula) is lower than the relative luminance of every patch colour of that Skin_Tone.
49. WHILE the Expression is `calm`, `worried` or `alarmed`, THE Avatar SHALL draw each eye with an eye white, an iris (`data-part="iris"`) inside the eye white, a pupil (`data-part="pupil"`) inside the iris and a white highlight (`data-part="eye-highlight"`) whose centre lies inside the iris, so that the eyes read as real eyes and not as button eyes.
50. THE Avatar SHALL draw, in every Expression, a small triangle nose (`data-part="nose"`) inside the face group as a `<polygon>` with exactly three points, lying inside the Face_Feature_Region and disjoint from the bounding boxes of the eye whites and of the `lips` element.
51. THE Avatar SHALL draw exactly two gown panels (`data-part="gown"`) inside the torso group, one in each half of the viewBox, and at least six gown dots (`data-part="gown-dot"`), each a `<circle>` with a fill and no stroke whose centre lies inside the Conservative_Bounding_Box of a gown panel.
52. THE Avatar SHALL draw both gown panels with Conservative_Bounding_Boxes disjoint from the Gown_Opening, so that the gown is open at the front.
53. THE Avatar SHALL fill both chest halves (`data-part="chest"` or `data-part="chest-swollen"`) with a patch colour of the current Skin_Tone, so that the chest between the gown edges shows as skin.
54. THE Avatar SHALL draw both bats inside the Window_Region and after the moon in document order, each with a Conservative_Bounding_Box that intersects the moon's Conservative_Bounding_Box, so that the bats fly in front of the moon.
55. THE Avatar SHALL give every fill colour inside the Avatar_Scene and the Quilt a relative luminance (WCAG 2.2 formula) no higher than the relative luminance of the darkest patch colour of the `healthy` Skin_Tone, so that the character stays the brightest part of the picture.
56. WHILE the Avatar_Variant is `lost`, THE Avatar SHALL give the class `sp-unstitch` only to the skin piece groups (`data-part="patch"`: head, forehead, cheek and hands) and to no element inside the Avatar_Scene, the torso group or the Quilt.
57. THE Avatar SHALL draw the character, the Avatar_Scene and the Quilt as one illustration lit from the window at the upper left, with every skin Shade_Shape on the viewer's-right side of, or below, the part it shades, verified through manual inspection during acceptance testing.
58. WHILE a side is not in Swollen_Sides, THE Avatar SHALL draw that side's chest half (`data-part="chest"`) with a stroke equal to the current Skin_Tone's `shade` colour, a stroke width of 1 and no `stroke-dasharray` attribute, so that the two chest halves read as one torso with a soft centre line.
59. WHILE a side is in Swollen_Sides, THE Avatar SHALL draw that side's chest half (`data-part="chest-swollen"`) with the stroke `#FF7A1A`, a stroke width of 2 and `stroke-dasharray="4 3"`, the values the swollen outline already uses.
60. THE Avatar SHALL draw each arm group so that the x coordinate of the centre of its mitten hand's Conservative_Bounding_Box lies at least 12 viewBox units closer to x = 100 than the arm group's Sleeve_Hem_Centre, so that the arm bends at the elbow and the mitten rests on the Quilt in front of the belly.
61. THE Avatar SHALL draw every shape element of the arm group in the viewer's left half whose Conservative_Bounding_Box reaches x = 43 or more, and every shape element of the arm group in the viewer's right half whose Conservative_Bounding_Box reaches x = 157 or less, with the top edge of that Conservative_Bounding_Box below y = 184, the bottom edge of the Chest_Region.
62. THE Avatar SHALL draw the Quilt with at least twelve quilt patches (`data-part="quilt-patch"`) of at least three different widths.
63. THE Avatar SHALL draw at least two Quilt_Fold_Shades inside the Quilt.
64. THE Avatar SHALL draw the hat with a Conservative_Bounding_Box whose bottom edge has a y coordinate of at most 38 and lies at least 14 viewBox units below the top of the head circle, so that the hat covers the top of the head.
65. THE Avatar SHALL draw, inside the hat group, exactly one brim (`data-part="brim"`) whose Conservative_Bounding_Box is at least as wide as the chord of the head circle at the y of that box's bottom edge.
66. WHILE the sweat flag is true, THE Avatar SHALL draw every sweat drop (`data-part="sweat"`) with a Conservative_Bounding_Box disjoint from the hat's Conservative_Bounding_Box.
67. THE Avatar SHALL draw every cross-stitch mark (`data-part="stitch"`) with a Conservative_Bounding_Box disjoint from the hat's Conservative_Bounding_Box and from the Conservative_Bounding_Box of every hair lock.
68. THE Avatar SHALL draw at least four hair locks in each half of the viewBox, counted by the x coordinate of each lock's Conservative_Bounding_Box centre, and in each half at least two hair locks whose Conservative_Bounding_Box bottom edge lies below the bottom edge of the hat's Conservative_Bounding_Box.
69. THE Avatar SHALL draw the arms bent at the elbow with the mittens resting on the Quilt, the Quilt as soft patchwork fabric with folds, and the beanie as a round knitted hat pulled down over the top of the head, with rounded brim ends over the side hair and a lower brim edge that follows the head's curve, verified through manual inspection during acceptance testing.

### Requirement 4: Avatar follows the live vitals

**User Story:** As a visitor, I want the patient's appearance to change with the patient's condition, so that I can see the patient getting worse or better.

#### Acceptance Criteria

1. THE Avatar_Mapper SHALL compute every Alarm_State with the Alarm_Function and the Case thresholds, so that the Play_View and the Clinician_View show the same Alarm_State for the same VitalSigns sample.
2. THE Avatar_Mapper SHALL compute each Vital_Band so that its Alarm_State equals the Alarm_Function result for the same value and thresholds. The direction SHALL be `low` when the value is below the `critical.low`, `warning.low` or `normal.low` threshold, `high` when the value is above the `critical.high`, `warning.high` or `normal.high` threshold, and `none` when the Alarm_State is `normal`.
3. WHEN the Avatar_Mapper receives a VitalSigns sample whose SpO2 Alarm_State is `normal`, THE Avatar_Mapper SHALL set Skin_Tone to `healthy`.
4. WHEN the Avatar_Mapper receives a VitalSigns sample whose SpO2 Alarm_State is `warning`, THE Avatar_Mapper SHALL set Skin_Tone to `pale`.
5. WHEN the Avatar_Mapper receives a VitalSigns sample whose SpO2 Alarm_State is `critical`, THE Avatar_Mapper SHALL set Skin_Tone to `cyanotic`.
6. WHEN the Avatar_Mapper receives a VitalSigns sample with a respiratory rate greater than 0, THE Avatar_Mapper SHALL set the breathing period to 60 divided by the respiratory rate, in Wall_Clock_Time seconds, with the same value at every Playback_Speed.
7. WHEN the Avatar_Mapper receives a VitalSigns sample with a respiratory rate of 0 or less, THE Avatar_Mapper SHALL mark breathing as stopped, so that the Avatar shows no breathing movement.
8. WHERE the Play_Section defines `avatar.referenceTidalVolumeMl`, THE Avatar_Mapper SHALL set the breathing depth to the sample's tidal volume divided by `referenceTidalVolumeMl`, clamped to the closed display range defined in the design, so that the depth is never below the range minimum or above the range maximum.
9. WHERE the Play_Section does not define `avatar.referenceTidalVolumeMl`, THE Avatar_Mapper SHALL set the breathing depth to the sample's tidal volume divided by the tidal volume of the first VitalSigns sample of the Session whose tidal volume is greater than 0, clamped to the same display range, or to the design-defined default depth while no such sample exists.
10. WHEN the Avatar_Mapper receives a VitalSigns sample with a heart rate greater than 0, THE Avatar_Mapper SHALL set the heartbeat period to 60 divided by the heart rate, in Wall_Clock_Time seconds, with the same value at every Playback_Speed.
11. WHEN the Avatar_Mapper receives a VitalSigns sample whose MAP Alarm_State is `warning` or `critical`, or whose heart rate Alarm_State is `critical`, THE Avatar_Mapper SHALL set the sweat flag to true.
12. WHEN the Avatar_Mapper receives a VitalSigns sample whose MAP Alarm_State is `normal` and whose heart rate Alarm_State is not `critical`, THE Avatar_Mapper SHALL set the sweat flag to false.
13. WHEN the Avatar_Mapper receives a VitalSigns sample whose Simulation_Time is greater than or equal to the `timeSeconds` of a Scheduled_Insult with action `SETensionPneumothorax`, THE Avatar_Mapper SHALL include that insult's `side` in Swollen_Sides, unless the Active_Interventions contain a Decompression on the same side with a Simulation_Time greater than or equal to that insult's `timeSeconds`.
14. WHEN the Intervention_API accepts a Decompression on a side that is in Swollen_Sides, THE Avatar_Mapper SHALL exclude that side from Swollen_Sides in every Avatar_Parameters it computes for a Simulation_Time at or after that Decompression's Simulation_Time on the current Branch_Lineage.
15. THE Avatar_Mapper SHALL set Decompressed_Sides to the sides of the Decompressions in the Active_Interventions of the current Branch_Lineage. After a fork through the Fork_API to a Checkpoint whose Simulation_Time is earlier than a Decompression, that Decompression's side SHALL be absent from Decompressed_Sides, and SHALL be back in Swollen_Sides if its tension pneumothorax insult has been applied.
16. WHEN the Intervention_API accepts a Decompression on a side that is not in Swollen_Sides, THE Avatar_Mapper SHALL leave the Swollen_Sides membership of every side unchanged.
17. WHILE a side is in Swollen_Sides, THE Avatar SHALL draw that side's chest half with a larger outline than the outline it has when the side is not in Swollen_Sides. The patient's `Left` SHALL be drawn on the viewer's right half and the patient's `Right` on the viewer's left half, as Requirement 3.7 states.
18. IF the Active_Interventions contain a Decompression whose Simulation_Time is earlier than the `timeSeconds` of a `SETensionPneumothorax` Scheduled_Insult on the same side, THEN THE Avatar_Mapper SHALL include that side in Swollen_Sides once the insult has been applied, as Requirement 4.13 implies. Engine check (open question 1, item d): the decompression-before-insult calibration scenario in Requirement 13.11 decides whether this criterion stays. Revise this criterion if that scenario shows that the earlier Decompression prevents the tension pneumothorax.
19. THE Avatar SHALL show the Overall_Status as an icon with a visible text label, `OK` for `normal`, `Worried` for `warning` and `Danger` for `critical`, so that colour is not the only signal.
20. WHEN the Web_App receives a new VitalSigns sample, or the current Branch changes through the Fork_API, THE Play_View SHALL show the Avatar drawn from the recomputed Avatar_Parameters within 500 ms of Wall_Clock_Time.
21. WHILE the Reduced_Motion_Preference is `reduce`, THE Avatar SHALL render without breathing, heartbeat, sweat-drop or Ending animation. It SHALL show the heart rate and respiratory rate Vital_Bands as static icons labelled `slow` for direction `low`, `normal` for direction `none` and `fast` for direction `high`, and SHALL keep Skin_Tone, the sweat flag, Swollen_Sides, Decompressed_Sides and Overall_Status visible as static drawing.
22. WHEN the Avatar_Mapper is called twice with identical inputs (VitalSigns sample, Case thresholds, Play_Section, applied Scheduled_Insults, Active_Interventions, and any previous-sample or first-sample values it uses), THE Avatar_Mapper SHALL return equal Avatar_Parameters (determinism property).
23. WHILE a side is in Decompressed_Sides, THE Avatar SHALL draw a small needle and a bandage on that side's chest half, with the patient's `Left` on the viewer's right half and the patient's `Right` on the viewer's left half, as Requirement 3.7 states.
24. WHEN the Avatar_Mapper receives a VitalSigns sample with a heart rate of 0 or less, THE Avatar_Mapper SHALL mark the heartbeat as stopped, so that the Avatar shows no heartbeat movement.
25. IF a VitalSigns sample has no value, or a non-finite value, for a vital sign, THEN THE Avatar_Mapper SHALL return Avatar_Parameters without raising an error. Each field derived from that vital sign SHALL keep the value computed from the previous sample of the current Branch, or the design-defined default when no previous sample exists.

### Requirement 5: Plain-language status

**User Story:** As a visitor, I want one short sentence telling me how the patient is doing, so that I understand the situation without medical knowledge.

#### Acceptance Criteria

1. WHILE the Play_View is displayed, THE Play_View SHALL show exactly one Status_Sentence directly under the Avatar, in full and without truncation, at viewport widths of 360 px and above.
2. WHEN the Status_Selector is called, THE Status_Selector SHALL compute the current Vital_Bands from the most recent VitalSigns sample of the current Branch, as defined in Requirement 4.2, evaluate the Status_Rules in their Case_Definition order, and return the `sentence` of the first Status_Rule whose `when` conditions all match those Vital_Bands.
3. THE Status_Selector SHALL treat a `when` condition as matching only when its `band` equals the Alarm_State of the named vital sign and, if the condition has a `direction`, that `direction` equals the direction of the vital sign's Vital_Band; a condition without a `direction` SHALL match both directions of the given band.
4. IF a `when` condition names a vital sign that has no thresholds in the Case, or whose value is missing from the VitalSigns sample, THEN THE Status_Selector SHALL treat that condition as not matching.
5. IF no Status_Rule matches the current Vital_Bands, or the `rules` array is empty, THEN THE Status_Selector SHALL return the Play_Section `defaultSentence`.
6. WHILE the Play_View has received no VitalSigns sample for the current Session, THE Play_View SHALL show the Play_Section `defaultSentence` as the Status_Sentence.
7. FOR ALL VitalSigns samples, Case thresholds and Status_Rules, THE Status_Selector SHALL return a sentence that is character-for-character equal to one `rules[].sentence` or the `defaultSentence` of the Play_Section, and SHALL compose, alter or generate no other text.
8. FOR ALL VitalSigns samples, Case thresholds and Play_Sections, THE Status_Selector SHALL return the same sentence when called twice with the same inputs (determinism property).
9. FOR ALL Case files in `cases/` that contain a Play_Section, the automated test suite SHALL fail if any `rules[].sentence` or the `defaultSentence` contains any Diagnosis_Term as a substring, ignoring letter case. This test enforces the content rule in Requirement 2.19.
10. THE Status_Sentences in the Play_Section SHALL describe only how the simulated patient looks or is doing, and SHALL contain no instruction or recommendation addressed to the reader. The author confirms this during review, recorded by a `references` entry or a `TODO(author)` marker as required by Requirement 2.15.
11. THE Play_View SHALL show the Status_Sentence in an ARIA live region with `polite` priority. That live region SHALL contain only the Status_Sentence.
12. WHEN a received VitalSigns sample causes the Status_Selector to return a sentence different from the one displayed, THE Play_View SHALL show the new Status_Sentence within 500 ms of Wall_Clock_Time of receiving that sample.
13. WHEN a received VitalSigns sample causes the Status_Selector to return the sentence already displayed, THE Play_View SHALL leave the live region text unchanged, so that assistive technology does not announce it again.
14. WHILE the Play_View is displayed, THE Play_View SHALL show the Goal_Text from the Play_Section in full, without truncation.
15. WHERE the Play_Section defines `endings.lost.timeLimitSeconds`, THE Play_View SHALL show the remaining Simulation_Time as a progress bar with a text label in `M:SS` format. The remaining time equals `timeLimitSeconds` minus the Simulation_Time of the most recent VitalSigns sample of the current Branch, floored at 0.
16. WHEN a VitalSigns sample is received or the current Branch changes through the Fork_API, THE Play_View SHALL recompute the Status_Sentence and the remaining Simulation_Time from the most recent VitalSigns sample of the current Branch, and show the result within 500 ms of Wall_Clock_Time.

### Requirement 6: Ending evaluation

**User Story:** As a visitor, I want a clear goal and a clear ending, so that I know whether I saved the patient.

#### Acceptance Criteria

1. THE Ending_Evaluator SHALL be a pure function of the ordered VitalSigns samples of the current Branch, the Case thresholds, the Play_Section and the Rescue_Gate_Time, returning the same Ending for the same inputs without reading Wall_Clock_Time, the network or any state outside its inputs.
2. THE Ending_Evaluator SHALL return `none` for an empty sample sequence, for a Case_Definition without a Play_Section, and for any sample sequence in which no condition in Requirement 6.3, 6.4 or 6.5 has been met.
3. WHEN all Vital_Conditions of the Rescue_Condition have held in every consecutive sample over a stretch of Simulation_Time of at least `endings.rescued.holdSeconds`, and every sample in that stretch has a Simulation_Time greater than or equal to the earliest Scheduled_Insult `timeSeconds` (or greater than or equal to 0 if the Case has no Scheduled_Insults) and greater than or equal to the Rescue_Gate_Time, THE Ending_Evaluator SHALL return `rescued`. A sample with a Simulation_Time below either bound, and every sample evaluated while the Rescue_Gate_Time is `null`, SHALL neither start nor extend the Rescue_Condition stretch.
4. WHEN all Vital_Conditions of at least one Lost_Condition group have held in every consecutive sample over a stretch of Simulation_Time of at least that group's `holdSeconds`, THE Ending_Evaluator SHALL return `lost`.
5. WHERE the Play_Section defines `endings.lost.timeLimitSeconds`, WHEN a sample's Simulation_Time is greater than or equal to `endings.lost.timeLimitSeconds` and the Rescue_Condition has not been completed at or before that sample, THE Ending_Evaluator SHALL return `lost`.
6. IF a sample does not satisfy all Vital_Conditions of the Rescue_Condition or of a Lost_Condition group, THEN THE Ending_Evaluator SHALL set that condition's hold stretch to 0 seconds and start a new stretch at the next sample that satisfies all of that condition's Vital_Conditions.
7. THE Ending_Evaluator SHALL measure a hold stretch as the Simulation_Time of the latest sample minus the Simulation_Time of the first sample in the unbroken stretch, so a stretch of one sample measures 0 seconds.
8. IF a sample's Simulation_Time is not a finite number, or is less than or equal to the Simulation_Time of the previous accepted sample on the same Branch, THEN THE Ending_Evaluator SHALL ignore that sample: it adds no hold time, breaks no stretch and does not trigger Requirement 6.5.
9. IF one sample completes both the Rescue_Condition and a Lost_Condition group, or completes the Rescue_Condition at a Simulation_Time that also reaches `endings.lost.timeLimitSeconds`, THEN THE Ending_Evaluator SHALL return `rescued`.
10. WHEN the Ending_Evaluator has returned `rescued` or `lost` for a Branch, THE Ending_Evaluator SHALL keep returning that Ending for all later samples of the same Branch.
11. WHEN the Fork_API returns a new current Branch, THE Web_App SHALL discard the previous Branch's samples, set the Ending to `none`, set every hold stretch to 0 seconds, and evaluate only VitalSigns samples received for the new Branch after that response.
12. FOR ALL sample sequences, appending samples to a sequence whose Ending is `rescued` or `lost` SHALL leave the Ending unchanged (monotonic property).
13. FOR ALL sample sequences, the Ending_Evaluator SHALL return the same Ending whether it processes the samples one at a time or as a single batch (incremental equals batch property).
14. THE automated test suite SHALL verify for `cases/adult-tension-pneumothorax.yaml` that every Lost_Condition group shares at least one vital with the Rescue_Condition for which no single value satisfies both the rescue Vital_Condition and the lost Vital_Condition. Example: the rescued SpO2 threshold is greater than the lost SpO2 threshold. The thresholds themselves stay in the case file with a citation or a `TODO(author)` marker.
15. THE Ending_Evaluator SHALL treat a Vital_Condition as held for a sample only when comparing the sample's value of the named vital with the condition's `value` using the condition's `op` gives true. The sample value uses the unit the Vitals_Stream reports, with SpO2 as a fraction from 0 to 1.
16. IF a sample has no value for a vital named in a Vital_Condition, or that value is not a finite number, THEN THE Ending_Evaluator SHALL treat that Vital_Condition as not held for that sample.
17. IF the Fork_API request fails, THEN THE Web_App SHALL keep the current Branch, its samples, its hold stretches and its Ending unchanged.
18. WHERE the Play_Section lists Required_Interventions, THE Web_App SHALL set the Rescue_Gate_Time to the largest, over the Required_Interventions, of the smallest Simulation_Time of an Active_Interventions entry with that intervention_id, and SHALL set it to `null` when any Required_Intervention has no such entry in the Active_Interventions of the current Branch_Lineage.
19. WHERE the Play_Section lists Required_Interventions, THE Web_App SHALL count an Active_Interventions entry toward the Rescue_Gate_Time only when its intervention_id is a Required_Intervention, so that a Decompression on the other side (for example `needle-decompression-right` when `needle-decompression-left` is required) leaves the Rescue_Gate_Time unchanged.
20. WHERE the Play_Section lists no Required_Interventions, THE Web_App SHALL set the Rescue_Gate_Time to minus infinity, so that the Ending_Evaluator returns the same Ending as with the earliest Scheduled_Insult bound of criterion 3 alone.
21. WHEN the Fork_API returns a new Branch whose Branch_Lineage has no Active_Interventions entry for a Required_Intervention, for example after a fork to a Checkpoint earlier than the left Decompression, THE Web_App SHALL set the Rescue_Gate_Time to `null`, so that the Ending of the new Branch can become `rescued` only after the learner applies that Required_Intervention again on that Branch.
22. THE Ending_Evaluator SHALL receive the Rescue_Gate_Time as an input, as criterion 1 defines, and SHALL read neither the Intervention_Record nor the Branch_Lineage; the Web_App computes the Rescue_Gate_Time under criteria 18 to 20.
23. WHEN the Web_App loads the Case_Definition, loads the Session metadata, loads a Checkpoint list, restores the Intervention_Record, adds an Intervention_Record entry after an Intervention_API success, or makes a new Branch current after a Fork_API success, THE Web_App SHALL recompute the Rescue_Gate_Time from the Intervention_Record and the current Branch_Lineage before it evaluates the next VitalSigns sample.
24. IF a recomputed Rescue_Gate_Time is `null`, or is later than the start of an open Rescue_Condition stretch, while the Ending is `none`, THEN THE Web_App SHALL end that stretch, so that only a sample at or after the new Rescue_Gate_Time can start a new one. A change of the Rescue_Gate_Time SHALL leave the Ending, the Lost_Condition hold stretches and the result of every sample already evaluated unchanged.

### Requirement 7: Ending screen

**User Story:** As a visitor, I want a memorable ending screen, so that I know the outcome and can try again.

#### Acceptance Criteria

1. WHEN the Ending of the current Branch changes from `none` to `rescued` or `lost`, THE Web_App SHALL send exactly one pause request for that Branch to the Playback_API within 1 second of Wall_Clock_Time.
2. WHEN the Ending of the current Branch changes from `none` to `rescued` or `lost` while the Play_View is shown, THE Play_View SHALL display the Ending_Screen over the Play_View within 1 second of Wall_Clock_Time.
3. WHILE the Ending_Screen shows the `rescued` Ending, THE Ending_Screen SHALL display the text "He's breathing again.", a dark background with at least one Halloween decoration (a bat, a moon, a cobweb or a jack-o'-lantern), and the Avatar drawn with the Avatar_Parameters of the VitalSigns sample at which the Ending changed.
4. WHILE the Ending_Screen shows the `lost` Ending, THE Ending_Screen SHALL display a dark background with at least one Halloween decoration (a bat, a moon, a cobweb or a jack-o'-lantern), the Avatar with its stitches coming apart in an animation that lasts at most 3 seconds and then holds its final frame, and a "Rewind and try again" button that is visible from the moment the Ending_Screen appears.
5. WHEN the learner activates the "Rewind and try again" button or the Ending_Screen control that opens the Rewind_Panel, THE Play_View SHALL open the Rewind_Panel and SHALL keep the Ending_Screen open behind it until the Fork_API returns a new Branch.
6. THE Ending_Screen SHALL offer two controls for both Endings: one that opens the Rewind_Panel (for the `lost` Ending, this control is the "Rewind and try again" button), and one that switches to the Clinician_View without changing the Session, the current Branch or the Ending.
7. WHILE the Ending of the current Branch is `rescued` or `lost`, THE Play_View SHALL disable the Intervention buttons, so that activating them sends no request to the Intervention_API.
8. WHEN the Ending of the current Branch changes from `none` to `rescued` or `lost` while the Clinician_View is shown, THE Clinician_View SHALL display, within 1 second of Wall_Clock_Time, a banner with the Ending name (`Rescued` or `Lost`) and a control that switches to the Play_View and opens the Ending_Screen, and SHALL keep the banner visible while the Ending of the current Branch is `rescued` or `lost`.
9. THE Ending_Screen SHALL keep the Safety_Notice visible at the top of the viewport for both Endings.
10. IF the Playback_API returns an error response to the pause request in criterion 1, or does not respond within 5 seconds, THEN THE Web_App SHALL retry the pause request at most 2 more times at 2-second intervals. If all attempts fail, it SHALL keep the Ending and the Ending_Screen or banner, and SHALL show a plain-language message saying that the simulation could not be paused.
11. WHEN the learner switches to the Play_View while the Ending of the current Branch is `rescued` or `lost`, THE Play_View SHALL display the Ending_Screen for that Ending within 500 ms of Wall_Clock_Time.
12. WHILE the Reduced_Motion_Preference is `reduce`, THE Ending_Screen SHALL show the Avatar with its stitches already apart, and all Halloween decorations, as static images with no animation or transition.

### Requirement 8: Interventions with plain labels

**User Story:** As a visitor, I want treatment buttons in everyday words, so that I can act without knowing medical terms.

#### Acceptance Criteria

1. THE Play_View SHALL display exactly one button per Intervention in the Case_Definition, in the order the Interventions are listed in the Case_Definition.
2. WHERE an Intervention defines a Play_Label that contains at least one non-whitespace character, THE Play_View SHALL show that Play_Label as the full text of that Intervention's button.
3. WHERE an Intervention has no Play_Label, or has a Play_Label that is empty or contains only whitespace, THE Play_View SHALL show the Intervention's `label` as the full text of that Intervention's button.
4. THE Clinician_View SHALL show the Intervention's `label` on each Intervention button and SHALL NOT show any Play_Label.
5. WHEN the learner activates an Intervention button in the Play_View, THE Web_App SHALL send one request to the Intervention_API with the same intervention_id and parameters that the Clinician_View sends for that Intervention.
6. WHEN the Intervention_API returns a success response, THE Web_App SHALL add exactly one entry to the Intervention_Record containing the intervention_id, the action, the side parameter (or no side if the Intervention has none), the Simulation_Time of the latest VitalSigns sample received before the success response, and the branch_id of the current Branch.
7. WHEN the Intervention_API returns a success response, THE Play_View SHALL show a plain-language confirmation that contains the button text shown under criteria 2 and 3 for that Intervention, for at least 2 and at most 5 seconds of Wall_Clock_Time.
8. IF the Intervention_API returns an error response, or does not respond within 10 seconds of Wall_Clock_Time after the request was sent, THEN THE Play_View SHALL show the plain-language message "That didn't work. Please try again." for at least 2 and at most 5 seconds of Wall_Clock_Time, SHALL add no entry to the Intervention_Record, and SHALL leave the current Branch and the Intervention_Record unchanged.
9. WHILE the Web_App is not connected to the Vitals_Stream, THE Play_View SHALL disable all Intervention buttons.
10. WHILE a request from the Play_View to the Intervention_API is waiting for a response, THE Play_View SHALL disable all Intervention buttons, so that activating a button again sends no further request.
11. WHEN the Intervention_API returns a success or error response, or the 10-second wait from criterion 8 ends, AND the Web_App is connected to the Vitals_Stream, THE Play_View SHALL re-enable all Intervention buttons.
12. WHEN an entry is added to the Intervention_Record, THE Web_App SHALL store the full Intervention_Record of the Session in the browser tab's sessionStorage under a key that contains the session_id.
13. WHEN the session page opens and the browser tab's sessionStorage holds an Intervention_Record for the session_id, THE Web_App SHALL restore that Intervention_Record before computing the Active_Interventions.
14. IF the session page opens and the browser tab's sessionStorage holds no Intervention_Record for the session_id, or the stored value cannot be read, THEN THE Web_App SHALL start with an empty Intervention_Record. This covers the known limitation that a new browser tab or a cleared sessionStorage loses the record.

### Requirement 9: Hints

**User Story:** As a visitor, I want up to three hints that get more specific, so that I can find the right action without being told immediately.

#### Acceptance Criteria

1. WHILE the Play_View is shown and the Play_Section defines at least one Hint, THE Play_View SHALL display a Hint button that shows the number of Hints not yet revealed, as an integer from 0 to 3.
2. WHEN the learner activates the Hint button (by pointer click, or by the Enter or Space key while the button has keyboard focus) and fewer Hints have been revealed than the Play_Section defines, THE Hint_Panel SHALL reveal exactly one Hint, which SHALL be the next unrevealed Hint in Case_Definition order, and SHALL lower the remaining count shown on the Hint button by 1.
3. WHEN the number of revealed Hints equals the number of Hints in the Play_Section, THE Play_View SHALL disable the Hint button and SHALL keep every revealed Hint visible in Case_Definition order.
4. THE Hint_Panel SHALL count revealed Hints per Session within one page load. Forking a Branch through the Rewind_Panel or the Fork_API, and switching views with the View_Switcher, SHALL leave the revealed Hints, their order and the remaining count unchanged.
5. WHEN a Hint is revealed, THE Web_App SHALL add exactly one entry to the Hint_Record. The entry SHALL hold the 1-based hint index, the current branch_id, the Wall_Clock_Time and a Simulation_Time. The Simulation_Time SHALL come from the latest VitalSigns sample received on the current Branch. If no sample has arrived yet on that Branch, it SHALL be the `simulation_time` of the Checkpoint the Branch was forked from. If the Branch is the Session's first Branch and no sample has arrived, it SHALL be 0.
6. THE Web_App SHALL reveal and record Hints without calling the Intervention_API, the Fork_API or the Playback_API.
7. THE `cases/adult-tension-pneumothorax.yaml` file SHALL define exactly 3 Hints in this order:
   1. a pointer to where on the patient to look;
   2. a statement that the affected side is the patient's Left, which also tells the reader that the patient's Left is drawn on the viewer's right;
   3. a statement that names the action.

   Each Hint text SHALL carry a `TODO(author)` marker or a citation in a `references` field.
8. THE automated test suite SHALL verify two things. First, for every Hint except the last, the Hint text SHALL not contain any Intervention's Play_Label or `label`, compared case-insensitively. Second, the last Hint text SHALL contain the Play_Label of the Intervention it names, compared case-insensitively.
9. IF the Play_Section that the Web_App receives has no `hints` array or an empty one, THEN THE Play_View SHALL hide both the Hint button and the Hint_Panel. This is a defensive fallback only: the Case_Schema rejects such a Play_Section under Requirement 2.7, but the Case_Loader skips schema validation when the Case_Schema file is missing.
10. THE Case_Schema SHALL reject a Play_Section whose `hints` array has more than 3 entries, or contains a Hint whose `text` is empty or longer than 160 characters, as Requirement 2.7 defines.

### Requirement 10: Rewind in the Play view

**User Story:** As a visitor, I want to rewind to an earlier moment and try something else, so that I can learn from a wrong choice.

#### Acceptance Criteria

1. WHILE the Play_View is displayed, THE Play_View SHALL display a Rewind button, including while the Ending_Screen is shown.
2. WHEN the learner activates the Rewind button, THE Rewind_Panel SHALL open and list at most 5 Rewind_Moments, newest first. It SHALL choose them from the Checkpoints of every Branch in the Branch_Lineage whose Simulation_Time is less than the Simulation_Time of the latest VitalSigns sample of the current Branch.
3. WHERE the Play_Section defines `endings.lost.timeLimitSeconds`, THE Rewind_Panel SHALL list only Checkpoints whose Simulation_Time is less than `timeLimitSeconds`.
4. WHEN the learner activates the Rewind button and the Branch_Lineage contains at least one Intervention_Record entry, THE Rewind_Panel SHALL include the newest eligible Checkpoint whose Simulation_Time is less than the Simulation_Time of the newest Intervention_Record entry in the Branch_Lineage. "Eligible" means the Checkpoint meets criteria 2 and 3. If that Checkpoint is not among the 5 newest eligible Checkpoints, it SHALL take the place of the oldest of those 5, so the list never holds more than 5 Rewind_Moments.
5. THE Rewind_Panel SHALL label each Rewind_Moment with its Simulation_Time rounded down to the whole second and shown in `M:SS` format, with minutes unpadded and seconds zero-padded to two digits (for example "0:00", "1:30", "12:05"). The label SHALL follow the first rule in this list that matches:
   - "<time> - at the start" when the Simulation_Time rounded down to the whole second is 0;
   - "<time> - before you chose: <Play_Label>" when the Branch_Lineage holds an Intervention_Record entry whose Simulation_Time is greater than the Checkpoint's Simulation_Time. <Play_Label> belongs to the earliest such entry. If that Intervention has no Play_Label, <Play_Label> SHALL be replaced by the Intervention's clinical `label`;
   - "<time>" alone, with no " - " and no phrase, in every other case.
6. WHEN the learner selects a Rewind_Moment, THE Web_App SHALL call the Fork_API exactly once with that Rewind_Moment's checkpoint_id.
7. WHILE a Fork_API call is pending, THE Rewind_Panel SHALL disable selection of all Rewind_Moments and SHALL show the plain-language text "Rewinding…".
8. WHEN the Fork_API returns a new Branch, THE Web_App SHALL load the Session metadata, make the new Branch current, clear the VitalSigns history, reset the Ending to `none`, close the Ending_Screen and close the Rewind_Panel.
9. WHEN a new Branch is created through the Fork_API, THE Web_App SHALL compute the Active_Interventions as the Intervention_Record entries in the Branch_Lineage whose Simulation_Time is less than or equal to the fork Checkpoint's Simulation_Time.
10. IF the Fork_API returns an error response or does not respond within 30 seconds of the call, THEN THE Play_View SHALL show the plain-language message "Couldn't rewind. Please try again.", keep the current Branch, its VitalSigns history and its Ending unchanged, and re-enable selection of the listed Rewind_Moments.
11. IF the Checkpoint list request fails for any Branch in the Branch_Lineage, THEN THE Rewind_Panel SHALL show the plain-language message "Couldn't load earlier moments. Please try again." and SHALL keep the current Branch unchanged. It SHALL list no Rewind_Moments until the learner activates the Rewind button again.
12. IF no Checkpoint meets criteria 2 and 3, including the case where no VitalSigns sample has been received on the current Branch, THEN THE Rewind_Panel SHALL show the text "No earlier moments yet."
13. FOR ALL Branch_Lineages and Checkpoint lists, the Rewind_Moment selection function SHALL return at most 5 Checkpoints, sorted by Simulation_Time in descending order, with no duplicate checkpoint_id and with every returned Simulation_Time less than the Simulation_Time of the latest VitalSigns sample.

### Requirement 11: Accessibility and layout

**User Story:** As a visitor using a keyboard or with colour vision deficiency, I want every control and signal to be accessible, so that I can play without barriers.

#### Acceptance Criteria

1. THE Play_View SHALL show each Overall_Status value (`normal`, `warning`, `critical`) as an icon with a distinct shape and the visible text label defined in Requirement 4.19 (`OK`, `Worried` or `Danger`), next to the Status_Sentence, so that each Overall_Status value is still distinguishable when the Play_View is shown in greyscale.
2. THE Play_View SHALL make the View_Switcher, play and pause control, speed controls, Intervention buttons, Hint button, Rewind button, Rewind_Moments and Ending_Screen controls reachable with the Tab key. The focus order SHALL follow visual order: left to right within a row, and rows from top to bottom. Shift+Tab SHALL move through the same controls in reverse order.
3. WHEN a control in the Play_View has keyboard focus and the learner presses the Enter key or the Space key, THE Play_View SHALL perform the same action as a pointer click on that control.
4. WHILE a control in the Play_View has keyboard focus, THE Play_View SHALL show a focus indicator around that control that is at least 2 CSS pixels thick and has a contrast ratio of at least 3:1 against the adjacent background.
5. WHEN the Rewind_Panel or the Ending_Screen opens, THE Play_View SHALL move keyboard focus to the first focusable control inside that panel.
6. WHEN the learner presses Escape in the Rewind_Panel, or the Rewind_Panel closes without a fork, THE Play_View SHALL close the Rewind_Panel and return keyboard focus to the Rewind button.
7. WHILE the browser viewport is 1280x720 CSS pixels at 100% browser zoom, THE Play_View SHALL show the Avatar, Status_Sentence, Goal_Text, Safety_Notice, play and pause control, Intervention buttons, Hint button and Rewind button fully inside the viewport, with no vertical or horizontal scrolling, when anywhere from zero to three Hints are revealed.
8. WHILE the browser viewport is 1280x720 CSS pixels at 100% browser zoom, THE Play_View SHALL render all text, including the Safety_Notice and Ending_Screen text, at a font size of at least 16 CSS pixels and a contrast ratio of at least 4.5:1 against its background, so that the text is readable in a 1280x720 screen recording without scaling.
9. THE Play_View SHALL display a play and pause control and speed controls for 1x, 2x and 4x that send the same Playback_API requests as the matching Clinician_View controls. THE Play_View SHALL show the current playing or paused state, and the selected speed, with a text label or icon shape in addition to colour.
10. WHILE the Rewind_Panel or the Ending_Screen is open, THE Play_View SHALL keep keyboard focus on that panel's controls, so that Tab and Shift+Tab wrap from the last control to the first and from the first to the last.
11. THE Play_View SHALL show the `rescued` and `lost` Ending on the Ending_Screen as a text heading naming the Ending, and SHALL show the disabled state of the Hint button and the Intervention buttons with a text label or icon in addition to colour.
12. WHEN the Play_View is displayed for the first time for a Session in the current browser tab, THE Web_App SHALL send one Playback_API request that sets the Playback_Speed to 2x, the same request that the Clinician_View's 2x control sends, and the learner SHALL then be able to change the Playback_Speed to 1x, 2x or 4x with the controls in criterion 9. Later displays of the Play_View for the same Session, including every switch through the View_Switcher, SHALL send no speed request, as Requirement 1.5 states.
13. IF the Playback_API returns an error response to the default 2x request in criterion 12, or does not respond within 5 seconds of Wall_Clock_Time, THEN THE Play_View SHALL show the Playback_Speed that was selected before the request, SHALL not retry the request, and SHALL keep the 1x, 2x and 4x controls enabled.

### Requirement 12: Automated tests

**User Story:** As a maintainer, I want the Play mode logic covered by fast unit tests, so that changes to presentation logic do not break the patient's cues or endings.

#### Acceptance Criteria

1. THE web test suite SHALL include Vitest unit tests for the Avatar_Mapper with fixed inputs that cover each of these cases:
   - Skin_Tone `healthy`, `pale` and `cyanotic` for SpO2 values in the `normal`, `warning` and `critical` Alarm_State of the Case thresholds (Requirement 4.3 to 4.5);
   - breathing period equal to 60 divided by the respiratory rate, with the same value at Playback_Speed 1x, 2x and 4x (Requirement 4.6);
   - breathing marked as stopped at a respiratory rate of 0 (Requirement 4.7);
   - heartbeat period equal to 60 divided by the heart rate, with the same value at Playback_Speed 1x, 2x and 4x (Requirement 4.10);
   - heartbeat marked as stopped at a heart rate of 0 (Requirement 4.24);
   - sweat flag true for MAP `warning`, for MAP `critical`, and for heart rate `critical` with MAP `normal`, and sweat flag false for MAP `normal` with heart rate `normal` and for MAP `normal` with heart rate `warning` (Requirement 4.11 and 4.12);
   - breathing depth below the lower bound of the display range, inside it, and above its upper bound, with the result equal to the nearest bound when outside the range (Requirement 4.8 and 4.9);
   - breathing depth computed from `avatar.referenceTidalVolumeMl` when the Play_Section defines it, and from the tidal volume of the first VitalSigns sample of the Session when it does not (Requirement 4.8 and 4.9).
2. THE web test suite SHALL include Vitest unit tests for side handling with fixed inputs that cover each of these cases:
   - a `Left` `SETensionPneumothorax` Scheduled_Insult adds `Left` to Swollen_Sides once the Simulation_Time is greater than or equal to its `timeSeconds`, and not before;
   - a `Left` Decompression removes `Left` from Swollen_Sides and adds `Left` to Decompressed_Sides;
   - a `Right` Decompression with an untreated `Left` insult keeps `Left` in Swollen_Sides and adds `Right` to Decompressed_Sides (Requirement 4.16);
   - the patient's `Left` maps to the viewer's right half of the Avatar and the patient's `Right` to the viewer's left half (Requirement 3.7);
   - after a fork, the Active_Interventions include only the Intervention_Record entries in the Branch_Lineage whose Simulation_Time is less than or equal to the fork Checkpoint's Simulation_Time (Requirement 10.9).
3. THE web test suite SHALL include Vitest unit tests for the Status_Selector with fixed inputs that cover each of these cases:
   - when two Status_Rules match, the selector returns the one that comes first in Case_Definition order;
   - a Status_Rule with two or more `when` conditions does not match when only some of them match;
   - a `when` condition without `direction` matches both the `low` and the `high` direction of its band;
   - when no Status_Rule matches, the selector returns the `defaultSentence`.
4. THE web test suite SHALL include Vitest unit tests for the Ending_Evaluator and the Web_App's fork handling with fixed sample sequences that cover each of these cases:
   - each criterion in Requirements 6.2 to 6.10, 6.15 and 6.16;
   - a Rescue_Condition stretch exactly `holdSeconds` long returns `rescued`, and the same stretch with its last sample removed, so that it is shorter than `holdSeconds`, returns `none`;
   - samples with a Simulation_Time below the earliest Scheduled_Insult `timeSeconds` add no rescue hold time;
   - for each Lost_Condition group, a stretch exactly that group's `holdSeconds` long returns `lost`;
   - one failing sample inside a hold stretch restarts that stretch;
   - samples whose Simulation_Time is equal to or less than the previous sample's add no hold time;
   - a sample at exactly `timeLimitSeconds` returns `lost`, and a sample below it returns `none`;
   - one sample that completes both the Rescue_Condition and a Lost_Condition returns `rescued`;
   - after a fork, evaluation starts with no samples, so the new Branch's Ending is `none` and the previous Branch's samples add no hold time (Requirement 6.11);
   - after a failed Fork_API request, the current Branch, its samples, its hold stretches and its Ending are unchanged (Requirement 6.17).
5. THE web test suite SHALL include Vitest unit tests for Rewind_Moment selection and labelling with fixed inputs that cover each of these cases:
   - no more than 5 of the newest Checkpoints are listed, newest first;
   - only Checkpoints with a Simulation_Time less than that of the latest VitalSigns sample are listed;
   - when `timeLimitSeconds` is defined, only Checkpoints with a Simulation_Time less than `timeLimitSeconds` are listed;
   - the inclusion rule in Requirement 10.4 holds when the required Checkpoint is older than the 5 newest Checkpoints;
   - an empty result when there is no qualifying Checkpoint;
   - each of the three label rules in Requirement 10.5, including the clinical `label` fallback when an Intervention has no Play_Label;
   - `M:SS` formatting for 0 s ("0:00"), 90 s ("1:30") and 605 s ("10:05").
6. THE web test suite SHALL include a Vitest test that checks, for each vital sign with thresholds in `cases/adult-tension-pneumothorax.yaml`, two properties:
   - the Vital_Band Alarm_State equals the Alarm_Function result;
   - the Vital_Band direction is `none` exactly when the Alarm_State is `normal`.

   The test SHALL check these properties at each threshold boundary value, at each boundary value plus and minus a small per-vital offset defined in the design that does not cross another boundary, and at no fewer than 100 evenly spaced values from 50% of the lowest boundary to 150% of the highest boundary of that vital sign.
7. THE web test suite SHALL include Vitest tests that check the following content of `cases/adult-tension-pneumothorax.yaml`:
   - for Requirements 2.19 and 5.9, no Status_Sentence (`rules[].sentence` or `defaultSentence`) contains any Diagnosis_Term, using case-insensitive substring matching;
   - for Requirement 6.14, for each Lost_Condition group, at least one vital sign has Vital_Conditions in both the Rescue_Condition and that group that no single value satisfies at the same time;
   - for Requirement 9.8, the text of each Hint except the last contains no Intervention's Play_Label or `label`, using case-insensitive substring matching.
8. IF a case-content test in criterion 7 fails, THEN THE web test suite SHALL report the failing Status_Sentence, Lost_Condition group or Hint text in the failure output.
9. IF `cases/adult-tension-pneumothorax.yaml` has no Play_Section, THEN THE case-content tests in criterion 7 SHALL fail and SHALL NOT pass with nothing to check.
10. THE web test suite SHALL include Vitest property tests for Requirements 4.22, 5.7, 5.8, 6.12, 6.13 and 10.13. Each property SHALL be checked against no fewer than 100 generated inputs, created from a fixed seed so that every run uses the same inputs.
11. THE web test suite SHALL run with `vitest --run` while the Physiology_Service and the Pulse_Engine are not running, and SHALL open no HTTP or WebSocket connection.
12. WHEN the Play mode tests are run with `vitest --run` on a macOS Apple Silicon development machine, THE web test suite SHALL finish them within 30 seconds of Wall_Clock_Time.
13. THE web test suite SHALL include Vitest unit tests with fixed inputs for stopped vital signs: a VitalSigns sample with a heart rate of 0 makes the Avatar_Mapper mark the heartbeat as stopped (Requirement 4.24), and a VitalSigns sample with a respiratory rate of 0 makes the Avatar_Mapper mark breathing as stopped (Requirement 4.7).
14. THE web test suite SHALL include Vitest unit tests with fixed VitalSigns samples that omit the optional `systolic_pressure` and `diastolic_pressure` values, and samples that omit one vital sign named in the Case thresholds. For each such sample, the Avatar_Mapper, the Status_Selector and the Ending_Evaluator SHALL return a result without throwing, and the results SHALL follow Requirement 4.25 (Avatar_Mapper), Requirement 5.4 (Status_Selector) and Requirement 6.16 (Ending_Evaluator).
15. THE web test suite SHALL include Vitest tests of the rendered Avatar markup for Requirements 3.13 to 3.31 and 3.33 that cover each of these cases:
   - one fixed-input test per Expression, including a `rescued` and a `lost` Avatar with Overall_Status `critical` and with Overall_Status `normal`, so that the Avatar_Variant takes precedence over the Overall_Status;
   - no crossed strokes in the eyes and no cross-stitch mark inside an eye's bounding box, for every Expression;
   - the hat, exactly two bats and exactly two spark groups in every Expression, with bounding boxes outside the Face_Feature_Region and the Chest_Region and without a `data-side` attribute;
   - the celebration classes present when Decompressed_Sides is not empty and absent when it is empty;
   - the blush, freckles, checked patch and striped patch present, with the two patches on the Quilt, and no plaster;
   - exactly one `data-part="lips"` element in the Skin_Tone's lips colour for every Expression and every Skin_Tone;
   - no `id` attribute, gradient, `<pattern>`, `<clipPath>`, `<mask>`, `<filter>` or `<defs>` element in the markup;
   - a test that reads `apps/web/src/app/globals.css` and checks that the `prefers-reduced-motion: reduce` block stops every animation inside the Avatar, and that the classes `sp-blink`, `sp-tilt`, `sp-spark`, `sp-bat`, `sp-celebrate-bolt` and `sp-celebrate-heart` are defined, with an iteration count of 1 for the two celebration classes.
16. THE web test suite SHALL include Vitest tests of the rendered Avatar markup for Requirements 3.34 to 3.56 and 3.58 to 3.68, run for every Skin_Tone, every Expression and both the normal and the swollen chest geometry, that cover each of these cases:
   - every stroked element outside the exempt parts uses the Outline_Colour and the Outline_Width, and the SVG element sets round line joins and caps that no descendant overrides (3.34);
   - the scene group is the first child of the SVG element and holds the window, moon, bats, IV pole, IV bag, IV tube, headboard and pillow in that order (3.35);
   - the Quilt comes after the torso, head-tilt, `data-side` and heart-hop elements, is followed only by the `hands` group, has at least four quilt patches with seams and stitches, and holds the checked and striped fabric looks inside quilt patches (3.29, 3.36, 3.37);
   - no Avatar_Scene shape intersects the Face_Feature_Region, the Quilt lies below the Chest_Region, the window and moon lie inside the Window_Region, and the IV parts lie inside the IV_Region, which is disjoint from the character groups (3.38 to 3.41);
   - the head diameter, the hat's overlap with the head, and the hair locks clear of the face and below the brim (3.42 to 3.44);
   - the arm joins, the mittens on the Quilt, and no arm shape over a `data-side` element (3.45, 3.46);
   - the Shade_Shape fills and counts, and each Skin_Tone's `shade` colour darker than its patch colours (3.47, 3.48);
   - the iris, pupil and highlight in the open-eyed Expressions, and the triangle nose in every Expression (3.49, 3.50);
   - the gown panels, the gown dots, the Gown_Opening and the skin-coloured chest halves (3.51 to 3.53);
   - both bats inside the Window_Region, after the moon and over it (3.54);
   - the relative luminance of every Avatar_Scene and Quilt fill (3.55);
   - `sp-unstitch` only on the skin piece groups in the `lost` variant (3.56);
   - the normal chest-half stroke in the Skin_Tone's `shade` colour, width 1, with no dash, and the swollen chest-half stroke `#FF7A1A`, width 2, dash `4 3` (3.58, 3.59);
   - each mitten centred at least 12 units closer to x = 100 than its Sleeve_Hem_Centre, and every arm shape that reaches x ≥ 43 (viewer's left) or x ≤ 157 (viewer's right) starting below y = 184 (3.60, 3.61);
   - at least twelve quilt patches of at least three widths, and at least two Quilt_Fold_Shades (3.62, 3.63);
   - the hat's bottom edge at y 36 to 38, and the brim at least as wide as the head chord at its bottom edge (3.64, 3.65);
   - no sweat drop intersecting the hat, no cross-stitch mark intersecting the hat or a hair lock, and at least four hair locks per half with at least two per half below the hat (3.66 to 3.68).
17. THE web test suite SHALL include Vitest tests for the Rescue_Gate_Time that cover each of these cases:
   - with a fixed finite Rescue_Gate_Time, samples that satisfy the Rescue_Condition before it add no rescue hold time, and a stretch exactly `holdSeconds` long that starts at it returns `rescued` (Requirement 6.3);
   - with Required_Interventions and a `null` Rescue_Gate_Time, a sequence whose samples all satisfy the Rescue_Condition never returns `rescued`, and still returns `lost` through a Lost_Condition group and through the Time_Limit;
   - a fixed sequence modelled on the 2026-11-20 run: no Intervention, the Rescue_Condition satisfied from the insult `timeSeconds` onward, Required_Interventions listed, returns `none` at Simulation_Time 61 s and later (Requirements 6.3 and 6.18);
   - the Rescue_Gate_Time is the largest of the earliest entry times of the Required_Interventions, is `null` when one Required_Intervention is missing, and stays `null` when only `needle-decompression-right` is active while `needle-decompression-left` is required (Requirements 6.18 and 6.19);
   - without Required_Interventions, the Ending equals the Ending without the Rescue_Gate_Time (Requirement 6.20);
   - after a fork to a Checkpoint earlier than the left Decompression, the Rescue_Gate_Time is `null`, and after the left Decompression is applied again on the new Branch, it equals the new entry's Simulation_Time (Requirement 6.21);
   - the Rescue_Gate_Time is recomputed for each event in Requirement 6.23, and an open Rescue_Condition stretch that starts before a later or `null` Rescue_Gate_Time is ended (Requirement 6.24);
   - Vitest property tests, under the settings of criterion 10, for Requirements 6.18 to 6.21, 6.23 and 6.24 and for the gate-dependent forms of Requirements 6.3, 6.12 and 6.13 with a fixed Rescue_Gate_Time;
   - the case-content existence check of Requirement 2.22, and the single `needle-decompression-left` entry with its decision comment and no `TODO(author)` marker (Requirement 2.23).

### Requirement 13: Engine calibration of the Play thresholds

**User Story:** As the case author, I want the ending thresholds checked against real engine runs, so that the acceptance demo is achievable and clinically reviewed.

#### Acceptance Criteria

1. WHEN the author has drafted every Play_Section threshold, Hold_Duration and the Time_Limit in `cases/adult-tension-pneumothorax.yaml`, THE project SHALL record in `docs/` a calibration run through the existing Physiology_Service API, with no change to Physiology_Service code or behaviour, for 4 scenarios: no Intervention, left Decompression, right Decompression only, and left Decompression before the insult. The calibration SHALL run on code at or after commit 1e71454 (core-simulation-loop task 3.4), the first commit at which a Decompression reaches Pulse switched on. Each scenario SHALL start a new Session from the unchanged Case_Definition, including its Scheduled_Insults. Each scenario SHALL run until the Ending is not `none` or the Simulation_Time reaches the Time_Limit, whichever comes first, except the left-Decompression-before-the-insult scenario, which runs as criterion 16 states.
2. THE calibration record SHALL contain, for each scenario, one VitalSigns sample for each multiple of 10 simulated seconds from Simulation_Time 0 to the end of the run. Each sample SHALL include its Simulation_Time and every vital sign that the Rescue_Condition or the Lost_Condition references.
3. THE calibration record SHALL contain the drafted Play_Section values that were used: every Vital_Condition, every Hold_Duration and the Time_Limit. It SHALL also contain the Simulation_Time at which each Decompression was applied through the Intervention_API. In the right-Decompression-only scenario, the right Decompression SHALL be applied at the same Simulation_Time as the left Decompression in the left Decompression scenario. In the left-Decompression-before-the-insult scenario, the left Decompression SHALL be applied at a Simulation_Time less than the `timeSeconds` of the left `SETensionPneumothorax` Scheduled_Insult.
4. THE calibration record SHALL state, for each scenario, the Ending that the Ending_Evaluator returns for that scenario's recorded samples, the Play_Section values used and the Rescue_Gate_Time of criterion 13, together with the Simulation_Time at which the Ending first stops being `none`. These Simulation_Times are measured from Session start and reported to 10-second resolution.
5. THE calibration record SHALL state, for the left Decompression scenario, the Simulation_Time at which the Ending first becomes `rescued`. That Simulation_Time SHALL be less than or equal to 300 seconds when the left Decompression is applied at the Simulation_Time chosen for the acceptance demo, and the record SHALL state that chosen Simulation_Time.
6. THE calibration record SHALL state, for the right-Decompression-only scenario, whether the Ending becomes `lost` through a Lost_Condition group (naming the group) or through the Time_Limit. The record SHALL also show that the Ending becomes `lost` at or before the Time_Limit and is never `rescued` in that scenario. The record SHALL label this scenario as the answer to open question 1, item c (right-side-only Decompression with the left pneumothorax untreated).
7. THE calibration record SHALL state, for the no-Intervention scenario, that the Ending becomes `lost` at or before the Time_Limit and is never `rescued` before that Simulation_Time.
8. IF any scenario's result in the calibration record fails the outcome required by criteria 5, 6, 7, 14 or 15, THEN THE calibration record SHALL name each failing scenario and the outcome it produced, and SHALL mark the drafted Play_Section values as not calibrated. The author then revises them, and the full 4-scenario run is repeated and recorded before any `TODO(author)` marker is removed from those values.
9. IF any Play_Section threshold, Hold_Duration, the Time_Limit, any Scheduled_Insult, or the acceptance-demo Decompression Simulation_Time changes after a calibration record was written, THEN THE project SHALL record a new 4-scenario calibration run in `docs/` before any `TODO(author)` marker is removed from the changed values.
10. WHILE the author has not reviewed the latest calibration record and added a clinical reference for a Play_Section threshold, Hold_Duration or the Time_Limit in a `references` field, THE `cases/adult-tension-pneumothorax.yaml` file SHALL keep that value marked `TODO(author)`.
11. THE calibration record SHALL state, for the left-Decompression-before-the-insult scenario, the Ending and the Simulation_Time at which it first stops being `none`, and SHALL compare the recorded samples after the insult's `timeSeconds` with the no-Intervention scenario at the same Simulation_Times. The record SHALL state whether the tension pneumothorax still develops after the earlier Decompression, which is the behaviour Requirement 4.18 assumes, and SHALL label this scenario as the answer to open question 1, item d.
12. IF the left-Decompression-before-the-insult scenario shows that the earlier Decompression prevents the tension pneumothorax, THEN THE calibration record SHALL flag Requirement 4.18 for revision, and Requirement 4.18 SHALL be revised before the design that depends on it is final.
13. THE calibration script SHALL compute each scenario's Rescue_Gate_Time from the Intervention_API calls it made in that scenario, using each call's Simulation_Time from criterion 3 and the same computation as the Web_App (Requirements 6.18 to 6.20, 6.24), and the calibration record SHALL state that Rescue_Gate_Time for each scenario, including `null` for the no-Intervention and right-Decompression-only scenarios.
14. THE calibration record SHALL show, for the left Decompression scenario with the left Decompression applied at the Simulation_Time chosen for the acceptance demo, that the Ending first becomes `rescued` at a Simulation_Time greater than or equal to the Rescue_Gate_Time plus `endings.rescued.holdSeconds` and less than or equal to 300 seconds.
15. THE calibration record SHALL show, for the right-Decompression-only and the no-Intervention scenarios, that the Ending is never `rescued` and becomes `lost` at or before the Time_Limit. The `null` Rescue_Gate_Time guarantees that neither scenario is `rescued`, and the record SHALL still check it. For both scenarios, the record SHALL also list the recorded samples at which every Vital_Condition of the Rescue_Condition held, without the Rescue_Gate_Time, so that the author can see which samples the gate excluded.
16. THE calibration record SHALL state, for the left-Decompression-before-the-insult scenario, that its Rescue_Gate_Time equals the Simulation_Time of the early left Decompression, so that the gate is open from that time, and that its Ending therefore depends only on the vitals and the earliest Scheduled_Insult bound and is not evidence for open question 1, item d. That scenario SHALL keep running after its Ending stops being `none`, until its Simulation_Time reaches the last Simulation_Time of the no-Intervention scenario, so that criterion 11 answers item d only from the comparison of its recorded vitals with the no-Intervention scenario at the same Simulation_Times.
17. THE calibration record SHALL contain, for each scenario: the Vital_Band (Alarm_State and direction) of every vital sign with Case thresholds at Simulation_Time 0; the Overall_Status at each recorded sample; and each Status_Rule that matched, with the Simulation_Times of the recorded samples at which it matched and of the samples at which the Status_Selector returned its sentence, or the statement that only the `defaultSentence` was returned. The calibration script SHALL leave every threshold in the case file unchanged; these entries give the author the data to decide the thresholds.

### Requirement 14: Acceptance demonstration

**User Story:** As a stakeholder, I want to see a person with no medical training save the patient, so that I can judge whether Play mode meets its goal.

#### Acceptance Criteria

1. WHEN a participant who reports no medical, nursing or other clinical training opens the adult-tension-pneumothorax Case in the Play_View and receives no spoken or written instructions beyond what the screen shows, THE participant SHALL start the simulation using only the controls shown in the Play_View, verified through manual observation.
2. WHEN the Overall_Status shown in the Play_View first changes from `normal` to `warning` or `critical` during the demonstration, THE participant SHALL say that the patient is getting worse within 60 seconds of Wall_Clock_Time, using only the Play_View and without opening the Clinician_View, verified through manual observation.
3. WHEN the participant has revealed at most 2 Hints according to the Hint_Record, and applies the Intervention with the Play_Label for the left needle decompression no later than the decompression Simulation_Time used for the left Decompression scenario in the Requirement 13 calibration record, and the Active_Interventions contain no right needle decompression, THE Ending SHALL become `rescued` and THE Ending_Screen SHALL show the `rescued` Ending at a Simulation_Time of at most 300 seconds measured from Session start (Simulation_Time 0) and before the Time_Limit, verified through manual observation and the calibration record in Requirement 13.5. TODO(author): the Time_Limit is not yet set; draft and calibrate it under Requirement 13 so that it is later than the rescue Simulation_Time recorded under Requirement 13.5.
4. WHEN the participant applies the Intervention with the Play_Label for the right needle decompression and the Active_Interventions of the current Branch_Lineage contain no left needle decompression, THE Ending SHALL become `lost` and THE Ending_Screen SHALL show the `lost` Ending at or before the Time_Limit, verified through manual observation and the calibration record in Requirement 13.6.
5. WHEN the Ending is `lost` after the right needle decompression and the participant activates the Rewind button, THE Rewind_Panel SHALL list at least 1 Rewind_Moment whose Simulation_Time is less than the Simulation_Time of the Intervention_Record entry for the right needle decompression.
6. WHEN the participant selects a Rewind_Moment listed under criterion 5, THE Web_App SHALL fork a new Branch through the Fork_API, make it the current Branch, set the Ending to `none` and close the Ending_Screen, and the right needle decompression SHALL not appear in the Active_Interventions of the new Branch.
7. WHEN the participant applies the Intervention with the Play_Label for the left needle decompression in the Branch created under criterion 6, from a Rewind_Moment whose Simulation_Time is less than or equal to the decompression Simulation_Time used for the left Decompression scenario in the Requirement 13 calibration record, THE Ending SHALL become `rescued` and THE Ending_Screen SHALL show the `rescued` Ending, verified through manual observation.
8. WHEN the participant activates the View_Switcher at any of these moments: before starting the simulation, after the Overall_Status first leaves `normal`, after applying a Decompression, while the Ending_Screen is shown, and after a fork, THE Clinician_View SHALL show the Session's current Branch (same session_id and branch_id) with the full Monitor_UI (numeric readouts, trend chart, playback controls, intervention panel and Timeline) without restarting the Session or resetting the Simulation_Time to 0. While playback is paused, the Simulation_Time it shows SHALL equal the Simulation_Time of the latest VitalSigns sample received before the switch.
9. THE Safety_Notice SHALL be visible in both the Play_View and the Clinician_View for the whole demonstration, including while the Rewind_Panel or the Ending_Screen is open, verified through manual observation.

### Requirement 15: Alarm band semantics for both views

**User Story:** As a learner in either view, I want a vital sign outside its normal range to show as at least a warning, so that neither the monitor nor the Avatar calls an abnormal value normal.

This requirement deliberately changes the alarm colours of the core-simulation-loop Monitor_UI (core-simulation-loop Requirement 8.3 and 8.4). This spec owns the change. Coordination note: the core-simulation-loop session is still executing and must not change `getAlarmState` in `apps/web/src/lib/alarms.ts` in a way that conflicts with this requirement.

#### Acceptance Criteria

1. IF a vital sign value is below the `critical.low` limit or above the `critical.high` limit of its Case thresholds, THEN THE Alarm_Function SHALL return `critical`.
2. IF a vital sign value does not meet criterion 1 and is below `normal.low`, above `normal.high`, below `warning.low` or above `warning.high`, THEN THE Alarm_Function SHALL return `warning`.
3. WHEN a vital sign value meets neither criterion 1 nor criterion 2, THE Alarm_Function SHALL return `normal`.
4. THE Alarm_Function SHALL treat a value equal to a limit as not beyond that limit, so that "below" and "above" in criteria 1 and 2 are strict comparisons.
5. IF a threshold object omits a `low` or `high` bound, or omits the whole `critical`, `warning` or `normal` object, THEN THE Alarm_Function SHALL skip the check for each absent bound and apply criteria 1 to 3 to the bounds that are present.
6. THE Alarm_Function SHALL be a pure function of the value and the threshold object: it SHALL return the same Alarm_State for the same inputs, SHALL read no Wall_Clock_Time, network or state outside its inputs, and SHALL leave its inputs unchanged.
7. THE Play_View (through the Avatar_Mapper, the Status_Selector and the Overall_Status) and the Clinician_View (numeric readouts and alarm colours) SHALL compute every Alarm_State with the Alarm_Function defined in this requirement.
8. WHILE a vital sign value is outside its normal range and within its critical limits, THE Clinician_View SHALL show that vital sign with the `warning` alarm colour.
9. WHEN the Alarm_Function evaluates the baseline vital signs of `adult-tension-pneumothorax` (heart rate 72/min, respiratory rate 12/min, SpO2 0.974, MAP 95 mmHg, EtCO2 36 mmHg, tidal volume 535 mL) against the thresholds in `cases/adult-tension-pneumothorax.yaml`, THE Alarm_Function SHALL return `normal` for each of them. These values are Pulse_Engine output, not clinical thresholds.
10. THE web test suite SHALL include Vitest unit tests for the Alarm_Function that, for each vital sign with thresholds in `cases/adult-tension-pneumothorax.yaml` and for each `low` and `high` bound present in its `normal`, `warning` and `critical` objects, check the value exactly at the bound, just inside it and just outside it, using the per-vital offset defined in the design (Requirement 12.6). Each expected result SHALL follow criteria 1 to 4.
11. THE web test suite SHALL include Vitest unit tests for the Alarm_Function with threshold objects that omit a `low` bound, a `high` bound and a whole `warning` object, with each expected result following criterion 5.
12. THE web test suite SHALL include a Vitest unit test that checks criterion 9 for each of the six baseline vital signs.
