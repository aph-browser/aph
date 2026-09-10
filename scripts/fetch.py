#!/usr/bin/env python3
"""Bootstrap: download, verify, and extract Firefox into build/."""

import hashlib
import json
import platform
import shutil
import subprocess
import sys
import tempfile
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BUILD_DIR = ROOT / "build"
FIREFOX_DIR = BUILD_DIR / "firefox"

VERSION = "155.0.1"

MOZILLA_CDN = "https://download-installer.cdn.mozilla.net/pub/firefox/releases"
ARCH_MAP = {
    "x86_64": "linux-x86_64",
    "aarch64": "linux-aarch64",
    "amd64": "linux-x86_64",
    "arm64": "linux-aarch64",
}
# Windows asset dirs on the same CDN (portable ZIPs, same layout inside).
WIN_ARCH_MAP = {
    "AMD64": "win64",
    "x86_64": "win64",
    "ARM64": "win64-aarch64",
    "arm64": "win64-aarch64",
    "aarch64": "win64-aarch64",
}


def is_windows() -> bool:
    return sys.platform == "win32"


def detect_arch() -> str:
    machine = platform.machine()
    arch = WIN_ARCH_MAP.get(machine) if is_windows() else ARCH_MAP.get(machine)
    if arch is None:
        sys.exit(f"Unsupported architecture: {machine} (platform {sys.platform})")
    return arch


def fetch_latest_version() -> str | None:
    url = "https://product-details.mozilla.org/1.0/firefox_versions.json"
    try:
        with urllib.request.urlopen(url, timeout=30) as resp:
            data = json.loads(resp.read())
            version = data["LATEST_FIREFOX_VERSION"]
            print(f"Latest release: {version}")
            return version
    except Exception as e:
        print(f"Warning: Failed to query latest version ({e})")
        return None


def installed_version() -> str | None:
    ini = FIREFOX_DIR / "application.ini"
    try:
        for line in ini.read_text().splitlines():
            if line.startswith("Version="):
                return line.split("=", 1)[1].strip()
    except OSError:
        pass
    return None


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def find_7z() -> str | None:
    """Locate a 7-Zip binary (needed to unpack the Windows installer exe)."""
    candidates = ("7z", "7z.exe", r"C:\Program Files\7-Zip\7z.exe")
    for cand in candidates:
        p = shutil.which(cand)
        if p:
            return p
    return None


def extract_windows_setup(setup_exe: Path, dest_dir: Path) -> Path:
    """Unpack the full installer exe (a 7z self-extractor holding `core/`).

    Returns the directory holding firefox.exe. Preinstalled on GitHub
    windows-latest runners; dev machines need 7-Zip (winget: 7zip.7zip).
    """
    seven_z = find_7z()
    if seven_z is None:
        sys.exit(
            "7-Zip not found: needed to unpack Firefox Setup on Windows.\n"
            "Install it (winget install 7zip.7zip) and re-run."
        )
    print(f"Extracting with {seven_z} ...")
    try:
        proc = subprocess.run(
            [seven_z, "x", str(setup_exe), f"-o{dest_dir}"],
            check=False,
            capture_output=True,
            text=True,
        )
    except OSError as e:
        sys.exit(f"Failed to run 7-Zip: {e}")
    if proc.returncode != 0:
        tail = ((proc.stdout or "") + (proc.stderr or ""))[-2000:]
        sys.exit(f"7-Zip extraction failed (exit {proc.returncode}):\n{tail}")
    for cand in (dest_dir / "core", dest_dir):
        if (cand / "firefox.exe").is_file():
            return cand
    top = sorted(p.name for p in dest_dir.iterdir())
    sys.exit(f"firefox.exe not found after extraction (top level: {top})")


