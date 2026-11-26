# Implementation Plan: bedside-monitor

## Overview

TypeScript in `apps/web/` (Next.js, Vitest, fast-check), plus one optional field in `cases/case-schema.json` and one added `play.opening` block in `cases/adult-tension-pneumothorax.yaml`. The order follows the design layers: pure functions, then controllers, then state and hooks, then components, then wiring. Each property test comes right after the code it tests.

**Standard verify** (the "Verify" line of every task means this, plus anything listed after it):

- from `apps/web/`: `npx tsc --noEmit` and `npx vitest --run` both pass;
- from the repository root: `git status --short services/physiology/` prints nothing.

**Rules for every task:**

- Change no file under `services/physiology/`. Add no runtime dependency to `apps/web/package.json`.
- Remove no `TODO(author)` marker. Change no threshold, Hold_Duration, Time_Limit, case value, Status_Rule, Hint, Exam_Rule, Speech_Line, Play_Label, Goal_Text, Side_Reveal_Text or other existing clinical text.
- Every new player-facing text gets a `TODO(author)` comment. No waveform, beep or alarm is presented as clinical fact; the alarm patterns are described as illustrative and never as IEC 60601-1-8 signals.
- Never run `docker compose up`, `down`, `stop` or `restart`. Only one-off containers.
- No commits.
- Property tests use fast-check with `PBT_PARAMS` from `src/test/pbt.ts`, carry the comment `// Feature: bedside-monitor, Property <n>: <title>`, and put shared arbitraries in `src/test/generators.ts`.

## Tasks

- [ ] 1. Confirm the Physiology_Service passes `play.opening` through unchanged (read-only)
  - Read, without editing, the case loader, the schema validation and the Case_API response code under `services/physiology/` (find them with a search for `case-schema.json` and `play`). Confirm that the service validates against `cases/case-schema.json` and returns the `play` object as loaded, so a new optional `play.opening` reaches `CaseData.play.opening` (as play-mode 2.13 and patient-speech 1.6 did).
  - IF a typed model, a whitelist or a copy step would drop or reject `play.opening`, THEN stop and ask the user. Do not edit the service.
  - Files: none changed.
  - _Requirements: 9.6, 13.1_
  - Verify: `git status --short` prints nothing new; `git status --short services/physiology/` prints nothing.

- [ ] 2. Add the optional Opening_Section to the schema, the case file and the types
  - [ ] 2.1 Add `openingSection` and `play.opening` to the schema, the case block and the TypeScript types
    - `cases/case-schema.json`: add the `openingSection` definition (`situationText` 1 to 120 characters, required; `references` optional, at least one non-empty string; `additionalProperties: false`) and `play.properties.opening`. Leave `variantOverrides` unchanged.
    - `cases/adult-tension-pneumothorax.yaml`: add only the `play.opening` block with the draft `situationText` and the comment line `# TODO(author): bedside-monitor spec draft, review the situation line` directly above it. No other line changes.
    - `apps/web/src/types/index.ts`: add `OpeningSection` and `PlaySection.opening?`.
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 13.2_
    - Verify: standard; plus `python scripts/validate-case.py cases/adult-tension-pneumothorax.yaml` in the one-off physiology container used by `.kiro/hooks/case-check.json` reports the Base_Case and both Resolved_Cases valid and exits 0 (Req 9.6); `git diff cases/adult-tension-pneumothorax.yaml` shows only added lines.
  - [ ] 2.2 Add the opening case-content tests
    - `apps/web/src/lib/caseContent.test.ts`: `play.opening` present and deep-equal in the Base_Case and every Resolved_Case; no Variant `overrides` and no `variantOverrides` schema property named `opening`; no Side_Word or Diagnosis_Term in `situationText` (case-insensitive); `OPENING_MARK = 'bedside-monitor spec'` and the path pattern `^play\.opening\.situationText$` join the TODO-marker rules as `SPEECH_MARK` does. Failures name the Variant_Id, the field path and the text, and the tests fail when `play.opening` is missing.
    - _Requirements: 9.3, 9.4, 9.5, 14.10_
    - Verify: standard.

