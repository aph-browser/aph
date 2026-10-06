"""Aph welcome page: chrome-system tour files ship via the rebrand, the
trigger opens it once per profile after session restore settles, and it
stays re-openable from the Aph menu and the palette.
"""

import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

HTML = ROOT / "branding" / "welcome.html"
CSS = ROOT / "branding" / "welcome.css"
PAGE_JS = ROOT / "branding" / "welcome-page.js"
TRIGGER = ROOT / "branding" / "src" / "workspaces" / "105-welcome.js"

# Shortcut teaching is covered behaviorally by tests/welcome.test.js
# ("teaches the core shortcuts"); what remains here are the string-level
# dead-path guards no behavioral test can see.


def test_welcome_sources_exist() -> None:
    for p in (HTML, CSS, PAGE_JS, TRIGGER):
        assert p.is_file(), f"missing {p.name}"


def test_welcome_html_is_sane() -> None:
    text = HTML.read_text(encoding="utf-8")
    assert text.startswith("<!DOCTYPE html>")
    assert "chrome://browser/content/aph-welcome.css" in text
    assert "chrome://browser/content/aph-welcome-page.js" in text
    assert "<script>" not in text, "no inline scripts on chrome pages"
    assert 'id="aph-welcome-list"' in text
    assert 'id="aph-welcome-dismiss"' in text
    assert "aph-settings.html" in text, "tour must link Aph Settings"
    assert "aph-stash.html" in text, "tour must link the Stash"
    # Show-once by design: no opt-out theater (Get started persists seen).
    assert "aph-welcome-skip" not in text, "dead checkbox must stay removed"


def test_welcome_css_is_sane() -> None:
    css = CSS.read_text(encoding="utf-8")
    assert css.count("{") == css.count("}"), "unbalanced braces"
    assert css.count("/*") == css.count("*/"), "unbalanced comments"
    # The local --wel-* scale is gone; the page reads the shared tokens.
    for live in (
        "var(--aph-base)",
        "var(--aph-surface)",
        "var(--aph-field)",
        "var(--aph-ink)",
        "var(--aph-ink-dim)",
        "var(--aph-radius-lg)",
        "var(--aph-radius-xl)",
    ):
        assert live in css, f"missing shared token read: {live}"
    assert css.count("@font-face {") == 4
    assert "aph-fonts/inter-" in css
    assert "prefers-reduced-motion" in css
    assert "transition: none" in css
    # The tour carries no workspace identity rows, so no workspace hues:
    # color lives only where data-ws identity lives (stash, settings).
    assert "--wel-ws-1" not in css


def test_welcome_demo_reaches_live_palette() -> None:
    js = PAGE_JS.read_text(encoding="utf-8")
    # Demos must reach the real browser window: chrome tabs host no
    # AphPalette of their own, so window.parent is always a dead end.
    assert "getMostRecentWindow" in js, "demo must open the live palette"
    assert "window.parent.AphPalette" not in js, "dead demo path resurrected"
    assert "Open palette help" not in js, "palette has no help deep-link"
    assert "aph-welcome-skip" not in js, "dead checkbox resurrected"


def test_welcome_trigger_wired_into_init_and_bundle() -> None:
    # Show-once behavior itself is covered by tests/welcome-trigger.test.js
    # (six cases against the real trigger source); what remains here is the
    # cross-file wiring no behavioral test sees.
    init = (ROOT / "branding" / "src" / "workspaces" / "110-chrome-init.js").read_text(
        encoding="utf-8"
    )
    assert "scheduleWelcome()" in init, "init() must arm the welcome trigger"
    assert "welcomeObserver" in init, "unload must release the welcome observer"
    bundle = (ROOT / "branding" / "workspaces.js").read_text(encoding="utf-8")
    assert "scheduleWelcome" in bundle
    assert "maybeShowWelcome" in bundle


def test_welcome_payloads_load_and_patch(tmp_path) -> None:
    from scripts.aph_rebrand import BrandPatcher, load_payloads
    from scripts.aph_rebrand.constants import (
        WELCOME_CSS_JA_PATH,
        WELCOME_HTML_JA_PATH,
        WELCOME_PAGE_JA_PATH,
        WORKSPACES_XHTML_PATH,
    )

    payloads = load_payloads({})
    assert len(payloads.welcome_page_files) == 3
    assert set(payloads.welcome_page_files) == {
        WELCOME_HTML_JA_PATH,
        WELCOME_CSS_JA_PATH,
        WELCOME_PAGE_JA_PATH,
    }

    ja = tmp_path / "omni.ja"
    with zipfile.ZipFile(ja, "w", compression=zipfile.ZIP_STORED) as z:
        z.writestr("localization/en-US/brand.ftl", "old")
        z.writestr("localization/en-US/sync-brand.ftl", "old")
        z.writestr("localization/en-US/brandings.ftl", "old")
        z.writestr("chrome/locale/brand.properties", "old")
        z.writestr("chrome/locale/brand.dtd", "old")
        z.writestr("chrome/browser/content/branding/about-logo.svg", "old")
        z.writestr(
            WORKSPACES_XHTML_PATH,
            "<html><head>"
            '<script src="chrome://browser/content/browser-main.js"></script>'
            "</head><body></body></html>",
        )
    counts = BrandPatcher(ja, payloads).patch()
    assert counts.welcomepage == 3
    with zipfile.ZipFile(ja) as z:
        names = set(z.namelist())
        for entry in (
            WELCOME_HTML_JA_PATH,
            WELCOME_CSS_JA_PATH,
            WELCOME_PAGE_JA_PATH,
        ):
            assert entry in names, entry


def test_welcome_entry_points_wired() -> None:
    dock = (ROOT / "branding" / "src" / "workspaces" / "65-dock.js").read_text(encoding="utf-8")
    assert "aph-aph-welcome" in dock
    assert "aphOpenWelcome" in dock
    palette = (ROOT / "branding" / "src" / "palette" / "40-items.js").read_text(encoding="utf-8")
    assert "Open Aph Welcome" in palette
    assert palette.count("aph-welcome.html") >= 2, "palette must dedupe + open"
    # Generated bundles are fresh (just rebrand rebuilds them first, but
    # contributors must commit the rebuilt files all the same).
    assert "aphOpenWelcome" in (ROOT / "branding" / "workspaces.js").read_text(encoding="utf-8")
    assert "Open Aph Welcome" in (ROOT / "branding" / "command-palette.js").read_text(
        encoding="utf-8"
    )
