# Architecture

## Overview

Stitched Patient uses a client-server architecture with real-time vital sign streaming:

```
┌─────────────────┐         HTTP/WS          ┌──────────────────────┐
│   Web Browser   │ ◄──────────────────────► │ Physiology Service   │
│   (Next.js)     │                           │   (FastAPI)          │
└─────────────────┘                           └──────────────────────┘
                                                        │
                                                        ▼
                                              ┌──────────────────────┐
                                              │  Pulse Engine(s)     │
                                              │  (C++ via Python)    │
                                              └──────────────────────┘
```

## Components

### Physiology Service (`services/physiology`)

FastAPI service that:
- Owns all Pulse engine instances
- Manages sessions and timeline branches
- Streams vital signs over WebSocket
- Handles interventions and checkpointing

**Key modules:**
- `main.py`: FastAPI app with HTTP and WebSocket endpoints
- `session_manager.py`: Session lifecycle, branches, checkpoints
- `pulse_wrapper.py`: Python wrapper for Pulse engine API
- `case_loader.py`: YAML case file loading and validation
- `models.py`: Pydantic models for API contracts

### Web Application (`apps/web`)

Next.js application with:
- Bedside monitor UI showing vital signs in real time
- Playback controls (play/pause, speed)
- Intervention buttons dynamically generated from case file
- Timeline view for branches and checkpoints
- Trend charts (last 5 simulated minutes)

**Key pages:**
- `/`: Case selection
- `/session/[sessionId]`: Main simulation view

### Case Files (`cases/`)

YAML files defining:
- Patient demographics
- Starting engine state
- Scheduled insults (time, action, parameters)
- Alarm thresholds for each vital
- Available interventions
- Clinical references

Validated against `case-schema.json`.

## Data Flow

### Session Creation

1. User selects a case on web UI
2. Web calls `POST /sessions` with `case_id`
3. Service loads case file, creates Pulse engine from starting state
4. Service creates initial branch and checkpoint
5. Service returns `session_id` and metadata
6. Web redirects to `/session/{session_id}`

### Real-Time Streaming

1. Web opens WebSocket to `/sessions/{session_id}/vitals`
2. Service sends current vitals ~1 Hz
3. If playing, service advances simulation by wall-clock delta × speed multiplier
4. Service checks for scheduled insults in the time window and applies them
5. Service saves automatic checkpoints every 30 sim seconds
6. Web updates monitor displays and trend chart

### Interventions

1. User clicks intervention button
2. Web calls `POST /sessions/{session_id}/interventions`
3. Service applies the Pulse action
4. Service logs the event with timestamp
5. Service saves a manual checkpoint
6. Vital signs respond in subsequent updates

### Branching

1. User clicks a checkpoint in the timeline
2. Web calls `POST /sessions/{session_id}/fork` with `checkpoint_id`
3. Service creates a new Pulse engine loaded from that checkpoint
4. Service creates a new branch linked to parent
5. Service switches current branch to the new one
6. Web clears vitals history and continues from the fork point

## Determinism

The simulation is deterministic:
- Same starting state + same actions at same times = same vitals
- Checkpoints capture complete engine state
- Each branch is independent after forking

This is verified in `test_determinism.py`.

## Resource Management

- One Pulse engine instance per active branch
- Engines are ~2.3 MB per checkpoint on disk
- Checkpoints capped at 100 per branch (oldest automatic ones deleted first)
- Vitals history capped at 300 points (5 minutes at 1 Hz)
- Sessions cleaned up after idle timeout (configurable, default 1 hour)

## Performance

Target: 1x real-time on development machine (13x on M2 Max under emulation).

WebSocket updates at 1 Hz wall-clock time. Simulation advances by:
```
sim_delta = wall_clock_delta * speed_multiplier
```

Speed multipliers:
- 1x: real time
- 2x: double speed
- 4x: quad speed

## Error Handling

- If physiology service is unreachable, web shows clear message
- If engine call fails, session can resume from last checkpoint
- WebSocket reconnection not implemented (page refresh required)
- One failed session never crashes the whole service (isolated engines)
