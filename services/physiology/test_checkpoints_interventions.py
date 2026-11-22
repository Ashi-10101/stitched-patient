"""Tests for checkpoint eviction and intervention application.

Eviction tests build Branch and Checkpoint objects directly (no Pulse engine,
no event loop). Each checkpoint points to a real file under tmp_path so that
deletion can be checked on disk. The cap is set per test through
session_manager.settings.max_checkpoints_per_branch.

Intervention tests go through the real HTTP endpoint with Starlette's
TestClient (lifespan included) and the real adult-tension-pneumothorax case.
The server-side Session is only read from the test thread, never driven.

Validates: Requirements 6.11, 6.12, 7.2, 7.11, 7.12
- 6.11: an unknown intervention_id returns 400 naming the valid ids.
- 6.12: an engine action failure returns 500 and the service keeps working.
- 7.2: a successful intervention saves a manual checkpoint.
- 7.11: the per-branch cap comes from configuration, read on every save.
- 7.12: at the cap, the oldest automatic checkpoint is evicted, otherwise the
  oldest manual one; the initial t=0 checkpoint is never evicted, and the
  evicted checkpoint's file is deleted.
"""
import contextlib
import logging
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Dict, Iterator, List, Optional, Tuple

import pytest
from fastapi.testclient import TestClient

import case_loader
import main
import session_manager
from session_manager import Branch, Checkpoint

CASE_ID = "adult-tension-pneumothorax"
POLL_S = 0.02


# ---------------------------------------------------------------------------
# Eviction helpers
# ---------------------------------------------------------------------------

def make_checkpoint(tmp_path: Path, tick: float, is_automatic: bool) -> Checkpoint:
    """A checkpoint at `tick` simulated seconds, backed by a real small file."""
    checkpoint_id = str(uuid.uuid4())
    path = tmp_path / f"{checkpoint_id}.json"
    path.write_text('{"checkpoint": "%s"}' % checkpoint_id)
    return Checkpoint(
        checkpoint_id=checkpoint_id,
        simulation_time=tick,
        path=path,
        created_at=datetime.utcnow(),
        is_automatic=is_automatic,
        applied_insults=frozenset(),
        event_count=0,
        tick_counter=tick,
        description=f"{'auto' if is_automatic else 'manual'} t={tick}",
    )


def make_branch() -> Branch:
    return Branch(
        branch_id=str(uuid.uuid4()),
        parent_branch_id=None,
        forked_from_checkpoint=None,
        engine=object(),  # add_checkpoint never touches the engine
    )


def fill_branch(
    tmp_path: Path, branch: Branch, kinds: List[bool]
) -> List[Checkpoint]:
    """
    Add one checkpoint per entry in `kinds` (True = automatic) directly to the
    list, in tick order: the first entry is t=0, then t=30, 60, 90, ...
    Bypasses add_checkpoint so setup never evicts.
    """
    cps = [
        make_checkpoint(tmp_path, 30.0 * i, is_automatic)
        for i, is_automatic in enumerate(kinds)
    ]
    branch.checkpoints.extend(cps)
    return cps


def ids(cps: List[Checkpoint]) -> List[str]:
    return [cp.checkpoint_id for cp in cps]


def set_cap(monkeypatch: pytest.MonkeyPatch, cap: int) -> None:
    monkeypatch.setattr(session_manager.settings, "max_checkpoints_per_branch", cap)


# ---------------------------------------------------------------------------
# Eviction tests (Req 7.11, 7.12)
# ---------------------------------------------------------------------------

def test_under_cap_appends_without_eviction(tmp_path, monkeypatch):
    """Req 7.11: below the cap, add_checkpoint only appends."""
    set_cap(monkeypatch, 10)
    branch = make_branch()
    existing = fill_branch(tmp_path, branch, [True, True, False, True, False])

    new = make_checkpoint(tmp_path, 150.0, True)
    branch.add_checkpoint(new)

    assert ids(branch.checkpoints) == ids(existing) + [new.checkpoint_id]
    for cp in existing + [new]:
        assert cp.path.exists(), f"file of {cp.description} was deleted under the cap"


