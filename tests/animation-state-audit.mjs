import fs from 'node:fs';

const animation = fs.readFileSync('worker/src/animation-jobs.ts', 'utf8');

for (const token of [
  'STATUS_RETRY_DELAY_MS=30000',
  'STATUS_RETRY_NOTICE=3',
  'status_retries',
  'provider_status_uncertain',
  "recovery:'continue_polling_same_provider_request'",
  "job.status='waiting_provider_status'",
  'setAlarm(Date.now()+(job.status_retries>=STATUS_RETRY_NOTICE?STATUS_RETRY_DELAY_MS:POLL_MS))'
]) {
  if (!animation.includes(token)) throw new Error(`Missing accepted-provider ambiguity guard: ${token}`);
}

const ambiguousStart = animation.indexOf('if(job.active_request_id){job.status_retries=');
const fallbackStart = animation.indexOf('job.retries=(job.retries||0)+1', ambiguousStart);
if (ambiguousStart < 0 || fallbackStart < 0 || fallbackStart <= ambiguousStart) {
  throw new Error('Could not locate the accepted-provider ambiguity guard.');
}
const ambiguousBlock = animation.slice(ambiguousStart, fallbackStart);
if (ambiguousBlock.includes('failOrFallback')) {
  throw new Error('An accepted Pixazo request must never enter fallback because its status lookup is ambiguous.');
}

if (!animation.includes("if(['ERROR','FAILED','CANCELLED'].includes(status)){await this.failGeneration")) {
  throw new Error('Definitive Pixazo terminal failure must remain the explicit terminal failure trigger.');
}

if (!animation.includes('status_retries:0')) {
  throw new Error('New animation jobs must initialize status retry tracking.');
}

if (!animation.includes('const imageScenes=new Set(images.map((image:any,index:number)=>sceneNo(image,index)))')) {
  throw new Error('Animation submission must validate scene-image coverage.');
}
if (!animation.includes("error:'Animation job requires a generated image for every storyboard scene.'")) {
  throw new Error('Incomplete scene-image coverage must block animation submission.');
}
if (!animation.includes('missing_scenes:missingScenes')) {
  throw new Error('Animation coverage rejection must identify missing scenes.');
}

console.log('ANIMATION STATE AUDIT PASS');
console.log('Accepted provider jobs: status ambiguity preserves the same provider request.');
console.log('Fallback: only definitive provider failure can trigger fallback.');
console.log('Animation input: every storyboard scene must have a generated image before submission.');
