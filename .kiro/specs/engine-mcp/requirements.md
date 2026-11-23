# Requirements Document

## Introduction

Engine MCP gives the Kiro agent, and a person at a terminal, a small set of tools that run the real Pulse_Engine through the existing Physiology_Service and report what the Play_View would show. Today the play-mode calibration (play-mode Requirement 13, tasks 12.1 to 12.3) is a planned one-off script for the left side only, and bedside-exam Requirement 13 asks for the same calibration on both Variants. This spec replaces that script with one Scenario_Runner used by two thin front ends:

1. **The Engine_MCP_Server.** A stdio MCP server built with the official TypeScript SDK (`@modelcontextprotocol/sdk`, latest 1.32.2 on 2026-11-22). It offers three tools: `list_cases`, `run_scenario` and `run_calibration`.
2. **The Engine_CLI.** A command line over the same Scenario_Runner, so a Calibration_Record can be reproduced without Kiro. It replaces the script of play-mode task 12.2.

Both run with `vite-node` and the web app's Vitest config (`apps/web/vitest.config.ts`, which defines the `@` alias), as play-mode task 12.2 planned. They import the shipped pure modules under `apps/web/src/lib/` (`endingEvaluator.ts`, `statusSelector.ts`, `vitalBands.ts`, `examFinding.ts`, `sides.ts`, `vitals.ts`) and do not copy them. `vite-node` 1.6.1 is already installed with Vitest. The web client in `apps/web/src/lib/api.ts` is not reused: its `createSession(caseId)` sends no `variant_id`, and it reads the browser setting `NEXT_PUBLIC_PHYSIOLOGY_URL`.

The spec also adds Kiro hooks, a workspace MCP configuration, steering, documentation, and one recorded calibration run of the shipped case with its current draft values.

This spec builds on core-simulation-loop (`.kiro/specs/core-simulation-loop/requirements.md`), play-mode (`.kiro/specs/play-mode/requirements.md`) and bedside-exam (`.kiro/specs/bedside-exam/requirements.md`). It edits none of them now. Requirement 14 states the later one-line pointer edits to play-mode and bedside-exam.

### Kiro facts checked in the installed app (2026-11-22)

Checked read-only in `/Applications/Kiro.app` and on kiro.dev. The installed version is **1.5.11** (`CFBundleShortVersionString`), not 1.4.x.

- **No manual hook in the IDE (verified).** The v1 hook trigger enum in `extensions/kiro.kiro-agent/dist/extension.js` contains `Manual`, but the kiro.dev trigger table (`/docs/hooks/types/`) marks Manual as unsupported in the IDE ("you can't create a new Manual-trigger Hook in the IDE") and the legacy manual hook as "Legacy only". The bundle's migration code converts a legacy `.kiro.hook` file with `userTriggered` into a manual steering file, with the note "Converted user-triggered hook to a manual steering file; invoke it from chat as a /<filename> slash command. The original .kiro.hook is left in place but no longer runs." This spec therefore ships no manual hook file (decision 11).
- **Hook input and blocking (verified).** A `PostFileSave` command hook receives JSON on stdin with `hook_event_name: "PostFileSave"` and `file_path`. A `PreToolUse` command hook receives `tool_name` and `tool_input`, and its `matcher` is tested against the tool name, not the command text. Exit code 2 blocks the tool call and sends stderr to the agent; exit code 0 lets it run.
- **No per-server MCP timeout in the IDE (verified).** The kiro.dev MCP configuration page lists no timeout field for the IDE; only Kiro CLI accepts `timeout` or `timeoutMs`, and there it is the connection timeout. The IDE agent calls MCP tools with `callTool(..., {timeout: 864e5})`, a tool-call timeout of 86,400,000 ms (24 hours). The bundle also has a pooled MCP client with a per-server `timeoutMs` and a 20,000 ms default; the check did not find which configuration sets that value (settle in design, item 3).
- **Working directory of a stdio MCP server (still to verify in design).** Kiro passes a `cwd` to its stdio transport; the check did not find which directory that is.

### Existing Physiology_Service API used (no new endpoint)

Checked in `services/physiology/main.py`, `session_manager.py` and `docs/api.md` on 2026-11-22:

- `GET /` health check; `GET /cases` returns the case ids as a JSON array of strings.
- `POST /sessions` with `case_id` and optional `variant_id` (bedside-exam 3.1 to 3.6); the Session_Metadata includes `variant_id`. A new Session starts paused at 1x (core-simulation-loop 3.3).
- `GET /sessions/{id}/case` returns the Resolved_Case (bedside-exam 3.8).
- `POST /sessions/{id}/playback` takes `playing` and `speed` (`1x`, `2x` or `4x` only).
- `POST /sessions/{id}/interventions` applies an Intervention at the current Simulation_Time (core-simulation-loop 6.5, 9.3) and saves a manual Checkpoint described `After <label>` (core-simulation-loop 6.8).
- `GET /sessions/{id}/branches/{branch_id}/checkpoints` lists Checkpoints with `simulation_time`.
- `WS /sessions/{id}/vitals`: while playing, the service sends one VitalSigns message per tick, and each tick advances exactly 1 simulated second; ticks run at 1, 2 or 4 Hz for 1x, 2x and 4x and run slower when the engine cannot keep up. While paused it re-sends the cached VitalSigns at 1 Hz (core-simulation-loop 4.1, 4.2, 10.14). When the last WebSocket client leaves, the Session pauses (core-simulation-loop 10.7).
- `DELETE /sessions/{id}` deletes a Session. The idle-timeout cleanup is still a `TODO` in `session_manager.py`, so a Session that is not deleted keeps its Pulse_Engine until the service restarts.

There is no HTTP endpoint that advances the engine by a fixed number of ticks (`SessionManager.step()` is a test hook, not exposed). The Scenario_Runner therefore advances Simulation_Time with the Playback_API and reads samples from the Vitals_Stream (decision 1).

### Scope, constraints and non-goals

