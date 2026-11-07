// soundmap.js - Stage 1: deterministic DSP sound map -> timeline contract v1.
// Pure ES module; runs unchanged in browsers and Node. No Math.random, no Date,
// no transcendental Math.* calls (see detmath.js), no hash-order iteration.
// sig: BWA_15.2003075_SOV_96.7Hz_SHA-BEWA_69912070  (c) Blake Wayne Allcorn. All rights reserved.
import { PI, rhu, roundDiv, parseDecimal, dsin, dcos, dln, dlog10, dlog2, sha256Bytes, canonical, determinismHash } from './detmath.js';

export const ANALYZER_VERSION = 'super-crab-soundmap/1.1.0';
export const SR = 22050, NFFT = 2048, HOP = 512, BLOCK = 128;
const FPS = SR / HOP;
const BPM_MIN = 60, BPM_MAX = 200;
export const PEAKINESS_MIN = 1.6; // tempo ACF peak / mean ACF below this -> no reliable pulse -> beats: []
export const KEY_MIN_R = 0.5;   // below this best K-S correlation the key is reported as "unknown"

// ---------------- PCM preparation ----------------
// Downmix channels (Float32Array each, fixed channel order) to mono Float64.
export function downmix(channels) {
  const n = channels[0].length, c = channels.length, out = new Float64Array(n);
  for (let i = 0; i < n; i++) { let s = 0; for (let k = 0; k < c; k++) s += channels[k][i]; out[i] = s / c; }
  return out;
}

// Fixed resampler: 63-tap Blackman-windowed-sinc low-pass (cutoff 0.45*22050 Hz) when
// downsampling, then linear interpolation at integer-rational positions i*src/22050.
export function resampleTo22050(x, srcRate) {
  if (srcRate === SR) return Float64Array.from(x);
  let y = x;
  if (srcRate > SR) {
    const taps = 63, M = taps - 1, fc = 0.45 * SR / srcRate, h = new Float64Array(taps);
    let hs = 0;
    for (let i = 0; i < taps; i++) {
      const m = i - M / 2;
      const sinc = m === 0 ? 2 * fc : dsin(2 * PI * fc * m) / (PI * m);
      const w = 0.42 - 0.5 * dcos(2 * PI * i / M) + 0.08 * dcos(4 * PI * i / M);
      h[i] = sinc * w; hs += h[i];
    }
    for (let i = 0; i < taps; i++) h[i] /= hs;
    y = new Float64Array(x.length);
    const half = M / 2, n = x.length;
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let k = 0; k < taps; k++) { const j = i + k - half; if (j >= 0 && j < n) s += h[k] * x[j]; }
      y[i] = s;
    }
  }
  const outLen = Math.floor((x.length * SR) / srcRate);
  const out = new Float64Array(outLen), n = y.length;
  for (let i = 0; i < outLen; i++) {
    const num = i * srcRate, idx = Math.floor(num / SR), frac = (num - idx * SR) / SR;
    const a = y[idx], b = idx + 1 < n ? y[idx + 1] : 0;
    out[i] = a + (b - a) * frac;
  }
  return out;
}

// Quantize to Int16 with round-half-up and clipping.
export function toInt16(x) {
  const out = new Int16Array(x.length);
  for (let i = 0; i < x.length; i++) { let v = rhu(x[i] * 32767); out[i] = v > 32767 ? 32767 : v < -32768 ? -32768 : v; }
  return out;
}

// ---------------- FFT ----------------
function makeFFT(n) {
  const levels = Math.round(dlog2(n));
  const rev = new Uint32Array(n);
  for (let i = 0; i < n; i++) { let r = 0, v = i; for (let b = 0; b < levels; b++) { r = (r << 1) | (v & 1); v >>= 1; } rev[i] = r; }
  const cosT = new Float64Array(n / 2), sinT = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) { cosT[i] = dcos(2 * PI * i / n); sinT[i] = dsin(2 * PI * i / n); }
  return function fft(re, im) {
    for (let i = 0; i < n; i++) { const j = rev[i]; if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1, step = n / size;
      for (let i = 0; i < n; i += size) {
        for (let j = 0, k = 0; j < half; j++, k += step) {
          const a = i + j, b = a + half;
          const tr = re[b] * cosT[k] + im[b] * sinT[k];
          const ti = -re[b] * sinT[k] + im[b] * cosT[k];
          re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        }
      }
    }
  };
}

