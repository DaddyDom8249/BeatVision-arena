import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import worker from './arena-entry.ts';

test('BeatVision scene-image route executes Flux Schnell only', async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push(url);

    if (url.endsWith('/flux-1-schnell/v1/getData')) {
      return new Response(JSON.stringify({ requestId: 'flux-test-1' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (url.endsWith('/flux-1-schnell/v1/checkStatus')) {
      return new Response(JSON.stringify({
        status: 'completed',
        output: 'https://example.invalid/flux-test.png'
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    throw new Error(`Unexpected provider endpoint: ${url}`);
  };

  try {
    const response = await worker.fetch(
      new Request('https://arena.example/v1/client/image/scene', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-gateway-token' },
        body: JSON.stringify({
          contract_version: '1.1',
          operation: 'sceneImages',
          payload: {
            style: 'test',
            world: {},
            storyboard: {
              scenes: [{
                scene: 1,
                beatId: 'beat-1',
                direction: 'test scene',
                startTime: 0,
                endTime: 4
              }]
            }
          }
        })
      }),
      { PIXAZO_API_KEY: 'test-key', GATEWAY_TOKEN: 'test-gateway-token' }
    );

    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.ok, true);
    assert.equal(data.result.images[0].model, 'flux-1-schnell');

    assert.deepEqual(calls.map(url => new URL(url).pathname), [
      '/flux-1-schnell/v1/getData',
      '/flux-1-schnell/v1/checkStatus'
    ]);
    assert.equal(calls.some(url => url.includes('/getImage/v1/getSDXLImage')), false);
    assert.equal(calls.some(url => url.includes('/sdxlTurbo/v2/getData')), false);
    assert.equal(calls.some(url => url.includes('/v2/requests/status/')), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test('BeatVision scene-image route falls back to Cloudflare Workers AI on Pixazo balance failure', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.endsWith('/flux-1-schnell/v1/getData')) {
      return new Response(JSON.stringify({ error: 'Insufficient Balance', message: 'The balance is insufficient to proceed with this operation.' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    throw new Error(`Unexpected Pixazo endpoint after fallback trigger: ${url}`);
  };

  try {
    const response = await worker.fetch(
      new Request('https://arena.example/v1/client/image/scene', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-gateway-token' },
        body: JSON.stringify({
          contract_version: '1.1',
          operation: 'sceneImages',
          payload: {
            style: 'test',
            world: {},
            storyboard: {
              scenes: [{ scene: 1, beatId: 'beat-fallback', direction: 'test scene', startTime: 0, endTime: 4 }]
            }
          }
        })
      }),
      {
        PIXAZO_API_KEY: 'test-key',
        GATEWAY_TOKEN: 'test-gateway-token',
        AI: {
          run: async (model: string, input: any) => {
            assert.equal(model, '@cf/black-forest-labs/flux-1-schnell');
            assert.equal(input.steps, 4);
            return { image: 'ZmFrZS1pbWFnZS1ieXRlcw==' };
          }
        }
      }
    );

    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.ok, true);
    assert.equal(data.result.images[0].provider, 'cloudflare-workers-ai');
    assert.equal(data.result.images[0].fallback_used, true);
    assert.equal(data.result.images[0].image_base64, 'ZmFrZS1pbWFnZS1ieXRlcw==');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('BeatVision images use only the confirmed free Cloudflare binding, never Pixazo', async () => {
  const originalFetch = globalThis.fetch;
  let outsideRequests = 0;
  globalThis.fetch = async () => { outsideRequests += 1; throw Error('NO_EXTERNAL_PAID_REQUESTS'); };
  const runs: Array<{ model: string; options: any }> = [];
  const payload = {
    contract_version: '1.1',
    operation: 'sceneImages',
    payload: {
      generation: { source: 'beatvision', cost_class: 'free', requested_model: 'flux-schnell' },
      style: 'cinematic', world: {},
      storyboard: { scenes: [{ scene: 1, beatId: 'scene-1', direction: 'foggy walkway', startTime: 0, endTime: 3 }] }
    }
  };
  try {
    const response = await worker.fetch(new Request('https://arena.example/v1/client/image/scene', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-gateway-token' },
      body: JSON.stringify(payload)
    }), {
      PIXAZO_API_KEY: 'configured-but-must-not-be-used',
      GATEWAY_TOKEN: 'test-gateway-token',
      BEATVISION_FREE_WORKERS_AI_CONFIRMED: 'true',
      AI: { run: async (model: string, options: any) => {
        runs.push({ model, options }); return { image: 'ZmFrZS1pbWFnZQ==' };
      } }
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.result.free_only, true);
    assert.deepEqual(body.result.provider_path, ['cloudflare-workers-ai']);
    assert.equal(body.result.images[0].model, 'flux-1-schnell');
    assert.equal(runs.length, 1);
    assert.equal(runs[0].model, '@cf/black-forest-labs/flux-1-schnell');
    assert.equal(runs[0].options.steps, 4);
    assert.equal(outsideRequests, 0, 'no Pixazo or other external provider was contacted');
  } finally { globalThis.fetch = originalFetch; }
});

test('unconfirmed Workers Free entitlement refuses BeatVision images before contacting any provider', async () => {
  let calls = 0;
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => { calls++; throw Error('NO_PAID_FALLBACK'); };
  try {
    const payload = { contract_version: '1.1', operation: 'sceneImages',
      payload: { generation: { source: 'beatvision', cost_class: 'free' },
        storyboard: { scenes: [{ scene: 1, direction: 'shadowy warehouse' }] } } };
    for (const flag of ['false', undefined]) {
      const response = await worker.fetch(new Request('https://arena.example/v1/client/image/scene', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer fixture-gateway' },
        body: JSON.stringify(payload)
      }), { GATEWAY_TOKEN: 'fixture-gateway', PIXAZO_API_KEY: 'present-but-denied',
        BEATVISION_FREE_WORKERS_AI_CONFIRMED: flag, AI: { run: async () => { calls++; throw Error('MUST_NOT_RUN'); } } });
      assert.equal(response.status, 503);
      const result = await response.json();
      assert.equal(result.code, 'PROVIDER_COST_UNVERIFIED');
      assert.equal(calls, 0);
    }
  } finally { globalThis.fetch = oldFetch; }
});

test('Wrangler deploys preserve the confirmed free Workers AI gate', () => {
  const config = readFileSync(existsSync('worker/wrangler.toml') ? 'worker/wrangler.toml' : 'wrangler.toml', 'utf8');
  assert.match(config, /^BEATVISION_FREE_WORKERS_AI_CONFIRMED = "true"$/m);
  assert.match(config, /^\[ai\]$/m);
  assert.match(config, /^binding = "AI"$/m);
});
