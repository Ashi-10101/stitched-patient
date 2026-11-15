# Screenshots and UI Guide

This document describes the user interface for documentation purposes.

## Home Page (Case Selection)

**URL**: http://localhost:3000

**Elements**:
- App title: "Stitched Patient"
- Subtitle: "Virtual patient for medical training"
- Educational disclaimer: "⚠️ Educational simulation, not for clinical use" (yellow badge)
- Case cards with:
  - Title: "Adult Tension Pneumothorax"
  - Description: Patient demographics and chief complaint
  - Click to start

**Layout**: Centered, max-width container, dark theme

## Simulation View (Bedside Monitor)

**URL**: http://localhost:3000/session/{session_id}

### Header Bar

- Case title (left)
- Patient info: age, sex, summary (below title)
- Educational disclaimer (right, yellow badge)

### Playback Controls (Top section)

- Play/Pause button (blue, prominent)
- Speed selector: 1x, 2x, 4x (pills, blue for active)
- Simulation clock: MM:SS format, large monospace font

### Vital Signs Grid (Left, 2/3 width)

**Primary Vitals** (Row 1):
- Heart Rate: Large number, "bpm" unit, background color by alarm state
- SpO2: Large number, "%" unit, background color by alarm state
- MAP: Large number, "mmHg" unit, background color by alarm state

**Secondary Vitals** (Row 2):
- Respiratory Rate
- EtCO2
- Tidal Volume

Each vital sign card:
- Label at top (gray text)
- Large number (green/yellow/red depending on alarm)
- Unit at bottom (gray text)
- Background color varies by alarm state:
  - Normal: Dark gray
  - Warning: Yellow tint
  - Critical: Red tint

**Trend Chart** (Below vitals):
- Title: "Trends (Last 5 Minutes)"
- X-axis: Time in seconds
- Y-axis: Values
- Three lines:
  - HR: Blue
  - SpO2: Green
  - MAP: Orange
- Legend showing line colors
- Grid lines for reference
- Scrolls as simulation progresses

### Right Sidebar (1/3 width)

**Interventions Panel**:
- Title: "Interventions"
- List of buttons, one per intervention
- Button text from case file
- Hover effect (lighter gray)
- Disabled when not connected

**Timeline Panel** (Below interventions):
- Title: "Timeline & Branches"
- Active branches section:
  - Current branch highlighted (blue border)
  - Branch ID (short form)
  - Parent branch info if forked
  - Event count
- Checkpoints section:
  - Title: "Checkpoints (click to fork)"
  - List of checkpoints
  - Each shows: Time, auto/manual label, description
  - Click to fork new branch
  - Scrollable if many checkpoints

### Color Scheme

**Background**: Very dark gray (#0a0a0a to #1a1a1a)
**Cards**: Medium dark gray (#1f2937 to #374151)
**Text**: White (#ffffff) and light gray (#9ca3af)
**Borders**: Dark gray (#374151)

**Alarm Colors**:
- Normal: Green (#10b981)
- Warning: Yellow (#f59e0b)
- Critical: Red (#ef4444)

**Interactive Elements**:
- Primary buttons: Blue (#3b82f6)
- Hover: Lighter shade
- Active: Darker shade

### Typography

- Headers: Sans-serif, bold
- Numbers: Large (48-64px), bold, tabular numerals
- Body: Sans-serif, regular
- Monospace: Simulation clock

### Responsive Behavior

Target: 1280×720 minimum for screen recording

At 1280×720:
- All vitals visible
- Trend chart readable
- Controls accessible
- Timeline scrollable if needed

## Loading States

**Initial Load**:
- "Loading session..." centered
- Error message below if load fails

**Connecting**:
- "Connecting to simulation..." centered
- Shown when WebSocket connecting

**Connected**:
- Full UI visible
- Vitals updating in real time

## Error States

**Connection Lost**:
- Red banner at top: "WebSocket error - connection lost"
- Vitals frozen at last update
- Controls disabled

**Session Not Found**:
- "Session not found" error page
- Link to return home

**Service Unreachable**:
- Error message with retry instructions
- Suggestion to check service status

## Interactions

### Play/Pause

- Click to toggle
- Icon changes: ▶ (play) ⏸ (pause)
- Immediate effect on simulation

### Speed Selection

- Click any speed button
- Active speed highlighted in blue
- Others gray
- Simulation speed changes immediately

### Apply Intervention

- Click intervention button
- Button briefly disabled
- Checkpoint created (appears in timeline)
- Vitals begin responding

### Fork from Checkpoint

- Click any checkpoint in timeline
- New branch created
- Timeline updates to show new branch
- Vitals reset to checkpoint state
- Trend chart clears
- Simulation continues from that point

## Accessibility Notes

**Color**: Not sole indicator of alarm state (also position in grid)

**Contrast**: All text meets WCAG AA for dark backgrounds

**Focus**: Keyboard focus visible on all interactive elements

**Screen Readers**: All buttons have accessible labels

**Motion**: No animations (users with motion sensitivity)

## UI States Summary

| State | Visual Feedback |
|-------|----------------|
| Normal vital | Green text, dark background |
| Warning vital | Yellow text, yellow-tinted background |
| Critical vital | Red text, red-tinted background |
| Playing | Play button shows "Pause", clock advancing |
| Paused | Play button shows "Play", clock stopped |
| Speed selected | Blue background on speed button |
| Intervention applied | Button briefly disabled, checkpoint added |
| Branch forked | New branch in timeline, trend chart clears |
| Connected | Vitals updating smoothly |
| Disconnected | Error banner, frozen vitals |

## Future UI Enhancements (Out of Scope)

These are not implemented but could be added:

- Waveforms (ECG, pleth)
- Sound effects (alarms, monitor beeps)
- Intervention animations
- Timeline visualization (tree graph)
- Fullscreen mode
- Dark/light theme toggle
- Customizable vital displays
- Export session data
- Share session link

## Design Philosophy

**Clinical Monitor Aesthetic**: Inspired by real bedside monitors
- Dark background (reduces eye strain)
- Large numbers (readable from distance)
- Color-coded alarms (quick status recognition)
- Minimal chrome (focus on data)

**Educational Focus**: 
- Clear simulation clock (learners track time)
- Visible checkpoints (encourage exploration)
- Easy-to-fork timeline (low friction for "what if" scenarios)
- Prominent disclaimer (never mistaken for clinical tool)

**Modern Web Standards**:
- Responsive layout
- Fast load times
- Real-time updates
- Keyboard accessible
- Mobile-friendly (though desktop is primary target)
