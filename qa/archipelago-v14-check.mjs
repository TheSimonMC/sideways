import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from '../dist/vendor/three.module.js';
import {createCity} from '../dist/region.js';
import {createRoadGuide} from '../dist/traffic.js';
import {findRoadRoute} from '../dist/navigation-map.js';
import {capsuleContact} from '../dist/contact.js';
const start=performance.now(),scene=new THREE.Scene(),city=createCity(scene),report={version:14,checks:[]};
const check=(name,fn)=>{fn();report.checks.push(name);console.log('PASS '+name);};
check('County is connected, contains three directed roundabouts and distinct road classes',()=>{
 assert.ok(city.region.areaKm2>100);assert.equal(city.region.roundabouts.length,3);assert.equal(city.region.layout.islands.length,4);assert.equal(city.region.architecture.bridges,5);assert.ok(city.region.architecture.buildings>2000);assert.ok(city.region.roads.some(r=>r.kind==='highway'));assert.ok(city.region.roads.some(r=>r.kind==='hills'));assert.ok(city.region.roads.some(r=>r.kind==='country'));
 const visit=new Set(),queue=[city.network.nodes[0].id];while(queue.length){const id=queue.shift();if(visit.has(id))continue;visit.add(id);queue.push(...city.network.nodeById.get(id).neighbors);}assert.equal(visit.size,city.network.nodes.length);
 for(const circle of city.region.roundabouts)for(let i=0;i<8;i++){const a=circle.ports[i],b=circle.ports[(i+1)%8];assert.ok(a.neighbors.includes(b.id));assert.ok(!b.neighbors.includes(a.id));}
});
let maxGrade=0,minHeight=Infinity,maxHeight=-Infinity;
check('Every authored road has moderate grades, continuous elevations and clear driving lanes',()=>{
 for(const road of city.region.roads)for(let i=1;i<road.points.length;i++){const a=road.points[i-1],b=road.points[i],l=Math.hypot(b.x-a.x,b.z-a.z);maxGrade=Math.max(maxGrade,Math.abs(b.y-a.y)/l);minHeight=Math.min(minHeight,a.y);maxHeight=Math.max(maxHeight,a.y);assert.ok(l>0);assert.ok(a.y>-2.5,road.name+' submerged '+a.y);if(i%4)continue;
  for(const side of[-Math.min(4.5,road.width*.24),0,Math.min(4.5,road.width*.24)]){const x=(a.x+b.x)/2+(b.z-a.z)/l*side,z=(a.z+b.z)/2-(b.x-a.x)/l*side;assert.ok(city.getRoadInfo(x,z).onRoad,road.name);assert.ok(Math.abs(city.getSurfaceAt(x,z).height-(road.bridge?(a.y+b.y)/2:city.region.height(x,z)))<.15,road.name+' height');assert.ok(!city.getColliders({x,z},6).some(c=>capsuleContact({x,z,heading:Math.atan2(b.x-a.x,b.z-a.z)},c,{width:2,length:4.5})),road.name+' obstacle');}
 }
 assert.ok(maxGrade<.20);assert.ok(maxHeight-minHeight>150);
});
check('Rendered road surface is above terrain at wheel positions, including switchbacks',()=>{
 city.root.updateMatrixWorld(true);const ray=new THREE.Raycaster(new THREE.Vector3(),new THREE.Vector3(0,-1,0));let samples=0,maxError=0;
 for(const road of city.region.roads)for(let i=4;i<road.points.length-4;i+=15){const a=road.points[i],b=road.points[i+1],l=Math.hypot(b.x-a.x,b.z-a.z);for(const side of[-Math.min(4.5,road.width*.24),Math.min(4.5,road.width*.24)]){const x=(a.x+b.x)/2+(b.z-a.z)/l*side,z=(a.z+b.z)/2-(b.x-a.x)/l*side;if(Math.abs(x)<768&&Math.abs(z)<768)continue;ray.set(new THREE.Vector3(x,500,z),new THREE.Vector3(0,-1,0));const hit=ray.intersectObjects(city.region.surfaceMeshes,false)[0];assert.ok(hit,road.name);assert.equal(hit.object.name,'county-road-ribbons',road.name+' terrain protrudes');const error=Math.abs(hit.point.y-city.getSurfaceAt(x,z).height);maxError=Math.max(maxError,error);assert.ok(error<.001,road.name+' visual/physics mismatch '+error);samples++;}}
 report.renderedRoadSamples=samples;report.maximumVisualHeightError=maxError;
});
check('Service destinations and hill lookouts are reachable through the road graph',()=>{
 for(const service of city.services){const r=findRoadRoute(city,city.spawn,service.spawn);assert.ok(r.points.length>1,service.name);assert.ok(!r.unrouted,service.name);assert.ok(!city.getColliders(service.spawn,8).some(c=>capsuleContact(service.spawn,c,{width:2,length:4.5})),service.name);}
 const target=city.landmarks.find(p=>p.name==='SKYLINE OBSERVATORY');assert.ok(findRoadRoute(city,city.spawn,target).points.length>2);
});
check('Civilian/police lane guides build for every new directed edge and turn',()=>{
 const guide=createRoadGuide(city);for(const edge of city.network.edges){const leg=guide.leg(edge.from,edge.to);assert.ok(leg.length>0);for(const v of leg.points)assert.ok(Number.isFinite(v.x)&&Number.isFinite(v.z));if(edge.from>=81||edge.to>=81)for(const nextId of city.network.nodeById.get(edge.to).neighbors.filter(n=>n!==edge.from))for(const p of guide.junction({fromId:edge.from,toId:edge.to,nextId}).points)assert.ok(city.getRoadInfo(p.x,p.z).onRoad);}
});
check('Every region reset returns to asphalt and world disposal is complete',()=>{
 for(const [x,z]of[[-2200,-2500],[2100,1100],[0,-2600],[-1400,1300],[1000,-1900]]){const p=city.getResetPose(x,z,.4);assert.ok(city.getRoadInfo(p.x,p.z).onRoad);assert.equal(city.getSurfaceAt(p.x,p.z).material,'asphalt');}city.dispose();assert.equal(scene.children.length,0);
});
Object.assign(report,{status:'passed',areaKm2:city.region.areaKm2,landKm2:city.region.landKm2,architecture:city.region.architecture,nodes:city.network.nodes.length,roadKm:city.length/1000,maxGrade,minHeight,maxHeight,elapsedMs:performance.now()-start,limits:['Geometry, routing and sampled wheel positions; no claim of driving every metre with physical hardware.']});fs.writeFileSync(new URL('archipelago-v14-results.json',import.meta.url),JSON.stringify(report,null,2));
