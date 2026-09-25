import fs from 'node:fs';

const required=[
  'app.js','provider-contracts.js','log-guard.js','motion-bridge.js','animation-bridge.js','worker/wrangler.toml',
  'worker/src/arena-entry.ts','worker/src/arena-validated-entry.ts','worker/src/visual-beat-engine.ts','worker/src/pixazo-media-gateway-fixed.ts',
  'worker/src/external-provider-gateway.ts','worker/src/shotstack-gateway.ts','worker/src/video-fallback-gateway.ts',
  'worker/src/animation-jobs.ts','worker/src/render-integrity.ts','worker/src/skills.ts','worker/src/index.ts','worker/src/storyboard-validator.ts'
];
for(const file of required)if(!fs.existsSync(file))throw new Error(`Missing required file: ${file}`);
const read=file=>fs.readFileSync(file,'utf8');
const active=required.map(read).join('\n');
for(const banned of ['huggingface','HF_API_TOKEN','sd3.5','stable-diffusion-3.5','pollinations','gemini'])if(active.toLowerCase().includes(banned.toLowerCase()))throw new Error(`Forbidden active-path reference found: ${banned}`);
const contracts=read('provider-contracts.js');
for(const operation of ['analyzeAudio','revealWorld','worldAssets','storyboard','sceneImages','animate','assemble','generateMusic','storeAsset'])if(!contracts.includes(operation))throw new Error(`Missing contract operation: ${operation}`);
const app=read('app.js');
if(!app.includes('executeSceneBatch'))throw new Error('Per-scene batching is missing.');
if(!app.includes('storyboard.scenes.slice(0,64)'))throw new Error('Expected only the browser safety ceiling, not a small fixed scene target.');
if(!app.includes('delete single.images'))throw new Error('Scene-image request isolation is missing.');
if(!app.includes('sceneNumber'))throw new Error('Scene identity matching is missing.');
const bridge=read('animation-bridge.js');
if(!bridge.includes('storyboard:state.storyboard,motion:state.motion'))throw new Error('Authoritative storyboard metadata is not passed into assembly.');
const beatEngine=read('worker/src/visual-beat-engine.ts');
for(const token of ['VisualBeat','compactAudio','visualBeatSystemPrompt','normalizeVisualBeats','coverage_ratio','semantic_grounding_failures','semantic_duplicate_rate','unexplained_reuse','reusePolicy'])if(!beatEngine.includes(token))throw new Error(`Visual beat engine missing ${token}.`);
if(!beatEngine.includes('lyricMeaning')||!beatEngine.includes('narrativePurpose')||!beatEngine.includes('characterState')||!beatEngine.includes('visualContinuityRequirements'))throw new Error('Visual beat metadata is incomplete.');
const language=read('worker/src/external-provider-gateway.ts');
if(!language.includes("import { compactAudio, normalizeVisualBeats, toStoryboard, visualBeatSystemPrompt } from './visual-beat-engine';"))throw new Error('Storyboard gateway is not using the visual beat engine.');
if(!language.includes('visual_coverage_insufficient'))throw new Error('Storyboard coverage quality gate is missing.');
if(!language.includes('BeatVision quality gate'))throw new Error('Storyboard failure must explain why reuse cannot silently fill gaps.');
const arena=read('worker/src/arena-entry.ts');
if(!/const\s+scenes\s*=\s*Array\.isArray\(payload\?\.storyboard\?\.scenes\)\s*\?\s*payload\.storyboard\.scenes\s*:\s*\[\]\s*;/.test(arena))throw new Error('Worker still has a fixed scene-count truncation.');
if(!arena.includes('Scene image gateway expects one visual beat per request'))throw new Error('Scene generation must remain isolated per visual beat.');
if(!arena.includes('beatId'))throw new Error('Generated images must retain visual beat identity.');
if(!arena.includes("pixazoPost('/getImage/v1/getSDXLImage'"))throw new Error('SDXL scene generation path is missing.');
if(!arena.includes("pixazoPost('/flux-1-schnell/v1/getData'"))throw new Error('Flux Schnell fallback path is missing.');
if(!arena.includes('clip(prompt, 2048)'))throw new Error('Flux Schnell prompt length guard is missing.');
if(!arena.includes('pixazoStatus(key, requestId, \'sdxl\')'))throw new Error('SDXL async status polling path is missing.');
if(!arena.includes('TIMEOUT_MS = 45000'))throw new Error('Pixazo scene polling timeout guard is missing.');
const pixazo=read('worker/src/pixazo-media-gateway-fixed.ts');
if(!pixazo.includes('/ltx-video/v1/image-to-video'))throw new Error('LTX image-to-video route is missing.');
if(!pixazo.includes('LTX_TIMEOUT_MS = 300000')||!pixazo.includes('LTX_POLL_INTERVAL_MS = 7000'))throw new Error('LTX polling deadline/interval guard is missing.');
const ltxPolls=Math.floor(300000/7000)+1;if(1+ltxPolls>50)throw new Error(`LTX polling can exceed the free Worker subrequest ceiling: ${1+ltxPolls}`);
if(!pixazo.includes('timed out after ${LTX_TIMEOUT_MS / 1000} seconds'))throw new Error('LTX timeout error must report the actual configured timeout.');
const animation=read('worker/src/animation-jobs.ts');
for(const token of ['generation_type','GENERATIVE_VIDEO','asset_id','pushClipOnce','alarm_fired','last_error'])if(!animation.includes(token))throw new Error(`Animation job integrity/recovery contract missing ${token}.`);
const integrity=read('worker/src/render-integrity.ts');
for(const token of ['buildCoverageManifest','assertSufficientCoverage','INSUFFICIENT_UNIQUE_VISUAL_COVERAGE','MEDIA_INTEGRITY_DUPLICATE_ASSET','MEDIA_INTEGRITY_DUPLICATE_SOURCE','timeline_start_seconds','timeline_end_seconds'])if(!integrity.includes(token))throw new Error(`Render integrity guard missing ${token}.`);
const shotstack=read('worker/src/shotstack-gateway.ts');
for(const token of ['probeVideo','/v1/probe/','buildCoverageManifest','assertSufficientCoverage','render_integrity:\'PASS\'','FINAL_MEDIA_DURATION_MISMATCH','timeline_start_seconds','timeline_end_seconds','STORYBOARD_MASTER_TIMELINE'])if(!shotstack.includes(token))throw new Error(`Shotstack master-timeline enforcement missing ${token}.`);
if(shotstack.includes('function cycleOrder'))throw new Error('Forbidden clip recycling function cycleOrder remains in active assembly.');
if(animation.includes('CAMERA_MOTION_FALLBACK')||integrity.includes('CAMERA_MOTION_FALLBACK')||shotstack.includes('CAMERA_MOTION_FALLBACK')||read('worker/src/video-fallback-gateway.ts').includes('CAMERA_MOTION_FALLBACK'))throw new Error('Forbidden camera-motion fallback remains in the active Arena production path.');
if(shotstack.includes('while (cursor < targetDuration'))throw new Error('Forbidden assembly extension loop remains; assembly must consume each validated asset at most once.');
if(shotstack.includes('previousScene'))throw new Error('Old adjacent-scene-only reuse guard remains; it is insufficient and must not be used as the assembly invariant.');
const skills=read('worker/src/skills.ts');
for(const token of ['normalizeWorldReveal','assertWorldLocked','compileGenerationPrompt','timelineGuardian','validateMediaRecord','providerResult'])if(!skills.includes(token))throw new Error(`Arena skill layer missing ${token}.`);
const validator=read('worker/src/storyboard-validator.ts');
for(const token of ['partial = false','TIMELINE_EPSILON_SECONDS'])if(!validator.includes(token))throw new Error(`Storyboard validator partial/timestamp tolerance missing ${token}.`);
const validated=read('worker/src/arena-validated-entry.ts');
if(!validated.includes("const partial = operation === 'sceneImages'"))throw new Error('Scene image validation must allow isolated per-scene requests.');
if(!validated.includes('export { BeatVisionAnimationJob }'))throw new Error('Durable Object class is not exported by the deployed Worker entrypoint.');
const fallback=read('worker/src/video-fallback-gateway.ts');
if(fallback.includes('fallback:{')||fallback.includes('shotstack-camera-motion'))throw new Error('Fallback capability is still advertised by the active Arena gateway.');
if(!fallback.includes('enrichMotionResponse')||!fallback.includes('approval_status'))throw new Error('Motion provenance enrichment is missing from the active Arena gateway.');
for(const token of ['approval_status','generation_type:\'GENERATIVE_VIDEO\'','asset_id'])if(!fallback.includes(token))throw new Error(`Motion output identity contract missing ${token}.`);
const wrangler=read('worker/wrangler.toml');
if(!wrangler.includes('main = "src/arena-validated-entry.ts"'))throw new Error('Wrangler entrypoint does not match the deployed validated Worker.');
console.log('STATIC AUDIT PASS');
console.log(`Checked ${required.length} source/config files.`);
console.log('Visual planning: song-grounded dynamic beats with coverage, semantic-grounding, duplicate, and reuse gates.');
console.log('Media assembly: storyboard master-timeline placement, actual source probing, unique asset/source enforcement, hard coverage gate, generative-video provenance, and final duration verification.');
