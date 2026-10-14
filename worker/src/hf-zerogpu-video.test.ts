import test from "node:test";
import assert from "node:assert/strict";
import video from "./hf-zerogpu-video.ts";
import fs from "node:fs";

const BASE="https://beatvision.example/v1/video/wan-zero",secret="internal_gateway_secret";
const env={GATEWAY_TOKEN:secret,HF_VIDEO_TOKEN:"hf_free_only"};
const signed="https://mdofsinyofqbeapzfygu.supabase.co/storage/v1/object/sign/visual-assets/project/scene.jpg?token=temporary";
const providerBase="https://zerogpu-aoti-wan2-2-fp8da-aoti-faster.hf.space";
const videoUrl=providerBase+"/gradio_api/file=/tmp/gradio/generated.mp4";
function body(duration=2,model="wan2.2-zerogpu",imageUrl=signed) {
  return {contract_version:"1.1",operation:"animate",payload:{generation:{requested_model:model},
    storyboard:{scenes:[{scene:2,startTime:0,endTime:duration,
      visual_direction:"A spy walking through rain",camera_direction:"Tracking camera"}]},
    images:{images:[{image_url:imageUrl,approved:true,asset_id:"approved-image"}]}}};
}
function makeRequest(data=body()) {
  return new Request(BASE,{method:"POST",headers:{"Authorization":"Bearer "+secret,"Content-Type":"application/json"},body:JSON.stringify(data)});
}
function pollRequest(id="proof_event_123456789") {
  return new Request(BASE+"/jobs/"+id,{method:"GET",headers:{"Authorization":"Bearer "+secret}});
}
function withFetch(mock,action) {
  const old=globalThis.fetch;
  globalThis.fetch=mock;
  return Promise.resolve().then(action).finally(()=>{globalThis.fetch=old});
}

test("no gateway auth refuses without provider calls",async()=>{
  const res=await video.fetch(new Request(BASE,{method:"POST"}),env);
  assert.equal(res.status,401);
});
test("paid/unknown model rejected before billing or queue",async()=>{
  const res=await video.fetch(makeRequest(body(2,"veo-3")),env);
  assert.equal(res.status,422);
});
test("31-second scene cannot falsely appear fully animated",async()=>{
  const res=await video.fetch(makeRequest(body(31.14)),env);
  assert.equal(res.status,422);
  assert.match(JSON.stringify(await res.json()),/WAN_ZERO_GPU_SCENE_LIMIT/);
});
test("unapproved or unsigned image rejected before network calls",async()=>{
  const result=await video.fetch(makeRequest(body(2,"wan2.2-zerogpu","https://evil.example/image.png")),env);
  assert.equal(result.status,422);
});
test("paid or unknown HF account stops before fetching source or queuing",async()=>{
  let count=0;
  await withFetch(async url=>{count++;assert.match(String(url),/whoami-v2/);return Response.json({isPro:true})},async()=>{
    const response=await video.fetch(makeRequest(),env);
    assert.equal(response.status,503);
  });
  assert.equal(count,1);
});
test("approved image is fetched, uploaded to Gradio, then submitted exactly once",async()=>{
  const seen=[];
  await withFetch(async(url,options={})=>{
    const address=String(url);seen.push(address);
    if(address.endsWith("/api/whoami-v2"))return Response.json({isPro:false});
    if(address===signed){assert.equal(options.redirect,"manual");return new Response(Uint8Array.from([255,216,255,217]),{headers:{"Content-Type":"image/jpeg"}})}
    if(address===providerBase+"/gradio_api/upload"){
      assert.equal(options.method,"POST");
      assert.ok(options.body instanceof FormData);
      assert.equal(options.body.get("files")?.type,"image/jpeg");
      return Response.json(["/tmp/gradio/upload/scene.jpg"]);
    }
    if(address===providerBase+"/gradio_api/call/generate_video"){
      const data=JSON.parse(options.body);
      assert.equal(data.data[0].path,"/tmp/gradio/upload/scene.jpg");
      assert.equal(data.data[0].meta._type,"gradio.FileData");
      assert.equal(data.data[2],4);
      assert.equal(data.data[4],2);
      return Response.json({event_id:"proof_event_123456789"});
    }
    throw Error("Unexpected URL: "+address);
  },async()=>{
    const result=await video.fetch(makeRequest(),env);
    const data=await result.json();
    assert.equal(result.status,202,JSON.stringify(data));
    assert.equal(data.status,"submitted");
    assert.equal(data.event_id,"proof_event_123456789");
    assert.equal(data.approval_status,"awaiting_creator_review");
    assert.equal(data.result,undefined);
  });
  assert.equal(seen.length,4);
  assert.ok(seen.every(url=>!url.includes("pixazo.ai")));
});
test("Cloudflare manual redirect policy rejects a signed-image HTTP 302 without uploading or queueing",async()=>{
  const seen=[];
  await withFetch(async(url,options={})=>{
    seen.push(String(url));
    if(String(url).endsWith("/api/whoami-v2"))return Response.json({isPro:false});
    if(String(url)===signed){
      assert.equal(options.redirect,"manual");
      return new Response(null,{status:302,headers:{Location:"https://evil.example/steal"}});
    }
    throw Error("Unexpected provider request after redirected image: "+url);
  },async()=>{
    const response=await video.fetch(makeRequest(),env);
    const data=await response.json();
    assert.equal(response.status,503);
    assert.equal(data.error,"APPROVED_IMAGE_REDIRECT_REFUSED");
  });
  assert.equal(seen.length,2);
});

