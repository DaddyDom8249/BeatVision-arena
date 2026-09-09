interface Env {
  ALLOWED_ORIGIN?: string;
  LANGUAGE_PROVIDER_URL?: string;
  LANGUAGE_PROVIDER_TOKEN?: string;
  LANGUAGE_PROVIDER_MODEL?: string;
  LANGUAGE_PROVIDER?: string;
  IMAGE_PROVIDER_URL?: string;
  VIDEO_PROVIDER_URL?: string;
  AUDIO_PROVIDER_URL?: string;
  STORAGE_PROVIDER_URL?: string;
  IMAGE_PROVIDER_TOKEN?: string;
  VIDEO_PROVIDER_TOKEN?: string;
  AUDIO_PROVIDER_TOKEN?: string;
  STORAGE_PROVIDER_TOKEN?: string;
  GATEWAY_TOKEN?: string;
}

type Capability = 'language' | 'image' | 'video' | 'audio' | 'storage';
const CONTRACT_VERSION = '1.1';
const MAX_BODY_BYTES = 8_000_000;
const UPSTREAM_TIMEOUT_MS = 45_000;
const AUDIO_TIMEOUT_MS = 120_000;
const HF_CHAT_URL = 'https://router.huggingface.co/v1/chat/completions';
const HF_CHAT_MODEL = 'openai/gpt-oss-120b:fastest';
const HF_IMAGE_URL = 'https://router.huggingface.co/hf-inference/models/black-forest-labs/FLUX.1-dev';
const HF_AUDIO_URL = 'https://router.huggingface.co/hf-inference/models/openai/whisper-large-v3-turbo';

const routes: Record<string, Capability> = {
  '/v1/language/world': 'language', '/v1/language/storyboard': 'language',
  '/v1/image/world-assets': 'image', '/v1/image/scenes': 'image',
  '/v1/video/animate': 'video', '/v1/video/assemble': 'video',
  '/v1/audio/analyze': 'audio', '/v1/storage/asset': 'storage'
};
const operations: Record<string, string> = {
  '/v1/language/world': 'revealWorld', '/v1/language/storyboard': 'storyboard',
  '/v1/image/world-assets': 'worldAssets', '/v1/image/scenes': 'sceneImages',
  '/v1/video/animate': 'animate', '/v1/video/assemble': 'assemble',
  '/v1/audio/analyze': 'analyzeAudio', '/v1/storage/asset': 'storeAsset'
};

function cors(r: Request, e: Env) {
  const origin = r.headers.get('Origin') || '';
  const allowed = e.ALLOWED_ORIGIN?.split(',').map(x => x.trim()).filter(Boolean) || [];
  return {
    'Access-Control-Allow-Origin': origin && (!allowed.length || allowed.includes(origin)) ? origin : (allowed[0] || '*'),
    'Vary': 'Origin', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,X-BeatVision-Contract,Authorization,X-BeatVision-Request',
    'Access-Control-Max-Age': '86400'
  };
}
function json(r: Request, e: Env, data: unknown, status = 200, extra: Record<string,string> = {}) {
  return new Response(JSON.stringify(data, null, 2), { status, headers: { 'Content-Type': 'application/json', ...cors(r,e), ...extra } });
}
function rid(r: Request) { return r.headers.get('X-BeatVision-Request') || crypto.randomUUID(); }
function authorized(r: Request, e: Env) { return !e.GATEWAY_TOKEN || r.headers.get('Authorization') === `Bearer ${e.GATEWAY_TOKEN}`; }
function endpoint(v?: string) { try { const u = new URL(v || ''); return ['https:', 'http:'].includes(u.protocol) ? u.toString() : null; } catch { return null; } }
function lang(e: Env) { return { url: endpoint(e.LANGUAGE_PROVIDER_URL) || HF_CHAT_URL, token: e.LANGUAGE_PROVIDER_TOKEN, model: e.LANGUAGE_PROVIDER_MODEL || HF_CHAT_MODEL, provider: e.LANGUAGE_PROVIDER || 'huggingface' }; }
function image(e: Env) { return { url: endpoint(e.IMAGE_PROVIDER_URL) || HF_IMAGE_URL, token: e.IMAGE_PROVIDER_TOKEN || e.LANGUAGE_PROVIDER_TOKEN, model: 'black-forest-labs/FLUX.1-dev', provider: e.IMAGE_PROVIDER_URL ? 'configured' : 'huggingface' }; }
function audio(e: Env) { return { url: endpoint(e.AUDIO_PROVIDER_URL) || HF_AUDIO_URL, token: e.AUDIO_PROVIDER_TOKEN || e.LANGUAGE_PROVIDER_TOKEN, model: 'openai/whisper-large-v3-turbo', provider: e.AUDIO_PROVIDER_URL ? 'configured' : 'huggingface' }; }
function bytes(b64: string) { const b = b64.includes(',') ? b64.split(',').pop()! : b64; const raw = atob(b); const out = new Uint8Array(raw.length); for (let i=0;i<raw.length;i++) out[i]=raw.charCodeAt(i); return out; }
function langMessages(op: string, p: any) {
  const system = 'You are the BeatVision visual-world director. Return ONLY valid JSON. Preserve creative intent, continuity, and production usefulness. Do not invent lyrics.';
  if (op === 'revealWorld') return [{role:'system',content:system+' Return {title,logline,palette,tone,visual_language,locations,character_concept,continuity_rules,visual_motifs}.'},{role:'user',content:JSON.stringify({task:op,...p})}];
  return [{role:'system',content:system+' Return {scenes:[{scene,description,emotion,location,visual_direction,transition,continuity_notes}]}.'},{role:'user',content:JSON.stringify({task:op,...p})}];
}
function parseJson(text: string) { const t=text.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,''); try{return JSON.parse(t)}catch{return {raw:t}} }

