import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from '../dist/vendor/three.module.js';
import MotorLab from '../sdk/motor-engine.mjs';
import {createWorld} from '../dist/world.js';
import {CarPhysics} from '../dist/physics.js';

globalThis.document={createElement(){return{getContext(){return{fillRect(){},beginPath(){},arc(){},fill(){},fillText(){}}}}}};
const scene=new THREE.Scene(),world=createWorld(scene),p=new CarPhysics(MotorLab),dt=1/120;
const result={status:'passed',checks:[],patches:[],plates:[],surfaces:[],barriers:0};
const record=name=>{result.checks.push(name);console.log('PASS',name);};
const at=(progress,offset=0,along=0)=>{const c=world.curve.getPointAt(progress),t=world.curve.getTangentAt(progress);return{x:c.x+t.z*offset+t.x*along,z:c.z-t.x*offset+t.z*along,heading:Math.atan2(t.x,t.z)};};

// Test rendered polygon geometry, not a duplicate implementation of its
// point-in-polygon rule. Every edge is probed on both sides of its midpoint.
const meshes=world.root.children.filter(o=>o.userData.patch);
assert.equal(meshes.length,5);
for(const mesh of meshes){
 const patch=mesh.userData.patch,positions=mesh.geometry.attributes.position;
 let maxGeometryError=0,edgeProbes=0;
 for(let i=0;i<patch.vertices.length;i++){
  const a=patch.vertices[i],b=patch.vertices[(i+1)%patch.vertices.length],mid={x:(a.x+b.x)/2,z:(a.z+b.z)/2};
  for(const [j,expected]of [[i*3,{x:patch.x,z:patch.z}],[i*3+1,a],[i*3+2,b]])maxGeometryError=Math.max(maxGeometryError,Math.hypot(positions.getX(j)-expected.x,positions.getZ(j)-expected.z));
  const dx=mid.x-patch.x,dz=mid.z-patch.z,length=Math.hypot(dx,dz),inset=.025/length;
  for(const [factor,inside]of [[1-inset,true],[1+inset,false]]){
   const x=patch.x+dx*factor,z=patch.z+dz*factor,s=world.getSurfaceAt(x,z);
   assert.ok(world.getRoadInfo(x,z).distance>14.5,'Patch overlaps physical road border');
   assert.equal(s.material,inside?patch.material:'concrete',`Rendered ${patch.material} edge disagrees with contact material`);edgeProbes++;
  }
 }
 assert.ok(maxGeometryError<.00003);
 result.patches.push({material:patch.material,progress:patch.progress,edgeProbes,maxGeometryError});
}
record('All five rendered material polygons match sampled boundaries on both sides of every edge');

// Three visible steel quads share one paint batch. Inspect their actual mesh
// vertices and sample both the face and just beyond its four boundaries.
const steelMeshes=world.root.children.filter(o=>o.name==='road-paint'&&Math.abs(o.material.metalness-.48)<1e-9);
assert.equal(steelMeshes.length,1);
const steel=steelMeshes[0],positions=steel.geometry.attributes.position,indices=steel.geometry.index.array;
assert.equal(positions.count,30);
for(let k=0;k<indices.length;k+=3){
 const a=indices[k],b=indices[k+1],c=indices[k+2];
 for(const weights of [[1/3,1/3,1/3],[.98,.01,.01],[.01,.98,.01],[.01,.01,.98]]){
  const x=positions.getX(a)*weights[0]+positions.getX(b)*weights[1]+positions.getX(c)*weights[2],z=positions.getZ(a)*weights[0]+positions.getZ(b)*weights[1]+positions.getZ(c)*weights[2];
  assert.equal(world.getSurfaceAt(x,z).material,'metal','Rendered steel triangle has a different tyre material');
 }
}
for(const joint of world.surfaceProfile.expansionJoints){
 let inside=0,outside=0;
 for(const lateral of[-11.7,0,11.7])for(const along of[-.60,0,.60]){const point=at(joint.progress,lateral,along);assert.equal(world.getSurfaceAt(point.x,point.z).material,'metal');inside++;}
 for(const [lateral,along]of [[-11.85,0],[11.85,0],[0,-.70],[0,.70]]){const point=at(joint.progress,lateral,along);assert.notEqual(world.getSurfaceAt(point.x,point.z).material,'metal');outside++;}
 result.plates.push({progress:joint.progress,inside,outside});
}
record('All three steel covers match their entire rendered footprints, including curved-road edges');

