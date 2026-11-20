"""Integration tests for the per-session clock (SessionManager._clock_task).

Uses the fake engine from test_insult_algorithm.py (no Pulse). Rates are
measured from the loop times at which a recording fake WebSocket receives
pushes, never from sleeps in the test.

Validates: Requirements 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 4.1, 4.2
"""
import asyncio
import contextlib
import time
from pathlib import Path
from typing import Any, AsyncIterator, Callable, Dict, List, Tuple

import pytest

import main
from models import PlaybackControlRequest, PlaybackSpeed
from session_manager import Session, SessionManager
from test_insult_algorithm import FakeEngine, make_session

# Relative tolerance for every rate assertion.
TOLERANCE = 0.10
POLL_S = 0.01


class SlowFakeEngine(FakeEngine):
    """FakeEngine whose advance_time takes 0.1 s of real time (runs in a worker thread)."""

    WORK_S = 0.1

    def advance_time(self, dt: float) -> None:
        time.sleep(self.WORK_S)
        super().advance_time(dt)


class RecordingWebSocket:
    """Fake WebSocket that records (loop time, payload) for every send."""

    def __init__(self) -> None:
        self.records: List[Tuple[float, Dict[str, Any]]] = []

    async def send_json(self, payload: Dict[str, Any]) -> None:
        self.records.append((asyncio.get_running_loop().time(), payload))

    def errors(self) -> List[Dict[str, Any]]:
        return [p for _, p in self.records if "error" in p]

    def vitals(self) -> List[Tuple[float, Dict[str, Any]]]:
        return [(t, p) for t, p in self.records if "error" not in p]


def make_recorded_session(
    tmp_path: Path, engine_cls: type = FakeEngine
) -> Tuple[Session, FakeEngine, RecordingWebSocket]:
    """Fake session (built in the running loop) with one recording subscriber."""
    session, engine = make_session(tmp_path, [])
    if engine_cls is not FakeEngine:
        engine = engine_cls()
        session.current_branch.engine = engine
    ws = RecordingWebSocket()
    session.vitals_subscribers.add(ws)
    return session, engine, ws


@contextlib.asynccontextmanager
async def running_clock(manager: SessionManager, session: Session) -> AsyncIterator[asyncio.Task]:
    """Run the session clock for the duration of the block, then cancel it."""
    task = asyncio.create_task(manager._clock_task(session))
    try:
        yield task
    finally:
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass


@contextlib.contextmanager
def registered_in_main(session: Session):
    """Make main.control_playback able to find the fake session."""
    main.session_manager.sessions[session.session_id] = session
    try:
        yield
    finally:
        main.session_manager.sessions.pop(session.session_id, None)


async def wait_until(predicate: Callable[[], bool], timeout: float, what: str) -> None:
    async def poll() -> None:
        while not predicate():
            await asyncio.sleep(POLL_S)

    try:
        await asyncio.wait_for(poll(), timeout)
    except asyncio.TimeoutError:
        pytest.fail(f"Timed out after {timeout:.1f} s waiting for {what}")


async def wait_for_pushes(ws: RecordingWebSocket, n: int, timeout: float) -> None:
    await wait_until(lambda: len(ws.vitals()) >= n, timeout, f"{n} vitals pushes")


def intervals(times: List[float]) -> List[float]:
    return [b - a for a, b in zip(times, times[1:])]


def assert_close(actual: float, expected: float, label: str) -> None:
    low, high = expected * (1 - TOLERANCE), expected * (1 + TOLERANCE)
    assert low <= actual <= high, (
        f"{label}: {actual:.4f} s not within 10% of {expected:.4f} s ({low:.4f}-{high:.4f})"
    )


# Intervals measured per speed: >= 3 everywhere, about 3 s of wall time at 1x.
INTERVALS_BY_SPEED = {
    PlaybackSpeed.NORMAL: 3,
    PlaybackSpeed.DOUBLE: 4,
    PlaybackSpeed.QUAD: 6,
}
MULTIPLIER = {PlaybackSpeed.NORMAL: 1, PlaybackSpeed.DOUBLE: 2, PlaybackSpeed.QUAD: 4}