def test_at_cap_evicts_oldest_automatic_and_keeps_t0(tmp_path, monkeypatch):
    """
    Req 7.12: at the cap, the oldest automatic checkpoint (not t=0) goes.

    t=0 is first and automatic, so ignoring its protection would evict it.
    A manual checkpoint sits at t=30, before the first evictable automatic one
    (t=60), so "evict the oldest overall" would pick t=30. Several automatic
    checkpoints follow, so "evict the newest automatic" would pick t=240.
    """
    cap = 10
    set_cap(monkeypatch, cap)
    branch = make_branch()
    #        t=0   t=30   t=60  t=90  t=120  t=150 t=180 t=210  t=240 t=270
    kinds = [True, False, True, True, False, True, True, False, True, False]
    existing = fill_branch(tmp_path, branch, kinds)
    assert len(branch.checkpoints) == cap
    t0, victim = existing[0], existing[2]
    assert victim.tick_counter == 60.0 and victim.is_automatic

    new = make_checkpoint(tmp_path, 300.0, True)
    branch.add_checkpoint(new)

    assert len(branch.checkpoints) == cap
    assert branch.checkpoints[-1] is new, "new checkpoint is not appended last"
    assert branch.checkpoints[0] is t0, "t=0 checkpoint was evicted or moved"
    expected = [cp for cp in existing if cp is not victim] + [new]
    assert ids(branch.checkpoints) == ids(expected), (
        "wrong victim: expected the oldest automatic checkpoint (t=60), got "
        f"remaining ticks {[cp.tick_counter for cp in branch.checkpoints]}"
    )
    assert not victim.path.exists(), "evicted checkpoint's file still on disk"


def test_no_automatic_evicts_oldest_manual_and_keeps_t0(tmp_path, monkeypatch):
    """
    Req 7.12: with no automatic checkpoints besides t=0, the oldest manual
    one (not t=0) goes. t=0 is automatic and first, so a fallback that ignores
    protection would pick it as "oldest automatic".
    """
    cap = 10
    set_cap(monkeypatch, cap)
    branch = make_branch()
    existing = fill_branch(tmp_path, branch, [True] + [False] * (cap - 1))
    t0, victim = existing[0], existing[1]
    assert victim.tick_counter == 30.0 and not victim.is_automatic

    new = make_checkpoint(tmp_path, 300.0, False)
    branch.add_checkpoint(new)

    assert len(branch.checkpoints) == cap
    assert branch.checkpoints[0] is t0, "t=0 checkpoint was evicted"
    assert branch.checkpoints[-1] is new
    expected = [cp for cp in existing if cp is not victim] + [new]
    assert ids(branch.checkpoints) == ids(expected), (
        "wrong victim: expected the oldest manual checkpoint (t=30), got "
        f"remaining ticks {[cp.tick_counter for cp in branch.checkpoints]}"
    )
    assert not victim.path.exists(), "evicted checkpoint's file still on disk"


def test_only_evicted_file_is_deleted(tmp_path, monkeypatch):
    """Req 7.12: the victim's file is removed; every other file stays on disk."""
    cap = 10
    set_cap(monkeypatch, cap)
    branch = make_branch()
    kinds = [False, False, True, False, True, True, False, True, False, True]
    existing = fill_branch(tmp_path, branch, kinds)
    victim = existing[2]  # oldest automatic after the protected t=0

    new = make_checkpoint(tmp_path, 300.0, True)
    branch.add_checkpoint(new)

    assert victim.checkpoint_id not in ids(branch.checkpoints)
    assert not victim.path.exists(), f"victim file {victim.path.name} not deleted"
    for cp in existing + [new]:
        if cp is victim:
            continue
        assert cp.path.exists(), f"file of kept checkpoint t={cp.tick_counter} was deleted"
    on_disk = sorted(p.name for p in tmp_path.iterdir())
    assert on_disk == sorted(cp.path.name for cp in branch.checkpoints)