- [ ] 3. Implement the pure waveform functions
  - [ ] 3.1 Create `apps/web/src/lib/waveforms.ts`
    - `phaseAdvance`, `ecgShape`, `plethShape`, `capnoShape`, `traceBaseline`, `TraceKind`, the raised-cosine bump helper, `R_PHASE` and `CAPNO_SCALE_MAX_MMHG`, with the shape constants of the design defined once under a `TODO(author)` comment naming open question 1.
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.11_
    - Verify: standard.
  - [ ] 3.2 Write unit tests for the waveform functions
    - `apps/web/src/lib/waveforms.test.ts`: wrap at 1, several cycles in one step, rate 0, negative and non-finite; ECG maximum at `R_PHASE`, baseline at 0 and near 1, range; Pleth range and equal ends; Capno 0 in inspiration, plateau height, clamping above `CAPNO_SCALE_MAX_MMHG`, missing EtCO2; a source-text check for the `TODO(author)` comment naming open question 1.
    - _Requirements: 1.11, 14.2_
    - Verify: standard.
  - [ ] 3.3 Write property test for Phase_Advance
    - **Property 1: Phase_Advance is additive and ignores invalid rates**
    - **Validates: Requirements 1.2, 1.3, 1.9**
    - Files: `apps/web/src/lib/waveforms.test.ts`, `apps/web/src/test/generators.ts` (phase and rate arbitraries, including 0, negative and non-finite rates).
    - Verify: standard.
  - [ ] 3.4 Write property test for the cardiac shapes
    - **Property 2: Cardiac shapes stay in range and join across cycles**
    - **Validates: Requirements 1.4, 1.5**
    - Files: `apps/web/src/lib/waveforms.test.ts`.
    - Verify: standard.
  - [ ] 3.5 Write property test for the capnogram
    - **Property 3: The capnogram is monotone in EtCO2 and peaks at the plateau height**
    - **Validates: Requirements 1.6, 1.7, 1.10**
    - Files: `apps/web/src/lib/waveforms.test.ts`.
    - Verify: standard.

- [ ] 4. Implement Trace_Time
  - [ ] 4.1 Create `apps/web/src/lib/traceTime.ts`
    - `TraceClock`, `TraceTimeInput`, `traceTime` with the rules of the design in order, and `TRACE_STALL_MS = 2000`. No Playback_Speed input.
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7_
    - Verify: standard.
  - [ ] 4.2 Write unit tests for Trace_Time
    - `apps/web/src/lib/traceTime.test.ts`: advance equals elapsed time while samples arrive; same clock for 1x, 2x and 4x arrival patterns; freeze after 2 s; resume with no jump; frozen while paused; `null` without a sample; reset on a new branch_id; unchanged on the same branch_id (failed fork).
    - _Requirements: 14.4_
    - Verify: standard.
  - [ ] 4.3 Write property test for Trace_Time
    - **Property 4: Trace_Time matches the covered-time model**
    - **Validates: Requirements 2.2, 2.3, 2.4, 2.5, 2.6**
    - Files: `apps/web/src/lib/traceTime.test.ts`, `apps/web/src/test/generators.ts` (arrival-list and evaluation-time arbitraries).
    - Verify: standard.

- [ ] 5. Implement the Trace_Engine
  - [ ] 5.1 Create `apps/web/src/lib/traceEngine.ts`
    - `createTraceEngine()` with `onSample`, `setPlaying`, `reset`, `frame`, `clockAt`, `advancingUntilMs`, `rCrossings` and `subscribe`; rate segments with raw rates (`readVital`) and the EtCO2 Displayed_Value; reset on a new branch_id; pruning of arrivals and segments.
    - _Requirements: 2.7, 2.8, 2.9, 2.10_
    - Verify: standard.
  - [ ] 5.2 Write property test and unit tests for the Trace_Engine
    - **Property 5: Phases are continuous across samples**
    - **Validates: Requirements 2.9**
    - Unit tests: reset on a new branch_id, no reset on the same one; `rCrossings` at a fixed rate; `advancingUntilMs` is `null` while paused and without a clock.
    - Files: `apps/web/src/lib/traceEngine.test.ts`, `apps/web/src/test/generators.ts` (sample-sequence arbitraries).
    - Verify: standard.

