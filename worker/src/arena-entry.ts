import pixazo from './video-fallback-gateway';
import { compileMusicalContext } from './musical-structure';
import { splitLongBeats as splitLongBeatsWithMusic } from './scene-splitting';
import { compileCharacterContinuity } from './character-continuity';
import { compactAudio, normalizeVisualBeats, toStoryboard } from './visual-beat-engine';
export { BeatVisionAnimationJob } from './animation-jobs';

const BASE = 'https://gateway.pixazo.ai';
const CONTRACT = '1.1';
const LANGUAGE_FALLBACK_MODEL = 'openai-fast';
const LANGUAGE_TIMEOUT_MS = 60000;

const cors = (r: Request, e: any) => {
  const origin = r.headers.get('Origin') || '';
  const allowed = String(e.ALLOWED_ORIGIN || '').split(',').map((x: string) => x.trim()).filter(Boolean);
  const headers: Record<string, string> = {
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,X-BeatVision-Contract,Authorization,X-BeatVision-Request'
  };
  if (origin && allowed.includes(origin)) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
};

const json = (r: Request, e: any, data: unknown, status = 200) =>
  new Response(JSON.stringify(data, null, 2), { status, headers: { 'Content-Type': 'application/json', ...cors(r, e) } });
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const clip = (value: unknown, max: number) => String(value ?? '').slice(0, max);
const media = (d: any) => {
  const candidates = [d?.output?.media_url?.[0], d?.output?.media_url, d?.output, d?.imageUrl, d?.image_url, d?.url];
  return candidates.find((value: unknown) => typeof value === 'string' && /^https?:\/\//i.test(value)) || null;
};
const parseJson = (text: string) => {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() || text.trim();
  try { return JSON.parse(candidate); } catch {
    const object = candidate.match(/\{[\s\S]*\}/)?.[0];
    const array = candidate.match(/\[[\s\S]*\]/)?.[0];
    try { return JSON.parse(object || array || candidate); } catch { return { raw: candidate }; }
  }
};

const scenePrompt = (payload: any, scene: any, index: number, total: number) => {
  const world = payload?.world || {};
  const character = clip(JSON.stringify(world?.character_concept || world?.character_sheet || {}), 1000);
  const locations = clip(JSON.stringify(world?.locations || world?.environment_sheet || {}), 800);
  const motifs = clip(JSON.stringify(world?.visual_motifs || []), 900);
  const continuity = clip(JSON.stringify(world?.continuity_rules || []), 700);
  const characterContinuity = compileCharacterContinuity(scene, world);
  const style = clip(payload?.style, 600);
  const musical = compileMusicalContext(payload?.audio_analysis || payload?.audioAnalysis || payload?.audio || payload?.analysis, scene);
  const composition = ['wide environmental establishing composition with the character small in frame', 'medium character-focused composition with visible interaction with the environment', 'tight emotional close-up emphasizing face, hands, or a meaningful object', 'side/profile composition with strong negative space and directional movement', 'low-angle composition making the environment feel imposing around the character', 'high-angle composition revealing spatial relationships', 'silhouette/backlit composition using the established world lighting and atmosphere', 'reflection/foreground-obstruction composition using glass, mirrors, rain, architecture, or another established motif'];
  const action = ['walking or changing position through the established location', 'interacting with a meaningful object or environmental element', 'pausing and reacting physically to an internal realization', 'turning, looking, or tracking something outside the frame', 'moving from one spatial zone to another', 'performing a restrained physical gesture that expresses the beat emotion', 'observing the environment while the environment provides the visual event', 'creating a visible consequence of the previous beat'];
  const camera = ['slow lateral tracking move', 'slow push-in', 'slow pull-back revealing context', 'controlled handheld follow', 'arc around the subject', 'vertical reveal or tilt', 'locked-off composition with environmental motion', 'foreground-to-background rack-focus style reveal'];
  const lighting = ['rainy diffuse backlight', 'hard side light through architecture', 'practical interior light against deep shadow', 'cool reflected city light', 'strong silhouette against atmospheric haze', 'isolated pool of light surrounded by darkness', 'wet reflective surfaces catching sparse highlights', 'mixed warm interior and cold exterior light'];
  let h = 2166136261 >>> 0;
  const seed = String(scene?.beatId || scene?.beat_id || scene?.scene || index + 1);
  for (let i = 0; i < seed.length; i += 1) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  const pick = <T>(items: T[], offset: number) => items[((h >>> 0) + offset) % items.length];
  return clip(['BeatVision cinematic music-video scene still.','Dark industrial realism, cinematic lighting, coherent recurring character and environment.','No text, logos, watermarks, captions, UI or typography.',style ? `Style: ${style}` : '',character ? `Character continuity: ${character}` : '',locations ? `World locations: ${locations}` : '',motifs ? `Visual motifs: ${motifs}` : '',continuity ? `Continuity rules: ${continuity}` : '',characterContinuity,`Storyboard scene ${index + 1}/${total}: ${clip(JSON.stringify(scene), 1800)}`,musical ? `MUSICAL STRUCTURE:\n${musical}` : '','VISUAL DIVERSITY DIRECTIVE:',`Composition: ${pick(composition, 0)}.`,`Primary action: ${pick(action, 1)}.`,`Camera language: ${pick(camera, 2)}.`,`Lighting treatment: ${pick(lighting, 3)}.`,`Previous beat: ${scene?.previousBeat || scene?.previous_beat || 'none'}. Next beat: ${scene?.nextBeat || scene?.next_beat || 'none'}.`,'Generate a genuinely new visual event, not a reordered, recolored, or reframed copy of another beat.','Preserve established character identity, world rules, locations, motifs, emotional truth, and original concept.','Use the musical structure as a timing cue.','Do not duplicate the previous beat composition, pose, framing, camera angle, or primary action unless reusePolicy is intentional_motif_return.','Do not create a generic portrait merely because the character is present.','For repeated lyrics, change the visual event, consequence, composition, or emotional state.'].filter(Boolean).join('\n'), 12000);
};

async function pixazoPost(path: string, key: string, body: any) {
  const response = await fetch(`${BASE}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache', 'Ocp-Apim-Subscription-Key': key }, body: JSON.stringify(body) });
  const text = await response.text(); let data: any; try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!response.ok) throw new Error(`Pixazo ${response.status} at ${path}: ${String(data?.message || data?.error || text).slice(0, 1600)}`);
  return data;
}
const requestIdFrom = (data: any) => data?.requestId || data?.request_id || data?.requestID || data?.id || null;

async function pixazoStatus(key: string, requestId: string, model: string) {
  const POLL_MS = 2000;
  const TIMEOUT_MS = 45000;
  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    const response = await fetch(`${BASE}/v2/requests/status/${encodeURIComponent(requestId)}`, {
      headers: { 'Ocp-Apim-Subscription-Key': key, 'Cache-Control': 'no-cache' }
    });
    const text = await response.text();
    let data: any;
    try { data = JSON.parse(text); } catch { data = {}; }
    if (!response.ok) {
      // Flux Schnell has historically exposed a model-specific status endpoint.
      // Keep the universal v2 endpoint as the primary path, but fall back to
      // the documented legacy endpoint if the universal route rejects the job.
      if (model === 'flux-schnell') {
        const legacy = await fetch(`${BASE}/flux-1-schnell/v1/checkStatus`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Ocp-Apim-Subscription-Key': key,
            'Cache-Control': 'no-cache'
          },
          body: JSON.stringify({ requestId })
        });
        const legacyText = await legacy.text();
        let legacyData: any;
        try { legacyData = JSON.parse(legacyText); } catch { legacyData = {}; }
        if (!legacy.ok) {
          throw new Error(`Pixazo ${model} status ${response.status}; legacy status ${legacy.status}: ${legacyText.slice(0, 1200)}`);
        }
        const legacyUrl = media(legacyData);
        const legacyStatus = String(legacyData?.status || legacyData?.state || '').toUpperCase();
        if (legacyUrl) return legacyUrl;
        if (['ERROR', 'FAILED', 'CANCELED', 'CANCELLED'].includes(legacyStatus)) {
          throw new Error(`Pixazo ${model} legacy job ${legacyStatus}: ${String(legacyData?.error || legacyData?.message || 'unknown provider error').slice(0, 1600)}`);
        }
        throw new Error(`Pixazo ${model} status rejected the universal endpoint and legacy status returned no media URL: ${legacyText.slice(0, 1200)}`);
      }
      throw new Error(`Pixazo ${model} status ${response.status}: ${text.slice(0, 1200)}`);
    }
    const url = media(data);
    const status = String(data?.status || data?.state || '').toUpperCase();
    if (url) return url;
    if (['ERROR', 'FAILED', 'CANCELED', 'CANCELLED'].includes(status)) {
      throw new Error(`Pixazo ${model} job ${status}: ${String(data?.error || data?.message || 'unknown provider error').slice(0, 1600)}`);
    }
    if (['COMPLETED', 'SUCCEEDED', 'SUCCESS'].includes(status)) {
      throw new Error(`Pixazo ${model} job ${status} without a media URL: ${text.slice(0, 1200)}`);
    }
    await sleep(POLL_MS);
  }
  throw new Error(`Pixazo ${model} request ${requestId} did not complete within ${TIMEOUT_MS / 1000} seconds.`);
}

async function generateSceneImage(key: string, prompt: string, sceneNumber: number) {
  let sdxlError = '';
  try {
    const data = await pixazoPost('/getImage/v1/getSDXLImage', key, {
      prompt,
      negative_prompt: 'low quality, blurry, distorted anatomy, duplicate face, extra limbs, text, logo, watermark, UI, caption, repeated composition, duplicate shot',
      height: 768,
      width: 1344,
      num_steps: 20,
      guidance_scale: 5,
      seed: Math.floor(Math.random() * 2147483647)
    });
    const url = media(data);
    if (url) return { image_url: url, model: 'sdxl' };
    const requestId = requestIdFrom(data);
    if (requestId) {
      const polled = await pixazoStatus(key, requestId, 'sdxl');
      return { image_url: polled, model: 'sdxl' };
    }
    throw new Error(`SDXL completed without an image URL or request ID. Body: ${JSON.stringify(data).slice(0, 800)}`);
  } catch (error) {
    sdxlError = error instanceof Error ? error.message : String(error);
  }

  try {
    const data = await pixazoPost('/flux-1-schnell/v1/getData', key, {
      prompt: clip(prompt, 2048),
      num_steps: 4,
      height: 1024,
      width: 1024,
      seed: Math.floor(Math.random() * 2147483647)
    });
    const url = media(data);
    if (url) return { image_url: url, model: 'flux-1-schnell', fallback_reason: sdxlError };
    const requestId = requestIdFrom(data);
    if (requestId) {
      const polled = await pixazoStatus(key, requestId, 'flux-schnell');
      return { image_url: polled, model: 'flux-1-schnell', fallback_reason: sdxlError };
    }
    throw new Error(`Flux Schnell completed without an image URL or request ID. Body: ${JSON.stringify(data).slice(0, 800)}`);
  } catch (error) {
    const fluxError = error instanceof Error ? error.message : String(error);

    // Final free fallback: current Pixazo SDXL Turbo endpoint is synchronous
    // and returns an output URL directly, avoiding queue/status incompatibilities.
    try {
      const turbo = await pixazoPost('/sdxlTurbo/v2/getData', key, {
        prompt: clip(prompt, 12000),
        height: 768,
        width: 768,
        num_inference_steps: 1,
        guidance_scale: 0,
        seed: Math.floor(Math.random() * 2147483647)
      });
      const turboUrl = media(turbo);
      if (turboUrl) {
        return {
          image_url: turboUrl,
          model: 'sdxl-turbo',
          fallback_reason: `${sdxlError}; ${fluxError}`
        };
      }
      throw new Error(`SDXL Turbo returned no image URL. Body: ${JSON.stringify(turbo).slice(0, 800)}`);
    } catch (turboError) {
      throw new Error(
        `scene ${sceneNumber}: SDXL failed: ${sdxlError}; Flux Schnell fallback failed: ${fluxError}; SDXL Turbo fallback failed: ${turboError instanceof Error ? turboError.message : String(turboError)}`
      );
    }
  }
}

async function resilientSceneImages(r: Request, e: any, body: any, requestId: string) {
  const key = e.PIXAZO_API_KEY; if (!key) return json(r, e, { ok: false, error: 'PIXAZO_API_KEY is not configured.', request_id: requestId }, 503);
  if (body?.contract_version !== CONTRACT) return json(r, e, { ok: false, error: 'Expected BeatVision contract 1.1.', request_id: requestId }, 400);
  const payload = body?.payload || {}; const scenes = Array.isArray(payload?.storyboard?.scenes) ? payload.storyboard.scenes : [];
  if (!scenes.length) return json(r, e, { ok: false, status: 'invalid_input', request_id: requestId, error: 'Storyboard contains no scenes.' }, 400);
  if (scenes.length > 1) return json(r, e, { ok: false, status: 'invalid_input', request_id: requestId, error: 'Scene image gateway expects one visual beat per request. Batch the beats at the client/orchestration layer so failures remain isolated.' }, 400);
  const started = Date.now(); const images: any[] = []; const models = new Set<string>();
  try { for (let i = 0; i < scenes.length; i += 1) { const sceneNumber = Number(scenes[i]?.scene || i + 1); const generated = await generateSceneImage(key, scenePrompt(payload, scenes[i], i, scenes.length), sceneNumber); images.push({ scene: sceneNumber, beatId: scenes[i]?.beatId || null, status: 'generated', image_url: generated.image_url, model: generated.model }); models.add(generated.model); } return json(r, e, { ok: true, contract_version: CONTRACT, capability: 'image', provider: 'pixazo', model: Array.from(models).join('+'), request_id: requestId, latency_ms: Date.now() - started, result: { images, models_used: Array.from(models), scene_count: images.length, free_only: true } }); } catch (error) { return json(r, e, { ok: false, contract_version: CONTRACT, capability: 'image', provider: 'pixazo', status: 'provider_error', request_id: requestId, latency_ms: Date.now() - started, completed_scene_count: images.length, completed_scenes: images.map(image => image.scene), error: String(error instanceof Error ? error.message : error).slice(0, 2200) }, 502); }
}

async function storyboardWithRenderSafeBeats(r: Request, e: any, body: any) {
  const upstream = await pixazo.fetch(new Request(r.url, { method: 'POST', headers: new Headers(r.headers), body: JSON.stringify(body) }), e); if (!upstream.ok) return upstream;
  let data: any; try { data = await upstream.clone().json(); } catch { return upstream; }
  const result = data?.result; if (!result || typeof result !== 'object') return upstream; const scenes = Array.isArray(result.scenes) ? result.scenes : Array.isArray(result.visual_beats) ? result.visual_beats : null; if (!scenes?.length) return upstream;
  const audioAnalysis = body?.payload?.audio_analysis || body?.payload?.audioAnalysis || body?.payload?.audio || body?.payload?.analysis;
  const expanded = splitLongBeatsWithMusic({ ...result, scenes }, audioAnalysis); if (expanded.length <= scenes.length) return upstream;
  const updated = { ...data, result: { ...result, scenes: expanded, visual_beats: expanded, scene_count: expanded.length, render_safe_scene_count: expanded.length, coverage: result.coverage ? { ...result.coverage, visual_beats: expanded.length, render_safe_scene_count: expanded.length, long_beats: 0 } : result.coverage } };
  return new Response(JSON.stringify(updated, null, 2), { status: upstream.status, headers: { 'Content-Type': 'application/json', ...cors(r, e) } });
}

async function languageGenerate(r: Request, e: any, body: any, requestId: string) {
  if (body?.contract_version !== CONTRACT || body?.operation !== 'generate') return json(r, e, { ok: false, contract_version: CONTRACT, status: 'contract_mismatch', request_id: requestId, error: 'Expected BeatVision contract 1.1 language generate.' }, 400);
  const token = e.LANGUAGE_PROVIDER_TOKEN;
  if (!token) return json(r, e, { ok: false, contract_version: CONTRACT, status: 'provider_unavailable', request_id: requestId, error: 'No language provider token configured.' }, 503);
  const payload = body?.payload || {};
  const prompt = clip(payload?.prompt, 30000);
  if (!prompt) return json(r, e, { ok: false, contract_version: CONTRACT, status: 'invalid_input', request_id: requestId, error: 'Language generation prompt is required.' }, 400);
  const models = [String(e.LANGUAGE_PROVIDER_MODEL || 'openai'), LANGUAGE_FALLBACK_MODEL].filter((v, i, a) => a.indexOf(v) === i);
  let lastError = 'Language provider request failed.';
  const started = Date.now();
  for (const model of models) {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), LANGUAGE_TIMEOUT_MS);
    try {
      const response = await fetch(e.LANGUAGE_PROVIDER_URL || 'https://gen.pollinations.ai/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}`, 'X-BeatVision-Request': requestId }, body: JSON.stringify({ model, messages: [{ role: 'system', content: 'You are the BeatVision visual-world director. Return ONLY valid JSON. Preserve creative intent, continuity, and production usefulness. Do not invent lyrics.' }, { role: 'user', content: prompt }], temperature: 0.7 }), signal: controller.signal });
      const text = await response.text(); let data: any; try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 20000) }; }
      const content = data?.choices?.[0]?.message?.content || '';
      if (response.ok && content) {
        const parsed = parseJson(content);
        if (String(payload?.mode || '') === 'storyboard') {
          const duration = Number(payload?.duration_seconds || payload?.durationSeconds || compactAudio(payload?.audio_analysis || payload?.audioAnalysis || payload?.audio || payload?.analysis)?.duration_seconds || 0);
          const normalized = normalizeVisualBeats(parsed, duration);
          if (normalized.errors.length) {
            return json(r, e, { ok: false, contract_version: CONTRACT, capability: 'language', provider: e.LANGUAGE_PROVIDER || 'pollinations', model, status: 'visual_coverage_insufficient', latency_ms: Date.now() - started, request_id: requestId, result: toStoryboard(normalized), coverage: normalized.coverage, errors: normalized.errors, error: 'Storyboard failed the deterministic visual coverage/semantic quality gate.' }, 422);
          }
          return json(r, e, { ok: true, contract_version: CONTRACT, capability: 'language', provider: e.LANGUAGE_PROVIDER || 'pollinations', model, status: 'generated', latency_ms: Date.now() - started, request_id: requestId, result: toStoryboard(normalized), coverage: normalized.coverage });
        }
        return json(r, e, { ok: true, contract_version: CONTRACT, capability: 'language', provider: e.LANGUAGE_PROVIDER || 'pollinations', model, status: 'generated', latency_ms: Date.now() - started, request_id: requestId, result: parsed });
      }
      lastError = `Language provider ${response.status}: ${String(data?.error?.message || data?.error || text).slice(0, 1000)}`;
      if (response.status < 500) break;
    } catch (error) { lastError = error instanceof Error ? error.message : String(error); }
    finally { clearTimeout(timer); }
  }
  return json(r, e, { ok: false, contract_version: CONTRACT, capability: 'language', provider: 'pollinations', status: 'provider_error', request_id: requestId, latency_ms: Date.now() - started, error: lastError }, 502);
}

