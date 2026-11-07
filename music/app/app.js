// app.js - Music -> Omni storyboard page. Owner: Port. Wires stage 1 (Super Crab), stages 2-3
// (Elite), the shared validator (Port) and stage 4 (Super Crab) into one static page.
// Security (M-032): the Gemini key is held only in a closure variable, sent only to
// generativelanguage.googleapis.com, never written to storage, the URL, logs or exports.
// Reproducibility (M-030): a saved project replays from its JSON; it never re-calls a model.
// sig: BWA_15.2003075_SOV_96.7Hz_SHA-BEWA_69912070  (c) Blake Wayne Allcorn. All rights reserved.
import { analyze } from '../stage1/soundmap.js';
import { decodeWav, isWav, sniffRate } from '../stage1/wav.js';
import { proposeShotWindows } from '../stage1/shots.js';
import { validateTimeline } from '../validator/validate.js';
import { assemble } from '../stage4/assemble.js';

const $ = id => document.getElementById(id);
const G = self.MOGemini, W = self.MOWav, LY = self.MOLyrics;
const PRICING_URL = 'https://ai.google.dev/gemini-api/docs/pricing';
const S = { schema: null, validatorOk: false, tl: null, decoded: null, fileName: '', models: [], edited: false, assembled: null };
let apiKey = '';   // M-032: memory only

