"""Build-time fix for the vertical-tabs navbar wipe.

Fresh profiles that pre-seed ``sidebar.verticalTabs`` (Aph does, via
``config/user.js``) hit a CustomizableUI restore path that builds the navbar
from ``verticalTabsDefaultPlacements`` (``["alltabs-button",
"ai-window-toggle"]``) INSTEAD of the full ``defaultPlacements`` — so the
removable defaults (back/forward/reload, downloads, springs, home) are never
placed and end up banished to the customization palette. That also breaks
``DownloadsButton.getAnchor()`` ("Downloads button cannot be found": no
progress ring, no auto-open panel) and "Restore Defaults" while vertical
tabs are on — both branch on the same array
(``restoreStateForArea`` / future-widget positioning in the same module).

This injector rewrites the array literal at rebrand time so vertical-tabs
profiles inherit the full stock navbar behind the tab-list button::

    verticalTabsDefaultPlacements: ["alltabs-button", ...navbarPlacements],

``navbarPlacements`` is the ``let`` defined just above the registration in
the same ``initialize()`` scope, so the spread is valid JS and future
Firefox buttons land in stock-relative positions with no Aph-side version
rot. Only applies to new profiles and toolbar resets; an already-wiped
profile keeps its persisted broken order until ``just nuke`` (or Customize
> Restore Defaults, which now restores the healthy bar).

Fail-loud contract: the anchor must occur exactly once in the entry that
ships it. A shipped ``CustomizableUI.sys.mjs`` without the anchor means
Mozilla moved the code — ``just rebrand`` errors instead of shipping a
silently unpatched build. Entries without that filename (synthetic test
jars, the browser omni.ja) are untouched. Verification is via the raise,
not ``PatchCounts`` (whose 16-tuple log shape is frozen for CI).
"""

from __future__ import annotations

from .base import PatchCounts

CUSTOMIZABLE_UI_PATH = "moz-src/browser/components/customizableui/CustomizableUI.sys.mjs"

_ANCHOR = b'verticalTabsDefaultPlacements: ["alltabs-button", "ai-window-toggle"],'
_REPLACEMENT = b'verticalTabsDefaultPlacements: ["alltabs-button", ...navbarPlacements],'


class ToolbarDefaultsInjector:
    name = "toolbar-defaults"

    def replace_existing(self, filename: str, data: bytes, counts: PatchCounts) -> bytes:
        if not filename.endswith("CustomizableUI.sys.mjs"):
            return data
        found = data.count(_ANCHOR)
        if found == 0:
            raise ValueError(
                "CustomizableUI.sys.mjs layout changed: "
                "verticalTabsDefaultPlacements anchor not found"
            )
        if found > 1:
            raise ValueError(
                f"CustomizableUI.sys.mjs anchor ambiguous: expected 1 occurrence, found {found}"
            )
        return data.replace(_ANCHOR, _REPLACEMENT)
