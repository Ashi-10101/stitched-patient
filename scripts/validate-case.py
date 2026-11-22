#!/usr/bin/env python3
"""
Validate a case file against the schema.

Usage:
    python scripts/validate-case.py cases/adult-tension-pneumothorax.yaml
"""

import sys
import json
import yaml
from pathlib import Path
from jsonschema import validate, ValidationError

# The Case_Resolver is shared with the Physiology_Service.
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "services" / "physiology"))
import case_resolver  # noqa: E402


def validate_variants(case_data: dict, schema: dict) -> bool:
    """Check a Base_Case with Variants and every Resolved_Case (Requirements 1.11, 1.12)."""
    problems = case_resolver.check_case(case_data, schema)
    if problems:
        for problem in problems:
            print(f"✗ {problem}")
        return False
    print("✓ Base case is valid")
    for variant in case_data["variants"]:
        print(f"✓ Resolved case of variant '{variant['id']}' is valid")
    return True


def validate_case(case_path: Path, schema_path: Path) -> bool:
    """Validate a case file against the schema."""
    
    # Load case file
    try:
        with open(case_path, 'r') as f:
            case_data = yaml.safe_load(f)
        print(f"✓ Loaded case file: {case_path}")
    except Exception as e:
        print(f"✗ Failed to load case file: {e}")
        return False
    
    # Load schema
    try:
        with open(schema_path, 'r') as f:
            schema = json.load(f)
        print(f"✓ Loaded schema: {schema_path}")
    except Exception as e:
        print(f"✗ Failed to load schema: {e}")
        return False
    
    if isinstance(case_data, dict) and "variants" in case_data:
        return validate_variants(case_data, schema)

    # Validate
    try:
        validate(instance=case_data, schema=schema)
        print(f"✓ Case file is valid")
        return True
    except ValidationError as e:
        print(f"✗ Validation failed:")
        print(f"  {e.message}")
        if e.path:
            print(f"  Path: {'.'.join(str(p) for p in e.path)}")
        return False


def main():
    if len(sys.argv) != 2:
        print("Usage: python scripts/validate-case.py <case-file>")
        sys.exit(1)
    
    case_path = Path(sys.argv[1])
    schema_path = Path("cases/case-schema.json")
    
    if not case_path.exists():
        print(f"✗ Case file not found: {case_path}")
        sys.exit(1)
    
    if not schema_path.exists():
        print(f"✗ Schema file not found: {schema_path}")
        sys.exit(1)
    
    success = validate_case(case_path, schema_path)
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
