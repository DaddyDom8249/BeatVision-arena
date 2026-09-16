export type CompositionAsset = {
  id: string;
  uri: string;
  kind: 'image' | 'video' | 'audio';
  source?: string;
  content_hash?: string;
  perceptual_hash?: string;
  semantic_fingerprint?: string[];
};

export type CompositionShot = {
  id: string;
  scene: number;
  asset_id: string;
  start_seconds: number;
  end_seconds: number;
  source_in_seconds?: number;
  source_out_seconds?: number;
  role: 'primary' | 'transition' | 'motif_return';
  beat_id?: string;
  previous_shot_id?: string | null;
  next_shot_id?: string | null;
};

export type CompositionAudio = {
  asset_id?: string;
  uri?: string;
  duration_seconds: number;
  bpm?: number | null;
  beat_times?: number[];
  section_times?: Array<{ id: string; start_seconds: number; end_seconds: number }>;
};

export type CompositionDocument = {
  schema_version: '1.0';
  project_id: string;
  duration_seconds: number;
  fps: number;
  audio: CompositionAudio;
  assets: CompositionAsset[];
  shots: CompositionShot[];
};

const finite = (value: unknown, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

export function buildCompositionDocument(input: any): CompositionDocument {
  const duration = Math.max(0, Math.min(3600, finite(input?.duration_seconds ?? input?.audio?.duration_seconds)));
  const rawShots = Array.isArray(input?.shots) ? input.shots : Array.isArray(input?.visual_beats) ? input.visual_beats : [];
  const shots: CompositionShot[] = rawShots
    .map((raw: any, index: number) => ({
      id: String(raw?.id ?? raw?.shot_id ?? raw?.beatId ?? `shot-${String(index + 1).padStart(4, '0')}`),
      scene: Math.max(1, Math.round(finite(raw?.scene, index + 1))),
      asset_id: String(raw?.asset_id ?? raw?.assetId ?? '').trim(),
      start_seconds: Math.max(0, finite(raw?.start_seconds ?? raw?.startTime)),
      end_seconds: Math.max(0, finite(raw?.end_seconds ?? raw?.endTime)),
      source_in_seconds: raw?.source_in_seconds == null ? undefined : Math.max(0, finite(raw.source_in_seconds)),
      source_out_seconds: raw?.source_out_seconds == null ? undefined : Math.max(0, finite(raw.source_out_seconds)),
      role: raw?.reusePolicy === 'intentional_motif_return' ? 'motif_return' : raw?.role === 'transition' ? 'transition' : 'primary',
      beat_id: raw?.beatId == null ? undefined : String(raw.beatId),
    }))
    .filter((shot: CompositionShot) => shot.asset_id && shot.end_seconds > shot.start_seconds)
    .sort((a: CompositionShot, b: CompositionShot) => a.start_seconds - b.start_seconds || a.scene - b.scene);

  for (let i = 0; i < shots.length; i++) {
    shots[i].previous_shot_id = i ? shots[i - 1].id : null;
    shots[i].next_shot_id = i + 1 < shots.length ? shots[i + 1].id : null;
  }

  const assets = (Array.isArray(input?.assets) ? input.assets : []).map((a: any) => ({
    id: String(a?.id ?? '').trim(),
    uri: String(a?.uri ?? a?.source_url ?? a?.url ?? '').trim(),
    kind: a?.kind === 'audio' || a?.kind === 'image' ? a.kind : 'video',
    source: a?.source == null ? undefined : String(a.source),
    content_hash: a?.content_hash == null ? undefined : String(a.content_hash),
    perceptual_hash: a?.perceptual_hash == null ? undefined : String(a.perceptual_hash),
    semantic_fingerprint: Array.isArray(a?.semantic_fingerprint) ? a.semantic_fingerprint.map(String) : undefined,
  })).filter((a: CompositionAsset) => a.id && a.uri);

  return {
    schema_version: '1.0',
    project_id: String(input?.project_id ?? input?.id ?? 'beatvision-project'),
    duration_seconds: duration,
    fps: Math.max(1, Math.min(120, Math.round(finite(input?.fps, 25)))),
    audio: {
      asset_id: input?.audio?.asset_id == null ? undefined : String(input.audio.asset_id),
      uri: input?.audio?.uri == null ? undefined : String(input.audio.uri),
      duration_seconds: duration,
      bpm: input?.audio?.bpm == null ? null : finite(input.audio.bpm),
      beat_times: Array.isArray(input?.audio?.beat_times) ? input.audio.beat_times.map((x: any) => Math.max(0, finite(x))).filter((x: number) => x <= duration) : [],
      section_times: Array.isArray(input?.audio?.section_times) ? input.audio.section_times.map((x: any, i: number) => ({ id: String(x?.id ?? `section-${i + 1}`), start_seconds: Math.max(0, finite(x?.start_seconds ?? x?.start)), end_seconds: Math.min(duration, Math.max(0, finite(x?.end_seconds ?? x?.end))) })).filter((x: any) => x.end_seconds > x.start_seconds) : [],
    },
    assets,
    shots,
  };
}

export function validateComposition(doc: CompositionDocument): string[] {
  const errors: string[] = [];
  if (doc.schema_version !== '1.0') errors.push('Unsupported composition schema.');
  if (!(doc.duration_seconds > 0)) errors.push('Composition duration must be greater than zero.');
  if (!(doc.fps > 0)) errors.push('Composition FPS must be greater than zero.');
  const assets = new Set(doc.assets.map(a => a.id));
  const ids = new Set<string>();
  for (const shot of doc.shots) {
    if (ids.has(shot.id)) errors.push(`Duplicate shot id: ${shot.id}`);
    ids.add(shot.id);
    if (!assets.has(shot.asset_id)) errors.push(`Shot ${shot.id} references missing asset ${shot.asset_id}.`);
    if (shot.start_seconds < 0 || shot.end_seconds <= shot.start_seconds) errors.push(`Invalid shot timing: ${shot.id}.`);
    if (shot.end_seconds > doc.duration_seconds + 0.05) errors.push(`Shot ${shot.id} exceeds composition duration.`);
  }
  return errors;
}
