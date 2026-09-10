import pixazo from './pixazo-ltx-gateway';
import shotstack from './shotstack-gateway';
import { InferenceClient } from '@huggingface/inference';

const HF_MODEL = 'Wan-AI/Wan2.1-I2V-14B-720P';
function cors(r: Request, e: any) { const o = r.headers.get('Origin') || ''; const allowed = String(e.ALLOWED_ORIGIN || '').split(',').map((x: string) => x.trim()).filter(Boolean); return { 'Access-Control-Allow-Origin': o && (!allowed.length || allowed.includes(o)) ? o : (allowed[0] || '*'), 'Vary': 'Origin', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type,X-BeatVision-Contract,Authorization,X-BeatVision-Request', 'Access-Control-Max-Age': '86400' }; }
function json(r: Request, e: any, d: unknown, status = 200) { return new Response(JSON.stringify(d, null, 2), { status, headers: { 'Content-Type': 'application/json', ...cors(r, e) } }); }
function auth(r: Request, e: any) { return !e.GATEWAY_TOKEN || r.headers.get('Authorization') === `Bearer ${e.GATEWAY_TOKEN}`; }
function clip(v: unknown, n: number) { return String(v || '').slice(0, n); }
function firstImageDataUrl(payload: any) { const imgs = payload?.images?.images || payload?.images || []; const item = Array.isArray(imgs) ? imgs[0] : imgs; const value = item?.image_url || item?.url || item?.data_url || null; return typeof value === 'string' && value.startsWith('data:') ? value : null; }
function dataUrlToBlob(value: string) { const comma = value.indexOf(','); if (comma < 0 || !value.startsWith('data:')) throw new Error('Invalid scene image data URL'); const header = value.slice(5, comma); const mime = header.split(';')[0] || 'image/jpeg'; const base64 = value.slice(comma + 1).replace(/\s/g, ''); const binary = atob(base64); const bytes = new Uint8Array(binary.length); for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i); return new Blob([bytes], { type: mime }); }
async function blobToDataUrl(blob: Blob) { const bytes = new Uint8Array(await blob.arrayBuffer()); let binary = ''; const chunk = 0x8000; for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.length))); return `data:${blob.type || 'video/mp4'};base64,${btoa(binary)}`; }
function fallbackPrompt(payload: any) { const scene = payload?.storyboard?.scenes?.[0] || {}; return ['Animate the supplied BeatVision scene image into a cinematic music-video shot.', `Style: ${clip(payload?.style, 1000)}`, `World: ${clip(payload?.world?.logline, 1200)}`, `Scene: ${clip(scene.visual_direction || scene.description, 1800)}`, 'Preserve the supplied image composition, character identity, environment, and visual continuity. Use restrained cinematic camera movement, natural subject motion, atmospheric lighting, and a 16:9 composition.'].join('\n'); }
async function hfFallback(r: Request, e: any, body: any, id: string) { const token = e.HF_VIDEO_TOKEN; if (!token) return json(r, e, { ok: false, contract_version: '1.1', capability: 'video', provider: 'none', status: 'provider_unavailable', request_id: id, error: 'Pixazo free LTX is unavailable and no HF_VIDEO_TOKEN is configured for the optional fallback.', primary_provider: 'pixazo', primary_failure: 'provider_unavailable' }, 503); const image = firstImageDataUrl(body.payload || {}); if (!image) return json(r, e, { ok: false, contract_version: '1.1', capability: 'video', provider: 'huggingface', model: e.HF_VIDEO_MODEL || HF_MODEL, status: 'invalid_input', request_id: id, error: 'HF fallback requires the approved scene image as a data URL.' }, 400); const start = Date.now(); const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 180_000); try { const client = new InferenceClient(token, { timeout: 170_000 }); const video = await client.imageToVideo({ model: e.HF_VIDEO_MODEL || HF_MODEL, provider: e.HF_VIDEO_PROVIDER || 'auto', inputs: dataUrlToBlob(image), parameters: { prompt: fallbackPrompt(body.payload || {}), num_frames: Number(e.HF_VIDEO_FRAMES || 49), num_inference_steps: Number(e.HF_VIDEO_STEPS || 20) } }); const blob = video instanceof Blob ? video : new Blob([video as any], { type: 'video/mp4' }); const videoUrl = await blobToDataUrl(blob); return json(r, e, { ok: true, contract_version: '1.1', capability: 'video', provider: 'huggingface', model: e.HF_VIDEO_MODEL || HF_MODEL, fallback_from: 'pixazo', delivery: 'inline_data_url', persistent_storage: false, latency_ms: Date.now() - start, request_id: id, result: { status: 'animated', video_url: videoUrl, mime_type: blob.type || 'video/mp4', source_image_url: image, source: 'HF image-to-video fallback' } }); } catch (err) { const timed = (err as Error)?.name === 'AbortError'; const msg = err instanceof Error ? err.message : String(err); return json(r, e, { ok: false, contract_version: '1.1', capability: 'video', provider: 'huggingface', model: e.HF_VIDEO_MODEL || HF_MODEL, status: 'provider_unavailable', request_id: id, error: timed ? 'HF image-to-video fallback timed out after 180 seconds' : `HF image-to-video fallback failed: ${msg.slice(0, 1800)}`, primary_provider: 'pixazo', primary_failure: 'provider_error' }, timed ? 504 : 503); } finally { clearTimeout(tm); } }

