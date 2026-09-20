  function ws() {
    return window.AphWorkspaces || null;
  }

  function wsContainerSuffix(api, n) {
    try {
      if (api && api.getWsContainer && api.describeContainer) {
        const id = api.getWsContainer(n);
        if (id) {
          const d = api.describeContainer(id);
          if (d && d.name) {
            return ` · ${d.name}`;
          }
        }
      }
    } catch (e) {}
    return "";
  }

  function wsName(api, n) {
    try {
      if (api && api.getWsName) {
        return api.getWsName(n) || "";
      }
    } catch (e) {}
    return "";
  }

  // "Workspace 2 (💼 Work) · Work" — number first so fuzzy prefixes and
  // existing muscle memory keep working; name/suffix only refine it.
  function wsFull(api, n) {
    const name = wsName(api, n);
    return `Workspace ${n}${name ? ` (${name})` : ""}${wsContainerSuffix(api, n)}`;
  }

  function arc() {
    try {
      return window.AphArchive || null;
    } catch (e) {
      return null;
    }
  }

  // "Archive Current Tab", or "Archive N Tabs" when a multiselection is
  // pending. Fully guarded: the archive controller may be absent (tests).
  function archiveCmdTitle() {
    try {
      const a = arc();
      if (a && typeof a.pendingCount === "function" && a.pendingCount() > 1) {
        return `Archive ${a.pendingCount()} Tabs`;
      }
    } catch (e) {}
    try {
      const n = (gBrowser.selectedTabs || gBrowser.multiselectedTabs || []).length;
      if (n > 1) {
        return `Archive ${n} Tabs`;
      }
    } catch (e) {}
    return "Archive Current Tab";
  }

  // "Send Active Tab to …", or "Send N Tabs to …" when a multiselection is
  // pending (sendTabTo moves the whole selection, auto-carrying linked
  // tree descendants and preserving whole native groups).
  function sendTabTitle(api, n) {
    try {
      const m = (gBrowser.selectedTabs || gBrowser.multiselectedTabs || []).length;
      if (m > 1) {
        return `Send ${m} Tabs to ${wsFull(api, n)}`;
      }
    } catch (e) {}
    return `Send Active Tab to ${wsFull(api, n)}`;
  }

  function sendTreeFamilySize(api) {
    try {
      if (!api) {
        return 0;
      }
      let sel = null;
      try {
        sel = gBrowser && gBrowser.selectedTab;
      } catch (e) {}
      if (!sel || sel.closing) {
        return 0;
      }
      // Multiselection family: selected tabs plus their descendants.
      let base = [sel];
      try {
        const multi =
          (gBrowser && (gBrowser.selectedTabs || gBrowser.multiselectedTabs)) ||
          null;
        if (Array.isArray(multi) && multi.length > 1 && multi.includes(sel)) {
          base = multi.filter((t) => t && !t.closing);
        }
      } catch (e) {}
      const seen = new Set();
      for (const t of base) {
        if (t) {
          seen.add(t);
        }
      }
      try {
        for (const t of Array.from(seen)) {
          let kids = [];
          try {
            kids =
              typeof api.getTreeDescendants === "function"
                ? api.getTreeDescendants(t)
                : [];
          } catch (e) {
            kids = [];
          }
          for (const k of kids || []) {
            if (k && !k.closing) {
              seen.add(k);
            }
          }
        }
      } catch (e) {}
      return seen.size;
    } catch (e) {
      return 0;
    }
  }

  function sendGroupSize() {
    try {
      const sel = gBrowser && gBrowser.selectedTab;
      const g = sel && sel.group;
      if (!g) {
        return 0;
      }
      const ms = Array.from(g.tabs || []).filter((t) => t && !t.closing);
      return ms.length >= 2 ? ms.length : 0;
    } catch (e) {
      return 0;
    }
  }

  function sendTreeTitle(api, n, family) {
    try {
      const f = family || sendTreeFamilySize(api);
      if (f > 1) {
        return `Send Tree (${f} Tabs) to ${wsFull(api, n)}`;
      }
    } catch (e) {}
    return `Send Tree to ${wsFull(api, n)}`;
  }

  function sendGroupTitle(api, n, size) {
    try {
      const s = size || sendGroupSize();
      if (s > 1) {
        return `Send Group (${s} Tabs) to ${wsFull(api, n)}`;
      }
    } catch (e) {}
    return `Send Group to ${wsFull(api, n)}`;
  }

