"""Command palette chrome: branding/command-palette.css stays parseable and
shares the urlbar accent language.
"""

import re
from pathlib import Path

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
    """The always-dark slab carries a 7% voice kiss so the overlay
    belongs to the workspace without going candy; selection speaks the
    full voice."""
    css = _css()
    head = css.find("--aph-palette-bg")
    assert head != -1
    overlay = css[max(0, head - 400) : head + 200]
    assert "--aph-voice" in overlay
    assert "7%" in overlay
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