test("Cloudflare opaque redirect is refused instead of triggering upload",async()=>{
  let calls=0;
  await withFetch(async(url,options={})=>{
    calls++;
    if(String(url).endsWith("/api/whoami-v2"))return Response.json({isPro:false});
    if(String(url)===signed){
      assert.equal(options.redirect,"manual");
      return {type:"opaqueredirect",status:0,ok:false};
    }
    throw Error("Unexpected provider request");
  },async()=>{
    const response=await video.fetch(makeRequest(),env);
    const data=await response.json();
    assert.equal(response.status,503);
    assert.equal(data.error,"APPROVED_IMAGE_REDIRECT_REFUSED");
  });
  assert.equal(calls,2);
});

test("poll returns actual video URL only on confirmed complete SSE event",async()=>{
  await withFetch(async(url,options)=>{
    assert.match(String(url),/gradio_api\/call\/generate_video\/proof_event_123456789/);
    assert.equal(options.headers.Accept,"text/event-stream");
    return new Response('event: generating\ndata: ["still working"]\n\nevent: complete\ndata: [{"video":{"url":"'+videoUrl+'"}},42]\n\n');
  },async()=>{
    const response=await video.fetch(pollRequest(),env);
    const data=await response.json();
    assert.equal(response.status,200,JSON.stringify(data));
    assert.equal(data.status,"completed");
    assert.equal(data.result.clips[0].video_url,videoUrl);
    assert.equal(data.result.clips[0].approval_status,"awaiting_creator_review");
  });
});
test("queue status timeout is processing, not completed or resubmitted",async()=>{
  let calls=0;
  await withFetch(async()=>{calls++;throw new DOMException("operation timed out","TimeoutError")},async()=>{
    const response=await video.fetch(pollRequest(),env);
    const data=await response.json();
    assert.equal(response.status,202);
    assert.equal(data.status,"processing");
  });
  assert.equal(calls,1);
});
test("quota failure refuses without retry or paid fallback",async()=>{
  let calls=0;
  await withFetch(async(url)=>{
    calls++;
    return calls===1?Response.json({isPro:false}):new Response("quota exhausted",{status:429});
  },async()=>{
    const response=await video.fetch(makeRequest(),env);
    const data=await response.json();
    assert.equal(response.status,503);
    assert.equal(data.status,"free_provider_unavailable");
  });
  assert.equal(calls,2);
});
test("poll cannot accept unknown host in completion payload",async()=>{
  await withFetch(async()=>new Response('event: complete\ndata: [{"url":"https://evil.example/video.mp4"},42]\n\n'),async()=>{
    const response=await video.fetch(pollRequest(),env);
    assert.equal(response.status,503);
  });
});

test("both validated entry and provider gateway route status GET to ZeroGPU",()=>{
  const entry=fs.readFileSync(new URL("./arena-validated-entry.ts",import.meta.url),"utf8");
  const router=fs.readFileSync(new URL("./video-fallback-gateway.ts",import.meta.url),"utf8");
  assert.match(entry,/path\.startsWith\('\/v1\/video\/wan-zero\/jobs\/'\)/);
  assert.match(router,/path\.startsWith\('\/v1\/video\/wan-zero\/jobs\/'\)/);
});

test("Gradio SSE error ends job, gives safe classification, never submits another",async()=>{
  let calls=0;
  await withFetch(async(url)=>{
    calls++;
    assert.match(String(url),/\/gradio_api\/call\/generate_video\/proof_event_123456789/);
    return new Response('event: error\ndata: {"error":"CUDA out of memory at /srv/app.py credential=secret"}\n\n');
  },async()=>{
    const response=await video.fetch(pollRequest(),env);
    const data=await response.json();
    assert.equal(response.status,200);
    assert.equal(data.ok,true);
    assert.equal(data.status,"failed");
    assert.equal(data.terminal,true);
    assert.equal(data.retry_automatically,false);
    assert.equal(data.failure_category,"gpu_runtime");
    assert.doesNotMatch(JSON.stringify(data),/credential=secret|srv\/app.py/);
  });
  assert.equal(calls,1);
});
test("Unknown Gradio error remains terminal, no raw path disclosure",async()=>{
  await withFetch(async()=>new Response('event: error\ndata: {"error":"Exception /tmp/secrets/private.txt"}\n\n'),async()=>{
    const response=await video.fetch(pollRequest(),env);
    const data=await response.json();
    assert.equal(data.status,"failed");
    assert.equal(data.failure_category,"provider_runtime");
    assert.doesNotMatch(JSON.stringify(data),/\/tmp\/secrets/);
  });
});
