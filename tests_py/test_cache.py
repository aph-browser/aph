"""Rebrand cache clearing must cover both profiles.

Dev (./profile) and daily (~/.config/aph/profile) run the same omni.ja;
a stale startupCache in either one keeps executing the previous build's
compiled chrome, so `just rebrand` must purge both (regression: Ctrl+W
park worked in dev but daily kept running pre-park code).
"""

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
