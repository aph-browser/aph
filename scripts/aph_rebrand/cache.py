"""Profile cache clearing so branding changes show immediately."""

from __future__ import annotations

import shutil
from pathlib import Path

from .constants import PROFILE_DIR, ROOT

DAILY_PROFILE_DIR = Path.home() / ".config" / "aph" / "profile"

_CACHE_SUBDIRS = ("startupCache", "cache2", "shader-cache")
_FAVICON_FILES = ("favicons.sqlite", "favicons.sqlite-wal", "favicons.sqlite-shm")


def _display(p: Path) -> str:
    try:
        return str(p.relative_to(ROOT))
    except ValueError:
        return str(p)


def _profile_locked(profile: Path) -> bool:
    """True if a running Firefox holds this profile (same check as
    scripts/dev.py and the nuke recipes: a ``lock`` symlink whose pid
    is alive). Local copy so the rebrand package never imports the
    launcher (direct-script entry must keep working)."""
    import os

    lock = profile / "lock"
    try:
        if not lock.is_symlink():
            return False
        target = os.readlink(lock)  # e.g. "127.0.0.1:+12345"
        pid = target.rsplit(":", 1)[-1].lstrip("+")
        if not pid.isdigit():
            return False
        os.kill(int(pid), 0)
        return True
    except (OSError, ValueError):
        return False


def running_profiles() -> list[Path]:
    """Repo + daily profiles currently held by a running Firefox."""
    return [p for p in (PROFILE_DIR, DAILY_PROFILE_DIR) if _profile_locked(p)]


def _clear_one(profile: Path) -> None:
    if not profile.is_dir():
        return

    # Clear Gecko startup caches
    for sub in _CACHE_SUBDIRS:
        p = profile / sub
        if p.exists():
            shutil.rmtree(p, ignore_errors=True)
            print(f"Cleared {_display(p)}")

    # Clear SQLite favicon cache (CRUCIAL for sidebar tab icon!)
    for fav in _FAVICON_FILES:
        p = profile / fav
        if p.exists():
            p.unlink(missing_ok=True)
            print(f"Cleared favicon cache: {fav} ({_display(profile)})")

    marker = profile / ".purgecache_done"
    if marker.exists():
        marker.unlink(missing_ok=True)


def clear_startup_cache() -> None:
    """Clear profile caches and favicon database so branding changes show immediately.

    Covers the repo dev profile AND the daily profile: both run the same
    omni.ja, and a stale startupCache in either one keeps executing the
    previous build's compiled chrome (same-version omni swaps don't
    invalidate it). Dropping .purgecache_done makes the next launch on
    that profile pass -purgecaches (see scripts/dev.py). A running
    instance keeps old code in memory regardless — quit Aph first.
    """
    _clear_one(PROFILE_DIR)
    _clear_one(DAILY_PROFILE_DIR)
