# Stitched Patient

A virtual patient for medical training that combines the Pulse Physiology Engine (a real-time vital signs simulator) with an LLM-powered patient personality. Learners manage emergency cases, make clinical decisions, and explore alternative timelines by forking and rewinding the simulation. Built for Kiroween 2026 (Frankenstein category).

---

**⚠️ Educational simulation, not for clinical use**

This is a training tool for healthcare learners. It is not a diagnostic tool, not for real patient care, and does not use real patient data.

---

## Features

- **Real-time physiology**: Pulse Physiology Engine computes vital signs continuously
- **Bedside monitor UI**: Large numeric displays, color-coded alarms, trend charts
- **Timeline branching**: Fork the simulation at any checkpoint to explore alternative decisions
- **Playback control**: Play, pause, and speed up (1x, 2x, 4x)
- **Deterministic simulation**: Same actions at same times produce identical results
- **Case-driven**: YAML case files define scenarios, interventions, and alarm thresholds

## Quick Start

### Prerequisites

- Docker and Docker Compose
- For optimal performance: x86_64 machine (or Apple Silicon with emulation)

### Run Locally

1. Clone the repository:
   ```bash
   git clone <repo-url>
   cd stitched-patient
   ```

2. Copy environment template:
   ```bash
   cp .env.example .env
   ```

3. Start services:
   ```bash
   docker compose up --build
   ```

4. Open browser to [http://localhost:3000](http://localhost:3000)

5. Select "Adult Tension Pneumothorax" case

### What to Expect

The demo case simulates a 32-year-old male with a tension pneumothorax:

- **0-30s**: Vitals are stable (HR ~72, SpO2 ~97%, MAP ~95)
- **30s+**: Left tension pneumothorax develops (severity 0.75)
- **Over next few minutes**: HR rises, SpO2 and BP fall
- **Intervention**: Click "Needle decompression - left" to reverse the trend
- **Timeline**: Click any checkpoint to fork and explore a different path

## Architecture

See [docs/architecture.md](docs/architecture.md) for detailed architecture documentation.

### Components

- **Physiology Service** (`services/physiology`): FastAPI + Pulse engine
- **Web App** (`apps/web`): Next.js + React
- **Cases** (`cases/`): YAML case definitions

## Development

### Running Tests

Determinism test (inside physiology container):
```bash
docker compose exec physiology python test_determinism.py
```

### Case Authoring

See [cases/README.md](cases/README.md) and [cases/case-schema.json](cases/case-schema.json).

All clinical content must cite sources. Use TODOs for content needing medical review.

## Project Status

**Current (MVP)**: Core simulation loop with physiology, monitor, interventions, and timeline branching

**Next steps** (separate specs):
- LLM-powered patient dialog
- Physical exam findings
- Rubric-based scoring and debrief

## License

MIT

## References

- [Pulse Physiology Engine](https://gitlab.kitware.com/physiology/engine) (Kitware, Apache-2.0)
- Case content references clinical guidelines (ATLS, AHA, etc.) - see individual case files