export default { async fetch(r: Request, e: any) {
  if (r.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(r, e) });
  const path = new URL(r.url).pathname;
  const id = r.headers.get('X-BeatVision-Request') || crypto.randomUUID();

  if (path === '/' || path === '/health') {
    return json(r, e, { ok: true, status: 'online', name: 'BeatVision Provider Gateway', contract_version: '1.1', primary_motion_provider: 'pixazo', assembly_provider: 'shotstack-sandbox', fallback_provider: e.HF_VIDEO_TOKEN ? 'huggingface' : 'none', request_id: id });
  }

  if (path === '/v1/capabilities') {
    if (!auth(r, e)) return json(r, e, { ok: false, error: 'Unauthorized', request_id: id }, 401);
    return json(r, e, { ok: true, contract_version: '1.1', capabilities: { video: { configured: !!e.PIXAZO_API_KEY, provider: 'pixazo', model: 'ltx' }, assembly: { configured: !!e.SHOTSTACK_API_KEY, provider: 'shotstack-sandbox' }, fallback: { configured: !!e.HF_VIDEO_TOKEN, provider: e.HF_VIDEO_TOKEN ? 'huggingface' : 'none' } }, request_id: id });
  }

  if (path === '/v1/video/assemble') return shotstack.fetch(r, e);
  if (path !== '/v1/video/animate') return pixazo.fetch(r, e);
  if (!auth(r, e)) return json(r, e, { ok: false, error: 'Unauthorized', request_id: id }, 401);

  // Read and validate the BeatVision envelope once, then reconstruct the Request
  // before handing it to the Pixazo adapter. This removes any ambiguity caused by
  // cloned/consumed request bodies and gives the client a diagnostic if a stale UI
  // ever sends an older contract.
  let rawBody = '';
  let body: any;
  try {
    rawBody = await r.clone().text();
    body = JSON.parse(rawBody);
  } catch {
    return json(r, e, { ok: false, contract_version: '1.1', capability: 'video', provider: 'gateway', status: 'invalid_input', request_id: id, error: 'Invalid JSON body sent to /v1/video/animate.' }, 400);
  }
  if (body?.contract_version !== '1.1' || body?.operation !== 'animate') {
    return json(r, e, { ok: false, contract_version: '1.1', capability: 'video', provider: 'gateway', status: 'contract_mismatch', request_id: id, expected: { contract_version: '1.1', operation: 'animate' }, received: { contract_version: body?.contract_version ?? null, operation: body?.operation ?? null }, error: 'BeatVision animation request did not use contract 1.1 animate.' }, 400);
  }

  const forwarded = new Request(r.url, { method: 'POST', headers: new Headers(r.headers), body: rawBody });
  const pixazoResponse = await pixazo.fetch(forwarded, e);
  if (pixazoResponse.status < 500) return pixazoResponse;
  return hfFallback(r, e, body, id);
} };