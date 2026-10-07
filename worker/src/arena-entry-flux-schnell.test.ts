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
        headers: { 'Content-Type': 'application/json' },
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
      { PIXAZO_API_KEY: 'test-key' }
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
        headers: { 'Content-Type': 'application/json' },
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
