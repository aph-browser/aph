"""Guest pages consume the shared Aph scale; they no longer mirror it.

Regression guard for the drift pattern: settings.css / stash.css /
welcome.css each used to re-declare the whole --aph-* scale under a local
prefix (--set-*, --arch-*, --wel-*) with parity tests keeping the copies
honest. Now aph-tokens.css is the single source and these files may only
read it. The rules below are the house contract, enforced here so a new
page (or a well-meaning edit) can't quietly reintroduce copies.
"""

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GUEST_PAGES = {
    "settings": ROOT / "branding" / "settings.css",
    "stash": ROOT / "branding" / "stash.css",
    "welcome": ROOT / "branding" / "welcome.css",
    "palette": ROOT / "branding" / "command-palette.css",
}
LOCAL_PREFIXES = ("--set-", "--arch-", "--wel-")
TOKENS = ROOT / "branding" / "tokens.css"

# Values a page may only spell itself if the line carries a "deliberate
# literal" comment nearby (one-off hero lift, caret blink, slab text shadow).
LITERAL_EXCEPTED = ("deliberate literal",)


def _strip_comments(css: str) -> str:
    return re.sub(r"/\*.*?\*/", "", css, flags=re.S)


# Chrome-owned tokens live in theme.css (the window's own :root); guest
# pages may read them with a fallback, so both files feed the known set.
TOKEN_SOURCES = (TOKENS, ROOT / "branding" / "theme.css")


def _tokens_body() -> str:
    known: set[str] = set()
    for path in TOKEN_SOURCES:
        known |= set(re.findall(r"(--aph-[a-z0-9-]+):", path.read_text(encoding="utf-8")))
    return known


def test_guest_pages_import_shared_tokens() -> None:
    for name, path in GUEST_PAGES.items():
        css = path.read_text(encoding="utf-8")
        assert '@import url("chrome://browser/content/aph-tokens.css")' in css, name


def test_no_local_scale_is_reintroduced() -> None:
    for name, path in GUEST_PAGES.items():
        live = _strip_comments(path.read_text(encoding="utf-8"))
        for prefix in LOCAL_PREFIXES:
            assert prefix not in live, f"{name} re-declared a local {prefix}* scale"


def test_guest_token_reads_all_exist_in_tokens_css() -> None:
    known = _tokens_body()
    for name, path in GUEST_PAGES.items():
        live = _strip_comments(path.read_text(encoding="utf-8"))
        for var in set(re.findall(r"var\((--aph-[a-z0-9-]+)", live)):
            assert var in known, f"{name} reads {var}, which aph-tokens.css never declares"


def test_motion_named_tokens_only() -> None:
    """Every transition/animation timing reads a --aph-motion-* token.

    Raw `0.12s ease-out` literals are the exact thing that let the three
    pages drift apart; tokens.css owns the durations now.
    """
    for name, path in GUEST_PAGES.items():
        text = path.read_text(encoding="utf-8")
        live = _strip_comments(text)
        for decl in re.findall(r"(?:transition|animation)(?:-[a-z]+)?:[^;}]*", live):
            if re.search(r"\b\d+m?s\b", decl):
                assert any(k in text.lower() for k in LITERAL_EXCEPTED), (
                    f"{name}: raw timing in `{decl.strip()}` — use a --aph-motion-* token "
                    f"or mark the rule as a deliberate literal"
                )


def test_no_hardcoded_radius_or_shadow() -> None:
    for name, path in GUEST_PAGES.items():
        text = path.read_text(encoding="utf-8")
        live = _strip_comments(text)
        for prop, value in re.findall(r"(border-radius|box-shadow|text-shadow):\s*([^;}]*)", live):
            if "var(--aph-" in value:
                continue
            if any(k in text.lower() for k in LITERAL_EXCEPTED):
                continue
            assert not re.search(r"\d", value), f"{name}: {prop}: {value.strip()} must use a token"


def test_spacing_on_four_px_grid() -> None:
    """Padding/margins snap to the 4px grid; 1px/2px stay (hairlines,
    optical nudges, and the toggle knob's travel)."""
    off_grid = {"3px", "5px", "7px", "9px", "10px", "11px", "14px", "18px", "22px"}
    for name, path in GUEST_PAGES.items():
        live = _strip_comments(path.read_text(encoding="utf-8"))
        for decl in re.findall(r"(?:padding|margin)(?:-[a-z]+)?:\s*([^;}]*)", live):
            for token in decl.split():
                assert token not in off_grid, f"{name}: off-grid spacing `{decl.strip()}`"
