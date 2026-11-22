"""Fast tests for Variant loading in case_loader (bedside-exam task 3.1).

No Pulse engine. Loader rejections use broken copies of the shipped case written
into pytest's tmp_path, with case_loader.CASES_DIR pointed at that directory.
"""
import copy
import json
import shutil
from pathlib import Path
from typing import Any, Callable, Dict, List

import jsonschema
import pytest
import yaml

import case_loader
from case_loader import CaseLoadError, load_case, load_case_with_variants, load_resolved_case
from case_resolver import OVERRIDE_KEYS, resolve_variant

CASE_ID = "adult-tension-pneumothorax"
BROKEN_ID = "broken-case"
SHIPPED_DIR: Path = case_loader.CASES_DIR
SHIPPED_SCHEMA_PATH = SHIPPED_DIR / "case-schema.json"

with open(SHIPPED_DIR / f"{CASE_ID}.yaml", "r") as _f:
    SHIPPED_CASE: Dict[str, Any] = yaml.safe_load(_f)
with open(SHIPPED_SCHEMA_PATH, "r") as _f:
    SHIPPED_SCHEMA: Dict[str, Any] = json.load(_f)

ALLOWED = "insultSide, requiredInterventions, hints, sideRevealText"


def _shipped() -> Dict[str, Any]:
    return copy.deepcopy(SHIPPED_CASE)


def _write_case(tmp_path: Path, case: Any, schema: Any = None, with_schema: bool = True) -> None:
    """Write a case copy as BROKEN_ID; copy the shipped schema, a given schema, or none."""
    with open(tmp_path / f"{BROKEN_ID}.yaml", "w") as f:
        yaml.safe_dump(case, f, sort_keys=False, allow_unicode=True)
    if schema is not None:
        with open(tmp_path / "case-schema.json", "w") as f:
            json.dump(schema, f)
    elif with_schema:
        shutil.copy(SHIPPED_SCHEMA_PATH, tmp_path / "case-schema.json")


@pytest.fixture
def cases_dir(tmp_path, monkeypatch) -> Path:
    monkeypatch.setattr(case_loader, "CASES_DIR", tmp_path)
    return tmp_path


def _load_error(case_id: str = BROKEN_ID) -> str:
    with pytest.raises(CaseLoadError) as info:
        load_case_with_variants(case_id)
    return str(info.value)


# --- Loader rejections (1.6, 1.7, 1.9, 1.10) ---------------------------------

@pytest.mark.parametrize("with_schema", [True, False], ids=["schema", "no-schema"])
def test_duplicate_variant_id_is_rejected(cases_dir, with_schema):
    case = _shipped()
    case["variants"][1]["id"] = "left"
    _write_case(cases_dir, case, with_schema=with_schema)
    assert _load_error() == (
        f"Case validation failed for {BROKEN_ID}: base case (variant 'left') at variants.1.id: "
        "duplicate variant id 'left' (first used at variants.0.id)"
    )


def test_unknown_override_key_is_rejected_by_schema(cases_dir):
    case = _shipped()
    case["variants"][1]["overrides"]["goalText"] = "Keep him safe."
    _write_case(cases_dir, case)
    assert _load_error() == (
        f"Case validation failed for {BROKEN_ID}: base case (variant 'right') at variants.1.overrides: "
        "Additional properties are not allowed ('goalText' was unexpected)"
    )


def test_unknown_override_key_is_rejected_without_schema(cases_dir):
    case = _shipped()
    case["variants"][1]["overrides"]["goalText"] = "Keep him safe."
    _write_case(cases_dir, case, with_schema=False)
    assert _load_error() == (
        f"Case validation failed for {BROKEN_ID}: base case (variant 'right') at variants.1.overrides.goalText: "
        f"unknown override key 'goalText'; allowed keys: {ALLOWED}"
    )


