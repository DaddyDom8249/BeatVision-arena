export type VisualBeat = {
  beatId: string;
  scene: number;
  startTime: number;
  endTime: number;
  sectionId: string;
  lyricRange: string;
  lyricMeaning: string;
  narrativePurpose: string;
  emotionalState: string;
  emotionalIntensity: number;
  characterState: string;
  environment: string;
  action: string;
  visualConcept: string;
  symbolicElements: string[];
  cameraIntent: string;
  transitionIntent: string;
  worldConstraints: string[];
  previousBeat: string | null;
  nextBeat: string | null;
  visualContinuityRequirements: string[];
  reusePolicy: string;
  description: string;
  visual_direction: string;
  location: string;
  emotion: string;
  continuity_notes: string;
  duration_seconds: number;
};

const finite=(v:unknown,f=0)=>{const n=Number(v);return Number.isFinite(n)?n:f};
const text=(v:unknown,f='')=>String(v??f).trim();
const tokens=(v:string)=>new Set(v.toLowerCase().replace(/[^a-z0-9\s]/g,' ').split(/\s+/).filter(x=>x.length>2));
const similarity=(a:Set<string>,b:Set<string>)=>{if(!a.size||!b.size)return 0;let i=0;for(const x of a)if(b.has(x))i++;return i/(a.size+b.size-i)};

function semanticFingerprint(b:VisualBeat){return [b.lyricMeaning,b.narrativePurpose,b.emotionalState,b.characterState,b.environment,b.action,b.visualConcept,b.cameraIntent,b.symbolicElements.join(' ')].join(' ')}

export function compactAudio(value:any){
  if(!value||typeof value!=='object')return value;
  const result=value.result&&typeof value.result==='object'?value.result:value;
  const raw=Array.isArray(result.segments)?result.segments:[];
  const segments=raw.slice(0,400).map((s:any,index:number)=>({index,start:Math.max(0,finite(s?.start)),end:Math.max(0,finite(s?.end,finite(s?.start)+1)),text:text(s?.text)})).filter((s:any)=>s.text&&s.end>s.start);
  return {duration_seconds:finite(value.duration_seconds??value.analysis?.duration_seconds??result.duration,0)||null,bpm:value.bpm??value.analysis?.bpm??null,sections:Array.isArray(value.sections)?value.sections.slice(0,64):[],energy_curve:Array.isArray(value.energy_curve)?value.energy_curve.slice(0,240):[],transcript:text(value.text??value.transcript??result.text).slice(0,16000),segments};
}

export function visualBeatSystemPrompt(){return [
  'You are the BeatVision visual-world director and visual beat planner.',
  'Return ONLY valid JSON. Never invent lyrics or claim a lyric event absent from supplied lyrics/transcript.',
  'The song is the subject. The selected style is a visual constraint, not the story.',
  'Build a complete song-grounded visual narrative, not a generic style montage.',
  'Use timestamped lyric segments and supplied section/energy information when available.',
  'Instrumental or non-lyrical intervals are valid visual beats. Do not leave them uncovered. Use the preceding and following narrative meaning plus pacing to create a transition, action, environment change, reaction, symbolic event, or consequence that is visually meaningful without inventing lyrics.',
  'The complete timeline from 0 through duration must be covered by intentional beats. Short silence at the beginning/end and long instrumental gaps are still part of the song experience and require visual direction.',
  'For long instrumental intervals, create multiple sequential visual beats when the interval contains enough time for meaningful progression. Do not make one static filler beat just to satisfy coverage.',
  'Repeated lyrics may return with different narrative purpose, emotional state, character state, action, composition, symbolism, or consequence.',
  'Do not treat a reordered copy of an earlier shot as a new visual beat.',
  'Every visual beat must explain why it exists and how it follows the previous beat.',
  'Choose beat count from song structure, lyric density, musical changes, narrative events, instrumental intervals, and pacing. Never target a fixed scene count.',
  'Do not collapse a whole verse, chorus, bridge, outro, or long instrumental passage merely to reduce generation work.',
  'Major narrative or emotional changes require a new beat even when lyrics repeat.',
  'Each beat must be independently renderable from one approved image and independently animatable.',
  'Return exactly {sections, visual_beats, coverage_notes}.',
  'Each visual beat must contain beatId,startTime,endTime,sectionId,lyricRange,lyricMeaning,narrativePurpose,emotionalState,emotionalIntensity,characterState,environment,action,visualConcept,symbolicElements,cameraIntent,transitionIntent,worldConstraints,previousBeat,nextBeat,visualContinuityRequirements,reusePolicy,description,visual_direction,location,emotion,continuity_notes,duration_seconds.',
  'For non-lyrical beats set lyricRange and lyricMeaning to an explicit instrumental/transition description rather than inventing lyrics.',
  'Use numeric seconds. emotionalIntensity is 0..1. Arrays must contain strings.',
  'Set reusePolicy to new_visual_event for normal beats. Use intentional_motif_return only when the beat deliberately revisits an earlier visual event for narrative reasons.',
  'coverage_notes must identify unresolved story gaps instead of silently filling them with reused material.'
].join(' ')}

