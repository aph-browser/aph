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

# Command palette (MVP): Ctrl+K overlay, JS + CSS injected the same way.
PALETTE_JS_SRC = BRANDING_DIR / "command-palette.js"
PALETTE_JA_PATH = "chrome/browser/content/browser/command-palette.js"
PALETTE_SCRIPT_TAG = '<script src="chrome://browser/content/command-palette.js"></script>'
PALETTE_CSS_SRC = BRANDING_DIR / "command-palette.css"
PALETTE_CSS_JA_PATH = "chrome/browser/content/browser/aph-palette.css"
PALETTE_LINK_TAG = '<link rel="stylesheet" href="chrome://browser/content/aph-palette.css" />'

# Text picker: controller injected into the browser window; actor child /
# parent modules + shared logic ship in actors/ (resource:/// URIs — every
# shipped actor uses resource://; chrome:// module URIs have zero precedent).
# The actor framework loads them by URI, never via browser.xhtml.
TEXTPICK_JS_SRC = BRANDING_DIR / "textpick.js"
TEXTPICK_JA_PATH = "chrome/browser/content/browser/textpick.js"
TEXTPICK_SCRIPT_TAG = '<script src="chrome://browser/content/textpick.js"></script>'
TEXTPICK_SHARED_SRC = BRANDING_DIR / "textpick-shared.js"
TEXTPICK_SHARED_JA_PATH = "actors/aph-textpick-shared.js"
TEXTPICK_SHARED_URI = "resource:///actors/aph-textpick-shared.js"
TEXTPICK_CHILD_SRC = BRANDING_DIR / "textpick-child.sys.mjs"
TEXTPICK_CHILD_JA_PATH = "actors/AphTextPickChild.sys.mjs"
TEXTPICK_CHILD_URI = "resource:///actors/AphTextPickChild.sys.mjs"
TEXTPICK_PARENT_SRC = BRANDING_DIR / "textpick-parent.sys.mjs"
TEXTPICK_PARENT_JA_PATH = "actors/AphTextPickParent.sys.mjs"
TEXTPICK_PARENT_URI = "resource:///actors/AphTextPickParent.sys.mjs"

# Tab archive: window controller + shared logic ride browser.xhtml (script
# tags, like workspaces.js); the archive page (HTML/CSS/page script) ships
# tag-less and loads by chrome:// URL in its own tab.
ARCHIVE_SHARED_SRC = BRANDING_DIR / "archive-shared.js"
ARCHIVE_SHARED_JA_PATH = "chrome/browser/content/browser/archive-shared.js"
ARCHIVE_SHARED_SCRIPT_TAG = '<script src="chrome://browser/content/archive-shared.js"></script>'
ARCHIVE_JS_SRC = BRANDING_DIR / "archive.js"
ARCHIVE_JA_PATH = "chrome/browser/content/browser/archive.js"
ARCHIVE_SCRIPT_TAG = '<script src="chrome://browser/content/archive.js"></script>'
ARCHIVE_HTML_SRC = BRANDING_DIR / "archive.html"
ARCHIVE_HTML_JA_PATH = "chrome/browser/content/browser/aph-archive.html"
ARCHIVE_CSS_SRC = BRANDING_DIR / "archive.css"
ARCHIVE_CSS_JA_PATH = "chrome/browser/content/browser/aph-archive.css"
ARCHIVE_PAGE_SRC = BRANDING_DIR / "archive-page.js"
ARCHIVE_PAGE_JA_PATH = "chrome/browser/content/browser/aph-archive-page.js"

# Tab rename: per-tab custom labels, window controller via xhtml script tag.
TABRENAME_JS_SRC = BRANDING_DIR / "tabrename.js"
TABRENAME_JA_PATH = "chrome/browser/content/browser/tabrename.js"
TABRENAME_SCRIPT_TAG = '<script src="chrome://browser/content/tabrename.js"></script>'

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