const KEY_MAJ = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KEY_MIN = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
const NAMES_MAJ = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const NAMES_MIN = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'G#', 'A', 'Bb', 'B'];

function meanStd(a) {
  let s = 0; for (let i = 0; i < a.length; i++) s += a[i];
  const m = a.length ? s / a.length : 0; let v = 0;
  for (let i = 0; i < a.length; i++) v += (a[i] - m) * (a[i] - m);
  return [m, a.length ? Math.sqrt(v / a.length) : 0];
}
function median(arr) { const a = Array.from(arr).sort((x, y) => x - y); if (!a.length) return 0; const h = a.length >> 1; return a.length % 2 ? a[h] : (a[h - 1] + a[h]) / 2; }
function pearson(x, y) {
  const [mx] = meanStd(x), [my] = meanStd(y); let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < x.length; i++) { const a = x[i] - mx, b = y[i] - my; sxy += a * b; sxx += a * a; syy += b * b; }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0;
}

// ---------------- Feature extraction ----------------
function features(pcm) {
  const len = pcm.length, F = 1 + Math.floor(len / HOP), half = NFFT / 2;
  const fft = makeFFT(NFFT), re = new Float64Array(NFFT), im = new Float64Array(NFFT);
  const win = new Float64Array(NFFT);
  for (let i = 0; i < NFFT; i++) win[i] = 0.5 - 0.5 * dcos(2 * PI * i / NFFT);
  const nb = half + 1, binHz = SR / NFFT;
  const pc = new Int8Array(nb).fill(-1);
  for (let b = 1; b < nb; b++) { const f = b * binHz; if (f >= 100 && f <= 5000) { const midi = rhu(69 + 12 * dlog2(f / 440)); pc[b] = ((midi % 12) + 12) % 12; } }
  const lowMax = Math.floor(200 / binHz);
  const flux = new Float64Array(F), low = new Float64Array(F), power = new Float64Array(F);
  const chroma = new Float64Array(F * 12);
  let prev = new Float64Array(nb), cur = new Float64Array(nb);
  for (let k = 0; k < F; k++) {
    const c = k * HOP; let pw = 0;
    for (let i = 0; i < NFFT; i++) {
      const j = c - half + i; const v = j >= 0 && j < len ? pcm[j] / 32768 : 0;
      re[i] = v * win[i]; im[i] = 0; pw += v * v;
    }
    power[k] = pw / NFFT;
    fft(re, im);
    let fl = 0, lo = 0;
    for (let b = 0; b < nb; b++) {
      const m = Math.sqrt(re[b] * re[b] + im[b] * im[b]);
      const lm = dln(1 + 10 * m); cur[b] = lm;
      if (k > 0 && b > 0) { const d = lm - prev[b]; if (d > 0) fl += d; }
      if (b > 0 && b <= lowMax) lo += m;
      if (pc[b] >= 0) chroma[k * 12 + pc[b]] += m;
    }
    flux[k] = fl; low[k] = lo;
    const t = prev; prev = cur; cur = t;
  }
  // block energy for time-domain beat refinement
  const NB = Math.floor(len / BLOCK), bE = new Float64Array(NB);
  for (let j = 0; j < NB; j++) { let s = 0; for (let i = j * BLOCK; i < (j + 1) * BLOCK; i++) { const v = pcm[i] / 32768; s += v * v; } bE[j] = s / BLOCK; }
  return { F, flux, low, power, chroma, bE };
}

