// Uses the current deployed Arena worker and optional SDXL reference-image path.\nconst endpoint = (process.env.BEATVISION_GATEWAY || "https://beatvision-provider-arena.richardcranium466.workers.dev") + "/v1/client/image/scene";

const canonicalMaster = {
  assetId: "rain-scene-master-001",
  source: "Arena/Pixazo SDXL",
  imageUrl: "https://pub-582b7213209642b9b995c96c95a30381.r2.dev/sdxl/prompt-133708738-1790839798765-439420.png",
  approved: true
};

const lockedStyle = "Photorealistic cinematic nighttime rain photography, realistic wet glass, restrained cool blue-gray ambient light, deep blue-black shadows, subtle distant warm lights, realistic atmospheric haze, wet reflections, shallow depth of field, dark low-light exposure, calm immersive sleep/relaxation mood.";

const continuationPrompt = `Continuation frame from the approved canonical master rain scene. Preserve the exact same visual world, photographic realism, nighttime exposure, cool blue-gray palette, wet-glass appearance, natural diagonal rainfall direction, restrained contrast, atmospheric depth, and minimal composition. This is a new visual moment, not a copy: vary individual droplets and water trails naturally while keeping the same environment, lighting logic, lens feel, and visual identity. Viewed through the same rainy window at night. No people, faces, animals, vehicles, prominent buildings, text, logos, watermarks, UI, neon, purple or magenta lighting, geometric patterns, grids, repeating streaks, or artificial particle patterns.`;

const negativePrompt = `purple lighting, magenta, neon, geometric lines, vertical bars, perfectly parallel lines, grid, barcode, repeating streaks, symmetrical rain, artificial particle pattern, cartoon, anime, illustration, fantasy, CGI appearance, oversaturated colors, bright daytime, lightning, text, logo, watermark`;

const body = {
  contract_version: "1.1",
  operation: "sceneImages",
  payload: {
    style: lockedStyle,
    world: {
      the_world: "A quiet rainy night viewed through the same wet glass environment as the approved canonical master.",
      characters: [],
      locations: [{ name: "Rainy window at night" }],
      continuity_rules: [
        "LOCKED MASTER: rain-scene-master-001",
        "Approved master is immutable and must not be overwritten.",
        "Preserve the same environment, camera language, lighting logic, exposure, palette, wet-glass realism, rainfall direction, and photographic texture.",
        "Generate a new continuation moment rather than reusing or replacing the master asset."
      ],
      visual_motifs: ["natural irregular rainfall", "wet glass", "soft distant lights", "deep blue-black night"]
    },
    storyboard: {
      scenes: [{
        scene: 2,
        sceneNumber: 2,
        id: "rain-scene-continuation-002",
        beatId: "rain-scene-continuation-002",
        durationSeconds: 31,
        startTime: 31,
        endTime: 62,
        visualPrompt: continuationPrompt,
        prompt: continuationPrompt,
        negativePrompt,
        negative_prompt: negativePrompt,
        environment: { name: "Rainy window at night" },
        characters: [],
        visualLanguage: lockedStyle,
        continuity: "Continuation of immutable approved master rain-scene-master-001. Preserve visual identity and environment; create a new natural rain moment.",
        canonical_master_asset_id: canonicalMaster.assetId,
        canonical_master_asset_url: canonicalMaster.imageUrl,
        canonical_master_approved: canonicalMaster.approved,
        reusePolicy: "new_visual_event"
      }]
    }
  }
};

const res = await fetch(endpoint, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body)
});

const raw = await res.text();
let parsed;
try { parsed = JSON.parse(raw); } catch { parsed = raw; }

console.log(JSON.stringify({
  test: "controlled-continuation",
  canonical_master_asset_id: canonicalMaster.assetId,
  canonical_master_untouched: true,
  endpoint,
  http_status: res.status,
  ok: res.ok,
  response: parsed
}, null, 2));

if (!res.ok) process.exit(1);
