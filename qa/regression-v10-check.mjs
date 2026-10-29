import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const files=['dist/main.js','dist/index.html','dist/audio.js','dist/physics.js','dist/mechanical.js','dist/multiplayer.js','dist/vendor/motor-engine.js'];
const signatures=()=>Object.fromEntries(files.map(name=>[name,sha256(fs.readFileSync(root+name))]));
const before=signatures(),report={version:10,status:'pending',checks:[],suites:[],sourceSHA256:before};
const suites=[['integration',9],['thermal',9],['damage',9],['audio',8]];

// Reuse the established behavioral suites without replacing their historical
// reports. Each fresh result is retained under this release's version instead.
for(const [name,version]of suites){
 const script=`qa/${name}-v${version}-check.mjs`,historical=`qa/${name}-v${version}-results.json`,current=`qa/${name}-v10-results.json`;
 const old=fs.existsSync(root+historical)?fs.readFileSync(root+historical):null;
 try{
  execFileSync(process.execPath,[script],{cwd:root,encoding:'utf8',maxBuffer:8*1024*1024,timeout:180000});
  const result=JSON.parse(fs.readFileSync(root+historical,'utf8'));assert.equal(result.status,'passed',name);
  result.verifiedInRelease=10;result.suiteSource=script;result.engineSdk='1.6.0';
  fs.writeFileSync(root+current,JSON.stringify(result,null,2)+'\n');
  report.suites.push({name,source:script,result:current,checks:result.checks?.length??0,sha256:sha256(fs.readFileSync(root+current))});
  report.checks.push(`${name}: ${result.checks?.length??0} existing behavioral groups passed against V10.`);
  console.log(`PASS ${name}: ${result.checks?.length??0} groups`);
 }catch(error){
  if(error.stdout)console.error(String(error.stdout).slice(-9000));
  if(error.stderr)console.error(String(error.stderr).slice(-9000));
  throw error;
 }finally{
  if(old)fs.writeFileSync(root+historical,old);else fs.rmSync(root+historical,{force:true});
 }
}
assert.deepEqual(signatures(),before,'Production source changed while regression suites ran');
report.status='passed';report.groups=report.suites.reduce((total,suite)=>total+suite.checks,0);
report.limits=['Controlled DOM, PCM/DSP and vehicle simulation. No live browser layout, speaker audition, hardware controller or internet WebRTC validation.'];
fs.writeFileSync(root+'qa/regression-v10-results.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
