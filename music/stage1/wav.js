// wav.js - minimal PCM WAV codec for tests and the demo (16-bit / 32-bit float).
// sig: BWA_15.2003075_SOV_96.7Hz_SHA-BEWA_69912070
export function encodeWav16(channels, sampleRate) {
  const c = channels.length, n = channels[0].length, data = n * c * 2;
  const buf = new ArrayBuffer(44 + data), dv = new DataView(buf);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); dv.setUint32(4, 36 + data, true); w(8, 'WAVE'); w(12, 'fmt ');
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, c, true);
  dv.setUint32(24, sampleRate, true); dv.setUint32(28, sampleRate * c * 2, true);
  dv.setUint16(32, c * 2, true); dv.setUint16(34, 16, true); w(36, 'data'); dv.setUint32(40, data, true);
  let o = 44;
  for (let i = 0; i < n; i++) for (let k = 0; k < c; k++) {
    let v = Math.floor(channels[k][i] * 32767 + 0.5); v = v > 32767 ? 32767 : v < -32768 ? -32768 : v;
    dv.setInt16(o, v, true); o += 2;
  }
  return new Uint8Array(buf);
}
// Decode to Float32 channels the same way browsers do for 16-bit PCM (v / 32768).
export function decodeWav(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = o => String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3));
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('not a WAV file');
  let o = 12, fmt = null;
  while (o + 8 <= bytes.length) {
    const id = tag(o), size = dv.getUint32(o + 4, true), body = o + 8;
    if (id === 'fmt ') fmt = { format: dv.getUint16(body, true), channels: dv.getUint16(body + 2, true), rate: dv.getUint32(body + 4, true), bits: dv.getUint16(body + 14, true) };
    if (id === 'data') {
      if (!fmt) throw new Error('data before fmt');
      const bpsmp = fmt.bits / 8, n = Math.floor(size / (bpsmp * fmt.channels));
      const ch = Array.from({ length: fmt.channels }, () => new Float32Array(n));
      for (let i = 0; i < n; i++) for (let k = 0; k < fmt.channels; k++) {
        const p = body + (i * fmt.channels + k) * bpsmp;
        ch[k][i] = fmt.format === 3 ? dv.getFloat32(p, true) : fmt.bits === 16 ? dv.getInt16(p, true) / 32768 : (() => { throw new Error('unsupported WAV bits ' + fmt.bits); })();
      }
      return { channels: ch, sampleRate: fmt.rate };
    }
    o = body + size + (size & 1);
  }
  throw new Error('no data chunk');
}
// Sniff native sample rate (WAV header or first MPEG audio frame) so the browser can
// decode without resampling. Returns null when unknown.
export function sniffRate(bytes) {
  const s = String.fromCharCode(...bytes.slice(0, 4));
  if (s === 'RIFF') { try { return decodeHeaderRate(bytes); } catch { return null; } }
  let o = 0;
  if (s.startsWith('ID3')) o = 10 + ((bytes[6] & 0x7f) << 21 | (bytes[7] & 0x7f) << 14 | (bytes[8] & 0x7f) << 7 | (bytes[9] & 0x7f));
  for (let i = o; i + 4 < Math.min(bytes.length, o + 65536); i++) {
    if (bytes[i] === 0xff && (bytes[i + 1] & 0xe0) === 0xe0) {
      const ver = (bytes[i + 1] >> 3) & 3, ri = (bytes[i + 2] >> 2) & 3; if (ver === 1 || ri === 3) continue;
      const base = [44100, 48000, 32000][ri]; return ver === 3 ? base : ver === 2 ? base / 2 : base / 4;
    }
  }
  return null;
}
function decodeHeaderRate(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); let o = 12;
  while (o + 8 <= bytes.length) { const id = String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]); const size = dv.getUint32(o + 4, true); if (id === 'fmt ') return dv.getUint32(o + 12, true); o += 8 + size + (size & 1); }
  return null;
}
export function isWav(bytes) { return bytes.length > 12 && String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3], bytes[8], bytes[9], bytes[10], bytes[11]) === 'RIFFWAVE'; }
