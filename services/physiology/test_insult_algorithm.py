"""Unit tests for the scheduled insult algorithm in SessionManager._advance_tick.

Uses a fake engine (no Pulse) that records advance_time() and apply_action()
calls, so each tick's exact call sequence can be checked.

Validates: Requirements 5.1, 5.3, 5.4, 5.5, 5.6
"""
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from models import VitalSigns
from session_manager import Branch, Session, SessionManager


class FakeEngine:
    """Records engine calls; tracks its own simulated time."""

    def __init__(self) -> None:
        self.current_time: float = 0.0
        # Each entry is ("advance", dt) or ("apply", action, params, time_at_apply)
        self.calls: List[Tuple[Any, ...]] = []

    def advance_time(self, dt: float) -> None:
        self.calls.append(("advance", dt))
        self.current_time += dt

    def apply_action(self, action: str, params: Dict[str, Any]) -> None:
        self.calls.append(("apply", action, params, self.current_time))

    def get_vitals(self) -> VitalSigns:
        # Offset by 2**-10 so the fake's time never equals the tick number.
        # Tests that see an integer simulation_time prove _advance_tick
        # stamps its own target instead of passing the engine's time through.
        return VitalSigns(
            simulation_time=self.current_time - 2**-10,
            heart_rate=72.0,
            respiratory_rate=12.0,
            spo2=0.97,
            mean_arterial_pressure=95.0,
            etco2=40.0,
            tidal_volume=500.0,
        )

    def save_checkpoint(self, path: Path) -> None:
        Path(path).write_text('{"fake": true}')


