import pixazo from './video-fallback-gateway';
export { BeatVisionAnimationJob } from './animation-jobs';

const BASE = 'https://gateway.pixazo.ai';
const CONTRACT = '1.1';

const cors = (r: Request, e: any) => {
  const origin = r.headers.get('Origin') || '';
  const allowed = String(e.ALLOWED_ORIGIN || '').split(',').map((x: string) => x.trim()).filter(Boolean);
  return {
    'Access-Control-Allow-Origin': origin && (!allowed.length || allowed.includes(origin)) ? origin : (allowed[0] || '*'),
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,X-BeatVision-Contract,Authorization,X-BeatVision-Request'
  };
};

const json = (r: Request, e: any, data: unknown, status = 200) =>
  new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors(r, e) }
  });

export default {
  async fetch(r: Request, e: any) {
    if (r.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(r, e) });
    return pixazo.fetch(r, e);
  }
};