import pixazo from './pixazo-media-gateway-fixed';

const RETRYABLE = /prompt not found|provider ended this request without producing output|job ERROR|502|503|504|temporarily unavailable|rate limit|too many requests/i;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * LTX is a long-running provider job and can fail transiently after submission.
 * A retry must create a fresh BeatVision/provider request rather than reusing
 * the failed provider request ID. Successful outputs are returned unchanged.
 */
async function fetchWithMotionRetry(r: Request, e: any) {
  const body = await r.clone().text();
  let last: Response | null = null;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const headers = new Headers(r.headers);
    headers.set('X-BeatVision-Request', crypto.randomUUID());
    const attemptRequest = new Request(r.url, {
      method: 'POST',
      headers,
      body
    });

    last = await pixazo.fetch(attemptRequest, e);
    if (last.status < 500) return last;

    const text = await last.clone().text();
    if (!RETRYABLE.test(text) || attempt === 3) return last;

    // The provider explicitly reports that "prompt not found" consumed no
    // credits and asks for a new request. Back off briefly before resubmitting.
    await sleep(1500 * attempt);
  }

  return last as Response;
}

export default {
  async fetch(r: Request, e: any) {
    const path = new URL(r.url).pathname;
    if (path !== '/v1/video/animate' || r.method !== 'POST') return pixazo.fetch(r, e);
    return fetchWithMotionRetry(r, e);
  }
};
