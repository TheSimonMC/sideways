import * as THREE from './vendor/three.module.js';
import {underbodyLayout} from './underbody.js';
const axis=new THREE.Vector3(0,1,0);
// One merged mesh per replaceable assembly keeps the extra draw calls bounded.
export function createUnderbodyView(chassis,build){
 const layout=underbodyLayout(build),roots={},records=[];
 const steel=new THREE.MeshStandardMaterial({color:0x87949d,roughness:.65,metalness:.4,flatShading:true});
 const dark=steel.clone();dark.color.set(0x303b4b);const spring=steel.clone();spring.color.set(build.selection.suspension==='street'?0x687685:0xdbb64e);
 for(const [id,d]of Object.entries(layout)){
  const geometry=[];
  const beam=(a,b,r)=>{const start=new THREE.Vector3(...a),end=new THREE.Vector3(...b),v=end.clone().sub(start),g=new THREE.CylinderGeometry(r,r,v.length(),6);g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(axis,v.normalize()));g.translate(...start.add(end).multiplyScalar(.5).toArray());geometry.push(g);};
  for(const [a,b]of d.lines){if(d.kind==='rod'){beam(a,a.map((v,i)=>v+(b[i]-v)*.49),.018);beam(a.map((v,i)=>v+(b[i]-v)*.51),b,.018);}else beam(a,b,d.kind==='pipe'?.045:d.kind==='strut'?.035:.030);}
  if(d.can){const g=new THREE.BoxGeometry(...d.can.size);g.translate(...d.can.center);geometry.push(g);}
  if(d.kind==='strut'){
   const [a,b]=d.lines[0],points=[];for(let k=0;k<=48;k++){const t=.15+.7*k/48,angle=k/48*Math.PI*12;points.push(new THREE.Vector3(a[0]+(b[0]-a[0])*t+Math.cos(angle)*.075,a[1]+(b[1]-a[1])*t,a[2]+(b[2]-a[2])*t+Math.sin(angle)*.075));}
   geometry.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points),64,.012,4,false));
  }
  const vertices=[],normals=[];
  for(const source of geometry){const g=source.toNonIndexed();vertices.push(...g.attributes.position.array);normals.push(...g.attributes.normal.array);g.dispose();source.dispose();}
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));g.computeBoundingSphere();
  const root=new THREE.Group(),mesh=new THREE.Mesh(g,d.kind==='strut'?spring:d.kind==='pipe'?steel:dark);root.name='underbody-'+id;root.userData.underbody=id;mesh.userData.underbody=id;mesh.castShadow=true;mesh.receiveShadow=true;root.add(mesh);chassis.add(root);roots[id]=root;
  records.push({id,d,root,mesh,base:g.attributes.position.array.slice(),signature:''});
 }
 const hub=new THREE.Vector3(),inverse=new THREE.Quaternion();
 function update(state){
  inverse.copy(chassis.quaternion).invert();
  for(const r of records){const part=state.bodyDamage?.underbody?.[r.id],d=r.d,i=d.corner,side=i%2?1:-1,p=build.physics;let dx=0,dy=0,dz=0;
   if(i!=null){const x=side*p.halfTrack,z=i<2?p.frontAxle:-p.rearAxle;hub.set(x,(state.suspension?.[i]?.wheelY??p.wheelRadius)-chassis.position.y,z).applyQuaternion(inverse);dx=hub.x-x;dy=hub.y-p.wheelRadius;dz=hub.z-z;}
   const rod=d.kind==='rod'?state.mechanical?.chassisDamage?.tieRods?.[i]:null,broken=rod?.health<=.025;
   const bend=(part?.bend||0)+(rod?.bend||0),crush=part?.crush||0,steer=i<2?state.wheelSteers?.[i]||0:0,key=[dx,dy,dz,bend,crush,steer,broken?1:0].map(n=>Math.round(n*1000)).join(':');r.root.visible=!part?.detached;
   if(key===r.signature)continue;r.signature=key;const a=r.mesh.geometry.attributes.position;
   for(let n=0;n<a.count;n++){
    const x=r.base[n*3],y=r.base[n*3+1],z=r.base[n*3+2];
    const t=d.kind==='strut'?THREE.MathUtils.clamp((.8-y)/Math.max(.2,.84-p.wheelRadius),0,1):i!=null?THREE.MathUtils.clamp((Math.abs(x)-.28)/Math.max(.1,p.halfTrack-.38),0,1):0;
    const pipeWeight=d.kind==='pipe'?Math.max(0,1-Math.abs(z-d.center[2])/Math.max(.1,d.half[2]))**2:0;
    a.setXYZ(n,x+dx*t+(d.kind==='strut'?bend*.14*Math.sin(t*Math.PI):0)+pipeWeight*bend*.24+(broken?Math.sign(t-.5)*side*.045:0),y+dy*t-(d.kind==='pipe'?crush*((y-d.center[1])*.7+.03)*pipeWeight:Math.sin(t*Math.PI)*Math.abs(bend)*.2)-(broken?.14*Math.sin(t*Math.PI):0),z+dz*t+bend*t*.20+(d.kind==='rod'?Math.sin(steer)*.12*t:0));
   }
   a.needsUpdate=true;r.mesh.geometry.computeBoundingSphere();
  }
 }
 return {roots,update};
}
