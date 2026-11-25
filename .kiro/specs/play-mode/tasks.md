# Implementation Plan: Play Mode

## Overview

This plan implements Play mode: a second, plain-language view of the same Session with a cartoon stitched patient, a status sentence, a goal with an ending, up to three hints, plain intervention labels and a Rewind button. The existing bedside monitor becomes the Clinician view. Both views share one client-side session state.

The approach follows dependency order: test tooling and types → Alarm_Function change → pure logic modules in `apps/web/src/lib/` → API timeouts → case schema and case file → session reducer and hook → shared shell and Clinician view → Play components → wiring the Play view and the session page → calibration script and run → manual acceptance checklist → final check. Every code task includes its own unit and property tests. Property numbers refer to the "Correctness Properties" section of `design.md`.

Nothing under `services/physiology/`, `docker-compose.yml` or `.kiro/specs/core-simulation-loop/` changes in this plan.

## Tasks

- [x] 1. Set up web test tooling and shared types
  - [x] 1.1 Add test dependencies, Vitest config and shared property-test settings
    - From `apps/web/`, run `npm install --save-dev fast-check@^3 yaml@^2`. These are the only new dependencies the design names (`vite-node` ships with Vitest, `react-dom/server` is already a dependency)
    - This creates `apps/web/package-lock.json`, which does not exist today. Keep the lockfile and commit it with this change. Do not delete it or add it to `.gitignore`. The web Dockerfile's `npm ci` and the core spec's deployment work rely on it
    - Create `apps/web/vitest.config.ts`: `environment: 'node'`, `include: ['src/**/*.test.ts', 'src/**/*.test.tsx']`, `resolve.alias` `@` → `./src`, `esbuild: { jsx: 'automatic' }`. `scripts/` stays outside `include`
    - Add `"test:run": "vitest --run"` to `apps/web/package.json` scripts. Keep the existing `"test": "vitest"`
    - Create `apps/web/src/test/pbt.ts` exporting `PBT_PARAMS = { seed: 20261031, numRuns: 100 }`
    - Create `apps/web/src/test/pbt.test.ts`: asserts the `PBT_PARAMS` values and runs one trivial `fc.assert` with them, so the suite has a test file from the start
    - Run `npx tsc --noEmit` from `apps/web/` and record the result as the baseline. Report any errors that existed before this task; do not fix them here
    - Confirm `git status` lists `apps/web/package-lock.json` as a new file
    - Run from `apps/web/`: `npx vitest --run 2>&1 | tee /tmp/sp-vitest.log`
    - Quote the Vitest summary line (passed/failed/skipped) in the task report
    - _Requirements: 12.10, 12.11_

  - [x] 1.2 Add Play types and the vital name helper
    - In `apps/web/src/types/index.ts`, add the types from the design's "Data Models" section: `Side`, `ComparisonOp`, `VitalCondition`, `ConditionGroup`, `StatusWhen`, `StatusRule`, `Hint`, `PlaySection`, `ScheduledInsult`, `AvatarParameters`, `InterventionRecordEntry`, `HintRecordEntry`, `LineageSegment`, `RewindMoment`. Extend `Intervention` with optional `playLabel`, and `CaseData` with `timeline` and optional `play`. Do not change `AlarmThreshold` here (task 2.1 does)
    - Create `apps/web/src/lib/vitals.ts` with `VITAL_NAMES`, `VitalName`, `VITAL_FIELD` and `readVital` as in the design. `readVital` returns `undefined` for a missing sample, a missing field, `null`, `NaN` and ±Infinity
    - Create `apps/web/src/lib/vitals.test.ts`: every case vital name maps to the VitalSigns field in the design table; `readVital` returns the number for finite values (including 0 and negatives) and `undefined` for each non-finite or missing case
    - Run `npx tsc --noEmit` from `apps/web/`; no new errors compared with the 1.1 baseline
    - Run from `apps/web/`: `npx vitest --run 2>&1 | tee /tmp/sp-vitest.log`
    - Quote the Vitest summary line (passed/failed/skipped) in the task report
    - _Requirements: 4.25, 5.4, 6.15, 6.16_

- [x] 2. Implement alarm band semantics
  - [x] 2.1 Rewrite the Alarm_Function in `apps/web/src/lib/alarms.ts`
    - This spec owns `alarms.ts`. Keep this task one small change: `alarms.ts`, its new test file, the `AlarmThreshold` type and the shared test helpers below. The core-simulation-loop session rebases onto it
    - Rewrite `getAlarmState` as in the design's "Alarm_Function change": `critical` when strictly beyond a present critical bound; otherwise `warning` when strictly outside a present `normal` or `warning` bound; otherwise `normal`. Each absent object or bound is skipped. `getAlarmColor` and `getAlarmBgColor` stay unchanged
    - Make `AlarmThreshold.normal` optional in `src/types/index.ts`. Fix any existing reader of `threshold.normal` that no longer type-checks, without changing its behaviour
    - Create `apps/web/src/test/caseFixtures.ts`: loads `cases/adult-tension-pneumothorax.yaml` with the `yaml` package (path resolved from the test file) and exports the parsed case and `VITAL_OFFSETS` from the design's "Per-vital test offsets" table
    - Create `apps/web/src/test/generators.ts` with `arbThreshold` as the design describes (each of `critical`, `warning`, `normal` and each bound present or absent; values from a small grid so equal and crossing bounds occur)
    - Create `apps/web/src/lib/alarms.test.ts`:
      - for each vital with thresholds in the case file and each present `low` and `high` bound of `normal`, `warning` and `critical`: the value exactly at the bound, just inside and just outside it by the per-vital offset, with expected results from Requirement 15.1 to 15.4
      - each offset is smaller than half the smallest gap between distinct boundaries of that vital; the failure message names the vital
      - threshold objects that omit a `low` bound, a `high` bound and a whole `warning` object
      - the six baseline vitals (HR 72, RR 12, SpO2 0.974, MAP 95, EtCO2 36, TV 535) are `normal` against the case thresholds
      - the design's before/after examples: SpO2 0.93, HR 110 and MAP 105 are `warning`; RR 12 is `normal`
      - **Property 1: Alarm_Function matches the band specification** (`arbThreshold` × finite values, deep-frozen thresholds, called twice). Tag: `// Feature: play-mode, Property 1: Alarm_Function matches the band specification`
    - Run `npx tsc --noEmit` from `apps/web/`; no new errors compared with the 1.1 baseline
    - Run from `apps/web/`: `npx vitest --run 2>&1 | tee /tmp/sp-vitest.log`
    - Quote the Vitest summary line (passed/failed/skipped) in the task report
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 15.7, 15.8, 15.9, 15.10, 15.11, 15.12, 1.7_
    - _Properties: 1_

  - [x] 2.2 Implement `apps/web/src/lib/vitalBands.ts`
    - `getVitalBand`, `thresholdsFor` and `overallStatus` as in the design, including the tie rule (`low` wins for a malformed threshold that a value crosses on both sides)
    - Create `apps/web/src/lib/vitalBands.test.ts`:
      - for each vital with thresholds in the case file: state equals `getAlarmState` and direction is `none` exactly when the state is `normal`, at each boundary, at each boundary ± the per-vital offset, and at no fewer than 100 evenly spaced values from 50% of the lowest boundary to 150% of the highest
      - `overallStatus` returns the most severe state and `normal` for an empty map
      - **Property 2: Vital_Band agrees with the Alarm_Function**. Tag: `// Feature: play-mode, Property 2: Vital_Band agrees with the Alarm_Function`
    - Run from `apps/web/`: `npx vitest --run 2>&1 | tee /tmp/sp-vitest.log`
    - Quote the Vitest summary line (passed/failed/skipped) in the task report
    - _Requirements: 4.1, 4.2, 4.19, 12.6, 15.7_
    - _Properties: 2_

- [x] 3. Implement Avatar and status logic
  - [x] 3.1 Implement `apps/web/src/lib/sides.ts`
    - `computeSides`, `viewerHalf` and `sideGeometry` as in the design. Results are sorted in `['Left', 'Right']` order without duplicates. `sideGeometry('Left')` lies in x `[100, 200]` and `sideGeometry('Right')` in x `[0, 100]` of the 200 × 280 viewBox; each swollen chest rectangle is wider and taller than the normal one on the same side and stays in the same half
    - Add `arbInsults` and `arbActiveInterventions` to `src/test/generators.ts`
    - Create `apps/web/src/lib/sides.test.ts`:
      - a Left `SETensionPneumothorax` insult adds `Left` to Swollen_Sides at and after `timeSeconds`, not before
      - a Left Decompression removes `Left` from Swollen_Sides and adds it to Decompressed_Sides
      - a Right Decompression with an untreated Left insult keeps `Left` swollen and adds `Right` to Decompressed_Sides
      - a Left Decompression earlier than the Left insult keeps `Left` swollen once the insult is applied (Requirement 4.18 as written)
      - `viewerHalf('Left')` is `viewerRight` and `viewerHalf('Right')` is `viewerLeft`; geometry halves and swollen sizes as above
      - **Property 6: Swollen and decompressed sides follow insults and Decompressions**. Tag: `// Feature: play-mode, Property 6: Swollen and decompressed sides follow insults and Decompressions`
    - Run from `apps/web/`: `npx vitest --run 2>&1 | tee /tmp/sp-vitest.log`
    - Quote the Vitest summary line (passed/failed/skipped) in the task report
    - _Requirements: 3.7, 4.13, 4.14, 4.16, 4.17, 4.18, 4.23, 12.2_
    - _Properties: 6_

  - [x] 3.2 Implement `apps/web/src/lib/avatarMapper.ts`
    - Export the UI constants `BREATH_DEPTH_MIN` (0.25), `BREATH_DEPTH_MAX` (1.75), `BREATH_DEPTH_DEFAULT` (1.0), `DEFAULT_BREATH_PERIOD_S` (4) and `DEFAULT_BEAT_PERIOD_S` (1). These are display constants, not clinical values
    - Implement `mapAvatar(input: AvatarInput)` with the rules table in the design: bands, Skin_Tone, breathing period and stopped flag, breathing depth (reference tidal volume, else first positive tidal volume, else default; clamped), heartbeat, sweat flag, sides through `computeSides`, Overall_Status. Missing or non-finite vitals keep the previous value or the default. The function has no Playback_Speed input
    - Add `arbSample` (each vital present, absent, `NaN`, ±Infinity, zero, negative or near a boundary) and `arbAvatarParameters` to `src/test/generators.ts`
    - Create `apps/web/src/lib/avatarMapper.test.ts` with fixed inputs from the case thresholds:
      - Skin_Tone `healthy`, `pale` and `cyanotic` for SpO2 in `normal`, `warning` and `critical`
      - breathing period 60 / RR and heartbeat period 60 / HR; the mapper has no speed input, so the test states that the same output holds at 1x, 2x and 4x
      - breathing stopped at RR 0 and heartbeat stopped at HR 0
      - sweat true for MAP `warning`, MAP `critical`, and HR `critical` with MAP `normal`; false for MAP `normal` with HR `normal` and with HR `warning`
      - depth below, inside and above the display range (clamped to the nearest bound); depth from `referenceTidalVolumeMl`, and from the first positive tidal volume when the Play_Section has none; default while no reference exists
      - samples without `systolic_pressure` and `diastolic_pressure`, and samples missing one case vital, return without throwing and keep the previous values
      - **Property 3: Avatar fields follow their vital bands and rates**. Tag: `// Feature: play-mode, Property 3: Avatar fields follow their vital bands and rates`
      - **Property 4: Avatar_Mapper determinism**. Tag: `// Feature: play-mode, Property 4: Avatar_Mapper determinism`
      - **Property 5: Missing vitals keep the previous values**. Tag: `// Feature: play-mode, Property 5: Missing vitals keep the previous values`
    - Run from `apps/web/`: `npx vitest --run 2>&1 | tee /tmp/sp-vitest.log`
    - Quote the Vitest summary line (passed/failed/skipped) in the task report
    - _Requirements: 4.1, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10, 4.11, 4.12, 4.13, 4.15, 4.19, 4.22, 4.24, 4.25, 12.1, 12.13, 12.14_
    - _Properties: 3, 4, 5_

  - [x] 3.3 Implement `apps/web/src/lib/statusSelector.ts`
    - `selectStatus(sample, alarms, play)` as in the design: `defaultSentence` for a `null` sample; rules in Case_Definition order; an item matches only when the vital has thresholds and a finite value, the band state equals `band`, and `direction` is absent or equal; first matching rule's sentence unchanged; else `defaultSentence`
    - Add `arbPlaySection` (status part: 0 to 20 rules with 1 to 6 `when` items and optional directions, never on `normal`) to `src/test/generators.ts`
    - Create `apps/web/src/lib/statusSelector.test.ts`:
      - two matching rules return the first in order
      - a rule with two or more `when` items does not match when only some match
      - an item without `direction` matches both `low` and `high`
      - no match and an empty `rules` array return `defaultSentence`; a `null` sample returns `defaultSentence`
      - a missing vital and a vital without thresholds make the item not match; samples without systolic and diastolic pressure return without throwing
      - **Property 10: Status_Selector returns the first matching case sentence** (with an independent reference matcher in the test). Tag: `// Feature: play-mode, Property 10: Status_Selector returns the first matching case sentence`
      - **Property 11: Status_Selector determinism**. Tag: `// Feature: play-mode, Property 11: Status_Selector determinism`
    - Run from `apps/web/`: `npx vitest --run 2>&1 | tee /tmp/sp-vitest.log`
    - Quote the Vitest summary line (passed/failed/skipped) in the task report
    - _Requirements: 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 12.3, 12.14_
    - _Properties: 10, 11_

