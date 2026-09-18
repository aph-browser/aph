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


def test_tree_rails_present() -> None:
    """Indented tabs draw Tree Style Tab guides via injected rail elements:
    one inner rail (L1), inner + outer ancestor rail (L2). Real elements,
    not pseudos — pseudo boxes don't generate on XUL tab elements."""
    css = _css()
    for sel in (
        ".aph-tree-rail--inner",
        ".aph-tree-rail--outer",
    ):
        assert sel in css, f"missing tree rail selector: {sel}"


def test_tree_rails_scoped_to_vertical_strip() -> None:
    """Rails must never paint in the horizontal strip: every rail rule
    that reveals or positions rails is scoped under #vertical-tabs
    (hide-by-default and collapsed-dots hide rules are exempt)."""
    css = _css()
    code = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
    for m in re.finditer(r"([^{}]*\.aph-tree-rail[^{}]*)\{([^{}]*)\}", code):
        selectors, body = m.group(1), m.group(2)
        if "display: none" in body:
            continue
        for sel in selectors.split(","):
            sel = sel.strip()
            if not sel:
                continue
            assert "#vertical-tabs" in sel, f"unscoped rail selector: {sel}"


def test_tree_rails_are_paint_only() -> None:
    """Rails live in the margin gutter as hit-test-transparent nodes:
    absolute, 1px, pointer-events none — never layout, never clickable.
    Stock tabs clip painted overflow, so indented tabs widen the clip
    margin to let the gutter rails paint."""
    css = _css()
    head = css.find("Indent rails: vertical")
    assert head != -1
    body = css[head : head + 3200]
    assert "position: absolute" in body
    assert "width: 1px" in body
    assert "pointer-events: none" in body
    assert ".aph-tree-rail--inner" in body
    assert "inset-inline-start" in body
    assert "overflow-clip-margin" in body


def test_tree_indent_yields_to_stock_drag_positioning() -> None:
    """Indented tabs must not fight stock's drag positioning: stock pins
    the dragged tab with .tabbrowser-tab[dragtarget]
    { position: absolute !important } and steers it via an inline `top`
    measured for absolute positioning. Our relative tab positioning is
    more specific and would win mid-drag, turning that inline `top` into
    a relative offset that parks the tab ~its strip offset below the
    cursor. Every rule putting position:relative on an indented tab must
    therefore exclude the stock drag state."""
    css = _css()
    code = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
    found = False
    for m in re.finditer(r"([^{}]+)\{([^{}]*)\}", code):
        selectors, body = m.group(1), m.group(2)
        if "position: relative" not in body:
            continue
        if "data-aph-level" not in selectors:
            continue
        for sel in selectors.split(","):
            sel = sel.strip()
            if "data-aph-level" in sel:
                found = True
                assert ":not([dragtarget])" in sel, f"indent positioning fights stock drag: {sel}"
    assert found, "indented-tab positioning rule vanished"


def test_tree_rails_hidden_while_dragged() -> None:
    """Rails anchor to the tab via its position:relative; mid-drag that
    containing block is yielded to stock (see above), so rails must hide
    for the flight or they re-anchor to a foreign ancestor and streak
    under the cursor. Hiding is pure CSS on [dragtarget], so nothing can
    stick hidden after drop."""
    css = _css()
    code = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
    assert re.search(r"\[dragtarget\][^{]*\.aph-tree-rail[^}]*display:\s*none", code, re.S), (
        "missing mid-drag rail hide rule"
    )


