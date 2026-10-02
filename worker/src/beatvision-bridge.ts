export const BEATVISION_BRIDGE_CONTRACT = '2.0';

const FREE_IMAGE_MODELS = new Set(['sdxl', 'flux-schnell', 'sdxl-turbo']);
const FREE_VIDEO_MODELS = new Set(['ltx-video']);

const text = (value: unknown, max = 12000) => String(value ?? '').trim().slice(0, max);

function json(r: Request, data: unknown, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

function finite(value: unknown, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function hasObject(value: unknown) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function freeModelFor(operation: string, requested: unknown) {
  const model = text(requested, 100).toLowerCase();
  if (operation === 'sceneImage') return FREE_IMAGE_MODELS.has(model) ? model : 'sdxl';
  if (operation === 'animate') return FREE_VIDEO_MODELS.has(model) ? model : 'ltx-video';
  return null;
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function validate(payload: any, operation: string) {
  const errors: string[] = [];

  if (payload?.source?.application !== 'beatvision') {
    errors.push('source.application must be "beatvision".');
  }
  if (payload?.source?.contract !== BEATVISION_BRIDGE_CONTRACT) {
    errors.push(`source.contract must be "${BEATVISION_BRIDGE_CONTRACT}".`);
  }
  if (!text(payload?.project?.id, 200)) errors.push('project.id is required.');
  if (!hasObject(payload?.song)) errors.push('song is required.');
  if (!(finite(payload?.song?.duration_seconds) > 0)) errors.push('song.duration_seconds must be greater than zero.');
  if (!hasObject(payload?.analysis)) errors.push('BeatVision-owned song analysis is required.');
  if (payload?.analysis?.analysis_method !== 'browser_audio_decode') {
    errors.push('analysis.analysis_method must identify BeatVision browser audio analysis.');
  }
  if (!hasObject(payload?.world)) errors.push('BeatVision-owned world is required.');
  if (!text(payload?.world?.version, 100)) errors.push('world.version is required for Vision Lock provenance.');
  if (!hasObject(payload?.vision_lock)) errors.push('vision_lock is required.');
  if (payload?.vision_lock?.locked !== true) errors.push('vision_lock.locked must be true before Arena generation.');
  if (!hasObject(payload?.scene)) errors.push('scene is required.');

  const sceneStart = finite(payload?.scene?.start_time ?? payload?.scene?.startTime, -1);
  const sceneEnd = finite(payload?.scene?.end_time ?? payload?.scene?.endTime, -1);
  if (sceneStart < 0 || sceneEnd <= sceneStart) errors.push('scene start/end timing is invalid.');
  if (sceneEnd > finite(payload?.song?.duration_seconds) + 0.25) errors.push('scene timing exceeds song duration.');

  if (operation === 'sceneImage' && payload?.generation?.cost_class && payload.generation.cost_class !== 'free') {
    errors.push('Only cost_class="free" is accepted by the BeatVision bridge.');
  }
  if (operation === 'animate' && payload?.generation?.cost_class && payload.generation.cost_class !== 'free') {
    errors.push('Only cost_class="free" is accepted by the BeatVision bridge.');
  }

  return errors;
}

function toLegacyPayload(payload: any, operation: string, model: string | null) {
  const world = payload.world || {};
  const lock = payload.vision_lock || {};
  const style = payload.style || {};
  const scene = payload.scene || {};
  const analysis = payload.analysis || {};

  const lockedContinuity = [
    ...(Array.isArray(lock.characters) ? lock.characters : []),
    ...(Array.isArray(lock.environments) ? lock.environments : []),
    ...(Array.isArray(lock.rules) ? lock.rules : []),
  ];

  const worldForArena = {
    ...world,
    character_concept: world.character_concept || world.character_sheet || lock.character_sheet || null,
    locations: world.locations || world.environments || [],
    visual_motifs: world.visual_motifs || world.motifs || [],
    continuity_rules: [
      ...(Array.isArray(world.continuity_rules) ? world.continuity_rules : []),
      ...lockedContinuity,
    ],
    vision_lock: {
      locked: true,
      world_version: text(payload?.world?.version, 100),
      style_version: text(style?.version, 100),
      immutable_continuity: lock.immutable_continuity ?? world.immutable_continuity ?? [],
      shot_overrides: scene.overrides || {},
    },
  };

  const storyboardScene = {
    ...scene,
    scene: Number(scene.scene_number || scene.scene || 1),
    beatId: scene.beat_id || scene.beatId || `beat-${scene.scene_number || scene.scene || 1}`,
    startTime: finite(scene.start_time ?? scene.startTime),
    endTime: finite(scene.end_time ?? scene.endTime),
    duration_seconds: finite(scene.duration_seconds, finite(scene.end_time ?? scene.endTime) - finite(scene.start_time ?? scene.startTime)),
    world_version: text(payload?.world?.version, 100),
    style_version: text(style?.version, 100),
    vision_lock_version: text(lock.version || payload?.world?.version, 100),
    world_constraints: [
      ...(Array.isArray(scene.world_constraints) ? scene.world_constraints : []),
      ...(Array.isArray(lock.rules) ? lock.rules : []),
    ],
    visualContinuityRequirements: [
      ...(Array.isArray(scene.visual_continuity_requirements) ? scene.visual_continuity_requirements : []),
      ...(Array.isArray(lock.immutable_continuity) ? lock.immutable_continuity : []),
    ],
  };

  return {
    contract_version: '1.1',
    operation: operation === 'sceneImage' ? 'sceneImages' : operation,
    payload: {
      song_title: text(payload?.song?.title, 500),
      artist: text(payload?.song?.artist, 500),
      style: JSON.stringify(style).slice(0, 4000),
      lyrics: text(payload?.song?.lyrics, 16000),
      audio_analysis: analysis,
      audio: analysis,
      analysis,
      world: worldForArena,
      assets: payload.assets || {},
      storyboard: {
        songDuration: finite(payload?.song?.duration_seconds),
        song_duration: finite(payload?.song?.duration_seconds),
        scenes: [storyboardScene],
        visual_beats: [storyboardScene],
      },
      images: payload.images || undefined,
      motion: payload.motion || undefined,
      generation: {
        cost_class: 'free',
        requested_model: model,
        source: 'beatvision',
      },
    },
  };
}

export async function handleBeatVisionBridge(
  r: Request,
  env: any,
  arenaFetch: (request: Request, env: any) => Promise<Response>,
) {
  const path = new URL(r.url).pathname;
  const operation =
    path === '/v2/scene-image' ? 'sceneImage' :
    path === '/v2/animate' ? 'animate' :
    path === '/v2/assemble' ? 'assemble' :
    null;

  if (!operation) return null;
  const requestId = r.headers.get('X-BeatVision-Request') || crypto.randomUUID();

  if (r.method !== 'POST') {
    return json(r, { ok: false, contract_version: BEATVISION_BRIDGE_CONTRACT, status: 'invalid_method', request_id: requestId, error: 'POST required.' }, 405);
  }

  if (!String(env.GATEWAY_TOKEN || '').trim() || r.headers.get('Authorization') !== `Bearer ${env.GATEWAY_TOKEN}`) {
    return json(r, { ok: false, contract_version: BEATVISION_BRIDGE_CONTRACT, status: 'unauthorized', request_id: requestId, error: 'Unauthorized.' }, 401);
  }

  let body: any;
  try { body = await r.json(); } catch {
    return json(r, { ok: false, contract_version: BEATVISION_BRIDGE_CONTRACT, status: 'invalid_input', request_id: requestId, error: 'Invalid JSON body.' }, 400);
  }

  const payload = body?.payload;
  const errors = validate(payload, operation);
  if (errors.length) {
    return json(r, {
      ok: false,
      contract_version: BEATVISION_BRIDGE_CONTRACT,
      capability: operation === 'assemble' ? 'video' : operation === 'animate' ? 'video' : 'image',
      status: 'contract_validation_failed',
      request_id: requestId,
      errors,
    }, 422);
  }

  const requestedModel = payload?.generation?.model;
  const model = operation === 'assemble' ? null : freeModelFor(operation, requestedModel);
  if (operation !== 'assemble' && requestedModel && String(requestedModel).toLowerCase() !== model) {
    return json(r, {
      ok: false,
      contract_version: BEATVISION_BRIDGE_CONTRACT,
      status: 'paid_or_unknown_model_rejected',
      request_id: requestId,
      error: `Requested model "${requestedModel}" is not in the Arena free allowlist for ${operation}.`,
      allowed_models: operation === 'sceneImage' ? [...FREE_IMAGE_MODELS] : [...FREE_VIDEO_MODELS],
    }, 422);
  }

  const visionLockPayload = {
    project_id: text(payload?.project?.id, 200),
    world_version: text(payload?.world?.version, 100),
    style_version: text(payload?.style?.version, 100),
    vision_lock: payload?.vision_lock,
    scene_id: text(payload?.scene?.id || payload?.scene?.beat_id, 200),
    scene_overrides: payload?.scene?.overrides || {},
  };
  const visionLockHash = await sha256(JSON.stringify(visionLockPayload));

  const legacy = toLegacyPayload(payload, operation, model);
  const internalPath =
    operation === 'sceneImage' ? '/v1/internal/beatvision-scene-image' :
    operation === 'animate' ? '/v1/internal/beatvision-animate' :
    '/v1/internal/beatvision-assemble';

  const internal = new Request(new URL(internalPath, r.url), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${env.GATEWAY_TOKEN}`,
      'X-BeatVision-Contract': '1.1',
      'X-BeatVision-Request': requestId,
    },
    body: JSON.stringify(legacy),
  });

  const response = await arenaFetch(internal, env);
  const responseText = await response.text();
  let data: any;
  try { data = JSON.parse(responseText); } catch { data = { raw: responseText.slice(0, 4000) }; }

  const headers = new Headers(response.headers);
  headers.set('X-BeatVision-Bridge-Contract', BEATVISION_BRIDGE_CONTRACT);
  headers.set('X-BeatVision-Vision-Lock-Hash', visionLockHash);
  headers.set('X-BeatVision-Request', requestId);

  return new Response(JSON.stringify({
    ...data,
    bridge: {
      contract_version: BEATVISION_BRIDGE_CONTRACT,
      project_id: text(payload?.project?.id, 200),
      world_version: text(payload?.world?.version, 100),
      style_version: text(payload?.style?.version, 100),
      vision_lock_hash: visionLockHash,
      generation_model: model,
      cost_class: 'free',
      source_of_truth: 'beatvision',
    },
  }, null, 2), { status: response.status, headers });
}

export function beatVisionBridgeCapabilities(env: any) {
  return {
    contract_version: BEATVISION_BRIDGE_CONTRACT,
    source_of_truth: 'beatvision',
    cost_class: 'free',
    analysis: { provider: 'beatvision-local-dsp', authoritative: true },
    transcription: { provider: 'groq-whisper', authoritative: true, optional: true },
    world: { provider: 'beatvision-world', authoritative: true },
    image: { provider: 'pixazo', models: [...FREE_IMAGE_MODELS] },
    video: { provider: 'pixazo', models: [...FREE_VIDEO_MODELS] },
    assembly: { provider: 'shotstack-sandbox', cost_class: 'free' },
  };
}