export default { async fetch(r: Request, e: any) {
  if (r.method === 'OPTIONS') { const origin = r.headers.get('Origin') || ''; const allowed = String(e.ALLOWED_ORIGIN || '').split(',').map((x: string) => x.trim()).filter(Boolean); if (!origin || !allowed.includes(origin)) return new Response(null, { status: 403, headers: cors(r, e) }); return new Response(null, { status: 204, headers: cors(r, e) }); }
  const url = new URL(r.url), path = url.pathname, requestId = r.headers.get('X-BeatVision-Request') || crypto.randomUUID();
  if (path === '/' || path === '/health') return pixazo.fetch(r, e);
  if (!e.GATEWAY_TOKEN) return json(r, e, { ok: false, error: 'Gateway authentication is not configured.', request_id: requestId }, 503);
  if (r.headers.get('Authorization') !== `Bearer ${e.GATEWAY_TOKEN}`) return json(r, e, { ok: false, error: 'Unauthorized', request_id: requestId }, 401);
  let body: any; try { body = await r.clone().json(); } catch { return json(r, e, { ok: false, error: 'Invalid JSON request body.', request_id: requestId }, 400); }
  if (path === '/v1/language/generate') return languageGenerate(r, e, body, requestId);
  if (body?.operation === 'sceneImages') return resilientSceneImages(r, e, body, requestId);
  if (body?.operation === 'storyboard') return storyboardWithRenderSafeBeats(r, e, body);
  return pixazo.fetch(r, e);
} };