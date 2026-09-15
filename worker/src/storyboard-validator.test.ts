import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateStoryboard } from './storyboard-validator.ts';

test('rejects storyboard gaps and undeclared media reuse', () => {
  const result = validateStoryboard({
    scenes: [
      { scene: 1, startTime: 0, endTime: 5, mediaAssetId: 'asset-a' },
      { scene: 2, startTime: 6, endTime: 10, mediaAssetId: 'asset-a' }
    ]
  }, 10);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some(issue => issue.code === 'TIMELINE_GAP'));
  assert.ok(result.issues.some(issue => issue.code === 'UNDECLARED_MEDIA_REUSE'));
});

test('accepts contiguous unique media coverage', () => {
  const result = validateStoryboard({
    scenes: [
      { scene: 1, startTime: 0, endTime: 5, mediaAssetId: 'asset-a' },
      { scene: 2, startTime: 5, endTime: 10, mediaAssetId: 'asset-b' }
    ]
  }, 10);
  assert.equal(result.ok, true);
});
