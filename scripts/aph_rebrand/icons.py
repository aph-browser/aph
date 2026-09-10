"""Window-manager / tab-favicon icon slicing (Pillow)."""

from __future__ import annotations

import io

from PIL import Image

from .constants import BRANDING_DIR, ICON_SIZES, ICONS_DIR


def slice_icons() -> dict[int, bytes]:
    """Slice branding logo into 16/32/48/64/128 PNGs using Pillow.

    Saves to disk for the OS/WM and returns in-memory bytes for omni.ja.
    Prefers aph.png (canonical Aph source) with fallback to logo.png.
    """
    # Canonical is aph.png, fallback to logo.png for backwards compat
    src = BRANDING_DIR / "aph.png"
    if not src.is_file():
        src = BRANDING_DIR / "logo.png"
        if not src.is_file():
            print(f"WARNING: {BRANDING_DIR / 'aph.png'} not found, skipping icon slicing.")
            return {}

    ICONS_DIR.mkdir(parents=True, exist_ok=True)
    rendered_buffers: dict[int, bytes] = {}

    try:
        with Image.open(src) as im:
            im = im.convert("RGBA")
            for size in ICON_SIZES:
                resized = im.resize((size, size), Image.LANCZOS)

                # 1. Save to disk for window manager / desktop frame
                dst = ICONS_DIR / f"default{size}.png"
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