- [x] 4. Implement case helpers and Ending evaluation
  - [x] 4.1 Implement `apps/web/src/lib/playCase.ts`
    - `playButtonText(i)`: `playLabel` when it has a non-whitespace character, else `label`
    - `conditionsDisjoint(a, b)`: same vital and no number satisfies both, using the half-line rule in the design (strict operators at equal values make them disjoint; same-direction bounds are never disjoint)
    - `interventionSide(i)`: `parameters.side` when it is `'Left'` or `'Right'`, else `undefined`
    - Create `apps/web/src/lib/playCase.test.ts`:
      - `conditionsDisjoint` examples for every operator pair, at equal and different values, and for different vitals
      - `playButtonText` with a Play_Label, without one, with an empty one and with a whitespace-only one
      - `interventionSide` for both case Interventions and for an Intervention without parameters
      - **Property 15: Condition disjointness is exact** (dense test set: both thresholds, ±ε and their midpoint). Tag: `// Feature: play-mode, Property 15: Condition disjointness is exact`
      - **Property 18: Play button text falls back to the clinical label**. Tag: `// Feature: play-mode, Property 18: Play button text falls back to the clinical label`
    - Run from `apps/web/`: `npx vitest --run 2>&1 | tee /tmp/sp-vitest.log`
    - Quote the Vitest summary line (passed/failed/skipped) in the task report
    - _Requirements: 6.14, 8.2, 8.3, 8.4_
    - _Properties: 15, 18_

  - [x] 4.2 Implement `apps/web/src/lib/endingEvaluator.ts`
    - `buildEndingContext`, `initialEndingState`, `stepEnding`, `evaluateEnding` (defined as the fold of `stepEnding`) and `conditionHolds`, following the 7-step algorithm in the design. A missing `endings.lost.groups` counts as `[]`. Rescue wins over lost on the same sample. `endedAt` is set when the Ending leaves `none`
    - Extend `arbPlaySection` with endings (1 to 6 rescue conditions, 0 to 5 lost groups, optional Time_Limit, at least one group or a Time_Limit) and add `arbSampleSequence` (times mostly +1 s, with repeats, decreases and non-finite times) to `src/test/generators.ts`
    - Create `apps/web/src/lib/endingEvaluator.test.ts` with fixed sequences:
      - `none` for no samples, for no Play_Section and when no condition is met
      - a rescue stretch exactly `holdSeconds` long returns `rescued`; with its last sample removed it returns `none`
      - samples below the earliest insult time add no rescue hold time; `rescueFromTime` is 0 for a case without insults
      - for each lost group, a stretch exactly its `holdSeconds` returns `lost`
      - one failing sample restarts a stretch; equal and decreasing times add no hold time and break no stretch; a non-finite time is ignored
      - a sample exactly at `timeLimitSeconds` returns `lost`; one below returns `none`
      - one sample completing both rescue and lost returns `rescued`; rescue completing at the Time_Limit returns `rescued`
      - the Ending stays once set
      - a missing or non-finite vital makes its condition not held; samples without systolic and diastolic pressure return without throwing
      - **Property 12: Ending matches the reference model** (independent reference model written in the test). Tag: `// Feature: play-mode, Property 12: Ending matches the reference model`
      - **Property 13: The Ending is monotonic**. Tag: `// Feature: play-mode, Property 13: The Ending is monotonic`
      - **Property 14: Incremental evaluation equals batch evaluation** (arbitrary chunkings). Tag: `// Feature: play-mode, Property 14: Incremental evaluation equals batch evaluation`
    - Run from `apps/web/`: `npx vitest --run 2>&1 | tee /tmp/sp-vitest.log`
    - Quote the Vitest summary line (passed/failed/skipped) in the task report
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 6.10, 6.12, 6.13, 6.15, 6.16, 12.4, 12.14_
    - _Properties: 12, 13, 14_

- [x] 5. Implement time format, lineage, rewind selection and the Intervention_Record
  - [x] 5.1 Implement `apps/web/src/lib/timeFormat.ts`
    - `formatMSS(seconds)`: floor; minutes unpadded; seconds two digits; negative and non-finite give `"0:00"`
    - `remainingSeconds(limit, latest)`: `max(0, limit - (latest ?? 0))`
    - Create `apps/web/src/lib/timeFormat.test.ts`: `"0:00"` for 0, `"1:30"` for 90, `"10:05"` for 605, `"12:05"` for 725, fractional seconds floored, negative input; `remainingSeconds` with `null`, below, at and above the limit. Property 17 is tested in task 5.3
    - Run from `apps/web/`: `npx vitest --run 2>&1 | tee /tmp/sp-vitest.log`
    - Quote the Vitest summary line (passed/failed/skipped) in the task report
    - _Requirements: 5.15, 10.5, 12.5_

  - [x] 5.2 Implement `apps/web/src/lib/branchLineage.ts`
    - `buildLineage(branches, currentBranchId, checkpointsByBranch)` and `activeInterventions(record, lineage)` as in the design: fork time from the parent's Checkpoint named by `forked_from_checkpoint`, falling back to the child's earliest Checkpoint; the walk stops on a cycle or a missing parent; before Checkpoint lists load, the lineage is the current Branch alone; entries are kept with `simulationTime <= upperBound` in their original order
    - Add `arbLineage` (1 to 4 Branches in a parent chain, Checkpoints per Branch including the fork copy at the same time, Intervention_Record entries on those Branches) to `src/test/generators.ts`
    - Create `apps/web/src/lib/branchLineage.test.ts`:
      - fork-time lookup from the parent's list; fallback when the fork Checkpoint is missing; cycle and missing parent stop the walk
      - after a fork to a Checkpoint earlier than a Decompression, that entry is not active; an entry exactly at the fork time is active (`<=`)
      - entries on Branches outside the lineage are excluded
      - **Property 7: Active_Interventions are limited to the Branch_Lineage**. Tag: `// Feature: play-mode, Property 7: Active_Interventions are limited to the Branch_Lineage`
    - Run from `apps/web/`: `npx vitest --run 2>&1 | tee /tmp/sp-vitest.log`
    - Quote the Vitest summary line (passed/failed/skipped) in the task report
    - _Requirements: 4.15, 10.9, 12.2_
    - _Properties: 7_

  - [x] 5.3 Implement `apps/web/src/lib/rewindMoments.ts`
    - `selectRewindCheckpoints` with the 6 steps in the design (empty without a latest sample; eligibility below the latest sample time and below the Time_Limit; de-duplicate by `checkpoint_id`, then by equal `simulation_time` keeping the lowest depth; sort descending with stable ties; take 5; inclusion rule for the newest eligible Checkpoint older than the newest lineage entry). Export `MAX_REWIND_MOMENTS = 5`
    - `labelRewindMoment` with the three label rules of Requirement 10.5, using `formatMSS` and `playButtonText` (clinical `label` fallback)
    - Create `apps/web/src/lib/rewindMoments.test.ts`:
      - at most 5, newest first; only below the latest sample; only below `timeLimitSeconds`
      - the inclusion rule when the required Checkpoint is older than the 5 newest
      - the fork copy and its source at the same time appear once
      - empty result with no qualifying Checkpoint and with no sample
      - each label rule, including the clinical-label fallback; `"0:00 - at the start"`
      - **Property 16: Rewind selection invariants**. Tag: `// Feature: play-mode, Property 16: Rewind selection invariants`
      - **Property 17: Time labels and rewind labels follow the format rules**. Tag: `// Feature: play-mode, Property 17: Time labels and rewind labels follow the format rules`
    - Run from `apps/web/`: `npx vitest --run 2>&1 | tee /tmp/sp-vitest.log`
    - Quote the Vitest summary line (passed/failed/skipped) in the task report
    - _Requirements: 10.2, 10.3, 10.4, 10.5, 10.12, 10.13, 5.15, 12.5_
    - _Properties: 16, 17_

  - [x] 5.4 Implement `apps/web/src/lib/interventionRecord.ts`
    - `recordKey`, `serializeRecord` (`{"v":1,"entries":[...]}`), `parseRecord` (returns `[]` for `null`, bad JSON, a wrong version or any invalid entry), `loadRecord` and `saveRecord` (catch storage exceptions; save failures leave the in-memory record in use)
    - `buildInterventionEntry(intervention, simulationTime, branchId)`: `interventionId`, `action`, `side` from `interventionSide` (omitted when the Intervention has none), `simulationTime`, `branchId`
    - Create `apps/web/src/lib/interventionRecord.test.ts`:
      - the key contains the session_id
      - missing key, bad JSON, wrong version, one invalid entry among valid ones, and a storage object whose methods throw
      - `buildInterventionEntry` for the left and right case Interventions and for one without a side
      - **Property 19: Intervention_Record storage round trip**. Tag: `// Feature: play-mode, Property 19: Intervention_Record storage round trip`
    - Run from `apps/web/`: `npx vitest --run 2>&1 | tee /tmp/sp-vitest.log`
    - Quote the Vitest summary line (passed/failed/skipped) in the task report
    - _Requirements: 8.6, 8.12, 8.13, 8.14_
    - _Properties: 19_

- [x] 6. Add request timeouts to the API client
  - [x] 6.1 Add an optional per-request timeout to `apps/web/src/lib/api.ts`
    - `fetchApi` takes an optional `timeoutMs`, uses an `AbortController`, and throws `ApiError(0, 'timeout')` when the timer fires. Clear the timer on every path
    - `getCaseData`, `getSession`, `controlPlayback`, `applyIntervention`, `forkBranch` and `getCheckpoints` gain an optional trailing `{ timeoutMs }` argument. Existing callers keep working unchanged
    - Export the design's timeout constants: 10 s case, 10 s intervention, 30 s fork, 5 s playback, 10 s checkpoints
    - Create `apps/web/src/lib/api.test.ts` with `vi.stubGlobal('fetch', ...)` and fake timers (no real network): a response before the timeout resolves; no response within the timeout rejects with status 0 and message `timeout`; an error status still throws `ApiError` with that status; a call without `timeoutMs` never aborts; the request body for `applyIntervention` is unchanged
    - Run from `apps/web/`: `npx vitest --run 2>&1 | tee /tmp/sp-vitest.log`
    - Quote the Vitest summary line (passed/failed/skipped) in the task report
    - _Requirements: 1.11, 7.10, 8.8, 10.10, 11.13, 12.11_