@pytest.mark.parametrize("with_schema", [True, False], ids=["schema", "no-schema"])
def test_insult_side_without_tension_pneumothorax_insult_is_rejected(cases_dir, with_schema):
    case = _shipped()
    case["timeline"]["scheduledInsults"] = []
    _write_case(cases_dir, case, with_schema=with_schema)
    reason = "the base case has no scheduled insult with action SETensionPneumothorax"
    assert _load_error() == f"Case validation failed for {BROKEN_ID}: " + "; ".join([
        f"base case (variant 'left') at variants.0.overrides.insultSide: override 'insultSide' has no target: {reason}",
        f"base case (variant 'right') at variants.1.overrides.insultSide: override 'insultSide' has no target: {reason}",
    ])


@pytest.mark.parametrize("with_schema", [True, False], ids=["schema", "no-schema"])
def test_play_key_without_play_object_is_rejected(cases_dir, with_schema):
    case = _shipped()
    del case["play"]
    _write_case(cases_dir, case, with_schema=with_schema)
    expected = [
        f"base case (variant '{variant_id}') at variants.{i}.overrides.{key}: "
        f"override '{key}' has no target: the base case has no play section"
        for i, variant_id in enumerate(["left", "right"])
        for key in ("requiredInterventions", "hints", "sideRevealText")
    ]
    assert _load_error() == f"Case validation failed for {BROKEN_ID}: " + "; ".join(expected)


def test_resolved_case_that_fails_the_schema_is_rejected(cases_dir):
    # A schema copy that allows only a left insult: the Base_Case and both Variants
    # pass the base schema, but the right Resolved_Case does not.
    schema = copy.deepcopy(SHIPPED_SCHEMA)
    insult_side = schema["properties"]["timeline"]["properties"]["scheduledInsults"]["items"][
        "properties"]["parameters"]["properties"]["side"]
    insult_side["enum"] = ["Left"]
    _write_case(cases_dir, _shipped(), schema=schema)
    assert _load_error() == (
        f"Case validation failed for {BROKEN_ID}: resolved case of variant 'right' at "
        "timeline.scheduledInsults.0.parameters.side: 'Right' is not one of ['Left']"
    )


def test_missing_schema_still_resolves_variants(cases_dir):
    _write_case(cases_dir, _shipped(), with_schema=False)
    loaded = load_case_with_variants(BROKEN_ID)
    assert loaded.variant_ids == ["left", "right"]
    assert loaded.base == SHIPPED_CASE


# --- Base_Case without Variants (1.13) ----------------------------------------

def test_base_case_without_variants_keeps_todays_message(cases_dir):
    case = _shipped()
    del case["variants"]
    del case["title"]
    _write_case(cases_dir, case)
    with pytest.raises(jsonschema.ValidationError) as expected:
        jsonschema.validate(instance=case, schema=SHIPPED_SCHEMA)
    message = _load_error()
    assert message == f"Case validation failed for {BROKEN_ID}: {expected.value.message}"
    assert message == f"Case validation failed for {BROKEN_ID}: 'title' is a required property"


def test_base_case_without_variants_loads_with_no_resolved_cases(cases_dir):
    case = _shipped()
    del case["variants"]
    _write_case(cases_dir, case)
    loaded = load_case_with_variants(BROKEN_ID)
    assert loaded.resolved == {}
    assert loaded.variant_ids == []
    assert load_case(BROKEN_ID) == case


# --- load_resolved_case --------------------------------------------------------

@pytest.mark.parametrize("variant_id", ["left", "right"])
def test_load_resolved_case_returns_each_resolved_case(variant_id):
    variant = next(v for v in SHIPPED_CASE["variants"] if v["id"] == variant_id)
    resolved = load_resolved_case(CASE_ID, variant_id)
    assert resolved == resolve_variant(SHIPPED_CASE, variant)
    assert "variants" not in resolved


@pytest.mark.parametrize("variant_id", ["middle", ""])
def test_load_resolved_case_rejects_unknown_id(variant_id):
    with pytest.raises(CaseLoadError) as info:
        load_resolved_case(CASE_ID, variant_id)
    assert str(info.value) == (
        f"Unknown variant_id for {CASE_ID}: '{variant_id}'. Valid variant ids: left, right"
    )


def test_load_case_returns_the_base_case_with_variants():
    assert load_case(CASE_ID) == SHIPPED_CASE


# --- Schema broken copies (design "Case-content and schema checks") -----------

