"""Configuration for physiology service."""
from pydantic import Field
from pydantic_settings import BaseSettings
from typing import Optional


class Settings(BaseSettings):
    """Application settings."""
    
    # Pulse engine
    pulse_data_root: str = "/pulse/bin"
    starting_state: str = "/pulse/bin/states/StandardMale@0s.json"
    
    # Session management
    checkpoint_interval_seconds: float = 30.0
    # Env: MAX_CHECKPOINTS_PER_BRANCH (10-1000)
    max_checkpoints_per_branch: int = Field(default=100, ge=10, le=1000)
    # Env: SESSION_IDLE_TIMEOUT (seconds, > 0)
    session_idle_timeout: int = Field(default=3600, gt=0)  # 1 hour
    # Env: SESSION_CREATION_TIMEOUT (seconds, > 0)
    session_creation_timeout: int = Field(default=30, gt=0)
    
    # Vitals streaming
    vitals_update_hz: float = 1.0  # Updates per second
    vitals_history_max_points: int = 300  # 5 minutes at 1 Hz
    
    # CORS
    cors_origins: list[str] = ["http://localhost:3000", "http://localhost:3001"]
    
    # API
    api_title: str = "Stitched Patient Physiology Service"
    api_version: str = "0.1.0"
    
    class Config:
        env_file = ".env"
        case_sensitive = False


settings = Settings()
