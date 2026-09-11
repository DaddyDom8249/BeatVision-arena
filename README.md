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

## Current provider architecture

**Pixazo is the unified creative-generation provider for the active free creative path.** The Arena intentionally allowlists only the Pixazo models that are being used as free models in this implementation.

BeatVision uses these Pixazo models:

- **Flux Schnell**: fast world, character and environment concepts.
- **SDXL**: polished world hero/keyframe artwork and 16:9 scene imagery.
- **LTX**: image-to-video generative motion.
- **Tracks**: optional music/score generation.

**Stable Diffusion 3.5 is intentionally excluded from the active Arena path.** It is not configured, advertised, or called, preventing the balance-gated model from being selected accidentally.

- **Shotstack Sandbox**: deterministic editing, stitching, transitions, audio and final MP4 assembly.
- **Pollinations**: retained only for the already-proven Whisper audio analysis and language/world-direction layer, because Pixazo's current free catalog does not replace those free speech-to-text and general language functions in this architecture.

The Arena does not assume that "free" means commercially licensed. Commercial rights, rate limits, attribution and other terms must be verified with each provider before production use.

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
- **BeatVision-arena**: safe integration laboratory and provider contract testbed.

Nothing here requires overwriting either existing project. Once an arena capability is proven, it can be promoted deliberately into the production architecture.

## Current status

**Free-model Pixazo-first integration foundation.** The UI supports deterministic and live modes, gateway health/capability discovery, capability-by-capability execution, request tracing, and a versioned provider contract. The active creative generation path is centralized behind one Pixazo API credential, using only Flux Schnell, SDXL, LTX and Tracks. Shotstack remains the editing/assembly layer and Pollinations remains only where its already-proven analysis/language functions are still needed.
