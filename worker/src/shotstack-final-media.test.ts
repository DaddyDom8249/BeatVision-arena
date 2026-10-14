import test from 'node:test';
import assert from 'node:assert/strict';
import { getShotstackRenderStatus } from './shotstack-gateway.ts';

const origin='https://shotstack-api-stage-output.s3-ap-southeast-2.amazonaws.com';
const env={GATEWAY_TOKEN:'unit-auth',SHOTSTACK_API_KEY:'unit-shotstack-key'};
const request=new Request('https://arena.example/v1/video/assemble/status/id1',{
  method:'POST',headers:{Authorization:'Bearer unit-auth'}
});
function status(url=origin+'/final.mp4'){return Response.json({response:{status:'done',duration:10,url}})}
function probe(streams:any[],format='mov,mp4,m4a,3gp,3g2,mj2',duration='10'){
  return Response.json({response:{metadata:{format:{duration,format_name:format},streams}}});
}
const video={codec_type:'video',codec_name:'h264',duration:'10'};
const audio={codec_type:'audio',codec_name:'aac',duration:'10'};
async function run(statusResponse:Response,probeResponse:Response|null){
  let calls:string[]=[];
  const old=globalThis.fetch;
  globalThis.fetch=async input=>{
    const url=String(input);
    calls.push(url);
    if(url.includes('/edit/stage/render/'))return statusResponse.clone();
    if(url.includes('/edit/stage/probe/')&&probeResponse)return probeResponse.clone();
    throw Error('Unexpected provider call '+url);
  };
  try {
    const response=await getShotstackRenderStatus(request,env,'id1',10);
    return{response,data:await response.json(),calls};
  }finally{globalThis.fetch=old}
}
test('probe proves MP4 video plus song audio and measured duration before PASS',async()=>{
  const result=await run(status(),probe([video,audio]));
  assert.equal(result.data.status,'done');
  assert.equal(result.data.result.render_integrity,'PASS');
  assert.equal(result.data.result.media_validation.probed,true);
  assert.equal(result.data.result.media_validation.duration_seconds,10);
  assert.equal(result.calls.length,2);
  assert.match(result.calls[1], /\/edit\/stage\/probe\//);
});
test('provider done with missing audio is failed, never complete',async()=>{
  const result=await run(status(),probe([video]));
  assert.equal(result.data.status,'failed');
  assert.equal(result.data.result.error,'FINAL_MEDIA_STREAMS_INVALID');
});
test('provider done with HTML rather than MP4 container is failed',async()=>{
  const result=await run(status(),probe([video,audio],'html'));
  assert.equal(result.data.result.error,'FINAL_MEDIA_STREAMS_INVALID');
});
test('provider done with wrong probed duration is failed despite status.duration matching plan',async()=>{
  const result=await run(status(),probe([{...video,duration:'7'},{...audio,duration:'7'}],'mov,mp4','7'));
  assert.equal(result.data.result.error,'FINAL_MEDIA_DURATION_MISMATCH');
});
test('failed or unreachable probe cannot claim completed media',async()=>{
  const result=await run(status(),new Response('unavailable',{status:500}));
  assert.equal(result.data.result.error,'FINAL_MEDIA_PROBE_FAILED');
});
test('untrusted output host never triggers probe',async()=>{
  const result=await run(status('https://evil.example/test.mp4'),null);
  assert.equal(result.data.result.error,'FINAL_MEDIA_OUTPUT_HOST_UNTRUSTED');
  assert.equal(result.calls.length,1);
});
