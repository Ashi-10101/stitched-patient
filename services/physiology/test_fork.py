"""Integration tests for branch forking (SessionManager.fork_branch and POST /fork).

Most tests use the fake engine from test_insult_algorithm.py, extended here so
that save_checkpoint writes the engine's simulated time into the file and a
patched PulseEngineWrapper.load_from_checkpoint rebuilds a fake engine from it.
One test forks a real Pulse session, and two go through the HTTP endpoint.

Validates: Requirements 7.5, 7.6, 7.7, 7.8, 7.9, 7.13
- 7.5: forking from an existing checkpoint creates a new branch from its state.
- 7.6: the new branch's engine is loaded from the checkpoint, and its vitals
  match the parent's recorded vitals at that time.
- 7.7: the new branch has a unique id and references the parent branch and the
  forked checkpoint.
- 7.8: the new branch inherits exactly the events the checkpoint records.
- 7.9: the original branch is unchanged by the fork.
- 7.13: an unknown checkpoint_id gives 404 naming the id.
Also covers Requirements 5.7 and 5.8 (insults across a fork).
"""
import asyncio
import json
import shutil
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import pytest
from fastapi.testclient import TestClient

import case_loader
import main
import session_manager
from session_manager import Branch, Checkpoint, Session, SessionManager
from test_insult_algorithm import FakeEngine, insult, make_session

CASE_ID = "adult-tension-pneumothorax"


# ---------------------------------------------------------------------------
# Fake-engine helpers
# ---------------------------------------------------------------------------

class ForkFakeEngine(FakeEngine):
    """FakeEngine whose checkpoint file records the engine's simulated time."""

    def save_checkpoint(self, path: Path) -> None:
        Path(path).write_text(json.dumps({"t": self.current_time}))


class FakeLoader:
    """Replacement for PulseEngineWrapper.load_from_checkpoint; records every load."""

    def __init__(self) -> None:
        self.engines: List[ForkFakeEngine] = []
        self.paths: List[Path] = []

    def __call__(self, path: Path) -> ForkFakeEngine:
        data = json.loads(Path(path).read_text())
        engine = ForkFakeEngine()
        engine.current_time = data["t"]
        self.engines.append(engine)
        self.paths.append(Path(path))
        return engine


@pytest.fixture
def loader(monkeypatch: pytest.MonkeyPatch) -> FakeLoader:
    fake = FakeLoader()
    monkeypatch.setattr(
        session_manager.PulseEngineWrapper, "load_from_checkpoint", fake
    )
    return fake


def fork_session(
    tmp_path: Path, insults: Optional[List[Dict[str, Any]]] = None
) -> Tuple[Session, Branch]:
    """A fake-engine session whose single branch uses ForkFakeEngine. Call inside the loop."""
    session, _ = make_session(tmp_path, insults or [])
    branch = session.current_branch
    branch.engine = ForkFakeEngine()
    session.case_data = {
        "interventions": [{"id": "x", "label": "X", "action": "A", "parameters": {}}]
    }
    return session, branch


def auto_checkpoint_at(branch: Branch, tick: float) -> Checkpoint:
    found = [
        cp for cp in branch.checkpoints
        if cp.is_automatic is True and cp.tick_counter == tick
    ]
    assert len(found) == 1, (
        f"expected one automatic t={tick} checkpoint, got "
        f"{[(cp.tick_counter, cp.is_automatic) for cp in branch.checkpoints]}"
    )
    return found[0]


def applies(engine: FakeEngine) -> List[Tuple[Any, ...]]:
    return [c for c in engine.calls if c[0] == "apply"]


# ---------------------------------------------------------------------------
# Fake-engine tests
# ---------------------------------------------------------------------------

async def test_fork_creates_branch_with_separate_engine(tmp_path, loader):
    """Req 7.5, 7.7: new branch, own engine from the loader, parent and checkpoint referenced."""
    manager = SessionManager()
    session, parent = fork_session(tmp_path)
    await manager.step(session, 30)
    cp = auto_checkpoint_at(parent, 30.0)

    new_id = await manager.fork_branch(session, cp.checkpoint_id)

    assert new_id != parent.branch_id
    assert set(session.branches) == {parent.branch_id, new_id}
    new = session.branches[new_id]
    assert new.branch_id == new_id
    assert new.engine is not parent.engine
    assert len(loader.engines) == 1
    assert new.engine is loader.engines[0]
    assert new.parent_branch_id == parent.branch_id
    assert new.forked_from_checkpoint == cp.checkpoint_id