def insult(time_s: float, action: str, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    return {"timeSeconds": time_s, "action": action, "parameters": params or {}}


def make_session(tmp_path: Path, insults: List[Dict[str, Any]]) -> Tuple[Session, FakeEngine]:
    """Build a Session with one Branch around a FakeEngine. Call inside the running loop."""
    engine = FakeEngine()
    branch_id = str(uuid.uuid4())
    branch = Branch(
        branch_id=branch_id,
        parent_branch_id=None,
        forked_from_checkpoint=None,
        engine=engine,
    )
    session = Session(
        session_id=str(uuid.uuid4()),
        case_id="test-case",
        case_data={},
        branches={branch_id: branch},
        current_branch_id=branch_id,
        created_at=datetime.utcnow(),
        scheduled_insults=insults,
        temp_dir=tmp_path,
    )
    return session, engine


async def run_ticks(
    manager: SessionManager, session: Session, engine: FakeEngine, n: int
) -> List[List[Tuple[Any, ...]]]:
    """Run n ticks; return the engine calls made in each tick."""
    per_tick = []
    for _ in range(n):
        start = len(engine.calls)
        await manager._advance_tick(session)
        per_tick.append(engine.calls[start:])
    return per_tick


def applies(engine: FakeEngine) -> List[Tuple[Any, ...]]:
    return [c for c in engine.calls if c[0] == "apply"]


async def test_single_insult_applied_at_exact_time(tmp_path):
    manager = SessionManager()
    session, engine = make_session(
        tmp_path, [insult(2.5, "SETensionPneumothorax", {"severity": 0.75})]
    )

    ticks = await run_ticks(manager, session, engine, 3)

    assert ticks[0] == [("advance", 1.0)]
    assert ticks[1] == [("advance", 1.0)]
    assert ticks[2] == [
        ("advance", 0.5),
        ("apply", "SETensionPneumothorax", {"severity": 0.75}, 2.5),
        ("advance", 0.5),
    ]


async def test_insult_at_time_zero_applied_before_first_advance(tmp_path):
    manager = SessionManager()
    session, engine = make_session(tmp_path, [insult(0.0, "A")])

    ticks = await run_ticks(manager, session, engine, 2)

    assert ticks[0] == [("apply", "A", {}, 0.0), ("advance", 1.0)]
    assert ticks[1] == [("advance", 1.0)]


async def test_different_times_applied_in_time_order(tmp_path):
    manager = SessionManager()
    # Case file order is deliberately not time order; 5.75 and 5.25 share a tick.
    session, engine = make_session(
        tmp_path,
        [
            insult(7.25, "C"),
            insult(5.75, "E"),
            insult(2.5, "A"),
            insult(5.25, "D"),
            insult(4.75, "B"),
        ],
    )

    ticks = await run_ticks(manager, session, engine, 8)

    assert [(c[1], c[3]) for c in applies(engine)] == [
        ("A", 2.5),
        ("B", 4.75),
        ("D", 5.25),
        ("E", 5.75),
        ("C", 7.25),
    ]
    # Tick 5 -> 6 holds two insults at different times
    assert ticks[5] == [
        ("advance", 0.25),
        ("apply", "D", {}, 5.25),
        ("advance", 0.5),
        ("apply", "E", {}, 5.75),
        ("advance", 0.25),
    ]


async def test_same_time_applied_in_case_file_order(tmp_path):
    manager = SessionManager()
    # Names are not alphabetical, so a sort by action name would fail this test.
    session, engine = make_session(
        tmp_path,
        [
            insult(3.5, "zeta", {"order": 1}),
            insult(3.5, "alpha", {"order": 2}),
            insult(3.5, "mike", {"order": 3}),
        ],
    )

    ticks = await run_ticks(manager, session, engine, 4)

    assert ticks[3] == [
        ("advance", 0.5),
        ("apply", "zeta", {"order": 1}, 3.5),
        ("apply", "alpha", {"order": 2}, 3.5),
        ("apply", "mike", {"order": 3}, 3.5),
        ("advance", 0.5),
    ]


async def test_insult_applied_only_once(tmp_path):
    manager = SessionManager()
    # 3.0 sits exactly on a tick boundary (target of tick 2 -> 3).
    session, engine = make_session(tmp_path, [insult(2.5, "A"), insult(3.0, "B")])

    await manager.step(session, 20)

    assert [c[1] for c in applies(engine)] == ["A", "B"]
    assert [c[3] for c in applies(engine)] == [2.5, 3.0]
    assert session.current_branch.applied_insults == {0, 1}


async def test_insult_on_tick_boundary_applied_in_ending_tick(tmp_path):
    manager = SessionManager()
    # 3.0 is the target of tick 2 -> 3, so it belongs to that tick (<= target),
    # not to the start of tick 3 -> 4.
    session, engine = make_session(tmp_path, [insult(3.0, "B")])

    ticks = await run_ticks(manager, session, engine, 3)

    assert ticks[0] == [("advance", 1.0)]
    assert ticks[1] == [("advance", 1.0)]
    assert ticks[2] == [("advance", 1.0), ("apply", "B", {}, 3.0)]
    assert 0 in session.current_branch.applied_insults

    ticks += await run_ticks(manager, session, engine, 1)

    assert ticks[3] == [("advance", 1.0)]
    assert len(applies(engine)) == 1


async def test_advance_calls_sum_to_one_per_tick(tmp_path):
    manager = SessionManager()
    session, engine = make_session(
        tmp_path,
        [
            insult(6.125, "G"),
            insult(0.0, "A"),
            insult(1.25, "B"),
            insult(1.75, "C"),
            insult(3.0, "D"),
            insult(3.0, "E"),
            insult(4.5, "F"),
        ],
    )

    ticks = await run_ticks(manager, session, engine, 8)

    for i, calls in enumerate(ticks):
        dts = [c[1] for c in calls if c[0] == "advance"]
        assert sum(dts) == 1.0, f"tick {i}: advance calls {dts}"
        assert all(dt > 0 for dt in dts), f"tick {i}: non-positive advance in {dts}"
    assert len(applies(engine)) == 7
    assert engine.current_time == 8.0


async def test_tick_counter_and_vitals_time_advance_by_one(tmp_path):
    manager = SessionManager()
    session, engine = make_session(
        tmp_path, [insult(0.0, "A"), insult(2.5, "B"), insult(4.0, "C")]
    )
    branch = session.current_branch

    for n in range(1, 7):
        vitals = await manager._advance_tick(session)
        assert branch.tick_counter == float(n)
        assert vitals.simulation_time == float(n)
        assert branch.last_vitals is vitals

    vitals = await manager.step(session, 3)
    assert branch.tick_counter == 9.0
    assert vitals.simulation_time == 9.0
