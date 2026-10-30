import {add,sub,scale,dot,cross,transform,eulerAxes,multiply,rotateAxes,boxCorners,boxContact,staticCandidates} from './part-contacts.js';
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const velocity=p=>[p.vx,p.vy,p.vz];
const move=(p,n,d)=>{p.x+=n[0]*d;p.y+=n[1]*d;p.z+=n[2]*d;};
const accelerate=(p,n,j)=>{p.vx+=n[0]*j;p.vy+=n[1]*j;p.vz+=n[2]*j;};
function inverseInertia(box,v){return transform(box.axes,box.axes.map((axis,i)=>dot(axis,v)/Math.max(.003,(box.half[(i+1)%3]**2+box.half[(i+2)%3]**2)/3)));}
function impulse(p,box,point,normal,friction=.4){
 const arm=sub(point,box.center),omega=p.angularVelocity||[0,0,0],relative=add(velocity(p),cross(omega,arm)),vn=dot(relative,normal);
 if(vn>=0)return 0;
 const lever=cross(arm,normal),inv=inverseInertia(box,lever),j=-(1+(vn< -1?.18:0))*vn/(1+(p.angularVelocity?dot(lever,inv):0));
 accelerate(p,normal,j);if(p.angularVelocity)p.angularVelocity=add(omega,scale(inv,j));
 const after=add(velocity(p),cross(p.angularVelocity||[0,0,0],arm)),t=sub(after,scale(normal,dot(after,normal))),speed=Math.hypot(...t);
 if(speed>.0001){const direction=scale(t,1/speed),l=cross(arm,direction),ii=inverseInertia(box,l),jt=-Math.min(j*friction,speed/(1+(p.angularVelocity?dot(l,ii):0)));accelerate(p,direction,jt);if(p.angularVelocity)p.angularVelocity=add(p.angularVelocity,scale(ii,jt));}
 return -vn;
}
const nearby=(p,query,surface,radius)=>staticCandidates(p,radius,query,surface);
// Up to eight panel boxes and 24 small glass proxies; static contacts only.
export function advanceDebris(p,dt,surface,query){
 if(!(dt>0))return;
 const half=p.half||[Math.min(.34,p.radius??.25),p.floorOffset??.10,Math.min(.34,p.radius??.25)],extent=Math.hypot(...half),travel=Math.hypot(p.vx,p.vy,p.vz)*dt;
 const steps=clamp(Math.ceil((travel+Math.hypot(...(p.angularVelocity||[0,0,0]))*extent*dt)/.10),1,64),h=dt/steps,boxes=nearby(p,query,surface,travel+extent+1);
 p.contacts??=0;
 for(let n=0;n<steps;n++){
  p.vy-=9.81*h;p.x+=p.vx*h;p.z+=p.vz*h;p.y+=p.vy*h;p.rotation=(p.rotation||0)+(p.spin||0)*h;
  if(p.axes&&p.angularVelocity)p.axes=rotateAxes(p.axes,p.angularVelocity,h);
  let box={center:[p.x,p.y,p.z],half,axes:p.axes||eulerAxes()};
  const corners=boxCorners(box);let deepest=0,point;
  for(const v of corners){const depth=surface(v[0],v[2]).height-v[1];if(depth>deepest){deepest=depth;point=v;}}
  if(deepest>0){p.y+=deepest;box.center[1]=p.y;point[1]+=deepest;impulse(p,box,point,[0,1,0]);
   const friction=Math.exp(-h*2.4);p.vx*=friction;p.vz*=friction;p.spin=(p.spin||0)*Math.exp(-h*4);if(p.angularVelocity)p.angularVelocity=scale(p.angularVelocity,Math.exp(-h*3));
  }
  for(const other of boxes){const hit=boxContact(box,other);if(!hit)continue;move(p,hit.normal,hit.depth+.001);box.center=[p.x,p.y,p.z];const point=add(hit.point,scale(hit.normal,hit.depth));if(impulse(p,box,point,hit.normal)>0)p.contacts++;}
  if(p.angularVelocity){const speed=Math.hypot(...p.angularVelocity);if(speed>24)p.angularVelocity=scale(p.angularVelocity,24/speed);}
 }
 p.age+=dt;
}
// A detached wheel has a free rolling axis. Ground friction couples translation
// and spin; it falls onto its side at low speed instead of leaning by its age.
export function advanceLooseWheel(p,dt,surface,query){
 if(!(dt>0))return;
 const radius=p.radius,width=p.width??radius*.72,travel=Math.hypot(p.vx,p.vy,p.vz)*dt,steps=clamp(Math.ceil(travel/.10),1,64),h=dt/steps,boxes=nearby(p,query,surface,travel+radius+1);
 p.contacts??=0;p.lean??=0;p.leanVelocity??=0;
 for(let n=0;n<steps;n++){
  p.vy-=9.81*h;p.x+=p.vx*h;p.z+=p.vz*h;p.y+=p.vy*h;p.spin+=p.omega*h;
  const sn=Math.sin(p.heading),cs=Math.cos(p.heading),half=[width/2,radius,radius],axes=multiply(eulerAxes(0,p.heading,0),eulerAxes(0,0,p.lean)),support=Math.abs(Math.cos(p.lean))*radius+Math.abs(Math.sin(p.lean))*width/2;
  let box={center:[p.x,p.y,p.z],axes,half};
  for(const other of boxes){const hit=boxContact(box,other);if(!hit)continue;move(p,hit.normal,hit.depth+.001);box.center=[p.x,p.y,p.z];const vn=dot(velocity(p),hit.normal);if(vn<0){accelerate(p,hit.normal,-vn*1.22);p.contacts++;p.leanVelocity+=clamp((hit.normal[0]*cs-hit.normal[2]*sn)*-vn*.12,-2,2);}}
  const ground=surface(p.x,p.z),floor=ground.height+support;
  if(p.y<=floor+.001){p.y=floor;p.vy=p.vy< -1?-p.vy*.28:Math.max(0,p.vy);
   const e=.18,gx=(surface(p.x+e,p.z).height-surface(p.x-e,p.z).height)/(2*e),gz=(surface(p.x,p.z+e).height-surface(p.x,p.z-e).height)/(2*e),gscale=9.81/(1+gx*gx+gz*gz);p.vx-=gx*gscale*h;p.vz-=gz*gscale*h;
   const long=p.vx*sn+p.vz*cs,lat=p.vx*cs-p.vz*sn,upright=Math.abs(Math.cos(p.lean)),friction=(ground.grip??1)*(ground.wetness?.72:1);
   if(upright>.4){const j=clamp(-(long-p.omega*radius)/(1+1/.55),-friction*9.81*h,friction*9.81*h);p.vx+=sn*j;p.vz+=cs*j;p.omega-=j/(.55*radius);const lateral=clamp(-lat,-friction*9.81*h,friction*9.81*h);p.vx+=cs*lateral;p.vz-=sn*lateral;}
   const drag=Math.exp(-h*(.08+(1-upright)*3.6));p.vx*=drag;p.vz*=drag;p.omega*=Math.exp(-h*(.035+(1-upright)*2));
   const speed=Math.hypot(p.vx,p.vz),fall=Math.max(0,1-speed/4),sign=Math.sign(p.lean)||Math.sign(p.leanVelocity)||1;
   p.leanVelocity+=(sign*fall*(.6+Math.abs(Math.sin(p.lean))*4)-p.leanVelocity*3-p.lean*(1-fall)*2)*h;
   p.lean=clamp(p.lean+p.leanVelocity*h,-Math.PI/2,Math.PI/2);if(Math.abs(p.lean)===Math.PI/2)p.leanVelocity=0;
  }
 }
 p.age+=dt;
}