// ---------- status helpers ----------
function status(msg, kind = '') { const el = $('status'); el.textContent = msg; el.className = 'status ' + kind; }
function fmtTime(ms) { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------- startup: contract + validator behaviour check (M-041/M-044 on the page side) ----------
async function boot() {
  try {
    const [schema, probe, valid] = await Promise.all(['../schema/timeline.schema.json', '../validator/test/probe.json', '../validator/test/valid.json']
      .map(p => fetch(new URL(p, import.meta.url)).then(r => { if (!r.ok) throw new Error(`${p}: HTTP ${r.status}`); return r.json(); })));
    S.schema = schema;
    const pe = validateTimeline(probe), ve = validateTimeline(valid);
    S.validatorOk = Array.isArray(pe) && pe.length > 0 && Array.isArray(ve) && ve.length === 0;
    if (!S.validatorOk) status('Validator self-check failed, so prompt assembly is disabled.', 'err');
  } catch (e) { status('Could not load the contract or validator: ' + e.message, 'err'); }
}

// ---------- stage 1: decode + analyze ----------
async function decode(bytes) {
  if (isWav(bytes)) { try { return { ...decodeWav(bytes), decoder: 'stage1-wav' }; } catch { /* unsupported variant -> browser */ } }
  const rate = sniffRate(bytes) || 44100;
  const buf = await new OfflineAudioContext(1, 1, rate).decodeAudioData(bytes.slice().buffer);
  const channels = []; for (let k = 0; k < buf.numberOfChannels; k++) channels.push(buf.getChannelData(k));
  return { channels, sampleRate: buf.sampleRate, decoder: 'browser-decodeAudioData' };
}

async function onFile(f) {
  if (!f) return;
  S.fileName = f.name; $('dropText').textContent = f.name;
  $('analysis').textContent = 'Mapping beats, bars, sections and key…'; $('analysis').className = 'muted';
  try {
    const bytes = new Uint8Array(await f.arrayBuffer());
    await new Promise(r => setTimeout(r, 30));   // let the status paint before the CPU-heavy analysis
    const d = await decode(bytes);
    const r = analyze({ fileBytes: bytes, filename: f.name, ...d, aspect: $('aspect').value });
    S.decoded = d; S.tl = r.timeline; S.tl.aspect = $('aspect').value; S.edited = false; S.assembled = null;
    showAnalysis(r.warnings || []);
    $('step3').hidden = true; $('shots').innerHTML = '';
    refreshEstimate(); refreshRun();
  } catch (e) { $('analysis').textContent = 'Could not analyse this file: ' + e.message; $('analysis').className = 'status err'; }
}

function showAnalysis(warnings) {
  const tl = S.tl, a = tl.analysis;
  const bpm = a.bpm_x100 == null ? 'no steady tempo' : `${(a.bpm_x100 / 100).toFixed(2)} BPM`;
  const bars = tl.beats.length ? tl.beats[tl.beats.length - 1].bar : 0;
  $('analysis').className = '';
  $('analysis').textContent = `${fmtTime(tl.source.duration_ms)} · ${bpm} · ${a.time_signature} · key ${a.key} · ${bars} bars · ${tl.sections.length} sections` +
    (warnings.length ? `\n${warnings.join('\n')}` : '');
  drawWave();
}

const SEC_COLORS = { intro: '#3b4a6b', verse: '#2f6b5a', pre_chorus: '#5b5a2f', chorus: '#7a4b2a', bridge: '#5a3a6b', breakdown: '#3a5a6b', drop: '#7a2a3a', outro: '#3b4a6b', instrumental: '#44505f' };
function drawWave() {
  const c = $('wave'), tl = S.tl; c.hidden = false; $('legend').hidden = false;
  const dpr = Math.max(1, window.devicePixelRatio || 1), w = c.clientWidth || 900, h = 140;
  c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
  const g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
  const D = tl.source.duration_ms, X = ms => ms / D * w;
  for (const s of tl.sections) { g.fillStyle = SEC_COLORS[s.label] || '#333'; g.globalAlpha = .35 + .4 * s.energy_q8 / 255; g.fillRect(X(s.start_ms), 0, X(s.end_ms) - X(s.start_ms), h); }
  g.globalAlpha = 1;
  if (S.decoded) {
    const ch = S.decoded.channels[0], step = Math.max(1, Math.floor(ch.length / w));
    g.strokeStyle = '#cfd6e6'; g.beginPath();
    for (let x = 0; x < w; x++) {
      let mx = 0; const o = x * step; for (let i = 0; i < step && o + i < ch.length; i++) { const v = Math.abs(ch[o + i]); if (v > mx) mx = v; }
      g.moveTo(x + .5, h / 2 - mx * h * .45); g.lineTo(x + .5, h / 2 + mx * h * .45);
    }
    g.stroke();
  }
  g.fillStyle = '#d9a441'; for (const b of tl.beats) if (b.downbeat) g.fillRect(X(b.t_ms), h - 8, 1, 8);
  if (tl.shots.length) { g.strokeStyle = '#ffffff'; g.setLineDash([4, 3]); for (const s of tl.shots) { g.beginPath(); g.moveTo(X(s.start_ms) + .5, 0); g.lineTo(X(s.start_ms) + .5, h); g.stroke(); } g.setLineDash([]); }
  const used = [...new Set(tl.sections.map(s => s.label))];
  const chip = (color, label) => { const s = document.createElement('span'); const i = document.createElement('i'); i.style.background = color; s.append(i, label); return s; };
  $('legend').replaceChildren(...used.map(l => chip(SEC_COLORS[l] || '#333', l.replace('_', ' '))), chip('#d9a441', 'downbeat'));
  if (tl.shots.length) { const k = document.createElement('span'); k.textContent = '┆ shot cut'; $('legend').append(k); }
}

// ---------- key + model list ----------
let keyTimer = 0;
function onKey() {
  clearTimeout(keyTimer);
  apiKey = $('key').value.trim();
  $('model').disabled = true; S.models = [];
  if (!apiKey) { $('model').innerHTML = '<option>Enter key first</option>'; refreshRun(); return; }
  keyTimer = setTimeout(async () => {
    $('model').innerHTML = '<option>Checking key…</option>';
    try {
      const ids = await G.listModels(apiKey);
      const usable = ids.filter(i => /^gemini-/.test(i) && !/image|tts|live|omni|embedding/.test(i)).sort();
      const def = G.pickModel(ids);
      S.models = usable;
      $('model').innerHTML = '';
      for (const id of [def, ...usable.filter(x => x !== def)]) { const o = document.createElement('option'); o.value = o.textContent = id; $('model').append(o); }
      $('model').disabled = false; status('Key accepted. Default model: ' + def, 'ok');
    } catch (e) { $('model').innerHTML = '<option>Key not accepted</option>'; status('Google rejected the key or the request: ' + e.message, 'err'); }
    refreshEstimate(); refreshRun();
  }, 500);
}

// ---------- cost estimate (M-034): counts only; prices come from Google's page ----------
function refreshEstimate() {
  if (!S.tl) { $('estimate').hidden = true; return; }
  let n = '?'; try { n = proposeShotWindows(S.tl).shots.length; } catch { /* too short */ }
  const sec = (S.tl.source.duration_ms / 1000).toFixed(1), m = $('model').disabled ? 'the selected model' : $('model').value;
  $('estimate').hidden = false;
  $('estimate').innerHTML = '';
  $('estimate').append(`Before you run: this sends ${sec} s of audio plus two prompts to ${m}, and the storyboard will have ${n} shots totalling ${sec} s of Omni video. ` +
    'Check per-token and per-second prices on ');
  const a = document.createElement('a'); a.href = PRICING_URL; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = "Google's pricing page"; $('estimate').append(a, '. Models without a free tier bill your key.');
}
function refreshRun() { $('run').disabled = !(S.tl && apiKey && !$('model').disabled && S.validatorOk); }

// ---------- stages 2-3 ----------
async function to16kMonoWav() {
  const { channels, sampleRate } = S.decoded, n = channels[0].length;
  const len = Math.ceil(n * 16000 / sampleRate);
  const ctx = new OfflineAudioContext(1, len, 16000);
  const buf = ctx.createBuffer(channels.length, n, sampleRate);
  channels.forEach((c, k) => buf.copyToChannel(c, k));
  const src = ctx.createBufferSource(); src.buffer = buf; src.connect(ctx.destination); src.start();
  const out = await ctx.startRendering();
  return W.encodeWav16(out.getChannelData(0), 16000);
}

async function run() {
  const model = $('model').value, tl = S.tl;
  $('run').disabled = true;
  try {
    tl.lyrics = []; tl.shots = []; tl.provenance.stages = []; S.edited = false;
    status('1/3 Transcribing lyrics with ' + model + '…');
    const wav = await to16kMonoWav();
    const tr = await G.transcribe({ key: apiKey, model, wavBytes: wav, duration_ms: tl.source.duration_ms, toBase64: W.toBase64 });
    tl.lyrics = LY.snapLyrics(tr.lines, tl.beats, tl.source.duration_ms);
    tl.provenance.stages.push(tr.record);
    status(`2/3 Cutting shots on bar lines and storyboarding ${tl.lyrics.length} lyric lines…`);
    const { shots: slots, warnings } = proposeShotWindows(tl);
    const fs = await G.fillShots({ key: apiKey, model, timeline: tl, slots, brief: $('brief').value });
    tl.shots = fs.shots.map(s => { const { aspect, ...rest } = s; return rest; });
    tl.provenance.stages.push(fs.record);
    status('3/3 Validating and assembling prompts…');
    build(warnings);
    status(`Done: ${tl.shots.length} shots, ${tl.lyrics.length} lyric lines. Save the project to replay it later without calling Gemini again.`, 'ok');
  } catch (e) { status('Stopped: ' + e.message, 'err'); }
  refreshRun();
}

// ---------- validate + assemble + render ----------
function options() {
  return { style: $('style').value, palette: $('palette').value, continuity: $('cont').value,
    characters: $('chars').value.split('\n').map(s => s.trim()).filter(Boolean) };
}
function build(extraWarnings = []) {
  const tl = S.tl;
  const errs = validateTimeline(tl);
  if (errs.length) throw new Error('The timeline failed validation:\n' + errs.slice(0, 8).map(e => `${e.code} ${e.path}: ${e.msg}`).join('\n'));
  S.assembled = assemble(tl, options(), { schema: S.schema, sharedValidator: validateTimeline });
  render([...extraWarnings, ...S.assembled.warnings]);
  drawWave();
}

function render(warnings) {
  const tl = S.tl, list = $('shots'); list.innerHTML = '';
  $('step3').hidden = false;
  $('warnings').hidden = !warnings.length; $('warnings').textContent = warnings.length ? 'Notes:\n' + warnings.join('\n') : '';
  const secs = new Map(tl.sections.map(s => [s.id, s]));
  tl.shots.forEach((s, i) => {
    const li = document.createElement('li'); li.className = 'shot';
    const hd = document.createElement('header');
    const h3 = document.createElement('h3'); h3.textContent = `Shot ${i + 1} · ${fmtTime(s.start_ms)}–${fmtTime(s.end_ms)} (${((s.end_ms - s.start_ms) / 1000).toFixed(1)} s)`;
    const tag = document.createElement('span'); tag.className = 'tag'; tag.textContent = secs.get(s.section_id).label.replace('_', ' ');
    const copy = document.createElement('button'); copy.className = 'ghost'; copy.textContent = 'Copy prompt';
    copy.addEventListener('click', () => copyText(S.assembled.prompts[i], copy));
    hd.append(h3, tag, copy); li.append(hd);
    if (s.lyric_refs.length) { const p = document.createElement('p'); p.className = 'lyr'; p.textContent = s.lyric_refs.map(k => tl.lyrics[k].text).join(' / '); li.append(p); }
    const fields = document.createElement('div'); fields.className = 'fields';
    for (const f of ['subject', 'action', 'camera', 'lighting']) {
      const lab = document.createElement('label'); lab.textContent = f;
      const ta = document.createElement('textarea'); ta.rows = 2; ta.value = s[f];
      ta.addEventListener('change', () => { tl.shots[i][f] = ta.value; S.edited = true; try { build(); } catch (e) { status(e.message, 'err'); } });
      lab.append(ta); fields.append(lab);
    }
    li.append(fields);
    const pre = document.createElement('pre'); pre.textContent = S.assembled.prompts[i]; li.append(pre);
    list.append(li);
  });
}

async function copyText(text, btn) {
  try { await navigator.clipboard.writeText(text); } catch {
    const ta = document.createElement('textarea'); ta.value = text; document.body.append(ta); ta.select(); document.execCommand('copy'); ta.remove();
  }
  if (btn) { const t = btn.textContent; btn.textContent = 'Copied'; setTimeout(() => { btn.textContent = t; }, 1200); }
}

// ---------- save / replay (M-030) ----------
function saveProject() {
  const proj = { project_version: 1, saved_by: 'music-omni/app', edited_after_model: S.edited, options: options(), brief: $('brief').value, timeline: S.tl,
    sig: 'BWA_15.2003075_SOV_96.7Hz_SHA-BEWA_69912070' };
  download((S.fileName || 'song').replace(/\.[^.]+$/, '') + '.storyboard.json', JSON.stringify(proj, null, 2), 'application/json');
}
async function loadProject(f) {
  if (!f) return;
  try {
    const proj = JSON.parse(await f.text());
    const tl = proj.timeline || proj;
    S.tl = tl; S.decoded = null; S.fileName = tl.source.filename; S.edited = !!proj.edited_after_model;
    $('aspect').value = tl.aspect;
    const o = proj.options || {};
    $('style').value = o.style || ''; $('palette').value = o.palette || ''; $('cont').value = o.continuity || '';
    $('chars').value = (o.characters || []).join('\n'); $('brief').value = proj.brief || '';
    $('dropText').textContent = `${tl.source.filename} (replayed from saved project, no model calls)`;
    showAnalysis([]);
    if (tl.shots.length) build(); else { $('step3').hidden = true; }
    status('Project replayed from file. Gemini was not called.', 'ok');
    refreshEstimate(); refreshRun();
  } catch (e) { status('Could not load that project: ' + e.message, 'err'); }
}

// ---------- wiring ----------
$('file').addEventListener('change', e => onFile(e.target.files[0]));
$('loadJson').addEventListener('change', e => loadProject(e.target.files[0]));
$('aspect').addEventListener('change', () => { if (S.tl) { S.tl.aspect = $('aspect').value; if (S.tl.shots.length) try { build(); } catch (e) { status(e.message, 'err'); } } });
$('key').addEventListener('input', onKey);
$('model').addEventListener('change', refreshEstimate);
$('run').addEventListener('click', run);
for (const id of ['style', 'palette', 'chars', 'cont']) $(id).addEventListener('change', () => { if (S.tl && S.tl.shots.length) try { build(); } catch (e) { status(e.message, 'err'); } });
$('copyAll').addEventListener('click', e => copyText(S.assembled.txt, e.target));
$('dlTxt').addEventListener('click', () => download((S.fileName || 'song').replace(/\.[^.]+$/, '') + '.omni-prompts.txt', S.assembled.txt, 'text/plain'));
$('dlJson').addEventListener('click', saveProject);
window.addEventListener('resize', () => { if (S.tl) drawWave(); });
boot();
