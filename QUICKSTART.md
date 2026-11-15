# Quick Start Guide

Get Stitched Patient running in under 5 minutes.

## Prerequisites

- Docker Desktop (Mac, Windows, or Linux)
- Web browser

## Steps

### 1. Start Services

```bash
docker compose up --build
```

Wait for:
- `physiology_1  | INFO:     Application startup complete.`
- `web_1         | ▲ Next.js ready on http://0.0.0.0:3000`

**First build takes ~5-10 minutes** (downloads Pulse image, installs dependencies).

Subsequent starts are faster (~30 seconds).

### 2. Open Browser

Navigate to: **http://localhost:3000**

### 3. Run Demo Case

1. Click **"Adult Tension Pneumothorax"**
2. Wait for connection (should be instant)
3. **Click Play ▶️**
4. Watch vitals for 30 seconds (stable baseline)
5. At t=30s, tension pneumothorax begins
6. Over next 2-4 minutes:
   - Heart Rate rises (→170+ bpm, turns yellow then red)
   - SpO2 falls (→87%, turns red)
   - MAP falls (→80 mmHg, turns yellow)
   - Trend chart shows deterioration
7. **Click Pause ⏸** around t = 4:00
8. In Timeline panel, **click a checkpoint** (e.g., at 3:30)
9. **Click "Needle decompression - left"**
10. **Click Play ▶️** again
11. Watch recovery over next 1-2 minutes:
    - Heart Rate falls back to ~90 bpm (green)
    - SpO2 rises back to ~97% (green)
    - MAP rises back to ~95 mmHg (green)

### 4. Explore Branching

- Timeline shows two branches
- Original branch: continued deterioration
- New branch: recovery after decompression
- Click different checkpoints to explore more scenarios

## Troubleshooting

### Services won't start

```bash
# Stop everything
docker compose down

# Remove old containers
docker compose down -v

# Rebuild
docker compose up --build
```

### Web app shows "Connecting..."

1. Check physiology service is running:
   ```bash
   curl http://localhost:8000/
   ```
   
   Should return:
   ```json
   {"service":"stitched-patient-physiology","status":"running","version":"0.1.0"}
   ```

2. Check browser console (F12) for errors

3. Restart services:
   ```bash
   docker compose restart
   ```

### Vitals don't update

1. Check WebSocket connection in browser console
2. Refresh page
3. Check physiology logs:
   ```bash
   docker compose logs physiology
   ```

### Slow performance

On Apple Silicon (M2/M3), the Pulse image runs under emulation. This is expected. Performance is still adequate (~13x real-time). If simulation lags, use 2x or 4x speed.

## Next Steps

- Read [docs/architecture.md](docs/architecture.md) for system overview
- Read [docs/acceptance-demo.md](docs/acceptance-demo.md) for full demo script
- Read [docs/development.md](docs/development.md) for development setup

## Stopping

```bash
# Stop services (containers remain)
docker compose stop

# Stop and remove containers
docker compose down

# Stop and remove everything including volumes
docker compose down -v
```

## Make Commands

If you have `make` installed:

```bash
make up           # Start services
make down         # Stop services
make logs         # Tail logs
make test-determinism  # Run test
make status       # Show status
```
