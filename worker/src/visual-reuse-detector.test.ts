import test from 'node:test';
import assert from 'node:assert/strict';
import { detectVisualReuse, assertNoUnapprovedReuse } from './visual-reuse-detector.ts';

test('detects semantic reuse from storyboard fields without an explicit fingerprint', () => {
  const shots = [
    { id: 'a', visualConcept: 'hooded figure in industrial hallway', environment: 'industrial hallway', action: 'walking' },
    { id: 'b', visualConcept: 'hooded figure in industrial hallway', environment: 'industrial hallway', action: 'walking' },
  ];
  const findings = detectVisualReuse(shots);
  assert.ok(findings.some(x => x.reason === 'semantic_similarity' && x.score === 1));
  assert.throws(() => assertNoUnapprovedReuse(shots), /UNAPPROVED_VISUAL_REUSE/);
});

test('allows explicitly intentional motif returns', () => {
  const shots = [
    { id: 'a', visualConcept: 'hooded figure in industrial hallway', reusePolicy: 'new_visual_event' },
    { id: 'b', visualConcept: 'hooded figure in industrial hallway', reusePolicy: 'intentional_motif_return' },
  ];
  const findings = detectVisualReuse(shots);
  assert.ok(findings.some(x => x.reason === 'semantic_similarity' && x.intentional));
  assert.doesNotThrow(() => assertNoUnapprovedReuse(shots));
});
