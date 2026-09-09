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
- Storage / delivery
- Long-running execution through a gateway

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
- `POST /v1/storage/asset`
- `GET /v1/capabilities`
- `GET /health`

Every live request carries the contract version and a request ID. The gateway reports provider capability, latency, and upstream result/error information.

## Security

Provider credentials never belong in browser code. Configure provider tokens and the optional gateway authentication token as Cloudflare secrets. Restrict `ALLOWED_ORIGIN` to the actual frontend origin before exposing live provider endpoints.

The Arena's browser stores only the gateway URL and temporary gateway token in the current session. It does not receive provider-specific credentials.

## Repository roles

- **BeatVision**: production application.
- **BeatVision-Test**: sponsor/provider presentation and proving ground.
- **BeatVision-arena**: safe integration laboratory and provider contract testbed.

Nothing here requires overwriting either existing project. Once an arena capability is proven, it can be promoted deliberately into the production architecture.

## Current status

**Integration-ready foundation.** The UI supports deterministic and live modes, gateway health/capability discovery, capability-by-capability execution, request tracing, and a versioned provider contract. Actual end-to-end generation depends on the provider endpoints configured in the gateway.
