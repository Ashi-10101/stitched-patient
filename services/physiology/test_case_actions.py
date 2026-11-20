"""Tests for case-file action parameters and their mapping to Pulse actions.

Bug covered: an unquoted `state: On` in a case file loads as the boolean True
under PyYAML (YAML 1.1), and apply_action used to map anything other than the
string "On" to eSwitch.Off, so needle decompression reached Pulse switched off.

Validates: Requirements 6.5, 6.6, 11.5, 11.6, 11.7
"""
import shutil
from typing import Any, Dict, List, Tuple

import pytest
import yaml

import case_loader
from models import VitalSigns
from pulse_wrapper import PulseEngineWrapper
from session_manager import SessionManager


# ---------------------------------------------------------------------------
# Case files: parameters must be strings or numbers, never booleans
# ---------------------------------------------------------------------------

def _case_action_parameters() -> List[Tuple[str, str, str, Any]]:
    """(case file, location, parameter name, value) for every action parameter."""
    case_paths = sorted(case_loader.CASES_DIR.glob("*.yaml"))
    assert case_paths, f"no case files found in {case_loader.CASES_DIR}"

    found = []
    for path in case_paths:
        with open(path, "r") as f:
            case_data = yaml.safe_load(f)

        insults = case_data.get("timeline", {}).get("scheduledInsults", []) or []
        for i, insult in enumerate(insults):
            for name, value in (insult.get("parameters") or {}).items():
                found.append((path.name, f"scheduledInsults[{i}]", name, value))

        for interv in case_data.get("interventions", []) or []:
            for name, value in (interv.get("parameters") or {}).items():
                found.append((path.name, f"intervention {interv['id']}", name, value))
    return found


def test_case_action_parameters_are_strings_or_numbers():
    params = _case_action_parameters()
    assert params, "case files define no action parameters"

    bad = [
        p for p in params
        if isinstance(p[3], bool) or not isinstance(p[3], (str, int, float))
    ]
    assert not bad, f"non-string/number action parameters (quote them): {bad}"


# ---------------------------------------------------------------------------
# apply_action: strict enum mapping, checked without Pulse running
# ---------------------------------------------------------------------------

class FakePulseEngine:
    """Stands in for PulseEngine; records process_action calls."""

    def __init__(self) -> None:
        self.processed: List[Any] = []

    def process_action(self, action: Any) -> None:
        self.processed.append(action)


def _wrapper_with_fake_engine() -> Tuple[PulseEngineWrapper, FakePulseEngine]:
    wrapper = PulseEngineWrapper.__new__(PulseEngineWrapper)
    fake = FakePulseEngine()
    wrapper.engine = fake
    return wrapper, fake


def test_apply_action_rejects_boolean_state():
    wrapper, fake = _wrapper_with_fake_engine()

    with pytest.raises(ValueError) as exc:
        wrapper.apply_action("SENeedleDecompression", {"side": "Left", "state": True})

    message = str(exc.value)
    assert "SENeedleDecompression" in message
    assert "state" in message
    assert "True" in message
    assert fake.processed == []


def test_apply_action_rejects_lowercase_side():
    wrapper, fake = _wrapper_with_fake_engine()

    with pytest.raises(ValueError) as exc:
        wrapper.apply_action("SENeedleDecompression", {"side": "left", "state": "On"})

    message = str(exc.value)
    assert "SENeedleDecompression" in message
    assert "side" in message
    assert "'left'" in message
    assert fake.processed == []


def test_apply_action_accepts_valid_needle_decompression():
    from pulse.cdm.engine import eSwitch

    wrapper, fake = _wrapper_with_fake_engine()

    wrapper.apply_action("SENeedleDecompression", {"side": "Left", "state": "On"})

    assert len(fake.processed) == 1
    action = fake.processed[0]
    if hasattr(action, "get_state"):
        assert action.get_state() == eSwitch.On


# ---------------------------------------------------------------------------
# Real Pulse: decompression on the case file's intervention actually helps
# ---------------------------------------------------------------------------

def _row(label: str, v: VitalSigns) -> str:
    return (
        f"{label}: t={v.simulation_time} HR={v.heart_rate} RR={v.respiratory_rate} "
        f"SpO2={v.spo2} MAP={v.mean_arterial_pressure} EtCO2={v.etco2} "
        f"TV={v.tidal_volume}"
    )


async def test_case_needle_decompression_beats_untreated_fork():
    case_data = case_loader.load_case("adult-tension-pneumothorax")
    manager = SessionManager()
    session = manager.create_session("adult-tension-pneumothorax", case_data)
    try:
        original = session.current_branch

        await manager.step(session, 150)
        manager.apply_intervention(session, "needle-decompression-left")
        vitals_dec = await manager.step(session, 120)
        assert vitals_dec.simulation_time == 270.0

        auto_150 = [
            cp for cp in original.checkpoints
            if cp.is_automatic is True and cp.simulation_time == 150.0
        ]
        assert len(auto_150) == 1, f"expected one automatic t=150 checkpoint, got {auto_150}"

        manager.fork_branch(session, auto_150[0].checkpoint_id)
        assert session.current_branch is not original
        vitals_fork = await manager.step(session, 120)
        assert vitals_fork.simulation_time == 270.0

        print()
        print(_row("decompressed", vitals_dec))
        print(_row("fork        ", vitals_fork))

        assert vitals_dec.spo2 > vitals_fork.spo2
        assert vitals_dec.heart_rate < vitals_fork.heart_rate
    finally:
        shutil.rmtree(session.temp_dir, ignore_errors=True)
