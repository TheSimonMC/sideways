/** A rounded, model-sized car body against static dock geometry and moving cars.
 * Contacts exchange linear and angular impulse at the actual body contact.
 * This is a planar collision model; the sprung chassis remains in physics.js. */
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const finite=(v,fallback=0)=>Number.isFinite(v)?v:fallback;
const wrap=a=>Math.atan2(Math.sin(a),Math.cos(a));

function dimensions(build={}){
 const m=build.vehicle?.model||build.model||build,p=build.physics||build;
 const width=Math.max(.2,finite(p.bodyWidth,finite(m.width,2.03))),length=Math.max(width,finite(m.length,4.42));
 return {radius:width*.5,halfSegment:(length-width)*.5,length,width,mass:Math.max(1,finite(p.mass,1160)),inertia:Math.max(1,finite(p.inertia,1680))};
}

// Distance from a finite line segment to an axis-aligned box. Squared distance
// is quadratic between crossings of the four face planes, so no sampling or
// iterative closest-point approximation is required.
function closestSegmentBox(ax,az,bx,bz,hx,hz){
 const dx=bx-ax,dz=bz-az,cuts=[0,1];
 if(Math.abs(dx)>1e-12)for(const face of [-hx,hx]){const t=(face-ax)/dx;if(t>0&&t<1)cuts.push(t);}
 if(Math.abs(dz)>1e-12)for(const face of [-hz,hz]){const t=(face-az)/dz;if(t>0&&t<1)cuts.push(t);}
 cuts.sort((a,b)=>a-b);let best=null;
 const evaluate=t=>{const x=ax+dx*t,z=az+dz*t,qx=clamp(x,-hx,hx),qz=clamp(z,-hz,hz),distance2=(x-qx)**2+(z-qz)**2;
  if(!best||distance2<best.distance2-1e-12||Math.abs(distance2-best.distance2)<1e-12&&Math.abs(t-.5)<Math.abs(best.t-.5))best={x,z,qx,qz,distance2,t};};
 for(let i=0;i<cuts.length-1;i++){
  const lo=cuts[i],hi=cuts[i+1],mid=(lo+hi)*.5,mx=ax+dx*mid,mz=az+dz*mid;let aa=0,bb=0;
  if(mx< -hx||mx>hx){const face=mx<0?-hx:hx;aa+=dx*dx;bb+=dx*(ax-face);}
  if(mz< -hz||mz>hz){const face=mz<0?-hz:hz;aa+=dz*dz;bb+=dz*(az-face);}
  evaluate(aa>1e-20?clamp(-bb/aa,lo,hi):clamp(.5,lo,hi));evaluate(lo);evaluate(hi);
 }
 return best;
}

/** Pure geometry. Heading is clockwise from world +Z toward +X.
 * Boxes may have their own heading, with hx/hz measured in box-local space. */
export function capsuleContact(state,box,build={}){
 if(!state||!box||![state.x,state.z,box.x,box.z,box.hx,box.hz].every(Number.isFinite)||box.hx<0||box.hz<0)return null;
 const d=dimensions(build),bh=finite(box.heading),bc=Math.cos(bh),bs=Math.sin(bh),dx=state.x-box.x,dz=state.z-box.z;
 const cx=dx*bc-dz*bs,cz=dx*bs+dz*bc,h=finite(state.heading)-bh,fx=Math.sin(h),fz=Math.cos(h),half=d.halfSegment,r=d.radius;
 if(Math.abs(cx)>box.hx+Math.abs(fx)*half+r||Math.abs(cz)>box.hz+Math.abs(fz)*half+r)return null;
 const q=closestSegmentBox(cx-fx*half,cz-fz*half,cx+fx*half,cz+fz*half,box.hx,box.hz);
 if(q.distance2>=r*r)return null;
 let nx,nz,penetration,px,pz;
 if(q.distance2>1e-16){
  const distance=Math.sqrt(q.distance2);nx=(q.x-q.qx)/distance;nz=(q.z-q.qz)/distance;penetration=r-distance;px=q.x-r*nx;pz=q.z-r*nz;
 }else{
  // Embedded centre lines need a separating translation, including contained
  // cars and side-on bars. Any selected axis fully separates both shapes.
  let best=Infinity;
  for(const [ux,uz] of [[1,0],[0,1],[fz,-fx]]){
   const center=cx*ux+cz*uz,extent=half*Math.abs(fx*ux+fz*uz)+r,boxExtent=box.hx*Math.abs(ux)+box.hz*Math.abs(uz);
   const positive=boxExtent-center+extent,negative=boxExtent+center+extent;
   const sign=positive<=negative?1:-1,depth=Math.min(positive,negative);
   if(depth<best){best=depth;nx=ux*sign;nz=uz*sign;}
  }
  penetration=best;
  const along=fx*nx+fz*nz;
  const t=Math.abs(along)>1e-8?-Math.sign(along)*half:clamp(-cx*fx-cz*fz,-half,half);
  px=cx+fx*t-r*nx;pz=cz+fz*t-r*nz;
 }
 return {normal:{x:nx*bc+nz*bs,z:-nx*bs+nz*bc},point:{x:box.x+px*bc+pz*bs,z:box.z-px*bs+pz*bc},penetration};
}

