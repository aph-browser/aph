"""Profile cache clearing so branding changes show immediately."""

from __future__ import annotations

import shutil

from .constants import PROFILE_DIR, ROOT


def clear_startup_cache() -> None:
    """Clear profile caches and favicon database so branding changes show immediately."""
    if not PROFILE_DIR.is_dir():
        return

    # Clear Gecko startup caches
    for sub in ["startupCache", "cache2", "shader-cache"]:
        p = PROFILE_DIR / sub
        if p.exists():
            shutil.rmtree(p, ignore_errors=True)
            print(f"Cleared {p.relative_to(ROOT)}")

    # Clear SQLite favicon cache (CRUCIAL for sidebar tab icon!)
    for fav in [
        "favicons.sqlite",
        "favicons.sqlite-wal",
        "favicons.sqlite-shm",
    ]:
        p = PROFILE_DIR / fav
        if p.exists():
            p.unlink(missing_ok=True)
            print(f"Cleared favicon cache: {fav}")

    marker = PROFILE_DIR / ".purgecache_done"
    if marker.exists():
        marker.unlink(missing_ok=True)
