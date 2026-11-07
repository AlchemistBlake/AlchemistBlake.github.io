// Stage 2b: deterministic lyric snapping. No model calls, no randomness.
// Shot windows come from Super Crab's stage1/shots.js proposeShotWindows (single owner, M-033).
// sig: BWA_15.2003075_SOV_96.7Hz_SHA-BEWA_69912070  (c) Blake Wayne Allcorn. All rights reserved.
'use strict';

// Snap each lyric start to the nearest beat if it is within half a beat interval.
function snapLyrics(lyrics, beats, duration_ms) {
  const t = beats.map(b => b.t_ms);
  const out = [];
  for (const l of lyrics) {
    let s = l.start_ms, e = l.end_ms;
    if (t.length > 1) {
      let lo = 0, hi = t.length - 1;            // binary search nearest beat
      while (lo < hi) { const m = (lo + hi) >> 1; if (t[m] < s) lo = m + 1; else hi = m; }
      const cands = [lo - 1, lo].filter(i => i >= 0 && i < t.length);
      const k = cands.reduce((a, b) => Math.abs(t[b] - s) < Math.abs(t[a] - s) ? b : a);
      const gap = k > 0 ? t[k] - t[k - 1] : t[1] - t[0];
      if (Math.abs(t[k] - s) * 2 <= gap) s = t[k];
    }
    s = Math.max(0, Math.min(s, duration_ms - 1));
    e = Math.min(Math.max(e, s + 1), duration_ms);
    out.push({ start_ms: s, end_ms: e, text: l.text.trim() });
  }
  out.sort((a, b) => a.start_ms - b.start_ms || a.end_ms - b.end_ms);
  return out;
}

if (typeof module !== 'undefined') module.exports = { snapLyrics };
else self.MOLyrics = { snapLyrics };
