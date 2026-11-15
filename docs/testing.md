# Testing Guide

## Test Categories

### 1. Determinism Test (Automated)

**Location**: `services/physiology/test_determinism.py`

**Purpose**: Verify that the simulation is deterministic - same starting state and actions produce identical results.

**Run**:
```bash
docker compose exec physiology python test_determinism.py
```

**What it tests**:
- Two identical scenarios produce identical vitals
- Checkpoint loading produces exact same state
- Continuing from checkpoint is deterministic
- All vital signs (HR, RR, SpO2, MAP, EtCO2, TV) match within 0.001 tolerance

**Expected output**:
```
✓ All determinism tests passed
  t=20s:  HR=72.0 SpO2=0.974 MAP=95.0
  t=80s:  HR=173.0 SpO2=0.878 MAP=81.0
  t=120s: HR=91.0 SpO2=0.968 MAP=94.0
  t=150s: HR=88.0 SpO2=0.972 MAP=95.0
```

### 2. Manual Acceptance Tests

**Location**: `docs/acceptance-demo.md`

**Purpose**: Verify all acceptance criteria from the spec.

**Key scenarios**:
1. Case loads from YAML
2. Vitals start normal
3. Scheduled insult occurs at correct time
4. Playback controls work
5. Vitals stream at 1 Hz
6. Alarms change color appropriately
7. Interventions apply and vitals respond
8. Checkpoints save automatically
9. Fork creates independent branch
10. Error handling works

### 3. Unit Tests (Future)

**Status**: Not yet implemented

**Recommended coverage**:
- Case file validation
- Alarm threshold logic
- Checkpoint serialization
- Session lifecycle
- API endpoint responses

**Framework**: pytest for Python, Vitest for TypeScript

### 4. Integration Tests (Future)

**Status**: Not yet implemented

**Recommended coverage**:
- Full session lifecycle (create → play → intervene → fork → cleanup)
- WebSocket connection and streaming
- Error recovery scenarios
- Resource cleanup

### 5. Performance Tests (Future)

**Status**: Not yet implemented

**Recommended metrics**:
- Engine advance time per simulated second
- WebSocket latency
- Memory usage per session
- Checkpoint save/load time

## Running Tests

### Automated Tests

Currently only determinism test is automated:

```bash
# Inside Docker
docker compose exec physiology python test_determinism.py

# With pytest (future)
docker compose exec physiology pytest
```

### Manual Testing

Follow the acceptance demo script:

```bash
# Start services
docker compose up -d

# Follow steps in docs/acceptance-demo.md
# Open http://localhost:3000
# Run through each scenario
```

### Test Data

**Case files**:
- `cases/adult-tension-pneumothorax.yaml` - Primary test case
- More cases should be added for regression testing

**Pulse states**:
- `/pulse/bin/states/StandardMale@0s.json` - Default starting state
- Additional states available in Pulse distribution

## Test Scenarios

### Scenario 1: Normal Operation

**Setup**: Start tension pneumothorax case

**Steps**:
1. Session loads successfully
2. Vitals start at baseline (HR ~72, SpO2 ~97%)
3. Play simulation
4. At t=30s, insult occurs
5. Vitals deteriorate over 3-4 minutes
6. Apply needle decompression
7. Vitals recover

**Expected**: All vitals follow expected trajectory, no errors

### Scenario 2: Timeline Branching

**Setup**: Continue from Scenario 1

**Steps**:
1. Pause at t=4:00 (after deterioration)
2. Click checkpoint at t=2:00
3. New branch created
4. Apply different intervention
5. Observe different outcome
6. Original branch preserved

**Expected**: Two independent branches with different trajectories

### Scenario 3: Playback Speed

**Setup**: Start new session

**Steps**:
1. Play at 1x speed for 30s
2. Change to 2x speed
3. Simulation advances twice as fast
4. Change to 4x speed
5. Simulation advances four times as fast
6. Pause and resume

**Expected**: Speed changes take effect immediately, clock advances correctly

### Scenario 4: Multiple Interventions

**Setup**: Start tension pneumothorax case

**Steps**:
1. Play until t=2:00
2. Apply needle decompression (left)
3. Checkpoint created
4. Continue playing
5. Fork from checkpoint at t=1:00
6. Apply different intervention or none
7. Compare outcomes

**Expected**: Each branch tracks interventions independently

### Scenario 5: Error Recovery

**Setup**: Start session, let it run

