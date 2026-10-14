import test from 'node:test';
import assert from 'node:assert/strict';
import worker from './arena-entry.ts';
import { handleBeatVisionBridge } from './beatvision-bridge.ts';
import { fetchReferenceImage, imageDimensions, normalizeReferences, REFERENCE_MODEL_ID, type SceneReference } from './scene-references.ts';

const TOKEN = 'test-gateway-token';
const SIGNED = 'https://mdofsinyofqbeapzfygu.supabase.co/storage/v1/object/sign/visual-assets/p1/char/a.png?token=SECRET-SIGNED-TOKEN';
const SIGNED2 = 'https://mdofsinyofqbeapzfygu.supabase.co/storage/v1/object/sign/visual-assets/p1/env/b.png?token=SECRET-SIGNED-TOKEN-2';
const DIRECTIVE = 'Character "Mara" must match the approved character sheet (appearance: silver buzzcut).';

function png(width: number, height: number, extra = 64) {
  const b = new Uint8Array(24 + extra); const dv = new DataView(b.buffer);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0); dv.setUint32(12, 0x49484452); dv.setUint32(16, width); dv.setUint32(20, height);
  return b;
}
const ref = (url = SIGNED): SceneReference => ({ kind: 'character', subject_id: 'c1', subject_name: 'Mara', asset_id: 'a1', label: 'front', image_url: url });

function bridgeRequest(extra: { references?: any; directives?: string[]; model?: string } = {}) {
  const scene: any = { id: 'scene-1', scene_number: 1, start_time: 0, end_time: 4, visual_direction: 'Mara walks the flooded depot' };
  if (extra.directives) scene.consistency_directives = extra.directives;
  return new Request('https://arena.example/v2/scene-image', {
    method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ payload: {
      source: { application: 'beatvision', contract: '2.0' }, project: { id: 'p1' },
      song: { title: 'T', duration_seconds: 30 }, analysis: { analysis_method: 'browser_audio_decode' },
      world: { version: 'w1' }, vision_lock: { locked: true, version: 'v1' }, scene,
      ...(extra.references !== undefined ? { references: extra.references } : {}),
      generation: { cost_class: 'free', model: extra.model || 'flux-schnell' },
    } }),
  });
}

async function run(req: Request, env: any, onFetch: (url: string, init?: any) => Response | Promise<Response>) {
  const original = globalThis.fetch; const urls: string[] = []; const pixazoBodies: any[] = []; let legacyBody: any;
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = String(input instanceof Request ? input.url : input); urls.push(url);
    if (url.endsWith('/flux-1-schnell/v1/getData')) { pixazoBodies.push(JSON.parse(init.body)); return new Response(JSON.stringify({ output: 'https://example.invalid/out.png' }), { status: 200 }); }
    return onFetch(url, init);
  }) as any;
  try {
    const res = await handleBeatVisionBridge(req, env, async (inner, innerEnv) => { legacyBody = await inner.clone().json(); return worker.fetch(inner, innerEnv); });
    const text = await res!.text();
    return { status: res!.status, text, data: JSON.parse(text), urls, pixazoBodies, legacyBody };
  } finally { globalThis.fetch = original; }
}
const noOther = (url: string) => { throw new Error(`unexpected fetch ${url}`); };
const refs = { characters: [{ id: 'c1', name: 'Mara', images: [{ asset_id: 'a1', label: 'front', image_url: SIGNED }] }], environments: [{ id: 'e1', name: 'Depot', images: [{ asset_id: 'a2', label: 'wide', image_url: SIGNED2 }] }] };

test('jobs without new fields behave exactly as before', async () => {
  const r = await run(bridgeRequest(), { GATEWAY_TOKEN: TOKEN, PIXAZO_API_KEY: 'k' }, noOther);
  assert.equal(r.status, 200);
  assert.equal(r.data.result.images[0].model, 'flux-1-schnell');
  assert.equal('references' in r.data.result.images[0], false);
  assert.equal('consistency_references' in r.data.bridge, false);
  assert.equal('consistency_references' in r.legacyBody.payload, false);
  assert.doesNotMatch(r.pixazoBodies[0].prompt, /CONSISTENCY DIRECTIVES/);
});

