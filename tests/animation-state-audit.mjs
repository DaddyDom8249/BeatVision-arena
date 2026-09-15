import fs from 'node:fs';

const animation = fs.readFileSync('worker/src/animation-jobs.ts', 'utf8');

for (const token of [
  'STATUS_RETRY_DELAY_MS=30000',
  'status_retries',
  'provider_status_uncertain',
  'recovery:\'continue_polling_same_provider_request\'',
  "if(job.active_request_id){job.status_retries=(job.status_retries||0)+1;",
  "job.status='waiting_provider_status'",
  'setAlarm(Date.now()+(job.status_retries>=STATUS_RETRY_NOTICE?STATUS_RETRY_DELAY_MS:POLL_MS))'
]) {
  if (!animation.includes(token)) throw new Error(`Missing accepted-provider ambiguity guard: ${token}`);
}

const ambiguousBlock = animation.slice(animation.indexOf("if(job.active_request_id){job.status_retries"), animation.indexOf("job.retries=(job.retries||0)+1", animation.indexOf("if(job.active_request_id){job.status_retries")));
if (ambiguousBlock.includes('failOrFallback')) throw new Error('An accepted Pixazo request must never enter fallback because its status lookup is ambiguous.');

if (!animation.includes("if(['ERROR','FAILED','CANCELLED'].includes(status)){await this.failOrFallback")) {
  throw new Error('Definitive Pixazo terminal failure must remain the explicit fallback trigger.');
}

console.log('ANIMATION STATE AUDIT PASS');
console.log('Accepted provider jobs: status ambiguity preserves the same provider request.');
console.log('Fallback: only definitive provider failure can trigger fallback.');
