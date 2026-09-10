"""Brand string replacements (FTL / properties / DTD)."""

from __future__ import annotations

from ..constants import BRAND_DTD_TEMPLATE, BRAND_PROPERTIES_TEMPLATE
from .base import PatchCounts


class BrandStringsInjector:
    name = "brand-strings"

    def __init__(
        self,
        brand_ftl_data: bytes,
        brandings_ftl_data: bytes,
        sync_ftl_data: bytes,
    ) -> None:
        self._brand_ftl_data = brand_ftl_data
        self._brandings_ftl_data = brandings_ftl_data
        self._sync_ftl_data = sync_ftl_data

    def xhtml_tags(self) -> list[str]:
        return []

    def replace_existing(self, filename: str, data: bytes, counts: PatchCounts) -> bytes:
        # Surgical replacements — sync-brand before brand (suffix overlap).
        fname = filename.lower()
        if fname.endswith("sync-brand.ftl"):
            counts.sync += 1
            return self._sync_ftl_data
        if fname.endswith("brand.ftl"):
            counts.brand += 1
            return self._brand_ftl_data
        if fname.endswith("brandings.ftl"):
            counts.brandings += 1
            return self._brandings_ftl_data
        if fname.endswith("brand.properties"):
            counts.props += 1
            return BRAND_PROPERTIES_TEMPLATE.encode("utf-8")
        if fname.endswith("brand.dtd"):
            counts.dtd += 1
            return BRAND_DTD_TEMPLATE.encode("utf-8")
        return data

    def new_entries(self, existing: set[str], counts: PatchCounts) -> list[tuple[str, bytes]]:
        return []
