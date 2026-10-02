"""Command palette chrome: branding/command-palette.css stays parseable and
shares the urlbar accent language.
"""

import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent


def _css() -> str:
    return (ROOT / "branding" / "command-palette.css").read_text(encoding="utf-8")


def test_palette_css_is_sane() -> None:
    css = _css()
    assert css.count("{") == css.count("}"), "unbalanced braces"
    assert css.count("/*") == css.count("*/"), "unbalanced comments"


def test_palette_input_shares_urlbar_accent() -> None:
    """The palette input's bottom border uses the same bright accent as
    the urlbar border (one shared voice), falling back to the neutral
    panel border when the theme layer is absent."""
    css = _css()
    head = css.find("#aph-palette-input {")
    assert head != -1
    body = css[head:]
    body = body[: body.find("}") + 1]
    assert "border-bottom" in body
    assert "--aph-urlbar-accent" in body


def test_palette_slab_belongs_to_room() -> None:
    """The always-dark slab carries a 7% voice kiss so the overlay belongs
    to the workspace without going candy; selection speaks the full voice.
    The slab tokens live in tokens.css now (the page only reads them)."""
    tokens = (ROOT / "branding" / "tokens.css").read_text(encoding="utf-8")
    head = tokens.find("--aph-palette-bg")
    assert head != -1, "slab color must be declared in tokens.css"
    block = tokens[head : tokens.find(";", head)]
    assert "--aph-voice" in block and "7%" in block
    css = _css()
    assert "var(--aph-palette-bg)" in css and "--aph-palette-bg:" not in css
    sel = css[css.find(".aph-palette-item.selected {") :]
    sel = sel[: sel.find("}") + 1]
    assert "--aph-voice" in sel


def test_palette_icon_marks_have_a_slot() -> None:
    """Icon-pick rows render vendored Lucide marks centered in the 22px
    tile (16px mark). Clicks must land on the row, never the glyphs."""
    css = _css()
    head = css.find(".aph-palette-icon svg {")
    assert head != -1, "palette mark slot missing"
    body = css[head : css.find("}", head)]
    assert "width: 16px" in body
    assert "pointer-events: none" in body


def test_palette_stays_rtl_clean() -> None:
    """Hint row floats/margins must mirror in RTL via logical props."""
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


def test_pop_plays_with_the_fade_not_after_it() -> None:
    """The box pop must start WITH the overlay fade, never a beat after.

    A single "<time> <easing>" token is legal in `transition:` but in the
    `animation:` shorthand the SECOND <time> parses as a DELAY. The old
    --aph-pop-in carried both, so the box held at rest while the
    backdrop faded, then snapped in — the open → flash → open again
    stutter. The tokens are split (theme.css §23) so no time slot can be
    misread, and the shorthand must reference only those two."""
    code = re.sub(r"/\*.*?\*/", "", _css(), flags=re.S)
    head = code.find("#aph-palette.aph-palette-anim {")
    assert head != -1, "pop rule missing"
    body = code[head : code.find("}", head)]
    assert "animation: aph-palette-pop var(--aph-pop-in-duration" in body, (
        "pop must take duration from the split token"
    )
    assert "var(--aph-pop-in-ease" in body, "pop must take easing from the split token"
    # The unsplit token is retired everywhere (a lone --aph-pop-in would
    # come back as a delay the moment it reached an animation shorthand).
    assert "--aph-pop-in)" not in code
    assert "--aph-pop-in " not in code
    theme = re.sub(
        r"/\*.*?\*/", "", (ROOT / "branding" / "theme.css").read_text(encoding="utf-8"), flags=re.S
    )
    assert "--aph-pop-in-duration: 180ms" in theme
    assert "--aph-pop-in-ease: cubic-bezier" in theme
    assert re.search(r"(?m)^\s*--aph-pop-in\s*:", theme) is None, (
        "unsplit --aph-pop-in resurrected — it parses as a delay in animation:"
    )


def test_no_custom_property_time_survives_into_an_animation() -> None:
    """Repo-wide guard for the delay bug class, not just the palette.

    In the `animation:` shorthand the FIRST <time> is the duration and
    the SECOND is the delay. Interpolating a token that already carries
    "<time> <easing>" (a shape that is fine in `transition:`) silently
    promotes its duration to a delay. Any such token must be split before
    it can reach an animation rule."""
    time_re = re.compile(r"\b\d*\.?\d+(?:ms|s)\b")
    for path in sorted((ROOT / "branding").glob("*.css")):
        code = re.sub(r"/\*.*?\*/", "", path.read_text(encoding="utf-8"), flags=re.S)
        tokens = dict(re.findall(r"(--[\w-]+)\s*:\s*([^;{}]+);", code))
        for m in re.finditer(r"(?<![\w-])animation\s*:\s*([^;{}]+)", code):
            decl = m.group(1)
            for name in re.findall(r"var\(\s*(--[\w-]+)", decl):
                value = tokens.get(name, "")
                # One time is fine (duration). Two or more, or a time
                # alongside a bezier/steps easing in a token used by an
                # animation, is the danger: a transition-shaped token.
                if len(time_re.findall(value)) >= 1 and re.search(
                    r"cubic-bezier|steps\(|ease-in|ease-out|ease-in-out|linear", value
                ):
                    pytest.fail(
                        f"{path.name}: animation interpolates transition-shaped "
                        f"{name} = {value.strip()!r}; split the duration and "
                        "easing or the duration parses as a delay"
                    )
