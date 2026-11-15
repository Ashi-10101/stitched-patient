# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [0.1.0] - 2026-01-15

### Added - Core Simulation Loop

**Physiology Service**
- FastAPI service with REST and WebSocket APIs
- Session management with isolated Pulse engine instances
- Timeline branching with checkpoint/fork system
- Automatic checkpoints every 30 simulated seconds
- Manual checkpoints on intervention application
- Playback control (play/pause, 1x/2x/4x speed)
- Scheduled insult processing from case files
- Real-time vital signs streaming at ~1 Hz
- Configurable resource limits and timeouts
- Health check endpoint
- Comprehensive error handling and logging

**Web Application**
- Next.js 14 with App Router and TypeScript
- Case selection page
- Bedside monitor UI with:
  - Large numeric vital sign displays
  - Color-coded alarms (green/yellow/red)
  - Trend chart (last 5 simulated minutes)
  - Simulation clock
  - Play/pause and speed controls
  - Dynamic intervention buttons from case file
  - Timeline view with branches and checkpoints
  - Click-to-fork from any checkpoint
- WebSocket integration for real-time updates
- Educational disclaimer notice
- Responsive design (readable at 1280×720)

**Case System**
- YAML format for case definitions
- JSON Schema validation
- Adult tension pneumothorax case implemented
- Configurable alarm thresholds per vital
- Dynamic intervention lists
- Clinical reference tracking

**Testing**
- Determinism test verifying reproducibility
- Manual acceptance test scenarios
- Test documentation

**Documentation**
- Architecture overview
- API reference
- Development guide
- Quick start guide
- Acceptance demo script
- Testing guide
- Technical specification summary

**DevOps**
- Docker Compose for local development
- Dockerfiles for both services
- Environment templates
- Makefile for common operations
- Health checks
- CORS configuration
- Logging setup

**Pulse Integration**
- Python wrapper for Pulse engine API
- Support for tension pneumothorax
- Support for needle decompression
- Checkpoint serialization/deserialization
- Data request configuration for all vitals

### Technical Specifications

**Vitals Tracked**:
- Heart Rate (bpm)
- Respiratory Rate (br/min)
- SpO2 (%)
- Mean Arterial Pressure (mmHg)
- Systolic/Diastolic BP (mmHg)
- End-Tidal CO2 (mmHg)
- Tidal Volume (mL)

**Performance**:
- Target: 1x real-time
- Achieved: 13x on M2 Max (emulated), 20x on x86_64

**Resource Limits**:
- 100 checkpoints per branch
- 300 vitals history points (5 minutes at 1 Hz)
- Configurable idle timeout (default 1 hour)

**APIs**:
- 10 REST endpoints
- 1 WebSocket endpoint
- OpenAPI/Swagger documentation

### Known Limitations

- WebSocket auto-reconnect not implemented
- Idle session cleanup logic incomplete
- Single WebSocket per session (shared playback state)
- Platform: linux/amd64 only (Apple Silicon uses emulation)

### Out of Scope (Future Work)

Features explicitly deferred to future specs:
- LLM-powered patient dialogue
- Physical exam findings
- Rubric-based scoring and debrief
- User accounts and authentication
- Multiplayer/collaborative sessions
- Cloud deployment

## [Unreleased]

Nothing yet.

---

## Release Planning

### 0.2.0 - Patient Dialog (Planned)
- LLM integration for patient responses
- Conversation history
- Patient state awareness
- Voice configuration

### 0.3.0 - Physical Exam (Planned)
- Exam finding generation from engine state
- Body region inspection
- Auscultation findings
- Palpation results

### 0.4.0 - Scoring System (Planned)
- Clinical rubric definition
- Action tracking against rubric
- Automated scoring
- Debrief generation
- Performance report export

### 0.5.0 - Additional Cases (Planned)
- Hemorrhagic shock
- Asthma exacerbation
- Anaphylaxis (if Pulse support improves)
- Additional trauma scenarios

### 1.0.0 - Production Ready (Planned)
- User authentication
- Case authoring UI
- Instructor dashboard
- Cloud deployment
- Performance optimizations
- Comprehensive test suite
