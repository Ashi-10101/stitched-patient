# Design Document: Core Simulation Loop

## Overview

The Core Simulation Loop is the technical foundation of Stitched Patient, a virtual patient training system that combines real-time physiology simulation with timeline branching for clinical decision exploration. This document describes how the system SHOULD work based on the requirements, identifies architectural patterns, and documents deviations between the current prototype and the correct design.

### Purpose

This feature enables:
- **Real-time physiological simulation** using Kitware's Pulse Physiology Engine
- **Timeline branching** for exploring alternative clinical decisions
- **Deterministic behavior** for reproducible outcomes and fair assessment
- **Responsive bedside monitor** with color-coded alarms and trend charts
- **Playback control** for managing learning pace

### Key Characteristics

- **Deterministic**: Same starting state + same interventions at same times = identical vital signs
- **Concurrent**: Multiple independent sessions run simultaneously without interference
- **Resilient**: One session's failure does not affect others; sessions resume from checkpoints after errors
- **Scalable**: Resource limits prevent memory exhaustion; idle sessions release resources automatically

### Technology Stack

- **Backend**: Python 3.11+, FastAPI, asyncio, Pulse Python bindings
- **Frontend**: TypeScript, Next.js 14, React, WebSocket client
- **Engine**: Pulse Physiology Engine (Kitware, C++ with Python bindings)
- **Data**: YAML case files, JSON Schema validation, JSON checkpoint serialization
- **Deployment**: Docker Compose for local development

---

## Architecture

### System Structure

```
┌─────────────────────┐
│   Web Application   │
│   (Next.js/React)   │
│                     │
│  - Monitor UI       │
│  - Playback         │
│  - Interventions    │
│  - Timeline         │
└──────────┬──────────┘
           │ HTTP/WS
           ▼
┌─────────────────────┐
│ Physiology Service  │
│    (FastAPI)        │
│                     │
│  - SessionManager   │
│  - Clock Tasks      │
│  - Case Loader      │
└──────────┬──────────┘
           │ asyncio.to_thread
           ▼
┌─────────────────────┐
│  Pulse Engines      │
│  (C++ via Python)   │
│                     │
│  - One per Branch   │
│  - State in memory  │
│  - Checkpoints      │
└─────────────────────┘
```

### Concurrency Model

**CRITICAL**: The system uses a **single clock per session** architecture:

1. **Session Creation**: Spawns one `asyncio.Task` that owns all time advancement for that session
2. **Clock Task**: Runs in an infinite loop while the session exists:
   - If playing: advance 1.0 simulated second, wait 1/speed wall-clock seconds
   - If paused: push cached vitals (no engine call), wait 1.0 wall-clock second
   - On error: mark branch failed, set playing=False, log error, broadcast error, continue looping in paused state
3. **Engine Operations**: ALL engine calls go through `asyncio.to_thread` to move blocking C++ work off the event loop
4. **Locking**: Each session has an `asyncio.Lock` held during:
   - Each clock tick (advance + vitals query)
   - Intervention application
   - Checkpoint save
   - Branch fork
5. **WebSocket Handlers**: Subscribe to vitals updates; do NOT advance time
6. **Pause on Disconnect**: When the LAST WebSocket client disconnects, pause the session

**Current Deviation**: The prototype runs the clock INSIDE the WebSocket handler (`/sessions/{session_id}/vitals`), which:
- Each connected client runs its own advance loop
- Two open tabs run the session at double speed
- Clock stops when all clients disconnect
- Does not use thread pool or locking

---

## Components and Interfaces

### 1. SessionManager

**Responsibilities**:
- Create and delete sessions
- Maintain session registry (dict of session_id → Session)
- Spawn and manage clock tasks
- Apply interventions (queued between ticks)
- Fork branches from checkpoints
- Clean up idle sessions

**Key Methods**:

```python
class SessionManager:
    async def create_session(
        self, case_id: str, case_data: Dict[str, Any]
    ) -> Session:
        """
        Create session with timeout.
        
        1. Load case definition
        2. Initialize Pulse engine in thread pool (with 30s timeout)
        3. Create initial branch and checkpoint
        4. Spawn clock task
        5. Return session metadata
        """
        
    async def _clock_task(self, session: Session):
        """
        Single clock per session. Runs until session deleted.
        
        While session exists:
          If playing:
            1. Acquire session lock
            2. Collect unapplied scheduled insults with timeSeconds <= target
            3. Sort by (time, case order)
            4. For each insult: advance to time, apply action
            5. Advance to t+1
            6. Query vitals
            7. Check for checkpoint (every 30s)
            8. Release lock
            9. Push vitals to all subscribers
            10. Wait 1/speed wall-clock seconds (or 0 if tick overran)
          If paused:
            1. Push cached last_vitals
            2. Push to all subscribers
            3. Wait 1.0 wall-clock second
        """
        
    async def apply_intervention(
        self, session: Session, intervention_id: str, parameters: Dict
    ):
        """
        Apply intervention between ticks.
        
        1. Acquire session lock
        2. Validate intervention_id
        3. Apply action in thread pool
        4. Record event in branch log
        5. Save manual checkpoint
        6. Release lock
        """
        
    async def fork_branch(
        self, session: Session, checkpoint_id: str, description: str
    ) -> str:
        """
        Create new branch from checkpoint.
        
        1. Acquire session lock
        2. Find checkpoint in any branch
        3. Copy checkpoint file (don't reuse parent's)
        4. Load engine from copy in thread pool
        5. Create new Branch with set(checkpoint.applied_insults)
        6. Copy parent.events[:checkpoint.event_count]
        7. Switch session.current_branch_id
        8. Release lock
        """
        
    async def step(self, session: Session, num_ticks: int) -> VitalSigns:
        """
        Test hook: advance simulation by num_ticks without wall-clock delays.
        
        Requires session.playing = False (paused).
        Does NOT acquire lock (caller must ensure no concurrent mutations).
        Returns final VitalSigns.
        
        Used by tests to avoid waiting for real-time clock.
        """
```

**Configuration**:
- `CHECKPOINT_INTERVAL = 30.0` (simulated seconds)
- `MAX_CHECKPOINTS_PER_BRANCH`: read from env (10-1000, default 100)
- `SESSION_IDLE_TIMEOUT`: read from env (seconds, default 3600)

---

### 2. Branch

**Data Structure**:

```python
@dataclass
class Branch:
    branch_id: str
    parent_branch_id: Optional[str]
    forked_from_checkpoint: Optional[str]
    engine: PulseEngineWrapper
    events: List[InterventionEvent]
    checkpoints: List[Checkpoint]  # Plain list, manual eviction
    applied_insults: Set[int]      # Set of insult indices
    vitals_history: deque[VitalSigns]  # maxlen=300 (5 min at 1 Hz)
    created_at: datetime
    last_checkpoint_time: float
    tick_counter: float            # Simulated time clock (seconds)
    last_vitals: Optional[VitalSigns]  # Cached for paused path
    failed: bool = False
    failure_reason: Optional[str] = None
```

