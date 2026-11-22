"""
Session_API tests for choosing a Variant at session creation (bedside-exam task 4.1).

All fast: session_manager.PulseEngineWrapper is replaced by a fake engine class
(design D8), so no Pulse engine starts. The Variant_Source is replaced only through
main.app.dependency_overrides[main.get_variant_source] (Requirement 3.11), never by
patching a module global.

Validates Requirements 3.1-3.12, 3.15, 10.5, 14.8, 14.11.
"""
import copy
import math
import shutil
from fractions import Fraction
from pathlib import Path
from typing import Any, Dict, Iterator, List, Tuple

import pytest
import yaml
from fastapi.testclient import TestClient

import case_loader
import main
import session_manager
from case_loader import load_case_with_variants, load_resolved_case
from case_resolver import choose_variant
from test_insult_algorithm import FakeEngine

CASE_ID = "adult-tension-pneumothorax"
VARIANT_IDS = ["left", "right"]
NO_VARIANTS_ID = "no-variants-case"
SHIPPED_DIR: Path = case_loader.CASES_DIR


class StubSource:
    """Variant_Source stub from the design: returns queued values and counts reads."""

    def __init__(self, values): self.values, self.reads = list(values), 0

    def __call__(self) -> float:
        self.reads += 1
        return self.values.pop(0)


@pytest.fixture
def stub_source() -> Iterator[StubSource]:
    stub = StubSource([0.0])
    main.app.dependency_overrides[main.get_variant_source] = lambda: stub
    yield stub
    main.app.dependency_overrides.pop(main.get_variant_source, None)


@pytest.fixture
def engines(monkeypatch: pytest.MonkeyPatch) -> List[Tuple[str, Any]]:
    """Replace session_manager.PulseEngineWrapper with a fake; record every engine start."""
    starts: List[Tuple[str, Any]] = []

    class FakeWrapper(FakeEngine):
        def __init__(self, starting_state: Any = None) -> None:
            super().__init__()
            starts.append(("new", starting_state))

        @staticmethod
        def load_from_checkpoint(path: Path) -> "FakeWrapper":
            engine = FakeWrapper.__new__(FakeWrapper)
            FakeEngine.__init__(engine)
            starts.append(("load", Path(path)))
            return engine

    monkeypatch.setattr(session_manager, "PulseEngineWrapper", FakeWrapper)
    return starts


@pytest.fixture
def client(engines) -> Iterator[TestClient]:
    """A TestClient with the fake engine; deletes every Session the test created."""
    before = set(main.session_manager.sessions)
    with TestClient(main.app) as c:
        try:
            yield c
        finally:
            for sid in set(main.session_manager.sessions) - before:
                main.session_manager.delete_session(sid)


