"""Real-Pulse determinism test for the `right` Variant of the tension pneumothorax case.

Two Branches forked from the same Checkpoint, with needle-decompression-right
applied at the same Simulation_Time on both, must give the same VitalSigns
(tolerance and failure message as in test_determinism.py).

Validates: Requirements 3.13, 3.14, 14.12
"""
import asyncio
import shutil

import pytest

import case_loader
from session_manager import Session, SessionManager

CASE_ID = "adult-tension-pneumothorax"
VARIANT_ID = "right"
FORK_TIME = 60.0          # automatic checkpoint, after the insult at t=30
NEEDLE_TIME = 90.0        # needle-decompression-right on both branches
END_TIME = 150.0

tolerance = 0.001  # same as test_determinism.py


def assert_vitals_equal(v1, v2, label):
    """Compare two VitalSigns objects (same checks and messages as test_determinism.py)."""
    assert abs(v1.heart_rate - v2.heart_rate) < tolerance, \
        f"{label}: HR mismatch {v1.heart_rate} vs {v2.heart_rate}"
    assert abs(v1.respiratory_rate - v2.respiratory_rate) < tolerance, \
        f"{label}: RR mismatch"
    assert abs(v1.spo2 - v2.spo2) < tolerance, \
        f"{label}: SpO2 mismatch {v1.spo2} vs {v2.spo2}"
    assert abs(v1.mean_arterial_pressure - v2.mean_arterial_pressure) < tolerance, \
        f"{label}: MAP mismatch {v1.mean_arterial_pressure} vs {v2.mean_arterial_pressure}"
    assert abs(v1.etco2 - v2.etco2) < tolerance, \
        f"{label}: EtCO2 mismatch"
    assert abs(v1.tidal_volume - v2.tidal_volume) < tolerance, \
        f"{label}: TV mismatch"


async def _run_branch(manager: SessionManager, session: Session, checkpoint_id: str):
    """Fork from the checkpoint, apply the right needle at NEEDLE_TIME, run to END_TIME."""
    await manager.fork_branch(session, checkpoint_id)
    branch = session.current_branch
    assert branch.tick_counter == FORK_TIME

    v_needle = await manager.step(session, int(NEEDLE_TIME - FORK_TIME))
    assert v_needle.simulation_time == NEEDLE_TIME
    await manager.apply_intervention(session, "needle-decompression-right")
    v_end = await manager.step(session, int(END_TIME - NEEDLE_TIME))
    assert v_end.simulation_time == END_TIME
    return branch, v_needle, v_end


# Feature: bedside-exam, Property 7: Each Variant is deterministic in the Pulse engine
@pytest.mark.pulse
async def test_right_variant_branches_from_same_checkpoint_are_deterministic():
    case_data = case_loader.load_resolved_case(CASE_ID, VARIANT_ID)
    insults = case_data["timeline"]["scheduledInsults"]
    assert [i["parameters"]["side"] for i in insults] == ["Right"]

    manager = SessionManager()
    session = manager.create_session(CASE_ID, case_data, variant_id=VARIANT_ID)
    original = session.current_branch
    init_path = original.checkpoints[0].path
    try:
        await manager.step(session, int(FORK_TIME))
        found = [
            cp for cp in original.checkpoints
            if cp.is_automatic is True and cp.simulation_time == FORK_TIME
        ]
        assert len(found) == 1, f"expected one automatic t={FORK_TIME} checkpoint, got {found}"
        checkpoint_id = found[0].checkpoint_id

        branch_a, a_needle, a_end = await _run_branch(manager, session, checkpoint_id)
        branch_b, b_needle, b_end = await _run_branch(manager, session, checkpoint_id)

        assert branch_a is not branch_b
        assert branch_a.engine is not branch_b.engine
        for branch in (branch_a, branch_b):
            assert [(e.simulation_time, e.intervention_id) for e in branch.events] == [
                (NEEDLE_TIME, "needle-decompression-right")
            ]

        print()
        for label, v in (("A t=90 ", a_needle), ("B t=90 ", b_needle),
                         ("A t=150", a_end), ("B t=150", b_end)):
            print(
                f"{label}: HR={v.heart_rate} RR={v.respiratory_rate} SpO2={v.spo2} "
                f"MAP={v.mean_arterial_pressure} EtCO2={v.etco2} TV={v.tidal_volume}"
            )

        assert_vitals_equal(a_needle, b_needle, "t=90s")
        assert_vitals_equal(a_end, b_end, "t=150s")
    finally:
        session.clock_task.cancel()
        try:
            await session.clock_task
        except asyncio.CancelledError:
            pass
        shutil.rmtree(session.temp_dir, ignore_errors=True)
        init_path.unlink(missing_ok=True)
