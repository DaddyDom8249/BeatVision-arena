import test from 'node:test';
import assert from 'node:assert/strict';
import { compileMusicalContext, musicalContext } from './musical-structure.ts';

test('maps a scene to its nearest beat and containing section', () => {
  const audio = {
    bpm: 120,
    beat_times: [0, 0.5, 1, 1.5, 2, 2.5, 3],
    section_times: [
      { start: 0, end: 2, name: 'verse' },
      { start: 2, end: 4, name: 'chorus' },
    ],
  };
  const context = musicalContext(audio, { startTime: 2.1, energy: 0.84, onset_strength: 0.72 });
  assert.equal(context.bpm, 120);
  assert.equal(context.beatIndex, 5);
  assert.equal(context.section, 'chorus');
  assert.equal(context.energy, 0.84);
  assert.equal(context.onset, 0.72);
});

test('prefers scene musical section and safely handles missing analysis', () => {
  const context = musicalContext({}, { startTime: 3, musicalSection: 'bridge' });
  assert.equal(context.section, 'bridge');
  assert.equal(compileMusicalContext({}, { startTime: 3 }), '');
});

test('accepts nested analysis result and snake/camel beat fields', () => {
  const audio = {
    analysis_result: {
      tempo: 98,
      beatTimes: [1, 2, 3],
      sections: [{ start_time: 2, end_time: 4, label: 'drop' }],
    },
  };
  const context = musicalContext(audio, { start_time: 2.2 });
  assert.equal(context.bpm, 98);
  assert.equal(context.beatIndex, 2);
  assert.equal(context.section, 'drop');
});
