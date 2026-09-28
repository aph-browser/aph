"""Lookout bot: version compare never crashes, pin rewrite is exact.

Covers scripts/lookout.py without touching the network or the real
scripts/fetch.py (check() itself queries Mozilla, so only the pure
pieces are tested here).
"""

from pathlib import Path

from scripts.lookout import _write_outputs, bump_version, latest_is_newer, parse_version


def test_parse_version_numeric() -> None:
    assert parse_version("156.0.1") == (156, 0, 1)
    assert parse_version("156.0") == (156, 0)


def test_parse_version_garbage_is_none() -> None:
    assert parse_version("") is None
    assert parse_version("next-tuesday") is None
    assert parse_version("156.0b1") is None


def test_newer_detection() -> None:
    assert latest_is_newer("156.0.1", "156.0")
    assert latest_is_newer("157.0", "156.0.1")
    assert not latest_is_newer("156.0.1", "156.0.1")
    assert not latest_is_newer("156.0", "156.0.1")
    assert not latest_is_newer("garbage", "156.0")
    assert not latest_is_newer("156.0.1", "garbage")


def _write_fetch(root: Path, version: str) -> Path:
    target = root / "scripts" / "fetch.py"
    target.parent.mkdir(parents=True)
    target.write_text(
        f'#!/usr/bin/env python3\nVERSION = "{version}"\nOTHER = 1\n', encoding="utf-8"
    )
    return target


def test_bump_rewrites_pin_only(tmp_path: Path) -> None:
    target = _write_fetch(tmp_path, "156.0")
    assert bump_version(tmp_path, "156.0.1") is True
    text = target.read_text(encoding="utf-8")
    assert 'VERSION = "156.0.1"' in text
    assert "OTHER = 1" in text


def test_bump_is_idempotent(tmp_path: Path) -> None:
    _write_fetch(tmp_path, "156.0.1")
    assert bump_version(tmp_path, "156.0.1") is False


def test_bump_missing_file_is_false(tmp_path: Path) -> None:
    assert bump_version(tmp_path, "156.0.1") is False


def test_bump_missing_pin_line_is_false(tmp_path: Path) -> None:
    target = tmp_path / "scripts" / "fetch.py"
    target.parent.mkdir(parents=True)
    target.write_text("VERSIONX = 1\n", encoding="utf-8")
    assert bump_version(tmp_path, "156.0.1") is False


def test_write_outputs_to_github_output(tmp_path: Path, monkeypatch) -> None:
    out = tmp_path / "ghout"
    monkeypatch.setenv("GITHUB_OUTPUT", str(out))
    _write_outputs("156.0.1", "156.0", True)
    text = out.read_text(encoding="utf-8")
    assert "latest=156.0.1" in text
    assert "pinned=156.0" in text
    assert "update_available=true" in text
