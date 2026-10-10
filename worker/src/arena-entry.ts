import pixazo from './video-fallback-gateway.ts';
import { compileMusicalContext } from './musical-structure.ts';
import { splitLongBeats as splitLongBeatsWithMusic } from './scene-splitting.ts';
import { compileCharacterContinuity } from './character-continuity.ts';
import { compactAudio, normalizeVisualBeats, toStoryboard } from './visual-beat-engine.ts';
import { getShotstackRenderStatus } from './shotstack-gateway.ts';
export { BeatVisionAnimationJob } from './animation-jobs.ts';

const BASE = 'https://gateway.pixazo.ai';
const CONTRACT = '1.1';
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
    if (model === 'flux-schnell') {
      const response = await fetch(`${BASE}/flux-1-schnell/v1/checkStatus`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Ocp-Apim-Subscription-Key': key,
          'Cache-Control': 'no-cache'
        },
        body: JSON.stringify({ requestId })
      });
      const text = await response.text();
      let data: any;
      try { data = JSON.parse(text); } catch { data = {}; }

      if (!response.ok) {
        throw new Error(`Pixazo flux-schnell status ${response.status}: ${text.slice(0, 1200)}`);
      }

      const url = media(data);
      const status = String(data?.status || data?.state || '').toUpperCase();
      if (url) return url;
      if (['ERROR', 'FAILED', 'CANCELED', 'CANCELLED'].includes(status)) {
        throw new Error(`Pixazo flux-schnell job ${status}: ${String(data?.error || data?.message || 'unknown').slice(0, 1600)}`);
      }
    } else {
      const response = await fetch(`${BASE}/v2/requests/status/${encodeURIComponent(requestId)}`, {
        headers: { 'Ocp-Apim-Subscription-Key': key, 'Cache-Control': 'no-cache' }
      });
      const text = await response.text();
      let data: any;
      try { data = JSON.parse(text); } catch { data = {}; }
      if (!response.ok) {
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
    }
    await sleep(POLL_MS);
  }
  throw new Error(`Pixazo ${model} request ${requestId} did not complete within ${TIMEOUT_MS / 1000} seconds.`);
}

async function generateCloudflareSceneImage(e: any, prompt: string, sceneNumber: number) {
  if (!e?.AI || typeof e.AI.run !== 'function') {
    throw new Error('Cloudflare Workers AI fallback is not configured.');
  }
  const response = await e.AI.run('@cf/black-forest-labs/flux-1-schnell', {
    prompt: clip(prompt, 2048),
    steps: 4
  });
  const image = typeof response?.image === 'string' ? response.image.trim() : '';
  if (!image) throw new Error(`Cloudflare Workers AI returned no image data for scene ${sceneNumber}.`);
  return { image_base64: image, model: 'flux-1-schnell', provider: 'cloudflare-workers-ai', fallback_used: true };
}

async function generateSceneImage(key: string, prompt: string, sceneNumber: number, e: any) {
  // Prefer the already configured Workers AI path without probing Pixazo
  // billing. A free-allocation failure must not submit to another provider.
  if (e?.AI && typeof e.AI.run === 'function') {
    return { ...await generateCloudflareSceneImage(e, prompt, sceneNumber), fallback_used: false };
  }
  // Primary: Pixazo Flux Schnell. Fallback: Cloudflare Workers AI Flux Schnell.
  // Both are free-only paths. Never silently substitute a paid/unknown model.
  try {
    if (!key) throw new Error('Pixazo API key is not configured.');
    const data = await pixazoPost('/flux-1-schnell/v1/getData', key, {
      prompt: clip(prompt, 2048),
      num_steps: 4,
      height: 1024,
      width: 1024,
      seed: Math.floor(Math.random() * 2147483647)
    });
    const url = media(data);
    if (url) return { image_url: url, model: 'flux-1-schnell', provider: 'pixazo', fallback_used: false };
    const requestId = requestIdFrom(data);
    if (requestId) {
      const polled = await pixazoStatus(key, requestId, 'flux-schnell');
      return { image_url: polled, model: 'flux-1-schnell', provider: 'pixazo', fallback_used: false };
    }
    throw new Error(`Flux Schnell completed without an image URL or request ID. Body: ${JSON.stringify(data).slice(0, 800)}`);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    const fallbackEligible = /Pixazo (?:402|403)|Insufficient Balance|balance is insufficient|Pixazo API key is not configured/i.test(msg);
    if (!fallbackEligible) throw new Error(`scene ${sceneNumber}: Flux Schnell failed: ${msg}`);
    try {
      return await generateCloudflareSceneImage(e, prompt, sceneNumber);
    } catch (fallbackError) {
      const fallbackMsg = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
      throw new Error(`scene ${sceneNumber}: Pixazo Flux Schnell unavailable; Cloudflare Workers AI Flux Schnell fallback failed: ${fallbackMsg}`);
    }
  }
}