async def test_new_branch_starts_at_checkpoint_tick(tmp_path, loader):
    """Req 7.5: the new branch's clock and cached vitals start at the checkpoint tick."""
    manager = SessionManager()
    session, parent = fork_session(tmp_path)
    await manager.step(session, 45)
    cp = auto_checkpoint_at(parent, 30.0)

    new_id = await manager.fork_branch(session, cp.checkpoint_id)
    new = session.branches[new_id]

    assert new.tick_counter == cp.tick_counter == 30.0
    assert new.engine.current_time == 30.0
    assert new.last_vitals is not None
    assert new.last_vitals.simulation_time == 30.0

    vitals = await manager.step(session, 1)
    assert vitals.simulation_time == 31.0
    assert new.tick_counter == 31.0
    assert new.engine.calls == [("advance", 1.0)]
    assert parent.tick_counter == 45.0


async def test_events_copied_up_to_checkpoint_event_count(tmp_path, loader):
    """Req 7.8: only the events recorded by the checkpoint are inherited, in a separate list."""
    manager = SessionManager()
    session, parent = fork_session(tmp_path)

    await manager.apply_intervention(session, "x")  # event 1 at t=0
    await manager.step(session, 30)                 # auto checkpoint at t=30
    await manager.step(session, 5)
    await manager.apply_intervention(session, "x")  # event 2 at t=35
    assert [e.simulation_time for e in parent.events] == [0.0, 35.0]
    cp = auto_checkpoint_at(parent, 30.0)
    assert cp.event_count == 1

    new_id = await manager.fork_branch(session, cp.checkpoint_id)
    new = session.branches[new_id]

    assert new.events == parent.events[:cp.event_count]
    assert len(new.events) == 1
    assert new.events[0].simulation_time == 0.0
    assert new.events is not parent.events

    parent_events_before = list(parent.events)
    await manager.apply_intervention(session, "x")  # lands on the new branch
    assert len(new.events) == 2
    assert parent.events == parent_events_before


async def test_original_branch_unchanged_by_fork(tmp_path, loader):
    """Req 7.9: the parent's clock, events, insults, checkpoints, engine and flags stay as they were."""
    manager = SessionManager()
    session, parent = fork_session(
        tmp_path, [insult(10.0, "SETensionPneumothorax", {"severity": 0.75})]
    )
    await manager.apply_intervention(session, "x")
    await manager.step(session, 40)
    cp = auto_checkpoint_at(parent, 30.0)

    before = {
        "tick_counter": parent.tick_counter,
        "events": list(parent.events),
        "applied_insults": set(parent.applied_insults),
        "checkpoints": [(c.checkpoint_id, c.path) for c in parent.checkpoints],
        "engine": parent.engine,
        "engine_calls": list(parent.engine.calls),
        "failed": parent.failed,
        "failure_reason": parent.failure_reason,
        "last_vitals": parent.last_vitals,
        "vitals_history": list(parent.vitals_history),
        "last_checkpoint_time": parent.last_checkpoint_time,
    }

    await manager.fork_branch(session, cp.checkpoint_id)

    after = {
        "tick_counter": parent.tick_counter,
        "events": list(parent.events),
        "applied_insults": set(parent.applied_insults),
        "checkpoints": [(c.checkpoint_id, c.path) for c in parent.checkpoints],
        "engine": parent.engine,
        "engine_calls": list(parent.engine.calls),
        "failed": parent.failed,
        "failure_reason": parent.failure_reason,
        "last_vitals": parent.last_vitals,
        "vitals_history": list(parent.vitals_history),
        "last_checkpoint_time": parent.last_checkpoint_time,
    }
    assert after == before
    assert parent.engine is before["engine"]
    for c in parent.checkpoints:
        assert c.path.exists(), f"parent checkpoint file t={c.tick_counter} is gone"
    assert session.branches[parent.branch_id] is parent


async def _fork_before_insult(
    tmp_path: Path, manager: SessionManager
) -> Tuple[Session, Branch, Branch, Checkpoint]:
    """Insult at 35.5; parent steps to 40 (insult applied); fork from the t=30 checkpoint."""
    session, parent = fork_session(
        tmp_path, [insult(35.5, "SETensionPneumothorax", {"severity": 0.75})]
    )
    await manager.step(session, 40)
    assert parent.applied_insults == {0}
    cp = auto_checkpoint_at(parent, 30.0)
    assert cp.applied_insults == frozenset()

    new_id = await manager.fork_branch(session, cp.checkpoint_id)
    return session, parent, session.branches[new_id], cp


async def test_applied_insults_copied_from_checkpoint(tmp_path, loader):
    """Req 5.8, 7.5: applied_insults come from the checkpoint, not the parent's current set."""
    manager = SessionManager()
    session, parent, new, cp = await _fork_before_insult(tmp_path, manager)

    assert new.applied_insults == set(cp.applied_insults) == set()
    assert parent.applied_insults == {0}
    assert new.applied_insults is not parent.applied_insults
    assert isinstance(new.applied_insults, set)


