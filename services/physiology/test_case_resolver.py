"""Tests for case_resolver.py: Variant resolution, case checks and the Variant pick.

Pure logic only: these tests start no Pulse engine and carry no `pulse` marker.
Validates: Requirements 1.4, 1.5, 1.6, 1.7, 1.9, 1.10, 1.13, 3.2, 3.3, 3.4, 3.5, 3.11, 3.12, 10.3, 14.9, 14.10
"""
import copy
import json
import math
from typing import Any, Dict, List, Optional

import jsonschema
import pytest
import yaml
from hypothesis import given, settings
from hypothesis import strategies as st

from case_loader import CASES_DIR, SCHEMA_PATH
from case_resolver import (
    OVERRIDE_KEYS,
    TENSION_PNEUMOTHORAX_ACTION,
    CaseProblem,
    CaseVariantError,
    VariantSelectionError,
    check_case,
    choose_variant,
    resolve_all,
    resolve_variant,
    variant_index,
)

HYPOTHESIS_SETTINGS = settings(max_examples=100, derandomize=True, deadline=None)


def _load_shipped_base() -> Dict[str, Any]:
    with open(CASES_DIR / "adult-tension-pneumothorax.yaml", "r") as f:
        case = yaml.safe_load(f)
    case.pop("variants", None)
    return case


SHIPPED_BASE = _load_shipped_base()
with open(SCHEMA_PATH, "r") as _f:
    SHIPPED_SCHEMA = json.load(_f)
INTERVENTION_IDS = [i["id"] for i in SHIPPED_BASE["interventions"]]

# Checks play.hints[*].text length and has no `variants` definition, so a bad Hint
# in a Variant is seen only on the Resolved_Case (the "Resolved schema" row).
HINT_TEXT_SCHEMA = {
    "type": "object",
    "properties": {
        "play": {
            "type": "object",
            "properties": {
                "hints": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {"text": {"type": "string", "minLength": 1}},
                    },
                },
            },
        },
    },
}

# Declares only the Variant_Overrides keys, so an unknown key is seen by the base schema step
# whether or not the shipped schema defines `variants` yet.
VARIANT_OVERRIDES_SCHEMA = {
    "type": "object",
    "properties": {
        "variants": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "overrides": {
                        "type": "object",
                        "additionalProperties": False,
                        "properties": {key: {} for key in OVERRIDE_KEYS},
                    },
                },
            },
        },
    },
}


def _base_with(variants: Optional[List[Dict[str, Any]]] = None) -> Dict[str, Any]:
    base = copy.deepcopy(SHIPPED_BASE)
    if variants is not None:
        base["variants"] = variants
    return base


def _never_called() -> float:
    pytest.fail("the Variant_Source must not be read")


# ---------------------------------------------------------------------------
# Examples: one per row of the design table "Error messages"
# ---------------------------------------------------------------------------

def test_message_base_schema_inside_a_variant():
    base = _base_with([
        {"id": "left", "overrides": {"insultSide": "Left"}},
        {"id": "right", "overrides": {"insultSide": "Right", "goalText": "x"}},
    ])
    problems = check_case(base, VARIANT_OVERRIDES_SCHEMA)
    assert [str(p) for p in problems] == [
        "base case (variant 'right') at variants.1.overrides: "
        "Additional properties are not allowed ('goalText' was unexpected)"
    ]


def test_message_duplicate_id():
    base = _base_with([
        {"id": "left", "overrides": {"insultSide": "Left"}},
        {"id": "left", "overrides": {"insultSide": "Right"}},
    ])
    assert [str(p) for p in check_case(base, None)] == [
        "base case (variant 'left') at variants.1.id: duplicate variant id 'left' (first used at variants.0.id)"
    ]


def test_message_unknown_key():
    base = _base_with([
        {"id": "left", "overrides": {"insultSide": "Left"}},
        {"id": "right", "overrides": {"insultSide": "Right", "goalText": "x"}},
    ])
    assert [str(p) for p in check_case(base, None)] == [
        "base case (variant 'right') at variants.1.overrides.goalText: unknown override key 'goalText'; "
        "allowed keys: insultSide, requiredInterventions, hints, sideRevealText"
    ]


