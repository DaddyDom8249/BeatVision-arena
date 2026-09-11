const BASE='https://gateway.pixazo.ai';
const STATUS=`${BASE}/v2/requests/status/`;
const POLL_MS=7000;
const MAX_RETRIES=3;
const media=(d:any)=>d?.output?.media_url?.[0]||d?.output?.media_url||d?.output||d?.url||null;
const retryable=(s:string)=>/prompt not found|provider ended this request|job ERROR|502|503|504|temporarily unavailable|rate limit|too many requests|timed out/i.test(s);

export class BeatVisionAnimationJob {
  state: DurableObjectState; env:any;
  constructor(state:DurableObjectState,env:any){this.state=state;this.env=env;}
  async load(){return (await this.state.storage.get<any>('job'))||null;}
  async save(job:any){await this.state.storage.put('job',job);}
  async alarm(){await this.tick();}
  async tick(){
    const job=await this.load(); if(!job||job.status==='completed'||job.status==='partial'||job.status==='failed')return;
    try{
      const scene=job.scenes[job.index];
      if(!scene){job.status=job.failed.length?'partial':'completed';job.completed_at=new Date().toISOString();await this.save(job);return;}
      if(!job.active_request_id){
        const item=job.images.find((x:any)=>Number(x?.scene)===Number(scene?.scene))||job.images[job.index];
        const source=item?.image_url||item?.url||item?.data_url;
        if(!source){job.failed.push({scene:Number(scene?.scene||job.index+1),status:'missing_image',error:'No source image.'});job.index++;job.retries=0;await this.save(job);await this.state.storage.setAlarm(Date.now());return;}
        const duration=Math.max(2.5,Math.min(Number(scene?.duration_seconds)||4,5.5));
        const response=await fetch(`${BASE}/ltx-video/v1/image-to-video`,{method:'POST',headers:{'Content-Type':'application/json','Cache-Control':'no-cache','Ocp-Apim-Subscription-Key':this.env.PIXAZO_API_KEY},body:JSON.stringify({prompt:this.prompt(scene),image_url:source,aspect:'16:9',num_frames:Math.round(duration*24)+1,frame_rate:24,steps:8,cfg:3})});
        const text=await response.text();let data:any;try{data=JSON.parse(text)}catch{data={raw:text}};
        if(!response.ok)throw new Error(`Pixazo ltx-video ${response.status}: ${String(data?.message||data?.error||text).slice(0,1600)}`);
        if(!data?.request_id){const url=media(data);if(!url)throw new Error('Pixazo LTX returned no request_id or video URL.');job.clips.push({scene:Number(scene?.scene||job.index+1),status:'animated',video_url:url,source:'Pixazo free LTX image-to-video',duration_seconds:duration,pixazo_request_id:null});job.index++;job.retries=0;await this.save(job);await this.state.storage.setAlarm(Date.now());return;}
        job.active_request_id=data.request_id;job.active_scene=Number(scene?.scene||job.index+1);job.active_duration=duration;job.active_started_at=Date.now();job.retries=0;await this.save(job);await this.state.storage.setAlarm(Date.now()+POLL_MS);return;
      }
      const response=await fetch(`${STATUS}${encodeURIComponent(job.active_request_id)}`,{headers:{'Ocp-Apim-Subscription-Key':this.env.PIXAZO_API_KEY,'Cache-Control':'no-cache'}});
      const text=await response.text();let data:any;try{data=JSON.parse(text)}catch{data={}};
      if(!response.ok)throw new Error(`Pixazo ltx-video status ${response.status}: ${text.slice(0,1200)}`);
      const status=String(data?.status||'').toUpperCase();
      if(status==='COMPLETED'||status==='SUCCEEDED'){
        const url=media(data);if(!url)throw new Error('Pixazo LTX completed without media output.');
        job.clips.push({scene:job.active_scene,status:'animated',video_url:url,source:'Pixazo free LTX image-to-video',duration_seconds:job.active_duration,pixazo_request_id:job.active_request_id});
        job.index++;job.active_request_id=null;job.active_scene=null;job.active_duration=null;job.retries=0;await this.save(job);await this.state.storage.setAlarm(Date.now());return;
      }
      if(['ERROR','FAILED','CANCELLED'].includes(status))throw new Error(`Pixazo ltx-video job ${status}: ${String(data?.error||'provider error').slice(0,1600)}`);
      await this.state.storage.setAlarm(Date.now()+POLL_MS);return;
    }catch(err){
      const msg=err instanceof Error?err.message:String(err);job.retries=(job.retries||0)+1;
      if(job.retries<MAX_RETRIES&&retryable(msg)){job.active_request_id=null;await this.save(job);await this.state.storage.setAlarm(Date.now()+1500*job.retries);return;}
      job.failed.push({scene:job.active_scene??Number(job.scenes[job.index]?.scene||job.index+1),status:502,error:msg,request_id:job.active_request_id||null});
      job.index++;job.active_request_id=null;job.active_scene=null;job.active_duration=null;job.retries=0;await this.save(job);await this.state.storage.setAlarm(Date.now());
    }
  }
  prompt(scene:any){return ['BeatVision cinematic music-video motion shot.','Preserve the approved character, environment, composition and visual identity.','Natural subtle cinematic camera movement, realistic motion, coherent anatomy, no text, logos, watermarks or captions.',`Storyboard: ${JSON.stringify(scene).slice(0,3500)}`].join('\n');}
  async fetch(req:Request){
    if(req.method==='GET')return Response.json(await this.load()||{status:'not_found'});
    if(req.method!=='POST')return new Response('Method Not Allowed',{status:405});
    const body:any=await req.json();const existing=await this.load();if(existing)return Response.json(existing);
    const scenes=Array.isArray(body?.storyboard?.scenes)?body.storyboard.scenes.slice(0,24):[];const images=Array.isArray(body?.images?.images)?body.images.images:[];
    if(!scenes.length||!images.length)return Response.json({ok:false,error:'Animation job requires storyboard scenes and generated images.'},{status:400});
    const job={job_id:body.job_id,status:'queued',created_at:new Date().toISOString(),index:0,scenes,images,clips:[],failed:[],retries:0,active_request_id:null};
    await this.save(job);await this.state.storage.setAlarm(Date.now());return Response.json(job,{status:202});
  }
}
