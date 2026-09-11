const BASE = 'https://api.shotstack.io';
const STAGE = `${BASE}/edit/stage`;
const INGEST_STAGE = `${BASE}/ingest/stage`;

function cors(r: Request, e: any) {
  const o = r.headers.get('Origin') || '';
  const allowed = String(e.ALLOWED_ORIGIN || '').split(',').map((x: string) => x.trim()).filter(Boolean);
  return {
    'Access-Control-Allow-Origin': o && (!allowed.length || allowed.includes(o)) ? o : (allowed[0] || '*'),
    'Vary': 'Origin', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,X-BeatVision-Contract,Authorization,X-BeatVision-Request', 'Access-Control-Max-Age': '86400'
  };
}
function json(r: Request, e: any, d: unknown, status = 200) { return new Response(JSON.stringify(d, null, 2), { status, headers: { 'Content-Type': 'application/json', ...cors(r, e) } }); }
function auth(r: Request, e: any) { return !e.GATEWAY_TOKEN || r.headers.get('Authorization') === `Bearer ${e.GATEWAY_TOKEN}`; }
function dataUrlToBlob(value: string) { const comma = value.indexOf(','); if (comma < 0 || !value.startsWith('data:')) throw new Error('Invalid data URL'); const header = value.slice(5, comma); const mime = header.split(';')[0] || 'application/octet-stream'; const base64 = value.slice(comma + 1).replace(/\s/g, ''); const binary = atob(base64); const bytes = new Uint8Array(binary.length); for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i); return new Blob([bytes], { type: mime }); }
async function shotstackFetch(path: string, key: string, init: RequestInit = {}) { const headers = new Headers(init.headers || {}); headers.set('x-api-key', key); headers.set('Accept', 'application/json'); const response = await fetch(`${BASE}${path}`, { ...init, headers }); const text = await response.text(); let data: any; try { data = JSON.parse(text); } catch { data = { raw: text }; } if (!response.ok) throw new Error(`Shotstack ${response.status}: ${String(data?.message || data?.error || text).slice(0, 1800)}`); return data; }
async function uploadDataUrl(value: string, key: string, filename: string) { const blob = dataUrlToBlob(value); const ticket = await shotstackFetch('/ingest/stage/upload', key, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filename }) }); const id = ticket?.data?.id || ticket?.data?.attributes?.id; const signed = ticket?.data?.attributes?.url; if (!id || !signed) throw new Error('Shotstack ingest did not return a signed upload URL.'); const put = await fetch(signed, { method: 'PUT', headers: { 'Content-Type': blob.type || 'application/octet-stream' }, body: blob }); if (!put.ok) throw new Error(`Shotstack source upload returned ${put.status}.`); const deadline = Date.now() + 90_000; while (Date.now() < deadline) { const status = await shotstackFetch(`/ingest/stage/sources/${encodeURIComponent(id)}`, key); const attrs = status?.data?.attributes || {}; if (attrs.status === 'ready' && attrs.source) return attrs.source as string; if (['failed', 'error'].includes(String(attrs.status || '').toLowerCase())) throw new Error(`Shotstack source ingest failed: ${String(attrs.error || attrs.status)}`); await new Promise(resolve => setTimeout(resolve, 2000)); } throw new Error('Shotstack source ingest timed out after 90 seconds.'); }
export async function resolveShotstackSource(value: unknown, key: string, filename: string) { if (typeof value !== 'string' || !value) throw new Error(`Missing ${filename} source.`); if (value.startsWith('data:')) return uploadDataUrl(value, key, filename); if (/^https?:\/\//i.test(value)) return value; throw new Error(`Unsupported ${filename} source. Expected an https URL or data URL.`); }

export async function animateStillWithShotstack(r: Request, e: any, image: string, id: string) {
  const key = e.SHOTSTACK_API_KEY;
  if (!key) return json(r, e, { ok: false, contract_version: '1.1', capability: 'video', provider: 'shotstack', environment: 'sandbox', status: 'provider_unavailable', request_id: id, error: 'Shotstack Sandbox is not configured.' }, 503);
  const started = Date.now();
  try {
    const src = await resolveShotstackSource(image, key, 'beatvision-motion-source.jpg');
    const length = Math.max(2, Math.min(Number(e.PIXAZO_LTX_DURATION || 5), 10));
    const edit = {
      timeline: { background: '#000000', tracks: [{ clips: [{ asset: { type: 'image', src }, start: 0, length, fit: 'crop', effect: 'zoomIn' }] }] },
      output: { format: 'mp4', resolution: 'hd', aspectRatio: '16:9', fps: 25 }
    };
    const queued = await shotstackFetch('/edit/stage/render', key, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(edit) });
    const renderId = queued?.response?.id;
    if (!renderId) throw new Error('Shotstack did not return a render ID for camera-motion fallback.');
    const deadline = Date.now() + 150_000;
    while (Date.now() < deadline) {
      const last = await shotstackFetch(`/edit/stage/render/${encodeURIComponent(renderId)}`, key);
      const response = last?.response || last?.data || {};
      const status = String(response.status || '').toLowerCase();
      if (status === 'done') {
        return json(r, e, { ok: true, contract_version: '1.1', capability: 'video', provider: 'shotstack', model: 'camera-motion', environment: 'sandbox', delivery: 'temporary_url', watermark: true, fallback_from: 'pixazo', latency_ms: Date.now() - started, request_id: id, result: { status: 'animated', video_url: response.url, preview_url: response.url, render_id: renderId, duration_seconds: response.duration || length, source: 'Shotstack Sandbox deterministic camera-motion fallback', motion_type: 'zoomIn' } });
      }
      if (['failed', 'error'].includes(status)) throw new Error(`Shotstack camera-motion render failed: ${String(response.error || status).slice(0, 1800)}`);
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
    return json(r, e, { ok: true, contract_version: '1.1', capability: 'video', provider: 'shotstack', model: 'camera-motion', environment: 'sandbox', delivery: 'render_id', watermark: true, fallback_from: 'pixazo', status: 'queued', request_id: id, result: { status: 'queued', render_id: renderId, message: 'Shotstack camera-motion fallback is still processing.' } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return json(r, e, { ok: false, contract_version: '1.1', capability: 'video', provider: 'shotstack', model: 'camera-motion', environment: 'sandbox', status: 'provider_error', fallback_from: 'pixazo', request_id: id, latency_ms: Date.now() - started, error: msg.slice(0, 2000) }, 502);
  }
}

function clipLength(clip: any) { const n = Number(clip?.duration_seconds || clip?.length || 4); return Number.isFinite(n) && n > 0 ? Math.min(n, 60) : 4; }
function extractMotionClips(payload: any) {
  const candidates = payload?.motion?.clips || payload?.motion?.result?.clips;
  if (Array.isArray(candidates)) return candidates.filter((x: any) => x?.video_url || x?.url);
  const single = payload?.motion?.video_url || payload?.motion?.result?.video_url || payload?.motion?.url || payload?.motion?.result?.url;
  return typeof single === 'string' && single ? [{ scene: 1, status: 'animated', video_url: single }] : [];
}

export default { async fetch(r: Request, e: any) {
  if (r.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(r, e) });
  const url = new URL(r.url); if (url.pathname !== '/v1/video/assemble') return json(r, e, { ok: false, error: 'Not found' }, 404);
  const id = r.headers.get('X-BeatVision-Request') || crypto.randomUUID(); if (!auth(r, e)) return json(r, e, { ok: false, error: 'Unauthorized', request_id: id }, 401); if (r.method !== 'POST') return json(r, e, { ok: false, error: 'POST required', request_id: id }, 405);
  const key = e.SHOTSTACK_API_KEY; if (!key) return json(r, e, { ok: false, contract_version: '1.1', capability: 'video', provider: 'shotstack', status: 'provider_unavailable', request_id: id, error: 'Shotstack Sandbox is not configured. Configure SHOTSTACK_API_KEY as a Worker secret.' }, 503);
  let body: any; try { body = await r.json(); } catch { return json(r, e, { ok: false, error: 'Invalid JSON body', request_id: id }, 400); }
  if (body?.contract_version !== '1.1' || body?.operation !== 'assemble') return json(r, e, { ok: false, error: 'Expected BeatVision contract 1.1 assemble operation.', request_id: id }, 400);
  const payload = body.payload || {}; const motionClips = extractMotionClips(payload); if (!motionClips.length) return json(r, e, { ok: false, contract_version: '1.1', capability: 'video', provider: 'shotstack', status: 'invalid_input', request_id: id, error: 'Assembly requires at least one generated motion clip. Provide motion.clips or motion.video_url.' }, 400);
  const started = Date.now();
  try {
    const resolved: Array<{ src: string; length: number; scene: number }> = [];
    for (let i = 0; i < motionClips.length; i++) { const clip = motionClips[i]; const src = await resolveShotstackSource(clip.video_url || clip.url, key, `beatvision-motion-${i + 1}.mp4`); resolved.push({ src, length: clipLength(clip), scene: Number(clip.scene || i + 1) }); }
    const audioInput = payload.audio_base64 || payload.audio_data || null; const audioSrc = audioInput ? await resolveShotstackSource(audioInput, key, 'beatvision-song.mp3') : null; const totalVideo = resolved.reduce((sum, x) => sum + x.length, 0);
    const videoClips = resolved.reduce((arr: any[], item, index) => { const start = arr.reduce((sum, x) => sum + Number(x.length || 0), 0); arr.push({ asset: { type: 'video', src: item.src }, start, length: item.length, fit: 'crop', transition: index === 0 ? undefined : { in: 'fade', out: 'fade' }, effect: index % 2 === 0 ? 'zoomIn' : 'zoomOut' }); return arr; }, []);
    const tracks: any[] = [{ clips: videoClips }]; if (audioSrc) tracks.push({ clips: [{ asset: { type: 'audio', src: audioSrc }, start: 0, length: totalVideo, volume: 1 }] });
    const edit = { timeline: { background: '#000000', tracks }, output: { format: 'mp4', resolution: 'hd', aspectRatio: '16:9', fps: 25 } };
    const queued = await shotstackFetch('/edit/stage/render', key, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(edit) }); const renderId = queued?.response?.id; if (!renderId) throw new Error('Shotstack did not return a render ID.');
    const deadline = Date.now() + 150_000; let last: any = null; while (Date.now() < deadline) { last = await shotstackFetch(`/edit/stage/render/${encodeURIComponent(renderId)}`, key); const response = last?.response || last?.data || {}; const status = String(response.status || '').toLowerCase(); if (status === 'done') return json(r, e, { ok: true, contract_version: '1.1', capability: 'video', provider: 'shotstack', environment: 'sandbox', delivery: 'temporary_url', watermark: true, latency_ms: Date.now() - started, request_id: id, result: { status: 'assembled', render_id: renderId, preview_url: response.url, video_url: response.url, duration_seconds: response.duration || totalVideo, source_clips: resolved.length, source_audio: !!audioSrc } }); if (['failed', 'error'].includes(status)) throw new Error(`Shotstack render failed: ${String(response.error || status).slice(0, 1800)}`); await new Promise(resolve => setTimeout(resolve, 5000)); }
    return json(r, e, { ok: true, contract_version: '1.1', capability: 'video', provider: 'shotstack', environment: 'sandbox', delivery: 'render_id', watermark: true, status: 'queued', latency_ms: Date.now() - started, request_id: id, result: { status: 'queued', render_id: renderId, message: 'Shotstack render is still processing.', last_status: last?.response?.status || null } });
  } catch (err) { const msg = err instanceof Error ? err.message : String(err); return json(r, e, { ok: false, contract_version: '1.1', capability: 'video', provider: 'shotstack', environment: 'sandbox', status: 'provider_error', request_id: id, latency_ms: Date.now() - started, error: msg.slice(0, 2000) }, 502); }
} };