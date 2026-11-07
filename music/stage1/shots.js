// shots.js - deterministic shot-window proposer (stage 1 helper). It only proposes
// windows; it is NOT the validator (Port owns the shared validator).
// sig: BWA_15.2003075_SOV_96.7Hz_SHA-BEWA_69912070  (c) Blake Wayne Allcorn. All rights reserved.
//
// Rule (documented, deterministic):
//  1. Candidate cut points = 0, every downbeat strictly inside (0, duration), duration.
//  2. Exact DP over cut points: each shot must be MIN_MS..MAX_MS long; cost per shot is
//     (len - target_ms)^2 plus a large penalty if it spans a section boundary. Ties break
//     toward the earlier previous cut, so the result is unique.
//  3. Song start/end: the first shot starts at 0 and the last ends at duration_ms even if
//     those aren't downbeats. A tail shorter than MIN_MS after the last usable downbeat is
//     absorbed into the previous shot by the DP (it never emits a < 3 s shot).
//  4. Short sections (< MIN_MS) cannot get their own shot; the DP pays the crossing penalty
//     and merges them into a neighbour.
//  5. If no all-downbeat solution exists (a > 15 s stretch without downbeats, e.g. a
//     beatless intro), fall back to every beat as a cut point, then to equal splits of
//     the offending gap. Each fallback adds a warning; such windows break the downbeat rule
//     and the shared validator will flag them.
//  6. Songs shorter than MIN_MS throw.
export const MIN_MS = 3000, MAX_MS = 15000;
const CROSS = 1e12;

function dp(pts, inner, target) {
  const n = pts.length, cost = new Array(n).fill(Infinity), prev = new Array(n).fill(-1);
  cost[0] = 0;
  for (let j = 1; j < n; j++) for (let i = j - 1; i >= 0; i--) {
    const len = pts[j] - pts[i];
    if (len > MAX_MS) break;
    if (len < MIN_MS || cost[i] === Infinity) continue;
    let cross = 0; for (const b of inner) if (b > pts[i] && b < pts[j]) cross++;
    const c = cost[i] + (len - target) * (len - target) + cross * CROSS;
    if (c < cost[j] || (c === cost[j] && i < prev[j])) { cost[j] = c; prev[j] = i; }
  }
  if (cost[n - 1] === Infinity) return null;
  const cuts = []; for (let j = n - 1; j > 0; j = prev[j]) cuts.push([pts[prev[j]], pts[j]]);
  return cuts.reverse();
}
function uniq(a) { const o = []; for (const v of a) if (!o.length || v > o[o.length - 1]) o.push(v); return o; }

export function proposeShotWindows(tl, { target_ms = 8000, aspect } = {}) {
  const D = tl.source.duration_ms, warnings = [];
  if (D < MIN_MS) throw new Error(`song is ${D} ms; Omni clips need at least ${MIN_MS} ms`);
  const inner = tl.sections.map(s => s.start_ms).filter(x => x > 0 && x < D);
  const down = tl.beats.filter(b => b.downbeat).map(b => b.t_ms).filter(t => t > 0 && t < D).sort((a, b) => a - b);
  let cuts = dp(uniq([0, ...down, D]), inner, target_ms);
  if (!cuts) {
    warnings.push('no downbeat-only solution; using non-downbeat beats as cut points');
    const all = tl.beats.map(b => b.t_ms).filter(t => t > 0 && t < D).sort((a, b) => a - b);
    cuts = dp(uniq([0, ...all, D]), inner, target_ms);
  }
  if (!cuts) {
    warnings.push('gaps > 15 s without beats; splitting them evenly (not beat-aligned)');
    const base = uniq([0, ...tl.beats.map(b => b.t_ms).filter(t => t > 0 && t < D).sort((a, b) => a - b), D]), pts = [0];
    for (let i = 1; i < base.length; i++) {
      const g = base[i] - base[i - 1], k = Math.ceil(g / MAX_MS);
      for (let q = 1; q < k; q++) pts.push(base[i - 1] + Math.floor(g * q / k));
      pts.push(base[i]);
    }
    cuts = dp(uniq(pts), inner, target_ms);
    if (!cuts) throw new Error('could not cut the song into 3-15 s windows');
  }
  const secAt = ms => (tl.sections.find(s => ms >= s.start_ms && ms < s.end_ms) || tl.sections[tl.sections.length - 1]).id;
  const shots = cuts.map(([s, e], index) => {
    const w = { index, start_ms: s, end_ms: e, section_id: secAt(s), lyric_refs: [] };
    (tl.lyrics || []).forEach((l, k) => { if (l.start_ms >= s && l.start_ms < e) w.lyric_refs.push(k); });
    if (aspect) w.aspect = aspect;
    return w;
  });
  return { shots, warnings };
}