// Every concrete barrier collision rectangle must coincide with a rendered
// rotated instance. This catches invisible walls and drive-through blocks.
const rendered=[],matrix=new THREE.Matrix4(),position=new THREE.Vector3(),scale=new THREE.Vector3(),rotation=new THREE.Quaternion();
scene.traverse(o=>{if(!o.isInstancedMesh)return;for(let i=0;i<o.count;i++){o.getMatrixAt(i,matrix);matrix.decompose(position,rotation,scale);if(Math.abs(scale.x-1.2)<1e-5&&Math.abs(scale.y-1.25)<1e-5&&Math.abs(scale.z-3.8)<1e-5)rendered.push({x:position.x,z:position.z,heading:new THREE.Euler().setFromQuaternion(rotation,'YXZ').y});}});
const barriers=world.colliders.filter(c=>c.kind==='barrier');assert.equal(barriers.length,40);assert.equal(rendered.length,40);
for(const box of barriers){const match=rendered.find(r=>Math.hypot(r.x-box.x,r.z-box.z)<.00003&&Math.abs(Math.atan2(Math.sin(r.heading-box.heading),Math.cos(r.heading-box.heading)))<1e-5);assert.ok(match,'Concrete barrier collider does not match visible rotated block');assert.equal(box.hx,.6);assert.equal(box.hz,1.9);assert.equal(box.material,'concrete');}
result.barriers=barriers.length;record('All 40 rotated barrier colliders match rendered position, orientation and dimensions');

// The same world query drives per-wheel physics metadata. Curbs and steel are
// intentionally narrower than a car, so the fixtures also verify mixed tyres.
const fixtures=[{name:'asphalt',...at(.1)},{name:'concrete',...at(.15,24)},{name:'curb',...at(.1,11.8)},
 {name:'gravel',...world.surfacePatches.find(s=>s.material==='gravel')},{name:'grass',...world.surfacePatches.find(s=>s.material==='grass')},
 {name:'metal',...at(.2,0,-p.frontAxle)}];
const seen=new Set();p.setGroundSampler(world.getSurfaceAt);
for(const fixture of fixtures){
 p.reset(fixture.x,fixture.z,fixture.heading);for(let i=0;i<120;i++)p.update(dt,{transmission:'sequential',manualClutch:true,clutch:1},world.getSurfaceAt(p.state.x,p.state.z));
 const contacts=p.state.wheelAudio.map((audio,i)=>{
  const [x,z]=p._positions[i],s=p.state,sn=Math.sin(s.heading),cs=Math.cos(s.heading),sample=world.getSurfaceAt(s.x+x*cs+z*sn,s.z-x*sn+z*cs);seen.add(sample.material);
  assert.equal(audio.surface,sample.material);assert.equal(audio.roughness,sample.roughness);assert.equal(s.suspension[i].grip,sample.grip);assert.equal(audio.tyrePower,0);assert.equal(audio.brakePower,0);assert.equal(audio.wheelSpeed,0);assert.equal(audio.slipSpeed,0);
  return{surface:audio.surface,grip:sample.grip,roughness:audio.roughness};
 });
 assert.ok(contacts.some(s=>s.surface===fixture.name),`Fixture failed to contact ${fixture.name}`);result.surfaces.push({fixture:fixture.name,contacts});
}
assert.deepEqual([...seen].sort(),Object.keys(world.surfaceMaterials).sort());record('All six actual world materials reach individual tyre physics without inventing movement or dissipated work at rest');

// Controlled equal-load locked-wheel test isolates material grip from height,
// engine and brake choice, and proves the material changes actual forces.
const deceleration=[];
for(const [material,props]of Object.entries(world.surfaceMaterials)){
 p.setGroundSampler(()=>({height:0,material,...props}));p.reset();p.state.vz=12;p._brakePressures.fill(1);p.update(dt,{transmission:'sequential',manualClutch:true,clutch:1,brake:1,handbrake:1,assists:false},props.grip);
 deceleration.push({material,grip:props.grip,deceleration:(12-p.state.vz)/dt});
}
deceleration.sort((a,b)=>b.grip-a.grip);for(let i=1;i<deceleration.length;i++)assert.ok(deceleration[i-1].deceleration>deceleration[i].deceleration+.03,'Grip changes did not reach tyre force');
result.materialBraking=deceleration;record('Identical locked-wheel braking produces distinct correctly ordered forces for all six surfaces');

const count=20000,start=performance.now();let checksum=0;
for(let i=0;i<count;i++){const sample=world.samples[i%world.samples.length],offset=(i%41)-20,s=world.getSurfaceAt(sample.x+sample.tz*offset,sample.z-sample.tx*offset);checksum+=s.height+s.grip+s.roughness;}
const duration=performance.now()-start;assert.ok(Number.isFinite(checksum));result.samplerPerformance={queries:count,totalMs:duration,microsecondsPerQuery:duration*1000/count,fourWheelsAt120HzMsPerSimulationSecond:duration/count*480,checksum};
record('Terrain sampler remains finite over 20000 road, curb and offroad queries; timing recorded without a host-dependent pass gate');
fs.writeFileSync(new URL('./world-v4-results.json',import.meta.url),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