async function resilientSceneImages(r: Request, e: any, body: any, requestId: string) {
  const key = String(e.PIXAZO_API_KEY || '').trim();
  const cloudflareAiAvailable = Boolean(e?.AI && typeof e.AI.run === 'function');
  if (!key && !cloudflareAiAvailable) return json(r, e, { ok: false, status: 'provider_unavailable', error: 'No free scene-image provider is configured.', request_id: requestId }, 503);
  if (body?.contract_version !== CONTRACT) return json(r, e, { ok: false, error: 'Expected BeatVision contract 1.1.', request_id: requestId }, 400);
  const payload = body?.payload || {}; const scenes = Array.isArray(payload?.storyboard?.scenes) ? payload.storyboard.scenes : [];
  if (!scenes.length) return json(r, e, { ok: false, status: 'invalid_input', request_id: requestId, error: 'Storyboard contains no scenes.' }, 400);
  if (scenes.length > 1) return json(r, e, { ok: false, status: 'invalid_input', request_id: requestId, error: 'Scene image gateway expects one visual beat per request. Batch the beats at the client/orchestration layer so failures remain isolated.' }, 400);
  const started = Date.now(); const images: any[] = []; const models = new Set<string>();
  try { for (let i = 0; i < scenes.length; i += 1) { const sceneNumber = Number(scenes[i]?.scene || i + 1); const generated = await generateSceneImage(key, scenePrompt(payload, scenes[i], i, scenes.length), sceneNumber, e); images.push({ scene: sceneNumber, beatId: scenes[i]?.beatId || null, status: 'generated', image_url: generated.image_url || null, image_base64: generated.image_base64 || null, model: generated.model, provider: generated.provider, fallback_used: Boolean(generated.fallback_used) }); models.add(generated.model); } return json(r, e, { ok: true, contract_version: CONTRACT, capability: 'image', provider: 'arena', model: Array.from(models).join('+'), request_id: requestId, latency_ms: Date.now() - started, result: { images, models_used: Array.from(models), scene_count: images.length, free_only: true, fallback_used: images.some(image => image.fallback_used), provider_path: Array.from(new Set(images.map(image => image.provider).filter(Boolean))) } }); } catch (error) { const rawError = String(error instanceof Error ? error.message : error); const sanitized = key ? rawError.split(key).join('[REDACTED]') : rawError; return json(r, e, { ok: false, contract_version: CONTRACT, capability: 'image', provider: 'arena', status: 'provider_error', request_id: requestId, latency_ms: Date.now() - started, completed_scene_count: images.length, completed_scenes: images.map(image => image.scene), free_only: true, error: sanitized.slice(0, 2200) }, 502); }
}

const APPROVED_YOUTUBE_REFERENCE = 'https://pub-582b7213209642b9b995c96c95a30381.r2.dev/sdxl/prompt-133708738-1790839798765-439420.png';

