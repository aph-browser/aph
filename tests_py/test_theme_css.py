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
    indicator, dock current — never as text. The desk stays neutral:
    no [data-aph-ws] rule may override --aph-desk-sheen (the room never
    changes white balance), and no accent edge rule may remain on the
    selected tab (the fill is the single signal)."""
    css = _css()
    for n in "123456789":
        assert f"--aph-ws-{n}:" in css, f"missing accent var for ws{n}"
        assert f':root[data-aph-ws="{n}"]' in css
    assert "--aph-ws-accent:" in css
    assert ":root[data-aph-ws] #aph-ws-indicator" in css
    assert '.aph-ws-pill[data-ws][data-current="1"]' in css
    assert ":root[data-aph-ws] .tabbrowser-tab[selected]" not in css, (
        "accent edge on selected tab is gone — the §13 fill is the signal"
    )
    assert not re.search(r":root\[data-aph-ws\][^{]*\{[^}]*--aph-desk-sheen", css), (
        "desk sheen must stay neutral on every workspace"
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


# Canonical presence faces: the 45% accent fill composited over each.
# Reconcile against Sun's live toolbar colors on a real build if they
# ever drift (dark base ≈ Sun-dark desk, light base ≈ Sun-light cream).
_PRESENCE_FACES = {
    "dark": ("#1c1d26", "#e8e8ec"),
    "light": ("#f6f1e3", "#23252f"),
}
_PRESENCE_MIN_CONTRAST = 4.5
# Role spends, mirroring the CSS: presence 45% (selected, indicator,
# dock current), hover 30% (tabs, pills, menus, Aph key).
_ROLE_SPENDS = {"presence": 0.45, "hover": 0.30}


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
    block = css[head:]
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