test('consistency_directives are always folded into the image prompt', async () => {
  const r = await run(bridgeRequest({ directives: [DIRECTIVE, '  '] }), { GATEWAY_TOKEN: TOKEN, PIXAZO_API_KEY: 'k' }, noOther);
  assert.equal(r.status, 200);
  assert.match(r.pixazoBodies[0].prompt, /CONSISTENCY DIRECTIVES[\s\S]*silver buzzcut/);
  assert.equal(r.data.bridge.consistency_directives_applied_to_prompt, true);
});

test('references without an enabled free conditioned model stay text-only and say so honestly', async () => {
  const r = await run(bridgeRequest({ references: refs, directives: [DIRECTIVE] }), { GATEWAY_TOKEN: TOKEN, PIXAZO_API_KEY: 'k', AI: { run: async () => { throw new Error('AI must not be called'); } } }, noOther);
  assert.equal(r.status, 200);
  assert.equal(r.data.result.images[0].model, 'flux-1-schnell');
  assert.equal(r.data.result.images[0].references.applied, false);
  assert.equal(r.data.result.images[0].references.reason, 'no_verified_free_conditioned_model_enabled');
  assert.deepEqual(r.data.bridge.consistency_references, { received: true, applied: false, model: null, reason: 'no_verified_free_conditioned_model_enabled', applied_count: 0 });
  assert.equal(r.urls.some(u => u.includes('supabase.co')), false, 'reference URLs must not be fetched when unused');
  assert.match(r.pixazoBodies[0].prompt, /silver buzzcut/);
  assert.doesNotMatch(r.text, /SECRET-SIGNED-TOKEN|supabase\.co/);
});

test('enabled conditioned model receives validated reference images and reports them', async () => {
  let aiModel = ''; let parts: string[] = []; let promptSent = '';
  const env = { GATEWAY_TOKEN: TOKEN, PIXAZO_API_KEY: 'k', CF_REFERENCE_IMAGE_MODEL_ENABLED: 'true', AI: { run: async (model: string, input: any) => {
    aiModel = model; const form = await new Response(input.multipart.body, { headers: { 'content-type': input.multipart.contentType } }).formData();
    parts = [...form.keys()]; promptSent = String(form.get('prompt')); return { image: 'aW1n' };
  } } };
  const fetchOpts: any[] = [];
  const r = await run(bridgeRequest({ references: refs, directives: [DIRECTIVE] }), env, (url, init) => { fetchOpts.push(init); return new Response(png(256, 256), { status: 200, headers: { 'content-type': 'image/png' } }); });
  assert.equal(r.status, 200);
  assert.equal(aiModel, REFERENCE_MODEL_ID);
  assert.deepEqual(parts.filter(p => p.startsWith('input_image_')), ['input_image_0', 'input_image_1']);
  assert.match(promptSent, /silver buzzcut/);
  assert.ok(fetchOpts.every(o => o.redirect === 'manual' && o.signal));
  assert.equal(r.pixazoBodies.length, 0);
  assert.equal(r.data.result.images[0].model, 'flux-2-klein-4b');
  assert.equal(r.data.bridge.consistency_references.applied, true);
  assert.equal(r.data.bridge.consistency_references.applied_count, 2);
  assert.doesNotMatch(r.text, /SECRET-SIGNED-TOKEN|supabase\.co/);
});

test('oversize references fall back to text-only and are recorded as not applied', async () => {
  const env = { GATEWAY_TOKEN: TOKEN, PIXAZO_API_KEY: 'k', CF_REFERENCE_IMAGE_MODEL_ENABLED: 'true', AI: { run: async () => { throw new Error('must not run'); } } };
  const r = await run(bridgeRequest({ references: refs }), env, () => new Response(png(1024, 1024), { status: 200, headers: { 'content-type': 'image/png' } }));
  assert.equal(r.data.result.images[0].model, 'flux-1-schnell');
  assert.equal(r.data.result.images[0].references.reason, 'no_usable_reference_images');
  assert.ok(r.data.result.images[0].references.skipped.every((s: any) => s.code === 'reference_dimensions_exceed_model_limit'));
  assert.equal(r.data.bridge.consistency_references.applied, false);
});