def fetch(version: str, arch: str) -> None:
    # No portable ZIP on the CDN for Windows (only jsshell zips) — use the
    # full installer exe (a 7z self-extractor) and unpack its `core/` dir.
    # Both assets are covered by the release SHA256SUMS file.
    on_win = arch.startswith("win")
    asset_name = f"Firefox Setup {version}.exe" if on_win else f"firefox-{version}.tar.xz"
    asset_url = f"{MOZILLA_CDN}/{version}/{arch}/en-US/{urllib.parse.quote(asset_name)}"
    checksum_url = f"{MOZILLA_CDN}/{version}/SHA256SUMS"

    print(f"Downloading {asset_name} ...")
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        asset = tmp / asset_name

        req = urllib.request.Request(asset_url)
        with urllib.request.urlopen(req, timeout=30) as resp, open(asset, "wb") as f:
            total = resp.headers.get("Content-Length")
            downloaded = 0
            while True:
                chunk = resp.read(1 << 16)
                if not chunk:
                    break
                f.write(chunk)
                downloaded += len(chunk)
                if total:
                    pct = downloaded * 100 // int(total)
                    print(
                        f"\r  {downloaded // (1 << 20)}MB / {int(total) // (1 << 20)}MB ({pct}%)",
                        end="",
                        flush=True,
                    )
            print()

        print("Verifying checksum ...")
        sha256sums = urllib.request.urlopen(checksum_url, timeout=30).read().decode()
        needle = f"{arch}/en-US/{asset_name}"
        expected = None
        for line in sha256sums.splitlines():
            parts = line.split()
            if len(parts) >= 2 and parts[1] == needle:
                expected = parts[0]
                break
        if expected is None:
            # Fall back to substring match (older SUMS layouts)
            for line in sha256sums.splitlines():
                if needle in line:
                    expected = line.split()[0]
                    break
        if expected is None:
            sys.exit(f"Could not find checksum for {needle} in SHA256SUMS")

        actual = sha256(asset)
        if actual != expected:
            sys.exit(f"Checksum mismatch!\n  expected: {expected}\n  actual:   {actual}")
        print(f"  {actual}")

        print("Extracting ...")
        BUILD_DIR.mkdir(parents=True, exist_ok=True)
        if on_win:
            extracted = extract_windows_setup(asset, tmp / "winpkg")
        else:
            shutil.unpack_archive(str(asset), str(tmp))
            extracted = tmp / "firefox"
            if not extracted.is_dir():
                sys.exit(f"Expected extracted directory {extracted} not found")

        if FIREFOX_DIR.exists():
            shutil.rmtree(FIREFOX_DIR)
        shutil.move(str(extracted), str(FIREFOX_DIR))

        binary = FIREFOX_DIR / ("firefox.exe" if is_windows() else "firefox")
        if binary.exists():
            binary.chmod(binary.stat().st_mode | 0o111)

    print(f"Firefox {version} ready at {FIREFOX_DIR}")


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser(
        description="Fetch Firefox release (default: latest from Mozilla)"
    )
    parser.add_argument(
        "version", nargs="?", default=None, help="Pin a specific release version (default: latest)"
    )
    parser.add_argument(
        "--latest", action="store_true", help="Use latest release from Mozilla (default behavior)"
    )
    args = parser.parse_args()

    current = installed_version()
    binary_present = (FIREFOX_DIR / ("firefox.exe" if is_windows() else "firefox")).is_file()

    if args.version:
        version = args.version
    else:
        latest = fetch_latest_version()
        if latest is None:
            if binary_present and current:
                print(f"Offline: keeping installed Firefox {current} at {FIREFOX_DIR}")
                return
            print(f"Offline: falling back to {VERSION}")
            version = VERSION
        else:
            version = latest

    if binary_present and current == version:
        print(f"Firefox {current} already up to date at {FIREFOX_DIR}")
        return
    if binary_present and current:
        print(f"Upgrading Firefox {current} -> {version} ...")
    arch = detect_arch()
    print(f"Fetching Firefox {version} for {arch} ...")
    fetch(version, arch)


if __name__ == "__main__":
    main()