**Checkpoint Eviction** (per Requirement 7.12):

```python
def add_checkpoint(self, checkpoint: Checkpoint) -> None:
    """
    Add checkpoint with explicit eviction.
    
    If len(checkpoints) >= MAX_CHECKPOINTS_PER_BRANCH:
      1. Find oldest automatic checkpoint (skip t=0)
      2. If found: delete its file, remove from list
      3. Else: find oldest manual checkpoint (skip t=0)
      4. Delete its file, remove from list
    Append new checkpoint
    """
```

**Current Deviations**:
- Uses `deque(maxlen=100)` which silently drops t=0 checkpoint
- Never deletes checkpoint files from disk
- Hard-coded 100 limit (should read `MAX_CHECKPOINTS_PER_BRANCH`)
- `applied_insults` stored on Session (should be per-Branch)

---

### 3. PulseEngineWrapper

**Responsibilities**:
- Initialize Pulse engine from state file
- Advance simulation time
- Query vital signs
- Apply actions (interventions and scheduled insults)
- Save/load checkpoints

**Key Methods**:

```python
class PulseEngineWrapper:
    DATA_ROOT = "/pulse/bin"
    
    def __init__(self, starting_state: str):
        """Initialize from Pulse state JSON. Sets up data requests."""
        
    def advance_time(self, seconds: float) -> None:
        """Advance simulation by seconds. Blocking call."""
        
    def get_vitals(self) -> VitalSigns:
        """Query current vital signs. Blocking call."""
        
    def apply_action(self, action_name: str, parameters: Dict) -> None:
        """Apply Pulse action. Blocking call. Raises ValueError if unknown."""
        
    def save_checkpoint(self, path: Path) -> None:
        """Serialize engine state to file. Blocking call."""
        
    @classmethod
    def load_from_checkpoint(cls, checkpoint_path: Path) -> "PulseEngineWrapper":
        """Create new engine from checkpoint. Blocking call."""
```

**Supported Actions** (from requirements):
- `SETensionPneumothorax`: parameters = {side, type, severity}
- `SENeedleDecompression`: parameters = {side, state}

---

### 4. Case Loader

**Responsibilities**:
- List available case IDs from `cases/` directory
- Load YAML case file
- Validate against `cases/case-schema.json`
- Return parsed case data

**Key Functions**:

```python
def load_case(case_id: str) -> Dict[str, Any]:
    """
    Load and validate case.
    
    1. Read cases/{case_id}.yaml
    2. Parse YAML (catch syntax errors)
    3. Load schema from cases/case-schema.json
    4. Validate with jsonschema (catch validation errors)
    5. Return case data dict
    
    Raises CaseLoadError with specific error message on failure.
    """

def list_cases() -> List[str]:
    """Return list of case IDs (*.yaml filenames, excluding case-schema)."""
```

**Validation Coverage** (from schema):
- Unique case ID (kebab-case pattern)
- Patient demographics (age, sex, summary)
- Engine starting state path
- Scheduled insults (time, action, parameters)
- Alarm thresholds (critical, warning, normal ranges)
- Interventions (id, label, action, parameters)
- References (citation, optional URL)

**Current Deviation**: Prototype skips validation if schema file not found (development convenience). Production should fail-hard.

---

### 5. Web Application

**Pages**:
- `/`: Case selection (lists available cases)
- `/session/[sessionId]`: Main bedside monitor view

**Components**:
- `VitalSign`: Single vital display with color-coded alarm state
- `VitalsTrendChart`: Line chart showing last 5 simulated minutes (300 points)
- `PlaybackControls`: Play/pause buttons, speed selector, simulation clock
- `InterventionPanel`: Dynamic buttons from case file
- `Timeline`: Branch tree with checkpoints, click-to-fork

**API Client** (`lib/api.ts`):
```typescript
export const api = {
  createSession(caseId: string): Promise<SessionMetadata>
  getSession(sessionId: string): Promise<SessionMetadata>
  getCaseData(sessionId: string): Promise<CaseData>
  controlPlayback(sessionId: string, playing?: boolean, speed?: string)
  applyIntervention(sessionId: string, interventionId: string, parameters?)
  forkBranch(sessionId: string, checkpointId: string, description?: string)
  getCheckpoints(sessionId: string, branchId: string): Promise<CheckpointMetadata[]>
  connectVitalsStream(sessionId: string): WebSocket
}
```

**Alarm Logic** (`lib/alarms.ts`):
```typescript
function getAlarmState(value: number, threshold: AlarmThreshold): AlarmState {
  if (value < critical.low || value > critical.high) return 'critical'
  if (value < warning.low || value > warning.high) return 'warning'
  return 'normal'
}
```

**UI Requirements** (from Requirement 8):
- Large font sizes for vital readouts (verified manually)
- Color-coded alarms: green (normal), yellow (warning), red (critical)
- Simulation clock in MM:SS format
- Educational disclaimer notice at top
- Readable at 1280×720 resolution
- Connection status indicator
- Error messages for service unavailable/connection lost

---

## Data Models

### VitalSigns

```python
class VitalSigns(BaseModel):
    simulation_time: float        # seconds since t=0
    heart_rate: float             # bpm
    respiratory_rate: float       # breaths/min
    spo2: float                   # 0-1 fraction
    mean_arterial_pressure: float # mmHg
    systolic_pressure: Optional[float]   # mmHg
    diastolic_pressure: Optional[float]  # mmHg
    etco2: float                  # mmHg
    tidal_volume: float           # mL
```

**JSON Field Names**: Field names MUST match this specification exactly. Test required (Requirement 4.5 - currently missing).

---

### Checkpoint

```python
@dataclass
class Checkpoint:
    checkpoint_id: str              # UUID
    simulation_time: float          # seconds
    path: Path                      # Checkpoint file location
    created_at: datetime            # Wall-clock timestamp
    is_automatic: bool              # True for 30s auto, False for intervention
    description: Optional[str]      # Optional label (max 500 chars)
    applied_insults: frozenset[int] # Insult indices applied at checkpoint time
    event_count: int                # Number of events in parent.events at checkpoint time
    tick_counter: float             # Branch tick_counter value at checkpoint
```

**Current Deviation**: `applied_insults` not stored in checkpoint. Fork recomputes from times, which breaks if case file changes.

---

### Session

```python
@dataclass
class Session:
    session_id: str                    # UUID
    case_id: str                       # Case identifier
    case_data: Dict[str, Any]          # Loaded case definition
    branches: Dict[str, Branch]        # branch_id → Branch
    current_branch_id: str             # Active branch
    created_at: datetime               # Wall-clock timestamp
    playing: bool                      # Playback state
    speed: PlaybackSpeed               # 1x, 2x, or 4x
    temp_dir: Path                     # Checkpoint storage
    lock: asyncio.Lock                 # NEW: Protects all engine operations
    clock_task: asyncio.Task           # NEW: Background clock
    vitals_subscribers: Set[WebSocket] # NEW: Active WebSocket connections
    last_activity: datetime            # NEW: Updated on API requests and WS connections
```

