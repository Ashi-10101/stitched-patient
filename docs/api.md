# API Reference

## Base URL

Local development: `http://localhost:8000`

## Authentication

None (local development only)

## Endpoints

### Health Check

**GET /**

Returns service status.

**Response:**
```json
{
  "service": "stitched-patient-physiology",
  "status": "running",
  "version": "0.1.0"
}
```

### List Cases

**GET /cases**

Returns list of available case IDs.

**Response:**
```json
["adult-tension-pneumothorax"]
```

### Create Session

**POST /sessions**

Create a new simulation session from a case.

**Request:**
```json
{
  "case_id": "adult-tension-pneumothorax"
}
```

**Response:**
```json
{
  "session_id": "550e8400-e29b-41d4-a716-446655440000",
  "case_id": "adult-tension-pneumothorax",
  "created_at": "2026-01-15T10:30:00Z",
  "current_branch_id": "660e8400-e29b-41d4-a716-446655440001",
  "branches": [
    {
      "branch_id": "660e8400-e29b-41d4-a716-446655440001",
      "parent_branch_id": null,
      "forked_from_checkpoint": null,
      "created_at": "2026-01-15T10:30:00Z",
      "event_count": 0
    }
  ]
}
```

### Get Session

**GET /sessions/{session_id}**

Get session metadata.

**Response:** Same as Create Session response

### Delete Session

**DELETE /sessions/{session_id}**

Delete a session and clean up resources.

**Response:**
```json
{
  "status": "deleted"
}
```

### Control Playback

**POST /sessions/{session_id}/playback**

Control playback state (play/pause/speed).

**Request:**
```json
{
  "playing": true,
  "speed": "2x"
}
```

Fields are optional. Omit to keep current value.

**Response:**
```json
{
  "playing": true,
  "speed": "2x",
  "simulation_time": 45.2
}
```

### Apply Intervention

**POST /sessions/{session_id}/interventions**

Apply an intervention to the current branch.

**Request:**
```json
{
  "intervention_id": "needle-decompression-left",
  "parameters": {}
}
```

**Response:**
```json
{
  "status": "applied",
  "intervention_id": "needle-decompression-left"
}
```

### Fork Branch

**POST /sessions/{session_id}/fork**

Create a new branch from a checkpoint.

**Request:**
```json
{
  "checkpoint_id": "770e8400-e29b-41d4-a716-446655440002",
  "description": "Try alternative approach"
}
```

**Response:**
```json
{
  "branch_id": "880e8400-e29b-41d4-a716-446655440003",
  "parent_branch_id": "660e8400-e29b-41d4-a716-446655440001",
  "forked_from_checkpoint": "770e8400-e29b-41d4-a716-446655440002",
  "created_at": "2026-01-15T10:35:00Z",
  "event_count": 2
}
```

### Get Checkpoints

**GET /sessions/{session_id}/branches/{branch_id}/checkpoints**

Get all checkpoints for a branch.

**Response:**
```json
[
  {
    "checkpoint_id": "770e8400-e29b-41d4-a716-446655440002",
    "simulation_time": 30.0,
    "created_at": "2026-01-15T10:30:30Z",
    "is_automatic": true,
    "description": null
  },
  {
    "checkpoint_id": "990e8400-e29b-41d4-a716-446655440004",
    "simulation_time": 60.0,
    "created_at": "2026-01-15T10:31:00Z",
    "is_automatic": true,
    "description": null
  }
]
```

### Get Case Data

**GET /sessions/{session_id}/case**

Get the case definition for a session (for UI rendering).

**Response:**
```json
{
  "id": "adult-tension-pneumothorax",
  "title": "Adult Tension Pneumothorax",
  "patient": {
    "age": 32,
    "sex": "male",
    "summary": "Sudden onset chest pain..."
  },
  "alarms": {
    "heartRate": {
      "critical": {"low": 40, "high": 140},
      "warning": {"low": 50, "high": 120},
      "normal": {"low": 60, "high": 100}
    },
    ...
  },
  "interventions": [
    {
      "id": "needle-decompression-left",
      "label": "Needle decompression - left",
      "action": "SENeedleDecompression",
      "parameters": {"side": "Left", "state": "On"}
    }
  ],
  "references": [...]
}
```

## WebSocket

### Vitals Stream

**WS /sessions/{session_id}/vitals**

Stream vital signs in real time.

**Message format:**
```json
{
  "simulation_time": 45.2,
  "heart_rate": 92.3,
  "respiratory_rate": 16.5,
  "spo2": 0.965,
  "mean_arterial_pressure": 93.2,
  "systolic_pressure": 125.4,
  "diastolic_pressure": 78.8,
  "etco2": 38.5,
  "tidal_volume": 520.3
}
```

Messages sent at ~1 Hz.

**Error format:**
```json
{
  "error": "Simulation error: ..."
}
```

## Error Responses

All endpoints may return:

**404 Not Found:**
```json
{
  "detail": "Session not found"
}
```

**400 Bad Request:**
```json
{
  "detail": "Unknown intervention: xyz"
}
```

**500 Internal Server Error:**
```json
{
  "detail": "Failed to create session: ..."
}
```

## Interactive Documentation

FastAPI provides interactive API documentation:

- Swagger UI: http://localhost:8000/docs
- ReDoc: http://localhost:8000/redoc
