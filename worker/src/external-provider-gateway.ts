import { compactAudio, normalizeVisualBeats, toStoryboard, visualBeatSystemPrompt } from './visual-beat-engine';

const CONTRACT_VERSION = '1.1';
const LANGUAGE_TIMEOUT_MS = 60000;
const AUDIO_TIMEOUT_MS = 120000;

function cors(r: Request, e: any) {
  const origin = r.headers.get('Origin') || '';
  const allowed = String(e.ALLOWED_ORIGIN || '').split(',').map((x: string) => x.trim()).filter(Boolean);
  return {
    'Access-Control-Allow-Origin': origin && (!allowed.length || allowed.includes(origin)) ? origin : (allowed[0] || '*'),
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,X-BeatVision-Contract,Authorization,X-BeatVision-Request',
    'Access-Control-Max-Age': '86400'
  };
}

function json(r: Request, e: any, data: unknown, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors(r, e) }
  });
}

function auth(r: Request, e: any) {
  return !e.GATEWAY_TOKEN || r.headers.get('Authorization') === `Bearer ${e.GATEWAY_TOKEN}`;
}

function clip(value: any, max: number) {
  return typeof value === 'string' ? value.slice(0, max) : value;
}

function safePayload(payload: any) {
  if (!payload || typeof payload !== 'object') return {};
  const clean = JSON.parse(JSON.stringify(payload));
  for (const key of ['audio_base64', 'audio_data', 'file_base64', 'raw_audio']) delete clean[key];
  return clean;
}

function compactWorld(value: any) {
  if (!value || typeof value !== 'object') return value;
  return {
    title: clip(value.title, 500),
    logline: clip(value.logline, 3000),
    palette: Array.isArray(value.palette) ? value.palette.slice(0, 24) : value.palette,
    tone: clip(value.tone, 2000),
    visual_language: clip(value.visual_language, 5000),
    locations: Array.isArray(value.locations) ? value.locations.slice(0, 12) : value.locations,
    character_concept: clip(value.character_concept, 5000),
    continuity_rules: Array.isArray(value.continuity_rules) ? value.continuity_rules.slice(0, 30) : value.continuity_rules,
    visual_motifs: Array.isArray(value.visual_motifs) ? value.visual_motifs.slice(0, 30) : value.visual_motifs
  };
}

function compactAssets(value: any) {
  if (!value || typeof value !== 'object') return value;
  return {
    characters: Array.isArray(value.characters) ? value.characters.slice(0, 20) : value.characters,
    environments: Array.isArray(value.environments) ? value.environments.slice(0, 20) : value.environments,
    style_bible: compactWorld(value.style_bible)
  };
}

function messages(operation: string, payload: any) {
  const clean = safePayload(payload);
  const system = 'You are the BeatVision visual-world director. Return ONLY valid JSON. Preserve creative intent, continuity, and production usefulness. Do not invent lyrics.';
  const base = {
    song_title: clip(clean.song_title, 500),
    style: clip(clean.style, 1500),
    lyrics: clip(clean.lyrics, 16000)
  };

  if (operation === 'revealWorld') {
    return [
      { role: 'system', content: system + ' Return {title,logline,palette,tone,visual_language,locations,character_concept,continuity_rules,visual_motifs}.' },
      { role: 'user', content: JSON.stringify({ task: operation, ...base, audio: compactAudio(clean.audio) }) }
    ];
  }

  return [
    {
      role: 'system',
      content: visualBeatSystemPrompt() + ' The selected world and assets are constraints that preserve character and environment continuity. The output must be usable directly by the downstream image generator.'
    },
    {
      role: 'user',
      content: JSON.stringify({
        task: operation,
        ...base,
        audio: compactAudio(clean.audio),
        world: compactWorld(clean.world),
        assets: compactAssets(clean.assets)
      })
    }
  ];
}

