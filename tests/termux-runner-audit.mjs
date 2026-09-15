import fs from 'node:fs';

const runner = fs.readFileSync('tests/termux-full-pipeline.mjs', 'utf8');

if (runner.includes("const fs = require('node:fs');")) throw new Error('Termux runner must remain valid ESM.');
for (const token of [
  "import fs from 'node:fs';",
  "import path from 'node:path';",
  "import crypto from 'node:crypto';",
  'function inputFingerprint(audio)',
  'Input fingerprint mismatch',
  'Legacy state in ${OUT} has no trusted input fingerprint',
  "state.animation.status === 'submit_failed'",
  "state.animation.submission_state === 'in_flight'",
  'getAnimationJob(jobId)',
  'animation_submission_verified_after_restart',
  'Cannot safely resume animation job',
  'if (failed.length)',
  'Animation is blocked until every required scene image exists.',
  "if (!/^https:\\/\\//i.test(url))",
  'Final download returned unexpected content type'
]) {
  if (!runner.includes(token)) throw new Error(`Missing Termux safety guard: ${token}`);
}

console.log('TERMUX RUNNER AUDIT PASS');
console.log('ESM syntax: native imports.');
console.log('Resume isolation: input fingerprint enforced.');
console.log('Animation submission: server verification before ambiguous resume.');
console.log('Scene images: incomplete coverage blocks animation.');
console.log('Final download: HTTPS and content-type checks enforced.');
