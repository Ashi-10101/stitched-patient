# Implementation Plan: Core Simulation Loop

## Overview

This plan implements the Core Simulation Loop for Stitched Patient, a virtual patient training system combining real-time physiology simulation with timeline branching. The implementation corrects 22 architectural, configuration, testing, and documentation deviations identified in the design document.

The approach follows dependency order: configuration → data models → clock algorithm → concurrency infrastructure → error handling → cleanup → testing. Each task is small enough for single-diff review and includes tests inline (except pure config/docs tasks).

## Tasks

- [x] 1. Add configuration environment variables and test dependencies
  - Update `services/physiology/config.py` using pydantic-settings
  - Add range check (10-1000) to existing `max_checkpoints_per_branch` field
  - Rename `idle_session_timeout_seconds` to `session_idle_timeout` (positive int, default 3600)
  - Add `session_creation_timeout: int` (positive int, default 30)
  - Update `.env.example` with new variables and descriptions
  - Pin pytest-asyncio==0.23.8 and httpx==0.27.2 in `services/physiology/requirements.txt`
  - pytest-asyncio 0.24+ needs pytest >= 8.2; requirements.txt pins pytest 7.4.3
  - httpx 0.28 removed the app= argument that starlette's TestClient uses
  - Set `asyncio_mode = auto` in `services/physiology/pytest.ini`
  - Write test for configuration validation (range checks) in services/physiology/test_config.py
  - Run: `docker compose build physiology && docker compose run --rm physiology python3 -m pytest -v 2>&1 | tee /tmp/sp-pytest.log`
  - Quote pytest summary (passed/failed/skipped) in task report
  - _Requirements: 2.12, 7.14, 10.15_
  - _Deviations: 4, 12, 13_

- [ ] 2. Update data models for per-branch state tracking (services/physiology/session_manager.py)
  - [x] 2.1 Add `applied_insults: Set[int]` field to Branch dataclass
    - Move `applied_insults` from Session to Branch (stores insult indices)
    - Initialize as empty set in Branch constructor
    - Update Session.processed_insults uses in advance_simulation and fork_branch
    - Update callers in main.py to use branch.applied_insults
    - _Requirements: 5.6, 5.7, 5.8_
    - _Deviations: 6_
  
  - [x] 2.2 Add branch runtime state fields to Branch dataclass
    - Add `tick_counter: float` field (simulated time clock, seconds)
    - Add `last_vitals: Optional[VitalSigns]` field (cached for paused path)
    - Add `failed: bool` field (default False)
    - Add `failure_reason: Optional[str]` field (default None)
    - In fork_branch, set new_branch.tick_counter from the source checkpoint's simulation_time
    - _Requirements: 9.4_
    - _Deviations: 7_
  
  - [ ] 2.3 Add concurrency fields to Session dataclass
    - Add `lock: asyncio.Lock` field for protecting engine operations
    - Add `clock_task: asyncio.Task` field for background clock task
    - Add `vitals_subscribers: Set[WebSocket]` field for active connections
    - Add `last_activity: datetime` field for idle timeout tracking
    - Initialize lock in Session constructor
    - _Requirements: 10.12, 10.13, 10.14, 10.6_
    - _Deviations: 3, 10, 11_
  
  - [ ] 2.4 Add checkpoint state fields to Checkpoint dataclass
    - Add `applied_insults: frozenset[int]` field (immutable copy from branch)
    - Add `event_count: int` field (len of parent.events at checkpoint time)
    - Add `tick_counter: float` field (branch simulation clock value)
    - Declare the three fields before description
    - In the same task, pass them in all three existing Checkpoint(...) calls: the t=0 checkpoint in create_session gets frozenset(), 0, and 0.0; _save_checkpoint takes them from the branch; fork_branch copies them from the source checkpoint
    - _Requirements: 5.7, 9.4_
    - _Deviations: 6_

