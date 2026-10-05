import test from 'node:test';
import assert from 'node:assert/strict';
import worker from './arena-entry.ts';

test('BeatVision scene-image route prefers Flux Schnell and falls back to free SDXL', async () => {
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

    if (url.endsWith('/getImage/v1/getSDXLImage')) {
      return new Response(JSON.stringify({ output: 'https://example.invalid/sdxl-fallback.png' }), {
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
    assert.equal(data.result.images[0].model, 'sdxl');
    assert.equal(data.result.free_only, true);
    assert.deepEqual(data.result.models_used, ['sdxl']);
    assert.equal(fluxAttempts, 1);

    assert.deepEqual(calls.map(url => new URL(url).pathname), [
      '/flux-1-schnell/v1/getData',
      '/getImage/v1/getSDXLImage'
    ]);
    assert.equal(calls.some(url => url.includes('/sdxlTurbo/v2/getData')), false);
    assert.equal(calls.some(url => url.includes('/v2/requests/status/')), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
