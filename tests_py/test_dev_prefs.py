"""Seed-once prefs: launchers must never overwrite an existing profile/user.js."""

import os
from pathlib import Path

import pytest

from scripts.dev import profile_locked, seed_user_js, sync_user_js


def _make_root(tmp_path: Path, user_js: str | None = 'user_pref("a.b", true);\n') -> Path:
    root = tmp_path / "root"
    (root / "config").mkdir(parents=True)
    if user_js is not None:
        (root / "config" / "user.js").write_text(user_js, encoding="utf-8")
    return root


def test_seed_creates_on_first_launch(tmp_path: Path) -> None:
    root = _make_root(tmp_path)
    profile = tmp_path / "profile"
    profile.mkdir()
    assert seed_user_js(root, profile) == "seeded"
    assert (profile / "user.js").read_text(encoding="utf-8") == 'user_pref("a.b", true);\n'


def test_seed_keeps_existing_user_edits(tmp_path: Path) -> None:
    root = _make_root(tmp_path)
    profile = tmp_path / "profile"
    profile.mkdir()
    custom = 'user_pref("a.b", false); // user changed this\n'
    (profile / "user.js").write_text(custom, encoding="utf-8")
    assert seed_user_js(root, profile) == "kept"
    assert (profile / "user.js").read_text(encoding="utf-8") == custom


def test_seed_missing_source(tmp_path: Path) -> None:
    root = _make_root(tmp_path, user_js=None)
    profile = tmp_path / "profile"
    profile.mkdir()
    assert seed_user_js(root, profile) == "missing-source"
    assert not (profile / "user.js").exists()


def test_sync_overwrites_with_backup(tmp_path: Path) -> None:
    root = _make_root(tmp_path)
    profile = tmp_path / "profile"
    profile.mkdir()
    old = 'user_pref("a.b", false);\n'
    (profile / "user.js").write_text(old, encoding="utf-8")
    sync_user_js(root, profile)
    assert (profile / "user.js").read_text(encoding="utf-8") == 'user_pref("a.b", true);\n'
    assert (profile / "user.js.bak").read_text(encoding="utf-8") == old


def _symlink_lock(profile: Path, pid: int) -> None:
    # Mirrors real Firefox lock targets: "<ip>:+<pid>" (cf. nuke-local parsing).
    try:
        os.symlink(f"127.0.0.1:+{pid}", profile / "lock")
    except OSError:
        pytest.skip("cannot create symlinks on this platform")


def test_profile_locked_live_pid(tmp_path: Path) -> None:
    profile = tmp_path / "profile"
    profile.mkdir()
    _symlink_lock(profile, os.getpid())
    assert profile_locked(profile) is True


def test_profile_unlocked_dead_pid(tmp_path: Path) -> None:
    profile = tmp_path / "profile"
    profile.mkdir()
    _symlink_lock(profile, 2**30)  # no such process
    assert profile_locked(profile) is False


def test_sync_refuses_while_running(tmp_path: Path) -> None:
    root = _make_root(tmp_path)
    profile = tmp_path / "profile"
    profile.mkdir()
    (profile / "user.js").write_text('user_pref("a.b", false);\n', encoding="utf-8")
    _symlink_lock(profile, os.getpid())
    with pytest.raises(SystemExit):
        sync_user_js(root, profile)
    # existing file untouched
    assert (profile / "user.js").read_text(encoding="utf-8") == 'user_pref("a.b", false);\n'