- [ ] 3. Implement correct scheduled insults algorithm
  - [ ] 3.1 Rewrite `_advance_tick` method with correct insult application
    - Acquire session.lock for entire operation
    - Collect all unapplied insults with `timeSeconds <= target`
    - Sort by (timeSeconds, case file order)
    - For each insult: advance to exact time with asyncio.to_thread, apply action, mark applied
    - Advance remaining time to target (exactly 1.0 second total)
    - Query vitals once at end of tick with asyncio.to_thread
    - Update `branch.tick_counter = target`
    - Set `branch.last_vitals = vitals`
    - Check if `target - branch.last_checkpoint_time >= 30.0`, save automatic checkpoint if true
    - Delete the old sync `advance_simulation` method
    - Update WebSocket handler in main.py: replace `advance_simulation` call with `await _advance_tick`
    - Make the WebSocket handler await `_advance_tick` once per loop iteration (will be removed in 5.1)
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.10, 7.1_
    - _Deviations: 5 (CRITICAL BUG)_
  
  - [ ] 3.2 Add `SessionManager.step()` test hook
    - Add method signature: `async def step(session: Session, num_ticks: int) -> VitalSigns`
    - Require `session.playing = False` (paused state)
    - Call `_advance_tick()` num_ticks times without wall-clock delays
    - Return final VitalSigns
    - Used by tests to bypass real-time clock
    - _Requirements: Testing Strategy - Acceptance Tests_
    - _Deviations: 16_
  
  - [ ] 3.3 Write unit tests for insult algorithm
    - Use fake engine that records advance_time() and apply_action() calls
    - Test single insult applied at exact scheduled time
    - Test multiple insults with different times applied in order
    - Test multiple insults at same time applied in case file order
    - Test that the advance_time calls within one tick sum to exactly 1.0 second
    - Test tick_counter advances exactly 1.0 per tick
    - Run: `docker compose build physiology && docker compose run --rm physiology python3 -m pytest -v 2>&1 | tee /tmp/sp-pytest.log`
    - Quote pytest summary (passed/failed/skipped) in task report
    - _Requirements: 5.1, 5.3, 5.4, 5.5, 5.6_

- [ ] 4. Implement single clock per session with thread pool
  - [ ] 4.1 Add `_clock_task` background task method
    - Infinite loop: if playing, call _advance_tick and broadcast; if paused, broadcast cached
    - DO NOT acquire session.lock in clock task (_advance_tick acquires it internally)
    - Wrap all engine calls with `asyncio.to_thread(...)` (in _advance_tick, not here)
    - Handle engine errors in clock task: mark branch failed, pause session, log error, broadcast error, continue
    - Calculate sleep duration based on playback speed (1/2/4 Hz)
    - _Requirements: 3.9, 3.10, 3.11, 4.1, 4.2, 10.10, 10.11, 10.12_
    - _Deviations: 1, 2, 3_
  
  - [ ] 4.2 Implement `_broadcast_vitals` helper function
    - Send vitals.model_dump() to all subscribers in session.vitals_subscribers
    - On send failure: remove subscriber, update session.last_activity
    - If last subscriber removed: set session.playing = False
    - Never raises exceptions (catch per subscriber)
    - _Requirements: 4.1, 4.2, 10.13_
    - _Deviations: 1, 10_
  
  - [ ] 4.3 Implement `_broadcast_error` helper function
    - Send error message to all subscribers
    - Same exception handling as _broadcast_vitals
    - _Requirements: 10.1, 10.2_
    - _Deviations: 9_
  
  - [ ] 4.4 Write integration tests for clock task
    - Use fake engine for timing validation (no Pulse overhead)
    - Test playing at 1x advances 1.0 sim second per 1.0 wall second (±10%)
    - Test playing at 2x advances at 2× rate
    - Test paused does not advance simulation time
    - Test vitals pushed at correct frequency (1/2/4 Hz, 1 Hz paused)
    - Test playback state transitions (paused → playing → paused)
    - Test speed changes without requiring pause
    - Test playing state continues when play clicked while playing
    - Test paused state remains when pause clicked while paused
    - Run: `docker compose build physiology && docker compose run --rm physiology python3 -m pytest -v 2>&1 | tee /tmp/sp-pytest.log`
    - Quote pytest summary (passed/failed/skipped) in task report
    - _Requirements: 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 4.1, 4.2_

