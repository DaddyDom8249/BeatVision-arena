const BASE = process.env.BEATVISION_GATEWAY || 'https://beatvision-provider-arena.richardcranium466.workers.dev';
const TOKEN = process.env.GATEWAY_TOKEN || '';
const PAYLOAD_FILE = process.env.BEATVISION_ANIMATION_PAYLOAD || process.argv[2];
const POLL_MS = Number(process.env.BEATVISION_POLL_MS || 7000);
const MAX_WAIT_MS = Number(process.env.BEATVISION_MAX_WAIT_MS || 900000);

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const headers = () => ({
  'Content-Type': 'application/json',
  'X-BeatVision-Contract': '1.1',
  ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {})
});

async function request(path, init = {}) {
  const response = await fetch(`${BASE}${path}`, { ...init, headers: { ...headers(), ...(init.headers || {}) } });
  const text = await response.text();
  let data = null;
  try { data = JSON.parse(text); } catch {}
  return { response, text, data };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function readPayload() {
  if (!PAYLOAD_FILE) throw new Error('Provide BEATVISION_ANIMATION_PAYLOAD=/path/to/payload.json or pass the payload file as the first argument.');
  return JSON.parse(require('node:fs').readFileSync(PAYLOAD_FILE, 'utf8'));
}

function evidencePath(jobId) {
  return `live-animation-evidence-${jobId}.json`;
}

async function main() {
  console.log('==========================================');
  console.log(' BeatVision Persistent Animation Evidence');
  console.log('==========================================');
  console.log(`Gateway: ${BASE}`);
  console.log('IMPORTANT: this runner submits exactly ONE persistent job and NEVER retries the POST.');

  const health = await request('/health');
  assert(health.response.status === 200, `health expected 200, got ${health.response.status}: ${health.text.slice(0, 500)}`);
  assert(health.data?.ok === true, 'health did not return ok=true');
  console.log('PASS health: 200');

  const caps = await request('/v1/capabilities');
  assert(caps.response.status === 200, `capabilities expected 200, got ${caps.response.status}: ${caps.text.slice(0, 500)}`);
  assert(caps.data?.capabilities?.persistent_animation?.configured === true, 'persistent animation binding is not configured');
  assert(caps.data?.capabilities?.video?.model === 'ltx-video', 'video capability is not LTX');
  console.log('PASS capabilities: persistent animation configured');

  const payload = readPayload();
  const jobId = String(payload.job_id || `live-${Date.now()}`);
  const path = `/v1/video/animate/jobs/${encodeURIComponent(jobId)}`;
  const startedAt = Date.now();
  const evidence = { job_id: jobId, gateway: BASE, started_at: new Date(startedAt).toISOString(), polls: [], terminal: null };

  console.log(`Submitting ONE persistent animation job: ${jobId}`);
  const created = await request(path, { method: 'POST', body: JSON.stringify({ ...payload, job_id: jobId }) });
  assert([200, 202].includes(created.response.status), `animation job POST expected 200/202, got ${created.response.status}: ${created.text.slice(0, 1600)}`);
  evidence.created_response = created.data ?? created.text;
  console.log(`PASS job accepted: HTTP ${created.response.status}`);

  while (Date.now() - startedAt < MAX_WAIT_MS) {
    const result = await request(path, { method: 'GET', headers: { 'Content-Type': 'application/json' } });
    const snapshot = result.data ?? { raw: result.text };
    evidence.polls.push({ at: new Date().toISOString(), http_status: result.response.status, snapshot });
    const status = String(snapshot?.status || '').toLowerCase();
    const completed = Array.isArray(snapshot?.clips) ? snapshot.clips.length : 0;
    const failed = Array.isArray(snapshot?.failed) ? snapshot.failed.length : 0;
    console.log(`JOB status=${status || 'unknown'} completed=${completed} failed=${failed}`);

    if (['completed', 'partial', 'failed'].includes(status)) {
      evidence.terminal = snapshot;
      evidence.finished_at = new Date().toISOString();
      require('node:fs').writeFileSync(evidencePath(jobId), JSON.stringify(evidence, null, 2));
      console.log(`Evidence saved: ${evidencePath(jobId)}`);
      if (status === 'failed') process.exitCode = 1;
      return;
    }
    await sleep(POLL_MS);
  }

  const final = await request(path, { method: 'GET', headers: { 'Content-Type': 'application/json' } });
  evidence.timeout_snapshot = final.data ?? final.text;
  evidence.finished_at = new Date().toISOString();
  evidence.timeout_ms = MAX_WAIT_MS;
  require('node:fs').writeFileSync(evidencePath(jobId), JSON.stringify(evidence, null, 2));
  console.error(`ANIMATION POLL TIMEOUT after ${MAX_WAIT_MS}ms.`);
  console.error(`Evidence saved: ${evidencePath(jobId)}`);
  console.error('The job remains persisted. DO NOT POST the job again. Inspect the saved evidence or poll the same job ID later.');
  process.exitCode = 2;
}

main().catch(error => {
  console.error(`RUNNER ERROR: ${error instanceof Error ? error.stack || error.message : String(error)}`);
  process.exitCode = 1;
});
