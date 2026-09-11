import pixazo from './video-fallback-gateway';

const BASE = 'https://gateway.pixazo.ai';
const CONTRACT = '1.1';

const cors = (r: Request, e: any) => {
  const origin = r.headers.get('Origin') || '';
  const allowed = String(e.ALLOWED_ORIGIN || '').split(',').map((x: string) => x.trim()).filter(Boolean);
  return {
    'Access-Control-Allow-Origin': origin && (!allowed.length || allowed.includes(origin)) ? origin : (allowed[0] || '*'),
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,X-BeatVision-Contract,Authorization,X-BeatVision-Request'
  };
};

const json = (r: Request, e: any, data: unknown, status = 200) =>
  new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors(r, e) }
  });

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const clip = (value: unknown, max: number) => String(value ?? '').slice(0, max);

const media = (d: any) =>
  d?.output?.media_url?.[0] || d?.output?.media_url || d?.output || d?.imageUrl || d?.image_url || d?.url || null;

const scenePrompt = (payload: any, scene: any) => {
  const world = payload?.world || {};
  const character = clip(JSON.stringify(world?.character_concept || {}), 1000);
  const locations = clip(JSON.stringify(world?.locations || []), 800);
  const motifs = clip(JSON.stringify(world?.visual_motifs || []), 900);
  const continuity = clip(JSON.stringify(world?.continuity_rules || []), 700);
  const style = clip(payload?.style, 600);
  return clip([
    'BeatVision cinematic music-video scene still.',
    'Dark industrial realism, cinematic lighting, coherent recurring character and environment.',
    'No text, logos, watermarks, captions, UI or typography.',
    style ? `Style: ${style}` : '',
    character ? `Character continuity: ${character}` : '',
    locations ? `World locations: ${locations}` : '',
    motifs ? `Visual motifs: ${motifs}` : '',
    continuity ? `Continuity rules: ${continuity}` : '',
    `Storyboard scene: ${clip(JSON.stringify(scene), 1800)}`
  ].filter(Boolean).join('\n'), 12000);
};

async function pixazoPost(path: string, key: string, body: any) {
  const response = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      'Ocp-Apim-Subscription-Key': key
    },
    body: JSON.stringify(body)
  });
  const text = await response.text();
  let data: any;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!response.ok) {
    throw new Error(`Pixazo ${response.status} at ${path}: ${String(data?.message || data?.error || text).slice(0, 1600)}`);
  }
  return data;
}

async function generateSceneImage(key: string, prompt: string, sceneNumber: number) {
  let lastError = '';

  // SDXL is still the preferred free scene-image model. Retry transient provider
  // failures before falling back, rather than letting one bad generation kill the run.
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const data = await pixazoPost('/getImage/v1/getSDXLImage', key, {
        prompt,
        negative_prompt: 'low quality, blurry, distorted anatomy, duplicate face, extra limbs, text, logo, watermark, UI, caption',
        // Pixazo documents SDXL at up to 1024x1024. Generate square here and let
        // the LTX stage compose the approved still into its 16:9 motion frame.
        height: 1024,
        width: 1024,
        num_steps: 20,
        guidance: 5,
        seed: Math.floor(Math.random() * 2147483647)
      });
      const url = media(data);
      if (!url) throw new Error('SDXL completed without an image URL.');
      return { image_url: url, model: 'sdxl' };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (attempt < 3) await sleep(1500 * attempt);
    }
  }

  // Free Flux Schnell is the deterministic fallback for a failed SDXL scene.
  // It is intentionally square because that is the documented safe free shape;
  // the downstream LTX stage requests the 16:9 motion composition.
  try {
    const data = await pixazoPost('/flux-1-schnell/v1/getData', key, {
      prompt: clip(prompt, 2048),
      num_steps: 4,
      height: 1024,
      width: 1024,
      seed: Math.floor(Math.random() * 2147483647)
    });
    const url = media(data);
    if (!url) throw new Error('Flux Schnell completed without an image URL.');
    return { image_url: url, model: 'flux-1-schnell', fallback_reason: lastError };
  } catch (error) {
    const fluxError = error instanceof Error ? error.message : String(error);
    throw new Error(`scene ${sceneNumber}: SDXL failed after 3 attempts; Flux Schnell fallback also failed. SDXL=${lastError}; Flux=${fluxError}`);
  }
}

async function resilientSceneImages(r: Request, e: any, body: any, requestId: string) {
  const key = e.PIXAZO_API_KEY;
  if (!key) return json(r, e, { ok: false, error: 'PIXAZO_API_KEY is not configured.', request_id: requestId }, 503);
  if (body?.contract_version !== CONTRACT) return json(r, e, { ok: false, error: 'Expected BeatVision contract 1.1.', request_id: requestId }, 400);

  const payload = body?.payload || {};
  const scenes = Array.isArray(payload?.storyboard?.scenes) ? payload.storyboard.scenes.slice(0, 8) : [];
  if (!scenes.length) return json(r, e, { ok: false, status: 'invalid_input', request_id: requestId, error: 'Storyboard contains no scenes.' }, 400);

  const started = Date.now();
  const images: any[] = [];
  const models = new Set<string>();

  try {
    for (let i = 0; i < scenes.length; i += 1) {
      const sceneNumber = Number(scenes[i]?.scene || i + 1);
      const generated = await generateSceneImage(key, scenePrompt(payload, scenes[i]), sceneNumber);
      images.push({ scene: sceneNumber, status: 'generated', image_url: generated.image_url, model: generated.model });
      models.add(generated.model);
    }

    return json(r, e, {
      ok: true,
      contract_version: CONTRACT,
      capability: 'image',
      provider: 'pixazo',
      model: Array.from(models).join('+'),
      request_id: requestId,
      latency_ms: Date.now() - started,
      result: {
        images,
        models_used: Array.from(models),
        scene_count: images.length,
        free_only: true
      }
    });
  } catch (error) {
    return json(r, e, {
      ok: false,
      contract_version: CONTRACT,
      capability: 'image',
      provider: 'pixazo',
      status: 'provider_error',
      request_id: requestId,
      latency_ms: Date.now() - started,
      completed_scene_count: images.length,
      completed_scenes: images.map(image => image.scene),
      error: String(error instanceof Error ? error.message : error).slice(0, 2200)
    }, 502);
  }
}

export default {
  async fetch(r: Request, e: any) {
    if (r.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(r, e) });
    if (r.method !== 'POST') return pixazo.fetch(r, e);

    const requestId = r.headers.get('X-BeatVision-Request') || crypto.randomUUID();
    if (e.GATEWAY_TOKEN && r.headers.get('Authorization') !== `Bearer ${e.GATEWAY_TOKEN}`) {
      return json(r, e, { ok: false, error: 'Unauthorized', request_id: requestId }, 401);
    }

    let body: any;
    try { body = await r.clone().json(); } catch { return pixazo.fetch(r, e); }

    if (body?.operation === 'sceneImages') {
      return resilientSceneImages(r, e, body, requestId);
    }

    return pixazo.fetch(r, e);
  }
};
