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


## 2026-10-13 — Cloudflare workerd signed-image redirect runtime fix

**Observed:** Owner's Android Ghast Production Workspace displayed `Invalid redirect value, must be one of "follow" or "manual" ("error" won't be implemented since it does not make sense at the edge; use "manual" and check the response status code)` after tapping strictly-free AI movement preview. This is an actual Worker runtime exception, not a Hugging Face quota or media permission error.

**Root cause:** `worker/src/hf-zerogpu-video.ts` used `fetch(sceneImageUrl,{redirect:"error"})`, which is valid in browsers but explicitly unsupported in Cloudflare workerd. The adapter catches it as `free_provider_unavailable` and the frontend correctly displays the exact error. The next external provider request never happened.

**Repair:** Switch to `redirect:"manual"` and fail closed on any 3xx or `opaqueredirect` response before any image bytes are read or uploaded. Keep signed-source host, approved image provenance, size/type limits, JWT/API checks and no paid fallback unchanged. Add regression coverage asserting the Worker-safe redirect mode and rejecting both ordinary and opaque redirects without any Gradio submission.

**Verification:** Awaiting exact-commit CI and Worker production deployment. Real generative MP4 still unverified; this only fixes the confirmed runtime blocker. No paid provider calls or creator asset mutations.


## 2026-10-13 — Fix terminal WAN_ZERO_GPU_PROVIDER_ERROR

Mobile production evidence: Gradio accepted a job and subsequently reported an SSE event:error. The Arena returned a generic 503, while the Studio retained a stuck queued ticket. New parser returns terminal status failed with an allowlisted failure category and safe message; no raw traceback disclosure, no automatic requeue, no paid fallback and no approved asset mutation. Live underlying model error still unverified.


## 2026-10-13 — C1 audit repair: fail-closed legacy image access

**Finding confirmed on GitHub main:** Both legacy /v1/client/image endpoints entered provider-capable code before the GATEWAY_TOKEN authorization gate. In-memory rate limiting is not authorization; actual incurred charges remain unverified. 

**Code fix, not deployed:** The outer validated Worker and inner Arena handler now require a configured server-side GATEWAY_TOKEN with matching Bearer header for all /v1/client paths, before any provider call or body validation. Legacy anonymous browser consumers will be denied; authenticated trusted-backend calls can continue. No approved assets, provider secrets, model entitlements or production settings are modified.

**Regressions:** Denial for absent/wrong token and missing configuration on scene and reference routes, both handler layers, spoofed-IP denial and retention of authenticated Flux Schnell mocking. Tests do not execute real provider calls. Await exact PR CI. Owner must explicitly authorize merge/deployment.


## 2026-10-13 — Final-video output media validation (review-only)

**Finding:** Shotstack status returned render_integrity PASS using only provider duration; the output URL was not probed. This can falsely mark absent audio, corrupt/non-MP4 file, or an unrelated duration as complete.

**Source fix:** On 'done', allow only the observed Shotstack sandbox S3 host, probe the output using Shotstack's existing /v1/probe service, require MP4 container, actual video plus audio streams, and probed duration within 0.35 seconds of the authoritative caller's target. Fail closed with stable error codes otherwise. Return media_validation only for verified media. No raw provider errors or stack traces returned. Mock tests assert valid media, missing audio, HTML container, wrong probe duration, probe unavailable, malicious output URL.

**Gates:** No provider API requests made during tests, no production deploy. New probe call's billing allowance is NOT VERIFIED and must be approved as $0 before deployment. Supabase final_videos write-hardening PR is required to complete the workflow. Signed S3 URL may expire; finished downloadable video retention is a separate outstanding problem.


## 2026-10-13 — Probe endpoint correction

Current official Shotstack API documentation specifies GET /edit/stage/probe/:encodedAssetUrl. Draft Worker still used legacy /v1/probe; corrected to the documented staging route, and mocks assert the new request path. No live API request was made. A historical Shotstack answer states the inspector uses no credits; current account entitlements remain unverified.

## 2026-10-26 America/Chicago — Accept truthful transcription-only image requests

Creator screenshots show Bragora forge paused at0/50 with Arena rejected generation.
Read-only production jobs474180c5,938b982c,2f6b9f1c record contract_validation_failed:
analysis.analysis_method must identify BeatVision browser audio analysis. Their
frozen analysis has completed groq/groq_whisper/whisper-large-v3-turbo, transcript,
segments/words and249.59999948799998s duration, but no local-DSP method. The existing
analyzer legitimately supports server-only fallback. Four project revisions have
zero stored images/motion; no missing-media restoration or revision creation needed.

Baseline maincbf4cbcb0a4b8c51d02adc9b67dbc5b4adc5615b. Existing root instructions,
project histories and actual live Worker reviewed. Small bridge validation change
accepts completed known Groq transcription with real transcript, positive numeric
matching duration and absent/explicit transcription method. Unknown, incomplete,
mismatched evidence still rejects. Incoming analysis remains untouched: no invented
browser DSP, BPM/key, source claims or database changes. Return safe contract error
message so current UI reports the cause on future failed requests. Gateway auth,
Vision Lock, timing, free provider/model guards and original media remain intact.

Verification: baseline63/63 Worker tests; two new behavioral regressions fail before
repair. Final67/67 pass, build via esbuild and diff check pass. Captured actual
active f3e727e0 bundle main188737chars; SHA256d5433af23105c0b9fd31e7def96c0d5c855aa9cbebbf716e26a9d515cc970c63.
Patched only exact compiled validator/error blocks, removing stale source-map link.
Actual complete pre/post bundles execute locally: old422/0mockAI, patched200/1mockAI;
invalid evidence422 and wrong-auth401 preserved; zero network/provider requests.
Patched mainSHA2560609c53c33a6e267e2226e69f642d947198ebf63877288cd2a6e783641926323.
Exact compatible diff recorded under worker/releases/. Live settings retain confirmed
Free flag, AI binding and DO namespace d6bf26572a32437aa95d86e30e2d84d4.

One local edit used wrong working-directory prefix and failed before any write;
corrected path. Multipart capture initially selected first part, whose order varies;
corrected to exact module name and verified complete hash before patching. No partial
capture accepted. Production content deployment/source readback pending. No inference,
retry, batch resume, approval, provider/cost change, data mutation or main merge.
Real successful image remains unverified until creator deliberately retries Scene1.
