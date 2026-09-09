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
}

type Capability = 'language'|'image'|'video'|'audio'|'storage';

const routes: Record<string, Capability> = {
  '/v1/language/world':'language',
  '/v1/language/storyboard':'language',
  '/v1/image/world-assets':'image',
  '/v1/image/scenes':'image',
  '/v1/video/animate':'video',
  '/v1/video/assemble':'video',
  '/v1/audio/analyze':'audio',
  '/v1/storage/asset':'storage'
};

function cors(request: Request, env: Env): Record<string,string> {
  const origin = request.headers.get('Origin') || '';
  const configured = env.ALLOWED_ORIGIN?.trim();
  return {
    'Access-Control-Allow-Origin': configured && configured !== '*' ? configured : (origin || '*'),
    'Access-Control-Allow-Methods':'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers':'Content-Type,X-BeatVision-Contract,Authorization',
    'Access-Control-Max-Age':'86400'
  };
}

function json(request: Request, env: Env, data: unknown, status=200){
  return new Response(JSON.stringify(data,null,2),{status,headers:{'Content-Type':'application/json',...cors(request,env)}});
}

function providerConfig(env: Env, capability: Capability){
  const map = {
    language:[env.LANGUAGE_PROVIDER_URL,env.LANGUAGE_PROVIDER_TOKEN],
    image:[env.IMAGE_PROVIDER_URL,env.IMAGE_PROVIDER_TOKEN],
    video:[env.VIDEO_PROVIDER_URL,env.VIDEO_PROVIDER_TOKEN],
    audio:[env.AUDIO_PROVIDER_URL,env.AUDIO_PROVIDER_TOKEN],
    storage:[env.STORAGE_PROVIDER_URL,env.STORAGE_PROVIDER_TOKEN]
  } as const;
  return map[capability];
}

export default {async fetch(request: Request, env: Env): Promise<Response>{
  if(request.method==='OPTIONS') return new Response(null,{status:204,headers:cors(request,env)});
  const url = new URL(request.url);
  if(request.method==='GET' && url.pathname==='/health') return json(request,env,{ok:true,name:'BeatVision Provider Gateway',contract_version:'1.0'});
  if(request.method==='GET' && url.pathname==='/v1/capabilities'){
    return json(request,env,{ok:true,contract_version:'1.0',capabilities:Object.fromEntries((Object.keys({language:1,image:1,video:1,audio:1,storage:1}) as Capability[]).map(c=>{const [endpoint]=providerConfig(env,c);return [c,{configured:Boolean(endpoint)}]}))});
  }
  const capability = routes[url.pathname];
  if(!capability) return json(request,env,{ok:false,error:'Route not found.'},404);
  if(request.method!=='POST') return json(request,env,{ok:false,error:'POST required.'},405);
  let body: any; try{body=await request.json()}catch{return json(request,env,{ok:false,error:'Invalid JSON body.'},400)}
  if(body?.contract_version!=='1.0') return json(request,env,{ok:false,error:'Unsupported BeatVision contract version.'},400);
  const [endpoint,token] = providerConfig(env,capability);
  if(!endpoint) return json(request,env,{ok:false,error:`No ${capability} provider configured.`,capability,mode:'unconfigured'},503);
  const started=Date.now();
  try{
    const headers: Record<string,string>={'Content-Type':'application/json','X-BeatVision-Capability':capability,'X-BeatVision-Operation':String(body.operation||url.pathname)};
    if(token) headers.Authorization=`Bearer ${token}`;
    const upstream=await fetch(endpoint,{method:'POST',headers,body:JSON.stringify({contract_version:'1.0',capability,operation:body.operation,payload:body.payload})});
    const text=await upstream.text();
    let result:any; try{result=JSON.parse(text)}catch{result={raw:text}};
    return json(request,env,{ok:upstream.ok,capability,latency_ms:Date.now()-started,result},upstream.status);
  }catch(error){return json(request,env,{ok:false,capability,latency_ms:Date.now()-started,error:String(error)},502)}
}};
