const PIXAZO_BASE='https://gateway.pixazo.ai';
const PIXAZO_STATUS=`${PIXAZO_BASE}/v2/requests/status/`;
const SHOTSTACK_BASE='https://api.shotstack.io';
const POLL_MS=7000;
const MAX_RETRIES=3;
const MAX_SCENES=64;
const SUBMIT_TIMEOUT_MS=45000;
const STATUS_TIMEOUT_MS=20000;
const media=(d:any)=>d?.output?.media_url?.[0]||d?.output?.media_url||d?.output||d?.url||null;
const retryable=(s:string)=>/prompt not found|provider ended this request|job ERROR|502|503|504|temporarily unavailable|rate limit|too many requests|timed out|timeout|request was rejected|aborted/i.test(s);

export class BeatVisionAnimationJob {
  state: DurableObjectState; env:any;
  constructor(state:DurableObjectState,env:any){this.state=state;this.env=env;}
  async load(){return (await this.state.storage.get<any>('job'))||null;}
  async save(job:any){await this.state.storage.put('job',job);}
  async event(job:any,event:string,details:any={}){
    const entry={at:new Date().toISOString(),event,scene:job.active_scene??(job.index+1),attempt:(job.retries||0)+1,...details};
    job.events=Array.isArray(job.events)?job.events:[];
    job.events.push(entry);
    if(job.events.length>100)job.events=job.events.slice(-100);
    job.last_event=entry;
    job.last_event_at=entry.at;
    await this.save(job);
  }
  async alarm(){await this.tick();}

