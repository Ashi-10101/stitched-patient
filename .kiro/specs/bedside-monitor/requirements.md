# Requirements Document

## Introduction

Bedside monitor makes the screens look and sound like a real bedside for the demo video. The storyboard shots are: a night ward where the monitor waveforms speed up and an alarm sounds; after the needle, the waveforms and SpO2 recover; the Clinician_View looks like a bedside monitor; a calm monitor at the end.

This spec makes five changes, all in the Web_App:

1. **Waveforms.** The Physiology_Service sends one VitalSigns sample per simulated second and no waveform data. The Web_App draws Illustrative_Waveforms from the samples: an ECG_Trace (normal sinus shape) at the heart rate, a Pleth_Trace at the heart rate, and a Capno_Trace at the respiratory rate whose plateau follows EtCO2. The shapes are drawn by the Web_App; the rates and the EtCO2 level come from the Pulse_Engine. The waveform math lives in pure functions, the drawing in a canvas component.
2. **Clinician_View as a bedside monitor.** A dark Monitor_Panel with one row per trace and its numeric readout beside it. The trend chart, the Intervention panel and the Timeline stay. Same data, no new numbers.
3. **Play_View bedside monitor.** A small Play_Monitor next to the Avatar with the ECG_Trace and the Pleth_Trace only, no numbers, and a visible alarm state.
4. **Sound, off by default.** A Sound_Toggle. When on: a Heartbeat_Beep per cardiac cycle whose pitch falls as SpO2 falls, and an Alarm_Tone pattern while the Overall_Status is `warning` or `critical`. Web Audio synthesis only.
5. **Opening scene and one fix.** (a) An Opening_Scene with the case's situation line and a Start button before the first Play_View of a Session. (b) The Timeline (the Clinician_View Branch panel) shows fresh event counts and Checkpoints, and writes "1 event" in the singular.

This spec builds on core-simulation-loop (`.kiro/specs/core-simulation-loop/requirements.md`), play-mode (`.kiro/specs/play-mode/requirements.md`), bedside-exam (`.kiro/specs/bedside-exam/requirements.md`) and patient-speech (`.kiro/specs/patient-speech/requirements.md`). It edits none of them. The table "Changes to other specs" lists where it changes their behaviour.

**Scope boundary.** This spec changes no file under `services/physiology/`. Outside `apps/web/` it changes only `cases/case-schema.json` (an optional `play.opening` object) and `cases/adult-tension-pneumothorax.yaml` (an added `play.opening` block and nothing else). The Physiology_Service reads `cases/` through the read-only volume and validates against `cases/case-schema.json`, so the new optional field reaches the Web_App through the Case_API with no service change (as play-mode 2.13 and patient-speech 1.6).

**Clinical safety.** The waveforms are illustrations, not physiology output. Pulse_Engine computes no ECG, plethysmogram or capnogram in this project. The Web_App draws a fixed normal shape whose rate and, for the Capno_Trace, plateau height follow the VitalSigns sample. This spec models no arrhythmia, no ST change, no perfusion change of the pleth amplitude and no capnogram shape change, and makes no clinical claim about any shape. Every view that shows a trace shows the Waveform_Note. Every new player-facing text (Waveform_Note, Sound_Toggle texts, Opening_Scene texts, monitor labels and accessible names) is a draft that carries a `TODO(author)` marker for review by the author, a clinical medicine student. This document contains no clinical numbers. The only numbers below are UI constants (sizes, durations, frequencies, refresh periods) and figures quoted from the code or from other specs.

**Root cause of the Branch panel bug (part 5b).** The Timeline in `apps/web/src/components/Timeline.tsx` shows `branch.event_count` from `state.session.branches` and the Checkpoints from `state.checkpointsByBranch[currentBranchId]` (`currentCheckpoints` in `ClinicianView.tsx`). In `apps/web/src/hooks/useSimulationSession.ts`, the Session_Metadata is loaded only when the session page opens and after a fork (`api.getSession`), and the Checkpoint lists only then and through `loadLineageCheckpoints()`. `applyIntervention` dispatches `interventionSucceeded` and reloads neither. The Physiology_Service does record the Event_Log entry and save a manual Checkpoint for each Intervention (core-simulation-loop 6.7 and 6.8), and saves automatic Checkpoints as time passes, but the Web_App never fetches them while the Session runs. The Rewind_Panel looks fresh because `RewindPanel.tsx` calls `loadLineageCheckpoints()` every time it opens. That call updates `checkpointsByBranch` for the Timeline too, but not the `event_count` in the Session_Metadata. So the Timeline keeps "0 events" and the 0:00 Checkpoint until a fork, or until the Rewind_Panel is opened. The plural is a hard-coded `{branch.event_count} events`. Requirement 12 specifies the fix.

**Out of scope and non-goals:**

- waveform data from the Physiology_Service, and any change under `services/physiology/`;
- arrhythmias, other ECG leads, ST segments, pleth amplitude or shape changes, capnogram shape changes, and any morphology beyond the normal shapes of Requirement 1;
- numbers in the Play_View; alarm silencing or acknowledgement controls; volume controls beyond the Sound_Toggle;
- audio files, text-to-speech, and new runtime dependencies;
- changes to thresholds, Ending rules, case values, Status_Rules, Hints, Exam_Rules, Speech_Lines or other existing clinical text, and removal of any `TODO(author)` marker;
- a waveform or sound on the Ending_Screen.

### Changes to other specs

| Spec and requirement | Change made by this spec | Where |
|---|---|---|
| core-simulation-loop 8 (Monitor_UI layout), play-mode 1.7 | The Clinician_View readouts move into the Monitor_Panel; a readout in `normal` shows the Trace_Colour of its row instead of today's `normal` colour; Display_Precision and the `warning` and `critical` colours stay | Requirement 4 |
| core-simulation-loop 8.10 (Timeline) | The Timeline refreshes its event counts and Checkpoints and writes the singular "1 event" | Requirement 12 |
| play-mode 1.1, 1.9 | On page open into the Play_View, the Opening_Scene shows first, once per Session per browser tab | Requirement 10 |
| play-mode 1.4 | View switches also keep the Sound_Setting and the Trace_Clock | 2.10, 6.4 |
| play-mode 2.3 | The Case_Schema gains an optional `play.opening` | 9.1 to 9.3 |
| play-mode 11.2, 11.7, 11.12 | The focus order includes the Sound_Toggle and the Start button; the 1280 × 720 layout includes the Play_Monitor and the Waveform_Note; the default 2x request is sent when Start is activated | 5.9, 7.1, 10.6, 13.3 |
| play-mode 6.23 | A Branch_Panel_Refresh that loads the Session_Metadata triggers the same Rescue_Gate_Time recomputation as any Session_Metadata load | 12.6 |
| bedside-exam 10.9, patient-speech 8.4 | The screen symmetry property also covers the Play_Monitor, the Monitor_Panel, the Waveform_Note and the Opening_Scene | 11.3 |