def test_message_missing_insult_target():
    base = _base_with([
        {"id": "left", "overrides": {"sideRevealText": "Left side."}},
        {"id": "right", "overrides": {"insultSide": "Right"}},
    ])
    base["timeline"]["scheduledInsults"] = []
    assert [str(p) for p in check_case(base, None)] == [
        "base case (variant 'right') at variants.1.overrides.insultSide: override 'insultSide' has no target: "
        "the base case has no scheduled insult with action SETensionPneumothorax"
    ]


def test_message_missing_play_target():
    base = _base_with([
        {"id": "left", "overrides": {"insultSide": "Left"}},
        {"id": "right", "overrides": {"hints": [{"text": "a"}]}},
    ])
    del base["play"]
    assert [str(p) for p in check_case(base, None)] == [
        "base case (variant 'right') at variants.1.overrides.hints: override 'hints' has no target: "
        "the base case has no play section"
    ]


def test_message_resolved_schema():
    base = _base_with([
        {"id": "left", "overrides": {"hints": [{"text": "a"}]}},
        {"id": "right", "overrides": {"hints": [{"text": "a"}, {"text": "b"}, {"text": ""}]}},
    ])
    problems = check_case(base, HINT_TEXT_SCHEMA)
    assert [str(p) for p in problems] == ["resolved case of variant 'right' at play.hints.2.text: '' is too short"]
    assert problems[0].document == "resolved"


def test_message_root_path_and_error_join():
    problems = check_case({"variants": "x"}, {"required": ["id"]})
    assert [str(p) for p in problems] == ["base case at (root): 'id' is a required property"]
    with pytest.raises(CaseVariantError) as info:
        resolve_all({"variants": [{"id": "a", "overrides": {}}, {"id": "a", "overrides": {}}, {"id": "a", "overrides": {}}]}, None)
    assert str(info.value) == (
        "base case (variant 'a') at variants.1.id: duplicate variant id 'a' (first used at variants.0.id); "
        "base case (variant 'a') at variants.2.id: duplicate variant id 'a' (first used at variants.0.id)"
    )
    assert len(info.value.problems) == 2


def test_variant_shape_is_checked_without_a_schema():
    base = _base_with([{"id": "left", "overrides": []}, "right", {"overrides": {}}])
    assert [str(p) for p in check_case(base, None)] == [
        "base case (variant 'left') at variants.0.overrides: variant overrides must be an object",
        "base case at variants.1: variant must be an object",
        "base case at variants.2.id: variant id must be a string",
    ]


def test_variant_index_rejects_bad_input():
    for u, n in [(0.5, 0), (1.0, 2), (-0.1, 2), (float("nan"), 2)]:
        with pytest.raises(ValueError):
            variant_index(u, n)


# ---------------------------------------------------------------------------
# resolve_variant on the shipped case
# ---------------------------------------------------------------------------

def test_resolve_variant_on_shipped_case():
    base = _base_with()
    variant = {
        "id": "right",
        "overrides": {
            "insultSide": "Right",
            "requiredInterventions": ["needle-decompression-right"],
            "hints": [{"text": "Listen to both sides of his chest."}],
            "sideRevealText": "The trapped air was on his right side.",
        },
    }
    base_before = copy.deepcopy(base)
    resolved = resolve_variant(base, variant)

    assert "variants" not in resolved
    assert resolved["timeline"]["scheduledInsults"][0]["parameters"] == {
        "side": "Right", "type": "Closed", "severity": 0.75,
    }
    assert resolved["play"]["endings"]["rescued"]["requiredInterventions"] == ["needle-decompression-right"]
    assert resolved["play"]["hints"] == [{"text": "Listen to both sides of his chest."}]
    assert resolved["play"]["sideRevealText"] == "The trapped air was on his right side."
    assert base == base_before
    assert check_case(base, SHIPPED_SCHEMA) == []

    # Every field outside the four Override_Targets is unchanged.
    expected = copy.deepcopy(base)
    expected["timeline"]["scheduledInsults"][0]["parameters"]["side"] = "Right"
    expected["play"]["endings"]["rescued"]["requiredInterventions"] = ["needle-decompression-right"]
    expected["play"]["hints"] = [{"text": "Listen to both sides of his chest."}]
    expected["play"]["sideRevealText"] = "The trapped air was on his right side."
    assert resolved == expected


# ---------------------------------------------------------------------------
# Strategies
# ---------------------------------------------------------------------------