function normalizeBeat(raw:any,index:number,previous:any,next:any):VisualBeat|null{
  const start=Math.max(0,finite(raw?.startTime??raw?.start_time,0));
  const end=Math.max(start,finite(raw?.endTime??raw?.end_time,0));
  if(!(end>start))return null;
  const beatId=text(raw?.beatId??raw?.beat_id,`beat-${String(index+1).padStart(2,'0')}`);
  const scene=Math.max(1,Math.round(finite(raw?.scene,index+1)));
  return {beatId,scene,startTime:start,endTime:end,sectionId:text(raw?.sectionId??raw?.section_id,`section-${index+1}`),lyricRange:text(raw?.lyricRange??raw?.lyric_range),lyricMeaning:text(raw?.lyricMeaning??raw?.lyric_meaning),narrativePurpose:text(raw?.narrativePurpose??raw?.narrative_purpose),emotionalState:text(raw?.emotionalState??raw?.emotional_state??raw?.emotion),emotionalIntensity:Math.min(1,Math.max(0,finite(raw?.emotionalIntensity,.5))),characterState:text(raw?.characterState??raw?.character_state),environment:text(raw?.environment??raw?.location),action:text(raw?.action),visualConcept:text(raw?.visualConcept??raw?.visual_concept??raw?.description),symbolicElements:Array.isArray(raw?.symbolicElements)?raw.symbolicElements.map(text).filter(Boolean):[],cameraIntent:text(raw?.cameraIntent??raw?.camera_intent),transitionIntent:text(raw?.transitionIntent??raw?.transition_intent??raw?.transition),worldConstraints:Array.isArray(raw?.worldConstraints)?raw.worldConstraints.map(text).filter(Boolean):[],previousBeat:text(raw?.previousBeat??raw?.previous_beat)||(previous?text(previous.beatId):null),nextBeat:text(raw?.nextBeat??raw?.next_beat)||(next?text(next.beatId):null),visualContinuityRequirements:Array.isArray(raw?.visualContinuityRequirements)?raw.visualContinuityRequirements.map(text).filter(Boolean):Array.isArray(raw?.visual_continuity_requirements)?raw.visual_continuity_requirements.map(text).filter(Boolean):[],reusePolicy:text(raw?.reusePolicy??raw?.reuse_policy,'new_visual_event'),description:text(raw?.description??raw?.visualConcept??raw?.visual_concept),visual_direction:text(raw?.visual_direction??raw?.visualDirection??raw?.visualConcept),location:text(raw?.location??raw?.environment),emotion:text(raw?.emotion??raw?.emotionalState??raw?.emotional_state),continuity_notes:text(raw?.continuity_notes??raw?.continuityNotes),duration_seconds:Math.max(.1,end-start)};
}

function mergeIntervals(beats:VisualBeat[]){
  const sorted=beats.map(b=>({start:b.startTime,end:b.endTime})).sort((a,b)=>a.start-b.start);
  let total=0,start:number|null=null,end=0;
  for(const x of sorted){if(start===null){start=x.start;end=x.end;continue}if(x.start<=end+.001){end=Math.max(end,x.end)}else{total+=Math.max(0,end-start);start=x.start;end=x.end}};
  if(start!==null)total+=Math.max(0,end-start);return total;
}

function timelineGaps(beats:VisualBeat[],duration:number){
  const sorted=[...beats].sort((a,b)=>a.startTime-b.startTime);const gaps:{startTime:number;endTime:number}[]=[];let cursor=0;
  for(const b of sorted){if(b.startTime>cursor+.25)gaps.push({startTime:cursor,endTime:b.startTime});cursor=Math.max(cursor,b.endTime)}
  if(duration>cursor+.25)gaps.push({startTime:cursor,endTime:duration});return gaps;
}