function onsetEnvelope(flux) {
  const F = flux.length, env = new Float64Array(F), W = 16;
  // prefix sums for a centered moving average (detrend), then half-wave rectify
  const ps = new Float64Array(F + 1);
  for (let i = 0; i < F; i++) ps[i + 1] = ps[i] + flux[i];
  for (let i = 0; i < F; i++) {
    const a = Math.max(0, i - W), b = Math.min(F, i + W + 1);
    const v = flux[i] - (ps[b] - ps[a]) / (b - a); env[i] = v > 0 ? v : 0;
  }
  const [, sd] = meanStd(env);
  if (sd > 0) for (let i = 0; i < F; i++) env[i] /= sd;
  return env;
}

// Tempo: autocorrelation over 60-200 BPM lags with a soft 120-BPM octave prior, then
// prefer the faster octave when the half lag carries >= 80% of the correlation.
function estimatePeriod(env) {
  const F = env.length;
  const lagMin = Math.floor(60 * FPS / BPM_MAX), lagMax = Math.ceil(60 * FPS / BPM_MIN);
  const ac = new Float64Array(lagMax + 2);
  for (let L = 1; L <= lagMax + 1; L++) { let s = 0; for (let t = L; t < F; t++) s += env[t] * env[t - L]; ac[L] = F > L ? s / (F - L) : 0; }
  let best = -1, bestS = -Infinity;
  for (let L = lagMin; L <= lagMax; L++) {
    const bpm = 60 * FPS / L; if (bpm < BPM_MIN || bpm > BPM_MAX) continue;
    if (!(ac[L] >= ac[L - 1] && ac[L] >= ac[L + 1])) continue;          // local peaks only
    const o = dlog2(bpm / 120), s = ac[L] / (1 + o * o);
    if (s > bestS) { bestS = s; best = L; }
  }
  let mean = 0, cnt = 0; for (let L = lagMin; L <= lagMax; L++) { mean += ac[L]; cnt++; } mean /= cnt;
  if (best < 0) return { period: 60 * FPS / 120, ac, peakiness: 0 };
  const refine = L => { const a = ac[L - 1], b = ac[L], c = ac[L + 1], d = a - 2 * b + c; return d < 0 ? L + 0.5 * (a - c) / d : L; };
  let P = refine(best);
  for (;;) {
    const h = P / 2; if (60 * FPS / h > BPM_MAX) break;
    let hm = -Infinity, hl = -1;
    for (let L = Math.max(1, Math.floor(h) - 1); L <= Math.ceil(h) + 1; L++) if (ac[L] > hm) { hm = ac[L]; hl = L; }
    if (hm >= 0.8 * ac[Math.round(P)]) P = refine(hl); else break;
  }
  return { period: P, ac, peakiness: mean > 0 ? ac[Math.round(P)] / mean : 0 };
}

// Beat tracking by dynamic programming (Ellis 2007).
function trackBeats(env, P) {
  const F = env.length, alpha = 100;
  const dMin = Math.max(1, rhu(P / 2)), dMax = rhu(2 * P);
  const tx = new Float64Array(dMax + 1);
  for (let d = dMin; d <= dMax; d++) { const l = dln(d / P); tx[d] = -alpha * l * l; }
  const C = new Float64Array(F), back = new Int32Array(F).fill(-1);
  for (let t = 0; t < F; t++) {
    let bv = -Infinity, bp = -1;
    for (let d = dMin; d <= dMax && t - d >= 0; d++) { const v = C[t - d] + tx[d]; if (v > bv) { bv = v; bp = t - d; } }
    if (bp >= 0 && bv > 0) { C[t] = env[t] + bv; back[t] = bp; } else C[t] = env[t];
  }
  let start = F - 1, sv = -Infinity;
  for (let t = Math.max(0, F - rhu(P)); t < F; t++) if (C[t] > sv) { sv = C[t]; start = t; }
  const beats = [];
  for (let t = start; t >= 0; t = back[t]) beats.push(t);
  beats.reverse();
  // trim weak leading/trailing beats (silence)
  const str = beats.map(t => Math.max(env[t], t > 0 ? env[t - 1] : 0, t + 1 < F ? env[t + 1] : 0));
  const thr = 0.2 * median(str);
  let a = 0, b = beats.length - 1;
  while (a <= b && str[a] < thr) a++;
  while (b >= a && str[b] < thr) b--;
  return beats.slice(a, b + 1);
}

