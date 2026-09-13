#!/usr/bin/env python3
"""Generate Windows Package Manager (winget) manifests for an Aph release.

Reads the installer identity straight from the repo so manifests cannot
drift: ProductCode from ``packaging/aph.iss`` (Inno AppId), publisher and
minimum OS from the same file. URLs default to the GitHub release assets
(``Aph-Setup-<version>.exe`` under the ``v<version>`` tag); the SHA-256 can
be passed directly or looked up from a ``SHA256SUMS`` file.

Layout matches what ``winget-pkgs`` expects::

    python scripts/winget_manifest.py --version 0.1.0 \\
        --sums-file release/SHA256SUMS --out packaging/winget

then test-install locally before submitting::

    winget install --manifest packaging/winget/0.1.0

First submission is a manual PR to ``microsoft/winget-pkgs`` (see
``SUBMIT_STEPS``); later releases are ``wingetcreate update`` runs.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ISS = ROOT / "packaging" / "aph.iss"

PACKAGE_IDENTIFIER = "AphBrowser.Aph"
PACKAGE_NAME = "Aph"
PUBLISHER = "Aph Browser"
LICENSE = "MPL-2.0"
LICENSE_URL = "https://github.com/aph-browser/aph/blob/main/LICENSE"
RELEASES_URL = "https://github.com/aph-browser/aph/releases"
MINIMUM_OS = "10.0.0.0"
SHORT_DESCRIPTION = "Firefox-based, workspaces-first web browser"
DESCRIPTION = (
    "Aph is a Firefox-based, workspaces-first web browser: stock Firefox "
    "with native workspace management, a command palette, tab archiving, "
    "and hardened privacy defaults. Per-user install, no admin rights needed."
)
TAGS = ["browser", "firefox", "workspaces", "privacy"]
MANIFEST_VERSION = "1.6.0"

SUBMIT_STEPS = """\
1. Generate: python scripts/winget_manifest.py --version <ver> --sums-file release/SHA256SUMS
2. Validate: winget validate --manifest packaging/winget/<ver>
3. Test-install: winget install --manifest packaging/winget/<ver> -e
4. Fork microsoft/winget-pkgs, copy manifests/AphBrowser/Aph/<ver>/, open a PR.
5. Later releases: wingetcreate update AphBrowser.Aph -u <new-exe-url>
"""


def read_app_id(iss_path: Path = ISS) -> str:
    """Return the Inno AppId GUID (single braces) from packaging/aph.iss.

    Inno escapes a literal opening brace by doubling it, so the file
    carries ``AppId={{<guid>}`` (a lone ``}`` needs no escape) while the
    real identity (registry key, winget ProductCode) is ``{<guid>}``.
    """
    text = iss_path.read_text(encoding="utf-8")
    match = re.search(r"^AppId=\{\{([0-9a-fA-F-]{36})\}\s*$", text, re.MULTILINE)
    if not match:
        raise ValueError(f"AppId GUID not found in {iss_path}")
    return "{" + match.group(1).lower() + "}"


def installer_filename(version: str) -> str:
    return f"Aph-Setup-{version}.exe"


def installer_url(version: str, tag: str | None = None) -> str:
    tag = tag or f"v{version}"
    return f"{RELEASES_URL}/download/{tag}/{installer_filename(version)}"


def lookup_sha256(sums_file: Path, filename: str) -> str:
    """Extract the hex digest for ``filename`` from a SHA256SUMS file."""
    for line in sums_file.read_text(encoding="utf-8").splitlines():
        parts = line.strip().split()
        if len(parts) == 2 and parts[1].lstrip("*") == filename:
            digest = parts[0].lower()
            if re.fullmatch(r"[0-9a-f]{64}", digest):
                return digest
    raise ValueError(f"{filename} not found in {sums_file}")


def render_version(version: str) -> str:
    return f"""\
