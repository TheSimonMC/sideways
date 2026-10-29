const clamp=(n,a,b)=>Math.max(a,Math.min(b,Number.isFinite(n)?n:a));

/** Horizontal facade queries for the dock. Small street furniture and low
 * barriers are omitted, so a lamp or kerb cannot become an acoustic wall. */
export function createFacadeSampler(colliders=[]){
 const facades=colliders.filter(c=>c&&[c.x,c.z,c.hx,c.hz].every(Number.isFinite)&&c.hx*c.hz>=8&&Math.min(c.hx,c.hz)>=1.2&&c.kind!=='barrier');
 return function sampleAcoustics(x,z,heading=0,right=null){
  const valid=Number.isFinite(x)&&Number.isFinite(z),h=Number.isFinite(heading)?heading:0;
  const basis=right&&Number.isFinite(right.x)&&Number.isFinite(right.z)&&Math.hypot(right.x,right.z)>.001?right:{x:Math.cos(h),z:-Math.sin(h)},magnitude=Math.hypot(basis.x,basis.z),rx=basis.x/magnitude,rz=basis.z/magnitude;
  const nearby=valid?facades.filter(c=>Math.hypot(c.x-x,c.z-z)<92+Math.hypot(c.hx,c.hz)):[];
  function cast(dx,dz){
   let nearest=90,reflect=.1;
   for(const c of nearby){
    const sn=Math.sin(c.heading||0),cs=Math.cos(c.heading||0),ox=(x-c.x)*cs-(z-c.z)*sn,oz=(x-c.x)*sn+(z-c.z)*cs,vx=dx*cs-dz*sn,vz=dx*sn+dz*cs;
    let enter=0,exit=90;
    for(const [origin,direction,extent]of [[ox,vx,c.hx],[oz,vz,c.hz]]){
     if(Math.abs(direction)<1e-7){if(Math.abs(origin)>extent){exit=-1;break;}}
     else{let a=(-extent-origin)/direction,b=(extent-origin)/direction;if(a>b)[a,b]=[b,a];enter=Math.max(enter,a);exit=Math.min(exit,b);}
    }
    if(exit>=enter&&exit>0&&enter<nearest){nearest=Math.max(1.5,enter);reflect=clamp(c.reflectivity??(c.material==='metal'?.92:.78),.1,.95);}
   }
   return {distance:nearest,reflect};
  }
  function fan(dx,dz){let result=cast(dx,dz);for(const angle of[-.34,.34]){const cs=Math.cos(angle),sn=Math.sin(angle),hit=cast(dx*cs-dz*sn,dx*sn+dz*cs);if(hit.distance<result.distance)result=hit;}return result;}
  const fx=Math.sin(h),fz=Math.cos(h),rays=[fan(-rx,-rz),fan(rx,rz),fan(fx,fz),fan(-fx,-fz)];
  const enclosure=clamp(rays.reduce((sum,r)=>sum+Math.pow(1-r.distance/90,1.15),0)/3,0,1),reflectivity=clamp(rays.reduce((sum,r)=>sum+r.reflect*(1-r.distance/110),0)/4,.10,.95);
  return {zone:enclosure>.25?'dock-yard':'harbor-open',enclosure,reflectivity,openness:1-enclosure,leftDistance:rays[0].distance,rightDistance:rays[1].distance,frontDistance:rays[2].distance,backDistance:rays[3].distance,district:'DOCK 09',ambient:{park:0,water:valid?clamp((x-180)/110,0,1):0,industrial:enclosure*.6,traffic:.1,wind:1-enclosure*.65,insects:0}};
 };
}
