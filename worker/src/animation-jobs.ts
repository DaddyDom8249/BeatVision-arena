const PIXAZO_BASE='https://gateway.pixazo.ai';
const PIXAZO_STATUS=`${PIXAZO_BASE}/v2/requests/status/`;
const SHOTSTACK_BASE='https://api.shotstack.io';
const POLL_MS=7000;
const MAX_RETRIES=3;
const media=(d:any)=>d?.output?.media_url?.[0]||d?.output?.media_url||d?.output||d?.url||null;
const retryable=(s:string)=>/prompt not found|provider ended this request|job ERROR|502|503|504|temporarily unavailable|rate limit|too many requests|timed out|request was rejected/i.test(s);

export class BeatVisionAnimationJob {
  state: DurableObjectState; env:any;
  constructor(state:DurableObjectState,env:any){this.state=state;this.env=env;}
  async load(){return (await this.state.storage.get<any>('job'))||null;}
  async save(job:any){await this.state.storage.put('job',job);}
  async alarm(){await this.tick();}

  async shotstack(path:string,init:RequestInit={}){
    const key=this.env.SHOTSTACK_API_KEY;
    if(!key) throw new Error('Shotstack fallback is not configured.');
    const headers=new Headers(init.headers||{});
    headers.set('x-api-key',key); headers.set('Accept','application/json');
    const response=await fetch(`${SHOTSTACK_BASE}${path}`,{...init,headers});
    const text=await response.text(); let data:any;
    try{data=JSON.parse(text)}catch{data={raw:text}};
    if(!response.ok)throw new Error(`Shotstack ${response.status}: ${String(data?.response?.error||data?.message||data?.error||text).slice(0,1600)}`);
    return data;
  }

