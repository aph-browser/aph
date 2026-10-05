"""Upstream drift detector: every stock selector, token, and pref Aph
depends on must still exist in the packaged Firefox.

CSS fails closed — when Mozilla renames a token, our override silently
stops matching with no console error. These tests turn that into a loud
CI failure on every Firefox bump instead. They skip cleanly when Firefox
isn't downloaded (no build/firefox tree); run `just setup` for coverage.

Each hook names the Aph rule that needs it. When a hook goes missing,
check the stock replacement *before* deleting our guard — see
test_themed_tab_outline_cannot_paint_aph_surfaces for the one time the
mechanism moved instead of dying.
"""

import zipfile
from pathlib import Path

import pytest

from scripts.aph_rebrand.constants import OMNI_JA, ROOT_OMNI_JA

ROOT = Path(__file__).resolve().parent.parent

# (omni, entry, needle, aph rule that consumes it)
BROWSER_HOOKS = (
    (
        "browser",
        "chrome/browser/skin/classic/browser/tabbrowser/tabs.css",
        "--tab-border-color-accent",
        "theme.css §13 Nova gradient kill",
    ),
    (
        "browser",
        "chrome/browser/skin/classic/browser/tabbrowser/tabs.css",
        "theme-in-app",
        "theme.css §13 Nova gating",
    ),
    (
        "browser",
        "chrome/browser/skin/classic/browser/tabbrowser/tabs.css",
        "lwt-tab-line-color",
        "theme.css §13 themed-ring source",
    ),
    (
        "browser",
        "chrome/browser/skin/classic/browser/tabbrowser/tabs.css",
        "--tab-border-color-selected",
        "theme.css §13 157 ring mechanism",
    ),
    (
        "browser",
        "chrome/browser/skin/classic/browser/tabbrowser/tabs.css",
        "--tab-group-line-color",
        "theme.css §27 group rail wash",
    ),
    (
        "browser",
        "chrome/browser/skin/classic/browser/tabbrowser/tab.tokens.css",
        "--tab-icon-end-margin",
        "theme.css §22 favicon gap token",
    ),
    (
        "browser",
        "chrome/browser/skin/classic/browser/tabbrowser/tab.tokens.css",
        "--tab-group-red",
        "theme.css §27 group color remap",
    ),
    (
        "browser",
        "chrome/browser/skin/classic/browser/toolbarbuttons.css",
        "--toolbarbutton-background-color-hover",
        "userChrome.css hover voice (Sun defines it)",
    ),
    (
        "browser",
        "chrome/browser/skin/classic/browser/sidebar.css",
        "--sidebar-background-color",
        "theme.css §22b one-room strip",
    ),
    (
        "browser",
        "chrome/browser/skin/classic/browser/browser-colors.css",
        "--chrome-content-separator-color",
        "theme.css §19b separator repoint",
    ),
    (
        "browser",
        "chrome/browser/skin/classic/browser/urlbar.css",
        "--urlbar-height",
        "theme.css §14 field rhythm pin",
    ),
    (
        "browser",
        "chrome/browser/skin/classic/browser/urlbar.css",
        "--lwt-toolbar-field-highlight",
        "theme.css §14 selection token",
    ),
    (
        "browser",
        "chrome/browser/skin/classic/browser/urlbar/view-nova.css",
        "--urlbarView-row-border-radius",
        "theme.css §25 dropdown rows",
    ),
    (
        "browser",
        "chrome/browser/skin/classic/browser/urlbar/view-nova.css",
        "--urlbarView-icon-size",
        "theme.css §25 icon geometry",
    ),
    (
        "browser",
        "chrome/browser/skin/classic/browser/urlbar/view-nova.css",
        "mask-image",
        "theme.css §25 badge-cutout unmask target",
    ),
    (
        "browser",
        "chrome/browser/skin/classic/browser/urlbar/urlbarview.tokens.css",
        "--urlbarview-favicon-size",
        "theme.css §25 glyph pin",
    ),
    (
        "browser",
        "chrome/browser/skin/classic/browser/urlbar/urlbarview.tokens.css",
        "--urlbarview-background-color-hover",
        "theme.css §25 hover wash",
    ),
    (
        "browser",
        "chrome/browser/skin/classic/browser/tabbrowser/fullscreen-and-pointerlock.css",
        "fullscreenNavToolboxHidden",
        "theme.css §10 F11 launcher rule",
    ),
    (
        "browser",
        "chrome/browser/skin/classic/browser/tabbrowser/fullscreen-and-pointerlock.css",
        "content-visibility",
        "theme.css §10 undo target",
    ),
    (
        "browser",
        "chrome/browser/content/browser/browser-commands.js",
        "addTabSplitView",
        "78-split.js native picker fallback",
    ),
    (
        "browser",
        "chrome/browser/content/browser/tabbrowser/tabsplitview.mjs",
        "unsplitTabs",
        "78-split.js dissolve guard",
    ),
)

