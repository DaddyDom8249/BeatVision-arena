# BeatVision Arena

Safe integration workspace for BeatVision.

This repository is the **provider execution arena**: a disposable place to assemble and test the provider-facing pipeline before changes are promoted into `BeatVision` (the main application) or `BeatVision-Test` (the presentation/proving-ground repo).

## Purpose

BeatVision Arena is designed around one requirement:

> A provider should be able to connect real technology and exercise the BeatVision workflow, not merely watch a simulated demo.

The arena exposes a provider-neutral contract for:

- Language / reasoning
- Audio intelligence
- Image generation
- Video generation
- Storage
- Long-running jobs

The UI can run in deterministic demo mode, while the gateway is structured for live provider endpoints. Credentials belong in the gateway environment, never in browser code or GitHub Pages.

## Pipeline

`Song + Lyrics → Analyze → Reveal World → Approve → World Assets → Storyboard → Scene Images → Motion → Assemble → Preview → Export`

## Repository roles

- **BeatVision**: production application.
- **BeatVision-Test**: sponsor/provider presentation and proving ground.
- **BeatVision-arena**: safe integration laboratory and provider contract testbed.

Nothing in this repository should require overwriting either existing project. Once an arena capability is proven, it can be promoted deliberately into the production architecture.

## Security

Never commit provider credentials. Configure provider secrets and endpoint URLs in the gateway deployment environment. The browser receives capability metadata and job results, not provider secrets.

## Status

The arena is intentionally provider-neutral. Demo mode is immediately runnable as a static site. Live mode becomes active when a compatible gateway is configured.
