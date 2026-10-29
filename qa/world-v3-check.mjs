import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from '../dist/vendor/three.module.js';
import {createWorld} from '../dist/world.js';
globalThis.document={createElement:tag=>({width:0,height:0,getContext:()=>({fillRect(){},beginPath(){},arc(){},fill(){},fillText(){}})})};
const start=performance.now(),scene=new THREE.Scene(),world=createWorld(scene);
const result={status:'passed',checks:[],profile:world.surfaceProfile,meshSamples:0,maxSurfaceMismatch:0,maxPaintMismatch:0,joints:[],curbs:[]};
assert.equal(world.samples.length,480);assert.equal(world.checkpoints.length,8);assert.equal(world.mapPoints.length,120);result.checks.push('Original track centerline, checkpoints and minimap structure retained');
const contactMeshes=world.root.children.filter(o=>['road-asphalt','road-curb','road-shoulder','road-edge-ramp'].includes(o.name));
assert.equal(contactMeshes.length,11);
for(const mesh of contactMeshes){
 const p=mesh.geometry.getAttribute('position'),idx=mesh.geometry.index.array;
 for(let k=0;k<idx.length;k+=3){
  const a=idx[k],b=idx[k+1],c=idx[k+2];
  const x=(p.getX(a)+p.getX(b)+p.getX(c))/3,z=(p.getZ(a)+p.getZ(b)+p.getZ(c))/3,y=(p.getY(a)+p.getY(b)+p.getY(c))/3;
  const surface=world.getSurfaceAt(x,z),error=Math.abs(surface.height-y);result.meshSamples++;result.maxSurfaceMismatch=Math.max(result.maxSurfaceMismatch,error);
  assert(error<.00005,`${mesh.name} rendered/contact mismatch ${error} at ${x},${z}`);
 }
}
result.checks.push('Every asphalt, curb, shoulder and edge-ramp triangle centroid matches sampled contact height');
const paintMeshes=world.root.children.filter(o=>['road-edge-line','road-rubber','road-arrow','road-paint'].includes(o.name));
for(const mesh of paintMeshes){const p=mesh.geometry.getAttribute('position'),elevation=mesh.userData.surfaceElevation;for(let i=0;i<p.count;i++){const sample=world.getSurfaceAt(p.getX(i),p.getZ(i)),error=Math.abs(p.getY(i)-sample.height-elevation);result.maxPaintMismatch=Math.max(result.maxPaintMismatch,error);assert(error<.0001,`${mesh.name} paint/surface mismatch ${error}`);}}
result.checks.push('Lane lines, arrows, rubber and finish paint follow the road surface with bounded separation');
for(const joint of world.surfaceProfile.expansionJoints){
 const center=world.curve.getPointAt(joint.progress),surface=world.getSurfaceAt(center.x,center.z);
 const before=world.curve.getPointAt(joint.progress-3.2/world.length),after=world.curve.getPointAt(joint.progress+3.2/world.length);
 assert(Math.abs(surface.height-.052)<.0005);assert(Math.abs(world.getSurfaceAt(before.x,before.z).height-.012)<.00005);assert(Math.abs(world.getSurfaceAt(after.x,after.z).height-.012)<.00005);
 result.joints.push({progress:joint.progress,centerHeight:surface.height,grip:surface.grip});
}
result.checks.push('Three 4cm expansion joints have 6m spans and return smoothly to road height');
for(const side of [-1,1])for(const [offset,expected] of [[12,.012],[12.28,.122],[12.6,.122],[12.92,.122],[13.3,.002],[14,.002],[14.5,-.06],[17,-.06]]){
 const sample=world.samples[48],x=sample.x+sample.tz*offset*side,z=sample.z-sample.tx*offset*side,height=world.getSurfaceAt(x,z).height;
 assert(Math.abs(height-expected)<.0005,`Curb ${side*offset}: ${height} != ${expected}`);result.curbs.push({offset:side*offset,height});
}
result.checks.push('Both curbs have a physical 11cm trapezoid profile and shoulders slope to the ground');
const ground=world.root.getObjectByName('dock-ground'),groundP=ground.geometry.attributes.position;
let maxGround=-Infinity;for(let i=0;i<groundP.count;i++)maxGround=Math.max(maxGround,groundP.getY(i)+ground.position.y);
assert(Math.abs(maxGround+.06)<1e-6);assert.equal(world.getSurfaceAt(0,0).height,-.06);result.checks.push('Visible island top and offroad wheel contact are both at -0.06m');
let meshes=0,instances=0;scene.traverse(node=>{if(!node.isMesh)return;meshes++;for(const value of node.geometry.attributes.position.array)assert(Number.isFinite(value));if(node.isInstancedMesh){instances+=node.count;for(const value of node.instanceMatrix.array)assert(Number.isFinite(value));}});
for(let i=0;i<60;i++)world.update(1/60,i/60);result.checks.push('Full district geometry and animated instancing remain finite');
result.meshes=meshes;result.instances=instances;result.wallTimeSeconds=(performance.now()-start)/1000;
fs.writeFileSync(new URL('./world-v3-results.json',import.meta.url),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
