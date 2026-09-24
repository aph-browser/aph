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


def test_collapsed_launcher_has_width_floor() -> None:
    """The collapsed strip once measured 0px wide (invisible, unhoverable,
    toggle-back dead) with every child reporting visible. A min-width floor
    on the collapsed launcher props it up; normal widths pass through."""
    css = _css()
    m = re.search(r"sidebar-main:not\(\[expanded\]\)\s*\{([^}]*)\}", css)
    assert m, "missing collapsed launcher floor rule"
    assert "min-width" in m.group(1), "floor must pin min-width"


def test_urlbar_themed_through_root_variables() -> None:
    """Urlbar internals are light-DOM children with classes, painted from
    stock variables — so focus border + text selection are themed via
    :root overrides. The shared accent sharpens the hover token with a
    hue-preserving saturation boost (red stays red, green stays green),
    never a hardcoded hue."""
    css = _css()
    head = css.find("14. URL-bar border + selection theme.")
    assert head != -1
    body = css[head : head + 2500]
    assert ":root" in body
    for var in (
        "--toolbar-field-border-color-focus",
        "--lwt-toolbar-field-highlight",
        "--urlbarview-background-color-selected",
    ):
        assert var in body, f"missing root override: {var}"
    assert "--toolbarbutton-background-color-hover" in body
    assert "hsl(" in body and "from" in body
    assert "calc(s *" in body


def test_unfocused_urlbar_border_stays_visible() -> None:
    """The field must stand out from the toolbar even unfocused: a
    class-based rule (never #ids — urlbar internals carry classes)
    paints the resting border from the shared sharpened accent (fully
    opaque). A translucent mix at 1px blends into its backdrop and
    reads as invisible, so transparent is banned here; focus uses the
    same accent through the variable above."""
    css = _css()
    sel = ".urlbar:not([focused]) .urlbar-background"
    assert sel in css, f"missing resting border rule: {sel}"
    body = css[css.find(sel) :]
    body = body[: body.find("}") + 1]
    assert "border-color: var(--aph-urlbar-accent)" in body
    assert "outline" not in body


def test_no_dead_urlbar_shadow_selectors() -> None:
    """Regression guard for the urlbar saga: its internals are light-DOM
    children of the moz-urlbar host but carry CLASSES, not ids
    (UrlbarInput #markup) — and a shadow boundary was wrongly blamed
    along the way. ID forms (#urlbar-background, #urlbar-input,
    #urlbar-input-container, focused-background children) parse fine
    and silently never match. Reach internals via classes, or theme the
    :root variables instead (see §14)."""
    css = _css()
    code = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
    for dead in (
        "#urlbar-background",
        "#urlbar-input",
        "#urlbar-input-container",
        "#urlbar[focused]",
    ):
        assert dead not in code, f"dead urlbar selector still present: {dead}"
    for live in (".urlbar-background", ".urlbar-input-container"):
        assert live in code, f"expected class selector missing: {live}"


def test_rounded_menus_present() -> None:
    """Rounded popups (§20): menupopup corners plus the panel variables
    so stock context menus, the dock's own menus, and arrow panels agree.
    Inner first/last-row radii keep hover backgrounds inside the corners;
    overflow clipping is banned (long menus keep their scrollbox)."""
    css = _css()
    for sel in (
        "menupopup {",
        "--panel-border-radius",
        "--arrowpanel-border-radius",
        "menupopup > menuitem:first-child",
        "menupopup > menuitem:last-child",
    ):
        assert sel in css, f"missing rounded-menu selector: {sel}"
    body = css[css.find("menupopup {") :]
    body = body[: body.find("}") + 1]
    assert "overflow" not in body
