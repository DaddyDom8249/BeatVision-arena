import original from './index';

const VIDEO_BASE='https://gen.pollinations.ai';
const VIDEO_MODEL='seedance-2.0-fast';
const VIDEO_TIMEOUT_MS=120_000;

function cors(r:Request,e:any){
  const o=r.headers.get('Origin')||'';
  const allowed=String(e.ALLOWED_ORIGIN||'').split(',').map((x:string)=>x.trim()).filter(Boolean);
  return {
    'Access-Control-Allow-Origin':o&&(!allowed.length||allowed.includes(o))?o:(allowed[0]||'*'),
    'Vary':'Origin',
    'Access-Control-Allow-Methods':'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers':'Content-Type,X-BeatVision-Contract,Authorization,X-BeatVision-Request',
    'Access-Control-Max-Age':'86400'
  };
}
function json(r:Request,e:any,d:unknown,status=200){
  return new Response(JSON.stringify(d,null,2),{status,headers:{'Content-Type':'application/json',...cors(r,e)}});
}
function auth(r:Request,e:any){
  return !e.GATEWAY_TOKEN||r.headers.get('Authorization')===`Bearer ${e.GATEWAY_TOKEN}`;
}
function firstImage(p:any){
  const imgs=p?.images?.images||p?.images||[];
  const item=Array.isArray(imgs)?imgs[0]:imgs;
  return item?.image_url||item?.url||item?.data_url||null;
}
function dataUrlBlob(v:any){
  if(typeof v!=='string'||!v.startsWith('data:'))return null;
  const comma=v.indexOf(',');
  if(comma<0)return null;
  const mime=(v.slice(5,comma).split(';')[0]||'image/jpeg');
  const raw=atob(v.slice(comma+1));
  const bytes=new Uint8Array(raw.length);
  for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);
  return new Blob([bytes],{type:mime});
}
async function uploadMedia(blob:Blob,token:string,filename:string,signal:AbortSignal){
  const form=new FormData();
  form.append('file',blob,filename);
  const res=await fetch(`${VIDEO_BASE}/upload`,{method:'POST',headers:{Authorization:`Bearer ${token}`},body:form,signal});
  const text=await res.text();
  if(!res.ok)throw new Error(`Pollinations media upload returned ${res.status}: ${text.slice(0,800)}`);
  const data=JSON.parse(text);
  if(!data?.url)throw new Error('Pollinations media upload returned no media URL');
  return data.url as string;
}

export default {
  async fetch(r:Request,e:any){
    const u=new URL(r.url);
    if(r.method==='OPTIONS')return new Response(null,{status:204,headers:cors(r,e)});
    if(u.pathname!=='/v1/video/animate')return original.fetch(r,e);
    const id=r.headers.get('X-BeatVision-Request')||crypto.randomUUID();
    if(!auth(r,e))return json(r,e,{ok:false,error:'Unauthorized',request_id:id},401);
    if(r.method!=='POST')return json(r,e,{ok:false,error:'POST required',request_id:id},405);
    let body:any;
    try{body=await r.json()}catch{return json(r,e,{ok:false,error:'Invalid JSON body',request_id:id},400)}
    if(body?.contract_version!=='1.1')return json(r,e,{ok:false,error:'Unsupported BeatVision contract version. Expected 1.1.',request_id:id},400);
    if(body?.operation!=='animate')return json(r,e,{ok:false,error:'Operation does not match gateway route',request_id:id},400);
    const token=e.VIDEO_PROVIDER_TOKEN||e.IMAGE_PROVIDER_TOKEN;
    if(!token)return json(r,e,{ok:false,error:'No Pollinations video token configured. The Arena can reuse IMAGE_PROVIDER_TOKEN for the Pollinations motion path.',capability:'video',provider:'pollinations',model:VIDEO_MODEL,request_id:id},503);
    const imageUrl=firstImage(body.payload||{});
    const image=dataUrlBlob(imageUrl);
    if(!image)return json(r,e,{ok:false,error:'Motion requires a generated scene image data URL.',capability:'video',provider:'pollinations',model:VIDEO_MODEL,request_id:id},400);
    const start=Date.now();
    const ctl=new AbortController();
    const tm=setTimeout(()=>ctl.abort(),VIDEO_TIMEOUT_MS);
    try{
      const imageMediaUrl=await uploadMedia(image,token,'beatvision-scene.jpg',ctl.signal);
      const p=body.payload||{};
      const scene=p.storyboard?.scenes?.[0]||{};
      const prompt=`Animate this BeatVision scene with restrained cinematic camera motion, natural subject movement, atmospheric lighting and continuity. Style: ${String(p.style||'').slice(0,1000)}. World: ${String(p.world?.logline||'').slice(0,1500)}. Storyboard direction: ${String(scene.visual_direction||scene.description||'').slice(0,2000)}`;
      const target=`${VIDEO_BASE}/video/${encodeURIComponent(prompt)}?model=${encodeURIComponent(VIDEO_MODEL)}&duration=4&aspectRatio=16:9&image=${encodeURIComponent(imageMediaUrl)}`;
      const videoRes=await fetch(target,{method:'GET',headers:{Authorization:`Bearer ${token}`,'X-BeatVision-Request':id},signal:ctl.signal});
      if(!videoRes.ok){const text=await videoRes.text();throw new Error(`Pollinations video provider returned ${videoRes.status}: ${text.slice(0,1200)}`)}
      const videoBlob=await videoRes.blob();
      const videoMediaUrl=await uploadMedia(videoBlob,token,'beatvision-motion.mp4',ctl.signal);
      return json(r,e,{ok:true,contract_version:'1.1',capability:'video',provider:'pollinations',model:VIDEO_MODEL,latency_ms:Date.now()-start,request_id:id,result:{status:'animated',video_url:videoMediaUrl,mime_type:videoBlob.type||'video/mp4',duration_seconds:4,source_image_url:imageMediaUrl}},200);
    }catch(err){
      const timed=(err as Error)?.name==='AbortError';
      const msg=err instanceof Error?err.message:String(err);
      return json(r,e,{ok:false,contract_version:'1.1',capability:'video',provider:'pollinations',model:VIDEO_MODEL,latency_ms:Date.now()-start,request_id:id,error:timed?'Video provider timed out after 120 seconds':`Video provider request failed: ${msg.slice(0,2000)}`},timed?504:502);
    }finally{clearTimeout(tm)}
  }
};