function makeInstrumentalBeat(start:number,end:number,index:number,previous:VisualBeat|null,next:VisualBeat|null):VisualBeat{
  const duration=end-start;
  const phase=index%3;
  const phaseNames=['transition','escalation','consequence'];
  const phaseActions=[
    'Carry the previous emotional state into a deliberate visual transition; the character moves through the environment while the world subtly changes.',
    'Increase the internal pressure through a distinct physical action or environmental shift, moving the character toward the next lyrical event.',
    'Let the emotional consequence settle into a new visual state that prepares the next lyrical event without inventing dialogue or lyrics.'
  ];
  const previousConcept=previous?.visualConcept||previous?.action||'the preceding visual state';
  const nextConcept=next?.visualConcept||next?.action||'the following visual state';
  const emotion=previous?.emotionalState||next?.emotionalState||'unresolved tension';
  const intensity=previous&&next?Number(((previous.emotionalIntensity+next.emotionalIntensity)/2).toFixed(2)):previous?.emotionalIntensity??next?.emotionalIntensity??.5;
  return {
    beatId:`instrumental-${String(index+1).padStart(2,'0')}-${phaseNames[phase]}`,
    scene:index+1,startTime:start,endTime:end,sectionId:`instrumental-${String(index+1).padStart(2,'0')}`,
    lyricRange:'instrumental / non-lyrical interval',
    lyricMeaning:`No lyric event in this interval. Visual transition from ${previousConcept} toward ${nextConcept}.`,
    narrativePurpose:`Bridge the song's emotional and narrative progression during an instrumental interval; this is a deliberate ${phaseNames[phase]} beat rather than filler.`,
    emotionalState:emotion,emotionalIntensity:intensity,
    characterState:previous?.characterState||next?.characterState||'continuing the established character state',
    environment:previous?.environment||next?.environment||'established world environment',
    action:phaseActions[phase],
    visualConcept:`Distinct instrumental ${phaseNames[phase]} beat connecting ${previousConcept} to ${nextConcept}.`,
    symbolicElements:[`instrumental-${phaseNames[phase]}`,`bridge-to-${next?.beatId||'next-event'}`],
    cameraIntent:phase===0?'Follow the transition with a slow directional move and clear spatial change.':phase===1?'Increase visual pressure with a tighter composition or more active camera movement.':'Settle into a consequential composition that visually points toward the next event.',
    transitionIntent:`Transition from ${previous?.beatId||'song-opening'} into ${next?.beatId||'song-continuation'} without repeating the previous image.`,
    worldConstraints:[...(previous?.worldConstraints||[]),...(next?.worldConstraints||[])],
    previousBeat:previous?.beatId||null,nextBeat:next?.beatId||null,
    visualContinuityRequirements:[...(previous?.visualContinuityRequirements||[]),...(next?.visualContinuityRequirements||[])],
    reusePolicy:'new_visual_event',
    description:`Instrumental ${phaseNames[phase]} visual event spanning ${duration.toFixed(2)} seconds.`,
    visual_direction:`Create a unique, renderable ${phaseNames[phase]} image that visibly progresses the established story between adjacent beats.`,
    location:previous?.location||next?.location||'established world location',emotion,continuity_notes:`Must bridge ${previous?.beatId||'opening'} to ${next?.beatId||'ending'} and must not be a reordered duplicate of either.`,
    duration_seconds:Math.max(.1,duration)
  };
}

function fillTimelineGaps(beats:VisualBeat[],duration:number){
  const sorted=[...beats].sort((a,b)=>a.startTime-b.startTime);const result:VisualBeat[]=[];let cursor=0;let gapIndex=0;
  for(let i=0;i<sorted.length;i++){
    const current=sorted[i];
    if(current.startTime>cursor+.25){
      const gapStart=cursor;const gapEnd=current.startTime;let t=gapStart;let chunk=0;
      while(t<gapEnd-.01){
        const e=Math.min(gapEnd,t+8);
        const prev=result.length?result[result.length-1]:null;
        const gapBeat=makeInstrumentalBeat(t,e,gapIndex*10+chunk,prev,current);
        result.push(gapBeat);t=e;chunk++;
      }
      gapIndex++;
    }
    result.push(current);cursor=Math.max(cursor,current.endTime);
  }
  if(duration>cursor+.25){
    let t=cursor;let chunk=0;
    while(t<duration-.01){const e=Math.min(duration,t+8);const prev=result.length?result[result.length-1]:null;result.push(makeInstrumentalBeat(t,e,gapIndex*10+chunk,prev,null));t=e;chunk++}
  }
  return result.sort((a,b)=>a.startTime-b.startTime);
}

