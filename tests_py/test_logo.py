"""Logo adoption: PNG masters render from aph.svg geometry, wordmark is a lockup.

Guards the font-A mark: committed PNGs must equal fresh renders
(hand-edits drift silently), the render font must match the SVG source
(same Inter 700 file, size, and centering), the logo must wear the
product palette's own stops, the master must read as the black tile
(never the legacy flame), the counter must stay open at 16px, and the
wordmark must keep its theming discipline.
"""

import io
import re
from pathlib import Path

from PIL import Image

from scripts.render_logo import GEOMETRY, OUTPUTS, load_font, render

ROOT = Path(__file__).resolve().parent.parent
BRANDING = ROOT / "branding"
TOKENS = BRANDING / "tokens.css"


def _png_bytes(size: int) -> bytes:
    buf = io.BytesIO()
    render(size).save(buf, format="PNG", optimize=True)
    return buf.getvalue()


def _size_of(rel: str) -> int:
    for name, size in OUTPUTS:
        if name == rel:
            return size
    raise AssertionError(f"{rel} not in OUTPUTS")


def test_renders_match_committed() -> None:
    """Every committed logo PNG equals a fresh render (no hand-edits)."""
    for rel, _size in OUTPUTS:
        target = ROOT / rel
        assert target.is_file(), f"{rel} missing — run: just render-logo"
        assert target.read_bytes() == _png_bytes(_size_of(rel)), f"{rel} stale"


def test_geometry_matches_svg_source() -> None:
    """GEOMETRY mirrors branding/aph.svg (single source).

    The SVG is one tile rect plus a hairline ring rect plus a single
    <text>A</text> in Inter Bold, centered, plus the apex-cut rect (a
    tile-colored subtraction over the live glyph — the one ownable
    move). The font file, size, weight, and centering must equal the
    Pillow render inputs — a render change without an SVG change (or
    the reverse) is drift. The <text> fallback stack is deliberate:
    chrome SVGs don't get page @font-face, so systems without Inter
    fall back to system bold, still centered via text-anchor.
    """
    svg = (BRANDING / "aph.svg").read_text(encoding="utf-8")
    rects = re.findall(r"<rect\s+([^/]*)/>", svg)
    assert len(rects) == 3, (
        f"aph.svg must hold tile + hairline + apex-cut rects, got {len(rects)} rects"
    )

    def attrs(tag: str) -> dict[str, str]:
        return dict(re.findall(r'([\w-]+)="([^"]*)"', tag))

    base = attrs(rects[0])
    assert base["width"] == base["height"] == str(GEOMETRY["size"])
    assert base["rx"] == str(GEOMETRY["base_rx"])
    assert base["fill"] == "url(#aphTile)", "tile must wear the near-black gradient"

    ring = attrs(rects[1])
    assert ring["fill"] == "none", "hairline must not fill"
    assert "stroke" in ring, "hairline must carry a light stroke"

    cut = attrs(rects[2])
    cut_keys = {"x": "apex_cut_x", "y": "apex_cut_y", "width": "apex_cut_w", "height": "apex_cut_h"}
    for attr, key in cut_keys.items():
        assert cut[attr] == str(GEOMETRY[key]), f"apex-cut {key} drifted from GEOMETRY"
    assert cut["fill"] == GEOMETRY["base_top"], "cut must be tile-colored (subtraction, not a mark)"
    assert int(cut["x"]) + int(cut["width"]) // 2 == GEOMETRY["text_x"], (
        "cut must center on the letter"
    )
    # The cut must start above the live apex ink and bite into it —
    # measured from the same font file (a font swap re-anchors this, so
    # the placement can never silently float off the letter).
    from PIL import ImageDraw

    size = GEOMETRY["size"]
    probe = Image.new("L", (size, size), 0)
    ImageDraw.Draw(probe).text(
        (GEOMETRY["text_x"], GEOMETRY["text_y"]),
        "A",
        font=load_font(GEOMETRY["font_size"]),
        fill=255,
        anchor="mm",
    )
    apex_top = probe.getbbox()[1]
    assert int(cut["y"]) < apex_top < int(cut["y"]) + int(cut["height"]), (
        "cut must start above the apex ink and bite into it"
    )

    texts = re.findall(r"<text\s+([^>]*)>([^<]*)</text>", svg)
    assert len(texts) == 1, f"aph.svg must hold one letter text, got {len(texts)}"
    t_attrs, t_body = texts[0]
    t = attrs(t_attrs)
    assert t_body == "A", f"logo text must be a plain A, got {t_body!r}"
    assert t["x"] == str(GEOMETRY["text_x"])
    assert t["y"] == str(GEOMETRY["text_y"])
    assert t["font-size"] == str(GEOMETRY["font_size"])
    assert t["font-weight"] == str(GEOMETRY["font_weight"])
    assert GEOMETRY["font_family"] in t["font-family"], "logo must set the Inter stack"
    assert t["text-anchor"] == "middle", "fallback fonts must stay centered"
    assert t["fill"] == "url(#aphA)", "letter must wear the flat purple"

    font_path = ROOT / GEOMETRY["font_file"]
    assert font_path.is_file(), f"{GEOMETRY['font_file']} missing"
    font = load_font(GEOMETRY["font_size"])
    assert font.getname()[0] == GEOMETRY["font_family"]
    assert font.getbbox("A")[3] > font.getbbox("A")[1], "font must rasterize the A"


