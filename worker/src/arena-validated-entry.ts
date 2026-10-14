import { isGatewayAuthorized } from './gateway-auth.ts';
import arena from './arena-entry.ts';
import providerGateway from './video-fallback-gateway.ts';
import { BeatVisionAnimationJob } from './animation-jobs.ts';
export { BeatVisionAnimationJob } from './animation-jobs.ts';
import { validateStoryboard } from './storyboard-validator.ts';
import { timelineGuardian, validateMediaRecord } from './skills.ts';
import { detectVisualReuse } from './visual-reuse-detector.ts';
import { beatVisionBridgeCapabilities, handleBeatVisionBridge } from './beatvision-bridge.ts';

const clientRateLimit = new Map<string, number>();
const RATE_LIMIT_WINDOW_MS = 10000; // 10 seconds per client IP
// Hardening 2026-10-14: refuse oversized bodies before auth/provider work or
// JSON parsing. Generous enough for base64 reference images.
export const MAX_REQUEST_BYTES = 8 * 1024 * 1024;

// Per-request env so json() can apply the ALLOWED_ORIGIN allowlist instead of
// reflecting whatever Origin the caller sent.
const requestEnv = new WeakMap<Request, any>();
export function corsHeadersFor(r: Request, env: any): Record<string, string> {
  const origin = r.headers.get('Origin') || '';
  const allowed = String(env?.ALLOWED_ORIGIN || '').split(',').map((x: string) => x.trim()).filter(Boolean);
  const headers: Record<string, string> = {
    'Vary': 'Origin',
    'Access-Control-Allow-Headers': 'Content-Type,X-BeatVision-Contract,Authorization,X-BeatVision-Request'
  };
  if (origin && allowed.includes(origin)) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

const json = (r: Request, data: unknown, status = 200) => new Response(JSON.stringify(data, null, 2), {
  status,
  headers: { 'Content-Type': 'application/json', ...corsHeadersFor(r, requestEnv.get(r)) }
});

export default {
  async fetch(r: Request, env: any, ctx: ExecutionContext) {
    requestEnv.set(r, env);
    if (r.method === 'OPTIONS') return arena.fetch(r, env, ctx);
    const declaredLength = Number(r.headers.get('Content-Length') || '0');
    if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
      return json(r, { ok: false, status: 'payload_too_large', error: 'Request body is too large.' }, 413);
    }
    const token = String(env.GATEWAY_TOKEN || '').trim();
    const path = new URL(r.url).pathname;

    // IP rate limits are not authentication. Gate all legacy client provider
    // endpoints before checking provider configuration or reading the body.
    if (path.startsWith('/v1/client/')) {
      if (!token) return json(r, { ok: false, error: 'Gateway authentication is not configured.' }, 503);
      if (!isGatewayAuthorized(r, env))
        return json(r, { ok: false, error: 'Unauthorized' }, 401);
    }

    if (path === '/health') {
      // Unauthenticated liveness only; configuration/secret presence and model
      // details are disclosed to gateway-authorized callers exclusively.
      if (!isGatewayAuthorized(r, env)) {
        return json(r, { ok: true, service: 'beatvision-provider-arena', contract_version: '1.1', bridge_contract_version: '2.0' });
      }
      return json(r, {
        ok: true,
        service: 'beatvision-provider-arena',
        entrypoint: 'arena-validated-entry',
        contract_version: '1.1',
        bridge_contract_version: '2.0',
        beatvision_bridge: beatVisionBridgeCapabilities(env),
        configuration: {
          gateway_token: Boolean(token),
          pixazo_api_key: Boolean(String(env.PIXAZO_API_KEY || '').trim()),
          external_language_provider_token: Boolean(String(env.EXTERNAL_LANGUAGE_PROVIDER_TOKEN || '').trim()),
          shotstack_api_key: Boolean(String(env.SHOTSTACK_API_KEY || '').trim()),
          external_language_provider: 'external',
          external_language_provider_model: String(env.EXTERNAL_LANGUAGE_PROVIDER_MODEL || 'unset').trim(),
          external_language_provider_url: Boolean(String(env.EXTERNAL_LANGUAGE_PROVIDER_URL || '').trim()),
        },
      });
    }

    // Legacy client endpoint requires server-held gateway authorization.
    if (path.startsWith('/v2/')) {
      const bridgeResponse = await handleBeatVisionBridge(r, env, (request, bridgeEnv) => arena.fetch(request, bridgeEnv, ctx));
      if (bridgeResponse) return bridgeResponse;
    }

    if (path === '/v1/client/image/reference-continuation') {
      if (r.method !== 'POST') {
        return json(r, { ok: false, error: 'Method Not Allowed. Reference-continuation endpoint requires POST.' }, 405);
      }

      const clientIp = r.headers.get('CF-Connecting-IP') || r.headers.get('X-Forwarded-For') || 'client';
      const now = Date.now();
      const lastRequest = clientRateLimit.get(`reference:${clientIp}`) || 0;
      if (now - lastRequest < RATE_LIMIT_WINDOW_MS) {
        const retryAfter = Math.ceil((RATE_LIMIT_WINDOW_MS - (now - lastRequest)) / 1000);
        return json(r, {
          ok: false,
          status: 'rate_limited',
          error: 'Rate limit exceeded: 1 reference-continuity request per 10 seconds.',
          retry_after_seconds: retryAfter
        }, 429);
      }
      clientRateLimit.set(`reference:${clientIp}`, now);

      const contractHeader = r.headers.get('X-BeatVision-Contract');
      if (contractHeader && contractHeader !== '1.1') {
        return json(r, { ok: false, error: 'Expected BeatVision contract 1.1.' }, 400);
      }

      const pixazoKey = String(env.PIXAZO_API_KEY || '').trim();
      if (!pixazoKey) {
        return json(r, { ok: false, error: 'Image provider is not configured on gateway.' }, 503);
      }

      let body: any = null;
      try { body = await r.json(); } catch { return json(r, { ok: false, error: 'Invalid JSON body.' }, 400); }
      if (body?.contract_version && body.contract_version !== '1.1') {
        return json(r, { ok: false, error: 'Expected BeatVision contract 1.1.' }, 400);
      }
      if (body?.operation && body.operation !== 'referenceContinuation') {
        return json(r, { ok: false, error: 'Invalid operation for reference-continuation endpoint.' }, 400);
      }
      body.contract_version = '1.1';
      body.operation = 'referenceContinuation';
      return arena.fetch(new Request(r.url, {
        method: 'POST',
        headers: new Headers(r.headers),
        body: JSON.stringify(body)
      }), env, ctx);
    }

    if (path === '/v1/client/image/scene') {
      if (r.method !== 'POST') {
        return json(r, { ok: false, error: 'Method Not Allowed. Client image endpoint requires POST.' }, 405);
      }

      const clientIp = r.headers.get('CF-Connecting-IP') || r.headers.get('X-Forwarded-For') || 'client';
      const now = Date.now();
      const lastRequest = clientRateLimit.get(clientIp) || 0;
      if (now - lastRequest < RATE_LIMIT_WINDOW_MS) {
        const retryAfter = Math.ceil((RATE_LIMIT_WINDOW_MS - (now - lastRequest)) / 1000);
        return json(r, {
          ok: false,
          status: 'rate_limited',
          error: 'Rate limit exceeded: 1 scene image request per 10 seconds.',
          retry_after_seconds: retryAfter
        }, 429);
      }
      clientRateLimit.set(clientIp, now);
      if (clientRateLimit.size > 2000) {
        for (const [k, v] of clientRateLimit.entries()) {
          if (now - v > RATE_LIMIT_WINDOW_MS * 2) clientRateLimit.delete(k);
        }
      }

      const contractHeader = r.headers.get('X-BeatVision-Contract');
      if (contractHeader && contractHeader !== '1.1') {
        return json(r, { ok: false, error: 'Expected BeatVision contract 1.1.' }, 400);
      }

      const pixazoKey = String(env.PIXAZO_API_KEY || '').trim();
      if (!pixazoKey) {
        return json(r, { ok: false, error: 'Image provider is not configured on gateway.' }, 503);
      }

      let body: any = null;
      try { body = await r.json(); } catch { return json(r, { ok: false, error: 'Invalid JSON body.' }, 400); }

      // Normalize if body provides scene directly
      if (body?.scene && !body?.payload?.storyboard?.scenes) {
        const sceneObj = {
          ...body.scene,
          scene: Number(body.scene.sceneNumber || body.scene.scene || 1),
          beatId: body.scene.id || body.scene.beatId || `scene-${body.scene.sceneNumber || 1}`
        };
        body = {
          contract_version: body.contract_version || '1.1',
          operation: 'sceneImages',
          payload: {
            style: body.style || body.scene?.visualLanguage || 'Dark industrial realism, cinematic lighting, coherent recurring character and environment.',
            world: body.world || {
              the_world: body.scene?.environment?.name || '',
              characters: body.scene?.characters || [],
              locations: body.scene?.environment ? [body.scene.environment] : []
            },
            storyboard: {
              scenes: [sceneObj]
            }
          }
        };
      }

      if (body?.contract_version && body.contract_version !== '1.1') {
        return json(r, { ok: false, error: 'Expected BeatVision contract 1.1.' }, 400);
      }
      body.contract_version = '1.1';

      if (body?.operation && body.operation !== 'sceneImages') {
        return json(r, { ok: false, error: 'Invalid operation for client image endpoint. Expected sceneImages.' }, 400);
      }
      body.operation = 'sceneImages';

      const payload = body?.payload;
      if (!payload || typeof payload !== 'object') {
        return json(r, { ok: false, error: 'Payload object is required.' }, 400);
      }

      const storyboard = payload?.storyboard;
      if (!storyboard || typeof storyboard !== 'object') {
        return json(r, { ok: false, error: 'Storyboard is required.' }, 400);
      }

      const scenes = Array.isArray(storyboard?.scenes) ? storyboard.scenes : Array.isArray(storyboard?.visual_beats) ? storyboard.visual_beats : [];
      if (!scenes.length) {
        return json(r, { ok: false, error: 'Storyboard contains no scenes.' }, 400);
      }
      if (scenes.length !== 1) {
        return json(r, { ok: false, error: 'Client scene endpoint allows exactly one scene per request.' }, 400);
      }

      // Deterministic integrity validation using existing validation functions
      const validation = validateStoryboard(storyboard, undefined, true);
      if (validation.issues.some((issue: any) => issue.severity === 'error')) {
        return json(r, {
          ok: false,
          contract_version: '1.1',
          status: 'storyboard_integrity_rejected',
          error: 'Storyboard failed deterministic integrity validation.',
          issues: validation.issues
        }, 422);
      }

      const requestId = r.headers.get('X-BeatVision-Request') || crypto.randomUUID();
      const forwardHeaders = new Headers(r.headers);
      forwardHeaders.set('X-BeatVision-Request', requestId);
      forwardHeaders.set('X-BeatVision-Contract', '1.1');
      const forwardReq = new Request(r.url, {
        method: 'POST',
        headers: forwardHeaders,
        body: JSON.stringify(body)
      });
      return arena.fetch(forwardReq, env, ctx);
    }

    if (path !== '/' && !token) {
      return json(r, { ok: false, error: 'Gateway authentication is not configured; refusing provider operation.' }, 503);
    }
    if (path !== '/' && path !== '/health' && !isGatewayAuthorized(r, env)) {
      return json(r, { ok: false, error: 'Unauthorized' }, 401);
    }

    // Gradio image-to-video status is a GET with no JSON body. Route it
    // before the legacy POST parser so polling never receives a false 400.
    if (path === '/v1/video/wan-zero' || path.startsWith('/v1/video/wan-zero/jobs/')) {
      return providerGateway.fetch(r, env);
    }

    // Persistent animation status is a GET with no JSON body. Route the job
    // endpoint before the generic POST/body validation in arena-entry so the
    // poll request cannot be rejected as an empty/invalid JSON request.
    if (path.startsWith('/v1/video/animate/jobs/')) {
      return providerGateway.fetch(r, env);
    }

    if (r.method === 'POST') {
      let body: any = null;
      try { body = await r.clone().json(); } catch { return json(r, { ok: false, error: 'Invalid JSON body.' }, 400); }
      const operation = String(body?.operation || '');
      const payload = body?.payload || {};
      const storyboard = payload?.storyboard;
      if (storyboard && ['sceneImages', 'assemble'].includes(operation)) {
        const target = Number(payload?.song_duration_seconds ?? payload?.songDuration ?? storyboard?.songDuration ?? storyboard?.song_duration ?? 0);
        const partial = operation === 'sceneImages';
        const validation = validateStoryboard(storyboard, target > 0 ? target : undefined, partial);
        const timeline = timelineGuardian(storyboard, partial ? undefined : (target > 0 ? target : undefined));
        const timelineIssues = partial ? [] : timeline.issues.map((message: string) => ({ code: 'TIMELINE_GUARDIAN', severity: 'error' as const, message }));
        const scenes = Array.isArray(storyboard?.scenes) ? storyboard.scenes : Array.isArray(storyboard?.visual_beats) ? storyboard.visual_beats : [];
        const reuseIssues = partial ? [] : detectVisualReuse(scenes)
          .filter(finding => !finding.intentional && finding.reason === 'semantic_similarity')
          .map(finding => ({
            code: 'VISUAL_REUSE',
            severity: 'error' as const,
            message: `Unapproved semantic visual reuse: ${finding.shot_id} resembles ${finding.compared_to} (${finding.score}).`
          }));
        const issues = [...validation.issues, ...timelineIssues, ...reuseIssues];
        if (issues.some(issue => issue.severity === 'error')) {
          return json(r, { ok: false, contract_version: body?.contract_version || '1.1', status: 'storyboard_integrity_rejected', error: 'Storyboard failed deterministic integrity validation.', issues }, 422);
        }
      }

      const mediaRecords = Array.isArray(payload?.media_records) ? payload.media_records : [];
      if (mediaRecords.length) {
        const mediaIssues = mediaRecords.flatMap((media: any, index: number) => {
          const result = validateMediaRecord(media);
          return result.errors.map((message: string) => ({ code: 'MEDIA_INTEGRITY', severity: 'error' as const, scene: index + 1, message }));
        });
        if (mediaIssues.length) {
          return json(r, { ok: false, contract_version: body?.contract_version || '1.1', status: 'media_integrity_rejected', error: 'Media records failed provenance validation.', issues: mediaIssues }, 422);
        }
      }
    }

    return arena.fetch(r, env, ctx);
  }
};
