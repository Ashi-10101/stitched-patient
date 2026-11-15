# Acceptance Demo Script

This document describes how to verify the acceptance criteria for the core simulation loop.

## Setup

1. Start services:
   ```bash
   docker compose up --build
   ```

2. Open browser to http://localhost:3000

## Demo Scenario: Tension Pneumothorax with Branching

### Part 1: Observe Natural Progression

1. **Select case**: Click "Adult Tension Pneumothorax"

2. **Initial vitals** (t = 0-30s):
   - Heart Rate: ~72 bpm (green, normal)
   - SpO2: ~97% (green, normal)
   - MAP: ~95 mmHg (green, normal)
   - All vitals stable and within normal ranges

3. **Click Play** and watch the simulation clock advance

4. **Insult occurs** (t = 30s):
   - Timeline will show simulation time advancing
   - After 30 seconds, the tension pneumothorax begins

5. **Observe deterioration** (t = 30s to ~4 minutes):
   - Heart Rate: gradually rises toward 170+ bpm
   - SpO2: falls toward 87-88%
   - MAP: falls toward 80 mmHg
   - Alarm colors change from green → yellow → red
   - Trend chart shows declining SpO2 and MAP, rising HR

6. **Click Pause** around t = 4 minutes

Expected state at t = 4 minutes without treatment:
- HR: 170-175 bpm (critical, red)
- SpO2: 87-88% (critical, red)
- MAP: 80-82 mmHg (warning/critical, yellow/red)

### Part 2: Apply Intervention

7. **Find checkpoint**: In Timeline panel, look for checkpoint near t = 3:30 or 4:00 (automatic checkpoints every 30s)

8. **Click checkpoint** to fork a new branch

9. **Verify fork**: 
   - Timeline shows a new branch
   - Vitals reset to the checkpoint state
   - Trend chart clears

10. **Click "Needle decompression - left"**

11. **Resume**: Click Play

12. **Observe recovery** (next 1-2 minutes):
    - Heart Rate: falls back toward 90 bpm
    - SpO2: rises back toward 97%
    - MAP: rises back toward 95 mmHg
    - Alarms return to green

Expected state 2 minutes after decompression:
- HR: ~90 bpm (normal, green)
- SpO2: ~97% (normal, green)
- MAP: ~94 mmHg (normal, green)

### Part 3: Compare Branches

13. **Timeline shows two branches**:
    - Original branch: continued deterioration without treatment
    - New branch: recovery after decompression

14. **Verify independence**: Each branch has its own:
    - Checkpoints
    - Event log (intervention recorded with timestamp)
    - Vitals history

## Verification Checklist

- [x] **Case loads from YAML**: Patient info, interventions, alarm thresholds all read from case file
- [x] **Vitals start normal**: Initial values match StandardMale baseline
- [x] **Scheduled insult occurs at t=30s**: Deterioration begins exactly at 30 seconds
- [x] **Clock control works**: Play/pause/speed (1x, 2x, 4x) all functional
- [x] **Vitals stream at ~1 Hz**: Updates appear smoothly, roughly once per second
- [x] **Trend chart updates**: Last 5 minutes of data shown, scrolls as time advances
- [x] **Alarms change color**: Green → yellow → red based on thresholds in case file
- [x] **Interventions apply**: Button click applies action, vitals respond
- [x] **Automatic checkpoints**: Saved every 30 simulated seconds
- [x] **Manual checkpoint on intervention**: Checkpoint created when intervention applied
- [x] **Fork creates new branch**: Independent timeline with own state
- [x] **Original branch preserved**: Can view/switch between branches
- [x] **Determinism**: Same scenario from same checkpoint produces same vitals (verify with test_determinism.py)
- [x] **Error handling**: If service crashes, page shows error; session can resume from checkpoint after restart
- [x] **Notice displayed**: "Educational simulation, not for clinical use" visible on all pages

## Performance Check

- At 1x speed, simulation time should keep up with wall clock time (±10%)
- At 2x speed, simulation should run roughly twice as fast
- At 4x speed, simulation should run roughly four times as fast

On an M2 Max (emulated), 1x speed should work smoothly. On slower machines, use 2x or 4x to compensate.

## Expected Timeline

Complete demo timeline:
- t=0: Start session, vitals normal
- t=0-30s: Stable baseline
- t=30s: Tension pneumothorax insult applied
- t=30s-4min: Progressive deterioration
- t=4min: Fork from checkpoint
- t=4min: Apply needle decompression
- t=4-6min: Recovery in new branch, continued deterioration in original branch

Total demo time: ~6-8 minutes wall clock (at 1x speed)

## Troubleshooting

If vitals don't update:
1. Check browser console for WebSocket errors
2. Verify physiology service is running: `docker compose ps`
3. Restart services: `docker compose restart`

If deterioration doesn't happen:
1. Check that scheduled insult is in case file at t=30s
2. Check physiology logs: `docker compose logs physiology`
3. Verify Pulse engine is advancing: look at simulation clock

If intervention doesn't work:
1. Check that intervention is listed in case file
2. Check physiology logs for action application errors
3. Verify Pulse supports that action (see tech.md)
