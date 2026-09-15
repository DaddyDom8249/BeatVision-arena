import assert from 'node:assert/strict';
import test from 'node:test';
import { assertWorldLocked, cameraLanguageFor, compileGenerationPrompt, normalizeWorldReveal, providerResult, timelineGuardian, validateMediaRecord } from './skills';

test('world reveal normalizes the Grok domain shape without inventing data', () => {
  const report = normalizeWorldReveal({ emotionalMood: 'grief', visualMotifs: ['rain'] });
  assert.equal(report.emotionalMood, 'grief');
  assert.deepEqual(report.visualMotifs, ['rain']);
  assert.equal(report.emotionalArc, '');
});

test('world continuity requires an explicit lock', () => {
  assert.equal(assertWorldLocked({ lockedAt: null }), false);
  assert.equal(assertWorldLocked({ lockedAt: 123 }), true);
});

test('camera language is deterministic for a scene index', () => {
  assert.equal(cameraLanguageFor({}, 0), cameraLanguageFor({}, 0));
  assert.notEqual(cameraLanguageFor({}, 0), cameraLanguageFor({}, 1));
});

test('generation prompt inherits timeline and world context', () => {
  const prompt = compileGenerationPrompt({
    song: { title: 'Test', artist: 'Artist' },
    world: { lockedAt: 1, report: { emotionalMood: 'tense', visualLanguage: 'gritty realism' } },
    scene: { startTime: 5, endTime: 9, musicalSection: 'chorus', purpose: 'turning point', description: 'A door opens' },
    index: 2,
  });
  assert.match(prompt, /Timeline: 5\.000s-9\.000s/);
  assert.match(prompt, /gritty realism/);
  assert.match(prompt, /chorus/);
});

test('timeline guardian rejects gaps and overlaps', () => {
  const gap = timelineGuardian({ scenes: [{ startTime: 0, endTime: 2 }, { startTime: 3, endTime: 4 }] }, 4);
  assert.equal(gap.ok, false);
  const overlap = timelineGuardian({ scenes: [{ startTime: 0, endTime: 3 }, { startTime: 2, endTime: 4 }] }, 4);
  assert.equal(overlap.ok, false);
});

test('media integrity requires identity and provenance', () => {
  assert.equal(validateMediaRecord({}).ok, false);
  assert.equal(validateMediaRecord({ sceneId: 's1', assetId: 'a1', sourceUrl: 'https://example.com/a.mp4', provider: 'pixazo' }).ok, true);
});

test('provider honesty preserves unavailable status instead of faking success', () => {
  const result = providerResult('unavailable', 'pixazo', 'not configured');
  assert.equal(result.status, 'unavailable');
  assert.equal(result.synthetic, true);
});