- [ ] 5. Convert WebSocket handler to subscribe-only and spawn clock task
  - [ ] 5.1 Rewrite `/sessions/{session_id}/vitals` WebSocket endpoint and update create_session
    - On connect: add WebSocket to session.vitals_subscribers, update last_activity
    - On disconnect: remove from vitals_subscribers, update last_activity
    - If last subscriber: set session.playing = False
    - Do NOT advance time in this handler (clock task does that)
    - Update create_session: after creating initial branch, spawn clock task
    - Store task reference in `session.clock_task`
    - Initialize `session.vitals_subscribers = set()`
    - Initialize `session.last_activity = datetime.now()`
    - Update callers in main.py to use new WebSocket logic
    - _Requirements: 2.4, 2.5, 2.6, 2.7, 2.8, 4.1, 4.2, 10.7, 10.13, 10.14_
    - _Deviations: 1, 10_
  
  - [ ] 5.2 Write integration test for pause-on-disconnect
    - Create session with 2 WebSocket connections
    - Verify playing continues with both connected
    - Disconnect one, verify still playing
    - Disconnect second, verify session.playing = False
    - Run: `docker compose build physiology && docker compose run --rm physiology python3 -m pytest -v 2>&1 | tee /tmp/sp-pytest.log`
    - Quote pytest summary (passed/failed/skipped) in task report
    - _Requirements: 10.7_

- [ ] 6. Implement intervention application with manual checkpoints
  - [ ] 6.1 Rewrite existing `Branch.add_checkpoint` method with explicit eviction and file deletion
    - Replace `checkpoints: deque` with `checkpoints: List[Checkpoint]`
    - Remove maxlen constraint (eviction will be explicit)
    - If len(checkpoints) >= settings.max_checkpoints_per_branch:
      - Find oldest automatic checkpoint (skip t=0)
      - If found: delete file, remove from list
      - Else: find oldest manual checkpoint (skip t=0)
      - Delete file, remove from list
    - Append new checkpoint
    - _Requirements: 7.11, 7.12_
    - _Deviations: 7_
  
  - [ ] 6.2 Update `_save_checkpoint` and `apply_intervention` with locking and thread pool
    - _save_checkpoint becomes async and calls engine.save_checkpoint through asyncio.to_thread. It takes simulation_time and last_checkpoint_time from branch.tick_counter
    - _advance_tick awaits it
    - Use Branch.add_checkpoint for eviction logic
    - In apply_intervention, acquire session.lock for entire operation
    - Wrap engine.apply_action with asyncio.to_thread
    - Wrap engine.save_checkpoint with asyncio.to_thread
    - Wrap engine.get_vitals with asyncio.to_thread (update last_vitals cache)
    - Record event in branch.events with timestamp and parameters
    - Create manual Checkpoint with is_automatic=False
    - Update branch.last_checkpoint_time
    - Return success response
    - Update callers in main.py to use new locking logic
    - _Requirements: 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 7.1, 7.3, 7.4_
    - _Deviations: 2, 3, 6, 7_
  
  - [ ] 6.3 Write unit tests for checkpoint eviction and intervention application
    - Test adding checkpoint when under cap appends normally
    - Test adding checkpoint at cap evicts oldest automatic (keeps t=0)
    - Test when no automatic checkpoints, evicts oldest manual (keeps t=0)
    - Test deleted checkpoint file removed from disk
    - Test max_checkpoints_per_branch configuration honored
    - Test unknown intervention_id returns 400 with list of valid IDs
    - Test engine action failure returns 500 and does not crash service
    - Test manual checkpoint saved after successful intervention
    - Run: `docker compose build physiology && docker compose run --rm physiology python3 -m pytest -v 2>&1 | tee /tmp/sp-pytest.log`
    - Quote pytest summary (passed/failed/skipped) in task report
    - _Requirements: 6.11, 6.12, 7.2, 7.11, 7.12_