---

### Case Definition (YAML)

```yaml
id: adult-tension-pneumothorax      # kebab-case, unique
title: Adult Tension Pneumothorax   # Human-readable

patient:
  age: 32                            # Non-negative integer
  sex: male                          # male | female | other
  summary: "Chief complaint..."      # One-line string

engine:
  startingState: /pulse/bin/states/StandardMale@0s.json

timeline:
  scheduledInsults:
    - timeSeconds: 30.0              # Non-negative float
      action: SETensionPneumothorax  # Pulse action name
      parameters:
        side: Left
        type: Closed
        severity: 0.75

alarms:
  heartRate:
    critical: {low: 40, high: 140}
    warning: {low: 50, high: 120}
    normal: {low: 60, high: 100}
  # ... (similar for other vitals)

interventions:
  - id: needle-decompression-left
    label: "Needle decompression - left"
    action: SENeedleDecompression
    parameters:
      side: Left
      state: On

references:
  - citation: "Clinical guideline citation"
    url: "https://..."
```

**TODO Markers**: Case file includes `TODO(author)` comments for values needing medical review (Requirement 1.14, Issue 9).

---

## Key Flows

### Flow 1: Session Creation

```
Web → POST /sessions {case_id}
  ↓
SessionManager.create_session(case_id, case_data)
  ↓
1. Validate case_id exists
2. Load case with CaseLoader
3. Create Session object
4. asyncio.wait_for(initialize_engine(), timeout=30)
   ↓ asyncio.to_thread
   PulseEngineWrapper(starting_state)
     → Pulse C++ initialization
5. Create initial Branch
6. asyncio.to_thread: query initial vitals, set branch.last_vitals
7. Save initial checkpoint (t=0)
8. Spawn clock_task(session)
9. Return SessionMetadata
  ↓
Web ← 201 Created {session_id, branches, ...}
```

**Error Paths**:
- Case not found → 404
- YAML syntax error → 404 with parse error message
- Schema validation failure → 404 with validation error
- Engine init timeout (>30s) → 500 with timeout message
- Engine init failure → 500 with engine error message

**Current Deviation**: No timeout enforcement. Should use `asyncio.wait_for(..., 30)`.

---

### Flow 2: Clock Task (Single Loop Per Session)

```python
async def _clock_task(session: Session):
    """Runs for lifetime of session."""
    while True:
        try:
            if session.playing:
                tick_start = asyncio.get_event_loop().time()
                try:
                    vitals = await _advance_tick(session)
                except Exception as e:
                    # Engine failure
                    branch = session.current_branch
                    branch.failed = True
                    branch.failure_reason = str(e)
                    session.playing = False
                    logger.error(f"Engine error in session {session.session_id} branch {branch.branch_id}: {e}")
                    _broadcast_error(session, str(e))
                    continue
                
                _broadcast_vitals(session, vitals)
                # Wait 1/speed seconds (or 0 if overran)
                multiplier = {"1x": 1, "2x": 2, "4x": 4}[session.speed.value]
                await asyncio.sleep(max(0, tick_start + 1.0/multiplier - asyncio.get_event_loop().time()))
            else:
                # Paused: push cached vitals at 1 Hz
                _broadcast_vitals(session, session.current_branch.last_vitals)
                await asyncio.sleep(1.0)
        except asyncio.CancelledError:
            # Session deleted
            raise
```

**`_broadcast_vitals(session, vitals)`** (never raises):

- If vitals is None, do nothing.
- Send vitals.model_dump() to each subscriber. If a send fails, remove that subscriber and update session.last_activity. If it was the last subscriber, set session.playing = False.
- Exceptions are caught per subscriber, so a client problem can never stop the clock task or mark the branch failed.
- `_broadcast_error` follows the same rules.

**`_advance_tick` Algorithm** (CRITICAL):

```python
async def _advance_tick(session: Session):
    """Advance exactly 1.0 simulated second."""
    async with session.lock:
        branch = session.current_branch
        engine = branch.engine
        
        target = branch.tick_counter + 1.0
        
        # 1. Collect unapplied insults with timeSeconds <= target
        pending = [
            (idx, insult) for idx, insult in enumerate(session.case_data["timeline"]["scheduledInsults"])
            if insult["timeSeconds"] <= target
            and idx not in branch.applied_insults
        ]
        
        # 2. Sort by (timeSeconds, case file order)
        pending.sort(key=lambda item: (item[1]["timeSeconds"], item[0]))
        
        # 3. Apply each insult at its exact time
        last_advance = branch.tick_counter
        for idx, insult in pending:
            insult_time = insult["timeSeconds"]
            if insult_time > last_advance:
                await asyncio.to_thread(engine.advance_time, insult_time - last_advance)
                last_advance = insult_time
            
            await asyncio.to_thread(
                engine.apply_action, insult["action"], insult["parameters"]
            )
            branch.applied_insults.add(idx)
        
        # 4. Advance remaining time to target
        if target > last_advance:
            await asyncio.to_thread(engine.advance_time, target - last_advance)
        
        # 5. Query vitals
        vitals = await asyncio.to_thread(engine.get_vitals)
        branch.vitals_history.append(vitals)
        branch.last_vitals = vitals
        branch.tick_counter = target
        
        # 6. Check for auto checkpoint
        if target - branch.last_checkpoint_time >= 30.0:
            await _save_checkpoint(session, branch, is_automatic=True)
        
        return vitals
```

**Current Deviation (CRITICAL BUG)**: The prototype calls `engine.advance_time(delta)` INSIDE the loop over scheduled insults, so each tick advances N × delta when the case has N insults. This causes simulation time to jump ahead incorrectly.

---

### Flow 3: Intervention Application

```
Web → POST /sessions/{session_id}/interventions {intervention_id, parameters}
  ↓
SessionManager.apply_intervention(session, intervention_id, parameters)
  ↓
async with session.lock:
  1. Validate intervention_id in case.interventions
  2. Merge runtime parameters with case defaults
  3. asyncio.to_thread: engine.apply_action(action, params)
  4. Record InterventionEvent in branch.events
  5. asyncio.to_thread: engine.save_checkpoint(path)
  6. asyncio.to_thread: query vitals, set branch.last_vitals
  7. Add manual Checkpoint to branch
  8. branch.last_checkpoint_time = current_time
  ↓
Web ← 200 OK {status: "applied", intervention_id}
```

**Error Paths**:
- Unknown intervention_id → 400 with list of valid IDs
- Engine action failure → 500 with error message

