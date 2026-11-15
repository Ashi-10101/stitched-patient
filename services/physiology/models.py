"""Data models for the physiology service."""
from typing import Dict, List, Optional, Any
from enum import Enum
from pydantic import BaseModel, Field


class PlaybackSpeed(str, Enum):
    """Simulation playback speed multipliers."""
    NORMAL = "1x"
    DOUBLE = "2x"
    QUAD = "4x"


class VitalSigns(BaseModel):
    """Vital signs snapshot at a point in simulation time."""
    simulation_time: float = Field(..., description="Simulation time in seconds")
    heart_rate: float = Field(..., description="Heart rate in beats per minute")
    respiratory_rate: float = Field(..., description="Respiratory rate in breaths per minute")
    spo2: float = Field(..., description="Oxygen saturation (0-1)")
    mean_arterial_pressure: float = Field(..., description="Mean arterial pressure in mmHg")
    systolic_pressure: Optional[float] = Field(None, description="Systolic blood pressure in mmHg")
    diastolic_pressure: Optional[float] = Field(None, description="Diastolic blood pressure in mmHg")
    etco2: float = Field(..., description="End-tidal CO2 in mmHg")
    tidal_volume: float = Field(..., description="Tidal volume in mL")


class AlarmState(str, Enum):
    """Alarm state for a vital sign."""
    NORMAL = "normal"
    WARNING = "warning"
    CRITICAL = "critical"


class InterventionRequest(BaseModel):
    """Request to apply an intervention."""
    intervention_id: str = Field(..., description="Intervention identifier from case file")
    parameters: Optional[Dict[str, Any]] = Field(None, description="Optional runtime parameters")


class InterventionEvent(BaseModel):
    """Record of an applied intervention."""
    simulation_time: float
    wall_clock_time: str
    intervention_id: str
    parameters: Dict[str, Any]


class CheckpointMetadata(BaseModel):
    """Metadata for a saved checkpoint."""
    checkpoint_id: str
    simulation_time: float
    created_at: str
    is_automatic: bool
    description: Optional[str] = None


class BranchMetadata(BaseModel):
    """Metadata for a simulation branch."""
    branch_id: str
    parent_branch_id: Optional[str]
    forked_from_checkpoint: Optional[str]
    created_at: str
    event_count: int


class SessionRequest(BaseModel):
    """Request to create a new session."""
    case_id: str


class SessionMetadata(BaseModel):
    """Metadata for an active session."""
    session_id: str
    case_id: str
    created_at: str
    current_branch_id: str
    branches: List[BranchMetadata]


class PlaybackControlRequest(BaseModel):
    """Request to change playback state."""
    playing: Optional[bool] = None
    speed: Optional[PlaybackSpeed] = None


class PlaybackState(BaseModel):
    """Current playback state."""
    playing: bool
    speed: PlaybackSpeed
    simulation_time: float


class ForkRequest(BaseModel):
    """Request to create a new branch from a checkpoint."""
    checkpoint_id: str
    description: Optional[str] = None