async def test_fork_before_insult_applies_it_when_time_reached(tmp_path, loader):
    """Req 5.8: a fork taken before an insult applies it once, at its scheduled time."""
    manager = SessionManager()
    session, parent, new, cp = await _fork_before_insult(tmp_path, manager)

    await manager.step(session, 10)  # 30 -> 40 on the new branch

    assert new.tick_counter == 40.0
    assert applies(new.engine) == [
        ("apply", "SETensionPneumothorax", {"severity": 0.75}, 35.5)
    ]
    assert new.applied_insults == {0}
    assert len(applies(parent.engine)) == 1


async def test_fork_after_insult_does_not_reapply_it(tmp_path, loader):
    """Req 5.7: a fork taken after an insult never applies it again."""
    manager = SessionManager()
    session, parent = fork_session(
        tmp_path, [insult(2.5, "SETensionPneumothorax", {"severity": 0.75})]
    )
    await manager.step(session, 30)
    cp = auto_checkpoint_at(parent, 30.0)
    assert cp.applied_insults == frozenset({0})

    new_id = await manager.fork_branch(session, cp.checkpoint_id)
    new = session.branches[new_id]
    await manager.step(session, 15)

    assert new.tick_counter == 45.0
    assert applies(new.engine) == []
    assert new.applied_insults == {0}
    assert len(applies(parent.engine)) == 1


async def test_fork_checkpoint_is_own_copy_and_branch_becomes_current(tmp_path, loader):
    """Req 7.5, 7.10: the new branch owns a copied checkpoint file and becomes current."""
    manager = SessionManager()
    session, parent = fork_session(
        tmp_path, [insult(2.5, "SETensionPneumothorax", {"severity": 0.75})]
    )
    await manager.apply_intervention(session, "x")
    await manager.step(session, 30)
    cp = auto_checkpoint_at(parent, 30.0)

    new_id = await manager.fork_branch(session, cp.checkpoint_id)
    new = session.branches[new_id]

    assert session.current_branch_id == new_id
    assert session.current_branch is new

    assert len(new.checkpoints) == 1
    first = new.checkpoints[0]
    assert first.path != cp.path, "new branch reuses the source checkpoint file"
    assert first.path.parent == session.temp_dir
    assert first.path.exists()
    assert cp.path.exists(), "source checkpoint file was removed"
    assert loader.paths == [first.path], "engine was not loaded from the copy"
    assert first.checkpoint_id != cp.checkpoint_id
    assert first.is_automatic is False
    assert first.tick_counter == cp.tick_counter == 30.0
    assert first.simulation_time == cp.simulation_time
    assert first.applied_insults == cp.applied_insults == frozenset({0})
    assert first.event_count == cp.event_count == 1


async def test_fork_from_failed_branch_yields_healthy_branch(tmp_path, loader):
    """Req 7.5: the source branch's failed flag is not inherited."""
    manager = SessionManager()
    session, parent = fork_session(tmp_path)
    await manager.step(session, 30)
    cp = auto_checkpoint_at(parent, 30.0)
    parent.failed = True
    parent.failure_reason = "earlier engine error"

    new_id = await manager.fork_branch(session, cp.checkpoint_id)
    new = session.branches[new_id]

    assert new.failed is False
    assert new.failure_reason is None
    vitals = await manager.step(session, 5)
    assert vitals.simulation_time == 35.0
    assert new.failed is False
    assert parent.failed is True
    assert parent.failure_reason == "earlier engine error"


async def test_engine_error_marks_only_the_advanced_branch(tmp_path, loader, monkeypatch):
    """An engine error in _advance_tick marks the current branch failed, not the other one."""
    manager = SessionManager()
    session, parent = fork_session(tmp_path)
    await manager.step(session, 30)
    cp = auto_checkpoint_at(parent, 30.0)
    new_id = await manager.fork_branch(session, cp.checkpoint_id)
    new = session.branches[new_id]

    def exploding_advance(dt: float) -> None:
        raise RuntimeError("engine exploded")

    monkeypatch.setattr(new.engine, "advance_time", exploding_advance)

    with pytest.raises(RuntimeError, match="engine exploded"):
        await manager.step(session, 1)

    assert new.failed is True
    assert new.failure_reason is not None
    assert "engine exploded" in new.failure_reason
    assert parent.failed is False
    assert parent.failure_reason is None