- [x] 7. Add Play mode to the case schema and the case file
  - [x] 7.1 Extend `cases/case-schema.json`
    - Add the Draft-07 `definitions` from the design: `vitalName`, `citationList`, `vitalCondition` (with the SpO2 `maximum: 1` rule), `conditionGroup`, `statusWhen` (no `direction` on a `normal` band)
    - Add the optional top-level `play` object exactly as in the design, with `additionalProperties: false` on `play` and every object nested in it, and the `anyOf` on `endings.lost` (at least one group or a `timeLimitSeconds`)
    - Add the optional `playLabel` (1 to 80 characters) to the Intervention item, and the `allOf` / `if` / `then` rule restricting `SENeedleDecompression` `parameters.side` to `"Left"` / `"Right"` and `parameters.state` to `"On"` / `"Off"`. Intervention items keep `additionalProperties` open
    - Validate with the existing tools inside the physiology image (Python dependencies are not installed on the host). Build the image first only if it does not exist: `docker compose build physiology`. Run from the repository root:
      - valid case: `docker compose run --rm -v "$PWD/scripts:/check/scripts:ro" -v "$PWD/cases:/check/cases:ro" -w /check physiology python3 scripts/validate-case.py cases/adult-tension-pneumothorax.yaml` must print "Case file is valid" and exit 0
      - with the file tools, create `/tmp/sp-cases/case-schema.json` (copy of the new schema) and `/tmp/sp-cases/broken-state.yaml` (copy of the case with unquoted `state: On` in the left Intervention). Run the same validate command with `-v /tmp/sp-cases:/check/cases:ro` and `cases/broken-state.yaml`: it must exit non-zero and print `Path: interventions.0.parameters.state`
      - Case_Loader: `docker compose run --rm -v /tmp/sp-cases:/check/cases:ro physiology python3 -c "import pathlib, case_loader as c; c.CASES_DIR = pathlib.Path('/check/cases'); c.SCHEMA_PATH = c.CASES_DIR / 'case-schema.json'; c.load_case('broken-state')"` must raise `CaseLoadError`
    - Quote the output of each command in the task report. The `/tmp/sp-cases/` copies are not committed
    - Run from `apps/web/`: `npx vitest --run 2>&1 | tee /tmp/sp-vitest.log`
    - Quote the Vitest summary line (passed/failed/skipped) in the task report
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.11, 2.17, 2.18, 2.20, 9.10_

  - [x] 7.2 Add the draft Play_Section and Play_Labels to `cases/adult-tension-pneumothorax.yaml`, with case-content tests
    - The author is away. Use exactly the draft values below; do not choose or change any value. Every draft value gets its own `TODO(author)` comment, on the same line or the line directly above, that names what needs review and ends with the text `draft from engine runs on 2026-11-20 (commit 1e71454), pending author review`. Example: `# TODO(author): rescue SpO2 threshold - draft from engine runs on 2026-11-20 (commit 1e71454), pending author review`. Write one condition per line so each number has its own marker. Do not add a `play.references` field (no citation exists yet)
    - Interventions: add `playLabel: "Let the trapped air out - left side (needle)"` to `needle-decompression-left` and `playLabel: "Let the trapped air out - right side (needle)"` to `needle-decompression-right`. Leave every other existing field unchanged, including the quoted `state: "On"`
    - `play` section:
      - `goalText: "Keep him breathing until he's out of danger."`
      - `diagnosisTerms: ["pneumothorax", "tension"]`
      - `avatar.referenceTidalVolumeMl: 535` (the engine's baseline tidal volume)
      - `endings.rescued.conditions`: `{ vital: spO2, op: ">=", value: 0.95 }` and `{ vital: heartRate, op: "<=", value: 110 }`; `endings.rescued.holdSeconds: 30`
      - `endings.lost.groups`: one group with `{ vital: spO2, op: "<", value: 0.85 }` and `holdSeconds: 30`; `endings.lost.timeLimitSeconds: 600`
      - `hints`, in this order:
        1. `"Watch his chest. Does one side move differently from the other?"`
        2. `"The trouble is on his left side. On your screen, that's the right."`
        3. `'Press "Let the trapped air out - left side (needle)".'`
      - `status.rules`, in this order:
        1. `when: [{ vital: spO2, band: critical }]`, sentence `"His lips are turning blue and he is fighting for breath."`
        2. `when: [{ vital: spO2, band: warning }]`, sentence `"He looks pale and is struggling to breathe."`
        3. `when: [{ vital: heartRate, band: critical, direction: high }]`, sentence `"His heart is racing and he looks frightened."`
        4. `when: [{ vital: heartRate, band: warning, direction: high }]`, sentence `"His heart is beating fast and he looks uneasy."`
        5. `when: [{ vital: respiratoryRate, band: warning, direction: high }]`, sentence `"He is breathing faster than normal."`
        6. `when: [{ vital: meanArterialPressure, band: warning, direction: low }]`, sentence `"He looks clammy and a little faint."`
      - `status.defaultSentence: "He is breathing calmly and looks comfortable."`
    - Quote every `op` value (a plain `>=` starts a YAML block scalar) and every string. Use no unquoted value that YAML 1.1 reads as a boolean
    - Engine basis, for reference only (used by task 12.3): with a left Decompression at t=150 the engine reached SpO2 0.953 at t=180, and HR 102.5 with SpO2 0.967 at t=210; untreated SpO2 was 0.855 at t=300 and still falling. The drafts predict rescue near t=230 and loss near t=340
    - Create `apps/web/src/lib/caseContent.test.ts`, reading the case with `yaml` `parseDocument` and a `LineCounter`:
      - the Play_Section exists; every check fails, not passes empty, when it is missing
      - no `rules[].sentence` or `defaultSentence` contains a Diagnosis_Term (case-insensitive substring); the failure names the sentence
      - `diagnosisTerms` contains "pneumothorax" and "tension"
      - each Lost_Condition group shares a vital with the Rescue_Condition whose conditions are disjoint by `conditionsDisjoint`; the failure names the group
      - exactly 3 Hints; Hints 1 and 2 contain no Intervention `label` or `playLabel` (case-insensitive); the last Hint contains the left Play_Label; failures name the Hint text
      - each Play_Label differs from its `label` and contains "left" or "right" matching its `side`
      - every number in the Play_Section, every Hint `text`, every Status_Rule `sentence` and the `defaultSentence` has a comment containing `TODO(author)` on its source line or the line directly above, unless the covering `references` array (Requirement 2.15) is non-empty; the failure names the field path
    - Validate, from the repository root: `docker compose run --rm -v "$PWD/scripts:/check/scripts:ro" -v "$PWD/cases:/check/cases:ro" -w /check physiology python3 scripts/validate-case.py cases/adult-tension-pneumothorax.yaml` must exit 0
    - With the file tools, refresh `/tmp/sp-cases/case-schema.json` and create one broken copy of the new case per rule: an extra property inside `play`, four Hints, an SpO2 `value` of 1.2, a `direction` on a `normal` band, and `endings.lost` with neither groups nor `timeLimitSeconds`. Each must make `validate-case.py` exit non-zero and print the field path. Quote the outputs. The copies are not committed
    - Run from `apps/web/`: `npx vitest --run 2>&1 | tee /tmp/sp-vitest.log`
    - Quote the Vitest summary line (passed/failed/skipped) in the task report
    - _Requirements: 2.12, 2.14, 2.15, 2.16, 2.17, 2.19, 5.9, 5.10, 6.14, 9.7, 9.8, 12.7, 12.8, 12.9, 13.10_

- [x] 8. Implement session state and the session hook
  - [x] 8.1 Implement the session reducer core in `apps/web/src/lib/sessionState.ts`
    - Define `View`, `SessionUiState`, `SessionAction`, `initialSessionState()` and `sessionReducer` as in the design. Export `HISTORY_LIMIT = 300` and `STALE_TOLERANCE_S = 5`
    - Implement these transitions: `caseLoaded` (stored view if the case has a Play_Section, `clinician` without one, else `play`; builds `endingCtx`), `caseFailed` (`clinician`, session/branch/connection fields untouched), `sessionLoaded`, `checkpointsLoaded` (recompute lineage), `connectionChanged`, `sampleReceived` (stale guard, history capped at 300, first positive tidal volume, `mapAvatar` with the previous parameters, `stepEnding`, `endingSnapshot` when the Ending leaves `none`), `viewSelected`, `playbackChanged`
    - Create `apps/web/src/lib/sessionState.test.ts`:
      - view choice on `caseLoaded` for: Play_Section and no stored view; Play_Section and stored `clinician`; no Play_Section with a stored `play`
      - `caseFailed` keeps session, branch and connection
      - the stale guard drops an old-Branch sample above `forkTime + 5` before the first accepted sample, then disarms
      - history stays at 300 after 400 samples while the Ending state equals `evaluateEnding` over all 400
      - `endingSnapshot` equals the Avatar of the sample at which the Ending changed
    - Run from `apps/web/`: `npx vitest --run 2>&1 | tee /tmp/sp-vitest.log`
    - Quote the Vitest summary line (passed/failed/skipped) in the task report
    - _Requirements: 1.1, 1.2, 1.4, 1.9, 1.11, 4.9, 4.20, 4.25, 5.16, 6.8, 6.11, 6.13, 7.3_

  - [x] 8.2 Add intervention, fork and hint transitions to `sessionReducer`
    - `interventionRecordRestored`; `interventionSucceeded` (append the entry, recompute only the side fields of `avatar` with `computeSides` at the latest sample time); `forkSucceeded` (set session and current branch, recompute lineage with the known fork time, clear `latestSample` and `history`, reset the Ending and `endingSnapshot`, arm the stale guard, set `avatar` from `mapAvatar` at the fork time with `previous: null`; keep hints, Intervention_Record, playback state, view and first tidal volume); `hintRevealed` (Hint_Record entry with the Simulation_Time fallbacks of Requirement 9.5)
    - Add to `apps/web/src/lib/sessionState.test.ts`:
      - after a fork the new Branch's Ending is `none` and old samples add no hold time
      - a failed fork dispatches nothing, so state is identical
      - a Decompression updates Swollen_Sides and Decompressed_Sides without waiting for a sample; after a fork to an earlier Checkpoint the side is swollen again
      - hint Simulation_Time: latest sample; else the Branch's fork time; else 0; no reveal past the last Hint
      - **Property 20: View switches and forks preserve session-scoped state**. Tag: `// Feature: play-mode, Property 20: View switches and forks preserve session-scoped state`
      - **Property 21: Hints reveal one at a time in order**. Tag: `// Feature: play-mode, Property 21: Hints reveal one at a time in order`
    - Run from `apps/web/`: `npx vitest --run 2>&1 | tee /tmp/sp-vitest.log`
    - Quote the Vitest summary line (passed/failed/skipped) in the task report
    - _Requirements: 1.4, 4.14, 4.15, 4.20, 6.11, 6.17, 8.6, 9.2, 9.3, 9.4, 9.5, 10.8, 10.9, 12.4_
    - _Properties: 20, 21_

  - [x] 8.3 Implement `apps/web/src/hooks/useSimulationSession.ts`
    - Create the new `src/hooks/` folder. The hook owns all I/O: the effects in the design's table (load case with the 10 s timeout and the stored view, load session then lineage Checkpoints, restore the Intervention_Record before first use, one Vitals_Stream keyed by `sessionId` only, pause on Ending once per Branch, default 2x once per Session in the tab)
    - Actions: `selectView`, `setPlaying`, `setSpeed`, `applyIntervention` (pending guard, 10 s timeout, entry from `buildInterventionEntry`, save to sessionStorage), `revealHint` (wall-clock time passed into the action), `loadLineageCheckpoints` (10 s timeout), `fork` (30 s timeout; on a failed session reload after success, dispatch `forkSucceeded` with the previous metadata plus the returned Branch). Return `state`, memoised `activeInterventions`, `statusSentence` (`null` without a Play_Section), `actions` and `notices` (`pauseFailed`, plus the existing stream error message)
    - Export pure helpers and use them inside the hook: `runPauseWithRetry(send, sleep)` (1 attempt + at most 2 retries, 2 s apart), `shouldSendDefaultSpeed(storage, sessionId, view, caseStatus)`, `markDefaultSpeedSent(storage, sessionId)` (written before the request) and `persistViewSelection(storage, sessionId, view)`
    - Create `apps/web/src/hooks/useSimulationSession.test.ts` with mocked `api` and fake timers (no DOM, no network):
      - `runPauseWithRetry`: success first time sends once; two failures then success sends 3; three failures send exactly 3, 2 s apart, and report failure
      - `shouldSendDefaultSpeed`: true only for `play`, a loaded case and no stored flag; false after `markDefaultSpeedSent`, also after a failed request
      - `persistViewSelection` writes the view key and calls no `api` function
    - Run `npx tsc --noEmit` from `apps/web/`; no new errors compared with the 1.1 baseline
    - Run from `apps/web/`: `npx vitest --run 2>&1 | tee /tmp/sp-vitest.log`
    - Quote the Vitest summary line (passed/failed/skipped) in the task report
    - _Requirements: 1.4, 1.5, 1.9, 1.11, 7.1, 7.10, 8.5, 8.6, 8.8, 8.11, 8.12, 8.13, 8.14, 9.6, 10.6, 10.8, 10.10, 10.11, 11.12, 11.13_

- [x] 9. Build the shared shell and the Clinician view
  - [x] 9.1 Create `SafetyNotice` and `ViewSwitcher` components
    - `apps/web/src/components/SafetyNotice.tsx`: sticky top bar with the text "Educational simulation, not for clinical use", `z-50`, height exposed as the CSS variable `--notice-h`, readable from 320 px to 1920 px
    - `apps/web/src/components/ViewSwitcher.tsx`: `role="radiogroup"` with "Play" and "Clinician" options, `aria-checked` on the selected one, a visible selected marker that is not only colour; Play disabled with `aria-disabled="true"` and the text "Play mode is not available for this case" (no Play_Section) or "Play mode is unavailable: the case could not be loaded." (case load failed); both options disabled while loading; activating a disabled option does nothing
    - Create `apps/web/src/components/ViewSwitcher.test.tsx` and `SafetyNotice.test.tsx` with `renderToStaticMarkup`: notice text present once; selected option marked in both views; each disabled state and its text; loading disables both
    - Run `npx tsc --noEmit` from `apps/web/`; no new errors compared with the 1.1 baseline
    - Run from `apps/web/`: `npx vitest --run 2>&1 | tee /tmp/sp-vitest.log`
    - Quote the Vitest summary line (passed/failed/skipped) in the task report
    - _Requirements: 1.2, 1.3, 1.8, 1.10, 1.11, 7.9, 11.8_

  - [x] 9.2 Extend `VitalSign`, `InterventionPanel` and `PlaybackControls`
    - `VitalSign`: optional `alarmState`; without it, a neutral grey style with no alarm colour
    - `InterventionPanel`: optional `getLabel(intervention)` (default: clinical `label`) and optional `disabledReason`; disabled buttons show a lock icon and "Not available right now"; buttons in Case_Definition order
    - `PlaybackControls`: optional `variant="play"` for the Play palette; the selected speed gets `aria-pressed="true"` and a check mark; play/pause keep their text labels; the same `onPlay`/`onPause`/`onSpeedChange` callbacks as today
    - Create `apps/web/src/components/sharedControls.test.tsx` with `renderToStaticMarkup`: neutral `VitalSign` has no alarm colour classes; `InterventionPanel` shows `label` by default and Play_Labels with `getLabel = playButtonText`; disabled text and icon; `aria-pressed` and check mark on the selected speed
    - Run `npx tsc --noEmit` from `apps/web/`; no new errors compared with the 1.1 baseline
    - Run from `apps/web/`: `npx vitest --run 2>&1 | tee /tmp/sp-vitest.log`
    - Quote the Vitest summary line (passed/failed/skipped) in the task report
    - _Requirements: 1.7, 1.11, 8.1, 8.2, 8.3, 8.4, 11.9, 11.11_

  - [x] 9.3 Create `EndingBanner` and `ClinicianView`
    - `apps/web/src/components/EndingBanner.tsx`: "Ending: Rescued" or "Ending: Lost" and a button "Open Play view" that calls `selectView('play')`
    - `apps/web/src/components/ClinicianView.tsx`: move the current monitor body of `src/app/session/[sessionId]/page.tsx` here (header without the old warning chip, playback controls, vitals grid with `getAlarmState`, trend chart, intervention panel with clinical labels, Timeline), reading all data and actions from the `useSimulationSession` result. Show `EndingBanner` while the Ending is not `none`. When `caseData` is `null` after a failed load, show the six readouts neutral and replace the intervention panel with "The case could not be loaded." Do not change `page.tsx` yet (task 11.2 wires it)
    - Create `apps/web/src/components/ClinicianView.test.tsx` with `renderToStaticMarkup` and a state built from `initialSessionState` and `sessionReducer`: clinical labels and no Play_Label; a warning-band value (for example SpO2 0.93) uses the warning colour; banner shown only with an Ending; failed case shows neutral readouts and the message
    - Run `npx tsc --noEmit` from `apps/web/`; no new errors compared with the 1.1 baseline
    - Run from `apps/web/`: `npx vitest --run 2>&1 | tee /tmp/sp-vitest.log`
    - Quote the Vitest summary line (passed/failed/skipped) in the task report
    - _Requirements: 1.7, 1.11, 7.8, 8.4, 15.7, 15.8_

- [x] 10. Build the Play components
  - [x] 10.1 Create the `StitchedPatient` Avatar and its styles
    - In `apps/web/src/app/globals.css`: Play palette variables (background `#2E1A47`, accent `#FF7A1A`, text `#FFF7EC`, focus ring `#FFD166`), the `:focus-visible` ring (`3px solid #FFD166`, offset 2px) for Play controls, and the animation stylesheet from the design (`sp-breathe`, `sp-beat`, stopped classes, `sp-unstitch`, `sp-rate-static`, and the `prefers-reduced-motion: reduce` block)
    - `apps/web/src/components/StitchedPatient.tsx` with the props in the design: speech-bubble headroom band always reserved; a bubble only for text with a non-whitespace character, wrapped with `overflow-wrap: anywhere`; exactly one `<svg role="img" aria-label={statusSentence} viewBox="0 0 200 280">`; no `<image>`, no `href`, no `url(`, no `id`; static HR/RR rate icons (`slow`/`normal`/`fast`) with class `sp-rate-static`
    - Artwork drawn for this project only, per the design: round head, friendly eyes and smile, 3 to 4 skin patches with at least three cross-stitch marks, exactly two neck bolts, light blue gown `#A9D6F5`, stitched-heart patch; Skin_Tone fills from the design table; sweat drops; `variant='lost'` adds `sp-unstitch` to the patch groups. No blood, wounds, bone, fangs or skulls; skin never green; head never flat. Copy no third-party artwork or paths
    - Every side-specific element carries `data-side` and takes its coordinates from `sideGeometry` as plain `x`/`y`/`width`/`height` or `x1`/`x2` attributes (no transforms), so the test can read them
    - Create `apps/web/src/components/StitchedPatient.test.tsx` with `renderToStaticMarkup`:
      - accessible name is the given sentence (the default sentence when nothing else is selected)
      - speech text of 200 characters appears in full; empty and whitespace-only speech render no bubble and the same wrapper markup
      - `variant='lost'` adds `sp-unstitch`; static rate icons present with the right labels for low, none and high directions
      - **Property 8: Patient's Left is drawn on the viewer's right**. Tag: `// Feature: play-mode, Property 8: Patient's Left is drawn on the viewer's right`
      - **Property 9: The Avatar renders one deterministic inline SVG**. Tag: `// Feature: play-mode, Property 9: The Avatar renders one deterministic inline SVG`
    - Run `npx tsc --noEmit` from `apps/web/`; no new errors compared with the 1.1 baseline
    - Run from `apps/web/`: `npx vitest --run 2>&1 | tee /tmp/sp-vitest.log`
    - Quote the Vitest summary line (passed/failed/skipped) in the task report
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.7, 3.8, 3.9, 3.10, 3.11, 3.12, 4.17, 4.21, 4.23, 7.4, 7.12, 11.4_
    - _Properties: 8, 9_

  - [x] 10.2 Create `StatusLine` and `GoalBar`
    - `apps/web/src/components/StatusLine.tsx`: Overall_Status badge outside the live region (circle with check "OK", triangle "Worried", octagon "Danger"), and a `<p aria-live="polite">` that contains only the Status_Sentence; text wraps, no `truncate` or `line-clamp`
    - `apps/web/src/components/GoalBar.tsx`: Goal_Text in full; when `timeLimitSeconds` exists, a `<progress>` and a visible `M:SS left` label from `remainingSeconds` and `formatMSS`
    - Create `apps/web/src/components/StatusLine.test.tsx` with `renderToStaticMarkup`: the live region text equals the sentence only; each badge has a distinct shape and label; no truncation classes; `GoalBar` shows the full goal, `"3:20 left"` for limit 600 and latest time 400, `"0:00 left"` past the limit, and no bar without a Time_Limit
    - Run `npx tsc --noEmit` from `apps/web/`; no new errors compared with the 1.1 baseline
    - Run from `apps/web/`: `npx vitest --run 2>&1 | tee /tmp/sp-vitest.log`
    - Quote the Vitest summary line (passed/failed/skipped) in the task report
    - _Requirements: 4.19, 5.1, 5.6, 5.11, 5.13, 5.14, 5.15, 11.1_

  - [x] 10.3 Create `HintPanel` and `Toast`
    - `apps/web/src/components/HintPanel.tsx`: hidden when `play.hints` is missing or empty; a native `<button>` "Hint (N left)"; revealed Hints in an ordered list in Case_Definition order; at N = 0 the button is disabled and reads "No hints left"; activation calls `revealHint` only
    - `apps/web/src/components/Toast.tsx`: `role="status"`, does not take focus, auto-hides after `TOAST_MS = 3000` (export the constant)
    - Create `apps/web/src/components/HintPanel.test.tsx` with `renderToStaticMarkup`: counts for 0 to 3 revealed of 3; disabled text; hidden without Hints; revealed order; `Toast` role and text; `TOAST_MS` within 2000 to 5000
    - Run `npx tsc --noEmit` from `apps/web/`; no new errors compared with the 1.1 baseline
    - Run from `apps/web/`: `npx vitest --run 2>&1 | tee /tmp/sp-vitest.log`
    - Quote the Vitest summary line (passed/failed/skipped) in the task report
    - _Requirements: 7.10, 8.7, 8.8, 9.1, 9.2, 9.3, 9.6, 9.9, 11.3, 11.11_

  - [x] 10.4 Create `apps/web/src/hooks/useFocusTrap.ts`
    - Moves focus to the first focusable control on open, wraps Tab and Shift+Tab, calls `onEscape` on Escape, and returns focus to a given element on close
    - Export the pure helper `nextFocusIndex(current, count, shiftKey)` and use it in the hook
    - Create `apps/web/src/hooks/useFocusTrap.test.ts`: forward and backward wrap, single control, current index outside the list
    - Run `npx tsc --noEmit` from `apps/web/`; no new errors compared with the 1.1 baseline
    - Run from `apps/web/`: `npx vitest --run 2>&1 | tee /tmp/sp-vitest.log`
    - Quote the Vitest summary line (passed/failed/skipped) in the task report
    - _Requirements: 11.5, 11.6, 11.10_

  - [x] 10.5 Create `RewindPanel`
    - `apps/web/src/components/RewindPanel.tsx`: a container that on open calls `loadLineageCheckpoints`, builds moments with `selectRewindCheckpoints` and `labelRewindMoment`, and calls `fork(checkpointId, simulationTime)` once per selection; and a presentational `RewindPanelBody` with props `status` (`loading` | `loadError` | `ready` | `forking` | `forkError`) and `moments`
    - Texts: "Couldn't load earlier moments. Please try again." (nothing listed until reopened), "No earlier moments yet.", "Rewinding…" with all moments disabled, "Couldn't rewind. Please try again." with moments re-enabled
    - `role="dialog"`, `aria-modal="true"`, positioned below the Safety_Notice, using `useFocusTrap`; Escape or closing without a fork returns focus to the Rewind button
    - Create `apps/web/src/components/RewindPanel.test.tsx` with `renderToStaticMarkup` of `RewindPanelBody` for each status: texts, disabled state while forking, labels in newest-first order, dialog attributes
    - Run `npx tsc --noEmit` from `apps/web/`; no new errors compared with the 1.1 baseline
    - Run from `apps/web/`: `npx vitest --run 2>&1 | tee /tmp/sp-vitest.log`
    - Quote the Vitest summary line (passed/failed/skipped) in the task report
    - _Requirements: 10.2, 10.5, 10.6, 10.7, 10.10, 10.11, 10.12, 11.2, 11.5, 11.6, 11.10_

  - [x] 10.6 Create `EndingScreen`
    - `apps/web/src/components/EndingScreen.tsx`: overlay starting at `top: var(--notice-h)` with a `z-index` below the Safety_Notice; dark background with an original inline-SVG corner cobweb (no ids); no moon or bats of its own, because the Avatar's scene already has the window, moon and bats; `<h2>` "Rescued" or "Lost"
    - `rescued`: "He's breathing again." and `StitchedPatient` with `endingSnapshot`, `variant="rescued"`; a "Rewind" control
    - `lost`: `StitchedPatient` with `variant="lost"` and a "Rewind and try again" button present in the first render
    - Both: the Rewind control opens the `RewindPanel` on top while the screen stays; "Show the monitor" calls `selectView('clinician')`; focus moves to the first control and is trapped with `useFocusTrap`; decorations sit inside `.sp-ending` so reduced motion stops their animation
    - Create `apps/web/src/components/EndingScreen.test.tsx` with `renderToStaticMarkup`: heading and texts per Ending; "Rewind and try again" present for `lost`; "Show the monitor" for both; at least one decoration; the cobweb is present and the Ending_Screen's own markup (outside the Avatar) contains no moon or bat; the lost Avatar carries `sp-unstitch`; the overlay style starts below the notice
    - Run `npx tsc --noEmit` from `apps/web/`; no new errors compared with the 1.1 baseline
    - Run from `apps/web/`: `npx vitest --run 2>&1 | tee /tmp/sp-vitest.log`
    - Quote the Vitest summary line (passed/failed/skipped) in the task report
    - _Requirements: 1.8, 7.2, 7.3, 7.4, 7.5, 7.6, 7.9, 7.11, 7.12, 10.1, 11.5, 11.10, 11.11_

  - [x] 10.7 Enrich the `StitchedPatient` Avatar
    - Touch only `apps/web/src/components/StitchedPatient.tsx`, `apps/web/src/app/globals.css` and `apps/web/src/components/StitchedPatient.test.tsx`
    - Expressions, per the design section "Expressions and dress-up": export `Expression` and the pure helper `expressionFor(overallStatus, variant)` with the precedence `rescued` → `joyful`, `lost` → `sleepy`, otherwise `normal` → `calm`, `warning` → `worried`, `critical` → `alarmed`; draw eyes, brows and mouth inside one `<g data-part="face" data-expression={…}>` inside the head Patch, per the design table (crescent eyes, big grin and three `sparkle` shapes for `joyful`; closed drooping eyes, sad mouth and exactly one light-blue `tear` for `sleepy`); eyes and brows only with `circle`, `ellipse` and `path`, no `<line>` in the face group, no X eyes or other death symbol; every Expression draws exactly one `data-part="lips"` element inside the `mouth` group in the Skin_Tone's lips colour (`SKIN_PALETTES[skinTone].lips`) per the design table (`calm`: the existing lips path; `alarmed`: lips-coloured ring with a small dark `#2E1A47` "o" inside; `worried` and `sleepy`: lips-coloured curve, stroke width ≥ 2.5, fill `none`; `joyful`: grin filled with the lips colour, optional `#FFF7EC` tooth strip, no fangs)
    - Dress-up: the pumpkin `hat` (one group), exactly two `bat` groups and exactly two `spark` groups at the bolts, drawn inside `HAT_BOX`, `BAT_BOXES` and `SPARK_BOXES`, with no `data-side` and no `transform` attribute; their shapes use only `rect`, `circle`, `ellipse`, `line`, `polygon` and `path` with absolute `M`/`L`/`H`/`V`/`Q`/`C`/`Z` commands so the test can compute bounding boxes; export `FACE_FEATURE_BOX`, `CHEST_REGION`, `HAT_BOX`, `BAT_BOXES` and `SPARK_BOXES` with the design values
    - Idle motions: `sp-blink` on the eyes group for `calm`, `worried` and `alarmed` only; a `<g data-part="head-tilt">` around the head, forehead and cheek Patches, head-area stitches, blush, freckles, plaster, sweat drops, hat and sparkles, with class `sp-tilt` only when `variant` is `live` or `rescued`; `sp-spark` / `sp-spark sp-spark-delay` on the sparks and `sp-bat` / `sp-bat sp-bat-delay` on the bats
    - Celebration: when `params.decompressedSides` is non-empty, `sp-celebrate-bolt` on both bolts and `sp-celebrate-heart` on a new `<g data-part="heart-hop">` around the heart path (which keeps `sp-beat`); no state, no timers, no effects
    - Craft details: two `blush` ellipses with a new `blush` fill per Skin_Tone in `SKIN_PALETTES`, six `freckle` dots, one `plaster` group (a friendly rounded strip, no wound under it), `fabric-check` lines inside the forehead Patch and `fabric-stripe` lines inside the hands Patch, all as plain lines and shapes with the design coordinates
    - Constraints: no new prop on `StitchedPatient` and no new field in `AvatarParameters`; no `id`, gradient, `<pattern>`, `<clipPath>`, `<mask>`, `<filter>` or `<defs>`; no `Math.random`, `Date` or timers; chest halves, needles and bandages stay direct children of `<svg>`, outside the head-tilt group and every other group; all artwork original and friendly, no blood, wounds, bone, fangs or skulls, skin never green, head never flat
    - `apps/web/src/app/globals.css`: add only the rules from the design's "Animation stylesheet additions" (`sp-blink`, `sp-tilt`, `sp-spark`, `sp-spark-delay`, `sp-bat`, `sp-bat-delay`, `sp-celebrate-bolt`, `sp-celebrate-heart` and their keyframes, with `animation-iteration-count: 1` on the two celebration classes); keep every existing rule unchanged; the existing `.sp-avatar *, .sp-ending * { animation: none !important; … }` rule in the `prefers-reduced-motion: reduce` block covers the new classes, because every new element sits inside `.sp-avatar`
    - Extend `apps/web/src/components/StitchedPatient.test.tsx` with `renderToStaticMarkup`:
      - one test per Expression: `calm`, `worried` and `alarmed` for `live` with Overall_Status `normal`, `warning` and `critical`; `joyful` for `rescued` and `sleepy` for `lost`, each with Overall_Status `normal` and `critical` (variant beats Overall_Status); `expressionFor` agrees with the rendered `data-expression`
      - no `<line` inside the face group and no cross-stitch centre inside an eye white's bounding box, in every Expression; exactly one `tear` for `sleepy` and none otherwise
      - one `hat`, exactly two `bat` and exactly two `spark` groups in every Expression, none with `data-side`
      - `sp-celebrate-bolt` (twice) and `sp-celebrate-heart` (once) present when `decompressedSides` is `['Left']`, `['Right']` or both, and absent when it is empty
      - `blush` (two), `freckle` (at least three), `plaster`, `fabric-check` and `fabric-stripe` present
      - for every Expression and every Skin_Tone (`healthy`, `pale`, `cyanotic`), exactly one `data-part="lips"` element whose `fill` or `stroke` equals `SKIN_PALETTES[tone].lips`; the existing palette tests keep passing unchanged
      - no `<pattern`, `<clipPath`, `<mask`, `<filter`, `<defs`, `Gradient`, ` id=` or `url(` in the markup, for each variant
      - non-overlap: conservative bounding boxes of the hat, bat and spark groups (all coordinate pairs, including path control points; `cx ± r` for circles) lie inside their design boxes and are disjoint from `FACE_FEATURE_BOX` and `CHEST_REGION`; every eye, brow, mouth and tear shape lies inside `FACE_FEATURE_BOX`; every `data-side` element lies inside `CHEST_REGION` and is a direct child of `<svg>`
      - CSS text: read `apps/web/src/app/globals.css` with `fs.readFileSync`, extract the `@media (prefers-reduced-motion: reduce)` block, check it contains `.sp-avatar *` with `animation: none !important`; check that `.sp-blink`, `.sp-tilt`, `.sp-spark`, `.sp-bat`, `.sp-celebrate-bolt` and `.sp-celebrate-heart` are defined and that both celebration rules contain `animation-iteration-count: 1`
      - extend the generators of the existing Property 8 and Property 9 tests with an arbitrary `variant`; both keep their tags and pass; Property 9 also checks the new forbidden elements
      - **Property 22: The Avatar's Expression and dress-up follow its props and keep clear of the face and chest**. Tag: `// Feature: play-mode, Property 22: The Avatar's Expression and dress-up follow its props and keep clear of the face and chest`
    - Run `npx tsc --noEmit` from `apps/web/`; no new errors compared with the 1.1 baseline
    - Run from `apps/web/`: `npx vitest --run 2>&1 | tee /tmp/sp-vitest.log`
    - Quote the Vitest summary line (passed/failed/skipped) in the task report
    - _Requirements: 3.1, 3.12, 3.13, 3.14, 3.15, 3.16, 3.17, 3.18, 3.19, 3.20, 3.21, 3.22, 3.23, 3.24, 3.25, 3.26, 3.27, 3.28, 3.29, 3.30, 3.31, 3.32, 3.33, 12.15_
    - _Properties: 8, 9, 22_

  - [x] 10.8 Redraw the Avatar as one cohesive scene
    - Touch only `apps/web/src/components/StitchedPatient.tsx` and `apps/web/src/components/StitchedPatient.test.tsx`; `apps/web/src/app/globals.css` stays unchanged unless a rule must change; report any change
    - Layer order, per the design section "Cohesive redraw" (follow its exact order and element lists): the `scene` group as the first child of `<svg>` (window, moon, two bats, IV pole, IV bag, IV tube, headboard, pillow); the `torso` group with `sp-breathe` (torso skin piece, two gown panels with gown dots, gown shades); the `head-tilt` group (back hair, `Patch head` with neck, chin shade, bolts, head circle, far-side shade and face group, `Patch forehead`, `Patch cheek`, brim shade, blush, freckles, head-area stitches, hair locks, beanie, sweat drops, sparkles); the two spark groups; the chest halves, needles and bandages with `data-side` as direct children of `<svg>`; the `heart-hop` group; the `quilt` group; last the `hands` Patch with both `arm` groups (forearm, seam with cross-stitch, mitten)
    - Coordinates and constants, per the design's coordinate plan, element geometry and colour tables: new values for `HAT_BOX` and `BAT_BOXES`; new `WINDOW_BOX`, `MOON`, `IV_BOX`, `GOWN_OPENING`, `QUILT_TOP_Y`, `HEAD_CENTRE`, `HEAD_RADIUS`, `OUTLINE_COLOUR`, `OUTLINE_WIDTH`, the shade, gown, beanie, quilt and scene colours, and a `shade` entry per Skin_Tone in `SKIN_PALETTES`; `FABRIC_CHECK_LINES` and `FABRIC_STRIPE_LINES` get the quilt coordinates; `FACE_FEATURE_BOX`, `CHEST_REGION`, `SPARK_BOXES`, `UNSTITCH_OFFSETS`, `PatchName` and `sides.ts` stay unchanged
    - Outline and shading: every stroked shape outside the exemptions of Requirement 3.34 uses `OUTLINE_COLOUR` and `OUTLINE_WIDTH`; the `<svg>` sets `stroke-linejoin="round"` and `stroke-linecap="round"`; Shade_Shapes are flat fills with no stroke and no opacity, lit from the window at the upper left
    - Face additions: iris, pupil (`data-part="pupil"`) and eye highlight in `calm`, `worried` and `alarmed`; a triangle `nose` polygon in every Expression; all other face coordinates unchanged
    - Removals and moves: remove `Plaster`, `DRESS_UP_COLOURS.plaster`, `DRESS_UP_COLOURS.plasterPad` and `DRESS_UP_COLOURS.batOutline`; `fabric-check` and `fabric-stripe` move onto quilt patches; the hand circles become the arm groups, the hair tuft becomes the back hair and hair locks, `PumpkinHat` becomes the beanie, the bats move into the window; the hand stitches move to the arm seams; chest halves are filled with `palette.patches[1]` (3.53) and `AVATAR_COLOURS.chestHalf` is no longer used
    - Must not change: the Expressions and lips (3.13 to 3.19, 3.33); the Skin_Tones and their `patches`, `lips` and `blush` values; the sweat drops; the chest halves with swelling and the side marks per side as direct children of `<svg>` inside `CHEST_REGION`, with the patient's Left on the viewer's right; the heart with `sp-beat`; breathing on the torso group; `sp-blink`; `sp-tilt` on the head-tilt group; the sparks; `sp-bat`; the one-time celebration; `sp-unstitch` on the four skin Patch groups only (head, forehead, cheek, hands); the reduced-motion block; the speech band and the rate icons outside the SVG; the viewBox `0 0 200 280`
    - Constraints: no new prop on `StitchedPatient` and no new field in `AvatarParameters`; no `Math.random`, `Date` or timers; identical markup for identical props; no `id`, gradient, `<pattern>`, `<clipPath>`, `<mask>`, `<filter>`, `<defs>`, `<image>`, `href` or `url(`; all paths use only absolute `M`/`L`/`H`/`V`/`Q`/`C`/`Z` commands; all artwork original and friendly, no blood, wounds, bone, fangs or skulls, skin never green, head never flat, real eyes and never button or X eyes
    - Extend `apps/web/src/components/StitchedPatient.test.tsx` with `renderToStaticMarkup`, for every Skin_Tone, every Expression and both the normal and the swollen chest geometry where Requirement 12.16 says so, using the Conservative_Bounding_Box helper, a path vertex reader and a `relativeLuminance(hex)` helper (WCAG 2.2):
      - outline: every element with a stroke other than `none`, outside the exempt parts (face group, `seam`, `stitch`, `heart`, `fabric-check`, `fabric-stripe`, `spark`, `sparkle`, `iv-tube`, `sweat` and every `data-side` element, with their descendants), has `stroke` equal to `OUTLINE_COLOUR` and `stroke-width` equal to `OUTLINE_WIDTH`; the `<svg>` sets round line joins and caps and no element sets another value (3.34)
      - scene group: exactly one `scene` group, the first child of `<svg>`, holding `window`, `moon`, two `bat`, `iv-pole`, `iv-bag`, `iv-tube`, `headboard` and `pillow` in that order (3.35)
      - quilt group: one `quilt` group, a direct child of `<svg>`, after the torso, head-tilt, every `data-side` element and the heart-hop group, followed only by the `hands` Patch; at least four `quilt-patch` elements, seams and at least two stitches; `fabric-check` and `fabric-stripe` each inside one quilt patch's box and on no skin piece (3.29, 3.36, 3.37)
      - no scene shape's box intersects `FACE_FEATURE_BOX` (3.38)
      - the top of the quilt's box lies below the bottom of `CHEST_REGION` (3.39)
      - window and moon inside `WINDOW_BOX`; both bats inside `WINDOW_BOX`, after the moon in document order, each box intersecting the moon's box (3.40, 3.54)
      - IV pole, bag and tube inside `IV_BOX`, which is disjoint from the boxes of the torso, head-tilt and `hands` groups (3.41)
      - head circle diameter at least 70 (3.42)
      - hat box above the head centre with its bottom at least 8 units below the head top; at least six `hair-lock` elements clear of `FACE_FEATURE_BOX`, at least one ending below the hat's bottom (3.43, 3.44)
      - arms: exactly two `arm` groups, one per half; each arm shape has two vertices within 0.5 units of vertices of the gown panel on its side; each arm has a seam with a stitch; each mitten's box intersects the quilt's box; no arm shape's box intersects the box of any `data-side` element, for normal and swollen chests (3.45, 3.46)
      - shading: every `shade` element has no stroke and no opacity attribute and a fill equal to the Skin_Tone's `shade`, `GOWN_SHADE` or `QUILT_SHADE`; at least three skin shades in the head-tilt group, at least one gown shade in the torso group and at least one quilt shade in the quilt; each Skin_Tone's `shade` has a lower relative luminance than every patch colour of that tone (3.47, 3.48)
      - eyes: in `calm`, `worried` and `alarmed`, each eye has an `iris` inside the white, a `pupil` inside the iris and an `eye-highlight` centred inside the iris (3.49)
      - nose: one `nose` polygon with three points in every Expression, inside `FACE_FEATURE_BOX` and clear of the eye-white and `lips` boxes (3.50)
      - gown: exactly two `gown` panels in the torso group, one per half; at least six `gown-dot` circles with a fill and no stroke, each centred inside a gown panel's box; no gown panel's box intersects `GOWN_OPENING` (3.51, 3.52)
      - chest halves (`chest` or `chest-swollen`) filled with a patch colour of the current Skin_Tone (3.53)
      - muted scene: every fill inside the scene group and the quilt has a relative luminance no higher than that of the darkest `healthy` patch colour (3.55)
      - `sp-unstitch` only on the four skin Patch groups and only for `lost`; none inside the scene, torso or quilt groups (3.56)
      - no element with `data-part="plaster"` (3.29)
      - **Property 23: The Avatar is one cohesive illustration**. Tag: `// Feature: play-mode, Property 23: The Avatar is one cohesive illustration`
    - Update every existing Avatar test to the new boxes and artwork: `HAT_BOX` and `BAT_BOXES`; the plaster test now asserts no plaster; the fabric looks on the quilt; the hand and stripe tests on the arm, mitten and quilt groups. Properties 8, 9 and 22 keep their tags and pass
    - The existing palette tests that parse fills inside Patch groups must keep passing, so every new fill inside a Patch group is a hex colour
    - Polish follow-up (design "Cohesive redraw", "Polish follow-up" and the element geometry table; same files, same constraints and "Must not change" list as above):
      - Chest: `ChestHalf` normal stroke becomes `palette.shade`, width 1, no dash (was `AVATAR_COLOURS.gown`); the swollen stroke `#FF7A1A`, width 2, `4 3` and every side mark stay as they are (3.58, 3.59)
      - Arms: replace the straight forearm with an `upper-arm` path (keeps the sleeve-hem vertices (20, 150) and (42, 150)) and a `forearm` path bent inward at the elbow; move the mitten and thumb in front of the belly (mitten group box x 48–77, y 186–210, and mirror); every arm shape that reaches x ≥ 43 (or x ≤ 157) starts below y 184; move the mitten shades to (61, 211) and (139, 211), rx 11 (3.45, 3.46, 3.60, 3.61)
      - Quilt: fourteen patches in three staggered rows with the design's coordinates and fills, seams on the new patch edges, stitches at (84, 213), (140, 240) and (156, 267), `fabric-check` on patch x 48–92, y 226–254 and `fabric-stripe` on patch x 76–116, y 254–280 with the new line coordinates, and three curved Quilt_Fold_Shades in `QUILT_SHADE`; colours unchanged (3.37, 3.39, 3.55, 3.62, 3.63)
      - Beanie and hair: `HAT_BOX` becomes x 60–140, y 0–38; new stem, rounder dome, ridges, `brim` path with rounded ends and a lower edge at y 38 at the ends and y 34 in the middle, and eight ribs, per the design; brim shade `M 68 38 Q 100 30 132 38 Q 100 36 68 38 Z`; `SWEAT_DROPS` (88, 38) → (88, 44) and (124, 40) → (124, 46); eight `hair-lock` paths, four per half, fuller at the sides (3.20, 3.43, 3.44, 3.64 to 3.68)
      - Tests: add markup checks for 3.58 to 3.68 as listed in Requirement 12.16 and Property 23 (normal and swollen chest strokes; mitten centre vs Sleeve_Hem_Centre; inward arm shapes below y 184 for normal and swollen chests; at least twelve patches of at least three widths; at least two Quilt_Fold_Shades; hat bottom at most y 38 and at least 14 below the head top; brim at least as wide as the head chord at its bottom; no sweat drop box over the hat box; no stitch box under the hat box or a hair-lock box; at least four locks per half with two per half below the hat)
      - Update the existing tests to the new values: `HAT_BOX` (3.20, 3.21, 3.43, Property 22); the hair-lock count and boxes (3.44); the arm-join check now finds its two vertices on the `upper-arm` shape (3.45); the arm and mitten boxes (3.46); the quilt patch, seam, stitch and fabric-look positions (3.29, 3.37); and every check that hard-codes the old sweat drop centres. Properties 8, 9, 22 and 23 keep their tags and pass
    - Run `npx tsc --noEmit` from `apps/web/`; no new errors compared with the 1.1 baseline
    - Run from `apps/web/`: `npx vitest --run 2>&1 | tee /tmp/sp-vitest.log`
    - Quote the Vitest summary line (passed/failed/skipped) in the task report
    - _Requirements: 3.2, 3.20, 3.21, 3.29, 3.30, 3.32, 3.34, 3.35, 3.36, 3.37, 3.38, 3.39, 3.40, 3.41, 3.42, 3.43, 3.44, 3.45, 3.46, 3.47, 3.48, 3.49, 3.50, 3.51, 3.52, 3.53, 3.54, 3.55, 3.56, 3.57, 3.58, 3.59, 3.60, 3.61, 3.62, 3.63, 3.64, 3.65, 3.66, 3.67, 3.68, 3.69, 12.15, 12.16_
    - _Properties: 8, 9, 22, 23_

- [x] 11. Wire the Play view and the session page
  - [x] 11.1 Create `PlayView`
    - `apps/web/src/components/PlayView.tsx`: the two-column layout from the design (`height: calc(100vh - var(--notice-h))`, `overflow: hidden` at widths ≥ 1024 px, stacked and scrolling below 1024 px), with `StitchedPatient`, `StatusLine`, `GoalBar`, `PlaybackControls variant="play"`, `InterventionPanel` with `getLabel = playButtonText`, `HintPanel`, Rewind button with `RewindPanel`, `Toast`s (success "Done: <button text>.", error "That didn't work. Please try again.", "The simulation could not be paused.", stream stopped "The simulation stopped. Please reload the page.") and `EndingScreen` while the Ending is not `none`. DOM order equals the visual and focus order in the design. Text at least `1rem`
    - Export the pure helper `interventionsDisabled({ connected, interventionPending, forkPending, ending })` and use it for the buttons
    - Create `apps/web/src/components/PlayView.test.tsx` with `renderToStaticMarkup` and a reducer-built state:
      - one button per Intervention in case order with the Play_Labels
      - the Rewind button is present with and without an Ending; the Ending_Screen renders only with an Ending
      - control order in the markup: playback controls, Intervention buttons, Hint button, Rewind button
      - `interventionsDisabled` is true when disconnected, while an Intervention or fork is pending, and while the Ending is not `none`; false otherwise
    - Run `npx tsc --noEmit` from `apps/web/`; no new errors compared with the 1.1 baseline
    - Run from `apps/web/`: `npx vitest --run 2>&1 | tee /tmp/sp-vitest.log`
    - Quote the Vitest summary line (passed/failed/skipped) in the task report
    - _Requirements: 5.1, 7.2, 7.7, 7.11, 8.1, 8.2, 8.3, 8.7, 8.8, 8.9, 8.10, 8.11, 10.1, 11.2, 11.3, 11.7, 11.8, 11.9_

  - [x] 11.2 Refactor `apps/web/src/app/session/[sessionId]/page.tsx`
    - Replace the page body with the design's structure: `useSimulationSession(sessionId)` once; `SafetyNotice`; `ViewSwitcher` (Play availability and reason from the case state, disabled while loading); a loading indicator while the case loads; otherwise `PlayView` or `ClinicianView` from `state.view`
    - Keep the existing "Connecting to simulation..." screen while the Vitals_Stream is not open; it replaces only the view content
    - Remove the page-local state, effects and WebSocket code that the hook now owns, so the page opens exactly one Vitals_Stream. The Safety_Notice appears exactly once
    - Run `npx tsc --noEmit` from `apps/web/`; no new errors compared with the 1.1 baseline
    - Run from `apps/web/`: `npx vitest --run 2>&1 | tee /tmp/sp-vitest.log`
    - Quote the Vitest summary line (passed/failed/skipped) in the task report
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.8, 1.9, 1.10, 1.11, 14.8, 14.9_

  - [x] 11.3 Gate the rescue on the Required_Interventions
    - Author's decision of 2026-11-20 (design D8): a sample counts toward the Rescue_Condition only from the Rescue_Gate_Time, which opens when every Required_Intervention is in the Active_Interventions. Follow the design sections "endingEvaluator.ts", "sessionState.ts — the reducer" and "Case file additions"
    - Files: `apps/web/src/lib/endingEvaluator.ts` and `endingEvaluator.test.ts`; `apps/web/src/lib/sessionState.ts` and `sessionState.test.ts`; `apps/web/src/types/index.ts`; `apps/web/src/test/generators.ts`; `cases/case-schema.json`; `cases/adult-tension-pneumothorax.yaml`; `apps/web/src/lib/caseContent.test.ts`; and the setup of existing tests that reach `rescued` with the real case file (below). No other file changes
    - Types: add `requiredInterventions?: string[]` to `endings.rescued` in `PlaySection` in `src/types/index.ts`
    - Evaluator (`endingEvaluator.ts`):
      - add `rescueGateTime: number | null` to `EndingContext`; `buildEndingContext` sets it to `rescueGateTime(requiredInterventions(play), [])`, so it is `null` when the Play_Section lists Required_Interventions and `-Infinity` without them
      - `stepEnding` step 4 as in the design: rescue holds only when `t >= ctx.rescueFromTime`, `ctx.rescueGateTime !== null`, `t >= ctx.rescueGateTime` and every rescue condition holds. Steps 1 to 3 and 5 to 7 stay unchanged. `evaluateEnding` stays the fold of `stepEnding`
      - export `requiredInterventions(play)` (`endings.rescued.requiredInterventions`, or `[]` when the field or the Play_Section is absent), `rescueGateTime(requiredIds, active)` (`-Infinity` for an empty list; else the largest, over the required ids, of the smallest finite `simulationTime` of an `active` entry with that `interventionId`; `null` when one id has no entry; entries with other ids ignored) and `setRescueGate(ctx, s, gate)` (same `ctx` and `s` when the gate is unchanged; otherwise the new gate, and `rescueStart = null` when the Ending is `none`, `rescueStart` is not `null` and the gate is `null` or later than `rescueStart`; `ending`, `endedAt`, `lastTime` and `lostStarts` never change). `endingEvaluator.ts` does not import `branchLineage.ts`. The calibration script (task 12.2) reuses these helpers
    - Reducer (`sessionState.ts`): a private `withRescueGate(state)` that computes `rescueGateTime(requiredInterventions(caseData?.play), activeInterventions(interventionRecord, lineage))`, applies it with `setRescueGate(state.endingCtx, state.ending, gate)` and returns the same state when the gate is unchanged. Call it as the last step of `caseLoaded`, `sessionLoaded`, `checkpointsLoaded`, `interventionRecordRestored`, `interventionSucceeded` and `forkSucceeded`. `sampleReceived`, `hintRevealed`, `viewSelected`, `playbackChanged` and `connectionChanged` leave the gate unchanged. The reducer stays pure
    - Generators (`src/test/generators.ts`): let `arbPlaySection` sometimes include `endings.rescued.requiredInterventions` (1 or more unique non-empty ids), keeping every existing guarantee (1 to 6 rescue conditions, 0 to 5 lost groups, at least one group or a Time_Limit, status rules never on `normal`)
    - Schema (`cases/case-schema.json`): add the optional `requiredInterventions` array to `endings.rescued` per the design fragment (`minItems: 1`, `uniqueItems: true`, items strings with `minLength: 1`); keep `additionalProperties: false` on `endings.rescued`
    - Case file (`cases/adult-tension-pneumothorax.yaml`): add `requiredInterventions: ["needle-decompression-left"]` under `endings.rescued`, with a comment on the same line or the line directly above stating that this is the author's decision of 2026-11-20 that rescue counts only after the left needle decompression. This entry gets no `TODO(author)` marker. Every other draft value keeps its marker, and no other line of the file changes
    - Existing tests that reach `rescued` with the real case file now see a `null` gate. Check at least `PlayView.test.tsx`, `SessionScreen.test.tsx`, `EndingScreen.test.tsx`, `ClinicianView.test.tsx` and `sessionState.test.ts`, and any other test that does so. In each, change only the setup so that `needle-decompression-left` is applied before the rescue samples (for example an `interventionSucceeded` action with `buildInterventionEntry` for that Intervention, or `setRescueGate` for a test that calls the evaluator directly). Do not change what these tests assert. Report each changed test and its setup change
    - Validate the schema inside the physiology image, from the repository root:
      - real case: `docker compose run --rm -v "$PWD/scripts:/check/scripts:ro" -v "$PWD/cases:/check/cases:ro" -w /check physiology python3 scripts/validate-case.py cases/adult-tension-pneumothorax.yaml` must print "Case file is valid" and exit 0
      - with the file tools, create three broken copies of the updated case under `/tmp/sp-cases/`: `requiredInterventions` empty (`[]`), with a repeated id, and with an empty string. Validate each with the side-by-side mounts, so the real schema under `cases/` is read: `docker compose run --rm -v "$PWD/scripts:/check/scripts:ro" -v "$PWD/cases:/check/cases:ro" -v /tmp/sp-cases:/check/tmpcases:ro -w /check physiology python3 scripts/validate-case.py tmpcases/<file>.yaml`. Each must exit non-zero and print the path of `endings.rescued.requiredInterventions` (2.21)
      - the file tool cannot write a schema copy, so do not try to copy `case-schema.json` to `/tmp/sp-cases/`. The broken copies are not committed
    - Add to `apps/web/src/lib/endingEvaluator.test.ts`, one test per case of Requirement 12.17:
      - with a fixed finite gate, samples that satisfy the Rescue_Condition before the gate add no rescue hold time, and a stretch exactly `holdSeconds` long that starts at the gate returns `rescued`
      - with Required_Interventions and a `null` gate, a sequence whose samples all satisfy the Rescue_Condition never returns `rescued`, and still returns `lost` through a Lost_Condition group and through the Time_Limit
      - a fixed sequence modelled on the 2026-11-20 run (no Intervention, the Rescue_Condition satisfied from the insult `timeSeconds` onward, Required_Interventions listed) returns `none` at Simulation_Time 61 s and later
      - `rescueGateTime` returns the largest of the earliest entry times of the required ids, `null` when one required id is missing, and `null` when only `needle-decompression-right` is active while `needle-decompression-left` is required
      - without Required_Interventions, the gate is `-Infinity` and the Endings equal those without a gate
      - `setRescueGate` ends an open rescue stretch that starts before a later or a `null` gate, and leaves `ending`, `endedAt`, `lastTime` and `lostStarts` unchanged
      - extend the generators of the existing Property 12, 13 and 14 tests with a fixed gate in the context (`-Infinity`, `null` or a finite time); the Property 12 reference model applies the gate as the design states. All three keep their tags and pass
      - **Property 24: Rescue never comes before the Rescue_Gate_Time**. Tag: `// Feature: play-mode, Property 24: Rescue never comes before the Rescue_Gate_Time`
    - Add to `apps/web/src/lib/sessionState.test.ts`:
      - after a fork to a Checkpoint earlier than the left Decompression the gate is `null`, and after `needle-decompression-left` succeeds again on the new Branch the gate equals the new entry's Simulation_Time
      - the gate is recomputed on each event of Requirement 6.23: `caseLoaded`, `sessionLoaded`, `checkpointsLoaded`, `interventionRecordRestored`, `interventionSucceeded` and `forkSucceeded`
      - **Property 25: The reducer keeps the Rescue_Gate_Time in step with the record and the lineage**. Tag: `// Feature: play-mode, Property 25: The reducer keeps the Rescue_Gate_Time in step with the record and the lineage`
    - Add to `apps/web/src/lib/caseContent.test.ts`:
      - every entry of `endings.rescued.requiredInterventions` equals the `id` of an Intervention in the case file; the failure names each unknown entry (2.22)
      - `requiredInterventions` has exactly one entry, `needle-decompression-left`, with the 2026-11-20 decision comment on its line or the line directly above and no `TODO(author)` marker (2.23)
      - the existing `TODO(author)` marker test must not require a marker on this entry; it keeps requiring one on every other draft value
    - All existing tests keep passing; only the setup changes named above are allowed
    - Run `npx tsc --noEmit` from `apps/web/`; no new errors compared with the 1.1 baseline
    - Run from `apps/web/`: `npx vitest --run 2>&1 | tee /tmp/sp-vitest.log`
    - Quote the Vitest summary line (passed/failed/skipped) in the task report, and quote the output of each validation command
    - _Requirements: 2.21, 2.22, 2.23, 6.1, 6.3, 6.12, 6.13, 6.18, 6.19, 6.20, 6.21, 6.22, 6.23, 6.24, 12.17_
    - _Properties: 12, 13, 14, 24, 25_

- [ ] 12. Calibrate the draft Play thresholds against the engine
  - [ ] 12.1 Implement calibration record helpers in `apps/web/src/lib/calibration.ts`
    - Superseded by engine-mcp task 2 (`.kiro/specs/engine-mcp/tasks.md`); mark this task done only when that task is done
    - Pure helpers used by the calibration script, kept under `src/` so Vitest covers them without any network:
      - `samplesAtTenSecondMarks(samples, endTime)`: one sample per multiple of 10 s from 0 to the end; the next sample is used and flagged when a mark is missing
      - `scenarioOutcome(ctx, samples, gateEntries)`: takes the scenario's gate sequence (its Intervention_Record entries) and applies `setRescueGate` with `rescueGateTime(requiredInterventions(play), entries so far)` at the sample where each call succeeded, as the design's "Rescue gate in the script" says, then returns the Ending from the fold of `stepEnding`, the time it left `none`, the final Rescue_Gate_Time, and for `lost` the cause (lost group number, read from `lostStarts` in the state returned at the ending sample, or "Time_Limit"); whether rescue ever held before the end
      - `checkLeft` (rescued at ≤ 300 s, and at or after the Rescue_Gate_Time plus `holdSeconds`; 13.14), `checkRightOnly` (lost at or before the Time_Limit, never rescued), `checkNoIntervention` (lost at or before the Time_Limit, never rescued) and `compareEarlyWithNone` (side-by-side samples after the insult time and a "pneumothorax still develops" statement). `checkRightOnly` and `checkNoIntervention` also list the samples at which every rescue Vital_Condition held without the gate (13.15). `compareEarlyWithNone` states that the early scenario's Ending is not evidence for item d and answers item d only from the vitals comparison (13.16)
      - for Requirement 13.17: `baselineBands(sample, alarms)` (the Vital_Band, Alarm_State and direction, of every vital with Case thresholds at t = 0), `overallStatusSeries(samples, alarms)` (the Overall_Status per sample) and `statusRuleReport(samples, alarms, play)` (each Status_Rule that matched, with the sample times at which it matched and the sample times at which `selectStatus` returned its sentence, or "only the defaultSentence was returned")
      - `renderCalibrationRecord(...)`: the markdown record with every item in the design's "Record" list, including the Rescue_Gate_Time per scenario, the 13.17 items, the labels "answers open question 1, item c" and "item d", the Requirement 4.18 revision flag when needed, and the line "Play_Section values NOT calibrated" when any check fails
    - Create `apps/web/src/lib/calibration.test.ts` with synthetic sample sequences: missing marks flagged; the gate is applied at the sample where the call succeeded, not before; each check passes and fails on the right inputs, including the 13.14 gate-plus-hold bound and the 13.15 list of samples where rescue held without the gate; lost cause names the group or the Time_Limit; the 13.17 items for a synthetic case where RR and EtCO2 sit on their lower normal bounds and no Status_Rule fires (the baseline bands and the Overall_Status per sample as `getVitalBand` and `overallStatus` give them, and "only the defaultSentence was returned"); the record contains the Rescue_Gate_Time per scenario, the "NOT calibrated" line only on failure and the 4.18 flag only when the early scenario shows no pneumothorax
    - Run from `apps/web/`: `npx vitest --run 2>&1 | tee /tmp/sp-vitest.log`
    - Quote the Vitest summary line (passed/failed/skipped) in the task report
    - _Requirements: 13.2, 13.3, 13.4, 13.5, 13.6, 13.7, 13.8, 13.11, 13.12, 13.13, 13.14, 13.15, 13.16, 13.17_

  - [ ] 12.2 Write the calibration script `apps/web/scripts/calibratePlayMode.ts`
    - Superseded by engine-mcp task 5 (`.kiro/specs/engine-mcp/tasks.md`); mark this task done only when that task is done
    - CLI from the design: `--url`, `--case`, `--decompress-at`, `--early-decompress-at`, optional `--max-seconds`. Uses Node's global `fetch` and `WebSocket`, the `yaml` parser, the shipped `endingEvaluator.ts` and the helpers from task 12.1. Imports use relative paths or the `@` alias through `--config vitest.config.ts`
    - Checks before any network call, stopping with a clear message: the arguments parse; the Play_Section exists and has a Time_Limit or `--max-seconds` is given; `--early-decompress-at` is less than the left `SETensionPneumothorax` `timeSeconds`; `git merge-base --is-ancestor 1e71454 HEAD` succeeds
    - Before the scenarios, create one Session and compare `GET /sessions/{id}/case` `play` and each `playLabel` with the YAML values (Requirement 2.13). The record states the result; a mismatch stops the run
    - Runs the 4 scenarios (no-intervention, left, right-only at the same time as left, left-before-insult) as separate Sessions in parallel, with the per-scenario procedure in the design: play, pause at the Decompression time, apply, read the newest "After …" Checkpoint time as the actual Decompression time, resume; stop at a non-`none` Ending or the Time_Limit / `--max-seconds`; pause and delete the Session
    - Rescue gate (13.13): the script keeps its own Intervention_Record per scenario, one `InterventionRecordEntry` per successful Intervention_API call with the actual Decompression time and the scenario's branch id. It computes the gate with `rescueGateTime(requiredInterventions(play), entries)` from task 11.3 and applies it with `setRescueGate` at the point in the sample order where the call succeeded, so the evaluator sees the same gate sequence as the Web_App
    - The left-before-insult scenario ignores its Ending and keeps running until its Simulation_Time reaches the last Simulation_Time of the no-intervention scenario. When the scenarios run in parallel, it runs to the Time_Limit or `--max-seconds` and the comparison uses the overlapping times (13.16)
    - Writes `docs/calibration/play-mode-<YYYY-MM-DD>-<short-sha>.md` and appends an index line to `docs/calibration/README.md` (created if missing). The record contains the Rescue_Gate_Time per scenario and the 13.17 items from task 12.1 (baseline bands at t = 0, Overall_Status per sample, Status_Rules matched and returned). Never edits the case file
    - Do not run the scenarios in this task. Verify offline: run `npx vite-node --config vitest.config.ts scripts/calibratePlayMode.ts -- --url http://localhost:8000 --case ../../cases/adult-tension-pneumothorax.yaml --decompress-at 150 --early-decompress-at 40` from `apps/web/`; it must stop on the early-decompression check before any network call. Quote the output
    - Run `npx tsc --noEmit` from `apps/web/`; no new errors compared with the 1.1 baseline
    - Run from `apps/web/`: `npx vitest --run 2>&1 | tee /tmp/sp-vitest.log`
    - Quote the Vitest summary line (passed/failed/skipped) in the task report
    - _Requirements: 2.13, 13.1, 13.2, 13.3, 13.4, 12.11, 13.13, 13.14, 13.15, 13.16, 13.17_

  - [ ] 12.3 Run the calibration and record it (ONE-TIME RECORDING RUN)
    - Superseded by engine-mcp task 8 (`.kiro/specs/engine-mcp/tasks.md`); mark this task done only when that task is done
    - The Physiology_Service must be reachable at `http://localhost:8000` (check `curl -sf http://localhost:8000/`). If it is not, stop and ask the user to start `docker compose up physiology` in their own terminal, or to give the x86 machine's URL for `--url`. Do not start the service from the agent
    - Run from `apps/web/`: `npx vite-node --config vitest.config.ts scripts/calibratePlayMode.ts -- --url http://localhost:8000 --case ../../cases/adult-tension-pneumothorax.yaml --decompress-at 150 --early-decompress-at 20 2>&1 | tee /tmp/sp-calibration.log`
    - Use execute_bash with timeout 1800000 ms. Until the core spec's clock task lands, the service ignores speed, so each scenario takes about as many wall-clock seconds as simulated seconds (up to the 600 s Time_Limit); the 4 scenarios run in parallel. If execute_bash reports a timeout, read the log and the record file before retrying
    - Expected from the drafts (task 7.2 engine basis) and the rescue gate (task 11.3): left rescued at or after its Rescue_Gate_Time plus `holdSeconds` and at or before 300 s (the drafts predict near t=230); no-intervention and right-only never rescued, which the `null` gate guarantees and the checks still verify, and lost at or before the Time_Limit (no-intervention lost near t=340 per the drafts). The right-only result is not yet known (open question 1, item c)
    - The early scenario's gate opens at the early Decompression, so its Ending is not evidence for item d. Item d is answered only from the vitals comparison with the no-intervention run, and the early scenario now runs past its Ending
    - Include the recorded outcome per scenario, the Decompression times, the Rescue_Gate_Time per scenario and the check results in the task report. Keep the record files under `docs/calibration/` with the change
    - The task report must also include, per scenario, the baseline band of every vital at t = 0, the Overall_Status over time and which Status_Rules fired (and when), so the author can decide the thresholds. The 2026-11-20 run showed `warning` from t = 0 (baseline RR ≈ 12 and EtCO2 ≈ 35 on the lower normal bounds) and only the default sentence. Do not change any threshold
    - If any check in Requirement 13.5, 13.6, 13.7, 13.14 or 13.15 fails, or the early scenario flags Requirement 4.18: STOP and report. Do not change any case value, threshold or check to make it pass
    - Do not remove any `TODO(author)` marker, also when every check passes. The author removes them after review and citation (Requirement 13.10)
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7, 13.8, 13.9, 13.10, 13.11, 13.12, 13.13, 13.14, 13.15, 13.16, 13.17, 14.3, 14.4_

- [ ] 13. Write the manual acceptance checklist
  - [ ] 13.1 Create `docs/play-mode-acceptance.md`
    - Since engine-mcp: references in this task to the calibration script or to task 12.3 mean the engine-mcp `run_calibration` tool and the Calibration_Record of engine-mcp Requirement 13
    - A checklist with one checkbox per item, each naming its requirement numbers:
      - artwork review and the recorded no-franchise confirmation (3.2 to 3.6)
      - speech-bubble placement at 320 px and 1280 px (3.11)
      - Safety_Notice at 320 to 1920 px and over the Rewind_Panel and Ending_Screen (1.8, 7.9, 14.9)
      - 1280×720 fit with 0 to 3 Hints revealed, 16 px text and contrast (11.7, 11.8)
      - keyboard order, Enter/Space, focus ring, focus trap and Escape (11.2 to 11.6, 11.10)
      - reduced motion on macOS (4.21, 7.12)
      - screen-reader announcement of status changes and no repeat for an unchanged sentence (5.11, 5.13)
      - timed behaviours: view switch, Avatar and status updates, Ending screen and pause (1.6, 3.8, 4.20, 5.12, 5.16, 7.1, 7.2, 7.8, 7.11)
      - the Session round trip of the Play_Section (2.13, as recorded by task 12.3)
      - the stakeholder demonstration steps of Requirement 14.1 to 14.9, using the Decompression time from the latest calibration record
    - State at the top that the simulator is an educational simulation, not for clinical use
    - No code changes in this task, so no Vitest run is needed
    - _Requirements: 3.2, 3.3, 3.4, 3.5, 3.6, 3.11, 11.7, 11.8, 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7, 14.8, 14.9_

- [ ] 14. Final check
  - [ ] 14.1 Run all web checks and the case validation
    - From `apps/web/`: `npx tsc --noEmit`, then `npx next build` (it exits when done; it is not a server), then `npx vitest --run 2>&1 | tee /tmp/sp-vitest.log`
    - From the repository root: `docker compose run --rm -v "$PWD/scripts:/check/scripts:ro" -v "$PWD/cases:/check/cases:ro" -w /check physiology python3 scripts/validate-case.py cases/adult-tension-pneumothorax.yaml`
    - Quote the Vitest summary line (passed/failed/skipped), the type-check result, the build result and the validation output in the task report. Report any failure with details. A skipped test is a problem to investigate
    - Confirm from the task reports that no play-mode task changed `services/physiology/`, `docker-compose.yml` or `.kiro/specs/core-simulation-loop/`, and that `apps/web/package-lock.json` is present
    - _Requirements: 2.12, 12.10, 12.11, 12.12_

- [ ] 15. Calibration fixes of 2026-11-25: early Decompression and displayed-value bands
  - [ ] 15.1 Fix 1: count only Gate_Entries toward the Rescue_Gate_Time
    - Author's decision of 2026-11-25 (requirements "Dependencies and confirmed decisions" item 7, design D9). Follow the design sections "endingEvaluator.ts" (Rescue gate), "sessionState.ts — the reducer" and "Shipped calibration path (13.18)"
    - Files: `apps/web/src/lib/endingEvaluator.ts` and `endingEvaluator.test.ts`; `apps/web/src/lib/sessionState.ts` and `sessionState.test.ts`; `apps/web/src/lib/calibration.ts` and `calibration.test.ts`; `apps/web/src/test/generators.ts` if a generator needs insult times. Do not change `engineRunner.ts` or `engineCalibration.ts`: they take the gate from `createOutcomeFold` / `scenarioOutcome` (13.18)
    - `endingEvaluator.ts`:
      - export `earliestInsultTime(caseData)`: the smallest finite `timeSeconds` of `timeline.scheduledInsults` (a missing list counts as empty), `undefined` without one. Move the minimum that `buildEndingContext` computes today into this function; `rescueFromTime` stays `earliestInsultTime(caseData) ?? 0`
      - `rescueGateTime(requiredIds, active, earliestInsult)` gains the required third argument `earliestInsult: number | undefined`. Per required id, only Gate_Entries count: entries with `simulationTime >= earliestInsult`, or every entry when `earliestInsult` is `undefined` (6.25, 6.26). Empty `requiredIds` still give `-Infinity`; a required id with no Gate_Entry still gives `null`; entries of other ids are still ignored (6.19)
      - `setRescueGate` and `stepEnding` stay unchanged
    - Update every non-test call site of `rescueGateTime`, each passing the third argument:
      - `buildEndingContext` in `endingEvaluator.ts`: `earliestInsultTime(caseData)`
      - `initialSessionState` in `sessionState.ts`: `rescueGateTime(requiredInterventions(undefined), [], undefined)` (no case loaded yet; the result stays `-Infinity`)
      - `withRescueGate` in `sessionState.ts`: `state.caseData ? earliestInsultTime(state.caseData) : undefined`
      - `createOutcomeFold` in `calibration.ts`: `earliestInsultTime(rc)`
    - Update every test call site (`endingEvaluator.test.ts`, `sessionState.test.ts` including `expectedGate`, `calibration.test.ts`) to pass the third argument. An existing test whose expectation relies on a pre-insult entry opening the gate encodes the old rule: change that expectation to follow 6.25 and report each such change
    - An entry left out of the gate stays in `interventionRecord` and in `activeInterventions`, and `computeSides`, `labelRewindMoment` and the Exam_Finding_Selector still see it (6.27). No change to `sides.ts`, `rewindMoments.ts`, `branchLineage.ts` or `examFinding.ts`
    - Add to `apps/web/src/lib/endingEvaluator.test.ts`, with the insult at 30 s as in the shipped case (12.18):
      - a left entry at 20 s gives `null`; at exactly 30 s gives 30; at 20 s and 150 s gives 150
      - with no finite insult time (`undefined`), every entry counts, with the results of the pre-Fix-1 rule
      - `earliestInsultTime` for the shipped case (30), for a case without insults (`undefined`) and for insults with non-finite `timeSeconds`
      - extend the existing **Property 24: Rescue never comes before the Rescue_Gate_Time** with a generated `earliestInsult` (finite or `undefined`) and entries before and after it: a finite result is never below `earliestInsult` when it is defined; adding or removing entries with `simulationTime < earliestInsult` leaves the result unchanged; with `undefined` the result equals the result with every entry counted. Keep the tag `// Feature: play-mode, Property 24: Rescue never comes before the Rescue_Gate_Time`
    - Add to `apps/web/src/lib/sessionState.test.ts`:
      - an `interventionSucceeded` for `needle-decompression-left` at 20 s keeps the gate `null`, the entry stays in `interventionRecord`, and `Left` is in `avatar.decompressedSides` (6.25, 6.27)
      - a fixture modelled on the `affected-side-early` Scenario of `docs/calibration/adult-tension-pneumothorax-2026-11-25-161c754.md`: left Decompression at 20 s, insult at 30 s, samples that satisfy the Rescue_Condition from 0 s on: the Ending is never `rescued` through `sessionReducer`; a second left Decompression at or after 30 s opens the gate at that entry's time
      - extend the existing **Property 25: The reducer keeps the Rescue_Gate_Time in step with the record and the lineage** so that `expectedGate` uses `earliestInsultTime(caseData)` and the generated entries include times before and after the Earliest_Insult_Time; it checks that every `interventionSucceeded` entry is in `interventionRecord` whether or not it is a Gate_Entry. Keep the tag `// Feature: play-mode, Property 25: The reducer keeps the Rescue_Gate_Time in step with the record and the lineage`
    - Add to `apps/web/src/lib/calibration.test.ts`: the same `affected-side-early` fixture through `createOutcomeFold` and through `scenarioOutcome` gives a `finalGate` of `null` and never `rescued` (13.18)
    - Use fast-check with `PBT_PARAMS` from `src/test/pbt.ts`, as the existing property tests do
    - Search `apps/web/src` and `apps/web/scripts` for `rescueGateTime(`: outside tests it is called only in `endingEvaluator.ts`, `sessionState.ts` and `calibration.ts`. Quote the search result
    - Run from `apps/web/`: `npx vitest --run 2>&1 | tee /tmp/sp-vitest.log`
    - Quote the Vitest summary line (passed/failed/skipped) in the task report
    - From `apps/web/`, `npx tsc --noEmit` (no new errors compared with the 1.1 baseline) and `npx vitest --run` pass, and `git status` shows no change under `services/physiology/` or `cases/`
    - _Requirements: 6.18, 6.19, 6.21, 6.22, 6.23, 6.24, 6.25, 6.26, 6.27, 12.18, 13.13, 13.16, 13.18_
    - _Properties: 24, 25_

  - [ ] 15.2 Fix 2: compute every Vital_Band from the Displayed_Value
    - Author's decision of 2026-11-25 (requirements "Dependencies and confirmed decisions" item 7, design D10). Follow the design sections "vitals.ts", "vitalBands.ts", "avatarMapper.ts", "statusSelector.ts", "Session page refactor" (Displayed values) and "Calibration run" (Record)
    - `apps/web/src/lib/vitals.ts`: add the single `DISPLAY_PRECISION` table (heart rate, respiratory rate, MAP, EtCO2 and tidal volume: scale 1, 0 decimals; SpO2: scale 100, 1 decimal; 15.13), `displayedValue(vital, raw)` (`Number((raw * scale).toFixed(decimals)) / scale`, `-0` written as `0`, `undefined` for a non-finite raw value or result; 15.15), `formatVital(vital, raw)` (text written from the Displayed_Value, `""` without one; 15.14, including the negative-zero exception: "0" for a whole-number vital with raw above -0.5 and below 0, "0.0" for SpO2 with raw above -0.0005 and below 0) and `readDisplayedVital(sample, vital)`. These are UI display constants, not clinical values
    - `apps/web/src/components/VitalSign.tsx`: take `vital: VitalName` and the raw value in place of `value` and `decimals`, and write the text with `formatVital`. `apps/web/src/components/ClinicianView.tsx`: pass the raw values (no `* 100` for SpO2), and replace the local `alarmFor` with an exported pure `clinicianAlarmState(alarms, vital, raw)`: `undefined` while `alarms` is `null`, `normal` for a vital without thresholds, otherwise `getAlarmState(displayedValue(vital, raw), threshold)`; a raw value with no Displayed_Value gets the neutral style (15.15). Neither file keeps a `toFixed` or a `* 100`
    - Pass the Displayed_Value to every Vital_Band caller (15.16): the band loop in `avatarMapper.ts` uses `readDisplayedVital`, while the breathing and heartbeat periods and the breathing depth keep the raw `readVital` value; `statusItemMatches` in `statusSelector.ts` uses `readDisplayedVital`; `bandsOf` in `calibration.ts` uses `readDisplayedVital`, so `overallStatusOf`, the early-versus-none comparison and `statusRuleReport` follow
    - Must not change: `getAlarmState` and `getVitalBand`; `conditionHolds`, the Time_Limit check and every other part of the Ending_Evaluator, which keep raw values (15.18); the raw Mark_Sample values in the calibration record's sample tables (13.19); the raw tidal volume in `sessionState.ts`
    - Shared functions carry the change to other specs: the bedside-exam Exam_Rule `vitals` conditions (`examFinding.ts`, through `statusItemMatches`) and the engine-mcp record bands, Overall_Status and D23 early comparison (through `bandsOf`). Their existing tests must still pass. Change a test only where its fixture or reference model computed a band from a raw value: point the reference model at `displayedValue`, or move the fixture raw value at least one display step (1, or 0.001 for SpO2) away from a bound, as the design's test-offset note says. Do not change what such a test asserts otherwise. Report each changed test. Tests that call `getAlarmState` or `getVitalBand` directly with `boundary ± offset` stay as they are
    - Extend `apps/web/src/lib/vitals.test.ts`:
      - the `DISPLAY_PRECISION` values of 15.13
      - raw RR 11.9999 → Displayed_Value 12, text "12", and band (`normal`, `none`) through `mapAvatar` and `clinicianAlarmState` (15.17); raw SpO2 0.974 → text "97.4"; raw SpO2 0.9496 → Displayed_Value 0.95, text "95.0", SpO2 band `normal`, while `conditionHolds({ vital: 'spO2', op: '>=', value: 0.95 }, sample)` is false (15.18)
      - `NaN`, `±Infinity` and a missing field give no Displayed_Value and `""` as text; the two negative-zero cases of 15.14
      - single definition (15.19): a text search of `VitalSign.tsx` and `ClinicianView.tsx` finds no `toFixed` and no `* 100`, and `displayedValue` and `formatVital` read `DISPLAY_PRECISION`
      - **Property 26: Readouts and Vital_Bands come from one Displayed_Value** (generated vital names and finite raw values with magnitude at most 1e9: `formatVital(v, raw)` equals `formatVital(v, displayedValue(v, raw))`, `displayedValue` applied twice equals applied once; for generated samples and thresholds, the bands from `mapAvatar(...).bands`, `statusItemMatches`, `bandsOf` and `clinicianAlarmState` equal `getVitalBand(displayedValue(vital, raw), threshold)`, state only for `clinicianAlarmState`). Tag: `// Feature: play-mode, Property 26: Readouts and Vital_Bands come from one Displayed_Value`
    - Update the reference models of the existing **Property 3** (`avatarMapper.test.ts`) and **Property 10** (`statusSelector.test.ts`, including the bedside-exam `statusItemMatches` property that shares `refItemMatches`) to compute states from the Displayed_Value and rates from raw values. Keep their tags
    - Extend `apps/web/src/components/ClinicianView.test.tsx` and `sharedControls.test.tsx`: the existing readout texts are unchanged (for example "72", "97.4", "95" for the baseline sample), raw RR 11.9999 shows "12" with no warning colour, and `VitalSign` without an alarm state keeps the neutral style
    - Use fast-check with `PBT_PARAMS` from `src/test/pbt.ts`, as the existing property tests do
    - Run from `apps/web/`: `npx vitest --run 2>&1 | tee /tmp/sp-vitest.log`
    - Quote the Vitest summary line (passed/failed/skipped) in the task report
    - From `apps/web/`, `npx tsc --noEmit` (no new errors compared with the 1.1 baseline) and `npx vitest --run` pass, and `git status` shows no change under `services/physiology/` or `cases/`
    - _Requirements: 1.7, 4.1, 4.2, 5.2, 5.3, 5.4, 13.17, 13.19, 15.7, 15.8, 15.13, 15.14, 15.15, 15.16, 15.17, 15.18, 15.19_
    - _Properties: 2, 3, 10, 26_

  - [ ] 15.3 Test the Play_View Intervention buttons after a Decompression and during a fork
    - Test-only. Files: `apps/web/src/components/PlayView.test.tsx` and, for the Clinician_View check, `apps/web/src/components/ClinicianView.test.tsx`. If a test shows a defect in `PlayView.tsx` or `ClinicianView.tsx`, stop and report; do not change component code in this task
    - 8.15: build a state with `sessionReducer` (case loaded, connected, a sample, Ending `none`), then an `interventionSucceeded` for `needle-decompression-left`. `interventionsDisabled({ connected: true, interventionPending: false, forkPending: false, ending: 'none' })` is `false`, and the rendered Play_View markup shows the left button enabled (no "Not available right now"). Check that `InterventionsDisabledInput` has exactly the keys `connected`, `interventionPending`, `forkPending` and `ending`, so no Intervention_Record entry can disable a button
    - 8.16: with the Vitals_Stream connected, no Intervention pending and the Ending `none`, `interventionsDisabled` is `true` while `forkPending` is `true`, and `false` again once `forkPending` is `false`, both after a `forkSucceeded` state (Ending `none`) and after a failed fork (state unchanged, no action dispatched). The `finally` in the Play_View's `fork` wrapper clears `forkPending` on both paths; read it and state this in the report
    - Clinician_View unchanged: its `interventionsDisabled(connected, pending)` takes no fork input (two parameters) and keeps the results the existing test checks
    - Run from `apps/web/`: `npx vitest --run 2>&1 | tee /tmp/sp-vitest.log`
    - Quote the Vitest summary line (passed/failed/skipped) in the task report
    - From `apps/web/`, `npx tsc --noEmit` (no new errors compared with the 1.1 baseline) and `npx vitest --run` pass, and `git status` shows no change under `services/physiology/` or `cases/`
    - _Requirements: 7.7, 8.9, 8.10, 8.15, 8.16, 12.18_

  - [ ] 15.4 Record a new calibration run and measure open question 1(e) (ONE-TIME RECORDING RUN)
    - Runs after 15.1 and 15.2 are done (13.20). Needs the running Physiology_Service. Never start, stop or restart it; if it is not reachable, ask the user to start it in their own terminal or to give its URL through `PHYSIOLOGY_URL`
    - Use the `stitched-patient-engine` MCP tools (`tool::stitched-patient-engine::list_cases`, `run_scenario`, `run_calibration`). Kiro asks for approval before each `run_scenario` and `run_calibration` call. Read the Variant ids and the affected-side Intervention of each Variant from `list_cases` (expected Variants `left` and `right`, with `needle-decompression-left` and `needle-decompression-right`)
    - (a) `run_calibration` with `case_id: "adult-tension-pneumothorax"`, default Decompression times and `write: false`. Report per Variant: the three Calibration_Checks with pass or fail; the `affected-side-early` Rescue_Gate_Time (expected `null`, "closed") and its Ending with time; the Vital_Band (Alarm_State and direction) of every vital at t = 0 (expected respiratoryRate `normal`, `none`)
    - If the `affected-side-early` Rescue_Gate_Time is not `null` or the t = 0 respiratoryRate band is not `normal` in any Variant, stop before (c) and report it as a defect in 15.1 or 15.2. A failing Calibration_Check alone does not stop the task: report it, and the record marks the values NOT calibrated (13.8)
    - (b) Open question 1(e): `run_scenario` once per Variant with the affected-side Decompression at 20 s and again at 150 s (`interventions` with `at_seconds` 20 and 150), `max_seconds: 600`, `sample_interval_seconds: 10`. Report per Variant: the Rescue_Gate_Time (expected 150 under 6.25), the Ending and its time, and HR, SpO2, MAP and RR at 150, 200, 250 and 300 s next to the `affected-side` Scenario of the same Variant from (a)
    - Write the measured answer under open question 1, item (e) in `.kiro/specs/play-mode/requirements.md`, with the date and the commit (`git rev-parse --short HEAD`): whether the second Decompression takes effect in Pulse, per Variant, with the numbers of (b). Keep the text of item (e) and every `TODO(author)` marker. This is the only spec edit in this task
    - (c) `run_calibration` with `write: true`, exactly once, with the same arguments as (a). Report the path of the new record under `docs/calibration/` and its index line (13.20)
    - CLI fallback: if an MCP call times out or the server is not available, run the Engine_CLI from `apps/web/` with execute_bash and a timeout of at least 1800000 ms: `./node_modules/.bin/vite-node --config vitest.config.ts scripts/engineCli.ts -- calibrate --case adult-tension-pneumothorax [--write]` and `./node_modules/.bin/vite-node --config vitest.config.ts scripts/engineCli.ts -- run-scenario --case adult-tension-pneumothorax --variant <id> --max-seconds 600 --interval 10 --intervention <affected-side id>@20 --intervention <affected-side id>@150`. If the run needs longer, ask the user to run it in their own terminal. If execute_bash reports a timeout, read the output and the record files before retrying
    - If a check fails, report it. Do not change any case value, threshold or check to make it pass (engine-mcp 13.3). Remove no `TODO(author)` marker (13.10)
    - From `apps/web/`, `npx tsc --noEmit` (no new errors compared with the 1.1 baseline) and `npx vitest --run` pass, and `git status` shows no change under `services/physiology/` or `cases/` (only the new files under `docs/calibration/` and the 1(e) edit in `requirements.md` are expected)
    - _Requirements: 13.1, 13.2, 13.4, 13.8, 13.9, 13.10, 13.13, 13.15, 13.16, 13.17, 13.18, 13.19, 13.20, 14.3, 14.7, 15.17_

## Notes

- Tasks are ordered by dependency: tooling and types → Alarm_Function → pure logic → API timeouts → case schema and case file → session state and hook → shared shell and Clinician view → Play components → wiring → calibration → acceptance checklist → final check
- Run order differs from document order for group 10: 10.7 and 10.8 run before 10.6, because the Ending_Screen shows the redrawn Avatar. The order is 10.5, 10.7, 10.8, then 10.6.
- Task 11.3 (the rescue gate) was added after group 11 was done; it runs after 11.2 and before 12.1, because the calibration script uses its helpers. The order is 11.1, 11.2, 11.3, then 12.1.
- Group 15 (calibration fixes of 2026-11-25) was added after task 11.3 was done. It does not depend on groups 12 to 14, so it can run as soon as 11.3 is done, in the order 15.1, 15.2, 15.3, 15.4. Task 15.4 is the new calibration run that Requirement 13.20 requires after 15.1 and 15.2. Run the final check 14.1 after group 15.
- Every task is required. There are no optional tasks and no `*` markers
- Tests live in the task that implements the code they test. There are no separate "write tests" tasks. Each property test sits in the task that implements its function and carries the tag `// Feature: play-mode, Property N: <title>`
- Each task references its requirement numbers and, where it has any, the design's property numbers
- The implementation language is TypeScript (Next.js App Router, React, Vitest), as in the design
- Clinical safety: the case-file values in task 7.2 are drafts from engine runs. Every one keeps its `TODO(author)` marker until the author reviews it and adds a citation. No task invents clinical content or removes a marker

### Coordination with the core-simulation-loop session

- Tasks run one at a time, and only when the user sends "Start task N". Do not start the next task on your own
- The core-simulation-loop spec owns `services/physiology/`, `docker-compose.yml` and `.kiro/specs/core-simulation-loop/tasks.md`. Its clock and WebSocket tasks run next. No play-mode task edits those files. Running the physiology image with `docker compose run` or `docker compose build` is allowed; editing the compose file is not
- This spec owns `apps/web/src/lib/alarms.ts`. Task 2.1 changes it in one small step so the core session can rebase onto it
- `apps/web/package-lock.json` is created in task 1.1 and must be kept and committed with that change. The core spec's deployment work relies on it

### Runtime

- Node v22 on the host provides global `fetch` and `WebSocket`; the web Docker image uses Node 20 with `npm ci`
- Vitest runs in the `node` environment without a DOM. Component tests use `renderToStaticMarkup` from `react-dom/server`. Logic inside hooks is tested through exported pure helpers
- Vitest does not type-check. Tasks that change types, hooks or components also run `npx tsc --noEmit` and compare with the baseline recorded in task 1.1
- Python dependencies for `scripts/validate-case.py` are not installed on the host. Case validation runs inside the physiology image with the commands given in tasks 7.1, 7.2 and 14.1
- Until the core spec's clock task lands, the service ignores Playback_Speed and advances one simulated second per wall-clock second. The calibration run in task 12.3 therefore takes about 10 minutes

### Test Execution Rules

- Every task that adds or changes code ends with: from `apps/web/`, `npx vitest --run 2>&1 | tee /tmp/sp-vitest.log`
- Quote the Vitest summary line (passed/failed/skipped) in the task report
- If any test is skipped, report it as a problem to investigate
- The web test suite opens no HTTP or WebSocket connection and needs neither the Physiology_Service nor Pulse. `apps/web/scripts/` is outside the Vitest `include` pattern
- Property tests use `PBT_PARAMS` from `src/test/pbt.ts` (fixed seed, 100 runs)
- If execute_bash reports a timeout, read the log or file before retrying. The command may have finished
- Edit files only with your edit tools, never with execute_bash. This includes temporary copies under `/tmp/sp-cases/`
- Never start long-running processes (dev servers, watchers, `docker compose up`). Ask the user to start them in their own terminal

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2"] },
    { "id": 2, "tasks": ["2.1"] },
    { "id": 3, "tasks": ["2.2"] },
    { "id": 4, "tasks": ["3.1"] },
    { "id": 5, "tasks": ["3.2"] },
    { "id": 6, "tasks": ["3.3"] },
    { "id": 7, "tasks": ["4.1"] },
    { "id": 8, "tasks": ["4.2"] },
    { "id": 9, "tasks": ["5.1"] },
    { "id": 10, "tasks": ["5.2"] },
    { "id": 11, "tasks": ["5.3"] },
    { "id": 12, "tasks": ["5.4"] },
    { "id": 13, "tasks": ["6.1"] },
    { "id": 14, "tasks": ["7.1"] },
    { "id": 15, "tasks": ["7.2"] },
    { "id": 16, "tasks": ["8.1"] },
    { "id": 17, "tasks": ["8.2"] },
    { "id": 18, "tasks": ["8.3"] },
    { "id": 19, "tasks": ["9.1"] },
    { "id": 20, "tasks": ["9.2"] },
    { "id": 21, "tasks": ["9.3"] },
    { "id": 22, "tasks": ["10.1"] },
    { "id": 23, "tasks": ["10.2"] },
    { "id": 24, "tasks": ["10.3"] },
    { "id": 25, "tasks": ["10.4"] },
    { "id": 26, "tasks": ["10.5"] },
    { "id": 27, "tasks": ["10.6"] },
    { "id": 28, "tasks": ["10.7"] },
    { "id": 29, "tasks": ["10.8"] },
    { "id": 30, "tasks": ["11.1"] },
    { "id": 31, "tasks": ["11.2"] },
    { "id": 32, "tasks": ["11.3"] },
    { "id": 33, "tasks": ["12.1"] },
    { "id": 34, "tasks": ["12.2"] },
    { "id": 35, "tasks": ["12.3"] },
    { "id": 36, "tasks": ["13.1"] },
    { "id": 37, "tasks": ["14.1"] },
    { "id": 38, "tasks": ["15.1"] },
    { "id": 39, "tasks": ["15.2"] },
    { "id": 40, "tasks": ["15.3"] },
    { "id": 41, "tasks": ["15.4"] }
  ]
}
```