export default { async fetch(request: Request, env: Env): Promise<Response> {
  const requestId = rid(request);
  if (request.method === 'OPTIONS') return new Response(null,{status:204,headers:cors(request,env)});
  const url = new URL(request.url);
  if (request.method === 'GET' && url.pathname === '/health') return json(request,env,{ok:true,name:'BeatVision Provider Gateway',contract_version:CONTRACT_VERSION,request_id:requestId});
  if (request.method === 'GET' && url.pathname === '/v1/capabilities') {
    if (!authorized(request,env)) return json(request,env,{ok:false,error:'Unauthorized',request_id:requestId},401);
    return json(request,env,{ok:true,contract_version:CONTRACT_VERSION,capabilities:{language:{configured:Boolean(lang(env).token),provider:lang(env).provider},image:{configured:Boolean(image(env).token),provider:image(env).token?'huggingface':null},audio:{configured:Boolean(audio(env).token),provider:audio(env).token?'huggingface':null},video:{configured:Boolean(endpoint(env.VIDEO_PROVIDER_URL)),provider:env.VIDEO_PROVIDER_URL||null},storage:{configured:Boolean(endpoint(env.STORAGE_PROVIDER_URL)),provider:env.STORAGE_PROVIDER_URL||null}},request_id:requestId});
  }
  const capability = routes[url.pathname];
  if (!capability) return json(request,env,{ok:false,error:'Route not found',request_id:requestId},404);
  if (request.method !== 'POST') return json(request,env,{ok:false,error:'POST required',request_id:requestId},405);
  if (!authorized(request,env)) return json(request,env,{ok:false,error:'Unauthorized',request_id:requestId},401);
  const length=Number(request.headers.get('Content-Length')||0); if(length>MAX_BODY_BYTES)return json(request,env,{ok:false,error:'Request body too large',request_id:requestId},413);
  let body:any; try{body=await request.json()}catch{return json(request,env,{ok:false,error:'Invalid JSON body',request_id:requestId},400)}
  if(JSON.stringify(body).length>MAX_BODY_BYTES)return json(request,env,{ok:false,error:'Request body too large',request_id:requestId},413);
  if(body?.contract_version!==CONTRACT_VERSION)return json(request,env,{ok:false,error:`Unsupported BeatVision contract version. Expected ${CONTRACT_VERSION}.`,request_id:requestId},400);
  if(body?.operation!==operations[url.pathname])return json(request,env,{ok:false,error:'Operation does not match gateway route',request_id:requestId},400);
  const started=Date.now();

  if(capability==='audio'){
    const cfg=audio(env), p=body.payload||{}, input=p.audio_base64||p.audio_data;
    if(!cfg.token)return json(request,env,{ok:false,error:'No audio provider token configured',capability,mode:'unconfigured',request_id:requestId},503);
    if(!input)return json(request,env,{ok:false,error:'Audio provider requires audio_base64/audio_data for live analysis',capability,request_id:requestId},400);
    const ctl=new AbortController(), timer=setTimeout(()=>ctl.abort(),AUDIO_TIMEOUT_MS);
    try{
      const u=await fetch(cfg.url,{method:'POST',headers:{Authorization:`Bearer ${cfg.token}`,'Content-Type':'application/json','X-BeatVision-Request':requestId},body:JSON.stringify({inputs:input.includes(',')?input.split(',').pop():input,parameters:{return_timestamps:true}}),signal:ctl.signal});
      const text=await u.text(); let result:any; try{result=JSON.parse(text)}catch{result={raw:text.slice(0,10000)}}
      return json(request,env,{ok:u.ok,contract_version:CONTRACT_VERSION,capability,provider:cfg.provider,model:cfg.model,latency_ms:Date.now()-started,request_id:requestId,result,analysis:{duration_seconds:p.duration_seconds??null,bpm:p.bpm??null,energy_curve:p.energy_curve??null,source:'Hugging Face ASR + browser audio metadata'}},u.status,{'X-BeatVision-Request':requestId});
    }catch(err){const timed=(err as Error)?.name==='AbortError';return json(request,env,{ok:false,contract_version:CONTRACT_VERSION,capability,provider:cfg.provider,model:cfg.model,latency_ms:Date.now()-started,request_id:requestId,error:timed?'Audio provider timed out after 120 seconds':'Audio provider request failed'},timed?504:502,{'X-BeatVision-Request':requestId})}finally{clearTimeout(timer)}
  }

  if(capability==='language'){
    const cfg=lang(env); if(!cfg.token)return json(request,env,{ok:false,error:'No language provider token configured',capability,request_id:requestId},503);
    const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),UPSTREAM_TIMEOUT_MS);
    try{const u=await fetch(cfg.url,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${cfg.token}`,'X-BeatVision-Request':requestId},body:JSON.stringify({model:cfg.model,messages:langMessages(body.operation,body.payload||{}),temperature:.7}),signal:ctl.signal});const text=await u.text();let result:any;try{result=JSON.parse(text)}catch{result={raw:text}}const content=result?.choices?.[0]?.message?.content||'';return json(request,env,{ok:u.ok,contract_version:CONTRACT_VERSION,capability,provider:cfg.provider,model:cfg.model,latency_ms:Date.now()-started,request_id:requestId,result:content?parseJson(content):result},u.status,{'X-BeatVision-Request':requestId})}catch(err){const timed=(err as Error)?.name==='AbortError';return json(request,env,{ok:false,capability,provider:cfg.provider,latency_ms:Date.now()-started,request_id:requestId,error:timed?'Language provider timed out':'Language provider request failed'},timed?504:502,{'X-BeatVision-Request':requestId})}finally{clearTimeout(timer)}}

  if(capability==='image'){
    const cfg=image(env);if(!cfg.token)return json(request,env,{ok:false,error:'No image provider token configured',capability,request_id:requestId},503);
    const p=body.payload||{},prompt=`BeatVision cinematic music video concept art. Style: ${p.style||''}. World: ${JSON.stringify(p.world||{}).slice(0,6000)}. Storyboard: ${JSON.stringify(p.storyboard||{}).slice(0,6000)}. Create strong continuity-focused production art.`;
    const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),UPSTREAM_TIMEOUT_MS);
    try{const u=await fetch(cfg.url,{method:'POST',headers:{Authorization:`Bearer ${cfg.token}`,'Content-Type':'application/json','X-BeatVision-Request':requestId},body:JSON.stringify({inputs:prompt,parameters:{width:1024,height:576,num_inference_steps:20}}),signal:ctl.signal});if(!u.ok){return json(request,env,{ok:false,capability,provider:cfg.provider,latency_ms:Date.now()-started,request_id:requestId,error:`Image provider returned ${u.status}`,provider_response:(await u.text()).slice(0,4000)},u.status)}const ct=u.headers.get('content-type')||'image/png',b=new Uint8Array(await u.arrayBuffer());let s='';for(let i=0;i<b.length;i+=0x8000)s+=String.fromCharCode(...b.subarray(i,i+0x8000));return json(request,env,{ok:true,contract_version:CONTRACT_VERSION,capability,provider:cfg.provider,model:cfg.model,latency_ms:Date.now()-started,request_id:requestId,result:{status:'generated',image_url:`data:${ct};base64,${btoa(s)}`,mime_type:ct}},200,{'X-BeatVision-Request':requestId})}catch(err){const timed=(err as Error)?.name==='AbortError';return json(request,env,{ok:false,capability,provider:cfg.provider,latency_ms:Date.now()-started,request_id:requestId,error:timed?'Image provider timed out':'Image provider request failed'},timed?504:502)}finally{clearTimeout(timer)}}

  const target=capability==='video'?endpoint(env.VIDEO_PROVIDER_URL):endpoint(env.STORAGE_PROVIDER_URL);const token=capability==='video'?env.VIDEO_PROVIDER_TOKEN:env.STORAGE_PROVIDER_TOKEN;if(!target)return json(request,env,{ok:false,error:`No valid ${capability} provider configured`,capability,mode:'unconfigured',request_id:requestId},503);const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),UPSTREAM_TIMEOUT_MS);
  try{const headers:Record<string,string>={'Content-Type':'application/json','X-BeatVision-Request':requestId};if(token)headers.Authorization=`Bearer ${token}`;const u=await fetch(target,{method:'POST',headers,body:JSON.stringify({...body,request_id:requestId}),signal:ctl.signal});const text=await u.text();let result:any;try{result=JSON.parse(text)}catch{result={raw:text.slice(0,20000)}}return json(request,env,{ok:u.ok,contract_version:CONTRACT_VERSION,capability,latency_ms:Date.now()-started,request_id:requestId,result},u.status,{'X-BeatVision-Request':requestId})}catch(err){const timed=(err as Error)?.name==='AbortError';return json(request,env,{ok:false,capability,latency_ms:Date.now()-started,request_id:requestId,error:timed?'Upstream provider timed out':'Upstream provider request failed'},timed?504:502)}finally{clearTimeout(timer)}
}};