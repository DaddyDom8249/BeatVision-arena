const BASE = process.env.BEATVISION_GATEWAY || 'https://beatvision-provider-arena.richardcranium466.workers.dev';

async function request(path, init = {}) {
  const response = await fetch(`${BASE}${path}`, init);
  const text = await response.text();
  let data = null;
  try { data = JSON.parse(text); } catch {}
  return { response, text, data };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function expectStatus(name, path, init, allowed) {
  const { response, data, text } = await request(path, init);
  assert(allowed.includes(response.status), `${name}: expected ${allowed.join('/')} but got ${response.status}: ${text.slice(0, 500)}`);
  console.log(`PASS ${name}: ${response.status}`);
  return { response, data };
}

const health = await expectStatus('health', '/health', {}, [200]);
assert(health.data?.ok === true, 'health did not return ok=true');
assert(health.data?.contract_version === '1.1', 'health contract version mismatch');

await expectStatus('CORS preflight', '/v1/video/animate', {
  method: 'OPTIONS',
  headers: { Origin: 'https://daddydom8249.github.io', 'Access-Control-Request-Method': 'POST' }
}, [204]);

const caps = await expectStatus('capability discovery', '/v1/capabilities', {}, [200, 401]);
if (caps.response.status === 200) {
  assert(caps.data?.capabilities?.image?.provider === 'pixazo', 'image provider is not Pixazo');
  assert(caps.data?.capabilities?.video?.model === 'ltx-video', 'video model is not LTX');
  assert(caps.data?.capabilities?.assembly?.provider === 'shotstack-sandbox', 'assembly provider is not Shotstack Sandbox');
}

await expectStatus('animate invalid JSON', '/v1/video/animate', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: '{broken-json'
}, [400, 401]);

await expectStatus('sceneImages missing storyboard', '/v1/image/scenes', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-BeatVision-Contract': '1.1' },
  body: JSON.stringify({ contract_version: '1.1', operation: 'sceneImages', payload: {} })
}, [400, 401, 503]);

await expectStatus('assemble missing motion', '/v1/video/assemble', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-BeatVision-Contract': '1.1' },
  body: JSON.stringify({ contract_version: '1.1', operation: 'assemble', payload: {} })
}, [400, 401, 503]);

await expectStatus('wrong contract rejected', '/v1/image/scenes', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-BeatVision-Contract': '0.0' },
  body: JSON.stringify({ contract_version: '0.0', operation: 'sceneImages', payload: {} })
}, [400, 401, 503]);

console.log('LIVE SMOKE PASS');