def _look_chest(case: Dict[str, Any]) -> Dict[str, Any]:
    action = case["play"]["exam"]["actions"][0]
    assert action["id"] == "look-chest" and "label" in action and action["rules"]
    return action


def _both_label_and_labels(case):
    _look_chest(case)["labels"] = {"Left": "Look at his chest - left", "Right": "Look at his chest - right"}


def _side_in_side_neutral_action(case):
    _look_chest(case)["rules"][0]["when"]["side"] = "affected"


def _empty_when(case):
    _look_chest(case)["rules"][0]["when"] = {}


def _override_goal_text(case):
    case["variants"][1]["overrides"]["goalText"] = "Keep him safe."


def _one_variant(case):
    case["variants"] = case["variants"][:1]


def _eleven_variants(case):
    case["variants"] = [
        {"id": f"variant-{i}", "overrides": copy.deepcopy(case["variants"][i % 2]["overrides"])}
        for i in range(11)
    ]


def _long_side_reveal_text(case):
    case["play"]["sideRevealText"] = "a" * 121


def _uppercase_exam_id(case):
    _look_chest(case)["id"] = "Look-chest"


SCHEMA_BREAKS: List[Any] = [
    ("both label and labels", _both_label_and_labels, "play.exam.actions.0"),
    ("when.side in a Side_Neutral_Action", _side_in_side_neutral_action, "play.exam.actions.0.rules.0.when"),
    ("empty when", _empty_when, "play.exam.actions.0.rules.0.when"),
    ("overrides key goalText", _override_goal_text, "variants.1.overrides"),
    ("one Variant", _one_variant, "variants"),
    ("11 Variants", _eleven_variants, "variants"),
    ("sideRevealText of 121 characters", _long_side_reveal_text, "play.sideRevealText"),
    ("Exam_Action id with an uppercase letter", _uppercase_exam_id, "play.exam.actions.0.id"),
]


def _error_paths(document: Any) -> List[str]:
    validator = jsonschema.Draft7Validator(SHIPPED_SCHEMA)
    return sorted(".".join(str(p) for p in e.absolute_path) for e in validator.iter_errors(document))


@pytest.mark.parametrize("name,breaker,path", SCHEMA_BREAKS, ids=[b[0] for b in SCHEMA_BREAKS])
def test_schema_rejects_broken_copy_at_expected_path(name, breaker: Callable, path):
    case = _shipped()
    breaker(case)
    paths = _error_paths(case)
    assert path in paths, f"{name}: expected an error at {path}, got {paths}"


# --- Property 3 (pytest half) -------------------------------------------------

# Feature: bedside-exam, Property 3: Both shipped Variants resolve and validate, and the left Variant equals the Base_Case
def test_property_3_shipped_variants_resolve_validate_and_left_equals_base():
    """**Validates: Requirements 1.8, 1.12, 2.1, 2.2, 2.3, 2.4, 2.5, 2.8**"""
    loaded = load_case_with_variants(CASE_ID)
    base = loaded.base

    assert _error_paths(base) == []
    assert [v["id"] for v in base["variants"]] == ["left", "right"]
    assert loaded.variant_ids == ["left", "right"]

    base_without_variants = copy.deepcopy(base)
    del base_without_variants["variants"]
    interventions = {i["id"]: i for i in base["interventions"]}

    for variant in base["variants"]:
        variant_id = variant["id"]
        overrides = variant["overrides"]
        assert set(overrides) == set(OVERRIDE_KEYS), f"variant '{variant_id}' sets {sorted(overrides)}"

        resolved = loaded.resolved[variant_id]
        assert _error_paths(resolved) == [], f"variant '{variant_id}'"

        required = resolved["play"]["endings"]["rescued"]["requiredInterventions"]
        needles = [interventions[r] for r in required if interventions[r]["action"] == "SENeedleDecompression"]
        assert needles, f"variant '{variant_id}' requires no needle decompression"
        for needle in needles:
            assert needle["parameters"]["side"] == overrides["insultSide"], (
                f"variant '{variant_id}': {needle['id']} side {needle['parameters']['side']} "
                f"!= insultSide {overrides['insultSide']}"
            )

    assert loaded.resolved["left"] == base_without_variants
