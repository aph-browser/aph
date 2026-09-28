"""Logo adoption: PNG masters render from aph.svg geometry, wordmark is a lockup.

Guards the grid-mark migration: committed PNGs must equal fresh renders
(hand-edits drift silently), the render geometry must match the SVG
source, the master must read as the dark grid (never the legacy flame),
small sizes must slice from the heavier small master, and the wordmark
must keep its theming discipline.
"""

import io
import re
from pathlib import Path

from PIL import Image

from scripts.render_logo import GEOMETRY, OUTPUTS, render

ROOT = Path(__file__).resolve().parent.parent
BRANDING = ROOT / "branding"


def _png_bytes(size: int, stroke_key: str) -> bytes:
    buf = io.BytesIO()
    render(size, GEOMETRY[stroke_key]).save(buf, format="PNG", optimize=True)
    return buf.getvalue()


def test_renders_match_committed() -> None:
    """Every committed logo PNG equals a fresh render (no hand-edits)."""
    for rel, size, stroke_key in OUTPUTS:
        target = ROOT / rel
        assert target.is_file(), f"{rel} missing — run: just render-logo"
        assert target.read_bytes() == _png_bytes(size, stroke_key), f"{rel} stale"


def test_geometry_matches_svg_source() -> None:
    """GEOMETRY mirrors branding/aph.svg rect-for-rect (single source of truth)."""
    svg = (BRANDING / "aph.svg").read_text(encoding="utf-8")
    rects = re.findall(r"<rect\s+([^/]*)/>", svg)
    assert len(rects) == 5, f"aph.svg must hold container + 4 cells, got {len(rects)}"

    def attrs(tag: str) -> dict[str, str]:
        return dict(re.findall(r'(\w[\w-]*)="([^"]*)"', tag))

    base = attrs(rects[0])
    assert base["width"] == base["height"] == str(GEOMETRY["size"])
    assert base["rx"] == str(GEOMETRY["base_rx"])
    assert base["fill"] == GEOMETRY["base_fill"]

    cells = [attrs(tag) for tag in rects[1:]]
    assert [c["width"] for c in cells] == [str(GEOMETRY["cell"])] * 4
    assert [c["rx"] for c in cells] == [str(GEOMETRY["cell_rx"])] * 4
    home_x, home_y, far = (str(v) for v in GEOMETRY["cell_xy"])
    assert [(c["x"], c["y"]) for c in cells] == [
        (home_x, home_y),
        (far, home_y),
        (home_x, far),
        (far, far),
    ]
    assert cells[0]["fill"] == GEOMETRY["ink"]
    for cell in cells[1:]:
        assert cell["stroke"] == GEOMETRY["ink"]
        assert cell["stroke-width"] == str(GEOMETRY["stroke"])


def _channel_means(path: Path) -> tuple[float, float, float, float]:
    """(mean luminance, mean R, mean G, mean B) over RGB pixels."""
    rgb = Image.open(path).convert("RGB")
    px = list(rgb.get_flattened_data())
    n = len(px)
    mean_r = sum(p[0] for p in px) / n
    mean_g = sum(p[1] for p in px) / n
    mean_b = sum(p[2] for p in px) / n
    lum = 0.2126 * mean_r + 0.7152 * mean_g + 0.0722 * mean_b
    return lum, mean_r, mean_g, mean_b


def test_master_is_grid_not_flame() -> None:
    """The shipped master reads as the dark grid: low luminance, no red
    dominance (the legacy flame was red-dominant), and a real ink cell
    (filled home workspace, ~7% of pixels)."""
    lum, mean_r, mean_g, _mean_b = _channel_means(BRANDING / "aph.png")
    assert lum < 70, f"master too bright for the dark grid: {lum:.1f}"
    assert -10 < (mean_r - mean_g) < 25, "master is red-dominant like the legacy flame"
    rgb = Image.open(BRANDING / "aph.png").convert("RGB")
    ink = sum(1 for p in rgb.get_flattened_data() if p[0] > 200 and p[1] > 200 and p[2] > 200)
    assert ink / (rgb.width * rgb.height) > 0.05, "filled home cell went missing"


def test_small_master_has_heavier_strokes() -> None:
    """Same geometry, heavier weight for subpixel sizes — and shipped."""
    assert GEOMETRY["small_stroke"] > GEOMETRY["stroke"]
    assert (BRANDING / "aph-small.png").is_file()
    small = render(512, GEOMETRY["small_stroke"])
    master = render(512, GEOMETRY["stroke"])

    def ink_count(im: Image.Image) -> int:
        return sum(1 for p in im.convert("RGB").get_flattened_data() if p[0] > 200)

    assert ink_count(small) > ink_count(master)


def test_small_sizes_slice_from_small_master(tmp_path: Path) -> None:
    """16/32 favicons come from aph-small.png, larger from aph.png."""
    from scripts.aph_rebrand.icons import SMALL_CUTOFF, slice_icons

    red, blue = (230, 30, 30, 255), (20, 120, 255, 255)
    small_src, master_src = tmp_path / "small.png", tmp_path / "master.png"
    Image.new("RGBA", (256, 256), red).save(small_src)
    Image.new("RGBA", (256, 256), blue).save(master_src)
    out = tmp_path / "icons"

    bufs = slice_icons(master=master_src, small=small_src, out_dir=out)
    assert set(bufs) == {16, 32, 48, 64, 128}

    def is_red(data: bytes) -> bool:
        p = Image.open(io.BytesIO(data)).convert("RGB").get_flattened_data()
        px = list(p)
        return sum(x[0] for x in px) / len(px) > sum(x[2] for x in px) / len(px)

    for size, data in bufs.items():
        assert is_red(data) == (size <= SMALL_CUTOFF), f"{size}px sliced from wrong master"
    assert (out / "default16.png").is_file()


def test_wordmark_is_name_only_and_theme_safe() -> None:
    """about-wordmark.svg carries ONLY the name: Activity Stream renders
    .logo (the mark) + .wordmark side by side, so a lockup here doubles
    the mark (seen live). The theming discipline stays: no style rules
    or media queries (themes recolor the name via context-fill), and the
    width stays pinned via textLength (never font metrics)."""
    svg = (BRANDING / "about-wordmark.svg").read_text(encoding="utf-8")
    assert "<rect" not in svg, "wordmark must not repeat the grid mark"
    assert ">Aph</text>" in svg, "wordmark must carry the name"
    markup = re.sub(r"<!--.*?-->", "", svg, flags=re.S)
    assert "<style" not in markup, "style rules would outrank theme colors"
    assert "@media" not in markup, "media queries would pin one fixed color"
    assert "context-fill" in svg
    assert "textLength" in svg