def test_svg_stops_are_product_palette() -> None:
    """The logo wears the palette's own stops — zero proprietary colour,
    so it can never drift from the product again."""
    svg = (BRANDING / "aph.svg").read_text(encoding="utf-8")
    stops = set(re.findall(r'stop-color="(#[0-9a-fA-F]{6})"', svg))
    assert stops == {
        GEOMETRY["base_top"],
        GEOMETRY["base_bottom"],
        GEOMETRY["grad_top"],
        GEOMETRY["grad_bottom"],
    }, f"logo stops must be the GEOMETRY stops, got {sorted(stops)}"
    tokens = TOKENS.read_text(encoding="utf-8")
    for hexval in (GEOMETRY["grad_top"], GEOMETRY["grad_bottom"]):
        assert hexval in tokens, f"{hexval} must live in tokens.css (palette-owned)"


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


def _is_letter(p: tuple[int, int, int]) -> bool:
    """Purple letter pixel: blue high, red mid, green low (tile is black)."""
    return p[2] > 130 and p[0] > 60 and p[2] > p[1] + 30


def test_master_is_grid_not_flame() -> None:
    """The shipped master reads as the near-black tile: low luminance, no red
    dominance (the legacy flame was red-dominant), and a real accent
    letter (flat purple, a meaningful share of pixels)."""
    lum, mean_r, mean_g, _mean_b = _channel_means(BRANDING / "aph.png")
    assert lum < 80, f"master too bright for the black tile: {lum:.1f}"
    assert -20 < (mean_r - mean_g) < 60, "master is red-dominant like the legacy flame"
    rgb = Image.open(BRANDING / "aph.png").convert("RGB")
    purple = sum(1 for p in rgb.get_flattened_data() if _is_letter(p))
    assert purple / (rgb.width * rgb.height) > 0.05, "accent letter went missing"


def test_apex_cut_is_flat_and_centered() -> None:
    """The subtraction leaves a level flat top, centered on the letter.

    Topmost ink row lands at the cut bottom (not the old apex tip),
    spans roughly the GEOMETRY flat width, and centers on the glyph —
    the signature survives as geometry, not wishful rendering. At 16px
    the apex column stays dark tile with the flat reading just below,
    so the cut registers even at favicon size.
    """
    im = render(GEOMETRY["size"]).convert("RGB")
    px = im.load()
    size = GEOMETRY["size"]
    top = next(y for y in range(size) if any(_is_letter(px[x, y]) for x in range(size)))
    xs = [x for x in range(size) if _is_letter(px[x, top])]
    flat, left, right = max(xs) - min(xs) + 1, min(xs), max(xs)
    assert abs(top - (GEOMETRY["apex_cut_y"] + GEOMETRY["apex_cut_h"])) <= 1, (
        f"topmost ink must sit at the cut bottom, got row {top}"
    )
    assert abs(flat - GEOMETRY["apex_cut_flat"]) <= 4, (
        f"flat must span ~{GEOMETRY['apex_cut_flat']}px, got {flat}"
    )
    assert abs((left + right) / 2 - GEOMETRY["text_x"]) <= 3, "flat must center on the letter"

    tiny = render(512).resize((16, 16), Image.LANCZOS).convert("RGB")
    t = tiny.load()
    assert not _is_letter(t[8, 2]), f"apex column must stay dark tile at 16px: {t[8, 2]}"
    assert _is_letter(t[8, 4]), f"flat must read just below at 16px: {t[8, 4]}"


def test_small_master_opens_the_counter() -> None:
    """The hinted font keeps the counter open at 16px: downscale the
    master render and require a dark counter pixel where the letter
    has ink around it."""
    assert (BRANDING / "aph-small.png").is_file()
    tiny = render(512).resize((16, 16), Image.LANCZOS).convert("RGB")
    px = tiny.load()
    # Inter Bold A at 16px: counter void sits just above center,
    # legs flank it, crossbar row below is solid ink.
    assert not _is_letter(px[7, 8]), f"counter closed at 16px: {px[7, 8]}"
    assert _is_letter(px[5, 10]), f"left leg missing at 16px: {px[5, 10]}"
    assert _is_letter(px[10, 10]), f"right leg missing at 16px: {px[10, 10]}"


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