- [ ] 6. Add the monitor theme, the UI texts and the shared alarm palette
  - [ ] 6.1 Create the theme and text constants and refactor the alarm colours
    - `apps/web/src/lib/monitorTheme.ts`: `MONITOR_BG`, `TRACE_COLOURS`, `contrastRatio`.
    - `apps/web/src/lib/monitorText.ts`: every new UI text of the design, each with `// TODO(author): bedside-monitor spec draft`.
    - `apps/web/src/lib/alarms.ts`: one `ALARM_PALETTE`; `getAlarmColor` and `getAlarmBgColor` return exactly today's strings; new `getAlarmBorderColor`.
    - _Requirements: 3.7, 4.6, 5.4, 13.3_
    - Verify: standard.
  - [ ] 6.2 Write unit tests for the theme, texts and palette
    - `apps/web/src/lib/monitorTheme.test.ts`: contrast ≥ 4.5 for every Trace_Colour on `MONITOR_BG`; no Trace_Colour equals the warning or critical hex; `getAlarmColor` and `getAlarmBgColor` unchanged for every state; `getAlarmBorderColor` per state.
    - `apps/web/src/lib/monitorText.test.ts`: `WAVEFORM_NOTE_TEXT` has no digit, Side_Word or Diagnosis_Term; every exported constant has a `TODO(author)` comment (source-text check).
    - _Requirements: 3.7, 4.6, 13.3_
    - Verify: standard.

- [ ] 7. Implement the trace drawing function
  - [ ] 7.1 Create `apps/web/src/lib/traceDraw.ts`
    - `TraceDrawContext`, `TraceRowLayout`, `TraceLayout`, `traceValueAt`, `drawTraces` (sweep and strip modes, gaps with `moveTo`, clear-only for a `null` frame, no `fillText`), `shouldRedraw(prevSeq, frame, mode)`, `shouldAnimate(engine, now, mounted)`, and the Trace_Window constants.
    - _Requirements: 2.7, 2.11, 3.1, 3.2, 3.3, 3.4, 3.5, 5.2_
    - Verify: standard.
  - [ ] 7.2 Write property test for `traceValueAt`
    - **Property 6: Gaps only for missing values, baselines at rate zero**
    - **Validates: Requirements 3.4, 3.5**
    - Files: `apps/web/src/lib/traceDraw.test.ts`, `apps/web/src/test/generators.ts` (segment-list arbitraries).
    - Verify: standard.
  - [ ] 7.3 Write unit tests for the drawing function
    - `apps/web/src/lib/traceDraw.test.ts` with a recording `TraceDrawContext` double: no stroke for a `null` frame; `moveTo` after a gap; flat line at rate 0; one redraw per `sampleSeq` change in strip mode; no `fillText` ever; `shouldAnimate` false when paused, held or unmounted.
    - _Requirements: 2.11, 5.2, 14.7_
    - Verify: standard.

- [ ] 8. Implement the Sound_Setting storage and the Audio_Output gate
  - [ ] 8.1 Create `apps/web/src/lib/soundSetting.ts`
    - `soundKey`, `readSoundSetting`, `writeSoundSetting`; missing, unreadable or unknown values read as off; writes that throw are skipped silently.
    - _Requirements: 6.2, 6.3_
    - Verify: standard.
  - [ ] 8.2 Write property test and unit tests for the Sound_Setting
    - **Property 9: Sound_Setting storage round trip**
    - **Validates: Requirements 6.2, 6.3**
    - Unit tests: default off, round trip, throwing storage gives off.
    - Files: `apps/web/src/lib/soundSetting.test.ts`.
    - Verify: standard.
  - [ ] 8.3 Create `apps/web/src/lib/webAudioPort.ts`
    - `createAudioOutput(factory)` with status `off | waiting | running | unavailable`, where only `activate()` creates or resumes a context; `webAudioPort(ctx, clock)` with one oscillator and one gain node per tone and linear `RAMP_MS` ramps.
    - _Requirements: 6.5, 6.6, 6.7, 6.8, 7.9_
    - Verify: standard.
  - [ ] 8.4 Write unit tests for the Audio_Output gate and the port
    - `apps/web/src/lib/webAudioPort.test.ts` with a fake `AudioContextLike`: no context outside `activate()`; `waiting` after a restore of on; `unavailable` for a null factory, a throwing constructor and a rejected `resume()`; recorded nodes, start times and ramps.
    - _Requirements: 14.1, 14.6_
    - Verify: standard.

