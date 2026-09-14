"""Command palette chrome: branding/command-palette.css stays parseable and
shares the urlbar accent language.
"""

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
