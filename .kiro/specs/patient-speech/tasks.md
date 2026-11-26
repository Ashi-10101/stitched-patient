# Implementation Plan: Patient speech

## Overview

This plan implements patient speech: a `play.speech` block in the case file, the Speech_Check in TypeScript and Python, the Speech_Selector fold in the session reducer, the Speech_Provider seam with the Scripted_Speech_Provider, the speech bubble and live region in the Play_View and on the rescued Ending_Screen, speech values in the Scenario_Result and the Calibration_Record, and four pointer lines in older specs. It follows `requirements.md` and `design.md` of this spec. Property numbers refer to the design's "Correctness Properties" section.

The order is: types and Speech_Check → schema, case file and `scripts/validate-case.py` → case-content checks → Speech_Selector → reducer → provider and gate → checkpoint → hook, live region, Play_View and Ending_Screen → Clinician_View and screen symmetry → calibration code → pointer lines → final check → calibration record.

Every task is small (about one module and its tests) and the whole plan is about one day of work. Every task and sub-task is required; none is optional, and the property tests are required sub-tasks.

Every task ends with these checks, which its report quotes:

- from `apps/web/`: `npx tsc --noEmit` passes and `npx vitest --run` passes (quote the `tsc` result and the Vitest summary line);
- from the repository root: `git status --short services/physiology/` prints nothing.

No task commits. The user commits. No task runs `docker compose up`, `down`, `stop` or `restart`, builds an image, or starts or stops the Physiology_Service.

## Tasks

- [x] 1. Speech types and the Speech_Check
  - [x] 1.1 Add the speech types and implement `speechCheck.ts`
    - Files: `apps/web/src/types/index.ts`, `apps/web/src/lib/speechCheck.ts` (new). No other file changes
    - In `types/index.ts`: `SpeechStatusEntry`, `SpeechSection` and the optional `PlaySection.speech`, as the design section "TypeScript types" states. No existing field changes
    - In `speechCheck.ts`: `SPEECH_MAX_CODE_POINTS`, `SIDE_WORD_PATTERN`, `THIRD_PERSON_PATTERN` (no look-behind, D11), `SPEECH_RULE_TEXT`, `forbiddenSpeechTerms(caseData)` and `speechCheck(text, caseData)` with rules (a) to (f) in the design's order: a blank text reports only rule (a); length counted in code points; Diagnosis_Terms and Forbidden_Speech_Terms by case-insensitive substring; Side_Words and Third_Person_Words as whole words, each distinct lower-cased match once
    - `forbiddenSpeechTerms` reads only `play.speech.forbiddenTerms`, every Intervention `label` and `playLabel`, and the Exam_Button texts in the order `examButtons` from `examFinding.ts` gives; non-blank, without repeats. Without a Play_Section, rules (c) and (e) use empty lists
    - Verify: from `apps/web/`, `npx tsc --noEmit` and `npx vitest --run` pass; `git status --short services/physiology/` prints nothing
    - _Requirements: 2.1, 4.7_
  - [x] 1.2 Write the Speech_Check unit tests
    - Files: `apps/web/src/lib/speechCheck.test.ts` (new). No other file changes
    - Build the test case from a fixture of `src/test/caseFixtures.ts` with a `play.speech.forbiddenTerms` list added in the test
    - One failing text per rule (a) to (f) with the exact `SPEECH_RULE_TEXT` message; a 200 and a 201 code-point text that contain an astral character (code points, not UTF-16 units); "alright" passes and "all right" fails; "the", "here" and "them" pass and "he's" fails; a Forbidden_Speech_Term taken from an Intervention `label`, a Play_Label and an Exam_Button text; a passing text gives `[]`; a case without a Play_Section
    - Verify: from `apps/web/`, `npx tsc --noEmit` and `npx vitest --run` pass; `git status --short services/physiology/` prints nothing
    - _Requirements: 2.1, 12.1_
  - [x] 1.3 Write the property test for the Speech_Check
    - **Property 1: The Speech_Check reports exactly the broken rules**
    - Files: `apps/web/src/lib/speechCheck.test.ts`. No other file changes
    - Use `PBT_PARAMS` from `src/test/pbt.ts`. Tag: `// Feature: patient-speech, Property 1: The Speech_Check reports exactly the broken rules`
    - Verify: from `apps/web/`, `npx tsc --noEmit` and `npx vitest --run` pass; `git status --short services/physiology/` prints nothing
    - **Validates: Requirements 2.1**

