"""Injector plugin interface.

Each feature owns one injector: it declares the ``<script>`` / ``<link>``
tags it needs in ``browser.xhtml``, how to handle already-shipped entries,
and which new entries to append (browser omni only — gated on the presence
of ``browser.xhtml``).

``PatchCounts`` replaces the legacy 16-tuple so call sites stay readable
while the on-disk log format keeps its historical field order via
:meth:`PatchCounts.as_tuple`.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol


@dataclass
class PatchCounts:
    brand: int = 0
    brandings: int = 0
    sync: int = 0
    props: int = 0
    dtd: int = 0
    logos: int = 0
    xhtml: int = 0
    wsjs: int = 0
    css: int = 0
    paljs: int = 0
    palcss: int = 0
    textpick: int = 0
    archivejs: int = 0
    archiveshared: int = 0
    archivepage: int = 0
    tabrenamejs: int = 0

    def as_tuple(self) -> tuple[int, ...]:
        return (
            self.brand,
            self.brandings,
            self.sync,
            self.props,
            self.dtd,
            self.logos,
            self.xhtml,
            self.wsjs,
            self.css,
            self.paljs,
            self.palcss,
            self.textpick,
            self.archivejs,
            self.archiveshared,
            self.archivepage,
            self.tabrenamejs,
        )


class Injector(Protocol):
    """A single rebrand concern (brand strings, logos, or one feature)."""

    name: str

    def xhtml_tags(self) -> list[str]:
        """Script/link tags this injector needs in browser.xhtml."""
        return []

    def replace_existing(self, filename: str, data: bytes, counts: PatchCounts) -> bytes:
        """Rewrite an already-shipped entry in place. Returns (possibly new) data."""
        return data

    def new_entries(self, existing: set[str], counts: PatchCounts) -> list[tuple[str, bytes]]:
        """Entries to append. Only called for the browser omni (has browser.xhtml)."""
        return []
