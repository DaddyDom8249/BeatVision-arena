// Consistency references for BeatVision scene images (BeatVision PR #94).
//
// BeatVision sends `references` ({characters, environments}: [{id, name,
// images: [{asset_id, label, image_url}]}]) and `scene.consistency_directives`
// (string[]). Directives are always folded into the text prompt. Reference
// images are only applied when a verified free image-conditioned model is
// explicitly enabled; otherwise the job stays on the existing text-only Flux
// Schnell path and reports references_applied=false. Signed URLs are never
// logged or echoed in responses or error messages.

export const REFERENCE_MODEL_ID = '@cf/black-forest-labs/flux-2-klein-4b';
export const REFERENCE_MODEL_NAME = 'flux-2-klein-4b';
export const REFERENCE_ALLOWED_HOST = 'mdofsinyofqbeapzfygu.supabase.co';
export const REFERENCE_PATH_PREFIX = '/storage/v1/object/sign/visual-assets/';
export const MAX_REFERENCES_PER_SUBJECT = 3;
export const MAX_MODEL_INPUT_IMAGES = 4; // Workers AI FLUX.2 limit (input_image_0..3)
export const MAX_INPUT_DIMENSION = 512; // Workers AI docs: inputs must be smaller than 512x512
export const MAX_REFERENCE_BYTES = 4 * 1024 * 1024;
export const REFERENCE_FETCH_TIMEOUT_MS = 8000;
const ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const MAX_DIRECTIVES = 12;
const MAX_DIRECTIVE_CHARS = 700;

export type SceneReference = { kind: 'character' | 'environment'; subject_id: string; subject_name: string; asset_id: string; label: string; image_url: string };

const str = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);

export function consistencyDirectives(scene: any): string[] {
  const raw = scene?.consistency_directives;
  if (!Array.isArray(raw)) return [];
  return raw.map((d) => str(d, MAX_DIRECTIVE_CHARS)).filter(Boolean).slice(0, MAX_DIRECTIVES);
}

export function isAllowedReferenceUrl(value: unknown) {
  try {
    const u = new URL(String(value));
    return u.protocol === 'https:' && u.hostname === REFERENCE_ALLOWED_HOST && !u.port
      && u.pathname.startsWith(REFERENCE_PATH_PREFIX) && !u.pathname.includes('..')
      && !!u.searchParams.get('token');
  } catch { return false; }
}

// Flatten BeatVision's references block. Invalid/off-host URLs are dropped and counted.
export function normalizeReferences(references: any): { refs: SceneReference[]; rejected: number } {
  const refs: SceneReference[] = [];
  let rejected = 0;
  if (!references || typeof references !== 'object' || Array.isArray(references)) return { refs, rejected };
  for (const [key, kind] of [['characters', 'character'], ['environments', 'environment']] as const) {
    const subjects = Array.isArray(references[key]) ? references[key] : [];
    for (const subject of subjects.slice(0, 20)) {
      const images = Array.isArray(subject?.images) ? subject.images : [];
      for (const image of images.slice(0, MAX_REFERENCES_PER_SUBJECT)) {
        if (!isAllowedReferenceUrl(image?.image_url)) { rejected += 1; continue; }
        refs.push({ kind, subject_id: str(subject?.id, 200), subject_name: str(subject?.name, 200), asset_id: str(image?.asset_id, 200), label: str(image?.label, 200), image_url: String(image.image_url) });
      }
    }
  }
  return { refs, rejected };
}

// Public metadata about references: never includes URLs.
export function referenceSummary(refs: SceneReference[]) {
  return refs.map((r) => ({ kind: r.kind, subject_id: r.subject_id, subject_name: r.subject_name, asset_id: r.asset_id }));
}

export function imageDimensions(bytes: Uint8Array, type: string): { width: number; height: number } | null {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (type === 'image/png') {
    if (bytes.length < 24 || dv.getUint32(0) !== 0x89504e47) return null;
    return { width: dv.getUint32(16), height: dv.getUint32(20) };
  }
  if (type === 'image/jpeg') {
    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) { i += 1; continue; }
      const marker = bytes[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { height: dv.getUint16(i + 5), width: dv.getUint16(i + 7) };
      }
      i += 2 + dv.getUint16(i + 2);
    }
    return null;
  }
  if (type === 'image/webp') {
    if (bytes.length < 30 || String.fromCharCode(...bytes.slice(0, 4)) !== 'RIFF' || String.fromCharCode(...bytes.slice(8, 12)) !== 'WEBP') return null;
    const chunk = String.fromCharCode(...bytes.slice(12, 16));
    if (chunk === 'VP8X') return { width: 1 + (bytes[24] | bytes[25] << 8 | bytes[26] << 16), height: 1 + (bytes[27] | bytes[28] << 8 | bytes[29] << 16) };
    if (chunk === 'VP8 ') return { width: dv.getUint16(26, true) & 0x3fff, height: dv.getUint16(28, true) & 0x3fff };
    if (chunk === 'VP8L') { const b = dv.getUint32(21, true); return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 }; }
    return null;
  }
  return null;
}

