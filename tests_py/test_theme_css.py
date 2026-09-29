"""Aph nav-bar theme: branding/theme.css stays parseable and keeps its
download-activity carve-out.

The theme dims (never hides) secondary buttons at idle while keeping
essentials (back/forward/reload/home + hamburger) at full ink; the
#downloads-button:is([progress], [attention]) rule lifts download progress
and the panel anchor to full ink. Layout never moves — stable footprint,
opacity-only.
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


def test_stock_nova_gradient_border_is_killed() -> None:
    """Stock Nova paints the active tab a 1px violet->orange gradient ring
    (tabs.css: `border: 1px solid transparent` + `background-clip: border-box`
    + `background: var(--tab-border-color-accent) border-box border-area`, where
    the token is a hardcoded 96deg violet-30 -> orange-30 gradient). Aph setting
    `background-color` never reset those `background-image` layers, so the ring
    drew over our hairline. It is gated on `:root[theme-in-app]`, so it came and
    went with theme state and read as a random, mostly-orange border.

    The selected-tab rule must therefore clear background-image, and the busy
    sweep must re-set it afterwards so loading tabs keep their sheen."""
    css = _css()
    sel = ".tabbrowser-tab[selected] > .tab-stack > .tab-background"
    head = css.find(sel)
    assert head != -1, "selected-tab rule missing"
    body = css[head : css.find("}", head)]
    assert "background-image: none" in body, (
        "stock Nova's violet->orange gradient ring must be cleared on the "
        "active tab — background-color alone does not reset background-image"
    )
    assert "border-color: transparent" in body, (
        "active tab must not keep a themed border color under the hairline"
    )
    # The §13 busy sweep repaints background-image; it has to come AFTER the
    # clearing rule or it would be wiped along with the gradient.
    busy = css.find("[selected][busy] > .tab-stack > .tab-background")
    assert busy != -1, "busy sweep rule missing"
    assert busy > head, "busy sweep must follow the background-image reset"
    assert "background-image: linear-gradient" in css[busy : css.find("}", busy)]


def test_hairline_is_one_shared_token() -> None:
    """§13 selected tab and §19 content card share a single ring value. They
    were two hand-picked alphas (tab 12%, card 10%) that drifted, and the card
    stacked a second inset top highlight so its top edge composited to ~22%
    while its sides were 10%. One token, one alpha, no doubled edge."""
    css = _css()
    assert "--aph-hairline:" in css, "hairline token must be defined on :root"
    # Both surfaces must read the token, not a private literal. Match with a
    # regex: the formatter wraps `var(\n    --aph-hairline,\n    ...)` across
    # lines whenever the inline fallback is long.
    for sel in (
        ".tabbrowser-tab[selected] > .tab-stack > .tab-background",
        "#tabbrowser-tabbox {",
    ):
        head = css.find(sel)
        assert head != -1, f"{sel} missing"
        assert re.search(r"var\(\s*--aph-hairline", css[head : css.find("}", head)]), (
            f"{sel} must consume --aph-hairline"
        )
    # The card no longer doubles its own top edge.
    card = css.find("#tabbrowser-tabbox {")
    assert card != -1
    assert "inset 0 1px 0" not in css[card : css.find("}", css.find("}", card) + 1)], (
        "card must not stack an inset top highlight on its own ring"
    )
    # Stamped workspaces tint the ring; alpha stays put (12% total) so the
    # edge gains hue without gaining weight.
    m = re.search(r":root\[data-aph-ws\][^{]*\{([^}]*--aph-hairline[^}]*)\}", css)
    assert m, "stamped workspaces must define a tinted hairline"
    assert "var(--aph-ws-accent)" in m.group(1)


def test_themed_tab_outline_cannot_paint_aph_surfaces() -> None:
    """A lightweight theme repaints the active tab through
    `--tab-selected-outline-color`. tabs.css, under `&[lwtheme]`, sets it to
    `var(--lwt-tab-line-color, currentColor)`; `.tab-background` consumes that
    as `outline-color` at `outline-offset: -1px` — a 1px outline drawn just
    inside the tab, in the theme's `tab_line` color. Aph set only box-shadow
    and never outline-color, so the ring survived every Aph repaint and wore
    the theme's hue (nova-sun ships tab_line #f3a81e — pure orange) on every
    workspace, since a theme token is not workspace-scoped.

    Aph owns its surfaces (see the canvas-face and menu-skin contracts), so
    the selected tab must clear outline-color. Transparent, not `none`: the
    1px geometry stays and outline never affects layout, so nothing shifts."""
    css = _css()
    sel = ".tabbrowser-tab[selected] > .tab-stack > .tab-background"
    head = css.find(sel)
    assert head != -1, "selected-tab rule missing"
    body = css[head : css.find("}", head)]
    assert "outline-color: transparent" in body, (
        "active tab must clear the themed --tab-selected-outline-color; "
        "otherwise the installed theme's tab_line draws a competing ring"
    )
    # --lwt-tab-line-color must never be *consumed* anywhere in the theme.
    # Comments are stripped first: the rule's own comment names the token to
    # explain why it is being overridden.
    code = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
    assert "--lwt-tab-line-color" not in code, (
        "theme must not read the lightweight-theme tab_line token"
    )


def test_content_separators_are_aph_owned() -> None:
    """Stock threads `--chrome-content-separator-color` through every
    structural edge of the content area — .browserContainer's block-start /
    inline-start / inline-end borders, the sidebar border, assorted
    block-end rules — and browser-colors.css defines it as
    `var(--card-border-color)`, i.e. theme-owned. Under a lightweight theme
    that token carries the theme's hue (nova-sun), which is why a border
    appeared around the content only outside fullscreen; stock drops the
    separators when the content covers the window.

    Aph must repoint the token at its own hairline so no consumer can be
    theme-colored, and must drop the content's block-start edge specifically:
    the card ring already draws that boundary a pixel outboard, so leaving
    it stacks a second hairline flush against the first."""
    css = _css()
    assert "--chrome-content-separator-color" in css, "theme must claim the content separator token"
    m = re.search(r"--chrome-content-separator-color\s*:\s*([^;]+);", css)
    assert m, "separator token must be assigned"
    assert "var(--aph-hairline)" in m.group(1), (
        f"separator must read --aph-hairline, got {m.group(1)!r}"
    )
    # !important: the stock declaration is equal-specificity on :root.
    tail = css[m.start() : css.find(";", m.start()) + 1]
    assert "!important" in tail, "equal-specificity :root declarations need !important to win"
    head = css.find("#tabbrowser-tabpanels > :not(.split-view-panel) .browserContainer")
    assert head != -1, "browserContainer separator rule missing"
    body = css[head : css.find("}", head)]
    assert "border-block-start-color: transparent" in body, (
        "content top edge must not double against the card ring"
    )
    # The inline edges are the only divider between sidebar and content
    # (Aph draws none) — they must survive, so only block-start is cleared.
    assert "border-inline-start-color" not in body
    assert "border-inline-end-color" not in body


def test_workspace_accent_has_a_root_default() -> None:
    """`--aph-ws-accent` is only defined per-workspace, and both stamp paths
    guard on `isValidId`. Unstamped, every `var(--aph-ws-accent, ...)` consumer
    fell back to a hardcoded rgb(125,190,255) — a blue outside the nine
    workspace stops. The root default must resolve to an in-palette stop so the
    off-palette blue is unreachable."""
    css = _css()
    m = re.search(r":root\s*\{[^}]*--aph-ws-accent\s*:\s*([^;]+);", css, re.S)
    assert m, "--aph-ws-accent needs a :root default"
    default = m.group(1).strip()
    assert "var(--aph-ws-" in default, f"root default must name a palette stop, got {default!r}"
    stop = re.search(r"var\((--aph-ws-\d+)\)", default).group(1)
    assert f"{stop}:" in css, f"{stop} must be defined on :root"
    assert stop != "--aph-ws-accent", "default must not self-reference"


def test_carve_out_comes_after_hide_rules() -> None:
    """Later + !important beats the §3 dim rules on equal specificity."""
    css = _css()
    assert css.find("Stable Dim Tiers") < css.find(CARVE_OUT)


def test_bar_never_moves_layout() -> None:
    """Stable footprint: no negative-margin collapse, no urlbar expand.
    Dim is opacity-only; footprint identical at idle/hover/open."""
    css = _css()
    assert "margin-inline-start: -34px" not in css
    assert "margin-inline-end: -34px" not in css
    assert "margin-inline-end: -38px" not in css
    assert "max-width: none" not in css
    assert "--aph-secondary-opacity:" in css


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
        ".aph-dock-aph svg",
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
    """Urlbar internals are light-DOM children with classes: focus border
    reads the shared sharpened voice accent, and text selection reads
    the Aph select token (which redefines the stock highlight var so
    native selection follows). Hue-preserving saturation boost on the
    accent — never a hardcoded hue."""
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
    assert "--aph-voice" in body
    assert "hsl(" in body and "from" in body
    assert "calc(s *" in body
    assert "calc(s * 1.15)" in body, "focus ring keeps near-voice saturation, never neon"


def test_unfocused_urlbar_border_stays_quiet() -> None:
    """Calm rest: an empty field gets no glowing edge. A class-based
    rule (never #ids — urlbar internals carry classes) keeps the
    resting border transparent; separation comes from the field fill.
    The sharpened accent arrives on focus through
    --toolbar-field-border-color-focus (see §14 root block)."""
    css = _css()
    sel = ".urlbar:not([focused]) .urlbar-background"
    assert sel in css, f"missing resting border rule: {sel}"
    body = css[css.find(sel) :]
    body = body[: body.find("}") + 1]
    assert "border-color: transparent" in body
    assert "var(--aph-urlbar-accent)" not in body
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


def test_tab_dialogs_survive_card_clip() -> None:
    """Tab-modal dialogs live inside #tabbrowser-tabbox (TabDialogBox
    appends the stack to the tab container), so the §19 card clip would
    slice the buttons off any dialog taller than the tab area. The guard
    constrains dialog content to fit with internal scroll instead."""
    css = _css()
    sel = "#tabbrowser-tabbox .dialogStack .dialogBox"
    assert sel in css, "missing tab-dialog guard rule"
    body = css[css.find(sel) :]
    body = body[: body.find("}") + 1]
    assert "max-height" in body
    assert "overflow" in body and "auto" in body


def test_desk_has_depth_and_adaptive_shadow() -> None:
    """Canvas desk (§19): layered sheen + vignette over the flat base
    (never sticker-flat), and the card shadow adapts to desk brightness
    behind a supports gate so engines without relative colors keep the
    fixed fallback."""
    css = _css()
    head = css.find("#browser {")
    assert head != -1
    body = css[head : head + 800]
    assert "linear-gradient" in body
    assert "color-mix" in body
    assert "@supports" in css and "rgb(from" in css


def test_workspace_accents_cover_all_nine() -> None:
    """Per-workspace accents (§21): all nine workspaces define an accent,
    consumed by the three presence surfaces — selected fill (§13),
    indicator, dock current — never as text. The desk keeps a subtle
    4% accent kiss (§19 sheen) for orientation without changing the
    room's white balance. The selected tab's hairline DOES carry the
    accent (--aph-hairline, §13) — it may tint the edge, but never grow
    past hairline weight, and never replace the fill as the signal."""
    css = _css()
    for n in "123456789":
        assert f"--aph-ws-{n}:" in css, f"missing accent var for ws{n}"
        assert f':root[data-aph-ws="{n}"]' in css
    assert "--aph-ws-accent:" in css
    assert ":root[data-aph-ws] #aph-ws-indicator" in css
    assert '.aph-ws-pill[data-ws][data-current="1"]' in css
    # A per-workspace RULE may not repaint the selected tab's background or
    # outline — the fill token owns that. The hairline tint is allowed to
    # live in :root[data-aph-ws] (it does, via --aph-hairline).
    assert ":root[data-aph-ws] .tabbrowser-tab[selected]" not in css, (
        "no per-workspace rule may repaint the selected tab — the §13 "
        "fill token owns its background"
    )
    m = re.search(r":root\[data-aph-ws\][^{]*\{[^}]*--aph-desk-sheen\s*:\s*([^;]+);", css)
    assert m, "desk sheen must be defined for stamped workspaces"
    # Subtle only: 4% accent kiss, never a repaint.
    assert "var(--aph-ws-accent)" in m.group(1)
    pct = re.search(r"(\d+(?:\.\d+)?)\s*%", m.group(1))
    assert pct and float(pct.group(1)) <= 5, (
        f"desk sheen must stay subtle (<=5%), got {m.group(1)!r}"
    )


def test_chrome_type_is_inter() -> None:
    """Chrome type (§23): Inter @font-face for 400/500/600/700 reaches the
    injected woff2 files, and :root applies the stack document-wide."""
    css = _css()
    assert css.count("@font-face {") == 4
    for w in ("400", "500", "600", "700"):
        # Full chrome URL: chrome://browser/content/ already maps to
        # browser/content/browser/ — an extra browser/ segment 404s at
        # runtime ("Missing chrome or resource URL").
        assert f"chrome://browser/content/aph-fonts/inter-{w}-latin.woff2" in css
        assert f"font-weight: {w};" in css
    assert "content/browser/aph-fonts" not in css
    assert "--aph-font-chrome:" in css
    assert "font-family: var(--aph-font-chrome)" in css


def test_motion_language_glides_hovers_dissolves_and_guards() -> None:
    """Motion language (§24): tab wash + dock ease both ways, the card
    dip dissolve, accent load feedback (burst tint + busy sweep), and a
    reduced-motion mirror that also covers the toast."""
    css = _css()
    assert "aph-ws-dip" in css
    assert "aph-busy-sweep" in css
    assert "--tab-loading-fill" in css
    assert "prefers-reduced-motion" in css
    assert "#aph-toast" in css and "transition: none" in css


def test_urlbar_dropdown_speaks_palette() -> None:
    """Dropdown as palette sibling (§25): wash hover/selected tokens, md
    row radius, selected inset accent border (never layout), 14px titles,
    icon wash tiles — all behind a forced-colors guard so High Contrast
    keeps stock rendering."""
    css = _css()
    assert "--urlbarview-background-color-hover" in css
    assert "--urlbarView-row-border-radius" in css
    assert ".urlbarView-row[selected]" in css
    assert ".urlbarView-title" in css
    assert ".urlbarView-favicon" in css
    assert "@media not (forced-colors)" in css


def test_toolbar_rhythm_unified() -> None:
    """Toolbar rhythm (§26 + §6): the indicator pill matches the 28px
    urlbar height, and nav-bar buttons share the md hover corners."""
    css = _css()
    head = css.find("#aph-ws-indicator {")
    assert head != -1
    assert "height: 28px" in css[head : head + 900]
    assert "#nav-bar toolbarbutton:hover" in css


def _hex_to_rgb(h: str) -> tuple:
    h = h.lstrip("#")
    return tuple(int(h[i : i + 2], 16) for i in (0, 2, 4))


def _srgb_mix(a: tuple, b: tuple, t: float) -> tuple:
    """color-mix(in srgb, …) interpolates gamma-encoded channels."""
    return tuple(round(x * t + y * (1 - t)) for x, y in zip(a, b, strict=True))


def _rel_luminance(c: tuple) -> float:
    def f(v: float) -> float:
        v /= 255
        return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4

    r, g, b = (f(v) for v in c)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def _contrast(fg: tuple, bg: tuple) -> float:
    l1, l2 = sorted((_rel_luminance(fg), _rel_luminance(bg)), reverse=True)
    return (l1 + 0.05) / (l2 + 0.05)


# Canonical presence faces: accent fills composited over each.
# Reconcile against Sun's live toolbar colors on a real build if they
# ever drift (dark base ≈ Sun-dark desk, light base ≈ Sun-light cream).
_PRESENCE_FACES = {
    "dark": ("#1c1d26", "#e8e8ec"),
    "light": ("#f6f1e3", "#23252f"),
}
_PRESENCE_MIN_CONTRAST = 4.5
# Role spends, mirroring the CSS: pill presence 45% (indicator, dock
# current), tab presence 35% (selected fill — large area, less spend),
# hover 30% (tabs, pills, menus, Aph key).
_ROLE_SPENDS = {"presence": 0.45, "presence-tab": 0.35, "hover": 0.30}


def _workspace_hues(css: str) -> dict:
    hues = {
        m.group(1): m.group(2) for m in re.finditer(r"--aph-ws-([1-9]):\s*(#[0-9a-fA-F]{6})", css)
    }
    assert len(hues) == 9, f"expected 9 workspace hues, found {len(hues)}"
    return hues


def test_workspace_presence_contrast() -> None:
    """Presence contrast gate (§13/§21): toolbar ink over the 45% accent
    fill must hit 4.5:1 for every hue on both faces. A failing hue gets
    muted — never hand-tuned around."""
    css = _css()
    hues = _workspace_hues(css)
    for n in sorted(hues):
        for face, (base, ink) in _PRESENCE_FACES.items():
            fill = _srgb_mix(_hex_to_rgb(hues[n]), _hex_to_rgb(base), _ROLE_SPENDS["presence"])
            ratio = _contrast(_hex_to_rgb(ink), fill)
            assert ratio >= _PRESENCE_MIN_CONTRAST, (
                f"ws{n} {hues[n]} on {face}: {ratio:.2f}:1 < "
                f"{_PRESENCE_MIN_CONTRAST}:1 — mute the hue"
            )


def test_workspace_tab_contrast() -> None:
    """Selected-tab contrast gate (§13): toolbar ink over the quieter 35%
    tab fill must hit 4.5:1 for every hue on both faces. Lower spend can
    only raise contrast versus the pill gate, so this guards the floor
    if the tab spend ever moves independently."""
    css = _css()
    hues = _workspace_hues(css)
    for n in sorted(hues):
        for face, (base, ink) in _PRESENCE_FACES.items():
            fill = _srgb_mix(_hex_to_rgb(hues[n]), _hex_to_rgb(base), _ROLE_SPENDS["presence-tab"])
            ratio = _contrast(_hex_to_rgb(ink), fill)
            assert ratio >= _PRESENCE_MIN_CONTRAST, (
                f"ws{n} {hues[n]} tab on {face}: {ratio:.2f}:1 < "
                f"{_PRESENCE_MIN_CONTRAST}:1 — mute the hue"
            )


def test_selected_fill_spends_less_than_pills() -> None:
    """The large tab surface must spend strictly less accent than the
    small pill surfaces (indicator §6, dock current §21) — presence
    hierarchy by area. Reads the live spends from the CSS."""
    css = _css()
    code = re.sub(r"/\*.*?\*/", "", css, flags=re.S)

    def spend_after(anchor: str) -> float:
        head = code.find(anchor)
        assert head != -1, f"anchor missing: {anchor}"
        m = re.search(
            r"color-mix\(\s*in srgb,\s*var\(--aph-ws-accent[^)]*\)\s*([\d.]+)%",
            code[head : head + 600],
        )
        assert m, f"no accent spend after {anchor}"
        return float(m.group(1)) / 100

    tab = spend_after(".tabbrowser-tab[selected] > .tab-stack > .tab-background")
    pill = spend_after(":root[data-aph-ws] #aph-ws-indicator {")
    assert tab < pill, f"tab {tab} must spend less than pill {pill}"
    assert tab == _ROLE_SPENDS["presence-tab"], "tab spend drifted from the gate"
    assert pill == _ROLE_SPENDS["presence"], "pill spend drifted from the gate"


def test_workspace_hover_contrast() -> None:
    """Hover contrast gate (§12/dock/menus): the quieter 30% voice wash
    must also carry toolbar ink at 4.5:1 for every hue on both faces."""
    css = _css()
    hues = _workspace_hues(css)
    for n in sorted(hues):
        for face, (base, ink) in _PRESENCE_FACES.items():
            fill = _srgb_mix(_hex_to_rgb(hues[n]), _hex_to_rgb(base), _ROLE_SPENDS["hover"])
            ratio = _contrast(_hex_to_rgb(ink), fill)
            assert ratio >= _PRESENCE_MIN_CONTRAST, (
                f"ws{n} {hues[n]} hover on {face}: {ratio:.2f}:1 < "
                f"{_PRESENCE_MIN_CONTRAST}:1 — mute the hue"
            )


# Block anchors allowed to name the raw theme hover token: the voice
# definition itself, nested voice fallbacks, text selection (platform
# convention), the functional pulse flash, and the starred gold marker.
# Everything else Aph paints must read --aph-voice — one voice, no
# stragglers. Anchors match against the ~800 chars above each use, so a
# new raw read in a new block fails until it is repointed or justified.
_VOICE_ALLOWLIST = (
    "--aph-voice:",
    "var(--aph-voice,",
    "#aph-tab-rename-input::selection",
    "#aph-palette-input::selection",
    "data-aph-ws-pulse",
    "data-aph-starred",
    "--lwt-toolbar-field-highlight:",
)

_VOICE_FILES = (
    "branding/theme.css",
    "branding/userChrome.css",
    "branding/command-palette.css",
)


def test_voice_owns_chrome_paint() -> None:
    """Single-voice gate across every chrome stylesheet."""
    root = Path(__file__).resolve().parent.parent
    for rel in _VOICE_FILES:
        code = re.sub(r"/\*.*?\*/", "", (root / rel).read_text(encoding="utf-8"), flags=re.S)
        for m in re.finditer(r"--toolbarbutton-background-color-hover", code):
            context = code[max(0, m.start() - 800) : m.start()]
            snippet = code[m.start() : m.start() + 80].splitlines()[0]
            assert any(a in context or a in snippet for a in _VOICE_ALLOWLIST), (
                f"{rel}: raw hover token outside the voice allowlist: {snippet}"
            )


def test_canvas_faces_defined() -> None:
    """Aph owns the room: base/surface/field/ink/dim tokens exist on
    :root (dark face) and are redefined under prefers-color-scheme:
    light (paper face) with different values. No face may share a hex
    with the other — that would mean a face was forgotten."""
    css = _css()

    def token_values(name: str) -> list:
        return re.findall(rf"{name}:\s*(#[0-9a-fA-F]{{6}})", css)

    for token in ("--aph-base", "--aph-surface", "--aph-field", "--aph-ink", "--aph-ink-dim"):
        values = token_values(token)
        assert len(values) == 2, f"{token}: expected dark + light, found {values}"
        assert values[0].lower() != values[1].lower(), f"{token}: faces identical"
    assert "@media (prefers-color-scheme: light)" in css


def _canvas_pairs(css: str) -> list:
    """(face, base, ink, dim) parsed from the stylesheet in order —
    dark defaults first, light overrides second."""
    dims = re.findall(r"--aph-ink-dim:\s*(#[0-9a-fA-F]{6})", css)
    bases = re.findall(r"--aph-base:\s*(#[0-9a-fA-F]{6})", css)
    inks = re.findall(r"--aph-ink:\s*(#[0-9a-fA-F]{6})", css)
    assert len(dims) == 2 and len(bases) == 2 and len(inks) == 2
    return [("dark", bases[0], inks[0], dims[0]), ("light", bases[1], inks[1], dims[1])]


def test_canvas_ink_hierarchy() -> None:
    """Ink 7:1+, dim 4.5:1+ against the face base — hierarchy by the
    numbers, so label dimming can never slide into unreadability."""
    for face, base, ink, dim in _canvas_pairs(_css()):
        ink_ratio = _contrast(_hex_to_rgb(ink), _hex_to_rgb(base))
        assert ink_ratio >= 7, f"{face} ink {ink}: {ink_ratio:.2f}:1 < 7:1"
        dim_ratio = _contrast(_hex_to_rgb(dim), _hex_to_rgb(base))
        assert dim_ratio >= _PRESENCE_MIN_CONTRAST, (
            f"{face} dim {dim}: {dim_ratio:.2f}:1 < {_PRESENCE_MIN_CONTRAST}:1"
        )


# Theme surface/ink reads banned from chrome stylesheets: base, text,
# fields, accent surfaces, panel surfaces. The theme still paints what
# Firefox owns natively; Aph surfaces must not name them. (Voice and
# button-color fallbacks live under their own gate above.)
_BANNED_CANVAS_READS = (
    "--toolbar-bgcolor",
    "--toolbar-text-color",
    "--toolbar-field-background-color",
    "--toolbar-field-text-color",
    "--lwt-accent-color",
    "--panel-background-color",
    "--panel-text-color",
)

_CANVAS_FILES = (
    "branding/theme.css",
    "branding/userChrome.css",
    "branding/command-palette.css",
)


def test_chrome_owns_its_canvas() -> None:
    """No Aph-painted surface may read the theme's base/ink/fields —
    a green or red installed theme must have nowhere to tint the room.
    Read-form only (``var(--x,``): userChrome *writes*
    --panel-background-color to force the native menu surface onto the
    Aph surface, which is ownership, not leakage."""
    root = Path(__file__).resolve().parent.parent
    for rel in _CANVAS_FILES:
        code = re.sub(r"/\*.*?\*/", "", (root / rel).read_text(encoding="utf-8"), flags=re.S)
        for banned in _BANNED_CANVAS_READS:
            assert f"var({banned}," not in code, f"{rel}: theme canvas leak: {banned}"


def test_toolbar_icon_hovers_speak_voice() -> None:
    """Icon hovers (§26b): paint the SAME inner elements native paints
    (.toolbarbutton-icon/text/badge-stack, .identity-box-button) — an
    outer-box wash plus the native inner pill renders doubled. Voice at
    hover 30% / pressed 45% (rest < hover < active), native hover ring
    cleared, focus rings guarded. No `transition` shorthand (owned by
    the §3/§4 slide timing), no raw theme token, radius untouched (the
    close X keeps its native circle)."""
    css = _css()
    head = css.find("26b. Icon hovers speak voice")
    assert head != -1
    tail = css[head:]
    # Bound to §26b: §26c (New Tab full-row) legitimately owns
    # border-radius/transition on the button box (close X keeps native).
    end = tail.find("26c.", 10)
    block = tail[:end] if end != -1 else tail
    inners = "> :is(.toolbarbutton-icon, .toolbarbutton-text, .toolbarbutton-badge-stack)"
    assert block.count(inners) >= 2, "hover must paint native's inner elements"
    assert ".identity-box-button:is(:hover" in block
    assert ":not(:focus-visible)" in block
    assert "outline-color: transparent" in block
    assert "--aph-voice" in block
    assert "30%" in block and "45%" in block
    assert "transition:" not in block
    assert "border-radius:" not in block
    assert "--toolbarbutton-background-color-hover" not in block


def test_newtab_hover_is_full_row_wash() -> None:
    """New Tab button (§26c): single full-row wash with md corners, inners
    cleared to transparent — never separate pills around plus + label,
    never the selected lg presence."""
    css = _css()
    assert "26c. New Tab button" in css
    assert "#tabs-newtab-button" in css
    head = css.find("26c. New Tab button")
    end = css.find("27. Tab group", head)
    block = css[head : end if end != -1 else len(css)]
    assert "--aph-radius-md" in block
    assert "--aph-radius-lg" not in block
    assert "30%" in block and "45%" in block
    assert ":not(:focus-visible)" in block


def test_newtab_rest_idles_like_tab_row() -> None:
    """New Tab button rest state (§26d): transparent box (never stock
    fill), icon + label at the secondary dim tier with the bar glide,
    full ink on hover/focus/open. Disabled untouched."""
    css = _css()
    assert "26d. New Tab button at rest" in css
    assert "#tabs-newtab-button" in css
    head = css.find("26d. New Tab button at rest")
    end = css.find("27. Tab group", head)
    block = css[head : end if end != -1 else len(css)]
    assert "background" in block and "transparent" in block
    assert "--aph-secondary-opacity" in block
    assert "opacity: 1" in block
    assert ":focus-visible" in block
    assert "[open]" in block


def test_tab_group_radix_remap() -> None:
    """Tab group remap (§27): stock 9-name palette retuned to the row
    colors — base solids plus hover/invert/pale/text variants per name,
    both grey spellings, behind the forced-colors guard. Amber alone
    takes dark text on solid."""
    css = _css()
    assert "27. Tab group color remap" in css
    assert "@media not (forced-colors)" in css
    head = css.find("27. Tab group color remap")
    block = css[head:]
    solids = {
        "--tab-group-red:": "#e54666",
        "--tab-group-orange:": "#f76808",
        "--tab-group-yellow:": "#ffc53d",
        "--tab-group-green:": "#29a383",
        "--tab-group-cyan:": "#00a2c7",
        "--tab-group-blue:": "#0090ff",
        "--tab-group-purple:": "#8e4ec6",
        "--tab-group-pink:": "#d6409f",
        "--tab-group-grey:": "#707885",
        "--tab-group-gray:": "#707885",
    }
    lowered = block.lower()
    for token, hexval in solids.items():
        assert token in lowered, f"missing {token}"
        assert hexval in lowered, f"missing solid {hexval} for {token}"
    for variant in ("-hover:", "-invert:", "-pale:", "-text:", "-text-invert:"):
        for name in ("red", "blue", "grey", "gray"):
            assert f"--tab-group-{name}{variant}" in lowered
    assert "--tab-group-yellow-text: #21201c" in lowered.replace("  ", " ")


def test_tab_group_labels_are_wash_not_solid() -> None:
    """Group labels (§27): 45% hue wash + ink text on the label (never solid
    vivid pills) — the same presence recipe as workspace selected tabs;
    hover holds the wash with an inset ring instead of a fill jump. The
    collapsed state inherits the base label rule — no duplicate block."""
    css = _css()
    head = css.find("27. Tab group color remap")
    assert head != -1
    block = css[head:]
    assert ".tab-group-label" in block
    assert "var(--tab-group-color) 45%" in block
    assert "var(--tab-group-color) 50%" not in block, (
        "group wash must match the 45% presence recipe"
    )
    assert "var(--aph-ink" in block
    assert "tab-group[collapsed] > .tab-group-label-container" not in block, (
        "collapsed label must inherit the base wash, not duplicate it"
    )
    assert "--tab-group-line-color" in block


def test_toolbox_paints_own_base() -> None:
    """The toolbox is a vertical sibling of #browser, never layered over
    the desk — transparent here is a hole straight through to the native
    window background, which Firefox fills with the theme accent color.
    The toolbox must paint opaque Aph base so no installed theme can
    tint the top bar."""
    css = _css()
    head = css.find("#navigator-toolbox {")
    assert head != -1
    # Rule-local window only: #nav-bar below it is transparent on
    # purpose (its parent toolbox now paints the base behind it).
    body = css[head:]
    body = body[: body.find("}") + 1]
    assert "background:" in body and "var(--aph-base" in body
    assert "transparent" not in body


def test_inter_small_size_tracking_is_scoped() -> None:
    """Inter tracking (§23): small chrome text gets the Dynamic-Metrics
    breathing room via --aph-tracking-ui, scoped to small selectors —
    never a :root blanket (inputs/headers excluded by design)."""
    css = _css()
    assert "--aph-tracking-ui: 0.015em" in css
    for sel in (
        ".tabbrowser-tab .tab-label",
        ".aph-ws-pill",
        "#aph-ws-indicator",
        ".urlbarView-title",
    ):
        assert sel in css
    assert "letter-spacing: var(--aph-tracking-ui)" in css


def test_overridden_paint_rules_stay_deleted() -> None:
    """Rules that a later, more-specific rule always beat are dead weight.

    .aph-ws-pill[data-current="1"] set background+color, but every such pill
    also carries data-ws, so .aph-ws-pill[data-ws][data-current="1"] always
    won (it also carried the theme-ink leak, now gone with the rule). The
    rest wash, the collapsed .aph-ws-count hide, and the collapsed
    tab-group-label block duplicated live values under narrower selectors.
    --arch-radius-sm was defined with zero readers.
    """
    css = _css()
    # The deleted rule set background+color on [data-current] without
    # [data-ws]; the live drag-dim rule only sets opacity+cursor and must
    # not trip this guard, so assert on the dead declarations, not the
    # selector substring.
    for m in re.finditer(r"\.aph-ws-pill\[data-current=\"1\"\]\s*\{([^}]*)\}", css):
        body = m.group(1)
        assert "background" not in body and "color:" not in body, (
            "dead current-pill paint resurrected"
        )
    assert "--toolbarbutton-color" not in re.sub(r"/\*.*?\*/", "", css, flags=re.S), (
        "theme ink read resurrected"
    )
    assert ".aph-ws-pill[data-ws]:not([data-current=" not in css, "dead rest-wash rule resurrected"
    assert "sidebar-main:not([expanded]) .aph-ws-count" not in css, (
        "dead collapsed-count rule resurrected"
    )
    assert "tab-group[collapsed] > .tab-group-label-container" not in css, (
        "dead collapsed-label rule resurrected"
    )
    arch = (ROOT / "branding" / "archive.css").read_text(encoding="utf-8")
    assert "--arch-radius-sm" not in arch, "dead radius token resurrected"


def test_no_live_theme_color_reads() -> None:
    """Aph paints no surface from a theme-owned token.

    The last two live reads are gone: the current-pill text (died with its
    rule) and the starred-tab tint (now hardcoded gold). What remains is
    exactly one nested airbag — userChrome.css keeps a theme-hover fallback
    behind --aph-voice for the state where the Aph layer failed to load —
    plus comments. Strip comments, then assert no live paint read survives.
    """
    root = Path(__file__).resolve().parent.parent
    theme = (root / "branding" / "theme.css").read_text(encoding="utf-8")
    code = re.sub(r"/\*.*?\*/", "", theme, flags=re.S)
    assert "--toolbarbutton-color" not in code, "theme ink read resurrected"
    assert "--toolbarbutton-background-color-hover" not in code, "theme hover read resurrected"
    # The starred tint is hardcoded gold, never a token.
    head = code.find('[data-aph-starred="1"]:not([selected])')
    assert head != -1
    assert "rgba(255, 200, 80, 0.28)" in code[head : code.find("}", head)]


def test_fallbacks_match_root_definitions() -> None:
    """Unreachable fallbacks must still tell the truth.

    Every var() below is always defined on :root, so these never fire — but
    the old values named alien hexes and off-palette blues that would have
    painted wrong in exactly the failure state the fallback exists for.
    The hue-neutral white washes and the userChrome airbag are intentional
    and exempt.
    """
    css = _css()
    for stale in (
        "#14141a",
        "#24283b",
        "#f0f0f4",
        "#e6e8f5",
        "#7dbeff",
        "rgb(125, 190, 255)",
        "rgba(125, 190, 255,",
    ):
        assert stale not in css, f"stale fallback value resurrected: {stale}"


def test_container_line_softened_unselected_only() -> None:
    """§7b: stock paints the container stripe at full saturation, which
    shouts in the muted room. Unselected container tabs wear the hue at
    half strength; selected keeps full strength (presence, §13);
    bound-match stays hidden (§7). Recolor only — geometry untouched."""
    css = _css()
    sel = '.tabbrowser-tab[usercontextid]:not([data-aph-bound-match="1"]):not([selected]) .tab-context-line'
    head = css.find(sel)
    assert head != -1, "softened container-line rule missing"
    body = css[head : css.find("}", head)]
    assert "color-mix" in body, "stripe must mix the identity hue toward transparent"
    assert "50%" in body
    assert "--identity-stroke-color" in body
    assert "--identity-icon-color" in body, "pre-Nova fallback must survive"
    # Selected is carved out: no :not([selected])-less twin may mute it.
    assert ":not([selected])" in sel
    # Bound-match hiding (§7) still precedes and is intact.
    hide = css.find('[data-aph-bound-match="1"] .tab-context-line')
    assert hide != -1 and hide < head


def test_sidebar_joins_toolbar_room() -> None:
    """§22b: stock paints the sidebar box its own -moz-sidebar flat plus a
    separator border, reading as separate things next to the Aph-base
    toolbar. The sidebar background token is reclaimed to Aph base and
    the box border goes transparent (width kept, so geometry never
    shifts)."""
    css = _css()
    assert "--sidebar-background-color: var(--aph-base" in css, (
        "strip must drink the toolbar base, not stock -moz-sidebar"
    )
    sel = "#sidebar-box {"
    head = css.find(sel)
    assert head != -1, "sidebar-box separator rule missing"
    body = css[head : css.find("}", head)]
    assert "border-color: transparent" in body


def test_rest_rows_whisper() -> None:
    """§22: unselected unhovered rows wear a whisper fill (not full
    transparency) so the strip reads as rows at rest. Hover (§12) and
    selected (§13) are mutually exclusive with the rest selector, so
    they still win their states."""
    css = _css()
    sel = ".tabbrowser-tab:not([selected]):not(:hover) > .tab-stack > .tab-background"
    head = css.find(sel)
    assert head != -1, "rest-row rule missing"
    body = css[head : css.find("}", head)]
    assert "4%" in body and "color-mix" in body, "rest rows must whisper, not vanish"
    assert "background: transparent" not in body


def test_pending_tabs_read_parked() -> None:
    """§8: icon-only dimming proved too quiet — loaded vs unloaded was
    unreadable. Pending unselected tabs must dim the icon fully AND step
    the label down (opacity only, never layout); selected stays exempt."""
    css = _css()
    icon_sel = ".tabbrowser-tab[pending]:not([selected]) .tab-icon-image"
    head = css.find(icon_sel)
    assert head != -1, "pending icon rule missing"
    icon_body = css[head : css.find("}", head)]
    assert "grayscale(1)" in icon_body, "pending icon must fully desaturate"
    assert "opacity: 0.45" in icon_body
    label_sel = ".tabbrowser-tab[pending]:not([selected]) .tab-label"
    lhead = css.find(label_sel)
    assert lhead != -1, "pending label rule missing"
    assert "opacity: 0.6" in css[lhead : css.find("}", lhead)]


def test_icon_to_label_gap() -> None:
    """Stock .tab-label carries margin-inline: 0, so Aph's fixed 20px
    icon box is the entire icon→text gap — without an explicit margin
    the glyph kisses the label."""
    css = _css()
    sel = ".tabbrowser-tab[image] .tab-icon-stack"
    head = css.find(sel)
    assert head != -1, "favicon box rule missing"
    body = css[head : css.find("}", head)]
    assert "margin-inline-end: 6px" in body
