import * as THREE from './vendor/three.module.js';

// Short lines lie on the damaged mesh's triangles, including its current dent.
// Geometry is rebuilt only when damage changes, never every render frame.
export function updateSurfaceMarks(mesh,condition,glass=false,hit=null,toBody=null){
 let marks=mesh.children.find(n=>n.name==='surface-damage');
 const amount=condition?.scratches||0,cracked=!!condition?.cracked;
 if(amount<.015&&!cracked){if(marks)marks.visible=false;return;}
 if(!marks){marks=new THREE.LineSegments(new THREE.BufferGeometry(),new THREE.LineBasicMaterial({color:glass?0xc5e8ea:0x85909b,transparent:true,opacity:glass?.82:.85,depthWrite:false}));marks.name='surface-damage';mesh.add(marks);}
 const pos=mesh.geometry.attributes.position,index=mesh.geometry.index,triangles=(index?index.count:pos.count)/3,verts=[];
 const at=i=>new THREE.Vector3().fromBufferAttribute(pos,index?index.getX(i):i);
 const ranked=[];
 for(let i=0;i<triangles;i++){const a=at(i*3),b=at(i*3+1),c=at(i*3+2),center=a.clone().add(b).add(c).multiplyScalar(1/3),world=toBody?center.clone().applyMatrix4(toBody):center;ranked.push({a,b,c,d:hit?(world.x-hit.x)**2+(world.z-hit.z)**2:i});}
 ranked.sort((a,b)=>a.d-b.d);
 for(const {a,b,c}of ranked.slice(0,glass?8:Math.max(1,Math.ceil(amount*5)))){
  const normal=b.clone().sub(a).cross(c.clone().sub(a)).normalize().multiplyScalar(.004);
  const point=(u,v)=>a.clone().multiplyScalar(1-u-v).addScaledVector(b,u).addScaledVector(c,v).add(normal);
  for(let j=0;j<(glass&&cracked?5:2);j++){
   const center=point(.32,.31),end=point(.08+j*.15,.10+(j%2)*.23);
   if(!glass)center.copy(point(.25+j*.13,.25));verts.push(...center.toArray(),...end.toArray());
  }
 }
 marks.geometry.dispose();marks.geometry=new THREE.BufferGeometry();marks.geometry.setAttribute('position',new THREE.Float32BufferAttribute(verts,3));marks.visible=true;
}
