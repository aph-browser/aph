#!/usr/bin/env python3
"""Launch Firefox with Aph overrides - Python replacement for dev.sh.

Prefs model: config/user.js holds Aph's *default* prefs. It is seeded into a
profile once (first launch) and never overwritten afterwards, so user changes
made via about:config / Settings persist across restarts. Enterprise policies
(config/policies.json) remain the only force-applied mechanism. To re-apply
defaults over a profile on purpose, run: just sync-prefs
"""

import contextlib
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path


def ensure_rebranded(root: Path) -> bool:
    """Run rebrand.py if branding or rebrand script changed.

    Returns True when a rebrand actually ran: omni.ja offsets move, so
    the profile's startupCache must be purged for that launch (stale
    chrome/resource mappings silently break privileged content like
    about:newtab's resource://newtab/ bundles — blank page, Security
    Error, zero console signal).
    """
    try:
        # Ensure root is on sys.path for `import scripts.rebrand`
        if str(root) not in sys.path:
            sys.path.insert(0, str(root))
        from scripts.rebrand import rebrand  # type: ignore

        omni = root / "build" / "firefox" / "browser" / "omni.ja"
        root_omni = root / "build" / "firefox" / "omni.ja"
        # Only rebrand if backup missing (first run) or branding newer than omni.ja
        if not omni.is_file():
            return False
        # Check mtime of all branding assets (sources + built bundles) AND
        # the rebrand package itself.
        watch_files = (
            list((root / "branding").rglob("*.js"))
            + list((root / "branding").rglob("*.css"))
            + list((root / "branding").rglob("*.ftl"))
            # Logos feed icon slicing + omni injection (icons.py, assets.py):
            # a swapped aph.png must count as stale, not launch silently old.
            + list((root / "branding").rglob("*.png"))
            + list((root / "branding").rglob("*.svg"))
            + list((root / "branding").rglob("*.ico"))
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
            return True
        return False
    except Exception as e:
        print(f"Warning: rebrand check failed: {e}", file=sys.stderr)
        return False


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
    # ExtensionSettings is REPLACE, not merge: deep_merge only adds, so a
    # removed extension would resurrect from a stale base on every launch
    # (seen live: SponsorBlock/containers reinstalled after their config
    # entries were deleted, because policies.json.bak had snapshotted an
    # old Aph policy as "pristine"). Config is authoritative here —
    # removing an entry must actually remove it from the live policy.
    try:
        custom_ext = custom_data.get("policies", {}).get("ExtensionSettings")
    except AttributeError:
        custom_ext = None
    if isinstance(custom_ext, dict):
        merged_data.setdefault("policies", {})["ExtensionSettings"] = custom_ext
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


def _seed_file(src: Path, dst: Path) -> str:
    """Copy src -> dst once; never overwrite user edits."""
    if not src.is_file():
        return "missing-source"
    if dst.exists():
        return "kept"
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dst)
    return "seeded"


def seed_user_js(root: Path, profile: Path) -> str:
    """Seed config/user.js into the profile once; never overwrite user edits.

    Returns "seeded" (fresh copy), "kept" (profile already had one — user
    changes preserved), or "missing-source" (nothing to seed from).
    """
    return _seed_file(root / "config" / "user.js", profile / "user.js")


def seed_chrome_css(root: Path, profile: Path) -> str:
    """Seed profile/chrome/ once: userChrome.css (menu accents) plus
    userContent.css (new-tab backdrop, so the page is never flat when
    the wallpaper feed is unreachable).

    Same seed-once contract as seed_user_js: never overwrite user edits.
    Returns "seeded" (either file fresh), "kept", or "missing-source".
    """
    first = _seed_file(root / "branding" / "userChrome.css", profile / "chrome" / "userChrome.css")
    second = _seed_file(
        root / "branding" / "userContent.css", profile / "chrome" / "userContent.css"
    )
    if "seeded" in (first, second):
        return "seeded"
    if "missing-source" in (first, second):
        return "missing-source" if first == second else "kept"
    return "kept"


