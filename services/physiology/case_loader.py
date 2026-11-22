"""Case file loading and validation."""
import yaml
import jsonschema
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Any, List, Optional

from case_resolver import check_case, resolve_all


CASES_DIR = Path("/app/cases")
SCHEMA_PATH = CASES_DIR / "case-schema.json"


class CaseLoadError(Exception):
    """Raised when a case file cannot be loaded or is invalid."""
    pass


@dataclass(frozen=True)
class LoadedCase:
    case_id: str
    base: Dict[str, Any]                  # the parsed file, `variants` included
    resolved: Dict[str, Dict[str, Any]]   # Variant_Id -> Resolved_Case, Case_Definition order; {} without Variants

    @property
    def variant_ids(self) -> List[str]:
        return list(self.resolved.keys())


def _read_schema() -> Optional[Dict[str, Any]]:
    """Read the case schema next to the case files; None when the file is missing."""
    try:
        with open(CASES_DIR / SCHEMA_PATH.name, 'r') as f:
            return yaml.safe_load(f)
    except FileNotFoundError:
        # Schema not found - skip schema validation in development
        return None


def load_case_with_variants(case_id: str) -> LoadedCase:
    """
    Load and validate a case definition and resolve its side Variants.

    Args:
        case_id: Case identifier (matches filename without extension)

    Returns:
        The parsed Base_Case and one Resolved_Case per Variant

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

    schema = _read_schema()

    if not (isinstance(case_data, dict) and "variants" in case_data):
        # Validate against schema (unchanged for a Base_Case without Variants)
        if schema is not None:
            try:
                jsonschema.validate(instance=case_data, schema=schema)
            except jsonschema.ValidationError as e:
                raise CaseLoadError(f"Case validation failed for {case_id}: {e.message}")
        return LoadedCase(case_id=case_id, base=case_data, resolved={})

    problems = check_case(case_data, schema)
    if problems:
        raise CaseLoadError(
            f"Case validation failed for {case_id}: " + "; ".join(str(p) for p in problems)
        )
    return LoadedCase(case_id=case_id, base=case_data, resolved=resolve_all(case_data, schema))


def load_case(case_id: str) -> Dict[str, Any]:
    """
    Load and validate a case definition.

    Args:
        case_id: Case identifier (matches filename without extension)

    Returns:
        Validated case data (the Base_Case, `variants` included)

    Raises:
        CaseLoadError: If case file not found or validation fails
    """
    return load_case_with_variants(case_id).base


def load_resolved_case(case_id: str, variant_id: str) -> Dict[str, Any]:
    """
    Load a case and return the Resolved_Case of one Variant.

    Raises:
        CaseLoadError: If the case cannot be loaded or has no Variant `variant_id`
    """
    loaded = load_case_with_variants(case_id)
    if variant_id not in loaded.resolved:
        valid = ", ".join(loaded.variant_ids) if loaded.variant_ids else "(none)"
        raise CaseLoadError(
            f"Unknown variant_id for {case_id}: '{variant_id}'. Valid variant ids: {valid}"
        )
    return loaded.resolved[variant_id]


def list_cases() -> list[str]:
    """List all available case IDs."""
    if not CASES_DIR.exists():
        return []
    
    return [
        p.stem for p in CASES_DIR.glob("*.yaml")
        if p.stem != "case-schema"
    ]
