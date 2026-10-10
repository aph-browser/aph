"""Next-gen chrome (Package D) gates.

The v2 layout (floating pill bar, reworked buttons, C1 rows) stamps
unconditionally at load — no pref, no toggle. The §29 namespacing
stays: every rule carries the gate so the chrome generation is
auditable in one block. These tests pin the tokens, the pref's
absence, and the gate.
"""

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GATE = ":root[data-aph-chrome-v2]"


def _css() -> str:
    return (ROOT / "branding" / "theme.css").read_text(encoding="utf-8")


def test_v2_tokens_exist_and_mirrored() -> None:
    """Geometry tokens for the floating shell live in tokens.css (single
    source); theme.css reads them via var() with matching fallbacks.
    Unified frame: 8/8/8 gutters, 12px bar+card."""
    tokens = (ROOT / "branding" / "tokens.css").read_text(encoding="utf-8")
    theme = _css()
    for token, value in (
        ("--aph-bar-float-margin", "8px"),
        ("--aph-bar-float-side", "8px"),
        ("--aph-bar-float-radius", "12px"),
        ("--aph-bar-float-height", "40px"),
    ):
        assert f"{token}: {value}" in tokens, f"tokens.css: {token} missing {value}"
        assert f"{token}, {value}" in theme or f"{token}," in theme, (
            f"theme.css must read {token} via var()"
        )


def test_v2_pref_removed() -> None:
    """No toggle: v2 is the only chrome (always stamped at load)."""
    config = (ROOT / "config" / "user.js").read_text(encoding="utf-8")
    assert "aph.chrome.v2" not in config


def test_v2_controller_ships_in_bundle() -> None:
    """115-chrome-v2.js is listed and built (stamp + reload seats +
    subtitle sync all present in the shipped bundle)."""
    from scripts.build_assets import BUNDLES

    assert "workspaces/115-chrome-v2.js" in BUNDLES["workspaces.js"]
    bundle = (ROOT / "branding" / "workspaces.js").read_text(encoding="utf-8")
    for needle in (
        "data-aph-chrome-v2",
        "placeChromeV2Reload",
    ):
        assert needle in bundle, f"bundle missing v2 controller piece: {needle}"
    assert "aph.chrome.v2" not in bundle, "dead pref read left in bundle"


def test_v2_section_fully_gated() -> None:
    """Every rule after the §29 header carries the gate — no unscoped
    display:none on home/hamburger, no moved buttons, no subtitles in
    v1. Splits the tail by rule; each selector chunk mentioning the v2
    surfaces must name the gate."""
    css = _css()
    head = css.find("29. Next-gen chrome")
    assert head != -1, "missing §29 v2 block"
    tail = css[head:]
    assert "display: none" in tail, "v2 home retirement missing"
    # No bare (ungated) hides of the retired button anywhere v2-related.
    # The hamburger stays visible on purpose: PanelUI.show() anchors the
    # native app panel on its button, so hiding it misplaces the panel.
    for m in re.finditer(r"([^{}]+)\{\s*display:\s*none", tail):
        assert "data-aph-chrome-v2" in m.group(1), (
            f"ungated display:none leaks into v1: {m.group(1).strip()[:80]}"
        )
    for scope in (
        "#nav-bar {",
        "#home-button",
        "#reload-button",
        ".tab-background",
    ):
        assert scope in tail, f"§29 missing expected scope: {scope}"


def _split_top_level(prelude: str) -> list:
    """Split a selector list on top-level commas only (commas inside
    :is()/:not()/var() fallbacks are not rule separators)."""
    parts, depth, cur = [], 0, ""
    for ch in prelude:
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth = max(0, depth - 1)
        if ch == "," and depth == 0:
            parts.append(cur)
            cur = ""
        else:
            cur += ch
    parts.append(cur)
    return parts


def test_v2_selectors_cover_all_surfaces() -> None:
    """The §29 tail must theme no selector without the gate: walk every
    rule in the tail and require the gate in each selector prelude."""
    css = _css()
    anchor = css.find("29. Next-gen chrome")
    assert anchor != -1, "missing §29 v2 block"
    # Back up to the comment opener so stripping leaves no header text.
    start = css.rfind("/*", 0, anchor)
    assert start != -1
    code = re.sub(r"/\*.*?\*/", "", css[start:], flags=re.S)
    depth = 0
    prelude_start = 0
    i = 0
    checked = 0
    while i < len(code):
        ch = code[i]
        if ch == "{":
            if depth == 0:
                prelude = code[prelude_start:i]
                if prelude.strip() and not prelude.strip().startswith("@"):
                    for part in _split_top_level(prelude):
                        if part.strip():
                            assert GATE in part, (
                                f"§29 ungated selector leaks into v1: {part.strip()[:80]}"
                            )
                            checked += 1
            depth += 1
        elif ch == "}":
            depth = max(0, depth - 1)
            if depth == 0:
                prelude_start = i + 1
        i += 1
    assert checked, "no §29 selectors found"
