import test from 'node:test';
import assert from 'node:assert/strict';
import { BEATVISION_BRIDGE_CONTRACT, beatVisionBridgeCapabilities, handleBeatVisionBridge } from './beatvision-bridge.ts';

test('BeatVision bridge advertises the free execution boundary', () => {
  assert.equal(BEATVISION_BRIDGE_CONTRACT, '2.0');
  const caps = beatVisionBridgeCapabilities({});
  assert.equal(caps.source_of_truth, 'beatvision');
  assert.equal(caps.cost_class, 'free');
  assert.deepEqual(caps.image.models, ['sdxl', 'flux-schnell', 'sdxl-turbo']);
  assert.deepEqual(caps.video.models, ['ltx-video']);
  assert.equal(caps.assembly.provider, 'shotstack-sandbox');
});

test('BeatVision bridge rejects an unlocked creative state before provider execution', async () => {
  const request = new Request('https://arena.example/v2/scene-image', {
    method: 'POST',
    headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      payload: {
        source: { application: 'beatvision', contract: '2.0' },
        project: { id: 'project-1' },
        song: { title: 'Test', duration_seconds: 30 },
        analysis: { analysis_method: 'browser_audio_decode' },
        world: { version: 'world-1' },
        vision_lock: { locked: false },
        scene: { id: 'scene-1', start_time: 0, end_time: 4 }
      }
    })
  });

  const response = await handleBeatVisionBridge(request, { GATEWAY_TOKEN: 'test-token' }, async () => {
    throw new Error('provider execution must not occur for invalid bridge input');
  });

  assert.ok(response);
  assert.equal(response.status, 422);
  const data = await response.json();
  assert.equal(data.status, 'contract_validation_failed');
  assert.match(data.errors.join(' '), /vision_lock\.locked/);
});


test('BeatVision assembly accepts the plan timeline without requiring a single scene', async () => {
  let forwarded = null;
  const request = new Request('https://arena.example/v2/assemble', {
    method: 'POST',
    headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      payload: {
        source: { application: 'beatvision', contract: '2.0' },
        project: { id: 'project-1' },
        song: { title: 'Test', duration_seconds: 8 },
        analysis: { analysis_method: 'browser_audio_decode' },
        world: { version: 'world-1' },
        style: { version: 'style-1' },
        vision_lock: { locked: true, version: 'lock-1' },
        assembly: {
          scenes: [
            { id: 'scene-1', start_time: 0, end_time: 4 },
            { id: 'scene-2', start_time: 4, end_time: 8 }
          ],
          images: [{ scene_id: 'scene-1', url: 'https://example.com/one.jpg' }],
          motion: [{ scene_id: 'scene-1', url: 'https://example.com/one.mp4' }]
        }
      }
    })
  });

  const response = await handleBeatVisionBridge(request, { GATEWAY_TOKEN: 'test-token' }, async (internal) => {
    forwarded = await internal.json();
    return new Response(JSON.stringify({ ok: true, status: 'completed' }), { status: 200 });
  });

  assert.ok(response);
  assert.equal(response.status, 200);
  assert.equal(forwarded.operation, 'assemble');
  assert.equal(forwarded.payload.storyboard.scenes.length, 2);
});