**Timing**: Intervention is applied BETWEEN ticks (clock task waits for lock).

---

### Flow 4: Branch Fork

```
Web → POST /sessions/{session_id}/fork {checkpoint_id, description}
  ↓
SessionManager.fork_branch(session, checkpoint_id, description)
  ↓
async with session.lock:
  1. Find checkpoint in any branch (404 if not found)
  2. Copy checkpoint file to new path
  3. asyncio.to_thread: load engine from copied file
  4. Create new Branch:
     - applied_insults = set(checkpoint.applied_insults)
     - events = parent.events[:checkpoint.event_count]
     - tick_counter = checkpoint.tick_counter
     - vitals_history starts empty
  5. asyncio.to_thread: query vitals, set branch.last_vitals
  6. session.current_branch_id = new_branch_id
  7. Save initial checkpoint for new branch
  ↓
Web ← 200 OK {branch_id, parent_branch_id, forked_from_checkpoint, ...}
```

**Current Deviations**:
1. Reuses parent's checkpoint file (should copy)
2. Rewrites `applied_insults` from times (should copy set from checkpoint)

---

### Flow 5: WebSocket Vitals Stream

```
Web → WS /sessions/{session_id}/vitals
  ↓
Accept connection
Add to session.vitals_subscribers
Update session.last_activity
  ↓
Clock task broadcasts vitals to all subscribers (1/2/4 Hz at 1×/2×/4×, 1 Hz paused)
  ↓
On disconnect:
  Remove from session.vitals_subscribers
  Update session.last_activity
  If len(vitals_subscribers) == 0:
    session.playing = False  # Pause on last disconnect
```

**Current Deviation**: Clock runs INSIDE WebSocket handler. Should be independent background task.

---

### Flow 6: Error Recovery

```
Clock task encounters engine error
  ↓
1. Set branch.failed = True
2. Set branch.failure_reason = error message
3. Set session.playing = False
4. Log error with session_id and branch_id
5. Broadcast error to all subscribers
6. Clock task continues (paused state)
  ↓
User clicks play
  ↓
POST /sessions/{session_id}/playback {playing: true}
  ↓
If branch.failed:
  async with session.lock:
    1. Find most recent checkpoint
    2. asyncio.to_thread: load engine from checkpoint
    3. Restore branch.applied_insults = set(checkpoint.applied_insults)
    4. Restore branch.events = branch.events[:checkpoint.event_count]
    5. Restore branch.tick_counter = checkpoint.tick_counter
    6. Drop vitals from vitals_history after checkpoint time
    7. asyncio.to_thread: query vitals, set branch.last_vitals
    8. branch.failed = False
    9. branch.failure_reason = None
    10. Release old engine instance
    11. session.playing = True
```

**Current Deviation**: Error recovery mechanism not implemented. Engine failure currently crashes the WebSocket handler.

---

### Flow 7: Idle Session Release

```
Background cleanup task runs every min(60, SESSION_IDLE_TIMEOUT/2) seconds
  ↓
For each session:
  If len(session.vitals_subscribers) == 0 and now - session.last_activity > SESSION_IDLE_TIMEOUT:
    async with session.lock:
      1. Cancel clock_task
      2. For each branch: terminate engine instance
      3. Delete all checkpoint files from temp_dir
      4. Remove session from registry
```

**last_activity Updates**:
- Session creation
- All API requests (playback control, intervention, fork)
- WebSocket connect
- WebSocket disconnect

---

## Design Decisions

### Decision 1: Single Clock Per Session

**Problem**: How to advance simulation time consistently across multiple WebSocket connections?

**Options**:
1. Each WebSocket handler advances time independently
2. Single background task per session advances time
3. Global tick manager advances all sessions

**Chosen**: Option 2 (single background task per session)

**Rationale**:
- **Determinism**: One clock ensures interventions and insults apply at precise times
- **Consistency**: All clients see identical vitals progression
- **Isolation**: Session failure doesn't affect other sessions
- **Simplicity**: No cross-session coordination needed

**Trade-offs**:
- One asyncio task per session (acceptable for 10-100 concurrent sessions)
- Task overhead (~50KB per session, negligible vs ~50MB per engine instance)

---

### Decision 2: Thread Pool for Engine Operations

**Problem**: Pulse engine is blocking C++ code. Calling it directly would block the asyncio event loop.

**Options**:
1. Run engine in separate process (multiprocessing)
2. Run engine calls in thread pool (asyncio.to_thread)
3. Rewrite Pulse bindings to be async (impractical)

**Chosen**: Option 2 (thread pool)

**Rationale**:
- **Simplicity**: `asyncio.to_thread` is built-in, no IPC needed
- **Performance**: Thread pool reuses threads across sessions
- **Memory**: Shared memory space (vs process isolation)

**Trade-offs**:
- Thread pool size limits concurrent engine operations (default: min(32, CPU_COUNT + 4))
- Must hold lock during entire engine operation (prevents concurrent access)

---

### Decision 3: Per-Branch Applied Insults Set

**Problem**: How to track which scheduled insults have been applied when forking branches?

**Options**:
1. Store `processed_insults` on Session (shared across branches)
2. Store `applied_insults` on Branch (independent per branch)
3. Recompute from event log and current time

**Chosen**: Option 2 (per-branch set)

**Rationale**:
- **Correctness**: Fork must preserve which insults were applied at checkpoint time
- **Independence**: New branch doesn't affect parent's insult tracking
- **Simplicity**: Set membership test is O(1)

**Implementation**:
- Key format: insult index in `case_data["timeline"]["scheduledInsults"]`
- `applied_insults` is `Set[int]`
- Stored in Checkpoint as `frozenset[int]`
- Copied when forking (not recomputed)

---

### Decision 4: Checkpoint Storage and Eviction

**Problem**: Checkpoints accumulate (~2.3MB each). How to limit storage?

**Options**:
1. Unlimited checkpoints (runs out of disk)
2. Fixed cap per session (loses old branches)
3. Fixed cap per branch (preserves all branches)

**Chosen**: Option 3 (cap per branch, configurable 10-1000, default 100)

**Rationale**:
- **Fairness**: Long-running branches don't consume disproportionate storage
- **Usability**: t=0 checkpoint always preserved (can restart from beginning)
- **Flexibility**: Environment variable allows tuning per deployment

**Eviction Policy**:
1. Prefer deleting oldest automatic checkpoint
2. If no automatic checkpoints (except t=0), delete oldest manual checkpoint
3. Never delete t=0 checkpoint

**Current Deviation**: Uses `deque(maxlen=100)` which silently drops t=0 if exceeded. Should use plain list with explicit eviction.

---

### Decision 5: Alarm Thresholds in Case File

**Problem**: Different cases need different alarm thresholds. Where to define them?

**Options**:
1. Hard-coded in client (inflexible)
2. Global configuration file (not case-specific)
3. Per-case in YAML file (flexible)

