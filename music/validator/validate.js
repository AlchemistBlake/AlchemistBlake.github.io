// validate.js - shared timeline v1 validator (M-035, M-036). Owner: Port.
// Pure ES module, synchronous, no dependencies beyond stage1/detmath.js (single
// canonical-form + SHA-256 implementation shared by every stage, so hashes cannot drift).
// Runs in Node and in the browser. Returns an array of {code, path, msg}; [] means valid.
// The JSON Schema (schema/timeline.schema.json) covers types/enums; this file covers
// every invariant JSON Schema cannot express.
// sig: BWA_15.2003075_SOV_96.7Hz_SHA-BEWA_69912070
import { determinismHash } from '../stage1/detmath.js';

export const VALIDATOR_VERSION = '1.0.0';
export const SHOT_MIN_MS = 3000;
export const SHOT_MAX_MS = 15000;
const TEXT_FIELDS = ['subject', 'action', 'camera', 'lighting'];

export function beatsPerBar(ts) {
  const m = /^(\d+)\/(\d+)$/.exec(String(ts));
  if (!m) return null;
  const n = Number(m[1]), d = Number(m[2]);
  return d === 8 && n % 3 === 0 ? n / 3 : n;   // compound meters count dotted-quarter beats
}

export { determinismHash };

export function validateTimeline(tl) {
  const E = [];
  const err = (code, path, msg) => E.push({ code, path, msg });
  if (!tl || typeof tl !== 'object') { err('NOT_OBJECT', '', 'timeline is not an object'); return E; }
  if (tl.schema_version !== 1) err('SCHEMA_VERSION', 'schema_version', 'must be 1');
  const src = tl.source || {}, an = tl.analysis || {}, prov = tl.provenance || {};
  const beats = Array.isArray(tl.beats) ? tl.beats : [], sections = Array.isArray(tl.sections) ? tl.sections : [];
  const lyrics = Array.isArray(tl.lyrics) ? tl.lyrics : [], shots = Array.isArray(tl.shots) ? tl.shots : [];
  const stages = Array.isArray(prov.stages) ? prov.stages : [];
  const dur = src.duration_ms;

  // R1 hash identity
  if (src.sha256 !== prov.audio_sha256) err('AUDIO_HASH_MISMATCH', 'provenance.audio_sha256', 'must equal source.sha256');
  // R2 determinism hash (subset: source, analysis, beats, sections)
  try {
    const h = determinismHash(tl);
    if (tl.determinism_hash !== h) err('DETERMINISM_HASH', 'determinism_hash', `expected ${h}`);
  } catch (e) { err('DETERMINISM_HASH', 'determinism_hash', 'subset not hashable: ' + e.message); }

  // R3 bpm null iff no beats
  if ((an.bpm_x100 === null) !== (beats.length === 0)) err('BPM_BEATS', 'analysis.bpm_x100', 'must be null exactly when beats is empty');

  // R4 beat grid
  const bpb = beatsPerBar(an.time_signature);
  let prev = null;
  beats.forEach((b, i) => {
    const p = `beats/${i}`;
    if (!(b.t_ms <= dur)) err('BEAT_RANGE', p, 't_ms beyond duration');
    if (bpb && !(b.beat >= 1 && b.beat <= bpb)) err('BEAT_INDEX', p, `beat must be 1..${bpb}`);
    if (b.downbeat !== (b.beat === 1)) err('DOWNBEAT', p, 'downbeat must be true exactly when beat == 1');
    if (prev) {
      if (!(b.t_ms > prev.t_ms)) err('BEAT_ORDER', p, 't_ms must strictly increase');
      const ok = b.beat === 1 ? b.bar === prev.bar + 1 : (b.bar === prev.bar && b.beat === prev.beat + 1);
      if (!ok) err('BEAT_SEQUENCE', p, 'bar/beat must advance by one');
    }
    prev = b;
  });
  const downbeats = new Set(beats.filter(b => b.downbeat).map(b => b.t_ms));

  // R5 sections tile [0, duration]
  const secIds = new Set();
  sections.forEach((s, i) => {
    const p = `sections/${i}`;
    if (!(s.end_ms > s.start_ms)) err('SECTION_ORDER', p, 'end_ms must exceed start_ms');
    const expStart = i === 0 ? 0 : sections[i - 1].end_ms;
    if (s.start_ms !== expStart) err('SECTION_GAP', p, `start_ms must be ${expStart}`);
    if (secIds.has(s.id)) err('SECTION_DUP_ID', p, 'duplicate id');
    secIds.add(s.id);
  });
  if (sections.length && sections[sections.length - 1].end_ms !== dur) err('SECTION_GAP', `sections/${sections.length - 1}`, 'last end_ms must equal duration_ms');

  // R6 lyrics
  lyrics.forEach((l, i) => {
    const p = `lyrics/${i}`;
    if (!(l.end_ms > l.start_ms)) err('LYRIC_ORDER', p, 'end_ms must exceed start_ms');
    if (!(l.end_ms <= dur)) err('LYRIC_RANGE', p, 'end_ms beyond duration');
    if (i && !(l.start_ms >= lyrics[i - 1].start_ms)) err('LYRIC_ORDER', p, 'start_ms must not decrease');
  });
  if (lyrics.length && !stages.some(s => s.stage === 'lyrics')) err('PROVENANCE_MISSING', 'provenance.stages', 'lyrics present without a lyrics stage record');

  // R7 shots
  shots.forEach((s, i) => {
    const p = `shots/${i}`;
    if (s.index !== i) err('SHOT_INDEX', p, `index must be ${i}`);
    const expStart = i === 0 ? 0 : shots[i - 1].end_ms;
    if (s.start_ms !== expStart) err('SHOT_GAP', p, `start_ms must be ${expStart}`);
    const len = s.end_ms - s.start_ms;
    if (!(len >= SHOT_MIN_MS && len <= SHOT_MAX_MS)) err('SHOT_DURATION', p, `length ${len} ms outside ${SHOT_MIN_MS}..${SHOT_MAX_MS}`);
    if (downbeats.size) {
      if (s.start_ms !== 0 && !downbeats.has(s.start_ms)) err('SHOT_OFF_BAR', p, 'start_ms is not a downbeat');
      if (s.end_ms !== dur && !downbeats.has(s.end_ms)) err('SHOT_OFF_BAR', p, 'end_ms is not a downbeat');
    }
    if (!secIds.has(s.section_id)) err('SHOT_SECTION_REF', p, `section_id ${JSON.stringify(s.section_id)} not found`);
    for (const r of s.lyric_refs || []) if (!(Number.isInteger(r) && r >= 0 && r < lyrics.length)) err('SHOT_LYRIC_REF', p, `lyric_refs ${r} not found`);
    for (const f of TEXT_FIELDS) if (typeof s[f] !== 'string' || !s[f].trim()) err('SHOT_TEXT_EMPTY', `${p}.${f}`, 'must be non-empty');
  });
  if (shots.length && shots[shots.length - 1].end_ms !== dur) err('SHOT_GAP', `shots/${shots.length - 1}`, 'last end_ms must equal duration_ms');
  if (shots.length && !stages.some(s => s.stage === 'storyboard')) err('PROVENANCE_MISSING', 'provenance.stages', 'shots present without a storyboard stage record');
  return E;
}
