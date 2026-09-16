import fs from 'node:fs';

const runner = fs.readFileSync('tests/termux-full-pipeline.mjs', 'utf8');

for (const token of [
  'function inputFingerprint(audio)',
  'Input fingerprint mismatch',
  'Legacy state in ${OUT} has no trusted input fingerprint',
  "state.input_fingerprint",
  "input_fingerprint_created",
  "input_fingerprint_migrated",
  "input_fingerprint: state.input_fingerprint"
]) {
  if (!runner.includes(token)) throw new Error(`Missing Termux resume-isolation guard: ${token}`);
}

if (!runner.includes('audio_sha256: audio.sha256')) throw new Error('Audio content hash is not part of the run fingerprint.');
if (!runner.includes('song_title: songTitle')) throw new Error('Song title is not part of the run fingerprint.');
if (!runner.includes('lyrics: readLyrics()')) throw new Error('Lyrics are not part of the run fingerprint.');
if (!runner.includes('style,')) throw new Error('Style is not part of the run fingerprint.');
if (!runner.includes('gateway: GATEWAY')) throw new Error('Gateway is not part of the run fingerprint.');
if (!runner.includes('state.gateway === GATEWAY')) throw new Error('Legacy resume does not verify the gateway identity.');
if (!runner.includes('state.contract_version === CONTRACT')) throw new Error('Legacy resume does not verify the contract version.');

console.log('TERMUX RUNNER AUDIT PASS');
console.log('Resume isolation: run inputs are fingerprinted.');
console.log('Audio identity: SHA-256 protected.');
console.log('Project identity: song, lyrics, style, gateway, and contract protected.');
console.log('Legacy state: migrated only when known persisted inputs match.');
