// assemble.js - Stage 4: deterministic prompt assembly for gemini-omni-1.2-flash.
// Same timeline + same options -> byte-identical prompts, bundle and .txt.
// sig: BWA_15.2003075_SOV_96.7Hz_SHA-BEWA_69912070  (c) Blake Wayne Allcorn. All rights reserved.
import { sha256Text, canonical, determinismHash } from '../stage1/detmath.js';
import { schemaErrors } from './schema_lite.js';
import { normalizeResult, BAD_SHAPE } from './result_shape.js';

export const ASSEMBLER_VERSION = 'super-crab-assembler/1.0.0';
export const SIGNATURE = 'BWA_15.2003075_SOV_96.7Hz_SHA-BEWA_69912070';
const ASPECTS = ['16:9', '9:16'];

export function xmlEscape(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
export const sec3 = ms => `${Math.floor(ms / 1000)}.${String(ms % 1000).padStart(3, '0')}`;
export const mmss = ms => `${String(Math.floor(ms / 60000)).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;

// M-028 lint: specs Omni cannot meet (it renders 360p/720p, 16:9 or 9:16).
const BANNED = [
  { re: /\b(?:16|12|8)\s?K\b(?:\s+resolution)?/gi, why: 'resolution above what Omni renders' },
  { re: /\b(\d{2,3})\s?(?:fps|frames per second)\b/gi, why: 'frame rate above 60', test: m => Number(m[1]) > 60 },
  { re: /\bIMAX\b/gi, why: 'IMAX format' },
  { re: /\b\d{1,2}[- ]?bit\s+RAW\b/gi, why: 'RAW bit depth' },
  { re: /\b\d(?:\.\d{1,2})?\s?:\s?1\b(?:\s+aspect(?:\s+ratio)?)?/g, why: 'aspect ratio other than 16:9 / 9:16' },
  { re: /\b(?:21:9|32:9|9:21|4:3|3:4|3:2|2:3|5:4|4:5)\b(?:\s+aspect(?:\s+ratio)?)?/g, why: 'aspect ratio other than 16:9 / 9:16' },
];
export function lintText(text, field, mode, warnings) {
  let out = String(text);
  for (const b of BANNED) {
    out = out.replace(b.re, (...args) => {
      const m = args.slice(0, -2); if (typeof m[m.length - 1] === 'object') m.pop();
      if (b.test && !b.test(m)) return m[0];
      if (mode === 'reject') throw new Error(`${field}: "${m[0]}" is not allowed (${b.why}, audit M-028)`);
      warnings.push(`${field}: stripped "${m[0]}" (${b.why})`);
      return '';
    });
  }
  return out.replace(/\s{2,}/g, ' ').replace(/\s+([,.;:])/g, '$1').replace(/([,;])(\s*[,;])+/g, '$1')
    .replace(/^[\s,;.:]+/, '').replace(/[\s,;:]+$/, '').trim();
}

/** Validate before assembling. Returns a list of errors (empty = OK). */
export function validateTimeline(tl, { schema, sharedValidator, devSchemaOnly = false } = {}) {
  if (!schema) return ['no contract schema supplied'];
  const err = schemaErrors(schema, tl);
  if (err.length) return err;
  if (sharedValidator) {
    let r, n = null;
    try { r = sharedValidator(tl); n = normalizeResult(r); } catch (e) { n = ['shared validator threw (fail closed): ' + (e && e.message || String(e))]; }
    if (n === null) err.push(BAD_SHAPE); else err.push(...n);
  } else if (!devSchemaOnly) err.push('shared validator missing: refusing to assemble (fail closed; set devSchemaOnly for labelled dev mode)');
  if (typeof tl.determinism_hash === 'string' && tl.determinism_hash !== determinismHash(tl)) err.push('determinism_hash does not match source/analysis/beats/sections');
  // assembly preconditions (what this module needs to build a prompt at all; not a replacement for the shared validator)
  const aspect = jobAspect(tl);
  if (!ASPECTS.includes(aspect)) err.push(`aspect ${JSON.stringify(aspect)} is not 16:9 or 9:16`);
  if (!tl.shots.length) err.push('shots: empty (stage 3 has not run)');
  const ids = new Set(tl.sections.map(s => s.id));
  tl.shots.forEach((s, i) => {
    if (!ids.has(s.section_id)) err.push(`shots/${i}: unknown section_id ${s.section_id}`);
    for (const k of s.lyric_refs) if (!(k >= 0 && k < tl.lyrics.length)) err.push(`shots/${i}: lyric_ref ${k} out of range`);
    if (!(s.end_ms > s.start_ms)) err.push(`shots/${i}: end_ms must be > start_ms`);
  });
  return err;
}
function jobAspect(tl) { return tl.aspect; }   // contract v1: job-wide top-level aspect (M-039)

function charLine(c) { return typeof c === 'string' ? c : `${c.name}: ${c.description || ''}`; }

/**
 * assemble(timeline, options, { schema, sharedValidator, lintMode: 'strip'|'reject' })
 * options: { style, palette, characters: (string|{name,description})[], continuity }
 */
export function assemble(tl, options = {}, ctx = {}) {
  const errors = validateTimeline(tl, ctx);
  if (errors.length) { const e = new Error('timeline rejected:\n' + errors.join('\n')); e.errors = errors; throw e; }
  const mode = ctx.lintMode || 'strip', warnings = [];
  const L = (t, f) => lintText(t == null ? '' : t, f, mode, warnings);
  const style = L(options.style, 'options.style'), palette = L(options.palette, 'options.palette');
  const chars = (options.characters || []).map((c, i) => L(charLine(c), `options.characters/${i}`));
  const continuity = L(options.continuity, 'options.continuity');
  const aspect = jobAspect(tl), th = determinismHash(tl), bpm = tl.analysis.bpm_x100;
  const bpmStr = bpm === null ? 'none (no steady tempo)' : `${Math.floor(bpm / 100)}.${String(bpm % 100).padStart(2, '0')}`;
  const secById = new Map(tl.sections.map(s => [s.id, s]));
  const X = xmlEscape;
  const prompts = tl.shots.map((s, i) => {
    const f = k => L(s[k], `shots/${i}/${k}`);
    const sec = secById.get(s.section_id), dur = s.end_ms - s.start_ms;
    const inClip = tl.beats.filter(b => b.t_ms >= s.start_ms && b.t_ms < s.end_ms);
    const beatsRel = inClip.map(b => sec3(b.t_ms - s.start_ms)).join(', ');
    const downRel = inClip.filter(b => b.downbeat).map(b => `${sec3(b.t_ms - s.start_ms)} (bar ${b.bar})`).join(', ');
    const lyr = s.lyric_refs.map(k => tl.lyrics[k]).map(l => {
      const a = Math.max(0, l.start_ms - s.start_ms), e = Math.min(dur, l.end_ms - s.start_ms);
      return `    <lyric start_s="${sec3(a)}" end_s="${sec3(Math.max(a, e))}">${X(l.text)}</lyric>`;
    });
    const prev = i > 0 ? `shot ${i - 1} (${mmss(tl.shots[i - 1].start_ms)}-${mmss(tl.shots[i - 1].end_ms)}): ${X(f2(tl.shots[i - 1], i - 1))}` : 'none (opening shot)';
    function f2(p, j) { return lintText(`${p.subject}; ${p.action}`, `shots/${j}/continuity`, 'strip', []); }
    const lines = [
      `<deterministic-simulation shot="${s.index}" range="${mmss(s.start_ms)}-${mmss(s.end_ms)}" duration_s="${sec3(dur)}">`,
      `  <shot_core>`,
      `    <subject>${X(f('subject'))}</subject>`,
      `    <action>${X(f('action'))}</action>`,
      `    <camera>${X(f('camera'))}</camera>`,
      `    <lighting>${X(f('lighting'))}</lighting>`,
      `    <section label="${X(sec.label)}" id="${X(sec.id)}"/>`,
      `  </shot_core>`,
      `  <timing_sync bpm="${bpmStr}" time_signature="${tl.analysis.time_signature}" clip_start_song_s="${sec3(s.start_ms)}">`,
      `    <beats_s>${beatsRel || 'none'}</beats_s>`,
      `    <downbeats_s>${downRel || 'none'}</downbeats_s>`,
      `    <section_energy q8="${sec.energy_q8}"/>`,
      ...(lyr.length ? [`    <lyrics>`, ...lyr, `    </lyrics>`] : [`    <lyrics/>`]),
      `    <instruction>Cut and accent motion on the listed downbeats; times are seconds from the start of this clip.</instruction>`,
      `  </timing_sync>`,
      `  <low_level>Camera: ${X(f('camera'))}. Motion lands on the downbeats above. Physical behavior: real inertia, gravity, cloth and hair follow-through, no frame-rate or resolution specs.</low_level>`,
      `  <optimizations><modules>`,
      `    <style>${X(style) || 'unspecified'}</style>`,
      `    <palette>${X(palette) || 'unspecified'}</palette>`,
      `    <characters>${chars.length ? chars.map(c => `<character>${X(c)}</character>`).join('') : 'none'}</characters>`,
      `    <continuity_notes>${X(continuity) || 'none'}</continuity_notes>`,
      `  </modules></optimizations>`,
      `  <config_registry aspect_ratio="${aspect}" duration_s="${sec3(dur)}">`,
      `    <continuity_ref>${prev}</continuity_ref>`,
      `  </config_registry>`,
      `  <sys_directory audio_sha256="${tl.source.sha256}" timeline_hash="${th}" shot_index="${s.index}" shot_count="${tl.shots.length}"/>`,
      `  <index_registry_core>${SIGNATURE}</index_registry_core>`,
      `</deterministic-simulation>`,
    ];
    const text = lines.join('\n');
    return { index: s.index, start_ms: s.start_ms, end_ms: s.end_ms, range: `${mmss(s.start_ms)}-${mmss(s.end_ms)}`, duration_s: sec3(dur), sha256: sha256Text(text), text };
  });
  const body = { bundle_version: 'music-omni-prompts/1', assembler_version: ASSEMBLER_VERSION, audio_sha256: tl.source.sha256,
    timeline_hash: th, aspect, prompt_count: prompts.length, prompts, lint_warnings: warnings,
    shared_validator: ctx.sharedValidator ? 'used' : 'DEV MODE: schema-only validation, not mergeable' };
  const bundle = { ...body, bundle_sha256: sha256Text(canonical(body)) };
  const txt = prompts.map(p => `===== SHOT ${p.index}  ${p.range}  (${p.duration_s} s)  sha256 ${p.sha256} =====\n${p.text}\n`).join('\n');
  return { prompts: prompts.map(p => p.text), bundle, bundleJson: JSON.stringify(bundle, null, 2) + '\n', txt, warnings };
}
