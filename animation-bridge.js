const BV_ANIMATION_JOB_KEY='beatvision_animation_job';
async function bvStartPersistentAnimation(payload){
 const base=gateway(); if(!base) throw new Error('No gateway URL configured.');
 const jobId=crypto.randomUUID(); localStorage.setItem(BV_ANIMATION_JOB_KEY,jobId);
 const r=await fetch(`${base}/v1/video/animate/jobs/${jobId}`,{method:'POST',headers:{...gatewayHeaders(),'X-BeatVision-Contract':C.version,'X-BeatVision-Request':jobId},body:JSON.stringify(payload)});
 const text=await r.text();let d;try{d=JSON.parse(text)}catch{d={raw:text}};if(!r.ok)throw new Error(`${r.status}: ${d.error||text}`);return d;
}
async function bvWaitPersistentAnimation(jobId,onUpdate){
 const base=gateway();
 while(true){
  const r=await fetch(`${base}/v1/video/animate/jobs/${jobId}`,{headers:gatewayHeaders()});
  const text=await r.text();let d;try{d=JSON.parse(text)}catch{d={raw:text}};if(!r.ok)throw new Error(`${r.status}: ${d.error||text}`);
  onUpdate?.(d);
  if(d.status==='completed'||d.status==='partial'||d.status==='failed')return d;
  await new Promise(resolve=>setTimeout(resolve,5000));
 }
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