def test_missing_victim_file_does_not_raise(tmp_path, monkeypatch, caplog):
    """Req 7.12: a victim whose file is already gone is still evicted, with a warning."""
    caplog.set_level(logging.WARNING, logger="session_manager")
    cap = 10
    set_cap(monkeypatch, cap)
    branch = make_branch()
    existing = fill_branch(tmp_path, branch, [True] * cap)
    victim = existing[1]
    victim.path.unlink()

    new = make_checkpoint(tmp_path, 300.0, True)
    branch.add_checkpoint(new)  # must not raise

    assert len(branch.checkpoints) == cap
    assert victim.checkpoint_id not in ids(branch.checkpoints)
    assert branch.checkpoints[-1] is new
    assert any(
        r.levelno == logging.WARNING and victim.path.name in r.getMessage()
        for r in caplog.records
    ), f"no warning naming {victim.path.name}: {[r.getMessage() for r in caplog.records]}"


def test_cap_change_takes_effect_on_next_call(tmp_path, monkeypatch):
    """
    Req 7.11: the cap is read from settings on every add. Catches a hardcoded
    cap and a cap read once (at import or on first call).
    """
    set_cap(monkeypatch, 10)
    branch = make_branch()
    existing = fill_branch(tmp_path, branch, [True] * 10)

    set_cap(monkeypatch, 12)
    first = make_checkpoint(tmp_path, 300.0, True)
    branch.add_checkpoint(first)
    assert len(branch.checkpoints) == 11, "evicted although under the raised cap of 12"
    assert ids(branch.checkpoints) == ids(existing) + [first.checkpoint_id]
    assert all(cp.path.exists() for cp in existing + [first])

    set_cap(monkeypatch, 10)
    second = make_checkpoint(tmp_path, 330.0, True)
    branch.add_checkpoint(second)
    victim = existing[1]
    assert len(branch.checkpoints) == 11, "expected exactly one eviction at cap 10"
    assert victim.checkpoint_id not in ids(branch.checkpoints)
    assert not victim.path.exists()
    assert branch.checkpoints[0] is existing[0]
    assert branch.checkpoints[-1] is second


# ---------------------------------------------------------------------------
# Intervention helpers
# ---------------------------------------------------------------------------

def wait_until(predicate: Callable[[], bool], timeout: float, what: str) -> None:
    deadline = time.monotonic() + timeout
    while not predicate():
        if time.monotonic() > deadline:
            pytest.fail(f"Timed out after {timeout:.1f} s waiting for {what}")
        time.sleep(POLL_S)


@contextlib.contextmanager
def advanced_session(client: TestClient) -> Iterator[Tuple[str, Any]]:
    """
    Create a session, play at 4x until tick_counter >= 2.0, pause, and wait
    for the clock to settle. Yields (session_id, server-side Session). The
    session is deleted on exit.
    """
    resp = client.post("/sessions", json={"case_id": CASE_ID})
    assert resp.status_code == 200, resp.text
    sid = resp.json()["session_id"]
    session = main.session_manager.sessions[sid]
    try:
        resp = client.post(f"/sessions/{sid}/playback", json={"playing": True, "speed": "4x"})
        assert resp.status_code == 200, resp.text
        wait_until(lambda: session.current_branch.tick_counter >= 2.0, 10.0,
                   "tick_counter >= 2.0")
        resp = client.post(f"/sessions/{sid}/playback", json={"playing": False})
        assert resp.status_code == 200, resp.text

        # Settle: an in-flight tick may still land after the pause.
        deadline = time.monotonic() + 10.0
        while True:
            before = session.current_branch.tick_counter
            time.sleep(1.2)
            if session.current_branch.tick_counter == before:
                break
            assert time.monotonic() < deadline, "clock did not settle after pause"
        assert session.playing is False
        assert session.current_branch.tick_counter >= 2.0
        yield sid, session
    finally:
        client.delete(f"/sessions/{sid}")  # 404 if already deleted is fine


def counts(branch: Any) -> Tuple[int, int]:
    return len(branch.events), len(branch.checkpoints)


# ---------------------------------------------------------------------------
# Intervention tests (Req 6.11, 6.12, 7.2)
# ---------------------------------------------------------------------------