export function normalizeVisualBeats(raw:any,durationSeconds:number){
  const source=Array.isArray(raw?.visual_beats)?raw.visual_beats:Array.isArray(raw?.scenes)?raw.scenes:[];
  const ordered=source.map((beat:any,index:number)=>({beat,index})).sort((a:any,b:any)=>finite(a.beat?.startTime??a.beat?.start_time,Infinity)-finite(b.beat?.startTime??b.beat?.start_time,Infinity)||a.index-b.index);
  let normalized:VisualBeat[]=[];
  for(let i=0;i<ordered.length;i++){const beat=normalizeBeat(ordered[i].beat,i,normalized[i-1]||null,ordered[i+1]?.beat||null);if(beat)normalized.push(beat)}
  const duration=Math.max(0,finite(durationSeconds));
  normalized=fillTimelineGaps(normalized,duration);
  normalized.forEach((b,i)=>{b.scene=i+1;b.beatId=b.beatId||`beat-${String(i+1).padStart(2,'0')}`;b.previousBeat=i?normalized[i-1].beatId:null;b.nextBeat=i+1<normalized.length?normalized[i+1].beatId:null});
  const coveredSeconds=mergeIntervals(normalized);const gaps=timelineGaps(normalized,duration);const coverage=duration?Math.min(1,coveredSeconds/duration):1;
  const unresolved=Array.isArray(raw?.coverage_notes?.unresolved_beats)?raw.coverage_notes.unresolved_beats:[];
  const semanticFields=['lyricMeaning','narrativePurpose','emotionalState','characterState','environment','action','visualConcept'];
  const missingSemantic=normalized.filter(b=>semanticFields.filter(k=>!text((b as any)[k])).length>=3).map(b=>b.beatId);
  const fingerprints=normalized.map(semanticFingerprint).map(tokens);const semanticDuplicates:any[]=[];
  for(let i=0;i<normalized.length;i++)for(let j=0;j<i;j++){const score=similarity(fingerprints[i],fingerprints[j]);if(score>=.78){const intentional=/intentional_motif_return|approved_reuse|recurring_motif/i.test(normalized[i].reusePolicy);semanticDuplicates.push({beatId:normalized[i].beatId,duplicateOf:normalized[j].beatId,similarity:Number(score.toFixed(3)),intentional});break}}
  const unexplainedReuse=semanticDuplicates.filter(x=>!x.intentional);const overlaps=[];
  for(let i=1;i<normalized.length;i++){const a=normalized[i-1],b=normalized[i];if(b.startTime<a.endTime-.25)overlaps.push({beatId:b.beatId,overlaps:a.beatId,seconds:Number((a.endTime-b.startTime).toFixed(3))})}
  const errors:string[]=[];
  if(!normalized.length)errors.push('No visual beats were produced.');
  if(duration&&coverage<.96)errors.push(`Visual coverage is ${(coverage*100).toFixed(1)}%, below the 96% minimum.`);
  if(gaps.length)errors.push(`Uncovered timeline gaps: ${gaps.map(g=>`${g.startTime.toFixed(2)}-${g.endTime.toFixed(2)}s`).join(', ')}`);
  if(missingSemantic.length)errors.push(`Beats missing semantic grounding: ${missingSemantic.join(', ')}`);
  if(unexplainedReuse.length)errors.push(`Unexplained semantic reuse detected: ${unexplainedReuse.map(x=>`${x.beatId}≈${x.duplicateOf} (${x.similarity})`).join(', ')}`);
  if(overlaps.length)errors.push(`Unexplained beat overlaps: ${overlaps.map(x=>`${x.beatId} overlaps ${x.overlaps} by ${x.seconds}s`).join(', ')}`);
  if(unresolved.length)errors.push(`Storyboard reported unresolved beats: ${unresolved.map((x:any)=>text(x?.beatId??x)).join(', ')}`);
  return {visual_beats:normalized,sections:Array.isArray(raw?.sections)?raw.sections:[],coverage:{duration_seconds:duration,visual_beats:normalized.length,covered_seconds:coveredSeconds,coverage_ratio:coverage,uncovered_seconds:Math.max(0,duration-coveredSeconds),gaps,unresolved_beats:unresolved,semantic_grounding_failures:missingSemantic,semantic_duplicates:semanticDuplicates,semantic_duplicate_rate:normalized.length?semanticDuplicates.length/normalized.length:0,unexplained_reuse:unexplainedReuse,long_beats:normalized.filter(b=>b.duration_seconds>8).length,overlaps},errors,covered_until:normalized.reduce((m,b)=>Math.max(m,b.endTime),0)};
}

export function toStoryboard(normalized:ReturnType<typeof normalizeVisualBeats>){return {scenes:normalized.visual_beats.map(b=>({...b})),visual_beats:normalized.visual_beats,sections:normalized.sections,coverage:normalized.coverage,coverage_notes:normalized.errors.length?{status:'insufficient',errors:normalized.errors}:{status:'complete',errors:[]}}}
