#!/usr/bin/env node
/**
 * BeatVision Arena - Termux Full Creator Pipeline Runner
 *
 * Mirrors the browser's live pipeline in animation-bridge.js/app.js:
 * analyzeAudio -> revealWorld -> worldAssets -> storyboard -> sceneImages
 * -> persistent animation job -> assemble.
 *
 * Safety rules:
 * - Network retries only retry interrupted HTTP transport, never provider jobs.
 * - Persistent animation is POSTed exactly once per persisted job.
 * - If Termux restarts, an existing animation job_id is resumed/polled.
 * - Every successful stage response is persisted before advancing.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const GATEWAY = (process.env.BEATVISION_GATEWAY || 'https://beatvision-provider-arena.richardcranium466.workers.dev').replace(/\/$/, '');
const TOKEN = process.env.BEATVISION_GATEWAY_TOKEN || '';
const AUDIO = path.resolve(process.env.BEATVISION_AUDIO || `${process.env.HOME}/storage/downloads/az_recorder_20260905_230436.mp3`);
const OUT = path.resolve(process.env.BEATVISION_OUTPUT || `${process.env.HOME}/beatvision-full-pipeline`);
const CONTRACT = '1.1';
const POLL_MS = Number(process.env.BEATVISION_POLL_MS || 5000);
const MAX_NETWORK_RETRIES = 3;
const RETRY_DELAYS = [2000, 5000, 10000];
const MAX_SCENES = 64;
const MAX_AUDIO_BYTES = 5_500_000;

const songTitle = process.env.BEATVISION_SONG_TITLE || path.basename(AUDIO).replace(/\.[^.]+$/, '');
const style = process.env.BEATVISION_STYLE || 'dark cinematic industrial';
const lyrics = process.env.BEATVISION_LYRICS || '';
const lyricsFile = process.env.BEATVISION_LYRICS_FILE ? path.resolve(process.env.BEATVISION_LYRICS_FILE) : null;

const STAGES = [
  ['audio', 'analyzeAudio', '/v1/audio/analyze'],
  ['world', 'revealWorld', '/v1/language/world'],
  ['assets', 'worldAssets', '/v1/image/world-assets'],
  ['storyboard', 'storyboard', '/v1/language/storyboard'],
  ['images', 'sceneImages', '/v1/image/scenes'],
  ['animation', 'persistentAnimation', '/v1/video/animate/jobs/{jobId}'],
  ['assemble', 'assemble', '/v1/video/assemble']
];

fs.mkdirSync(OUT, { recursive: true });
for (const [dir] of STAGES) fs.mkdirSync(path.join(OUT, dir), { recursive: true });

const statePath = path.join(OUT, 'state.json');
const eventsPath = path.join(OUT, 'events.jsonl');
const finalReportPath = path.join(OUT, 'final-report.json');
let state = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : {
  version: 2,
  started_at: new Date().toISOString(),
  gateway: GATEWAY,
  contract_version: CONTRACT,
  song_title: songTitle,
  style,
  stages: {},
  animation: { post_count: 0, job_id: null, status: null },
  complete: false
};

function saveState() {
  const tmp = `${statePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, statePath);
}
function event(type, data = {}) {
  const item = { at: new Date().toISOString(), type, ...data };
  fs.appendFileSync(eventsPath, JSON.stringify(item) + '\n');
  console.log(`[${item.at}] ${type}${Object.keys(data).length ? ` ${JSON.stringify(data)}` : ''}`);
}
function saveJson(rel, data) {
  const p = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, p);
}
function requestEvidence(name, req, res) {
  saveJson(`requests/${name}.json`, { ...req, headers: Object.fromEntries(Object.entries(req.headers || {}).map(([k, v]) => [k, /authorization/i.test(k) ? 'Bearer [REDACTED]' : v])) });
  saveJson(`responses/${name}.json`, res);
}
function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
function readLyrics() {
  if (lyricsFile) return fs.readFileSync(lyricsFile, 'utf8');
  return lyrics;
}
function audioDataUrl() {
  if (!fs.existsSync(AUDIO)) throw new Error(`Audio file not found: ${AUDIO}`);
  const stat = fs.statSync(AUDIO);
  if (stat.size > MAX_AUDIO_BYTES) throw new Error(`Browser-equivalent live audio limit exceeded: ${stat.size} bytes > ${MAX_AUDIO_BYTES}.`);
  const ext = path.extname(AUDIO).toLowerCase();
  const mime = ({'.mp3':'audio/mpeg','.wav':'audio/wav','.m4a':'audio/mp4','.aac':'audio/aac','.flac':'audio/flac'})[ext] || 'audio/mpeg';
  const buf = fs.readFileSync(AUDIO);
  return { data: `data:${mime};base64,${buf.toString('base64')}`, mime, name: path.basename(AUDIO), size: stat.size, sha256: sha256File(AUDIO) };
}
function inputFingerprint(audio) {
  return crypto.createHash('sha256').update(JSON.stringify({
    gateway: GATEWAY,
    contract_version: CONTRACT,
    song_title: songTitle,
    style,
    lyrics: readLyrics(),
    lyrics_file: lyricsFile,
    audio_sha256: audio.sha256,
    audio_size_bytes: audio.size,
    audio_mime_type: audio.mime,
    audio_filename: audio.name
  })).digest('hex');
}
function establishInputFingerprint(audio) {
  const fingerprint = inputFingerprint(audio);
  if (state.input_fingerprint) {
    if (state.input_fingerprint !== fingerprint) {
      throw new Error(`Input fingerprint mismatch for ${OUT}. Refusing to resume state created for different project inputs.`);
    }
    return fingerprint;
  }
  const priorAudioInfoPath = path.join(OUT, 'audio', 'info.json');
  const priorInputPath = path.join(OUT, 'audio', 'input.json');
  let priorAudio = null;
  let priorInput = null;
  try { if (fs.existsSync(priorAudioInfoPath)) priorAudio = JSON.parse(fs.readFileSync(priorAudioInfoPath, 'utf8')); } catch {}
  try { if (fs.existsSync(priorInputPath)) priorInput = JSON.parse(fs.readFileSync(priorInputPath, 'utf8')); } catch {}
  if (state.animation?.job_id || Object.values(state.stages || {}).some(x => x?.complete)) {
    const sameKnownInputs = priorAudio?.sha256 === audio.sha256 && priorAudio?.bytes === audio.size && priorInput?.song_title === songTitle && priorInput?.style === style && priorInput?.lyrics === readLyrics() && state.gateway === GATEWAY && state.contract_version === CONTRACT;
    if (!sameKnownInputs) {
      throw new Error(`Legacy state in ${OUT} has no trusted input fingerprint. Refusing unsafe resume. Use a new BEATVISION_OUTPUT directory for a fresh run.`);
    }
    state.input_fingerprint = fingerprint;
    state.fingerprint_migrated_at = new Date().toISOString();
    saveState();
    event('input_fingerprint_migrated', { fingerprint });
    return fingerprint;
  }
  state.input_fingerprint = fingerprint;
  saveState();
  event('input_fingerprint_created', { fingerprint });
  return fingerprint;
}
async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function headers(token = TOKEN) {
  return { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}
async function fetchWithNetworkRetry(url, options = {}, label = 'request') {
  let last;
  for (let attempt = 0; attempt <= MAX_NETWORK_RETRIES; attempt++) {
    try { return await fetch(url, options); }
    catch (error) {
      last = error;
      if (attempt === MAX_NETWORK_RETRIES) break;
      event('transport_retry', { label, attempt: attempt + 1, max: MAX_NETWORK_RETRIES, error: error?.message || String(error) });
      await sleep(RETRY_DELAYS[attempt]);
    }
  }
  throw new Error(`${label} failed after network retries: ${last?.message || 'Failed to fetch'}`);
}
async function parseResponse(r) {
  const text = await r.text();
  let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
  return { status: r.status, ok: r.ok, data };
}
async function gatewayGet(pathname, name) {
  const req = { method: 'GET', url: `${GATEWAY}${pathname}`, headers: headers() };
  const started = Date.now();
  const r = await fetchWithNetworkRetry(req.url, { headers: req.headers }, name);
  const parsed = await parseResponse(r);
  const res = { ...parsed, elapsed_ms: Date.now() - started };
  requestEvidence(name, req, res);
  if (!r.ok) throw Object.assign(new Error(`${r.status}: ${parsed.data?.error || JSON.stringify(parsed.data)}`), { status: r.status, data: parsed.data });
  return parsed.data;
}
async function callGateway(operation, payload, indexName) {
  const requestId = crypto.randomUUID();
  const urlMap = Object.fromEntries(STAGES.map(([, op, p]) => [op, p]));
  const pathname = urlMap[operation];
  const body = { contract_version: CONTRACT, operation, payload };
  const reqHeaders = { ...headers(), 'X-BeatVision-Contract': CONTRACT, 'X-BeatVision-Request': requestId };
  const req = { method: 'POST', url: `${GATEWAY}${pathname}`, headers: reqHeaders, body };
  const started = Date.now();
  const r = await fetchWithNetworkRetry(req.url, { method: 'POST', headers: reqHeaders, body: JSON.stringify(body) }, operation);
  const parsed = await parseResponse(r);
  const res = { ...parsed, request_id: parsed.data?.request_id || requestId, elapsed_ms: Date.now() - started };
  requestEvidence(indexName, req, res);
  if (!r.ok) throw Object.assign(new Error(`${r.status}: ${parsed.data?.error || JSON.stringify(parsed.data)}`), { status: r.status, data: parsed.data, requestId: res.request_id });
  return { result: parsed.data?.result ?? parsed.data, meta: { request_id: res.request_id, status: r.status, latency_ms: parsed.data?.latency_ms ?? res.elapsed_ms, capability: parsed.data?.capability, provider: parsed.data?.provider || parsed.data?.provider_name || 'gateway' } };
}
function projectPayload() {
  const a = audioDataUrl();
  const p = { song_title: songTitle, style, lyrics: readLyrics(), audio_base64: a.data, audio_mime_type: a.mime, audio_filename: a.name, audio_size_bytes: a.size };
  saveJson('audio/input.json', { ...p, audio_base64: `[${a.size} bytes base64 data omitted]`, sha256: a.sha256 });
  return p;
}
async function runStage(key, operation, payload) {
  if (state.stages[key]?.complete && state.stages[key]?.result) {
    event('stage_resume', { stage: key, operation });
    return state.stages[key].result;
  }
  event('stage_start', { stage: key, operation });
  const out = await callGateway(operation, payload, `${String(Object.keys(state.stages).length + 1).padStart(2,'0')}-${key}`);
  saveJson(`${key}/result.json`, out.result);
  state.stages[key] = { complete: true, operation, completed_at: new Date().toISOString(), meta: out.meta, result: out.result };
  saveState();
  event('stage_complete', { stage: key, operation, request_id: out.meta.request_id, status: out.meta.status, provider: out.meta.provider });
  return out.result;
}
async function runSceneImages(payload) {
  if (state.stages.images?.complete && state.stages.images.result) return state.stages.images.result;
  const scenes = Array.isArray(payload?.storyboard?.scenes) ? payload.storyboard.scenes.slice(0, MAX_SCENES) : [];
  if (!scenes.length) throw new Error('sceneImages requires storyboard scenes.');
  const outputs = [], failed = [], models = new Set();
  event('scene_batch_start', { count: scenes.length });
  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    const sceneNumber = Number(scene?.scene || i + 1);
    const single = { ...payload, storyboard: { ...payload.storyboard, scenes: [scene] } };
    delete single.images;
    const label = `scene-${String(sceneNumber).padStart(3,'0')}`;
    try {
      event('scene_image_start', { scene: sceneNumber, total: scenes.length });
      const out = await callGateway('sceneImages', single, `images/${label}`);
      const got = out.result?.images || [];
      outputs.push(...got);
      (out.result?.models_used || []).forEach(x => models.add(x));
      saveJson(`images/${label}.json`, out);
      event('scene_image_complete', { scene: sceneNumber, status: out.meta.status, count: got.length, provider: out.meta.provider });
    } catch (error) {
      const failure = { scene: sceneNumber, status: error.status || 502, error: error.message, request_id: error.requestId || null };
      failed.push(failure);
      saveJson(`images/${label}-failure.json`, failure);
      event('scene_image_failed', failure);
    }
  }
  if (!outputs.length && failed.length) throw new Error('sceneImages failed for every scene.');
  const result = { images: outputs, models_used: [...models], scene_count: outputs.length, requested_scene_count: scenes.length, failed_scenes: failed, free_only: true };
  saveJson('images/result.json', result);
  state.stages.images = { complete: true, operation: 'sceneImages', completed_at: new Date().toISOString(), result };
  saveState();
  event('stage_complete', { stage: 'images', generated: outputs.length, failed: failed.length });
  return result;
}
async function persistentAnimation(payload) {
  if (state.animation.job_id) {
    event('animation_resume', { job_id: state.animation.job_id, post_count: state.animation.post_count });
  } else {
    const jobId = crypto.randomUUID();
    const url = `${GATEWAY}/v1/video/animate/jobs/${jobId}`;
    const body = { contract_version: CONTRACT, operation: 'animate', storyboard: payload.storyboard, images: payload.images };
    const reqHeaders = { ...headers(), 'X-BeatVision-Contract': CONTRACT, 'X-BeatVision-Request': jobId };
    if (!Array.isArray(body.storyboard?.scenes) || !body.storyboard.scenes.length) throw new Error('Refusing animation submission: storyboard.scenes is empty.');
    if (!Array.isArray(body.images?.images) || !body.images.images.length) throw new Error('Refusing animation submission: images.images is empty.');
    state.animation = { job_id: jobId, post_count: 0, status: 'submitting', created_at: new Date().toISOString() };
    saveState();
    event('animation_submit_start', { job_id: jobId, scenes: body.storyboard.scenes.length, images: body.images.images.length, safety: 'ONE_POST_ONLY' });
    const req = { method: 'POST', url, headers: reqHeaders, body };
    const started = Date.now();
    const r = await fetchWithNetworkRetry(url, { method: 'POST', headers: reqHeaders, body: JSON.stringify(body) }, 'Animation job submission');
    const parsed = await parseResponse(r);
    const res = { ...parsed, request_id: parsed.data?.request_id || jobId, elapsed_ms: Date.now() - started };
    requestEvidence('animation/submit', req, res);
    if (!r.ok) {
      state.animation.status = 'submit_failed'; state.animation.submit_response = res; saveState();
      throw Object.assign(new Error(`${r.status}: ${parsed.data?.error || JSON.stringify(parsed.data)}`), { status: r.status, data: parsed.data, requestId: res.request_id });
    }
    state.animation.post_count = 1;
    state.animation.status = parsed.data?.status || 'queued';
    state.animation.accepted_response = parsed.data;
    saveState();
    event('animation_submit_accepted', { job_id: jobId, status: state.animation.status, post_count: 1 });
  }
  while (true) {
    const jobId = state.animation.job_id;
    const url = `${GATEWAY}/v1/video/animate/jobs/${jobId}`;
    const req = { method: 'GET', url, headers: headers() };
    const r = await fetchWithNetworkRetry(url, { headers: req.headers }, 'Animation job status');
    const parsed = await parseResponse(r);
    const res = { ...parsed, elapsed_ms: 0 };
    requestEvidence(`animation/status-${Date.now()}`, req, res);
    if (!r.ok) throw Object.assign(new Error(`${r.status}: ${parsed.data?.error || JSON.stringify(parsed.data)}`), { status: r.status, data: parsed.data });
    const job = parsed.data;
    state.animation.last_status = job;
    state.animation.status = job.status;
    state.animation.updated_at = new Date().toISOString();
    saveState();
    event('animation_poll', { job_id: jobId, status: job.status, completed: job.clips?.length || 0, failed: job.failed?.length || 0, total: job.scenes?.length || 0 });
    if (['completed','partial','failed'].includes(job.status)) {
      saveJson('animation/final-job.json', job);
      if (job.status === 'failed' && !(job.clips || []).length) throw new Error('Persistent animation failed for every scene.');
      const motion = { status: job.failed?.length ? 'partial' : 'animated', clips: job.clips || [], video_url: job.clips?.[0]?.video_url || null, source: 'Pixazo free LTX image-to-video', models_used: ['ltx-video'], scene_count: job.clips?.length || 0, requested_scene_count: job.scenes?.length || 0, failed_scenes: job.failed || [] };
      state.stages.animation = { complete: true, operation: 'persistentAnimation', completed_at: new Date().toISOString(), result: motion };
      saveJson('animation/result.json', motion); saveState();
      return motion;
    }
    await sleep(POLL_MS);
  }
}
async function downloadFinal(result) {
  const candidates = [result?.video_url, result?.preview_url, result?.url, result?.output?.url].filter(Boolean);
  if (!candidates.length) { event('final_download_skipped', { reason: 'No video URL in assembly result.' }); return null; }
  const url = candidates[0];
  if (!/^https?:\/\//i.test(url)) { event('final_download_skipped', { reason: 'Final URL is not HTTP(S).', url }); return null; }
  const target = path.join(OUT, 'final', 'beatvision-final.mp4');
  event('final_download_start', { url: url.replace(/([?&](?:token|key|signature)=[^&]+)/ig, '$1=[REDACTED]') });
  const r = await fetchWithNetworkRetry(url, {}, 'Final MP4 download');
  if (!r.ok) throw new Error(`Final MP4 download failed: ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  fs.writeFileSync(target, buf);
  const stat = fs.statSync(target);
  saveJson('final/download.json', { url, path: target, bytes: stat.size, sha256: sha256File(target), downloaded_at: new Date().toISOString() });
  event('final_download_complete', { path: target, bytes: stat.size, sha256: sha256File(target) });
  return target;
}
function probeMedia(file) {
  if (!file || !fs.existsSync(file)) return { available: false, reason: 'file_missing' };
  try {
    const out = execFileSync('ffprobe', ['-v','error','-show_entries','format=duration,size,format_name:stream=index,codec_type,codec_name,width,height,r_frame_rate','-of','json',file], { encoding:'utf8' });
    return { available: true, ...JSON.parse(out) };
  } catch (e) { return { available: false, reason: 'ffprobe_unavailable_or_failed', error: e.message }; }
}
async function main() {
  console.log('\n==========================================');
  console.log(' BeatVision Arena - TERMUX FULL PIPELINE');
  console.log('==========================================');
  console.log(`Gateway: ${GATEWAY}`);
  console.log(`Audio:   ${AUDIO}`);
  console.log(`Output:  ${OUT}`);
  console.log(`Song:    ${songTitle}`);
  console.log(`Style:   ${style}`);
  console.log(`Contract:${CONTRACT}`);
  console.log('');

  const audio = audioDataUrl();
  establishInputFingerprint(audio);
  saveJson('audio/info.json', { file: AUDIO, name: audio.name, mime: audio.mime, bytes: audio.size, sha256: audio.sha256, browser_equivalent_limit: MAX_AUDIO_BYTES });
  event('run_start', { gateway: GATEWAY, audio: AUDIO, song_title: songTitle, style, contract_version: CONTRACT, input_fingerprint: state.input_fingerprint, resumed: !!state.animation.job_id });

  const health = await gatewayGet('/health', 'health');
  saveJson('gateway/health.json', health);
  const caps = await gatewayGet('/v1/capabilities', 'capabilities');
  saveJson('gateway/capabilities.json', caps);
  const cap = caps?.capabilities || {};
  console.log(`Capabilities: video=${!!cap.video?.configured}, persistent_animation=${!!cap.persistent_animation?.configured}, image=${!!cap.image?.configured}, audio=${!!cap.audio?.configured}, language=${!!cap.language?.configured}, assembly=${!!cap.assembly?.configured}`);

  const p = projectPayload();
  const audioResult = await runStage('audio', 'analyzeAudio', p);
  const world = await runStage('world', 'revealWorld', { ...p, audio: audioResult });
  const assets = await runStage('assets', 'worldAssets', { ...p, world });
  const storyboard = await runStage('storyboard', 'storyboard', { ...p, audio: audioResult, world, assets });
  const images = await runSceneImages({ ...p, audio: audioResult, world, assets, storyboard });
  const motion = await persistentAnimation({ storyboard, images });
  const assembled = await runStage('assemble', 'assemble', { ...p, audio: audioResult, motion });
  const finalFile = await downloadFinal(assembled);
  const probe = probeMedia(finalFile);

  state.complete = true; state.completed_at = new Date().toISOString(); state.final = { assembled, final_file: finalFile, probe }; saveState();
  const report = { ok: true, completed_at: state.completed_at, gateway: GATEWAY, contract_version: CONTRACT, input_fingerprint: state.input_fingerprint, song_title: songTitle, style, audio: { file: AUDIO, bytes: audio.size, sha256: audio.sha256 }, stages: Object.fromEntries(Object.entries(state.stages).map(([k,v]) => [k, { complete: v.complete, operation: v.operation, status: v.meta?.status }])), animation: { job_id: state.animation.job_id, post_count: state.animation.post_count, final_status: state.animation.status, scene_count: motion.scene_count, failed_scene_count: motion.failed_scenes.length }, assembly: assembled, final_file: finalFile, final_media_probe: probe };
  saveJson('final-report.json', report);
  event('run_complete', { ok: true, final_file: finalFile, animation_post_count: state.animation.post_count });
  console.log('\n==========================================');
  console.log(' FULL PIPELINE COMPLETE');
  console.log('==========================================');
  console.log(`Final report: ${finalReportPath}`);
  if (finalFile) console.log(`Final MP4:    ${finalFile}`);
  console.log(`Animation POST count: ${state.animation.post_count}`);
}
main().catch(error => {
  state.failed = { at: new Date().toISOString(), status: error.status || 0, error: error.message, animation_post_count: state.animation.post_count, animation_job_id: state.animation.job_id, input_fingerprint: state.input_fingerprint || null };
  saveState();
  saveJson('final-report.json', { ok: false, error: state.failed, state });
  event('run_failed', state.failed);
  console.error('\nPIPELINE FAILED:', error.message);
  console.error(`State preserved: ${statePath}`);
  process.exit(1);
});
