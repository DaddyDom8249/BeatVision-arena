import pixazo from './video-fallback-gateway';
export { BeatVisionAnimationJob } from './animation-jobs';

const BASE = 'https://gateway.pixazo.ai';
const CONTRACT = '1.1';

const cors = (r: Request, e: any) => {
  const origin = r.headers.get('Origin') || '';
  const allowed = String(e.ALLOWED_ORIGIN || '').split(',').map((x: string) => x.trim()).filter(Boolean);
  return {
    'Access-Control-Allow-Origin': origin && (!allowed.length || allowed.includes(origin)) ? origin : (allowed[0] || '*'),
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,X-BeatVision-Contract,Authorization,X-BeatVision-Request'
  };
};

const json = (r: Request, e: any, data: unknown, status = 200) =>
  new Response(JSON.stringify(data, null, 2), { status, headers: { 'Content-Type': 'application/json', ...cors(r, e) } });
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const clip = (value: unknown, max: number) => String(value ?? '').slice(0, max);
const media = (d: any) => d?.output?.media_url?.[0] || d?.output?.media_url || d?.output || d?.imageUrl || d?.image_url || d?.url || null;

const composition = ['wide environmental establishing composition with the character small in frame','medium character-focused composition with visible interaction with the environment','tight emotional close-up emphasizing face, hands, or a meaningful object','side/profile composition with strong negative space and directional movement','low-angle composition making the environment feel imposing around the character','high-angle or elevated composition revealing spatial relationships','silhouette/backlit composition using the established world lighting and atmosphere','reflection/foreground-obstruction composition using glass, mirrors, rain, architecture, or another established motif'];
const action = ['walking or changing position through the established location','interacting with a meaningful object or environmental element','pausing and reacting physically to an internal realization','turning, looking, or tracking something outside the frame','moving from one spatial zone to another','performing a restrained physical gesture that expresses the beat emotion','observing the environment while the environment provides the visual event','creating a visible consequence of the previous beat'];
const camera = ['slow lateral tracking move','slow push-in','slow pull-back revealing context','controlled handheld follow','arc around the subject','vertical reveal or tilt','locked-off composition with environmental motion','foreground-to-background rack-focus style reveal'];
const lighting = ['rainy diffuse backlight','hard side light through architecture','practical interior light against deep shadow','cool reflected city light','strong silhouette against atmospheric haze','isolated pool of light surrounded by darkness','wet reflective surfaces catching sparse highlights','mixed warm interior and cold exterior light'];
function hash(text: string) { let h=2166136261>>>0; for(let i=0;i<text.length;i+=1) h=Math.imul(h^text.charCodeAt(i),16777619); return h>>>0; }
function pick<T>(items:T[],h:number,o:number){return items[(h+o)%items.length];}
function variationDirective(scene:any,index:number){
  const id=String(scene?.beatId||scene?.beat_id||scene?.scene||index+1), h=hash(id);
  return [
    'VISUAL DIVERSITY DIRECTIVE:',
    `This is visual beat ${index+1}. Generate a genuinely new visual event, not a reordered, recolored, or reframed copy of another beat.`,
    `Composition: ${pick(composition,h,0)}.`,
    `Primary action: ${pick(action,h,1)}.`,
    `Camera language: ${pick(camera,h,2)}.`,
    `Lighting treatment: ${pick(lighting,h,3)}.`,
    `Previous beat: ${scene?.previousBeat||scene?.previous_beat||'none'}. Next beat: ${scene?.nextBeat||scene?.next_beat||'none'}.`,
    'Preserve the established character identity, world rules, locations, motifs, emotional truth, and original concept.',
    'Do not duplicate the previous beat composition, pose, framing, camera angle, or primary action unless reusePolicy is intentional_motif_return.',
    'Do not create a generic portrait merely because the character is present. The environment and action must contribute to the story.',
    'For repeated lyrics, change the visual event, consequence, composition, or emotional state. Reuse a motif only when narratively intentional.'
  ].join(' ');
}

