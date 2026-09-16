import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCompositionDocument, validateComposition } from './composition-model.ts';
import { detectVisualReuse, assertNoUnapprovedReuse } from './visual-reuse-detector.ts';

test('buildCompositionDocument creates a deterministic canonical timeline', () => {
  const doc = buildCompositionDocument({
    project_id: 'demo', duration_seconds: 20, fps: 25,
    audio: { bpm: 120, beat_times: [0, 0.5, 1, 2, 30] },
    assets: [{ id: 'a1', uri: 'file://one.mp4', kind: 'video' }, { id: 'a2', uri: 'file://two.mp4', kind: 'video' }],
    shots: [
      { id: 's2', scene: 2, asset_id: 'a2', start_seconds: 5, end_seconds: 10 },
      { id: 's1', scene: 1, asset_id: 'a1', start_seconds: 0, end_seconds: 5 },
    ],
  });
  assert.equal(doc.shots[0].id, 's1');
  assert.equal(doc.shots[0].next_shot_id, 's2');
  assert.deepEqual(doc.audio.beat_times, [0, 0.5, 1, 2]);
  assert.deepEqual(validateComposition(doc), []);
});

test('composition validation catches missing assets and timeline overflow', () => {
  const doc = buildCompositionDocument({ duration_seconds: 10, assets: [], shots: [{ id: 'bad', asset_id: 'missing', start_seconds: 0, end_seconds: 12 }] });
  const errors = validateComposition(doc);
  assert.ok(errors.some(x => x.includes('missing asset')));
  assert.ok(errors.some(x => x.includes('exceeds composition duration')));
});

test('reuse detector catches exact asset reuse and allows explicit motif returns', () => {
  const shots = [
    { id: 's1', asset_id: 'same', role: 'primary' },
    { id: 's2', asset_id: 'same', role: 'primary' },
    { id: 's3', asset_id: 'same', role: 'motif_return' },
  ];
  const findings = detectVisualReuse(shots);
  assert.equal(findings.length, 3);
  assert.equal(findings.filter(x => !x.intentional).length, 1);
  assert.throws(() => assertNoUnapprovedReuse(shots), /UNAPPROVED_VISUAL_REUSE/);
});

test('semantic reuse is detected from storyboard visual-beat fields', () => {
  const shots = [
    {
      id: 'beat-a',
      lyricMeaning: 'alone in the dark', narrativePurpose: 'isolation', emotionalState: 'grief',
      characterState: 'withdrawn', environment: 'industrial hallway', action: 'walking',
      visualConcept: 'hooded figure walking through a blue industrial hallway', cameraIntent: 'slow push-in',
      symbolicElements: ['shadow']
    },
    {
      id: 'beat-b',
      lyricMeaning: 'alone in the dark', narrativePurpose: 'isolation', emotionalState: 'grief',
      characterState: 'withdrawn', environment: 'industrial hallway', action: 'walking',
      visualConcept: 'hooded figure walking through a blue industrial hallway', cameraIntent: 'slow push-in',
      symbolicElements: ['shadow']
    }
  ];
  const findings = detectVisualReuse(shots);
  assert.ok(findings.some(x => x.reason === 'semantic_similarity' && x.score === 1 && !x.intentional));
  assert.throws(() => assertNoUnapprovedReuse(shots), /UNAPPROVED_VISUAL_REUSE/);
});

test('semantic reuse allows an explicitly intentional motif return', () => {
  const findings = detectVisualReuse([
    { id: 'beat-a', visualConcept: 'hooded figure in industrial hallway', reusePolicy: 'new_visual_event' },
    { id: 'beat-b', visualConcept: 'hooded figure in industrial hallway', reusePolicy: 'intentional_motif_return' }
  ]);
  assert.ok(findings.some(x => x.reason === 'semantic_similarity' && x.intentional));
  assert.doesNotThrow(() => assertNoUnapprovedReuse([
    { id: 'beat-a', visualConcept: 'hooded figure in industrial hallway', reusePolicy: 'new_visual_event' },
    { id: 'beat-b', visualConcept: 'hooded figure in industrial hallway', reusePolicy: 'intentional_motif_return' }
  ]));
});
