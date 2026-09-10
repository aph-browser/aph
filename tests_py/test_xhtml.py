"""Unit tests for browser.xhtml tag injection."""

from scripts.aph_rebrand.injectors.xhtml import CANONICAL_TAG_ORDER, XhtmlInjector

ANCHOR = '<script src="chrome://browser/content/browser-main.js"></script>'


def _doc(body: str = "") -> bytes:
    return f"<html><head>{ANCHOR}</head><body>{body}</body></html>".encode()


def test_injects_all_tags_after_anchor() -> None:
    data, changed = XhtmlInjector([]).inject(_doc())
    assert changed
    text = data.decode()
    anchor_at = text.index(ANCHOR) + len(ANCHOR)
    for tag in CANONICAL_TAG_ORDER:
        pos = text.index(tag)
        assert pos > anchor_at, tag
    # Legacy order: palette link < workspaces < palette script.
    assert text.index("aph-palette.css") < text.index("workspaces.js")
    assert text.index("workspaces.js") < text.index("command-palette.js")


def test_injection_is_idempotent() -> None:
    once, _ = XhtmlInjector([]).inject(_doc())
    twice, changed = XhtmlInjector([]).inject(once)
    assert not changed
    assert twice == once


def test_falls_back_to_head_close_without_anchor() -> None:
    data, changed = XhtmlInjector([]).inject(b"<html><head></head><body></body></html>")
    assert changed
    assert b"workspaces.js" in data


def test_non_utf8_passthrough() -> None:
    raw = b"\xff\xfe\x00invalid"
    data, changed = XhtmlInjector([]).inject(raw)
    assert not changed
    assert data == raw


def test_canonical_order_has_all_eight_tags() -> None:
    joined = "\n".join(CANONICAL_TAG_ORDER)
    for needle in (
        "aph-theme.css",
        "aph-palette.css",
        "workspaces.js",
        "command-palette.js",
        "textpick.js",
        "archive-shared.js",
        "archive.js",
        "tabrename.js",
    ):
        assert needle in joined, needle
