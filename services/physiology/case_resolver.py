"""Case_Resolver: resolve, check and pick side Variants of a Case.

Pure functions only. No function reads files, the clock, the environment or
randomness; the Variant_Source is passed in by the caller.
"""
import bisect
import copy
from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Literal, Mapping, Optional, Sequence, Tuple

import jsonschema

OVERRIDE_KEYS: Tuple[str, ...] = ("insultSide", "requiredInterventions", "hints", "sideRevealText")
TENSION_PNEUMOTHORAX_ACTION = "SETensionPneumothorax"


@dataclass(frozen=True)
class CaseProblem:
    document: Literal["base", "resolved"]   # where `path` points
    path: str                               # dotted field path, "(root)" for the whole document
    message: str
    variant_id: Optional[str] = None        # set for every problem that belongs to one Variant

    def __str__(self) -> str:
        if self.document == "resolved":
            where = f"resolved case of variant '{self.variant_id}'"
        elif self.variant_id is not None:
            where = f"base case (variant '{self.variant_id}')"
        else:
            where = "base case"
        return f"{where} at {self.path}: {self.message}"


class CaseVariantError(ValueError):
    """Raised by resolve_all; `problems` holds every problem, str() joins them with '; '."""

    problems: Tuple[CaseProblem, ...]

    def __init__(self, problems: Sequence[CaseProblem]) -> None:
        self.problems = tuple(problems)
        super().__init__("; ".join(str(p) for p in self.problems))


class VariantSelectionError(ValueError):
    """A create request named a variant_id that the Case cannot accept (HTTP 400)."""


def _dotted(path: Sequence[Any]) -> str:
    dotted = ".".join(str(p) for p in path)
    return dotted if dotted else "(root)"


def _schema_problems(
    document: Mapping[str, Any],
    schema: Mapping[str, Any],
    kind: Literal["base", "resolved"],
    resolved_variant_id: Optional[str] = None,
) -> List[CaseProblem]:
    errors = sorted(
        jsonschema.Draft7Validator(schema).iter_errors(document),
        key=lambda e: _dotted(e.absolute_path),
    )
    problems = []
    for error in errors:
        variant_id = resolved_variant_id
        if kind == "base":
            variant_id = _base_error_variant_id(document, list(error.absolute_path))
        problems.append(CaseProblem(kind, _dotted(error.absolute_path), error.message, variant_id))
    return problems


def _base_error_variant_id(base: Mapping[str, Any], path: List[Any]) -> Optional[str]:
    if len(path) < 2 or path[0] != "variants" or not isinstance(path[1], int):
        return None
    variants = base.get("variants")
    if not isinstance(variants, list) or not 0 <= path[1] < len(variants):
        return None
    item = variants[path[1]]
    if isinstance(item, Mapping) and isinstance(item.get("id"), str):
        return item["id"]
    return None


def _tension_insults(document: Mapping[str, Any]) -> List[Any]:
    timeline = document.get("timeline")
    if not isinstance(timeline, Mapping):
        return []
    insults = timeline.get("scheduledInsults")
    if not isinstance(insults, list):
        return []
    return [
        insult for insult in insults
        if isinstance(insult, Mapping) and insult.get("action") == TENSION_PNEUMOTHORAX_ACTION
    ]


def resolve_variant(base: Mapping[str, Any], variant: Mapping[str, Any]) -> Dict[str, Any]:
    """Return a deep copy of `base` without `variants`, with the Variant's overrides applied."""
    resolved = copy.deepcopy(dict(base))
    resolved.pop("variants", None)
    for key, value in variant["overrides"].items():
        if key == "insultSide":
            for insult in _tension_insults(resolved):
                insult.setdefault("parameters", {})["side"] = copy.deepcopy(value)
        elif key == "requiredInterventions":
            rescued = resolved["play"].setdefault("endings", {}).setdefault("rescued", {})
            rescued["requiredInterventions"] = copy.deepcopy(value)
        elif key == "hints":
            resolved["play"]["hints"] = copy.deepcopy(value)
        elif key == "sideRevealText":
            resolved["play"]["sideRevealText"] = copy.deepcopy(value)
    return resolved


