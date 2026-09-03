#!/usr/bin/env python3
"""Bootstrap: download, verify, and extract LibreWolf into build/."""

import hashlib
import platform
import shutil
import sys
import tempfile
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BUILD_DIR = ROOT / "build"
LIBREWOLF_DIR = BUILD_DIR / "librewolf"

VERSION = "155.0-1"

CODEBERG_API = "https://codeberg.org/api/packages/librewolf/generic/librewolf"
ARCH_MAP = {"x86_64": "x86_64", "aarch64": "arm64", "amd64": "x86_64", "arm64": "arm64"}


def detect_arch() -> str:
    machine = platform.machine()
    arch = ARCH_MAP.get(machine)
    if arch is None:
        sys.exit(f"Unsupported architecture: {machine}")
    return arch


def fetch_latest_tag() -> str:
    url = "https://codeberg.org/api/v1/repos/librewolf/bsys6/releases/latest"
    try:
        with urllib.request.urlopen(url) as resp:
            data = resp.read()
            import json
            tag = json.loads(data)["tag_name"]
            print(f"Latest release: {tag}")
            return tag
    except Exception as e:
        sys.exit(f"Failed to query latest release: {e}")


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def fetch(version: str, arch: str) -> None:
    tarball_name = f"librewolf-{version}-linux-{arch}-package.tar.xz"
    tarball_url = f"{CODEBERG_API}/{version}/{tarball_name}"
    checksum_url = f"{tarball_url}.sha256sum"

    print(f"Downloading {tarball_name} ...")
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        tarball = tmp / tarball_name

        req = urllib.request.Request(tarball_url)
        with urllib.request.urlopen(req) as resp, open(tarball, "wb") as f:
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
                    print(f"\r  {downloaded // (1 << 20)}MB / {int(total) // (1 << 20)}MB ({pct}%)", end="", flush=True)
            print()

        print("Verifying checksum ...")
        expected = urllib.request.urlopen(checksum_url).read().decode().strip()
        actual = sha256(tarball)
        if actual != expected:
            sys.exit(f"Checksum mismatch!\n  expected: {expected}\n  actual:   {actual}")
        print(f"  {actual}")

        print("Extracting ...")
        BUILD_DIR.mkdir(parents=True, exist_ok=True)
        shutil.unpack_archive(str(tarball), str(tmp))
        extracted = tmp / "librewolf"
        if not extracted.is_dir():
            sys.exit(f"Expected extracted directory {extracted} not found")

        if LIBREWOLF_DIR.exists():
            shutil.rmtree(LIBREWOLF_DIR)
        shutil.move(str(extracted), str(LIBREWOLF_DIR))

        binary = LIBREWOLF_DIR / "librewolf"
        if binary.exists():
            binary.chmod(binary.stat().st_mode | 0o111)

    print(f"LibreWolf {version} ready at {LIBREWOLF_DIR}")


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser(description="Fetch LibreWolf release")
    parser.add_argument("version", nargs="?", default=VERSION, help=f"Release version (default: {VERSION})")
    parser.add_argument("--latest", action="store_true", help="Use latest release from Codeberg")
    args = parser.parse_args()

    if LIBREWOLF_DIR.is_dir():
        binary = LIBREWOLF_DIR / "librewolf"
        if binary.exists():
            print(f"LibreWolf already present at {LIBREWOLF_DIR}")
            print("Remove build/librewolf/ and re-run to upgrade, or pass a version argument.")
            return

    version = fetch_latest_tag() if args.latest else args.version
    arch = detect_arch()
    print(f"Fetching LibreWolf {version} for {arch} ...")
    fetch(version, arch)


if __name__ == "__main__":
    main()
