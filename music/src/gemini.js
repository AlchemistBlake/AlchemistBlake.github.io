// Stage 2/3b: Gemini calls. The key is passed in per call and never stored or logged.
// Every call: temperature 0, fixed seed, JSON-only output with a response schema, then
// validated in code; an invalid answer is retried with the errors (max 3 attempts).
// sig: BWA_15.2003075_SOV_96.7Hz_SHA-BEWA_69912070  (c) Blake Wayne Allcorn. All rights reserved.
'use strict';
const API = 'https://generativelanguage.googleapis.com/v1beta';
const PREFERRED = ['gemini-4-argon', 'gemini-3.8-flash', 'gemini-3.1-pro-preview', 'gemini-3-flash-preview'];
const MAX_ATTEMPTS = 3, SEED = 967, INLINE_MAX = 18 * 1024 * 1024, PROMPT_VERSION = '1.0.0';
// M-030: temperature 0 + seed reduce variance but do not make a hosted model deterministic.
// Each accepted answer is hashed into a provenance record; reproducing a run means replaying
// the saved timeline, never calling the model again.

async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const subtle = (globalThis.crypto && globalThis.crypto.subtle) || require('node:crypto').webcrypto.subtle;
  return [...new Uint8Array(await subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function stageRecord(stage, model, text, now = () => new Date()) {
  return { stage, model_id: model, prompt_version: PROMPT_VERSION, temperature: 0,
           response_sha256: await sha256Hex(text), created_at: now().toISOString() };
}

class GeminiError extends Error {}

async function listModels(key, fetchFn = fetch) {
  const ids = []; let page = '';
  do {
    const r = await fetchFn(`${API}/models?pageSize=1000${page ? `&pageToken=${page}` : ''}`, { headers: { 'x-goog-api-key': key } });
    if (!r.ok) throw new GeminiError(`listing models failed: HTTP ${r.status}`);
    const j = await r.json();
    for (const m of j.models || []) if ((m.supportedGenerationMethods || []).includes('generateContent')) ids.push(m.name.replace(/^models\//, ''));
    page = j.nextPageToken || '';
  } while (page);
  return ids;
}

function pickModel(ids) {
  for (const p of PREFERRED) if (ids.includes(p)) return p;
  const flash = ids.filter(i => /^gemini-.*flash/.test(i) && !/image|tts|live|omni/.test(i)).sort();
  if (flash.length) return flash[flash.length - 1];
  throw new GeminiError('this key has none of the supported Gemini text models');
}

async function generateJSON({ key, model, parts, schema, check, fetchFn = fetch }) {
  let feedback = '', last = [];
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const body = {
      contents: [{ role: 'user', parts: feedback ? [...parts, { text: feedback }] : parts }],
      generationConfig: { temperature: 0, seed: SEED, responseMimeType: 'application/json', responseSchema: schema },
    };
    const r = await fetchFn(`${API}/models/${model}:generateContent`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify(body),
    });
    if (!r.ok) throw new GeminiError(`${model} returned HTTP ${r.status}`);
    const j = await r.json(), c = (j.candidates || [])[0];
    const text = c && c.content && (c.content.parts || []).map(p => p.text || '').join('');
    let out = null;
    try { out = JSON.parse(text); last = check(out); } catch (e) { last = [`not valid JSON: ${e.message}`]; }
    if (!last.length) return { value: out, attempts: attempt, text };
    feedback = `Your previous answer was rejected for these reasons. Return corrected JSON only.\n- ${last.join('\n- ')}`;
  }
  throw new GeminiError(`no valid answer after ${MAX_ATTEMPTS} attempts: ${last.slice(0, 5).join('; ')}`);
}

const LYRICS_SCHEMA = { type: 'OBJECT', required: ['lines'], properties: { lines: { type: 'ARRAY', items: {
  type: 'OBJECT', required: ['start_ms', 'end_ms', 'text'],
  properties: { start_ms: { type: 'INTEGER' }, end_ms: { type: 'INTEGER' }, text: { type: 'STRING' } } } } } };

async function transcribe({ key, model, wavBytes, duration_ms, toBase64, fetchFn = fetch }) {
  if (wavBytes.length > INLINE_MAX) throw new GeminiError(`audio is ${wavBytes.length} bytes; inline limit here is ${INLINE_MAX}`);
  const parts = [
    { inlineData: { mimeType: 'audio/wav', data: toBase64(wavBytes) } },
    { text: `Transcribe the sung or spoken lyrics of this ${duration_ms} ms recording, one entry per sung line, in order. ` +
            'start_ms and end_ms are integer milliseconds from the start of the audio. Copy words exactly as sung; ' +
            'do not add, fix or translate anything. Mark unclear words as [inaudible]. If there are no vocals, return an empty list.' },
  ];
  const check = o => {
    const e = [];
    if (!o || !Array.isArray(o.lines)) return ['missing lines array'];
    o.lines.forEach((l, i) => {
      if (!Number.isInteger(l.start_ms) || !Number.isInteger(l.end_ms)) e.push(`line ${i}: times must be integers`);
      else if (l.start_ms < 0 || l.end_ms > duration_ms || l.start_ms >= l.end_ms) e.push(`line ${i}: times outside 0..${duration_ms} or start >= end`);
      if (typeof l.text !== 'string' || !l.text.trim()) e.push(`line ${i}: empty text`);
    });
    return e;
  };
  const { value, attempts, text } = await generateJSON({ key, model, parts, schema: LYRICS_SCHEMA, check, fetchFn });
  return { lines: value.lines, attempts, record: await stageRecord('lyrics', model, text) };
}

const SHOTS_SCHEMA = { type: 'OBJECT', required: ['shots'], properties: { shots: { type: 'ARRAY', items: {
  type: 'OBJECT', required: ['index', 'subject', 'action', 'camera', 'lighting'],
  properties: { index: { type: 'INTEGER' }, subject: { type: 'STRING' }, action: { type: 'STRING' },
                camera: { type: 'STRING' }, lighting: { type: 'STRING' } } } } } };

// Gemini fills only the creative fields of slots that code already cut and timed.
async function fillShots({ key, model, timeline, slots, brief = '', fieldMax = 400, fetchFn = fetch }) {
  const secs = Object.fromEntries(timeline.sections.map(s => [s.id, s]));
  const plan = slots.map(s => ({
    index: s.index, seconds: `${(s.start_ms / 1000).toFixed(3)}-${(s.end_ms / 1000).toFixed(3)}`,
    section: secs[s.section_id].label, energy_0_255: secs[s.section_id].energy_q8,
    lyrics: s.lyric_refs.map(k => timeline.lyrics[k].text),
  }));
  const parts = [{ text:
    `You are the director storyboarding a music video. Song: ${timeline.analysis.bpm_x100 == null ? "no steady tempo" : timeline.analysis.bpm_x100 / 100 + " BPM"}, ` +
    `${timeline.analysis.time_signature} time, key ${timeline.analysis.key}. Creative brief from the artist: ${brief || '(none)'}\n` +
    `Fill exactly one entry for every shot below, same index, same order. Each field is concrete and visible on camera, ` +
    `under ${fieldMax} characters: subject (who/what is in frame), action (what moves, synced to the section and lyric), ` +
    `camera (shot size, lens, movement), lighting (sources, colour, contrast). Keep characters, wardrobe and setting continuous ` +
    `between shots. No resolutions, frame rates or technical numbers the video model cannot honour.\nShots:\n${JSON.stringify(plan)}` }];
  const check = o => {
    if (!o || !Array.isArray(o.shots)) return ['missing shots array'];
    const e = [];
    if (o.shots.length !== slots.length) e.push(`expected ${slots.length} shots, got ${o.shots.length}`);
    o.shots.forEach((s, i) => {
      if (s.index !== i) e.push(`entry ${i} has index ${s.index}`);
      for (const f of ['subject', 'action', 'camera', 'lighting']) {
        if (typeof s[f] !== 'string' || !s[f].trim()) e.push(`shot ${i}: ${f} empty`);
        else if (s[f].length > fieldMax) e.push(`shot ${i}: ${f} is ${s[f].length} chars, max ${fieldMax}`);
      }
    });
    return e;
  };
  const { value, attempts, text } = await generateJSON({ key, model, parts, schema: SHOTS_SCHEMA, check, fetchFn });
  const shots = slots.map((s, i) => ({ ...s, subject: value.shots[i].subject.trim(), action: value.shots[i].action.trim(),
    camera: value.shots[i].camera.trim(), lighting: value.shots[i].lighting.trim() }));
  return { shots, attempts, record: await stageRecord('storyboard', model, text) };
}

const api = { sha256Hex, stageRecord, PROMPT_VERSION, listModels, pickModel, generateJSON, transcribe, fillShots, GeminiError, PREFERRED, MAX_ATTEMPTS, SEED };
if (typeof module !== 'undefined') module.exports = api; else self.MOGemini = api;