// Refine each beat to the 128-sample block with the strongest relative energy rise in
// [-1, +2] hops around the frame time. Returns sample positions (integers).
function refineBeats(frames, bE) {
  let mean = 0; for (let j = 0; j < bE.length; j++) mean += bE[j];
  mean = bE.length ? mean / bE.length : 0;
  const eps = 1e-3 * mean + 1e-12, per = HOP / BLOCK;
  const out = [];
  for (const k of frames) {
    const c = k * per; let best = -1, bv = 0.4;                   // ln-ratio threshold
    for (let j = Math.max(1, c - per); j <= Math.min(bE.length - 1, c + 2 * per); j++) {
      const r = dln((bE[j] + eps) / (bE[j - 1] + eps)); if (r > bv) { bv = r; best = j; }
    }
    out.push(best >= 0 ? best * BLOCK : k * HOP);
  }
  for (let i = 1; i < out.length; i++) if (out[i] <= out[i - 1]) out[i] = out[i - 1] + 1;
  return out;
}

// Least-squares beat period in samples, computed EXACTLY as a rational Num/Den of BigInts
// (x = beat index, y = integer sample position), with one exact outlier-rejection pass
// (drop beats whose residual exceeds a quarter period). Returns null if < 4 beats.
function fitPeriodExact(samples) {
  let pts = samples.map((y, i) => [BigInt(i), BigInt(y)]);
  let res = null;
  for (let pass = 0; pass < 2; pass++) {
    const n = BigInt(pts.length); if (pts.length < 4) break;
    let sx = 0n, sy = 0n, sxy = 0n, sxx = 0n;
    for (const [x, y] of pts) { sx += x; sy += y; sxy += x * y; sxx += x * x; }
    const num = n * sxy - sx * sy, den = n * sxx - sx * sx;
    if (num <= 0n || den <= 0n) break;
    res = { num, den };
    const abs = v => (v < 0n ? -v : v);
    pts = pts.filter(([x, y]) => 4n * abs(n * den * y - den * sy + num * sx - n * num * x) <= n * num);
  }
  return res;
}

// bpm_x100 = round_half_up(6000 * sr / period_samples), period = num/den samples -> exact.
export function bpmX100FromPeriodRational(num, den, sr = SR) { return roundDiv(6000n * BigInt(sr) * BigInt(den), BigInt(num)); }
// bpm_x100 from a decimal BPM string, parsed as fixed point (never via a float).
export function bpmStringToX100(str) { const { n, scale } = parseDecimal(str); return roundDiv(n * 100n, scale); }
// ms from an integer sample index at an integer rate, exact half-up.
export function samplesToMs(samples, rate) { return roundDiv(BigInt(samples) * 1000n, BigInt(rate)); }

const msOf = samples => samplesToMs(samples, SR);

function zs(a) { const [m, s] = meanStd(a); return a.map(v => s > 0 ? (v - m) / s : 0); }

function beatSync(feat, beatSamples, lenSamples) {
  const { chroma, power, F } = feat, n = beatSamples.length;
  const ch = [], db = [];
  for (let i = 0; i < n; i++) {
    const a = Math.min(F - 1, roundDiv(beatSamples[i], HOP)), bEnd = i + 1 < n ? beatSamples[i + 1] : Math.min(lenSamples, beatSamples[i] + (beatSamples[i] - (i ? beatSamples[i - 1] : 0)));
    const b = Math.max(a + 1, Math.min(F, roundDiv(bEnd, HOP)));
    const v = new Float64Array(12); let p = 0;
    for (let k = a; k < b; k++) { for (let q = 0; q < 12; q++) v[q] += chroma[k * 12 + q]; p += power[k]; }
    let nn = 0; for (let q = 0; q < 12; q++) nn += v[q] * v[q]; nn = Math.sqrt(nn);
    if (nn > 0) for (let q = 0; q < 12; q++) v[q] /= nn;
    ch.push(v); db.push(10 * dlog10(p / (b - a) + 1e-10));
  }
  return { ch, db };
}

