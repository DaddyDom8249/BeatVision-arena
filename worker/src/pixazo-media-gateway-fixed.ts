import { resolveShotstackSource } from './shotstack-gateway';

const BASE = 'https://gateway.pixazo.ai';
const STATUS = `${BASE}/v2/requests/status/`;
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

const auth = (r: Request, e: any) =>
  !e.GATEWAY_TOKEN || r.headers.get('Authorization') === `Bearer ${e.GATEWAY_TOKEN}`;

const media = (d: any) =>
  d?.output?.media_url?.[0] || d?.output?.media_url || d?.output || d?.imageUrl || d?.image_url || d?.url || null;

const image = (p: any) => {
  const values = p?.images?.images || p?.images || [];
  const first = Array.isArray(values) ? values[0] : values;
  return first?.image_url || first?.url || first?.data_url || null;
};

const imageItems = (p: any) => {
  const values = p?.images?.images || p?.images || [];
  return Array.isArray(values) ? values.filter((item: any) => item?.image_url || item?.url || item?.data_url) : [];
};

const clip = (value: unknown, max: number) => String(value ?? '').slice(0, max);

const worldPrompt = (p: any, scene?: any) => {
  const world = p?.world || {};
  const style = clip(p?.style, 500);
  const character = clip(JSON.stringify(world?.character_concept || {}), 900);
  const locations = clip(JSON.stringify(world?.locations || []), 700);
  const motifs = clip(JSON.stringify(world?.visual_motifs || []), 700);
  const continuity = clip(JSON.stringify(world?.continuity_rules || []), 500);
  const sceneText = scene ? clip(JSON.stringify(scene), 700) : '';
  return clip([
    'BeatVision cinematic music-video artwork.',
    'Dark industrial realism, coherent recurring character and environment, cinematic lighting.',
    'No text, logos, watermarks, captions, UI or typography.',
    style ? `Style: ${style}` : '',
    character ? `Character: ${character}` : '',
    locations ? `Locations: ${locations}` : '',
    motifs ? `Motifs: ${motifs}` : '',
    continuity ? `Continuity: ${continuity}` : '',
    sceneText ? `Scene: ${sceneText}` : 'Create a strong world establishing image.'
  ].filter(Boolean).join('\n'), 2048);
};

async function call(path: string, key: string, body: any, model: string) {
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
    throw new Error(`Pixazo ${model} ${response.status} at ${path}: ${String(data?.message || data?.error || text).slice(0, 1800)}`);
  }
  return data;
}

async function wait(key: string, requestId: string, model: string) {
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    const response = await fetch(`${STATUS}${encodeURIComponent(requestId)}`, {
      headers: { 'Ocp-Apim-Subscription-Key': key, 'Cache-Control': 'no-cache' }
    });
    const text = await response.text();
    let data: any;
    try { data = JSON.parse(text); } catch { data = {}; }
    if (!response.ok) throw new Error(`Pixazo ${model} status ${response.status}: ${text.slice(0, 1200)}`);
    const state = String(data?.status || '').toUpperCase();
    if (state === 'COMPLETED' || state === 'SUCCEEDED') {
      const url = media(data);
      if (!url) throw new Error(`Pixazo ${model} completed without media output.`);
      return url;
    }
    if (['ERROR', 'FAILED', 'CANCELLED'].includes(state)) {
      throw new Error(`Pixazo ${model} job ${state}: ${String(data?.error || 'unknown provider error').slice(0, 1600)}`);
    }
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
  throw new Error(`Pixazo ${model} job timed out after 120 seconds.`);
}

async function img(key: string, model: 'flux-schnell' | 'sdxl', promptText: string, aspect: 'square' | 'wide' = 'square') {
  if (model === 'flux-schnell') {
    const data = await call('/flux-1-schnell/v1/getData', key, {
      prompt: clip(promptText, 2048),
      num_steps: 4,
      height: 1024,
      width: 1024
    }, model);
    const url = media(data);
    if (!url) throw new Error(`Pixazo ${model} returned no image URL.`);
    return url;
  }

  const data = await call('/getImage/v1/getSDXLImage', key, {
    prompt: clip(promptText, 12000),
    height: aspect === 'wide' ? 576 : 1024,
    width: 1024,
    num_steps: 20,
    guidance: 5
  }, model);
  const url = media(data);
  if (!url) throw new Error(`Pixazo ${model} returned no image URL.`);
  return url;
}