- [ ] 9. Implement the Sound_Scheduler
  - [ ] 9.1 Create `apps/web/src/lib/soundScheduler.ts`
    - `ToneSpec`, `ToneHandle`, `AudioPort`, `SoundConditions`, `soundAllowed`, `beepPitch`, `WARNING_PATTERN`, `CRITICAL_PATTERN`, `createSoundScheduler` (50 ms tick, 100 ms look-ahead capped at the stall horizon, `MIN_BEEP_GAP_MS`, cancel on sample arrival and on any gate change, separate beep and alarm handles), and the gain, ramp and pitch constants with `TODO(author)` comments naming open questions 3 and 4. Comments describe the patterns as illustrative sounds, not IEC 60601-1-8 signals.
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 7.9, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 11.1_
    - Verify: standard.
  - [ ] 9.2 Write property test for Beep_Pitch
    - **Property 10: Beep_Pitch is monotone and bounded**
    - **Validates: Requirements 7.3**
    - Files: `apps/web/src/lib/soundScheduler.test.ts`.
    - Verify: standard.
  - [ ] 9.3 Write property test for the gate, gap and gain
    - **Property 11: Scheduler tones respect the gate, the gap and the gain**
    - **Validates: Requirements 7.5, 7.6, 7.9**
    - Files: `apps/web/src/lib/soundScheduler.test.ts`, `apps/web/src/test/generators.ts` (condition and clock-step arbitraries).
    - Verify: standard.
  - [ ] 9.4 Write property test for beeps on R peaks
    - **Property 12: Beeps fall on the drawn R peaks**
    - **Validates: Requirements 7.1**
    - Files: `apps/web/src/lib/soundScheduler.test.ts`.
    - Verify: standard.
  - [ ] 9.5 Write property test for sound side symmetry
    - **Property 13: Sound side symmetry**
    - **Validates: Requirements 11.2**
    - Uses `CASE_LEFT` and `CASE_RIGHT`. Files: `apps/web/src/lib/soundScheduler.test.ts`.
    - Verify: standard.
  - [ ] 9.6 Write FakeClock unit tests for the Sound_Scheduler
    - `apps/web/src/lib/soundScheduler.test.ts` with FakeClock and a recording Audio_Port: no call while off; one beep per R peak at the same times at 1x, 2x and 4x; no beep while held; pitch from the SpO2 Displayed_Value; stop within 200 ms on pause, disconnect and a `lost` Ending; Warning_Pattern, Critical_Pattern, stop within 1 s at `normal`; beeps during an alarm; the two patterns differ in tone count.
    - _Requirements: 8.3, 14.5_
    - Verify: standard.

- [ ] 10. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.
  - Verify: standard.

- [ ] 11. Fix the Branch panel
  - [ ] 11.1 Create `apps/web/src/lib/eventCount.ts` and use it in the Timeline
    - `eventCountText(n)`; `apps/web/src/components/Timeline.tsx` uses it instead of `{branch.event_count} events`.
    - _Requirements: 12.7_
    - Verify: standard.
  - [ ] 11.2 Write property test for the event-count text
    - **Property 17: Event-count text**
    - **Validates: Requirements 12.7**
    - Unit examples for 0, 1 and 2. Files: `apps/web/src/lib/eventCount.test.ts`.
    - Verify: standard.
  - [ ] 11.3 Create `apps/web/src/lib/branchPanelRefresh.ts`
    - `createBranchPanelRefresher` with `refresh` (skip while pending; epoch and branch check before `apply`; failures silent), `setPeriodic` (`BRANCH_PANEL_REFRESH_MS = 10_000`), `invalidate`, `dispose`.
    - _Requirements: 12.3, 12.5, 12.6_
    - Verify: standard.
  - [ ] 11.4 Add the `branchPanelRefreshed` action to `apps/web/src/lib/sessionState.ts`
    - Guard on `session.current_branch_id === state.currentBranchId`; merge `byBranch` as `checkpointsLoaded` does; recompute `lineage`; pass through `withSides` and `withRescueGate`; change nothing else.
    - _Requirements: 12.4, 12.6_
    - Verify: standard.
  - [ ] 11.5 Write property test for `branchPanelRefreshed`
    - **Property 16: A Branch_Panel_Refresh changes only the Branch panel data**
    - **Validates: Requirements 12.4, 12.6**
    - Files: `apps/web/src/lib/sessionState.test.ts`, `apps/web/src/test/generators.ts` (refresh-result arbitraries).
    - Verify: standard.
  - [ ] 11.6 Wire the refresher into `apps/web/src/hooks/useSimulationSession.ts`
    - All-or-nothing `load` with `CHECKPOINTS_TIMEOUT_MS` (dispatch-free mode of `fetchLineageCheckpoints`); `refresh()` right after `interventionSucceeded`; `refresh()` when the view becomes `'clinician'`, including page open; `setPeriodic(view === 'clinician' && playing)`; `invalidate()` at fork start and on a `currentBranchId` change; a fork epoch. `RewindPanel.tsx` is not changed.
    - _Requirements: 12.1, 12.2, 12.3, 12.5, 12.6, 12.8_
    - Verify: standard.
  - [ ] 11.7 Write tests for the Branch panel fix
    - `apps/web/src/lib/branchPanelRefresh.test.ts` (FakeClock, mocked `load`): one refresh after an Intervention success; one on a switch to the Clinician_View; one every 10 s while periodic, none while pending; unchanged after a rejected `load`; discarded after `invalidate()`.
    - `apps/web/src/components/Timeline.test.tsx`: "1 event" and the new Checkpoint after `branchPanelRefreshed`.
    - `apps/web/src/hooks/useSimulationSession.test.ts`: the trigger helper fires after `interventionSucceeded`, with the API client mocked.
    - _Requirements: 14.1, 14.9_
    - Verify: standard.

