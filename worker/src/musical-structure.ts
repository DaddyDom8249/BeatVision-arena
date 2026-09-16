export type MusicalContext = {
  bpm?: number;
  beatIndex?: number;
  section?: string;
  energy?: number;
  onset?: number;
};

const finite = (value: unknown): number | null => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const text = (value: unknown, max = 160): string => String(value ?? '').trim().slice(0, max);

function arrayFrom(...values: unknown[]): any[] {
  for (const value of values) if (Array.isArray(value)) return value;
  return [];
}

function beatTimes(audio: any): number[] {
  const values = arrayFrom(audio?.beat_times, audio?.beatTimes, audio?.beats, audio?.beat_grid, audio?.beatGrid);
  return values.map(value => finite(typeof value === 'object' ? value?.time ?? value?.startTime ?? value?.start_time : value)).filter((v): v is number => v !== null).sort((a, b) => a - b);
}

function sections(audio: any): any[] {
  return arrayFrom(audio?.section_times, audio?.sectionTimes, audio?.sections, audio?.song_sections, audio?.songSections);
}

function sectionFor(audio: any, time: number): string {
  const found = sections(audio).find(section => {
    const start = finite(section?.startTime ?? section?.start_time ?? section?.start ?? section?.time);
    const end = finite(section?.endTime ?? section?.end_time ?? section?.end);
    if (start === null) return false;
    return time >= start && (end === null || time < end);
  });
  if (!found) return '';
  return text(found?.name ?? found?.label ?? found?.type ?? found?.section);
}

export function musicalContext(audio: any, scene: any): MusicalContext {
  const source = audio?.analysis || audio?.analysis_result || audio?.result || audio || {};
  const start = finite(scene?.startTime ?? scene?.start_time ?? scene?.time) ?? 0;
  const beats = beatTimes(source);
  let beatIndex: number | undefined;
  if (beats.length) {
    let nearest = 0;
    let distance = Math.abs(beats[0] - start);
    for (let i = 1; i < beats.length; i += 1) {
      const d = Math.abs(beats[i] - start);
      if (d < distance) { nearest = i; distance = d; }
    }
    beatIndex = nearest + 1;
  }
  const bpm = finite(source?.bpm ?? source?.tempo);
  const energy = finite(scene?.energy ?? scene?.energy_score ?? scene?.musicalEnergy ?? scene?.musical_energy ?? source?.energy ?? source?.energy_score);
  const onset = finite(scene?.onset ?? scene?.onset_strength ?? source?.onset ?? source?.onset_strength);
  const section = text(scene?.musicalSection ?? scene?.musical_section) || sectionFor(source, start);
  return {
    ...(bpm !== null ? { bpm } : {}),
    ...(beatIndex !== undefined ? { beatIndex } : {}),
    ...(section ? { section } : {}),
    ...(energy !== null ? { energy } : {}),
    ...(onset !== null ? { onset } : {}),
  };
}

export function compileMusicalContext(audio: any, scene: any): string {
  const context = musicalContext(audio, scene);
  const lines = [
    context.bpm !== undefined ? `BPM: ${context.bpm}.` : '',
    context.beatIndex !== undefined ? `Nearest beat: ${context.beatIndex}.` : '',
    context.section ? `Musical section: ${context.section}.` : '',
    context.energy !== undefined ? `Energy: ${context.energy}.` : '',
    context.onset !== undefined ? `Onset strength: ${context.onset}.` : '',
    context.beatIndex !== undefined || context.section || context.energy !== undefined || context.onset !== undefined
      ? 'Timing directive: make the visual event, motion implication, framing, or consequence reflect the local musical moment rather than only the lyric meaning.'
      : '',
  ].filter(Boolean);
  return lines.join('\n');
}
