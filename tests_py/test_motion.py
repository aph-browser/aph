"""Spring micro-motion: one dialect for weight and entrances.

Springs move things, eases fade them: press dips and entrances ride
--aph-motion-spring (soft overshoot), color/opacity/shadow legs keep the
plain eases. Press is transform-only (never layout, anchors never
slide); every keyframe has a reduced-motion mirror.
"""

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
THEME = ROOT / "branding" / "theme.css"
TOKENS = ROOT / "branding" / "tokens.css"
GUESTS = (
    ROOT / "branding" / "command-palette.css",
    ROOT / "branding" / "settings.css",
    ROOT / "branding" / "stash.css",
    ROOT / "branding" / "welcome.css",
)
ALL = (THEME, *GUESTS)


def _code(path: Path) -> str:
    return re.sub(r"/\*.*?\*/", "", path.read_text(encoding="utf-8"), flags=re.S)


def test_spring_tokens_exist_and_composed() -> None:
    """tokens.css owns the soft overshoot curve plus a composed
    duration+curve token so guests name one motion token."""
    tokens = TOKENS.read_text(encoding="utf-8")
    assert "--aph-spring-soft:" in tokens
    m = re.search(r"--aph-spring-soft:\s*([^;]+);", tokens)
    assert m and "cubic-bezier" in m.group(1), "spring must overshoot"
    assert "1.1" in m.group(1), "soft spring overshoots gently, never pops"
    m2 = re.search(r"--aph-motion-spring:\s*([^;]+);", tokens)
    assert m2, "guests need a single composed spring token"
    assert "var(--aph-pop-in-duration)" in m2.group(1)
    assert "var(--aph-spring-soft)" in m2.group(1)


def test_spring_read_via_var_not_mirrored() -> None:
    """Single source: theme.css never redefines the spring tokens."""
    theme = THEME.read_text(encoding="utf-8")
    assert "--aph-spring-soft:" not in theme
    assert "--aph-motion-spring:" not in theme
    assert "var(--aph-motion-spring" in theme, "dock glide must ride the spring"
    for guest in GUESTS:
        live = _code(guest)
        assert "cubic-bezier" not in live, f"{guest.name}: inline curve — use the token"


def test_press_states_are_transform_only() -> None:
    """Every :active press dips with scale (transform-only): no layout
    prop may change between rest and press, or rows reflow mid-press."""
    for path in ALL:
        live = _code(path)
        for m in re.finditer(r"([^{}]+):active\s*\{([^}]*)\}", live):
            body = m.group(2)
            assert "transform" in body and "scale(" in body, (
                f"{path.name}: press without a scale dip: {m.group(1).strip()[:60]}"
            )
            for banned in (
                "width:",
                "height:",
                "margin:",
                "margin-inline",
                "padding:",
                "left:",
                "top:",
                "display:",
            ):
                assert banned not in body, (
                    f"{path.name}: layout prop in press: {banned} ({m.group(1).strip()[:60]})"
                )


def test_no_layout_prop_transitions() -> None:
    """Transitions may ease paint and transform only. The settings
    toggle knob (left-animated, pre-existing) is the sole allowlisted
    exception — new motion must use transform."""
    for path in ALL:
        live = _code(path)
        for m in re.finditer(r"transition\s*:\s*([^;!}]+)", live):
            for leg in m.group(1).split(","):
                prop = leg.strip().split()[0]
                if prop == "left" and "toggle" in live[max(0, m.start() - 400) : m.start()]:
                    continue
                assert prop not in (
                    "left",
                    "top",
                    "right",
                    "bottom",
                    "width",
                    "height",
                    "min-width",
                    "min-height",
                    "margin",
                    "padding",
                    "inset",
                ), f"{path.name}: layout-animated transition: `{leg.strip()}`"


def test_press_surfaces_present() -> None:
    """Press weight where clicks land: palette rows, dock pills (theme),
    guest buttons, pills, and CTAs."""
    theme = _code(THEME)
    assert ".aph-ws-pill:active" in theme
    assert "scale(0.96)" in theme[theme.find(".aph-ws-pill:active") :][:200]
    palette = _code(GUESTS[0])
    assert ".aph-palette-item:active" in palette
    settings = _code(GUESTS[1])
    assert ".aph-settings-rowbtn:active" in settings
    assert "#aph-settings-modal-ok:active" in settings
    stash = _code(GUESTS[2])
    assert ".aph-stash-pill:active" in stash
    assert "#aph-stash-bulk-delete:active" in stash
    welcome = _code(GUESTS[3])
    assert "#aph-welcome-dismiss:active" in welcome


def test_modal_entrance_mirrored() -> None:
    """The settings modal pops on the shared pop tokens and dies under
    reduced motion (no un-killable entrance)."""
    settings = GUESTS[1].read_text(encoding="utf-8")
    live = _code(GUESTS[1])
    assert "aph-modal-pop" in live
    head = live.find("#aph-settings-modal-card")
    body = live[head : live.find("}", head)]
    assert "var(--aph-pop-in-duration)" in body
    assert "var(--aph-pop-in-ease)" in body
    rm = settings.find("@media (prefers-reduced-motion: reduce)")
    assert rm != -1
    tail = settings[rm : rm + 2000]
    assert "#aph-settings-modal-card" in tail
    assert "animation: none" in tail


def test_tab_hover_lifts_shadow_only() -> None:
    """Tab hover depth is shadow-only (bar §29 language): the wash never
    doubles and anchors never slide — no transform on rows."""
    css = _code(THEME)
    sel = ".tabbrowser-tab:not([selected]):hover > .tab-stack > .tab-background"
    head = css.find(sel)
    assert head != -1
    body = css[head : css.find("}", head)]
    assert "0 1px 4px rgba(0, 0, 0, 0.3)" in body
    assert "transform" not in body
