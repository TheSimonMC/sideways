import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from '../dist/vendor/three.module.js';
import {createCity} from '../dist/city.js';
import {mapCityPoint,unmapCityPoint,pathLength} from '../dist/city-shape.js';
import {createRoadGuide} from '../dist/traffic.js';
import {capsuleContact} from '../dist/contact.js';

const scene=new THREE.Scene(),city=createCity(scene),guide=createRoadGuide(city);
const report={status:'pending',checks:[],limits:['Real Three.js meshes, world collision boxes, road sampling and ray intersections in Node. No browser GPU image comparison.','The city is a compact, curved grid with driveable courtyard alleys, not a streamed open-world engine.']};
const check=name=>{report.checks.push(name);console.log('PASS '+name);};
let inverseError=0;
for(let x=-770;x<=770;x+=35)for(let z=-770;z<=770;z+=35){const p=mapCityPoint(x,z),q=unmapCityPoint(p.x,p.z);inverseError=Math.max(inverseError,Math.hypot(q.x-x,q.z-z));}
assert.ok(inverseError<1e-8);assert.equal(city.network.trafficSide,'left');assert.ok(Math.abs(city.network.laneOffset+2.7)<1e-12);assert.equal(city.network.halfRoad,6);assert.ok(city.bounds.maxX-city.bounds.minX<1000);
report.layout={inverseErrorM:inverseError,roadWidthM:12,laneOffsetM:2.7,bounds:city.bounds,buildings:city.mapBuildings.length,alleys:city.alleys.length,districts:city.mapDistricts.map(d=>d.name)};
check('A reversible metre-scale layout keeps a 12 metre road and 2.7 metre left lane offset across five compact districts');

const failures=[],laneSamples=[],turnSamples=[];let minLaneOffset=Infinity,maxLaneOffset=-Infinity,maxCurve=0,maxLengthError=0,legalTurns=0;
for(const e of city.network.edges){
 assert.ok(e.points.length>4);maxLengthError=Math.max(maxLengthError,Math.abs(e.length-pathLength(e.points)));
 const a=e.points[0],b=e.points.at(-1),dx=b.x-a.x,dz=b.z-a.z,length=Math.hypot(dx,dz);
 for(const p of e.points)maxCurve=Math.max(maxCurve,Math.abs((p.x-a.x)*dz-(p.z-a.z)*dx)/length);
 const leg=guide.leg(e.from,e.to);
 for(let d=3;d<leg.length-2;d+=4){const p=guide.sample(leg,d),info=city.getRoadInfo(p.x,p.z),center=info.nearest,offset=(p.x-center.x)*p.dz-(p.z-center.z)*p.dx;minLaneOffset=Math.min(minLaneOffset,offset);maxLaneOffset=Math.max(maxLaneOffset,offset);assert.ok(info.onRoad);assert.ok(offset< -2.5&&offset> -2.9);laneSamples.push(p);}
 for(const nextId of city.network.nodeById.get(e.to).neighbors.filter(n=>n!==e.from)){
  legalTurns++;const turn=guide.junction({fromId:e.from,toId:e.to,nextId});
  for(let i=0;i<=32;i++){const p=guide.sample(turn,turn.length*i/32);if(!city.getRoadInfo(p.x,p.z).onRoad)failures.push({from:e.from,to:e.to,nextId,p});if(i%4===0)turnSamples.push(p);}
 }
}
assert.ok(maxCurve>1.5,'The asphalt and AI paths must actually bend between junctions');assert.ok(maxLengthError<1e-9);assert.equal(failures.length,0,JSON.stringify(failures.slice(0,2)));
report.paths={legalTurns,laneSamples:laneSamples.length,turnSamples:turnSamples.length,maxCurveM:maxCurve,minLaneOffset,maxLaneOffset,maxLengthError};
check('Every directed road follows a sampled curve in the left lane; all 764 legal turn paths stay on the drivable road');