function chooseMeter(feat, env, beatSamples, bs) {
  const n = beatSamples.length;
  if (n < 6) return { m: 4, phase: 0 };
  const low = [], on = [], chg = [];
  for (let i = 0; i < n; i++) {
    const k = Math.min(feat.F - 1, roundDiv(beatSamples[i], HOP));
    let l = 0, o = 0; for (let j = k; j < Math.min(feat.F, k + 3); j++) { l += feat.low[j]; if (env[j] > o) o = env[j]; }
    low.push(l); on.push(o);
    let d = 0; if (i > 0) { let dot = 0; for (let q = 0; q < 12; q++) dot += bs.ch[i][q] * bs.ch[i - 1][q]; d = 1 - dot; }
    chg.push(d);
  }
  const zl = zs(low), zo = zs(on), zc = zs(chg);
  const acc = zl.map((v, i) => v + zo[i] + zc[i]);
  const score = (m, ph) => { let a = 0, na = 0, b = 0, nb = 0; for (let i = 0; i < n; i++) { if (((i - ph) % m + m) % m === 0) { a += acc[i]; na++; } else { b += acc[i]; nb++; } } return (na ? a / na : 0) - (nb ? b / nb : 0); };
  let best4 = { s: -Infinity, ph: 0 }, best3 = { s: -Infinity, ph: 0 };
  for (let ph = 0; ph < 4; ph++) { const s = score(4, ph); if (s > best4.s) best4 = { s, ph }; }
  for (let ph = 0; ph < 3; ph++) { const s = score(3, ph); if (s > best3.s) best3 = { s, ph }; }
  return best3.s > 1.15 * best4.s && best3.s > 0 ? { m: 3, phase: best3.ph } : { m: 4, phase: best4.ph };
}

function estimateKey(feat) {
  const g = new Float64Array(12);
  for (let k = 0; k < feat.F; k++) for (let q = 0; q < 12; q++) g[q] += feat.chroma[k * 12 + q];
  let tot = 0; for (let q = 0; q < 12; q++) tot += g[q];
  if (!(tot > 0)) return { key: null, r: 0 };
  let best = { r: -Infinity, key: null };
  for (let mode = 0; mode < 2; mode++) for (let t = 0; t < 12; t++) {
    const prof = mode ? KEY_MIN : KEY_MAJ, rot = new Array(12);
    for (let q = 0; q < 12; q++) rot[q] = prof[((q - t) % 12 + 12) % 12];
    const r = pearson(g, rot);
    if (r > best.r) best = { r, key: (mode ? NAMES_MIN[t] + 'min' : NAMES_MAJ[t] + 'maj') };
  }
  return best;
}

function findSections(bs, beatsOut, m, durationMs) {
  const n = bs.ch.length, downIdx = [];
  beatsOut.forEach((b, i) => { if (b.downbeat) downIdx.push(i); });
  if (n < 4 * m * 2 || downIdx.length < 2) return [0];
  const zdb = zs(bs.db), wE = 0.5;
  const f = bs.ch.map((c, i) => { const v = Array.from(c); v.push(wE * Math.max(-3, Math.min(3, zdb[i]))); return v; });
  const sim = (i, j) => { let s = 0; for (let q = 0; q < 13; q++) { const d = f[i][q] - f[j][q]; s += d * d; } return -Math.sqrt(s); };
  const w = 4 * m, taper = new Float64Array(w);
  for (let a = 0; a < w; a++) { const r = (a + 0.5) / w; taper[a] = 1 - r * r; }
  const nov = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let a = -w; a < w; a++) {
      const ia = i + a; if (ia < 0 || ia >= n) continue;
      const ta = taper[a < 0 ? -a - 1 : a];
      for (let b = -w; b < w; b++) {
        const ib = i + b; if (ib < 0 || ib >= n) continue;
        const sign = (a < 0) === (b < 0) ? 1 : -1;
        s += sign * ta * taper[b < 0 ? -b - 1 : b] * sim(ia, ib);
      }
    }
    nov[i] = s;
  }
  const [mu, sd] = meanStd(nov), thr = mu + sd;
  const cands = [];
  for (let i = 1; i < n - 1; i++) if (nov[i] > thr && nov[i] >= nov[i - 1] && nov[i] > nov[i + 1]) cands.push(i);
  cands.sort((x, y) => nov[y] - nov[x] || x - y);
  const minBeats = 4 * m, chosen = [0];
  for (const c of cands) {
    // snap to nearest downbeat index (tie -> earlier)
    let sn = downIdx[0], sd2 = Infinity;
    for (const d of downIdx) { const dd = Math.abs(d - c); if (dd < sd2) { sd2 = dd; sn = d; } }
    if (sn < minBeats || n - sn < minBeats) continue;
    if (chosen.some(x => Math.abs(x - sn) < minBeats)) continue;
    chosen.push(sn);
  }
  chosen.sort((x, y) => x - y);
  return chosen;
}

