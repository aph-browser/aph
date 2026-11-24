"""Feature injectors: one class per shipped asset group.

Each injector appends its files only to the browser omni (the caller gates
on ``browser.xhtml`` presence) and only when the entry does not exist yet,
so upgrades never duplicate entries.
"""

from __future__ import annotations

from ..constants import (
    CONTENT_CSS_JA_PATH,
    PALETTE_CSS_JA_PATH,
    PALETTE_JA_PATH,
    THEME_JA_PATH,
    TOKENS_CSS_JA_PATH,
    WORKSPACES_JA_PATH,
)
from .base import PatchCounts


class StaticEntriesInjector:
    """Generic injector for static files added to the browser omni."""

    def __init__(
        self,
        entries: list[tuple[str, bytes | None, str]],
        name: str = "static-entries",
    ) -> None:
        self._entries = entries
        self.name = name

    def replace_existing(self, filename: str, data: bytes, counts: PatchCounts) -> bytes:
        return data

    def new_entries(self, existing: set[str], counts: PatchCounts) -> list[tuple[str, bytes]]:
        out: list[tuple[str, bytes]] = []
        for ja_path, data, count_attr in self._entries:
            if data is not None and ja_path not in existing:
                setattr(counts, count_attr, getattr(counts, count_attr) + 1)
                out.append((ja_path, data))
        return out


class WorkspacesInjector(StaticEntriesInjector):
    def __init__(self, js: bytes | None) -> None:
        super().__init__([(WORKSPACES_JA_PATH, js, "wsjs")], name="workspaces")


class ThemeInjector(StaticEntriesInjector):
    def __init__(self, css: bytes | None) -> None:
        super().__init__([(THEME_JA_PATH, css, "css")], name="theme")


class ContentCssInjector(StaticEntriesInjector):
    def __init__(self, css: bytes | None) -> None:
        super().__init__([(CONTENT_CSS_JA_PATH, css, "contentcss")], name="content-css")


class TokensInjector(StaticEntriesInjector):
    def __init__(self, css: bytes | None) -> None:
        super().__init__([(TOKENS_CSS_JA_PATH, css, "tokens")], name="tokens")


class PaletteInjector:
    name = "palette"

    def __init__(self, js: bytes | None, css: bytes | None) -> None:
        self._js = js
        self._css = css

    def replace_existing(self, filename: str, data: bytes, counts: PatchCounts) -> bytes:
        return data

    def new_entries(self, existing: set[str], counts: PatchCounts) -> list[tuple[str, bytes]]:
        out: list[tuple[str, bytes]] = []
        if self._js is not None and PALETTE_JA_PATH not in existing:
            counts.paljs += 1
            out.append((PALETTE_JA_PATH, self._js))
        if self._css is not None and PALETTE_CSS_JA_PATH not in existing:
            counts.palcss += 1
            out.append((PALETTE_CSS_JA_PATH, self._css))
        return out


class FontInjector:
    """Chrome type (Inter woff2): pure additions, never replacements."""

    name = "fonts"

    def __init__(self, fonts: dict[str, bytes]) -> None:
        self._fonts = fonts

    def replace_existing(self, filename: str, data: bytes, counts: PatchCounts) -> bytes:
        return data

    def new_entries(self, existing: set[str], counts: PatchCounts) -> list[tuple[str, bytes]]:
        out: list[tuple[str, bytes]] = []
        for ja_path, payload in self._fonts.items():
            if ja_path not in existing:
                counts.fonts += 1
                out.append((ja_path, payload))
        return out
