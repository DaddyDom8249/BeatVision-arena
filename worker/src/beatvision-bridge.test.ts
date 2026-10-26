import test from 'node:test';
import assert from 'node:assert/strict';
import { BEATVISION_BRIDGE_CONTRACT, beatVisionBridgeCapabilities, handleBeatVisionBridge } from './beatvision-bridge.ts';

test('BeatVision bridge advertises the free execution boundary', () => {
  assert.equal(BEATVISION_BRIDGE_CONTRACT, '2.0');
  const caps = beatVisionBridgeCapabilities({});
  assert.equal(caps.source_of_truth, 'beatvision');
  assert.equal(caps.cost_class, 'free');
  assert.deepEqual(caps.image.models, ['flux-schnell']);
  assert.deepEqual(caps.video.models, ['ltx-video', 'wan2.2-zerogpu']);
  assert.equal(caps.video.hf_zerogpu_configured, false);
  assert.equal(beatVisionBridgeCapabilities({ HF_VIDEO_TOKEN: 'bound' }).video.hf_zerogpu_configured, true);
  assert.equal(caps.assembly.provider, 'shotstack-sandbox');
});

test('BeatVision bridge rejects an unlocked creative state before provider execution', async () => {
  const request = new Request('https://arena.example/v2/scene-image', {
    method: 'POST',
    headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      payload: {
        source: { application: 'beatvision', contract: '2.0' },
        project: { id: 'project-1' },
        song: { title: 'Test', duration_seconds: 30 },
        analysis: { analysis_method: 'browser_audio_decode' },
        world: { version: 'world-1' },
        vision_lock: { locked: false },
        scene: { id: 'scene-1', start_time: 0, end_time: 4 }
      }
    })
  });

  const response = await handleBeatVisionBridge(request, { GATEWAY_TOKEN: 'test-token' }, async () => {
    throw new Error('provider execution must not occur for invalid bridge input');
  });

  assert.ok(response);
  assert.equal(response.status, 422);
  const data = await response.json();
  assert.equal(data.status, 'contract_validation_failed');
  assert.match(data.errors.join(' '), /vision_lock\.locked/);
});

function transcriptionPayload() {
  return {source:{application:'beatvision',contract:'2.0'},project:{id:'project-1'},song:{duration_seconds:249.59999948799998},
    analysis:{duration_seconds:249.59999948799998,transcript:'The phone rings.',transcription_method:'groq_whisper',transcription_provider:'groq',transcription_model:'whisper-large-v3-turbo',transcription_status:'completed'},
    world:{version:'world-1'},vision_lock:{locked:true,version:'lock-1'},scene:{id:'scene-1',start_time:0,end_time:4.992},generation:{model:'flux-schnell',cost_class:'free'}};
}
async function send(payload:any,token='test-token') {
 let calls=0,forwarded:any;
 const response=await handleBeatVisionBridge(new Request('https://arena.example/v2/scene-image',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({payload})}),{GATEWAY_TOKEN:'test-token'},async request=>{
   calls++;forwarded=await request.json();return new Response(JSON.stringify({ok:true,status:'completed',result:{images:[]}}),{status:200});
 });
 return {response:response!,calls,forwarded};
}
test('authenticated frozen transcription-only analysis can generate images without claiming local DSP',async()=>{
 const payload=transcriptionPayload(),before=structuredClone(payload);const r=await send(payload);
 assert.equal(r.response.status,200);assert.equal(r.calls,1);assert.deepEqual(r.forwarded.payload.analysis,payload.analysis);
 assert.equal(r.forwarded.payload.analysis.analysis_method,undefined);assert.deepEqual(payload,before);
});
test('incomplete, unknown and duration-mismatched transcription-only evidence fails before execution',async()=>{
 for(const patch of [{transcription_status:'failed'},{transcription_method:'unknown'},{transcription_provider:'other'},{transcription_model:'invented'},
   {duration_seconds:0},{duration_seconds:42},{transcript:''},{analysis_method:'made_up'},{duration_seconds:'249.59999948799998'}]){
  const p=transcriptionPayload();Object.assign(p.analysis,patch);const r=await send(p);assert.equal(r.response.status,422);assert.equal(r.calls,0);
 }
});
test('valid transcription evidence never bypasses gateway, locked-state or free-model guards',async()=>{
 let p=transcriptionPayload();let r=await send(p,'wrong-token');assert.equal(r.response.status,401);assert.equal(r.calls,0);
 p.vision_lock.locked=false;r=await send(p);assert.equal(r.response.status,422);assert.equal(r.calls,0);
 p=transcriptionPayload();p.generation.model='paid-model';r=await send(p);assert.equal(r.response.status,422);assert.equal(r.calls,0);
});
test('contract failure exposes an actionable safe error rather than a generic rejection',async()=>{
 const p=transcriptionPayload();p.analysis.transcription_status='failed';const r=await send(p),body=await r.response.json();
 assert.equal(r.response.status,422);assert.match(body.error.message,/analysis/i);assert.equal(body.error.code,'BRIDGE_CONTRACT_INVALID');
});