- [x] 2. Case data: schema, case file and checks
  - [x] 2.1 Add `speechSection` to the schema and the `play.speech` block to the case file
    - Files: `cases/case-schema.json`, `cases/adult-tension-pneumothorax.yaml`. No other file changes
    - In `case-schema.json`: the `speech` property under `properties.play.properties` and the `speechLineList` and `speechSection` definitions, exactly as the design section "JSON Schema changes" states. Do not touch `variantOverrides` or any other definition
    - In the case file: insert the `play.speech` block of the design section "Case file addition", character for character, at the end of the `play` mapping, after the `exam` block and before the blank line and the `# Author's game-rule decision ...` comment. Every Speech_Line and the `forbiddenTerms` line keep their `TODO(author)` comment containing "patient-speech spec" on the comment-only line directly above
    - Change no threshold, Hold_Duration, Time_Limit, Scheduled_Insult, Status_Rule, Hint, Exam_Rule, Play_Label, Goal_Text, Side_Reveal_Text, Variant or other existing text or comment, and remove no `TODO(author)` marker. `git diff --numstat cases/adult-tension-pneumothorax.yaml` must show 0 deleted lines, and `git diff cases/adult-tension-pneumothorax.yaml` must show only the added `play.speech` block; quote the numstat line
    - A save under `cases/` triggers the `case-check` hook; read its output and report it
    - Verify: from `apps/web/`, `npx tsc --noEmit` and `npx vitest --run` pass; `git status --short services/physiology/` prints nothing
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 3.1, 3.2, 3.3, 3.4, 11.2_
  - [x] 2.2 Add the Python Speech_Check to `scripts/validate-case.py` and run the case check
    - Files: `scripts/validate-case.py`. No other file changes
    - Implement `SPEECH_MAX_CODE_POINTS`, `SIDE_WORD`, `THIRD_PERSON_WORD`, `forbidden_speech_terms`, `speech_check`, `speech_lines`, `speech_problems` and `validate_speech` as the design section "`scripts/validate-case.py`" states: the same patterns and the same rule texts as `SPEECH_RULE_TEXT`, rules (a) to (f) in the same order, run after the schema checks pass on the Base_Case (prefix `""`) and on each Resolved_Case from `case_resolver.resolve_variant` (prefix `variant '<id>': `). Print `✗ <problem>` per failure, or `✓ Every Speech_Line passes the speech checks`; `main` exits with 1 when the schema or the speech check fails. Add no pytest (decision 14)
    - Run the case check exactly as Requirement 11.6 describes, never with the host Python:
      - first check that the image exists: `docker image inspect stitched-patient-physiology > /dev/null`. If it is missing, stop and ask the user to run `docker compose build physiology` in their own terminal. Never build the image in this task
      - passing run, from the repository root: `docker compose run -T --rm --no-deps -v "$PWD:/repo:ro" -w /repo -e PYTHONDONTWRITEBYTECODE=1 physiology python3 scripts/validate-case.py cases/adult-tension-pneumothorax.yaml`. It must report the Base_Case and both Resolved_Cases valid, print the speech pass line, and exit 0
      - failing run: copy the case file to a temporary directory outside the repository (for example from `mktemp -d`) and change one Speech_Line of the copy to contain the whole word "left". Never edit the repository file for this. Run `docker compose run -T --rm --no-deps -v "$PWD:/repo:ro" -v "<copy>:/tmp/speech-side-word.yaml:ro" -w /repo -e PYTHONDONTWRITEBYTECODE=1 physiology python3 scripts/validate-case.py /tmp/speech-side-word.yaml`. It must print a failure that names the path, the line and `contains Side_Word "left"`, and exit with a non-zero status. Delete the temporary copy afterwards
      - use execute_bash with a timeout of 300000 ms for each run. Never run `docker compose up`, `down`, `stop` or `restart`
    - Quote the output and the exit code of both runs in the task report
    - Verify: from `apps/web/`, `npx tsc --noEmit` and `npx vitest --run` pass; `git status --short services/physiology/` prints nothing
    - _Requirements: 1.7, 2.3, 11.6_
  - [x] 2.3 Add the speech case-content checks
    - Files: `apps/web/src/lib/caseContent.test.ts`. No other file changes
    - Add, as the design section "Case-content test additions" states: `SPEECH_MARK`, `SPEECH_ITEM_PATTERNS` joined to `TEXT_ITEM_PATTERNS`, the `play.speech.references` covering path, `checkSpeechLines` (through `perVariant`, failures as `<path> "<line>": <rule>`), `checkSpeechSentences`, `checkSpeechShape`, `checkSpeechInBaseOnly`, `checkSpeechEqualAcrossVariants` and the `variantOverrides` schema test
    - Each checker returns `play.speech is missing` without a Speech_Section, and each is also run on a broken copy in the test to show that it names the failing path
    - Existing checks stay as they are
    - Verify: from `apps/web/`, `npx tsc --noEmit` and `npx vitest --run` pass; `git status --short services/physiology/` prints nothing
    - _Requirements: 1.5, 2.2, 2.4, 2.5, 2.6, 3.1, 3.4, 8.1, 12.7_

