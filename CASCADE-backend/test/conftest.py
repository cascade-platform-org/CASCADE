"""Shared pytest fixtures for the CASCADE backend test suite."""
from __future__ import annotations

import pytest

from config import get_settings


@pytest.fixture(autouse=True)
def _clear_settings_cache() -> None:
    """Clear the get_settings() lru_cache before every test.

    get_settings() is cached so the Settings object is built once per process.
    Without this fixture, any test (or import-time side effect from importing
    main.py) that populates the cache poisons the environment for subsequent
    tests that monkeypatch env vars and call get_settings() expecting fresh
    values. The fixture runs automatically for every test in the suite.
    """
    get_settings.cache_clear()
