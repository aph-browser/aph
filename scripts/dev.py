#!/usr/bin/env python3
"""Launch LibreWolf with Aph overrides - Python replacement for dev.sh."""

import shutil
import subprocess
import sys
from pathlib import Path


def ensure_rebranded(root: Path) -> None:
    """Run rebrand.py if branding or rebrand script changed."""
    try:
        # Ensure root is on sys.path for `import scripts.rebrand`
        if str(root) not in sys.path:
            sys.path.insert(0, str(root))
        from scripts.rebrand import rebrand  # type: ignore

        omni = root / "build" / "librewolf" / "browser" / "omni.ja"
        backup = omni.with_suffix(".ja.bak")
        # Only rebrand if backup missing (first run) or branding newer than omni.ja
        if not omni.is_file():
            return
        # Check mtime of all branding assets AND the rebrand script itself
        watch_files = list((root / "branding").glob("*")) + [
            root / "scripts" / "rebrand.py"
        ]
        newest_source = max(f.stat().st_mtime for f in watch_files if f.is_file())
        omni_mtime = omni.stat().st_mtime
        if not backup.exists() or newest_source > omni_mtime:
            print("Rebranding omni.ja to Aph...")
            rebrand()
    except Exception as e:
        print(f"Warning: rebrand check failed: {e}", file=sys.stderr)


def main() -> None:
    root = Path(__file__).resolve().parent.parent
    profile = root / "profile"
    overrides_src = root / "config" / "librewolf.overrides.cfg"
    overrides_dst = profile / "librewolf.overrides.cfg"
    binary = root / "build" / "librewolf" / "librewolf"

    profile.mkdir(parents=True, exist_ok=True)

    if overrides_src.is_file():
        shutil.copy2(overrides_src, overrides_dst)

    # Auto-rebrand browser/omni.ja
    ensure_rebranded(root)

    if not binary.is_file():
        print(f"ERROR: {binary} not found. Extract LibreWolf first.", file=sys.stderr)
        sys.exit(1)

    # Always pass -purgecaches if cache was cleared
    purgecache_marker = profile / ".purgecache_done"
    if not purgecache_marker.exists():
        purgecache_marker.touch()
        cmd = [str(binary), "-purgecaches", "--profile", str(profile), "--no-remote", *sys.argv[1:]]
    else:
        cmd = [str(binary), "--profile", str(profile), "--no-remote", *sys.argv[1:]]
    # Replace current process (like exec in bash)
    try:
        # Use exec on POSIX for exact bash parity
        import os

        os.execv(cmd[0], cmd)
    except AttributeError:
        # Fallback for non-POSIX
        result = subprocess.run(cmd, check=False)
        sys.exit(result.returncode)


if __name__ == "__main__":
    main()
