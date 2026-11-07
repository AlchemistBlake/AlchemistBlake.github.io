// detmath.js - deterministic math + hashing used by stage 1 and stage 4.
// Only IEEE-754 basic ops (+ - * / sqrt, all correctly rounded in every JS engine)
// are used, so results are bit-identical across V8, SpiderMonkey and JavaScriptCore.
// Math.sin/cos/log/exp/pow are NOT used: their last-bit results are engine-specific.
// sig: BWA_15.2003075_SOV_96.7Hz_SHA-BEWA_69912070  (c) Blake Wayne Allcorn. All rights reserved.

export const PI = 3.141592653589793;
const TWO_PI = 6.283185307179586;
const HALF_PI = 1.5707963267948966;
const LN2 = 0.6931471805599453;
const LN10 = 2.302585092994046;

// M-037 rounding. Every output field that is a ratio of integers is rounded with roundDiv
// (exact BigInt math). rhu() is only for values that are floats by nature (decoded PCM,
// log-domain energy); each such use is listed in README "Rounding".
export function rhu(x) { return Math.floor(x + 0.5); }
// round-half-up of n/d for integers n >= 0, d > 0: floor((2n + d) / (2d)), exact in BigInt.
export function roundDiv(n, d) {
  const N = BigInt(n), D = BigInt(d);
  if (N < 0n || D <= 0n) throw new Error('roundDiv needs n >= 0, d > 0');
  return Number((2n * N + D) / (2n * D));
}
// Parse a non-negative decimal string ("120.005") as fixed point: returns { n: BigInt, scale: BigInt }.
export function parseDecimal(str) {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(String(str).trim());
  if (!m) throw new Error('not a non-negative decimal: ' + str);
  const frac = m[2] || '';
  return { n: BigInt(m[1] + frac), scale: 10n ** BigInt(frac.length) };
}

function sinPoly(x) { // |x| <= pi/4, Taylor to x^19
  const x2 = x * x; let term = x, sum = x;
  for (let n = 1; n <= 9; n++) { term = -term * x2 / ((2 * n) * (2 * n + 1)); sum += term; }
  return sum;
}
function cosPoly(x) {
  const x2 = x * x; let term = 1, sum = 1;
  for (let n = 1; n <= 9; n++) { term = -term * x2 / ((2 * n - 1) * (2 * n)); sum += term; }
  return sum;
}
export function dsin(x) {
  let k = Math.floor(x / TWO_PI); x = x - k * TWO_PI;           // [0, 2pi)
  const q = Math.floor(x / HALF_PI + 0.5); const r = x - q * HALF_PI; // |r| <= pi/4
  switch (((q % 4) + 4) % 4) {
    case 0: return sinPoly(r);
    case 1: return cosPoly(r);
    case 2: return -sinPoly(r);
    default: return -cosPoly(r);
  }
}
export function dcos(x) { return dsin(x + HALF_PI); }

// Natural log via exact power-of-two reduction then atanh series.
export function dln(x) {
  if (!(x > 0)) return -Infinity;
  let e = 0;
  while (x >= 2) { x /= 2; e++; }
  while (x < 1) { x *= 2; e--; }
  if (x > 1.4142135623730951) { x /= 2; e++; }
  const z = (x - 1) / (x + 1), z2 = z * z;
  let term = z, sum = 0;
  for (let n = 1; n < 40; n += 2) { sum += term / n; term *= z2; }
  return 2 * sum + e * LN2;
}
export function dlog10(x) { return dln(x) / LN10; }
export function dlog2(x) { return dln(x) / LN2; }

// ---------- SHA-256 (pure, synchronous) ----------
const K = new Uint32Array([
  0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
  0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
  0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
  0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
  0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
  0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
  0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
  0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2]);
export function sha256Bytes(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input.buffer ? input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength) : input);
  const len = bytes.length, bitLenHi = Math.floor(len / 0x20000000), bitLenLo = (len * 8) >>> 0;
  const total = ((len + 9 + 63) >> 6) << 6;
  const buf = new Uint8Array(total); buf.set(bytes); buf[len] = 0x80;
  const dv = new DataView(buf.buffer);
  dv.setUint32(total - 8, bitLenHi); dv.setUint32(total - 4, bitLenLo);
  const H = new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]);
  const W = new Uint32Array(64);
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) W[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const a = W[i - 15], b = W[i - 2];
      const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3);
      const s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10);
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i] + W[i]) >>> 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const mj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + mj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
  }
  let hex = '';
  for (let i = 0; i < 8; i++) hex += H[i].toString(16).padStart(8, '0');
  return hex;
}
export function utf8(str) { return new TextEncoder().encode(str); }
export function sha256Text(str) { return sha256Bytes(utf8(str)); }

// Canonical JSON: sorted keys (code-unit order), no whitespace. Rejects non-finite numbers.
export function canonical(v) {
  if (v === null || typeof v === 'boolean' || typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'number') { if (!Number.isFinite(v)) throw new Error('non-finite number'); return JSON.stringify(v); }
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  if (typeof v === 'object') {
    const keys = Object.keys(v).filter(k => v[k] !== undefined).sort();
    return '{' + keys.map(k => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
  }
  throw new Error('unsupported type ' + typeof v);
}
// determinism_hash subset: source, analysis, beats, sections only.
// M-043: source.filename is provenance only and is excluded; source.sha256 (file bytes) stays in.
export function determinismHash(tl) {
  const { filename, ...src } = tl.source || {};
  return sha256Text(canonical({ analysis: tl.analysis, beats: tl.beats, sections: tl.sections, source: src }));
}
