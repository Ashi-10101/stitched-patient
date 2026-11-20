"""FastAPI application for physiology service."""
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Dict, List

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
import logging

from models import (
    SessionRequest, SessionMetadata, InterventionRequest,
    PlaybackControlRequest, PlaybackState, ForkRequest,
    BranchMetadata, CheckpointMetadata, VitalSigns
)
from session_manager import SessionManager
from case_loader import load_case, list_cases, CaseLoadError
from config import settings


# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


# Global session manager
session_manager = SessionManager()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage application lifecycle."""
    logger.info("Starting physiology service")
    await session_manager.start()
    yield
    logger.info("Shutting down physiology service")
    await session_manager.stop()


app = FastAPI(
    title=settings.api_title,
    description="Real-time physiology simulation using Pulse engine",
    version=settings.api_version,
    lifespan=lifespan,
)

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
async def root():
    """Health check endpoint."""
    return {
        "service": "stitched-patient-physiology",
        "status": "running",
        "version": "0.1.0"
    }


@app.get("/cases")
async def get_cases() -> List[str]:
    """List available case IDs."""
    return list_cases()


@app.post("/sessions", response_model=SessionMetadata)
async def create_session(request: SessionRequest) -> SessionMetadata:
    """
    Create a new simulation session from a case.
    
    Args:
        request: Session creation request with case_id
        
    Returns:
        Session metadata including session_id and initial branch
    """
    try:
        case_data = load_case(request.case_id)
    except CaseLoadError as e:
        logger.error(f"Failed to load case {request.case_id}: {e}")
        raise HTTPException(status_code=404, detail=str(e))
    
    try:
        session = session_manager.create_session(request.case_id, case_data)
        logger.info(f"Created session {session.session_id} for case {request.case_id}")
    except Exception as e:
        logger.error(f"Failed to create session: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to create session: {str(e)}")
    
    return SessionMetadata(
        session_id=session.session_id,
        case_id=session.case_id,
        created_at=session.created_at.isoformat(),
        current_branch_id=session.current_branch_id,
        branches=[
            BranchMetadata(
                branch_id=branch.branch_id,
                parent_branch_id=branch.parent_branch_id,
                forked_from_checkpoint=branch.forked_from_checkpoint,
                created_at=branch.created_at.isoformat(),
                event_count=len(branch.events),
            )
            for branch in session.branches.values()
        ],
    )


@app.get("/sessions/{session_id}", response_model=SessionMetadata)
async def get_session(session_id: str) -> SessionMetadata:
    """Get session metadata."""
    session = session_manager.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    
    return SessionMetadata(
        session_id=session.session_id,
        case_id=session.case_id,
        created_at=session.created_at.isoformat(),
        current_branch_id=session.current_branch_id,
        branches=[
            BranchMetadata(
                branch_id=branch.branch_id,
                parent_branch_id=branch.parent_branch_id,
                forked_from_checkpoint=branch.forked_from_checkpoint,
                created_at=branch.created_at.isoformat(),
                event_count=len(branch.events),
            )
            for branch in session.branches.values()
        ],
    )


@app.delete("/sessions/{session_id}")
async def delete_session(session_id: str):
    """Delete a session and clean up resources."""
    session = session_manager.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    
    session_manager.delete_session(session_id)
    return {"status": "deleted"}


@app.post("/sessions/{session_id}/playback", response_model=PlaybackState)
async def control_playback(
    session_id: str,
    request: PlaybackControlRequest,
) -> PlaybackState:
    """Control playback state (play/pause/speed)."""
    session = session_manager.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    
    if request.playing is not None:
        session.playing = request.playing
    
    if request.speed is not None:
        session.speed = request.speed
    
    return PlaybackState(
        playing=session.playing,
        speed=session.speed,
        simulation_time=session.current_branch.engine.current_time,
    )


@app.post("/sessions/{session_id}/interventions")
async def apply_intervention(
    session_id: str,
    request: InterventionRequest,
):
    """Apply an intervention to the current branch."""
    session = session_manager.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    
    try:
        await session_manager.apply_intervention(
            session,
            request.intervention_id,
            request.parameters,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to apply intervention: {str(e)}")
    
    return {"status": "applied", "intervention_id": request.intervention_id}


@app.post("/sessions/{session_id}/fork")
async def fork_branch(
    session_id: str,
    request: ForkRequest,
) -> BranchMetadata:
    """Create a new branch from a checkpoint."""
    session = session_manager.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    
    try:
        new_branch_id = await session_manager.fork_branch(
            session,
            request.checkpoint_id,
            request.description,
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fork branch: {str(e)}")
    
    new_branch = session.branches[new_branch_id]
    return BranchMetadata(
        branch_id=new_branch.branch_id,
        parent_branch_id=new_branch.parent_branch_id,
        forked_from_checkpoint=new_branch.forked_from_checkpoint,
        created_at=new_branch.created_at.isoformat(),
        event_count=len(new_branch.events),
    )


@app.get("/sessions/{session_id}/branches/{branch_id}/checkpoints")
async def get_checkpoints(session_id: str, branch_id: str) -> List[CheckpointMetadata]:
    """Get all checkpoints for a branch."""
    session = session_manager.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    
    branch = session.branches.get(branch_id)
    if not branch:
        raise HTTPException(status_code=404, detail="Branch not found")
    
    return [
        CheckpointMetadata(
            checkpoint_id=cp.checkpoint_id,
            simulation_time=cp.simulation_time,
            created_at=cp.created_at.isoformat(),
            is_automatic=cp.is_automatic,
            description=cp.description,
        )
        for cp in branch.checkpoints
    ]


@app.websocket("/sessions/{session_id}/vitals")
async def vitals_stream(websocket: WebSocket, session_id: str):
    """
    Subscribe to a session's vitals stream.
    
    Subscribe-only: this handler never sends, advances time, or calls the
    engine. The session's clock task pushes vitals (and error messages) to
    every subscriber. The handler only waits for the client to leave; when
    the last subscriber leaves, the session is paused.
    """
    await websocket.accept()
    
    session = session_manager.get_session(session_id)
    if not session:
        await websocket.close(code=1008, reason="Session not found")
        return
    
    session.vitals_subscribers.add(websocket)
    session.last_activity = datetime.utcnow()
    
    try:
        while True:
            # Awaiting receive is what notices a disconnect.
            msg = await websocket.receive()
            if msg["type"] == "websocket.disconnect":
                logger.info(f"WebSocket disconnected for session {session_id}")
                break
            # Ignore anything else the client sends.
    except WebSocketDisconnect:
        logger.info(f"WebSocket disconnected for session {session_id}")
    except Exception as e:
        logger.error(f"WebSocket error for session {session_id}: {e}", exc_info=True)
    finally:
        was_subscribed = websocket in session.vitals_subscribers
        session.vitals_subscribers.discard(websocket)
        session.last_activity = datetime.utcnow()
        # Pause only when this discard removed the last subscriber. If a failed
        # send already dropped it, the broadcaster has handled that.
        if was_subscribed and not session.vitals_subscribers:
            session.playing = False


@app.get("/sessions/{session_id}/case")
async def get_case_data(session_id: str) -> Dict:
    """Get the case data for a session (for UI to render interventions, alarms, etc.)."""
    session = session_manager.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    
    return session.case_data


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