async function youtubeReferenceContinuation(r: Request, e: any, body: any, requestId: string) {
  return json(r, e, {
    ok: false,
    contract_version: CONTRACT,
    capability: 'image',
    provider: 'pixazo',
    status: 'provider_unavailable',
    request_id: requestId,
    cost_class: 'free',
    error: 'Reference continuation is disabled in the free-only BeatVision execution path. Use the BeatVision Vision Lock and generate a new locked scene image instead.'
  }, 503);
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
  if (body?.contract_version !== CONTRACT || body?.operation !== 'generate') {
    return json(r, e, {
      ok: false,
      contract_version: CONTRACT,
      status: 'contract_mismatch',
      request_id: requestId,
      error: 'Expected BeatVision contract 1.1 language generate.'
    }, 400);
  }

  const token = String(e.EXTERNAL_LANGUAGE_PROVIDER_TOKEN || '').trim();
  const url = String(e.EXTERNAL_LANGUAGE_PROVIDER_URL || '').trim();
  const model = String(e.EXTERNAL_LANGUAGE_PROVIDER_MODEL || '').trim();
  if (!token || !url || !model) {
    return json(r, e, {
      ok: false,
      contract_version: CONTRACT,
      capability: 'language',
      status: 'provider_unavailable',
      request_id: requestId,
      error: 'No external language provider is configured. Configure EXTERNAL_LANGUAGE_PROVIDER_URL, EXTERNAL_LANGUAGE_PROVIDER_MODEL and EXTERNAL_LANGUAGE_PROVIDER_TOKEN.'
    }, 503);
  }

  const payload = body?.payload || {};
  const prompt = clip(payload?.prompt, 30000);
  if (!prompt) return json(r, e, {
    ok: false,
    contract_version: CONTRACT,
    capability: 'language',
    status: 'invalid_input',
    request_id: requestId,
    error: 'Language generation prompt is required.'
  }, 400);

  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LANGUAGE_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'X-BeatVision-Request': requestId
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content: 'You are the BeatVision visual-world director. Return ONLY a valid JSON object. Never return prose, markdown, a single character, or a JSON string. Preserve creative intent, continuity, song timing, and production usefulness. Do not invent lyrics.'
          },
          { role: 'user', content: prompt }
        ],
        temperature: 0.4,
        response_format: { type: 'json_object' }
      }),
      signal: controller.signal
    });

    const text = await response.text();
    let data: any;
    try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 20000) }; }
    const content = data?.choices?.[0]?.message?.content || '';

    if (response.ok && content) {
      const parsed = parseJson(content);
      if (String(payload?.mode || '') === 'storyboard') {
        const duration = Number(
          payload?.duration_seconds ||
          payload?.durationSeconds ||
          compactAudio(payload?.audio_analysis || payload?.audioAnalysis || payload?.audio || payload?.analysis)?.duration_seconds ||
          0
        );
        const normalized = normalizeVisualBeats(parsed, duration);
        if (!normalized.errors.length) {
          return json(r, e, {
            ok: true,
            contract_version: CONTRACT,
            capability: 'language',
            provider: 'external',
            model,
            status: 'generated',
            latency_ms: Date.now() - started,
            request_id: requestId,
            result: toStoryboard(normalized),
            coverage: normalized.coverage
          });
        }

        if (normalized.errors.some((x: string) => x === 'No visual beats were produced.')) {
          const repairPrompt = [
            'Repair the BeatVision storyboard request below.',
            'Return ONLY one valid JSON object with exactly these top-level keys: sections, visual_beats, coverage_notes.',
            'visual_beats MUST be a non-empty JSON array.',
            'Every beat MUST have numeric startTime and endTime with endTime greater than startTime.',
            'Use the supplied song duration when present. Cover the complete timeline from 0 to duration.',
            'Do not return markdown, prose, null, or an empty array.',
            'Do not invent lyrics. Instrumental intervals must be described as non-lyrical.',
            'Song duration: ' + (duration > 0 ? String(duration) : 'not supplied') + '.',
            'Original storyboard prompt:',
            prompt
          ].join('\\n');
          try {
            const repairResponse = await fetch(url, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
                'X-BeatVision-Request': requestId
              },
              body: JSON.stringify({
                model,
                messages: [
                  { role: 'system', content: 'You are repairing a BeatVision storyboard. Output ONLY valid JSON matching the requested structure.' },
                  { role: 'user', content: repairPrompt }
                ],
                temperature: 0.2,
                response_format: { type: 'json_object' }
              }),
              signal: AbortSignal.timeout(LANGUAGE_TIMEOUT_MS)
            });
            const repairText = await repairResponse.text();
            let repairData: any;
            try { repairData = JSON.parse(repairText); } catch { repairData = { raw: repairText.slice(0, 20000) }; }
            const repairContent = repairData?.choices?.[0]?.message?.content || '';
            if (repairResponse.ok && repairContent) {
              const repaired = parseJson(repairContent);
              const repairedNormalized = normalizeVisualBeats(repaired, duration);
              if (!repairedNormalized.errors.length) {
                return json(r, e, {
                  ok: true,
                  contract_version: CONTRACT,
                  capability: 'language',
                  provider: 'external',
                  model,
                  status: 'generated_repaired',
                  latency_ms: Date.now() - started,
                  request_id: requestId,
                  result: toStoryboard(repairedNormalized),
                  coverage: repairedNormalized.coverage
                });
              }
            }
          } catch {
            // Preserve deterministic quality-gate failure if repair also fails.
          }
        }

        return json(r, e, {
          ok: false,
          contract_version: CONTRACT,
          capability: 'language',
          provider: 'external',
          model,
          status: 'visual_coverage_insufficient',
          latency_ms: Date.now() - started,
          request_id: requestId,
          result: toStoryboard(normalized),
          coverage: normalized.coverage,
          errors: normalized.errors,
          error: 'Storyboard failed the deterministic visual coverage/semantic quality gate.'
        }, 422);
      }

      return json(r, e, {
        ok: true,
        contract_version: CONTRACT,
        capability: 'language',
        provider: 'external',
        model,
        status: 'generated',
        latency_ms: Date.now() - started,
        request_id: requestId,
        result: parsed
      });
    }

    const providerError = String(data?.error?.message || data?.error || text).slice(0, 1600);
    return json(r, e, {
      ok: false,
      contract_version: CONTRACT,
      capability: 'language',
      provider: 'external',
      model,
      status: 'provider_error',
      latency_ms: Date.now() - started,
      request_id: requestId,
      error: `External language provider ${response.status}: ${providerError}`
    }, response.status >= 400 && response.status < 600 ? 502 : 502);
  } catch (error) {
    const timed = error instanceof Error && error.name === 'AbortError';
    return json(r, e, {
      ok: false,
      contract_version: CONTRACT,
      capability: 'language',
      provider: 'external',
      model,
      status: timed ? 'provider_timeout' : 'provider_error',
      latency_ms: Date.now() - started,
      request_id: requestId,
      error: timed ? 'External language provider timed out.' : String(error instanceof Error ? error.message : error).slice(0, 1600)
    }, timed ? 504 : 502);
  } finally {
    clearTimeout(timer);
  }
}