function parseJson(value: string) {
  const stripped = value.trim().replace(/^\`\`\`(?:json)?\s*/i, '').replace(/\s*\`\`\`$/, '');
  try { return JSON.parse(stripped); } catch { return { raw: stripped }; }
}

function audioBlob(value: any) {
  if (typeof value !== 'string' || !value) return null;
  const encoded = value.includes(',') ? value.slice(value.indexOf(',') + 1) : value;
  try {
    const raw = atob(encoded);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
    return new Blob([bytes], { type: 'audio/mpeg' });
  } catch {
    return null;
  }
}

async function languageRequest(r: Request, e: any, body: any, requestId: string) {
  const url = String(e.EXTERNAL_LANGUAGE_PROVIDER_URL || '').trim();
  const token = String(e.EXTERNAL_LANGUAGE_PROVIDER_TOKEN || '').trim();
  const model = String(e.EXTERNAL_LANGUAGE_PROVIDER_MODEL || '').trim();
  if (!url || !token || !model) {
    return json(r, e, {
      ok: false,
      contract_version: CONTRACT_VERSION,
      capability: 'language',
      provider: 'external',
      status: 'provider_unavailable',
      request_id: requestId,
      error: 'External language provider is not configured. Configure EXTERNAL_LANGUAGE_PROVIDER_URL, EXTERNAL_LANGUAGE_PROVIDER_MODEL and EXTERNAL_LANGUAGE_PROVIDER_TOKEN.'
    }, 503);
  }

  if (r.method !== 'POST') return json(r, e, { ok: false, error: 'POST required', request_id: requestId }, 405);

  const operation = new URL(r.url).pathname.endsWith('/world') ? 'revealWorld' : 'storyboard';
  if (body?.contract_version !== CONTRACT_VERSION || body?.operation !== operation) {
    return json(r, e, {
      ok: false,
      contract_version: CONTRACT_VERSION,
      capability: 'language',
      status: 'contract_mismatch',
      request_id: requestId,
      error: `Expected BeatVision contract 1.1 operation ${operation}.`
    }, 400);
  }

  const clean = safePayload(body.payload || {});
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LANGUAGE_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'X-BeatVision-Request': requestId
      },
      body: JSON.stringify({
        model,
        messages: messages(operation, clean),
        temperature: 0.4,
        response_format: { type: 'json_object' }
      }),
      signal: controller.signal
    });

    const responseText = await response.text();
    let data: any;
    try { data = JSON.parse(responseText); } catch { data = { raw: responseText.slice(0, 20000) }; }
    const content = data?.choices?.[0]?.message?.content || '';

    if (!response.ok || !content) {
      return json(r, e, {
        ok: false,
        contract_version: CONTRACT_VERSION,
        capability: 'language',
        provider: 'external',
        model,
        status: 'provider_error',
        latency_ms: Date.now() - started,
        request_id: requestId,
        error: `External language provider ${response.status}: ${String(data?.error?.message || data?.error || responseText).slice(0, 1600)}`
      }, 502);
    }

    const parsed = parseJson(content);
    if (operation === 'storyboard') {
      const duration = Number(compactAudio(clean.audio)?.duration_seconds || 0);
      const normalized = normalizeVisualBeats(parsed, duration);
      if (normalized.errors.length) {
          if (normalized.errors.some((x: string) => x === 'No visual beats were produced.')) {
            const repairPrompt = [
              'Repair the BeatVision storyboard request below.',
              'Return ONLY one valid JSON object with exactly these top-level keys: sections, visual_beats, coverage_notes.',
              'visual_beats MUST be a non-empty JSON array.',
              'Every beat MUST have numeric startTime and endTime with endTime greater than startTime.',
              'Use the supplied song duration when present. Cover the complete timeline from 0 to duration.',
              'Do not return markdown, prose, null, or an empty array.',
              'Do not invent lyrics. Instrumental intervals must be described as non-lyrical.',
              'Song duration: ' + (duration > 0 ? String(duration) : 'not supplied') + '.',
              'Original storyboard request:',
              JSON.stringify(clean)
            ].join('\\n');
            try {
              const repairResponse = await fetch(url, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${token}`,
                  'X-BeatVision-Request': requestId
                },
                body: JSON.stringify({
                  model,
                  messages: [
                    { role: 'system', content: 'You are repairing a BeatVision storyboard. Output ONLY valid JSON matching the requested structure.' },
                    { role: 'user', content: repairPrompt }
                  ],
                  temperature: 0.2,
                  response_format: { type: 'json_object' }
                }),
                signal: AbortSignal.timeout(LANGUAGE_TIMEOUT_MS)
              });
              const repairText = await repairResponse.text();
              let repairData: any;
              try { repairData = JSON.parse(repairText); } catch { repairData = { raw: repairText.slice(0, 20000) }; }
              const repairContent = repairData?.choices?.[0]?.message?.content || '';
              if (repairResponse.ok && repairContent) {
                const repaired = parseJson(repairContent);
                const repairedNormalized = normalizeVisualBeats(repaired, duration);
                if (!repairedNormalized.errors.length) {
                  return json(r, e, {
                    ok: true,
                    contract_version: CONTRACT_VERSION,
                    capability: 'language',
                    provider: 'external',
                    model,
                    status: 'generated_repaired',
                    latency_ms: Date.now() - started,
                    request_id: requestId,
                    result: toStoryboard(repairedNormalized),
                    coverage: repairedNormalized.coverage
                  });
                }
              }
            } catch {
              // Preserve the deterministic quality-gate failure if repair also fails.
            }
          }
        return json(r, e, {
          ok: false,
          contract_version: CONTRACT_VERSION,
          capability: 'language',
          provider: 'external',
          model,
          status: 'visual_coverage_insufficient',
          latency_ms: Date.now() - started,
          request_id: requestId,
          result: toStoryboard(normalized),
          coverage: normalized.coverage,
          errors: normalized.errors,
          error: 'Storyboard failed the deterministic visual coverage/semantic quality gate.'
        }, 422);
      }
      return json(r, e, {
        ok: true,
        contract_version: CONTRACT_VERSION,
        capability: 'language',
        provider: 'external',
        model,
        status: 'generated',
        latency_ms: Date.now() - started,
        request_id: requestId,
        result: toStoryboard(normalized),
        coverage: normalized.coverage
      });
    }

    return json(r, e, {
      ok: true,
      contract_version: CONTRACT_VERSION,
      capability: 'language',
      provider: 'external',
      model,
      status: 'generated',
      latency_ms: Date.now() - started,
      request_id: requestId,
      result: parsed
    });
  } catch (error) {
    const timed = error instanceof Error && error.name === 'AbortError';
    return json(r, e, {
      ok: false,
      contract_version: CONTRACT_VERSION,
      capability: 'language',
      provider: 'external',
      status: timed ? 'provider_timeout' : 'provider_error',
      latency_ms: Date.now() - started,
      request_id: requestId,
      error: timed ? 'External language provider timed out.' : String(error instanceof Error ? error.message : error).slice(0, 1600)
    }, timed ? 504 : 502);
  } finally {
    clearTimeout(timer);
  }
}