- [ ] 12. Add the Opening_Scene state
  - [ ] 12.1 Add `openingShown` to `apps/web/src/lib/sessionState.ts`
    - `caseLoaded` gains `openingDismissed`; new `openingDismissed` action; `viewSelected('clinician')` clears `openingShown`; `sessionScreenMode` gains `'opening'` after `'loading'`.
    - _Requirements: 10.1, 10.7, 10.10_
    - Verify: standard.
  - [ ] 12.2 Write property test for the opening selection rule
    - **Property 15: Opening_Scene selection rule**
    - **Validates: Requirements 10.1, 10.7, 10.10**
    - Files: `apps/web/src/lib/sessionState.test.ts`, `apps/web/src/test/generators.ts` if new arbitraries are needed.
    - Verify: standard.
  - [ ] 12.3 Add the opening helpers and actions to `apps/web/src/hooks/useSimulationSession.ts`
    - `openingKey`, `readOpeningDismissed`, `markOpeningDismissed`; `caseLoaded` receives the stored flag; `shouldSendDefaultSpeed(..., openingShown)` returns false while shown; `actions.dismissOpening()`; `selectView('clinician')` stores the dismissal while shown. No Playback, Intervention or Fork request while the Opening_Scene is shown.
    - _Requirements: 10.1, 10.6, 10.7, 10.8_
    - Verify: standard.
  - [ ] 12.4 Write unit tests for the opening helpers
    - `apps/web/src/hooks/useSimulationSession.test.ts`: key and read/mark helpers with memory and throwing storage; `shouldSendDefaultSpeed` false while shown and true after dismissal; dismissal stored on a Clinician switch.
    - _Requirements: 10.6, 10.7, 10.8_
    - Verify: standard.

- [ ] 13. Add the monitor hooks
  - [ ] 13.1 Create `apps/web/src/hooks/useReducedMotion.ts` and `apps/web/src/hooks/useBedsideMonitor.ts`
    - `useReducedMotion` (false during server rendering). `useBedsideMonitor(sessionId, state)` holds one Trace_Engine, Audio_Output gate and Sound_Scheduler in refs; effects call `onSample`, `setPlaying`, `reset` and `scheduler.update`; one-shot `click`, `keydown` and `touchend` listeners while `waiting`; the toggle stores the Sound_Setting. Export a pure `soundConditionsFrom(...)` that reads `connected`, `ending`, `avatar.overallStatus` and the latest sample only, and no Variant, side or record. The view does not affect the hook.
    - _Requirements: 2.8, 2.10, 6.3, 6.4, 6.5, 6.6, 6.7, 7.6, 8.5, 11.1_
    - Verify: standard.
  - [ ] 13.2 Write unit tests for `soundConditionsFrom`
    - `apps/web/src/hooks/useBedsideMonitor.test.ts`: each gate input maps from the state; the result is equal for the `left` and `right` Resolved_Case states.
    - _Requirements: 7.6, 11.1_
    - Verify: standard.

