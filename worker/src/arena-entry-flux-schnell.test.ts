import test from 'node:test';
import assert from 'node:assert/strict';
import worker from './arena-entry.ts';

test('BeatVision scene-image route walks the confirmed free image fallback pool', async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  let fluxAttempts = 0;

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push(url);

    if (url.endsWith('/flux-1-schnell/v1/getData')) {
      fluxAttempts += 1;
      return new Response(JSON.stringify({ error: 'The balance is insufficient to proceed with this operation.' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (url.endsWith('/sd3-5/v1/r-sd-3-5-large')) {
      return new Response(JSON.stringify({ error: 'The balance is insufficient to proceed with this operation.' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    if (url.endsWith('/getImage/v1/getSDXLImage')) {
      return new Response(JSON.stringify({ error: 'The balance is insufficient to proceed with this operation.' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (url.endsWith('/inpainting/v1/getImage')) {
      return new Response(JSON.stringify({ error: 'The balance is insufficient to proceed with this operation.' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    if (url.endsWith('/sdxl_lightning/getImage/v1/getSDXLImage')) {
      return new Response(JSON.stringify({ error: 'The balance is insufficient to proceed with this operation.' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (url.endsWith('/pixelforge-image/v1/qwen_image_gen/serve_image')) {
      return new Response(JSON.stringify({
        output: {
          choices: [{
            message: {
              content: [{ image: 'https://example.invalid/pixelforge-fallback.png' }]
            }
          }]
        }
      }), {
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
    assert.equal(data.result.images[0].model, 'pixelforge-1');
    assert.equal(data.result.free_only, true);
    assert.deepEqual(data.result.models_used, ['pixelforge-1']);
    assert.equal(fluxAttempts, 1);

    assert.deepEqual(calls.map(url => new URL(url).pathname), [
      '/flux-1-schnell/v1/getData',
      '/sd3-5/v1/r-sd-3-5-large',
      '/getImage/v1/getSDXLImage',
      '/sdxl_lightning/getImage/v1/getSDXLImage',
      '/inpainting/v1/getImage',
      '/pixelforge-image/v1/qwen_image_gen/serve_image'
    ]);
    assert.equal(calls.some(url => url.includes('/sdxlTurbo/v2/getData')), false);
    assert.equal(calls.some(url => url.includes('/v2/requests/status/')), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