async function labeled(label: string, work: () => Promise<string>) {
  try { return await work(); }
  catch (error) { throw new Error(`${label}: ${error instanceof Error ? error.message : String(error)}`); }
}

async function animate(r: Request, e: any, key: string, payload: any, requestId: string) {
  const items = imageItems(payload);
  if (!items.length) return json(r, e, {
    ok: false,
    contract_version: CONTRACT,
    capability: 'video',
    provider: 'pixazo',
    model: 'ltx-video',
    status: 'invalid_input',
    request_id: requestId,
    error: 'No approved scene images were supplied.'
  }, 400);

  const scenes = Array.isArray(payload?.storyboard?.scenes) ? payload.storyboard.scenes : [];
  const started = Date.now();
  const clips: Array<{ scene: number; status: string; video_url: string; source: string; pixazo_request_id: string | null }> = [];

  try {
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i];
      const raw = item?.image_url || item?.url || item?.data_url;
      const sceneNumber = Number(item?.scene || scenes[i]?.scene || i + 1);
      const scene = scenes.find((candidate: any) => Number(candidate?.scene) === sceneNumber) || scenes[i];
      const source = String(raw).startsWith('data:')
        ? await resolveShotstackSource(String(raw), e.SHOTSTACK_API_KEY || '', `beatvision-scene-${sceneNumber}.jpg`)
        : String(raw);

      const data = await call('/ltx-video/v1/image-to-video', key, {
        prompt: clip(worldPrompt(payload, scene), 4000),
        image_url: source,
        aspect: '16:9',
        num_frames: 121,
        frame_rate: 24,
        steps: 8,
        cfg: 3
      }, 'ltx-video');

      const videoUrl = data?.request_id ? await wait(key, data.request_id, 'ltx-video') : media(data);
      if (!videoUrl) throw new Error(`Pixazo LTX scene ${sceneNumber} returned no video URL.`);
      clips.push({
        scene: sceneNumber,
        status: 'animated',
        video_url: videoUrl,
        source: 'Pixazo free LTX image-to-video',
        pixazo_request_id: data?.request_id || null
      });
    }

    return json(r, e, {
      ok: true,
      contract_version: CONTRACT,
      capability: 'video',
      provider: 'pixazo',
      model: 'ltx-video',
      status: 'animated',
      latency_ms: Date.now() - started,
      request_id: requestId,
      result: {
        status: 'animated',
        clips,
        video_url: clips[0]?.video_url || null,
        source: 'Pixazo free LTX image-to-video',
        models_used: ['ltx-video'],
        scene_count: clips.length,
        pixazo_request_ids: clips.map(clip => clip.pixazo_request_id).filter(Boolean)
      }
    });
  } catch (error) {
    return json(r, e, {
      ok: false,
      contract_version: CONTRACT,
      capability: 'video',
      provider: 'pixazo',
      model: 'ltx-video',
      status: 'provider_error',
      request_id: requestId,
      latency_ms: Date.now() - started,
      completed_scene_count: clips.length,
      completed_scenes: clips.map(clip => clip.scene),
      error: String(error instanceof Error ? error.message : error).slice(0, 2000)
    }, 502);
  }
}

