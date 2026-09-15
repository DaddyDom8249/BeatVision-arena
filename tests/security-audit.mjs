import fs from 'node:fs';

const arena = fs.readFileSync('worker/src/arena-entry.ts', 'utf8');
const wrangler = fs.readFileSync('worker/wrangler.toml', 'utf8');

if (!arena.includes("if (!e.GATEWAY_TOKEN) return json(r, e, { ok: false, error: 'Gateway authentication is not configured.'")) {
  throw new Error('Gateway must fail closed when GATEWAY_TOKEN is missing.');
}
if (arena.includes("(!allowed.length || allowed.includes(origin)) ? origin : (allowed[0] || '*')")) {
  throw new Error('CORS must not reflect arbitrary origins or use wildcard fallback.');
}
if (!arena.includes("if (origin && allowed.includes(origin)) headers['Access-Control-Allow-Origin'] = origin")) {
  throw new Error('CORS allowlist enforcement is missing.');
}
if (!arena.includes("if (!origin || !allowed.includes(origin)) return new Response(null, { status: 403")) {
  throw new Error('Disallowed CORS preflight must be rejected.');
}
if (!arena.includes("if (r.headers.get('Authorization') !== `Bearer ${e.GATEWAY_TOKEN}`)")) {
  throw new Error('Gateway bearer-token verification is missing.');
}
if (!arena.includes("return json(r, e, { ok: false, error: 'Invalid JSON request body.'")) {
  throw new Error('Malformed JSON must be rejected at the gateway boundary.');
}
if (!wrangler.includes('ALLOWED_ORIGIN = "https://daddydom8249.github.io"')) {
  throw new Error('Production CORS origin is not explicitly configured.');
}
console.log('SECURITY AUDIT PASS');
console.log('Gateway authentication: fail-closed.');
console.log('CORS: explicit allowlist only.');
console.log('Malformed JSON: rejected at gateway boundary.');
