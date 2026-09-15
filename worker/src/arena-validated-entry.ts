import arena from './arena-entry';
import { validateStoryboard } from './storyboard-validator';
import { timelineGuardian, validateMediaRecord } from './skills';

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
        const timeline = timelineGuardian(storyboard, target > 0 ? target : undefined);
        const timelineIssues = timeline.issues.map((message: string) => ({ code: 'TIMELINE_GUARDIAN', severity: 'error' as const, message }));
        const issues = [...validation.issues, ...timelineIssues];
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
