import fs from 'node:fs';

const gateway = fs.readFileSync('worker/src/video-fallback-gateway.ts', 'utf8');
const wrangler = fs.readFileSync('worker/wrangler.toml', 'utf8');

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
if (!wrangler.includes('ALLOWED_ORIGIN = "https://daddydom8249.github.io"')) {
  throw new Error('Production CORS origin is not explicitly configured.');
}

console.log('SECURITY AUDIT PASS');
console.log('Provider gateway authentication: fail-closed.');
console.log('Provider gateway CORS: explicit allowlist only.');