**Chosen**: Option 3 (case file)

**Rationale**:
- **Flexibility**: Neonatal vs adult cases have different normal ranges
- **Maintainability**: Case authors can update thresholds without code changes
- **Traceability**: Thresholds documented with clinical references

**Structure**:
```yaml
alarms:
  heartRate:
    critical: {low: 40, high: 140}
    warning: {low: 50, high: 120}
    normal: {low: 60, high: 100}
```

**Requirement**: All threshold values MUST have clinical references or TODO comments (Requirement 1.14, Issue 9).

---

### Decision 6: WebSocket vs HTTP Polling

**Problem**: How to stream vital signs to the client in real time?

**Options**:
1. HTTP polling (client requests vitals every second)
2. Server-Sent Events (one-way stream)
3. WebSocket (bidirectional stream)

**Chosen**: Option 3 (WebSocket)

**Rationale**:
- **Efficiency**: One persistent connection vs N HTTP requests per second
- **Latency**: Push updates immediately (no polling delay)
- **Simplicity**: FastAPI has built-in WebSocket support

**Stream Rate**:
- Playing at 1×: 1 Hz
- Playing at 2×: 2 Hz
- Playing at 4×: 4 Hz
- Paused: 1 Hz (cached vitals)

**Trade-offs**:
- Client must handle disconnection (page refresh required in current prototype)
- Not HTTP-cacheable (vitals are real-time, so caching not useful)

**Future Enhancement**: Add WebSocket auto-reconnect with state recovery.

---

### Decision 7: Determinism Tolerance

**Problem**: Floating-point arithmetic is not perfectly reproducible. What tolerance is acceptable?

**Options**:
1. Exact equality (fails due to floating-point errors)
2. 0.001 tolerance (clinically insignificant difference)
3. 1% relative tolerance (varies by vital sign magnitude)

**Chosen**: Option 2 (0.001 absolute tolerance)

**Rationale**:
- **Clinical Significance**: 0.001 bpm heart rate difference is unmeasurable
- **Simplicity**: Absolute tolerance easier to reason about than relative

**Test Implementation** (Requirement 9.6):
```python
async def test_determinism():
    """Test using step() hook to bypass wall-clock delays."""
    # Run 1: No checkpoint
    session1 = await create_session("adult-tension-pneumothorax")
    session1.playing = False  # step() requires paused
    vitals1 = await session_manager.step(session1, 120)  # 120 ticks = 2 minutes
    
    # Run 2: From checkpoint at t=60
    session2 = await create_session("adult-tension-pneumothorax")
    session2.playing = False
    await session_manager.step(session2, 60)
    checkpoint = session2.current_branch.checkpoints[-1]  # Auto checkpoint at t=60
    branch_id = await session_manager.fork_branch(session2, checkpoint.checkpoint_id, "test fork")
    session2.current_branch_id = branch_id
    session2.playing = False
    vitals2 = await session_manager.step(session2, 60)  # 60 more ticks
    
    # Compare all vital fields
    for field in ["heart_rate", "respiratory_rate", "spo2", "mean_arterial_pressure", "etco2", "tidal_volume"]:
        assert abs(getattr(vitals1, field) - getattr(vitals2, field)) < 0.001
```

---

## Testing Strategy

### Why Property-Based Testing Does Not Apply

Property-based testing is NOT applicable to this feature. The system integrates with an external physiology engine (Pulse) that:
- Is not a pure function (maintains internal state, uses timers)
- Has non-trivial setup cost
- Requires expensive operations for property test iteration
- Already tested by Kitware (Pulse maintainer)

This feature falls into the **integration and infrastructure** category where property-based testing is inappropriate. Instead, we use **example-based unit tests** for components and **integration tests** with representative scenarios (adult-tension-pneumothorax case) for end-to-end validation.

### Unit Tests

1. **Case Loader**:
   - Valid case loads successfully
   - Invalid YAML returns parse error
   - Schema validation failure returns field path
   - Missing case returns 404

2. **Pulse Wrapper**:
   - Engine initializes from starting state
   - `advance_time` updates current_time
   - `get_vitals` returns all required fields
   - `apply_action` with valid action succeeds
   - `apply_action` with invalid action raises ValueError
   - Checkpoint save/load round-trips

3. **Alarm Logic**:
   - Value in critical range → critical state
   - Value in warning range → warning state
   - Value in normal range → normal state

4. **Checkpoint Eviction**:
   - Adding checkpoint when under cap appends
   - Adding checkpoint when at cap evicts oldest automatic (keeps t=0)
   - When no automatic checkpoints, evicts oldest manual (keeps t=0)
   - Deleted checkpoint file is removed from disk

5. **VitalSigns JSON Encoding** (MISSING - Requirement 4.5):
   - Test that VitalSigns.model_dump() produces exact field names from spec
   - Test that JSON keys match TypeScript interface

### Integration Tests

**Session Manager Tests**:
1. **Session Creation**:
   - Create session completes within 30s
   - Initial branch has checkpoint at t=0
   - Clock task is spawned
   - Session metadata returned correctly

2. **Clock Task**:
   - Playing at 1x advances 1.0 sim second per 1.0 wall second (±10% for scheduling jitter)
   - Playing at 2x advances 1.0 sim second per 0.5 wall seconds
   - Paused does not advance simulation time
   - Vitals pushed at 1/2/4 Hz at 1×/2×/4×, 1 Hz paused

3. **Scheduled Insults**:
   - Insult applied at exact scheduled time (within 0.02s Engine_Time_Step)
   - Vitals reflect insult effects in next update
   - Multiple insults at same time applied in case file order
   - Fork before insult: new branch applies insult when time reached
   - Fork after insult: new branch does NOT reapply insult

4. **Interventions**:
   - Valid intervention applied successfully
   - Event recorded with timestamp and parameters
   - Manual checkpoint saved after intervention
   - Unknown intervention returns 400 with valid IDs list

5. **Branch Fork**:
   - Fork creates new branch with new engine instance
   - New branch starts at checkpoint time
   - Events copied up to checkpoint.event_count
   - Original branch unaffected
   - Applied insults set copied (not recomputed)

6. **Error Recovery**:
   - Engine error marks branch failed and pauses session
   - Play request after error reloads from last checkpoint
   - Other sessions continue unaffected

7. **Resource Management**:
   - One engine per active branch
   - Idle session paused when last WebSocket disconnects
   - Automated test: Session deleted after idle timeout (SESSION_IDLE_TIMEOUT=2)

### Acceptance Tests

**SessionManager-Level Test** (Requirement 11, HIGH PRIORITY):

**Test Hook**: Add `SessionManager.step(session, num_ticks)` method:
- Requires session.playing = False (paused)
- Does NOT acquire lock (caller must ensure no concurrent mutations)
- Calls `_advance_tick()` num_ticks times
- Returns final VitalSigns
- Used by tests to avoid waiting for real-time clock

