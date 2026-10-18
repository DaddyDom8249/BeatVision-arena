import test from 'node:test';
import assert from 'node:assert/strict';
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


import { handleBeatVisionBridge } from './beatvision-bridge.ts';

function beatvisionImageRequest() {
  return new Request('https://arena.example/v2/scene-image', {
    method: 'POST',
    headers: { Authorization: 'Bearer test-gateway-token', 'Content-Type': 'application/json' },
    body: JSON.stringify({ payload: {
      source: { application: 'beatvision', contract: '2.0' },
      project: { id: 'proj-test' },
      song: { title: 'Test song', duration_seconds: 10 },
      analysis: { analysis_method: 'browser_audio_decode' },
      world: { version: 'world-1' },
      style: { version: 'style-1' },
      vision_lock: { locked: true, version: 'lock-1' },
      scene: { id: 'scene-1', scene_number: 1, start_time: 0, end_time: 4 },
      generation: { cost_class: 'free', model: 'flux-schnell' }
    } })
  });
}

test('canonical BeatVision image refuses any provider when Workers Free entitlement is unverified', async () => {
  let calls = 0;
  const env = {
    GATEWAY_TOKEN: 'test-gateway-token',
    PIXAZO_API_KEY: 'pixazo-must-not-be-used',
    AI: { run: async () => { calls++; throw new Error('must not call AI'); } }
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { calls++; throw new Error('must not contact Pixazo'); };
  try {
    const response = await handleBeatVisionBridge(beatvisionImageRequest(), env, (request, e) => worker.fetch(request, e));
    assert.equal(response?.status, 503);
    const result = await response!.json();
    assert.equal(result.code, 'PROVIDER_COST_UNVERIFIED');
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('certified canonical BeatVision image only uses the Cloudflare Flux Schnell binding, never Pixazo', async () => {
  let upstreamCalls = 0, aiCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { upstreamCalls++; throw new Error('Pixazo should never be invoked'); };
  try {
    const env = {
      GATEWAY_TOKEN: 'test-gateway-token',
      PIXAZO_API_KEY: 'pixazo-must-not-be-used',
      BEATVISION_FREE_WORKERS_AI_CONFIRMED: 'true',
      AI: { run: async (model: string, inputs: any) => {
        aiCalls++;
        assert.equal(model, '@cf/black-forest-labs/flux-1-schnell');
        assert.equal(inputs.steps, 4);
        return { image: 'ZmFrZS1tb2NrLWJ5dGVz' };
      } }
    };
    const response = await handleBeatVisionBridge(beatvisionImageRequest(), env, (request, e) => worker.fetch(request, e));
    assert.equal(response?.status, 200);
    const result = await response!.json();
    assert.equal(result.result.images[0].provider, 'cloudflare-workers-ai');
    assert.equal(result.result.images[0].image_base64, 'ZmFrZS1tb2NrLWJ5dGVz');
    assert.equal(aiCalls, 1);
    assert.equal(upstreamCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