- [ ] 14. Build the monitor components
  - [ ] 14.1 Add the `monitor` variant to `apps/web/src/components/VitalSign.tsx`
    - Optional `variant` (default `'tile'`, markup unchanged) and `normalColour`; monitor variant compact, Trace_Colour in `normal`, `getAlarmColor` and `getAlarmBgColor` otherwise.
    - _Requirements: 4.3, 4.4, 4.9_
    - Verify: standard.
  - [ ] 14.2 Create `apps/web/src/components/WaveformCanvas.tsx` and `apps/web/src/components/WaveformNote.tsx`
    - Fixed `<canvas aria-hidden="true">` markup from layout props only; drawing in effects with `drawTraces`, `shouldRedraw` and `shouldAnimate`; nothing drawn when `getContext('2d')` is null. Note at `text-base`.
    - _Requirements: 2.11, 3.1, 3.3, 3.6, 3.8_
    - Verify: standard.
  - [ ] 14.3 Create `apps/web/src/components/MonitorPanel.tsx`
    - Rows ECG, Pleth, CO₂ and the readout row, today's labels and units, `clinicianAlarmState` moved unchanged, `formatVital`, Waveform_Note under the rows.
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_
    - Verify: standard.
  - [ ] 14.4 Create `apps/web/src/components/PlayMonitor.tsx` and add the flash CSS
    - `<figure data-part="play-monitor">`, `role="img"` with `PLAY_MONITOR_NAME`, no `aria-live`, frame from `getAlarmBorderColor`, `sp-monitor-flash` only when not `normal` and not reduced motion. `apps/web/src/app/globals.css`: `@keyframes sp-monitor-flash` with a 1 s period and `animation: none` under `prefers-reduced-motion: reduce`.
    - _Requirements: 5.1, 5.2, 5.4, 5.5, 5.6, 5.7, 5.8_
    - Verify: standard.
  - [ ] 14.5 Create `apps/web/src/components/SoundToggle.tsx`
    - Button with `aria-pressed`, inline SVG icon, the four state texts, `disabled` when `unavailable`, play-mode focus ring, `text-base`.
    - _Requirements: 6.1, 6.6, 6.7, 6.9_
    - Verify: standard.
  - [ ] 14.6 Create `apps/web/src/components/OpeningScene.tsx`
    - Dark panel, inline SVG night ward made for this project (no blood, wounds, bone, fangs, skulls or side-specific drawing), `situationText` at `text-xl`, autofocused Start button that also focuses on mount.
    - _Requirements: 10.2, 10.3, 10.4, 10.5_
    - Verify: standard.
  - [ ] 14.7 Write property test for markup independence
    - **Property 7: Monitor markup does not depend on sample values**
    - **Validates: Requirements 3.8**
    - Files: `apps/web/src/components/monitorMarkup.test.tsx`.
    - Verify: standard.
  - [ ] 14.8 Write property test for the readouts
    - **Property 8: Readouts use Display_Precision and the colour rule**
    - **Validates: Requirements 4.3, 4.4, 4.5**
    - Files: `apps/web/src/components/monitorMarkup.test.tsx`.
    - Verify: standard.
  - [ ] 14.9 Write static-markup and source tests for the components
    - `apps/web/src/components/monitorComponents.test.tsx` (`renderToStaticMarkup`): Monitor_Panel rows in order with each of the six readouts once; Play_Monitor without digits, with its name, frame class per Overall_Status, no flash class under reduced motion; Sound_Toggle `aria-pressed` and four texts; Opening_Scene text and Start button; `VitalSign` tile markup unchanged; `globals.css` flash period ≥ 1 s and disabled under reduced motion; no new file of this spec mentions "IEC 60601" except as a negation.
    - _Requirements: 5.2, 5.5, 8.7, 13.3, 14.8_
    - Verify: standard.

