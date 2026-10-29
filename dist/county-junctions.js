/** Split at-grade crossings into real shared graph nodes. Bridge spans retain
 * their level and do not become accidental junctions with roads below them. */
export function splitCrossings(roads,node){
 const cells=new Map(),cuts=new Map(),seen=new Set();
 roads.forEach((r,id)=>{r._id=id;const list=[{s:0,p:r.points[0],n:r.a}],distances=[0];for(let i=1;i<r.points.length;i++)distances.push(distances.at(-1)+Math.hypot(r.points[i].x-r.points[i-1].x,r.points[i].z-r.points[i-1].z));list.push({s:distances.at(-1),p:r.points.at(-1),n:r.b});cuts.set(r,list);r._distances=distances;
  if(r.bridge)return;
  for(let i=1;i<r.points.length;i++){const a=r.points[i-1],b=r.points[i],seg={r,a,b,i,s:distances[i-1],len:distances[i]-distances[i-1]};for(let x=Math.floor(Math.min(a.x,b.x)/80);x<=Math.floor(Math.max(a.x,b.x)/80);x++)for(let z=Math.floor(Math.min(a.z,b.z)/80);z<=Math.floor(Math.max(a.z,b.z)/80);z++){const key=x+','+z;if(!cells.has(key))cells.set(key,[]);cells.get(key).push(seg);}}
 });
 for(const bucket of cells.values())for(let i=0;i<bucket.length;i++)for(let j=i+1;j<bucket.length;j++){
  const a=bucket[i],b=bucket[j];if(a.r===b.r)continue;const key=a.r._id+':'+a.i+'/'+b.r._id+':'+b.i;if(seen.has(key))continue;seen.add(key);
  const dx=a.b.x-a.a.x,dz=a.b.z-a.a.z,ex=b.b.x-b.a.x,ez=b.b.z-b.a.z,den=dx*ez-dz*ex;if(Math.abs(den)<1e-8)continue;const qx=b.a.x-a.a.x,qz=b.a.z-a.a.z,t=(qx*ez-qz*ex)/den,u=(qx*dz-qz*dx)/den;if(t< -1e-6||t>1.000001||u< -1e-6||u>1.000001)continue;
  const y=a.a.y+(a.b.y-a.a.y)*t,yb=b.a.y+(b.b.y-b.a.y)*u;if(Math.abs(y-yb)>1)continue;const p={x:a.a.x+dx*t,z:a.a.z+dz*t,y:Math.max(y,yb)},n=node(p.x,p.z,a.r.name+' / '+b.r.name);cuts.get(a.r).push({s:a.s+a.len*t,p,n});cuts.get(b.r).push({s:b.s+b.len*u,p,n});
 }
 const out=[];
 for(const r of roads){const unique=cuts.get(r).sort((a,b)=>a.s-b.s).filter((c,i,list)=>!i||c.s-list[i-1].s>.1);for(let i=1;i<unique.length;i++){const a=unique[i-1],b=unique[i];if(a.n===b.n||b.s-a.s<.1)continue;const points=[{...a.p}];for(let k=1;k<r.points.length-1;k++)if(r._distances[k]>a.s+.05&&r._distances[k]<b.s-.05)points.push({...r.points[k]});points.push({...b.p});out.push({...r,a:a.n,b:b.n,from:a.n.id,to:b.n.id,points});}delete r._id;delete r._distances;}
 return out;
}
