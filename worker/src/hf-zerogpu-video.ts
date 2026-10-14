import { isGatewayAuthorized } from './gateway-auth.ts';
// BeatVision ZeroGPU image-to-video adapter: short preview, free accounts only.
// Two-phase Gradio upload -> submit, then bounded status polling.
// No provider wallet, paid failover, automatic retry, or approved asset mutation.
const SPACE = "https://zerogpu-aoti-wan2-2-fp8da-aoti-faster.hf.space";
const HUB = "https://huggingface.co";
const MODEL = "wan2.2-zerogpu";
const MAX_SECONDS = 3;
const MAX_UPLOAD = 8 * 1024 * 1024;
const ALLOWED_IMAGE_HOST = "mdofsinyofqbeapzfygu.supabase.co";
const JOB_PATH = /^\/v1\/video\/wan-zero\/jobs\/([a-zA-Z0-9_-]{8,130})$/;
const NEGATIVE_PROMPT = "still frame, frozen subject, distorted hands, extra limbs, watermark";

function reply(data: unknown, status=200) {
  return new Response(JSON.stringify(data), {status, headers: {
    "Content-Type":"application/json","Cache-Control":"no-store",
    "X-Content-Type-Options":"nosniff"
  }});
}
function validSource(value: unknown) {
  try {
    const u=new URL(String(value));
    return u.protocol==="https:" && u.hostname===ALLOWED_IMAGE_HOST
      && u.pathname.startsWith("/storage/v1/object/sign/visual-assets/")
      && !!u.searchParams.get("token");
  } catch {return false;}
}
function motionScene(body: any) {
  const scenes=body?.payload?.storyboard?.scenes;
  const images=body?.payload?.images?.images;
  if(!Array.isArray(scenes)||scenes.length!==1||!Array.isArray(images)||images.length!==1)
    throw Error("ONE_APPROVED_SCENE_AND_IMAGE_REQUIRED");
  const scene=scenes[0],image=images[0];
  if(image?.approved!==true||!validSource(image?.image_url))
    throw Error("APPROVED_SIGNED_SCENE_IMAGE_REQUIRED");
  const start=Number(scene.startTime??scene.start_time),end=Number(scene.endTime??scene.end_time);
  const duration=end-start;
  if(!Number.isFinite(duration)||duration<0.5||duration>MAX_SECONDS)
    throw Error("WAN_ZERO_GPU_SCENE_LIMIT: only 0.5-3-second pilot scenes are allowed.");
  const directions=[scene.visual_direction,scene.visualDirection,
    scene.movement_direction,scene.movementDirection,
    scene.camera_direction,scene.cameraDirection].filter(Boolean).join(". ");
  const prompt=("Cinematic image-to-video. Visible subject movement (walk, turn, gesture, shift posture). "+directions).slice(0,1100);
  return {imageUrl:image.image_url,imageId:String(image.asset_id||image.image_id||image.scene_id||""),
    sceneNumber:Number(scene.scene_number||scene.scene||1),duration,prompt};
}
function providerVideoUrl(value: any): string {
  const item=Array.isArray(value)?value[0]:value;
  const video=item?.video??item?.value??item;
  const candidate=typeof video==="string"?video:
    (typeof video?.url==="string"?video.url:
     typeof video?.path==="string"?video.path:"");
  if(!candidate)throw Error("WAN_ZERO_GPU_VIDEO_URL_MISSING");
  const url=candidate.startsWith("/tmp/")
    ?new URL("/gradio_api/file="+candidate,SPACE)
    :new URL(candidate,SPACE);
  if(url.protocol!=="https:"||url.hostname!==new URL(SPACE).hostname
      ||!/\/(?:gradio_api\/)?file=/.test(url.pathname))throw Error("WAN_ZERO_GPU_VIDEO_URL_UNTRUSTED");
  return url.href;
}
// Gradio SSE errors are terminal. Never expose raw third-party tracebacks,
// stack paths, credentials or error payloads to browser clients.
function classifyProviderFailure(raw:string) {
  const value=raw.toLowerCase().slice(0,2500);
  if(/quota|daily limit|credits|gpu.?time|free tier|allowance/.test(value))
    return {failure_category:"free_quota",message:"The Hugging Face free GPU allowance is unavailable or exhausted. No paid fallback was used."};
  if(/queue full|capacity|overloaded|too many requests|busy|gpu unavailable/.test(value))
    return {failure_category:"capacity",message:"The free Hugging Face queue is currently unavailable. This job failed."};
  if(/input image|invalid image|upload|image format|pil\.|cannot identify image|file not found/.test(value))
    return {failure_category:"input",message:"Hugging Face could not read the approved source image."};
  if(/memory|cuda|oom/.test(value))
    return {failure_category:"gpu_runtime",message:"Hugging Face ran out of GPU resources rendering the preview."};
  return {failure_category:"provider_runtime",message:"Hugging Face reported a render failure. No AI clip was produced."};
}
function parseEvent(input:string): {status:"completed";video:string}|{status:"failed";failure_category:string;message:string}|null {
  for(const part of input.split(/\r?\n\r?\n/)) {
    const event=/^event:\s*([a-z_]+)\s*$/m.exec(part)?.[1];
    if(event!=="complete"&&event!=="error")continue;
    const raw=/^data:\s*(.+)$/m.exec(part)?.[1]||"";
    if(event==="error") {
      let value:any=raw;
      try{value=JSON.parse(raw)}catch{/* Provider may send a plain text error. */}
      const detail=typeof value==="string"?value:
        (typeof value?.error==="string"?value.error:
         typeof value?.message==="string"?value.message:raw);
      return {status:"failed",...classifyProviderFailure(String(detail))};
    }
    let value:any;
    try{value=JSON.parse(raw)}catch{throw Error("WAN_ZERO_GPU_BAD_COMPLETION")}
    return {status:"completed",video:providerVideoUrl(value)};
  }
  return null;
}
async function requireFreeAccount(token:string) {
  const response=await fetch(HUB+"/api/whoami-v2",{
    headers:{Authorization:"Bearer "+token,Accept:"application/json"},
    signal:AbortSignal.timeout(12000)
  });
  if(!response.ok)throw Error("WAN_ZERO_GPU_IDENTITY_UNVERIFIED");
  const identity:any=await response.json();
  if(identity?.isPro!==false)throw Error("WAN_ZERO_GPU_FREE_ACCOUNT_NOT_VERIFIED");
}
async function uploadApprovedImage(sceneImageUrl:string,token:string) {
  // Cloudflare Workers only supports "follow" and "manual"; the browser's
  // "error" redirect mode is unsupported in workerd. Never follow source-image
  // redirects: reject all 3xx/opaqueredirect responses before reading bytes.
  const src=await fetch(sceneImageUrl,{redirect:"manual",signal:AbortSignal.timeout(15000)});
  if(src.type==="opaqueredirect"||(src.status>=300&&src.status<400))
    throw Error("APPROVED_IMAGE_REDIRECT_REFUSED");
  if(!src.ok)throw Error("APPROVED_IMAGE_FETCH_FAILED");
  const mime=String(src.headers.get("Content-Type")||"").split(";")[0].toLowerCase();
  if(!["image/jpeg","image/png","image/webp"].includes(mime))
    throw Error("APPROVED_IMAGE_FORMAT_UNSUPPORTED");
  const headerSize=Number(src.headers.get("Content-Length")||0);
  if(headerSize>MAX_UPLOAD)throw Error("APPROVED_IMAGE_TOO_LARGE");
  const bytes=await src.arrayBuffer();
  if(!bytes.byteLength||bytes.byteLength>MAX_UPLOAD)throw Error("APPROVED_IMAGE_TOO_LARGE");
  const filename=mime==="image/png"?"source.png":mime==="image/webp"?"source.webp":"source.jpg";
  const form=new FormData();
  form.append("files",new File([bytes],filename,{type:mime}));
  const uploaded=await fetch(SPACE+"/gradio_api/upload",{
    method:"POST",headers:{Authorization:"Bearer "+token},
    body:form,signal:AbortSignal.timeout(22000)
  });
  if(!uploaded.ok)throw Error("WAN_ZERO_GPU_UPLOAD_REJECTED");
  const paths:any=await uploaded.json();
  const path=Array.isArray(paths)?paths[0]:null;
  if(typeof path!=="string"||!/^\/tmp\/[a-zA-Z0-9/_\-.]{3,512}$/.test(path))
    throw Error("WAN_ZERO_GPU_UPLOAD_PATH_INVALID");
  return {path,orig_name:filename,meta:{_type:"gradio.FileData"}};
}
async function submit(scene:ReturnType<typeof motionScene>,token:string) {
  const file=await uploadApprovedImage(scene.imageUrl,token);
  const request=await fetch(SPACE+"/gradio_api/call/generate_video",{
    method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+token},
    body:JSON.stringify({data:[file,scene.prompt,4,NEGATIVE_PROMPT,scene.duration,1,1,42,false]}),
    signal:AbortSignal.timeout(22000)
  });
  if(!request.ok)return reply({ok:false,status:"free_provider_unavailable",http_status:request.status},503);
  const result:any=await request.json();
  const eventId=String(result?.event_id||"");
  if(!/^[a-zA-Z0-9_-]{8,130}$/.test(eventId))throw Error("WAN_ZERO_GPU_EVENT_ID_MISSING");
  return reply({ok:true,contract_version:"1.1",status:"submitted",capability:"video",
    cost_class:"free",provider:"hf-zerogpu",model:MODEL,event_id:eventId,
    source_image_id:scene.imageId,scene_number:scene.sceneNumber,
    requested_duration_seconds:scene.duration,approval_status:"awaiting_creator_review"},202);
}
async function poll(eventId:string,token:string) {
  // The Gradio queue responds as SSE on a separate request. Stop after 12s;
  // the browser retries status, but generation is submitted only once.
  let response:Response;
  try {
    response=await fetch(SPACE+"/gradio_api/call/generate_video/"+encodeURIComponent(eventId),{
      headers:{Authorization:"Bearer "+token,Accept:"text/event-stream"},
      signal:AbortSignal.timeout(12000)
    });
  } catch(error) {
    if(error instanceof Error&&/abort|timeout/i.test(error.name+" "+error.message))
      return reply({ok:true,status:"processing",event_id:eventId},202);
    throw error;
  }
  if(!response.ok)return reply({ok:false,status:"free_provider_unavailable",http_status:response.status},503);
  let sse:string;
  try{sse=await response.text()}catch(error){
    if(error instanceof Error&&/abort|timeout/i.test(error.name+" "+error.message))
      return reply({ok:true,status:"processing",event_id:eventId},202);
    throw error;
  }
  if(sse.length>500000)throw Error("WAN_ZERO_GPU_EVENT_TOO_LARGE");
  const outcome=parseEvent(sse);
  if(!outcome)return reply({ok:true,status:"processing",event_id:eventId},202);
  if(outcome.status==="failed")return reply({ok:true,status:"failed",event_id:eventId,
    error_code:"WAN_ZERO_GPU_PROVIDER_ERROR",failure_category:outcome.failure_category,
    error:outcome.message,terminal:true,retry_automatically:false});
  const video=outcome.video;
  return reply({ok:true,contract_version:"1.1",capability:"video",provider:"hf-zerogpu",
    model:MODEL,status:"completed",cost_class:"free",generation_type:"GENERATIVE_VIDEO",
    result:{status:"completed",video_url:video,scene_count:1,generation_type:"GENERATIVE_VIDEO",
      clips:[{status:"animated",video_url:video,provider:"hf-zerogpu",model:MODEL,
        generation_type:"GENERATIVE_VIDEO",approval_status:"awaiting_creator_review"}]}}); 
}
export default {
  async fetch(r:Request,e:any) {
    if(!isGatewayAuthorized(r,e))
      return reply({ok:false,status:"unauthorized"},401);
    const token=String(e.HF_VIDEO_TOKEN||"").trim();
    if(!token)return reply({ok:false,status:"provider_unavailable",error:"HF_VIDEO_TOKEN not configured"},503);
    const path=new URL(r.url).pathname,job=JOB_PATH.exec(path);
    if(job) {
      if(r.method!=="GET")return reply({ok:false,status:"invalid_method",error:"GET required"},405);
      try{return await poll(job[1],token)}
      catch(error){return reply({ok:false,status:"free_provider_unavailable",
        error:String(error instanceof Error?error.message:error).slice(0,250)},503)}
    }
    if(path!=="/v1/video/wan-zero"||r.method!=="POST")
      return reply({ok:false,status:"invalid_method",error:"POST required"},405);
    let body:any;
    try{body=await r.json()}catch{return reply({ok:false,status:"invalid_input"},400)}
    if(body?.contract_version!=="1.1"||body?.operation!=="animate"
        ||body?.payload?.generation?.requested_model!==MODEL)
      return reply({ok:false,status:"contract_mismatch",error:"Explicit wan2.2-zerogpu selection required."},422);
    let scene:ReturnType<typeof motionScene>;
    try{scene=motionScene(body)}catch(error){return reply({ok:false,status:"invalid_scene",
      error:String(error instanceof Error?error.message:error)},422)}
    try {
      await requireFreeAccount(token);
      return await submit(scene,token);
    }catch(error){return reply({ok:false,status:"free_provider_unavailable",
      error:String(error instanceof Error?error.message:error).slice(0,250)},503)}
  }
};
