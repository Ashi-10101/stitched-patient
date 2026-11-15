"""
Test that the simulation is deterministic.

Starting from the same checkpoint and applying the same interventions 
at the same simulation times must produce identical vitals.
"""
import tempfile
from pathlib import Path
from pulse_wrapper import PulseEngineWrapper


def test_determinism():
    """Test that identical scenarios produce identical results."""
    
    # Initial state
    starting_state = "/pulse/bin/states/StandardMale@0s.json"
    
    # Run 1: Create baseline scenario
    engine1 = PulseEngineWrapper(starting_state)
    
    # Advance 20 seconds
    engine1.advance_time(20.0)
    vitals_1_t20 = engine1.get_vitals()
    
    # Apply tension pneumothorax
    engine1.apply_action("SETensionPneumothorax", {
        "side": "Left",
        "type": "Closed",
        "severity": 0.75
    })
    
    # Advance 60 seconds
    engine1.advance_time(60.0)
    vitals_1_t80 = engine1.get_vitals()
    
    # Apply needle decompression
    engine1.apply_action("SENeedleDecompression", {
        "side": "Left",
        "state": "On"
    })
    
    # Advance 40 seconds
    engine1.advance_time(40.0)
    vitals_1_t120 = engine1.get_vitals()
    
    # Save checkpoint
    checkpoint_path = Path(tempfile.gettempdir()) / "test_checkpoint.json"
    engine1.save_checkpoint(checkpoint_path)
    
    # Run 2: Repeat exact same scenario
    engine2 = PulseEngineWrapper(starting_state)
    
    engine2.advance_time(20.0)
    vitals_2_t20 = engine2.get_vitals()
    
    engine2.apply_action("SETensionPneumothorax", {
        "side": "Left",
        "type": "Closed",
        "severity": 0.75
    })
    
    engine2.advance_time(60.0)
    vitals_2_t80 = engine2.get_vitals()
    
    engine2.apply_action("SENeedleDecompression", {
        "side": "Left",
        "state": "On"
    })
    
    engine2.advance_time(40.0)
    vitals_2_t120 = engine2.get_vitals()
    
    # Run 3: Load from checkpoint and continue
    engine3 = PulseEngineWrapper.load_from_checkpoint(checkpoint_path)
    vitals_3_t120 = engine3.get_vitals()
    
    engine3.advance_time(30.0)
    vitals_3_t150 = engine3.get_vitals()
    
    # Run 4: Repeat from checkpoint
    engine4 = PulseEngineWrapper.load_from_checkpoint(checkpoint_path)
    vitals_4_t120 = engine4.get_vitals()
    
    engine4.advance_time(30.0)
    vitals_4_t150 = engine4.get_vitals()
    
    # Assertions
    tolerance = 0.001  # Allow tiny floating-point differences
    
    def assert_vitals_equal(v1, v2, label):
        """Compare two VitalSigns objects."""
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
    
    # Run 1 vs Run 2 (identical scenarios)
    assert_vitals_equal(vitals_1_t20, vitals_2_t20, "t=20s")
    assert_vitals_equal(vitals_1_t80, vitals_2_t80, "t=80s")
    assert_vitals_equal(vitals_1_t120, vitals_2_t120, "t=120s")
    
    # Checkpoint loading produces same state
    assert_vitals_equal(vitals_1_t120, vitals_3_t120, "checkpoint load")
    assert_vitals_equal(vitals_3_t120, vitals_4_t120, "checkpoint load repeat")
    
    # Continuing from checkpoint is deterministic
    assert_vitals_equal(vitals_3_t150, vitals_4_t150, "post-checkpoint")
    
    print("✓ All determinism tests passed")
    print(f"  t=20s:  HR={vitals_1_t20.heart_rate:.1f} SpO2={vitals_1_t20.spo2:.3f} MAP={vitals_1_t20.mean_arterial_pressure:.1f}")
    print(f"  t=80s:  HR={vitals_1_t80.heart_rate:.1f} SpO2={vitals_1_t80.spo2:.3f} MAP={vitals_1_t80.mean_arterial_pressure:.1f}")
    print(f"  t=120s: HR={vitals_1_t120.heart_rate:.1f} SpO2={vitals_1_t120.spo2:.3f} MAP={vitals_1_t120.mean_arterial_pressure:.1f}")
    print(f"  t=150s: HR={vitals_3_t150.heart_rate:.1f} SpO2={vitals_3_t150.spo2:.3f} MAP={vitals_3_t150.mean_arterial_pressure:.1f}")


if __name__ == "__main__":
    test_determinism()
