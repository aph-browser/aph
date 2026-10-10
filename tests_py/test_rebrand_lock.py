"""Rebrand lock guards: never patch omni.ja under a running browser.

Patching under a live instance leaves it on stale memory-mapped code
and corrupts the cache clear — the refetch/dev/quit loop. rebrand()
must refuse while either profile is locked (same quit-first contract
as the nuke recipes), and the asset build must not bump mtimes when
content is unchanged (phantom staleness would force needless rebrands).
"""

import contextlib
import os
from pathlib import Path

import scripts.aph_rebrand as aph_rebrand
import scripts.aph_rebrand.cache as cache
from scripts.build_assets import build


def _symlink_lock(profile: Path, pid: int) -> None:
    profile.mkdir(parents=True, exist_ok=True)
    with contextlib.suppress(OSError):
        (profile / "lock").unlink()
    os.symlink(f"127.0.0.1:+{pid}", profile / "lock")


def test_profile_lock_detects_live_pid(tmp_path: Path) -> None:
    profile = tmp_path / "profile"
    _symlink_lock(profile, os.getpid())
    assert cache._profile_locked(profile) is True


def test_profile_lock_ignores_dead_pid(tmp_path: Path) -> None:
    profile = tmp_path / "profile"
    _symlink_lock(profile, 2**30)  # no such process
    assert cache._profile_locked(profile) is False


def test_running_profiles_lists_held(tmp_path: Path, monkeypatch) -> None:
    held = tmp_path / "held"
    _symlink_lock(held, os.getpid())
    free = tmp_path / "free"
    free.mkdir()
    monkeypatch.setattr(cache, "PROFILE_DIR", held)
    monkeypatch.setattr(cache, "DAILY_PROFILE_DIR", free)
    assert cache.running_profiles() == [held]


def test_rebrand_refuses_when_locked(tmp_path: Path, monkeypatch, capsys) -> None:
    held = tmp_path / "held"
    monkeypatch.setattr(aph_rebrand, "running_profiles", lambda: [held])
    assert aph_rebrand.rebrand() is False
    assert "quit it first" in capsys.readouterr().out


def test_build_skips_unchanged() -> None:
    """Rebuilding with no source edits writes nothing (mtime-stable).

    Every write bumps mtime, and dev.py treats branding newer than
    omni.ja as a rebrand trigger — rewriting identical bytes would
    force a rebrand (and a -purgecaches launch) on every run.
    """
    from scripts.build_assets import BRANDING_DIR, BUNDLES

    build()  # settle: tree is up to date afterwards
    before = {b: (BRANDING_DIR / b).stat().st_mtime_ns for b in BUNDLES}
    assert build() == []
    after = {b: (BRANDING_DIR / b).stat().st_mtime_ns for b in BUNDLES}
    assert before == after, "identical rebuild must not touch mtimes"
