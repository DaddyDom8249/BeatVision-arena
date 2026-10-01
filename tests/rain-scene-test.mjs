const endpoint = (process.env.BEATVISION_GATEWAY || "https://beatvision-provider-arena.richardcranium466.workers.dev") + "/v1/client/image/scene";

const scenePrompt = `Photorealistic cinematic nighttime rain scene viewed through a window.

A peaceful, dark rainy night with heavy but natural rainfall. Hundreds of individually varied rain droplets and streaks at different depths, lengths, brightness levels, and trajectories. Foreground droplets cling naturally to wet glass and form irregular water trails. Midground and background rainfall becomes progressively softer and more atmospheric.

Deep blue-black nighttime shadows. Very subtle cool blue-gray ambient light. A few extremely distant, dim warm lights softly diffused through the rainfall. Realistic moisture, atmospheric haze, wet reflections, shallow depth of field, realistic low-light photography.

The composition should feel calm, immersive, slow, quiet, and meditative, suitable for sleep, relaxation, and deep breathing.

Minimal composition. No people. No faces. No animals. No vehicles. No prominent buildings. No text. No logos. No watermark. No UI.

CRITICAL VISUAL REQUIREMENTS:
natural irregular rainfall
varied droplet size
varied streak length
varied depth
varied brightness
natural diagonal wind direction
realistic wet glass
realistic atmospheric perspective
photographic texture
dark nighttime exposure
subtle contrast
no repeating patterns`;

const negativePrompt = `purple lighting, magenta, neon, geometric lines, vertical bars, perfectly parallel lines, grid, barcode, repeating streaks, symmetrical rain, artificial particle pattern, cartoon, anime, illustration, fantasy, CGI appearance, oversaturated colors, bright daytime, lightning, text, logo, watermark`;

const body = {
  contract_version: "1.1",
  operation: "sceneImages",
  payload: {
    style: "Photorealistic dark nighttime rain photography, natural wet-glass realism, restrained cool-blue lighting, cinematic low-light exposure.",
    world: {
      the_world: "A quiet rainy night viewed through wet glass.",
      characters: [],
      locations: [{ name: "Rainy window at night" }]
    },
    storyboard: {
      scenes: [{
        scene: 1,
        sceneNumber: 1,
        id: "rain-scene-test-001",
        beatId: "rain-scene-test-001",
        durationSeconds: 31,
        visualPrompt: scenePrompt,
        prompt: scenePrompt,
        negativePrompt,
        negative_prompt: negativePrompt,
        environment: { name: "Rainy window at night" },
        characters: [],
        visualLanguage: "Photorealistic cinematic nighttime rain photography",
        continuity: "No repeating patterns; natural irregular rainfall; consistent dark blue-black nighttime exposure."
      }]
    }
  }
};

const res = await fetch(endpoint, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body)
});

const text = await res.text();
console.log(JSON.stringify({
  endpoint,
  http_status: res.status,
  ok: res.ok,
  response: (() => { try { return JSON.parse(text); } catch { return text; } })()
}, null, 2));

if (!res.ok) process.exit(1);