PackageIdentifier: {PACKAGE_IDENTIFIER}
PackageVersion: {version}
DefaultLocale: en-US
ManifestType: version
ManifestVersion: {MANIFEST_VERSION}
"""


def render_locale(version: str) -> str:
    tags = "\n".join(f"- {t}" for t in TAGS)
    return f"""\
PackageIdentifier: {PACKAGE_IDENTIFIER}
PackageVersion: {version}
PackageLocale: en-US
Publisher: {PUBLISHER}
PublisherUrl: {RELEASES_URL}
PackageName: {PACKAGE_NAME}
License: {LICENSE}
LicenseUrl: {LICENSE_URL}
ShortDescription: {SHORT_DESCRIPTION}
Description: {DESCRIPTION}
Tags:
{tags}
ReleaseNotesUrl: {RELEASES_URL}/tag/v{version}
ManifestType: defaultLocale
ManifestVersion: {MANIFEST_VERSION}
"""


def render_installer(version: str, url: str, sha256: str, product_code: str) -> str:
    filename = url.rsplit("/", 1)[-1]
    return f"""\
PackageIdentifier: {PACKAGE_IDENTIFIER}
PackageVersion: {version}
InstallerType: inno
Scope: user
UpgradeBehavior: install
ProductCode: "{product_code}"
Capabilities:
- internetClient
- internetClientServer
Installers:
- Architecture: x64
  InstallerUrl: {url}
  InstallerSha256: {sha256.upper()}
  AppsAndFeaturesEntries:
  - DisplayName: Aph {version}
    Publisher: {PUBLISHER}
    DisplayVersion: {version}
    ProductCode: "{product_code}"
    UpgradeCode: "{product_code}"
  InstallerSwitches:
    Silent: /SILENT
    SilentWithProgress: /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SP-
    Custom: /SUPPRESSMSGBOXES /NORESTART /SP-
ManifestType: installer
ManifestVersion: {MANIFEST_VERSION}
# Local file name (not part of the schema): {filename}
"""


def write_manifests(version: str, url: str, sha256: str, out_dir: Path) -> list[Path]:
    product_code = read_app_id()
    target = out_dir / version
    target.mkdir(parents=True, exist_ok=True)
    files = {
        f"{PACKAGE_IDENTIFIER}.yaml": render_version(version),
        f"{PACKAGE_IDENTIFIER}.locale.en-US.yaml": render_locale(version),
        f"{PACKAGE_IDENTIFIER}.installer.yaml": render_installer(
            version, url, sha256, product_code
        ),
    }
    written = []
    for name, content in files.items():
        path = target / name
        path.write_text(content, encoding="utf-8")
        written.append(path)
    return written


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--version", required=True, help="Aph version, e.g. 0.1.0")
    parser.add_argument("--tag", default=None, help="Release tag (default: v<version>)")
    parser.add_argument("--installer-url", default=None, help="Override the asset URL")
    parser.add_argument("--sha256", default=None, help="Installer SHA-256 hex digest")
    parser.add_argument(
        "--sums-file",
        default=None,
        help="SHA256SUMS file to look the digest up in",
    )
    parser.add_argument(
        "--out",
        default=str(ROOT / "packaging" / "winget"),
        help="Output directory (default: packaging/winget)",
    )
    parser.add_argument(
        "--print-steps",
        action="store_true",
        help="Print the winget-pkgs submission steps and exit",
    )
    args = parser.parse_args(argv)
    if args.print_steps:
        print(SUBMIT_STEPS)
        return 0
    url = args.installer_url or installer_url(args.version, args.tag)
    filename = url.rsplit("/", 1)[-1]
    sha256 = args.sha256
    if sha256 is None and args.sums_file is not None:
        sha256 = lookup_sha256(Path(args.sums_file), filename)
    if not sha256 or not re.fullmatch(r"[0-9a-fA-F]{64}", sha256):
        parser.error("a 64-hex-digit --sha256 (or --sums-file containing it) is required")
    for path in write_manifests(args.version, url, sha256, Path(args.out)):
        try:
            print(f"Wrote {path.relative_to(ROOT)}")
        except ValueError:
            print(f"Wrote {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
