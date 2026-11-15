"""Case file loading and validation."""
import yaml
import jsonschema
from pathlib import Path
from typing import Dict, Any


CASES_DIR = Path("/app/cases")
SCHEMA_PATH = CASES_DIR / "case-schema.json"


class CaseLoadError(Exception):
    """Raised when a case file cannot be loaded or is invalid."""
    pass


def load_case(case_id: str) -> Dict[str, Any]:
    """
    Load and validate a case definition.
    
    Args:
        case_id: Case identifier (matches filename without extension)
        
    Returns:
        Validated case data
        
    Raises:
        CaseLoadError: If case file not found or validation fails
    """
    case_path = CASES_DIR / f"{case_id}.yaml"
    
    if not case_path.exists():
        raise CaseLoadError(f"Case file not found: {case_id}")
    
    try:
        with open(case_path, 'r') as f:
            case_data = yaml.safe_load(f)
    except yaml.YAMLError as e:
        raise CaseLoadError(f"Invalid YAML in {case_id}: {e}")
    
    # Validate against schema
    try:
        with open(SCHEMA_PATH, 'r') as f:
            schema = yaml.safe_load(f)
        jsonschema.validate(instance=case_data, schema=schema)
    except jsonschema.ValidationError as e:
        raise CaseLoadError(f"Case validation failed for {case_id}: {e.message}")
    except FileNotFoundError:
        # Schema not found - skip validation in development
        pass
    
    return case_data


def list_cases() -> list[str]:
    """List all available case IDs."""
    if not CASES_DIR.exists():
        return []
    
    return [
        p.stem for p in CASES_DIR.glob("*.yaml")
        if p.stem != "case-schema"
    ]
