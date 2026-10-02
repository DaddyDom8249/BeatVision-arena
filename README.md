# BeatVision Arena

Safe integration workspace for BeatVision.

This repository is the **provider execution arena**: a disposable place to assemble and test provider integrations before proven changes are promoted into `BeatVision` (the main application) or `BeatVision-Test` (the presentation/proving-ground repo).

## Purpose

A provider should be able to connect real technology and exercise the BeatVision workflow, not merely watch a simulated demo.

The arena exposes a versioned provider-neutral contract for:

- Language / reasoning
- Audio intelligence
- Image generation
- Video generation
- Music generation
- Storage / delivery
- Long-running execution through a gateway

## BeatVision integration boundary

BeatVision is the source of truth for song analysis, transcription, World Reveal, Style, Vision Lock, scene direction, approvals, and project state. Arena is an execution layer: it receives an approved, locked BeatVision creative state and turns individual scenes into provider media, then assembles approved motion against the authoritative song timeline.

The current bridge contract is **2.0**. It requires `source.application=beatvision`, a locked `world.version`, a locked `vision_lock`, BeatVision-owned analysis, and explicit scene timing. Arena returns a Vision Lock hash and generation provenance so the main application can record exactly what creative state produced each asset.

Arena does not silently replace BeatVision analysis or world state, and it does not fall back to paid or unknown models. The bridge only permits the configured free image/video model allowlists and Shotstack Sandbox for assembly.

### Bridge endpoints

- `POST /v2/scene-image` — generate one scene image from a locked BeatVision scene.
- `POST /v2/animate` — animate one approved scene image with the free LTX path.
- `POST /v2/assemble` — assemble approved motion against the BeatVision master timeline.
- `GET /health` — reports both legacy 1.1 compatibility and the BeatVision 2.0 bridge capabilities.

The legacy 1.1 provider contract remains available for compatibility while BeatVision migrates to the bridge.

## Current provider architecture

**Pixazo is the unified creative-generation provider for the active free creative path.** The Arena intentionally allowlists only the Pixazo models that are being used as free models in this implementation.

BeatVision uses these Pixazo models:

- **Flux Schnell**: fast world, character and environment concepts.
- **SDXL**: polished world hero/keyframe artwork and 16:9 scene imagery.
- **LTX**: image-to-video generative motion.
- **Tracks**: optional music/score generation.

**Stable Diffusion 3.5 is intentionally excluded from the active Arena path.** It is not configured, advertised, or called, preventing the balance-gated model from being selected accidentally.

- **Shotstack Sandbox**: deterministic editing, stitching, transitions, audio and final MP4 assembly.
- **Optional external intelligence/audio providers**: not bundled or selected by default. They can be connected only by explicitly supplying the required endpoint, model and secret credentials. The Arena exposes them as generic external capabilities rather than shipping a provider-specific integration.

The Arena is the production execution authority for BeatVision. The main BeatVision application owns product state, approvals, UI and persistence; Arena owns provider execution, retries, durable motion jobs, media provenance and final assembly. The Arena does not assume that "free" means commercially licensed. Commercial rights, rate limits, attribution and other terms must be verified with each provider before production use.

## Pipeline

`Song + Lyrics → Analyze → Reveal World → Approve → World Assets → Storyboard → Scene Images → Motion → Assemble → Preview → Export`

The deterministic demo remains available without credentials. Live execution requires a deployed gateway with provider endpoints configured server-side.

## Live provider contract

Contract version: **1.1**

Operations:

- `POST /v1/audio/analyze`
- `POST /v1/language/world`
- `POST /v1/language/storyboard`
- `POST /v1/image/world-assets`
- `POST /v1/image/scenes`
- `POST /v1/video/animate`
- `POST /v1/video/assemble`
- `POST /v1/audio/generate`
- `POST /v1/storage/asset`
- `GET /v1/capabilities`
- `GET /health`

Every live request carries the contract version and a request ID. The gateway reports provider capability, latency, model, and upstream result/error information.

## Security

Provider credentials never belong in browser code. Configure provider tokens and the optional gateway authentication token as Cloudflare secrets. Restrict `ALLOWED_ORIGIN` to the actual frontend origin before exposing live provider endpoints.

The Arena's browser stores only the gateway URL and temporary gateway token in the current session. It does not receive provider-specific credentials.

## Repository roles

- **BeatVision**: production application.
- **BeatVision-Test**: sponsor/provider presentation and proving ground.
- **BeatVision-arena**: canonical execution engine and provider contract authority.

Nothing here requires overwriting either existing project. Arena capabilities are promoted directly into the production execution path; BeatVision remains the product shell around that engine.

## Current status

**BeatVision-owned intelligence + Pixazo/Shotstack execution foundation.** BeatVision owns analysis and creative state. Arena executes only the approved media-generation and assembly steps. Optional legacy language/audio endpoints remain for compatibility, but they are not authoritative for the new BeatVision path.