async def test_fork_unknown_checkpoint_raises_value_error(tmp_path, loader):
    """Req 7.13: an unknown checkpoint id raises ValueError naming it; nothing changes."""
    manager = SessionManager()
    session, parent = fork_session(tmp_path)
    await manager.step(session, 30)
    branches_before = dict(session.branches)
    files_before = sorted(p.name for p in tmp_path.iterdir())

    with pytest.raises(ValueError, match="nope"):
        await manager.fork_branch(session, "nope")

    assert session.branches == branches_before
    assert session.current_branch_id == parent.branch_id
    assert loader.engines == []
    assert sorted(p.name for p in tmp_path.iterdir()) == files_before


# ---------------------------------------------------------------------------
# Real Pulse (Req 7.6)
# ---------------------------------------------------------------------------

async def test_real_fork_vitals_match_parent_at_checkpoint():
    """Req 7.6: a fork from the t=30 checkpoint reproduces the parent's t=30 vitals."""
    case_data = case_loader.load_case(CASE_ID)
    manager = SessionManager()
    session = manager.create_session(CASE_ID, case_data)
    original = session.current_branch
    init_path = original.checkpoints[0].path
    try:
        await manager.step(session, 30)
        cp = auto_checkpoint_at(original, 30.0)
        recorded = [v for v in original.vitals_history if v.simulation_time == 30.0]
        assert len(recorded) == 1, "no parent vitals recorded at t=30"
        parent_v = recorded[0]

        new_id = await manager.fork_branch(session, cp.checkpoint_id)
        new = session.branches[new_id]
        fork_v = new.last_vitals

        print()
        print(f"parent t=30: HR={parent_v.heart_rate} SpO2={parent_v.spo2}")
        print(f"fork   t={fork_v.simulation_time}: HR={fork_v.heart_rate} SpO2={fork_v.spo2}")

        assert new.engine is not original.engine
        assert fork_v.simulation_time == 30.0
        assert abs(fork_v.heart_rate - parent_v.heart_rate) <= 1.0
        assert abs(fork_v.spo2 - parent_v.spo2) <= 0.005
    finally:
        session.clock_task.cancel()
        try:
            await session.clock_task
        except asyncio.CancelledError:
            pass
        shutil.rmtree(session.temp_dir, ignore_errors=True)
        init_path.unlink(missing_ok=True)


# ---------------------------------------------------------------------------
# HTTP endpoint (Req 7.7, 7.13)
# ---------------------------------------------------------------------------

def _create_http_session(client: TestClient) -> Tuple[str, Session, Path]:
    resp = client.post("/sessions", json={"case_id": CASE_ID})
    assert resp.status_code == 200, resp.text
    sid = resp.json()["session_id"]
    session = main.session_manager.sessions[sid]
    init_path = session.current_branch.checkpoints[0].path
    return sid, session, init_path


def _cleanup_http_session(
    client: TestClient, sid: str, session: Session, init_path: Path
) -> None:
    client.delete(f"/sessions/{sid}")  # 404 if already gone is fine
    shutil.rmtree(session.temp_dir, ignore_errors=True)
    init_path.unlink(missing_ok=True)


def test_http_fork_unknown_checkpoint_returns_404():
    """Req 7.13: POST /fork with an unknown checkpoint_id returns 404 naming it."""
    with TestClient(main.app) as client:
        sid, session, init_path = _create_http_session(client)
        try:
            branch_ids_before = set(session.branches)
            current_before = session.current_branch_id

            resp = client.post(f"/sessions/{sid}/fork", json={"checkpoint_id": "no-such-cp"})

            assert resp.status_code == 404, resp.text
            assert "no-such-cp" in resp.json()["detail"]
            assert set(session.branches) == branch_ids_before
            assert session.current_branch_id == current_before
        finally:
            _cleanup_http_session(client, sid, session, init_path)


def test_http_fork_valid_checkpoint_returns_new_branch():
    """Req 7.5, 7.7, 7.10: POST /fork with the t=0 checkpoint returns the new branch's metadata."""
    with TestClient(main.app) as client:
        sid, session, init_path = _create_http_session(client)
        try:
            original_id = session.current_branch_id
            resp = client.get(f"/sessions/{sid}/branches/{original_id}/checkpoints")
            assert resp.status_code == 200, resp.text
            t0 = [c for c in resp.json() if c["simulation_time"] == 0.0]
            assert len(t0) == 1, resp.json()
            cp_id = t0[0]["checkpoint_id"]

            resp = client.post(f"/sessions/{sid}/fork", json={"checkpoint_id": cp_id})

            assert resp.status_code == 200, resp.text
            body = resp.json()
            new_id = body["branch_id"]
            assert new_id != original_id
            assert new_id in session.branches
            assert session.current_branch_id == new_id
            assert body["parent_branch_id"] == original_id
            assert body["forked_from_checkpoint"] == cp_id
            uuid.UUID(new_id)  # a valid UUID
        finally:
            _cleanup_http_session(client, sid, session, init_path)
