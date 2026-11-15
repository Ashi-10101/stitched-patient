# Technology Stack

## Architecture

### physiology-service
- **Language**: Python 3
- **Framework**: FastAPI
- **Container**: Docker, based on official image `kitware/pulse:4.3.1` (linux/amd64 only)
- **Role**: owns all Pulse engine instances, exposes HTTP and WebSocket APIs
- **Tests**: pytest

### web
- **Framework**: Next.js (App Router)
- **Language**: TypeScript + React
- **Communication**: HTTP and WebSocket to physiology-service
- **LLM calls**: server-side only
- **Tests**: Vitest

### LLM Integration
- Small adapter using OpenAI-compatible Chat Completions API
- Configuration via environment variables: `LLM_BASE_URL`, `LLM_MODEL`, `LLM_API_KEY`
- **Security**: never commit keys; provide `.env.example` only

### Local Development
- `docker compose up` starts both services
- Target platform: macOS (Apple Silicon)
- **Important**: physiology-service container must declare `platform: linux/amd64` because Pulse image is amd64-only
- Performance under emulation: ~13x real time (sufficient for development)
- Alternative: Windows x86 machine on same private network can run physiology-service (~20x real time)
- Configuration: `PHYSIOLOGY_URL` environment variable makes service location configurable

## Pulse Physiology Engine (verified 2026-11-15)

### Base Image Details
- **Image**: `kitware/pulse:4.3.1`
- **OS**: Debian 11
- **apt sources caveat**: must be switched to `archive.debian.org` with `Acquire::Check-Valid-Until=false` before installing packages
- **Missing dependencies**: pandas, numpy, matplotlib (needed by Pulse Python package)

### Environment
- `PYTHONPATH=/pulse/python:/pulse/bin`
- Data root: `/pulse/bin`
- Starting state: `/pulse/bin/states/StandardMale@0s.json`

### Python API
```python
PulseEngine(data_root_dir=...)
serialize_from_file(path, SEDataRequestManager)
advance_time_s(seconds)
pull_data()
process_action(action)
serialize_to_file(path)
```

### Python imports and usage (verified in the spike)
```python
from pulse.engine.PulseEngine import PulseEngine
from pulse.cdm.engine import SEDataRequest, SEDataRequestManager, eSide, eGate, eSwitch
from pulse.cdm.patient_actions import SETensionPneumothorax, SENeedleDecompression
from pulse.cdm.scalars import FrequencyUnit, PressureUnit, VolumeUnit

reqs = [
    SEDataRequest.create_physiology_request("HeartRate", unit=FrequencyUnit.Per_min),
    SEDataRequest.create_physiology_request("RespirationRate", unit=FrequencyUnit.Per_min),
    SEDataRequest.create_physiology_request("OxygenSaturation"),
    SEDataRequest.create_physiology_request("MeanArterialPressure", unit=PressureUnit.mmHg),
    SEDataRequest.create_physiology_request("EndTidalCarbonDioxidePressure", unit=PressureUnit.mmHg),
    SEDataRequest.create_physiology_request("TidalVolume", unit=VolumeUnit.mL),
]
mgr = SEDataRequestManager(reqs)

engine = PulseEngine(data_root_dir="/pulse/bin")
engine.log_to_console(False)
engine.serialize_from_file("/pulse/bin/states/StandardMale@0s.json", mgr)

engine.advance_time_s(20)
values = engine.pull_data()  # values[0] is simulation time in seconds, then one value per request, in order

ptx = SETensionPneumothorax()
ptx.set_side(eSide.Left); ptx.set_type(eGate.Closed); ptx.get_severity().set_value(0.75)
engine.process_action(ptx)

nd = SENeedleDecompression()
nd.set_side(eSide.Left); nd.set_state(eSwitch.On)
engine.process_action(nd)

engine.serialize_to_file("/tmp/checkpoint.json")         # checkpoint / fork point

branch = PulseEngine(data_root_dir="/pulse/bin"); branch.log_to_console(False)
branch.serialize_from_file("/tmp/checkpoint.json", mgr)  # a new branch starts from the checkpoint
```

### State Management
- Saved state size: ~2.3 MB
- States can be loaded into a new engine to fork the timeline

### Data Requests
- `HeartRate` (1/min)
- `RespirationRate` (1/min)
- `OxygenSaturation` (fraction 0-1)
- `MeanArterialPressure` (mmHg)
- `EndTidalCarbonDioxidePressure` (mmHg)
- `TidalVolume` (mL)

### Verified Actions
- `SETensionPneumothorax` (side: Left/Right, type: Closed/Open, severity: 0-1)
- `SENeedleDecompression` (side, state: On)

### Spike Test Results (Tension Pneumothorax)
**Scenario**: Left closed tension pneumothorax, severity 0.75

**Baseline**: HR 72 / SpO2 0.974 / MAP 95

**After 4 minutes**: HR 173 / SpO2 0.878 / MAP 81

**With needle decompression**: HR 91 / SpO2 0.968 / MAP 94

**Without decompression (forked branch)**: SpO2 fell to 0.71

### Known Pitfall
The `eSubstance_Administration` enum's `.value` is a tuple in this build, causing `TypeError` during action serialization. **Workaround**: wrap it in an object that exposes an integer `.value`.

### Performance
- **x86 desktop**: ~20x real time
- **Apple M2 Max (amd64 emulation)**: ~13x real time
- **1-vCPU cloud VM**: ~1.5x real time
- **Reproducibility**: x86 and emulated Mac produce identical vitals for the same scenario

### Modeling Limits
**Weak or missing models**:
- Opioid overdose produces only small changes
- No anaphylaxis model
- No atropine

**Strong mechanical models** (prefer these):
- Tension pneumothorax
- Hemorrhage
- Asthma
- Airway obstruction
- Sepsis