KEBAB_IDS = st.text(alphabet="abcdefghijklmnopqrstuvwxyz0123456789-", min_size=1, max_size=12)
SHORT_TEXT = st.text(alphabet="abcdefghijklmnopqrstuvwxyz ABC.,'", min_size=1, max_size=40)
SIDES = st.sampled_from(["Left", "Right"])
JSON_VALUES = st.one_of(
    st.none(), st.booleans(), st.integers(), st.text(max_size=5),
    st.lists(st.integers(), max_size=3),
    st.dictionaries(st.text(max_size=3), st.integers(), max_size=2),
)
HINT_LISTS = st.lists(st.fixed_dictionaries({"text": SHORT_TEXT}), min_size=1, max_size=3)
REQUIRED_LISTS = st.lists(st.sampled_from(INTERVENTION_IDS), min_size=1, max_size=2, unique=True)


@st.composite
def insults(draw):
    params: Dict[str, Any] = {}
    if draw(st.booleans()):
        params["side"] = draw(SIDES)
    params["severity"] = draw(st.floats(min_value=0, max_value=1))
    params.update(draw(st.dictionaries(st.sampled_from(["type", "rate", "extra"]), JSON_VALUES, max_size=2)))
    return {
        "timeSeconds": draw(st.integers(min_value=0, max_value=600)),
        "action": draw(st.sampled_from(
            [TENSION_PNEUMOTHORAX_ACTION, "SEHemorrhage", "SEAsthmaAttack", "SEAirwayObstruction"]
        )),
        "parameters": params,
    }


@st.composite
def resolver_inputs(draw):
    """A Base_Case from the shipped case and Variants that check_case(base, None) accepts."""
    base = copy.deepcopy(SHIPPED_BASE)
    base.update(draw(st.dictionaries(
        st.text(alphabet="xyz", min_size=1, max_size=6).map(lambda k: "extra" + k), JSON_VALUES, max_size=3,
    )))
    base["timeline"]["scheduledInsults"] = draw(st.lists(insults(), max_size=3))
    play_shape = draw(st.sampled_from(["full", "no-endings", "no-required", "absent"]))
    if play_shape == "no-endings":
        del base["play"]["endings"]
    elif play_shape == "no-required":
        del base["play"]["endings"]["rescued"]["requiredInterventions"]
    elif play_shape == "absent":
        del base["play"]

    allowed = []
    if any(i["action"] == TENSION_PNEUMOTHORAX_ACTION for i in base["timeline"]["scheduledInsults"]):
        allowed.append("insultSide")
    if "play" in base:
        allowed += ["requiredInterventions", "hints", "sideRevealText"]
    values = {"insultSide": SIDES, "requiredInterventions": REQUIRED_LISTS, "hints": HINT_LISTS,
              "sideRevealText": SHORT_TEXT}

    ids = draw(st.lists(KEBAB_IDS, min_size=1, max_size=3, unique=True))
    variants = []
    for variant_id in ids:
        keys = draw(st.lists(st.sampled_from(allowed), unique=True)) if allowed else []
        variants.append({"id": variant_id, "overrides": {k: draw(values[k]) for k in keys}})
    if draw(st.booleans()):
        base["variants"] = variants
    return base, variants


def _expected_resolution(base: Dict[str, Any], variant: Dict[str, Any]) -> Dict[str, Any]:
    expected = copy.deepcopy(base)
    expected.pop("variants", None)
    overrides = variant["overrides"]
    if "insultSide" in overrides:
        for insult in expected["timeline"]["scheduledInsults"]:
            if insult["action"] == TENSION_PNEUMOTHORAX_ACTION:
                insult["parameters"]["side"] = overrides["insultSide"]
    if "requiredInterventions" in overrides:
        rescued = expected["play"].setdefault("endings", {}).setdefault("rescued", {})
        rescued["requiredInterventions"] = overrides["requiredInterventions"]
    if "hints" in overrides:
        expected["play"]["hints"] = overrides["hints"]
    if "sideRevealText" in overrides:
        expected["play"]["sideRevealText"] = overrides["sideRevealText"]
    return expected


def _mutate_every_container(document: Any) -> None:
    containers = []

    def collect(node: Any) -> None:
        if isinstance(node, dict):
            containers.append(node)
            for value in node.values():
                collect(value)
        elif isinstance(node, list):
            containers.append(node)
            for value in node:
                collect(value)

    collect(document)
    for container in containers:
        if isinstance(container, dict):
            container["__mutated__"] = True
        else:
            container.append("__mutated__")


