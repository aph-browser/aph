#!/usr/bin/env python3
"""Launch Firefox with Aph overrides - Python replacement for dev.sh."""

import json
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

        omni = root / "build" / "firefox" / "browser" / "omni.ja"
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


def merge_policies(root: Path) -> None:
    """Write config/policies.json into Firefox's distribution dir.

    Fresh upstream tarballs ship no distribution/ dir at all; in that case
    there is no pristine base to back up, so merge over an empty policy set.
    """
    custom_policies_file = root / "config" / "policies.json"
    dist_dir = root / "build" / "firefox" / "distribution"
    target_policies_file = dist_dir / "policies.json"
    backup_policies_file = dist_dir / "policies.json.bak"

    if target_policies_file.is_file() or backup_policies_file.is_file():
        # Create pristine backup on first run (never modified)
        if not backup_policies_file.exists():
            shutil.copy2(target_policies_file, backup_policies_file)
            print(f"Created pristine policies backup: {backup_policies_file}")

        # ALWAYS read from the pristine backup as the base
        try:
            base_data = json.loads(backup_policies_file.read_text(encoding="utf-8"))
        except Exception as e:
            print(f"Warning: Failed to read policies backup: {e}", file=sys.stderr)
            base_data = {"policies": {}}
    else:
        # No upstream policies to preserve; start from an empty set.
        dist_dir.mkdir(parents=True, exist_ok=True)
        base_data = {"policies": {}}

    # If no custom policies exist, restore the pristine backup and exit
    if not custom_policies_file.is_file():
        if backup_policies_file.is_file():
            shutil.copy2(backup_policies_file, target_policies_file)
        return

    # Load custom Aph policies
    try:
        custom_data = json.loads(custom_policies_file.read_text(encoding="utf-8"))
    except Exception as e:
        print(f"ERROR parsing config/policies.json: {e}", file=sys.stderr)
        return

    def deep_merge(base: dict, update: dict) -> dict:
        for k, v in update.items():
            if isinstance(v, dict) and k in base and isinstance(base[k], dict):
                deep_merge(base[k], v)
            else:
                base[k] = v
        return base

    merged_data = deep_merge(base_data, custom_data)
    target_policies_file.write_text(json.dumps(merged_data, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    root = Path(__file__).resolve().parent.parent
    profile = root / "profile"
    user_js_src = root / "config" / "user.js"
    user_js_dst = profile / "user.js"
    binary = root / "build" / "firefox" / "firefox"

    profile.mkdir(parents=True, exist_ok=True)

    if user_js_src.is_file():
        shutil.copy2(user_js_src, user_js_dst)

    # Auto-merge enterprise policies & extensions
    merge_policies(root)

    # Auto-rebrand browser/omni.ja
    ensure_rebranded(root)

    if not binary.is_file():
        print(f"ERROR: {binary} not found. Extract Firefox first.", file=sys.stderr)
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
    except (AttributeError, OSError):
        # Fallback for non-POSIX, or if exec fails (e.g. bad binary)
        result = subprocess.run(cmd, check=False)
        sys.exit(result.returncode)


if __name__ == "__main__":
    main()
