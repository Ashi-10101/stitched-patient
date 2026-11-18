"""Session and branch management."""
import asyncio
import tempfile
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Dict, FrozenSet, List, Optional, Any, Set
from collections import deque

from fastapi import WebSocket

from pulse_wrapper import PulseEngineWrapper
from models import (
    VitalSigns, InterventionEvent, CheckpointMetadata, 
    BranchMetadata, PlaybackSpeed
)


@dataclass
class Checkpoint:
    """A saved checkpoint in a branch."""
    checkpoint_id: str
    simulation_time: float
    path: Path
    created_at: datetime
    is_automatic: bool
    applied_insults: FrozenSet[int]  # Immutable copy of branch.applied_insults at checkpoint time
    event_count: int  # len(branch.events) at checkpoint time
    tick_counter: float  # Branch simulated clock (seconds) at checkpoint time
    description: Optional[str] = None


@dataclass
class Branch:
    """A simulation timeline branch."""
    branch_id: str
    parent_branch_id: Optional[str]
    forked_from_checkpoint: Optional[str]
    engine: PulseEngineWrapper
    events: List[InterventionEvent] = field(default_factory=list)
    applied_insults: Set[int] = field(default_factory=set)  # Indices into session.scheduled_insults
    checkpoints: deque = field(default_factory=lambda: deque(maxlen=100))  # Cap at 100 per branch
    vitals_history: deque = field(default_factory=lambda: deque(maxlen=300))  # 5 min at 1 Hz
    created_at: datetime = field(default_factory=datetime.utcnow)
    last_checkpoint_time: float = 0.0
    tick_counter: float = 0.0  # Simulated time clock (seconds)
    last_vitals: Optional[VitalSigns] = None  # Cached for paused path
    failed: bool = False
    failure_reason: Optional[str] = None
    
    def add_checkpoint(self, checkpoint: Checkpoint) -> None:
        """Add a checkpoint, removing oldest automatic ones if at capacity."""
        # If at capacity, remove oldest automatic checkpoint
        if len(self.checkpoints) == self.checkpoints.maxlen:
            for i, cp in enumerate(self.checkpoints):
                if cp.is_automatic:
                    del self.checkpoints[i]
                    break
        
        self.checkpoints.append(checkpoint)


@dataclass
class Session:
    """An active simulation session."""
    session_id: str
    case_id: str
    case_data: Dict[str, Any]
    branches: Dict[str, Branch]
    current_branch_id: str
    created_at: datetime
    playing: bool = False
    speed: PlaybackSpeed = PlaybackSpeed.NORMAL
    temp_dir: Path = field(default_factory=lambda: Path(tempfile.mkdtemp()))
    scheduled_insults: List[Dict[str, Any]] = field(default_factory=list)
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)  # Protects all engine operations
    clock_task: Optional[asyncio.Task] = None  # Background clock task
    vitals_subscribers: Set[WebSocket] = field(default_factory=set)  # Active WebSocket connections
    last_activity: datetime = field(default_factory=datetime.utcnow)  # For idle timeout tracking
    
    @property
    def current_branch(self) -> Branch:
        """Get the currently active branch."""
        return self.branches[self.current_branch_id]


