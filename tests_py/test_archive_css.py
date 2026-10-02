"""Archive page chrome: branding/archive.css speaks the chrome system
(Inter, Aph radii, neutral desk surfaces, workspace pills) — never a
guest skin — plus hover easing and motion guards.
"""

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _css() -> str:
    return (ROOT / "branding" / "archive.css").read_text(encoding="utf-8")


def _theme_css() -> str:
    return (ROOT / "branding" / "theme.css").read_text(encoding="utf-8")


def _page_js() -> str:
    return (ROOT / "branding" / "archive-page.js").read_text(encoding="utf-8")


def test_archive_css_is_sane() -> None:
    css = _css()
    assert css.count("{") == css.count("}"), "unbalanced braces"
    assert css.count("/*") == css.count("*/"), "unbalanced comments"


def test_archive_hovers_ease_and_motion_guarded() -> None:
    """Motion language (§24 dialect): pills, rows, tags, and the delete
    reveal ease instead of snapping, and reduced-motion kills every
    transition including the toast's."""
    css = _css()
    # Base rules plus the motion block at the end (which owns the
    # transitions), so each selector must appear at least twice and a
    # transition must follow one of the occurrences.
    for sel in (".aph-archive-pill {", ".aph-archive-row {", ".aph-archive-del {"):
        first = css.find(sel)
        assert first != -1, sel
        second = css.find(sel, first + 1)
        assert second != -1, sel
        assert "transition" in css[second : second + 400], sel
    assert "prefers-reduced-motion" in css
    assert "#aph-archive-toast" in css and "transition: none" in css


def test_archive_drops_tokyo_night() -> None:
    """One product with the chrome: the old Tokyo-Night surfaces are gone
    (desk/elevated/raised + ink/muted take over), Inter ships in the
    page, and the Aph radius scale backs every corner. Danger red
    survives only as the delete signal (functional, not decorative)."""
    css = _css()
    for dead in (
        "#1a1b26",
        "#c0caf5",
        "#24283b",
        "#343a55",
        "#565f89",
        "#e6e8f5",
        "#ff2d55",
    ):
        assert dead not in css, f"guest-skin surface still present: {dead}"
    # The local --arch-* scale is gone: the page reads the shared tokens.
    for live in (
        "var(--aph-base)",
        "var(--aph-surface)",
        "var(--aph-field)",
        "var(--aph-ink)",
        "var(--aph-ink-dim)",
        "var(--aph-radius-md)",
        "var(--aph-radius-xl)",
    ):
        assert live in css, f"missing shared token read: {live}"
    assert "--arch-" not in re.sub(r"/\*.*?\*/", "", css, flags=re.S)
    assert css.count("@font-face {") == 4
    assert "aph-fonts/inter-" in css
    assert "var(--aph-danger)" in css


def test_archive_voice_parity() -> None:
    """The archive used to duplicate the nine workspace hues under its own
    --arch-ws-N names with this test holding the copies equal. It now reads
    the tokens.css table outright, so parity is structural — assert the
    page spends the shared hues and carries no local copy."""
    css = _css()
    for n in "123456789":
        assert f"var(--aph-ws-{n})" in css, n
    assert "--arch-ws-" not in css


def test_archive_pills_carry_workspace() -> None:
    """Workspace filter pills wear their own hue when active (dock
    parity): the page stamps data-ws at render (no bridge — the value
    IS the id), and the stylesheet spends the accent on .on pills."""
    js = _page_js()
    assert 'setAttribute("data-ws"' in js
    css = _css()
    assert ".aph-archive-pill[data-ws]" in css
    assert ".aph-archive-pill[data-ws].on" in css
    assert "--aph-ws-now" in css


def test_archive_stays_rtl_clean() -> None:
    """Count badge margins must mirror in RTL via logical props."""
    code = re.sub(r"/\*.*?\*/", "", _css(), flags=re.S)
    for banned in (
        "margin-left:",
        "margin-right:",
        "float: left",
        "float: right",
        "text-align: left",
        "text-align: right",
    ):
        assert banned not in code, f"physical direction prop leaked: {banned}"