test('conditioned model failure falls back to text-only, never claiming references', async () => {
  const env = { GATEWAY_TOKEN: TOKEN, PIXAZO_API_KEY: 'k', CF_REFERENCE_IMAGE_MODEL_ENABLED: 'true', AI: { run: async () => { throw new Error(`boom ${SIGNED}`); } } };
  const r = await run(bridgeRequest({ references: refs }), env, () => new Response(png(200, 200), { status: 200, headers: { 'content-type': 'image/png' } }));
  assert.equal(r.data.result.images[0].model, 'flux-1-schnell');
  assert.equal(r.data.bridge.consistency_references.reason, 'reference_model_failed');
  assert.doesNotMatch(r.text, /SECRET-SIGNED-TOKEN/);
});

test('free image allowlist unchanged: conditioned model cannot be requested directly', async () => {
  const r = await run(bridgeRequest({ references: refs, model: 'flux-2-klein-4b' }), { GATEWAY_TOKEN: TOKEN, PIXAZO_API_KEY: 'k' }, noOther);
  assert.equal(r.status, 422);
  assert.equal(r.data.status, 'paid_or_unknown_model_rejected');
  assert.deepEqual(r.data.allowed_models, ['flux-schnell']);
});

test('reference URL normalization drops off-host and unsigned URLs', () => {
  const { refs: out, rejected } = normalizeReferences({ characters: [{ id: 'c', name: 'n', images: [
    { asset_id: '1', image_url: SIGNED }, { asset_id: '2', image_url: 'https://evil.example/x.png?token=a' },
    { asset_id: '3', image_url: SIGNED.replace(/\?token=.*/, '') }, { asset_id: '4', image_url: SIGNED.replace('https:', 'http:') },
  ] }], environments: 'bad' });
  assert.equal(out.length, 1); assert.equal(rejected, 2); // 4th dropped by per-subject cap of 3
});

test('fetchReferenceImage enforces redirect, content-type, size and timeout limits', async () => {
  const f = (res: Response) => (async () => res) as any;
  assert.deepEqual(await fetchReferenceImage(ref(), f(new Response(null, { status: 302, headers: { location: 'https://x' } }))), { ok: false, code: 'reference_redirect_rejected' });
  assert.deepEqual(await fetchReferenceImage(ref(), f(new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } }))), { ok: false, code: 'reference_content_type_rejected' });
  assert.deepEqual(await fetchReferenceImage(ref(), f(new Response(new Uint8Array(5 * 1024 * 1024), { status: 200, headers: { 'content-type': 'image/png' } }))), { ok: false, code: 'reference_too_large' });
  assert.deepEqual(await fetchReferenceImage(ref(), f(new Response('x', { status: 403, headers: { 'content-type': 'image/png' } }))), { ok: false, code: 'reference_http_403' });
  assert.deepEqual(await fetchReferenceImage(ref('https://evil.example/a.png?token=x'), f(new Response(png(10, 10)))), { ok: false, code: 'reference_url_rejected' });
  const hang = ((_u: string, init: any) => new Promise((_r, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))))) as any;
  assert.deepEqual(await fetchReferenceImage(ref(), hang, 20), { ok: false, code: 'reference_fetch_timeout' });
  const ok = await fetchReferenceImage(ref(), f(new Response(png(512, 300), { status: 200, headers: { 'content-type': 'image/png' } })));
  assert.equal(ok.ok, true);
});

test('imageDimensions parses PNG and JPEG headers', () => {
  assert.deepEqual(imageDimensions(png(320, 200), 'image/png'), { width: 320, height: 200 });
  const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0, 0, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0x2c, 0x01, 0x90, 0x03, 0, 0, 0]);
  assert.deepEqual(imageDimensions(jpg, 'image/jpeg'), { width: 400, height: 300 });
  assert.equal(imageDimensions(new Uint8Array(30), 'image/png'), null);
});
