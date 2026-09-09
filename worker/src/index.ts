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

type Capability = 'language'|'image'|'video'|'audio'|'storage';
const CONTRACT_VERSION = '1.1';
const MAX_BODY_BYTES = 512_000;
const UPSTREAM_TIMEOUT_MS = 45_000;
const HF_DEFAULT_URL = 'https://router.huggingface.co/v1/chat/completions';
const HF_DEFAULT_MODEL = 'openai/gpt-oss-120b:fastest';
const routes: Record<string, Capability> = {
  '/v1/language/world':'language', '/v1/language/storyboard':'language',
  '/v1/image/world-assets':'image', '/v1/image/scenes':'image',
  '/v1/video/animate':'video', '/v1/video/assemble':'video',
  '/v1/audio/analyze':'audio', '/v1/storage/asset':'storage'
};
const operations: Record<string,string> = {
  '/v1/language/world':'revealWorld','/v1/language/storyboard':'storyboard',
  '/v1/image/world-assets':'worldAssets','/v1/image/scenes':'sceneImages',
  '/v1/video/animate':'animate','/v1/video/assemble':'assemble',
  '/v1/audio/analyze':'analyzeAudio','/v1/storage/asset':'storeAsset'
};

function cors(request: Request, env: Env): Record<string,string> {
  const origin=request.headers.get('Origin')||''; const configured=env.ALLOWED_ORIGIN?.split(',').map(x=>x.trim()).filter(Boolean)||[];
  if(configured.length&&origin&&!configured.includes(origin)) return {'Vary':'Origin'};
  return {'Access-Control-Allow-Origin':origin||(configured[0]||'*'),'Vary':'Origin','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type,X-BeatVision-Contract,Authorization,X-BeatVision-Request','Access-Control-Max-Age':'86400'};
}
function json(request: Request,env: Env,data: unknown,status=200,extra: Record<string,string>={}){return new Response(JSON.stringify(data,null,2),{status,headers:{'Content-Type':'application/json',...cors(request,env),...extra}})}
function providerConfig(env: Env,capability: Capability){const map={language:[env.LANGUAGE_PROVIDER_URL,env.LANGUAGE_PROVIDER_TOKEN],image:[env.IMAGE_PROVIDER_URL,env.IMAGE_PROVIDER_TOKEN],video:[env.VIDEO_PROVIDER_URL,env.VIDEO_PROVIDER_TOKEN],audio:[env.AUDIO_PROVIDER_URL,env.AUDIO_PROVIDER_TOKEN],storage:[env.STORAGE_PROVIDER_URL,env.STORAGE_PROVIDER_TOKEN]} as const;return map[capability]}
function requestId(request: Request){return request.headers.get('X-BeatVision-Request')||crypto.randomUUID()}
function authorized(request: Request,env: Env){if(!env.GATEWAY_TOKEN)return true;return request.headers.get('Authorization')===`Bearer ${env.GATEWAY_TOKEN}`}
function safeEndpoint(endpoint?: string){try{const u=new URL(endpoint||'');return ['https:','http:'].includes(u.protocol)?u.toString():null}catch{return null}}
function allowedOrigin(request: Request,env: Env){const configured=env.ALLOWED_ORIGIN?.split(',').map(x=>x.trim()).filter(Boolean)||[];const origin=request.headers.get('Origin');return !configured.length||!origin||configured.includes(origin)}
function languageConfig(env: Env){return {url:safeEndpoint(env.LANGUAGE_PROVIDER_URL)||HF_DEFAULT_URL,token:env.LANGUAGE_PROVIDER_TOKEN,model:env.LANGUAGE_PROVIDER_MODEL||HF_DEFAULT_MODEL,provider:env.LANGUAGE_PROVIDER||'huggingface'}}
function languageMessages(operation: string,payload: any){const p=payload||{};const system='You are the BeatVision visual-world director. Return ONLY valid JSON matching the requested schema. Preserve creative intent, continuity, and production usefulness. Do not invent lyrics that are not supplied.';if(operation==='revealWorld')return [{role:'system',content:system+' For revealWorld return {title,logline,palette:[string],tone,visual_language,locations:[string],character_concept,continuity_rules:[string],visual_motifs:[string]}'},{role:'user',content:JSON.stringify({task:'revealWorld',song_title:p.song_title,style:p.style,lyrics:p.lyrics,audio:p.audio})}];if(operation==='storyboard')return [{role:'system',content:system+' For storyboard return {scenes:[{scene,description,emotion,location,visual_direction,transition,continuity_notes}]}'},{role:'user',content:JSON.stringify({task:'storyboard',song_title:p.song_title,style:p.style,lyrics:p.lyrics,world:p.world,assets:p.assets,audio:p.audio})}];return [{role:'system',content:system+' For scene direction return {scenes:[{scene,prompt,camera,lighting,action,continuity_notes}]}'},{role:'user',content:JSON.stringify({task:operation,...p})}];}
function extractText(result:any){return result?.choices?.[0]?.message?.content||result?.output_text||result?.choices?.[0]?.text||''}
function parseModelJson(text:string){const cleaned=text.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');try{return JSON.parse(cleaned)}catch{return {raw:cleaned}}}

export default {async fetch(request: Request,env: Env): Promise<Response>{
  const rid=requestId(request);
  if(request.method==='OPTIONS')return allowedOrigin(request,env)?new Response(null,{status:204,headers:cors(request,env)}):new Response('Forbidden',{status:403,headers:{'Vary':'Origin'}});
  if(!allowedOrigin(request,env))return json(request,env,{ok:false,error:'Origin not allowed.',request_id:rid},403);
  const url=new URL(request.url);
  if(request.method==='GET'&&url.pathname==='/health')return json(request,env,{ok:true,name:'BeatVision Provider Gateway',contract_version:CONTRACT_VERSION,request_id:rid});
  if(request.method==='GET'&&url.pathname==='/v1/capabilities'){
    if(!authorized(request,env))return json(request,env,{ok:false,error:'Unauthorized.',request_id:rid},401);
    const capabilities=Object.fromEntries((['language','image','video','audio','storage'] as Capability[]).map(c=>{const [endpoint,token]=providerConfig(env,c);const configured=c==='language'?Boolean(token):Boolean(safeEndpoint(endpoint));return[c,{configured,provider:c==='language'?(configured?languageConfig(env).provider:null):(safeEndpoint(endpoint)?new URL(endpoint!).hostname:null)}]}));
    return json(request,env,{ok:true,contract_version:CONTRACT_VERSION,capabilities,request_id:rid});
  }
  const capability=routes[url.pathname]; if(!capability)return json(request,env,{ok:false,error:'Route not found.',request_id:rid},404);
  if(request.method!=='POST')return json(request,env,{ok:false,error:'POST required.',request_id:rid},405);
  if(!authorized(request,env))return json(request,env,{ok:false,error:'Unauthorized.',request_id:rid},401);
  const length=Number(request.headers.get('Content-Length')||0);if(length>MAX_BODY_BYTES)return json(request,env,{ok:false,error:'Request body too large.',request_id:rid},413);
  let body:any;try{body=await request.json()}catch{return json(request,env,{ok:false,error:'Invalid JSON body.',request_id:rid},400)}
  if(JSON.stringify(body).length>MAX_BODY_BYTES)return json(request,env,{ok:false,error:'Request body too large.',request_id:rid},413);
  if(body?.contract_version!==CONTRACT_VERSION)return json(request,env,{ok:false,error:`Unsupported BeatVision contract version. Expected ${CONTRACT_VERSION}.`,request_id:rid},400);
  if(body?.operation!==operations[url.pathname])return json(request,env,{ok:false,error:'Operation does not match gateway route.',request_id:rid},400);
  const started=Date.now();
  if(capability==='language'){
    const cfg=languageConfig(env); if(!cfg.token)return json(request,env,{ok:false,error:'No language provider token configured.',capability,mode:'unconfigured',provider:cfg.provider,request_id:rid},503);
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),UPSTREAM_TIMEOUT_MS);
    try{
      const upstream=await fetch(cfg.url,{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${cfg.token}`,'X-BeatVision-Capability':'language','X-BeatVision-Operation':body.operation,'X-BeatVision-Request':rid},body:JSON.stringify({model:cfg.model,messages:languageMessages(body.operation,body.payload),temperature:0.7}),signal:controller.signal});
      const text=await upstream.text();let result:any;try{result=JSON.parse(text)}catch{result={raw:text.slice(0,20000)}}
      const content=extractText(result); const parsed=content?parseModelJson(content):result;
      return json(request,env,{ok:upstream.ok,contract_version:CONTRACT_VERSION,capability,provider:cfg.provider,model:cfg.model,latency_ms:Date.now()-started,request_id:rid,result:parsed,provider_response:result},upstream.status,{'X-BeatVision-Request':rid});
    }catch(error){const timedOut=(error as Error)?.name==='AbortError';return json(request,env,{ok:false,contract_version:CONTRACT_VERSION,capability,provider:cfg.provider,latency_ms:Date.now()-started,request_id:rid,error:timedOut?'Language provider timed out.':'Language provider request failed.'},timedOut?504:502,{'X-BeatVision-Request':rid})}finally{clearTimeout(timeout)}
  }
  const [configuredEndpoint,token]=providerConfig(env,capability),endpoint=safeEndpoint(configuredEndpoint);
  if(!endpoint)return json(request,env,{ok:false,error:`No valid ${capability} provider configured.`,capability,mode:'unconfigured',request_id:rid},503);
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),UPSTREAM_TIMEOUT_MS);
  try{
    const headers:Record<string,string>={'Content-Type':'application/json','X-BeatVision-Capability':capability,'X-BeatVision-Operation':body.operation,'X-BeatVision-Request':rid};if(token)headers.Authorization=`Bearer ${token}`;
    const upstream=await fetch(endpoint,{method:'POST',headers,body:JSON.stringify({contract_version:CONTRACT_VERSION,capability,operation:body.operation,payload:body.payload,request_id:rid}),signal:controller.signal});
    const text=await upstream.text();let result:any;try{result=JSON.parse(text)}catch{result={raw:text.slice(0,20000)}}
    return json(request,env,{ok:upstream.ok,contract_version:CONTRACT_VERSION,capability,latency_ms:Date.now()-started,request_id:rid,result},upstream.status,{'X-BeatVision-Request':rid});
  }catch(error){const timedOut=(error as Error)?.name==='AbortError';return json(request,env,{ok:false,contract_version:CONTRACT_VERSION,capability,latency_ms:Date.now()-started,request_id:rid,error:timedOut?'Upstream provider timed out.':'Upstream provider request failed.'},timedOut?504:502,{'X-BeatVision-Request':rid})}finally{clearTimeout(timeout)}
}};
