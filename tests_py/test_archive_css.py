"""Archive page chrome: branding/archive.css eases hovers and guards motion."""

from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _css() -> str:
    return (ROOT / "branding" / "archive.css").read_text(encoding="utf-8")


def test_archive_css_is_sane() -> None:
    css = _css()
    assert css.count("{") == css.count("}"), "unbalanced braces"
    assert css.count("/*") == css.count("*/"), "unbalanced comments"


def test_archive_hovers_ease_and_motion_guarded() -> None:
    """Motion language (§24 dialect): pills, rows, tags, and the delete
    reveal ease instead of snapping, and reduced-motion kills every
    transition including the toast's."""
    css = _css()
    # Base rules plus the motion block at the end (which owns the
    # transitions), so each selector must appear at least twice and a
    # transition must follow one of the occurrences.
    for sel in (".aph-archive-pill {", ".aph-archive-row {", ".aph-archive-del {"):
        first = css.find(sel)
        assert first != -1, sel
        second = css.find(sel, first + 1)
        assert second != -1, sel
        assert "transition" in css[second : second + 400], sel
    assert "prefers-reduced-motion" in css
    assert "#aph-archive-toast" in css and "transition: none" in css
