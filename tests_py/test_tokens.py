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
    ROOT / "branding" / "stash.css",
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
        "--aph-icon-sm",
        "--aph-icon-md",
        "--aph-icon-label-gap",
        "--aph-hit-min",
        "--aph-hit-sm",
        "--aph-bar-button",
        "--aph-bar-height",
        "--aph-pill-empty-opacity",
        "--aph-pill-empty-dash",
    ):
        assert live in css, f"missing shared token: {live}"


def test_tokens_hues_match_chrome() -> None:
    """Sixteen hue stops mirror theme.css §21 (same parity contract as
    the settings/stash mirrors). tokens.css declares each hex once under
    --aph-color-* with --aph-ws-N aliasing it; theme.css keeps literals
    as fallback for older omnis — compare resolved values."""
    theme = (ROOT / "branding" / "theme.css").read_text(encoding="utf-8")
    tokens = TOKENS.read_text(encoding="utf-8")
    theme_hues = dict(re.findall(r"--aph-ws-([0-9]{1,2}):\s*(#[0-9a-fA-F]{6})", theme))
    assert len(theme_hues) == 16, f"expected 16 chrome hues, found {len(theme_hues)}"
    colors = dict(re.findall(r"--aph-color-([a-z]+):\s*(#[0-9a-fA-F]{6})", tokens))
    assert len(colors) == 16, f"expected 16 named colors, found {len(colors)}"
    aliases = dict(re.findall(r"--aph-ws-([0-9]{1,2}):\s*var\(--aph-color-([a-z]+)\)", tokens))
    assert len(aliases) == 16, f"expected 16 ws aliases, found {len(aliases)}"
    for n in [str(i) for i in range(1, 17)]:
        assert n in aliases, f"tokens missing alias for hue {n}"
        resolved = colors[aliases[n]].lower()
        assert resolved == theme_hues[n].lower(), (
            f"ws{n} diverged: tokens {resolved} vs chrome {theme_hues[n]}"
        )


def test_every_consumer_imports_tokens_first() -> None:
    """@import must resolve at runtime and precede any @font-face (an
    @import after other statements is dropped by the parser)."""
    for path in CONSUMERS:
        css = path.read_text(encoding="utf-8")
        tag = f'@import url("{TOKENS_URL}");'
        assert tag in css, f"{path.name} never imports {TOKENS_URL}"
        # Import must precede any rule that consumes the tokens. Consumers
        # no longer declare a local :root scale (tokens.css is the only
        # declaration site), so the first real rule is the anchor.
        first_rule = css.find(":root {")
        if first_rule == -1:
            first_rule = min(
                (
                    i
                    for i in (
                        css.find("#aph-palette-overlay {"),
                        css.find("#aph-settings {"),
                        css.find("#aph-stash {"),
                        css.find("#aph-welcome {"),
                    )
                    if i != -1
                ),
                default=-1,
            )
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