def check_case(base: Mapping[str, Any], schema: Optional[Mapping[str, Any]]) -> List[CaseProblem]:
    """Return every problem of the Base_Case and its Variants (steps 1 to 7 of the design)."""
    # 1. Schema on the Base_Case.
    problems: List[CaseProblem] = []
    if schema is not None:
        problems = _schema_problems(base, schema, "base")
    # 2. No Variants.
    if problems or "variants" not in base:
        return problems

    # 3. Variant shape.
    variants = base["variants"]
    if not isinstance(variants, list):
        return [CaseProblem("base", "variants", "variants must be a list")]
    for i, variant in enumerate(variants):
        if not isinstance(variant, Mapping):
            problems.append(CaseProblem("base", f"variants.{i}", "variant must be an object"))
            continue
        variant_id = variant.get("id") if isinstance(variant.get("id"), str) else None
        if variant_id is None:
            problems.append(CaseProblem("base", f"variants.{i}.id", "variant id must be a string"))
        if not isinstance(variant.get("overrides"), Mapping):
            problems.append(CaseProblem(
                "base", f"variants.{i}.overrides", "variant overrides must be an object", variant_id,
            ))
    if problems:
        return problems

    # 4. Unique ids.
    first_index: Dict[str, int] = {}
    for i, variant in enumerate(variants):
        variant_id = variant["id"]
        if variant_id in first_index:
            problems.append(CaseProblem(
                "base",
                f"variants.{i}.id",
                f"duplicate variant id '{variant_id}' (first used at variants.{first_index[variant_id]}.id)",
                variant_id,
            ))
        else:
            first_index[variant_id] = i
    if problems:
        return problems

    # 5. Allowed keys.
    allowed = ", ".join(OVERRIDE_KEYS)
    for i, variant in enumerate(variants):
        for key in variant["overrides"]:
            if key not in OVERRIDE_KEYS:
                problems.append(CaseProblem(
                    "base",
                    f"variants.{i}.overrides.{key}",
                    f"unknown override key '{key}'; allowed keys: {allowed}",
                    variant["id"],
                ))
    if problems:
        return problems

    # 6. Targets exist.
    has_tension_insult = bool(_tension_insults(base))
    has_play = isinstance(base.get("play"), Mapping)
    for i, variant in enumerate(variants):
        for key in variant["overrides"]:
            if key == "insultSide" and not has_tension_insult:
                reason = f"the base case has no scheduled insult with action {TENSION_PNEUMOTHORAX_ACTION}"
            elif key != "insultSide" and not has_play:
                reason = "the base case has no play section"
            else:
                continue
            problems.append(CaseProblem(
                "base",
                f"variants.{i}.overrides.{key}",
                f"override '{key}' has no target: {reason}",
                variant["id"],
            ))
    if problems:
        return problems

    # 7. Resolve each Variant and validate each Resolved_Case.
    if schema is not None:
        for variant in variants:
            resolved = resolve_variant(base, variant)
            problems.extend(_schema_problems(resolved, schema, "resolved", variant["id"]))
    return problems


def resolve_all(base: Mapping[str, Any], schema: Optional[Mapping[str, Any]]) -> Dict[str, Dict[str, Any]]:
    """Return {variant_id: Resolved_Case} in Case_Definition order, or {} without Variants."""
    problems = check_case(base, schema)
    if problems:
        raise CaseVariantError(problems)
    if "variants" not in base:
        return {}
    return {variant["id"]: resolve_variant(base, variant) for variant in base["variants"]}


def variant_index(u: float, n: int) -> int:
    """Index of the Variant whose interval [k/n, (k+1)/n) holds `u` (design D5)."""
    if not (n >= 1 and 0 <= u < 1):
        raise ValueError(f"variant_index needs n >= 1 and 0 <= u < 1 (got u={u!r}, n={n!r})")
    return bisect.bisect_right([k / n for k in range(1, n)], u)


def choose_variant(
    case_id: str,
    variant_ids: Sequence[str],
    requested: Optional[str],
    source: Callable[[], float],
) -> Optional[str]:
    """Pick the Variant_Id for a create request (design table of five rows)."""
    ids = list(variant_ids)
    if requested is None:
        if not ids:
            return None
        return ids[variant_index(source(), len(ids))]
    if not ids:
        raise VariantSelectionError(
            f"Case '{case_id}' has no variants; omit variant_id or send null (got '{requested}')"
        )
    if requested in ids:
        return requested
    raise VariantSelectionError(
        f"Unknown variant_id: '{requested}'. Valid variant ids: {', '.join(ids)}"
    )
