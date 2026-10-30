// Small rigid boxes share the renderer's orientation. SAT tests all 15 axes;
// broad-phase queries remain owned by the existing world's spatial index.
export const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
export const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
export const add=(a,b)=>a.map((v,i)=>v+b[i]);
export const sub=(a,b)=>a.map((v,i)=>v-b[i]);
export const scale=(a,s)=>a.map(v=>v*s);
export const transform=(axes,p)=>[0,1,2].map(i=>axes[0][i]*p[0]+axes[1][i]*p[1]+axes[2][i]*p[2]);
export const multiply=(a,b)=>b.map(v=>transform(a,v));
export function eulerAxes(x=0,y=0,z=0){
 const a=Math.cos(x),b=Math.sin(x),c=Math.cos(y),d=Math.sin(y),e=Math.cos(z),f=Math.sin(z);
 return [[c*e,a*f+b*d*e,b*f-a*d*e],[-c*f,a*e-b*d*f,b*e+a*d*f],[d,-b*c,a*c]];
}
export function rotateAxes(axes,omega,dt){
 const speed=Math.hypot(...omega);if(speed<1e-9)return axes;
 const axis=scale(omega,1/speed),c=Math.cos(speed*dt),s=Math.sin(speed*dt);
 return axes.map(v=>add(add(scale(v,c),scale(cross(axis,v),s)),scale(axis,dot(axis,v)*(1-c))));
}
export function boxCorners(box){
 const out=[];for(const x of [-1,1])for(const y of [-1,1])for(const z of [-1,1])out.push(add(box.center,transform(box.axes,[x*box.half[0],y*box.half[1],z*box.half[2]])));return out;
}
export function support(box,direction){
 return add(box.center,transform(box.axes,box.axes.map((axis,i)=>{const d=dot(axis,direction);return Math.abs(d)<1e-7?0:Math.sign(d)*box.half[i];})));
}
export function staticBox(c,ground=0){
 if(c.visible===false||['traffic','network','police'].includes(c.kind)||![c.x,c.z,c.hx,c.hz].every(Number.isFinite))return null;
 const base=c.baseY??ground,top=c.maxY??base+(c.height??3),cy=(base+top)/2;
 if(top<=base)return null;
 // Sloped bridge rails provide their actual pitch and centre height.
 return {center:[c.x,c.centerY??cy,c.z],half:[c.hx,c.halfHeight??(top-base)/2,c.hz],axes:multiply(eulerAxes(0,c.heading||0,0),eulerAxes(c.pitch||0,0,0))};
}
export function staticCandidates(point,radius,query,surface){
 const boxes=[];
 for(const c of query?.(point,radius)||[]){
  const reach=radius+Math.hypot(c.hx,c.hz);
  if(!Number.isFinite(reach)||Math.abs(c.x-point.x)>reach||Math.abs(c.z-point.z)>reach||c.visible===false||['traffic','network','police'].includes(c.kind))continue;
  const box=staticBox(c,c.baseY??surface(c.x,c.z).height);if(box)boxes.push(box);
 }
 return boxes;
}
export function boxContact(a,b){
 const delta=sub(a.center,b.center),candidates=[...a.axes,...b.axes];
 for(const u of a.axes)for(const v of b.axes)candidates.push(cross(u,v));
 let depth=Infinity,normal;
 for(let n of candidates){const length=Math.hypot(...n);if(length<1e-7)continue;n=scale(n,1/length);
  const ra=a.axes.reduce((r,axis,i)=>r+Math.abs(dot(axis,n))*a.half[i],0),rb=b.axes.reduce((r,axis,i)=>r+Math.abs(dot(axis,n))*b.half[i],0),distance=dot(delta,n),overlap=ra+rb-Math.abs(distance);
  if(overlap<=0)return null;if(overlap<depth){depth=overlap;normal=scale(n,distance<0?-1:1);}
 }
 // Project the opposing centre onto the contact face, preserving the tangent
 // coordinates instead of arbitrarily choosing a far corner of a long rail.
 const toward=sub(b.center,a.center),local=a.axes.map((axis,i)=>Math.max(-a.half[i],Math.min(a.half[i],dot(toward,axis))));
 const point=add(a.center,transform(a.axes,local));
 return {normal,depth,point};
}
