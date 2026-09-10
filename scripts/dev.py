#!/usr/bin/env python3
"""Launch Firefox with Aph overrides - Python replacement for dev.sh.

Prefs model: config/user.js holds Aph's *default* prefs. It is seeded into a
profile once (first launch) and never overwritten afterwards, so user changes
made via about:config / Settings persist across restarts. Enterprise policies
(config/policies.json) remain the only force-applied mechanism. To re-apply
defaults over a profile on purpose, run: just sync-prefs
"""

import json
import os
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
        root_omni = root / "build" / "firefox" / "omni.ja"
        # Only rebrand if backup missing (first run) or branding newer than omni.ja
        if not omni.is_file():
            return
        # Check mtime of all branding assets (sources + built bundles) AND
        # the rebrand package itself.
        watch_files = (
            list((root / "branding").rglob("*.js"))
            + list((root / "branding").rglob("*.css"))
            + list((root / "branding").rglob("*.ftl"))
            + list((root / "scripts" / "aph_rebrand").rglob("*.py"))
            + [root / "scripts" / "rebrand.py", root / "scripts" / "build_assets.py"]
        )
        newest_source = max(f.stat().st_mtime for f in watch_files if f.is_file())
        # Both browser and root omni.ja get patched — a missing backup or a
        # stale timestamp on EITHER one must trigger a rebrand.
        targets = [p for p in (omni, root_omni) if p.is_file()]
        if any(not p.with_suffix(".ja.bak").exists() for p in targets) or newest_source > min(
            p.stat().st_mtime for p in targets
        ):
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


def profile_locked(profile: Path) -> bool:
    """True if a running Firefox holds this profile (mirrors nuke-local check)."""
    lock = profile / "lock"
    try:
        if not lock.is_symlink():
            return False
        target = os.readlink(lock)  # e.g. "127.0.0.1:+12345"
        pid = target.rsplit(":", 1)[-1].lstrip("+")
        if not pid.isdigit():
            return False
        os.kill(int(pid), 0)
        return True
    except (OSError, ValueError):
        return False


def seed_user_js(root: Path, profile: Path) -> str:
    """Seed config/user.js into the profile once; never overwrite user edits.

    Returns "seeded" (fresh copy), "kept" (profile already had one — user
    changes preserved), or "missing-source" (nothing to seed from).
    """
    src = root / "config" / "user.js"
    dst = profile / "user.js"
    if not src.is_file():
        return "missing-source"
    if dst.exists():
        return "kept"
    shutil.copy2(src, dst)
    return "seeded"


def seed_chrome_css(root: Path, profile: Path) -> str:
    """Seed branding/userChrome.css into profile/chrome/ once (menu accents).

    Same seed-once contract as seed_user_js: never overwrite user edits.
    Returns "seeded", "kept", or "missing-source".
    """
    src = root / "branding" / "userChrome.css"
    dst = profile / "chrome" / "userChrome.css"
    if not src.is_file():
        return "missing-source"
    if dst.exists():
        return "kept"
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dst)
    return "seeded"


def sync_user_js(root: Path, profile: Path) -> None:
    """Force re-apply config/user.js over the profile (explicit opt-in).

    Backs up the existing profile/user.js to user.js.bak first. Refuses while
    Firefox holds the profile lock. Next launch, Firefox applies the synced
    file over prefs.js — user edits to listed prefs are overwritten.
    """
    src = root / "config" / "user.js"
    dst = profile / "user.js"
    if not src.is_file():
        print(f"ERROR: {src} not found. Run: just update-prefs", file=sys.stderr)
        sys.exit(1)
    if profile_locked(profile):
        print(f"ERROR: Firefox is running on {profile} - quit it first.", file=sys.stderr)
        sys.exit(1)
    profile.mkdir(parents=True, exist_ok=True)
    if dst.exists():
        shutil.copy2(dst, profile / "user.js.bak")
    shutil.copy2(src, dst)
    print(f"Synced {src} -> {dst} (previous saved as user.js.bak)")


def sync_chrome_css(root: Path, profile: Path) -> None:
    """Force re-apply branding/userChrome.css over the profile (explicit opt-in).

    Same contract as sync_user_js: backs up to userChrome.css.bak first,
    refuses while Firefox holds the profile lock.
    """
    src = root / "branding" / "userChrome.css"
    dst = profile / "chrome" / "userChrome.css"
    if not src.is_file():
        print(f"ERROR: {src} not found.", file=sys.stderr)
        sys.exit(1)
    if profile_locked(profile):
        print(f"ERROR: Firefox is running on {profile} - quit it first.", file=sys.stderr)
        sys.exit(1)
    dst.parent.mkdir(parents=True, exist_ok=True)
    if dst.exists():
        shutil.copy2(dst, profile / "chrome" / "userChrome.css.bak")
    shutil.copy2(src, dst)
    print(f"Synced {src} -> {dst} (previous saved as userChrome.css.bak)")


def main() -> None:
    root = Path(__file__).resolve().parent.parent
    profile = root / "profile"
    binary = root / "build" / "firefox" / ("firefox.exe" if sys.platform == "win32" else "firefox")

    profile.mkdir(parents=True, exist_ok=True)

    # Seed-once defaults: never overwrite an existing profile/user.js, so
    # user changes via about:config / Settings survive restarts.
    if seed_user_js(root, profile) == "seeded":
        print(f"Seeded first-run prefs: {profile / 'user.js'}")
    # Seed-once menu accents (same contract: never overwrite user edits).
    if seed_chrome_css(root, profile) == "seeded":
        print(f"Seeded menu accents: {profile / 'chrome' / 'userChrome.css'}")

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