@pytest.mark.pulse
def test_unknown_intervention_and_bad_parameter_return_400():
    """Req 6.11: unknown id gives 400 listing valid ids; a bad parameter gives 400. No side effects."""
    valid_ids = [i["id"] for i in case_loader.load_case(CASE_ID)["interventions"]]
    assert valid_ids, "case defines no interventions"

    with TestClient(main.app) as client:
        with advanced_session(client) as (sid, session):
            branch = session.current_branch
            assert [i["id"] for i in session.case_data["interventions"]] == valid_ids

            before = counts(branch)
            resp = client.post(f"/sessions/{sid}/interventions",
                               json={"intervention_id": "no-such-thing"})
            assert resp.status_code == 400, resp.text
            detail = resp.json()["detail"]
            assert "no-such-thing" in detail
            for valid_id in valid_ids:
                assert valid_id in detail, f"detail does not list valid id {valid_id!r}: {detail}"
            assert counts(branch) == before, "unknown id added an event or checkpoint"

            before = counts(branch)
            resp = client.post(
                f"/sessions/{sid}/interventions",
                json={"intervention_id": "needle-decompression-left",
                      "parameters": {"state": True}},
            )
            assert resp.status_code == 400, resp.text
            assert counts(branch) == before, "bad parameter added an event or checkpoint"
            assert branch.failed is False


@pytest.mark.pulse
def test_engine_action_failure_returns_500_and_service_survives():
    """Req 6.12: a non-ValueError engine failure gives 500, no side effects, service keeps working."""
    with TestClient(main.app) as client:
        with advanced_session(client) as (sid, session):
            branch = session.current_branch
            engine = branch.engine
            calls: List[Optional[str]] = []

            def failing_apply_action(action_name: str, parameters: Dict[str, Any]) -> None:
                calls.append(action_name)
                raise RuntimeError("simulated Pulse failure")

            before = counts(branch)
            last_vitals_before = branch.last_vitals
            with pytest.MonkeyPatch.context() as mp:
                mp.setattr(engine, "apply_action", failing_apply_action)
                resp = client.post(f"/sessions/{sid}/interventions",
                                   json={"intervention_id": "needle-decompression-left"})
            assert calls == ["SENeedleDecompression"], "patched apply_action was not called"
            assert resp.status_code == 500, resp.text
            assert "simulated Pulse failure" in resp.json()["detail"]
            assert counts(branch) == before, "failed action recorded an event or checkpoint"
            assert branch.last_vitals is last_vitals_before
            assert branch.failed is False

            # The service still answers, and a real intervention now succeeds.
            resp = client.get(f"/sessions/{sid}")
            assert resp.status_code == 200, resp.text
            resp = client.post(f"/sessions/{sid}/interventions",
                               json={"intervention_id": "needle-decompression-left"})
            assert resp.status_code == 200, resp.text
            assert counts(branch) == (before[0] + 1, before[1] + 1)


@pytest.mark.pulse
def test_successful_intervention_saves_manual_checkpoint():
    """Req 7.2: a successful intervention records one event and saves one manual checkpoint."""
    intervention_id = "needle-decompression-left"
    with TestClient(main.app) as client:
        with advanced_session(client) as (sid, session):
            branch = session.current_branch
            label = next(
                i["label"] for i in session.case_data["interventions"]
                if i["id"] == intervention_id
            )
            tick = branch.tick_counter
            assert tick >= 2.0
            n_events, n_checkpoints = counts(branch)

            resp = client.post(f"/sessions/{sid}/interventions",
                               json={"intervention_id": intervention_id})
            assert resp.status_code == 200, resp.text
            assert resp.json() == {"status": "applied", "intervention_id": intervention_id}

            assert len(branch.events) == n_events + 1
            assert len(branch.checkpoints) == n_checkpoints + 1
            event = branch.events[-1]
            assert event.intervention_id == intervention_id
            assert event.simulation_time == branch.tick_counter == tick

            cp = branch.checkpoints[-1]
            assert cp.is_automatic is False
            assert cp.description == f"After {label}"
            assert cp.event_count == len(branch.events)
            assert cp.tick_counter == event.simulation_time
            assert cp.simulation_time == event.simulation_time
            assert cp.path.exists(), f"manual checkpoint file missing: {cp.path}"