- [ ] 7. Implement branch forking with checkpoint copying
  - [ ] 7.1 Update `fork_branch` to copy checkpoint files
    - Acquire session.lock for entire operation
    - Find checkpoint in any branch (404 if not found)
    - Copy checkpoint file to new path with shutil.copy
    - Put the copied fork checkpoint file in session.temp_dir
    - Wrap engine load from copied file with asyncio.to_thread
    - Create new Branch with applied_insults=set(checkpoint.applied_insults)
    - Copy events: new_branch.events = parent.events[:checkpoint.event_count]
    - Set new_branch.tick_counter = checkpoint.tick_counter
    - Wrap get_vitals with asyncio.to_thread (set last_vitals)
    - Switch session.current_branch_id to new branch
    - Save initial checkpoint for new branch
    - Update callers in main.py to use new forking logic
    - _Requirements: 7.5, 7.6, 7.7, 7.8, 7.9, 7.10_
    - _Deviations: 2, 3, 6, 8_
  
  - [ ] 7.2 Write integration tests for branch forking
    - Test fork creates new branch with separate engine instance
    - Test new branch starts at checkpoint time
    - Test events copied up to checkpoint.event_count
    - Test original branch unchanged
    - Test applied_insults copied (not recomputed)
    - Test fork before insult: new branch applies insult when time reached
    - Test fork after insult: new branch does NOT reapply insult
    - Test unknown checkpoint_id returns 404
    - Run: `docker compose build physiology && docker compose run --rm physiology python3 -m pytest -v 2>&1 | tee /tmp/sp-pytest.log`
    - Quote pytest summary (passed/failed/skipped) in task report
    - _Requirements: 7.5, 7.6, 7.7, 7.8, 7.9, 7.13_

- [ ] 8. Implement error recovery from checkpoints
  - [ ] 8.1 Add error recovery to playback control endpoint
    - In POST `/sessions/{session_id}/playback` when setting playing=true
    - Check if current branch.failed is True
    - If failed: restore from most recent checkpoint
      - Acquire session.lock
      - Find most recent checkpoint
      - Wrap engine load with asyncio.to_thread
      - Restore applied_insults from checkpoint
      - Restore events[:checkpoint.event_count]
      - Restore tick_counter from checkpoint (update branch.tick_counter)
      - Drop vitals_history after checkpoint time
      - Wrap get_vitals with asyncio.to_thread (update last_vitals)
      - Release old engine instance
      - Set branch.failed = False, branch.failure_reason = None
      - Release lock
    - Set session.playing = True
    - The playback response's simulation_time reports branch.tick_counter
    - _Requirements: 10.1, 10.2, 10.3, 10.4_
    - _Deviations: 9_
  
  - [ ] 8.2 Write integration test for error recovery
    - Mock engine failure during simulation
    - Verify branch marked failed and session paused
    - Verify error logged with session_id and branch_id
    - Request play after error
    - Verify session restored from last checkpoint (tick_counter restored)
    - Verify other sessions unaffected
    - Run: `docker compose build physiology && docker compose run --rm physiology python3 -m pytest -v 2>&1 | tee /tmp/sp-pytest.log`
    - Quote pytest summary (passed/failed/skipped) in task report
    - _Requirements: 10.1, 10.2, 10.3, 10.4_

- [ ] 9. Implement idle session cleanup
  - [ ] 9.1 Update existing `_cleanup_loop` in SessionManager.start
    - Replace sleep(300) with sleep(min(60, settings.session_idle_timeout / 2))
    - Extract loop body into new method `_cleanup_idle_sessions()`
    - Loop calls `_cleanup_idle_sessions()` after each sleep
    - `_cleanup_idle_sessions()`: for each session, check if len(vitals_subscribers) == 0 and now - last_activity > timeout
    - If idle: call delete_session
    - Remove the unused SessionManager.IDLE_TIMEOUT constant
    - _Requirements: 10.6, 10.15_
    - _Deviations: 11_
  
  - [ ] 9.2 Implement `delete_session` method
    - delete_session becomes async because it takes the lock. In the same task, update the DELETE /sessions/{session_id} endpoint in main.py to await it
    - Acquire session.lock
    - Cancel session.clock_task
    - For each branch: terminate engine instance (no asyncio.to_thread needed - just del)
    - create_session writes the t=0 checkpoint to tempfile.gettempdir(), not session.temp_dir. Delete the file of every checkpoint in every branch, then remove session.temp_dir with shutil.rmtree
    - Remove session from registry
    - _Requirements: 10.8, 10.9_
    - _Deviations: 11_
  
  - [ ] 9.3 Update session.last_activity tracking
    - Update in create_session
    - Update in all API endpoints (playback control, intervention, fork)
    - Update in WebSocket connect/disconnect
    - _Requirements: 10.6_
    - _Deviations: 11_
  
  - [ ] 9.4 Write integration test for idle session release
    - Set session_idle_timeout=2 for test via settings override
    - Create session, verify created
    - Wait ≥ timeout seconds, call `_cleanup_idle_sessions()` directly
    - Verify session deleted from registry
    - Verify checkpoint files deleted from disk
    - Verify one engine per active branch, zero after cleanup
    - Run: `docker compose build physiology && docker compose run --rm physiology python3 -m pytest -v 2>&1 | tee /tmp/sp-pytest.log`
    - Quote pytest summary (passed/failed/skipped) in task report
    - _Requirements: 10.5, 10.6, 10.8, 10.9_