export default {
  async fetch(r: Request, e: any) {
    if (r.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(r, e) });
    const requestId = r.headers.get('X-BeatVision-Request') || crypto.randomUUID();
    if (!auth(r, e)) return json(r, e, { ok: false, error: 'Unauthorized', request_id: requestId }, 401);
    if (r.method !== 'POST') return json(r, e, { ok: false, error: 'POST required', request_id: requestId }, 405);

    const key = e.PIXAZO_API_KEY;
    if (!key) return json(r, e, {
      ok: false,
      contract_version: CONTRACT,
      status: 'provider_unavailable',
      provider: 'pixazo',
      request_id: requestId,
      error: 'PIXAZO_API_KEY is not configured.'
    }, 503);

    let body: any;
    try { body = await r.json(); }
    catch { return json(r, e, { ok: false, error: 'Invalid JSON body', request_id: requestId }, 400); }

    if (body?.contract_version !== CONTRACT) return json(r, e, {
      ok: false,
      error: 'Expected BeatVision contract 1.1.',
      request_id: requestId
    }, 400);

    const payload = body.payload || {};
    const operation = body.operation;

    try {
      if (operation === 'animate') return animate(r, e, key, payload, requestId);

      if (operation === 'worldAssets') {
        const character = await labeled('character / Flux Schnell', () => img(key, 'flux-schnell', worldPrompt(payload) + '\nFocus on the primary recurring character.'));
        const environment = await labeled('environment / Flux Schnell', () => img(key, 'flux-schnell', worldPrompt(payload) + '\nFocus on the defining environment.'));
        const hero = await labeled('hero / SDXL', () => img(key, 'sdxl', worldPrompt(payload) + '\nCreate a polished establishing keyframe.'));
        return json(r, e, {
          ok: true,
          contract_version: CONTRACT,
          capability: 'image',
          provider: 'pixazo',
          model: 'flux-1-schnell+sdxl',
          request_id: requestId,
          result: {
            characters: [{ name: 'Primary BeatVision character', image_url: character }],
            environments: [{ name: 'Primary BeatVision environment', image_url: environment }],
            hero_image_url: hero,
            models_used: ['flux-1-schnell', 'sdxl']
          }
        });
      }

      if (operation === 'sceneImages') {
        const scenes = Array.isArray(payload?.storyboard?.scenes) ? payload.storyboard.scenes.slice(0, 8) : [];
        if (!scenes.length) return json(r, e, {
          ok: false,
          status: 'invalid_input',
          request_id: requestId,
          error: 'Storyboard contains no scenes.'
        }, 400);
        const images = [];
        for (let i = 0; i < scenes.length; i += 1) {
          const scene = scenes[i];
          const imageUrl = await labeled(`scene ${i + 1} / SDXL Free`, () => img(key, 'sdxl', worldPrompt(payload, scene), 'wide'));
          images.push({ scene: Number(scene.scene || i + 1), status: 'generated', image_url: imageUrl });
        }
        return json(r, e, {
          ok: true,
          contract_version: CONTRACT,
          capability: 'image',
          provider: 'pixazo',
          model: 'sdxl',
          request_id: requestId,
          result: { images, models_used: ['sdxl'] }
        });
      }

      if (operation === 'generateMusic') {
        const data = await call('/tracks/v1/generate', key, {
          prompt: clip(payload?.music_prompt || payload?.style || 'cinematic instrumental music', 5000),
          lyrics: clip(payload?.lyrics, 12000),
          instrumental: !payload?.lyrics,
          duration: Math.max(10, Math.min(Number(payload?.duration_seconds || 30), 600)),
          ...(payload?.bpm ? { bpm: Number(payload.bpm) } : {}),
          ...(payload?.key ? { key: String(payload.key) } : {})
        }, 'tracks');
        const audioUrl = data?.request_id ? await wait(key, data.request_id, 'tracks') : media(data);
        if (!audioUrl) throw new Error('Pixazo Tracks returned no audio URL.');
        return json(r, e, {
          ok: true,
          contract_version: CONTRACT,
          capability: 'music',
          provider: 'pixazo',
          model: 'tracks',
          request_id: requestId,
          result: { status: 'generated', audio_url: audioUrl, pixazo_request_id: data?.request_id || null }
        });
      }

      return json(r, e, {
        ok: false,
        error: `Pixazo route not implemented for operation: ${operation}`,
        request_id: requestId
      }, 404);
    } catch (error) {
      return json(r, e, {
        ok: false,
        contract_version: CONTRACT,
        provider: 'pixazo',
        status: 'provider_error',
        request_id: requestId,
        error: String(error instanceof Error ? error.message : error).slice(0, 2000)
      }, 502);
    }
  }
};
