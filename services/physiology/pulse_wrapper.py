"""Wrapper for Pulse Physiology Engine operations."""
import tempfile
from pathlib import Path
from typing import Dict, Any, List
from pulse.engine.PulseEngine import PulseEngine
from pulse.cdm.engine import SEDataRequest, SEDataRequestManager, eSide, eGate, eSwitch
from pulse.cdm.patient_actions import SETensionPneumothorax, SENeedleDecompression
from pulse.cdm.scalars import FrequencyUnit, PressureUnit, VolumeUnit

from models import VitalSigns


# Exact case-file strings accepted for enum parameters. Anything else,
# including YAML 1.1 booleans such as an unquoted `On`, is rejected.
_SIDES = {"Left": eSide.Left, "Right": eSide.Right}
_GATES = {"Closed": eGate.Closed, "Open": eGate.Open}
_SWITCHES = {"On": eSwitch.On, "Off": eSwitch.Off}


def _lookup(action_name: str, param: str, value: Any, mapping: Dict[str, Any]) -> Any:
    """Map a case-file string to a Pulse enum, or raise ValueError."""
    if not isinstance(value, str) or value not in mapping:
        expected = ", ".join(repr(k) for k in mapping)
        raise ValueError(
            f"{action_name}: invalid {param} {value!r} (expected one of {expected})"
        )
    return mapping[value]


class PulseEngineWrapper:
    """
    Manages a single Pulse engine instance and its state.
    
    Handles data requests, action processing, and checkpoint serialization.
    """
    
    DATA_ROOT = "/pulse/bin"
    
    def __init__(self, starting_state: str):
        """
        Initialize engine from a starting state file.
        
        Args:
            starting_state: Path to Pulse state JSON file
        """
        self.engine = PulseEngine(data_root_dir=self.DATA_ROOT)
        self.engine.log_to_console(False)
        
        # Set up data requests for all vitals we need
        self.data_requests = [
            SEDataRequest.create_physiology_request("HeartRate", unit=FrequencyUnit.Per_min),
            SEDataRequest.create_physiology_request("RespirationRate", unit=FrequencyUnit.Per_min),
            SEDataRequest.create_physiology_request("OxygenSaturation"),
            SEDataRequest.create_physiology_request("MeanArterialPressure", unit=PressureUnit.mmHg),
            SEDataRequest.create_physiology_request("SystolicArterialPressure", unit=PressureUnit.mmHg),
            SEDataRequest.create_physiology_request("DiastolicArterialPressure", unit=PressureUnit.mmHg),
            SEDataRequest.create_physiology_request("EndTidalCarbonDioxidePressure", unit=PressureUnit.mmHg),
            SEDataRequest.create_physiology_request("TidalVolume", unit=VolumeUnit.mL),
        ]
        self.data_manager = SEDataRequestManager(self.data_requests)
        
        # Load initial state
        self.engine.serialize_from_file(starting_state, self.data_manager)
        self.current_time = 0.0
    
    def advance_time(self, seconds: float) -> None:
        """Advance simulation by the specified duration."""
        self.engine.advance_time_s(seconds)
        self.current_time += seconds
    
    def get_vitals(self) -> VitalSigns:
        """
        Pull current vital signs from the engine.
        
        Returns:
            VitalSigns object with current values
        """
        values = self.engine.pull_data()
        
        # values[0] is simulation time, then one value per request in order
        return VitalSigns(
            simulation_time=self.current_time,
            heart_rate=values[1],
            respiratory_rate=values[2],
            spo2=values[3],
            mean_arterial_pressure=values[4],
            systolic_pressure=values[5],
            diastolic_pressure=values[6],
            etco2=values[7],
            tidal_volume=values[8],
        )
    
    def apply_action(self, action_name: str, parameters: Dict[str, Any]) -> None:
        """
        Apply a Pulse action with the given parameters.
        
        Args:
            action_name: Pulse action class name (e.g., "SETensionPneumothorax")
            parameters: Action-specific parameters
        """
        if action_name == "SETensionPneumothorax":
            action = SETensionPneumothorax()
            action.set_side(
                _lookup(action_name, "side", parameters["side"], _SIDES)
            )
            action.set_type(
                _lookup(action_name, "type", parameters["type"], _GATES)
            )
            action.get_severity().set_value(parameters["severity"])
            
        elif action_name == "SENeedleDecompression":
            action = SENeedleDecompression()
            action.set_side(
                _lookup(action_name, "side", parameters["side"], _SIDES)
            )
            action.set_state(
                _lookup(action_name, "state", parameters["state"], _SWITCHES)
            )
            
        else:
            raise ValueError(f"Unknown action: {action_name}")
        
        self.engine.process_action(action)
    
    def save_checkpoint(self, path: Path) -> None:
        """Save current engine state to a file."""
        self.engine.serialize_to_file(str(path))
    
    @classmethod
    def load_from_checkpoint(cls, checkpoint_path: Path) -> "PulseEngineWrapper":
        """
        Create a new engine instance from a checkpoint.
        
        Args:
            checkpoint_path: Path to saved checkpoint file
            
        Returns:
            New PulseEngineWrapper instance at the checkpoint state
        """
        # Create a dummy instance to set up data requests
        wrapper = cls.__new__(cls)
        wrapper.engine = PulseEngine(data_root_dir=cls.DATA_ROOT)
        wrapper.engine.log_to_console(False)
        
        # Set up data requests (must match the original)
        wrapper.data_requests = [
            SEDataRequest.create_physiology_request("HeartRate", unit=FrequencyUnit.Per_min),
            SEDataRequest.create_physiology_request("RespirationRate", unit=FrequencyUnit.Per_min),
            SEDataRequest.create_physiology_request("OxygenSaturation"),
            SEDataRequest.create_physiology_request("MeanArterialPressure", unit=PressureUnit.mmHg),
            SEDataRequest.create_physiology_request("SystolicArterialPressure", unit=PressureUnit.mmHg),
            SEDataRequest.create_physiology_request("DiastolicArterialPressure", unit=PressureUnit.mmHg),
            SEDataRequest.create_physiology_request("EndTidalCarbonDioxidePressure", unit=PressureUnit.mmHg),
            SEDataRequest.create_physiology_request("TidalVolume", unit=VolumeUnit.mL),
        ]
        wrapper.data_manager = SEDataRequestManager(wrapper.data_requests)
        
        # Load from checkpoint
        wrapper.engine.serialize_from_file(str(checkpoint_path), wrapper.data_manager)
        
        # Read current simulation time from the engine
        values = wrapper.engine.pull_data()
        wrapper.current_time = values[0]
        
        return wrapper
