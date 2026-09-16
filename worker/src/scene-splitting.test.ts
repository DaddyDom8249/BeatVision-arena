import test from 'node:test';
import assert from 'node:assert/strict';
import { beatSnappedBoundaries, splitLongBeats } from './scene-splitting.ts';

test('snaps long-scene boundaries to the nearest available beat', () => {
  const boundaries = beatSnappedBoundaries(0, 10, 2, { beat_times: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5.2, 5.7, 6.2, 7, 8, 9, 10] });
  assert.deepEqual(boundaries, [0, 5.2, 10]);
});

test('preserves deterministic equal splits when beat analysis is unavailable', () => {
  const boundaries = beatSnappedBoundaries(2, 12, 2, {});
  assert.deepEqual(boundaries, [2, 7, 12]);
});

test('splitLongBeats preserves timeline coverage while using musical boundaries', () => {
  const expanded = splitLongBeats({ scenes: [{ scene: 1, beatId: 'beat-1', startTime: 0, endTime: 10 }] }, { beat_times: [0, 1, 2, 3, 4, 5.2, 6, 7, 8, 9, 10] });
  assert.equal(expanded.length, 2);
  assert.equal(expanded[0].startTime, 0);
  assert.equal(expanded[0].endTime, 5.2);
  assert.equal(expanded[1].startTime, 5.2);
  assert.equal(expanded[1].endTime, 10);
  assert.equal(expanded[0].previousBeat, null);
  assert.equal(expanded[0].nextBeat, expanded[1].beatId);
  assert.equal(expanded[1].previousBeat, expanded[0].beatId);
  assert.equal(expanded[1].nextBeat, null);
});
