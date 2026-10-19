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


def _remove_favicons(profile: Path, *, zero_byte_only: bool = False) -> list[str]:
    """Unlink the favicons trio; returns the files actually removed.

    With zero_byte_only (launcher self-heal), nothing is touched unless the
    main favicons.sqlite exists and is 0 bytes — the state a process leaves
    behind when its files are deleted while it runs, and the single file
    state that makes Firefox's whole Places init fail on the next launch
    (history/bookmarks misreported as "database is locked", because a LOCKED
    status never reaches the corruption-recovery path).
    """
    main = profile / "favicons.sqlite"
    if zero_byte_only and not (main.is_file() and main.stat().st_size == 0):
        return []
    removed: list[str] = []
    for fav in _FAVICON_FILES:
        p = profile / fav
        if p.is_file():
            p.unlink(missing_ok=True)
            removed.append(fav)
    return removed


def drop_zero_byte_favicons(profile: Path) -> bool:
    """Launcher self-heal: remove a leftover 0-byte favicons.sqlite.

    The file is 0 bytes (no data), so removal costs nothing and Firefox
    rebuilds the cache on open. Skips while Firefox holds the profile —
    deleting under it is what creates the poison in the first place.
    """
    if not profile.is_dir() or _profile_locked(profile):
        return False
    removed = _remove_favicons(profile, zero_byte_only=True)
    if removed:
        print(
            f"Removed 0-byte favicons cache (Places init poison): "
            f"{', '.join(removed)} ({_display(profile)})"
        )
    return bool(removed)


def wipe_favicons(profile: Path) -> bool:
    """Remove the whole favicons trio from an idle profile (rebuilt on open).

    Safe slot for the rebrand-time favicon refresh: only ever runs when no
    running Firefox holds this profile.
    """
    if not profile.is_dir() or _profile_locked(profile):
        return False
    removed = _remove_favicons(profile)
    if removed:
        print(f"Cleared favicon cache: {', '.join(removed)} ({_display(profile)})")
    return bool(removed)


def _clear_one(profile: Path) -> None:
    if not profile.is_dir():
        return
    if _profile_locked(profile):
        # Deleting files out from under a running instance poisons its
        # NEXT launch (2026-10-18 daily regression): the process keeps its
        # open inodes, and SQLite later recreates an empty favicons.sqlite
        # on the path (Places maintenance re-attaches by name). Skip the
        # file deletions; drop only the purge marker (a launcher-only
        # file), so the next launch passes -purgecaches — Firefox's own
        # in-process purge is the safe counterpart while it runs.
        marker = profile / ".purgecache_done"
        if marker.exists():
            marker.unlink(missing_ok=True)
            print(f"Marked {_display(profile)} for -purgecaches (profile in use)")
        return

    # Clear Gecko startup caches
    for sub in _CACHE_SUBDIRS:
        p = profile / sub
        if p.exists():
            shutil.rmtree(p, ignore_errors=True)
            print(f"Cleared {_display(p)}")

    # Clear SQLite favicon cache (CRUCIAL for sidebar tab icon!)
    for fav in _remove_favicons(profile):
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
    Profiles a running Firefox holds are left untouched: deleting under
    it is what once left a 0-byte favicons.sqlite on the path that
    poisoned the next launch. Only their purge marker drops, so the next
    launch purges in-process via -purgecaches.
    """
    _clear_one(PROFILE_DIR)
    _clear_one(DAILY_PROFILE_DIR)