- **No service change.** No code, configuration or behaviour in `services/physiology/` changes. If the Scenario_Runner needs something the API does not offer, the need is reported to the user as an open question, not met by a service change.
- **No container control.** Neither the tools, the CLI, the hooks nor any task of this spec runs `docker compose up`, `down`, `stop` or `restart`, or starts, stops or rebuilds the Physiology_Service. The running container on port 8000 is used only through its HTTP and WebSocket API. The hooks use one-off containers (`docker compose run --rm --no-deps`), as the bedside-exam tasks already do.
- **No new runtime dependency for the web app.** `@modelcontextprotocol/sdk` and `zod` (the SDK's schema library, `^3.25 || ^4.0`) are added as dev dependencies only. No module imported by the Next.js app imports either.
- **No case-content change.** This spec changes no threshold, Hold_Duration, Time_Limit, Scheduled_Insult, Exam_Rule, Status_Rule, Hint or other clinical text in `cases/`, and removes no `TODO(author)` marker. The author reads the Calibration_Record and decides.
- **Clinical safety.** This spec creates no clinical text. The Calibration_Record and every agent summary present engine results and the case file's own sentences; they give no clinical advice and propose no clinical value. This document contains no clinical numbers. The numbers in it are tool constants (sample interval, Session_Cap, timeouts, playback speed) or are quoted from the other specs (the 300 s demo bound of play-mode 13.5 and the defaults of play-mode task 12.3).
- **Small plan.** The implementation must fit in about 8 small tasks (Requirement 18.6), each ending with passing tests, sized for about one day.
- **Non-goals:** new Cases, Variants or Interventions; scoring and debrief; an HTTP (non-stdio) MCP transport; tools that fork Branches or change a Session the user is playing; running the slow `-m pulse` pytest suite from a hook; a manual hook file; a hook that reminds the agent to recalibrate.

### Planned file layout (the design may refine names)

- `apps/web/src/lib/calibration.ts`: the record helpers of play-mode task 12.1, extended per Variant (pure, covered by Vitest).
- `apps/web/src/lib/engineRunner.ts` and `apps/web/src/lib/engineTools.ts`: the Scenario_Runner, the Session_Cap and the SDK-free tool handlers, with injected `fetch`, WebSocket and file-system functions so Vitest can use the Fake_Service.
- `apps/web/scripts/engineMcp.ts` (the Engine_MCP_Server entry point, the only module that imports the SDK) and `apps/web/scripts/engineCli.ts` (the Engine_CLI).
- `.kiro/settings/mcp.json`, `.kiro/hooks/*.json` (three file-save hooks and the Compose_Guard_Hook), `.kiro/steering/engine-calibration.md`, `.kiro/steering/calibrate-the-case.md`, updates to `.kiro/steering/tech.md` and `docs/development.md`, and the record under `docs/calibration/`.

### Decisions

1. **Advancing time and sampling.** The Scenario_Runner opens the Vitals_Stream before it presses play, keeps it open for the whole Scenario (otherwise the Session pauses, core-simulation-loop 10.7), plays at `4x`, the fastest existing speed, and keeps one sample per distinct `simulation_time`. Repeated messages with the same `simulation_time` (the paused re-send) are ignored. The sample at Simulation_Time 0 is the paused re-send that a new Session already provides. Playback speed changes only the wall-clock duration: every tick is 1 simulated second at any speed.
2. **Applying an Intervention "at" a Simulation_Time.** For a Planned_Intervention with Requested_Time T > 0, the Scenario_Runner sends a pause request as soon as it receives the sample with `simulation_time` ≥ T, applies the Intervention through the Intervention_API while paused, reads the Actual_Time from the `simulation_time` of the new manual Checkpoint described `After <label>` on the current Branch, and then resumes. For T = 0 it applies the Intervention before the first play request. If the pause lands after one or more further ticks, the Actual_Time is later than T: the result records both times and flags a Late_Intervention, and every later computation uses the Actual_Time. The design may lower the speed to `1x` shortly before T to widen the pause window; that choice changes no requirement.
3. **Rescue gate in the runner.** As play-mode task 12.1 planned, the Scenario_Runner keeps its own Intervention_Record (one entry per successful Intervention_API call, with the Actual_Time and the Scenario's single branch_id), computes the gate with `rescueGateTime(requiredInterventions(play), entries)` from the Resolved_Case (bedside-exam 13.3), and applies it with `setRescueGate` at the place in the sample order where the call succeeded, so the Ending_Evaluator sees the same gate sequence as the Web_App.
4. **Where the Status_Sentence and Exam_Findings come from.** From the shipped `selectStatus` and `examFinding` functions, called on the Resolved_Case that the Case_API returns for the Scenario's Session, with the Active_Interventions taken from the runner's Intervention_Record up to the sample's Simulation_Time. No finding or sentence is written by this spec.
5. **Ending on the recorded samples.** The Ending_Evaluator runs on the Mark_Samples, as play-mode 13.4 states ("the Ending that the Ending_Evaluator returns for that scenario's recorded samples"). Calibration keeps the 10 s Mark_Samples of play-mode 13.4 (user decision, 2026-11-22). A `run_scenario` caller who wants the Web_App's per-second view sets the Sample_Interval to 1.
6. **Cancellation.** The SDK passes an `AbortSignal` to each tool handler (`extra.signal`), which aborts when the MCP_Client sends `notifications/cancelled`. The Scenario_Runner treats an abort like an error: it stops sampling and deletes every Session it created. The Engine_CLI aborts the same signal on SIGINT and SIGTERM, and the Engine_MCP_Server aborts all running calls when its stdin closes or it receives SIGINT or SIGTERM.
7. **Session_Cap.** At most 4 Sessions per process by default, set by the environment variable `ENGINE_MCP_MAX_SESSIONS` or the CLI flag `--max-sessions`, from 1 to 8. A Scenario waits in a queue until a slot is free. Each Session holds one Pulse_Engine, and the user's own Play_View session needs one more; 4 keeps the 8 calibration Scenarios to two rounds while leaving the service usable.
8. **Approval.** `.kiro/settings/mcp.json` lists only `list_cases` in `autoApprove` and never `"*"`. Kiro then asks the user before each `run_scenario` and `run_calibration` call (Kiro MCP configuration docs, `autoApprove`: tool names to auto-approve without prompting).
9. **Service URL from configuration only.** The tools take no URL argument, so the agent cannot point them at another host. The URL comes from `PHYSIOLOGY_URL` (the name in steering `tech.md`), default `http://localhost:8000`, or the CLI flag `--url`. To use the x86 machine on the private network, the user sets `PHYSIOLOGY_URL` in the MCP_Config `env` or passes `--url`.
10. **`variant_id` is a required string.** `run_scenario` never relies on the random pick (bedside-exam 13.1) and does not accept `null` (user decision, 2026-11-22). A case without Variants cannot be run with `run_scenario`; the only shipped case has Variants.
11. **The "Calibrate the case" manual hook is a manual steering file only.** Kiro IDE 1.5.11 has no Manual hook trigger and converts legacy `userTriggered` hooks into manual steering files (see "Kiro facts checked"). "Calibrate the case" is therefore `.kiro/steering/calibrate-the-case.md` with `inclusion: manual`, run as `/calibrate-the-case`, and no hook file is added for it (user decision, 2026-11-22).
12. **Determinism and platform.** Core-simulation-loop 9.1 and 9.3 make the vitals reproducible for equal Actual_Times, and bedside-exam 3.13 extends this per Variant. Steering `tech.md` records that the x86 machine and the emulated Mac produce identical vitals for the same scenario, so the Calibration_Record states no platform caveat; it states the Service_URL and that the playback speed affects wall-clock time only.
13. **Compose guard, no recalibrate reminder.** A `PreToolUse` hook, the Compose_Guard_Hook, blocks shell commands that contain `docker compose up`, `down`, `stop` or `restart`, which encodes the rule the project already follows (Requirement 15.5 to 15.7). No `PostFileSave` reminder to recalibrate is added; the Engine_Steering_File covers that (user decision, 2026-11-22).
14. **Long calls, progress and fallback.** The IDE's 24-hour tool-call timeout is far above a full calibration, so the MCP_Config sets no timeout unless the design finds a per-server tool-call timeout that this Kiro honours (Requirement 16.4). In that case the value is 3,600,000 ms: the longest allowed calibration on the development Mac is 8 Scenarios at the largest Max_Time of 3600 s; with the emulated engine at about 13x real time in total across Sessions, that is about 8 × 3600 / 13 ≈ 2215 s of Wall_Clock_Time, above the 4x floor of 2 rounds × 3600 / 4 = 1800 s at a Session_Cap of 4, and 3600 s leaves about 60 % margin. Slower hosts (for example the 1-vCPU VM at about 1.5x) use the Engine_CLI. `run_calibration` sends progress notifications when the MCP_Client sends a `progressToken` (Requirement 8.13). If an MCP call still times out, the Calibrate_Command and the Engine_Steering_File tell the agent to run the Engine_CLI through a shell command with a long timeout (Requirements 15.12, 16.6).

### Known limitations

- **Hooks fire on agent saves.** The Kiro `PostFileSave` trigger fires when the agent saves or edits a file. A save made by the user in the editor may not fire it.
- **Wall-clock duration.** At 4x, a 600 s Scenario takes at least 150 s of wall-clock time, and longer when the engine runs below 4x real time (for example several Sessions on the emulated Mac at about 13x real time in total). The 8 calibration Scenarios with a Session_Cap of 4 take several minutes. The IDE's tool-call timeout is 24 hours (decision 14); another MCP_Client may end `run_calibration` earlier, and the Engine_CLI has no such limit.
- **PreToolUse sees the command text only.** The Compose_Guard_Hook matches text in the shell command. A command that runs a script which itself calls `docker compose down` is not blocked.
- **Late Interventions.** Decision 2 cannot guarantee that the Actual_Time equals the Requested_Time, because there is no step endpoint. Equal inputs give equal records only when the Actual_Times are equal; the record shows both times.
- **Orphaned Sessions.** If the process is killed with SIGKILL, its Sessions stay in the service until the service restarts, because idle cleanup is not implemented.

### Answered questions (2026-11-22)

1. **Manual hook.** Accepted as the manual steering file `/calibrate-the-case`. No hook file, because Kiro 1.5.11 has no IDE Manual trigger (decision 11).
2. **MCP tool-call timeout.** Progress notifications: yes (Requirement 8.13). The IDE has no per-server timeout field and calls tools with a 24-hour timeout; Requirement 16.4 covers the case that the design finds one. The CLI fallback is in Requirements 15.12 and 16.6.
3. **Cases without Variants.** `variant_id` stays a required string; `null` is not accepted (decision 10).
4. **Ending resolution.** Calibration keeps the 10 s Mark_Samples of play-mode 13.4 (decision 5).
5. **Further hooks.** Add the Compose_Guard_Hook; no recalibrate reminder (decision 13).
6. **Stale references in other specs.** Requirement 14.3 adds one-line pointers to the bedside-exam glossary term Calibration_Run and to play-mode task 13.1.

### Settle in design (by checking the installed Kiro, not by guessing)

1. **Working directory of the MCP server.** The MCP_Config has no `cwd` field. The design checks from which directory Kiro 1.5.11 starts a workspace stdio server, so that the `vite-node` command and the `--config` path resolve.
2. **Saved file path.** The field is `file_path` (verified). The design checks whether it is absolute or workspace-relative before the Web_Test_Hook passes it to `vitest related`.
3. **Per-server tool-call timeout.** The design checks whether the pooled MCP client's per-server `timeoutMs` is read from the MCP_Config in the IDE (Requirement 16.4).
4. **Python_Test_Hook command.** The design picks the command and shows that it works (Requirement 15.4).
5. **Shell tool ids.** The design names the built-in shell tool ids, or the `shell` category, that the Compose_Guard_Hook's matcher uses, and the `tool_input` field that holds the command text (Requirement 15.7).

### Open questions for the user

None.

## Glossary

Terms from core-simulation-loop, play-mode and bedside-exam keep their meaning in those specs: **Case**, **Case_Definition**, **Session**, **Session_API**, **Session_Metadata**, **Case_API**, **Branch**, **Checkpoint**, **Pulse_Engine**, **Physiology_Service**, **Web_App**, **Intervention**, **Intervention_API**, **Playback_API**, **Playback_Speed**, **Scheduled_Insult**, **Simulation_Time**, **Wall_Clock_Time**, **Vitals_Stream**, **VitalSigns**, **Alarm_State**, **Play_View**, **Play_Section**, **Play_Label**, **Vital_Band**, **Overall_Status**, **Status_Rule**, **Status_Sentence**, **Status_Selector**, **Vital_Condition**, **Rescue_Condition**, **Lost_Condition**, **Hold_Duration**, **Time_Limit**, **Required_Interventions**, **Rescue_Gate_Time**, **Ending**, **Ending_Evaluator**, **Intervention_Record**, **Active_Interventions**, **Decompression**, **Safety_Notice**, **Base_Case**, **Variant**, **Variant_Id**, **Variant_Overrides**, **Override_Target**, **Resolved_Case**, **Affected_Side**, **Other_Side**, **Exam_Section**, **Exam_Action**, **Exam_Button**, **Exam_Finding**, **Abnormal_Finding**, **Exam_Finding_Selector**.

- **MCP_Client**: The program that starts the Engine_MCP_Server and calls its tools, normally Kiro
- **MCP_Config**: The workspace file `.kiro/settings/mcp.json`
- **Engine_MCP_Server**: The stdio MCP server of this spec, started with `vite-node` and the web app's Vitest config
- **Engine_CLI**: The command line of this spec, started the same way, with the subcommands `list-cases`, `run-scenario` and `calibrate`
- **Scenario_Runner**: The shared logic that creates a Session, advances it, applies Planned_Interventions, collects samples, computes the Scenario_Result and deletes the Session
- **Service_URL**: The base URL of the Physiology_Service that the Scenario_Runner uses: the CLI `--url` value, else the `PHYSIOLOGY_URL` environment variable, else `http://localhost:8000`
- **Health_Check**: A `GET /` request to the Service_URL with a 3-second Wall_Clock_Time timeout
- **Unreachable_Error**: The error result that names the Service_URL, says that the Physiology_Service is not reachable, tells the user to start it in their own terminal (for example with `docker compose up physiology`) or to set `PHYSIOLOGY_URL`, and says that the tool does not start the service
- **Scenario**: One run of one Session from Simulation_Time 0 with a fixed Variant and Intervention_Plan
- **Planned_Intervention**: A pair of an `intervention_id` from the Resolved_Case and a Requested_Time
- **Intervention_Plan**: The ordered list of Planned_Interventions of a Scenario
- **Requested_Time**: The Simulation_Time, a whole number of seconds, at which a Planned_Intervention should be applied
- **Actual_Time**: The `simulation_time` of the manual Checkpoint described `After <label>` that the Physiology_Service saved for an applied Planned_Intervention
- **Late_Intervention**: A Planned_Intervention whose Actual_Time is greater than its Requested_Time
- **Max_Time**: The Simulation_Time at which a Scenario stops at the latest
- **Sample_Interval**: The distance in simulated seconds between Sample_Marks, a whole number; default 10
- **Sample_Mark**: A Simulation_Time that is a multiple of the Sample_Interval, from 0 to the Scenario's last Simulation_Time
- **Mark_Sample**: The VitalSigns sample recorded for a Sample_Mark: the received sample whose `simulation_time` equals the Sample_Mark, or else the next received sample, flagged as substituted
- **Runner_Intervention_Record**: The Scenario_Runner's Intervention_Record for one Scenario, with one entry per successful Intervention_API call, holding the Actual_Time and the Scenario's branch_id
- **Scenario_Result**: The output of one Scenario defined in Requirement 5
- **Session_Cap**: The largest number of Sessions that one Engine_MCP_Server or Engine_CLI process holds at the same time
- **Stall_Timeout**: 30 seconds of Wall_Clock_Time without a new distinct sample while the Scenario is playing
- **Scenario_Kind**: One of the four calibration Scenarios per Variant, named relative to the Variant: `no-intervention`; `affected-side` (Decompression on the Affected_Side at the Demo_Decompression_Time); `other-side-only` (Decompression on the Other_Side only, at the Demo_Decompression_Time); and `affected-side-early` (Decompression on the Affected_Side at the Early_Decompression_Time)
- **Demo_Decompression_Time**: The Requested_Time of the Decompression in the `affected-side` and `other-side-only` Scenarios, the Simulation_Time chosen for the acceptance demo (play-mode 13.5); default 150, the value of play-mode task 12.3
- **Early_Decompression_Time**: The Requested_Time of the Decompression in the `affected-side-early` Scenario; default 20, the value of play-mode task 12.3; it must be less than the Affected_Side insult's `timeSeconds`
- **Calibration_Checks**: The outcome checks of play-mode 13.5, 13.6, 13.7, 13.14 and 13.15, applied to every Variant (bedside-exam 13.5). The play-mode 13.12 flag for Requirement 4.18 is reported separately and is not a Calibration_Check, as in play-mode 13.8
- **Calibration_Record**: The markdown document that `run_calibration` returns, made of a Record_Header and a Record_Body
- **Record_Header**: The first block of the Calibration_Record, holding the date, the Git commit, the Service_URL and the other run facts of Requirement 9.1
- **Record_Body**: The Calibration_Record without its Record_Header
- **Calibration_Index**: The file `docs/calibration/README.md`, with one line per written Calibration_Record
- **Fake_Service**: An in-memory test double of the Physiology_Service's HTTP and WebSocket contract, injected into the Scenario_Runner, that opens no network connection and starts no Pulse_Engine
- **Case_Check_Hook**: The Kiro hook that checks the case files when a file under `cases/` is saved
- **Web_Test_Hook**: The Kiro hook that runs the Vitest tests related to a saved web source file
- **Python_Test_Hook**: The Kiro hook that runs the fast physiology pytest suite when a Python file under `services/physiology/` is saved
- **Compose_Guard_Hook**: The Kiro `PreToolUse` hook that blocks an agent shell command containing a Blocked_Compose_Command
- **Blocked_Compose_Command**: A `docker compose` invocation whose subcommand is `up`, `down`, `stop` or `restart`, also when global options such as `-f <file>` or `-p <name>` come between `compose` and the subcommand
- **Hook_Verification_Log**: The section "Hook verification" in `docs/development.md` that records, per hook, the date, the Kiro version, the file saved or command tried, whether Kiro ran the hook, and the first 20 lines of what the hook printed
- **Calibrate_Command**: The manually included steering file `.kiro/steering/calibrate-the-case.md`, run as the slash command `/calibrate-the-case`
- **Engine_Steering_File**: The steering file `.kiro/steering/engine-calibration.md`, included when the agent works on files under `cases/`

## Requirements

### Requirement 1: Engine MCP server and its connection to the service

**User Story:** As the case author working with the Kiro agent, I want an MCP server that talks to the running Physiology_Service, so that the agent can run the real engine without me copying numbers by hand.

#### Acceptance Criteria

1. THE Engine_MCP_Server SHALL use `@modelcontextprotocol/sdk` with the stdio transport and SHALL register exactly the tools `list_cases`, `run_scenario` and `run_calibration`, each with a description and an input schema.
2. THE Engine_MCP_Server SHALL start with `vite-node --config apps/web/vitest.config.ts` (or the same config given relative to `apps/web/`) and SHALL import the Ending_Evaluator, the Status_Selector, the Vital_Band functions, the Exam_Finding_Selector and the side helpers from their modules under `apps/web/src/lib/`, with no copy of their logic.
3. THE Engine_MCP_Server SHALL write only MCP protocol messages to stdout and SHALL write every log line to stderr.
4. THE Scenario_Runner SHALL send every HTTP request and WebSocket connection only to the Service_URL.
5. WHEN any tool is called, THE Engine_MCP_Server SHALL run the Health_Check before any other request to the Physiology_Service.
6. IF the Health_Check fails, times out, or a request to the Physiology_Service fails with a connection error, THEN THE Engine_MCP_Server SHALL return the Unreachable_Error as a tool result with `isError: true`, and SHALL make no further request for that call except the Session deletions of Requirement 6.
7. IF the Physiology_Service returns an HTTP error response, THEN THE Engine_MCP_Server SHALL return a tool result with `isError: true` that names the endpoint, the HTTP status and the service's error message.
8. THE Engine_MCP_Server, the Engine_CLI and the Scenario_Runner SHALL start no process, container or service, and SHALL send no request that stops or restarts the Physiology_Service.
9. IF the `PHYSIOLOGY_URL` value or the `--url` value is not an absolute `http` or `https` URL, or the Session_Cap value is not a whole number from 1 to 8, THEN THE Engine_MCP_Server or THE Engine_CLI SHALL exit at startup with an error message that names the invalid value and, for the Session_Cap, the allowed range.

### Requirement 2: The `list_cases` tool

**User Story:** As the agent, I want to list the cases the service offers, so that I call the other tools with a valid case id.

#### Acceptance Criteria

1. WHEN `list_cases` is called, THE Engine_MCP_Server SHALL return the case ids from `GET /cases` in the order the Physiology_Service returns them.
2. THE `list_cases` tool SHALL take no argument and SHALL create no Session.

### Requirement 3: `run_scenario` inputs

**User Story:** As the agent, I want a strict input format for a scenario, so that a bad request fails before it uses the engine.

#### Acceptance Criteria

1. THE `run_scenario` tool SHALL take: `case_id` (required kebab-case string); `variant_id` (required kebab-case string); `interventions` (a list of at most 20 Planned_Interventions, each with an `intervention_id` kebab-case string and an `at_seconds` whole number, default empty); `max_seconds` (required whole number from 1 to 3600); `sample_interval_seconds` (whole number from 1 to 60, default 10); and `stop_at_ending` (boolean, default false).
2. IF an input violates criterion 1, or a Planned_Intervention's `at_seconds` is greater than `max_seconds`, THEN THE Engine_MCP_Server SHALL return a tool result with `isError: true` that names each invalid field, before the Health_Check and before any Session is created.
3. IF an `intervention_id` is not an Intervention of the Resolved_Case, THEN THE Scenario_Runner SHALL return an error that names the id and lists the valid ids, before the first play request.
4. WHEN the Scenario_Runner creates the Session for a Scenario, THE Scenario_Runner SHALL send the requested `variant_id` with the Session_API request (bedside-exam 13.1).
5. IF the Session_Metadata's `variant_id` differs from the requested `variant_id`, THEN THE Scenario_Runner SHALL delete the Session and return an error that names both values.

### Requirement 4: Running a scenario

**User Story:** As the case author, I want each scenario to run the engine exactly as a player's session would, so that the results show what the Play_View would show.

#### Acceptance Criteria

1. WHEN a Scenario starts, THE Scenario_Runner SHALL create one Session, read the Resolved_Case from the Case_API, open the Vitals_Stream, receive the sample at Simulation_Time 0, apply every Planned_Intervention with Requested_Time 0, and then start playback through the Playback_API at Playback_Speed `4x`.
2. WHILE a Scenario runs, THE Scenario_Runner SHALL keep the Vitals_Stream open and SHALL keep exactly one sample per distinct `simulation_time`, the first one received.
3. WHEN the Scenario_Runner receives the first sample whose `simulation_time` is greater than or equal to the Requested_Time of a pending Planned_Intervention with Requested_Time greater than 0, THE Scenario_Runner SHALL pause playback, apply every pending Planned_Intervention whose Requested_Time is less than or equal to that `simulation_time` in Intervention_Plan order, and resume playback.
4. WHEN the Intervention_API accepts a Planned_Intervention, THE Scenario_Runner SHALL read its Actual_Time from the Checkpoint list of the Session's current Branch and SHALL add one Runner_Intervention_Record entry with that Actual_Time.
5. IF the Actual_Time of a Planned_Intervention is greater than its Requested_Time, THEN THE Scenario_Result SHALL mark that Planned_Intervention as a Late_Intervention and state both times.
6. THE Scenario_Runner SHALL compute the Rescue_Gate_Time from the Resolved_Case's Required_Interventions and the Runner_Intervention_Record, and SHALL apply each change of the Rescue_Gate_Time to the Ending_Evaluator before the first Mark_Sample whose Simulation_Time is greater than or equal to the Actual_Time of the call that caused it (play-mode 13.13, bedside-exam 13.3).
7. WHEN a sample with `simulation_time` greater than or equal to the Max_Time is received, or `stop_at_ending` is true and the Ending of the Mark_Samples so far is not `none`, THE Scenario_Runner SHALL stop the Scenario.
8. THE Scenario_Runner SHALL record one Mark_Sample for every Sample_Mark from 0 to the Scenario's last Simulation_Time, and SHALL flag each Mark_Sample that was substituted, with the Simulation_Time it stands for.
9. IF the Vitals_Stream closes, sends an error message, or reaches the Stall_Timeout while the Scenario is playing, THEN THE Scenario_Runner SHALL end the Scenario with an error that names the Session's last Simulation_Time and the cause.

### Requirement 5: `run_scenario` output

**User Story:** As the case author, I want every result to show the vitals together with what the Play_View derives from them, so that I can judge thresholds, status rules and exam rules from one run.

#### Acceptance Criteria

1. THE Scenario_Result SHALL contain, for each Mark_Sample: its Simulation_Time and substituted flag; every VitalSigns field the Vitals_Stream sent; the Vital_Band of every vital sign with Case thresholds in the Resolved_Case; the Overall_Status; the Status_Sentence that `selectStatus` returns for that sample and the Resolved_Case; and the Ending after that sample.
2. THE Scenario_Result SHALL contain, for each Mark_Sample and each Exam_Button of the Resolved_Case's Exam_Section in Exam_Button order, the Exam_Button's action id and side, and the Exam_Finding sentence and abnormal flag that `examFinding` returns for that sample's Simulation_Time and the Runner_Intervention_Record entries with Actual_Time less than or equal to that Simulation_Time.
3. WHERE the Resolved_Case has no Exam_Section, THE Scenario_Result SHALL contain an empty exam list for each Mark_Sample.
4. THE Scenario_Result SHALL contain the Ending timeline: the Simulation_Time at which the Ending first stops being `none`, the Ending at that time, and for `lost` the cause (the Lost_Condition group number or `Time_Limit`), or the statement that the Ending stayed `none`.
5. THE Scenario_Result SHALL contain the final Rescue_Gate_Time (`null` when the gate stayed closed) and, for each Planned_Intervention, the `intervention_id`, the Requested_Time, the Actual_Time and the Late_Intervention flag.
6. THE Scenario_Result SHALL contain the case id, the Variant_Id, the Affected_Side, the Sample_Interval, the Max_Time and the Service_URL.
7. THE Engine_MCP_Server SHALL return the Scenario_Result as structured JSON content and as the same JSON in a text content item.

### Requirement 6: Session cleanup and cancellation

**User Story:** As the user, I want every session the tools create to be deleted, so that runs do not leave Pulse engines behind in my service.

#### Acceptance Criteria

1. WHEN a Scenario ends, with a result or with an error, THE Scenario_Runner SHALL pause playback, close the Vitals_Stream and delete the Session through `DELETE /sessions/{id}`, and after an error SHALL return the original error.
2. WHEN the MCP_Client cancels a tool call, THE Scenario_Runner SHALL stop every Scenario of that call within 5 seconds of Wall_Clock_Time, delete every Session the call created, and return no further result for that call.
3. WHEN the Engine_MCP_Server's stdin closes, or the Engine_MCP_Server or the Engine_CLI receives SIGINT or SIGTERM, THE process SHALL delete every Session that the process created and has not yet deleted before it exits, waiting at most 10 seconds of Wall_Clock_Time.
4. IF a Session deletion fails, THEN THE Scenario_Runner SHALL report the session_id of the Session that was not deleted in the result or on stderr.
5. THE Scenario_Runner SHALL delete only Sessions that the same process created, and SHALL send no request for any other Session.

### Requirement 7: Parallel Session cap

**User Story:** As the user, I want the tools to hold only a few Sessions at once, so that my own Play_View session stays usable during a calibration.

#### Acceptance Criteria

1. THE Scenario_Runner SHALL hold at most Session_Cap Sessions at the same time per process, across all running tool calls.
2. THE Session_Cap SHALL be 4 by default, set by the `ENGINE_MCP_MAX_SESSIONS` environment variable or the Engine_CLI flag `--max-sessions`, with the flag taking precedence.
3. WHILE the number of held Sessions equals the Session_Cap, THE Scenario_Runner SHALL queue each further Scenario and SHALL start it in queue order when a Session is deleted.
4. WHEN a tool call is cancelled while one of its Scenarios is queued, THE Scenario_Runner SHALL remove that Scenario from the queue without creating a Session.

### Requirement 8: `run_calibration` scenarios

**User Story:** As the case author, I want one tool call to run the full calibration for both sides, so that the thresholds I approve work whichever side the Session picks.

#### Acceptance Criteria

1. THE `run_calibration` tool SHALL take: `case_id` (required kebab-case string); `decompress_at_seconds` (whole number, default the Demo_Decompression_Time 150); `early_decompress_at_seconds` (whole number, default the Early_Decompression_Time 20); `max_seconds` (whole number from 1 to 3600, optional); and `write` (boolean, default false).
2. WHEN `run_calibration` is called, THE Scenario_Runner SHALL run the four Scenario_Kinds for each Variant of the case, which is eight Scenarios for `adult-tension-pneumothorax` (bedside-exam 13.2), each in a new Session created with the Variant named by `variant_id` (bedside-exam 13.1).
3. THE Scenario_Runner SHALL take the Variant_Ids, the Play_Section, the Time_Limit and the insult `timeSeconds` for the checks of criterion 5 from the case file `cases/<case_id>.yaml` in the repository.
4. THE Scenario_Runner SHALL choose the Decompression of the `affected-side` and `affected-side-early` Scenarios from the Resolved_Case's Interventions with action `SENeedleDecompression` whose `side` parameter equals the Affected_Side, and the Decompression of the `other-side-only` Scenario from those whose `side` parameter equals the Other_Side.
5. IF the case file has no Variants or no Play_Section, the Play_Section has no Time_Limit and `max_seconds` is not given, or `early_decompress_at_seconds` is not less than the `timeSeconds` of the first `SETensionPneumothorax` Scheduled_Insult, THEN THE Engine_MCP_Server SHALL return an error that names the failed condition before any Session is created.
6. IF a Resolved_Case has no Decompression for a side that criterion 4 needs, THEN THE Scenario_Runner SHALL end that Scenario with an error that names the Variant_Id and the side, handled as criterion 12 states.
7. THE `no-intervention`, `affected-side` and `other-side-only` Scenarios SHALL run with `stop_at_ending` true and a Max_Time equal to the Time_Limit, or to `max_seconds` when given.
8. THE `affected-side-early` Scenario SHALL run with `stop_at_ending` false to the same Max_Time as the other Scenarios of its Variant (play-mode 13.16).
9. THE Scenario_Runner SHALL use a Sample_Interval of 10 for every calibration Scenario (play-mode 13.2).
10. WHEN a calibration Scenario has read its Resolved_Case and before its playback starts, THE Scenario_Runner SHALL compare every Play_Section field that is not an Override_Target, and every Play_Label, with the case file.
11. IF the comparison of criterion 10 finds a difference, THEN THE Scenario_Runner SHALL end that Scenario with an error that names the Variant_Id and the field path (play-mode 2.13), handled as criterion 12 states.
12. IF any Scenario of the call ends with an error, THEN THE Engine_MCP_Server SHALL stop the other Scenarios, delete every Session of the call, return the error with the name of the failing Scenario, and return no Calibration_Record.
13. WHERE the MCP_Client sent a `progressToken` with the call, THE Engine_MCP_Server SHALL send an MCP progress notification at least once per 10 seconds of Wall_Clock_Time while the call runs, stating the number of completed Scenarios out of the total.

### Requirement 9: Calibration_Record contents and checks

**User Story:** As the case author, I want one record that shows every check, sign and sentence per side, so that I can decide the thresholds and exam rules from it.

#### Acceptance Criteria

1. THE Record_Header SHALL contain the Safety_Notice; the sentence "Engine results for draft case values. Not clinical advice."; the date; the Git short commit id; whether files under `cases/` or `apps/web/src/lib/` differed from that commit; whether commit 1e71454 is an ancestor of that commit (play-mode 13.1); the Service_URL; the Playback_Speed used with the statement that it affects wall-clock time only; the Session_Cap; the Demo_Decompression_Time and the Early_Decompression_Time.
2. THE Record_Body SHALL contain, for each Variant, the Variant_Id and the Affected_Side, and SHALL name each Scenario by its Scenario_Kind and Variant_Id, with "affected side" and "other side" instead of "left" and "right" (bedside-exam 13.4).
3. THE Record_Body SHALL contain the Play_Section values used: every Vital_Condition, every Hold_Duration, the Time_Limit and the Required_Interventions of each Resolved_Case (play-mode 13.3).
4. THE Record_Body SHALL contain, for each Scenario, the Mark_Samples with every vital sign that the Rescue_Condition or the Lost_Condition references, the Requested_Time and Actual_Time of each Decompression, the Late_Intervention flags, the Rescue_Gate_Time, and the Ending timeline of Requirement 5.4 (play-mode 13.2 to 13.4, 13.13).
5. THE Record_Body SHALL state the result of each Calibration_Check for each Variant as "pass" or "fail" with the Simulation_Time and outcome it is based on (play-mode 13.5 to 13.7, 13.14, 13.15; bedside-exam 13.5).
6. THE Record_Body SHALL contain, for each Variant, the comparison of the `affected-side-early` Scenario with the `no-intervention` Scenario at the same Simulation_Times after the insult's `timeSeconds`, the statement whether the tension pneumothorax still develops after the early Decompression, and the statement that the early Scenario's Ending is not evidence for play-mode open question 1, item d (play-mode 13.11, 13.16).
7. IF the `affected-side-early` comparison shows that the early Decompression prevents the tension pneumothorax in any Variant, THEN THE Record_Body SHALL flag play-mode Requirement 4.18 for revision (play-mode 13.12).
8. THE Record_Body SHALL contain, for each Scenario, the Vital_Band of every vital sign with Case thresholds at Simulation_Time 0, the Overall_Status at each Mark_Sample, and each Status_Rule that matched with the Simulation_Times at which it matched and at which `selectStatus` returned its sentence, or the statement that only the `defaultSentence` was returned (play-mode 13.17).
9. THE Record_Body SHALL contain, for each Scenario and each Mark_Sample, the Exam_Finding sentence and abnormal flag of each Exam_Button, and for each Exam_Button the first Simulation_Time at which its Exam_Finding is an Abnormal_Finding, or the statement that it never is (bedside-exam 13.7).
10. THE Record_Body SHALL contain, for each Scenario_Kind, the largest absolute difference per vital sign between the `left` and the `right` Variant's Mark_Samples at the same Simulation_Times (bedside-exam 13.6).
11. IF any Calibration_Check fails for any Variant, THEN THE Calibration_Record SHALL contain the line "Play_Section values NOT calibrated" and SHALL name each failing Scenario with the outcome it produced (play-mode 13.8, bedside-exam 13.5).
12. WHILE every Calibration_Check passes for every Variant, THE Calibration_Record SHALL contain the line "All calibration checks passed. The author reviews the values and their citations before removing any TODO(author) marker." (play-mode 13.10).
13. THE Calibration_Record SHALL quote Status_Sentences and Exam_Finding sentences exactly as the Resolved_Case holds them and SHALL contain no other clinical text.

### Requirement 10: Writing the record

**User Story:** As the case author, I want to keep a record in the repository only when I ask for it, so that test runs do not clutter `docs/`.

#### Acceptance Criteria

1. WHERE `write` is false, THE Engine_MCP_Server SHALL write no file.
2. WHERE `write` is true, THE Engine_MCP_Server SHALL write the Calibration_Record to `docs/calibration/<case_id>-<YYYY-MM-DD>-<short-sha>.md` under the repository root and SHALL append one line to the Calibration_Index with the date, the commit, the case id, a relative link to the file, and "calibrated" or "NOT calibrated".
3. IF the record file already exists, THEN THE Engine_MCP_Server SHALL add the suffix `-2`, `-3` and so on before `.md` and SHALL not overwrite the existing file.
4. IF the Calibration_Index does not exist, THEN THE Engine_MCP_Server SHALL create it with a title line and the Safety_Notice before appending the line.
5. THE Engine_MCP_Server and THE Engine_CLI SHALL write files only under `docs/calibration/`.
6. WHERE `write` is true, THE tool result SHALL contain the repository-relative paths of the written record and of the Calibration_Index.

### Requirement 11: Command line

**User Story:** As the case author, I want the same runs from a terminal, so that I can reproduce a record without Kiro.

#### Acceptance Criteria

1. THE Engine_CLI SHALL offer the subcommands `list-cases`, `run-scenario` and `calibrate`, which call the same Scenario_Runner and tool handlers as `list_cases`, `run_scenario` and `run_calibration`, with the same inputs as flags (`--case`, `--variant`, `--intervention <id>@<seconds>` repeatable, `--max-seconds`, `--interval`, `--stop-at-ending`, `--decompress-at`, `--early-decompress-at`, `--write`) and the global flags `--url` and `--max-sessions`.
2. WHEN `calibrate` succeeds, THE Engine_CLI SHALL print the Calibration_Record to stdout.
3. WHEN `list-cases` or `run-scenario` succeeds, THE Engine_CLI SHALL print the tool's JSON result to stdout.
4. THE Engine_CLI SHALL exit with code 0 on success (for `calibrate`, only when every Calibration_Check passes), 3 when `calibrate` succeeds with "NOT calibrated", 2 for invalid arguments, and 1 for every other error, including the Unreachable_Error.
5. IF the arguments are invalid, THEN THE Engine_CLI SHALL print a usage message to stderr before any network request.
6. FOR ALL equal inputs given once as Engine_CLI flags and once as tool arguments, THE Scenario_Runner SHALL receive equal Scenario requests (equivalence property).

### Requirement 12: Determinism and reproducibility

**User Story:** As the case author, I want the same scenario to give the same record, so that a record in `docs/` can be checked by running it again.

#### Acceptance Criteria

1. WHEN the Calibration_Record is rendered twice from equal Scenario_Results and an equal Record_Header, THE two Calibration_Records SHALL be identical.
2. THE Record_Body SHALL contain no Wall_Clock_Time value, session_id, branch_id or checkpoint_id, and SHALL render every number with a fixed number of decimals per vital sign.
3. WHEN a Scenario on the real Physiology_Service is run twice with the same Variant_Id, Intervention_Plan, Max_Time and Sample_Interval and equal Actual_Times, THE two Scenario_Results SHALL have vital sign values within the 0.001 tolerance of core-simulation-loop 9.1, verified by the manual check of Requirement 17.8.

### Requirement 13: Calibration of the shipped case

**User Story:** As the case author, I want one calibration record of the current draft values, so that I can review them and decide.

#### Acceptance Criteria

1. WHEN the Engine_MCP_Server and the Engine_CLI are complete, THE project SHALL run `run_calibration` (or the Engine_CLI `calibrate`) once with `write` true on `adult-tension-pneumothorax` with the current draft values and default times, and SHALL keep the written Calibration_Record and the Calibration_Index line in `docs/calibration/`.
2. IF the Health_Check fails before that run, THEN THE run SHALL stop and the user SHALL be asked to start the Physiology_Service in their own terminal or to give another Service_URL.
3. IF the Calibration_Record says "Play_Section values NOT calibrated", THEN THE project SHALL keep that record as the expected result of this spec and SHALL report the failing Scenarios to the author without changing any case value or check.

### Requirement 14: Pointers in the play-mode and bedside-exam specs

**User Story:** As a maintainer, I want play-mode and bedside-exam to say where their calibration is implemented, so that the specs do not disagree.

#### Acceptance Criteria

1. WHEN the Scenario_Runner and `run_calibration` are implemented, THE project SHALL add to play-mode Requirement 13, directly under its user story, a note that engine-mcp implements this calibration for both Variants as bedside-exam Requirement 13 requires, through `run_calibration` and the Engine_CLI, and SHALL leave the acceptance criteria text of play-mode Requirement 13 unchanged.
2. WHEN the Scenario_Runner and `run_calibration` are implemented, THE project SHALL add to each of play-mode tasks 12.1, 12.2 and 12.3 a first sub-bullet that names the engine-mcp task that supersedes it, and SHALL mark each of these play-mode tasks done only when the superseding engine-mcp task is done.
3. WHEN the Scenario_Runner and `run_calibration` are implemented, THE project SHALL add one line to the bedside-exam glossary term Calibration_Run and one line to play-mode task 13.1, each stating that the reference to the play-mode calibration script or to play-mode task 12.3 now means the engine-mcp `run_calibration` and the Calibration_Record of Requirement 13.
4. THE pointer edits SHALL change no other line of the play-mode or bedside-exam spec and SHALL change no file of the core-simulation-loop spec.

### Requirement 15: Kiro hooks

**User Story:** As a developer, I want the checks that matter for a file to run when the agent saves it, and the agent stopped before it starts or stops the containers, so that broken cases and tests are found at once and my running service is left alone.

#### Acceptance Criteria

1. THE project SHALL define each hook of this requirement as a file `.kiro/hooks/<id>.json` with `"version": "v1"` and a `hooks` array, each hook having a `name`, a `description`, a `matcher`, a `command` action and a `timeout` in seconds; the Case_Check_Hook, the Web_Test_Hook and the Python_Test_Hook SHALL use the trigger `PostFileSave` with a `matcher` regular expression against the file path, and the Compose_Guard_Hook SHALL use the trigger `PreToolUse`.
2. WHEN a file under `cases/` is saved, THE Case_Check_Hook SHALL run `scripts/validate-case.py` on every `cases/*.yaml` file through `docker compose run --rm --no-deps -v "$PWD:/repo:ro" -w /repo physiology python3 scripts/validate-case.py <file>`, and then run `npx vitest --run src/lib/caseContent.test.ts` from `apps/web/`.
3. WHEN a `.ts` or `.tsx` file under `apps/web/src/` is saved, THE Web_Test_Hook SHALL run `npx vitest related --run <saved file>` from `apps/web/`, with the saved file taken from the `file_path` field of the hook's stdin JSON.
4. WHEN a `.py` file under `services/physiology/` is saved, THE Python_Test_Hook SHALL run the fast physiology suite (`python3 -m pytest -m "not pulse"`) on the saved source in a one-off `docker compose run --rm --no-deps` container of the `physiology` service, without rebuilding the image, with a command that the verification of criterion 13 shows to work and that writes nothing under `services/physiology/` (no `__pycache__`, `.pytest_cache` or Hypothesis files). The design SHALL choose the exact command, taking into account that compose also mounts `./cases` at `/app/cases`, so a read-only bind mount of the source over `/app` can fail because Docker cannot create the `cases` mount point inside it (options include a writable temporary copy of the source in the container, or mounting the source and `cases` separately).
5. WHEN the agent is about to run a built-in shell tool call whose command text contains a Blocked_Compose_Command, THE Compose_Guard_Hook SHALL exit with code 2 and write to stderr a message that names the blocked command, states that the agent does not start, stop or restart the containers in this project, and asks the user to run the command in their own terminal.
6. WHEN the agent is about to run a built-in shell tool call whose command text contains no Blocked_Compose_Command, THE Compose_Guard_Hook SHALL exit with code 0 and write nothing to stdout, so that `docker compose run`, `docker compose build`, `docker compose ps`, `docker compose logs`, `docker compose config` and every command without `docker compose` run unchanged.
7. THE Compose_Guard_Hook SHALL use a `matcher` that selects only the agent's built-in shell tools and SHALL read the command text from the `tool_input` of its stdin JSON.
8. THE hooks SHALL not pass `--build` or `--service-ports` to `docker compose run`, and SHALL run no Blocked_Compose_Command.
9. IF the checks of the Case_Check_Hook, the Web_Test_Hook or the Python_Test_Hook fail, THEN THE hook command SHALL exit with a non-zero code and write the failing output to stderr, so that Kiro sends it to the agent (kiro.dev `/docs/hooks/actions/`).
10. THE Calibrate_Command SHALL instruct the agent to check that the Physiology_Service is reachable with `list_cases`, to run `run_calibration` on the requested case through the Engine_MCP_Server with `write` false unless the user asks to keep the record, and to summarize which Calibration_Checks pass or fail per Variant, which Status_Rules fire and at which Simulation_Times, and when each Exam_Button first shows an Abnormal_Finding.
11. THE Calibrate_Command SHALL instruct the agent to present results only, to propose no threshold, Hold_Duration, Time_Limit or clinical text, to edit no file under `cases/`, and to remove no `TODO(author)` marker.
12. THE Calibrate_Command SHALL instruct the agent, when a `run_calibration` call times out or the Engine_MCP_Server is not available, to run the Engine_CLI `calibrate` with the same inputs through a shell command with a timeout of at least 1,800,000 ms (30 minutes), and to ask the user to run the Engine_CLI in their own terminal when the run needs longer.
13. THE project SHALL show during implementation that the Case_Check_Hook, the Web_Test_Hook and the Python_Test_Hook fire in the installed Kiro: for each hook, the agent saves one matching file through its file-write tool (under `cases/` and `services/physiology/` with byte-identical content, Requirements 18.1 and 18.4), Kiro runs the hook, and the Hook_Verification_Log records the result.
14. THE project SHALL show during implementation that the Compose_Guard_Hook fires in the installed Kiro: the agent runs `echo docker compose down` through its shell tool and Kiro blocks the call with the hook's message, then the agent runs `echo docker compose ps` and Kiro runs it; the Hook_Verification_Log records both outcomes, and the check uses only these `echo` commands.
15. IF a hook does not fire, or the Compose_Guard_Hook does not block the test command, THEN THE project SHALL record what was tried in the Hook_Verification_Log and report it to the user; a manual run of the hook command SHALL not count as the hook firing, and no other trigger, wrapper or script SHALL replace the hook.

### Requirement 16: MCP configuration, steering and documentation

**User Story:** As a developer, I want the server registered and documented, so that Kiro and a new contributor can use it without asking.

#### Acceptance Criteria

1. THE MCP_Config SHALL register the Engine_MCP_Server under `mcpServers` with a `command` and `args` that start it as Requirement 1.2 states, `"disabled": false`, and `"autoApprove": ["list_cases"]`.
2. THE MCP_Config SHALL list neither `run_scenario`, `run_calibration` nor `"*"` in `autoApprove`, so that Kiro asks the user before each call that creates Sessions.
3. THE MCP_Config SHALL contain no secret, SHALL set no `PHYSIOLOGY_URL`, so that the default Service_URL applies unless the user overrides it, and SHALL set no timeout field other than the one of criterion 4.
4. WHERE the design shows that Kiro 1.5.11 reads a per-server tool-call timeout from the MCP_Config, THE MCP_Config SHALL set that timeout to 3,600,000 ms (60 minutes), for the reason given in decision 14.
5. THE Engine_Steering_File SHALL have front matter `inclusion: fileMatch` with a `fileMatchPattern` that matches every file under `cases/`.
6. THE Engine_Steering_File SHALL tell the agent to run `run_scenario` or `run_calibration` whenever a change touches a threshold, a Scheduled_Insult, an Exam_Rule or a Status_Rule in `cases/`, to report the results to the author, to start no service, to follow the clinical-safety steering rules, and to fall back to the Engine_CLI as Requirement 15.12 states when an MCP call times out.
7. THE Calibrate_Command file SHALL have front matter `inclusion: manual`.
8. THE project SHALL update `.kiro/steering/tech.md` with a short section on the Engine_MCP_Server and the Engine_CLI (start command, `PHYSIOLOGY_URL`, `ENGINE_MCP_MAX_SESSIONS`, approval, CLI fallback) and SHALL leave its verified Pulse facts unchanged.
9. THE project SHALL update `docs/development.md` with how to run the Engine_MCP_Server and the Engine_CLI, how the Physiology_Service must already be running, what each hook runs, how to run the Calibrate_Command, and the Hook_Verification_Log.

### Requirement 17: Automated tests and the manual check

**User Story:** As a maintainer, I want the runner and the record covered by fast tests with a fake service, so that changes cannot leak Sessions or break the record.

#### Acceptance Criteria

1. THE web test suite SHALL include Vitest unit tests of the Scenario_Runner with the Fake_Service for: Session creation with the requested `variant_id`; a `variant_id` mismatch; Planned_Interventions at Requested_Time 0, at a later time, at the same time, and a Late_Intervention; the Actual_Time read from the Checkpoint list; repeated paused samples ignored; a substituted Mark_Sample; `stop_at_ending`; the Rescue_Gate_Time applied at the right sample; and one Fake_Service script run twice giving equal Scenario_Results (Requirements 3.3 to 3.5, 4.1 to 4.8).
2. THE web test suite SHALL include Vitest tests showing that the Session is deleted after success, after an Intervention_API error, after a Vitals_Stream close, after the Stall_Timeout (with a fake clock), after an exception in result computation, and after cancellation through the `AbortSignal`, and that a queued Scenario cancelled before it starts creates no Session (Requirements 6.1 to 6.4, 7.4).
3. THE web test suite SHALL include Vitest tests showing that each tool returns the Unreachable_Error naming the Service_URL when the Health_Check fails, and makes no other request in that case (Requirement 1.6).
4. THE web test suite SHALL include Vitest property tests, with fast-check, no fewer than 100 generated inputs from a fixed seed each, for: input validation (every input outside Requirement 3.1 is rejected before any Fake_Service request); the Session_Cap (for any number of Scenarios and caps from 1 to 8, the Fake_Service never holds more than the cap and every created Session is deleted); and the CLI-to-tool equivalence of Requirement 11.6.
5. THE web test suite SHALL include Vitest tests of the Calibration_Record with synthetic Scenario_Results for each item of Requirement 9, including "NOT calibrated" only on failure, the Requirement 4.18 flag only when the early Scenario shows no tension pneumothorax, a second rendering compared with the first (Requirement 12.1) and checked for the absence of the values of Requirement 12.2, and the record file name, the `-2` suffix, the Calibration_Index creation and append, and the refusal to write outside `docs/calibration/`, with an injected file system (Requirements 9, 10 and 12.1 to 12.2).
6. THE web test suite SHALL include Vitest tests that parse the MCP_Config and every `.kiro/hooks/*.json` file and check Requirements 15.1, 15.8, 16.1 to 16.3, and that run the Compose_Guard_Hook command with sample stdin JSON, expecting exit code 2 for `docker compose up`, `down`, `stop` and `restart` (also with `-f <file>` before the subcommand and inside `echo`) and exit code 0 with empty stdout for `docker compose run`, `docker compose build`, `docker compose ps` and a command without `docker compose` (Requirements 15.5 to 15.7).
7. THE tests of this requirement SHALL run with `npx vitest --run` from `apps/web/` while the Physiology_Service is not running, SHALL open no network connection, and SHALL start no Pulse_Engine (play-mode 12.11).
8. THE project SHALL run one manual check against the real Physiology_Service: `list_cases`, one `run_scenario` for each Variant with a Decompression on the Affected_Side, a repeat of one of them to compare with Requirement 12.3, one run of the Calibrate_Command with `write` false, and the calibration run of Requirement 13, recording the outcome in the task report.

### Requirement 18: Constraints

**User Story:** As the project owner, I want the tools to stay outside the service and the case content, so that adding them cannot break the simulation or change clinical content.

#### Acceptance Criteria

1. THE changes of this spec SHALL modify no file under `services/physiology/`.
2. THE changes of this spec SHALL add `@modelcontextprotocol/sdk` and `zod` to `devDependencies` of `apps/web/package.json` only, and SHALL add no entry to `dependencies`.
3. THE Next.js app SHALL import no module that imports `@modelcontextprotocol/sdk`, and `npx next build` SHALL succeed with no import of the SDK in its output.
4. THE changes of this spec SHALL modify no file under `cases/`, so that no case value or text changes and no `TODO(author)` marker is removed, also when every Calibration_Check passes, and SHALL modify no file under `apps/web/src/` other than the new runner, tool, record and test modules and `apps/web/src/lib/calibration.ts`.
5. THE tools, the Engine_CLI, the hooks and every task of this spec SHALL run no Blocked_Compose_Command, and SHALL use the container on port 8000 only through its HTTP and WebSocket API.
6. THE implementation plan of this spec SHALL have no more than 8 tasks, not counting checkpoints, and each task SHALL end with `npx vitest --run` passing in `apps/web/`.
