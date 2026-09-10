"""Logo / SVG replacements inside omni.ja."""

from __future__ import annotations

from .base import PatchCounts


class LogoInjector:
    name = "logos"

    def __init__(self, logos: dict[str, bytes]) -> None:
        self._logos = logos

    def xhtml_tags(self) -> list[str]:
        return []

    def replace_existing(self, filename: str, data: bytes, counts: PatchCounts) -> bytes:
        if filename in self._logos:
            counts.logos += 1
            return self._logos[filename]
        return data

    def new_entries(self, existing: set[str], counts: PatchCounts) -> list[tuple[str, bytes]]:
        return []
