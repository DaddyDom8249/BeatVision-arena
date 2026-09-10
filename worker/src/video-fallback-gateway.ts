import primary from './pollinations-gateway-v2';
import { InferenceClient } from '@huggingface/inference';

const HF_MODEL = 'Wan-AI/Wan2.1-I2V-14B-720P';

function cors(r: Request, e: any) {
  const o = r.headers.get('Origin') || '';
  const allowed = String(e.ALLOWED_ORIGIN || '').split(',').map((x: string) => x.trim()).filter(Boolean);
  return {
    'Access-Control-Allow-Origin': o && (!allowed.length || allowed.includes(o)) ? o : (allowed[0] || '*'),
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,X-BeatVision-Contract,Authorization,X-BeatVision-Request',
    'Access-Control-Max-Age': '86400'
  };
}

function json(r: Request, e: any, d: unknown, status = 200) {
  return new Response(JSON.stringify(d, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors(r, e) }
  });
}

function auth(r: Request, e: any) {
  return !e.GATEWAY_TOKEN || r.headers.get('Authorization') === `Bearer ${e.GATEWAY_TOKEN}`;
}

function clip(v: unknown, n: number) {
  return String(v || '').slice(0, n);
}

function firstImageDataUrl(payload: any) {
  const imgs = payload?.images?.images || payload?.images || [];
  const item = Array.isArray(imgs) ? imgs[0] : imgs;
  const value = item?.image_url || item?.url || item?.data_url || null;
  return typeof value === 'string' && value.startsWith('data:') ? value : null;
}

function dataUrlToBase64(value: string) {
  const comma = value.indexOf(',');
  if (comma < 0) throw new Error('Invalid scene image data URL');
  return value.slice(comma + 1);
}

async function blobToDataUrl(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.length)));
  }
  return `data:${blob.type || 'video/mp4'};base64,${btoa(binary)}`;
}

function fallbackPrompt(payload: any) {
  const scene = payload?.storyboard?.scenes?.[0] || {};
  return [
    'Animate the supplied BeatVision scene image into a cinematic music-video shot.',
    `Style: ${clip(payload?.style, 1000)}`,
    `World: ${clip(payload?.world?.logline, 1200)}`,
    `Scene: ${clip(scene.visual_direction || scene.description, 1800)}`,
    'Preserve the supplied image composition, character identity, environment, and visual continuity. Use restrained cinematic camera movement, natural subject motion, atmospheric lighting, and a 16:9 composition.'
  ].join('\n');
}

async function hfFallback(r: Request, e: any, body: any, id: string) {
  const token = e.HF_VIDEO_TOKEN;
  if (!token) {
    return json(r, e, {
      ok: false,
      contract_version: '1.1',
      capability: 'video',
      provider: 'none',
      status: 'provider_unavailable',
      request_id: id,
      error: 'Primary video provider is unavailable and no HF_VIDEO_TOKEN is configured for the optional fallback.',
      primary_provider: 'pollinations',
      primary_failure: 'insufficient_balance'
    }, 503);
  }

  const image = firstImageDataUrl(body.payload || {});
  if (!image) {
    return json(r, e, {
      ok: false,
      contract_version: '1.1',
      capability: 'video',
      provider: 'huggingface',
      model: e.HF_VIDEO_MODEL || HF_MODEL,
      status: 'invalid_input',
      request_id: id,
      error: 'HF image-to-video fallback requires the approved scene image as a data URL.'
    }, 400);
  }

  const start = Date.now();
  const ctl = new AbortController();
  const tm = setTimeout(() => ctl.abort(), 180_000);
  try {
    const client = new InferenceClient(token, { timeout: 170_000 });
    const video = await client.imageToVideo({
      model: e.HF_VIDEO_MODEL || HF_MODEL,
      provider: e.HF_VIDEO_PROVIDER || 'auto',
      inputs: dataUrlToBase64(image),
      parameters: {
        prompt: fallbackPrompt(body.payload || {}),
        num_frames: Number(e.HF_VIDEO_FRAMES || 49),
        num_inference_steps: Number(e.HF_VIDEO_STEPS || 20)
      }
    });
    const blob = video instanceof Blob ? video : new Blob([video as any], { type: 'video/mp4' });
    const videoUrl = await blobToDataUrl(blob);

    return json(r, e, {
      ok: true,
      contract_version: '1.1',
      capability: 'video',
      provider: 'huggingface',
      model: e.HF_VIDEO_MODEL || HF_MODEL,
      fallback_from: 'pollinations',
      delivery: 'inline_data_url',
      persistent_storage: false,
      latency_ms: Date.now() - start,
      request_id: id,
      result: {
        status: 'animated',
        video_url: videoUrl,
        mime_type: blob.type || 'video/mp4',
        source_image_url: image,
        source: 'HF image-to-video fallback'
      }
    });
  } catch (err) {
    const timed = (err as Error)?.name === 'AbortError';
    const msg = err instanceof Error ? err.message : String(err);
    return json(r, e, {
      ok: false,
      contract_version: '1.1',
      capability: 'video',
      provider: 'huggingface',
      model: e.HF_VIDEO_MODEL || HF_MODEL,
      status: 'provider_unavailable',
      request_id: id,
      error: timed ? 'HF image-to-video fallback timed out after 180 seconds' : `HF image-to-video fallback failed: ${msg.slice(0, 1800)}`,
      primary_provider: 'pollinations',
      primary_failure: 'insufficient_balance'
    }, timed ? 504 : 503);
  } finally {
    clearTimeout(tm);
  }
}

export default {
  async fetch(r: Request, e: any) {
    if (r.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(r, e) });
    if (new URL(r.url).pathname !== '/v1/video/animate') return primary.fetch(r, e);

    const id = r.headers.get('X-BeatVision-Request') || crypto.randomUUID();
    if (!auth(r, e)) return json(r, e, { ok: false, error: 'Unauthorized', request_id: id }, 401);

    // Clone before delegating because the primary gateway consumes the request body.
    const fallbackRequest = r.clone();
    const response = await primary.fetch(r, e);
    if (response.status !== 502) return response;

    let data: any = null;
    try { data = await response.clone().json(); } catch {}
    const primaryError = String(data?.error || '');
    if (!/returned 402|INSUFFICIENT_BALANCE|insufficient balance/i.test(primaryError)) return response;

    let body: any;
    try { body = await fallbackRequest.json(); } catch { return response; }
    return hfFallback(r, e, body, id);
  }
};