@pytest.fixture
def no_variants_case(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Dict[str, Any]:
    """Write the shipped case without `variants` to tmp_path and point CASES_DIR at it."""
    with open(SHIPPED_DIR / f"{CASE_ID}.yaml") as f:
        case = yaml.safe_load(f)
    del case["variants"]
    with open(tmp_path / f"{NO_VARIANTS_ID}.yaml", "w") as f:
        yaml.safe_dump(case, f, sort_keys=False, allow_unicode=True)
    shutil.copy(SHIPPED_DIR / "case-schema.json", tmp_path / "case-schema.json")
    monkeypatch.setattr(case_loader, "CASES_DIR", tmp_path)
    return case


def _session_count() -> int:
    return len(main.session_manager.sessions)


def _create(client: TestClient, body: Dict[str, Any]) -> Dict[str, Any]:
    resp = client.post("/sessions", json=body)
    assert resp.status_code == 200, resp.text
    return resp.json()


# --- Default selection with stub values (14.8) ------------------------------

N = len(VARIANT_IDS)
BOUNDARY_VALUES = sorted(
    {0.0, math.nextafter(1.0, 0.0)}
    | {k / N for k in range(1, N)}
    | {math.nextafter(k / N, 0.0) for k in range(1, N)}
)


@pytest.mark.parametrize("u", BOUNDARY_VALUES, ids=[repr(u) for u in BOUNDARY_VALUES])
def test_stub_value_selects_floor_u_times_n(client, stub_source, engines, u):
    stub_source.values = [u]
    expected = VARIANT_IDS[int(Fraction(u) * N)]  # exact floor(u × n)

    meta = _create(client, {"case_id": CASE_ID})

    assert meta["variant_id"] == expected
    assert stub_source.reads == 1
    assert engines == [("new", load_resolved_case(CASE_ID, expected)["engine"]["startingState"])]


@pytest.mark.parametrize("variant_id", VARIANT_IDS)
def test_named_variant_is_used_and_source_not_read(client, stub_source, variant_id):
    meta = _create(client, {"case_id": CASE_ID, "variant_id": variant_id})

    assert meta["variant_id"] == variant_id
    assert stub_source.reads == 0


def test_explicit_null_variant_id_reads_the_source(client, stub_source):
    stub_source.values = [0.5]
    meta = _create(client, {"case_id": CASE_ID, "variant_id": None})

    assert meta["variant_id"] == "right"
    assert stub_source.reads == 1


# --- Rejections: 400, 404, 422 (3.4, 3.5, 3.6) -------------------------------

def _assert_rejected(client, engines, body, status, detail=None):
    count = _session_count()
    resp = client.post("/sessions", json=body)
    assert resp.status_code == status, resp.text
    if detail is not None:
        assert resp.json()["detail"] == detail
    assert _session_count() == count
    assert engines == []


@pytest.mark.parametrize("variant_id", ["middle", "", "Left"])
def test_unknown_variant_id_returns_400(client, stub_source, engines, variant_id):
    _assert_rejected(
        client, engines, {"case_id": CASE_ID, "variant_id": variant_id}, 400,
        f"Unknown variant_id: '{variant_id}'. Valid variant ids: left, right",
    )
    assert stub_source.reads == 0


@pytest.mark.parametrize("variant_id", ["left", ""])
def test_variant_id_for_case_without_variants_returns_400(
    client, stub_source, engines, no_variants_case, variant_id
):
    _assert_rejected(
        client, engines, {"case_id": NO_VARIANTS_ID, "variant_id": variant_id}, 400,
        f"Case '{NO_VARIANTS_ID}' has no variants; omit variant_id or send null (got '{variant_id}')",
    )
    assert stub_source.reads == 0


@pytest.mark.parametrize("variant_id", [1, 0.5, ["left"], {"id": "left"}],
                         ids=["int", "float", "list", "object"])
def test_non_string_variant_id_returns_422(client, stub_source, engines, variant_id):
    _assert_rejected(client, engines, {"case_id": CASE_ID, "variant_id": variant_id}, 422)
    assert stub_source.reads == 0


@pytest.mark.parametrize("body_extra", [{}, {"variant_id": None}, {"variant_id": "left"},
                                        {"variant_id": "middle"}, {"variant_id": ""}],
                         ids=["omitted", "null", "left", "middle", "empty"])
def test_unknown_case_id_returns_404_whatever_the_variant_id(client, stub_source, engines, body_extra):
    _assert_rejected(
        client, engines, {"case_id": "no-such-case", **body_extra}, 404,
        "Case file not found: no-such-case",
    )
    assert stub_source.reads == 0


# --- Session_Metadata and a Case without Variants (3.9, 3.12) ----------------

def test_case_without_variants_has_null_variant_id_and_unchanged_base(
    client, stub_source, no_variants_case
):
    meta = _create(client, {"case_id": NO_VARIANTS_ID})
    sid = meta["session_id"]

    assert "variant_id" in meta and meta["variant_id"] is None
    got = client.get(f"/sessions/{sid}").json()
    assert "variant_id" in got and got["variant_id"] is None
    assert client.get(f"/sessions/{sid}/case").json() == no_variants_case
    assert main.session_manager.sessions[sid].variant_id is None
    assert stub_source.reads == 0


# --- Default source, no engine (14.11) ---------------------------------------

def test_default_source_selects_both_variants_in_200_picks(engines):
    ids = load_case_with_variants(CASE_ID).variant_ids
    picks = {choose_variant(CASE_ID, ids, None, main.get_variant_source()) for _ in range(200)}

    assert picks == set(VARIANT_IDS)
    assert engines == []


# --- Property 6 ---------------------------------------------------------------

# Feature: bedside-exam, Property 6: The Variant stays fixed for the life of the Session
@pytest.mark.parametrize(
    "body_extra,stub_values",
    [({}, [u]) for u in BOUNDARY_VALUES] + [({"variant_id": v}, []) for v in VARIANT_IDS],
    ids=[f"stub-{u!r}" for u in BOUNDARY_VALUES] + [f"named-{v}" for v in VARIANT_IDS],
)
def test_variant_stays_fixed_for_the_life_of_the_session(client, stub_source, body_extra, stub_values):
    """**Validates: Requirements 3.7, 3.8, 3.9, 3.10**"""
    stub_source.values = list(stub_values)
    meta = _create(client, {"case_id": CASE_ID, **body_extra})
    sid, variant_id = meta["session_id"], meta["variant_id"]
    expected_case = load_resolved_case(CASE_ID, variant_id)

    assert client.get(f"/sessions/{sid}").json()["variant_id"] == variant_id

    first = client.get(f"/sessions/{sid}/case").json()
    second = client.get(f"/sessions/{sid}/case").json()
    assert first == second == expected_case
    assert "variants" not in first

    session = main.session_manager.sessions[sid]
    assert session.scheduled_insults == expected_case["timeline"]["scheduledInsults"]

    branch_id = meta["current_branch_id"]
    checkpoints = client.get(f"/sessions/{sid}/branches/{branch_id}/checkpoints").json()
    resp = client.post(f"/sessions/{sid}/fork", json={"checkpoint_id": checkpoints[0]["checkpoint_id"]})
    assert resp.status_code == 200, resp.text

    after = client.get(f"/sessions/{sid}").json()
    assert after["variant_id"] == variant_id
    assert len(after["branches"]) == 2
    assert client.get(f"/sessions/{sid}/case").json() == expected_case
    assert session.scheduled_insults == expected_case["timeline"]["scheduledInsults"]
    assert stub_source.reads == (1 if "variant_id" not in body_extra else 0)
