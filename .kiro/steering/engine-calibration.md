---
inclusion: fileMatch
fileMatchPattern: "cases/**"
---
# Engine calibration while editing cases

These rules apply while you work on a file under `cases/`.

## When to run the engine

- When a change touches a threshold, a Scheduled_Insult, an Exam_Rule or a Status_Rule in `cases/`, run the case through the Engine_MCP_Server: call `run_scenario`, or `run_calibration` with `write` false.
- Report the results to the author. Say which Calibration_Checks pass or fail and quote the engine numbers.

## The service and the containers

- Do not start the Physiology_Service. It must already be running.
- Run no Blocked_Compose_Command: no `docker compose up`, `down`, `stop` or `restart`.
- If `list_cases` or another tool says the Physiology_Service is not reachable, ask the user to start it in their own terminal.

## Clinical safety

- Follow the clinical-safety steering rules.
- Present engine results only. Propose no threshold, Hold_Duration, Time_Limit, clinical value or clinical text.
- Edit no file under `cases/` because of an engine result, for example to make a check pass. Leave that decision to the author. Remove no `TODO(author)` marker.

## Fallback when MCP fails

If an MCP call times out or the Engine_MCP_Server is not available, run the Engine_CLI through `execute_bash` from `apps/web/`, with a timeout of at least 1,800,000 ms (30 minutes):

```bash
./node_modules/.bin/vite-node --config vitest.config.ts scripts/engineCli.ts -- calibrate --case <id>
```

If the run needs longer than 30 minutes, ask the user to run the same command in their own terminal and share the output.