- [ ] 3. Speech_Selector
  - [ ] 3.1 Implement `speechSelector.ts`
    - Files: `apps/web/src/lib/speechSelector.ts` (new). No other file changes
    - Export `SPEECH_HOLD_SECONDS = 10`, `SPEECH_ROTATE_SECONDS = 30`, `SpeechKey`, `SpeechState`, `SpeechInput`, `SpeechStep`, `speechLines`, `targetSpeechKey` (the seven steps of the design, calling `selectStatus` and `earliestInsultTime`), `selectSpeech` (the hold and rotation pseudocode of the design, returning `previous` itself when nothing changes), `foldSpeech`, `checkedScriptedLine` and `speechRequestKey`
    - The module reads no Wall_Clock_Time, random value, network, Variant_Id, Affected_Side, Scheduled_Insult side, Intervention_Record or Exam_Record
    - Verify: from `apps/web/`, `npx tsc --noEmit` and `npx vitest --run` pass; `git status --short services/physiology/` prints nothing
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 5.1, 5.2, 5.3, 5.4, 5.10, 8.2_
  - [ ] 3.2 Write the Speech_Selector unit tests
    - Files: `apps/web/src/lib/speechSelector.test.ts` (new). No other file changes
    - Each rule of 4.2 with fixed inputs: silence at 29 s and `early` at exactly 30 s; a Status_Rule sentence without an entry; the `defaultSentence` with the gate `null`, greater than, equal to and less than the time, and `-Infinity`; `rescued` with and without Rescued_Lines; `lost`; no sample; no Speech_Section
    - Requirement 5: a key change at 9 s is held and at 10 s is not; an Ending overrides the hold; rotation at 30 s and the wrap to the first line; a one-line list never rotates; another Branch and a later `since` are ignored
    - The engine-facts sequence of the `left` affected-side Scenario (10 s steps: default sentence 0 to 100 s, Status_Rules from 110 s, gate 150 s, default sentence at 220 s, `rescued` at 230 s) gives silence before 30 s, the first `early` line from 30 s, silence at 220 s and the Rescued_Lines line at 230 s
    - `checkedScriptedLine` returns `null` for a line that fails the Speech_Check; `speechRequestKey` changes on key, index, `since` and Branch changes and not otherwise
    - Verify: from `apps/web/`, `npx tsc --noEmit` and `npx vitest --run` pass; `git status --short services/physiology/` prints nothing
    - _Requirements: 4.2, 4.7, 5.1, 5.2, 5.3, 5.4, 6.4, 12.2, 12.3_
  - [ ] 3.3 Add the speech generators and write the property test for line membership
    - **Property 2: Every returned line is a case line at its index**
    - Files: `apps/web/src/test/generators.ts`, `apps/web/src/lib/speechSelector.test.ts`. No other file changes
    - Add `arbEnding`, `arbGate` (`null`, `-Infinity`, or a time from a grid around 30, 150 and 220 s) and `arbSpeechState` (any key of the shipped case or `silent`, index 0 to 3, a branch_id from a small set, any `since`) to `generators.ts`
    - Use `PBT_PARAMS`. Tag: `// Feature: patient-speech, Property 2: Every returned line is a case line at its index`
    - Verify: from `apps/web/`, `npx tsc --noEmit` and `npx vitest --run` pass; `git status --short services/physiology/` prints nothing
    - **Validates: Requirements 4.4, 4.5**
  - [ ] 3.4 Write the property test for the hold
    - **Property 4: Key changes on one Branch are at least the hold apart**
    - Files: `apps/web/src/lib/speechSelector.test.ts`. No other file changes
    - Use `PBT_PARAMS` and `arbSampleSequence`. Tag: `// Feature: patient-speech, Property 4: Key changes on one Branch are at least the hold apart`
    - Verify: from `apps/web/`, `npx tsc --noEmit` and `npx vitest --run` pass; `git status --short services/physiology/` prints nothing
    - **Validates: Requirements 5.1**
  - [ ] 3.5 Write the property test for Branch isolation
    - **Property 5: A previous Speech_State from another Branch or the future is ignored**
    - Files: `apps/web/src/lib/speechSelector.test.ts`. No other file changes
    - Use `PBT_PARAMS`. Tag: `// Feature: patient-speech, Property 5: A previous Speech_State from another Branch or the future is ignored`
    - Verify: from `apps/web/`, `npx tsc --noEmit` and `npx vitest --run` pass; `git status --short services/physiology/` prints nothing
    - **Validates: Requirements 5.4**
  - [ ] 3.6 Write the property test for side symmetry
    - **Property 6: Speech is the same on both sides**
    - Files: `apps/web/src/lib/speechSelector.test.ts`. No other file changes
    - Compare `selectSpeech` and `foldSpeech` on `CASE_LEFT` and `CASE_RIGHT` resolved from the shipped case. Use `PBT_PARAMS`. Tag: `// Feature: patient-speech, Property 6: Speech is the same on both sides`
    - Verify: from `apps/web/`, `npx tsc --noEmit` and `npx vitest --run` pass; `git status --short services/physiology/` prints nothing
    - **Validates: Requirements 8.2, 8.3**

