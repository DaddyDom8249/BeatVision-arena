import pixazo from './pixazo-media-gateway-fixed';
import motionResilient from './pixazo-motion-resilience';
import shotstack, { animateStillWithShotstack } from './shotstack-gateway';
import pollinations from './pollinations-gateway-v2';

function cors(r: Request, e: any) { const o = r.headers.get('Origin') || ''; const allowed = String(e.ALLOWED_ORIGIN || '').split(',').map((x: string) => x.trim()).filter(Boolean); return { 'Access-Control-Allow-Origin': o && (!allowed.length || allowed.includes(o)) ? o : (allowed[0] || '*'), 'Vary': 'Origin', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type,X-BeatVision-Contract,Authorization,X-BeatVision-Request', 'Access-Control-Max-Age': '86400' }; }
function json(r: Request, e: any, d: unknown, status = 200) { return new Response(JSON.stringify(d, null, 2), { status, headers: { 'Content-Type': 'application/json', ...cors(r, e) } }); }
function auth(r: Request, e: any) { return !e.GATEWAY_TOKEN || r.headers.get('Authorization') === `Bearer ${e.GATEWAY_TOKEN}`; }
function firstImageDataUrl(payload: any) { const imgs = payload?.images?.images || payload?.images || []; const item = Array.isArray(imgs) ? imgs[0] : imgs; const value = item?.image_url || item?.url || item?.data_url || null; return typeof value === 'string' && value.startsWith('data:') ? value : null; }

export default { async fetch(r: Request, e: any) {
  if (r.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(r, e) });
  const path = new URL(r.url).pathname;
  const id = r.headers.get('X-BeatVision-Request') || crypto.randomUUID();
  if (path === '/' || path === '/health') return json(r, e, { ok: true, status: 'online', name: 'BeatVision Provider Gateway', contract_version: '1.1', creative_provider: 'pixazo', analysis_provider: 'pollinations', assembly_provider: 'shotstack-sandbox', fallback_provider: 'shotstack-camera-motion', request_id: id });
  if (path === '/v1/capabilities') {
    if (!auth(r, e)) return json(r, e, { ok: false, error: 'Unauthorized', request_id: id }, 401);
    return json(r, e, { ok: true, contract_version: '1.1', capabilities: { language: { configured: !!e.LANGUAGE_PROVIDER_TOKEN, provider: e.LANGUAGE_PROVIDER || 'pollinations', model: e.LANGUAGE_PROVIDER_MODEL || 'openai' }, image: { configured: !!e.PIXAZO_API_KEY, provider: 'pixazo', models: ['flux-schnell', 'sdxl'] }, audio: { configured: !!(e.AUDIO_PROVIDER_TOKEN || e.LANGUAGE_PROVIDER_TOKEN), provider: 'pollinations', model: 'whisper-large-v3' }, video: { configured: !!e.PIXAZO_API_KEY, provider: 'pixazo', model: 'ltx-video' }, music: { configured: !!e.PIXAZO_API_KEY, provider: 'pixazo', model: 'tracks' }, assembly: { configured: !!e.SHOTSTACK_API_KEY, provider: 'shotstack-sandbox' }, fallback: { configured: !!e.SHOTSTACK_API_KEY, provider: 'shotstack-camera-motion', mode: 'deterministic_zoom' }, storage: { configured: !!e.STORAGE_PROVIDER_URL, provider: e.STORAGE_PROVIDER_URL || null, optional: true } }, request_id: id });
  }
  if (path === '/v1/video/assemble') return shotstack.fetch(r, e);
  if (path === '/v1/video/animate') {
    if (!auth(r, e)) return json(r, e, { ok: false, error: 'Unauthorized', request_id: id }, 401);
    const rawBody = await r.text(); let body: any; try { body = JSON.parse(rawBody); } catch { return json(r, e, { ok: false, contract_version: '1.1', capability: 'video', status: 'invalid_input', request_id: id, error: 'Invalid JSON body sent to /v1/video/animate.' }, 400); }
    if (body?.contract_version !== '1.1' || body?.operation !== 'animate') return json(r, e, { ok: false, contract_version: '1.1', capability: 'video', status: 'contract_mismatch', request_id: id, error: 'BeatVision animation request did not use contract 1.1 animate.' }, 400);
    const forwarded = new Request(r.url, { method: 'POST', headers: new Headers(r.headers), body: rawBody });
    const pixazoResponse = await motionResilient.fetch(forwarded, e);
    if (pixazoResponse.status < 500) return pixazoResponse;
    const image = firstImageDataUrl(body.payload || {});
    if (!image) return pixazoResponse;
    return animateStillWithShotstack(r, e, image, id);
  }
  if (path === '/v1/image/world-assets' || path === '/v1/image/scenes' || path === '/v1/audio/generate') return pixazo.fetch(r, e);
  return pollinations.fetch(r, e);
} };