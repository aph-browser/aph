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
    for live in (
        "--arch-bg",
        "--arch-surface",
        "--arch-raised",
        "--arch-text",
        "--arch-muted",
        "--arch-radius-md",
        "--arch-radius-xl",
    ):
        assert live in css, f"missing chrome-system token: {live}"
    assert css.count("@font-face {") == 4
    assert "aph-fonts/inter-" in css
    assert "--arch-danger" in css


def test_archive_voice_parity() -> None:
    """The archive is a separate document (no theme.css cascade), so its
    workspace hue table is duplicated by design — and pinned equal to
    theme.css §21. A hue change must land in both files together."""
    theme_hues = dict(re.findall(r"--aph-ws-([1-9]):\s*(#[0-9a-fA-F]{6})", _theme_css()))
    arch_hues = dict(re.findall(r"--arch-ws-([1-9]):\s*(#[0-9a-fA-F]{6})", _css()))
    assert len(theme_hues) == 9 and len(arch_hues) == 9
    for n in "123456789":
        assert arch_hues[n].lower() == theme_hues[n].lower(), (
            f"ws{n} diverged: archive {arch_hues[n]} vs chrome {theme_hues[n]}"
        )


def test_archive_pills_carry_workspace() -> None:
    """Workspace filter pills wear their own hue when active (dock
    parity): the page stamps data-ws at render (no bridge — the value
    IS the id), and the stylesheet spends the accent on .on pills."""
    js = _page_js()
    assert 'setAttribute("data-ws"' in js
    css = _css()
    assert ".aph-archive-pill[data-ws]" in css
    assert ".aph-archive-pill[data-ws].on" in css
    assert "--arch-ws-accent" in css