- [ ] 15. Wire the monitor into the views
  - [ ] 15.1 Update `apps/web/src/components/ClinicianView.tsx`
    - Replace the two `VitalSign` grids with `<MonitorPanel>`; add `<SoundToggle>` to the playback row; keep the trend chart, Intervention panel, Timeline, Ending banner and header. Optional `monitor` prop.
    - _Requirements: 4.1, 4.7, 4.8, 6.1_
    - Verify: standard.
  - [ ] 15.2 Update `apps/web/src/components/PlayView.tsx`
    - Avatar and `<PlayMonitor>` side by side at `lg`+, stacked under the StatusLine below `lg`; `<SoundToggle>` in `play-toolbar`; `AVATAR_WRAPPER_STYLE` width cap; layout comment updated. Avatar markup unchanged. Optional `monitor` prop.
    - _Requirements: 5.1, 5.3, 5.9, 5.10, 6.1_
    - Verify: standard.
  - [ ] 15.3 Update `apps/web/src/components/SessionScreen.tsx`
    - `'opening'` mode with `SafetyNotice`, `ViewSwitcher` and `OpeningScene` wired to `actions.dismissOpening`; optional `monitor` prop passed to both views.
    - _Requirements: 10.1, 10.6, 10.7, 10.9, 10.11, 13.4_
    - Verify: standard.
  - [ ] 15.4 Update `apps/web/src/app/session/[sessionId]/page.tsx`
    - `const monitor = useBedsideMonitor(sessionId, sim.state)` and `<SessionScreen sim={sim} monitor={monitor} />`.
    - _Requirements: 2.10, 6.4_
    - Verify: standard.
  - [ ] 15.5 Extend the screen symmetry property test
    - **Property 14: Screen symmetry with the monitor**
    - **Validates: Requirements 11.3**
    - Files: `apps/web/src/components/sideSymmetry.test.tsx` (a `monitor` from a test Trace_Engine; the Opening_Scene mode).
    - Verify: standard.
  - [ ] 15.6 Update the view-level markup tests
    - `apps/web/src/components/ClinicianView.test.tsx`, `PlayView.test.tsx`, `SessionScreen.test.tsx`: Waveform_Note and Sound_Toggle in both views; Opening_Scene with `situationText`, Start button and Safety_Notice through `SessionScreen`; `'opening'` mode order. If an existing test fails because of the intended layout change, update its selectors only. If an existing behaviour assertion fails, stop and ask the user.
    - _Requirements: 3.6, 10.9, 13.4, 14.8_
    - Verify: standard.

- [ ] 16. Run the final constraint checks (read-only)
  - From the repository root, all of these must hold: `git diff apps/web/package.json` adds no runtime dependency; `git diff cases/adult-tension-pneumothorax.yaml` shows only the added `play.opening` lines; `git diff -U0 | grep '^-.*TODO(author)'` prints nothing; `git status --short services/physiology/` prints nothing.
  - Files: none changed. If a check fails, report it to the user and do not commit.
  - _Requirements: 13.1, 13.2, 13.3, 13.5_
  - Verify: standard.

## Notes

- Test sub-tasks are not marked optional, because Requirement 14 makes the tests part of the spec.
- Layout fit at 1280 × 720 and 320 px (Req 4.8, 5.9, 5.10, 10.11) and the listening check of the sounds are manual acceptance checks and are not part of these tasks.
- The design's TypeScript interfaces are the source of names and signatures.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1"] },
    { "id": 1, "tasks": ["2.1"] },
    { "id": 2, "tasks": ["2.2", "3.1", "4.1", "6.1", "8.1", "8.3"] },
    { "id": 3, "tasks": ["3.2", "4.2", "5.1", "6.2", "8.2", "8.4"] },
    { "id": 4, "tasks": ["3.3", "7.1", "9.1"] },
    { "id": 5, "tasks": ["3.4", "4.3"] },
    { "id": 6, "tasks": ["3.5", "5.2"] },
    { "id": 7, "tasks": ["7.2", "9.2"] },
    { "id": 8, "tasks": ["7.3", "9.3"] },
    { "id": 9, "tasks": ["9.4"] },
    { "id": 10, "tasks": ["9.5"] },
    { "id": 11, "tasks": ["9.6"] },
    { "id": 12, "tasks": ["10"] },
    { "id": 13, "tasks": ["11.1", "11.3", "11.4"] },
    { "id": 14, "tasks": ["11.2", "11.5", "11.6"] },
    { "id": 15, "tasks": ["11.7", "12.1"] },
    { "id": 16, "tasks": ["12.2", "12.3"] },
    { "id": 17, "tasks": ["12.4", "13.1", "14.1", "14.2", "14.5", "14.6"] },
    { "id": 18, "tasks": ["13.2", "14.3", "14.4"] },
    { "id": 19, "tasks": ["14.7", "14.9"] },
    { "id": 20, "tasks": ["14.8"] },
    { "id": 21, "tasks": ["15.1", "15.2"] },
    { "id": 22, "tasks": ["15.3"] },
    { "id": 23, "tasks": ["15.4"] },
    { "id": 24, "tasks": ["15.5", "15.6"] },
    { "id": 25, "tasks": ["16"] }
  ]
}
```