**Scenario**:
1. Create session for adult-tension-pneumothorax
2. Step to t=150s (insult applied at t=30)
3. Apply needle decompression intervention at t=150
4. Step to t=300s, check vitals at t=210 show improvement
5. Fork from automatic checkpoint at t=150 (before intervention)
6. Step new branch to t=300s
7. Compare vitals at t=270 and t=300: parent (intervention) branch shows better vitals than forked (no-intervention) branch

**Performance Note**: Test uses `step()` to bypass wall-clock delays (~30s execution). The real clock task at 4× speed requires ≥105s wall-clock time (420s simulation / 4) for full scenario.

**Manual Verification** (Requirement 11):
- Screen recording at 1280×720 shows readable UI
- Alarm colors update when vital crosses threshold
- Trend chart updates as vitals stream
- Intervention button shows visual confirmation
- Educational disclaimer visible at top
- Connection lost message appears when service stops

---

## Implementation Deviations

### Critical Deviations (Architectural)

1. **Single Clock Per Session** (Requirements 3, 4, 10.13, 10.14):
   - **Current**: Clock runs inside WebSocket handler (`/sessions/{session_id}/vitals`), so each connected client runs its own advance loop
   - **Correct**: One `asyncio.Task` per session, spawned at creation
   - **Impact**: Two open tabs run the session at double speed; clock stops when all clients disconnect
   - **Fix**: Move clock to `SessionManager._clock_task(session)`

2. **Thread Pool for Engine Operations** (Requirement 10.10):
   - **Current**: Engine calls run directly on event loop
   - **Correct**: Wrap all engine calls with `asyncio.to_thread(...)`
   - **Impact**: Blocking C++ calls freeze all sessions
   - **Fix**: Add thread pool wrapper to all engine operations

3. **Session Lock** (Requirement 10.12):
   - **Current**: No locking
   - **Correct**: `asyncio.Lock` per session, held during tick/intervention/fork
   - **Impact**: Race conditions if multiple clients send intervention requests
   - **Fix**: Add `session.lock` and use `async with session.lock:` in all mutating operations

4. **Session Creation Timeout** (Requirement 2.12):
   - **Current**: No timeout enforcement
   - **Correct**: `await asyncio.wait_for(initialize_engine(), timeout=30)`
   - **Impact**: Stuck engine init hangs forever
   - **Fix**: Wrap engine initialization with timeout

5. **Scheduled Insults Algorithm** (Requirement 5, CRITICAL BUG):
   - **Current**: Calls `engine.advance_time(delta)` inside loop over insults
   - **Correct**: Collect, sort, advance-to-each-time-and-apply, then advance to t+1
   - **Impact**: Simulation time advances N × delta on every tick when the case has N scheduled insults, because each loop iteration calls advance_time
   - **Fix**: Rewrite `advance_simulation` per algorithm in Flow 2

6. **Applied Insults Per Branch** (Requirement 5.7, 5.8):
   - **Current**: `processed_insults` stored on Session, fork rewrites from times
   - **Correct**: `applied_insults: Set[int]` stored on Branch (insult indices), copied when forking
   - **Impact**: Fork may reapply insults if case file changed between creation and fork
   - **Fix**: Move `applied_insults` to Branch, store in Checkpoint as `frozenset[int]`, copy on fork

7. **Checkpoint Cap and Eviction** (Requirement 7.11, 7.12):
   - **Current**: `deque(maxlen=100)`, hard-coded, silent eviction
   - **Correct**: Plain list, explicit eviction logic, configurable max
   - **Impact**: t=0 checkpoint may be lost; files never deleted
   - **Fix**: Implement explicit eviction per Decision 4

8. **Checkpoint File Management**:
   - **Current**: Fork reuses parent's checkpoint file path
   - **Correct**: Copy checkpoint file when forking
   - **Impact**: If parent deletes checkpoint during eviction, child branch breaks
   - **Fix**: `shutil.copy(source_checkpoint.path, new_path)` in fork

9. **Error Recovery** (Requirement 10.1-10.4):
   - **Current**: Engine error crashes WebSocket handler
   - **Correct**: Mark branch failed, pause session, reload from checkpoint on next play
   - **Impact**: Session unusable after engine error
   - **Fix**: Implement error handling per Flow 6

10. **WebSocket Pause on Disconnect** (Requirement 10.7):
    - **Current**: No pause logic; playing stays true with no clock advancing time
    - **Correct**: Pause only when LAST client disconnects
    - **Impact**: Clock task continues in paused state with no subscribers
    - **Fix**: Track `session.vitals_subscribers` set, pause when `len() == 0`

11. **Idle Session Cleanup Loop** (Requirements 10.6, 10.8, 10.9, 10.15):
   - **Current**: `delete_session` and `_cleanup_loop` are TODO stubs
   - **Correct**: Background task runs every min(60, SESSION_IDLE_TIMEOUT/2) seconds, releasing sessions with no subscribers and last_activity > timeout
   - **Impact**: Idle sessions never released; memory and disk grow unbounded
   - **Fix**: Implement cleanup loop per Flow 7

---

### Configuration Deviations

12. **MAX_CHECKPOINTS_PER_BRANCH** (Requirement 7.14):
    - **Current**: Hard-coded 100
    - **Correct**: Read from env (10-1000, default 100)
    - **Fix**: `settings.MAX_CHECKPOINTS_PER_BRANCH = int(os.getenv("MAX_CHECKPOINTS_PER_BRANCH", "100"))`

13. **SESSION_IDLE_TIMEOUT** (Requirement 10.15):
    - **Current**: Hard-coded 3600
    - **Correct**: Read from env
    - **Fix**: `settings.SESSION_IDLE_TIMEOUT = int(os.getenv("SESSION_IDLE_TIMEOUT", "3600"))`

14. **Web App Environment Variable** (Docker Configuration):
    - **Current**: docker-compose.yml sets `PHYSIOLOGY_URL` which nothing reads
    - **Correct**: Set `NEXT_PUBLIC_PHYSIOLOGY_URL=http://localhost:8000`
    - **Impact**: Web app works via api.ts fallback to http://localhost:8000
    - **Fix**: Update docker-compose.yml environment variable name

---

### Testing Deviations

15. **VitalSigns JSON Field Names Test** (Requirement 4.5):
    - **Current**: Missing
    - **Correct**: Test that JSON encoding matches spec exactly
    - **Priority**: Medium
    - **Fix**: Add test comparing `VitalSigns.model_dump()` keys to TypeScript interface

16. **SessionManager-Level Acceptance Test** (Requirement 11):
    - **Current**: Only `test_determinism.py` (wrapper-level)
    - **Correct**: Full scenario test at SessionManager level with `step()` test hook
    - **Priority**: HIGH
    - **Fix**: Implement test per "Acceptance Tests" section above