- [ ] 10. Add session creation timeout
  - [ ] 10.1 Wrap engine initialization with configurable timeout
    - In `create_session`, wrap engine init with `asyncio.wait_for(..., timeout=settings.session_creation_timeout)`
    - On timeout: raise TimeoutError with message
    - On engine error: raise with original error message
    - Return 500 status code with error message
    - Update callers in main.py to handle timeout errors
    - _Requirements: 2.9, 2.10, 2.11, 2.12_
    - _Deviations: 4_
  
  - [ ] 10.2 Write unit test for session creation timeout
    - Use fake engine that sleeps ~0.5s with timeout setting ~0.1s
    - Verify timeout error returned within expected time
    - Verify session not created in registry
    - Verify case_id validation (2.9), starting state error (2.10), and engine init error (2.11) still work
    - Run: `docker compose build physiology && docker compose run --rm physiology python3 -m pytest -v 2>&1 | tee /tmp/sp-pytest.log`
    - Quote pytest summary (passed/failed/skipped) in task report
    - _Requirements: 2.9, 2.10, 2.11, 2.12_

- [ ] 11. Add VitalSigns JSON encoding test
  - [ ] 11.1 Write test for VitalSigns field names (services/physiology/test_vitalsigns_json.py)
    - Hard-code expected key list: ["simulation_time", "heart_rate", "respiratory_rate", "spo2", "mean_arterial_pressure", "systolic_pressure", "diastolic_pressure", "etco2", "tidal_volume"]
    - Add comment pointing to apps/web/src/types/index.ts for TypeScript interface
    - Create VitalSigns instance with sample data
    - Call vitals.model_dump()
    - Assert JSON keys match spec exactly
    - Assert values correctly serialized (floats, optional fields)
    - Run: `docker compose build physiology && docker compose run --rm physiology python3 -m pytest -v 2>&1 | tee /tmp/sp-pytest.log`
    - Quote pytest summary (passed/failed/skipped) in task report
    - _Requirements: 4.5_
    - _Deviations: 15_

- [ ] 12. Implement determinism test at SessionManager level
  - [ ] 12.1 Write determinism test using step() hook (services/physiology/test_determinism_manager.py)
    - Keep existing test_determinism.py
    - Create NEW file test_determinism_manager.py
    - Run 1: Create session, pause, step 120 ticks, record vitals at t=120
    - Run 2: Create session, pause, step 60 ticks, use the automatic checkpoint at t=60 that _advance_tick created
    - Fork from automatic checkpoint at t=60, pause, step 60 more ticks, record vitals at t=120
    - Compare all vital fields (heart_rate, respiratory_rate, spo2, mean_arterial_pressure, etco2, tidal_volume)
    - Assert each field differs by no more than 0.001
    - Run: `docker compose build physiology && docker compose run --rm physiology python3 -m pytest -v 2>&1 | tee /tmp/sp-pytest.log`
    - Quote pytest summary (passed/failed/skipped) in task report
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8_
    - _Deviations: 16_

