import test from 'node:test';
import assert from 'node:assert/strict';
import { BeatVisionAnimationJob } from './animation-jobs.ts';

test('motion job accepts a real Shotstack source and completed video URL', async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith('/edit/stage/render')) {
      return Response.json({ response: { id: 'render-test' } });
    }
    return Response.json({ response: { status: 'done', url: 'https://example.invalid/motion.mp4', duration: 4 } });
  };
  try {
    const job = new BeatVisionAnimationJob({} as DurableObjectState, { SHOTSTACK_API_KEY: 'test-only' });
    const result = await job.renderShotstackMotion('https://example.invalid/image.png', 4, 1);
    assert.equal(result.video_url, 'https://example.invalid/motion.mp4');
    assert.equal(result.generation_type, 'PROCEDURAL_MOTION');
    assert.deepEqual(calls, [
      'https://api.shotstack.io/edit/stage/render',
      'https://api.shotstack.io/edit/stage/render/render-test',
    ]);
  } finally { globalThis.fetch = originalFetch; }
});

test('invalid source is rejected before any Shotstack request', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('Unexpected provider call'); };
  try {
    const job = new BeatVisionAnimationJob({} as DurableObjectState, { SHOTSTACK_API_KEY: 'test-only' });
    await assert.rejects(job.renderShotstackMotion('data:image/png;base64,dGVzdA==', 4, 1), /requires an HTTPS source image/);
    assert.equal(calls, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test('a completed render without a valid video URL is rejected', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL) => String(input).endsWith('/edit/stage/render')
    ? Response.json({ response: { id: 'render-test' } })
    : Response.json({ response: { status: 'done', url: 'not-a-video-url', duration: 4 } });
  try {
    const job = new BeatVisionAnimationJob({} as DurableObjectState, { SHOTSTACK_API_KEY: 'test-only' });
    await assert.rejects(job.renderShotstackMotion('https://example.invalid/image.png', 4, 1), /completed without a video URL/);
  } finally { globalThis.fetch = originalFetch; }
});

test('Pixazo-unavailable fallback preserves the full storyboard scene duration', async () => {
  const originalFetch = globalThis.fetch;
  let requestedDuration = 0;
  const stored: any = { job_id: 'duration-test', status: 'queued', index: 0, scenes: [{ scene: 1, duration_seconds: 14 }], images: [{ scene: 1, image_url: 'https://example.invalid/image.png' }], clips: [], failed: [], events: [], retries: 0 };
  const state = { storage: { get: async () => stored, put: async (_key: string, value: any) => Object.assign(stored, value), setAlarm: async () => {} } };
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/ltx-video/')) return Response.json({ error: 'Insufficient Balance' }, { status: 403 });
    if (url.endsWith('/edit/stage/render')) {
      requestedDuration = JSON.parse(String(init?.body)).timeline.tracks[0].clips[0].length;
      return Response.json({ response: { id: 'duration-render' } });
    }
    return Response.json({ response: { status: 'done', url: 'https://example.invalid/14-seconds.mp4', duration: requestedDuration } });
  };
  try {
    const job = new BeatVisionAnimationJob(state as unknown as DurableObjectState, { PIXAZO_API_KEY: 'test-only', SHOTSTACK_API_KEY: 'test-only' });
    await job.tick();
    assert.equal(requestedDuration, 14);
    assert.equal(stored.clips.length, 1);
    assert.equal(stored.clips[0].requested_duration_seconds, 14);
    assert.equal(stored.clips[0].duration_seconds, 14);
    assert.equal(stored.clips[0].generation_type, 'PROCEDURAL_MOTION');
  } finally { globalThis.fetch = originalFetch; }
});