function labelSections(secs, songMs) {
  const n = secs.length;
  if (n === 1) { secs[0].label = 'instrumental'; return; }
  if (n === 2) { const lo = secs[0].db <= secs[1].db ? 0 : 1; secs[lo].label = 'verse'; secs[1 - lo].label = 'chorus'; return; }
  const med = median(secs.map(s => s.db));
  if (secs[0].db < med) secs[0].label = 'intro';
  secs[n - 1].label = 'outro';
  const rest = secs.filter(s => !s.label);
  const clusters = [];
  for (const s of rest) {
    const c = clusters.find(cl => { const r = cl[0]; let dot = 0; for (let q = 0; q < 12; q++) dot += r.ch[q] * s.ch[q]; return dot >= 0.95 && Math.abs(r.db - s.db) <= 3; });
    if (c) c.push(s); else clusters.push([s]);
  }
  const rep = clusters.filter(c => c.length >= 2);
  let chorus = null, cv = -Infinity;
  for (const c of rep) { const e = c.reduce((a, s) => a + s.db, 0) / c.length; if (e > cv) { cv = e; chorus = c; } }
  for (const c of rep) for (const s of c) s.label = c === chorus ? 'chorus' : 'verse';
  for (const c of clusters) if (c.length === 1) {
    const s = c[0], pos = s.start_ms / songMs;
    if (s.db >= med && pos >= 0.4 && pos <= 0.85) s.label = 'bridge';
    else if (s.db < med - 6) s.label = 'breakdown';
    else s.label = 'instrumental';
  }
}

/**
 * analyze({ fileBytes, filename, channels: Float32Array[], sampleRate, unknownKeyToken })
 * -> { timeline, timeline_hash, sidecar }
 */
