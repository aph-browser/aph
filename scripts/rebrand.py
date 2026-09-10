#!/usr/bin/env python3
"""Rebrand Firefox omni.ja to Aph — thin CLI shim.

The implementation lives in :mod:`scripts.aph_rebrand` (BrandPatcher +
per-feature injectors). This module stays so existing entry points keep
working unchanged: ``just rebrand``, ``scripts/dev.py``, CI workflows,
and any external ``from scripts.rebrand import rebrand`` imports.
"""

from __future__ import annotations

import sys
from pathlib import Path

# Allow both entry styles: `python scripts/rebrand.py` (scripts/ on path)
# and `from scripts.rebrand import rebrand` (repo root on path, via dev.py).
try:
    from scripts.aph_rebrand import (
        BrandPatcher,
        PatchCounts,
        PatchPayloads,
        _inject_workspaces_script,
        _patch_single_ja,
        clear_startup_cache,
        is_optimized_omni_ja,
        normalize_omni_ja,
        patch_omni_ja,
        rebrand,
        slice_icons,
    )
except ImportError:  # pragma: no cover - direct-script fallback
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from aph_rebrand import (  # type: ignore[no-redef]
        BrandPatcher,
        PatchCounts,
        PatchPayloads,
        _inject_workspaces_script,
        _patch_single_ja,
        clear_startup_cache,
        is_optimized_omni_ja,
        normalize_omni_ja,
        patch_omni_ja,
        rebrand,
        slice_icons,
    )

__all__ = [
    "BrandPatcher",
    "PatchCounts",
    "PatchPayloads",
    "_inject_workspaces_script",
    "_patch_single_ja",
    "clear_startup_cache",
    "is_optimized_omni_ja",
    "normalize_omni_ja",
    "patch_omni_ja",
    "rebrand",
    "slice_icons",
]


if __name__ == "__main__":
    ok = rebrand()
    sys.exit(0 if ok else 1)