**Steps**:
1. Stop physiology service: `docker compose stop physiology`
2. Web app should show connection error
3. Restart service: `docker compose start physiology`
4. Refresh page
5. Session state preserved via checkpoints

**Expected**: Can resume from last checkpoint, no data loss

### Scenario 6: Resource Limits

**Setup**: Create multiple sessions

**Steps**:
1. Create first session, play for 5 minutes
2. Create second session
3. Create third session
4. Check checkpoints accumulate
5. Verify oldest automatic checkpoints deleted when limit reached

**Expected**: Checkpoint count per branch stays at or below configured limit (100)

### Scenario 7: Alarm Thresholds

**Setup**: Start tension pneumothorax case

**Steps**:
1. Note initial alarm states (all green)
2. Wait for deterioration
3. Verify HR turns yellow at 120 bpm
4. Verify HR turns red at 140 bpm
5. Verify SpO2 turns yellow at 92%
6. Verify SpO2 turns red at 88%
7. Apply intervention
8. Verify alarms return to green

**Expected**: Alarm colors match thresholds in case file exactly

## Debugging Failed Tests

### Determinism Test Fails

**Symptoms**: Values don't match between runs

**Possible causes**:
1. Pulse engine version mismatch
2. Platform difference (but x86 and ARM produce same results)
3. Race condition in engine state
4. Checkpoint file corrupted

**Debug steps**:
```python
# Print actual values
print(f"Run 1: HR={vitals_1.heart_rate}")
print(f"Run 2: HR={vitals_2.heart_rate}")
print(f"Diff: {abs(vitals_1.heart_rate - vitals_2.heart_rate)}")
```

### WebSocket Test Fails

**Symptoms**: No vitals updates in UI

**Possible causes**:
1. CORS configuration
2. WebSocket endpoint not reachable
3. Session not found
4. Engine crashed

**Debug steps**:
```bash
# Check service logs
docker compose logs physiology

# Test WebSocket manually
wscat -c ws://localhost:8000/sessions/SESSION_ID/vitals

# Check session exists
curl http://localhost:8000/sessions/SESSION_ID
```

### Checkpoint Test Fails

**Symptoms**: Fork doesn't work or vitals don't match

**Possible causes**:
1. Checkpoint file missing or corrupted
2. Data requests mismatch between save and load
3. Simulation time not preserved

**Debug steps**:
```python
# Verify checkpoint file exists
import os
print(os.path.exists(checkpoint_path))

# Check file size (~2.3 MB expected)
print(os.path.getsize(checkpoint_path))

# Try loading manually
wrapper = PulseEngineWrapper.load_from_checkpoint(checkpoint_path)
print(wrapper.get_vitals())
```

## Test Coverage Goals

**Current coverage**: ~60% of critical paths (determinism + manual acceptance)

**Target coverage**: 80%+

**Priority areas to add**:
1. API endpoint unit tests
2. Session manager unit tests
3. Case loader validation tests
4. Alarm logic tests
5. WebSocket integration tests
6. Error handling tests

## Continuous Integration (Future)

Recommended CI pipeline:
1. Lint code (Python: black, flake8; TypeScript: eslint)
2. Run determinism test
3. Run unit tests
4. Build Docker images
5. Run integration tests
6. Deploy to staging

## Performance Benchmarks

**Baseline**: M2 Max, macOS, Docker Desktop

| Metric | Target | Actual |
|--------|--------|--------|
| Engine init time | <5s | ~2s |
| Advance 10s sim time | <1s wall time | ~0.77s (13x) |
| WebSocket latency | <100ms | ~50ms |
| Checkpoint save | <1s | ~0.3s |
| Checkpoint load | <2s | ~1s |
| Memory per session | <100MB | ~50MB |

## Test Data Management

**Case files**: Version controlled in `cases/`

**Checkpoint files**: Generated on demand, not committed

**Test outputs**: Ignored by git (in .gitignore)

**Baseline data**: Store expected vitals trajectories for regression testing

## Smoke Test Checklist

Quick health check after changes:

- [ ] Services start without errors
- [ ] Health endpoint returns 200: `curl http://localhost:8000/`
- [ ] Web app loads: http://localhost:3000
- [ ] Case selection works
- [ ] Session creates successfully
- [ ] WebSocket connects
- [ ] Vitals update in real time
- [ ] Play/pause works
- [ ] Speed changes work
- [ ] Intervention applies
- [ ] Fork works
- [ ] No errors in console
- [ ] No errors in logs

Run this checklist before committing major changes.
