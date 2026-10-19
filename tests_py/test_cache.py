"""Rebrand cache clearing must cover both profiles.

Dev (./profile) and daily (~/.config/aph/profile) run the same omni.ja;
a stale startupCache in either one keeps executing the previous build's
compiled chrome, so `just rebrand` must purge both (regression: Ctrl+W
park worked in dev but daily kept running pre-park code).

Deleting under a RUNNING instance is forbidden: its files are recreated
under us and an empty favicons.sqlite left on the path then fails the
whole Places init on the next launch ("database is locked"; daily
regression 2026-10-18) — held profiles only lose their purge marker so
the next launch purges in-process. The launcher additionally heals a
leftover 0-byte favicons.sqlite on an idle profile.
"""

import os
from pathlib import Path

import pytest

from scripts.aph_rebrand import cache as cache_mod


def _seed(profile: Path) -> None:
    (profile / "startupCache").mkdir(parents=True)
    (profile / "startupCache" / "script.bin").write_text("stale", encoding="utf-8")
    (profile / "cache2").mkdir(parents=True, exist_ok=True)
    (profile / "favicons.sqlite").write_text("stale", encoding="utf-8")
    (profile / "prefs.js").write_text("// user data", encoding="utf-8")
    (profile / ".purgecache_done").write_text("", encoding="utf-8")


def _lock(profile: Path, pid: int = 0) -> None:
    profile.mkdir(parents=True, exist_ok=True)
    if (profile / "lock").is_symlink():
        os.unlink(profile / "lock")
    os.symlink(f"127.0.0.1:+{pid or os.getpid()}", profile / "lock")


def test_clears_both_profiles(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    repo = tmp_path / "profile"
    daily = tmp_path / "daily"
    _seed(repo)
    _seed(daily)
    monkeypatch.setattr(cache_mod, "PROFILE_DIR", repo)
    monkeypatch.setattr(cache_mod, "DAILY_PROFILE_DIR", daily)
    cache_mod.clear_startup_cache()
    for profile in (repo, daily):
        assert not (profile / "startupCache").exists()
        assert not (profile / "cache2").exists()
        assert not (profile / "favicons.sqlite").exists()
        assert not (profile / ".purgecache_done").exists()
        assert (profile / "prefs.js").is_file(), "user data must survive"


def test_missing_profile_is_skipped(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    repo = tmp_path / "profile"
    _seed(repo)
    monkeypatch.setattr(cache_mod, "PROFILE_DIR", repo)
    monkeypatch.setattr(cache_mod, "DAILY_PROFILE_DIR", tmp_path / "no-such-daily")
    cache_mod.clear_startup_cache()  # must not raise
    assert not (repo / "startupCache").exists()
    assert (repo / "prefs.js").is_file()


def test_in_use_profile_keeps_files_but_purges_next_launch(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys
) -> None:
    """A profile held by a running Firefox is never written to.

    Its caches stay (the running instance would recreate them — and the
    favicons deletion under it once left a 0-byte favicons.sqlite that
    failed the next launch's whole Places init); only the purge marker
    drops, so the next launch purges in-process. The idle profile is
    still fully cleared.
    """
    repo = tmp_path / "profile"
    daily = tmp_path / "daily"
    _seed(repo)
    _seed(daily)
    _lock(daily)  # daily is running
    monkeypatch.setattr(cache_mod, "PROFILE_DIR", repo)
    monkeypatch.setattr(cache_mod, "DAILY_PROFILE_DIR", daily)
    cache_mod.clear_startup_cache()

    # idle repo: full clear, marker gone (-> -purgecaches next launch)
    assert not (repo / "startupCache").exists()
    assert not (repo / "cache2").exists()
    assert not (repo / "favicons.sqlite").exists()
    assert not (repo / ".purgecache_done").exists()
    assert (repo / "prefs.js").is_file()

    # held daily: files untouched, marker dropped
    assert (daily / "startupCache").is_dir()
    assert (daily / "favicons.sqlite").is_file(), "never delete under a running instance"
    assert (daily / "prefs.js").is_file()
    assert not (daily / ".purgecache_done").exists(), "marker drop forces -purgecaches"
    assert "in use" in capsys.readouterr().out


def test_stale_lock_does_not_block_clear(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """A lock symlink whose pid is dead is not an in-use profile."""
    repo = tmp_path / "profile"
    _seed(repo)
    _lock(repo, pid=2**30)  # no such process
    monkeypatch.setattr(cache_mod, "PROFILE_DIR", repo)
    monkeypatch.setattr(cache_mod, "DAILY_PROFILE_DIR", tmp_path / "no-such-daily")
    cache_mod.clear_startup_cache()
    assert not (repo / "startupCache").exists()
    assert not (repo / "favicons.sqlite").exists()


def test_zero_byte_favicons_healed(tmp_path: Path) -> None:
    """The poison state disappears, stale companions go with it."""
    profile = tmp_path / "profile"
    profile.mkdir()
    (profile / "favicons.sqlite").write_text("", encoding="utf-8")
    (profile / "favicons.sqlite-shm").write_bytes(b"x" * 64)
    assert cache_mod.drop_zero_byte_favicons(profile) is True
    assert not (profile / "favicons.sqlite").exists()
    assert not (profile / "favicons.sqlite-shm").exists()


def test_healthy_favicons_left_alone(tmp_path: Path) -> None:
    """A real database (and its 0-byte running-state wal) must survive."""
    profile = tmp_path / "profile"
    profile.mkdir()
    (profile / "favicons.sqlite").write_bytes(b"x" * 64)
    (profile / "favicons.sqlite-wal").write_text("", encoding="utf-8")
    assert cache_mod.drop_zero_byte_favicons(profile) is False
    assert (profile / "favicons.sqlite").is_file()
    assert (profile / "favicons.sqlite-wal").is_file()


def test_zero_byte_favicons_skipped_while_locked(tmp_path: Path) -> None:
    profile = tmp_path / "profile"
    _lock(profile)
    (profile / "favicons.sqlite").write_text("", encoding="utf-8")
    assert cache_mod.drop_zero_byte_favicons(profile) is False
    assert (profile / "favicons.sqlite").is_file()


def test_wipe_favicons_removes_trio_when_idle(tmp_path: Path) -> None:
    profile = tmp_path / "profile"
    profile.mkdir()
    (profile / "favicons.sqlite").write_bytes(b"x" * 64)
    (profile / "favicons.sqlite-wal").write_bytes(b"y" * 10)
    assert cache_mod.wipe_favicons(profile) is True
    assert not (profile / "favicons.sqlite").exists()
    assert not (profile / "favicons.sqlite-wal").exists()


def test_wipe_favicons_skipped_while_locked(tmp_path: Path) -> None:
    profile = tmp_path / "profile"
    _lock(profile)
    (profile / "favicons.sqlite").write_bytes(b"x" * 64)
    assert cache_mod.wipe_favicons(profile) is False
    assert (profile / "favicons.sqlite").is_file()
