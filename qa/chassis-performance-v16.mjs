import fs from 'node:fs';
import {pathToFileURL,fileURLToPath} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('../',import.meta.url));
async function measure(directory,hills){
 const {CarPhysics}=await import(pathToFileURL(path.join(directory,'dist/physics.js'))),{default:MotorLab}=await import(pathToFileURL(path.join(directory,'sdk/motor-engine.mjs')));
 const p=new CarPhysics(MotorLab),times=[];let queries=0;
 p.setGroundSampler((x,z)=>{queries++;return {height:hills?.08*z+.04*Math.sin(x/5)+.02*Math.sin(z/3):0,grip:1};});p.reset();queries=0;
 for(let i=0;i<1320;i++){const t=performance.now();p.update(1/120,{throttle:.4,steer:Math.sin(i/180)*.1});if(i>=120)times.push(performance.now()-t);}p.engine.dispose();
 assert.equal(queries,1320*4);times.sort((a,b)=>a-b);
 return {steps:times.length,meanMs:times.reduce((a,b)=>a+b,0)/times.length,medianMs:times[600],p95Ms:times[Math.floor(times.length*.95)],groundQueriesPerStep:queries/1320};
}
const report={version:16,status:'measured',current:{flat:await measure(root,false),hills:await measure(root,true)},limits:['Node.js wall-clock on this machine for one native engine/chassis. Browser GPU, world query cost, AI, audio and frame scheduling are excluded; no FPS guarantee.','Same inputs and sampler for V15 and V16; evolving engine load and JIT timing can differ. A single run is not a universal performance comparison.']};
if(process.argv[2]){const base=path.resolve(process.argv[2]);report.baselineV15={flat:await measure(base,false),hills:await measure(base,true)};}
fs.writeFileSync(new URL('chassis-performance-v16-results.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
