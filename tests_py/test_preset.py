"""Theme presets: frozen Aph rooms picked in Settings → Appearance.

Each preset redefines ONLY the room ladder every surface already reads
(presets are data, never paint code). Absent/invalid reads as auto —
the prefers-color-scheme faces own the room again. Every room clears
the house gates: ink 7:1+, dim 4.5:1+ vs base, all sixteen hues at pill
45% and tab 28% — computed here with the same math as
test_theme_css, never eyeballed.
"""

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TOKENS = ROOT / "branding" / "tokens.css"
PAGE_JS = ROOT / "branding" / "settings-page.js"

PRESETS = ("midnight", "paper", "nord", "mocha", "espresso")
LADDER = (
    "--aph-base",
    "--aph-surface",
    "--aph-field",
    "--aph-urlbar-bg",
    "--aph-raised",
    "--aph-ink",
    "--aph-ink-dim",
    "--aph-ink-faint",
    "--aph-line",
)


def _preset_blocks() -> dict:
    css = TOKENS.read_text(encoding="utf-8")
    blocks = {}
    for m in re.finditer(r':root\[data-aph-preset="([a-z]+)"\]\s*\{([^}]*)\}', css):
        blocks[m.group(1)] = m.group(2)
    return blocks


def test_preset_blocks_exist_after_faces() -> None:
    css = TOKENS.read_text(encoding="utf-8")
    light = css.find("@media (prefers-color-scheme: light)")
    assert light != -1
    for preset in PRESETS:
        sel = f':root[data-aph-preset="{preset}"]'
        head = css.find(sel)
        assert head != -1, f"missing preset block: {preset}"
        assert head > light, f"{preset} must come after the faces (ties break late)"


def test_preset_blocks_redefine_the_full_ladder() -> None:
    blocks = _preset_blocks()
    assert set(blocks) == set(PRESETS), f"expected {PRESETS}, found {sorted(blocks)}"
    for preset, body in blocks.items():
        for token in LADDER:
            assert f"{token}:" in body, f"{preset}: ladder gap — {token} missing"
        assert "color-scheme:" in body, f"{preset}: native controls must follow the room"
        # Rooms only: a preset may CONSUME a shared hue stop (nord/mocha
        # retune --aph-voice from room identity) but never DEFINE one.
        for pattern in (r"--aph-ws-\d+:\s*", r"--aph-color-[a-z]+:\s*"):
            assert not re.search(pattern, body), f"{preset}: defines a hue stop — rooms only"


def _hex_to_rgb(h: str) -> tuple:
    h = h.lstrip("#")
    return tuple(int(h[i : i + 2], 16) for i in (0, 2, 4))


def _srgb_mix(a: tuple, b: tuple, t: float) -> tuple:
    """Opaque presence math (see test_theme_css for the oklab note)."""
    return tuple(round(x * t + y * (1 - t)) for x, y in zip(a, b, strict=True))


def _rel_luminance(c: tuple) -> float:
    def f(v: float) -> float:
        v /= 255
        return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4

    r, g, b = (f(v) for v in c)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def _contrast(fg: tuple, bg: tuple) -> float:
    l1, l2 = sorted((_rel_luminance(fg), _rel_luminance(bg)), reverse=True)
    return (l1 + 0.05) / (l2 + 0.05)


def _hues() -> dict:
    tokens = TOKENS.read_text(encoding="utf-8")
    colors = dict(re.findall(r"--aph-color-([a-z]+):\s*(#[0-9a-fA-F]{6})", tokens))
    aliases = dict(re.findall(r"--aph-ws-([0-9]{1,2}):\s*var\(--aph-color-([a-z]+)\)", tokens))
    return {n: colors[aliases[n]] for n in aliases if aliases[n] in colors}


def test_preset_rooms_clear_gates() -> None:
    """Ink 7:1+, dim 4.5:1+ vs base; every hue at pill/tab spends —
    per preset, same math as the theme gates."""
    blocks = _preset_blocks()
    hues = _hues()
    assert len(hues) == 16
    for preset, body in blocks.items():
        base = _hex_to_rgb(re.search(r"--aph-base:\s*(#[0-9a-fA-F]{6})", body).group(1))
        ink = _hex_to_rgb(re.search(r"--aph-ink:\s*(#[0-9a-fA-F]{6})", body).group(1))
        dim = _hex_to_rgb(re.search(r"--aph-ink-dim:\s*(#[0-9a-fA-F]{6})", body).group(1))
        assert _contrast(ink, base) >= 7, f"{preset}: ink gate failed"
        assert _contrast(dim, base) >= 4.5, f"{preset}: dim gate failed"
        for n, hue in sorted(hues.items()):
            for spend, role in ((0.45, "pill"), (0.28, "tab")):
                fill = _srgb_mix(_hex_to_rgb(hue), base, spend)
                assert _contrast(ink, fill) >= 4.5, (
                    f"{preset}: ws{n} {role} presence failed — mute the room, never the hue"
                )


def test_preset_allowlists_agree() -> None:
    """One set, three spellings: the stamper allowlist, the settings
    options, and the tokens blocks must name the same presets. The
    mocha stamp bug was exactly this drift (settings offered it, the
    stamper rejected it, the attribute read null)."""
    module = (ROOT / "branding" / "src" / "workspaces" / "74-theme-preset.js").read_text(
        encoding="utf-8"
    )
    m = re.search(r"const THEME_PRESETS = \[([^\]]*)\]", module)
    assert m, "stamper allowlist missing"
    stamper = re.findall(r'"([a-z]+)"', m.group(1))
    js = PAGE_JS.read_text(encoding="utf-8")
    m2 = re.search(r"const THEME_PRESET_OPTIONS = \[([^\]]*)\]", js)
    assert m2, "settings options missing"
    settings_opts = re.findall(r'"([a-z]+)"', m2.group(1))
    assert [o for o in settings_opts if o != "auto"] == stamper, (
        f"settings {settings_opts} vs stamper {stamper}"
    )
    assert set(stamper) == set(_preset_blocks()), "stamper vs tokens blocks drifted"


def test_preset_pref_default_is_auto() -> None:
    config = (ROOT / "config" / "user.js").read_text(encoding="utf-8")
    assert 'user_pref("aph.theme.preset", "auto")' in config


def test_preset_module_ships_in_bundle() -> None:
    from scripts.build_assets import BUNDLES

    assert "workspaces/74-theme-preset.js" in BUNDLES["workspaces.js"]
    bundle = (ROOT / "branding" / "workspaces.js").read_text(encoding="utf-8")
    for needle in (
        "THEME_PRESET_PREF",
        "data-aph-preset",
        "AphThemePreset",
        "cleanupThemePreset",
    ):
        assert needle in bundle, f"bundle missing preset piece: {needle}"


def test_preset_settings_section_present() -> None:
    """Theme preset radios reuse the Appearance row dialect (no new CSS):
    five options in order, scheme pairing, sync-checked from the pref."""
    js = PAGE_JS.read_text(encoding="utf-8")
    for token in (
        "THEME_PRESET_PREF",
        "THEME_PRESET_OPTIONS",
        "THEME_PRESET_SCHEME",
        "readThemePreset",
        "writeThemePreset",
        "makePresetSection",
        '"aph-preset"',
        '"Theme preset"',
    ):
        assert token in js, f"preset settings wiring missing: {token}"
    assert '"aph.theme.preset"' in js
    for preset in PRESETS:
        assert f'"{preset}"' in js, f"preset option missing: {preset}"
    # Scheme pairing keeps art agreeing with the room.
    assert '"paper"' in js and '"light"' in js
    assert "writeAppearance" in js