- [ ] 4. Speech_State in the session reducer
  - [ ] 4.1 Fold speech in `sessionState.ts`
    - Files: `apps/web/src/lib/sessionState.ts`, `apps/web/src/lib/sessionState.test.ts`. No other file changes
    - Add `speech: SpeechState | null` and `speechLastTime: number | null` to `SessionUiState`, both `null` initially and on `caseLoaded` and `forkSucceeded`. In `onSample`, after `stepEnding`, apply the step of the design section "`sessionState.ts`" (finite time, greater than `speechLastTime`, current Branch and case known, gate from `state.endingCtx.rescueGateTime`). No other action reads or writes the two fields
    - Unit tests: speech steps after the Ending on the same sample (`rescued` line in the Ending's sample); `forkSucceeded` resets both fields and the first new-Branch sample gives a fresh state; a fork failure dispatches nothing and leaves speech unchanged; a non-increasing or non-finite sample is not folded; `viewSelected` and `playbackChanged` return the same `speech` object
    - Existing reducer tests stay green; update only fixtures that build a full `SessionUiState` by hand, if `tsc` requires the new fields
    - Verify: from `apps/web/`, `npx tsc --noEmit` and `npx vitest --run` pass; `git status --short services/physiology/` prints nothing
    - _Requirements: 5.5, 5.6, 5.7, 5.8, 5.9_
  - [ ] 4.2 Write the property test for the reducer fold
    - **Property 3: The speech fold is deterministic and ignores non-sample actions**
    - Files: `apps/web/src/lib/sessionState.test.ts`. No other file changes
    - Use `PBT_PARAMS`. Tag: `// Feature: patient-speech, Property 3: The speech fold is deterministic and ignores non-sample actions`
    - Verify: from `apps/web/`, `npx tsc --noEmit` and `npx vitest --run` pass; `git status --short services/physiology/` prints nothing
    - **Validates: Requirements 4.1, 4.6, 5.7, 5.8, 5.9**

- [ ] 5. Speech_Provider seam
  - [ ] 5.1 Implement `speechProvider.ts` and `speechGate.ts`
    - Files: `apps/web/src/lib/speechProvider.ts` (new), `apps/web/src/lib/speechGate.ts` (new). No other file changes
    - `speechProvider.ts`: `SpeechContext`, `SpeechProvider`, `scriptedSpeechProvider` and `buildSpeechContext(state)` (newest 5 or fewer Active_Interventions and Active_Exam_Entries; `null` before the case and the current Branch are known), as the design states
    - `speechGate.ts`: `PROVIDER_TIMEOUT_MS = 5000`, `SpeechClock` and `createSpeechGate` with the six steps of `request` (abort the previous request, show the checked Scripted_Line synchronously, time out after 5 s, treat a synchronous throw as a rejection, discard Stale_Results, then `null`/`undefined` silences, passing text shows, anything else keeps the fallback) and `dispose`. No error message, no logging
    - No setting, environment variable, API key, network call or new dependency
    - Verify: from `apps/web/`, `npx tsc --noEmit` and `npx vitest --run` pass; `git status --short services/physiology/` prints nothing
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 6.10, 6.11, 11.3_
  - [ ] 5.2 Write the gate unit tests
    - Files: `apps/web/src/lib/speechGate.test.ts` (new). No other file changes
    - With `FakeClock` from `src/test/fakeClock.ts`, provider test doubles defined in the test file and `vi.spyOn(globalThis, 'fetch')`: valid text; `null` and `undefined`; text failing each rule (a) to (f); reject; synchronous throw; resolution after 5 s; resolution after a Branch change, after an Ending change and after a newer request; the previous signal is aborted on a new request; `dispose` aborts and clears the timer; the Scripted_Speech_Provider shows the checked Scripted_Line, and `null` for a failing line; `fetch` is never called
    - Verify: from `apps/web/`, `npx tsc --noEmit` and `npx vitest --run` pass; `git status --short services/physiology/` prints nothing
    - _Requirements: 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 6.11, 12.5_
  - [ ] 5.3 Write the property test for the gate
    - **Property 7: The Displayed_Speech is never stale, late or unchecked**
    - Files: `apps/web/src/test/generators.ts`, `apps/web/src/lib/speechGate.test.ts`. No other file changes
    - Add `arbProviderOutcome` to `generators.ts`. Use `PBT_PARAMS`. Tag: `// Feature: patient-speech, Property 7: The Displayed_Speech is never stale, late or unchecked`
    - Verify: from `apps/web/`, `npx tsc --noEmit` and `npx vitest --run` pass; `git status --short services/physiology/` prints nothing
    - **Validates: Requirements 6.5, 6.6, 6.7, 6.8, 6.9, 6.11**

- [ ] 6. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.
  - From `apps/web/`, `npx tsc --noEmit` and `npx vitest --run` pass; `git status --short services/physiology/` prints nothing

- [ ] 7. Showing speech
  - [ ] 7.1 Add `SpeechLiveRegion` and wire the gate into the session hook
    - Files: `apps/web/src/components/SpeechLiveRegion.tsx` (new), `apps/web/src/hooks/useSimulationSession.ts`, `apps/web/src/hooks/useSimulationSession.test.ts` (only if existing assertions on the returned object need the new field). No other file changes
    - `SpeechLiveRegion` exactly as the design states (`data-part="speech-live"`, `sr-only`, `aria-live="polite"`, `aria-atomic="true"`, `fillAfterMount`)
    - In the hook: one `SpeechGate` created on mount with `scriptedSpeechProvider` and disposed on unmount, `displayedSpeech` state, `onDisplay` guarded by the mounted flag, and one effect keyed on `speechRequestKey(state.currentBranchId, state.speech)` that calls `gate.request(buildSpeechContext(stateRef.current))`. `SimulationSession` gains `speech: string | null`. The hook signature does not change and no option selects a provider
    - Verify: from `apps/web/`, `npx tsc --noEmit` and `npx vitest --run` pass; `git status --short services/physiology/` prints nothing
    - _Requirements: 5.6, 5.9, 6.3, 6.4, 6.5, 6.10, 7.5_
  - [ ] 7.2 Show speech in the Play_View and on the rescued Ending_Screen
    - Files: `apps/web/src/components/PlayView.tsx`, `apps/web/src/components/EndingScreen.tsx`, `apps/web/src/components/PlayView.test.tsx`, `apps/web/src/components/EndingScreen.test.tsx`, and every other file that builds a PlayView `sim` (find them with a search for `<PlayView`; at least `SessionScreen.tsx` and `sideSymmetry.test.tsx`, where tests pass `speech: checkedScriptedLine(state.speech, state.caseData)`). No other file changes
    - `PlayView.tsx`: `sim` gains `speech`; the Avatar gets `speech={sim.speech ?? undefined}` with its `statusSentence` unchanged; a `SpeechLiveRegion` after the `exam-live` region while the Ending is `none`; `EndingScreen` gets `speech={sim.speech}`
    - `EndingScreen.tsx`: the optional `speech` prop, `showSpeech` only for `rescued` with non-blank text, the rescued layout of design D10 and "Layout" (no negative margin, overhead plus `SPEECH_BAND_HEIGHT`, widened bubble selector), `SpeechLiveRegion text={showSpeech ? speech : null} fillAfterMount` as the last child of the dialog container, and the file comment "never shows speech" replaced. The `lost` screen markup and style stay exactly as today
    - Tests (static markup): the bubble shows the Displayed_Speech; no bubble for `null`; exactly one `data-part="speech-live"` region holding the text or empty; the same markup for a repeated sample and new content for a changed line; the Ending_Screen region is inside the `role="dialog"` element and empty in static markup; no bubble and an unchanged Avatar wrapper style on the `lost` screen; the rescued screen with speech contains the bubble and no negative margin; the Avatar `aria-label` equals the Status_Sentence; a session without `play.speech` renders no bubble
    - Verify: from `apps/web/`, `npx tsc --noEmit` and `npx vitest --run` pass; `git status --short services/physiology/` prints nothing
    - _Requirements: 4.8, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.9, 11.7, 12.6_
  - [ ] 7.3 Test that the Clinician_View does not change
    - Files: `apps/web/src/components/ClinicianView.test.tsx`. No other file changes; `ClinicianView.tsx` does not change
    - The Clinician_View renders equal markup for a case with and without `play.speech`, and contains no `speech-bubble` and no `speech-live` part
    - Verify: from `apps/web/`, `npx tsc --noEmit` and `npx vitest --run` pass; `git status --short services/physiology/` prints nothing
    - _Requirements: 7.8, 12.6_
  - [ ] 7.4 Extend the screen symmetry property test with speech
    - **Property 9: Screen symmetry holds with speech (extends bedside-exam Property 17)**
    - Files: `apps/web/src/components/sideSymmetry.test.tsx`. No other file changes
    - Sample times of the generator cross the insult time and the hold; the PlayView `speech` comes from `checkedScriptedLine(state.speech, state.caseData)`; the markup compared includes the bubble and the speech live region. Use `PBT_PARAMS`. Tag: `// Feature: patient-speech, Property 9: Screen symmetry holds with speech`
    - Verify: from `apps/web/`, `npx tsc --noEmit` and `npx vitest --run` pass; `git status --short services/physiology/` prints nothing
    - **Validates: Requirements 8.4**

- [ ] 8. Speech in the calibration output
  - [ ] 8.1 Add speech values to the Scenario_Result
    - Files: `apps/web/src/lib/calibration.ts`, `apps/web/src/lib/engineRunner.ts`, `apps/web/src/lib/engineTools.ts`, `apps/web/src/lib/calibration.test.ts`, `apps/web/src/lib/engineRunner.test.ts`, `apps/web/src/lib/engineTools.test.ts`. No other file changes
    - `calibration.ts`: `OutcomeFold.gateAt` and `ScenarioOutcome.gateAt`, the gate after the entries for each mark and before `stepEnding`. No existing field changes
    - `engineRunner.ts`: `MarkRow.speech` and `MarkRow.speech_key` from `foldSpeech` over the marks with `endingAfter[i]` and `gateAt[i]`, `recordKey` mapping `status:<s>` to `play.status.rules[<i>]` (first rule with that sentence), and `ScenarioResult.has_speech_section`
    - `engineTools.ts`: the zod fields `speech`, `speech_key` and `has_speech_section`
    - Tests with fixed Mark_Samples: the expected `speech` and `speech_key` per row; `gateAt` per mark; `has_speech_section` true and false; the zod schemas accept the new fields. Existing tests keep their assertions, adding only the new fields where a test compares whole rows
    - Verify: from `apps/web/`, `npx tsc --noEmit` and `npx vitest --run` pass; `git status --short services/physiology/` prints nothing
    - _Requirements: 9.1, 9.5, 12.8_
  - [ ] 8.2 Add the speech table to the Record_Body
    - Files: `apps/web/src/lib/calibrationRecord.ts`, `apps/web/src/lib/calibrationRecord.test.ts`. No other file changes
    - `speechChanges(marks)` and the `#### Speech` table after "Status_Rules" in `scenarioSection`, with the fixed sentence of 9.3 under it; `Speech: none (the case has no speech section)` when `has_speech_section` is false; lines through the existing `cell()` escaping. No Calibration_Check or other block reads the speech fields
    - Tests: the table for fixed rows, the fixed sentence, the `Speech: none ...` line, a line with a `|` escaped; existing record tests stay green
    - Verify: from `apps/web/`, `npx tsc --noEmit` and `npx vitest --run` pass; `git status --short services/physiology/` prints nothing
    - _Requirements: 9.2, 9.3, 9.4, 9.5, 12.8_
  - [ ] 8.3 Write the property test for the speech table
    - **Property 8: The speech table compresses the per-mark speech without loss**
    - Files: `apps/web/src/lib/calibrationRecord.test.ts`. No other file changes
    - Use `PBT_PARAMS`. Tag: `// Feature: patient-speech, Property 8: The speech table compresses the per-mark speech without loss`
    - Verify: from `apps/web/`, `npx tsc --noEmit` and `npx vitest --run` pass; `git status --short services/physiology/` prints nothing
    - **Validates: Requirements 9.2**

- [ ] 9. Add the four pointer lines to the older specs
  - Files: `.kiro/specs/bedside-exam/requirements.md`, `.kiro/specs/play-mode/requirements.md`, `.kiro/specs/engine-mcp/requirements.md`. Doc-only; no other file and no other line changes
  - Add exactly the four lines of Requirements 10.1 to 10.4, copied character for character (including the leading spaces), directly under bedside-exam 10.8, the play-mode glossary entry **Speech_Bubble_Slot**, engine-mcp 5.1 and engine-mcp 9.4
  - Run `git diff --stat` and `git diff` on the three files and quote them: four added lines, nothing removed or changed
  - Verify: from `apps/web/`, `npx tsc --noEmit` and `npx vitest --run` pass; `git status --short services/physiology/` prints nothing
  - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5_

- [ ] 10. Final check before the calibration run
  - Ensure all tests pass, ask the user if questions arise.
  - From `apps/web/`, `npx tsc --noEmit` and `npx vitest --run` pass; `git status --short services/physiology/` prints nothing
  - `git diff --numstat cases/adult-tension-pneumothorax.yaml` (against the commit before task 2.1, if the user has committed since) shows 0 deleted lines, and `grep -c "TODO(author)"` on the case file is the earlier count plus the added speech markers
  - `apps/web/package.json` is unchanged (`git diff --stat apps/web/package.json` against the commit before task 1.1 prints nothing)
  - Ask the user to commit all changes of this spec before task 11, because task 11 compares the Engine_MCP_Server start time with the last code commit, and the Calibration_Record states whether `cases/` and `apps/web/src/lib/` differ from the commit. Do not commit
  - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5_

- [ ] 11. Record the calibration with speech
  - Files: one new Calibration_Record under `docs/calibration/` and its index line in `docs/calibration/README.md`, both written by the calibration writer. No other file changes. Edit no case value because of the result and remove no `TODO(author)` marker
  - Before starting, confirm with `git status --short` that the user has committed the code of this spec. If not, ask the user to commit first. Do not commit
  - Decide the run path as the design section "Calibration run path" states, and report both times:
    - last code commit time: `git log -1 --format=%cI -- apps/web/src apps/web/scripts cases scripts`
    - MCP server process: `pgrep -f scripts/engineMcp.ts`, then `ps -o lstart= -p <pid>`
    - use the MCP tool `run_calibration` only when a process exists, the `stitched-patient-engine` tools respond (`list_cases`) and the process started after the commit time. In every other case (the default) use the Engine_CLI
  - The Physiology_Service must already run. Check it first (for example the Engine_CLI `list-cases` command from `apps/web/`). If it is not reachable, stop and ask the user to start it in their own terminal. Never start, stop or restart it, and never run `docker compose up`, `down`, `stop` or `restart`
  - Engine_CLI path, from `apps/web/`, each through execute_bash with a timeout of at least 1,800,000 ms:
    - `./node_modules/.bin/vite-node --config vitest.config.ts scripts/engineCli.ts -- calibrate --case adult-tension-pneumothorax` (without `--write`)
    - then exactly once: `./node_modules/.bin/vite-node --config vitest.config.ts scripts/engineCli.ts -- calibrate --case adult-tension-pneumothorax --write`
    - if a run reports a timeout, read its output before doing anything else, and do not start a second `--write` run. If the run needs longer than 30 minutes, ask the user to run it in their own terminal
  - MCP path: `run_calibration` for `adult-tension-pneumothorax` without writing, then once with writing; Kiro asks the user to approve each call
  - Check that every Scenario of the new record has `has_speech_section` true (this also shows that the Case_API returned the Speech_Section unchanged, 1.6) and a speech table followed by the fixed sentence of 9.3
  - Report: the path used and why, both times, the CLI exit code (or the tool result status), the record path and the index line, and the speech table of each of the eight Scenarios of the new Calibration_Record
  - Verify: from `apps/web/`, `npx tsc --noEmit` and `npx vitest --run` pass; `git status --short services/physiology/` prints nothing
  - _Requirements: 1.6, 9.1, 9.2, 9.3, 9.6, 9.7_

## Notes

- No task is optional. Property tests 1 to 9 are required sub-tasks placed right after the code they test
- No task commits. Task 10 asks the user to commit before task 11, because the run-path check in task 11 compares the MCP server start time with the last code commit, and the record names the commit
- The Engine_CLI is the default path for task 11. Requirement 9.6 says the Engine_MCP_Server counts as disconnected unless its process started after the last code commit of this spec, because it loads `apps/web/src/lib/` when it starts
- Saving a file under `cases/` triggers the `case-check` hook; saving a `.ts` or `.tsx` file under `apps/web/src/` triggers `web-related-tests`. Read their output, but the checks listed in each task are still required
- The `case-check` commands of task 2.2 run in a one-off physiology container from the prebuilt image `stitched-patient-physiology`, never with the host Python. If the image is missing, ask the user to build it in their own terminal
- The web suite needs neither the Physiology_Service nor Pulse and opens no HTTP or WebSocket connection (11.5). Only task 11 needs the running service
- Web property tests use `PBT_PARAMS` from `src/test/pbt.ts` (seed 20261031, 100 runs) and the tag `// Feature: patient-speech, Property <n>: <title>`
- Manual acceptance checks of the design (200-character bubble at 1280 × 720, rescued Ending_Screen layout, VoiceOver) are for the author and the user and are not tasks here (7.3, 7.6, 7.7, 7.10)
- If execute_bash reports a timeout, read the output before retrying. The command may have finished

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "2.1"] },
    { "id": 2, "tasks": ["1.3", "2.2"] },
    { "id": 3, "tasks": ["2.3", "3.1"] },
    { "id": 4, "tasks": ["3.2", "4.1"] },
    { "id": 5, "tasks": ["3.3", "5.1"] },
    { "id": 6, "tasks": ["3.4", "5.2"] },
    { "id": 7, "tasks": ["3.5", "4.2"] },
    { "id": 8, "tasks": ["3.6", "5.3"] },
    { "id": 9, "tasks": ["6"] },
    { "id": 10, "tasks": ["7.1"] },
    { "id": 11, "tasks": ["7.2"] },
    { "id": 12, "tasks": ["7.3", "7.4", "8.1"] },
    { "id": 13, "tasks": ["8.2"] },
    { "id": 14, "tasks": ["8.3", "9"] },
    { "id": 15, "tasks": ["10"] },
    { "id": 16, "tasks": ["11"] }
  ]
}
```
