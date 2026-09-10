  // --- Scored fuzzy matching --------------------------------------------
  // Tiers: exact prefix (1000s) > word-boundary substring (800s) >
  // plain substring (600s) > subsequence (400s baseline with
  // consecutive/word-start bonuses, gap penalties). An all-word-start
  // acronym match (+300, e.g. "nt" → "New Tab") outranks mid-word
  // substrings ("curreNT") but stays below word-boundary substrings and
  // prefixes. Returns null on no match.
  function fuzzyScore(query, text) {
    const needle = (query || "").toLowerCase();
    const hay = (text || "").toLowerCase();
    const n = needle.length;
    if (!n || !hay) {
      return n ? null : { score: 0, indices: [] };
    }
    const isBoundary = (i) => i === 0 || /[^a-z0-9]/.test(hay[i - 1]);
    if (hay.startsWith(needle)) {
      const indices = [];
      for (let i = 0; i < n; i++) {
        indices.push(i);
      }
      return { score: 1000 - hay.length, indices };
    }
    const at = hay.indexOf(needle);
    if (at !== -1) {
      const indices = [];
      for (let i = 0; i < n; i++) {
        indices.push(at + i);
      }
      return { score: (isBoundary(at) ? 800 : 600) - at, indices };
    }
    // Subsequence: best of earliest and word-start-preferring alignments.
    const a = subseqAlign(needle, hay, isBoundary, false);
    const b = subseqAlign(needle, hay, isBoundary, true);
    if (a && b) {
      return b.score >= a.score ? b : a;
    }
    return a || b;
  }

  // One subsequence alignment pass. With preferBoundary, each query char
  // lands on the earliest word-start at/after the cursor when one exists
  // (so "w2" aligns to "Workspace 2", not the "w" in "switch"); otherwise
  // the earliest occurrence. Returns null when the query isn't a
  // subsequence of the text.
  function subseqAlign(needle, hay, isBoundary, preferBoundary) {
    const n = needle.length;
    const indices = [];
    let ti = 0;
    let first = -1;
    let gaps = 0;
    let consec = 0;
    let bounds = 0;
    let prev = -2;
    for (let qi = 0; qi < n; qi++) {
      const c = needle[qi];
      let f = -1;
      let fb = -1;
      for (let j = ti; j < hay.length; j++) {
        if (hay[j] === c) {
          if (f === -1) {
            f = j;
          }
          if (isBoundary(j)) {
            fb = j;
            break;
          }
        }
      }
      if (f === -1) {
        return null;
      }
      if (preferBoundary && fb !== -1) {
        f = fb;
      }
      if (first === -1) {
        first = f;
      }
      if (f === prev + 1) {
        consec++;
      } else {
        gaps += f - prev - 1;
      }
      if (isBoundary(f)) {
        bounds++;
      }
      indices.push(f);
      prev = f;
      ti = f + 1;
    }
    let score = 400 + consec * 10 + bounds * 8 - gaps * 4 - first;
    // Acronym: every query char lands on a word start ("nt" → "New Tab").
    // Beats mid-word substrings ("curreNT") but stays below real substrings
    // at word boundaries and prefixes.
    if (bounds === n) {
      score += 300;
    }
    return { score, indices };
  }

  // Best of title / sub / hint (sub and hint count slightly less, so a
  // title hit outranks metadata); keeps all index sets so paint() can
  // highlight each field that matched.
  function matchItem(it, q) {
    const tm = fuzzyScore(q, it.title || "");
    const sm = it.sub ? fuzzyScore(q, it.sub) : null;
    const hm = it.hint ? fuzzyScore(q, it.hint) : null;
    if (!tm && !sm && !hm) {
      return null;
    }
    const score = Math.max(
      tm ? tm.score : -Infinity,
      sm ? sm.score - 50 : -Infinity,
      hm ? hm.score - 100 : -Infinity
    );
    return {
      score,
      ti: tm ? tm.indices : [],
      si: sm ? sm.indices : [],
      hi: hm ? hm.indices : [],
    };
  }