TOOLKIT_HOOKS = (
    (
        "toolkit",
        "chrome/toolkit/skin/classic/global/popup.css",
        "--panel-background-color",
        "userChrome.css menu surface variable",
    ),
    (
        "toolkit",
        "chrome/toolkit/skin/classic/global/popup.css",
        "::part(content)",
        "userChrome.css shadow-part paint",
    ),
)

PREF_HOOKS = (
    "sidebar.visibility",
    "sidebar.revamp",
    "browser.compactmode.show",
    "browser.uidensity",
    "browser.nova.enabled",
)

# Removed upstream and documented as such: --tab-selected-outline-color
# died in 157 (absent from both packaged omnis — the one exception is our
# own aph-theme.css override). If it ever reappears, fail loud: the §13
# guard comment must be re-examined against the restored mechanism.
REMOVED_NEEDLES = ("--tab-selected-outline-color",)


def _zips():
    paths = {}
    if OMNI_JA.is_file():
        paths["browser"] = OMNI_JA
    if ROOT_OMNI_JA.is_file():
        paths["toolkit"] = ROOT_OMNI_JA
    if not paths:
        pytest.skip("Firefox not downloaded (just setup) — no packaged omni.ja to inspect")
    out = {}
    for name, path in paths.items():
        try:
            out[name] = zipfile.ZipFile(path)
        except zipfile.BadZipFile:
            pytest.skip(f"unreadable {path}")
    if not out:
        pytest.skip("no packaged omni.ja available")
    return out


def _read(zf, entry):
    try:
        return zf.read(entry).decode("utf-8", "replace")
    except KeyError:
        return None


def test_browser_hooks_present() -> None:
    zips = _zips()
    if "browser" not in zips:
        pytest.skip("browser omni.ja not downloaded")
    zf = zips["browser"]
    missing = []
    for _omni, entry, needle, aph_ref in BROWSER_HOOKS:
        text = _read(zf, entry)
        if text is None:
            missing.append(f"{entry} (file gone; needed for {aph_ref})")
        elif needle not in text:
            missing.append(f"{needle} not in {entry} (needed for {aph_ref})")
    assert not missing, "upstream drift:\n" + "\n".join(missing)


def test_toolkit_hooks_present() -> None:
    zips = _zips()
    if "toolkit" not in zips:
        pytest.skip("toolkit omni.ja not downloaded")
    zf = zips["toolkit"]
    missing = []
    for _omni, entry, needle, aph_ref in TOOLKIT_HOOKS:
        text = _read(zf, entry)
        if text is None:
            missing.append(f"{entry} (file gone; needed for {aph_ref})")
        elif needle not in text:
            missing.append(f"{needle} not in {entry} (needed for {aph_ref})")
    assert not missing, "upstream drift:\n" + "\n".join(missing)


def test_upstream_prefs_present() -> None:
    zips = _zips()
    if "browser" not in zips:
        pytest.skip("browser omni.ja not downloaded")
    text = _read(zips["browser"], "defaults/preferences/firefox.js")
    assert text is not None, "defaults/preferences/firefox.js gone from browser omni"
    missing = [p for p in PREF_HOOKS if p not in text]
    assert not missing, f"upstream prefs removed: {missing}"


def test_removed_hooks_stay_removed() -> None:
    """--tab-selected-outline-color was removed in 157. Our own override
    still names it (the guard), so aph-* entries are excluded from the
    scan. A reappearance means Mozilla restored the mechanism and the §13
    comment must be rewritten again."""
    zips = _zips()
    found = []
    for name, zf in zips.items():
        for entry in zf.namelist():
            if not entry.endswith(".css"):
                continue
            if "/aph-" in entry or entry.startswith("aph-"):
                continue
            try:
                text = zf.read(entry).decode("utf-8", "replace")
            except KeyError:
                continue
            for needle in REMOVED_NEEDLES:
                if needle in text:
                    found.append(f"{needle} back in {name}:{entry}")
    assert not found, "upstream restored a removed hook:\n" + "\n".join(found)
