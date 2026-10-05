"""Stash page chrome: branding/stash.css speaks the
chrome system (Inter, Aph radii, neutral desk surfaces, workspace pills) —
never a guest skin — plus hover easing and motion guards, and the
workspace-stash cards added for the second view.
"""

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _css() -> str:
    return (ROOT / "branding" / "stash.css").read_text(encoding="utf-8")


def _theme_css() -> str:
    return (ROOT / "branding" / "theme.css").read_text(encoding="utf-8")


def _page_js() -> str:
    return (ROOT / "branding" / "stash-page.js").read_text(encoding="utf-8")


def test_stash_css_is_sane() -> None:
    css = _css()
    assert css.count("{") == css.count("}"), "unbalanced braces"
    assert css.count("/*") == css.count("*/"), "unbalanced comments"


def test_stash_hovers_ease_and_motion_guarded() -> None:
    """Motion language (§24 dialect): pills, rows, tags, and the delete
    reveal ease instead of snapping, and reduced-motion kills every
    transition including the toast's."""
    css = _css()
    # Base rules plus the motion block at the end (which owns the
    # transitions), so each selector must appear at least twice and a
    # transition must follow one of the occurrences.
    for sel in (".aph-stash-pill {", ".aph-stash-row {", ".aph-stash-del {"):
        first = css.find(sel)
        assert first != -1, sel
        second = css.find(sel, first + 1)
        assert second != -1, sel
        assert "transition" in css[second : second + 400], sel
    assert "prefers-reduced-motion" in css
    assert "#aph-stash-toast" in css and "transition: none" in css


def test_stash_drops_tokyo_night() -> None:
    """One product with the chrome: the old Tokyo-Night surfaces are gone
    (desk/elevated/raised + ink/muted take over), Inter ships in the
    page, and the Aph radius scale backs every corner. Danger red
    survives only as the delete signal (functional, not decorative)."""
    css = _css()
    for dead in (
        "#1a1b26",
        "#c0caf5",
        "#24283b",
        "#343a55",
        "#565f89",
        "#e6e8f5",
        "#ff2d55",
    ):
        assert dead not in css, f"guest-skin surface still present: {dead}"
    # The local --arch-* scale is gone: the page reads the shared tokens.
    for live in (
        "var(--aph-base)",
        "var(--aph-surface)",
        "var(--aph-field)",
        "var(--aph-ink)",
        "var(--aph-ink-dim)",
        "var(--aph-radius-md)",
        "var(--aph-radius-xl)",
    ):
        assert live in css, f"missing shared token read: {live}"
    assert "--arch-" not in re.sub(r"/\*.*?\*/", "", css, flags=re.S)
    assert css.count("@font-face {") == 4
    assert "aph-fonts/inter-" in css
    assert "var(--aph-danger)" in css


def test_stash_voice_parity() -> None:
    """The stash used to duplicate the nine workspace hues under its own
    --arch-ws-N names with this test holding the copies equal. It now reads
    the tokens.css table outright, so parity is structural — assert the
    page spends the shared hues and carries no local copy."""
    css = _css()
    for n in [str(i) for i in range(1, 17)]:
        assert f"var(--aph-ws-{n})" in css, n
    assert "--arch-ws-" not in css


def test_stash_pills_carry_workspace() -> None:
    """Workspace filter pills wear their own hue when active (dock
    parity): the page stamps data-ws at render (no bridge — the value
    IS the id), and the stylesheet spends the accent on .on pills."""
    js = _page_js()
    assert 'setAttribute("data-ws"' in js
    css = _css()
    assert ".aph-stash-pill[data-ws]" in css
    assert ".aph-stash-pill[data-ws].on" in css
    assert "--aph-ws-now" in css


def test_stash_stays_rtl_clean() -> None:
    """Count badge margins must mirror in RTL via logical props."""
    code = re.sub(r"/\*.*?\*/", "", _css(), flags=re.S)
    for banned in (
        "margin-left:",
        "margin-right:",
        "float: left",
        "float: right",
        "text-align: left",
        "text-align: right",
    ):
        assert banned not in code, f"physical direction prop leaked: {banned}"