class SessionManager:
    """Manages active simulation sessions."""
    
    CHECKPOINT_INTERVAL = 30.0  # seconds
    IDLE_TIMEOUT = 3600  # 1 hour
    
    def __init__(self):
        self.sessions: Dict[str, Session] = {}
        self._cleanup_task: Optional[asyncio.Task] = None
    
    async def start(self):
        """Start background cleanup task."""
        self._cleanup_task = asyncio.create_task(self._cleanup_loop())
    
    async def stop(self):
        """Stop background tasks and clean up."""
        if self._cleanup_task:
            self._cleanup_task.cancel()
            try:
                await self._cleanup_task
            except asyncio.CancelledError:
                pass
    
    async def _cleanup_loop(self):
        """Periodically clean up idle sessions."""
        while True:
            await asyncio.sleep(300)  # Check every 5 minutes
            # TODO: Implement idle session cleanup based on last activity time
    
    def create_session(self, case_id: str, case_data: Dict[str, Any]) -> Session:
        """
        Create a new session from a case definition.
        
        Args:
            case_id: Case identifier
            case_data: Loaded and validated case data
            
        Returns:
            New Session instance
        """
        session_id = str(uuid.uuid4())
        
        # Create initial engine
        engine = PulseEngineWrapper(case_data["engine"]["startingState"])
        
        # Create initial branch
        branch_id = str(uuid.uuid4())
        branch = Branch(
            branch_id=branch_id,
            parent_branch_id=None,
            forked_from_checkpoint=None,
            engine=engine,
        )
        
        # Create initial checkpoint
        checkpoint_path = Path(tempfile.gettempdir()) / f"{session_id}_{branch_id}_init.json"
        engine.save_checkpoint(checkpoint_path)
        
        initial_checkpoint = Checkpoint(
            checkpoint_id=str(uuid.uuid4()),
            simulation_time=0.0,
            path=checkpoint_path,
            created_at=datetime.utcnow(),
            is_automatic=True,
            applied_insults=frozenset(),
            event_count=0,
            tick_counter=0.0,
            description="Initial state",
        )
        branch.add_checkpoint(initial_checkpoint)
        
        # Extract scheduled insults from timeline
        scheduled_insults = case_data.get("timeline", {}).get("scheduledInsults", [])
        
        session = Session(
            session_id=session_id,
            case_id=case_id,
            case_data=case_data,
            branches={branch_id: branch},
            current_branch_id=branch_id,
            created_at=datetime.utcnow(),
            scheduled_insults=scheduled_insults,
        )
        
        self.sessions[session_id] = session
        return session
    
    def get_session(self, session_id: str) -> Optional[Session]:
        """Get a session by ID."""
        return self.sessions.get(session_id)
    
    def delete_session(self, session_id: str) -> None:
        """Delete a session and clean up resources."""
        if session_id in self.sessions:
            # TODO: Clean up temp files
            del self.sessions[session_id]
    
    async def _advance_tick(self, session: Session) -> VitalSigns:
        """
        Advance the current branch by exactly 1.0 simulated second.
        
        branch.tick_counter is the only clock: every offset is measured from
        it, never from engine.current_time. Unapplied scheduled insults with
        timeSeconds <= target are applied in (timeSeconds, case file order),
        each at its exact time (or at the current position if already past).
        The advance_time durations within one tick sum to exactly 1.0.
        
        Args:
            session: Active session (operates on session.current_branch)
            
        Returns:
            Vital signs at the end of the tick, with simulation_time = target
        """
        async with session.lock:
            branch = session.current_branch
            engine = branch.engine
            
            target = branch.tick_counter + 1.0
            
            # 1. Collect unapplied insults due at or before the target time
            pending = [
                (idx, insult)
                for idx, insult in enumerate(session.scheduled_insults)
                if insult["timeSeconds"] <= target
                and idx not in branch.applied_insults
            ]
            
            # 2. Sort by (timeSeconds, case file order)
            pending.sort(key=lambda item: (item[1]["timeSeconds"], item[0]))
            
            # 3. Apply each insult at its exact time
            last_advance = branch.tick_counter
            for idx, insult in pending:
                insult_time = insult["timeSeconds"]
                if insult_time > last_advance:
                    await asyncio.to_thread(engine.advance_time, insult_time - last_advance)
                    last_advance = insult_time
                
                await asyncio.to_thread(
                    engine.apply_action, insult["action"], insult["parameters"]
                )
                branch.applied_insults.add(idx)
            
            # 4. Advance the remaining time to the target
            if target > last_advance:
                await asyncio.to_thread(engine.advance_time, target - last_advance)
            
            # 5. Query vitals once, stamped with the branch clock
            vitals = await asyncio.to_thread(engine.get_vitals)
            vitals = vitals.model_copy(update={"simulation_time": target})
            branch.vitals_history.append(vitals)
            branch.last_vitals = vitals
            branch.tick_counter = target
            
            # 6. Automatic checkpoint (synchronous until task 6.2)
            if target - branch.last_checkpoint_time >= self.CHECKPOINT_INTERVAL:
                self._save_checkpoint(session, branch, is_automatic=True)
            
            return vitals
    
    async def step(self, session: Session, num_ticks: int) -> VitalSigns:
        """
        Test hook: advance the current branch by num_ticks simulated seconds.
        
        Runs _advance_tick() num_ticks times back to back, with no wall-clock
        delays, so tests can bypass the real-time clock. Not exposed over HTTP.
        
        The caller must have paused the session (session.playing is False).
        This method does not take session.lock itself; each _advance_tick()
        call acquires it, and asyncio.Lock is not reentrant.
        
        Args:
            session: Active, paused session (operates on session.current_branch)
            num_ticks: Number of 1.0 s ticks to run (must be >= 1)
            
        Returns:
            Vital signs from the last tick
            
        Raises:
            RuntimeError: If the session is playing
            ValueError: If num_ticks < 1
        """
        if session.playing:
            raise RuntimeError(
                "step() requires a paused session; session.playing is True"
            )
        if num_ticks < 1:
            raise ValueError(f"num_ticks must be >= 1, got {num_ticks}")
        
        vitals: Optional[VitalSigns] = None
        for _ in range(num_ticks):
            vitals = await self._advance_tick(session)
        return vitals
    
    def apply_intervention(
        self,
        session: Session,
        intervention_id: str,
        parameters: Optional[Dict[str, Any]] = None,
    ) -> None:
        """
        Apply an intervention to the current branch.
        
        Args:
            session: Active session
            intervention_id: Intervention identifier from case file
            parameters: Optional runtime parameters (merged with case defaults)
        """
        branch = session.current_branch
        engine = branch.engine
        
        # Find intervention definition in case file
        intervention = None
        for interv in session.case_data["interventions"]:
            if interv["id"] == intervention_id:
                intervention = interv
                break
        
        if not intervention:
            raise ValueError(f"Unknown intervention: {intervention_id}")
        
        # Merge parameters
        action_params = intervention.get("parameters", {}).copy()
        if parameters:
            action_params.update(parameters)
        
        # Apply the action
        engine.apply_action(intervention["action"], action_params)
        
        # Record the event
        event = InterventionEvent(
            simulation_time=engine.current_time,
            wall_clock_time=datetime.utcnow().isoformat(),
            intervention_id=intervention_id,
            parameters=action_params,
        )
        branch.events.append(event)
        
        # Save a checkpoint after intervention
        self._save_checkpoint(session, branch, is_automatic=False, 
                            description=f"After {intervention['label']}")
    
    def fork_branch(
        self,
        session: Session,
        checkpoint_id: str,
        description: Optional[str] = None,
    ) -> str:
        """
        Create a new branch from a checkpoint.
        
        Args:
            session: Active session
            checkpoint_id: Checkpoint to fork from
            description: Optional description for the new branch
            
        Returns:
            New branch ID
        """
        # Find the checkpoint in any branch
        source_checkpoint = None
        source_branch = None
        
        for branch in session.branches.values():
            for cp in branch.checkpoints:
                if cp.checkpoint_id == checkpoint_id:
                    source_checkpoint = cp
                    source_branch = branch
                    break
            if source_checkpoint:
                break
        
        if not source_checkpoint:
            raise ValueError(f"Checkpoint not found: {checkpoint_id}")
        
        # Create new engine from checkpoint
        new_engine = PulseEngineWrapper.load_from_checkpoint(source_checkpoint.path)
        
        # Create new branch
        new_branch_id = str(uuid.uuid4())
        new_branch = Branch(
            branch_id=new_branch_id,
            parent_branch_id=source_branch.branch_id,
            forked_from_checkpoint=checkpoint_id,
            engine=new_engine,
        )
        
        # Copy checkpoint to new branch
        initial_checkpoint = Checkpoint(
            checkpoint_id=str(uuid.uuid4()),
            simulation_time=source_checkpoint.simulation_time,
            path=source_checkpoint.path,  # Reuse same checkpoint file
            created_at=datetime.utcnow(),
            is_automatic=False,
            applied_insults=source_checkpoint.applied_insults,
            event_count=source_checkpoint.event_count,
            tick_counter=source_checkpoint.tick_counter,
            description=description or f"Forked from {source_branch.branch_id[:8]}",
        )
        new_branch.add_checkpoint(initial_checkpoint)
        new_branch.last_checkpoint_time = source_checkpoint.simulation_time
        new_branch.tick_counter = source_checkpoint.simulation_time
        
        # Copy events up to the checkpoint time
        for event in source_branch.events:
            if event.simulation_time <= source_checkpoint.simulation_time:
                new_branch.events.append(event)
        
        # New branch inherits only the source branch's insults applied at or
        # before the checkpoint time. Source branch and session are untouched.
        new_branch.applied_insults = {
            idx for idx in source_branch.applied_insults
            if session.scheduled_insults[idx]["timeSeconds"] <= source_checkpoint.simulation_time
        }
        
        session.branches[new_branch_id] = new_branch
        session.current_branch_id = new_branch_id
        
        return new_branch_id
    
    def _save_checkpoint(
        self,
        session: Session,
        branch: Branch,
        is_automatic: bool,
        description: Optional[str] = None,
    ) -> None:
        """Save a checkpoint for a branch."""
        checkpoint_id = str(uuid.uuid4())
        checkpoint_path = session.temp_dir / f"{checkpoint_id}.json"
        
        branch.engine.save_checkpoint(checkpoint_path)
        
        checkpoint = Checkpoint(
            checkpoint_id=checkpoint_id,
            simulation_time=branch.tick_counter,
            path=checkpoint_path,
            created_at=datetime.utcnow(),
            is_automatic=is_automatic,
            applied_insults=frozenset(branch.applied_insults),
            event_count=len(branch.events),
            tick_counter=branch.tick_counter,
            description=description,
        )
        
        branch.add_checkpoint(checkpoint)
        branch.last_checkpoint_time = branch.tick_counter
