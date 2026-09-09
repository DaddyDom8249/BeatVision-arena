interface Env {
  ALLOWED_ORIGIN?: string;
  LANGUAGE_PROVIDER_URL?: string;
  IMAGE_PROVIDER_URL?: string;
  VIDEO_PROVIDER_URL?: string;
  AUDIO_PROVIDER_URL?: string;
  STORAGE_PROVIDER_URL?: string;
  LANGUAGE_PROVIDER_TOKEN?: string;
  IMAGE_PROVIDER_TOKEN?: string;
  VIDEO_PROVIDER_TOKEN?: string;
  AUDIO_PROVIDER_TOKEN?: string;
  STORAGE_PROVIDER_TOKEN?: string;
  GATEWAY_TOKEN?: string;
}

type Capability = 'language'|'image'|'video'|'audio'|'storage';
const CONTRACT_VERSION = '1.1';
const routes: Record<string, Capability> = {
  '/v1/language/world':'language', '/v1/language/storyboard':'language',
  '/v1/image/world-assets':'image', '/v1/image/scenes':'image',
  '/v1/video/animate':'video', '/v1/video/assemble':'video',
  '/v1/audio/analyze':'audio', '/v1/storage/asset':'storage'
};

function cors(request: Request, env: Env): Record<string,string> {
  const origin = request.headers.get('Origin') || '';
  const configured = env.ALLOWED_ORIGIN?.trim();
  const allowed = configured ? configured.split(',').map(x=>x.trim()).filter(Boolean) : [];
  const allowOrigin = allowed.length ? (allowed.includes(origin) ? origin : allowed[0]) : '*';
  return {'Access-Control-Allow-Origin':allowOrigin,'Vary':'Origin','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type,X-BeatVision-Contract,Authorization,X-BeatVision-Request','Access-Control-Max-Age':'86400'};
}
function json(request: Request, env: Env, data: unknown, status=200, extra: Record<string,string>={}) {
  return new Response(JSON.stringify(data,null,2),{status,headers:{'Content-Type':'application/json',...cors(request,env),...extra}});
}
function providerConfig(env: Env, capability: Capability) {
  const map = {language:[env.LANGUAGE_PROVIDER_URL,env.LANGUAGE_PROVIDER_TOKEN],image:[env.IMAGE_PROVIDER_URL,env.IMAGE_PROVIDER_TOKEN],video:[env.VIDEO_PROVIDER_URL,env.VIDEO_PROVIDER_TOKEN],audio:[env.AUDIO_PROVIDER_URL,env.AUDIO_PROVIDER_TOKEN],storage:[env.STORAGE_PROVIDER_URL,env.STORAGE_PROVIDER_TOKEN]} as const;
  return map[capability];
}
function requestId(request: Request) { return request.headers.get('X-BeatVision-Request') || crypto.randomUUID(); }
function authorized(request: Request, env: Env) { if(!env.GATEWAY_TOKEN) return true; return request.headers.get('Authorization') === `Bearer ${env.GATEWAY_TOKEN}`; }

export default {async fetch(request: Request, env: Env): Promise<Response> {
  if(request.method==='OPTIONS') return new Response(null,{status:204,headers:cors(request,env)});
  const url=new URL(request.url); const rid=requestId(request);
  if(request.method==='GET' && url.pathname==='/health') return json(request,env,{ok:true,name:'BeatVision Provider Gateway',contract_version:CONTRACT_VERSION,request_id:rid});
  if(request.method==='GET' && url.pathname==='/v1/capabilities') {
    if(!authorized(request,env)) return json(request,env,{ok:false,error:'Unauthorized.',request_id:rid},401);
    const capabilities=Object.fromEntries((['language','image','video','audio','storage'] as Capability[]).map(c=>{const [endpoint]=providerConfig(env,c);return [c,{configured:Boolean(endpoint)}]}));
    return json(request,env,{ok:true,contract_version:CONTRACT_VERSION,capabilities,request_id:rid});
  }
  const capability=routes[url.pathname];
  if(!capability) return json(request,env,{ok:false,error:'Route not found.',request_id:rid},404);
  if(request.method!=='POST') return json(request,env,{ok:false,error:'POST required.',request_id:rid},405);
  if(!authorized(request,env)) return json(request,env,{ok:false,error:'Unauthorized.',request_id:rid},401);
  let body:any; try{body=await request.json()}catch{return json(request,env,{ok:false,error:'Invalid JSON body.',request_id:rid},400)}
  if(body?.contract_version!==CONTRACT_VERSION) return json(request,env,{ok:false,error:`Unsupported BeatVision contract version. Expected ${CONTRACT_VERSION}.`,request_id:rid},400);
  if(body?.operation && routes[url.pathname] && providerConfig(env,capability)) { /* operation/path already bound by the gateway */ }
  const [endpoint,token]=providerConfig(env,capability);
  if(!endpoint) return json(request,env,{ok:false,error:`No ${capability} provider configured.`,capability,mode:'unconfigured',request_id:rid},503);
  const started=Date.now();
  try {
    const headers:Record<string,string>={'Content-Type':'application/json','X-BeatVision-Capability':capability,'X-BeatVision-Operation':String(body.operation||url.pathname),'X-BeatVision-Request':rid};
    if(token) headers.Authorization=`Bearer ${token}`;
    const upstream=await fetch(endpoint,{method:'POST',headers,body:JSON.stringify({contract_version:CONTRACT_VERSION,capability,operation:body.operation,payload:body.payload,request_id:rid})});
    const text=await upstream.text(); let result:any; try{result=JSON.parse(text)}catch{result={raw:text}};
    return json(request,env,{ok:upstream.ok,contract_version:CONTRACT_VERSION,capability,latency_ms:Date.now()-started,request_id:rid,result},upstream.status,{'X-BeatVision-Request':rid});
  } catch(error) {
    return json(request,env,{ok:false,contract_version:CONTRACT_VERSION,capability,latency_ms:Date.now()-started,request_id:rid,error:String(error)},502,{'X-BeatVision-Request':rid});
  }
}};
