import {partPose} from './part-shapes.js';
import {add,sub,scale,dot,cross,boxContact,boxCorners,staticCandidates} from './part-contacts.js';
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const ids=['left','right','hood','boot'];
export function openPanelContacts(build,body,state,query,damage=true,options={}){
 const hits=[];if(!query&&!options.surface)return hits;
 const previous=options.previous||state,angles=options.angles||{},surface=options.surface||(()=>({height:0})),mass=state.bodyMass?.mass||build.physics.mass,inertia=state.bodyMass?.inertia||build.physics.inertia;
 for(const id of ids){
  const panel=body?.zones?.[id];if(!panel||panel.detached||Math.max(panel.angle,angles[id]||0)<.015)continue;
  const angle=panel.angle,oldAngle=angles[id]??angle,layout=partPose(build,id,body,state,angle),radius=Math.hypot(...layout.half)+Math.hypot(...sub(layout.center,layout.pivot));
  const oldHeading=previous.heading??state.heading??0,turn=Math.atan2(Math.sin((state.heading||0)-oldHeading),Math.cos((state.heading||0)-oldHeading));
  const travel=Math.hypot(state.x-previous.x,state.z-previous.z)+(Math.abs(angle-oldAngle)+Math.abs(turn))*radius,steps=clamp(Math.ceil(travel/.06),1,48),boxes=staticCandidates(state,radius+travel+2,query,surface);
  let found,pose,at=state;
  for(let step=1;step<=steps&&!found;step++){
   const t=step/steps;at={...state,x:previous.x+(state.x-previous.x)*t,z:previous.z+(state.z-previous.z)*t,heading:oldHeading+turn*t};
   pose=partPose(build,id,body,at,oldAngle+(angle-oldAngle)*t);
   for(const box of boxes){const hit=boxContact(pose,box);if(hit&&(!found||hit.depth>found.depth))found=hit;}
   if(options.surface)for(const point of boxCorners(pose)){const depth=surface(point[0],point[2]).height-point[1];if(depth>0&&(!found||depth>found.depth))found={normal:[0,1,0],depth,point};}
   if(found){panel.angle=oldAngle+(angle-oldAngle)*t;state.x=at.x;state.z=at.z;}
  }
  if(!found)continue;
  const n=found.normal,point=found.point,arm=sub(point,pose.pivot),tangent=cross(pose.axis,arm),lever=dot(tangent,n),hingeInertia=Math.max(.2,pose.part.mass*(dot(sub(pose.center,pose.pivot),sub(pose.center,pose.pivot))+dot(pose.half,pose.half)/3));
  const rx=point[0]-state.x,rz=point[2]-state.z,yawLever=rz*n[0]-rx*n[2],yaw=state.yawRate||0;
  const velocity=add([state.vx+yaw*rz,options.verticalVelocity||0,state.vz-yaw*rx],scale(tangent,panel.velocity||0)),vn=dot(velocity,n),closing=Math.max(0,-vn);
  const inverse=1/mass+yawLever*yawLever/inertia+lever*lever/hingeInertia;
  let impulse=0;
  if(vn<0){impulse=-(1+(closing>1?.08:0))*vn/inverse;state.vx+=n[0]*impulse/mass;state.vz+=n[2]*impulse/mass;state.yawRate=yaw+yawLever*impulse/inertia;panel.velocity=clamp(panel.velocity+lever*impulse/hingeInertia,-5,5);}
  // Share positional correction between hinge and car. If a hinge reaches its
  // stop, the remaining normal displacement belongs to the vehicle.
  const old=panel.angle,limit=id==='left'||id==='right'?1.12:1.16,correction=(found.depth+.002)/inverse;
  panel.angle=clamp(panel.angle+lever*correction/hingeInertia,0,limit);
  const remaining=Math.max(0,found.depth+.002-lever*(panel.angle-old));
  state.x+=n[0]*remaining;state.z+=n[2]*remaining;if(n[1])state.bodyHeight=(state.bodyHeight||0)+n[1]*remaining;
  const energy=.5*closing*closing/inverse;
  if(damage&&closing>1&&energy>2){
   const loss=clamp(energy/6500,0,.85),sn=Math.sin(state.heading||0),cs=Math.cos(state.heading||0);
   panel.mounts=Math.max(0,panel.mounts-loss*(1+panel.angle));panel.health=Math.max(0,panel.health-loss*.6);panel.latch=Math.max(0,panel.latch-loss);panel.crush=Math.min(.7,panel.crush+loss*.10);panel.scratches=Math.min(1,(panel.scratches||0)+loss*.7);
   panel.x=rx*cs-rz*sn;panel.z=rx*sn+rz*cs;panel.pushX=n[0]*cs-n[2]*sn;panel.pushZ=n[0]*sn+n[2]*cs;
   if(panel.mounts<.10)panel.detached=true;body.revision++;
  }
  hits.push({id,detached:panel.detached,closingSpeed:closing,normal:{x:n[0],y:n[1],z:n[2]},point:{x:point[0],y:point[1],z:point[2]},energyJ:energy,verticalImpulse:n[1]*impulse,damaged:damage&&closing>1&&energy>2});
 }
 return hits;
}