# ---------------------------------------------------------------------------
# Properties
# ---------------------------------------------------------------------------

# Feature: bedside-exam, Property 1: The Case_Resolver changes only the Override_Targets
@HYPOTHESIS_SETTINGS
@given(resolver_inputs())
def test_property_1_resolver_changes_only_override_targets(inputs):
    """**Validates: Requirements 1.4, 1.5**"""
    base, variants = inputs
    assert check_case(base, None) == []
    for variant in variants:
        base_before = copy.deepcopy(base)
        variant_before = copy.deepcopy(variant)

        resolved = resolve_variant(base, variant)

        assert "variants" not in resolved
        assert resolved == _expected_resolution(base_before, variant_before)
        assert base == base_before
        assert variant == variant_before
        assert resolve_variant(base, variant) == resolved

        _mutate_every_container(resolved)
        assert base == base_before
        assert variant == variant_before


@st.composite
def valid_cases_with_variants(draw):
    """The shipped Base_Case with 2 to 4 Variants that pass the shipped schema.

    No `sideRevealText`: the shipped schema accepts `play.sideRevealText` only from task 2 on,
    and this test must pass before and after task 2.
    """
    ids = draw(st.lists(KEBAB_IDS, min_size=2, max_size=4, unique=True))
    variants = []
    for variant_id in ids:
        overrides = {"insultSide": draw(SIDES)}
        if draw(st.booleans()):
            overrides["requiredInterventions"] = draw(REQUIRED_LISTS)
        if draw(st.booleans()):
            overrides["hints"] = draw(HINT_LISTS)
        variants.append({"id": variant_id, "overrides": overrides})
    return _base_with(variants)


UNKNOWN_KEYS = st.text(alphabet="abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ", min_size=1, max_size=12).filter(
    lambda k: k not in OVERRIDE_KEYS
)
BASE_FAULTS = ["duplicate-id", "unknown-key", "no-insult", "no-play"]


def _schema_alone(document: Dict[str, Any], schema: Optional[Dict[str, Any]]) -> List[CaseProblem]:
    if schema is None:
        return []
    return [
        CaseProblem("base", ".".join(str(p) for p in e.absolute_path) or "(root)", e.message)
        for e in jsonschema.Draft7Validator(schema).iter_errors(document)
    ]


# Feature: bedside-exam, Property 2: The Case_Resolver rejects bad Variants by id and path
@HYPOTHESIS_SETTINGS
@given(valid_cases_with_variants(), st.sampled_from(BASE_FAULTS + ["resolved", "without-variants"]), st.data())
def test_property_2_resolver_rejects_bad_variants_by_id_and_path(base, fault, data):
    """**Validates: Requirements 1.6, 1.7, 1.9, 1.10, 1.13**"""
    if fault == "resolved":
        schema = HINT_TEXT_SCHEMA
    else:
        schema = data.draw(st.sampled_from([None, SHIPPED_SCHEMA, HINT_TEXT_SCHEMA]))
    assert check_case(base, None) == []
    assert check_case(base, schema) == []

    if fault == "without-variants":
        del base["variants"]
        breakage = data.draw(st.sampled_from(["none", "no-title", "numeric-id"]))
        if breakage == "no-title":
            del base["title"]
        elif breakage == "numeric-id":
            base["id"] = 5
        expected = _schema_alone(base, schema)
        assert sorted(check_case(base, schema), key=str) == sorted(expected, key=str)
        if expected:
            with pytest.raises(CaseVariantError):
                resolve_all(base, schema)
        else:
            assert resolve_all(base, schema) == {}
        return

    variants = base["variants"]
    j = data.draw(st.integers(min_value=1, max_value=len(variants) - 1))
    if fault == "duplicate-id":
        i = data.draw(st.integers(min_value=0, max_value=j - 1))
        variants[j]["id"] = variants[i]["id"]
        expected_path, document = f"variants.{j}.id", "base"
    elif fault == "unknown-key":
        key = data.draw(UNKNOWN_KEYS)
        variants[j]["overrides"][key] = data.draw(JSON_VALUES)
        expected_path, document = f"variants.{j}.overrides.{key}", "base"
    elif fault == "no-insult":
        base["timeline"]["scheduledInsults"] = []
        expected_path, document = f"variants.{j}.overrides.insultSide", "base"
    elif fault == "no-play":
        key = data.draw(st.sampled_from(["requiredInterventions", "hints", "sideRevealText"]))
        variants[j]["overrides"][key] = data.draw(
            {"requiredInterventions": REQUIRED_LISTS, "hints": HINT_LISTS, "sideRevealText": SHORT_TEXT}[key]
        )
        del base["play"]
        expected_path, document = f"variants.{j}.overrides.{key}", "base"
    else:  # resolved
        hints = data.draw(HINT_LISTS)
        h = data.draw(st.integers(min_value=0, max_value=len(hints) - 1))
        hints[h]["text"] = ""
        variants[j]["overrides"]["hints"] = hints
        expected_path, document = f"play.hints.{h}.text", "resolved"

    faulty_id = variants[j]["id"]
    problems = check_case(base, schema)
    if schema is None or fault in ("duplicate-id", "resolved"):
        assert any(
            p.variant_id == faulty_id and p.path == expected_path and p.document == document for p in problems
        ), problems
    else:
        # A schema that defines Variants may report the fault at the enclosing Variant field.
        assert any(
            p.variant_id == faulty_id and p.document == "base"
            and (p.path == expected_path or expected_path.startswith(p.path + "."))
            and p.path.startswith(f"variants.{j}")
            for p in problems
        ), problems
    with pytest.raises(CaseVariantError) as info:
        resolve_all(base, schema)
    assert info.value.problems == tuple(problems)


