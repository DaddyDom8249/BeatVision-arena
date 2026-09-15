import arena from './arena-entry';
import { validateStoryboard } from './storyboard-validator';

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

    // Provider operations are fail-closed. A missing secret must never silently
    // turn a protected gateway into a public provider proxy.
    if (path !== '/' && path !== '/health' && !token) {
      return json(r, { ok: false, error: 'Gateway authentication is not configured; refusing provider operation.' }, 503);
    }
    if (path !== '/' && path !== '/health' && r.headers.get('Authorization') !== `Bearer ${token}`) {
      return json(r, { ok: false, error: 'Unauthorized' }, 401);
    }

    if (r.method === 'POST') {
      let body: any = null;
      try { body = await r.clone().json(); } catch { return json(r, { ok: false, error: 'Invalid JSON body.' }, 400); }
      const operation = String(body?.operation || '');
      const payload = body?.payload || {};
      const storyboard = payload?.storyboard;
      if (storyboard && ['sceneImages', 'assemble'].includes(operation)) {
        const target = Number(payload?.song_duration_seconds ?? payload?.songDuration ?? storyboard?.songDuration ?? storyboard?.song_duration ?? 0);
        const validation = validateStoryboard(storyboard, target > 0 ? target : undefined);
        if (!validation.ok) {
          return json(r, {
            ok: false,
            contract_version: body?.contract_version || '1.1',
            status: 'storyboard_integrity_rejected',
            error: 'Storyboard failed deterministic integrity validation.',
            issues: validation.issues
          }, 422);
        }
      }
    }

    return arena.fetch(r, env, ctx);
  }
};
