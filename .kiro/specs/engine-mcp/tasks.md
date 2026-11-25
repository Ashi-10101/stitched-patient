# Implementation Plan: Engine MCP

## Overview

This plan implements the engine-mcp spec: one Scenario_Runner behind SDK-free tool handlers, a stdio Engine_MCP_Server and an Engine_CLI over those handlers, the Calibration_Record, four Kiro hooks, the MCP_Config, two steering files, documentation, the Requirement 14 pointer lines, the in-Kiro verification, and one recorded calibration run of the shipped case. It follows `requirements.md` and `design.md` in this directory. Property numbers refer to the design's "Correctness Properties" section.

The 8 tasks are the design's "Planned task split", in that order. The Requirement 14 pointer lines name tasks 2, 5 and 8, so the numbers must not change. The only checkpoint is sub-task 6.5, before the in-Kiro checks.

Every task and sub-task is required; none is optional. Every sub-task ends with the end commands below passing, and the task report quotes them:

- From `apps/web/`: `npx tsc --noEmit > /tmp/sp-tsc.log 2>&1; echo "exit $?"` and `npx vitest --run 2>&1 | tee /tmp/sp-vitest.log`. Quote the tsc result and the Vitest summary line (passed/failed/skipped). A skipped test is a problem to investigate
- From the repository root: `git status --short services/physiology cases` prints nothing (18.1, 18.4)

Only task 8 needs the Physiology_Service running. Steps that need the user are marked **Needs the user:**.

## Tasks

- [x] 1. Dev dependencies, HTTP client, Session slots and the Fake_Service
  - [x] 1.1 Add `@modelcontextprotocol/sdk`, `zod` and `vite-node` as dev dependencies
    - Files: `apps/web/package.json`, `apps/web/package-lock.json`. No other file changes
    - Before any change, run the end commands once and record the tsc result as the baseline. If tsc or Vitest fails before any change, stop and report; do not fix unrelated errors
    - Open item O1, part 1: `npm view @modelcontextprotocol/sdk@1.32.2 peerDependencies dependencies` (read-only). If the SDK's `zod` range accepts `zod` 4, use `zod@4.6.7`; otherwise use the newest `3.25.x` (design D16). The code imports `zod/v4` either way
    - From `apps/web/`: `npm install --save-dev --save-exact vite-node@1.6.1 @modelcontextprotocol/sdk@1.32.2 zod@<version chosen above>` (D20). This needs the npm registry. Then `npm ls vite-node vitest @modelcontextprotocol/sdk zod` must show one `vite-node@1.6.1` and no invalid or missing peer
    - The three packages go into `devDependencies` only. `dependencies` stays byte-identical (18.2). No module imported by the Next.js app imports any of them
    - Quote the chosen `zod` version with the peer range, the `npm ls` output and the `package.json` diff (`git diff apps/web/package.json`) in the task report
    - End commands as in the Overview
    - _Requirements: 18.2, 18.6_

  - [x] 1.2 Implement `engineClient.ts` and `engineSlots.ts` with `engineSlots.test.ts`
    - Files: `apps/web/src/lib/engineClient.ts` (new), `apps/web/src/lib/engineSlots.ts` (new), `apps/web/src/lib/engineSlots.test.ts` (new). No other file changes
    - `engineClient.ts` as in the design sections "`engineClient.ts`" and "HTTP client (`engineClient.ts`)" of Error Handling: `FetchLike`, `VitalsSocket`, `SocketFactory`, `EngineErrorKind`, `EngineError`, `parseServiceUrl`, `parseSessionCap`, `unreachableMessage`, `vitalsUrl`, `PhysiologyClient` and `createPhysiologyClient`, with the error mapping (unreachable, timeout, cancelled, http with the `{id}` path template) and `AbortSignal.any` with `AbortSignal.timeout`
    - Also define `EngineClock` here (design "`engineRunner.ts`" shows the interface), because the fake clock of task 1.3 needs it before task 3. Task 3 re-exports it from `engineRunner.ts`
    - Constants (design "Constants"): export each from the first module that uses it. In this task: `DEFAULT_SERVICE_URL`, `DEFAULT_SESSION_CAP`, `HEALTH_TIMEOUT_MS`, `REQUEST_TIMEOUT_MS`, `CREATE_SESSION_TIMEOUT_MS`, `CLEANUP_REQUEST_TIMEOUT_MS`, `SHUTDOWN_BUDGET_MS` and `KEBAB` in `engineClient.ts`
    - `engineSlots.ts` as in the design section "`engineSlots.ts`": `createSessionSlots(cap)` (FIFO, abortable waits, double release is a no-op) and `createSessionRegistry()`
    - The engine modules import no `node:` module, no SDK, no `zod`, and no global `fetch`, `WebSocket`, clock or file system (D17)
    - `engineSlots.test.ts`: FIFO order, release twice is a no-op, abort while queued leaves the queue and rejects with kind `cancelled` (7.3, 7.4)
    - End commands as in the Overview
    - _Requirements: 1.4, 1.6, 1.7, 1.9, 6.5, 7.1, 7.2, 7.3, 7.4, 17.7_

  - [x] 1.3 Add the Fake_Service and the fake clock, and test the client against them
    - Files: `apps/web/src/test/fakeClock.ts` (new), `apps/web/src/test/fakePhysiologyService.ts` (new), `apps/web/src/lib/engineClient.test.ts` (new). No other file changes
    - `fakeClock.ts` and `fakePhysiologyService.ts` as in the design sections "Fake_Service" and "Test doubles": virtual time with `advance` and `runUntilSettled`; ticks at `1000 / speed` ms while playing, a paused re-send at 1 Hz with an unchanged `simulation_time`, pause on the last socket close, a manual Checkpoint `After <label>` at the current time per Intervention, `variant_id` echo, 404 and 400 errors, close code 1008 for an unknown session, and every scripted failure of the design table "Fake_Service scripts used". Cases come from `CASE_LEFT` and `CASE_RIGHT` in `src/test/caseFixtures.ts`. Vitals come from a formula each test passes in; no case value is derived from them
    - The Fake_Service opens no socket and listens on no port (17.7)
    - `engineClient.test.ts`, the rows of the design table "Test files" for this file: `parseServiceUrl` and `parseSessionCap` accept and reject values and name the value and the range (1.9, 7.2); the `unreachableMessage` text; `vitalsUrl`; the error mapping (1.6, 1.7, timeouts through `TimeoutError`, Fake_Service `unreachable` and `healthDelayMs`); every request URL starts with the Service_URL (1.4)
    - Do not edit `src/test/generators.ts`, `caseFixtures.ts` or `pbt.ts`; they are existing modules (18.4)
    - End commands as in the Overview
    - _Requirements: 1.4, 1.6, 1.7, 1.9, 7.2, 17.7_