@st.composite
def pick_inputs(draw):
    n = draw(st.integers(min_value=2, max_value=10))
    k = draw(st.integers(min_value=1, max_value=n - 1))
    u = draw(st.one_of(
        st.floats(min_value=0, max_value=1, exclude_max=True),
        st.just(k / n),
        st.just(math.nextafter(k / n, 0)),
        st.just(0.0),
        st.just(math.nextafter(1.0, 0)),
    ))
    ids = draw(st.lists(KEBAB_IDS, min_size=n, max_size=n, unique=True))
    return n, k, u, ids


# Feature: bedside-exam, Property 4: The Variant pick is floor(u × n), and each Variant owns an interval of width 1/n
@HYPOTHESIS_SETTINGS
@given(pick_inputs())
def test_property_4_variant_pick_owns_intervals(inputs):
    """**Validates: Requirements 3.2**"""
    n, k, u, ids = inputs
    index = variant_index(u, n)
    assert 0 <= index <= n - 1
    assert index == max(m for m in range(n) if m / n <= u)

    assert variant_index(k / n, n) == k
    assert variant_index(math.nextafter(k / n, 0), n) == k - 1
    assert variant_index(0.0, n) == 0
    assert variant_index(math.nextafter(1.0, 0), n) == n - 1

    calls = []

    def source() -> float:
        calls.append(u)
        return u

    assert choose_variant("adult-tension-pneumothorax", ids, None, source) == ids[index]
    assert len(calls) == 1


# Feature: bedside-exam, Property 5: A named variant_id is used as given, and a bad one is refused
@HYPOTHESIS_SETTINGS
@given(KEBAB_IDS, st.lists(KEBAB_IDS, max_size=10, unique=True), st.data())
def test_property_5_named_variant_id_used_or_refused(case_id, ids, data):
    """**Validates: Requirements 3.3, 3.4, 3.5, 3.12**"""
    choices = [st.text(max_size=12), KEBAB_IDS]
    if ids:
        choices.append(st.sampled_from(ids))
    requested = data.draw(st.one_of(*choices))

    if requested in ids:
        assert choose_variant(case_id, ids, requested, _never_called) == requested
    elif ids:
        with pytest.raises(VariantSelectionError) as info:
            choose_variant(case_id, ids, requested, _never_called)
        assert str(info.value) == f"Unknown variant_id: '{requested}'. Valid variant ids: {', '.join(ids)}"
    else:
        with pytest.raises(VariantSelectionError) as info:
            choose_variant(case_id, ids, requested, _never_called)
        assert str(info.value) == (
            f"Case '{case_id}' has no variants; omit variant_id or send null (got '{requested}')"
        )

    assert choose_variant(case_id, [], None, _never_called) is None
