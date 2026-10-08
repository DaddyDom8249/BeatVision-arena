import pixazo from './pixazo-media-gateway-fixed';

const RETRYABLE = /prompt not found|provider ended this request without producing output|job ERROR|502|503|504|temporarily unavailable|rate limit|too many requests/i;
const PIXAZO_UNAVAILABLE = /Pixazo ltx-video (?:402|403)|Add a card to use your monthly Pixazo Free Tier|insufficient balance|balance is insufficient/i;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function proceduralMotion(body: any, e: any, requestId: string) {
  const key = String(e.SHOTSTACK_API_KEY || '').trim();
  if (!key) throw new Error('Shotstack procedural motion fallback is not configured.');
  const payload = body?.payload || {};
  const items = Array.isArray(payload?.images?.images) ? payload.images.images : [];
  const scenes = Array.isArray(payload?.storyboard?.scenes) ? payload.storyboard.scenes : [];
  if (!items.length) throw new Error('No approved scene images were supplied for procedural motion fallback.');
  const effects = ['zoomInSlow','zoomOutSlow','slideLeftSlow','slideRightSlow','slideUpSlow','slideDownSlow'];
  const clips: any[] = [];
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    const sceneNumber = Number(item?.scene || scenes[i]?.scene || i + 1);
    const scene = scenes.find((x: any) => Number(x?.scene) === sceneNumber) || scenes[i];
    const source = String(item?.image_url || item?.url || item?.data_url || '');
    if (!/^https?:\/\//i.test(source)) throw new Error('Procedural motion requires an HTTPS scene-image URL.');
    const duration = Math.max(3, Number(scene?.duration_seconds) || 4);
    const effect = effects[Math.max(0, sceneNumber - 1) % effects.length];
    const edit = { timeline: { tracks: [{ clips: [{ asset: { type: 'image', src: source }, start: 0, length: duration, fit: 'crop', effect }] }] }, output: { format: 'mp4', resolution: 'hd', aspectRatio: '16:9', fps: 25 } };
    const submit = await fetch('https://api.shotstack.io/edit/stage/render', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': key, Accept: 'application/json' }, body: JSON.stringify(edit) });
    const text = await submit.text();
    let data: any; try { data = JSON.parse(text); } catch { data = { raw: text }; }
    if (!submit.ok) throw new Error('Shotstack procedural motion ' + submit.status + ': ' + String(data?.response?.error || data?.error || data?.message || text).slice(0, 1600));
    const renderId = String(data?.response?.id || data?.data?.id || '').trim();
    if (!renderId) throw new Error('Shotstack procedural motion returned no render ID.');
    const deadline = Date.now() + 180000;
    let result: any = null;
    while (Date.now() < deadline) {
      const statusResponse = await fetch('https://api.shotstack.io/edit/stage/render/' + encodeURIComponent(renderId), { headers: { 'x-api-key': key, Accept: 'application/json' } });
      const statusText = await statusResponse.text();
      try { result = JSON.parse(statusText)?.response || JSON.parse(statusText)?.data || {}; } catch { result = {}; }
      const status = String(result?.status || '').toLowerCase();
      if (status === 'done') break;
      if (status === 'failed' || status === 'error') throw new Error('Shotstack procedural motion render ' + status + ': ' + String(result?.error || status).slice(0, 1600));
      await sleep(5000);
    }
    const url = String(result?.url || '').trim();
    const actual = Number(result?.duration || duration);
    if (!/^https?:\/\//i.test(url)) throw new Error('Shotstack procedural motion completed without a video URL.');
    if (!(actual > 0) || Math.abs(actual - duration) > 0.35) throw new Error('Shotstack procedural motion duration mismatch.');
    clips.push({ scene: sceneNumber, status: 'animated', video_url: url, source: 'Shotstack procedural image motion fallback', provider: 'shotstack', model: 'image-motion', generation_type: 'PROCEDURAL_MOTION', duration_seconds: actual, requested_duration_seconds: duration, asset_id: 'motion:' + requestId + ':scene:' + sceneNumber + ':shotstack:' + renderId, shotstack_render_id: renderId, effect });
  }
  return clips;
}

async function fetchWithMotionRetry(r: Request, e: any) {
  const body = await r.clone().text();
  let last: Response | null = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const headers = new Headers(r.headers);
    headers.set('X-BeatVision-Request', crypto.randomUUID());
    const attemptRequest = new Request(r.url, { method: 'POST', headers, body });
    last = await pixazo.fetch(attemptRequest, e);
    const text = await last.clone().text();
    if (PIXAZO_UNAVAILABLE.test(text)) {
      try {
        const parsed = JSON.parse(body);
        const clips = await proceduralMotion(parsed, e, headers.get('X-BeatVision-Request') || crypto.randomUUID());
        return new Response(JSON.stringify({ ok: true, contract_version: '1.1', capability: 'video', provider: 'shotstack', model: 'image-motion', status: 'animated', request_id: headers.get('X-BeatVision-Request'), result: { status: 'animated', clips, video_url: clips[0]?.video_url || null, source: 'Shotstack procedural image motion fallback', models_used: ['image-motion'], scene_count: clips.length, generation_type: 'PROCEDURAL_MOTION', fallback_used: true, provider_path: ['pixazo', 'shotstack'] } }, null, 2), { status: 200, headers: { 'Content-Type': 'application/json' } });
      } catch (fallbackError) {
        return new Response(JSON.stringify({ ok: false, contract_version: '1.1', capability: 'video', provider: 'shotstack', model: 'image-motion', status: 'provider_error', request_id: headers.get('X-BeatVision-Request'), error: String(fallbackError instanceof Error ? fallbackError.message : fallbackError).slice(0, 2000) }), { status: 502, headers: { 'Content-Type': 'application/json' } });
      }
    }
    if (last.status < 500) return last;
    if (!RETRYABLE.test(text) || attempt === 3) return last;
    await sleep(1500 * attempt);
  }
  return last as Response;
}

export default {
  async fetch(r: Request, e: any) {
    const path = new URL(r.url).pathname;
    if (path !== '/v1/video/animate' || r.method !== 'POST') return pixazo.fetch(r, e);
    return fetchWithMotionRetry(r, e);
  }
};
