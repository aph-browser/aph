"""Window-manager / tab-favicon icon slicing (Pillow)."""

from __future__ import annotations

import io
from pathlib import Path

from PIL import Image

from .constants import BRANDING_DIR, ICON_SIZES, ICONS_DIR

# Sizes at/below this read the small master (same geometry, heavier
# strokes — subpixel outlines vanish at 16px); larger sizes read the
# full master. Render both with: just render-logo
SMALL_CUTOFF = 32


def _resolve(given: Path | None, *candidates: Path) -> Path | None:
    if given is not None and given.is_file():
        return given
    for cand in candidates:
        if cand.is_file():
            return cand
    return None


def slice_icons(
    master: Path | None = None,
    small: Path | None = None,
    out_dir: Path | None = None,
) -> dict[int, bytes]:
    """Slice branding logos into 16/32/48/64/128 PNGs using Pillow.

    Saves to disk for the OS/WM and returns in-memory bytes for omni.ja.
    Prefers aph.png (canonical Aph source) with fallback to logo.png;
    small sizes prefer aph-small.png with fallback to the master.
    Paths are injectable for tests; defaults preserve the live behavior.
    """
    master_src = _resolve(master, BRANDING_DIR / "aph.png", BRANDING_DIR / "logo.png")
    if master_src is None:
        print(f"WARNING: {BRANDING_DIR / 'aph.png'} not found, skipping icon slicing.")
        return {}
    small_src = _resolve(small, BRANDING_DIR / "aph-small.png") or master_src
    dest = out_dir or ICONS_DIR
    dest.mkdir(parents=True, exist_ok=True)
    rendered_buffers: dict[int, bytes] = {}

    try:
        with Image.open(master_src) as master_im, Image.open(small_src) as small_im:
            master_im = master_im.convert("RGBA")
            small_im = small_im.convert("RGBA")
            for size in ICON_SIZES:
                src = small_im if size <= SMALL_CUTOFF else master_im
                resized = src.resize((size, size), Image.LANCZOS)

                # 1. Save to disk for window manager / desktop frame
                dst = dest / f"default{size}.png"
                resized.save(dst, format="PNG", optimize=True)

                # 2. Keep in memory for omni.ja injection
                buf = io.BytesIO()
                resized.save(buf, format="PNG", optimize=True)
                rendered_buffers[size] = buf.getvalue()
                print(f"  sliced {size}x{size} -> default{size}.png & icon{size}.png")

        return rendered_buffers
    except Exception as e:
        print(f"ERROR slicing icons: {e}")
        return {}
