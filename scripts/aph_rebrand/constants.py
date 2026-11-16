"""Shared paths, omni.ja entry locations, xhtml tags, and brand templates.

Single source of truth for everything the rebrand touches inside omni.ja.
Feature injectors import their constants from here; ``patcher.py`` never
hardcodes a ``chrome://`` or ``actors/`` path.
"""

from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
OMNI_JA = ROOT / "build" / "firefox" / "browser" / "omni.ja"
ROOT_OMNI_JA = ROOT / "build" / "firefox" / "omni.ja"
BRANDING_DIR = ROOT / "branding"
ICONS_DIR = ROOT / "build" / "firefox" / "browser" / "chrome" / "icons" / "default"
PROFILE_DIR = ROOT / "profile"

# Sizes for window manager icons (WM spec) and tab favicons
ICON_SIZES = [16, 32, 48, 64, 128]

# Blank wordmark to erase Firefox text, leaving only logo
BLANK_WORDMARK = (
    b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1" width="1" height="1"></svg>'
)

BRAND_FTL_SRC = BRANDING_DIR / "brand.ftl"
BRANDINGS_FTL_SRC = BRANDING_DIR / "brandings.ftl"
SYNC_BRAND_FTL_SRC = BRANDING_DIR / "sync-brand.ftl"

# The browser window document. Presence of this entry discriminates the
# browser omni.ja (feature payloads go here) from the toolkit omni.ja.
WORKSPACES_XHTML_PATH = "chrome/browser/content/browser/browser.xhtml"

# Workspaces: single JS file injected into the browser window.
WORKSPACES_JS_SRC = BRANDING_DIR / "workspaces.js"
WORKSPACES_JA_PATH = "chrome/browser/content/browser/workspaces.js"
WORKSPACES_SCRIPT_TAG = '<script src="chrome://browser/content/workspaces.js"></script>'

# Theme: dedicated CSS injected alongside workspaces.js.
THEME_CSS_SRC = BRANDING_DIR / "theme.css"
THEME_JA_PATH = "chrome/browser/content/browser/aph-theme.css"
THEME_LINK_TAG = '<link rel="stylesheet" href="chrome://browser/content/aph-theme.css" />'

# Content CSS (new-tab backdrop): shipped in omni.ja, registered at startup via StyleSheetService.
CONTENT_CSS_SRC = BRANDING_DIR / "userContent.css"
CONTENT_CSS_JA_PATH = "chrome/browser/content/browser/aph-content.css"

# Bundled default preferences: appended to defaults/preferences/firefox.js.
DEFAULT_PREFS_SRC = ROOT / "config" / "default-prefs.js"
FIREFOX_PREFS_JA_PATH = "defaults/preferences/firefox.js"

# Design tokens: single source of truth (branding/tokens.css) shipped as
# aph-tokens.css and @imported by theme + palette + all three pages.
# No browser.xhtml tag — consumers pull it via CSS @import so the
# canonical xhtml tag order stays untouched.
TOKENS_CSS_SRC = BRANDING_DIR / "tokens.css"
TOKENS_CSS_JA_PATH = "chrome/browser/content/browser/aph-tokens.css"

# Chrome type: Inter (SIL OFL — see branding/fonts/OFL.txt), static latin
# subsets, one file per weight. Pure additions under aph-fonts/; the CSS
# reaches them as chrome://browser/content/aph-fonts/<file> (content/
# already maps to browser/content/browser/ — no extra segment).
FONT_SRC_PAIRS = [
    (
        BRANDING_DIR / "fonts" / "inter-400-latin.woff2",
        "chrome/browser/content/browser/aph-fonts/inter-400-latin.woff2",
    ),
    (
        BRANDING_DIR / "fonts" / "inter-500-latin.woff2",
        "chrome/browser/content/browser/aph-fonts/inter-500-latin.woff2",
    ),
    (
        BRANDING_DIR / "fonts" / "inter-600-latin.woff2",
        "chrome/browser/content/browser/aph-fonts/inter-600-latin.woff2",
    ),
    (
        BRANDING_DIR / "fonts" / "inter-700-latin.woff2",
        "chrome/browser/content/browser/aph-fonts/inter-700-latin.woff2",
    ),
]

# Command palette (MVP): Ctrl+K overlay, JS + CSS injected the same way.
PALETTE_JS_SRC = BRANDING_DIR / "command-palette.js"
PALETTE_JA_PATH = "chrome/browser/content/browser/command-palette.js"
PALETTE_SCRIPT_TAG = '<script src="chrome://browser/content/command-palette.js"></script>'
PALETTE_CSS_SRC = BRANDING_DIR / "command-palette.css"
PALETTE_CSS_JA_PATH = "chrome/browser/content/browser/aph-palette.css"
PALETTE_LINK_TAG = '<link rel="stylesheet" href="chrome://browser/content/aph-palette.css" />'

# Tab rename: per-tab custom labels, window controller via xhtml script tag.
TABRENAME_JS_SRC = BRANDING_DIR / "tabrename.js"
TABRENAME_JA_PATH = "chrome/browser/content/browser/tabrename.js"
TABRENAME_SCRIPT_TAG = '<script src="chrome://browser/content/tabrename.js"></script>'

# Aph settings: tag-less settings page (HTML/CSS/page script) — loads by
# chrome:// URL in its own tab, no browser.xhtml tag.
SETTINGS_HTML_SRC = BRANDING_DIR / "settings.html"
SETTINGS_HTML_JA_PATH = "chrome/browser/content/browser/aph-settings.html"
SETTINGS_CSS_SRC = BRANDING_DIR / "settings.css"
SETTINGS_CSS_JA_PATH = "chrome/browser/content/browser/aph-settings.css"
SETTINGS_PAGE_SRC = BRANDING_DIR / "settings-page.js"
SETTINGS_PAGE_JA_PATH = "chrome/browser/content/browser/aph-settings-page.js"

BRAND_PROPERTIES_TEMPLATE = """brandShorterName=Aph
brandShortName=Aph
brandFullName=Aph Browser
brandProductName=Aph Browser
vendorShortName=Aph

syncBrandShortName=Aph Sync
"""

BRAND_DTD_TEMPLATE = """<!-- Aph branding -->
<!ENTITY  brandShorterName      "Aph">
<!ENTITY  brandShortName        "Aph">
<!ENTITY  brandFullName         "Aph Browser">
<!ENTITY  brandProductName      "Aph Browser">
<!ENTITY  vendorShortName       "Aph">
<!ENTITY  trademarkInfo.part1   " ">
"""
