"""Feature injectors: one class per shipped asset group.

Each injector appends its files only to the browser omni (the caller gates
on ``browser.xhtml`` presence) and only when the entry does not exist yet,
so upgrades never duplicate entries. ``textpick`` / ``archivepage`` cover
their multi-file groups under a single counter, matching historical logs.
"""

from __future__ import annotations

from ..constants import (
    ARCHIVE_CSS_JA_PATH,
    ARCHIVE_HTML_JA_PATH,
    ARCHIVE_JA_PATH,
    ARCHIVE_PAGE_JA_PATH,
    ARCHIVE_SCRIPT_TAG,
    ARCHIVE_SHARED_JA_PATH,
    ARCHIVE_SHARED_SCRIPT_TAG,
    PALETTE_CSS_JA_PATH,
    PALETTE_JA_PATH,
    PALETTE_LINK_TAG,
    PALETTE_SCRIPT_TAG,
    TABRENAME_JA_PATH,
    TABRENAME_SCRIPT_TAG,
    TEXTPICK_CHILD_JA_PATH,
    TEXTPICK_JA_PATH,
    TEXTPICK_PARENT_JA_PATH,
    TEXTPICK_SCRIPT_TAG,
    TEXTPICK_SHARED_JA_PATH,
    THEME_JA_PATH,
    THEME_LINK_TAG,
    WORKSPACES_JA_PATH,
    WORKSPACES_SCRIPT_TAG,
)
from .base import PatchCounts


class WorkspacesInjector:
    name = "workspaces"

    def __init__(self, js: bytes | None) -> None:
        self._js = js

    def xhtml_tags(self) -> list[str]:
        # Tags are unconditional (matches legacy _inject_workspaces_script):
        # a missing payload still gets its tag, the missing file warns at
        # load time. Payload presence only gates new_entries below.
        return [WORKSPACES_SCRIPT_TAG]

    def replace_existing(self, filename: str, data: bytes, counts: PatchCounts) -> bytes:
        return data

    def new_entries(self, existing: set[str], counts: PatchCounts) -> list[tuple[str, bytes]]:
        if self._js is not None and WORKSPACES_JA_PATH not in existing:
            counts.wsjs += 1
            return [(WORKSPACES_JA_PATH, self._js)]
        return []


class ThemeInjector:
    name = "theme"

    def __init__(self, css: bytes | None) -> None:
        self._css = css

    def xhtml_tags(self) -> list[str]:
        return [THEME_LINK_TAG]

    def replace_existing(self, filename: str, data: bytes, counts: PatchCounts) -> bytes:
        return data

    def new_entries(self, existing: set[str], counts: PatchCounts) -> list[tuple[str, bytes]]:
        if self._css is not None and THEME_JA_PATH not in existing:
            counts.css += 1
            return [(THEME_JA_PATH, self._css)]
        return []


class PaletteInjector:
    name = "palette"

    def __init__(self, js: bytes | None, css: bytes | None) -> None:
        self._js = js
        self._css = css

    def xhtml_tags(self) -> list[str]:
        return [PALETTE_LINK_TAG, PALETTE_SCRIPT_TAG]

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


class TextpickInjector:
    """Window controller (xhtml script tag) + tag-less actor modules."""

    name = "textpick"

    def __init__(
        self,
        controller_js: bytes | None,
        extra_files: dict[str, bytes],
    ) -> None:
        self._controller_js = controller_js
        # ja_path -> bytes for shared / child / parent (actor framework URIs).
        self._extra_files = extra_files

    def xhtml_tags(self) -> list[str]:
        return [TEXTPICK_SCRIPT_TAG]

    def replace_existing(self, filename: str, data: bytes, counts: PatchCounts) -> bytes:
        return data

    def new_entries(self, existing: set[str], counts: PatchCounts) -> list[tuple[str, bytes]]:
        out: list[tuple[str, bytes]] = []
        if self._controller_js is not None and TEXTPICK_JA_PATH not in existing:
            counts.textpick += 1
            out.append((TEXTPICK_JA_PATH, self._controller_js))
        for key in (
            TEXTPICK_SHARED_JA_PATH,
            TEXTPICK_CHILD_JA_PATH,
            TEXTPICK_PARENT_JA_PATH,
        ):
            data = self._extra_files.get(key)
            if data is not None and key not in existing:
                counts.textpick += 1
                out.append((key, data))
        return out


class ArchiveInjector:
    """Window controllers (xhtml tags) + tag-less archive page files."""

    name = "archive"

    def __init__(
        self,
        archive_js: bytes | None,
        shared_js: bytes | None,
        page_files: dict[str, bytes],
    ) -> None:
        self._archive_js = archive_js
        self._shared_js = shared_js
        self._page_files = page_files

    def xhtml_tags(self) -> list[str]:
        return [ARCHIVE_SHARED_SCRIPT_TAG, ARCHIVE_SCRIPT_TAG]

    def replace_existing(self, filename: str, data: bytes, counts: PatchCounts) -> bytes:
        return data

    def new_entries(self, existing: set[str], counts: PatchCounts) -> list[tuple[str, bytes]]:
        out: list[tuple[str, bytes]] = []
        if self._shared_js is not None and ARCHIVE_SHARED_JA_PATH not in existing:
            counts.archiveshared += 1
            out.append((ARCHIVE_SHARED_JA_PATH, self._shared_js))
        if self._archive_js is not None and ARCHIVE_JA_PATH not in existing:
            counts.archivejs += 1
            out.append((ARCHIVE_JA_PATH, self._archive_js))
        for key in (
            ARCHIVE_HTML_JA_PATH,
            ARCHIVE_CSS_JA_PATH,
            ARCHIVE_PAGE_JA_PATH,
        ):
            data = self._page_files.get(key)
            if data is not None and key not in existing:
                counts.archivepage += 1
                out.append((key, data))
        return out


class TabrenameInjector:
    name = "tabrename"

    def __init__(self, js: bytes | None) -> None:
        self._js = js

    def xhtml_tags(self) -> list[str]:
        return [TABRENAME_SCRIPT_TAG]

    def replace_existing(self, filename: str, data: bytes, counts: PatchCounts) -> bytes:
        return data

    def new_entries(self, existing: set[str], counts: PatchCounts) -> list[tuple[str, bytes]]:
        if self._js is not None and TABRENAME_JA_PATH not in existing:
            counts.tabrenamejs += 1
            return [(TABRENAME_JA_PATH, self._js)]
        return []
