export type StoryboardValidationIssue = {
  code: string;
  severity: 'error' | 'warning';
  scene?: number | string;
  message: string;
};

const TIMELINE_EPSILON_SECONDS = 0.02;

export function validateStoryboard(storyboard: any, songDuration?: number, partial = false) {
  const issues: StoryboardValidationIssue[] = [];
  const scenes = Array.isArray(storyboard?.scenes)
    ? storyboard.scenes
    : Array.isArray(storyboard?.visual_beats)
      ? storyboard.visual_beats
      : [];
  const duration = Number(songDuration ?? storyboard?.songDuration ?? storyboard?.song_duration ?? 0);

  if (!scenes.length) {
    issues.push({ code: 'NO_SCENES', severity: 'error', message: 'Storyboard contains no scenes.' });
    return { ok: false, issues };
  }

  const seenAssets = new Map<string, number>();
  let cursor = 0;
  for (let i = 0; i < scenes.length; i += 1) {
    const scene = scenes[i] || {};
    const number = scene.scene ?? i + 1;
    const start = Number(scene.startTime ?? scene.start_time ?? 0);
    const end = Number(scene.endTime ?? scene.end_time ?? start + Number(scene.duration_seconds ?? scene.duration ?? 0));
    const length = end - start;
    if (!Number.isFinite(start) || !Number.isFinite(end) || length <= 0) {
      issues.push({ code: 'INVALID_DURATION', severity: 'error', scene: number, message: 'Scene must have a positive finite duration.' });
      continue;
    }
    // Full storyboards must stay inside the song. Partial sceneImages requests
    // intentionally send one beat and may use estimated timestamps.
    if (!partial) {
      if (start < -TIMELINE_EPSILON_SECONDS || (duration > 0 && end > duration + TIMELINE_EPSILON_SECONDS)) {
        issues.push({ code: 'OUTSIDE_SONG', severity: 'error', scene: number, message: `Scene ${number} falls outside the song timeline.` });
      }
    }
    if (!partial) {
      if (start < cursor - TIMELINE_EPSILON_SECONDS) {
        issues.push({ code: 'TIMELINE_OVERLAP', severity: 'error', scene: number, message: `Scene ${number} overlaps the preceding scene.` });
      }
      if (start > cursor + TIMELINE_EPSILON_SECONDS) {
        issues.push({ code: 'TIMELINE_GAP', severity: 'error', scene: number, message: `Timeline gap detected before scene ${number}.` });
      }
    }
    cursor = Math.max(cursor, end);

    const assetId = scene.mediaAssetId ?? scene.media_asset_id ?? scene.assetId ?? scene.asset_id;
    const reuseFrom = scene.reuseMediaFromSceneId ?? scene.reuse_media_from_scene_id;
    if (assetId) {
      const previous = seenAssets.get(String(assetId));
      if (previous !== undefined && !reuseFrom) {
        issues.push({ code: 'UNDECLARED_MEDIA_REUSE', severity: 'error', scene: number, message: `Media asset ${assetId} is reused by scene ${number} without explicit reuse authorization.` });
      }
      seenAssets.set(String(assetId), i);
    }
    if (reuseFrom && !String(reuseFrom).trim()) {
      issues.push({ code: 'INVALID_REUSE_DECLARATION', severity: 'error', scene: number, message: 'Reuse declaration is empty.' });
    }
  }

  if (!partial && duration > 0 && cursor < duration - 0.35) {
    issues.push({ code: 'INCOMPLETE_COVERAGE', severity: 'error', message: `Storyboard ends at ${cursor.toFixed(3)}s but song duration is ${duration.toFixed(3)}s.` });
  }

  return { ok: !issues.some(issue => issue.severity === 'error'), issues };
}