def _sync_file(
    src: Path, dst: Path, profile: Path, backup_name: str, missing_hint: str = ""
) -> None:
    """Force re-apply src over dst (explicit opt-in).

    Backs up dst to backup_name first, refuses while Firefox holds the
    profile lock. All user-facing messages match the historical wording.
    """
    if not src.is_file():
        print(f"ERROR: {src} not found.{missing_hint}", file=sys.stderr)
        sys.exit(1)
    if profile_locked(profile):
        print(f"ERROR: Firefox is running on {profile} - quit it first.", file=sys.stderr)
        sys.exit(1)
    dst.parent.mkdir(parents=True, exist_ok=True)
    if dst.exists():
        shutil.copy2(dst, dst.parent / backup_name)
    shutil.copy2(src, dst)
    print(f"Synced {src} -> {dst} (previous saved as {backup_name})")


def sync_user_js(root: Path, profile: Path) -> None:
    """Force re-apply config/user.js over the profile (explicit opt-in).

    Backs up the existing profile/user.js to user.js.bak first. Refuses while
    Firefox holds the profile lock. Next launch, Firefox applies the synced
    file over prefs.js — user edits to listed prefs are overwritten.
    """
    _sync_file(
        root / "config" / "user.js",
        profile / "user.js",
        profile,
        "user.js.bak",
        " Run: just update-prefs",
    )


def sync_chrome_css(root: Path, profile: Path) -> None:
    """Force re-apply profile/chrome/ over the profile (explicit opt-in):
    userChrome.css plus userContent.css (new-tab backdrop).

    Same contract as sync_user_js: backs up to *.bak first, refuses
    while Firefox holds the profile lock.
    """
    _sync_file(
        root / "branding" / "userChrome.css",
        profile / "chrome" / "userChrome.css",
        profile,
        "userChrome.css.bak",
    )
    # userContent leg is skip-tolerant (minimal test roots and older
    # checkouts may lack the file); the userChrome leg above keeps its
    # fatal missing-source contract.
    if (root / "branding" / "userContent.css").is_file():
        _sync_file(
            root / "branding" / "userContent.css",
            profile / "chrome" / "userContent.css",
            profile,
            "userContent.css.bak",
        )
    else:
        print("WARNING: branding/userContent.css not found, skipping.", file=sys.stderr)


DAILY_FLAGS = ("--daily", "--local")


def resolve_launch(argv: list[str], root: Path) -> tuple[Path, list[str], bool]:
    """Split launcher flags from Firefox passthrough args.

    ``--daily`` (alias ``--local``) selects the persistent daily profile at
    ``~/.config/aph/profile`` and allows remote (no ``--no-remote``), so
    external links reuse the running instance. Default is the repo
    ``./profile`` with ``--no-remote`` (dev isolation).

    Returns ``(profile, firefox_args, no_remote)``.
    """
    extra = [a for a in argv if a not in DAILY_FLAGS]
    daily = len(extra) != len(argv)
    profile = Path.home() / ".config" / "aph" / "profile" if daily else root / "profile"
    return profile, extra, not daily


def main() -> None:
    root = Path(__file__).resolve().parent.parent
    profile, extra_args, no_remote = resolve_launch(sys.argv[1:], root)
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

    # Auto-rebrand browser/omni.ja. A fresh rebrand moves omni offsets,
    # so drop the purge marker: this launch passes -purgecaches and the
    # stale startupCache (which would otherwise keep mapping chrome and
    # resource:// URLs to the old bytes) is rebuilt.
    if ensure_rebranded(root):
        with contextlib.suppress(OSError):
            (profile / ".purgecache_done").unlink(missing_ok=True)

    if not binary.is_file():
        print(f"ERROR: {binary} not found. Extract Firefox first.", file=sys.stderr)
        sys.exit(1)

    # Always pass -purgecaches if cache was cleared
    purgecache_marker = profile / ".purgecache_done"
    remote_flag = ["--no-remote"] if no_remote else []
    if not purgecache_marker.exists():
        purgecache_marker.touch()
        cmd = [str(binary), "-purgecaches", "--profile", str(profile), *remote_flag, *extra_args]
    else:
        cmd = [str(binary), "--profile", str(profile), *remote_flag, *extra_args]
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