async function audioAnalyze(r: Request, e: any, body: any, requestId: string) {
  const url = String(e.EXTERNAL_AUDIO_PROVIDER_URL || '').trim();
  const token = String(e.EXTERNAL_AUDIO_PROVIDER_TOKEN || '').trim();
  const model = String(e.EXTERNAL_AUDIO_PROVIDER_MODEL || '').trim();
  if (!url || !token || !model) {
    return json(r, e, {
      ok: false,
      contract_version: CONTRACT_VERSION,
      capability: 'audio',
      provider: 'external',
      status: 'provider_unavailable',
      request_id: requestId,
      error: 'External audio provider is not configured. Configure EXTERNAL_AUDIO_PROVIDER_URL, EXTERNAL_AUDIO_PROVIDER_MODEL and EXTERNAL_AUDIO_PROVIDER_TOKEN.'
    }, 503);
  }

  if (r.method !== 'POST') return json(r, e, { ok: false, error: 'POST required', request_id: requestId }, 405);
  if (body?.contract_version !== CONTRACT_VERSION || body?.operation !== 'analyzeAudio') {
    return json(r, e, { ok: false, error: 'Operation does not match contract 1.1', request_id: requestId }, 400);
  }

  const payload = body.payload || {};
  const audio = audioBlob(payload.audio_base64 || payload.audio_data);
  if (!audio) return json(r, e, {
    ok: false,
    contract_version: CONTRACT_VERSION,
    capability: 'audio',
    provider: 'external',
    status: 'invalid_input',
    request_id: requestId,
    error: 'Audio provider requires valid base64 audio.'
  }, 400);

  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AUDIO_TIMEOUT_MS);

  try {
    const form = new FormData();
    form.append('file', audio, 'beatvision-audio');
    form.append('model', model);
    form.append('response_format', 'verbose_json');
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'X-BeatVision-Request': requestId
      },
      body: form,
      signal: controller.signal
    });
    const text = await response.text();
    let result: any;
    try { result = JSON.parse(text); } catch { result = { raw: text.slice(0, 10000) }; }

    const segments = Array.isArray(result?.segments) ? result.segments : [];
    return json(r, e, {
      ok: response.ok,
      contract_version: CONTRACT_VERSION,
      capability: 'audio',
      provider: 'external',
      model,
      latency_ms: Date.now() - started,
      request_id: requestId,
      result,
      analysis: {
        duration_seconds: payload.duration_seconds ?? result?.duration ?? null,
        bpm: payload.bpm ?? null,
        energy_curve: payload.energy_curve ?? null,
        source: 'external transcription endpoint + browser audio metadata',
        segment_count: segments.length
      }
    }, response.ok ? 200 : 502);
  } catch (error) {
    const timed = error instanceof Error && error.name === 'AbortError';
    return json(r, e, {
      ok: false,
      contract_version: CONTRACT_VERSION,
      capability: 'audio',
      provider: 'external',
      status: timed ? 'provider_timeout' : 'provider_error',
      request_id: requestId,
      error: timed ? 'External audio provider timed out.' : String(error instanceof Error ? error.message : error).slice(0, 1600)
    }, timed ? 504 : 502);
  } finally {
    clearTimeout(timer);
  }
}

export default {
  async fetch(r: Request, e: any) {
    const path = new URL(r.url).pathname;
    if (r.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(r, e) });

    const id = r.headers.get('X-BeatVision-Request') || crypto.randomUUID();
    if (!auth(r, e)) return json(r, e, { ok: false, error: 'Unauthorized', request_id: id }, 401);

    if (path === '/v1/audio/analyze') {
      let body: any;
      try { body = await r.json(); } catch { return json(r, e, { ok: false, error: 'Invalid JSON body', request_id: id }, 400); }
      return audioAnalyze(r, e, body, id);
    }

    if (path === '/v1/language/world' || path === '/v1/language/storyboard') {
      let body: any;
      try { body = await r.json(); } catch { return json(r, e, { ok: false, error: 'Invalid JSON body', request_id: id }, 400); }
      return languageRequest(r, e, body, id);
    }

    return json(r, e, { ok: false, status: 'not_found', request_id: id, error: 'External provider route not configured.' }, 404);
  }
};
