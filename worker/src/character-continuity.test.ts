import test from 'node:test';
import assert from 'node:assert/strict';
import { compileCharacterContinuity } from './character-continuity.ts';

test('emits stable continuity guidance when an anchor is present', () => {
  const result = compileCharacterContinuity(
    { character_continuity_anchor: 'character:hooded-lead' },
    { character_concept: { appearance: 'black hood, silver eyes, scar over left eyebrow' } }
  );
  assert.match(result, /Continuity anchor: character:hooded-lead/);
  assert.match(result, /Canonical character identity/);
  assert.match(result, /persistent across scenes/);
  assert.match(result, /do not redesign the character/);
});

test('returns empty guidance when no character identity exists', () => {
  assert.equal(compileCharacterContinuity({}, {}), '');
});
