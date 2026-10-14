import test from 'node:test';
import assert from 'node:assert/strict';
import { isGatewayAuthorized, timingSafeEqualString } from './gateway-auth.ts';
import shotstack, { getShotstackRenderStatus } from './shotstack-gateway.ts';
import external from './external-provider-gateway.ts';
import pixazoMedia from './pixazo-media-gateway-fixed.ts';

const req = (path: string, auth?: string) => new Request('https://arena.test' + path, {
  method: 'POST', headers: auth ? { Authorization: auth, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' }, body: '{}',
});

test('timingSafeEqualString matches only identical strings', () => {
  assert.equal(timingSafeEqualString('Bearer abc', 'Bearer abc'), true);
  for (const bad of ['Bearer ab', 'Bearer abcd', 'Bearer abd', '', 'bearer abc']) assert.equal(timingSafeEqualString(bad, 'Bearer abc'), false);
});

test('isGatewayAuthorized fails closed when GATEWAY_TOKEN is unset', () => {
  assert.equal(isGatewayAuthorized(req('/x'), {}), false);
  assert.equal(isGatewayAuthorized(req('/x', 'Bearer '), { GATEWAY_TOKEN: '' }), false);
  assert.equal(isGatewayAuthorized(req('/x', 'Bearer t0k'), { GATEWAY_TOKEN: 't0k' }), true);
  assert.equal(isGatewayAuthorized(req('/x', 'Bearer t0'), { GATEWAY_TOKEN: 't0k' }), false);
});

test('sub-gateways reject requests when no GATEWAY_TOKEN is configured (no provider call)', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => { calls++; throw new Error('provider must not be called'); }) as any;
  try {
    assert.equal((await shotstack.fetch(req('/v1/video/assemble'), {})).status, 401);
    assert.equal((await external.fetch(req('/v1/language/generate'), {})).status, 401);
    assert.equal((await pixazoMedia.fetch(req('/v1/image/world-assets'), {})).status, 401);
    assert.equal((await getShotstackRenderStatus(req('/v1/video/assemble/status'), {}, 'abc', 30)).status, 401);
    assert.equal(calls, 0);
  } finally { globalThis.fetch = original; }
});
