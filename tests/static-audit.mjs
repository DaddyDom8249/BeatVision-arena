import fs from 'node:fs';

const required = [
  'app.js',
  'provider-contracts.js',
  'log-guard.js',
  'motion-bridge.js',
  'worker/wrangler.toml',
  'worker/src/arena-entry.ts',
  'worker/src/pixazo-media-gateway-fixed.ts',
  'worker/src/pollinations-gateway-v2.ts',
  'worker/src/shotstack-gateway.ts',
  'worker/src/video-fallback-gateway.ts',
  'worker/src/index.ts'
];

for (const file of required) {
  if (!fs.existsSync(file)) throw new Error(`Missing required file: ${file}`);
}

const read = file => fs.readFileSync(file, 'utf8');
const active = required.map(read).join('\n');

for (const banned of ['huggingface', 'HF_API_TOKEN', 'sd3.5', 'stable-diffusion-3.5']) {
  if (active.toLowerCase().includes(banned.toLowerCase())) {
    throw new Error(`Forbidden active-path reference found: ${banned}`);
  }
}

const contracts = read('provider-contracts.js');
for (const operation of ['analyzeAudio', 'revealWorld', 'worldAssets', 'storyboard', 'sceneImages', 'animate', 'assemble', 'generateMusic', 'storeAsset']) {
  if (!contracts.includes(operation)) throw new Error(`Missing contract operation: ${operation}`);
}

const app = read('app.js');
if (!app.includes('executeSceneBatch')) throw new Error('Per-scene batching is missing.');
if (!app.includes('storyboard.scenes.slice(0,24)')) throw new Error('Browser scene batch limit is missing.');
if (!app.includes('delete single.images')) throw new Error('Scene-image request isolation is missing.');
if (!app.includes('sceneNumber')) throw new Error('Scene identity matching is missing.');

const arena = read('worker/src/arena-entry.ts');
if (!arena.includes('storyboard.scenes.slice(0, 8)')) throw new Error('Worker scene cap is missing.');
if (!arena.includes('for (let attempt = 1; attempt <= 3; attempt += 1)')) throw new Error('SDXL retry guard is missing.');

const pixazo = read('worker/src/pixazo-media-gateway-fixed.ts');
if (!pixazo.includes('/ltx-video/v1/image-to-video')) throw new Error('LTX image-to-video route is missing.');
if (!pixazo.includes('LTX_TIMEOUT_MS = 300000') || !pixazo.includes('LTX_POLL_INTERVAL_MS = 7000')) throw new Error('LTX polling deadline/interval guard is missing.');
const ltxPolls = Math.floor(300000 / 7000) + 1;
if (1 + ltxPolls > 50) throw new Error(`LTX polling can exceed the free Worker subrequest ceiling: ${1 + ltxPolls}`);
if (!pixazo.includes('timed out after ${LTX_TIMEOUT_MS / 1000} seconds')) throw new Error('LTX timeout error must report the actual configured timeout.');

const shotstack = read('worker/src/shotstack-gateway.ts');
if (!shotstack.includes('requestedDuration') || !shotstack.includes('targetDuration')) throw new Error('Full-song assembly duration guard is missing.');
if (!shotstack.includes('while (cursor < targetDuration')) throw new Error('Visual extension loop is missing.');
if (!shotstack.includes('function cycleOrder')) throw new Error('Multi-cycle visual ordering is missing.');
if (!shotstack.includes('case 1: ordered = [...base].reverse()')) throw new Error('Reverse-cycle visual ordering is missing.');
if (!shotstack.includes('case 2: ordered = rotate(base, Math.floor(base.length / 2))')) throw new Error('Rotated-cycle visual ordering is missing.');
if (!shotstack.includes('previousScene')) throw new Error('Adjacent repeated-scene guard is missing.');

const wrangler = read('worker/wrangler.toml');
if (!wrangler.includes('main = "src/arena-entry.ts"')) throw new Error('Arena entry is not the deployed Worker entrypoint.');

console.log('STATIC AUDIT PASS');
console.log(`Checked ${required.length} source/config files.`);
console.log('Active providers: Pollinations analysis/language, Pixazo free media, Shotstack Sandbox assembly/fallback.');
console.log('Assembly ordering: deterministic multi-cycle permutations with adjacent-scene guard.');
