const PIXAZO_LTX = 'https://gateway.pixazo.ai/ltx/image-to-video';
const PIXAZO_STATUS = 'https://gateway.pixazo.ai/v2/requests/status/';

function cors(r: Request, e: any) {
  const o = r.headers.get('Origin') || '';
  const allowed = String(e.ALLOWED_ORIGIN || '').split(',').map((x: string) => x.trim()).filter(Boolean);
  return {
    'Access-Control-Allow-Origin': o && (!allowed.length || allowed.includes(o)) ? o : (allowed[0] || '*'),
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,X-BeatVision-Contract,Authorization,X-BeatVision-Request',
    'Access-Control-Max-Age': '86400'
  };
}

function json(r: Request, e: any, d: unknown, status = 200) {
  return new Response(JSON.stringify(d, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors(r, e) }
  });
}

function auth(r: Request, e: any) {
  return !e.GATEWAY_TOKEN || r.headers.get('Authorization') === `Bearer ${e.GATEWAY_TOKEN}`;
}

function firstImage(payload: any) {
  const imgs = payload?.images?.images || payload?.images || [];
  const item = Array.isArray(imgs) ? imgs[0] : imgs;
  return item?.image_url || item?.url || item?.data_url || null;
}

function promptFor(payload: any) {
  const scene = payload?.storyboard?.scenes?.[0] || {};
  return [
    'Animate this BeatVision approved scene into a cinematic music-video shot.',
    `Style: ${String(payload?.style || '').slice(0, 900)}`,
    `World: ${String(payload?.world?.logline || '').slice(0, 1200)}`,
    `Scene: ${String(scene.visual_direction || scene.description || '').slice(0, 1600)}`,
    'Preserve the supplied composition, characters, identity, environment and continuity. Use subtle natural motion and cinematic camera movement. Do not redesign the scene.'
  ].join('\n');
}

async function waitForResult(r: Request, e: any, apiKey: string, requestId: string, started: number) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const response = await fetch(`${PIXAZO_STATUS}${encodeURIComponent(requestId)}`, {
      headers: { 'Ocp-Apim-Subscription-Key': apiKey, 'Accept': 'application/json' }
    });
    const text = await response.text();
    let data: any;
    try { data = JSON.parse(text); } catch { data = {}; }
    if (!response.ok) throw new Error(`Pixazo status ${response.status}: ${text.slice(0, 1500)}`);
    const status = String(data?.status || '').toUpperCase();
    if (status === 'COMPLETED') {
      const url = Array.isArray(data?.output?.media_url) ? data.output.media_url[0] : data?.output?.media_url;
      if (!url) throw new Error('Pixazo completed without a media URL.');
      return json(r, e, {
        ok: true,
        contract_version: '1.1',
        capability: 'video',
        provider: 'pixazo',
        model: 'ltx',
        status: 'animated',
        delivery: 'temporary_url',
        persistent_storage: false,
        latency_ms: Date.now() - started,
        request_id: r.headers.get('X-BeatVision-Request') || requestId,
        result: { status: 'animated', video_url: url, source: 'Pixazo free LTX image-to-video', pixazo_request_id: requestId }
      });
    }
    if (['ERROR', 'FAILED', 'CANCELLED'].includes(status)) throw new Error(`Pixazo LTX job ${status}: ${String(data?.error || 'unknown error').slice(0, 1600)}`);
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
  return json(r, e, {
    ok: true,
    contract_version: '1.1',
    capability: 'video',
    provider: 'pixazo',
    model: 'ltx',
    status: 'queued',
    delivery: 'request_id',
    request_id: r.headers.get('X-BeatVision-Request') || requestId,
    result: { status: 'queued', pixazo_request_id: requestId, polling_url: `${PIXAZO_STATUS}${encodeURIComponent(requestId)}`, message: 'Pixazo is still processing the free LTX job.' }
  });
}

export default {
  async fetch(r: Request, e: any) {
    if (r.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(r, e) });
    const id = r.headers.get('X-BeatVision-Request') || crypto.randomUUID();
    if (!auth(r, e)) return json(r, e, { ok: false, error: 'Unauthorized', request_id: id }, 401);
    if (r.method !== 'POST') return json(r, e, { ok: false, error: 'POST required', request_id: id }, 405);
    const apiKey = e.PIXAZO_API_KEY;
    if (!apiKey) return json(r, e, { ok: false, contract_version: '1.1', capability: 'video', provider: 'pixazo', model: 'ltx', status: 'provider_unavailable', request_id: id, error: 'Pixazo free LTX is not configured. Configure PIXAZO_API_KEY as a Worker secret.' }, 503);

    let body: any;
    try { body = await r.json(); } catch { return json(r, e, { ok: false, error: 'Invalid JSON body', request_id: id }, 400); }
    if (body?.contract_version !== '1.1' || body?.operation !== 'animate') return json(r, e, { ok: false, error: 'Expected BeatVision contract 1.1 animate operation.', request_id: id }, 400);
    const payload = body.payload || {};
    const imageUrl = firstImage(payload);
    if (!imageUrl || !/^https?:\/\//i.test(imageUrl)) return json(r, e, { ok: false, contract_version: '1.1', capability: 'video', provider: 'pixazo', status: 'invalid_input', request_id: id, error: 'Pixazo free LTX requires the approved scene image to be available at a public HTTPS URL.' }, 400);

    const started = Date.now();
    try {
      const response = await fetch(PIXAZO_LTX, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Ocp-Apim-Subscription-Key': apiKey },
        body: JSON.stringify({
          prompt: promptFor(payload),
          image_url: imageUrl,
          resolution: e.PIXAZO_LTX_RESOLUTION || '720p',
          duration: Number(e.PIXAZO_LTX_DURATION || 5),
          fps: Number(e.PIXAZO_LTX_FPS || 25),
          aspect_ratio: '16:9'
        })
      });
      const text = await response.text();
      let data: any;
      try { data = JSON.parse(text); } catch { data = {}; }
      if (!response.ok) throw new Error(`Pixazo ${response.status}: ${String(data?.error || text).slice(0, 1800)}`);
      const requestId = data?.request_id;
      if (!requestId) throw new Error('Pixazo LTX did not return a request_id.');
      return waitForResult(r, e, apiKey, requestId, started);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return json(r, e, { ok: false, contract_version: '1.1', capability: 'video', provider: 'pixazo', model: 'ltx', status: 'provider_error', request_id: id, latency_ms: Date.now() - started, error: msg.slice(0, 2000) }, 502);
    }
  }
};