  async startShotstackFallback(job:any,scene:any,source:string,duration:number){
    const edit={
      timeline:{
        background:'#000000',
        tracks:[{clips:[{asset:{type:'image',src:source},start:0,length:duration,fit:'crop',effect:'zoomIn'}]}]
      },
      output:{format:'mp4',resolution:'hd',aspectRatio:'16:9',fps:25}
    };
    const queued=await this.shotstack('/edit/stage/render',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(edit)});
    const renderId=queued?.response?.id;
    if(!renderId)throw new Error('Shotstack fallback did not return a render ID.');
    job.fallback_render_id=renderId;
    job.fallback_scene=Number(scene?.scene||job.index+1);
    job.fallback_duration=duration;
    job.status='fallback';
    job.fallback_started_at=Date.now();
    await this.save(job);
    await this.state.storage.setAlarm(Date.now()+5000);
  }

  async pollShotstackFallback(job:any){
    const last=await this.shotstack(`/edit/stage/render/${encodeURIComponent(job.fallback_render_id)}`);
    const response=last?.response||last?.data||{};
    const status=String(response.status||'').toLowerCase();
    if(status==='done'){
      const url=response.url;
      if(!url)throw new Error('Shotstack fallback completed without a video URL.');
      job.clips.push({scene:job.fallback_scene,status:'animated',video_url:url,source:'Shotstack Sandbox deterministic camera-motion fallback',duration_seconds:job.fallback_duration,render_id:job.fallback_render_id,motion_type:'zoomIn',watermark:true});
      job.index++; job.fallback_render_id=null; job.fallback_scene=null; job.fallback_duration=null; job.fallback_attempted=false; job.retries=0; job.status='running';
      await this.save(job); await this.state.storage.setAlarm(Date.now()); return;
    }
    if(['failed','error'].includes(status))throw new Error(`Shotstack fallback render failed: ${String(response.error||status).slice(0,1800)}`);
    await this.state.storage.setAlarm(Date.now()+POLL_MS);
  }

  async failOrFallback(job:any,scene:any,source:string,duration:number,msg:string){
    if(this.env.SHOTSTACK_API_KEY&&!job.fallback_attempted){
      job.fallback_attempted=true;
      job.active_request_id=null;
      await this.save(job);
      try{await this.startShotstackFallback(job,scene,source,duration);return true;}
      catch(error){
        const fallbackError=error instanceof Error?error.message:String(error);
        job.failed.push({scene:Number(scene?.scene||job.index+1),status:502,error:`Pixazo LTX failed and Shotstack fallback failed. LTX=${msg}; fallback=${fallbackError}`,request_id:null});
        job.index++; job.fallback_attempted=false; job.retries=0; job.status='running'; await this.save(job); await this.state.storage.setAlarm(Date.now()); return true;
      }
    }
    job.failed.push({scene:Number(scene?.scene||job.index+1),status:502,error:msg,request_id:job.active_request_id||null});
    job.index++; job.active_request_id=null; job.active_scene=null; job.active_duration=null; job.fallback_attempted=false; job.retries=0; job.status='running';
    await this.save(job); await this.state.storage.setAlarm(Date.now()); return true;
  }

  async tick(){
    const job=await this.load(); if(!job||job.status==='completed'||job.status==='partial'||job.status==='failed')return;
    try{
      if(job.fallback_render_id){await this.pollShotstackFallback(job);return;}
      const scene=job.scenes[job.index];
      if(!scene){job.status=job.failed.length?'partial':'completed';job.completed_at=new Date().toISOString();await this.save(job);return;}
      const item=job.images.find((x:any)=>Number(x?.scene)===Number(scene?.scene))||job.images[job.index];
      const source=item?.image_url||item?.url||item?.data_url;
      const duration=Math.max(2.5,Math.min(Number(scene?.duration_seconds)||4,5.5));
      if(!source){job.failed.push({scene:Number(scene?.scene||job.index+1),status:'missing_image',error:'No source image.'});job.index++;job.retries=0;job.status='running';await this.save(job);await this.state.storage.setAlarm(Date.now());return;}
      if(!job.active_request_id){
        const response=await fetch(`${PIXAZO_BASE}/ltx-video/v1/image-to-video`,{method:'POST',headers:{'Content-Type':'application/json','Cache-Control':'no-cache','Ocp-Apim-Subscription-Key':this.env.PIXAZO_API_KEY},body:JSON.stringify({prompt:this.prompt(scene),image_url:source,aspect:'16:9',num_frames:Math.round(duration*24)+1,frame_rate:24,steps:8,cfg:3})});
        const text=await response.text();let data:any;try{data=JSON.parse(text)}catch{data={raw:text}};
        if(!response.ok)throw new Error(`Pixazo ltx-video ${response.status}: ${String(data?.message||data?.error||text).slice(0,1600)}`);
        if(!data?.request_id){const url=media(data);if(!url)throw new Error('Pixazo LTX returned no request_id or video URL.');job.clips.push({scene:Number(scene?.scene||job.index+1),status:'animated',video_url:url,source:'Pixazo free LTX image-to-video',duration_seconds:duration,pixazo_request_id:null});job.index++;job.retries=0;job.fallback_attempted=false;job.status='running';await this.save(job);await this.state.storage.setAlarm(Date.now());return;}
        job.active_request_id=data.request_id;job.active_scene=Number(scene?.scene||job.index+1);job.active_duration=duration;job.active_started_at=Date.now();job.retries=0;job.status='running';await this.save(job);await this.state.storage.setAlarm(Date.now()+POLL_MS);return;
      }
      const response=await fetch(`${PIXAZO_STATUS}${encodeURIComponent(job.active_request_id)}`,{headers:{'Ocp-Apim-Subscription-Key':this.env.PIXAZO_API_KEY,'Cache-Control':'no-cache'}});
      const text=await response.text();let data:any;try{data=JSON.parse(text)}catch{data={}};
      if(!response.ok)throw new Error(`Pixazo ltx-video status ${response.status}: ${text.slice(0,1200)}`);
      const status=String(data?.status||'').toUpperCase();
      if(status==='COMPLETED'||status==='SUCCEEDED'){
        const url=media(data);if(!url)throw new Error('Pixazo LTX completed without media output.');
        job.clips.push({scene:job.active_scene,status:'animated',video_url:url,source:'Pixazo free LTX image-to-video',duration_seconds:job.active_duration,pixazo_request_id:job.active_request_id});
        job.index++;job.active_request_id=null;job.active_scene=null;job.active_duration=null;job.retries=0;job.fallback_attempted=false;job.status='running';await this.save(job);await this.state.storage.setAlarm(Date.now());return;
      }
      if(['ERROR','FAILED','CANCELLED'].includes(status)){
        const msg=`Pixazo ltx-video job ${status}: ${String(data?.error||'provider error').slice(0,1600)}`;
        await this.failOrFallback(job,scene,source,duration,msg);return;
      }
      await this.state.storage.setAlarm(Date.now()+POLL_MS);return;
    }catch(err){
      const msg=err instanceof Error?err.message:String(err);job.retries=(job.retries||0)+1;
      const scene=job.scenes[job.index];
      const item=job.images.find((x:any)=>Number(x?.scene)===Number(scene?.scene))||job.images[job.index];
      const source=item?.image_url||item?.url||item?.data_url;
      const duration=Math.max(2.5,Math.min(Number(scene?.duration_seconds)||4,5.5));
      if(job.retries<MAX_RETRIES&&retryable(msg)){await this.save(job);await this.state.storage.setAlarm(Date.now()+1500*job.retries);return;}
      if(source){await this.failOrFallback(job,scene,source,duration,msg);return;}
      job.failed.push({scene:Number(scene?.scene||job.index+1),status:502,error:msg,request_id:job.active_request_id||null});job.index++;job.active_request_id=null;job.active_scene=null;job.active_duration=null;job.retries=0;job.fallback_attempted=false;job.status='running';await this.save(job);await this.state.storage.setAlarm(Date.now());
    }
  }
  prompt(scene:any){return ['BeatVision cinematic music-video motion shot.','Preserve the approved character, environment, composition and visual identity.','Natural subtle cinematic camera movement, realistic motion, coherent anatomy, no text, logos, watermarks or captions.',`Storyboard: ${JSON.stringify(scene).slice(0,3500)}`].join('\n');}
  async fetch(req:Request){
    if(req.method==='GET')return Response.json(await this.load()||{status:'not_found'});
    if(req.method!=='POST')return new Response('Method Not Allowed',{status:405});
    const body:any=await req.json();const existing=await this.load();if(existing)return Response.json(existing);
    const scenes=Array.isArray(body?.storyboard?.scenes)?body.storyboard.scenes.slice(0,24):[];const images=Array.isArray(body?.images?.images)?body.images.images:[];
    if(!scenes.length||!images.length)return Response.json({ok:false,error:'Animation job requires storyboard scenes and generated images.'},{status:400});
    const job={job_id:body.job_id,status:'queued',created_at:new Date().toISOString(),index:0,scenes,images,clips:[],failed:[],retries:0,active_request_id:null,active_scene:null,active_duration:null,fallback_attempted:false,fallback_render_id:null,fallback_scene:null,fallback_duration:null};
    await this.save(job);await this.state.storage.setAlarm(Date.now());return Response.json(job,{status:202});
  }
}
