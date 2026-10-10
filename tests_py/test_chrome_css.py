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


def _stamp(css: str, version: int) -> str:
    return f"/* aph-seed-version: {version} */\n{css}"


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
    # Canvas ownership: the surface is Aph's (never lwt-accent), and menu
    # text is Aph ink — bg and fg change together so contrast can't drift
    # apart under vivid installed themes. No other bare text `color:`.
    assert "--lwt-accent-color" not in css
    assert "--aph-surface" in css
    bare_color = re.findall(r"(?m)^\s*color\s*:(.*)$", css)
    assert bare_color, "menu text ink went missing"
    for decl in bare_color:
        assert "var(--aph-ink" in decl, decl


def test_shipped_css_leaves_select_popups_native() -> None:
    """Web-content <select> dropdowns render as
    menulist#ContentSelectDropdown > menupopup in the same popupset, so
    every menupopup leg must exclude them (plus .in-menulist) — else the
    select popup on random webpages wears the Aph menu skin."""
    root = Path(__file__).resolve().parent.parent
    for name in ("branding/userChrome.css", "branding/theme.css"):
        css = (root / name).read_text(encoding="utf-8")
        code = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
        assert "#ContentSelectDropdown" in code, f"{name}: select exclusion went missing"
        assert ".in-menulist" in code, f"{name}: menulist exclusion went missing"
        found = 0
        for line in code.splitlines():
            for part in line.split(","):
                if "menupopup" not in part:
                    continue
                found += 1
                assert "#ContentSelectDropdown" in part, (
                    f"{name}: unguarded menupopup leg themes <select> popups: {part.strip()}"
                )
        assert found, f"{name}: no menupopup legs found"


def test_seed_migrates_on_version_bump(tmp_path: Path) -> None:
    """A newer bundled seed version backs the profile copy up to .bak and
    overwrites — this is how chrome fixes reach existing profiles."""
    root = _make_root(tmp_path, css=_stamp(CSS, 2))
    profile = tmp_path / "profile"
    (profile / "chrome").mkdir(parents=True)
    custom = _stamp("menupopup { background: green; } /* user */\n", 1)
    (profile / "chrome" / "userChrome.css").write_text(custom, encoding="utf-8")
    assert seed_chrome_css(root, profile) == "migrated"
    assert (profile / "chrome" / "userChrome.css").read_text(encoding="utf-8") == _stamp(CSS, 2)
    assert (profile / "chrome" / "userChrome.css.bak").read_text(encoding="utf-8") == custom


def test_seed_migrates_unstamped_to_stamped(tmp_path: Path) -> None:
    """Pre-scheme profile copies (no stamp = v0) migrate to the first
    stamped bundle exactly once, then hold."""
    root = _make_root(tmp_path, css=_stamp(CSS, 1))
    profile = tmp_path / "profile"
    (profile / "chrome").mkdir(parents=True)
    custom = "menupopup { background: green; } /* user */\n"
    (profile / "chrome" / "userChrome.css").write_text(custom, encoding="utf-8")
    assert seed_chrome_css(root, profile) == "migrated"
    assert seed_chrome_css(root, profile) == "kept"


def test_seed_keeps_same_version_user_edits(tmp_path: Path) -> None:
    """Same stamp both sides: user edits persist, no backup litter."""
    root = _make_root(tmp_path, css=_stamp(CSS, 1))
    profile = tmp_path / "profile"
    (profile / "chrome").mkdir(parents=True)
    custom = _stamp("menupopup { background: green; } /* user */\n", 1)
    (profile / "chrome" / "userChrome.css").write_text(custom, encoding="utf-8")
    assert seed_chrome_css(root, profile) == "kept"
    assert (profile / "chrome" / "userChrome.css").read_text(encoding="utf-8") == custom
    assert not (profile / "chrome" / "userChrome.css.bak").exists()


