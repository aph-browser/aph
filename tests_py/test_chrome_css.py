"""Seed-once menu accents: branding/userChrome.css into profile/chrome/.

Mirrors test_dev_prefs.py: launchers must never overwrite an existing
profile/chrome/userChrome.css, and sync must refuse while Firefox runs.
"""

import os
import re
from pathlib import Path

import pytest

from scripts.dev import seed_chrome_css, sync_chrome_css

CSS = "menupopup { background: red; }\n"


def _make_root(tmp_path: Path, css: str | None = CSS) -> Path:
    root = tmp_path / "root"
    (root / "branding").mkdir(parents=True)
    if css is not None:
        (root / "branding" / "userChrome.css").write_text(css, encoding="utf-8")
    return root


def test_seed_creates_chrome_dir_on_first_launch(tmp_path: Path) -> None:
    root = _make_root(tmp_path)
    profile = tmp_path / "profile"
    profile.mkdir()
    assert seed_chrome_css(root, profile) == "seeded"
    assert (profile / "chrome" / "userChrome.css").read_text(encoding="utf-8") == CSS


def test_seed_keeps_existing_user_edits(tmp_path: Path) -> None:
    root = _make_root(tmp_path)
    profile = tmp_path / "profile"
    (profile / "chrome").mkdir(parents=True)
    custom = "menupopup { background: green; } /* user */\n"
    (profile / "chrome" / "userChrome.css").write_text(custom, encoding="utf-8")
    assert seed_chrome_css(root, profile) == "kept"
    assert (profile / "chrome" / "userChrome.css").read_text(encoding="utf-8") == custom


def test_seed_missing_source(tmp_path: Path) -> None:
    root = _make_root(tmp_path, css=None)
    profile = tmp_path / "profile"
    profile.mkdir()
    assert seed_chrome_css(root, profile) == "missing-source"
    assert not (profile / "chrome" / "userChrome.css").exists()


def test_sync_overwrites_with_backup(tmp_path: Path) -> None:
    root = _make_root(tmp_path)
    profile = tmp_path / "profile"
    (profile / "chrome").mkdir(parents=True)
    old = "menupopup { background: green; }\n"
    (profile / "chrome" / "userChrome.css").write_text(old, encoding="utf-8")
    sync_chrome_css(root, profile)
    assert (profile / "chrome" / "userChrome.css").read_text(encoding="utf-8") == CSS
    assert (profile / "chrome" / "userChrome.css.bak").read_text(encoding="utf-8") == old


def test_sync_refuses_while_running(tmp_path: Path) -> None:
    root = _make_root(tmp_path)
    profile = tmp_path / "profile"
    (profile / "chrome").mkdir(parents=True)
    (profile / "chrome" / "userChrome.css").write_text("old\n", encoding="utf-8")
    try:
        os.symlink(f"127.0.0.1:+{os.getpid()}", profile / "lock")
    except OSError:
        pytest.skip("cannot create symlinks on this platform")
    with pytest.raises(SystemExit):
        sync_chrome_css(root, profile)
    assert (profile / "chrome" / "userChrome.css").read_text(encoding="utf-8") == "old\n"


def test_shipped_css_is_sane() -> None:
    """The committed userChrome.css must stay parseable and on-mission."""
    root = Path(__file__).resolve().parent.parent
    css = (root / "branding" / "userChrome.css").read_text(encoding="utf-8")
    assert css.count("{") == css.count("}"), "unbalanced braces"
    assert css.count("/*") == css.count("*/"), "unbalanced comments"
    assert "menupopup" in css and "panelview" in css
    # Menu surface is painted on the ::part(content) shadow part, not just
    # the host (toolkit popup.css) — both must be covered.
    assert "part(content)" in css
    # Hover must use a variable Sun actually defines (button hover gold),
    # not the highlight var Sun leaves unset (renders as plain blue).
    assert "--toolbarbutton-background-color-hover" in css
    # Accent touches only: surfaces may be redefined via variables, but no
    # rule may set a bare text `color:` (menus keep stock text).
    bare_color = re.findall(r"(?m)^\s*color\s*:", css)
    assert not bare_color, bare_color
