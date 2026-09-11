"""Atomic omni.ja patching.

:class:`BrandPatcher` owns the backup lifecycle, the copy-and-replace loop,
feature appends, and commit verification. All zip entries stay ZIP_STORED
(Gecko memory-maps omni.ja). Rewritten entries keep their timestamps and
unix mode; new entries get 0644.
"""

from __future__ import annotations

import shutil
import zipfile
from pathlib import Path

from .assets import PatchPayloads
from .constants import OMNI_JA, ROOT_OMNI_JA, WORKSPACES_XHTML_PATH
from .injectors.base import Injector, PatchCounts
from .injectors.brand import BrandStringsInjector
from .injectors.features import (
    ArchiveInjector,
    PaletteInjector,
    TabrenameInjector,
    TextpickInjector,
    ThemeInjector,
    WorkspacesInjector,
)
from .injectors.logos import LogoInjector
from .injectors.toolbar import ToolbarDefaultsInjector
from .injectors.xhtml import XhtmlInjector
from .omni import atomic_ja_temp, normalize_omni_ja

LEAGCY_LOG_FIELDS = (
    "brand.ftl",
    "brandings.ftl",
    "sync-brand.ftl",
    "brand.properties",
    "brand.dtd",
    "logos",
    "browser.xhtml",
    "workspaces.js",
    "theme.css",
    "palette.js",
    "palette.css",
    "textpick files (controller/shared/child/parent)",
    "archive.js",
    "archive-shared.js",
    "archive page files (html/css/page)",
    "tabrename.js",
)


class BrandPatcher:
    """Patch one omni.ja from its pristine backup."""

    def __init__(self, ja_path: Path, payloads: PatchPayloads) -> None:
        self.ja_path = ja_path
        self.payloads = payloads
        brand = BrandStringsInjector(
            payloads.brand_ftl_data,
            payloads.brandings_ftl_data,
            payloads.sync_ftl_data,
        )
        logos = LogoInjector(payloads.logos)
        features: list[Injector] = [
            WorkspacesInjector(payloads.workspaces_js),
            ThemeInjector(payloads.theme_css),
            PaletteInjector(payloads.palette_js, payloads.palette_css),
            TextpickInjector(payloads.textpick_js, payloads.textpick_files),
            ArchiveInjector(
                payloads.archive_js,
                payloads.archive_shared_js,
                payloads.archive_page_files,
            ),
            TabrenameInjector(payloads.tabrename_js),
        ]
        self._replace_injectors: list[Injector] = [brand, logos, ToolbarDefaultsInjector()]
        self._feature_injectors: list[Injector] = features
        self._xhtml = XhtmlInjector(features)
        # Brand/string + logo + toolbar-defaults replacements run for every
        # entry; xhtml injection only touches browser.xhtml (handled inline
        # in patch()).
        self._counts = PatchCounts()

    @property
    def counts(self) -> PatchCounts:
        return self._counts

    def ensure_pristine(self) -> Path:
        """Pin a pristine backup on first run; normalize it; return its path.

        ALWAYS reads from the pristine backup to prevent cascading corruption.
        """
        backup = self.ja_path.with_suffix(".ja.bak")
        if not backup.exists():
            shutil.copy2(self.ja_path, backup)
            print(f"Created pristine backup: {backup}")

        # Firefox ships omni.ja in optimized CD-first layout which zipfile can't
        # read. Normalize the backup to standard ZIP (Firefox reads both layouts).
        normalize_omni_ja(backup)
        return backup

    @staticmethod
    def _write_stored(
        zout: zipfile.ZipFile,
        filename: str,
        data: bytes,
    ) -> None:
        info = zipfile.ZipInfo(filename=filename)
        info.compress_type = zipfile.ZIP_STORED
        # Regular file with 0644 perms
        info.external_attr = 0o644 << 16
        zout.writestr(info, data)

    def patch(self) -> PatchCounts:
        counts = PatchCounts()
        self._counts = counts
        src_ja = self.ensure_pristine()

        with atomic_ja_temp(self.ja_path) as tmp_path:
            with (
                zipfile.ZipFile(src_ja, "r") as zin,
                zipfile.ZipFile(tmp_path, "w", compression=zipfile.ZIP_STORED) as zout,
            ):
                existing = set(zin.namelist())
                for info in zin.infolist():
                    data = zin.read(info.filename)

                    for injector in self._replace_injectors:
                        data = injector.replace_existing(info.filename, data, counts)

                    if info.filename == WORKSPACES_XHTML_PATH:
                        data, changed = self._xhtml.inject(data)
                        if changed:
                            counts.xhtml += 1

                    new_info = zipfile.ZipInfo(
                        filename=info.filename,
                        date_time=info.date_time,
                    )
                    new_info.compress_type = zipfile.ZIP_STORED
                    new_info.external_attr = info.external_attr
                    zout.writestr(new_info, data)

                # Append feature payloads (browser omni only).
                if WORKSPACES_XHTML_PATH in existing:
                    for injector in self._feature_injectors:
                        for ja_path, payload in injector.new_entries(existing, counts):
                            if ja_path not in existing:
                                self._write_stored(zout, ja_path, payload)
                                existing.add(ja_path)

            shutil.move(str(tmp_path), str(self.ja_path))

        # Fail loud on corrupt output or silently unbranded output (e.g.
        # Firefox changed omni.ja layout/paths in an upgrade).
        bad = zipfile.ZipFile(self.ja_path).testzip()
        if bad is not None:
            raise ValueError(f"corrupt entry after patch: {bad}")
        if (
            counts.brand == 0
            and counts.brandings == 0
            and counts.sync == 0
            and counts.props == 0
            and counts.dtd == 0
        ):
            raise ValueError("0 brand files replaced — layout changed?")
        return counts

    @classmethod
    def discover_targets(cls) -> list[Path]:
        return [p for p in (OMNI_JA, ROOT_OMNI_JA) if p.is_file()]

    @classmethod
    def format_summary(cls, ja_path: Path, counts: PatchCounts) -> str:
        try:
            from .constants import ROOT

            display = str(ja_path.relative_to(ROOT))
        except ValueError:
            display = str(ja_path)
        values = counts.as_tuple()
        assert len(values) == len(LEAGCY_LOG_FIELDS)
        # Keep the historical human-readable shape (tests/CI grep for it).
        return (
            f"Rebranded {display}: "
            f"{counts.brand} brand.ftl, {counts.brandings} brandings.ftl, "
            f"{counts.sync} sync-brand.ftl, "
            f"{counts.props} brand.properties, {counts.dtd} brand.dtd, "
            f"{counts.logos} logos, "
            f"{counts.xhtml} browser.xhtml, {counts.wsjs} workspaces.js, "
            f"{counts.css} theme.css, "
            f"{counts.paljs} palette.js, {counts.palcss} palette.css, "
            f"{counts.textpick} textpick files (controller/shared/child/parent), "
            f"{counts.archivejs} archive.js, {counts.archiveshared} archive-shared.js, "
            f"{counts.archivepage} archive page files (html/css/page), "
            f"{counts.tabrenamejs} tabrename.js"
        )
