import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCoverageManifest } from './render-integrity.ts';

test('uses storyboard allocation for unique coverage', () => {
  const manifest = buildCoverageManifest([
    { scene: 1, asset_id: 'a', source_url: 'https://example.com/a.mp4', generation_type: 'GENERATIVE_VIDEO', actual_duration_seconds: 5, timeline_start_seconds: 0, timeline_end_seconds: 4 },
    { scene: 2, asset_id: 'b', source_url: 'https://example.com/b.mp4', generation_type: 'GENERATIVE_VIDEO', actual_duration_seconds: 5, timeline_start_seconds: 4, timeline_end_seconds: 8 },
  ], 8);
  assert.equal(manifest.coverage_status, 'SUFFICIENT');
  assert.equal(manifest.validated_unique_duration_seconds, 8);
});

test('rejects a generated clip shorter than its storyboard allocation', () => {
  assert.throws(() => buildCoverageManifest([
    { scene: 1, asset_id: 'a', source_url: 'https://example.com/a.mp4', generation_type: 'GENERATIVE_VIDEO', actual_duration_seconds: 3, timeline_start_seconds: 0, timeline_end_seconds: 4 },
  ], 4), /MEDIA_INTEGRITY_CLIP_TOO_SHORT_FOR_TIMELINE/);
});

test('rejects duplicate assets even when timeline positions differ', () => {
  assert.throws(() => buildCoverageManifest([
    { scene: 1, asset_id: 'same', source_url: 'https://example.com/a.mp4', generation_type: 'GENERATIVE_VIDEO', actual_duration_seconds: 4, timeline_start_seconds: 0, timeline_end_seconds: 4 },
    { scene: 2, asset_id: 'same', source_url: 'https://example.com/b.mp4', generation_type: 'GENERATIVE_VIDEO', actual_duration_seconds: 4, timeline_start_seconds: 4, timeline_end_seconds: 8 },
  ], 8), /MEDIA_INTEGRITY_DUPLICATE_ASSET/);
});
