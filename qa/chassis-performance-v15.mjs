import fs from 'node:fs';
import {pathToFileURL,fileURLToPath} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
async function measure(root){const {CarPhysics}=await import(pathToFileURL(path.join(root,'dist/physics.js'))),{default:MotorLab}=await import(pathToFileURL(path.join(root,'sdk/motor-engine.mjs')));const p=new CarPhysics(MotorLab),times=[];for(let i=0;i<1320;i++){const t=performance.now();p.update(1/120,{throttle:.4,steer:Math.sin(i/180)*.1});if(i>=120)times.push(performance.now()-t);}p.engine.dispose();times.sort((a,b)=>a-b);return {steps:times.length,meanMs:times.reduce((a,b)=>a+b,0)/times.length,medianMs:times[600],p95Ms:times[Math.floor(times.length*.95)]};}
const report={version:15,status:'measured',current:await measure(root),limits:['Node.js wall-clock timings on this machine for one player chassis and its native engine. Excludes browser GPU, audio device, world, AI and frame scheduling; no FPS guarantee.']};
if(process.argv[2])report.baselineV14=await measure(path.resolve(process.argv[2]));
fs.writeFileSync(new URL('chassis-performance-v15-results.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