const scenePrompt = (payload:any,scene:any,index:number,total:number) => {
  const world=payload?.world||{};
  const character=clip(JSON.stringify(world?.character_concept||{}),1000);
  const locations=clip(JSON.stringify(world?.locations||[]),800);
  const motifs=clip(JSON.stringify(world?.visual_motifs||[]),900);
  const continuity=clip(JSON.stringify(world?.continuity_rules||[]),700);
  const style=clip(payload?.style,600);
  return clip([
    'BeatVision cinematic music-video scene still.',
    'Dark industrial realism, cinematic lighting, coherent recurring character and environment.',
    'No text, logos, watermarks, captions, UI or typography.',
    style?`Style: ${style}`:'',
    character?`Character continuity: ${character}`:'',
    locations?`World locations: ${locations}`:'',
    motifs?`Visual motifs: ${motifs}`:'',
    continuity?`Continuity rules: ${continuity}`:'',
    `Storyboard scene: ${clip(JSON.stringify(scene),1800)}`,
    variationDirective(scene,index),
    'The image must be a distinct story event while remaining unmistakably inside the supplied BeatVision world.'
  ].filter(Boolean).join('\n'),12000);
};

async function pixazoPost(path:string,key:string,body:any){
  const response=await fetch(`${BASE}${path}`,{method:'POST',headers:{'Content-Type':'application/json','Cache-Control':'no-cache','Ocp-Apim-Subscription-Key':key},body:JSON.stringify(body)});
  const text=await response.text(); let data:any; try{data=JSON.parse(text)}catch{data={raw:text}};
  if(!response.ok)throw new Error(`Pixazo ${response.status} at ${path}: ${String(data?.message||data?.error||text).slice(0,1600)}`); return data;
}
async function generateSceneImage(key:string,prompt:string,sceneNumber:number){
  let lastError='';
  for(let attempt=1;attempt<=3;attempt+=1){try{
    const data=await pixazoPost('/getImage/v1/getSDXLImage',key,{prompt,negative_prompt:'low quality, blurry, distorted anatomy, duplicate face, extra limbs, text, logo, watermark, UI, caption, repeated composition, duplicate shot',height:576,width:1024,num_steps:20,guidance:5,seed:Math.floor(Math.random()*2147483647)});
    const url=media(data); if(!url)throw new Error('SDXL completed without an image URL.'); return {image_url:url,model:'sdxl'};
  }catch(error){lastError=error instanceof Error?error.message:String(error);if(attempt<3)await sleep(1500*attempt)}}
  try{
    const data=await pixazoPost('/flux-1-schnell/v1/getData',key,{prompt:clip(prompt,2048),num_steps:4,height:576,width:1024,seed:Math.floor(Math.random()*2147483647)});
    const url=media(data);if(!url)throw new Error('Flux Schnell completed without an image URL.');return {image_url:url,model:'flux-1-schnell',fallback_reason:lastError};
  }catch(error){const fluxError=error instanceof Error?error.message:String(error);throw new Error(`scene ${sceneNumber}: SDXL failed after 3 attempts; Flux Schnell fallback also failed. SDXL=${lastError}; Flux=${fluxError}`)}
}

async function resilientSceneImages(r:Request,e:any,body:any,requestId:string){
  const key=e.PIXAZO_API_KEY;if(!key)return json(r,e,{ok:false,error:'PIXAZO_API_KEY is not configured.',request_id:requestId},503);
  if(body?.contract_version!==CONTRACT)return json(r,e,{ok:false,error:'Expected BeatVision contract 1.1.',request_id:requestId},400);
  const payload=body?.payload||{};const scenes=Array.isArray(payload?.storyboard?.scenes)?payload.storyboard.scenes:[];
  if(!scenes.length)return json(r,e,{ok:false,status:'invalid_input',request_id:requestId,error:'Storyboard contains no scenes.'},400);
  if(scenes.length>1)return json(r,e,{ok:false,status:'invalid_input',request_id:requestId,error:'Scene image gateway expects one visual beat per request. Batch the beats at the client/orchestration layer so failures remain isolated.'},400);
  const started=Date.now();const images:any[]=[];const models=new Set<string>();
  try{for(let i=0;i<scenes.length;i+=1){const sceneNumber=Number(scenes[i]?.scene||i+1);const generated=await generateSceneImage(key,scenePrompt(payload,scenes[i],i,scenes.length),sceneNumber);images.push({scene:sceneNumber,beatId:scenes[i]?.beatId||null,status:'generated',image_url:generated.image_url,model:generated.model});models.add(generated.model)}
    return json(r,e,{ok:true,contract_version:CONTRACT,capability:'image',provider:'pixazo',model:Array.from(models).join('+'),request_id:requestId,latency_ms:Date.now()-started,result:{images,models_used:Array.from(models),scene_count:images.length,free_only:true}});
  }catch(error){return json(r,e,{ok:false,contract_version:CONTRACT,capability:'image',provider:'pixazo',status:'provider_error',request_id:requestId,latency_ms:Date.now()-started,completed_scene_count:images.length,completed_scenes:images.map(image=>image.scene),error:String(error instanceof Error?error.message:error).slice(0,2200)},502)}
}