---

### Documentation and Configuration Deviations

17. **Docker Compose Version** (Issue 6):
    - **Current**: `version: '3.8'` (obsolete key)
    - **Correct**: Remove `version` key (Docker Compose v2 syntax)
    - **Fix**: Delete first line of `docker-compose.yml`

18. **Healthcheck Uses curl** (Issue 6):
    - **Current**: docker-compose.yml uses `CMD curl -f http://localhost:8000/`; the Dockerfile HEALTHCHECK uses `CMD python healthcheck.py`
    - **Correct**: kitware/pulse:4.3.1 image has python3 only (not python or curl)
    - **Impact**: Both healthchecks fail (compose: no curl, Dockerfile: no python)
    - **Fix**: Use `CMD python3 healthcheck.py` in docker-compose.yml and services/physiology/Dockerfile

19. **.gitignore Missing Entries** (Issue 7):
    - **Current**: Missing `venv/`, `.venv`, `.env.*.local`
    - **Correct**: Add these common Python/Node patterns
    - **Fix**: Append to `.gitignore`

20. **Overclaiming Documentation** (Issue 8):
    - **Current**: `IMPLEMENTATION_COMPLETE.md`, `CHANGELOG.md`, `docs/screenshots.md` exist
    - **Correct**: Delete these files (feature is prototype, not production-ready)
    - **Impact**: Misleading stakeholders about implementation status
    - **Fix**: `rm IMPLEMENTATION_COMPLETE.md CHANGELOG.md docs/screenshots.md`

21. **Alarm Threshold Citations** (Issue 9, Requirement 1.14):
    - **Current**: Some thresholds lack `TODO(author)` markers
    - **Correct**: All thresholds without specific citations need TODO comments
    - **Example**: `# TODO(author): verify EtCO2 alarm thresholds and add clinical source`
    - **Fix**: Add TODOs to `cases/adult-tension-pneumothorax.yaml`

22. **Patient Age vs Starting State** (Issue 9):
    - **Current**: Case specifies age 32, uses `StandardMale@0s.json` (age?)
    - **Correct**: Either document StandardMale age or add TODO about mismatch
    - **Fix**: Add comment: `# TODO(author): verify StandardMale age matches 32yo patient`

---

## Performance Characteristics

### Resource Usage (Estimated)

- **Pulse Engine Instance**: ~50MB RAM per branch (C++ heap + Python objects)
- **Checkpoint File**: ~2.3MB per checkpoint (serialized engine state)
- **Session Overhead**: ~50KB (Python objects + asyncio task)
- **Total per Session**: ~50MB + (2.3MB × checkpoints) + (50MB × branches)

**Example**: Session with 3 branches, 30 checkpoints per branch:
- Engines: 3 × 50MB = 150MB
- Checkpoints: 90 × 2.3MB = 207MB
- Total: ~357MB

**Capacity Estimate**: 2GB RAM supports ~20-30 concurrent sessions (depends on branch count).

---

### Performance Targets

- **Engine Speed**: ≥1× real time (requirement), ~13.5× measured on M2 Max (amd64 emulation)
- **Vitals Stream**: 1/2/4 Hz at 1×/2×/4×, 1 Hz paused
- **Intervention Latency**: <1 simulated second (applied between ticks)
- **Fork Latency**: <5 seconds (engine load from checkpoint)
- **Session Creation**: <30 seconds (timeout enforced)

---

### Test Execution Time (Estimated)

- **Unit Tests**: ~5-10 seconds total (fast, in-memory)
- **Integration Tests**: ~30-60 seconds (create sessions, advance time)
- **Acceptance Test**: ~30 seconds (uses `step()` test hook to bypass wall-clock delays)
- **Determinism Test**: ~60 seconds (2 runs to 120s each)

---

## Error Handling

### Error Categories

1. **Case Loading Errors** (4xx):
   - Case not found → 404 with case_id
   - YAML syntax error → 404 with parse error and line number
   - Schema validation failure → 404 with field path and validation message

2. **Session Creation Errors** (5xx):
   - Engine init timeout (>30s) → 500 with timeout message
   - Engine init failure → 500 with engine error
   - Starting state file not found → 500 with path

3. **Runtime Errors** (4xx/5xx):
   - Unknown intervention_id → 400 with list of valid IDs
   - Unknown checkpoint_id → 404 with checkpoint_id
   - Engine operation failure → 500 with error message, session continues from last checkpoint

4. **Client Errors**:
   - WebSocket disconnect → Pause session on last disconnect
   - Service unreachable → Display error message with reconnection status

---

### Error Isolation

**Per Requirement 10.2**: One session's failure MUST NOT affect other sessions.