@pytest.mark.parametrize(
    "speed", [PlaybackSpeed.NORMAL, PlaybackSpeed.DOUBLE, PlaybackSpeed.QUAD]
)
async def test_playing_advances_at_speed_multiplier(tmp_path, speed):
    """Req 3.9, 3.10, 4.1: 1/2/4 Hz pushes, +1.0 sim s each, sim/wall rate = multiplier."""
    manager = SessionManager()
    session, engine, ws = make_recorded_session(tmp_path)
    await manager.step(session, 1)  # warm up the worker thread before measuring
    session.speed = speed
    session.playing = True
    multiplier = MULTIPLIER[speed]
    n = INTERVALS_BY_SPEED[speed]

    async with running_clock(manager, session):
        await wait_for_pushes(ws, n + 1, timeout=n / multiplier + 3.0)

    assert ws.errors() == []
    pushes = ws.vitals()[: n + 1]
    times = [t for t, _ in pushes]
    sim_times = [p["simulation_time"] for _, p in pushes]

    gaps = intervals(times)
    mean_gap = sum(gaps) / len(gaps)
    assert_close(mean_gap, 1.0 / multiplier, f"mean push interval at {speed.value} (gaps {gaps})")
    assert intervals(sim_times) == [1.0] * n, f"simulation_time per push: {sim_times}"

    rate = (sim_times[-1] - sim_times[0]) / (times[-1] - times[0])
    assert multiplier * (1 - TOLERANCE) <= rate <= multiplier * (1 + TOLERANCE), (
        f"sim s per wall s at {speed.value}: {rate:.3f}"
    )


async def test_sleep_subtracts_tick_duration(tmp_path):
    """Req 3.10, 4.1: a 0.1 s tick at 2x still pushes every 0.5 s, not 0.6 s."""
    manager = SessionManager()
    session, engine, ws = make_recorded_session(tmp_path, SlowFakeEngine)
    await manager.step(session, 1)
    session.speed = PlaybackSpeed.DOUBLE
    session.playing = True
    n = 4

    async with running_clock(manager, session):
        await wait_for_pushes(ws, n + 1, timeout=6.0)

    assert ws.errors() == []
    pushes = ws.vitals()[: n + 1]
    gaps = intervals([t for t, _ in pushes])
    mean_gap = sum(gaps) / len(gaps)
    assert_close(mean_gap, 0.5, f"mean push interval with 0.1 s ticks at 2x (gaps {gaps})")
    assert intervals([p["simulation_time"] for _, p in pushes]) == [1.0] * n


async def test_paused_does_not_advance_and_pushes_at_1hz(tmp_path):
    """Req 4.2 (and 3.6 stopped state): paused keeps time still, re-sends vitals at 1 Hz."""
    manager = SessionManager()
    session, engine, ws = make_recorded_session(tmp_path)
    await manager.step(session, 1)  # sets last_vitals; paused with None sends nothing
    branch = session.current_branch
    assert session.playing is False
    loop = asyncio.get_running_loop()

    async with running_clock(manager, session):
        start_tick, start_time = branch.tick_counter, loop.time()
        await wait_for_pushes(ws, 4, timeout=6.0)
        end_tick, end_time = branch.tick_counter, loop.time()

    assert ws.errors() == []
    assert end_time - start_time >= 2.0
    assert start_tick == end_tick == 1.0
    assert engine.current_time == 1.0

    pushes = ws.vitals()[:4]
    assert [p["simulation_time"] for _, p in pushes] == [1.0] * 4
    gaps = intervals([t for t, _ in pushes])
    assert_close(sum(gaps) / len(gaps), 1.0, f"mean paused push interval (gaps {gaps})")


async def test_paused_playing_paused_transitions(tmp_path):
    """Req 3.4, 3.6: play starts advancing (within ~1 s), pause stops it."""
    manager = main.session_manager  # its start() is never called
    session, engine, ws = make_recorded_session(tmp_path)
    await manager.step(session, 1)
    branch = session.current_branch

    with registered_in_main(session):
        async with running_clock(manager, session):
            # Paused: two pushes (~1 s), no advance.
            await wait_for_pushes(ws, 2, timeout=3.0)
            assert branch.tick_counter == 1.0

            state = await main.control_playback(
                session.session_id, PlaybackControlRequest(playing=True)
            )
            assert state.playing is True and session.playing is True

            # The paused path may still be in its 1.0 s sleep; then ticks run at 1x.
            await wait_until(lambda: branch.tick_counter >= 3.0, 4.0, "two ticks after play")

            state = await main.control_playback(
                session.session_id, PlaybackControlRequest(playing=False)
            )
            assert state.playing is False and session.playing is False
            tick_at_pause = branch.tick_counter

            # At most one tick already in flight may still finish.
            await asyncio.sleep(0.2)
            tick_settled = branch.tick_counter
            assert tick_settled - tick_at_pause <= 1.0

            pushes_before = len(ws.vitals())
            await wait_for_pushes(ws, pushes_before + 2, timeout=4.0)
            assert branch.tick_counter == tick_settled, "time advanced after pause"

    assert ws.errors() == []
    tail = ws.vitals()[pushes_before:]
    assert all(p["simulation_time"] == tick_settled for _, p in tail)


