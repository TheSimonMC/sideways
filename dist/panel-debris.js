// Bounded rigid proxies for loose bodywork. Contacts are against the same local
// static road/building colliders as the vehicle; no debris-to-debris solver.
export function advanceDebris(p,dt,surface,query){
 const steps=Math.max(1,Math.min(24,Math.ceil(Math.hypot(p.vx,p.vz)*dt/.20))),h=dt/steps;
 for(let n=0;n<steps;n++){
  p.vy-=9.81*h;p.x+=p.vx*h;p.z+=p.vz*h;p.y+=p.vy*h;p.rotation+=p.spin*h;
  const ground=surface(p.x,p.z).height,floor=ground+(p.floorOffset??.1);
  if(p.y<floor){p.y=floor;p.vy=Math.abs(p.vy)>1?-p.vy*.18:0;const f=Math.exp(-h*3);p.vx*=f;p.vz*=f;p.spin*=Math.exp(-h*4);}
  for(const c of query?.(p,4)||[]){
   if(c.visible===false||c.kind==='traffic'||c.kind==='network'||c.kind==='police')continue;
   const base=c.baseY??c.y??ground,top=c.maxY??base+(c.height??3);
   if(p.y-.10>top||p.y+.10<base)continue;
   const angle=c.heading||0,s=Math.sin(angle),k=Math.cos(angle),dx=p.x-c.x,dz=p.z-c.z;
   const x=dx*k-dz*s,z=dx*s+dz*k,r=Math.min(.34,p.radius??.25),hx=c.hx??c.radius??.5,hz=c.hz??c.radius??.5;
   const a=hx+r-Math.abs(x),b=hz+r-Math.abs(z);if(a<=0||b<=0)continue;
   const nx=a<b?(Math.sign(x)||1):0,nz=a<b?0:(Math.sign(z)||1),wx=nx*k+nz*s,wz=-nx*s+nz*k,d=Math.min(a,b);
   p.x+=wx*(d+.001);p.z+=wz*(d+.001);const v=p.vx*wx+p.vz*wz;
   if(v<0){p.vx-=wx*v*1.22;p.vz-=wz*v*1.22;p.spin*=.65;p.contacts++;}
  }
 }
 p.age+=dt;
}
