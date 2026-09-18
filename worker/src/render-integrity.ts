export type GenerationType = 'GENERATIVE_VIDEO';

export type ValidatedMotionClip = {
  scene: number;
  asset_id: string;
  source_url: string;
  generation_type: GenerationType;
  actual_duration_seconds: number;
  requested_duration_seconds?: number;
  timeline_start_seconds?: number;
  timeline_end_seconds?: number;
  provider?: string;
  model?: string;
};

export type CoverageManifest = {
  target_duration_seconds: number;
  validated_unique_duration_seconds: number;
  unique_asset_count: number;
  unique_scene_count: number;
  coverage_ratio: number;
  coverage_status: 'SUFFICIENT' | 'INSUFFICIENT_UNIQUE_VISUAL_COVERAGE';
  clips: ValidatedMotionClip[];
};

export const COVERAGE_EPSILON_SECONDS = 0.05;

export function targetDurationFromPayload(payload: any, fallback: number): number {
  const candidates = [payload?.audio?.duration_seconds, payload?.audio?.duration, payload?.analysis?.duration_seconds];
  for (const value of candidates) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return Math.min(n, 3600);
  }
  const n = Number(fallback);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 3600) : 0;
}

export function inferGenerationType(clip: any): GenerationType | null {
  if (clip?.generation_type === 'GENERATIVE_VIDEO') return 'GENERATIVE_VIDEO';
  const provider = String(clip?.provider || '').toLowerCase();
  const source = String(clip?.source || '').toLowerCase();
  const model = String(clip?.model || '').toLowerCase();
  if (provider.includes('pixazo') || model.includes('ltx') || source.includes('pixazo')) return 'GENERATIVE_VIDEO';
  return null;
}

export function buildCoverageManifest(clips: ValidatedMotionClip[], targetDurationSeconds: number): CoverageManifest {
  const target = Math.max(0, Number(targetDurationSeconds) || 0);
  const seenAssets = new Set<string>();
  const seenSources = new Set<string>();
  const seenScenes = new Set<number>();
  const accepted: ValidatedMotionClip[] = [];

  for (const clip of clips) {
    const scene = Number(clip?.scene);
    const assetId = String(clip?.asset_id || '').trim();
    const sourceUrl = String(clip?.source_url || '').trim();
    const duration = Number(clip?.actual_duration_seconds);
    const type = clip?.generation_type;
    if (!Number.isInteger(scene) || scene < 1) throw new Error('MEDIA_INTEGRITY_INVALID_SCENE_ID');
    if (!assetId) throw new Error(`MEDIA_INTEGRITY_MISSING_ASSET_ID:${scene}`);
    if (!sourceUrl) throw new Error(`MEDIA_INTEGRITY_MISSING_SOURCE_URL:${scene}`);
    if (!Number.isFinite(duration) || duration <= 0) throw new Error(`MEDIA_INTEGRITY_MISSING_ACTUAL_DURATION:${scene}`);
    if (type !== 'GENERATIVE_VIDEO') throw new Error(`MEDIA_INTEGRITY_UNKNOWN_GENERATION_TYPE:${scene}`);
    if (seenScenes.has(scene)) throw new Error(`MEDIA_INTEGRITY_DUPLICATE_SCENE:${scene}`);
    if (seenAssets.has(assetId)) throw new Error(`MEDIA_INTEGRITY_DUPLICATE_ASSET:${assetId}`);
    if (seenSources.has(sourceUrl)) throw new Error(`MEDIA_INTEGRITY_DUPLICATE_SOURCE:${scene}`);
    if (clip.timeline_start_seconds !== undefined || clip.timeline_end_seconds !== undefined) {
      const start = Number(clip.timeline_start_seconds), end = Number(clip.timeline_end_seconds);
      if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) throw new Error(`MEDIA_INTEGRITY_INVALID_TIMELINE:${scene}`);
      if (end > target + COVERAGE_EPSILON_SECONDS) throw new Error(`MEDIA_INTEGRITY_TIMELINE_OUTSIDE_TARGET:${scene}`);
      if (duration + COVERAGE_EPSILON_SECONDS < end - start) throw new Error(`MEDIA_INTEGRITY_CLIP_TOO_SHORT_FOR_TIMELINE:${scene}`);
    }
    seenScenes.add(scene);
    seenAssets.add(assetId);
    seenSources.add(sourceUrl);
    accepted.push(clip);
  }

  const uniqueDuration = accepted.reduce((sum, clip) => {
    const allocated = Number(clip.timeline_end_seconds) - Number(clip.timeline_start_seconds);
    return sum + (Number.isFinite(allocated) && allocated > 0 ? allocated : Math.max(0, Math.min(Number(clip.actual_duration_seconds), 60)));
  }, 0);
  const ratio = target > 0 ? uniqueDuration / target : 1;
  return {
    target_duration_seconds: target,
    validated_unique_duration_seconds: uniqueDuration,
    unique_asset_count: accepted.length,
    unique_scene_count: seenScenes.size,
    coverage_ratio: ratio,
    coverage_status: uniqueDuration + COVERAGE_EPSILON_SECONDS >= target ? 'SUFFICIENT' : 'INSUFFICIENT_UNIQUE_VISUAL_COVERAGE',
    clips: accepted,
  };
}

export function assertSufficientCoverage(manifest: CoverageManifest): void {
  if (manifest.coverage_status !== 'SUFFICIENT') {
    throw new Error(`INSUFFICIENT_UNIQUE_VISUAL_COVERAGE: required=${manifest.target_duration_seconds.toFixed(3)}s validated_unique=${manifest.validated_unique_duration_seconds.toFixed(3)}s unique_assets=${manifest.unique_asset_count}`);
  }
}
