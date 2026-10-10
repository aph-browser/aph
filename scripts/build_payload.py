#!/usr/bin/env python3
"""Build the Aph update payload: the Aph-owned bytes of a release.

A release is stock Firefox plus branding. The Firefox base moves a few
times a year; the branding payload (chrome JS/CSS, pages, fonts, logos,
seeds) is where nearly every Aph change lands. This script packages
exactly that payload so installed launchers can self-update it without
re-downloading the base:

- omni.ja entries: added-or-changed vs the pristine ``.ja.bak`` backups
  the rebrand pins on first run (self-maintaining — future files ride
  along automatically, stock bytes can never leak in).
- profile seeds: config/user.js + the chrome CSS (the launchers' existing
  seed/seed-version machinery migrates profiles afterwards).

Output (``--out DIR``):

- ``aph-payload-<ver>.zip`` with ``manifest.json``,
  ``browser/...`` (firefox/browser/omni.ja entries),
  ``toolkit/...`` (firefox/omni.ja entries) and ``share/...`` (seeds).
- ``version.json``: the update channel — version, required Firefox base,
  asset names and hashes. Launchers fetch it from
  ``releases/latest/download/version.json`` (static URL, no API limits).

Policy (mirrored in packaging/aph-update.ps1, tested in
tests_py/test_payload.py):

- Replace-only: clients add or overwrite listed entries, never delete.
  A retired file lingers as dead bytes (nothing references it — the
  payload's own xhtml does), which beats deleting a stock path by
  mistake. No ``.bak``/pristine bytes ship: the payload is Aph-owned
  content only.
- Exact-base gate: the payload applies only when the installed Firefox
  base equals ``manifest.firefox`` (browser.xhtml bytes are computed
  against that base — a stale xhtml on a newer base could revert
  upstream fixes). Otherwise the launcher takes the full-installer path.

Usage:
    python scripts/build_payload.py --out build/payload-out
Requires a rebranded tree (``just rebrand`` first): fails loud when the
pristine ``.ja.bak`` files are missing.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from scripts.version import get_version  # noqa: E402

BUILD_FIREFOX = ROOT / "build" / "firefox"
BROWSER_OMNI = BUILD_FIREFOX / "browser" / "omni.ja"
TOOLKIT_OMNI = BUILD_FIREFOX / "omni.ja"
APP_INI = BUILD_FIREFOX / "application.ini"

SEEDS = (
    (ROOT / "config" / "user.js", "share/user.js"),
    (ROOT / "branding" / "userChrome.css", "share/userChrome.css"),
    (ROOT / "branding" / "userContent.css", "share/userContent.css"),
)

# Reproducible payload zips: fixed DOS timestamp on every entry.
_ZIP_DATE = (2020, 1, 1, 0, 0, 0)


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def diff_omni_entries(pristine: Path, branded: Path) -> list[tuple[str, bytes]]:
    """Added-or-changed entries of ``branded`` vs ``pristine`` (by bytes).

    Deterministic order (sorted names). Both inputs must be standard
    ZIPs — the rebrand normalizes Firefox's optimized layout on first
    run, so post-rebrand trees always qualify.
    """
    with zipfile.ZipFile(pristine, "r") as z0:
        old = {info.filename: z0.read(info.filename) for info in z0.infolist()}
    with zipfile.ZipFile(branded, "r") as z1:
        return [
            (info.filename, z1.read(info.filename))
            for info in sorted(z1.infolist(), key=lambda i: i.filename)
            if old.get(info.filename) != z1.read(info.filename)
        ]


def firefox_base_version(app_ini: Path = APP_INI) -> str:
    """Read ``Version=`` from the built Firefox's application.ini."""
    text = app_ini.read_text(encoding="utf-8", errors="replace")
    m = re.search(r"^Version=(.+)$", text, re.M)
    if not m:
        raise ValueError(f"{app_ini} has no Version= line")
    return m.group(1).strip()


def payload_applies(installed_firefox: str, required_firefox: str) -> bool:
    """Exact-base gate: the payload applies only on its build base.

    browser.xhtml bytes are computed against that base; anything else
    takes the full-installer path. Comparison is case/whitespace
    tolerant and nothing more — no ranges, no prefixes.
    """
    return installed_firefox.strip().lower() == required_firefox.strip().lower()