def test_tree_group_indent_stacks_on_stock_group_margin() -> None:
    """Stock indents every <tab-group> member by --space-medium (≈12px) in
    the expanded vertical strip — exactly our L1 step. Our !important L1
    margin would merely replace stock's and render grouped L0/L1
    pixel-identical (first child looks un-indented). Grouped L1/L2 must
    therefore add their step ON TOP of the stock token, with a pinned
    fallback so a missing token degrades to the same ladder, never 0."""
    css = _css()
    code = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
    l1 = re.search(
        r"tab-group\s*>\s*[^{]*\[data-aph-level=\"1\"\][^{]*\{([^}]*)\}",
        code,
    )
    assert l1, "missing grouped-L1 stacking rule"
    assert re.search(
        r"margin-inline-start:\s*calc\(\s*var\(--space-medium,\s*12px\)\s*\+\s*12px\s*\)",
        l1.group(1),
    ), f"grouped L1 must stack 12px on the stock token, got: {l1.group(1).strip()}"
    l2 = re.search(
        r"tab-group\s*>\s*[^{]*\[data-aph-level=\"2\"\][^{]*\{([^}]*)\}",
        code,
    )
    assert l2, "missing grouped-L2 stacking rule"
    assert re.search(
        r"margin-inline-start:\s*calc\(\s*var\(--space-medium,\s*12px\)\s*\+\s*24px\s*\)",
        l2.group(1),
    ), f"grouped L2 must stack 24px on the stock token, got: {l2.group(1).strip()}"


def test_tree_group_line_stays_straight_under_indents() -> None:
    """Stock draws the group line as one .tab-group-line piece per member
    tab anchored at the tab's own inline-start edge. Our stacked grouped
    margins would carry each indented tab's piece right by the tree step,
    kinking the line into a zigzag. Grouped L1/L2 must counter-shift their
    piece by exactly their tree step (-12px/-24px) so every piece stays on
    the group offset. Scoped to the expanded strip (sidebar-main[expanded])
    so collapsed dots keep the stock piece offset, and to #vertical-tabs
    so the horizontal strip is untouched."""
    css = _css()
    code = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
    for level, shift in (("1", "-12px"), ("2", "-24px")):
        m = re.search(
            r"([^{}]*tab-group\s*>[^{}]*\[data-aph-level=\""
            + level
            + r"\"\][^{}]*\.tab-group-line[^{}]*)\{([^}]*)\}",
            code,
        )
        assert m, f"missing grouped-L{level} group-line straightening rule"
        selectors, body = m.group(1), m.group(2)
        assert "#vertical-tabs" in selectors, f"unscoped line rule: {selectors}"
        assert "sidebar-main[expanded]" in selectors, (
            f"line rule must be expanded-only (collapsed keeps stock offset): {selectors}"
        )
        assert re.search(
            r"inset-inline-start:\s*" + re.escape(shift) + r"\s*!important",
            body,
        ), f"grouped L{level} line must counter-shift {shift}, got: {body.strip()}"


def test_tree_group_indent_zeroed_when_collapsed() -> None:
    """The stacking rules out-specify the base collapsed zeroing (extra
    tab-group type), so grouped L1/L2 need their own dots-only zeroing,
    scoped tighter and placed later."""
    css = _css()
    code = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
    stacking = code.find("tab-group > tab[data-aph-level")
    assert stacking != -1
    m = re.search(
        r"#sidebar-container\s+sidebar-main:not\(\[expanded\]\)[^{]*"
        r"tab-group\s*>[^{]*\[data-aph-level=\"[12]\"\][^{]*\{([^}]*)\}",
        code,
    )
    assert m, "missing collapsed grouped-level zeroing rule"
    assert "margin-inline-start: 0" in m.group(1)
    assert code.find(m.group(0)) > stacking, "collapsed zeroing must come after stacking"


def test_tree_rails_hidden_when_collapsed() -> None:
    """Collapsed sidebar-main shows dots with zero indent: rails would clip
    like the twisty/counts, so they must hide there too."""
    css = _css()
    head = css.find("twisty, counts, and rails would")
    assert head != -1
    body = css[head : head + 1200]
    assert "sidebar-main:not([expanded])" in body
    assert ".aph-tree-rail" in body
    assert "display: none" in body


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
