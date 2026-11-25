# Development Guide

## Local Setup

### Prerequisites

- Docker and Docker Compose
- Node.js 20+ (for local web development without Docker)
- Python 3.9+ (for running tests locally)

### Environment Configuration

1. Copy the environment template:
   ```bash
   cp .env.example .env
   ```

2. For local development, the defaults work. For custom setups:
   - `PULSE_DATA_ROOT`: Path to Pulse data directory (inside container)
   - `NEXT_PUBLIC_PHYSIOLOGY_URL`: URL for web app to reach physiology service

### Starting Services

Full stack with Docker Compose:
```bash
docker compose up --build
```

Services:
- Physiology service: http://localhost:8000
- Web app: http://localhost:3000

API docs: http://localhost:8000/docs (FastAPI auto-generated)

### Development Workflow

#### Working on Physiology Service

The service runs inside a Docker container. To see logs:
```bash
docker compose logs -f physiology
```

To run tests:
```bash
docker compose exec physiology python test_determinism.py
```

To add Python dependencies:
1. Edit `services/physiology/requirements.txt`
2. Rebuild: `docker compose up --build physiology`

#### Working on Web App

For faster iteration, run Next.js locally:

1. Install dependencies:
   ```bash
   cd apps/web
   npm install
   ```

2. Create `.env.local`:
   ```bash
   NEXT_PUBLIC_PHYSIOLOGY_URL=http://localhost:8000
   ```

3. Start dev server:
   ```bash
   npm run dev
   ```

The app will be at http://localhost:3000 with hot reload.

#### Working on Case Files

Case files are mounted read-only into the physiology container. Edit them directly:

```bash
vim cases/adult-tension-pneumothorax.yaml
```

Restart the service to pick up changes:
```bash
docker compose restart physiology
```

Validate against schema:
```bash
docker compose exec physiology python -c "from case_loader import load_case; print(load_case('adult-tension-pneumothorax'))"
```

## Testing

### Determinism Test

Verifies that the simulation is deterministic (same inputs → same outputs):

```bash
docker compose exec physiology python test_determinism.py
```

Expected output:
```
✓ All determinism tests passed
  t=20s:  HR=72.0 SpO2=0.974 MAP=95.0
  t=80s:  HR=173.0 SpO2=0.878 MAP=81.0
  t=120s: HR=91.0 SpO2=0.968 MAP=94.0
  t=150s: HR=88.0 SpO2=0.972 MAP=95.0
```

### Manual Testing Checklist