### Decisions

1. **Phase in, value out.** The request asks for pure functions "time and sample in, value out". A value computed from absolute time times the current rate jumps when the rate changes between samples. So each trace keeps a phase: a pure Phase_Advance function takes the previous phase, a time step and the rate, and a pure shape function takes the phase (and, for the Capno_Trace, the EtCO2) and returns the value. Both stay pure and deterministic; the phase makes the trace continuous across rate changes.
2. **Traces and beep follow Wall_Clock_Time, like the Avatar.** The Trace_Clock advances with Wall_Clock_Time (as defined in core-simulation-loop) at the heart rate and respiratory rate of the latest sample, at every Playback_Speed, as the Avatar's heartbeat and breathing periods do (play-mode 4.6 and 4.10). A baseline heart rate therefore looks the same at 1x, 2x and 4x, and the traces, the Heartbeat_Beep and the Avatar's heart patch beat at one visible rate. Playback_Speed changes only how quickly the rates themselves change. This is the author's answer to open question 2.
3. **Between samples the traces keep the latest rates; a stalled stream freezes them.** Samples arrive once per simulated second. Between samples the traces run at the rates of the latest sample of the current Branch. If no new sample of that Branch arrives for Trace_Stall_Seconds of Wall_Clock_Time, the traces freeze, and they resume from where they stopped when the next sample arrives. The Trace_Clock never runs backwards on one Branch.
4. **One Trace_Clock per Session, not per view.** The Trace_Clock and the trace phases live in the session state, so a view switch does not restart them and the Heartbeat_Beep stays in step with the drawn R wave in both views.
5. **The Play_Monitor is outside the Avatar SVG.** A canvas cannot live inside the Avatar's SVG, and play-mode Requirement 3 fixes the Avatar's markup and regions. The Play_Monitor is a separate element in the patient column next to the Avatar, styled as a monitor in the night ward. The Avatar markup does not change.
6. **Readout colours.** A Clinician_View readout shows its row's Trace_Colour while its Alarm_State is `normal`, and today's alarm colours (`getAlarmColor`, `getAlarmBgColor` in `apps/web/src/lib/alarms.ts`) while `warning` or `critical`. This keeps play-mode 15.8 and core-simulation-loop 8.16 true and looks like a monitor at rest. No Trace_Colour equals the `warning` or `critical` colour.
7. **Reduced motion.** While the Reduced_Motion_Preference is `reduce`, traces do not scroll or sweep continuously. Each trace is redrawn once per received sample as a still strip, and the Play_Monitor frame does not flash.
8. **Sound gating.** Sound plays only when the Sound_Setting is on, the Audio_Output is running, playback is playing, the Vitals_Stream is connected, the current Branch has a sample, and the Ending is not `lost`. The `lost` silence follows patient-speech decision 3 (no distress at the lost ending); the author confirmed it (open question 7). After a `rescued` Ending, playback is paused (play-mode 7.1), so the monitor is silent unless the learner resumes playback.
9. **Opening only on page open.** The Opening_Scene shows when the session page opens into the Play_View (play-mode 1.1 and 1.9) and the Opening_Scene has not been dismissed for that Session in the browser tab. A switch from the Clinician_View to the Play_View never shows it, so play-mode 1.6 (new view within 500 ms) stays true.
10. **Start does not start playback.** Start dismisses the Opening_Scene and shows the Play_View. The learner then starts the simulation with the play control, as play-mode 14.1 expects. The author confirmed this (open question 6).
11. **Where the new texts live.** The situation line is case content and goes into `play.opening.situationText` in the case file, like the Goal_Text. Generic UI texts (Waveform_Note, Sound_Toggle texts, Start label, monitor labels and accessible names) are constants in `apps/web/src/`, like `FINDINGS_EMPTY_TEXT` in `FindingsList.tsx`, each with a `TODO(author)` comment.
12. **Alarm patterns are made up.** The Warning_Pattern and the Critical_Pattern are simple patterns made for this project (the author's answer to open question 4). They are not IEC 60601-1-8 alarm signals, and nothing in the UI or the documents claims so.

### Draft content for the author (all `TODO(author)`)

| Item | Draft text | Stored in |
|---|---|---|
| Situation line | "It's 3 a.m. Your patient can't breathe." | `play.opening.situationText` in `cases/adult-tension-pneumothorax.yaml` |
| Start button | "Start" | UI constant |
| Waveform_Note | "Illustrative waveforms: the shapes are drawn, the rates come from the simulation." | UI constant |
| Sound_Toggle, off / on | "Sound off" / "Sound on" | UI constant |
| Sound waiting for a gesture | "Tap or press a key to hear the monitor." | UI constant |
| Sound not available | "Sound is not available in this browser." | UI constant |
| Monitor_Panel row labels | "ECG", "Pleth", "CO₂" | UI constant |
| Play_Monitor accessible name | "Heart monitor" | UI constant |

### Known limitations

- **The traces are not engine output.** Only the rates and the EtCO2 plateau come from the Pulse_Engine. A reader who sees a normal ECG shape at 170/min sees a drawn sinus tachycardia, not a modelled rhythm.
- **The traces show the latest sample's rates and freeze when the stream stalls.** The drawn rates change in steps of one sample. At 4x under emulation (about 13x real time on the Mac, steering `tech.md`) samples keep up; on a 1-vCPU VM (about 1.5x) they arrive more slowly than requested, and if none arrives for Trace_Stall_Seconds the traces freeze.
- **Traces do not speed up with Playback_Speed.** At 2x and 4x the traces and the Heartbeat_Beep run at the patient's rate per minute of Wall_Clock_Time, like the Avatar, while the simulation runs faster, so a rate change shows up after fewer wall-clock seconds than at 1x (decision 2).
- **Audio after a reload** needs a new user gesture before it can play (browser autoplay rules).

### Open questions for the author

1. **Waveform look.** Are the normal sinus ECG shape, the pleth shape (with or without a dicrotic notch) and the capnogram phases acceptable as illustrations? What EtCO2 maps to the top of the Capno_Trace (Capno_Scale_Max)? Please cite a source for the shapes if one is wanted.
2. **Trace speed.** Resolved: traces and the Heartbeat_Beep run on Wall_Clock_Time at every Playback_Speed (decision 2).
3. **Beep pitch.** The pulse-oximeter convention of a lower pitch for a lower SpO2: please confirm and cite a source. Is a linear mapping between Beep_Pitch_Min and Beep_Pitch_Max acceptable?
4. **Alarm tone pattern.** Resolved in part: simple made-up patterns, not IEC 60601-1-8 alarm signals (decision 12). Still open: the exact pattern (tones, pitches, lengths) of the Warning_Pattern and the Critical_Pattern, and how often each repeats.
5. **Opening text.** Wording of the situation line and the Start label. Is "3 a.m." acceptable in a view that otherwise shows no numbers?
6. **Start and playback.** Resolved: Start does not start playback (decision 10).
7. **Lost silence.** Resolved: the monitor is silent at the `lost` Ending (decision 8).

## Glossary

Terms from other specs keep their meaning there:

- core-simulation-loop: **Case**, **Case_Definition**, **Case_Loader**, **Session**, **Branch**, **Checkpoint**, **Pulse_Engine**, **Physiology_Service**, **Web_App**, **Intervention**, **Scheduled_Insult**, **Simulation_Time**, **Wall_Clock_Time**, **Playback_Speed**, **Monitor_UI**, **Vitals_Stream**, **VitalSigns**, **Alarm_State**, **Event_Log**, **Timeline**.
- play-mode: **Fork_API**, **Playback_API**, **Intervention_API**, **Alarm_Function**, **Clinician_View**, **Play_View**, **View_Switcher**, **Play_Section**, **Play_Label**, **Avatar**, **Avatar_Scene**, **Face_Feature_Region**, **Chest_Region**, **Overall_Status**, **Display_Precision**, **Displayed_Value**, **Status_Rule**, **Status_Sentence**, **Goal_Text**, **Diagnosis_Terms**, **Hold_Duration**, **Time_Limit**, **Rescue_Gate_Time**, **Ending**, **Ending_Screen**, **Hint**, **Hint_Record**, **Branch_Lineage**, **Rewind_Panel**, **Intervention_Record**, **Reduced_Motion_Preference**, **Safety_Notice**, **Case_Schema**.
- bedside-exam: **Session_Metadata**, **Case_API**, **Base_Case**, **Variant**, **Variant_Id**, **Variant_Overrides**, **Override_Target**, **Resolved_Case**, **Affected_Side**, **Side_Word**, **Side_Reveal_Text**, **Exam_Rule**, **Exam_Record**, **Casual_Player**.
- patient-speech: **Speech_Bubble_Slot**, **Speech_Line**, **Speech_State**, **Displayed_Speech**.

New terms:

- **Illustrative_Waveform**: A trace drawn by the Web_App from a fixed shape and a rate taken from VitalSigns; not Pulse_Engine output
- **ECG_Trace**: The Illustrative_Waveform with a normal sinus shape (a P wave, a QRS complex and a T wave on a flat baseline), one cycle per heartbeat at the heart rate
- **Pleth_Trace**: The Illustrative_Waveform of a pulse-oximetry plethysmogram, one pulse per heartbeat at the heart rate, with a fixed amplitude
- **Capno_Trace**: The Illustrative_Waveform of a capnogram, one cycle per breath at the respiratory rate, with a baseline at zero and a plateau whose height follows the EtCO2
- **Trace_Phase**: A number in [0, 1) giving the position inside the current cycle of a trace: the Cardiac_Phase for the ECG_Trace and the Pleth_Trace, the Respiratory_Phase for the Capno_Trace
- **Cardiac_Phase**: The Trace_Phase of the ECG_Trace and the Pleth_Trace, advanced at the heart rate
- **Respiratory_Phase**: The Trace_Phase of the Capno_Trace, advanced at the respiratory rate
- **Phase_Advance**: The pure function that returns the next Trace_Phase and the number of completed cycles from a Trace_Phase, a time step in seconds and a rate per minute
- **ECG_Shape**, **Pleth_Shape**, **Capno_Shape**: The pure functions that return the trace value for a Trace_Phase (and, for Capno_Shape, an EtCO2 value)
- **R_Phase**: The Cardiac_Phase of the R peak of the ECG_Shape; a design constant
- **Capno_Scale_Max**: The EtCO2 value, in mmHg, drawn at the top of the Capno_Trace row; a display constant marked `TODO(author)` (open question 1)
- **Trace_Clock**: The Session-level running time, in seconds, at which the traces are drawn, computed by the pure Trace_Time function (Requirement 2); it advances with Wall_Clock_Time while playback is playing and the traces are not frozen, at every Playback_Speed
- **Trace_Stall_Seconds**: The Wall_Clock_Time after the arrival of the latest sample of the current Branch after which the traces freeze until the next sample arrives; 2 s, a UI constant
- **Trace_Window**: The span of Trace_Clock time, in seconds, that one trace row shows; a UI constant
- **Trace_Colour**: The fixed colour of one trace row and its readouts in the Monitor_Panel; a design constant
- **Waveform_Canvas**: The React component that draws one or more traces into a `<canvas>` with the Canvas 2D API
- **Waveform_Note**: The short visible text stating that the waveform shapes are illustrative and the rates come from the simulation
- **Monitor_Panel**: The dark bedside-monitor panel of the Clinician_View, with one row per trace and the numeric readouts
- **Play_Monitor**: The small monitor in the Play_View patient column with the ECG_Trace and the Pleth_Trace and no numbers
- **Sound_Toggle**: The control in both views that turns sound on or off
- **Sound_Setting**: The on or off choice of the Sound_Toggle for a Session, stored in the browser tab's sessionStorage under a key that contains the session_id
- **Audio_Output**: The Web Audio `AudioContext` of the page, created or resumed only inside a user-gesture handler
- **Audio_Port**: The interface through which the Sound_Scheduler asks for tones (frequency, start time, duration, gain); the browser implementation uses the Audio_Output, tests use a recording double
- **Sound_Scheduler**: The plain controller that decides when to play each Heartbeat_Beep and Alarm_Tone, with an injected clock and Audio_Port and no DOM
- **Heartbeat_Beep**: A short synthesized tone played when the Cardiac_Phase passes the R_Phase
- **Beep_Pitch**: The pure function from the SpO2 Displayed_Value to the Heartbeat_Beep frequency, within Beep_Pitch_Min and Beep_Pitch_Max (UI constants)
- **Min_Beep_Gap**: The shortest Wall_Clock_Time between two Heartbeat_Beeps; 150 ms, a UI constant
- **Alarm_Tone**: The repeating synthesized tone pattern played while the Overall_Status is `warning` (the Warning_Pattern) or `critical` (the Critical_Pattern); both patterns are UI constants (open question 4)
- **Opening_Scene**: The night-ward panel with the situation line and the Start button, shown before the first Play_View of a Session (Requirement 10)
- **Opening_Section**: The optional `play.opening` object in the Play_Section
- **Branch_Panel_Refresh**: One reload of the Session_Metadata and of the Checkpoint lists of the Branch_Lineage for the Timeline (Requirement 12)
- **Branch_Panel_Refresh_Seconds**: The Wall_Clock_Time between periodic Branch_Panel_Refreshes; 10 s, a UI constant
- **FakeClock**: The existing test clock `createFakeClock` in `apps/web/src/test/fakeClock.ts`
- **PBT_PARAMS**: The existing fast-check settings in `apps/web/src/test/pbt.ts` (no fewer than 100 runs from a fixed seed, play-mode 12.10)

## Requirements

### Requirement 1: Waveform shape functions

**User Story:** As a developer, I want the waveform math in small pure functions, so that the shapes are testable and identical in every view.

#### Acceptance Criteria

1. THE Web_App SHALL define Phase_Advance, ECG_Shape, Pleth_Shape and Capno_Shape once, as pure functions in `apps/web/src/lib/`, that read no Wall_Clock_Time, random value, DOM, network or state outside their inputs.
2. WHEN Phase_Advance receives a Trace_Phase `p`, a step `dt` of 0 or more seconds and a finite rate `r` greater than 0 per minute, THE Phase_Advance function SHALL return the fractional part of `p + dt × r / 60` as the new Trace_Phase and the integer part as the number of completed cycles.
3. IF Phase_Advance receives a rate that is 0, negative or not finite, THEN THE Phase_Advance function SHALL return the unchanged Trace_Phase and 0 completed cycles.
4. THE ECG_Shape SHALL return a value in [−1, 1] for every Trace_Phase, with a P wave, a QRS complex whose maximum is at the R_Phase, a T wave and a flat baseline elsewhere, and SHALL return the baseline value at Trace_Phase 0 and in the limit towards 1, so that consecutive cycles join without a step.
5. THE Pleth_Shape SHALL return a value in [0, 1] for every Trace_Phase, with one pulse per cycle that rises after the R_Phase, and SHALL return equal values at Trace_Phase 0 and in the limit towards 1.
6. THE Capno_Shape SHALL return 0 in its inspiratory part, rise to a plateau, and fall back to 0 before the cycle ends. The plateau height SHALL equal the EtCO2 Displayed_Value divided by Capno_Scale_Max, clamped to [0, 1].
7. IF Capno_Shape receives an EtCO2 value that is missing or not finite, THEN THE Capno_Shape function SHALL return no value, so that the trace draws a gap.
8. THE ECG_Shape and the Pleth_Shape SHALL depend on the Trace_Phase only, so that no vital sign other than the heart rate (through Phase_Advance) changes their look.
9. FOR ALL Trace_Phases, rates and steps `dt1`, `dt2`, advancing by `dt1` and then by `dt2` SHALL give the same Trace_Phase, within 1e-9, and the same total cycle count as advancing once by `dt1 + dt2` (additivity property).
10. FOR ALL Trace_Phases and EtCO2 values, Capno_Shape SHALL be non-decreasing in the EtCO2 value at a fixed Trace_Phase, and its maximum over one cycle SHALL equal the plateau height of criterion 6 (metamorphic property).
11. THE shape constants (wave positions, widths and heights inside a cycle, R_Phase and Capno_Scale_Max) SHALL be defined once in `apps/web/src/lib/` with a `TODO(author)` comment naming open question 1.

### Requirement 2: Trace timing

**User Story:** As a visitor, I want the waveforms to beat at the patient's current rates like the Avatar and to stop when the simulation stops, so that the monitor matches what the patient is doing.

#### Acceptance Criteria

1. THE Web_App SHALL compute the Trace_Clock with one pure Trace_Time function of: the current Wall_Clock_Time, the Wall_Clock_Times at which the samples of the current Branch arrived, the playing or paused state, the current branch_id and the previous Trace_Clock value with its branch_id. The Playback_Speed SHALL not be an input.
2. WHILE playback is playing and the latest sample of the current Branch arrived no more than Trace_Stall_Seconds of Wall_Clock_Time ago, THE Trace_Time function SHALL advance the Trace_Clock by the elapsed Wall_Clock_Time, so that every trace runs at the same speed at 1x, 2x and 4x (decision 2).
3. WHILE playback is paused, THE Trace_Time function SHALL return the previous Trace_Clock value of the same Branch, so that every trace stops.
4. IF no new sample of the current Branch has arrived for more than Trace_Stall_Seconds of Wall_Clock_Time, THEN THE Trace_Time function SHALL hold the Trace_Clock at its value at that moment, so that every trace freezes (decision 3).
5. WHEN a sample of the current Branch arrives while the Trace_Clock is held under criterion 4, THE Trace_Time function SHALL resume advancing from the held value, so that the Wall_Clock_Time spent frozen does not advance the Trace_Clock.
6. FOR ALL inputs on one Branch, THE Trace_Time function SHALL return a value greater than or equal to the previous Trace_Clock value of that Branch, and the increase over any span SHALL be at most the Wall_Clock_Time elapsed in that span (monotonic and bounded property).
7. WHILE the current Branch has no VitalSigns sample, THE Web_App SHALL have no Trace_Clock, and every Waveform_Canvas SHALL draw no trace.
8. WHEN the Fork_API returns a new current Branch, THE Web_App SHALL discard the Trace_Clock, the Trace_Phases and every drawn trace of the previous Branch, and SHALL start them again from the first sample of the new Branch. IF the Fork_API request fails, THEN THE Web_App SHALL keep them unchanged.
9. THE Web_App SHALL advance the Trace_Phases with Phase_Advance, using for each step the heart rate or respiratory rate of the latest sample of the current Branch that had arrived at the start of that step.
10. WHEN the learner switches view with the View_Switcher, THE Web_App SHALL keep the Trace_Clock and the Trace_Phases unchanged (decision 4).
11. WHILE playback is paused, the Trace_Clock is held under criterion 4, or no Waveform_Canvas is displayed, THE Web_App SHALL request no animation frame for the traces.

### Requirement 3: Waveform canvas

**User Story:** As a visitor, I want smooth, clearly labelled traces, so that the monitor reads as a monitor and not as real patient data.

#### Acceptance Criteria

1. THE Waveform_Canvas SHALL draw each of its traces with the Canvas 2D API from the Trace_Clock, the Trace_Phases and the shape functions of Requirement 1, showing the most recent Trace_Window of the Trace_Clock, and SHALL use no image file, no SVG path copied from a third party and no new runtime dependency.
2. THE Waveform_Canvas SHALL keep its drawing logic in a function that takes a minimal drawing-context interface (the Canvas 2D calls it uses), so that the logic runs in Node tests with a recording double.
3. WHILE the Reduced_Motion_Preference is `reduce`, THE Waveform_Canvas SHALL redraw each trace only when a new sample arrives, as a still strip of the most recent Trace_Window, with no continuous movement between samples (decision 7).
4. IF the sample in effect for a span of a trace has no finite value for that trace's rate or level, THEN THE Waveform_Canvas SHALL draw a gap for that span and SHALL draw no invented values.
5. WHILE the rate of a trace is 0, THE Waveform_Canvas SHALL draw that trace as a flat baseline.
6. WHERE a view shows a Waveform_Canvas, THE view SHALL show the Waveform_Note next to it, in full, at a font size of at least 16 CSS pixels with a contrast ratio of at least 4.5:1 against its background.
7. THE Waveform_Note SHALL contain no digit, no Side_Word and no Diagnosis_Term, and SHALL be defined once as a UI constant with a `TODO(author)` comment.
8. THE Waveform_Canvas SHALL render the same static markup for every VitalSigns sample, so that the markup of a view does not depend on the sample values.

### Requirement 4: Clinician_View bedside monitor

**User Story:** As a medical learner, I want the Clinician_View to look like a bedside monitor, so that the demo shows a familiar ward screen.

This requirement changes the layout of core-simulation-loop Requirement 8 and keeps play-mode 1.7 and 15.7 to 15.16 true.

#### Acceptance Criteria

1. THE Clinician_View SHALL show a Monitor_Panel with a near-black background and, from top to bottom, these rows: the ECG_Trace with the heart rate readout; the Pleth_Trace with the SpO2 readout; the Capno_Trace with the EtCO2 and the respiratory rate readouts; and a readout row with the MAP and the tidal volume readouts.
2. THE Monitor_Panel SHALL show each of the six vital signs that the Clinician_View shows today exactly once, with its current label and unit, and SHALL show no other number derived from VitalSigns.
3. THE Monitor_Panel SHALL write every readout with `formatVital` and the Display_Precision (play-mode 15.13 and 15.14), unchanged.
4. WHILE a readout's Alarm_State is `normal`, THE Monitor_Panel SHALL show that readout in the Trace_Colour of its row. WHILE it is `warning` or `critical`, THE Monitor_Panel SHALL show it with the alarm colours that `getAlarmColor` and `getAlarmBgColor` return for that state (decision 6).
5. THE Monitor_Panel SHALL compute each Alarm_State as the Clinician_View does today, with the Alarm_Function applied to the Displayed_Value (play-mode 15.7 and 15.16).
6. THE Web_App SHALL define the Trace_Colours once, with each one distinct from the `warning` and `critical` alarm colours and with a contrast ratio of at least 4.5:1 against the Monitor_Panel background.
7. THE Clinician_View SHALL keep the trend chart, the Intervention panel, the Timeline, the playback controls, the Ending banner and the patient information with their current content and behaviour.
8. WHILE the browser viewport is 1280 × 720 CSS pixels at 100% zoom, THE Clinician_View SHALL show the Safety_Notice, the View_Switcher, the playback controls, the Sound_Toggle, the whole Monitor_Panel with the Waveform_Note, and the Intervention buttons inside the viewport with no page scrolling. The trend chart and the Timeline may be reached by scrolling. This is verified through manual inspection during acceptance testing.
9. THE Monitor_Panel SHALL reuse the existing `VitalSign` component, or a variant of it, for the readouts.

### Requirement 5: Play_View bedside monitor

**User Story:** As a visitor, I want a small heart monitor next to the patient, so that I can see his heart race and calm down without reading numbers.

#### Acceptance Criteria

1. WHILE the Play_View is displayed, THE Play_View SHALL show the Play_Monitor in the patient column, next to the Avatar, with the ECG_Trace above the Pleth_Trace and the Waveform_Note.
2. THE Play_Monitor SHALL draw no digit, no text and no unit inside its canvas, so that the Play_View shows no vital-sign number.
3. THE Play_Monitor SHALL overlap neither the Avatar's SVG element, the Speech_Bubble_Slot nor the Status_Sentence, and SHALL leave the Avatar's markup unchanged (decision 5).
4. THE Play_Monitor SHALL show a frame in the alarm colour of the Overall_Status, taken from the same single colour definition that the Clinician_View uses.
5. WHILE the Overall_Status is `warning` or `critical` and the Reduced_Motion_Preference is not `reduce`, THE Play_Monitor frame SHALL flash with no more than 3 flashes in any one second (WCAG 2.2 Success Criterion 2.3.1).
6. WHILE the Overall_Status is `normal`, or the Reduced_Motion_Preference is `reduce`, THE Play_Monitor frame SHALL show a steady colour.
7. THE Play_Monitor SHALL carry `role="img"` and a fixed accessible name that names no side and no number, and SHALL not be a live region, so that the Status_Sentence live region (play-mode 5.11) stays the only status announcement.
8. THE Play_Monitor SHALL compute everything it shows only from the Trace_Clock, the Trace_Phases, the VitalSigns samples of the current Branch, the Case thresholds, the playback state and the Reduced_Motion_Preference, and SHALL read no Variant_Id, Affected_Side, Scheduled_Insult side, Intervention_Record or Exam_Record.
9. WHILE the browser viewport is 1280 × 720 CSS pixels at 100% zoom, THE Play_View SHALL keep play-mode 11.7 and 11.8, bedside-exam 6.13 and patient-speech 7.10 true with the Play_Monitor and the Waveform_Note shown, with zero to three Hints revealed. This is verified through manual inspection during acceptance testing.
10. WHILE the browser viewport is 320 CSS pixels wide, THE Play_View SHALL show the Play_Monitor and the Waveform_Note without horizontal scrolling.

### Requirement 6: Sound toggle and audio start

**User Story:** As a visitor, I want sound to stay off until I turn it on, so that the page never surprises me with noise.

#### Acceptance Criteria

1. THE Play_View and the Clinician_View SHALL each show the Sound_Toggle next to the playback controls, as a button with `aria-pressed`, an icon and the visible text of the current Sound_Setting.
2. WHEN the session page opens and the browser tab's sessionStorage holds no Sound_Setting for the session_id, or the stored value cannot be read, THE Web_App SHALL set the Sound_Setting to off.
3. WHEN the learner activates the Sound_Toggle, THE Web_App SHALL switch the Sound_Setting, SHALL store it in the browser tab's sessionStorage under a key that contains the session_id and nothing else that varies, and SHALL show the new state on the Sound_Toggle within 500 ms of Wall_Clock_Time.
4. WHEN the learner switches view with the View_Switcher, THE Web_App SHALL keep the Sound_Setting and the Audio_Output unchanged (extends play-mode 1.4).
5. THE Web_App SHALL create or resume the Audio_Output only inside the handler of a user activation (a pointer click, a tap or a key press) and SHALL create no Audio_Output while the Sound_Setting is off.
6. WHEN the session page opens with a stored Sound_Setting of on, THE Web_App SHALL show the Sound_Toggle as on with the visible "waiting for a gesture" text, and SHALL create or resume the Audio_Output at the next user activation anywhere on the page.
7. IF the browser has no Web Audio API, or creating or resuming the Audio_Output fails, THEN THE Web_App SHALL show the Sound_Toggle as disabled with the visible "sound not available" text, SHALL play no sound, and SHALL continue with no other error message.
8. THE Web_App SHALL use only the browser's built-in Web Audio API (oscillator and gain nodes) for sound, with no audio file, no network request for audio and no new runtime dependency.
9. THE Sound_Toggle SHALL be reachable with the Tab key in visual order, SHALL toggle on Enter or Space, SHALL show the focus indicator of play-mode 11.4, and SHALL render its text at a font size of at least 16 CSS pixels with a contrast ratio of at least 4.5:1.

### Requirement 7: Heartbeat beep

**User Story:** As a visitor, I want to hear the heartbeat speed up and the beep drop in pitch, so that I notice the patient getting worse even when I look away.

#### Acceptance Criteria

1. WHILE sound is allowed (criterion 6), THE Sound_Scheduler SHALL ask the Audio_Port for one Heartbeat_Beep each time the Cardiac_Phase passes the R_Phase as the Trace_Clock advances, at the Wall_Clock_Time at which the ECG_Trace draws that R peak, so that the beeps per minute of Wall_Clock_Time equal the heart rate of the latest sample at every Playback_Speed (decision 2).
2. THE Sound_Scheduler SHALL set the Heartbeat_Beep frequency with Beep_Pitch from the SpO2 Displayed_Value of the latest sample of the current Branch.
3. FOR ALL pairs of SpO2 values `a <= b`, Beep_Pitch(a) SHALL be less than or equal to Beep_Pitch(b), and every result SHALL lie in [Beep_Pitch_Min, Beep_Pitch_Max] (monotonic and bounded property). Beep_Pitch_Min, Beep_Pitch_Max and the mapping SHALL be UI constants defined once with a `TODO(author)` comment naming open question 3.
4. IF the latest sample has no finite SpO2 value, THEN THE Sound_Scheduler SHALL use the Beep_Pitch of the previous Heartbeat_Beep on the same Branch, or Beep_Pitch_Max when there is none.
5. THE Sound_Scheduler SHALL leave at least Min_Beep_Gap of Wall_Clock_Time between two Heartbeat_Beeps and SHALL drop a beat that would come closer, so that very fast heart rates do not merge into one tone.
6. THE Sound_Scheduler SHALL allow sound only WHILE all of these hold: the Sound_Setting is on, the Audio_Output is running, playback is playing, the Web_App is connected to the Vitals_Stream, the current Branch has a sample, and the Ending of the current Branch is not `lost` (decision 8).
7. WHEN any condition of criterion 6 stops holding, THE Sound_Scheduler SHALL schedule no new tone and SHALL stop every scheduled tone that has not started, within 200 ms of Wall_Clock_Time.
8. WHILE the heart rate of the latest sample is 0, negative or not finite, or the Trace_Clock is held under Requirement 2.4, THE Sound_Scheduler SHALL play no Heartbeat_Beep.
9. THE Sound_Scheduler SHALL use a fixed gain no higher than a single UI constant for every tone, with short fade-in and fade-out ramps so that no tone clicks.

### Requirement 8: Alarm tone

**User Story:** As a visitor, I want an alarm to sound while the patient is in trouble and stop when he is safe, so that the ward feels real.

#### Acceptance Criteria

1. WHILE sound is allowed (Requirement 7.6) and the Overall_Status is `warning`, THE Sound_Scheduler SHALL play the Warning_Pattern, repeated at the interval defined with it.
2. WHILE sound is allowed and the Overall_Status is `critical`, THE Sound_Scheduler SHALL play the Critical_Pattern, repeated at the interval defined with it.
3. THE Warning_Pattern and the Critical_Pattern SHALL differ in at least the number of tones per repeat, and SHALL be defined once as UI constants with a `TODO(author)` comment naming open question 4.
4. WHEN the Overall_Status changes, THE Sound_Scheduler SHALL start the matching pattern, or stop the Alarm_Tone when the Overall_Status becomes `normal`, within 1 second of Wall_Clock_Time, and SHALL not finish a repeat of the previous pattern.
5. THE Sound_Scheduler SHALL take the Overall_Status computed by the Web_App from the Displayed_Values (play-mode 15.16), and SHALL compute no Alarm_State of its own.
6. THE Sound_Scheduler SHALL play the Heartbeat_Beep and the Alarm_Tone independently, so that the heartbeat is still heard while an Alarm_Tone plays.
7. THE Warning_Pattern and the Critical_Pattern SHALL be simple patterns made for this project, and every UI text, code comment and document that mentions them SHALL describe them as illustrative sounds, with no claim that they are IEC 60601-1-8 alarm signals (decision 12).

### Requirement 9: Opening text in the case file

**User Story:** As a case author, I want the opening line in the case file, so that each case can set its own scene and the line is reviewable content.

This requirement extends play-mode Requirement 2.

#### Acceptance Criteria

1. THE Case_Schema SHALL define `opening` as an optional property of the Play_Section, so that a Play_Section without `opening` validates with the same result as before this spec.
2. THE Case_Schema SHALL define the Opening_Section as an object with the required property `situationText` (a string of 1 to 120 characters) and the optional property `references` (an array of 1 or more non-empty citation strings), and SHALL reject any other property.
3. THE Case_Schema SHALL keep `opening` out of the Variant_Overrides properties, so that the Opening_Section is not an Override_Target and is the same in every Resolved_Case.
4. THE `cases/adult-tension-pneumothorax.yaml` file SHALL define `play.opening.situationText` with the draft text of the table "Draft content for the author", with a `TODO(author)` comment containing "bedside-monitor spec" on the same line or the comment-only line directly above, unless `play.opening.references` is non-empty.
5. THE `situationText` of every Resolved_Case SHALL contain no Side_Word and no Diagnosis_Term, by case-insensitive matching (as play-mode 2.19 and bedside-exam 11.1).
6. WHEN `python scripts/validate-case.py cases/adult-tension-pneumothorax.yaml` is run after the case-file change, in a one-off physiology container as patient-speech 11.6 describes, THE script SHALL report that the Base_Case and both Resolved_Cases are valid and exit with status 0.

### Requirement 10: Opening scene

**User Story:** As a visitor, I want a short opening scene before the patient appears, so that I know where I am and what is happening before I start.

#### Acceptance Criteria

1. WHEN the session page opens and play-mode 1.1 or 1.9 selects the Play_View, the Resolved_Case has an Opening_Section, and the Opening_Scene has not been dismissed for that session_id in the browser tab, THE Web_App SHALL show the Opening_Scene in place of the Play_View (decision 9).
2. THE Opening_Scene SHALL show a dark night-ward panel, the `situationText` in full and a Start button with the draft label, at a font size of at least 16 CSS pixels and a contrast ratio of at least 4.5:1.
3. THE Opening_Scene artwork SHALL be inline SVG or CSS created for this project, with no raster image and no third-party artwork, and SHALL follow play-mode 3.4: no blood, wounds, bone, fangs or skulls.
4. THE Opening_Scene SHALL show no Side_Word, no Diagnosis_Term, no side-specific drawing and no vital-sign number.
5. WHEN the Opening_Scene opens, THE Web_App SHALL move keyboard focus to the Start button, and the Start button SHALL act on a pointer click, Enter or Space.
6. WHEN the learner activates the Start button, THE Web_App SHALL store in the browser tab's sessionStorage, under a key that contains the session_id, that the Opening_Scene was dismissed, and SHALL show the Play_View within 500 ms of Wall_Clock_Time. Play-mode 11.12 (the default 2x request at the first display of the Play_View) SHALL apply at this moment.
7. WHEN the learner selects the Clinician_View with the View_Switcher while the Opening_Scene is shown, THE Web_App SHALL mark the Opening_Scene as dismissed and show the Clinician_View.
8. WHILE the Opening_Scene is shown, THE Web_App SHALL send no request to the Playback_API, the Intervention_API or the Fork_API, and SHALL keep the Vitals_Stream connection and the Session unchanged.
9. WHILE the Opening_Scene is shown, THE Web_App SHALL keep the Safety_Notice visible at the top of the viewport (play-mode 1.8) and the View_Switcher visible.
10. WHERE the Resolved_Case has no Opening_Section, THE Web_App SHALL show no Opening_Scene and SHALL keep play-mode 1.1 and 1.9 unchanged.
11. WHILE the browser viewport is 1280 × 720 CSS pixels at 100% zoom, THE Opening_Scene SHALL show the `situationText` and the Start button with no page scrolling. WHILE the viewport is 320 CSS pixels wide, THE Opening_Scene SHALL show them without horizontal scrolling. This is verified through manual inspection during acceptance testing.

### Requirement 11: No giveaway

**User Story:** As a visitor, I want the monitor, the sound and the opening to be the same whichever side is affected, so that the bedside exam is still worth doing.

#### Acceptance Criteria

1. THE Trace_Time function, the shape functions, Beep_Pitch, the Sound_Scheduler, the Play_Monitor, the Monitor_Panel and the Opening_Scene SHALL read no Variant_Id, no Affected_Side, no Scheduled_Insult side and no side of an Intervention_Record or Exam_Record entry.
2. FOR ALL VitalSigns sample sequences, Playback_Speeds, playback states, Overall_Status sequences and Wall_Clock_Time sequences, THE Sound_Scheduler SHALL issue equal Audio_Port calls for the `left` and the `right` Resolved_Case (side symmetry property).
3. THE screen symmetry property of bedside-exam 10.9 SHALL also hold with the Play_Monitor, the Monitor_Panel, the Waveform_Note, the Sound_Toggle and the Opening_Scene present.

### Requirement 12: Fresh Branch panel

**User Story:** As a medical learner, I want the Timeline to show the events and Checkpoints I just created, so that I can fork from them without rewinding first.

This requirement fixes the bug described in the Introduction and changes core-simulation-loop 8.10.

#### Acceptance Criteria

1. WHEN the Intervention_API returns a success response, from either view, THE Web_App SHALL start one Branch_Panel_Refresh within 1 second of Wall_Clock_Time.
2. WHEN the learner switches to the Clinician_View with the View_Switcher, or the session page opens into the Clinician_View, THE Web_App SHALL start one Branch_Panel_Refresh. Play-mode 1.5 stays true, because a Branch_Panel_Refresh sends no request to the Playback_API, the Intervention_API or the Fork_API.
3. WHILE the Clinician_View is displayed and playback is playing, THE Web_App SHALL start one Branch_Panel_Refresh every Branch_Panel_Refresh_Seconds, and SHALL start none while another Branch_Panel_Refresh is pending.
4. WHEN a Branch_Panel_Refresh succeeds, THE Timeline SHALL show the `event_count` of each Branch from the reloaded Session_Metadata and the Checkpoints of the current Branch from the reloaded lists, within 500 ms of Wall_Clock_Time.
5. IF a Branch_Panel_Refresh fails or does not respond within the existing Checkpoint timeout (`CHECKPOINTS_TIMEOUT_MS`), THEN THE Web_App SHALL keep the previous Session_Metadata and Checkpoint lists and SHALL show no error message.
6. IF the current Branch changes, or a Fork_API request starts, while a Branch_Panel_Refresh is pending, THEN THE Web_App SHALL discard the result of that Branch_Panel_Refresh. A Branch_Panel_Refresh SHALL change no current branch_id, VitalSigns history, Ending, Intervention_Record, Exam_Record, Hint_Record or Speech_State. Where it loads the Session_Metadata, play-mode 6.23 applies.
7. THE Timeline SHALL write each Branch's event count with one pure function that returns "1 event" for 1 and "<n> events" for every other whole number `n`, including "0 events".
8. THE Rewind_Panel SHALL keep its current loading behaviour (play-mode 10.2 to 10.13).

### Requirement 13: Constraints

**User Story:** As the author, I want this feature to change only the presentation, so that the calibrated case and the clinical content stay as they are.

#### Acceptance Criteria

1. THE implementation SHALL change no file under `services/physiology/` and SHALL add no runtime dependency to `apps/web/package.json`.
2. THE implementation SHALL change no threshold, Hold_Duration, Time_Limit, Scheduled_Insult, Status_Rule, Hint, Exam_Rule, Speech_Line, Play_Label, Goal_Text, Side_Reveal_Text, Variant or other existing text or comment in `cases/adult-tension-pneumothorax.yaml`, and SHALL remove no `TODO(author)` marker anywhere. The diff of the case file SHALL consist only of the added `play.opening` block.
3. THE implementation SHALL give every new player-facing text a `TODO(author)` comment, and SHALL present no waveform, beep or alarm as clinical fact or advice in code comments, documents or the UI.
4. THE Web_App SHALL keep the Safety_Notice visible in the Play_View, the Clinician_View, the Opening_Scene and the Ending_Screen (play-mode 1.8).
5. WHEN an implementation task of this spec ends, `npx tsc --noEmit` and `npx vitest --run`, run from `apps/web/`, SHALL both pass.

### Requirement 14: Automated tests

**User Story:** As a maintainer, I want the waveform, sound and refresh logic covered by fast tests, so that later changes cannot break the monitor or leak the side.

#### Acceptance Criteria

1. THE web test suite SHALL run every test of this spec with `vitest --run` in Node without a DOM, while the Physiology_Service and the Pulse_Engine are not running, and SHALL open no HTTP or WebSocket connection and create no real `AudioContext` (play-mode 12.11).
2. THE web test suite SHALL include Vitest unit tests with fixed inputs for Phase_Advance (wrap at 1, several cycles in one step, rate 0, negative and non-finite rates), for ECG_Shape (maximum at R_Phase, baseline at phase 0 and near 1, range), for Pleth_Shape (range, equal ends) and for Capno_Shape (0 in inspiration, plateau height, clamping above Capno_Scale_Max, missing EtCO2).
3. THE web test suite SHALL include fast-check property tests with PBT_PARAMS for Requirements 1.9, 1.10, 2.6, 7.3, 7.5 (no two beeps closer than Min_Beep_Gap) and 11.2, for determinism of every pure function of this spec, and for the event-count text of Requirement 12.7.
4. THE web test suite SHALL include Vitest unit tests for the Trace_Time function: an advance equal to the elapsed Wall_Clock_Time while samples arrive, the same Trace_Clock whichever Playback_Speed produced the samples, a freeze after Trace_Stall_Seconds without a new sample, a resume from the held value with no jump when the next sample arrives, a frozen value while paused, no value without a sample, and a reset after a fork with an unchanged value after a failed fork.
5. THE web test suite SHALL include Vitest tests of the Sound_Scheduler driven by FakeClock with a recording Audio_Port double: no call while the Sound_Setting is off; one beep per R peak at a fixed heart rate, at the same Wall_Clock_Times at 1x, 2x and 4x; no beep while the Trace_Clock is held under Requirement 2.4; Beep_Pitch from the SpO2 Displayed_Value; stop within 200 ms when playback pauses, the Vitals_Stream disconnects or the Ending becomes `lost`; the Warning_Pattern, the Critical_Pattern and a stop at `normal` within 1 second; and beeps during an Alarm_Tone.
6. THE web test suite SHALL include Vitest tests for the Sound_Setting storage (default off, store and restore round trip, unreadable value gives off) and for the Audio_Output gate (no creation outside a user activation, the "waiting" text after a restore, the disabled state when Web Audio is missing).
7. THE web test suite SHALL include Vitest tests of the Waveform_Canvas drawing function with a recording drawing-context double: no drawing without a Trace_Clock, a gap for a missing value, a flat baseline at rate 0, and one redraw per sample under the Reduced_Motion_Preference `reduce`.
8. THE web test suite SHALL include static-markup tests (`renderToStaticMarkup`) for: the Monitor_Panel rows in order with each of the six readouts once, the Trace_Colour in `normal` and today's alarm colours in `warning` and `critical`; the Play_Monitor with no digit, its accessible name, its frame colour per Overall_Status and no flashing class under `reduce`; the Waveform_Note in every view that shows a trace; the Sound_Toggle with `aria-pressed` and its texts; the Opening_Scene with the `situationText`, the Start button and the Safety_Notice; and the screen symmetry property of Requirement 11.3.
9. THE web test suite SHALL include Vitest tests for Requirement 12 with the API client mocked: a Branch_Panel_Refresh after an Intervention_API success, after a switch to the Clinician_View and every Branch_Panel_Refresh_Seconds while playing (driven by FakeClock); the Timeline showing "1 event" and the new Checkpoint afterwards; unchanged values after a failed refresh; and a discarded result when a fork starts while the refresh is pending.
10. THE web test suite SHALL include case-content tests for `cases/adult-tension-pneumothorax.yaml` that check Requirements 9.3 to 9.5 for each Resolved_Case and name the failing Variant_Id, field path and text. IF the case file has no Opening_Section, THEN these tests SHALL fail and SHALL NOT pass with nothing to check.
