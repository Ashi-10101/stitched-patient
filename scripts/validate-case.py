#!/usr/bin/env python3
"""
Validate a case file against the schema.

Usage:
    python scripts/validate-case.py cases/adult-tension-pneumothorax.yaml
"""

import re
import sys
import json
import yaml
from pathlib import Path
from jsonschema import validate, ValidationError

# The Case_Resolver is shared with the Physiology_Service.
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "services" / "physiology"))
import case_resolver  # noqa: E402


# Speech_Check (patient-speech Requirement 2.3, design "scripts/validate-case.py", decision 14, D11).
# A copy of apps/web/src/lib/speechCheck.ts: the same patterns, the same rules (a) to (f) in the
# same order, and the same failure messages. The checks are partial word lists: passing them does
# not prove that a line is first person or hints at nothing (Requirement 2.7).

# Rule (b): the Case_Schema `maxLength` of a Speech_Line, in code points.
SPEECH_MAX_CODE_POINTS = 200

# Whole-word, case-insensitive. No look-behind, so Python and every browser agree (D11).
SIDE_WORD = re.compile(r"(^|[^A-Za-z0-9_])(left|right)(?=$|[^A-Za-z0-9_])", re.IGNORECASE)
THIRD_PERSON_WORD = re.compile(r"(^|[^A-Za-z0-9_])(he|his|him|himself)(?=$|[^A-Za-z0-9_])", re.IGNORECASE)

# Rule texts: identical to SPEECH_RULE_TEXT in apps/web/src/lib/speechCheck.ts.
SPEECH_RULE_BLANK = "is empty or contains only whitespace"
SPEECH_RULE_TOO_LONG = "has more than 200 characters"


def _speech_rule_diagnosis(term: str) -> str:
    return f'contains Diagnosis_Term "{term}"'


def _speech_rule_side(word: str) -> str:
    return f'contains Side_Word "{word}"'


def _speech_rule_forbidden(term: str) -> str:
    return f'contains Forbidden_Speech_Term "{term}"'


def _speech_rule_third_person(word: str) -> str:
    return f'contains Third_Person_Word "{word}"'


def _is_non_blank(value) -> bool:
    return isinstance(value, str) and value.strip() != ""


def _non_blank_unique(values) -> list:
    """Non-blank strings of `values`, in order, without repeats."""
    result = []
    for value in values:
        if _is_non_blank(value) and value not in result:
            result.append(value)
    return result


def _word_matches(text: str, pattern: "re.Pattern") -> list:
    """Each distinct lower-cased whole-word match of `pattern` (group 2), in first-match order."""
    return _non_blank_unique(m.group(2).lower() for m in pattern.finditer(text))


def _contains_ignoring_case(text: str, term: str) -> bool:
    return term.lower() in text.lower()


def _mapping(value) -> dict:
    return value if isinstance(value, dict) else {}


def _list(value) -> list:
    return value if isinstance(value, list) else []


def forbidden_speech_terms(case: dict) -> list:
    """`play.speech.forbiddenTerms`, every Intervention `label` and Play_Label, every Exam_Button
    text (Left before Right). Non-blank, without repeats, in that order. Empty without a Play_Section."""
    play = case.get("play")
    if not isinstance(play, dict):
        return []
    terms = list(_list(_mapping(play.get("speech")).get("forbiddenTerms")))
    for intervention in _list(case.get("interventions")):
        intervention = _mapping(intervention)
        terms.append(intervention.get("label"))
        terms.append(intervention.get("playLabel"))
    exam = play.get("exam")
    if isinstance(exam, dict) and isinstance(exam.get("actions"), list):
        for action in exam["actions"]:
            action = _mapping(action)
            labels = action.get("labels")
            if labels is not None:
                labels = _mapping(labels)
                terms.append(labels.get("Left"))
                terms.append(labels.get("Right"))
            else:
                terms.append(action.get("label"))
    return _non_blank_unique(terms)


def speech_check(text: str, case: dict) -> list:
    """One message per broken rule (a) to (f), in that order; [] when the text passes."""
    # (a) A blank text reports only this rule.
    if text.strip() == "":
        return [SPEECH_RULE_BLANK]

    failures = []

    # (b) Code points, as JSON Schema `maxLength` counts them (Python's len counts code points).
    if len(text) > SPEECH_MAX_CODE_POINTS:
        failures.append(SPEECH_RULE_TOO_LONG)

    # (c) Diagnosis_Terms, case-insensitive substring (play-mode 2.19).
    diagnosis_terms = _non_blank_unique(_list(_mapping(case.get("play")).get("diagnosisTerms")))
    for term in diagnosis_terms:
        if _contains_ignoring_case(text, term):
            failures.append(_speech_rule_diagnosis(term))

    # (d) Side_Words, whole words.
    for word in _word_matches(text, SIDE_WORD):
        failures.append(_speech_rule_side(word))

    # (e) Forbidden_Speech_Terms, case-insensitive substring.
    for term in forbidden_speech_terms(case):
        if _contains_ignoring_case(text, term):
            failures.append(_speech_rule_forbidden(term))

    # (f) Third_Person_Words, whole words.
    for word in _word_matches(text, THIRD_PERSON_WORD):
        failures.append(_speech_rule_third_person(word))

    return failures


def speech_lines(case: dict) -> list:
    """[(path, text)] for every Speech_Line: status entries, then early, then rescued."""
    speech = _mapping(_mapping(case.get("play")).get("speech"))
    lines = []
    for i, entry in enumerate(_list(speech.get("status"))):
        for j, text in enumerate(_list(_mapping(entry).get("lines"))):
            lines.append((f"play.speech.status[{i}].lines[{j}]", text))
    for key in ("early", "rescued"):
        for j, text in enumerate(_list(speech.get(key))):
            lines.append((f"play.speech.{key}[{j}]", text))
    return lines


def speech_problems(case: dict, prefix: str) -> list:
    """['<prefix><path> "<text>": <rule>'] for every rule that a Speech_Line breaks."""
    problems = []
    for path, text in speech_lines(case):
        if not isinstance(text, str):
            continue  # The Case_Schema rejects non-string lines before this check runs.
        for rule in speech_check(text, case):
            problems.append(f'{prefix}{path} "{text}": {rule}')
    return problems


def validate_speech(case_data: dict) -> bool:
    """Speech_Check on the Base_Case and on every Resolved_Case (Requirement 2.3)."""
    if not isinstance(case_data, dict) or "speech" not in _mapping(case_data.get("play")):
        return True
    problems = speech_problems(case_data, "")
    for variant in _list(case_data.get("variants")):
        resolved = case_resolver.resolve_variant(case_data, variant)
        problems.extend(speech_problems(resolved, f"variant '{variant['id']}': "))
    if problems:
        for problem in problems:
            print(f"✗ {problem}")
        return False
    print("✓ Every Speech_Line passes the speech checks")
    return True


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
    return validate_speech(case_data)


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
    except ValidationError as e:
        print(f"✗ Validation failed:")
        print(f"  {e.message}")
        if e.path:
            print(f"  Path: {'.'.join(str(p) for p in e.path)}")
        return False
    return validate_speech(case_data)


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
