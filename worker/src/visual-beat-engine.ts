export type VisualBeat = {
  beatId: string;
  scene: number;
  startTime: number;
  endTime: number;
  sectionId: string;
  lyricRange: string;
  lyricMeaning: string;
  narrativePurpose: string;
  emotionalState: string;
  emotionalIntensity: number;
  characterState: string;
  environment: string;
  action: string;
  visualConcept: string;
  symbolicElements: string[];
  cameraIntent: string;
  transitionIntent: string;
  worldConstraints: string[];
  previousBeat: string | null;
  nextBeat: string | null;
  visualContinuityRequirements: string[];
  reusePolicy: string;
  description: string;
  visual_direction: string;
  location: string;
  emotion: string;
  continuity_notes: string;
  duration_seconds: number;
};

const finite = (value: unknown, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const text = (value: unknown, fallback = '') => String(value ?? fallback).trim();

const tokens = (value: string) => new Set(
  value.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(token => token.length > 2)
);

const similarity = (a: Set<string>, b: Set<string>) => {
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
};

function semanticFingerprint(beat: VisualBeat) {
  return [beat.lyricMeaning, beat.narrativePurpose, beat.emotionalState, beat.characterState, beat.environment, beat.action, beat.visualConcept, beat.cameraIntent, beat.symbolicElements.join(' ')].join(' ');
}

export function compactAudio(value: any) {
  if (!value || typeof value !== 'object') return value;
  const result = value.result && typeof value.result === 'object' ? value.result : value;
  const rawSegments = Array.isArray(result.segments) ? result.segments : [];
  const segments = rawSegments.slice(0, 400).map((segment: any, index: number) => ({
    index,
    start: Math.max(0, finite(segment?.start)),
    end: Math.max(0, finite(segment?.end, finite(segment?.start) + 1)),
    text: text(segment?.text)
  })).filter((segment: any) => segment.text && segment.end > segment.start);
  return {
    duration_seconds: finite(value.duration_seconds ?? value.analysis?.duration_seconds ?? result.duration, 0) || null,
    bpm: value.bpm ?? value.analysis?.bpm ?? null,
    sections: Array.isArray(value.sections) ? value.sections.slice(0, 64) : [],
    energy_curve: Array.isArray(value.energy_curve) ? value.energy_curve.slice(0, 240) : [],
    transcript: text(value.text ?? value.transcript ?? result.text).slice(0, 16000),
    segments
  };
}

export function visualBeatSystemPrompt() {
  return [
    'You are the BeatVision visual-world director and visual beat planner.',
    'Return ONLY valid JSON. Never invent lyrics or claim a lyric event that is absent from the supplied lyrics/transcript.',
    'The song is the subject. The selected style is a visual constraint, not the story.',
    'Build a complete song-grounded visual narrative, not a generic style montage.',
    'Repeated lyrics may return with different narrative purpose, emotional state, character state, action, composition, symbolism, or consequence.',
    'Do not treat a reordered copy of an earlier shot as a new visual beat.',
    'Every visual beat must explain why it exists and how it follows the previous beat.',
    'Use the supplied audio segment timestamps whenever available. Keep visual beats contiguous or intentionally overlapping only when the metadata explains the overlap.',
    'Choose the number of beats from the song structure, lyric density, musical changes, narrative events, and pacing. Do not target a fixed scene count.',
    'Do not collapse a whole verse, chorus, bridge, or outro into one shot merely to reduce generation work.',
    'Major narrative or emotional changes require a new beat even when the lyrics repeat.',
    'Each beat must be independently renderable from one approved image and independently animatable.',
    'Return this exact top-level shape: {sections, visual_beats, coverage_notes}.',
    'Each visual beat must contain: beatId, startTime, endTime, sectionId, lyricRange, lyricMeaning, narrativePurpose, emotionalState, emotionalIntensity, characterState, environment, action, visualConcept, symbolicElements, cameraIntent, transitionIntent, worldConstraints, previousBeat, nextBeat, visualContinuityRequirements, reusePolicy, description, visual_direction, location, emotion, continuity_notes, duration_seconds.',
    'Use numeric startTime/endTime in seconds. emotionalIntensity is 0..1. symbolicElements and worldConstraints and visualContinuityRequirements are arrays of strings.',
    'coverage_notes must identify unresolved story gaps instead of silently filling them with reused material.'
  ].join(' ');
}

function normalizeBeat(raw: any, index: number, previous: any, next: any): VisualBeat | null {
  const start = Math.max(0, finite(raw?.startTime ?? raw?.start_time, 0));
  const end = Math.max(start, finite(raw?.endTime ?? raw?.end_time, 0));
  if (!(end > start)) return null;
  const beatId = text(raw?.beatId ?? raw?.beat_id, `beat-${String(index + 1).padStart(2, '0')}`);
  const scene = Math.max(1, Math.round(finite(raw?.scene, index + 1)));
  const intensity = Math.min(1, Math.max(0, finite(raw?.emotionalIntensity, 0.5)));
  return {
    beatId, scene, startTime: start, endTime: end,
    sectionId: text(raw?.sectionId ?? raw?.section_id, `section-${index + 1}`),
    lyricRange: text(raw?.lyricRange ?? raw?.lyric_range),
    lyricMeaning: text(raw?.lyricMeaning ?? raw?.lyric_meaning),
    narrativePurpose: text(raw?.narrativePurpose ?? raw?.narrative_purpose),
    emotionalState: text(raw?.emotionalState ?? raw?.emotional_state ?? raw?.emotion),
    emotionalIntensity: intensity,
    characterState: text(raw?.characterState ?? raw?.character_state),
    environment: text(raw?.environment ?? raw?.location),
    action: text(raw?.action),
    visualConcept: text(raw?.visualConcept ?? raw?.visual_concept ?? raw?.description),
    symbolicElements: Array.isArray(raw?.symbolicElements) ? raw.symbolicElements.map(text).filter(Boolean) : [],
    cameraIntent: text(raw?.cameraIntent ?? raw?.camera_intent),
    transitionIntent: text(raw?.transitionIntent ?? raw?.transition_intent ?? raw?.transition),
    worldConstraints: Array.isArray(raw?.worldConstraints) ? raw.worldConstraints.map(text).filter(Boolean) : [],
    previousBeat: text(raw?.previousBeat ?? raw?.previous_beat) || (previous ? text(previous.beatId) : null),
    nextBeat: text(raw?.nextBeat ?? raw?.next_beat) || (next ? text(next.beatId) : null),
    visualContinuityRequirements: Array.isArray(raw?.visualContinuityRequirements) ? raw.visualContinuityRequirements.map(text).filter(Boolean) : (Array.isArray(raw?.visual_continuity_requirements) ? raw.visual_continuity_requirements.map(text).filter(Boolean) : []),
    reusePolicy: text(raw?.reusePolicy ?? raw?.reuse_policy, 'new_visual_event unless intentional motif return is explicitly justified'),
    description: text(raw?.description ?? raw?.visualConcept ?? raw?.visual_concept),
    visual_direction: text(raw?.visual_direction ?? raw?.visualDirection ?? raw?.visualConcept),
    location: text(raw?.location ?? raw?.environment),
    emotion: text(raw?.emotion ?? raw?.emotionalState ?? raw?.emotional_state),
    continuity_notes: text(raw?.continuity_notes ?? raw?.continuityNotes),
    duration_seconds: Math.max(0.1, end - start)
  };
}

export function normalizeVisualBeats(raw: any, durationSeconds: number) {
  const source = Array.isArray(raw?.visual_beats) ? raw.visual_beats : Array.isArray(raw?.scenes) ? raw.scenes : [];
  const ordered = source.map((beat: any, index: number) => ({ beat, index }))
    .sort((a: any, b: any) => finite(a.beat?.startTime ?? a.beat?.start_time, Infinity) - finite(b.beat?.startTime ?? b.beat?.start_time, Infinity) || a.index - b.index);
  const normalized: VisualBeat[] = [];
  for (let i = 0; i < ordered.length; i += 1) {
    const previous = normalized[i - 1] || null;
    const nextRaw = ordered[i + 1]?.beat || null;
    const beat = normalizeBeat(ordered[i].beat, i, previous, nextRaw);
    if (beat) normalized.push(beat);
  }
  normalized.forEach((beat, index) => {
    beat.scene = index + 1;
    beat.beatId = beat.beatId || `beat-${String(index + 1).padStart(2, '0')}`;
    beat.previousBeat = index > 0 ? normalized[index - 1].beatId : null;
    beat.nextBeat = index + 1 < normalized.length ? normalized[index + 1].beatId : null;
  });
  const duration = Math.max(0, finite(durationSeconds));
  const coveredUntil = normalized.reduce((cursor, beat) => Math.max(cursor, beat.endTime), 0);
  const coveredSeconds = normalized.reduce((sum, beat) => sum + Math.max(0, beat.endTime - beat.startTime), 0);
  const gaps: Array<{startTime: number; endTime: number}> = [];
  let cursor = 0;
  for (const beat of normalized) {
    if (beat.startTime > cursor + 0.25) gaps.push({ startTime: cursor, endTime: beat.startTime });
    cursor = Math.max(cursor, beat.endTime);
  }
  if (duration > cursor + 0.25) gaps.push({ startTime: cursor, endTime: duration });
  const coverage = duration > 0 ? Math.min(1, coveredSeconds / duration) : 1;
  const unresolved = Array.isArray(raw?.coverage_notes?.unresolved_beats) ? raw.coverage_notes.unresolved_beats : [];
  const longBeatCount = normalized.filter(beat => beat.duration_seconds > 8).length;
  const semanticFields = ['lyricMeaning','narrativePurpose','emotionalState','characterState','environment','action','visualConcept'];
  const missingSemantic = normalized.filter(beat => semanticFields.filter(key => !text((beat as any)[key])).length >= 3).map(beat => beat.beatId);

  const fingerprints = normalized.map(semanticFingerprint).map(tokens);
  const semanticDuplicates: Array<{beatId: string; duplicateOf: string; similarity: number; intentional: boolean}> = [];
  for (let i = 0; i < normalized.length; i += 1) {
    for (let j = 0; j < i; j += 1) {
      const score = similarity(fingerprints[i], fingerprints[j]);
      if (score >= 0.78) {
        const intentional = /intentional|motif|return|recurring|reuse/i.test(normalized[i].reusePolicy);
        semanticDuplicates.push({ beatId: normalized[i].beatId, duplicateOf: normalized[j].beatId, similarity: Number(score.toFixed(3)), intentional });
        break;
      }
    }
  }
  const unexplainedReuse = semanticDuplicates.filter(item => !item.intentional);
  const errors: string[] = [];
  if (!normalized.length) errors.push('No visual beats were produced.');
  if (duration > 0 && coverage < 0.96) errors.push(`Visual coverage is ${(coverage * 100).toFixed(1)}%, below the 96% minimum.`);
  if (gaps.length) errors.push(`Uncovered timeline gaps: ${gaps.map(g => `${g.startTime.toFixed(2)}-${g.endTime.toFixed(2)}s`).join(', ')}`);
  if (missingSemantic.length) errors.push(`Beats missing semantic grounding: ${missingSemantic.join(', ')}`);
  if (unexplainedReuse.length) errors.push(`Unexplained semantic reuse detected: ${unexplainedReuse.map(item => `${item.beatId}≈${item.duplicateOf} (${item.similarity})`).join(', ')}`);
  return {
    visual_beats: normalized,
    sections: Array.isArray(raw?.sections) ? raw.sections : [],
    coverage: {
      duration_seconds: duration,
      visual_beats: normalized.length,
      covered_seconds: coveredSeconds,
      coverage_ratio: coverage,
      uncovered_seconds: Math.max(0, duration - coveredSeconds),
      gaps,
      unresolved_beats: unresolved,
      semantic_grounding_failures: missingSemantic,
      semantic_duplicates: semanticDuplicates,
      semantic_duplicate_rate: normalized.length ? semanticDuplicates.length / normalized.length : 0,
      unexplained_reuse: unexplainedReuse,
      long_beats: longBeatCount
    },
    errors,
    covered_until: coveredUntil
  };
}

export function toStoryboard(normalized: ReturnType<typeof normalizeVisualBeats>) {
  return {
    scenes: normalized.visual_beats.map(beat => ({ ...beat })),
    visual_beats: normalized.visual_beats,
    sections: normalized.sections,
    coverage: normalized.coverage,
    coverage_notes: normalized.errors.length ? { status: 'insufficient', errors: normalized.errors } : { status: 'complete', errors: [] }
  };
}
