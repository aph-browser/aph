"""browser.xhtml tag injection.

Owns the ``<script>`` / ``<link>`` payload inserted next to
``browser-main.js``. Injection is idempotent: tags already present are
skipped, so re-running the rebrand over an already-patched file is safe
(the patcher always starts from the pristine backup anyway).
"""

from __future__ import annotations

from ..constants import (
    ARCHIVE_SCRIPT_TAG,
    ARCHIVE_SHARED_SCRIPT_TAG,
    PALETTE_LINK_TAG,
    PALETTE_SCRIPT_TAG,
    TABRENAME_SCRIPT_TAG,
    TEXTPICK_SCRIPT_TAG,
    THEME_LINK_TAG,
    WORKSPACES_SCRIPT_TAG,
)
from .base import Injector, PatchCounts

# Canonical injection order (matches legacy _inject_workspaces_script).
# Note PALETTE_LINK and PALETTE_SCRIPT straddle WORKSPACES_SCRIPT — the
# order is load-bearing for byte-identical browser.xhtml output.
CANONICAL_TAG_ORDER = (
    THEME_LINK_TAG,
    PALETTE_LINK_TAG,
    WORKSPACES_SCRIPT_TAG,
    PALETTE_SCRIPT_TAG,
    TEXTPICK_SCRIPT_TAG,
    ARCHIVE_SHARED_SCRIPT_TAG,
    ARCHIVE_SCRIPT_TAG,
    TABRENAME_SCRIPT_TAG,
)


class XhtmlInjector:
    name = "xhtml"

    def __init__(self, feature_injectors: list[Injector]) -> None:
        self._features = feature_injectors

    def xhtml_tags(self) -> list[str]:
        return []

    def all_tags(self) -> list[str]:
        # Fixed canonical order — do NOT concatenate feature tags here:
        # the legacy order interleaves palette link/script around workspaces.
        return list(CANONICAL_TAG_ORDER)

    def inject(self, xhtml_bytes: bytes) -> tuple[bytes, bool]:
        """Insert missing Aph tags. Returns (data, changed)."""
        try:
            text = xhtml_bytes.decode("utf-8")
        except UnicodeDecodeError:
            return xhtml_bytes, False

        tags_to_inject = [t for t in self.all_tags() if t not in text]
        if not tags_to_inject:
            return xhtml_bytes, False

        payload = "\n  " + "\n  ".join(tags_to_inject)

        anchor = '<script src="chrome://browser/content/browser-main.js"></script>'
        if anchor in text:
            text = text.replace(anchor, anchor + payload, 1)
        elif "</head>" in text:
            text = text.replace("</head>", payload + "\n</head>", 1)
        else:
            for closing in ("</html:body>", "</body>", "</html>", "</window>"):
                if closing in text:
                    text = text.replace(closing, payload + "\n" + closing, 1)
                    break

        return text.encode("utf-8"), True

    def replace_existing(self, filename: str, data: bytes, counts: PatchCounts) -> bytes:
        return data

    def new_entries(self, existing: set[str], counts: PatchCounts) -> list[tuple[str, bytes]]:
        return []