/** Mutates only position and planar velocity; heading stays with the vehicle
 * integrator. previousPosition enables a conservative swept path at fast speed.
 * A returned contact can have zero impulse when merely touching or separating. */
export function resolveVehicleContacts(state,colliders,build={},options={}){
 const result={collided:false,contacts:[],maxClosingSpeed:0};
 if(!state||!Array.isArray(colliders)||![state.x,state.z,state.vx,state.vz,state.yawRate].every(Number.isFinite))return result;
 const d=dimensions(build),invMass=1/d.mass,invInertia=1/d.inertia,restitution=clamp(finite(options.restitution,.08),0,1),friction=clamp(finite(options.friction,.32),0,1),skin=.001;
 const dt=clamp(finite(options.dt,1/120),1/1000,1/15),end={x:state.x,z:state.z,heading:finite(state.heading)},previous=options.previousPosition;
 const canSweep=previous&&[previous.x,previous.z].every(Number.isFinite),start=canSweep?{x:previous.x,z:previous.z,heading:finite(previous.heading,end.heading)}:end;
 const travel=Math.hypot(end.x-start.x,end.z-start.z),turn=wrap(end.heading-start.heading);
 const steps=canSweep?clamp(Math.ceil((travel+Math.abs(turn)*d.length*.5)/Math.max(.12,d.radius*.42)),1,256):1;
 const byCollider=new Map();let intercepted=false;
 if(canSweep){state.x=start.x;state.z=start.z;}
 for(let step=1;step<=steps;step++){
  if(!intercepted){state.x=start.x+(end.x-start.x)*step/steps;state.z=start.z+(end.z-start.z)*step/steps;}
  else{state.x+=state.vx*dt/steps;state.z+=state.vz*dt/steps;}
  const pose={x:state.x,z:state.z,heading:start.heading+turn*step/steps};
  for(let pass=0;pass<4;pass++){
   let corrected=false;
   for(const box of colliders){
    pose.x=state.x;pose.z=state.z;const hit=capsuleContact(pose,box,build);if(!hit)continue;
    corrected=result.collided=intercepted=true;
    const {normal:n,point}=hit,rx=point.x-state.x,rz=point.z-state.z,arm=rz*n.x-rx*n.z;
    const other=box.body&&Number.isFinite(box.mass)&&box.mass>0?box.body:null;
    const invOther=other?1/box.mass:0,otherInertia=other?Math.max(1,finite(box.inertia,box.mass*(box.hx*box.hx+box.hz*box.hz)/3)):Infinity,invOtherYaw=other?1/otherInertia:0;
    if(other){other.vx=finite(other.vx);other.vz=finite(other.vz);other.yawRate=finite(other.yawRate);}
    const brx=other?point.x-other.x:0,brz=other?point.z-other.z:0,barm=brz*n.x-brx*n.z;
    const wallVX=other?other.vx+other.yawRate*brz:finite(box.vx),wallVZ=other?other.vz-other.yawRate*brx:finite(box.vz);
    const relativeX=state.vx+state.yawRate*rz-wallVX,relativeZ=state.vz-state.yawRate*rx-wallVZ;
    const normalVelocity=relativeX*n.x+relativeZ*n.z;
    const closingSpeed=Math.max(0,-normalVelocity),relativeSpeed=Math.hypot(relativeX,relativeZ);let impulse=0,frictionImpulse=0;
    const kinetic=()=>.5*d.mass*(state.vx*state.vx+state.vz*state.vz)+.5*d.inertia*state.yawRate*state.yawRate+(other ? .5*box.mass*(other.vx*other.vx+other.vz*other.vz)+.5*otherInertia*other.yawRate*other.yawRate:0);
    const energyBefore=kinetic(),tx=-n.z,tz=n.x;
    if(normalVelocity<0){
     // Both dynamic bodies receive the same impulse with opposite signs.
     // Kinematic walls retain the existing one-body response.
     const bounce=closingSpeed>1?restitution:0;
     impulse=-(1+bounce)*normalVelocity/(invMass+arm*arm*invInertia+invOther+barm*barm*invOtherYaw);
     state.vx+=impulse*n.x*invMass;state.vz+=impulse*n.z*invMass;state.yawRate+=impulse*arm*invInertia;
     if(other){other.vx-=impulse*n.x*invOther;other.vz-=impulse*n.z*invOther;other.yawRate-=impulse*barm*invOtherYaw;}
     const tarm=rz*tx-rx*tz,btarm=brz*tx-brx*tz;
     const bvx=other?other.vx+other.yawRate*brz:wallVX,bvz=other?other.vz-other.yawRate*brx:wallVZ;
     const tv=(state.vx+state.yawRate*rz-bvx)*tx+(state.vz-state.yawRate*rx-bvz)*tz;
     frictionImpulse=clamp(-tv/(invMass+tarm*tarm*invInertia+invOther+btarm*btarm*invOtherYaw),-friction*impulse,friction*impulse);
     state.vx+=frictionImpulse*tx*invMass;state.vz+=frictionImpulse*tz*invMass;state.yawRate+=frictionImpulse*tarm*invInertia;
     if(other){other.vx-=frictionImpulse*tx*invOther;other.vz-=frictionImpulse*tz*invOther;other.yawRate-=frictionImpulse*btarm*invOtherYaw;}
    }
    const energyJ=Math.max(0,energyBefore-kinetic()),correction=hit.penetration+skin,share=invMass/(invMass+invOther),playerCorrection=correction*share;
    state.x+=n.x*playerCorrection;state.z+=n.z*playerCorrection;
    if(other){other.x-=n.x*correction*(1-share);other.z-=n.z*correction*(1-share);Object.assign(box,{x:other.x,z:other.z,vx:other.vx,vz:other.vz,yawRate:other.yawRate});}
    point.x+=n.x*playerCorrection;point.z+=n.z*playerCorrection;
    const cs=Math.cos(finite(state.heading)),sn=Math.sin(finite(state.heading)),localPoint={x:rx*cs-rz*sn,z:rx*sn+rz*cs},impulseVector={x:impulse*n.x+frictionImpulse*tx,z:impulse*n.z+frictionImpulse*tz};
    const recorded=byCollider.get(box);
    if(recorded){recorded.impulse+=impulse;recorded.frictionImpulse+=frictionImpulse;recorded.energyJ+=energyJ;recorded.impulseVector.x+=impulseVector.x;recorded.impulseVector.z+=impulseVector.z;recorded.penetration=Math.max(recorded.penetration,hit.penetration);if(closingSpeed>recorded.closingSpeed){recorded.closingSpeed=closingSpeed;recorded.relativeSpeed=relativeSpeed;recorded.normal=n;recorded.point=point;recorded.localPoint=localPoint;}}
    else{const contact={...hit,closingSpeed,relativeSpeed,impulse,frictionImpulse,impulseVector,localPoint,energyJ,collider:box};byCollider.set(box,contact);result.contacts.push(contact);}
    result.maxClosingSpeed=Math.max(result.maxClosingSpeed,closingSpeed);
   }
   if(!corrected)break;
  }
 }
 return result;
}
