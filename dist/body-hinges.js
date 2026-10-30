import {bodyLayout,panelCenter} from './body-layout.js';
import {exteriorLayout,exteriorMissing} from './exterior-damage.js';
export const HINGED_PANELS=['hood','left','right','boot'];
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
export function toggleBodyPanel(body,id,speed=0){
 const p=body?.zones?.[id];
 if(!HINGED_PANELS.includes(id)||!p||p.detached||Math.abs(speed)>.8)return false;
 // A broken latch cannot hold a panel closed; replacing that panel repairs it.
 if(p.latch<.08&&p.open)return false;
 p.open=!p.open;body.revision++;return true;
}
export function stepBodyHinges(body,dt,state,damage=true){
 const detached=[];if(!body?.zones||!(dt>0))return detached;
 for(const id of HINGED_PANELS){
  const p=body.zones[id];if(!p||p.detached)continue;
  const door=id==='left'||id==='right',side=id==='left'?-1:1,limit=door?1.12:1.16;
  const unlatched=p.open||p.latch<.08||p.angle>.002;
  const speed=state.forwardSpeed||0;
  // Hinge inertia, check strap / gas strut and relative air load. Door opening
  // presents area to forward flow; a damaged hood latch allows the air to lift it.
  const aero=door?-Math.sign(speed)*speed*speed*.0012*Math.sin(p.angle):speed*speed*.001*(id==='hood'?1:-.45);
  const inertia=door?side*(state.accelerationLat||0)*.045:(state.accelerationLong||0)*.018;
  const target=p.open?(door?.90:1.05):!door&&p.latch<.08?.30:0,accel=unlatched?(target-p.angle)*18-p.velocity*7+aero+inertia:0;
  p.velocity=unlatched?clamp(p.velocity+accel*dt,-5,5):0;
  p.angle=unlatched?clamp(p.angle+p.velocity*dt,0,limit):0;
  if(!p.open&&p.latch>=.08&&p.angle<.002){p.angle=0;p.velocity=0;}
  if(p.angle===0&&p.velocity<0)p.velocity=0;
  if(p.angle===limit&&p.velocity>0){p.velocity*=-.12;}
  // Only compromised mounts fatigue under sustained high aerodynamic load.
  if(damage&&unlatched&&p.mounts<.45&&p.angle>.3&&Math.abs(speed)>25){
   const loss=dt*(Math.abs(speed)-25)*.0008*(.5+p.angle);p.mounts=Math.max(0,p.mounts-loss);
   if(p.mounts<=.015){p.detached=true;detached.push(id);body.revision++;}
  }
 }
 return detached;
}
export function bodyMassProperties(build,body){
 const {parts}=bodyLayout(build),p=build.physics;let missing=0,momentY=0,momentZ=0,momentX=0,inertia=0;
 for(const [id,part]of Object.entries(parts))if(body?.zones?.[id]?.detached){
  const [x,y,z]=part.center,m=part.mass;missing+=m;momentY+=m*y;momentZ+=m*z;momentX+=m*x;inertia+=m*(x*x+z*z);
 }
 for(const [id,part]of Object.entries(exteriorLayout(build)))if(exteriorMissing(body,id)&&!(part.parent&&body?.zones?.[part.parent]?.detached)){const [x,y,z]=part.center,m=part.mass;missing+=m;momentY+=m*y;momentZ+=m*z;momentX+=m*x;inertia+=m*(x*x+z*z);}
 const mass=Math.max(p.mass*.65,p.mass-missing),wheelbase=p.frontAxle+p.rearAxle;
 const cgX=-momentX/mass,cgZ=-momentZ/mass;
 const front=clamp((p.rearAxle+cgZ)/wheelbase,.2,.8),left=clamp((p.halfTrack-cgX)/(2*p.halfTrack),.25,.75);
 return {mass,missingMass:missing,cgX,cgZ,cgHeight:Math.max(.2,(p.mass*p.cgHeight-momentY)/mass),inertia:Math.max(p.inertia*.6,p.inertia-inertia),loads:[front*left,front*(1-left),(1-front)*left,(1-front)*(1-left)].map(f=>f*mass*9.81)};
}
export function openDoorContacts(build,body,state,query,damage=true){
 const hits=[];if(!query||!(body.zones.left?.angle>.25&&!body.zones.left.detached||body.zones.right?.angle>.25&&!body.zones.right.detached))return hits;
 const layout=bodyLayout(build),s=Math.sin(state.heading),c=Math.cos(state.heading);
 for(const id of ['left','right']){
  const p=body.zones[id],part=layout.parts[id];if(!p||p.detached||p.angle<.25)continue;
  const center=panelCenter(part,p.angle),pivot=part.pivot;
  // The door's trailing edge lies beyond the normal closed-body contact shape.
  const x=pivot[0]+(center[0]-pivot[0])*1.85,z=pivot[2]+(center[2]-pivot[2])*1.85;
  const point={x:state.x+x*c+z*s,z:state.z-x*s+z*c};
  for(const box of query(point,4)||[]){
   if(!Number.isFinite(box.hx)||!Number.isFinite(box.hz)||box.visible===false)continue;
   const bs=Math.sin(box.heading||0),bc=Math.cos(box.heading||0),dx=point.x-box.x,dz=point.z-box.z,bx=dx*bc-dz*bs,bz=dx*bs+dz*bc;
   const a=box.hx+.10-Math.abs(bx),b=box.hz+.10-Math.abs(bz);if(a<=0||b<=0)continue;
   const nx=a<b?(Math.sign(bx)||1):0,nz=a<b?0:(Math.sign(bz)||1),wx=nx*bc+nz*bs,wz=-nx*bs+nz*bc;
   const closing=Math.max(0,-(state.vx*wx+state.vz*wz));p.velocity=0;p.angle=Math.max(0,p.angle-.10);
   if(damage&&closing>1){
    const energy=.5*part.mass*closing*closing,loss=clamp(energy/6500,0,.85);
    p.mounts=Math.max(0,p.mounts-loss*(1+p.angle));p.health=Math.max(0,p.health-loss*.6);p.latch=Math.max(0,p.latch-loss);p.crush=Math.min(.7,p.crush+loss*.10);p.x=part.center[0];p.z=part.center[2];p.pushX=wx*c-wz*s;p.pushZ=wx*s+wz*c;
    if(p.mounts<.10){p.detached=true;}body.revision++;
    const impulse=Math.min(closing*part.mass*1.1,closing*build.physics.mass*.08);state.vx+=wx*impulse/build.physics.mass;state.vz+=wz*impulse/build.physics.mass;
    hits.push({id,detached:p.detached,closingSpeed:closing,normal:{x:wx,z:wz},energyJ:energy});
   }
   break;
  }
 }
 return hits;
}
