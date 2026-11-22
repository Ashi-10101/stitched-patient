"""Integration tests for the subscribe-only vitals WebSocket (pause on last disconnect).

Runs the real app through Starlette's TestClient (lifespan included) with the
real adult-tension-pneumothorax case, so the session's clock task runs in the
TestClient's own event loop. Tests are plain sync functions; the server-side
Session is only read (polled) from the test thread, never driven.

Validates: Requirements 10.7, 10.13
- 10.7: closing one of two subscribers keeps the session playing; closing the
  last one pauses it and simulation time stops advancing.
- 10.13: with two subscribers, both receive the same pushes and simulation
  time advances exactly 1.0 s per push (no extra advance per connection).
Also checks that connect and disconnect update session.last_activity, that an
unknown session id is closed with code 1008, and that deleting the session
cancels its clock task.
"""
import contextlib
import logging
import queue
import threading
import time
from typing import Any, Callable, Dict, List, Optional

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

import main

CASE_ID = "adult-tension-pneumothorax"
POLL_S = 0.02
RECEIVE_TIMEOUT_S = 3.0  # paused sessions push at 1 Hz, so a push always arrives sooner


def wait_until(predicate: Callable[[], bool], timeout: float, what: str) -> None:
    deadline = time.monotonic() + timeout
    while not predicate():
        if time.monotonic() > deadline:
            pytest.fail(f"Timed out after {timeout:.1f} s waiting for {what}")
        time.sleep(POLL_S)


def receive_json_within(ws: Any, timeout: float = RECEIVE_TIMEOUT_S) -> Dict[str, Any]:
    """ws.receive_json() with a deadline (the TestClient call blocks forever)."""
    result: "queue.Queue[Any]" = queue.Queue()

    def run() -> None:
        try:
            result.put((True, ws.receive_json()))
        except BaseException as exc:  # re-raised in the test thread
            result.put((False, exc))

    threading.Thread(target=run, daemon=True).start()
    try:
        ok, value = result.get(timeout=timeout)
    except queue.Empty:
        pytest.fail(f"No WebSocket message within {timeout:.1f} s")
    if not ok:
        raise value
    return value


def receive_vitals(ws: Any) -> Dict[str, Any]:
    payload = receive_json_within(ws)
    assert "error" not in payload, f"unexpected error push: {payload}"
    return payload


def assert_one_second_steps(sim_times: List[float], label: str) -> None:
    """Pushes at t > 0 (after play) must be 1.0, 2.0, 3.0, ... with no gaps or repeats."""
    played = [t for t in sim_times if t > 0.0]
    assert played, f"{label}: no pushes after play ({sim_times})"
    assert played == [float(i) for i in range(1, len(played) + 1)], (
        f"{label}: simulation_time per push is not 1.0, 2.0, ...: {sim_times}"
    )


def dropped_records(caplog: pytest.LogCaptureFixture) -> List[logging.LogRecord]:
    """Records of the broadcasters removing a subscriber after a failed send."""
    return [
        r for r in caplog.records
        if r.name == "session_manager" and r.getMessage().startswith("Dropped ")
    ]


