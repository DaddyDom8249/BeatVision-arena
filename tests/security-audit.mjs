import fs from 'node:fs';

const arena = fs.readFileSync('worker/src/arena-entry.ts', 'utf8');
const fallback = fs.readFileSync('worker/src/video-fallback-gateway.ts', 'utf8');
const shotstack = fs.readFileSync('worker/src/shotstack-gateway.ts', 'utf8');
const wrangler = fs.readFileSync('worker/wrangler.toml', 'utf8');

if (!arena.includes("if (!e.GATEWAY_TOKEN) return json(r, e, { ok: false, error: 'Gateway authentication is not configured.'")) {
  throw new Error('Gateway must fail closed when GATEWAY_TOKEN is missing.');
}
if (arena.includes("(!allowed.length || allowed.includes(origin)) ? origin : (allowed[0] || '*')")) {
  throw new Error('Arena CORS must not reflect arbitrary origins or use wildcard fallback.');
}
if (!arena.includes("if (origin && allowed.includes(origin)) headers['Access-Control-Allow-Origin'] = origin")) {
  throw new Error('Arena CORS allowlist enforcement is missing.');
}
if (!arena.includes("if (!origin || !allowed.includes(origin)) return new Response(null, { status: 403")) {
  throw new Error('Arena disallowed CORS preflight must be rejected.');
}
if (!arena.includes("if (r.headers.get('Authorization') !== `Bearer ${e.GATEWAY_TOKEN}`)")) {
  throw new Error('Arena bearer-token verification is missing.');
}
if (!arena.includes("return json(r, e, { ok: false, error: 'Invalid JSON request body.'")) {
  throw new Error('Malformed JSON must be rejected at the Arena gateway boundary.');
}
if (fallback.includes("(!allowed.length||allowed.includes(o))?o:(allowed[0]||'*')")) {
  throw new Error('Fallback gateway still contains fail-open CORS.');
}
if (!fallback.includes("if(o&&allowed.includes(o))h['Access-Control-Allow-Origin']=o")) {
  throw new Error('Fallback gateway CORS allowlist enforcement is missing.');
}
if (!fallback.includes("if(!o||!allowed.includes(o))return new Response(null,{status:403")) {
  throw new Error('Fallback gateway disallowed CORS preflight must be rejected.');
}
if (!fallback.includes("return !!e.GATEWAY_TOKEN&&r.headers.get('Authorization')===`Bearer ${e.GATEWAY_TOKEN}`")) {
  throw new Error('Fallback gateway authentication must fail closed.');
}
if (shotstack.includes("(!allowed.length||allowed.includes(o))?o:(allowed[0]||'*')")) {
  throw new Error('Assembly gateway still contains fail-open CORS.');
}
if (!shotstack.includes("if(o&&allowed.includes(o))h['Access-Control-Allow-Origin']=o")) {
  throw new Error('Assembly gateway CORS allowlist enforcement is missing.');
}
if (!shotstack.includes("if(!o||!allowed.includes(o))return new Response(null,{status:403")) {
  throw new Error('Assembly gateway disallowed CORS preflight must be rejected.');
}
if (!shotstack.includes("return !!e.GATEWAY_TOKEN&&r.headers.get('Authorization')===`Bearer ${e.GATEWAY_TOKEN}`")) {
  throw new Error('Assembly gateway authentication must fail closed.');
}
if (!wrangler.includes('ALLOWED_ORIGIN = "https://daddydom8249.github.io"')) {
  throw new Error('Production CORS origin is not explicitly configured.');
}
console.log('SECURITY AUDIT PASS');
console.log('Gateway authentication: fail-closed.');
console.log('CORS: explicit allowlist only across gateway layers.');
console.log('Malformed JSON: rejected at Arena gateway boundary.');