  async fetchWithTimeout(input:RequestInfo|URL,init:RequestInit={},timeoutMs=30000){
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),timeoutMs);
    try{return await fetch(input,{...init,signal:controller.signal});}
    catch(error){
      if(error instanceof Error&&error.name==='AbortError')throw new Error(`Provider request timed out after ${timeoutMs}ms.`);
      throw error;
    }finally{clearTimeout(timer);}
  }

  async shotstack(path:string,init:RequestInit={}){
    const key=this.env.SHOTSTACK_API_KEY;
    if(!key) throw new Error('Shotstack fallback is not configured.');
    const headers=new Headers(init.headers||{});
    headers.set('x-api-key',key); headers.set('Accept','application/json');
    const response=await this.fetchWithTimeout(`${SHOTSTACK_BASE}${path}`,{...init,headers},STATUS_TIMEOUT_MS);
    const text=await response.text(); let data:any;
    try{data=JSON.parse(text)}catch{data={raw:text}};
    if(!response.ok)throw new Error(`Shotstack ${response.status}: ${String(data?.response?.error||data?.message||data?.error||text).slice(0,1600)}`);
    return data;
  }

  async startShotstackFallback(job:any,scene:any,source:string,duration:number){
    await this.event(job,'fallback_submit_start',{provider:'shotstack',duration_seconds:duration,source_type:source.startsWith('data:')?'data_url':'image_url'});
    const edit={timeline:{background:'#000000',tracks:[{clips:[{asset:{type:'image',src:source},start:0,length:duration,fit:'crop',effect:'zoomIn'}]}]},output:{format:'mp4',resolution:'hd',aspectRatio:'16:9',fps:25}};
    const queued=await this.shotstack('/edit/stage/render',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(edit)});
    const renderId=queued?.response?.id;
    if(!renderId)throw new Error('Shotstack fallback did not return a render ID.');
    job.fallback_render_id=renderId; job.fallback_scene=Number(scene?.scene||job.index+1); job.fallback_duration=duration; job.status='fallback'; job.fallback_started_at=Date.now();
    await this.event(job,'fallback_submitted',{provider:'shotstack',render_id:renderId});
    await this.save(job); await this.state.storage.setAlarm(Date.now()+5000);
  }

  async pollShotstackFallback(job:any){
    await this.event(job,'fallback_poll_start',{provider:'shotstack',render_id:job.fallback_render_id});
    const last=await this.shotstack(`/edit/stage/render/${encodeURIComponent(job.fallback_render_id)}`);
    const response=last?.response||last?.data||{}; const status=String(response.status||'').toLowerCase();
    await this.event(job,'fallback_poll_result',{provider:'shotstack',render_id:job.fallback_render_id,provider_status:status});
    if(status==='done'){
      const url=response.url;if(!url)throw new Error('Shotstack fallback completed without a video URL.');
      job.clips.push({scene:job.fallback_scene,status:'animated',video_url:url,source:'Shotstack Sandbox deterministic camera-motion fallback',duration_seconds:job.fallback_duration,render_id:job.fallback_render_id,motion_type:'zoomIn',watermark:true});
      await this.event(job,'scene_completed',{provider:'shotstack',source:'deterministic_fallback',video_url_present:true,duration_seconds:job.fallback_duration});
      job.index++;job.fallback_render_id=null;job.fallback_scene=null;job.fallback_duration=null;job.fallback_attempted=false;job.retries=0;job.status='running';
      await this.save(job);await this.state.storage.setAlarm(Date.now());return;
    }
    if(['failed','error'].includes(status))throw new Error(`Shotstack fallback render failed: ${String(response.error||status).slice(0,1800)}`);
    await this.save(job);await this.state.storage.setAlarm(Date.now()+POLL_MS);
  }

  async failOrFallback(job:any,scene:any,source:string,duration:number,msg:string){
    await this.event(job,'provider_failure',{provider:'pixazo_ltx',error:msg,retry_count:job.retries||0,active_request_id:job.active_request_id||null});
    if(this.env.SHOTSTACK_API_KEY&&!job.fallback_attempted){
      job.fallback_attempted=true;job.active_request_id=null;await this.save(job);
      try{await this.startShotstackFallback(job,scene,source,duration);return true;}
      catch(error){
        const fallbackError=error instanceof Error?error.message:String(error);
        await this.event(job,'fallback_failure',{provider:'shotstack',error:fallbackError});
        job.failed.push({scene:Number(scene?.scene||job.index+1),status:502,error:`Pixazo LTX failed and Shotstack fallback failed. LTX=${msg}; fallback=${fallbackError}`,request_id:null});
        job.index++;job.fallback_attempted=false;job.retries=0;job.status='running';await this.save(job);await this.state.storage.setAlarm(Date.now());return true;
      }
    }
    job.failed.push({scene:Number(scene?.scene||job.index+1),status:502,error:msg,request_id:job.active_request_id||null});
    job.index++;job.active_request_id=null;job.active_scene=null;job.active_duration=null;job.fallback_attempted=false;job.retries=0;job.status='running';await this.save(job);await this.state.storage.setAlarm(Date.now());return true;
  }

  async tick(){
    const job=await this.load();if(!job||job.status==='completed'||job.status==='partial'||job.status==='failed')return;
    try{
      if(job.fallback_render_id){await this.pollShotstackFallback(job);return;}
      const scene=job.scenes[job.index];
      if(!scene){job.status=job.failed.length?'partial':'completed';job.completed_at=new Date().toISOString();await this.event(job,'job_completed',{completed:job.clips.length,failed:job.failed.length,total:job.scenes.length});await this.save(job);return;}
      const item=job.images.find((x:any)=>Number(x?.scene)===Number(scene?.scene))||job.images[job.index];
      const source=item?.image_url||item?.url||item?.data_url;
      const duration=Math.max(2.5,Math.min(Number(scene?.duration_seconds)||4,5.5));
      if(!source){await this.event(job,'missing_image',{scene:Number(scene?.scene||job.index+1)});job.failed.push({scene:Number(scene?.scene||job.index+1),status:'missing_image',error:'No source image.'});job.index++;job.retries=0;job.status='running';await this.save(job);await this.state.storage.setAlarm(Date.now());return;}
      if(!job.active_request_id){
        await this.event(job,'pixazo_submit_start',{provider:'pixazo_ltx',endpoint:'/ltx-video/v1/image-to-video',duration_seconds:duration,image_source:source.startsWith('data:')?'data_url':'remote_url',timeout_ms:SUBMIT_TIMEOUT_MS});
        const started=Date.now();
        const response=await this.fetchWithTimeout(`${PIXAZO_BASE}/ltx-video/v1/image-to-video`,{method:'POST',headers:{'Content-Type':'application/json','Cache-Control':'no-cache','Ocp-Apim-Subscription-Key':this.env.PIXAZO_API_KEY},body:JSON.stringify({prompt:this.prompt(scene),image_url:source,aspect:'16:9',num_frames:Math.round(duration*24)+1,frame_rate:24,steps:8,cfg:3})},SUBMIT_TIMEOUT_MS);
        const text=await response.text();let data:any;try{data=JSON.parse(text)}catch{data={raw:text}};
        await this.event(job,'pixazo_submit_response',{provider:'pixazo_ltx',http_status:response.status,elapsed_ms:Date.now()-started,request_id:data?.request_id||null,response_keys:Object.keys(data||{}),has_media_url:!!media(data)});
        if(!response.ok)throw new Error(`Pixazo ltx-video ${response.status}: ${String(data?.message||data?.error||text).slice(0,1600)}`);
        if(!data?.request_id){const url=media(data);if(!url)throw new Error('Pixazo LTX returned no request_id or video URL.');job.clips.push({scene:Number(scene?.scene||job.index+1),status:'animated',video_url:url,source:'Pixazo free LTX image-to-video',duration_seconds:duration,pixazo_request_id:null});await this.event(job,'scene_completed',{provider:'pixazo_ltx',source:'direct_media_url',duration_seconds:duration});job.index++;job.retries=0;job.fallback_attempted=false;job.status='running';await this.save(job);await this.state.storage.setAlarm(Date.now());return;}
        job.active_request_id=data.request_id;job.active_scene=Number(scene?.scene||job.index+1);job.active_duration=duration;job.active_started_at=Date.now();job.retries=0;job.status='running';await this.event(job,'pixazo_request_accepted',{provider:'pixazo_ltx',request_id:data.request_id,scene:job.active_scene,timeout_ms:STATUS_TIMEOUT_MS,poll_interval_ms:POLL_MS});await this.save(job);await this.state.storage.setAlarm(Date.now()+POLL_MS);return;
      }
      await this.event(job,'pixazo_status_poll_start',{provider:'pixazo_ltx',request_id:job.active_request_id,elapsed_ms:Date.now()-(job.active_started_at||Date.now()),timeout_ms:STATUS_TIMEOUT_MS});
      const pollStarted=Date.now();
      const response=await this.fetchWithTimeout(`${PIXAZO_STATUS}${encodeURIComponent(job.active_request_id)}`,{headers:{'Ocp-Apim-Subscription-Key':this.env.PIXAZO_API_KEY,'Cache-Control':'no-cache'}},STATUS_TIMEOUT_MS);
      const text=await response.text();let data:any;try{data=JSON.parse(text)}catch{data={}};
      await this.event(job,'pixazo_status_poll_result',{provider:'pixazo_ltx',request_id:job.active_request_id,http_status:response.status,elapsed_ms:Date.now()-pollStarted,provider_status:data?.status||null,response_keys:Object.keys(data||{}),has_media_url:!!media(data)});
      if(!response.ok)throw new Error(`Pixazo ltx-video status ${response.status}: ${text.slice(0,1200)}`);
      const status=String(data?.status||'').toUpperCase();
      if(status==='COMPLETED'||status==='SUCCEEDED'){
        const url=media(data);if(!url)throw new Error('Pixazo LTX completed without media output.');
        job.clips.push({scene:job.active_scene,status:'animated',video_url:url,source:'Pixazo free LTX image-to-video',duration_seconds:job.active_duration,pixazo_request_id:job.active_request_id});
        await this.event(job,'scene_completed',{provider:'pixazo_ltx',source:'generated_motion',request_id:job.active_request_id,duration_seconds:job.active_duration,elapsed_ms:Date.now()-(job.active_started_at||Date.now())});
        job.index++;job.active_request_id=null;job.active_scene=null;job.active_duration=null;job.retries=0;job.fallback_attempted=false;job.status='running';await this.save(job);await this.state.storage.setAlarm(Date.now());return;
      }
      if(['ERROR','FAILED','CANCELLED'].includes(status)){const msg=`Pixazo ltx-video job ${status}: ${String(data?.error||'provider error').slice(0,1600)}`;await this.failOrFallback(job,scene,source,duration,msg);return;}
      await this.save(job);await this.state.storage.setAlarm(Date.now()+POLL_MS);return;
    }catch(err){
      const msg=err instanceof Error?err.message:String(err);job.retries=(job.retries||0)+1;
      await this.event(job,'tick_error',{error:msg,retry_count:job.retries,active_request_id:job.active_request_id||null});
      const scene=job.scenes[job.index];const item=job.images.find((x:any)=>Number(x?.scene)===Number(scene?.scene))||job.images[job.index];const source=item?.image_url||item?.url||item?.data_url;const duration=Math.max(2.5,Math.min(Number(scene?.duration_seconds)||4,5.5));
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
    const scenes=Array.isArray(body?.storyboard?.scenes)?body.storyboard.scenes.slice(0,MAX_SCENES):[];const images=Array.isArray(body?.images?.images)?body.images.images:[];
    if(!scenes.length||!images.length)return Response.json({ok:false,error:'Animation job requires storyboard scenes and generated images.'},{status:400});
    const job={job_id:body.job_id,status:'queued',created_at:new Date().toISOString(),index:0,scenes,images,clips:[],failed:[],retries:0,active_request_id:null,active_scene:null,active_duration:null,active_started_at:null,fallback_attempted:false,fallback_render_id:null,fallback_scene:null,fallback_duration:null,events:[],last_event:null,last_event_at:null};
    await this.event(job,'job_created',{total_scenes:scenes.length,total_images:images.length,max_scenes:MAX_SCENES,max_retries:MAX_RETRIES,submit_timeout_ms:SUBMIT_TIMEOUT_MS,status_timeout_ms:STATUS_TIMEOUT_MS,poll_interval_ms:POLL_MS});
    await this.save(job);await this.state.storage.setAlarm(Date.now());return Response.json(job,{status:202});
  }
}