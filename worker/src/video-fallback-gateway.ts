import primary from './pollinations-gateway-v2';
import { InferenceClient } from '@huggingface/inference';

const HF_MODEL = 'Wan-AI/Wan2.2-TI2V-5B';
const MEDIA_BASE = 'https://media.pollinations.ai';

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

async function uploadVideo(video: Blob, token: string, id: string, signal: AbortSignal) {
  const form = new FormData();
  form.append('file', video, 'beatvision-hf-fallback.mp4');
  const res = await fetch(`${MEDIA_BASE}/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'X-BeatVision-Request': id },
    body: form,
    signal
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Media upload returned ${res.status}: ${text.slice(0, 800)}`);
  const data: any = JSON.parse(text);
  if (!data?.url) throw new Error('Media upload returned no URL');
  return data.url as string;
}

function fallbackPrompt(payload: any) {
  const scene = payload?.storyboard?.scenes?.[0] || {};
  return [
    'Create a cinematic music-video shot matching this BeatVision scene.',
    `Style: ${clip(payload?.style, 1000)}`,
    `World: ${clip(payload?.world?.logline, 1200)}`,
    `Scene: ${clip(scene.visual_direction || scene.description, 1800)}`,
    'Use restrained cinematic camera movement, natural subject motion, atmospheric lighting, continuity, and a 16:9 composition.'
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

  const start = Date.now();
  const ctl = new AbortController();
  const tm = setTimeout(() => ctl.abort(), 180_000);
  try {
    const client = new InferenceClient(token, { timeout: 170_000 });
    const video = await client.textToVideo({
      model: e.HF_VIDEO_MODEL || HF_MODEL,
      inputs: fallbackPrompt(body.payload || {}),
      provider: e.HF_VIDEO_PROVIDER || 'auto'
    });
    const blob = video instanceof Blob ? video : new Blob([video as any], { type: 'video/mp4' });
    const mediaToken = e.VIDEO_PROVIDER_TOKEN || e.IMAGE_PROVIDER_TOKEN;
    if (!mediaToken) {
      return json(r, e, {
        ok: false,
        contract_version: '1.1',
        capability: 'video',
        provider: 'huggingface',
        model: e.HF_VIDEO_MODEL || HF_MODEL,
        status: 'provider_unavailable',
        request_id: id,
        error: 'HF video generation succeeded, but no media upload token is configured for returning the MP4 to BeatVision.'
      }, 503);
    }
    const url = await uploadVideo(blob, mediaToken, id, ctl.signal);
    return json(r, e, {
      ok: true,
      contract_version: '1.1',
      capability: 'video',
      provider: 'huggingface',
      model: e.HF_VIDEO_MODEL || HF_MODEL,
      fallback_from: 'pollinations',
      latency_ms: Date.now() - start,
      request_id: id,
      result: {
        status: 'animated',
        video_url: url,
        mime_type: blob.type || 'video/mp4',
        source: 'HF text-to-video fallback'
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
      error: timed ? 'HF video fallback timed out after 180 seconds' : `HF video fallback failed: ${msg.slice(0, 1800)}`,
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

    const response = await primary.fetch(r, e);
    if (response.status !== 502) return response;

    let data: any = null;
    try { data = await response.clone().json(); } catch {}
    const primaryError = String(data?.error || '');
    if (!/returned 402|INSUFFICIENT_BALANCE|insufficient balance/i.test(primaryError)) return response;

    let body: any;
    try { body = await r.clone().json(); } catch { return response; }
    return hfFallback(r, e, body, id);
  }
};
