---
inclusion: manual
---
# Calibrate the case

Run these steps when the user types `/calibrate-the-case`. The user may name a case; the default is `adult-tension-pneumothorax`.

1. Call `list_cases` to check that the Physiology_Service is reachable. If it fails, stop, show the error and ask the user to start the Physiology_Service in their own terminal. Do not start it yourself and run no Blocked_Compose_Command (`docker compose up`, `down`, `stop` or `restart`).
2. Call `run_calibration` for the requested case with `write` false. Set `write` true only if the user asked to keep the record.
3. Summarize the result per Variant:
   - each Calibration_Check, pass or fail, with its basis;
   - which Status_Rules fired and at which Simulation_Times;
   - when each Exam_Button first shows an Abnormal_Finding;
   - the early comparison and the 4.18 flag.
4. Present results only. Propose no threshold, Hold_Duration, Time_Limit, clinical value or clinical text. Edit no file under `cases/`, and remove no `TODO(author)` marker. Follow the clinical-safety steering rules.
5. If the `run_calibration` call times out or the Engine_MCP_Server is not available, run the Engine_CLI with the same inputs through `execute_bash` from `apps/web/`, with a timeout of at least 1,800,000 ms (30 minutes):

   ```bash
   ./node_modules/.bin/vite-node --config vitest.config.ts scripts/engineCli.ts -- calibrate --case <id>
   ```

   Add `--write` only if the user asked to keep the record, as in step 2. If the run needs longer than 30 minutes, ask the user to run the same command in their own terminal and share the output.