@pytest.mark.pulse
def test_pause_only_on_last_disconnect(caplog):
    """Req 10.7, 10.13: two subscribers; first close keeps playing, last close pauses."""
    caplog.set_level(logging.INFO, logger="session_manager")
    caplog.set_level(logging.INFO, logger="main")

    with TestClient(main.app) as client:
        resp = client.post("/sessions", json={"case_id": CASE_ID, "variant_id": "left"})
        assert resp.status_code == 200, resp.text
        sid = resp.json()["session_id"]
        session = main.session_manager.sessions[sid]
        clock_task = session.clock_task
        assert clock_task is not None
        url = f"/sessions/{sid}/vitals"
        stack1 = contextlib.ExitStack()
        stack2 = contextlib.ExitStack()

        try:
            # Connect both. A push proves the socket is subscribed, and the
            # handler sets last_activity right after adding it (no await between).
            before = session.last_activity
            ws1 = stack1.enter_context(client.websocket_connect(url))
            first1 = receive_vitals(ws1)
            assert first1["simulation_time"] == 0.0
            assert session.last_activity > before, "last_activity not updated on connect #1"

            before = session.last_activity
            ws2 = stack2.enter_context(client.websocket_connect(url))
            first2 = receive_vitals(ws2)
            assert first2["simulation_time"] == 0.0
            assert session.last_activity > before, "last_activity not updated on connect #2"
            assert len(session.vitals_subscribers) == 2
            assert session.playing is False

            resp = client.post(f"/sessions/{sid}/playback", json={"playing": True, "speed": "4x"})
            assert resp.status_code == 200, resp.text
            assert resp.json()["playing"] is True

            # Both connected: both see the same 1.0 s steps while playing.
            times1: List[float] = [first1["simulation_time"]]
            times2: List[float] = [first2["simulation_time"]]
            while times1[-1] < 3.0:
                times1.append(receive_vitals(ws1)["simulation_time"])
            while times2[-1] < 3.0:
                times2.append(receive_vitals(ws2)["simulation_time"])
            assert_one_second_steps(times1, "socket 1 with both connected")
            assert_one_second_steps(times2, "socket 2 with both connected")
            assert [t for t in times1 if t > 0] == [t for t in times2 if t > 0]
            assert session.playing is True
            assert len(session.vitals_subscribers) == 2

            # Close the first socket: the handler removes it, the session keeps playing.
            before = session.last_activity
            stack1.close()
            wait_until(lambda: len(session.vitals_subscribers) == 1, 2.0, "1 subscriber left")
            # The handler bumps last_activity right after the discard; it runs in
            # another thread, so allow it a moment to land.
            wait_until(lambda: session.last_activity > before, 1.0,
                       "last_activity update on disconnect #1")
            time.sleep(0.3)  # let the handler's finally block finish before checking playing
            assert session.playing is True, "session paused although a subscriber is still connected"
            assert any(
                r.name == "main" and f"WebSocket disconnected for session {sid}" in r.getMessage()
                for r in caplog.records
            ), "caplog did not capture the handler's disconnect log from the TestClient thread"

            # The remaining socket keeps receiving advancing vitals (backlog included).
            tick_after_close = session.current_branch.tick_counter
            fresh = 0
            deadline = time.monotonic() + 3.0
            while fresh < 3:
                assert time.monotonic() < deadline, (
                    f"no 3 pushes after t={tick_after_close} within 3 s: {times2}"
                )
                t = receive_vitals(ws2)["simulation_time"]
                times2.append(t)
                assert t > times2[-2], f"simulation_time not strictly increasing: {times2}"
                if t > tick_after_close:
                    fresh += 1
            assert_one_second_steps(times2, "socket 2 after socket 1 closed")
            assert session.playing is True

            # Close the last socket: the session pauses and time stops.
            before = session.last_activity
            stack2.close()
            wait_until(lambda: len(session.vitals_subscribers) == 0, 2.0, "0 subscribers")
            wait_until(lambda: session.last_activity > before, 1.0,
                       "last_activity update on disconnect #2")
            # Same cross-thread allowance as above: playing is set right after.
            wait_until(lambda: session.playing is False, 1.0, "pause after the last disconnect")
            time.sleep(0.3)  # at most one tick may already be in flight
            tick_settled = session.current_branch.tick_counter
            time.sleep(1.5)
            assert session.current_branch.tick_counter == tick_settled, "time advanced after pause"
            assert session.playing is False

            # The removals came from the handler, not from a failed broadcast send.
            assert dropped_records(caplog) == [], [r.getMessage() for r in dropped_records(caplog)]
        finally:
            stack1.close()
            stack2.close()
            client.delete(f"/sessions/{sid}")  # 404 if already deleted is fine

        wait_until(clock_task.done, 2.0, "clock task to finish after delete")
        assert clock_task.cancelled()
        assert sid not in main.session_manager.sessions


def test_unknown_session_closed_with_1008():
    """The vitals socket for an unknown session id is closed with policy-violation code 1008."""
    with TestClient(main.app) as client:
        with pytest.raises(WebSocketDisconnect) as exc_info:
            with client.websocket_connect("/sessions/does-not-exist/vitals") as ws:
                receive_json_within(ws)
        assert exc_info.value.code == 1008
