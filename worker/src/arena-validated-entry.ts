import arena from './arena-entry.ts';
import providerGateway from './video-fallback-gateway.ts';
import { BeatVisionAnimationJob } from './animation-jobs.ts';
export { BeatVisionAnimationJob } from './animation-jobs.ts';
import { validateStoryboard } from './storyboard-validator.ts';
import { timelineGuardian, validateMediaRecord } from './skills.ts';
import { detectVisualReuse } from './visual-reuse-detector.ts';

const clientRateLimit = new Map<string, number>();
const RATE_LIMIT_WINDOW_MS = 10000; // 10 seconds per client IP

const json = (r: Request, data: unknown, status = 200) => new Response(JSON.stringify(data, null, 2), {
  status,
  headers: {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': r.headers.get('Origin') || 'https://daddydom8249.github.io',
    'Access-Control-Allow-Headers': 'Content-Type,X-BeatVision-Contract,Authorization,X-BeatVision-Request'
  }
});

export default {
  async fetch(r: Request, env: any, ctx: ExecutionContext) {
    if (r.method === 'OPTIONS') return arena.fetch(r, env, ctx);
    const token = String(env.GATEWAY_TOKEN || '').trim();
    const path = new URL(r.url).pathname;

    if (path === '/health') {
      return json(r, {
        ok: true,
        service: 'beatvision-provider-arena',
        entrypoint: 'arena-validated-entry',
        contract_version: '1.1',
        configuration: {
          gateway_token: Boolean(token),
          pixazo_api_key: Boolean(String(env.PIXAZO_API_KEY || '').trim()),
          language_provider_token: Boolean(String(env.LANGUAGE_PROVIDER_TOKEN || '').trim()),
          shotstack_api_key: Boolean(String(env.SHOTSTACK_API_KEY || '').trim()),
        },
      });
    }

    // Narrow client image endpoint: allows single scene generation without exposing master GATEWAY_TOKEN
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
    if (path !== '/' && path !== '/health' && r.headers.get('Authorization') !== `Bearer ${token}`) {
      return json(r, { ok: false, error: 'Unauthorized' }, 401);
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
