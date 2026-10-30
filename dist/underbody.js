import {outletPositions,outletHeight} from './exterior-tuning.js';
// Structural mounts are separate from the existing damper, bearing and engine
// wear. These fixed keys are shared by saves, network, repairs and geometry.
const clamp=(v,a,b)=>Math.max(a,Math.min(b,Number.isFinite(v)?v:a));
const corners=['FL','FR','RL','RR'],names=['Front left','Front right','Rear left','Rear right'];
export const UNDERBODY_PARTS=Object.fromEntries(corners.flatMap((c,i)=>[
 ['arm'+c,{label:names[i]+' control arm',kind:'arm',corner:i,mass:4.8}],
 ['strut'+c,{label:names[i]+' spring and damper mounts',kind:'strut',corner:i,mass:7.2}],
 ...(i<2?[['tieRod'+c,{label:names[i]+' tie rod mounts',kind:'rod',corner:i,mass:1.3}]]:[])
]).concat([
 ['exhaustFront',{label:'Downpipe and front exhaust mounts',kind:'pipe',mass:5.5}],
 ['exhaustCenter',{label:'Center exhaust and resonator',kind:'pipe',mass:7.5}],
 ['exhaustRear',{label:'Rear silencer and connecting pipes',kind:'pipe',mass:9.5}]
]));
export function createUnderbody(saved){return Object.fromEntries(Object.keys(UNDERBODY_PARTS).map(id=>{const p=saved?.[id];return[id,{mounts:clamp(p?.mounts??1,0,1),crush:clamp(p?.crush??0,0,1),bend:clamp(p?.bend??0,-.35,.35),detached:p?.detached===true}];}));}
const cache=new WeakMap();
export function underbodyLayout(build){
 if(cache.has(build))return cache.get(build);
 const p=build.physics,L=build.vehicle.model.length/2,all={};
 for(const [id,d]of Object.entries(UNDERBODY_PARTS)){
  const i=d.corner,side=i%2?1:-1,z=i<2?p.frontAxle:-p.rearAxle,x=side*p.halfTrack;let lines,can;
  if(d.kind==='arm')lines=[[[side*.27,.17,z-.23],[x-side*.10,p.wheelRadius-.18,z]],[[side*.27,.17,z+.23],[x-side*.10,p.wheelRadius-.18,z]],[[side*.27,.17,z-.23],[side*.27,.17,z+.23]]];
  else if(d.kind==='strut')lines=[[[x*.83,.80,z-.04],[x-side*.10,p.wheelRadius-.04,z]]];
  else if(d.kind==='rod')lines=[[[side*.35,.36,z-.17],[x-side*.10,p.wheelRadius,z-.15]]];
  else if(id==='exhaustFront')lines=[[[.22,.56,L*.60],[.28,.18,L*.29]],[[.28,.18,L*.29],[.23,.18,.08]]];
  else if(id==='exhaustCenter'){lines=[[[.23,.18,.08],[.23,.18,-L*.53]]];can={center:[.23,.18,-L*.26],size:[.22,.16,.42]};}
  else {const ends=outletPositions(build.vehicle.model.kind,build.selection);lines=[[[.23,.18,-L*.53],[.23,.24,-L*.73]],...ends.map(e=>[[.23,.24,-L*.73],[e,outletHeight(build.selection),-L*.925]])];can={center:[.23,.24,-L*.73],size:[.55,.20,.33]};}
  const points=lines.flat(),padding=d.kind==='strut'?.10:.06,lo=[0,1,2].map(n=>Math.min(...points.map(v=>v[n]))-padding),hi=[0,1,2].map(n=>Math.max(...points.map(v=>v[n]))+padding);
  if(can)for(let n=0;n<3;n++){lo[n]=Math.min(lo[n],can.center[n]-can.size[n]/2);hi[n]=Math.max(hi[n],can.center[n]+can.size[n]/2);}
  const center=lo.map((v,n)=>(v+hi[n])/2),half=lo.map((v,n)=>(hi[n]-v)/2);
  all[id]={...d,lines,can,center,half,radius:Math.hypot(...half)};
 }
 cache.set(build,all);return all;
}
export function underbodySupport(body,i){const u=body?.underbody,a=u?.['arm'+corners[i]],s=u?.['strut'+corners[i]];return a?.detached||s?.detached?0:.3+.7*Math.min(a?.mounts??1,s?.mounts??1);}
export function underbodyToe(body,i){return (body?.underbody?.['arm'+corners[i]]?.bend||0)*.35;}
export function underbodyHealth(p){return p?.detached?0:Math.min(p?.mounts??1,1-(p?.crush||0),1-Math.abs(p?.bend||0));}
export function repairUnderbody(body,id){if(!body?.underbody?.[id])return false;body.underbody[id]={mounts:1,crush:0,bend:0,detached:false};body.revision++;return true;}
const segmentDistance=(q,a,b)=>{const v=b.map((n,i)=>n-a[i]),w=q.map((n,i)=>n-a[i]),t=clamp(w.reduce((s,n,i)=>s+n*v[i],0)/Math.max(.0001,v.reduce((s,n)=>s+n*n,0)),0,1);return Math.hypot(...q.map((n,i)=>n-a[i]-v[i]*t));};
export function damageUnderbody(body,build,{local,energyJ,closingSpeed}){
 const detached=[],layout=underbodyLayout(build),q=[local.x,Number.isFinite(local.y)?local.y:build.physics.wheelRadius,local.z];let changed=false;
 if(closingSpeed<2.2)return {changed,detached};
 for(const [id,d]of Object.entries(layout)){
  const part=body.underbody[id];if(part.detached)continue;
  if(d.corner!=null&&q[0]*(d.corner%2?1:-1)<-.1)continue;
  const radius=d.kind==='pipe'?.47:.72,distance=Math.min(...d.lines.map(([a,b])=>segmentDistance(q,a,b))),weight=Math.max(0,1-distance/radius);
  const loss=clamp(energyJ/(build.physics.mass*90*(build.physics.bodyStrength||1))*weight*.85,0,1);if(loss<.002)continue;
  part.mounts=clamp(part.mounts-loss,0,1);part.crush=clamp(part.crush+loss*.45,0,1);part.bend=clamp(part.bend+(Math.sign(q[0]-d.center[0])||1)*loss*.20,-.35,.35);
  if(part.mounts<.08&&closingSpeed>8){part.detached=true;detached.push(id);}changed=true;
 }
 if(changed)body.revision++;return {changed,detached};
}
export function exhaustRoute(body){
 let restriction=0,leak=0,breakAt=null;
 for(const id of ['exhaustFront','exhaustCenter','exhaustRear']){
  const p=body?.underbody?.[id];if(p?.detached){leak=1;breakAt=id;break;}
  restriction=Math.max(restriction,p?.crush||0);leak=Math.max(leak,(1-(p?.mounts??1))*.65);
 }
 return {restriction,leak,breakAt,connected:breakAt===null};
}
// Only compromised mounts fatigue. Loads come from the existing corner model;
// the sampled road plane is a cheap underfloor approximation, not extra rays.
export function stepUnderbody(body,build,state,dt){
 const detached=[],layout=underbodyLayout(build);let changed=false;
 for(const [id,d]of Object.entries(layout)){
  const p=body.underbody[id];if(p.detached)continue;
  let loss=0;
  if(d.kind==='pipe'){
   const [x,y,z]=d.center,ground=(state.groundHeight||0)+(state.roadGradeLong||0)*z+(state.roadGradeLat||0)*x;
   const height=(state.bodyHeight||0)+(build.physics.rideHeight||0)+y-(state.bodyPitch||0)*z+(state.bodyRoll||0)*x-d.half[1];
   const depth=clamp(ground-height,0,.25);
   loss=dt*depth*Math.min(40,state.speed||0)*.08;
   if(loss>0)p.crush=clamp(p.crush+loss*.4,0,1);
  }
  if(p.mounts<.3){const shock=d.corner==null?Math.abs(state.accelerationLat||0)*.015:Math.abs(state.suspension?.[d.corner]?.velocity||0)*.12;loss+=dt*shock*(.3-p.mounts);}
  if(loss>1e-7){p.mounts=Math.max(0,p.mounts-loss);changed=true;if(p.mounts<=.015){p.detached=true;detached.push(id);}}
 }
 if(changed)body.revision++;return {changed,detached};
}