function splitLongBeats(storyboard:any){
  const source=Array.isArray(storyboard?.scenes)?storyboard.scenes:Array.isArray(storyboard?.visual_beats)?storyboard.visual_beats:[];
  const expanded:any[]=[];
  for(const original of source){
    const start=Number(original?.startTime??original?.start_time??0);
    const end=Number(original?.endTime??original?.end_time??start+Number(original?.duration_seconds||4));
    const duration=Math.max(.1,end-start), parts=Math.max(1,Math.ceil(duration/5));
    for(let part=0;part<parts;part++){
      const a=start+duration*part/parts,b=start+duration*(part+1)/parts;
      expanded.push({...original,scene:expanded.length+1,beatId:`${original?.beatId||original?.beat_id||`beat-${expanded.length+1}`}-part-${part+1}`,startTime:a,endTime:b,duration_seconds:b-a,visual_variation_part:`${part+1}/${parts}`,visual_variation_parent:original?.beatId||original?.beat_id||original?.scene||null,reusePolicy:part===0?(original?.reusePolicy||original?.reuse_policy||'new_visual_event'):'new_visual_event'});
    }
  }
  expanded.forEach((b,i)=>{b.previousBeat=i?expanded[i-1].beatId:null;b.nextBeat=i+1<expanded.length?expanded[i+1].beatId:null});
  return expanded;
}
async function storyboardWithRenderSafeBeats(r:Request,e:any,body:any){
  const upstream=await pixazo.fetch(new Request(r.url,{method:'POST',headers:new Headers(r.headers),body:JSON.stringify(body)}),e);
  if(!upstream.ok)return upstream;
  let data:any;try{data=await upstream.clone().json()}catch{return upstream;}
  const result=data?.result;if(!result||typeof result!=='object')return upstream;
  const scenes=Array.isArray(result.scenes)?result.scenes:Array.isArray(result.visual_beats)?result.visual_beats:null;if(!scenes?.length)return upstream;
  const expanded=splitLongBeats({...result,scenes});if(expanded.length<=scenes.length)return upstream;
  const updated={...data,result:{...result,scenes:expanded,visual_beats:expanded,scene_count:expanded.length,render_safe_scene_count:expanded.length,coverage:result.coverage?{...result.coverage,visual_beats:expanded.length,render_safe_scene_count:expanded.length,long_beats:0}:result.coverage}};
  return new Response(JSON.stringify(updated,null,2),{status:upstream.status,headers:{'Content-Type':'application/json',...cors(r,e)}});
}

export default {async fetch(r:Request,e:any){
  if(r.method==='OPTIONS')return new Response(null,{status:204,headers:cors(r,e)});
  const requestId=r.headers.get('X-BeatVision-Request')||crypto.randomUUID();
  if(e.GATEWAY_TOKEN&&r.headers.get('Authorization')!==`Bearer ${e.GATEWAY_TOKEN}`)return json(r,e,{ok:false,error:'Unauthorized',request_id:requestId},401);
  let body:any;try{body=await r.clone().json()}catch{return pixazo.fetch(r,e)}
  if(body?.operation==='sceneImages')return resilientSceneImages(r,e,body,requestId);
  if(body?.operation==='storyboard')return storyboardWithRenderSafeBeats(r,e,body);
  return pixazo.fetch(r,e);
}};