- [ ] 13. Record baseline values for acceptance thresholds
  - [ ] 13.1 Run adult-tension-pneumothorax scenario to establish thresholds (ONE-TIME RECORDING RUN)
    - Create session for adult-tension-pneumothorax case
    - Use step() to advance without wall-clock delays
    - Record vitals at key points:
      - Step one tick at a time from t=1 to t=29. At each tick, check heart rate, SpO2, and MAP
      - Record the min and max of each vital (heart rate, SpO2, MAP) over the t=1 to t=29 window
      - t=150s (2 min after insult, no intervention)
      - t=150s: apply needle decompression
      - Step to t=210s, t=270s, t=300s (record each)
      - Fork from automatic checkpoint at t=150s (is_automatic=True, NOT checkpoints[-1])
      - Step fork to t=270s and t=300s (record each)
    - Record raw vital values at each point
    - Calculate thresholds: keep fixed 11.1 and 11.3 numbers, use ≥50% of observed improvement for 11.5
    - At t=270: record heart rate, SpO2 and MAP on both branches
    - At t=300: record heart rate, SpO2 and MAP on both branches, and the difference between them. 14.1 derives its 11.7 threshold from this difference
    - Write services/physiology/record_baseline.py script to perform this recording
    - Execute as one-off command: `docker compose build physiology && docker compose run --rm physiology python3 record_baseline.py 2>&1 | tee /tmp/sp-baseline.log`
    - Include recorded values in task report
    - If miss fixed thresholds (11.1, 11.3), no improvement (11.5), 11.6 fails (at t=270 the fork's SpO2 is not lower than at the fork point t=150, or the fork does not show lower SpO2 and higher heart rate than the intervention branch), or no difference at t=300 (11.7): STOP and report failure. Do not loosen any threshold or criterion to make it pass
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7_

- [ ] 14. Implement full acceptance test scenario
  - [ ] 14.1 Write acceptance test with empirical thresholds from task 13.1 (services/physiology/test_acceptance.py)
    - Document raw recorded values AND derived thresholds in test_acceptance.py as constants with comment explaining source
    - Use thresholds from baseline run (task 13.1)
    - Test criterion 11.1: Step one tick at a time from t=1 to t=29. At each tick, check heart rate, SpO2, and MAP within tolerance (fixed values)
    - Test criterion 11.2: Insult applied at t=30s
    - Test criterion 11.3: Deterioration at t=150s (fixed values)
    - Test criterion 11.4: Intervention registered within 1s
    - Step intervention branch 150 → 210 → 270 → 300, record vitals at each point
    - Test criterion 11.5: Improvement at t=210s (≥50% of observed improvement from baseline)
    - Test criterion 11.6: Fork from automatic checkpoint at t=150 (is_automatic=True)
    - Step fork 150 → 270, record vitals
    - At t=270: fork shows SpO2 lower than at fork point (t=150)
    - At t=270: fork shows lower SpO2 and higher heart rate than intervention branch
    - Step fork 270 → 300, record vitals
    - Test criterion 11.7: At t=300, intervention branch beats fork by ≥50% of difference from recording run
    - If miss fixed thresholds (11.1, 11.3), no improvement (11.5), 11.6 fails (at t=270 the fork's SpO2 is not lower than at the fork point t=150, or the fork does not show lower SpO2 and higher heart rate than the intervention branch), or no difference at t=300 (11.7): STOP and report failure. Do not loosen any threshold or criterion to make it pass
    - Run: `docker compose build physiology && docker compose run --rm physiology python3 -m pytest -v 2>&1 | tee /tmp/sp-pytest.log`
    - Quote pytest summary (passed/failed/skipped) in task report
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.8_
    - _Deviations: 16_

- [ ] 15. Fix Docker and deployment configuration
  - [ ] 15.1 Fix docker-compose.yml configuration
    - Remove obsolete `version: '3.8'` key
    - Update physiology service healthcheck: `CMD python3 healthcheck.py`
    - Update web service environment: change `PHYSIOLOGY_URL` to `NEXT_PUBLIC_PHYSIOLOGY_URL=http://localhost:8000`
    - _Requirements: None (configuration fixes)_
    - _Deviations: 14, 17, 18_
  
  - [ ] 15.2 Fix services/physiology/Dockerfile healthcheck
    - Change `CMD python healthcheck.py` to `CMD python3 healthcheck.py`
    - _Requirements: None (configuration fixes)_
    - _Deviations: 18_
  
  - [ ] 15.3 Update .gitignore with common patterns
    - Add `venv/`, `.venv`, `.env.*.local` to .gitignore
    - _Requirements: None (configuration fixes)_
    - _Deviations: 19_

- [ ] 16. Fix documentation and case file issues
  - [ ] 16.1 Delete overclaiming documentation files
    - Delete `IMPLEMENTATION_COMPLETE.md`
    - Delete `CHANGELOG.md`
    - Delete `docs/screenshots.md`
    - _Requirements: None (documentation cleanup)_
    - _Deviations: 20_
  
  - [ ] 16.2 Add TODO markers to case file
    - Add `# TODO(author): verify StandardMale age matches 32yo patient` to engine section
    - Add `# TODO(author): verify EtCO2 alarm thresholds and add clinical source` to alarms section
    - Add `# TODO(author): verify tidal volume alarm thresholds and add clinical source` to alarms section
    - Review all threshold values, add TODO comments for any lacking specific citations
    - _Requirements: 1.14_
    - _Deviations: 21, 22_

- [ ] 17. Run full test suite and verify implementation
  - [ ] 17.1 Execute pytest in physiology container
    - Run: `docker compose build physiology && docker compose run --rm physiology python3 -m pytest -v 2>&1 | tee /tmp/sp-pytest.log`
    - Use execute_bash with timeout ≥600000ms (10 minutes)
    - Quote pytest summary (passed/failed/skipped) in task report
    - Report any failures with details
    - If any tests are skipped, report as a problem to investigate
    - _Requirements: All testing requirements_

## Notes

- Tasks are ordered by dependency: config → models → algorithm → concurrency → features → cleanup → testing → deployment
- Each task references specific requirement numbers and deviation numbers from the design document
- The implementation uses Python as the chosen programming language
- Thread pool operations use `asyncio.to_thread` to move blocking Pulse engine calls off the event loop
- Single clock per session ensures deterministic behavior across all clients
- Checkpoint eviction preserves t=0 checkpoint and deletes files from disk
- Error recovery reloads from most recent checkpoint without losing progress
- Idle session cleanup prevents unbounded resource growth
- This is a correctness-focused implementation: all critical architectural deviations must be fixed

### Runtime

- The image runs Python 3.9.2 (Debian 11). Use Optional[...], not X | None. Use asyncio.wait_for, not asyncio.timeout or TaskGroup.
- In Python 3.9, asyncio.Lock binds to the event loop that is current when it is created. Create sessions inside the loop that will use them. Within one test, do not mix TestClient requests with direct awaits on the same session.
- Use TestClient as a context manager (with TestClient(app) as client:). That keeps the app's event loop, and the clock tasks on it, alive for the whole test.

### Test Execution Rules

- Every test task ends with: `docker compose build physiology && docker compose run --rm physiology python3 -m pytest -v 2>&1 | tee /tmp/sp-pytest.log`
- Use execute_bash with timeout ≥600000ms (10 minutes) for test commands
- Quote pytest summary showing passed/failed/skipped counts in task report
- If any tests are skipped, report as a problem requiring investigation
- Pulse engine is only available in Docker container, not on host system
- If execute_bash reports a timeout, read the log or file before retrying. The command may have finished.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1"] },
    { "id": 1, "tasks": ["2.1"] },
    { "id": 2, "tasks": ["2.2"] },
    { "id": 3, "tasks": ["2.3"] },
    { "id": 4, "tasks": ["2.4"] },
    { "id": 5, "tasks": ["3.1"] },
    { "id": 6, "tasks": ["3.2"] },
    { "id": 7, "tasks": ["3.3"] },
    { "id": 8, "tasks": ["4.1"] },
    { "id": 9, "tasks": ["4.2"] },
    { "id": 10, "tasks": ["4.3"] },
    { "id": 11, "tasks": ["4.4"] },
    { "id": 12, "tasks": ["5.1"] },
    { "id": 13, "tasks": ["5.2"] },
    { "id": 14, "tasks": ["6.1"] },
    { "id": 15, "tasks": ["6.2"] },
    { "id": 16, "tasks": ["6.3"] },
    { "id": 17, "tasks": ["7.1"] },
    { "id": 18, "tasks": ["7.2"] },
    { "id": 19, "tasks": ["8.1"] },
    { "id": 20, "tasks": ["8.2"] },
    { "id": 21, "tasks": ["9.1"] },
    { "id": 22, "tasks": ["9.2"] },
    { "id": 23, "tasks": ["9.3"] },
    { "id": 24, "tasks": ["9.4"] },
    { "id": 25, "tasks": ["10.1"] },
    { "id": 26, "tasks": ["10.2"] },
    { "id": 27, "tasks": ["11.1"] },
    { "id": 28, "tasks": ["12.1"] },
    { "id": 29, "tasks": ["13.1"] },
    { "id": 30, "tasks": ["14.1"] },
    { "id": 31, "tasks": ["15.1"] },
    { "id": 32, "tasks": ["15.2"] },
    { "id": 33, "tasks": ["15.3"] },
    { "id": 34, "tasks": ["16.1"] },
    { "id": 35, "tasks": ["16.2"] },
    { "id": 36, "tasks": ["17.1"] }
  ]
}
```