def test_seed_migrate_refuses_while_running(tmp_path: Path) -> None:
    """A due migration never overwrites under a live Firefox — it reports
    locked and retries on the next fresh launch."""
    root = _make_root(tmp_path, css=_stamp(CSS, 2))
    profile = tmp_path / "profile"
    (profile / "chrome").mkdir(parents=True)
    custom = _stamp("menupopup { background: green; } /* user */\n", 1)
    (profile / "chrome" / "userChrome.css").write_text(custom, encoding="utf-8")
    try:
        os.symlink(f"127.0.0.1:+{os.getpid()}", profile / "lock")
    except OSError:
        pytest.skip("cannot create symlinks on this platform")
    assert seed_chrome_css(root, profile) == "locked"
    assert (profile / "chrome" / "userChrome.css").read_text(encoding="utf-8") == custom
    assert not (profile / "chrome" / "userChrome.css.bak").exists()


def test_bundled_seed_stamps_match() -> None:
    """Both shipped seeds carry the same aph-seed-version stamp (bump both
    together — a lone bump would migrate one file and strand the other)."""
    root = Path(__file__).resolve().parent.parent
    versions = set()
    for name in ("branding/userChrome.css", "branding/userContent.css"):
        css = (root / name).read_text(encoding="utf-8")
        m = re.search(r"aph-seed-version:\s*(\d+)", css)
        assert m, f"{name}: seed stamp missing"
        assert css.index("aph-seed-version") < 200, f"{name}: stamp must ride the first line"
        versions.add(int(m.group(1)))
    assert len(versions) == 1, f"seed stamps diverged: {versions}"
    assert next(iter(versions)) >= 1


def test_seed_seeds_content_backdrop_alongside(tmp_path: Path) -> None:
    """seed_chrome_css also seeds userContent.css (new-tab backdrop) —
    still seed-once, still never overwrites user edits."""
    root = _make_root(tmp_path)
    (root / "branding" / "userContent.css").write_text("body { color: red; }\n", encoding="utf-8")
    profile = tmp_path / "profile"
    profile.mkdir()
    assert seed_chrome_css(root, profile) == "seeded"
    assert (profile / "chrome" / "userContent.css").read_text(
        encoding="utf-8"
    ) == "body { color: red; }\n"
    assert seed_chrome_css(root, profile) == "kept"


def test_shipped_content_css_is_sane() -> None:
    """The committed userContent.css targets only new-tab surfaces and
    never depends on the wallpaper feed."""
    root = Path(__file__).resolve().parent.parent
    css = (root / "branding" / "userContent.css").read_text(encoding="utf-8")
    assert css.count("{") == css.count("}"), "unbalanced braces"
    assert "@-moz-document" in css
    for page in ("about:newtab", "about:home", "about:blank"):
        assert page in css, page
    # Self-contained gradients only: no remote or chrome-url asset the
    # feed could withhold (@-moz-document url() selectors excepted).
    assert "url(http" not in css
    assert "url(chrome" not in css
    # Underlay stacking: the desk lives on html with body forced
    # transparent, so Activity Stream's wallpaper (body background-image)
    # covers it naturally when present — no observable wallpaper signal.
    assert "--newtab-wallpaper:" not in css
    assert "[style*=" not in css
    assert "html {" in css
    assert "background-color: transparent" in css


def test_content_css_has_no_unscoped_rules() -> None:
    """userContent.css applies to *every* web page Firefox loads: any style
    rule outside an @-moz-document block themes random webpages (the way
    unguarded menupopup rules once themed <select> popups from the chrome
    side). Walk the brace structure — every rule-opening brace must sit
    inside @-moz-document (directly or via the light-scheme @media)."""
    root = Path(__file__).resolve().parent.parent
    css = (root / "branding" / "userContent.css").read_text(encoding="utf-8")
    code = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
    stack: list[str] = []
    leaks: list[str] = []
    last_close = 0
    i, n = 0, len(code)
    while i < n:
        if code.startswith("@-moz-document", i):
            j = code.find("{", i)
            assert j != -1, "unterminated @-moz-document"
            stack.append("document")
            last_close = j + 1
            i = j + 1
            continue
        if code.startswith("@media", i):
            j = code.find("{", i)
            assert j != -1, "unterminated @media"
            stack.append("media")
            last_close = j + 1
            i = j + 1
            continue
        ch = code[i]
        if ch == "{":
            if "document" not in stack:
                leaks.append(code[last_close:i].strip().splitlines()[-1].strip())
            stack.append("rule")
        elif ch == "}":
            if stack:
                stack.pop()
            last_close = i + 1
        i += 1
    assert not leaks, f"unscoped userContent rules theme the whole web: {leaks}"