// Fetch one signed reference with timeout, no redirects (workerd-safe "manual"),
// content-type allowlist, byte cap and dimension check. Errors carry only codes.
export async function fetchReferenceImage(ref: SceneReference, fetcher: typeof fetch = fetch, timeoutMs = REFERENCE_FETCH_TIMEOUT_MS): Promise<{ ok: true; blob: Blob } | { ok: false; code: string }> {
  if (!isAllowedReferenceUrl(ref.image_url)) return { ok: false, code: 'reference_url_rejected' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetcher(ref.image_url, { redirect: 'manual', signal: controller.signal });
    if (res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400)) return { ok: false, code: 'reference_redirect_rejected' };
    if (!res.ok) return { ok: false, code: `reference_http_${res.status}` };
    const type = String(res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!ALLOWED_TYPES.has(type)) return { ok: false, code: 'reference_content_type_rejected' };
    const declared = Number(res.headers.get('content-length') || 0);
    if (declared > MAX_REFERENCE_BYTES) return { ok: false, code: 'reference_too_large' };
    if (!res.body) return { ok: false, code: 'reference_empty' };
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = []; let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_REFERENCE_BYTES) { await reader.cancel().catch(() => {}); return { ok: false, code: 'reference_too_large' }; }
      chunks.push(value);
    }
    if (!total) return { ok: false, code: 'reference_empty' };
    const bytes = new Uint8Array(total); let o = 0;
    for (const c of chunks) { bytes.set(c, o); o += c.byteLength; }
    const dims = imageDimensions(bytes, type);
    if (!dims) return { ok: false, code: 'reference_not_decodable' };
    if (dims.width > MAX_INPUT_DIMENSION || dims.height > MAX_INPUT_DIMENSION) return { ok: false, code: 'reference_dimensions_exceed_model_limit' };
    return { ok: true, blob: new Blob([bytes], { type }) };
  } catch (error) {
    return { ok: false, code: (error as any)?.name === 'AbortError' ? 'reference_fetch_timeout' : 'reference_fetch_failed' };
  } finally { clearTimeout(timer); }
}

// The conditioned path is OFF unless the owner explicitly opts in after confirming
// the Cloudflare account plan (free allocation only; see PR notes).
export function referenceModelEnabled(env: any) {
  return String(env?.CF_REFERENCE_IMAGE_MODEL_ENABLED || '').trim().toLowerCase() === 'true'
    && !!env?.AI && typeof env.AI.run === 'function';
}

export async function generateReferencedImage(env: any, prompt: string, blobs: Blob[]) {
  const form = new FormData();
  form.append('prompt', prompt.slice(0, 2048));
  form.append('width', '1024');
  form.append('height', '1024');
  blobs.slice(0, MAX_MODEL_INPUT_IMAGES).forEach((b, i) => form.append(`input_image_${i}`, b));
  const packed = new Response(form);
  const out = await env.AI.run(REFERENCE_MODEL_ID, { multipart: { body: packed.body, contentType: packed.headers.get('content-type') } });
  const image = typeof out?.image === 'string' ? out.image.trim() : '';
  if (!image) throw new Error('reference_model_returned_no_image');
  return image;
}

export type ReferenceOutcome = {
  provided: number; rejected_urls: number; applied: boolean; applied_count: number;
  model: string | null; reason: string; skipped: { asset_id: string; code: string }[];
  assets: ReturnType<typeof referenceSummary>;
};

// Try the conditioned model; never throws. Returns image_base64 only when references were really used.
export async function tryReferencedSceneImage(env: any, prompt: string, references: any, fetcher: typeof fetch = fetch): Promise<{ image_base64: string | null; outcome: ReferenceOutcome }> {
  const { refs, rejected } = normalizeReferences(references);
  const outcome: ReferenceOutcome = { provided: refs.length + rejected, rejected_urls: rejected, applied: false, applied_count: 0, model: null, reason: '', skipped: [], assets: [] };
  if (!refs.length) { outcome.reason = rejected ? 'all_reference_urls_rejected' : 'no_references'; return { image_base64: null, outcome }; }
  if (!referenceModelEnabled(env)) { outcome.reason = 'no_verified_free_conditioned_model_enabled'; return { image_base64: null, outcome }; }
  const blobs: Blob[] = []; const used: SceneReference[] = [];
  for (const ref of refs) {
    if (blobs.length >= MAX_MODEL_INPUT_IMAGES) { outcome.skipped.push({ asset_id: ref.asset_id, code: 'model_input_limit' }); continue; }
    const got = await fetchReferenceImage(ref, fetcher);
    if (got.ok) { blobs.push(got.blob); used.push(ref); } else outcome.skipped.push({ asset_id: ref.asset_id, code: got.code });
  }
  if (!blobs.length) { outcome.reason = 'no_usable_reference_images'; return { image_base64: null, outcome }; }
  try {
    const image = await generateReferencedImage(env, prompt, blobs);
    Object.assign(outcome, { applied: true, applied_count: blobs.length, model: REFERENCE_MODEL_NAME, reason: 'applied', assets: referenceSummary(used) });
    return { image_base64: image, outcome };
  } catch {
    outcome.reason = 'reference_model_failed';
    return { image_base64: null, outcome };
  }
}