async def test_play_while_playing_stays_playing(tmp_path):
    """Req 3.5: play while playing keeps playing and the clock keeps advancing."""
    manager = main.session_manager
    session, engine, ws = make_recorded_session(tmp_path)
    session.speed = PlaybackSpeed.QUAD
    session.playing = True
    branch = session.current_branch

    with registered_in_main(session):
        async with running_clock(manager, session):
            await wait_for_pushes(ws, 2, timeout=3.0)

            state = await main.control_playback(
                session.session_id, PlaybackControlRequest(playing=True)
            )
            assert state.playing is True
            assert state.speed == PlaybackSpeed.QUAD
            assert session.playing is True

            tick_after_call = branch.tick_counter
            await wait_until(
                lambda: branch.tick_counter >= tick_after_call + 2.0,
                3.0,
                "two more ticks after play-while-playing",
            )
            assert session.playing is True

    assert ws.errors() == []


async def test_pause_while_paused_stays_paused(tmp_path):
    """Req 3.7: pause while paused keeps paused and time stays still."""
    manager = main.session_manager
    session, engine, ws = make_recorded_session(tmp_path)
    await manager.step(session, 1)
    branch = session.current_branch

    with registered_in_main(session):
        async with running_clock(manager, session):
            await wait_for_pushes(ws, 1, timeout=3.0)

            state = await main.control_playback(
                session.session_id, PlaybackControlRequest(playing=False)
            )
            assert state.playing is False
            assert state.speed == PlaybackSpeed.NORMAL
            assert session.playing is False

            await wait_for_pushes(ws, 3, timeout=4.0)
            assert branch.tick_counter == 1.0
            assert session.playing is False

    assert ws.errors() == []
    assert all(p["simulation_time"] == 1.0 for _, p in ws.vitals())


async def test_speed_change_applies_without_pause(tmp_path):
    """Req 3.8: 1x -> 4x while playing; after the straddling push, intervals are 0.25 s."""
    manager = main.session_manager
    session, engine, ws = make_recorded_session(tmp_path)
    await manager.step(session, 1)
    session.playing = True
    loop = asyncio.get_running_loop()

    with registered_in_main(session):
        async with running_clock(manager, session):
            await wait_for_pushes(ws, 2, timeout=4.0)

            state = await main.control_playback(
                session.session_id, PlaybackControlRequest(speed=PlaybackSpeed.QUAD)
            )
            switch_time = loop.time()
            assert state.playing is True and session.playing is True
            assert state.speed == PlaybackSpeed.QUAD

            def pushes_after_switch() -> int:
                return sum(1 for t, _ in ws.vitals() if t > switch_time)

            # 1 straddling interval + 3 intervals at 4x.
            await wait_until(lambda: pushes_after_switch() >= 4, 4.0, "4 pushes after speed change")

    assert ws.errors() == []
    pushes = ws.vitals()
    times = [t for t, _ in pushes]
    pre = [t for t in times if t <= switch_time]
    assert_close(pre[-1] - pre[-2], 1.0, "interval at 1x before the switch")

    first_after = len(pre)
    after_gaps = intervals(times[first_after - 1 : first_after + 4])
    # after_gaps[0] straddles the switch; the 2nd and later must be at 4x.
    for i, gap in enumerate(after_gaps[1:], start=2):
        assert_close(gap, 0.25, f"interval #{i} after the speed change (gaps {after_gaps})")
    sim_times = [p["simulation_time"] for _, p in pushes]
    assert intervals(sim_times) == [1.0] * (len(sim_times) - 1)
