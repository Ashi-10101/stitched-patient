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