**Mechanisms**:
- Separate asyncio task per session (task crash isolated)
- Separate Pulse engine instance per branch (engine failure isolated)
- Exception handling in clock task (logs error with session_id and branch_id, marks branch failed, continues paused)
- Thread pool isolation (blocking engine call doesn't freeze event loop)

---

## Security Considerations

### Input Validation

- **Case ID**: Validated against available cases (prevent directory traversal)
- **Intervention ID**: Validated against case.interventions (prevent arbitrary action execution)
- **Checkpoint ID**: Validated against session branches (prevent cross-session access)
- **Parameters**: Validated by Pulse engine (engine raises ValueError on invalid)

### Resource Limits

- **Checkpoint Cap**: Prevents unbounded disk usage
- **Vitals History Cap**: Prevents unbounded memory usage (deque maxlen=300)
- **Session Timeout**: Releases resources from abandoned sessions
- **Engine Timeout**: Prevents stuck initialization from holding resources

### CORS Policy

**Current**: `allow_origins=["*"]` (development only)

**Production**: Restrict to deployed web app origin.

---

## Deployment Considerations

### Environment Variables

```bash
# Required
PULSE_DATA_ROOT=/pulse/bin              # Pulse engine data directory

# Optional (with defaults)
MAX_CHECKPOINTS_PER_BRANCH=100          # 10-1000 range
SESSION_IDLE_TIMEOUT=3600               # seconds
CORS_ORIGINS=http://localhost:3000      # comma-separated list

# Next.js
NEXT_PUBLIC_PHYSIOLOGY_URL=http://localhost:8000
```

---

### Docker Configuration

**Physiology Service**:
- Platform: `linux/amd64` (Pulse binary requirement)
- Volume: Mount `cases/` directory (read-only)
- Healthcheck: `CMD python3 healthcheck.py` (kitware/pulse:4.3.1 has python3 only)
- Restart: On failure (isolated failures should not crash service)

**Web Application**:
- Depends on: `physiology` service
- Environment: `NEXT_PUBLIC_PHYSIOLOGY_URL=http://localhost:8000` set for client-side API calls
- Port: 3000 (external) → 3000 (internal)

---

### Monitoring

**Metrics** (future enhancement):
- Active sessions count
- Total branches across all sessions
- Disk usage (checkpoint storage)
- Memory usage (engine instances)
- Clock task health (ticks per second, overruns)
- WebSocket connection count

**Logs**:
- Session creation/deletion
- Engine errors (with session_id and branch_id)
- Intervention applications
- Checkpoint saves/loads
- Fork operations

---

## Future Enhancements

### Out of Scope for This Spec

These features require separate specifications:

1. **LLM Patient Dialog**: OpenAI-compatible API integration for patient responses
2. **Physical Exam Findings**: Engine state → exam findings mapping
3. **Rubric-Based Scoring**: Track actions against clinical guidelines, generate debrief
4. **User Accounts**: Authentication, session ownership, progress tracking
5. **Multiplayer**: Multiple learners collaborating on one simulation
6. **Cloud Deployment**: Kubernetes, load balancing, persistent storage

---

### Architectural Improvements (Within Scope)

1. **WebSocket Auto-Reconnect**:
   - Client detects disconnect, attempts reconnect every 2s for 30s
   - Server resumes vitals stream from current time
   - Priority: Medium (improves reliability)

2. **Multi-Client Session Sharing**:
   - Multiple learners view same simulation
   - Separate playback controls per client (optional)
   - Priority: Low (requires significant UI changes)

3. **Checkpoint Diff/Dedup**:
   - Store only delta between checkpoints (reduce 2.3MB to ~100KB)
   - Requires custom serialization format
   - Priority: Low (only valuable at scale)

4. **Progressive Checkpoint Loading**:
   - Fork loads checkpoint lazily (display UI immediately, load engine in background)
   - Requires engine state streaming API
   - Priority: Low (fork is already <5s, acceptable)

5. **Waveform Display**:
   - Show ECG, plethysmograph waveforms (if Pulse supports)
   - Requires higher-frequency data stream (30-100 Hz vs current 1 Hz)
   - Priority: Medium (significant educational value)

---

## References

- [Pulse Physiology Engine](https://gitlab.kitware.com/physiology/engine) - Kitware, Apache-2.0 license
- [FastAPI WebSocket Documentation](https://fastapi.tiangolo.com/advanced/websockets/)
- [Python asyncio Documentation](https://docs.python.org/3/library/asyncio.html)
- [Next.js Documentation](https://nextjs.org/docs)
- Clinical guidelines referenced in individual case files

---

## Appendix: File Inventory

### Prototype Files (Existing)

**Physiology Service** (`services/physiology/`):
- `main.py` - FastAPI application
- `session_manager.py` - Session and branch management
- `pulse_wrapper.py` - Pulse engine wrapper
- `case_loader.py` - Case file loading
- `models.py` - Pydantic models
- `config.py` - Configuration
- `healthcheck.py` - Health check endpoint
- `test_determinism.py` - Determinism test
- `Dockerfile` - Container build
- `requirements.txt` - Python dependencies
- `pytest.ini` - Pytest configuration

**Web Application** (`apps/web/`):
- `src/app/page.tsx` - Case selection
- `src/app/session/[sessionId]/page.tsx` - Main simulation view
- `src/components/VitalSign.tsx` - Vital display
- `src/components/VitalsTrendChart.tsx` - Trend chart
- `src/components/PlaybackControls.tsx` - Playback controls
- `src/components/InterventionPanel.tsx` - Intervention buttons
- `src/components/Timeline.tsx` - Branch timeline
- `src/lib/api.ts` - API client
- `src/lib/alarms.ts` - Alarm logic
- `src/types/index.ts` - TypeScript types
- `Dockerfile` - Container build
- `package.json` - Node dependencies
- `next.config.js` - Next.js config
- `tailwind.config.js` - Tailwind config
- `tsconfig.json` - TypeScript config

**Cases** (`cases/`):
- `adult-tension-pneumothorax.yaml` - First case
- `case-schema.json` - JSON Schema
- `README.md` - Case authoring guide

**Documentation** (`docs/`):
- `README.md` - Documentation index
- `architecture.md` - System architecture
- `api.md` - API reference
- `development.md` - Development guide
- `testing.md` - Testing strategy
- `DEVLOG.md` - Development log
- `core-simulation-spec.md` - Implementation summary
- `acceptance-demo.md` - Demo script

**Configuration**:
- `docker-compose.yml` - Service orchestration
- `Makefile` - Development shortcuts
- `.gitignore` - Version control exclusions
- `.env.example` - Environment template
- `README.md` - Project overview
- `QUICKSTART.md` - Quick start guide

**Scripts**:
- `scripts/validate-case.py` - Case validation script

---

### Files to Create/Modify

**Fixes for Critical Deviations**:
1. `services/physiology/session_manager.py` - Rewrite clock task, add locking, fix insults algorithm
2. `services/physiology/models.py` - Add `applied_insults` to Branch and Checkpoint
3. `services/physiology/main.py` - Move clock spawn to session creation, add timeout
4. `services/physiology/config.py` - Add MAX_CHECKPOINTS_PER_BRANCH, SESSION_IDLE_TIMEOUT env vars

**Fixes for Testing Deviations**:
5. `services/physiology/test_vitalsigns_json.py` - NEW: Test JSON field names
6. `services/physiology/test_acceptance.py` - NEW: SessionManager-level acceptance test

**Fixes for Configuration Deviations**:
7. `docker-compose.yml` - Remove `version` key, healthcheck → `python3 healthcheck.py`, web env → `NEXT_PUBLIC_PHYSIOLOGY_URL`
8. `services/physiology/Dockerfile` - Healthcheck → `CMD python3 healthcheck.py`
9. `.gitignore` - Add `venv/`, `.venv`, `.env.*.local`

**Fixes for Documentation Deviations**:
10. `cases/adult-tension-pneumothorax.yaml` - Add TODO comments for uncited values
11. DELETE: `IMPLEMENTATION_COMPLETE.md`, `CHANGELOG.md`, `docs/screenshots.md`

---

## Summary

This design document specifies how the Core Simulation Loop SHOULD work based on the requirements. Key architectural principles:

1. **Single clock per session** (background asyncio task)
2. **Thread pool for engine operations** (asyncio.to_thread)
3. **Locking for state mutations** (asyncio.Lock per session)
4. **Per-branch insult tracking** (copied on fork, not recomputed)
5. **Explicit checkpoint eviction** (preserve t=0, delete files)
6. **Error recovery from checkpoints** (mark failed, reload on play)
7. **Deterministic behavior** (0.001 tolerance)

The prototype implementation has **11 critical architectural deviations**, **3 configuration deviations**, **2 testing deviations**, and **6 documentation deviations**. All deviations are documented above with impact analysis and fix recommendations.

Once these deviations are corrected, the system will meet all 11 requirements covering case definition, session management, playback control, vitals streaming, scheduled insults, interventions, checkpoints, timeline forking, UI, determinism, and error recovery.