- [x] 2. Calibration helpers in `calibration.ts` (supersedes play-mode task 12.1)
  - [x] 2.1 Implement `apps/web/src/lib/calibration.ts` with its example tests
    - Files: `apps/web/src/lib/calibration.ts` (new), `apps/web/src/lib/calibration.test.ts` (new). No other file changes
    - Implement every export of the design section "`calibration.ts`": `markSamples`, `createOutcomeFold` (D3: gate changes applied in record order before the first Mark_Sample with mark at or after the entry's Actual_Time; Mark_Samples evaluated with `simulation_time` set to their mark), `scenarioOutcome` (the same fold, post hoc), `checkAffectedRescued`, `checkLostNeverRescued`, `compareEarlyWithNone` (the D23 rule), `bandsOf`, `overallStatusOf`, `statusRuleReport`, `examRows`, `firstAbnormal`, `sideDifference`, and the constant `DEMO_RESCUE_BOUND_SECONDS`
    - Import the shipped functions listed for this module in the design table "Modules" (`endingEvaluator`, `statusSelector`, `vitalBands`, `examFinding`, `sides`, `vitals`). Copy none of their logic (1.2)
    - `calibration.test.ts` examples, from the design table "Test files": the three Calibration_Checks pass and fail with their basis text (9.5); `compareEarlyWithNone` with and without a worse Alarm_State (D23, 9.6, 9.7); `statusRuleReport` matched versus returned, and `onlyDefault`; `examRows` and `firstAbnormal`, and `[]` without an Exam_Section (5.2, 5.3, 9.9); `sideDifference` (9.10). Expected values come from the case fixtures or from the test's own synthetic numbers; no test hard-codes a clinical value
    - Clinical safety: this task writes no clinical text. Status_Sentences and Exam_Finding sentences come from the Resolved_Case unchanged
    - End commands as in the Overview
    - _Requirements: 1.2, 4.6, 4.8, 5.1, 5.2, 5.3, 5.4, 9.5, 9.6, 9.7, 9.8, 9.9, 9.10, 9.13_

  - [x] 2.2 Write the property test for Mark_Samples
    - Files: `apps/web/src/lib/calibration.test.ts`. No other file changes
    - **Property 4: Mark_Samples cover every Sample_Mark**. Generate strictly increasing kept times starting at 0, with gaps, and intervals from 1 to 60. `fc.assert(..., PBT_PARAMS)` from `src/test/pbt.ts`
    - Tag: `// Feature: engine-mcp, Property 4: Mark_Samples cover every Sample_Mark`
    - End commands as in the Overview
    - _Requirements: 4.8, 5.1_
    - _Properties: 4_

  - [x] 2.3 Write the property test for the outcome fold
    - Files: `apps/web/src/lib/calibration.test.ts`. No other file changes
    - **Property 5: The incremental outcome fold equals the post-hoc fold**. Use `arbSampleSequence` from `src/test/generators.ts` (unchanged), `CASE_LEFT` and `CASE_RIGHT`, and Runner_Intervention_Record entries with Actual_Times that do not decrease, for the fixture's Required_Interventions and other Interventions. Compare the incremental fold, `scenarioOutcome` and the reference evaluation of the property text. `fc.assert(..., PBT_PARAMS)`
    - Tag: `// Feature: engine-mcp, Property 5: The incremental outcome fold equals the post-hoc fold`
    - End commands as in the Overview
    - _Requirements: 4.6, 4.7, 5.4, 5.5_
    - _Properties: 5_

- [x] 3. Scenario_Runner in `engineRunner.ts`
  - [x] 3.1 Implement `apps/web/src/lib/engineRunner.ts` with its example tests
    - Files: `apps/web/src/lib/engineRunner.ts` (new), `apps/web/src/lib/engineRunner.test.ts` (new). No other file changes
    - Implement the design sections "`engineRunner.ts`", "One Scenario", "Message loop", "Cleanup and cancellation" (per Scenario and per call), "Mark rows" and "Scenario_Result", and the Error Handling sections "Vitals_Stream" and "Scenario_Runner": `runScenario`, `validatePlan`, `buildScenarioResult`, the Actual_Time procedure of D2 (Checkpoint list before and after each Intervention_API call), the approach speed of D26, the stall timer and the first-sample wait, and the `finally` cleanup (pause, close, DELETE with the 4 s timeout, `undeleted_sessions`, original error rethrown)
    - Re-export `EngineClock` from `engineClient.ts`. Constants of this module: `STALL_TIMEOUT_MS`, `FIRST_SAMPLE_TIMEOUT_MS`, `RUN_SPEED`, `APPROACH_SPEED`, `APPROACH_WINDOW_S`
    - The `outputSchema` check of `ScenarioResult` waits for `ScenarioResultSchema` in task 5.1, because only `engineTools.ts` may import `zod`
    - `engineRunner.test.ts` examples, all on the Fake_Service and the fake clock: the 17.1 list (the `variant_id` sent, and the mismatch; Planned_Interventions at 0, later, at the same time, and late with `lateTicksAfterPause`; the Actual_Time from the Checkpoint list; repeated paused samples ignored; a substituted Mark_Sample; `stop_at_ending`; the gate applied at the right sample); the start order of 4.1 from the call log; the result fields of 5.1 to 5.6
      - **Property 7: Every Scenario ends with its Session deleted and the original outcome**: one example per way of ending (success, `stop_at_ending`, an Intervention_API HTTP error, a Vitals_Stream close, an error message, the Stall_Timeout, an exception in `buildScenarioResult`, cancellation through the `AbortSignal` with every DELETE within 5 s of fake time, and a queued Scenario cancelled before it starts that creates no Session). Tag on the test group: `// Feature: engine-mcp, Property 7: Every Scenario ends with its Session deleted and the original outcome`
      - **Property 8: Equal Fake_Service scripts give equal Scenario_Results**: run the scripts of the 17.1 tests twice on fresh Fake_Services and compare deep equality and `JSON.stringify`. Tag on the test group: `// Feature: engine-mcp, Property 8: Equal Fake_Service scripts give equal Scenario_Results`
    - End commands as in the Overview
    - _Requirements: 3.3, 3.4, 3.5, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 6.1, 6.2, 6.4, 6.5, 7.4, 12.3, 17.1, 17.2, 17.7_
    - _Properties: 7, 8_

  - [x] 3.2 Write the property test for the Session_Cap
    - Files: `apps/web/src/lib/engineRunner.cap.test.ts` (new). No other file changes
    - **Property 2: The Session_Cap holds and every created Session is deleted**. `fc.asyncProperty` with 1 to 12 Scenarios across one to three calls, caps from 1 to 8, and a mix of scripted outcomes per Scenario (success, Intervention_API error, socket close, DELETE failure, cancellation of its call). Max_Time 1 to 5 s per Scenario. Check the five bullets of the property text with the Fake_Service's `maxConcurrentSessions`, `calls` and `deleted`. `fc.assert(..., PBT_PARAMS)`
    - Tag: `// Feature: engine-mcp, Property 2: The Session_Cap holds and every created Session is deleted`
    - End commands as in the Overview
    - _Requirements: 6.1, 6.4, 6.5, 7.1, 7.3, 17.4_
    - _Properties: 2_

- [ ] 4. Calibration plan, evaluation and the Calibration_Record
  - [ ] 4.1 Implement `apps/web/src/lib/engineCalibration.ts` with its tests
    - Files: `apps/web/src/lib/engineCalibration.ts` (new), `apps/web/src/lib/engineCalibration.test.ts` (new). No other file changes
    - Implement the design sections "`engineCalibration.ts`", "The eight calibration Scenarios", "Calibration_Checks per Variant", "Calibration evaluation" (including `VariantEvaluation`, `CalibrationEvaluation` and `CalibrationSummary`) and the Error Handling section "Calibration": `SCENARIO_KINDS`, `readCaseFileFacts` (with the existing `yaml` devDependency), `preflightCalibration`, `planCalibration`, `decompressionFor` (by action and side, never by id), `OVERRIDE_TARGET_PLAY_PATHS`, `comparePlayWithCaseFile`, `runCalibration` (the first Scenario error aborts a call-internal controller and is rethrown with the Scenario name) and `evaluateCalibration`
    - Constants of this module: `CALIBRATION_SAMPLE_INTERVAL`, `DEFAULT_DEMO_DECOMPRESSION_TIME`, `DEFAULT_EARLY_DECOMPRESSION_TIME`, `DECOMPRESSION_CHECK_COMMIT`
    - `engineCalibration.test.ts`, the row of the design table "Test files": `readCaseFileFacts(CASE_TEXT)`; each preflight error with zero Fake_Service calls (8.5); `planCalibration` gives the 8-row table (8.2, 8.7 to 8.9); `decompressionFor` for both roles and Variants and the missing-side error (8.4, 8.6); `comparePlayWithCaseFile` gives `null` for both fixtures, the path for one changed field, and ignores Override_Targets (8.10, 8.11); the first Scenario error stops the others and every Session is deleted (8.12); `evaluateCalibration` on synthetic results
    - End commands as in the Overview
    - _Requirements: 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9, 8.10, 8.11, 8.12, 9.2, 9.3, 9.5, 9.6, 9.7, 9.10, 9.11_

  - [ ] 4.2 Implement `apps/web/src/lib/calibrationRecord.ts` with its tests
    - Files: `apps/web/src/lib/calibrationRecord.ts` (new), `apps/web/src/lib/calibrationRecord.test.ts` (new). No other file changes
    - Implement the design sections "`calibrationRecord.ts`", "Record_Header", "Record_Body layout" (with its rules for the body), "Calibration_Index" and the Error Handling section "Record writer": `GitInfo`, `RecordHeader`, `SAFETY_NOTICE`, `NOT_ADVICE`, `NOT_CALIBRATED_LINE`, `ALL_PASSED_LINE`, `DECIMALS`, `renderRecordHeader`, `renderRecordBody`, `renderCalibrationRecord`, `RecordFs`, `recordFileName`, `indexLine`, `assertCalibrationPath` and `writeCalibrationRecord`
    - The record holds only the fixed texts of the design, engine numbers, and sentences quoted exactly from the Resolved_Case (9.13). No other prose
    - `calibrationRecord.test.ts`, the 17.5 list on synthetic Scenario_Results and an in-memory `RecordFs`: each item of Requirement 9; "NOT calibrated" only on failure; the 4.18 flag only when the early Scenario shows no worsening; `SAFETY_NOTICE === SAFETY_NOTICE_TEXT`
      - **Property 9: The Record_Body is deterministic and free of ids and clock values**: two renderings are identical, and the body contains none of the marker ids (`SESSION-MARKER` and similar), the date, the commit or the Service_URL; vital values use `DECIMALS`. Tag on the test group: `// Feature: engine-mcp, Property 9: The Record_Body is deterministic and free of ids and clock values`
      - **Property 10: Record writes stay in `docs/calibration/` and never overwrite**: the file name, the `-2` and `-3` suffixes, the Calibration_Index creation and append, existing files unchanged, and `assertCalibrationPath` rejecting `..` segments, other absolute paths, nested directories and empty names. Tag on the test group: `// Feature: engine-mcp, Property 10: Record writes stay in docs/calibration/ and never overwrite`
    - End commands as in the Overview
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9, 9.10, 9.11, 9.12, 9.13, 10.2, 10.3, 10.4, 10.5, 12.1, 12.2, 17.5_
    - _Properties: 9, 10_

- [ ] 5. Tool handlers, Node adapters, Engine_MCP_Server and Engine_CLI (with tasks 3 and 4, supersedes play-mode task 12.2)
  - [ ] 5.1 Implement `apps/web/src/lib/engineTools.ts` with its example tests
    - Files: `apps/web/src/lib/engineTools.ts` (new), `apps/web/src/lib/engineTools.test.ts` (new), `apps/web/src/lib/engineRunner.test.ts` (adds the `outputSchema` check only). No other file changes
    - Implement the design sections "`engineTools.ts`", "Progress notifications", "Per-call flow of the tools", "Tool inputs and outputs" and "CLI options": the `zod/v4` schemas `ListCasesInput`, `RunScenarioInput` (with the `at_seconds <= max_seconds` refinement) and `RunCalibrationInput`; `ScenarioResultSchema`; `TOOL_DEFINITIONS` with the published descriptions and the JSON Schemas from `z.toJSONSchema`; `createEngineTools` with the D27 order (validation, local preflight, Health_Check, Sessions); `toScenarioRequest`; `formatIssues`; `parseCliArgs` (drops one leading `--`, O6), `CLI_USAGE` and `cliExitCode`. Constant of this module: `PROGRESS_INTERVAL_MS`
    - `engineTools.ts` is the only non-test module under `src/` that imports `zod` (18.3)
    - `run_calibration` reads `GitInfo` before the Scenarios start; Git failures make the header say "unknown" and do not fail the call
    - `engineTools.test.ts` examples: `TOOL_DEFINITIONS` has the three tools with descriptions and schemas (1.1); each tool returns the Unreachable_Error naming the Service_URL with only the `GET /` call recorded (1.6, 17.3); `list_cases` order and no Session (2.1, 2.2); `run_scenario` structured and text content are equal (5.7); `run_calibration` with `write` false makes no `RecordFs` call, and with `write` true returns both paths (10.1, 10.6); progress callbacks at least once per 10 s of fake time with increasing `progress` (8.13)
    - `engineRunner.test.ts`: add the check that a `ScenarioResult` from the 17.1 scripts parses with `ScenarioResultSchema` (design "Test files", row `engineRunner.test.ts`)
    - End commands as in the Overview
    - _Requirements: 1.1, 1.5, 1.6, 1.7, 2.1, 2.2, 3.1, 3.2, 5.7, 8.1, 8.13, 10.1, 10.6, 11.1, 11.4, 11.6, 17.3_

  - [ ] 5.2 Write the property test for input validation
    - Files: `apps/web/src/lib/engineTools.test.ts`. No other file changes
    - **Property 1: Invalid input fails before any request**. Start from a valid `run_scenario` or `run_calibration` input and apply one to three mutations (wrong type, missing required field, non-kebab id, `null` `variant_id`, out-of-range or non-whole number, more than 20 Planned_Interventions, an unknown field, `at_seconds` above `max_seconds`). The result has `isError: true` and names every mutated field path, and the Fake_Service records zero calls. `fc.assert(..., PBT_PARAMS)`
    - Tag: `// Feature: engine-mcp, Property 1: Invalid input fails before any request`
    - End commands as in the Overview
    - _Requirements: 1.5, 3.1, 3.2, 8.1, 17.4_
    - _Properties: 1_

  - [ ] 5.3 Write the CLI parser and exit-code example tests
    - Files: `apps/web/src/lib/engineCli.test.ts` (new). No other file changes
    - Examples: each subcommand and flag of 11.1; a bad `--intervention` (no `@`, or more than one); a leading `--` and none (O6); `cliExitCode` for every row of the design's Engine_CLI error table (11.4); usage on invalid input (11.5)
    - End commands as in the Overview
    - _Requirements: 11.1, 11.4, 11.5_

  - [ ] 5.4 Write the property test for CLI-to-tool equivalence
    - Files: `apps/web/src/lib/engineCli.test.ts`. No other file changes
    - **Property 3: CLI flags and tool arguments give equal Scenario requests**. Generate valid `run_scenario` and `run_calibration` argument objects with optional fields omitted at random, render them as flags in random order (keeping `--intervention` order), with or without a leading `--`, and compare the parsed inputs, `toScenarioRequest` of both, and the `CalibrationInput` of both. `fc.assert(..., PBT_PARAMS)`
    - Tag: `// Feature: engine-mcp, Property 3: CLI flags and tool arguments give equal Scenario requests`
    - End commands as in the Overview
    - _Requirements: 11.1, 11.6, 17.4_
    - _Properties: 3_

  - [ ] 5.5 Implement the Node adapters and the two entry points, and test the SDK behaviour
    - Files: `apps/web/scripts/engineStdout.ts` (new), `apps/web/scripts/engineNode.ts` (new), `apps/web/scripts/engineMcp.ts` (new), `apps/web/scripts/engineCli.ts` (new), `apps/web/src/lib/engineMcpSdk.test.ts` (new). No other file changes
    - Implement the design sections "`scripts/engineNode.ts`", "`scripts/engineMcp.ts`", "`scripts/engineCli.ts`" and the Error Handling sections "Engine_MCP_Server" and "Engine_CLI": `loadConfig`, `REPO_ROOT` (D18), `createNodeDeps` (global `fetch`, `new WebSocket(url)`, `node:fs/promises`, `GitInfo` through `execFile('git', ...)` with the three read-only commands of D24, the real clock, stderr logging) and `installShutdown` (6.3); `engineStdout.ts` imported first (D25); the low-level SDK `Server` with `ListToolsRequestSchema` and `CallToolRequestSchema` (D15); the CLI behaviour steps 1 to 4 and exit codes
    - `engineMcp.ts` is the only module that imports `@modelcontextprotocol/sdk` outside test files. The entry points start no process other than the three read-only `git` commands (1.8, conflict C1 in the Notes) and send no request that stops or restarts the service
    - Open item O1, part 2: read the installed SDK `.d.ts` files to confirm the import paths of `Server`, `StdioServerTransport`, the request schemas and `InMemoryTransport`, and the types of `extra.signal`, `extra.sendNotification` and `params._meta.progressToken`. Quote the paths in the task report
    - `engineMcpSdk.test.ts` (test files may import the SDK): with `InMemoryTransport.createLinkedPair()`, a low-level `Server` and `createEngineTools` over the Fake_Service lists 3 tools; `tools/call` returns `isError` results; `extra.signal` aborts on `notifications/cancelled` and no response arrives; `_meta.progressToken` reaches the handler and `notifications/progress` arrive
    - Smoke checks from `apps/web/`, none of which opens a network connection; quote each exit code and the relevant output in the task report:
      - `./node_modules/.bin/vite-node --config vitest.config.ts scripts/engineCli.ts -- run-scenario --case adult-tension-pneumothorax; echo "exit $?"` prints the usage to stderr and exits 2 (11.5)
      - `PHYSIOLOGY_URL=ftp://x ./node_modules/.bin/vite-node --config vitest.config.ts scripts/engineCli.ts -- list-cases; echo "exit $?"` names the invalid value and exits 2 (1.9)
      - `PHYSIOLOGY_URL=ftp://x ./node_modules/.bin/vite-node --config vitest.config.ts scripts/engineMcp.ts < /dev/null; echo "exit $?"` names the invalid value on stderr and exits 1 (1.9)
      - stdio check (1.3): pipe an `initialize` request (with the SDK's `LATEST_PROTOCOL_VERSION` from the installed types), the `notifications/initialized` notification and a `tools/list` request, then `sleep 2`, into `./node_modules/.bin/vite-node --config vitest.config.ts scripts/engineMcp.ts > /tmp/sp-mcp-out.log 2> /tmp/sp-mcp-err.log; echo "exit $?"`. Read `/tmp/sp-mcp-out.log` with the file tool: every line is one JSON-RPC message, and the `tools/list` result names exactly `list_cases`, `run_scenario` and `run_calibration`. `tools/list` sends no request to the Physiology_Service. The server exits after stdin closes
    - Do not start the server or the CLI in the background, and do not call a tool that reaches the service in this task
    - End commands as in the Overview
    - _Requirements: 1.1, 1.2, 1.3, 1.8, 1.9, 6.2, 6.3, 7.2, 8.13, 11.1, 11.2, 11.3, 11.4, 11.5_

  - [ ] 5.6 Write the boundary tests and list the build check for the reviewer
    - Files: `apps/web/src/lib/engineBoundaries.test.ts` (new). No other file changes
    - The four checks of the design row `engineBoundaries.test.ts`: (a) no non-test module under `src/` imports `@modelcontextprotocol/sdk` or `vite-node`; (b) the only non-test module under `src/` that imports `zod` is `src/lib/engineTools.ts`; (c) no non-test module under `src/` outside the engine modules (`engineClient`, `engineSlots`, `calibration`, `engineRunner`, `engineCalibration`, `calibrationRecord`, `engineTools`) imports any engine module; (d) the engine modules import no `node:` module. Also: `apps/web/package.json` lists the SDK, `zod` and `vite-node` only under `devDependencies` (18.2)
    - This task never runs `npx next build`: the build rewrites `apps/web/.next/`, which the dev server uses. The task report lists the 18.3 build check for the reviewer, who runs it in a separate copy of `apps/web` that does not share `apps/web/.next/`:
      - `npx next build > /tmp/sp-next.log 2>&1; echo "exit $?"`
      - `grep -rl "modelcontextprotocol" .next/; echo "grep exit $? (1 means no match)"`
      - The check passes when the build exits 0 and the grep finds no match
    - End commands as in the Overview
    - _Requirements: 1.2, 18.2, 18.3, 18.4_

- [ ] 6. Hook scripts, hook files, MCP_Config, steering files and the Kiro-file tests
  - [ ] 6.1 Write the hook scripts and the guard's type declaration
    - Files: `scripts/hooks/hookLib.mjs`, `scripts/hooks/case-check.mjs`, `scripts/hooks/web-related-tests.mjs`, `scripts/hooks/python-tests.mjs`, `scripts/hooks/compose-guard.mjs`, `scripts/hooks/compose-guard.d.mts` (all new, under the repository root). No other file changes
    - Implement the design section "Hooks" and the Error Handling section "Hooks": `hookLib.mjs` (`REPO_ROOT`, `readStdinJson`, `savedRepoPath` for absolute, relative and outside paths, `run` with `spawn` and no shell, `requireImage`, `failWith`); each file hook filters the saved path itself and exits 0 without output when it does not match (D21); `case-check.mjs` with `-T` and `-e PYTHONDONTWRITEBYTECODE=1` (D22, C2); `web-related-tests.mjs` with `--passWithNoTests` (C2); `python-tests.mjs` with the verified command of F2; `compose-guard.mjs` exporting `findBlockedCompose` and running `main` only when executed directly
    - Docker rules: the scripts use only `docker image inspect` and `docker compose run -T --rm --no-deps`. They pass no `--build` or `--service-ports` and contain no `docker compose up`, `down`, `stop` or `restart` (15.8, 18.5). This task runs no docker command and does not run the file hooks on a matching path
    - Type-check of the cross-package import (used by `kiroFiles.test.ts` in tasks 6.3 and 6.4): `compose-guard.d.mts` declares `export function findBlockedCompose(text: string): string | null;`. The test imports `../../../../scripts/hooks/compose-guard.mjs` statically. With `moduleResolution: "bundler"`, TypeScript resolves a `.mjs` import to the sibling `.d.mts` before the `.mjs` file, so `npx tsc --noEmit` type-checks the test against the declaration and does not analyse the JavaScript (no `checkJs` change; `tsconfig.json` stays unchanged). Vitest ignores the `.d.mts` and loads the `.mjs` through vite-node. If Vitest refuses the path outside `apps/web/`, stop and report; do not change `vitest.config.ts` or `tsconfig.json` without the user's agreement
    - End commands as in the Overview
    - _Requirements: 15.2, 15.3, 15.4, 15.5, 15.6, 15.7, 15.8, 15.9, 18.5_

  - [ ] 6.2 Write the hook files, the MCP_Config and the steering files
    - Files: `.kiro/hooks/case-check.json`, `.kiro/hooks/web-related-tests.json`, `.kiro/hooks/python-tests.json`, `.kiro/hooks/compose-guard.json`, `.kiro/settings/mcp.json`, `.kiro/steering/engine-calibration.md`, `.kiro/steering/calibrate-the-case.md` (all new). No other file changes
    - Hook files exactly as the design table and example in "Hooks": `"version": "v1"`, one hook each with `name`, `description`, `trigger`, `matcher`, `action` `{ "type": "command", "command": "node \"$(git rev-parse --show-toplevel)/scripts/hooks/<script>.mjs\"" }` and `timeout` (15.1). No manual hook file (requirements decision 11)
    - `.kiro/settings/mcp.json` exactly as the design section "`.kiro/settings/mcp.json`": the D19 `bash -c` command, `"disabled": false`, `"autoApprove": ["list_cases"]`, no `env`, no `cwd`, no timeout field (16.1 to 16.3, C3)
    - Steering files as the design section "Steering files": `engine-calibration.md` with `inclusion: fileMatch` and `fileMatchPattern: "cases/**"` (16.5, 16.6); `calibrate-the-case.md` with `inclusion: manual` and the five numbered steps (15.10 to 15.12, 16.7). Clinical safety: both files tell the agent to present engine results only, propose no clinical value or text, edit no file under `cases/` and remove no `TODO(author)` marker
    - Once these files exist, Kiro may load the hooks and start the MCP server on its own. The Web_Test_Hook may then run after later `.ts` saves; that output is expected. The Compose_Guard_Hook blocks Blocked_Compose_Commands, which no task uses
    - End commands as in the Overview
    - _Requirements: 15.1, 15.10, 15.11, 15.12, 16.1, 16.2, 16.3, 16.5, 16.6, 16.7_

  - [ ] 6.3 Write the Kiro-file example tests
    - Files: `apps/web/src/lib/kiroFiles.test.ts` (new). No other file changes
    - The examples of the design row `kiroFiles.test.ts`: parse `.kiro/settings/mcp.json` (16.1 to 16.3) and every `.kiro/hooks/*.json` (15.1: fields, triggers, matchers compile as `RegExp` and match their example paths and tool names); the scripts contain no `--build`, `--service-ports` or Blocked_Compose_Command, found with `findBlockedCompose` (guard excluded) (15.8); steering front matter (16.5, 16.7)
    - Spawned guard (`node scripts/hooks/compose-guard.mjs` with stdin `{ tool_name: 'execute_bash', tool_input: { command } }`): exit 2 with the 15.5 message for `docker compose up`, `down`, `stop`, `restart`, `docker compose -f x.yml down` and `echo docker compose down`; exit 0 with empty stdout for `docker compose run`, `build`, `ps` and `ls -la` (17.6)
    - Spawned file hooks only with non-matching paths (`apps/web/src/a.css`, `casesx/a.yaml`, `services/physiology/a.txt`, a path outside the repository): exit 0 with no output, so no hook reaches `requireImage()` or docker. `savedRepoPath` for absolute, relative and outside paths
    - Import `findBlockedCompose` as task 6.1 states
    - End commands as in the Overview
    - _Requirements: 15.1, 15.5, 15.6, 15.7, 15.8, 16.1, 16.2, 16.3, 16.5, 16.7, 17.6, 17.7_

  - [ ] 6.4 Write the property test for the Compose_Guard_Hook
    - Files: `apps/web/src/lib/kiroFiles.test.ts`. No other file changes
    - **Property 6: The Compose_Guard_Hook blocks exactly the Blocked_Compose_Commands**. Generate a prefix (none, `echo`, `cd x &&`, `FOO=1`), `docker compose`, any sequence of the guard's global options (with values, in `--opt=value` form, and as flags), a subcommand, random arguments, optional quoting of the compose part and a suffix (`; ls`, `| cat`); also commands with no `docker compose` pair. `findBlockedCompose` returns a hit exactly for `up`, `down`, `stop` and `restart`. `fc.assert(..., PBT_PARAMS)`
    - Tag: `// Feature: engine-mcp, Property 6: The Compose_Guard_Hook blocks exactly the Blocked_Compose_Commands`
    - End commands as in the Overview
    - _Requirements: 15.5, 15.6_
    - _Properties: 6_

  - [ ] 6.5 Checkpoint before the in-Kiro checks
    - Ensure all tests pass, ask the user if questions arise
    - No file changes in this sub-task
    - Run the end commands. Also `git status --short` and confirm that the changed and new files are exactly those named in tasks 1 to 6
    - **Needs the user:** review tasks 1 to 6 and confirm that task 7 may start. Task 7 needs Kiro to reload the hooks and the MCP server
    - _Requirements: 17.7, 18.1, 18.4, 18.6_

- [ ] 7. Documentation, Requirement 14 pointers and the in-Kiro verification
  - [ ] 7.1 Update `.kiro/steering/tech.md` and `docs/development.md`
    - Files: `.kiro/steering/tech.md`, `docs/development.md`. No other file changes
    - `tech.md`: append the section `## Engine MCP server and CLI (engine-mcp)` of the design section "`.kiro/steering/tech.md` addition" after the Pulse sections. Every existing line, including the verified Pulse facts, stays unchanged (16.8)
    - `docs/development.md`: add the section `## Engine tools (engine-mcp)` with the subsections of the design section "`docs/development.md` addition": the running Physiology_Service as a prerequisite (started by the user in their own terminal), the MCP server and how to add a local `env` without committing it (C3), the command line with its exit codes, the hooks, "Calibrate the case", and "Hook verification" with a one-line introduction and no entries yet (task 7.4 adds them) (16.9)
    - End commands as in the Overview
    - _Requirements: 16.8, 16.9_

  - [ ] 7.2 Add the Requirement 14 pointer lines to play-mode and bedside-exam
    - Files: `.kiro/specs/play-mode/requirements.md`, `.kiro/specs/play-mode/tasks.md`, `.kiro/specs/bedside-exam/requirements.md`. No other file changes; no file of `.kiro/specs/core-simulation-loop/` changes (14.4)
    - Insert exactly the lines of the design section "Requirement 14 pointer lines (exact text)", with their leading spaces:
      - 14.1: play-mode `requirements.md`, Requirement 13, between the blank line after the user story and `#### Acceptance Criteria`. The acceptance criteria text stays unchanged
      - 14.2: play-mode `tasks.md`, the first sub-bullet of tasks 12.1, 12.2 and 12.3 (superseded by engine-mcp tasks 2, 5 and 8)
      - 14.3: bedside-exam `requirements.md`, directly below the glossary term Calibration_Run; play-mode `tasks.md`, the first sub-bullet of task 13.1
    - Do not tick any play-mode checkbox. The user marks play-mode tasks 12.1, 12.2 and 12.3 done after reviewing engine-mcp tasks 2, 5 and 8 (14.2)
    - Check with `git diff --numstat .kiro/specs/play-mode .kiro/specs/bedside-exam .kiro/specs/core-simulation-loop`: `1 0` for both requirements files, `4 0` for play-mode `tasks.md`, nothing else. Quote it in the task report
    - End commands as in the Overview
    - _Requirements: 14.1, 14.2, 14.3, 14.4_

  - [ ] 7.3 Verify the Engine_MCP_Server in the installed Kiro (open items O3 and O5)
    - Files: none, unless O5 finds a per-server tool-call timeout (then `.kiro/settings/mcp.json` and `apps/web/src/lib/kiroFiles.test.ts`). No other file changes
    - This sub-task does not need the Physiology_Service and does not start it
    - **Needs the user:** make Kiro load `.kiro/settings/mcp.json` (open the MCP Servers view; reconnect or reload the server `stitched-patient-engine` if it is missing or shows an old state)
    - **Needs the user:** confirm that `stitched-patient-engine` shows as connected with the tools `list_cases`, `run_scenario` and `run_calibration`, and report any error or non-protocol line in Kiro's MCP log output (1.3)
    - The agent calls `list_cases` once. It is auto-approved, so Kiro shows no approval prompt (record it if Kiro prompts). With the service stopped, the expected result is the Unreachable_Error naming `http://localhost:8000`; with the service running, the case ids. Either result shows that the call path works. Do not call `run_scenario` or `run_calibration` here
    - If the server does not start, record the MCP log lines and report them to the user. Do not change the D19 command or add `cwd` (F1) without the user's agreement
    - O5: with read-only `grep` on the installed bundle (`extensions/kiro.kiro-agent/dist/extension.js` inside `/Applications/Kiro.app`, the file the design's F1 and F8 cite), re-read the stdio server schema near `cwd:b.string().optional()` and check for a per-server tool-call timeout field. Expected (F8): none, so Requirement 16.4 does not apply and the files stay unchanged. If one exists and is read for tool calls, set it to `3600000` in `mcp.json`, change the no-timeout check in `kiroFiles.test.ts` to expect exactly that field, and report it (16.4)
    - Quote the outcome of each step in the task report
    - End commands as in the Overview
    - _Requirements: 1.1, 1.3, 16.1, 16.2, 16.4_

  - [ ] 7.4 Verify the four hooks in the installed Kiro and write the Hook_Verification_Log (open items O2 and O4)
    - Files: `docs/development.md` (the "Hook verification" entries only). Byte-identical saves of `cases/adult-tension-pneumothorax.yaml`, `apps/web/src/lib/engineSlots.ts` and `services/physiology/case_resolver.py`. No other file changes
    - Docker rules: never run `docker compose up`, `down`, `stop` or `restart`, and do not touch the container on port 8000. The hooks run their own one-off `docker compose run -T --rm --no-deps` containers. The agent itself runs only the read-only `docker image inspect stitched-patient-physiology --format '{{.Id}}'`
    - **Needs the user:** if the image is missing, build it in their own terminal (`docker compose build physiology`); the agent does not build images in this plan. The Case_Check_Hook and the Python_Test_Hook need the image
    - **Needs the user:** confirm that Kiro's Agent Hooks view lists the four hooks as enabled, and reload them if not
    - For each file hook, read the file and write the same content back with the file-write tool, then check with `git status --short cases apps/web/src services/physiology` that nothing changed (Requirements 15.13, 18.1, 18.4). If git shows a change, stop and report; do not run `git checkout` or any other restoring command
      - Case_Check_Hook: `cases/adult-tension-pneumothorax.yaml`; expect the validation lines of every case file and the `caseContent.test.ts` Vitest summary
      - Web_Test_Hook: `apps/web/src/lib/engineSlots.ts`; expect a `vitest related` run that includes `engineSlots.test.ts`
      - Python_Test_Hook: `services/physiology/case_resolver.py`; expect the fast pytest summary, and afterwards `git status --short --ignored services/physiology` prints nothing (no `__pycache__`, `.pytest_cache` or Hypothesis files, F2)
    - **Needs the user:** if the hook output does not reach the agent, copy the first 20 lines from Kiro's hook output view
    - Compose_Guard_Hook (15.14, O4), using only these two commands through the shell tool: `echo docker compose down` must be blocked with the hook's message; `echo docker compose ps` must run and print `docker compose ps`
    - Write one Hook_Verification_Log entry per check in the format of the design section "Hook_Verification_Log entry": date, Kiro version, file saved or command tried, whether Kiro ran the hook, and the first 20 lines of its output. Also record whether `file_path` looked absolute or workspace-relative, if the output shows it (O2)
    - If a hook does not fire, or the guard does not block, record what was tried and report it to the user. A manual run of the hook command does not count, and no other trigger, wrapper or script replaces the hook (15.15)
    - End commands as in the Overview
    - _Requirements: 15.5, 15.6, 15.7, 15.13, 15.14, 15.15, 16.9, 18.1, 18.4, 18.5_

- [ ] 8. Real-service check and the recorded calibration run (supersedes play-mode task 12.3)
  - **Needs the Physiology_Service running at http://localhost:8000 — the user confirms it is up before this task starts.**
  - [ ] 8.1 Run the manual check against the real Physiology_Service (manual check (a))
    - Files: none. No file changes
    - **Needs the user:** start the Physiology_Service in their own terminal (for example `docker compose up physiology`) and confirm that it is up. The agent never starts, stops or restarts it and uses it only through its HTTP and WebSocket API
    - Call `list_cases`. If it returns the Unreachable_Error, stop and ask the user to start the service or give another Service_URL (13.2)
    - For each Variant (`left`, `right`), call `run_scenario` with `case_id` `adult-tension-pneumothorax`, the Variant, one Planned_Intervention of the Decompression on its Affected_Side (the Resolved_Case's `SENeedleDecompression` whose side is the Affected_Side) at the Demo_Decompression_Time 150, `max_seconds` equal to the `timeLimitSeconds` of the case file's Play_Section, `stop_at_ending` true and the default Sample_Interval. **Needs the user:** approve each `run_scenario` call
    - Repeat the `left` call once (**Needs the user:** approve it). When every Actual_Time is equal in both results, every vital sign value at every Mark_Sample must agree within 0.001 (12.3); report the largest difference. When the Actual_Times differ, report both and do not judge the comparison
    - **Needs the user:** type `/calibrate-the-case` in a Kiro chat and approve its `run_calibration` call, which runs with `write` false. The agent summarizes the results as the Calibrate_Command says. If the call times out, use the Engine_CLI fallback of the Calibrate_Command (15.12)
    - Record each outcome in the task report (17.8). Present engine results and the case file's own sentences only; propose no clinical value or text
    - Check that `git status --short docs/calibration` prints nothing (`write` was false)
    - End commands as in the Overview
    - _Requirements: 12.3, 13.2, 15.10, 15.11, 17.8_

  - [ ] 8.2 Record the one calibration run of the shipped case (manual check (c))
    - Files: `docs/calibration/<case_id>-<YYYY-MM-DD>-<short-sha>.md` and `docs/calibration/README.md`, both written by the tool. No other file changes
    - The service must still be up. If `list_cases` returns the Unreachable_Error, stop and ask the user to start it or give another Service_URL (13.2)
    - Call `run_calibration` with `case_id` `adult-tension-pneumothorax` and `write` true, with the default times and no `max_seconds` (13.1). **Needs the user:** approve the call
    - If the MCP call times out or the server is unavailable, run from `apps/web/` with execute_bash and a timeout of 1800000 ms: `./node_modules/.bin/vite-node --config vitest.config.ts scripts/engineCli.ts -- calibrate --case adult-tension-pneumothorax --write; echo "exit $?"`. Exit 0 and exit 3 are both completed runs. **Needs the user:** run that command in their own terminal when it needs longer than 30 minutes (15.12)
    - Keep exactly one record. If a second record file is written (for example by a retry), report it and leave both files for the user to decide; delete nothing
    - A "Play_Section values NOT calibrated" record is an expected result. Keep it and report the failing Scenarios to the author as the record names them (13.3)
    - Change no threshold, Hold_Duration, Time_Limit, Scheduled_Insult, Exam_Rule, Status_Rule, Hint or other clinical text, change no check, and remove no `TODO(author)` marker, also when every check passes (18.4)
    - Report from the record: the result of each Calibration_Check per Variant, the Requirement 4.18 flag, and the early-Decompression answer with the D23 rule, which the author still has to confirm (A1)
    - Check that `git status --short docs/calibration` shows only the record file and `README.md`
    - End commands as in the Overview
    - _Requirements: 9.1, 9.11, 9.12, 10.2, 10.4, 10.6, 13.1, 13.2, 13.3, 17.8, 18.4, 18.5_

## Notes

- Tasks run one at a time, only when the user sends "Start task N". Do not start the next task on your own
- Every task and sub-task is required. There are no optional tasks and no `*` markers
- **Physiology_Service.** Only task 8 needs it running, and the user starts it. Task 7.3's `list_cases` call accepts the Unreachable_Error, so task 7 does not need the service. The automated tests open no network connection, start no Pulse_Engine and pass while the service is stopped (17.7)
- **Containers.** Never run `docker compose up`, `down`, `stop` or `restart`, and do not touch the container on port 8000 except through its HTTP and WebSocket API (18.5). No task runs `docker compose build`; the user builds the image if it is missing. The hooks use one-off `docker compose run -T --rm --no-deps` containers, which publish no ports. After task 6.2 the Compose_Guard_Hook also blocks these commands
- **No service or case change.** No file under `services/physiology/` or `cases/` changes (18.1, 18.4). Task 7.4 saves one file in each with byte-identical content, checked with `git status`. No existing module under `apps/web/src/` is edited, including `src/test/generators.ts`, `caseFixtures.ts` and `pbt.ts`; generators for engine inputs live in the new test files
- **Dependencies.** `@modelcontextprotocol/sdk`, `zod` and `vite-node` are dev dependencies only (task 1.1, 18.2). `dependencies` does not change, and nothing the Next.js app imports reaches them (task 5.6, 18.3)
- **Edits and commits.** Edit files only with the file tools, never with execute_bash. Commands are for installing (task 1.1), testing, read-only checks and the smoke checks of task 5.5. The agent does not commit; the user reviews and commits each task. Never start long-running processes such as dev servers or watchers; Kiro starts the MCP server itself
- **Run order.** The engine-mcp tasks run before play-mode task group 12. Engine-mcp tasks 2, 5 and 8 implement what play-mode tasks 12.1, 12.2 and 12.3 planned. Task 7.2 makes the Requirement 14 pointer edits. The user marks play-mode tasks 12.1 to 12.3 done only after the superseding engine-mcp task is done (14.2), so play-mode task group 12 closes after engine-mcp task 8
- **Property test tags** use the property title from `design.md` with Markdown backticks removed, as in bedside-exam: `// Feature: engine-mcp, Property N: <title>`. Property tests (1 to 6) call `fc.assert(..., PBT_PARAMS)` from `src/test/pbt.ts` (seed 20261031, 100 runs). Example-based properties (7 to 10) carry the tag on their test group
- **Clinical safety.** No task writes clinical text. The Calibration_Record and every agent summary present engine numbers and the case file's own sentences. Expected test values come from the case fixtures or from synthetic numbers
- If execute_bash reports a timeout, read the output or log before retrying. The command may have finished

### Order adjustments

- **`EngineClock` is defined in `engineClient.ts` (task 1.2)** and re-exported from `engineRunner.ts` (task 3.1), because the fake clock of task 1.3 needs it before the runner exists
- **Constants** (design "Constants") are exported from the first module that uses them; each task names its constants
- **The `outputSchema` check of `engineRunner.test.ts` is added in task 5.1**, because `ScenarioResultSchema` lives in `engineTools.ts`, the only module that may import `zod`
- **The CLI parser and `cliExitCode` are implemented in task 5.1** (in `engineTools.ts`, as the design places them) and tested in tasks 5.3 and 5.4; `scripts/engineCli.ts` follows in task 5.5

### Known items

- **A1 (author).** The mechanical rule for "the tension pneumothorax still develops" (design D23) needs the author's confirmation. Task 8.2 reports the answer with the rule. If the author rejects the rule, Requirement 9.7 cannot be checked automatically
- **C1.** Requirement 1.8 says the tools start no process, but the Record_Header needs Git facts. Task 5.5 runs three read-only `git` commands with `execFile` and no other process. The requirements are not edited by this plan; the suggested wording is in the design
- **C2.** The hook commands differ from the literal text of 15.2 and 15.3: `-T` and `-e PYTHONDONTWRITEBYTECODE=1` in the Case_Check_Hook, and `--passWithNoTests` in the Web_Test_Hook (task 6.1)
- **C3.** The MCP_Config has no `env` block, because 16.3 forbids setting `PHYSIOLOGY_URL` there. `docs/development.md` shows how a user adds one locally (task 7.1)
- **Open items.** O1 in tasks 1.1 and 5.5, O2 and O4 in task 7.4, O3 and O5 in task 7.3, O6 in tasks 5.1 and 5.3

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2"] },
    { "id": 2, "tasks": ["1.3"] },
    { "id": 3, "tasks": ["2.1"] },
    { "id": 4, "tasks": ["2.2"] },
    { "id": 5, "tasks": ["2.3"] },
    { "id": 6, "tasks": ["3.1"] },
    { "id": 7, "tasks": ["3.2"] },
    { "id": 8, "tasks": ["4.1"] },
    { "id": 9, "tasks": ["4.2"] },
    { "id": 10, "tasks": ["5.1"] },
    { "id": 11, "tasks": ["5.2"] },
    { "id": 12, "tasks": ["5.3"] },
    { "id": 13, "tasks": ["5.4"] },
    { "id": 14, "tasks": ["5.5"] },
    { "id": 15, "tasks": ["5.6"] },
    { "id": 16, "tasks": ["6.1"] },
    { "id": 17, "tasks": ["6.2"] },
    { "id": 18, "tasks": ["6.3"] },
    { "id": 19, "tasks": ["6.4"] },
    { "id": 20, "tasks": ["6.5"] },
    { "id": 21, "tasks": ["7.1"] },
    { "id": 22, "tasks": ["7.2"] },
    { "id": 23, "tasks": ["7.3"] },
    { "id": 24, "tasks": ["7.4"] },
    { "id": 25, "tasks": ["8.1"] },
    { "id": 26, "tasks": ["8.2"] }
  ]
}
```