export function analyze({ fileBytes, filename, channels, sampleRate, decoder = 'unspecified', aspect = '16:9' }) {
  if (aspect !== '16:9' && aspect !== '9:16') throw new Error('aspect must be 16:9 or 9:16');
  if (!channels || !channels.length) throw new Error('no audio channels');
  const sha = sha256Bytes(fileBytes);
  const mono = downmix(channels);
  const inF32 = Float32Array.from(mono);
  const durationMs = Math.max(1, samplesToMs(mono.length, sampleRate));
  const pcm = toInt16(resampleTo22050(mono, sampleRate));
  const feat = features(pcm);
  const env = onsetEnvelope(feat.flux);
  const { period, peakiness } = estimatePeriod(env);   // float lag: used only to steer the DP, never serialized
  const frames = peakiness >= PEAKINESS_MIN ? trackBeats(env, period) : [];
  const bSamp = refineBeats(frames, feat.bE).filter(s => msOf(s) < durationMs);
  const fit = fitPeriodExact(bSamp);
  // fallback (< 4 beats): integer autocorrelation lag, still an exact rational 6000*sr/(hop*lag)
  const warnings = [];
  // contract: bpm_x100 is null exactly when beats is empty (no steady tempo found)
  let bpm_x100 = null;
  if (bSamp.length) {
    bpm_x100 = fit ? bpmX100FromPeriodRational(fit.num, fit.den) : roundDiv(6000 * SR, HOP * Math.max(1, rhu(period)));
    bpm_x100 = Math.max(2000, Math.min(40000, bpm_x100));
    if (!fit) warnings.push('fewer than 4 beats: bpm_x100 from the integer autocorrelation lag');
  } else warnings.push('no steady pulse detected: beats is empty and bpm_x100 is null');

  const bs = beatSync(feat, bSamp, pcm.length);
  const { m, phase } = chooseMeter(feat, env, bSamp, bs);
  const beats = bSamp.map((s, i) => {
    const pos = ((i - phase) % m + m) % m;
    const bar = i < phase ? 1 : Math.floor((i - phase) / m) + (phase > 0 ? 2 : 1);
    return { t_ms: msOf(s), bar, beat: pos + 1, downbeat: pos === 0 && i >= phase };
  });
  const keyRes = estimateKey(feat);
  let key = keyRes.key;
  if (!key || keyRes.r < KEY_MIN_R) { key = 'unknown'; warnings.push('no clear tonal centre: key is "unknown"'); }   // contract allows "unknown"
  const bIdx = findSections(bs, beats, m, durationMs);
  const secs = bIdx.map((bi, k) => {
    const start = k === 0 ? 0 : beats[bi].t_ms;
    const end = k + 1 < bIdx.length ? beats[bIdx[k + 1]].t_ms : durationMs;
    const fa = Math.min(feat.F - 1, roundDiv(start * SR, 1000 * HOP)), fb = Math.max(fa + 1, Math.min(feat.F, roundDiv(end * SR, 1000 * HOP)));
    let p = 0; const ch = new Float64Array(12);
    for (let f = fa; f < fb; f++) { p += feat.power[f]; for (let q = 0; q < 12; q++) ch[q] += feat.chroma[f * 12 + q]; }
    let nn = 0; for (let q = 0; q < 12; q++) nn += ch[q] * ch[q]; nn = Math.sqrt(nn); if (nn > 0) for (let q = 0; q < 12; q++) ch[q] /= nn;
    const db = 10 * dlog10(p / (fb - fa) + 1e-10);
    return { id: 's' + (k + 1), start_ms: start, end_ms: end, db, ch, label: null };
  });
  labelSections(secs, durationMs);
  const sections = secs.map(s => ({ id: s.id, label: s.label, start_ms: s.start_ms, end_ms: s.end_ms,
    // float by nature (log energy): the one rounded output field that cannot be an exact rational
    energy_q8: Math.max(0, Math.min(255, rhu((s.db + 60) * 255 / 60))) }));
  const timeline = {
    schema_version: 1,
    source: { filename: String(filename), sha256: sha, duration_ms: durationMs, sample_rate: sampleRate },
    analysis: { bpm_x100, time_signature: `${m}/4`, key, analyzer_version: ANALYZER_VERSION },
    beats, sections, lyrics: [], shots: [],
    provenance: { audio_sha256: sha, stages: [] },
    aspect,
  };
  // determinism_hash: the exact function Port's validator imports (detmath.determinismHash)
  const timeline_hash = determinismHash(timeline);
  timeline.determinism_hash = timeline_hash;
  const sidecar = {
    decoder, input_sample_rate: sampleRate, analysis_sample_rate: SR,
    input_channels: channels.length, input_samples: mono.length,
    input_pcm_sha256: sha256Bytes(new Uint8Array(inF32.buffer)),
    pcm_sha256: sha256Bytes(new Uint8Array(pcm.buffer)),
    tempo_period_frames: period, tempo_peakiness: peakiness, beat_samples: bSamp,
    period_rational: fit ? { num: fit.num.toString(), den: fit.den.toString() } : null, key_correlation: keyRes.r, meter_phase: phase,
  };
  return { timeline, timeline_hash, sidecar, warnings };
}

export { canonical, determinismHash };
