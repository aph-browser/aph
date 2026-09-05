#!/usr/bin/env python3
"""Bootstrap: download, verify, and extract Firefox into build/."""

import hashlib
import json
import platform
import shutil
import sys
import tempfile
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BUILD_DIR = ROOT / "build"
FIREFOX_DIR = BUILD_DIR / "firefox"

VERSION = "136.0"

MOZILLA_CDN = "https://download-installer.cdn.mozilla.net/pub/firefox/releases"
ARCH_MAP = {"x86_64": "linux-x86_64", "aarch64": "linux-aarch64", "amd64": "linux-x86_64", "arm64": "linux-aarch64"}


def detect_arch() -> str:
    machine = platform.machine()
    arch = ARCH_MAP.get(machine)
    if arch is None:
        sys.exit(f"Unsupported architecture: {machine}")
    return arch


def fetch_latest_version() -> str:
    url = "https://product-details.mozilla.org/1.0/firefox_versions.json"
    try:
        with urllib.request.urlopen(url) as resp:
            data = json.loads(resp.read())
            version = data["LATEST_FIREFOX_VERSION"]
            print(f"Latest release: {version}")
            return version
    except Exception as e:
        print(f"Warning: Failed to query latest version ({e}), using {VERSION}")
        return VERSION


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def fetch(version: str, arch: str) -> None:
    tarball_name = f"firefox-{version}.tar.xz"
    tarball_url = f"{MOZILLA_CDN}/{version}/{arch}/en-US/{tarball_name}"
    checksum_url = f"{MOZILLA_CDN}/{version}/SHA256SUMS"

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
        sha256sums = urllib.request.urlopen(checksum_url).read().decode()
        needle = f"{arch}/en-US/{tarball_name}"
        expected = None
        for line in sha256sums.splitlines():
            if needle in line:
                expected = line.split()[0]
                break
        if expected is None:
            sys.exit(f"Could not find checksum for {needle} in SHA256SUMS")

        actual = sha256(tarball)
        if actual != expected:
            sys.exit(f"Checksum mismatch!\n  expected: {expected}\n  actual:   {actual}")
        print(f"  {actual}")

        print("Extracting ...")
        BUILD_DIR.mkdir(parents=True, exist_ok=True)
        shutil.unpack_archive(str(tarball), str(tmp))
        extracted = tmp / "firefox"
        if not extracted.is_dir():
            sys.exit(f"Expected extracted directory {extracted} not found")

        if FIREFOX_DIR.exists():
            shutil.rmtree(FIREFOX_DIR)
        shutil.move(str(extracted), str(FIREFOX_DIR))

        binary = FIREFOX_DIR / "firefox"
        if binary.exists():
            binary.chmod(binary.stat().st_mode | 0o111)

    print(f"Firefox {version} ready at {FIREFOX_DIR}")


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser(description="Fetch Firefox release")
    parser.add_argument("version", nargs="?", default=VERSION, help=f"Release version (default: {VERSION})")
    parser.add_argument("--latest", action="store_true", help="Use latest release from Mozilla")
    args = parser.parse_args()

    if FIREFOX_DIR.is_dir():
        binary = FIREFOX_DIR / "firefox"
        if binary.exists():
            print(f"Firefox already present at {FIREFOX_DIR}")
            print("Remove build/firefox/ and re-run to upgrade, or pass a version argument.")
            return

    version = fetch_latest_version() if args.latest else args.version
    arch = detect_arch()
    print(f"Fetching Firefox {version} for {arch} ...")
    fetch(version, arch)


if __name__ == "__main__":
    main()
