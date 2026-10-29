import fs from 'node:fs';
import {pathToFileURL,fileURLToPath} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const root=fileURLToPath(new URL('../',import.meta.url));
async function measure(directory,hills,kit='stock'){
 const {CarPhysics}=await import(pathToFileURL(path.join(directory,'dist/physics.js'))),{resolveBuild}=await import(pathToFileURL(path.join(directory,'dist/catalog.js'))),{default:MotorLab}=await import(pathToFileURL(path.join(directory,'sdk/motor-engine.mjs')));
 const p=new CarPhysics(MotorLab,resolveBuild({carId:'vector',engineId:'v6',driveKit:kit})),times=[];let queries=0;
 p.setGroundSampler((x,z)=>{queries++;return {height:hills?.08*z+.04*Math.sin(x/5)+.02*Math.sin(z/3):0,grip:1};});p.reset();queries=0;
 for(let i=0;i<1320;i++){const t=performance.now();p.update(1/120,{throttle:.4,steer:Math.sin(i/180)*.1});if(i>=120)times.push(performance.now()-t);}p.engine.dispose();
 assert.equal(queries,1320*4);times.sort((a,b)=>a-b);
 return {steps:times.length,meanMs:times.reduce((a,b)=>a+b,0)/times.length,medianMs:times[600],p95Ms:times[Math.floor(times.length*.95)],groundQueriesPerStep:queries/1320};
}
const report={version:20,status:'measured',current:{},limits:['Node.js wall-clock on this machine for one native engine/chassis and a synthetic sampler. Browser GPU, world query cost, AI, audio and frame scheduling excluded; no FPS guarantee.','Same Vector V6 inputs and samplers; native engine load and JIT timing may differ. Single local run, not a universal comparison.']};
for(const kit of ['stock','fwd','awd'])report.current[kit]={flat:await measure(root,false,kit),hills:await measure(root,true,kit)};
if(process.argv[2]){const base=path.resolve(process.argv[2]);report.baselineV19={flat:await measure(base,false),hills:await measure(base,true)};}
report.sourceSHA256=Object.fromEntries(['dist/drivetrain.js','dist/physics.js','dist/mechanical.js','dist/wheel-hop.js','dist/aerodynamics.js','dist/catalog.js','dist/tyres.js','dist/vehicle-state.js','dist/brake-hydraulics.js'].map(f=>[f,createHash('sha256').update(fs.readFileSync(path.join(root,f))).digest('hex')]));
fs.writeFileSync(new URL('chassis-performance-v20-results.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
