"""Tests for physiology service configuration validation.

Validates: Requirements 2.12, 7.14, 10.15
"""
import pytest
from pydantic import ValidationError

from config import Settings

ENV_VARS = (
    "MAX_CHECKPOINTS_PER_BRANCH",
    "SESSION_IDLE_TIMEOUT",
    "SESSION_CREATION_TIMEOUT",
)


@pytest.fixture(autouse=True)
def clear_config_env(monkeypatch):
    """Ensure host/container environment does not leak into these tests."""
    for name in ENV_VARS:
        monkeypatch.delenv(name, raising=False)


def make_settings(**kwargs) -> Settings:
    # _env_file=None so a local .env cannot affect results
    return Settings(_env_file=None, **kwargs)


def test_defaults():
    s = make_settings()
    assert s.max_checkpoints_per_branch == 100
    assert s.session_idle_timeout == 3600
    assert s.session_creation_timeout == 30


def test_old_idle_timeout_name_removed():
    assert "idle_session_timeout_seconds" not in Settings.model_fields


@pytest.mark.parametrize("value", [10, 11, 100, 999, 1000])
def test_max_checkpoints_accepts_in_range(value):
    assert make_settings(max_checkpoints_per_branch=value).max_checkpoints_per_branch == value


@pytest.mark.parametrize("value", [9, 1001, 0, -1])
def test_max_checkpoints_rejects_out_of_range(value):
    with pytest.raises(ValidationError):
        make_settings(max_checkpoints_per_branch=value)


@pytest.mark.parametrize("field", ["session_idle_timeout", "session_creation_timeout"])
@pytest.mark.parametrize("value", [1, 2, 60, 86400])
def test_timeouts_accept_positive(field, value):
    assert getattr(make_settings(**{field: value}), field) == value


@pytest.mark.parametrize("field", ["session_idle_timeout", "session_creation_timeout"])
@pytest.mark.parametrize("value", [0, -1, -3600])
def test_timeouts_reject_non_positive(field, value):
    with pytest.raises(ValidationError):
        make_settings(**{field: value})


def test_reads_values_from_env(monkeypatch):
    monkeypatch.setenv("MAX_CHECKPOINTS_PER_BRANCH", "250")
    monkeypatch.setenv("SESSION_IDLE_TIMEOUT", "2")
    monkeypatch.setenv("SESSION_CREATION_TIMEOUT", "45")
    s = make_settings()
    assert s.max_checkpoints_per_branch == 250
    assert s.session_idle_timeout == 2
    assert s.session_creation_timeout == 45


@pytest.mark.parametrize(
    "name,value",
    [
        ("MAX_CHECKPOINTS_PER_BRANCH", "9"),
        ("MAX_CHECKPOINTS_PER_BRANCH", "1001"),
        ("SESSION_IDLE_TIMEOUT", "0"),
        ("SESSION_CREATION_TIMEOUT", "-5"),
    ],
)
def test_rejects_invalid_env_values(monkeypatch, name, value):
    monkeypatch.setenv(name, value)
    with pytest.raises(ValidationError):
        make_settings()
