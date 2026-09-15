/**
 * BeatVision Arena-native domain skills.
 *
 * These are provider-neutral rules distilled from Beatvision-grok's useful
 * product/domain work. They deliberately do not use browser/session storage.
 * Durable persistence belongs to the Arena project/job storage layer.
 */

export type VisualWorldReport = {
  emotionalMood: string;
  emotionalArc: string;
  visualLanguage: string;
  cinematography: string;
  environments: string[];
  characters: string[];
  lighting: string;
  colorDirection: string;
  visualMotifs: string[];
  movement: string;
  atmosphere: string;
};

export type StyleBible = {
  overallLook: string;
  colorPalette: string;
  lightingRules: string;
  cameraLanguage: string;
  textureAndGrain: string;
  doNot: string;
};

export type WorldContext = {
  report?: Partial<VisualWorldReport>;
  styleBible?: Partial<StyleBible>;
  characters?: Array<{ id?: string; name?: string; role?: string; description?: string; continuityNotes?: string }>;
  environments?: Array<{ id?: string; name?: string; description?: string; whenUsed?: string }>;
  visualRules?: { continuity?: string; camera?: string; lighting?: string; forbidden?: string };
  lockedAt?: number | null;
};

const text = (v: unknown, max = 1200) => String(v ?? '').trim().slice(0, max);
const list = (v: unknown, max = 8) => Array.isArray(v) ? v.map(x => text(x, 500)).filter(Boolean).slice(0, max) : [];

/** World Reveal skill: normalize the canonical world report without inventing facts. */
export function normalizeWorldReveal(report: Partial<VisualWorldReport>): VisualWorldReport {
  return {
    emotionalMood: text(report.emotionalMood), emotionalArc: text(report.emotionalArc),
    visualLanguage: text(report.visualLanguage), cinematography: text(report.cinematography),
    environments: list(report.environments), characters: list(report.characters),
    lighting: text(report.lighting), colorDirection: text(report.colorDirection),
    visualMotifs: list(report.visualMotifs), movement: text(report.movement), atmosphere: text(report.atmosphere),
  };
}

/** World Continuity skill: later stages inherit this context instead of reinterpreting it. */
export function assertWorldLocked(world: WorldContext) {
  return Number.isFinite(Number(world?.lockedAt)) && Number(world.lockedAt) > 0;
}

export function compileWorldContext(world: WorldContext) {
  const report = normalizeWorldReveal(world.report || {});
  const style = world.styleBible || {};
  return [
    `Mood: ${report.emotionalMood}`, `Arc: ${report.emotionalArc}`,
    `Visual language: ${report.visualLanguage}`, `Cinematography: ${report.cinematography}`,
    `Environments: ${list(report.environments).join('; ')}`, `Characters: ${list(report.characters).join('; ')}`,
    `Lighting: ${text(style.lightingRules || report.lighting)}`,
    `Color: ${text(style.colorPalette || report.colorDirection)}`,
    `Motifs: ${list(report.visualMotifs).join('; ')}`, `Movement: ${text(style.cameraLanguage || report.movement)}`,
    `Atmosphere: ${text(style.textureAndGrain || report.atmosphere)}`,
    `World rules: ${text(world.visualRules?.continuity)}`,
    `Forbidden: ${text(style.doNot)} ${text(world.visualRules?.forbidden)}`,
  ].filter(x => !x.endsWith(': ')).join('\n');
}

/** Camera Language skill: controlled variation without random stylistic drift. */
export const CAMERA_LANGUAGES = [
  'wide environmental establishing composition', 'medium character-focused composition',
  'tight emotional close-up', 'side/profile composition with directional negative space',
  'low-angle environmental composition', 'high-angle spatial reveal',
  'silhouette/backlit composition', 'reflection or foreground-obstruction composition',
] as const;

export function cameraLanguageFor(scene: any, index: number) {
  const requested = text(scene?.cameraLanguage || scene?.camera_language);
  if (requested) return requested;
  return CAMERA_LANGUAGES[index % CAMERA_LANGUAGES.length];
}

/** Anti-Recycling skill: repeated media must be explicit and traceable. */
export function mediaIdentity(scene: any) {
  return text(scene?.mediaAssetId || scene?.media_asset_id || scene?.assetId || scene?.asset_id);
}

