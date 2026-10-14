import test from 'node:test';
import assert from 'node:assert/strict';
import entry from './arena-validated-entry.ts';

const env = { ALLOWED_ORIGIN: 'https://daddydom8249.github.io,https://beat-vision-theta.vercel.app', GATEWAY_TOKEN: 'tok' };
const get = (origin: string, path = '/v1/unknown') => entry.fetch(new Request('https://arena.test' + path, { headers: { Origin: origin } }), env, {} as any);

test('validated entry does not reflect arbitrary origins', async () => {
  const res = await get('https://evil.example');
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), null);
});

test('validated entry allows configured origins', async () => {
  const res = await get('https://beat-vision-theta.vercel.app');
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://beat-vision-theta.vercel.app');
  assert.equal(res.headers.get('Vary'), 'Origin');
});
