const BV_ANIMATION_JOB_KEY='beatvision_animation_job';
const BV_RETRY_DELAYS=[2000,5000,10000];
async function bvNetworkFetch(url,options={},label='request'){
 let last;
 for(let attempt=0;attempt<=BV_RETRY_DELAYS.length;attempt++){
  try{
   return await fetch(url,options);
  }catch(error){
   last=error;
   if(attempt===BV_RETRY_DELAYS.length)break;
   log(`${label} network interruption; retrying ${attempt+1}/${BV_RETRY_DELAYS.length}.`);
   await new Promise(resolve=>setTimeout(resolve,BV_RETRY_DELAYS[attempt]));
  }
 }
 throw new Error(`${label} failed after network retries: ${last?.message||'Failed to fetch'}`);
}
async function bvStartPersistentAnimation(payload){
 const base=gateway(); if(!base) throw new Error('No gateway URL configured.');
 const jobId=crypto.randomUUID(); localStorage.setItem(BV_ANIMATION_JOB_KEY,jobId);
 const r=await bvNetworkFetch(`${base}/v1/video/animate/jobs/${jobId}`,{method:'POST',headers:{...gatewayHeaders(),'X-BeatVision-Contract':C.version,'X-BeatVision-Request':jobId},body:JSON.stringify(payload)},'Animation job submission');
 const text=await r.text();let d;try{d=JSON.parse(text)}catch{d={raw:text}};if(!r.ok)throw Object.assign(new Error(`${r.status}: ${d.error||text}`),{status:r.status,data:d});return d;
}
async function bvWaitPersistentAnimation(jobId,onUpdate){
 const base=gateway();
 while(true){
  const r=await bvNetworkFetch(`${base}/v1/video/animate/jobs/${jobId}`,{headers:gatewayHeaders()},'Animation job status');
  const text=await r.text();let d;try{d=JSON.parse(text)}catch{d={raw:text}};if(!r.ok)throw Object.assign(new Error(`${r.status}: ${d.error||text}`),{status:r.status,data:d});
  onUpdate?.(d);
  if(d.status==='completed'||d.status==='partial'||d.status==='failed')return d;
  await new Promise(resolve=>setTimeout(resolve,5000));
 }
}

/* Replace the browser-side gateway call with a small network-resilience layer.
   This is specifically for mobile browsers that suspend/tear down fetches when
   the screen turns off. It does not retry provider jobs, only interrupted HTTP
   transport. Provider retry policy remains server-side. */
if(typeof window.callGateway==='function'){
 const originalCallGateway=window.callGateway;
 window.callGateway=async function(operation,payload){
  let last;
  for(let attempt=0;attempt<=BV_RETRY_DELAYS.length;attempt++){
   try{return await originalCallGateway(operation,payload)}catch(error){
    last=error;
    const status=Number(error?.status||0);
    const transport=!status || status===408 || status===429 || status>=500;
    if(!transport||attempt===BV_RETRY_DELAYS.length)throw error;
    log(`${operation} transport interrupted; retrying ${attempt+1}/${BV_RETRY_DELAYS.length}.`);
    await new Promise(resolve=>setTimeout(resolve,BV_RETRY_DELAYS[attempt]));
   }
  }
  throw last;
 };
}

async function persistentRunPipeline(){
 if(state.running)return; state.running=true; state.mode='live'; $('runPipeline').disabled=true; $('runDemo').disabled=true; $('gatewayToken').disabled=false; $('log').value='';
 log('Starting live provider pipeline with persistent server-side animation.');
 try{
  const p=await liveProjectPayload(); renderStages(0);
  state.audio=(await execute('analyzeAudio',p,'live')).result; renderStages(1);
  state.world=(await execute('revealWorld',{...p,audio:state.audio},'live')).result; renderStages(2);
  state.assets=(await execute('worldAssets',{...p,world:state.world},'live')).result; renderStages(3);
  state.storyboard=(await execute('storyboard',{...p,audio:state.audio,world:state.world,assets:state.assets},'live')).result; renderStages(4);
  state.images=(await executeSceneBatch('sceneImages',{...p,audio:state.audio,world:state.world,assets:state.assets,storyboard:state.storyboard},'live')).result; renderStages(5);
  const job=await bvStartPersistentAnimation({contract_version:C.version,operation:'animate',storyboard:state.storyboard,images:state.images});
  log('Animation job accepted by Cloudflare Durable Object.',{job_id:job.job_id,status:job.status});
  const done=await bvWaitPersistentAnimation(job.job_id,(j)=>{log(`Persistent animation status: ${j.status}`,{scene:j.index+1,total:j.scenes?.length||0,completed:j.clips?.length||0,failed:j.failed?.length||0});});
  localStorage.removeItem(BV_ANIMATION_JOB_KEY);
  if(done.status==='failed'&&!done.clips?.length)throw new Error('Persistent animation failed for every scene.');
  state.motion={status:done.failed?.length?'partial':'animated',clips:done.clips||[],video_url:done.clips?.[0]?.video_url||null,source:'Pixazo free LTX image-to-video',models_used:['ltx-video'],scene_count:(done.clips||[]).length,requested_scene_count:done.scenes?.length||0,failed_scenes:done.failed||[]};
  renderStages(6); log('Persistent animation completed.',{clips:state.motion.scene_count,failed:state.motion.failed_scenes.length});
  const assembled=(await execute('assemble',{...p,audio:state.audio,motion:state.motion},'live')).result; renderStages(7); log('PIPELINE COMPLETE',assembled); $('gatewayStatus').textContent=state.motion.failed_scenes.length?'Gateway: live pipeline complete with partial motion':'Gateway: live pipeline complete';
 }catch(e){log(`PIPELINE STOPPED: ${e.status===401||e.status===403?'authentication required':e.message}`);$('gatewayStatus').textContent=e.status===401||e.status===403?'Gateway: authentication required':'Gateway: pipeline failed';}
 finally{state.running=false;$('runPipeline').disabled=false;$('runDemo').disabled=false;renderCapabilities();}
}
$('runPipeline').onclick=()=>persistentRunPipeline();