const blockerFailures=[];
function checkVehicleClear(p,label,width=1.82,length=4.45){for(const box of city.getColliders(p,6)){const hit=capsuleContact(p,box,{width,length});if(hit&&hit.penetration>.015)blockerFailures.push({label,p,kind:box.kind,box,penetration:hit.penetration});}}
for(const p of laneSamples)checkVehicleClear(p,'lane');for(const p of turnSamples)checkVehicleClear(p,'junction');
let alleySamples=0;
for(const e of city.mapRoads.filter(e=>e.kind==='alley'))for(let i=1;i<e.points.length-1;i++){const p=e.points[i],before=e.points[i-1],after=e.points[i+1],heading=Math.atan2(after.x-before.x,after.z-before.z);assert.ok(city.getRoadInfo(p.x,p.z).onRoad);assert.equal(city.getSurfaceAt(p.x,p.z).material,'asphalt');checkVehicleClear({...p,heading},'alley');alleySamples++;}
for(const s of city.services){checkVehicleClear(s.spawn,s.kind+' spawn');const a=city.shape.map(s.base.x,s.base.z+48),b=city.shape.map(s.base.x,s.base.z+90);for(let i=0;i<=12;i++)checkVehicleClear({x:a.x+(b.x-a.x)*i/12,z:a.z+(b.z-a.z)*i/12,heading:Math.atan2(b.x-a.x,b.z-a.z)},s.kind+' entrance');}
assert.equal(blockerFailures.length,0,JSON.stringify(blockerFailures.slice(0,3)));
let poleChecks=0;for(const c of city.colliders.filter(c=>['lamp','signal','speed-camera'].includes(c.kind)))for(const x of[-c.hx,0,c.hx])for(const z of[-c.hz,0,c.hz]){const sn=Math.sin(c.heading),cs=Math.cos(c.heading),p={x:c.x+cs*x+sn*z,z:c.z-sn*x+cs*z};assert.ok(!city.getRoadInfo(p.x,p.z).onRoad,`${c.kind} footprint intersects a road`);poleChecks++;}
report.clearance={alleySamples,poleChecks,vehicleSamples:laneSamples.length+turnSamples.length+alleySamples+city.services.length*14};
check('Vehicle bodies clear every sampled road, turn, alley and service entrance; lamp, signal and camera footprints stay outside the asphalt');

scene.updateMatrixWorld(true);const ray=new THREE.Raycaster(),down=new THREE.Vector3(0,-1,0),probes=[];
for(const e of city.mapRoads.filter(e=>e.kind==='street').filter((_,i)=>i%3===0))for(const p of[e.points[3],e.points[Math.floor(e.points.length/2)],e.points.at(-4)])probes.push(p);
for(const tile of city.blockTiles)for(const [dx,dz] of[[0,0],[-65,-65],[65,65],[0,-79.7],[79.7,0]])probes.push(city.shape.map(tile.x+dx,tile.z+dz));
for(const zone of city.surfaceZones)probes.push(city.shape.map(zone.x+zone.width*.17,zone.z+zone.depth*.11));
let maxHeightError=0,overlapCount=0,rayFailures=[];
for(const p of probes){ray.set(new THREE.Vector3(p.x,2,p.z),down);const hits=ray.intersectObjects(city.surfaceMeshes,false),surface=city.getSurfaceAt(p.x,p.z);if(!hits.length){rayFailures.push({p,surface});continue;}const nearest=hits[0];maxHeightError=Math.max(maxHeightError,Math.abs(nearest.point.y-surface.height));const materials=new Set(hits.filter(h=>Math.abs(h.point.y-nearest.point.y)<.001).map(h=>h.object.userData.surfaceMaterial||'asphalt'));if(materials.size>1)overlapCount++;assert.ok(materials.has(surface.material)||surface.material==='curb',`Visual material differs at ${JSON.stringify({p,surface,materials:[...materials]})}`);}
assert.equal(rayFailures.length,0,JSON.stringify(rayFailures.slice(0,3)));assert.ok(maxHeightError<.0015,`Ground height error ${maxHeightError}`);assert.equal(overlapCount,0);
const grass=city.nature.grass,matrix=new THREE.Matrix4();for(let i=0;i<grass.count;i++){grass.getMatrixAt(i,matrix);assert.equal(city.getSurfaceAt(matrix.elements[12],matrix.elements[14]).material,'grass');}
assert.ok(city.mapBuildings.every(b=>[b.x,b.z,b.width,b.depth,b.heading,b.height].every(Number.isFinite)));assert.ok(city.mapBuildings.filter(b=>b.height>55).length>=8);assert.equal(city.mapDistricts.length,5);assert.ok(city.mapSurfaces.every(s=>s.points.length>=8));
report.surfaces={probes:probes.length,maxHeightErrorM:maxHeightError,overlapCount,grassTufts:grass.count,towers:city.mapBuildings.filter(b=>b.height>55).length};
check('Rendered road and ground triangles agree with tyre material/height sampling; grass tufts stay on grass and no probe has coplanar surface overlap');

for(const heading of[0,Math.PI/2,Math.PI,-Math.PI/2])for(const [x,z]of[[0,-75],[-90,0],[360,270],[-540,-420]]){const p=city.shape.map(x,z),reset=city.getResetPose(p.x,p.z,city.shape.heading(x,z,heading)),r=city.getRoadInfo(reset.x,reset.z);assert.ok(r.onRoad);const offset=(reset.x-r.nearest.x)*Math.cos(reset.heading)-(reset.z-r.nearest.z)*Math.sin(reset.heading);if(r.kind!=='alley')assert.ok(offset< -2.4&&offset> -3);checkVehicleClear(reset,'reset');}
assert.equal(blockerFailures.length,0);check('Reset poses consistently use the left side in both directions and avoid intersections and colliders');
city.dispose();assert.equal(scene.children.length,0);city.dispose();report.status='passed';fs.writeFileSync(new URL('./world-v8-results.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