export default { async fetch(r: Request, e: any) {
  if (r.method === 'OPTIONS') { const origin = r.headers.get('Origin') || ''; const allowed = String(e.ALLOWED_ORIGIN || '').split(',').map((x: string) => x.trim()).filter(Boolean); if (!origin || !allowed.includes(origin)) return new Response(null, { status: 403, headers: cors(r, e) }); return new Response(null, { status: 204, headers: cors(r, e) }); }
  const url = new URL(r.url), path = url.pathname, requestId = r.headers.get('X-BeatVision-Request') || crypto.randomUUID();
  if (path === '/' || path === '/health') return pixazo.fetch(r, e);
  if (path === '/v1/client/image/reference-continuation') {
    if (r.method !== 'POST') return json(r, e, { ok: false, error: 'Method Not Allowed', request_id: requestId }, 405);
    let body: any; try { body = await r.json(); } catch { return json(r, e, { ok: false, error: 'Invalid JSON request body.', request_id: requestId }, 400); }
    if (body?.contract_version && body.contract_version !== CONTRACT) return json(r, e, { ok: false, error: 'Expected BeatVision contract 1.1.', request_id: requestId }, 400);
    return youtubeReferenceContinuation(r, e, body, requestId);
  }
  if (path === '/v1/client/image/scene') {
    if (r.method !== 'POST') return json(r, e, { ok: false, error: 'Method Not Allowed' }, 405);
    let clientBody: any; try { clientBody = await r.json(); } catch { return json(r, e, { ok: false, error: 'Invalid JSON request body.', request_id: requestId }, 400); }
    if (clientBody?.scene && !clientBody?.payload?.storyboard?.scenes) {
      const sceneObj = {
        ...clientBody.scene,
        scene: Number(clientBody.scene.sceneNumber || clientBody.scene.scene || 1),
        beatId: clientBody.scene.id || clientBody.scene.beatId || `scene-${clientBody.scene.sceneNumber || 1}`
      };
      clientBody = {
        contract_version: clientBody.contract_version || CONTRACT,
        operation: 'sceneImages',
        payload: {
          style: clientBody.style || clientBody.scene?.visualLanguage || 'Dark industrial realism, cinematic lighting, coherent recurring character and environment.',
          world: clientBody.world || {
            the_world: clientBody.scene?.environment?.name || '',
            characters: clientBody.scene?.characters || [],
            locations: clientBody.scene?.environment ? [clientBody.scene.environment] : []
          },
          storyboard: {
            scenes: [sceneObj]
          }
        }
      };
    }
    return resilientSceneImages(r, e, clientBody, requestId);
  }
  if (!e.GATEWAY_TOKEN) return json(r, e, { ok: false, error: 'Gateway authentication is not configured.', request_id: requestId }, 503);
  if (r.headers.get('Authorization') !== `Bearer ${e.GATEWAY_TOKEN}`) return json(r, e, { ok: false, error: 'Unauthorized', request_id: requestId }, 401);
  let body: any; try { body = await r.clone().json(); } catch { return json(r, e, { ok: false, error: 'Invalid JSON request body.', request_id: requestId }, 400); }
  const renderStatusMatch = path.match(/^\/v1\/video\/assemble\/status\/([A-Za-z0-9-]+)$/);
  if (renderStatusMatch) {
    if (r.method !== 'POST') return json(r, e, { ok: false, error: 'POST required', request_id: requestId }, 405);
    const payload = body?.payload || {};
    const renderId = renderStatusMatch[1];
    const targetDuration = Number(payload?.target_duration_seconds || payload?.targetDurationSeconds || 0);
    if (!(targetDuration > 0)) return json(r, e, { ok: false, error: 'target_duration_seconds is required.', request_id: requestId }, 400);
    return getShotstackRenderStatus(r, e, renderId, targetDuration);
  }
  if (path === '/v1/language/generate') return languageGenerate(r, e, body, requestId);
  if (body?.operation === 'sceneImages') return resilientSceneImages(r, e, body, requestId);
  if (body?.operation === 'storyboard') return storyboardWithRenderSafeBeats(r, e, body);
  return pixazo.fetch(r, e);
} };