def test_stash_page_offers_two_views_over_one_store() -> None:
    """One page, two views: Stashed tabs (aph.stash.tabs)
    and Workspace stashes (aph.stash.snapshots). Both read their pref directly
    (system-principal chrome page) and reach the owning window through the
    apH-stash observer bridge, extended with a `kind` discriminator so one
    topic serves both restores. Pre-rename keys (aph.archive.* / aph.snapshots)
    are read once as a migration fallback and adopted forward — the page
    keeps listing them until the controller moves them over."""
    js = _page_js()
    html = (ROOT / "branding" / "stash.html").read_text(encoding="utf-8")
    assert '"aph.stash.tabs"' in js, "per-tab store pref"
    assert 'const SNAP_PREF = "aph.stash.snapshots"' in js, "snapshot store pref"
    assert '"aph-stash-restore"' in js and '"aph-stash-result"' in js
    # Restore routing is discriminated, never guessed.
    assert 'kind: "tab"' in js or "kind)" in js
    assert '"stash"' in js, "snapshot restore kind"
    assert "readStashes" in js and "deleteStash" in js
    # View switch exists in markup and is wired to the render split.
    assert 'data-view="tabs"' in html and 'data-view="stashes"' in html
    assert 'view === "stashes"' in js
    assert "renderStashes()" in js
    # View parity: the stashes view keeps the shared toolbar (filter
    # pills with its own All/Manual/Auto vocabulary, sort, bulk bar)
    # instead of hiding it.
    assert "renderStashPills" in js
    assert "hidden = false" in js
    assert "<title>Stash</title>" in html


def test_stash_cards_use_shared_tokens() -> None:
    """Snapshots speak the tab row dialect: the same row/check/fav/title/
    domain/tags/✕ classes, plus snapshot-only extras (wrapper, chevron,
    indented members, detail actions) in shared tokens only — no guest
    skin, no local scale, no physical direction props."""
    css = _css()
    for sel in (
        "#aph-stash-views button",
        ".aph-stash-row {",
        ".aph-stash-check",
        ".aph-stash-fav",
        ".aph-stash-title",
        ".aph-stash-domain",
        ".aph-stash-tag",
        ".aph-stash-del {",
        ".aph-stash-snap {",
        ".aph-stash-expand",
        ".aph-stash-members",
        ".aph-stash-member",
        ".aph-stash-card-actions button",
        ".aph-stash-card-rename",
    ):
        assert sel in css, f"missing stash selector: {sel}"
    for token in ("var(--aph-surface)", "var(--aph-ink)", "var(--aph-ink-dim)"):
        assert token in css, f"missing shared token read: {token}"
    for dead in (
        ".aph-stash-card {",
        ".aph-stash-card-name",
        ".aph-stash-card-tabs",
        ".aph-stash-card-delete",
    ):
        assert dead not in css, f"dead card selector resurrected: {dead}"
    live = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
    assert "--arch-" not in live, "local scale resurrected on stash rows"
    for banned in ("margin-left:", "margin-right:", "float: left", "float: right"):
        assert banned not in live, f"physical direction prop leaked: {banned}"


def _controller_js() -> str:
    return (ROOT / "branding" / "stash.js").read_text(encoding="utf-8")


def test_stash_restore_confidence() -> None:
    """Restore confidence (§1): duplicate-skip with counts, single-tab
    restore, safety-net undo, and renameable stashes — all append-only,
    nothing ever closed by a restore."""
    js = _controller_js()
    assert "restoreStashTab" in js, "single-tab restore entry point"
    assert '"stash-tab"' in js, "single-tab bridge kind"
    assert '"stash-update"' in js and "updateStash" in js, "in-place update"
    assert "confirmBulkClose" in js and "undoSafetyStash" in js, "undo offer"
    assert "renameStash" in js, "controller rename"
    assert "skipped" in js and "unbound" in js, "restore residual counts"
    assert "autoStashTick" in js, "heartbeat covers current + idle workspaces"
    assert "sweepDueWorkspace" in js, "due-gated per-workspace sweep"
    assert "captureChangedWorkspaces" in js, "shutdown net"
    assert "safetyThreshold" in js, "tunable bulk-close threshold"
    assert "SNAP_TICK_MS" in js, "heartbeat tick, not a fixed 30-min timer"
    page = _page_js()
    assert "startStashRename" in page and "commitStashRename" in page
    assert "makeStashRow" in page and "makeStashMember" in page, "row dialect"
    assert "deleteStashTab" in page, "nested x removes one tab"
    assert "toggleStashExpanded" in page, "expandable members"
    assert 'requestRestore(snap.id, false, "stash-tab"' in page
    assert "restoreResultText" in page, "result summary"
    assert "renderStashPills" in page, "All/Manual/Auto pills"
    assert "sortStashes" in page, "snapshot sorting"
    css = _css()
    assert ".aph-stash-expand" in css, "disclosure chevron"
    assert ".aph-stash-member" in css, "indented member rows"
    assert ".aph-stash-card-rename" in css, "rename input"
    palette = (ROOT / "branding" / "command-palette.js").read_text(encoding="utf-8")
    assert "stashHosts" in palette, "member hosts in restore rows"
    assert "openStashSub" in palette, "live stash counts"