- [ ] Start a session, verify vitals load
- [ ] Play/pause works
- [ ] Speed changes (1x, 2x, 4x) work
- [ ] Scheduled insult occurs at correct time
- [ ] Vitals respond to insult (HR up, SpO2 down, etc.)
- [ ] Apply intervention, verify vitals respond
- [ ] Automatic checkpoints appear in timeline
- [ ] Fork from a checkpoint creates new branch
- [ ] New branch is independent (vitals don't affect original)
- [ ] Trend chart updates in real time
- [ ] Alarms change color based on thresholds

## Performance

### Expected Performance

On different platforms:
- **x86_64 desktop**: ~20x real time
- **Apple M2 Max (emulated)**: ~13x real time
- **Cloud 1-vCPU VM**: ~1.5x real time

At 1x playback speed, the simulation should advance smoothly. If it lags behind, increase speed multiplier or reduce update frequency.

### Profiling

To check engine performance:

```python
import time
from pulse_wrapper import PulseEngineWrapper

engine = PulseEngineWrapper("/pulse/bin/states/StandardMale@0s.json")

start = time.time()
engine.advance_time(10.0)
elapsed = time.time() - start

print(f"Simulated 10s in {elapsed:.2f}s wall clock = {10/elapsed:.1f}x real time")
```

## Debugging

### WebSocket Connection Issues

If the monitor doesn't update:

1. Check browser console for WebSocket errors
2. Verify physiology service is running: `curl http://localhost:8000/`
3. Check CORS settings in `main.py` if running web app from different origin

### Engine Errors

If the engine fails to start or crashes:

1. Check physiology logs: `docker compose logs physiology`
2. Verify starting state file exists: `docker compose exec physiology ls /pulse/bin/states/`
3. Try running a minimal test inside container:
   ```bash
   docker compose exec physiology python -c "from pulse_wrapper import PulseEngineWrapper; e = PulseEngineWrapper('/pulse/bin/states/StandardMale@0s.json'); print(e.get_vitals())"
   ```

### Case File Validation Errors

If a case fails to load:

1. Check syntax: `yamllint cases/your-case.yaml`
2. Validate against schema using a JSON Schema validator
3. Check physiology logs for detailed error message

## Code Style

### Python

- Follow PEP 8
- Use type hints
- Docstrings for public functions
- Snake_case for functions and variables

### TypeScript/React

- Follow Next.js conventions
- Use TypeScript strict mode
- Functional components with hooks
- CamelCase for components, camelCase for functions

### Git Workflow

Branch naming:
- `feature/description`
- `fix/description`
- `docs/description`

Commit messages:
- Imperative mood: "Add feature" not "Added feature"
- Sentence case
- Reference issues when applicable

## Adding a New Intervention

1. Verify Pulse supports the action (see `tech.md`)

2. Add to case file:
   ```yaml
   interventions:
     - id: your-intervention-id
       label: "Button label"
       action: PulseActionClassName
       parameters:
         param1: value1
   ```

3. Add handler in `pulse_wrapper.py` if needed:
   ```python
   elif action_name == "YourAction":
       action = YourAction()
       # Set parameters
       action.set_something(parameters["something"])
   ```

4. Test manually in the UI

## Adding a New Case

1. Create YAML file in `cases/`:
   ```bash
   cp cases/adult-tension-pneumothorax.yaml cases/your-case.yaml
   ```

2. Edit case data (patient, timeline, alarms, interventions, references)

3. Validate:
   ```bash
   docker compose exec physiology python -c "from case_loader import load_case; load_case('your-case')"
   ```

4. Add to home page (`apps/web/src/app/page.tsx`)

5. Test full scenario

## Troubleshooting

### "Platform mismatch" warning

This is expected. The Pulse image is `linux/amd64` only. On Apple Silicon, Docker will use emulation. Performance is still acceptable for development (~13x real time).

### Checkpoint files growing large

Each checkpoint is ~2.3 MB. With 100 checkpoints per branch, that's ~230 MB per branch. Old sessions should be cleaned up. Implement `SessionManager._cleanup_loop()` to delete idle sessions.

### Vitals freeze after intervention

Check if the engine crashed. Look for exceptions in physiology logs. Some Pulse actions may have preconditions or cause instability with certain parameter combinations.

## Engine tools (engine-mcp)

The engine tools run cases of this educational simulation through the real Pulse engine, from Kiro (MCP server) or from a terminal (command line). They are development tools for case authors, not for clinical use.

### Prerequisite: a running Physiology_Service

The tools talk to a physiology-service that is already running. They never start, stop or restart it. Start it yourself in your own terminal, for example:

```bash
docker compose up physiology
```

The tools read the service URL from `PHYSIOLOGY_URL`, default `http://localhost:8000`. To use the x86 machine on the private network, set `PHYSIOLOGY_URL=http://<host>:8000`, or pass `--url` to the command line. If Node runs with `NODE_USE_ENV_PROXY` set, its `fetch` honours `HTTP_PROXY`, `HTTPS_PROXY` and `NO_PROXY`, so a service on another host may need that host in `NO_PROXY`.

`ENGINE_MCP_MAX_SESSIONS` sets the most sessions the tools open at once: default 4, allowed 1 to 8. An invalid `PHYSIOLOGY_URL` or `ENGINE_MCP_MAX_SESSIONS` stops the server or the command line at startup with a message that names the value.

### MCP server

`.kiro/settings/mcp.json` registers the server `stitched-patient-engine`:

```json
{
  "mcpServers": {
    "stitched-patient-engine": {
      "command": "bash",
      "args": [
        "-c",
        "cd \"$(git rev-parse --show-toplevel)/apps/web\" && exec ./node_modules/.bin/vite-node --config vitest.config.ts scripts/engineMcp.ts"
      ],
      "disabled": false,
      "autoApprove": ["list_cases"]
    }
  }
}
```

It needs `npm install` in `apps/web/` first. Kiro starts the server itself. The tools are:

- `list_cases`: lists the case ids that the running service offers, and so checks that it is reachable. It creates no session. `autoApprove` lists `list_cases`, but in task 7.3 Kiro 1.5.11 still asked for approval in a Supervised session. The likely reason, inferred from the Kiro bundle: Kiro 1.5.11 turns `autoApprove` entries into permission rules only once, in a one-time trust migration per workspace (which needs a trusted workspace), so an `autoApprove` added after that migration does not take effect; choosing "Always allow" in the prompt adds the rule.
- `run_scenario`: runs one case variant with scheduled interventions and returns the samples. Kiro asks you before each call.
- `run_calibration`: runs the calibration scenarios of a case and returns the calibration record. Kiro asks you before each call.

The committed `.kiro/settings/mcp.json` has no `env` on purpose, so the default service URL and session cap apply. To change them, add an `env` block to the same server entry in your user-level MCP config (`~/.kiro/settings/mcp.json`), or edit the workspace file locally and do not commit the change:

```json
"env": { "PHYSIOLOGY_URL": "http://<host>:8000", "ENGINE_MCP_MAX_SESSIONS": "4" }
```

### Command line

The command line calls the same handlers as the MCP tools. Run it from `apps/web/`:

```bash
./node_modules/.bin/vite-node --config vitest.config.ts scripts/engineCli.ts -- list-cases
```

Usage (`CLI_USAGE` in `apps/web/src/lib/engineTools.ts`):

```text
Usage: vite-node --config vitest.config.ts scripts/engineCli.ts -- [--url URL] [--max-sessions N] <command> [flags]

  list-cases
  run-scenario --case ID --variant ID --max-seconds N [--intervention ID@SECONDS]...
               [--interval N] [--stop-at-ending]
  calibrate    --case ID [--decompress-at N] [--early-decompress-at N] [--max-seconds N] [--write]

Exit codes: 0 success; 1 error; 2 invalid arguments; 3 calibrate finished with "NOT calibrated".
```

`calibrate` prints the calibration record. The other commands print JSON.

Exit codes:

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | Any other error, for example the service is not reachable, or the run was ended by SIGINT or SIGTERM |
| 2 | Invalid arguments or configuration. The usage text and the message go to stderr before any request |
| 3 | `calibrate` finished, but the record says "NOT calibrated" |

A full calibration can take many minutes. When the agent uses the command line as a fallback for a timed-out MCP call, it runs it with a shell timeout of at least 1,800,000 ms (30 minutes). Longer runs belong in your own terminal.

### Hooks

The hooks in `.kiro/hooks/` fire when the agent saves a file through its file tools, or before the agent runs a shell command. Each one runs a script in `scripts/hooks/`.

- **Check case files** (`case-check.json`, `PostFileSave`, files under `cases/`): validates every `cases/*.yaml` with `scripts/validate-case.py` in a one-off container (`docker compose run -T --rm --no-deps ... physiology`), then runs `npx vitest --run src/lib/caseContent.test.ts` in `apps/web/`.
- **Run related web tests** (`web-related-tests.json`, `PostFileSave`, `.ts` and `.tsx` files under `apps/web/src/`): runs `npx vitest related --run --passWithNoTests <saved file>` in `apps/web/`.
- **Run fast physiology tests** (`python-tests.json`, `PostFileSave`, `.py` files under `services/physiology/`): runs `python3 -m pytest -p no:cacheprovider -q -m "not pulse"` on a read-only mount of `services/physiology/` in a one-off container. It writes no bytecode, pytest cache or Hypothesis files to the checkout.
- **Block container start and stop** (`compose-guard.json`, `PreToolUse`, the agent's shell tools): blocks any agent command that contains `docker compose up`, `down`, `stop` or `restart`, and asks you to run it in your own terminal. `docker compose run`, `build`, `ps`, `logs` and `config` pass.

The case check and the physiology tests need the `stitched-patient-physiology` image. Build it yourself in your own terminal:

```bash
docker compose build physiology
```

The hooks never build images. If the image is missing, the hook fails with a message that says so. One-off containers publish no ports and leave the running service on port 8000 alone. A failing check exits non-zero and sends its output to the agent.

### Calibrate the case

Type `/calibrate-the-case` in Kiro chat, optionally with a case id (default `adult-tension-pneumothorax`). The agent checks the service with `list_cases`, runs `run_calibration` with `write` false, and summarizes the results. It proposes no clinical values or text and edits no case file.

To keep the record, ask for it: the agent then sets `write` true (or the command line gets `--write`). Records go to `docs/calibration/`, and each one adds a line to the index `docs/calibration/README.md`. An existing record is never overwritten.

### Hook verification

This log records, per check, whether the installed Kiro ran each hook (date, Kiro version, hook, file saved or command tried, result, and the first 20 lines of output).

#### 2026-11-24: Check case files (Case_Check_Hook)
- Kiro version: 1.5.11
- File saved or command tried: `cases/adult-tension-pneumothorax.yaml` (byte-identical rewrite through the agent's file-write tool at 21:34:40 PST; SHA-256 and `git status --short cases apps/web/src services/physiology` unchanged afterwards)
- Kiro ran the hook: yes, with no manual run. Kiro's session events show `ContextualHookInvoked` for "Check case files" with status completed at 21:34:43 PST, and Kiro waited for the hook before the agent's next step. Docker Desktop's backend log shows the one-off container `stitched-patient-physiology-run-fd17bec1a6d2` created at 21:34:41.22 and removed at 21:34:41.99, with read-only mounts `cases` -> `/app/cases` and the repository root -> `/repo` and no published ports (the validate-case step for the one case file)
- file_path form (O2): not shown; the hook reached its docker step, so `savedRepoPath` accepted the form Kiro passes
- Output (first 20 lines):
```text
(Kiro 1.5.11 shows no output for this hook, so pass or fail is not visible)
```

#### 2026-11-24: Run related web tests (Web_Test_Hook)
- Kiro version: 1.5.11
- File saved or command tried: `apps/web/src/lib/engineSlots.ts` (byte-identical rewrite through the agent's file-write tool at about 21:35:38 PST; SHA-256 and `git status --short cases apps/web/src services/physiology` unchanged afterwards)
- Kiro ran the hook: yes, with no manual run. Kiro's session events show `ContextualHookInvoked` for "Run related web tests" with status completed at 21:35:40 PST, and Kiro waited for the hook before the agent's next step. This hook uses no container. It also fired earlier the same evening, 19:19 to 19:30 PST, after `.ts` saves in task 6
- file_path form (O2): not shown
- Output (first 20 lines):
```text
(Kiro 1.5.11 shows no output for this hook, so pass or fail is not visible)
```

#### 2026-11-24: Run fast physiology tests (Python_Test_Hook)
- Kiro version: 1.5.11
- File saved or command tried: `services/physiology/case_resolver.py` (byte-identical rewrite through the agent's file-write tool at 21:36:21 PST; SHA-256 and `git status --short cases apps/web/src services/physiology` unchanged afterwards, and `git status --short --ignored services/physiology` printed nothing)
- Kiro ran the hook: yes, with no manual run. Kiro's session events show `ContextualHookInvoked` for "Run fast physiology tests" with status completed at 21:36:56 PST, and Kiro waited for the hook before the agent's next step. Docker Desktop's backend log shows the one-off container `stitched-patient-physiology-run-16bb6c4a6150` created at 21:36:21.95 and removed at 21:36:56.11 (34 s, close to the 33 s in fact F2 of `.kiro/specs/engine-mcp/design.md`), with read-only mounts `cases` -> `/app/cases` and `services/physiology` -> `/src` and no published ports (the pytest run)
- file_path form (O2): not shown; the hook reached its docker step, so `savedRepoPath` accepted the form Kiro passes
- Output (first 20 lines):
```text
(Kiro 1.5.11 shows no output for this hook, so pass or fail is not visible)
```

#### 2026-11-24: Block container start and stop (Compose_Guard_Hook)
- Kiro version: 1.5.11
- File saved or command tried: `echo docker compose down` through `execute_bash`, then `echo docker compose ps` through `execute_bash`
- Kiro ran the hook: yes. Kiro intercepted `echo docker compose down` before execution and did not run it. `echo docker compose ps` ran (exit code 0) and printed `docker compose ps`. The matcher `^(execute_bash|execute_pwsh)$` selects the shell tool (O4)
- file_path form (O2): not applicable (PreToolUse hook)
- Output (first 20 lines):
```text
(node:30828) [UNDICI-EHPA] Warning: EnvHttpProxyAgent is experimental, expect them to change at any time.
(Use `node --trace-warnings ...` to show where the warning was created)
Blocked: `docker compose down`. The agent does not start, stop or restart the containers in this project. Please run this command in your own terminal.
```
