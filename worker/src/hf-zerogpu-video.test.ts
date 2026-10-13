import test from "node:test";
import assert from "node:assert/strict";
import video from "./hf-zerogpu-video.ts";

const BASE="https://beatvision.example/v1/video/wan-zero";
const token="internal_gateway_secret";
const env={GATEWAY_TOKEN:token,HF_VIDEO_TOKEN:"hf_test_free_account"};
const signed="https://mdofsinyofqbeapzfygu.supabase.co/storage/v1/object/sign/visual-assets/owner/scene.jpg?token=temporary";
function request(duration=2,model="wan2.2-zerogpu") {
  return new Request(BASE,{method:"POST",headers:{"Authorization":"Bearer "+token,"Content-Type":"application/json"},
    body:JSON.stringify({contract_version:"1.1",operation:"animate",
      payload:{generation:{requested_model:model},
        storyboard:{scenes:[{scene:2,startTime:0,endTime:duration,visual_direction:"Walking under falling rain"}]},
        images:{images:[{image_url:signed,approved:true,asset_id:"approved-image-1"}]}}})});
}
test("refuses missing gateway auth without any external calls", async()=>{
  const result=await video.fetch(new Request(BASE,{method:"POST"}),env);
  assert.equal(result.status,401);
});
test("rejects unsupported paid/unknown model before provider calls", async()=>{
  const result=await video.fetch(request(2,"veo-3"),env);
  assert.equal(result.status,422);
});
test("rejects incomplete 249-second scene without pretending complete motion",async()=>{
  const result=await video.fetch(request(31.14),env);
  assert.equal(result.status,422);
  assert.match(JSON.stringify(await result.json()),/WAN_ZERO_GPU_SCENE_LIMIT/);
});
test("rejects unsigned images without external calls",async()=>{
  const req=new Request(BASE,{method:"POST",headers:{"Authorization":"Bearer "+token},
    body:JSON.stringify({contract_version:"1.1",operation:"animate",payload:{
      generation:{requested_model:"wan2.2-zerogpu"},storyboard:{scenes:[{scene:1,startTime:0,endTime:2}]},
      images:{images:[{image_url:"https://evil.example/scene.jpg",approved:true}]}}})});
  assert.equal((await video.fetch(req,env)).status,422);
});
test("unknown PRO/free account status blocks without queue submission", async()=>{
  let requests=0;const old=globalThis.fetch;globalThis.fetch=async url=>{
    requests++;
    assert.match(String(url),/whoami-v2/);
    return Response.json({isPro:true});
  };
  try {const response=await video.fetch(request(),env);
    assert.equal(response.status,503);assert.equal(requests,1);
  }finally{globalThis.fetch=old;}
});
test("verified free account returns actual trusted MP4 and requires creator review", async()=>{
  const old=globalThis.fetch;let index=0;
  globalThis.fetch=async(url,opts)=>{
    index++;
    if(index===1){assert.match(String(url),/whoami-v2/);return Response.json({isPro:false});}
    if(index===2){const data=JSON.parse(opts.body);assert.equal(data.data[4],2);return Response.json({event_id:"proof_event_123456789"});}
    if(index===3){return new Response("event: complete\ndata: [{\"url\":\"https://zerogpu-aoti-wan2-2-fp8da-aoti-faster.hf.space/gradio_api/file=/tmp/example.mp4\"},42]\n\n",{status:200});}
    throw new Error("Unexpected provider request");
  };
  try {const response=await video.fetch(request(),env);const data=await response.json();
    assert.equal(response.status,200,JSON.stringify(data));assert.equal(index,3);
    assert.equal(data.result.clips[0].generation_type,"GENERATIVE_VIDEO");
    assert.equal(data.result.clips[0].approval_status,"awaiting_creator_review");
  }finally{globalThis.fetch=old;}
});
test("provider refusal blocks rather than silently sending Pixazo or claiming motion",async()=>{
  const old=globalThis.fetch;let index=0;globalThis.fetch=async()=>{index++;return index===1?Response.json({isPro:false}):new Response("quota exhausted",{status:429});};
  try{const response=await video.fetch(request(),env);const json=await response.json();
    assert.equal(response.status,503);assert.equal(json.status,"free_provider_unavailable");assert.equal(index,2);
  }finally{globalThis.fetch=old;}
});