export function hasExplicitReuse(scene: any) {
  return Boolean(text(scene?.reuseMediaFromSceneId || scene?.reuse_media_from_scene_id));
}

/** Generation Prompt Compiler: every prompt inherits song/world/timeline/scene context. */
export function compileGenerationPrompt(input: {
  world?: WorldContext; song?: any; scene?: any; index?: number; total?: number;
}) {
  const scene = input.scene || {};
  const song = input.song || {};
  const world = input.world || {};
  return [
    'BeatVision cinematic music-video scene.',
    `Song: ${text(song.title)}${song.artist ? ` by ${text(song.artist)}` : ''}.`,
    `Timeline: ${Number(scene.startTime ?? scene.start_time ?? 0).toFixed(3)}s-${Number(scene.endTime ?? scene.end_time ?? 0).toFixed(3)}s.`,
    `Musical section: ${text(scene.musicalSection || scene.musical_section)}.`,
    `Scene purpose: ${text(scene.purpose || scene.visualPurpose || scene.visual_purpose)}.`,
    `World context:\n${compileWorldContext(world)}`,
    `Composition: ${cameraLanguageFor(scene, input.index || 0)}.`,
    `Visual event: ${text(scene.visualEvent || scene.visual_event || scene.description, 1800)}.`,
    `Previous beat: ${text(scene.previousBeat || scene.previous_beat || 'none')}. Next beat: ${text(scene.nextBeat || scene.next_beat || 'none')}.`,
    'Create a new visual event that advances the song. Preserve identity and continuity.',
    'Do not recycle another scene, reorder/recolor/reframe an existing image, add text/logos/watermarks/UI, or invent unrelated characters/locations.',
    'If a recurring lyric or motif returns, change the consequence, emotional state, spatial relationship, or visual event unless explicit reuse is declared.',
  ].join('\n');
}

/** Timeline Guardian: one canonical production-boundary check. */
export function timelineGuardian(storyboard: any, songDuration?: number) {
  const scenes = Array.isArray(storyboard?.scenes) ? storyboard.scenes : Array.isArray(storyboard?.visual_beats) ? storyboard.visual_beats : [];
  const duration = Number(songDuration ?? storyboard?.songDuration ?? storyboard?.song_duration ?? 0);
  const TIMELINE_EPSILON_SECONDS = 0.02;
  const issues: string[] = [];
  let cursor = 0;
  for (let i = 0; i < scenes.length; i += 1) {
    const s = scenes[i] || {};
    const start = Number(s.startTime ?? s.start_time ?? 0);
    const end = Number(s.endTime ?? s.end_time ?? start + Number(s.duration_seconds ?? s.duration ?? 0));
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) issues.push(`scene ${i + 1}: invalid duration`);
    if (start < cursor - TIMELINE_EPSILON_SECONDS) issues.push(`scene ${i + 1}: overlap`);
    if (start > cursor + TIMELINE_EPSILON_SECONDS) issues.push(`scene ${i + 1}: gap`);
    if (duration > 0 && end > duration + TIMELINE_EPSILON_SECONDS) issues.push(`scene ${i + 1}: outside song`);
    cursor = Math.max(cursor, end);
  }
  if (duration > 0 && cursor < duration - 0.35) issues.push(`coverage ends at ${cursor.toFixed(3)}s of ${duration.toFixed(3)}s`);
  return { ok: issues.length === 0, issues };
}

/** Media Integrity skill: provider output is evidence, not merely a URL-shaped string. */
export function validateMediaRecord(media: any) {
  const errors: string[] = [];
  if (!text(media?.sceneId || media?.scene_id)) errors.push('missing scene identity');
  if (!text(media?.assetId || media?.mediaAssetId || media?.media_asset_id)) errors.push('missing media identity');
  if (!text(media?.sourceUrl || media?.source_url || media?.url)) errors.push('missing source URL');
  if (!text(media?.provider)) errors.push('missing provider provenance');
  return { ok: errors.length === 0, errors };
}

/** Provider Honesty skill: never turn an unavailable capability into a fake success. */
export function providerResult(status: 'available' | 'unavailable' | 'fallback', provider: string, detail?: string) {
  return { status, provider: text(provider, 120), detail: text(detail, 500), synthetic: status === 'unavailable' };
}
