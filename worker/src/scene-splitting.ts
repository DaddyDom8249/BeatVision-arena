export type BeatTimeSource = {
  beat_times?: unknown;
  beatTimes?: unknown;
  beats?: unknown;
  beat_grid?: unknown;
  beatGrid?: unknown;
};

function finite(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function beatTimes(source: BeatTimeSource): number[] {
  const raw = source?.beat_times ?? source?.beatTimes ?? source?.beats ?? source?.beat_grid ?? source?.beatGrid;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((value: any) => {
      if (typeof value === 'object' && value !== null) return finite(value.time ?? value.startTime ?? value.start_time);
      return finite(value);
    })
    .filter((value): value is number => value !== null && value >= 0)
    .sort((a, b) => a - b);
}

function nearestBeat(target: number, candidates: number[]): number | null {
  if (!candidates.length) return null;
  let best = candidates[0];
  let bestDistance = Math.abs(best - target);
  for (const candidate of candidates.slice(1)) {
    const distance = Math.abs(candidate - target);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

export function beatSnappedBoundaries(start: number, end: number, parts: number, audioAnalysis?: BeatTimeSource | null): number[] {
  const duration = Math.max(0.1, end - start);
  if (parts <= 1) return [start, end];
  const beats = beatTimes(audioAnalysis || {});
  if (!beats.length) {
    return Array.from({ length: parts + 1 }, (_, index) => start + duration * index / parts);
  }

  const boundaries = [start];
  for (let part = 1; part < parts; part += 1) {
    const target = start + duration * part / parts;
    const lower = boundaries[boundaries.length - 1] + 0.5;
    const upper = end - 0.5 * (parts - part + 1);
    const candidates = beats.filter((beat) => beat >= lower && beat <= upper);
    const snapped = nearestBeat(target, candidates);
    boundaries.push(snapped ?? target);
  }
  boundaries.push(end);
  return boundaries;
}

export function splitLongBeats(storyboard: any, audioAnalysis?: BeatTimeSource | null) {
  const source = Array.isArray(storyboard?.scenes) ? storyboard.scenes : Array.isArray(storyboard?.visual_beats) ? storyboard.visual_beats : [];
  const expanded: any[] = [];
  for (const original of source) {
    const start = Number(original?.startTime ?? original?.start_time ?? 0);
    const end = Number(original?.endTime ?? original?.end_time ?? start + Number(original?.duration_seconds || 4));
    const duration = Math.max(.1, end - start);
    const parts = Math.max(1, Math.ceil(duration / 5));
    const boundaries = beatSnappedBoundaries(start, end, parts, audioAnalysis);
    for (let part = 0; part < parts; part += 1) {
      const a = boundaries[part];
      const b = boundaries[part + 1];
      expanded.push({
        ...original,
        scene: expanded.length + 1,
        beatId: `${original?.beatId || original?.beat_id || `beat-${expanded.length + 1}`}-part-${part + 1}`,
        startTime: a,
        endTime: b,
        duration_seconds: b - a,
        visual_variation_part: `${part + 1}/${parts}`,
        visual_variation_parent: original?.beatId || original?.beat_id || original?.scene || null,
        reusePolicy: part === 0 ? (original?.reusePolicy || original?.reuse_policy || 'new_visual_event') : 'new_visual_event'
      });
    }
  }
  expanded.forEach((beat, index) => {
    beat.previousBeat = index ? expanded[index - 1].beatId : null;
    beat.nextBeat = index + 1 < expanded.length ? expanded[index + 1].beatId : null;
  });
  return expanded;
}
