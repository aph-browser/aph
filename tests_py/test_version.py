"""pyproject.toml is the single source of truth for the Aph version."""

from scripts.sync_version import sync
from scripts.version import get_version


def test_version_parses() -> None:
    v = get_version()
    assert v.count(".") == 2, v
    assert all(part.isdigit() for part in v.split(".")), v


def test_derived_files_in_sync() -> None:
    assert sync(apply=False) == [], "run `just sync-version` after bumping pyproject"
