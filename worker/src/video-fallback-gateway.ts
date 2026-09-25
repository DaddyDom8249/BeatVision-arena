import pixazo from './pixazo-media-gateway-fixed';
import motionResilient from './pixazo-motion-resilience';
import shotstack from './shotstack-gateway';
import externalProvider from './external-provider-gateway';

function cors(r:Request,e:any){const o=r.headers.get('Origin')||'';const allowed=String(e.ALLOWED_ORIGIN||'').split(',').map((x:string)=>x.trim()).filter(Boolean);const h:Record<string,string>={'Vary':'Origin','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type,X-BeatVision-Contract,Authorization,X-BeatVision-Request','Access-Control-Max-Age':'86400'};if(o&&allowed.includes(o))h['Access-Control-Allow-Origin']=o;return h;}
function json(r:Request,e:any,d:unknown,status=200){return new Response(JSON.stringify(d,null,2),{status,headers:{'Content-Type':'application/json',...cors(r,e)}});}
function auth(r:Request,e:any){return !!e.GATEWAY_TOKEN&&r.headers.get('Authorization')===`Bearer ${e.GATEWAY_TOKEN}`;}
function enrichMotionResponse(response:Response,body:any,requestId:string){
  if(response.status>=400)return response;
  return response.clone().json().then((data:any)=>{
    const clips=Array.isArray(data?.result?.clips)?data.result.clips:null;
    if(!clips)return response;
    const scenes=Array.isArray(body?.payload?.storyboard?.scenes)?body.payload.storyboard.scenes:[];
    const images=Array.isArray(body?.payload?.images?.images)?body.payload.images.images:[];
    const enriched=clips.map((clip:any,index:number)=>{
      const scene=Number(clip?.scene||scenes[index]?.scene||index+1);
      const image=images.find((x:any)=>Number(x?.scene)===scene)||images[index];
      const sourceImageId=String(image?.asset_id||image?.image_id||image?.beatId||image?.beat_id||`scene-${scene}`);
      const providerRequest=String(clip?.pixazo_request_id||`direct-${requestId}-scene-${scene}`);
      return {...clip,scene,asset_id:String(clip?.asset_id||`motion:${requestId}:scene:${scene}:${providerRequest}`),generation_type:'GENERATIVE_VIDEO',provider:'pixazo',model:clip?.model||'ltx-video',source_image_id:sourceImageId,approval_status:'approved_for_current_pipeline'};
    });
    data.result={...data.result,clips:enriched,unique_asset_count:new Set(enriched.map((x:any)=>x.asset_id)).size,generation_type:'GENERATIVE_VIDEO'};
    return new Response(JSON.stringify(data,null,2),{status:response.status,headers:Object.fromEntries(new Headers(response.headers))});
  }).catch(()=>response);
}
export default {async fetch(r:Request,e:any){
  if(r.method==='OPTIONS'){const o=r.headers.get('Origin')||'';const allowed=String(e.ALLOWED_ORIGIN||'').split(',').map((x:string)=>x.trim()).filter(Boolean);if(!o||!allowed.includes(o))return new Response(null,{status:403,headers:cors(r,e)});return new Response(null,{status:204,headers:cors(r,e)});}
  const path=new URL(r.url).pathname,id=r.headers.get('X-BeatVision-Request')||crypto.randomUUID();
  if(path==='/'||path==='/health')return json(r,e,{ok:true,status:'online',name:'BeatVision Provider Gateway',contract_version:'1.1',creative_provider:'pixazo',analysis_provider:'external-optional',assembly_provider:'shotstack-sandbox',request_id:id});
  if(path==='/v1/capabilities'){if(!auth(r,e))return json(r,e,{ok:false,error:e.GATEWAY_TOKEN?'Unauthorized':'Gateway authentication is not configured.',request_id:id},e.GATEWAY_TOKEN?401:503);return json(r,e,{ok:true,contract_version:'1.1',capabilities:{language:{configured:!!(e.EXTERNAL_LANGUAGE_PROVIDER_URL&&e.EXTERNAL_LANGUAGE_PROVIDER_TOKEN&&e.EXTERNAL_LANGUAGE_PROVIDER_MODEL),provider:'external',model:e.EXTERNAL_LANGUAGE_PROVIDER_MODEL||null},image:{configured:!!e.PIXAZO_API_KEY,provider:'pixazo',models:['flux-schnell','sdxl']},audio:{configured:!!(e.EXTERNAL_AUDIO_PROVIDER_URL&&e.EXTERNAL_AUDIO_PROVIDER_TOKEN&&e.EXTERNAL_AUDIO_PROVIDER_MODEL),provider:'external',model:e.EXTERNAL_AUDIO_PROVIDER_MODEL||null},video:{configured:!!e.PIXAZO_API_KEY,provider:'pixazo',model:'ltx-video'},music:{configured:!!e.PIXAZO_API_KEY,provider:'pixazo',model:'tracks'},assembly:{configured:!!e.SHOTSTACK_API_KEY,provider:'shotstack-sandbox'},storage:{configured:!!e.STORAGE_PROVIDER_URL,provider:e.STORAGE_PROVIDER_URL||null,optional:true},persistent_animation:{configured:!!e.ANIMATION_JOBS,provider:'cloudflare-durable-object'}},request_id:id});}
  if(path.startsWith('/v1/video/animate/jobs/')){if(!auth(r,e))return json(r,e,{ok:false,error:e.GATEWAY_TOKEN?'Unauthorized':'Gateway authentication is not configured.',request_id:id},e.GATEWAY_TOKEN?401:503);if(!e.ANIMATION_JOBS)return json(r,e,{ok:false,status:'provider_unavailable',error:'Persistent animation binding is not configured.',request_id:id},503);const jobId=path.split('/').filter(Boolean).pop()||id,stub=e.ANIMATION_JOBS.get(e.ANIMATION_JOBS.idFromName(jobId));if(r.method==='POST'){const body=await r.clone().json().catch(()=>null);if(!body)return json(r,e,{ok:false,error:'Invalid JSON animation job.',request_id:id},400);const forwarded=new Request(r.url,{method:'POST',headers:new Headers(r.headers),body:JSON.stringify({...body,job_id:jobId})});const response=await stub.fetch(forwarded);return new Response(response.body,{status:response.status,headers:{...Object.fromEntries(response.headers),...cors(r,e)}});}if(r.method==='GET'){const response=await stub.fetch(new Request(r.url,{method:'GET'}));return new Response(response.body,{status:response.status,headers:{...Object.fromEntries(response.headers),...cors(r,e)}});}return json(r,e,{ok:false,error:'GET or POST required',request_id:id},405);}
  if(path==='/v1/video/assemble'){const response=await shotstack.fetch(r,e);return new Response(response.body,{status:response.status,headers:{...Object.fromEntries(response.headers),...cors(r,e)}});}
  if(path==='/v1/video/animate'){if(!auth(r,e))return json(r,e,{ok:false,error:e.GATEWAY_TOKEN?'Unauthorized':'Gateway authentication is not configured.',request_id:id},e.GATEWAY_TOKEN?401:503);const rawBody=await r.text();let body:any;try{body=JSON.parse(rawBody)}catch{return json(r,e,{ok:false,contract_version:'1.1',capability:'video',status:'invalid_input',request_id:id,error:'Invalid JSON body sent to /v1/video/animate.'},400);}if(body?.contract_version!=='1.1'||body?.operation!=='animate')return json(r,e,{ok:false,contract_version:'1.1',capability:'video',status:'contract_mismatch',request_id:id,error:'BeatVision animation request did not use contract 1.1 animate.'},400);const forwarded=new Request(r.url,{method:'POST',headers:new Headers(r.headers),body:rawBody});const response=await motionResilient.fetch(forwarded,e);return enrichMotionResponse(response,body,id);}
  if(path==='/v1/image/world-assets'||path==='/v1/image/scenes'||path==='/v1/audio/generate')return pixazo.fetch(r,e);
  return externalProvider.fetch(r,e);
}};
