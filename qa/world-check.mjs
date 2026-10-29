import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from '../dist/vendor/three.module.js';
import {createWorld} from '../dist/world.js';

// Geometry-only QA: canvas text drawing is immaterial to the track and collision checks.
globalThis.document = {createElement(tag) {
  assert.equal(tag, 'canvas');
  const ctx = {fillRect(){},beginPath(){},arc(){},fill(){},fillText(){}};
  return {width:0,height:0,getContext(type){assert.equal(type,'2d');return ctx;}};
}};
const scene = new THREE.Scene();
const world = createWorld(scene);
assert.ok(world.length > 1000 && world.length < 1400, `Unexpected circuit length ${world.length}`);
assert.equal(world.samples.length,480);
assert.equal(world.checkpoints.length,8);
assert.equal(world.mapPoints.length,120);
assert.ok(Number.isFinite(world.spawn.x + world.spawn.z + world.spawn.heading));
const spawnRoad=world.getRoadInfo(world.spawn.x,world.spawn.z);
assert.ok(spawnRoad.distance < .03);
assert.ok(Math.abs(spawnRoad.progress-.985) < .001);
assert.equal(spawnRoad.grip,1);
let minColliderDistance=Infinity,minColliderIndex=-1,minColliderProgress=-1;
let maxProgressError=0,maxCenterError=0,maxTangentAngle=0,minNormalY=1;
const distanceToBox=(x,z,b)=>Math.hypot(Math.max(Math.abs(x-b.x)-b.hx,0),Math.max(Math.abs(z-b.z)-b.hz,0));
let signedArea=0;
for(let i=0;i<4800;i++) {
  const progress=i/4800,p=world.curve.getPointAt(progress),t=world.curve.getTangentAt(progress),road=world.getRoadInfo(p.x,p.z);
  const error=Math.min(Math.abs(road.progress-progress),1-Math.abs(road.progress-progress));
  maxProgressError=Math.max(maxProgressError,error);maxCenterError=Math.max(maxCenterError,road.distance);
  maxTangentAngle=Math.max(maxTangentAngle,Math.acos(Math.min(1,Math.max(-1,t.x*road.tangent.x+t.z*road.tangent.z))));
  assert.ok(error<.001,`Progress mismatch at ${progress}: ${road.progress}`);
  assert.ok(road.distance<.12,`Centerline mismatch at ${progress}: ${road.distance}`);
  assert.ok(road.onRoad && road.grip === 1);
  for(let j=0;j<world.colliders.length;j++) {
    const d=distanceToBox(p.x,p.z,world.colliders[j]);
    if(d<minColliderDistance){minColliderDistance=d;minColliderIndex=j;minColliderProgress=progress;}
    assert.ok(d>13.18,`Collider ${j} encroaches road plus car radius at ${progress}: ${d}`);
  }
  const next=world.curve.getPointAt((progress+1/4800)%1);signedArea+=p.x*next.z-next.x*p.z;
}
for(let i=0;i<8;i++) {
  const cp=world.checkpoints[i],p=world.curve.getPointAt(i/8),t=world.curve.getTangentAt(i/8);
  assert.ok(Math.hypot(cp.x-p.x,cp.z-p.z)<.001);
  assert.ok(Math.abs(Math.atan2(Math.sin(cp.heading-Math.atan2(t.x,t.z)),Math.cos(cp.heading-Math.atan2(t.x,t.z))))<.0001);
  // A local +X checkpoint arch is perpendicular to the road tangent after yaw.
  assert.ok(Math.abs(Math.cos(cp.heading)*t.x-Math.sin(cp.heading)*t.z)<.0001);
}
const ribbons=world.root.children.filter(c=>c.isMesh && c.geometry.getAttribute('position')?.count===962);
assert.ok(ribbons.length>=9);
for(const ribbon of ribbons) {
  const normal=ribbon.geometry.getAttribute('normal');
  for(let i=0;i<normal.count;i++){minNormalY=Math.min(minNormalY,normal.getY(i));assert.ok(normal.getY(i)>.99,'Road normal points downward');}
}
let meshes=0,instances=0,vertices=0;
scene.traverse(object=>{
 if(!object.isMesh)return;meshes++;
 const p=object.geometry.getAttribute('position');
 for(const value of p.array)assert.ok(Number.isFinite(value),'Non-finite geometry vertex');
 if(object.isInstancedMesh){instances+=object.count;for(const value of object.instanceMatrix.array)assert.ok(Number.isFinite(value),'Non-finite instance matrix');}
 vertices+=p.count*(object.isInstancedMesh?object.count:1);
});
for(let i=0;i<120;i++)world.update(1/60,i/60);
const summary={passed:true,length:world.length,spawn:world.spawn,spawnProgress:spawnRoad.progress,checkpoints:world.checkpoints.length,colliders:world.colliders.length,minColliderDistance,minColliderIndex,minColliderProgress,maxProgressError,maxCenterError,maxTangentAngleDegrees:maxTangentAngle*180/Math.PI,roadRibbons:ribbons.length,minNormalY,signedArea:signedArea/2,directionOnNorthUpMap:signedArea>0?'clockwise':'counterclockwise',meshes,instances,vertices,landBounds:world.bounds};
fs.writeFileSync(new URL('./world-results.json',import.meta.url),JSON.stringify(summary,null,2));
console.log(JSON.stringify(summary,null,2));