def compare_versions(a: str, b: str) -> int:
    """Compare dotted versions: -1 if a<b, 0 if equal, 1 if a>b.

    Leading ``v`` ignored, components numeric (``0.4.10`` beats
    ``0.4.3``), missing components are zero. Non-numeric tails are
    ignored (``1.0rc1`` compares as ``1.0``).
    """

    def parts(s: str) -> list[int]:
        s = s.strip().lstrip("vV")
        out = []
        for comp in s.split("."):
            m = re.match(r"\d+", comp)
            out.append(int(m.group(0)) if m else 0)
        return out

    pa, pb = parts(a), parts(b)
    n = max(len(pa), len(pb))
    pa += [0] * (n - len(pa))
    pb += [0] * (n - len(pb))
    return (pa > pb) - (pa < pb)


def build_payload(out_dir: Path) -> dict[str, Path]:
    """Assemble the payload zip + version.json into ``out_dir``."""
    for omni in (BROWSER_OMNI, TOOLKIT_OMNI):
        bak = omni.with_suffix(".ja.bak")
        if not omni.is_file():
            raise FileNotFoundError(f"{omni} missing — fetch a Firefox build first")
        if not bak.is_file():
            raise FileNotFoundError(f"{bak} missing — run `just rebrand` first")
    for src, _arc in SEEDS:
        if not src.is_file():
            raise FileNotFoundError(f"seed missing: {src}")
    return assemble_payload(
        BROWSER_OMNI,
        BROWSER_OMNI.with_suffix(".ja.bak"),
        TOOLKIT_OMNI,
        TOOLKIT_OMNI.with_suffix(".ja.bak"),
        APP_INI,
        list(SEEDS),
        get_version(),
        out_dir,
    )


def assemble_payload(
    browser_omni: Path,
    browser_pristine: Path,
    toolkit_omni: Path,
    toolkit_pristine: Path,
    app_ini: Path,
    seeds: list[tuple[Path, str]],
    aph_version: str,
    out_dir: Path,
) -> dict[str, Path]:
    """Pure assembly over explicit inputs (tests drive synthetic trees)."""
    fx_version = firefox_base_version(app_ini)

    files: list[dict] = []
    staged: list[tuple[str, bytes]] = []
    for ja, omni, pristine in (
        ("browser", browser_omni, browser_pristine),
        ("toolkit", toolkit_omni, toolkit_pristine),
    ):
        for arcname, data in diff_omni_entries(pristine, omni):
            staged.append((f"{ja}/{arcname}", data))
            files.append({"ja": ja, "path": arcname, "sha256": _sha256(data), "size": len(data)})
    for src, arc in seeds:
        data = src.read_bytes()
        staged.append((arc, data))
        files.append(
            {
                "ja": "share",
                "path": arc.split("/", 1)[1],
                "sha256": _sha256(data),
                "size": len(data),
            }
        )
    files.sort(key=lambda f: (f["ja"], f["path"]))

    manifest = {
        "format": 1,
        "aph_version": aph_version,
        "firefox": fx_version,
        "files": files,
    }
    zip_name = f"aph-payload-{aph_version}.zip"
    out_dir.mkdir(parents=True, exist_ok=True)
    zip_path = out_dir / zip_name
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as z:
        manifest_bytes = json.dumps(manifest, indent=2).encode("utf-8")
        info = zipfile.ZipInfo("manifest.json", date_time=_ZIP_DATE)
        info.compress_type = zipfile.ZIP_DEFLATED
        z.writestr(info, manifest_bytes)
        for arcname, data in sorted(staged):
            info = zipfile.ZipInfo(arcname, date_time=_ZIP_DATE)
            info.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(info, data)

    payload_bytes = zip_path.read_bytes()
    version = {
        "aph_version": aph_version,
        "firefox": fx_version,
        "payload": zip_name,
        "payload_sha256": _sha256(payload_bytes),
        "payload_size": len(payload_bytes),
        "installer": f"Aph-Setup-{aph_version}.exe",
        "notes": f"https://github.com/aph-browser/aph/releases/tag/v{aph_version}",
    }
    version_path = out_dir / "version.json"
    version_path.write_text(json.dumps(version, indent=2) + "\n", encoding="utf-8")

    print(f"payload: {zip_path} ({len(payload_bytes)} bytes, {len(files)} files)")
    print(f"channel: {version_path} (Aph {aph_version} on Firefox {fx_version})")
    return {"zip": zip_path, "version": version_path}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--out", required=True, help="output directory for payload zip + version.json"
    )
    args = parser.parse_args(argv)
    build_payload(Path(args.out))
    return 0


if __name__ == "__main__":
    sys.exit(main())
