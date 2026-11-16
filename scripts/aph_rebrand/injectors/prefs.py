"""Injector for Aph bundled default preferences into defaults/preferences/firefox.js.

Appends Aph's default preferences (Betterfox privacy & security baselines
plus native Aph overrides) directly to the end of defaults/preferences/firefox.js
inside browser/omni.ja. Setting Firefox's default branch natively guarantees
last-line-wins with zero filename sorting ambiguity. User edits via about:config
or Aph Settings persist to prefs.js automatically without profile seeding.
"""

from __future__ import annotations

from .base import PatchCounts


class PrefsDefaultsInjector:
    name = "prefs-defaults"

    def __init__(self, prefs_data: bytes | None) -> None:
        self._prefs = prefs_data

    def replace_existing(self, filename: str, data: bytes, counts: PatchCounts) -> bytes:
        if filename != "defaults/preferences/firefox.js" or not self._prefs:
            return data
        return data + b"\n\n// Aph bundled default preferences\n" + self._prefs + b"\n"

    def new_entries(self, existing: set[str], counts: PatchCounts) -> list[tuple[str, bytes]]:
        return []
