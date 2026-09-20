import fs from 'node:fs';

const arena = fs.readFileSync('worker/src/arena-entry.ts', 'utf8');
const gateway = fs.readFileSync('worker/src/video-fallback-gateway.ts', 'utf8');
const wrangler = fs.readFileSync('worker/wrangler.toml', 'utf8');

if (!arena.includes("if (!e.GATEWAY_TOKEN) return json(r, e, { ok: false, error: 'Gateway authentication is not configured.'")) {
  throw new Error('Direct Arena gateway must fail closed when GATEWAY_TOKEN is missing.');
}
if (!arena.includes("if (r.headers.get('Authorization') !== `Bearer ${e.GATEWAY_TOKEN}`)")) {
  throw new Error('Direct Arena gateway bearer-token verification is missing.');
}
if (!arena.includes("if (origin && allowed.includes(origin)) headers['Access-Control-Allow-Origin'] = origin")) {
  throw new Error('Direct Arena gateway CORS allowlist enforcement is missing.');
}
if (arena.includes("(!allowed.length || allowed.includes(origin)) ? origin : (allowed[0] || '*')")) {
  throw new Error('Direct Arena gateway must not reflect arbitrary origins or use wildcard fallback.');
}
if (!arena.includes("if (!origin || !allowed.includes(origin)) return new Response(null, { status: 403")) {
  throw new Error('Direct Arena gateway must reject disallowed CORS preflight.');
}
if (!arena.includes("return json(r, e, { ok: false, error: 'Invalid JSON request body.'")) {
  throw new Error('Direct Arena gateway must reject malformed JSON.');
}

if (!gateway.includes("return !!e.GATEWAY_TOKEN&&r.headers.get('Authorization')===`Bearer ${e.GATEWAY_TOKEN}`")) {
  throw new Error('Provider gateway authentication must fail closed.');
}
if (!gateway.includes("if(!o||!allowed.includes(o))return new Response(null,{status:403")) {
  throw new Error('Provider gateway must reject disallowed CORS preflight.');
}
if (gateway.includes("(!allowed.length||allowed.includes(o))?o:(allowed[0]||'*')")) {
  throw new Error('Provider gateway must not use wildcard/fallback CORS.');
}
if (!gateway.includes("if(o&&allowed.includes(o))h['Access-Control-Allow-Origin']=o")) {
  throw new Error('Provider gateway CORS allowlist enforcement is missing.');
}
if (!wrangler.includes('ALLOWED_ORIGIN = "https://daddydom8249.github.io,https://beat-vision-theta.vercel.app"')) {
  throw new Error('Production CORS origins are not explicitly configured.');
}

console.log('SECURITY AUDIT PASS');
console.log('Direct Arena gateway authentication: fail-closed.');
console.log('Direct Arena gateway CORS: explicit allowlist only.');
console.log('Provider gateway authentication: fail-closed.');
console.log('Provider gateway CORS: explicit allowlist only.');
