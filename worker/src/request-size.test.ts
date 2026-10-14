// Hardening 2026-10-14: oversized requests are refused before auth or provider calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import entry, { MAX_REQUEST_BYTES } from './arena-validated-entry.ts';

test('oversized declared body returns 413 without any provider call', async () => {
  const original = globalThis.fetch; let calls = 0;
  globalThis.fetch = (async () => { calls++; throw new Error('no provider'); }) as any;
  try {
    for (const path of ['/v2/scene-image', '/v1/client/image/reference-continuation', '/v1/image/generate']) {
      const r = new Request('https://arena.test' + path, { method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': String(MAX_REQUEST_BYTES + 1), Authorization: 'Bearer t0k' }, body: '{}' });
      const res = await entry.fetch(r, { GATEWAY_TOKEN: 't0k' }, {} as any);
      assert.equal(res.status, 413, path);
      assert.equal((await res.json()).status, 'payload_too_large');
    }
    assert.equal(calls, 0);
  } finally { globalThis.fetch = original; }
});

test('normal-size unauthorized bridge request is still 401', async () => {
  const r = new Request('https://arena.test/v2/scene-image', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal((await entry.fetch(r, { GATEWAY_TOKEN: 't0k' }, {} as any)).status, 401);
});


test('body-size cap rejects chunked streams without Content-Length and cancels upstream', async () => {
  let canceled = false;
  let pulls = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulls++;
      // No declared size. First chunk is accepted; next byte must reject.
      controller.enqueue(new Uint8Array(pulls === 1 ? MAX_REQUEST_BYTES : 1));
    },
    cancel() { canceled = true; },
  });
  const r = new Request('https://arena.test/v2/scene-image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer t0k' },
    body,
    duplex: 'half',
  } as RequestInit & { duplex: 'half' });
  const res = await entry.fetch(r, { GATEWAY_TOKEN: 't0k' }, {} as any);
  assert.equal(res.status, 413);
  assert.equal((await res.json()).status, 'payload_too_large');
  assert.equal(canceled, true, 'reader cancels upstream at the first excess byte');
});

test('body-size cap ignores a falsified small Content-Length', async () => {
  const r = new Request('https://arena.test/v1/image/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': '2', Authorization: 'Bearer t0k' },
    body: new Uint8Array(MAX_REQUEST_BYTES + 1),
  });
  const res = await entry.fetch(r, { GATEWAY_TOKEN: 't0k' }, {} as any);
  assert.equal(res.status, 413);
  assert.equal((await res.json()).status, 'payload_too_large');
});
