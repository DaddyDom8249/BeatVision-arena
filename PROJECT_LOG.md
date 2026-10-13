# BeatVision Arena Project Log

## 2026-10-09 17:41 UTC — Restore buildable Worker source and preserve live motion timing

**Observed failure:** GitHub main 7454dace fails Worker deployment run 37729347507 at animation-jobs.ts:33 with Syntax error (backslash). The new real-module motion tests and local esbuild entry build reproduce the same invalid TypeScript before repair.

**Live/source comparison:** Read the actual Cloudflare module at active version b07e8cd8-f8ce-4465-9669-e5c89f675168, body SHA-256 e3388ba42bf7a72e9af93098223cd6800bb6cb3004dc08f6d244954c987ae09a. Twelve module sections match the repaired Git bundle byte for byte. The final entry matches after formatting; render-integrity and fallback metadata differences are equivalent expressions. The animation section contains a live-only full-scene Shotstack duration repair, unlike Git main's clamped fallback. Preserved that behavior in source instead of replacing it with 5.5-second clips.

**Repair:** Correct the two doubly escaped URL regex literals. Add explicit .ts extensions to active gateway imports so the existing npm scene-image regression runs directly in Node. Update existing static checks for the actual computed generative/procedural metadata. Add real motion-module URL and full-scene fallback regressions to npm test and GitHub audit. Deploy workflow records the exact Git SHA in both message and tag and uses strict mode to avoid silently overwriting remote settings. Existing bindings, Wrangler exports, authentication and provider configuration remain unchanged.

**Verification:** Before the timing repair, the 14-second fallback test reproduces 5.5 seconds. After repair, all 30 npm Worker tests and two character-continuity tests pass. Both Worker entry bundles build. Pipeline coherence, static architecture, security, persistent animation state, Termux safety and adversarial render-integrity audits pass. Provider calls in regression tests are mocked; no real media job or paid/unknown-cost request was made.

**Publication and live verification:** Pending at this commit. GitHub audit must pass before merge. Verify deploy workflow success, exact serving version/commit tag, unchanged Durable Object namespace and real failure-path health after release. Existing live animation namespace d6bf26572a32437aa95d86e30e2d84d4 and migration tag v2 are recorded for preservation. Zero-cost generation evidence remains unverified.


## 2026-10-13 — Free Wan ZeroGPU motion adapter (draft, not deployed)

**Why:** The live Worker had HF_VIDEO_TOKEN bound but /v2/animate routed only to Pixazo; Pixazo API free tier requires an initial $10 wallet top-up, contrary to strict zero-payment policy. Existing fallback produces Shotstack PROCEDURAL_MOTION/image-motion, not generative movement.

**Change:** A separate explicit model `wan2.2-zerogpu` route checks authenticated gateway requests, one approved short scene and signed source image, and Hugging Face `whoami-v2.isPro === false` before any generation. It calls only the public Wan2.2 ZeroGPU Space; returns real MP4 URLs as GENERATIVE_VIDEO awaiting creator review, never auto-approves. A 3-second cap prevents false full-song coverage; no paid fallback/retry. New mocked free-account, failure, identity, source and duration regressions are added to Worker npm test.

**Limitations:** Exact-head tests and live ZeroGPU queue integration not yet verified. HF public Space may reject API calls, change endpoints, or exhaust daily quota; return unavailable rather than claiming free motion. No production deploy, DB write, approved asset changes, paid provider calls, or merge. Existing Ghast scenes are much longer than 3 seconds; this adapter is a safe pilot, not a full-scene replacement. Groq TTS is a separate component and not silently enabled.


## 2026-10-13 — Gradio remote-image upload and non-duplicating Wan job polling

**Fix:** Replace the inaccurate direct signed-URL-as-server-path Gradio image input with a server-side bounded fetch of the owner-approved Supabase image and a Gradio `/gradio_api/upload` multipart upload. Submit `/gradio_api/call/generate_video` once with an explicit `gradio.FileData` input; return a provider event id without claiming completion.

**Polling:** New authenticated `GET /v1/video/wan-zero/jobs/:eventId` route polls Gradio's SSE result under a 12s timeout and reports processing on timeout; only confirmed completed MP4 from the same trusted Space host receives GENERATIVE_VIDEO provenance, awaiting creator review. Validated Worker entry routes GET before the old POST-only parser.

**Safety:** Validate image source host, signed storage prefix and MIME, max 8 MiB input, free `whoami-v2.isPro===false` before sending, 0.5–3s duration, one owner-approved image, bounded uploads and queue requests. No Pixazo billing, no retries that enqueue duplicate video jobs, no automatically approved media.

**Verification:** Dedicated mocked tests now explicitly run in GitHub Arena Audit; live remote Space API acceptance remains unverified, so merge and deployment stay gated until strict free identity and production proof. No paid calls or production changes.


## 2026-10-13 — Complete Wan ZeroGPU status route + new-head CI

A final route audit found that the validated-entry forwarded GET status, but the inner provider gateway lacked its explicit `/v1/video/wan-zero/jobs/` dispatch. Fixed both routing layers and added dedicated source regression coverage. Enabled safe, no-provider-request GitHub Arena Audit on the feature branch to obtain evidence for the exact amended commit; previously passing CI was from the old synchronous adapter. No production deployment, provider job, approval writes, paid APIs, or automatic retry.
