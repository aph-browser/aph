"""Design tokens payload: branding/tokens.css ships as aph-tokens.css
and every Aph stylesheet pulls it via @import (local mirrors stay as
fallback for older omnis)."""

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

TOKENS = ROOT / "branding" / "tokens.css"

CONSUMERS = (
    ROOT / "branding" / "theme.css",
    ROOT / "branding" / "command-palette.css",
    ROOT / "branding" / "settings.css",
    ROOT / "branding" / "archive.css",
    ROOT / "branding" / "welcome.css",
)

TOKENS_URL = "chrome://browser/content/aph-tokens.css"


def test_tokens_source_is_sane() -> None:
    assert TOKENS.is_file(), "missing branding/tokens.css"
    css = TOKENS.read_text(encoding="utf-8")
    assert css.count("{") == css.count("}"), "unbalanced braces"
    assert css.count("/*") == css.count("*/"), "unbalanced comments"
    for live in (
        "--aph-base",
        "--aph-surface",
        "--aph-ink",
        "--aph-voice",
        "--aph-radius-md",
        "--aph-radius-card",
        "--aph-pop-in-duration",
        "--aph-pop-in-ease",
    ):
        assert live in css, f"missing shared token: {live}"


def test_tokens_hues_match_chrome() -> None:
    """Nine workspace hues mirror theme.css §21 (same parity contract as
    the settings/archive mirrors)."""
    theme = (ROOT / "branding" / "theme.css").read_text(encoding="utf-8")
    tokens = TOKENS.read_text(encoding="utf-8")
    theme_hues = dict(re.findall(r"--aph-ws-([1-9]):\s*(#[0-9a-fA-F]{6})", theme))
    token_hues = dict(re.findall(r"--aph-ws-([1-9]):\s*(#[0-9a-fA-F]{6})", tokens))
    assert len(theme_hues) == 9 and len(token_hues) == 9
    for n in "123456789":
        assert token_hues[n].lower() == theme_hues[n].lower(), (
            f"ws{n} diverged: tokens {token_hues[n]} vs chrome {theme_hues[n]}"
        )


def test_every_consumer_imports_tokens_first() -> None:
    """@import must resolve at runtime and precede any @font-face (an
    @import after other statements is dropped by the parser)."""
    for path in CONSUMERS:
        css = path.read_text(encoding="utf-8")
        tag = f'@import url("{TOKENS_URL}");'
        assert tag in css, f"{path.name} never imports {TOKENS_URL}"
        # Import must precede any rule that consumes the tokens: :root
        # where present, else the first real rule (palette keeps its vars
        # on #aph-palette-overlay and has no :root at all).
        first_rule = css.find(":root {")
        if first_rule == -1:
            first_rule = css.find("#aph-palette-overlay {")
        assert first_rule != -1, f"{path.name}: no rule block found"
        assert css.find(tag) < first_rule, f"{path.name}: import after first rule"
        if "@font-face" in css:
            assert css.find(tag) < css.find("@font-face"), (
                f"{path.name}: @import must precede @font-face or it is ignored"
            )


def test_tokens_payload_wired() -> None:
    from scripts.aph_rebrand import load_payloads
    from scripts.aph_rebrand.constants import TOKENS_CSS_JA_PATH

    assert TOKENS_CSS_JA_PATH == "chrome/browser/content/browser/aph-tokens.css"
    payloads = load_payloads({})
    assert payloads.tokens_css, "tokens.css not loaded into payloads"
    assert TOKENS.read_bytes() == payloads.tokens_css
