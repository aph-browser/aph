"""Aph nav-bar theme: branding/theme.css stays parseable and keeps its
download-activity carve-out.

The theme auto-hides every nav-bar button at idle; the
#downloads-button:is([progress], [attention]) rule is the only exception
that lets download progress and the panel anchor show. If it is removed
or neutered, downloads start with zero UI and Firefox logs
"Downloads button cannot be found".
"""

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CARVE_OUT = "#downloads-button:is([progress], [attention])"


def _css() -> str:
    return (ROOT / "branding" / "theme.css").read_text(encoding="utf-8")


def test_theme_css_is_sane() -> None:
    css = _css()
    assert css.count("{") == css.count("}"), "unbalanced braces"
    assert css.count("/*") == css.count("*/"), "unbalanced comments"


def test_download_activity_carve_out_present() -> None:
    css = _css()
    assert CARVE_OUT in css
    body = css[css.find(CARVE_OUT) : css.find(CARVE_OUT) + 600]
    assert "visibility: visible" in body
    assert "opacity: 1" in body


def test_carve_out_comes_after_hide_rules() -> None:
    """Later + !important beats the §3 hide rules on equal specificity."""
    css = _css()
    assert css.find("Negative Margins at Idle") < css.find(CARVE_OUT)


def test_carve_out_uses_visibility_not_display() -> None:
    """display:none would collapse the panel anchor's box; visibility keeps it."""
    css = _css()
    body = css[css.find(CARVE_OUT) : css.find(CARVE_OUT) + 600]
    assert not re.search(r"(?m)^\s*display\s*:", body)


def test_workspace_dock_selectors_present() -> None:
    """The sidebar dock (65-dock.js) needs its container, pills, drop
    highlight and collapsed-dots rules."""
    css = _css()
    for sel in (
        "#aph-ws-dock",
        ".aph-ws-pill",
        ".aph-ws-pill.drop-target",
        "sidebar-main:not([expanded])",
    ):
        assert sel in css, f"missing dock selector: {sel}"


def test_dock_stacks_vertically() -> None:
    """#vertical-tabs is a horizontal box by default: without an explicit
    vertical stack the dock squeezes in beside the tab list."""
    css = _css()
    body = css[css.find("#vertical-tabs {") : css.find("#aph-ws-dock {")]
    assert "vertical" in body and "column" in body
