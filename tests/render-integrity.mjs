import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir=mkdtempSync(join(tmpdir(),'beatvision-integrity-'));
const out=join(dir,'render-integrity.mjs');
try{
  execFileSync('npx',['--no-install','esbuild','worker/src/render-integrity.ts','--bundle','--format=esm','--platform=node',`--outfile=${out}`],{stdio:'inherit'});
  const mod=await import(`file://${out}`);
  const {buildCoverageManifest,assertSufficientCoverage}=mod;
  const clip=(scene,asset,duration=5,source=`https://example.test/${asset}.mp4`)=>({scene,asset_id:asset,source_url:source,generation_type:'GENERATIVE_VIDEO',actual_duration_seconds:duration});

  assert.equal(buildCoverageManifest(Array.from({length:16},(_,i)=>clip(i+1,`asset-${i+1}`)),249.12).coverage_status,'INSUFFICIENT_UNIQUE_VISUAL_COVERAGE');
  assert.doesNotThrow(()=>assertSufficientCoverage(buildCoverageManifest(Array.from({length:50},(_,i)=>clip(i+1,`asset-${i+1}`)),249.12)));
  assert.throws(()=>buildCoverageManifest([clip(1,'asset-1'),clip(2,'asset-1')],10),/MEDIA_INTEGRITY_DUPLICATE_ASSET/);
  assert.throws(()=>buildCoverageManifest([clip(1,'asset-1',5,'https://example.test/same.mp4'),clip(2,'asset-2',5,'https://example.test/same.mp4')],10),/MEDIA_INTEGRITY_DUPLICATE_SOURCE/);
  assert.throws(()=>assertSufficientCoverage(buildCoverageManifest([clip(1,'asset-1',5)],10)),/INSUFFICIENT_UNIQUE_VISUAL_COVERAGE/);
  assert.throws(()=>buildCoverageManifest([{...clip(1,'asset-1'),generation_type:'CAMERA_MOTION_FALLBACK'}],5),/MEDIA_INTEGRITY_UNKNOWN_GENERATION_TYPE/);
  assert.throws(()=>buildCoverageManifest([{scene:1,asset_id:'asset-1',source_url:'https://example.test/a.mp4',generation_type:'GENERATIVE_VIDEO',actual_duration_seconds:0}],5),/MEDIA_INTEGRITY_MISSING_ACTUAL_DURATION/);
  console.log('RENDER INTEGRITY ADVERSARIAL TESTS PASS');
}finally{rmSync(dir,{recursive:true,force:true});}
