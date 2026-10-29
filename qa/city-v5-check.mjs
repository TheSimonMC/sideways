import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from '../dist/vendor/three.module.js';
import {createCity} from '../dist/city.js';
import {createTraffic} from '../dist/traffic.js';
import {capsuleContact} from '../dist/contact.js';
globalThis.document={createElement(){return{width:0,height:0,getContext(){return{fillRect(){},fillText(){}}}}}};
const scene=new THREE.Scene(),city=createCity(scene),traffic=createTraffic(scene,city),result={status:'pending',checks:[],signals:0,turnPaths:0};
const check=name=>{result.checks.push(name);console.log('PASS',name);};
assert.equal(city.network.nodes.length,25);assert.equal(city.network.edges.length,80);assert.equal(city.mapRoads.length,40);assert.equal(city.length,4800);
const visited=new Set(),visit=id=>{if(visited.has(id))return;visited.add(id);for(const next of city.network.nodeById.get(id).neighbors)visit(next);};visit(0);assert.equal(visited.size,25);
assert.ok(city.getRoadInfo(city.spawn.x,city.spawn.z).onRoad);assert.equal(city.getSurfaceAt(city.spawn.x,city.spawn.z).height,.012);
check('Connected 25-intersection graph, 40 two-way streets and safe player spawn');
for(const node of city.network.nodes)for(let t=0;t<72;t+=.25){const x=city.getSignal(node.id,'x',t),z=city.getSignal(node.id,'z',t);assert.ok(!(x==='green'&&z==='green'));if(x!=='red')assert.equal(z,'red');if(z!=='red')assert.equal(x,'red');result.signals++;}
assert.equal(city.signalHeads.length,80);assert.equal(city.signalLamps.count,240);
city.setTrafficTime(20);city.update(0,20);const color=new THREE.Color();
for(let i=0;i<city.signalHeads.length;i++){const h=city.signalHeads[i],signal=city.getSignal(h.nodeId,h.axis),on=signal==='red'?0:signal==='amber'?1:2;for(let j=0;j<3;j++){city.signalLamps.getColorAt(i*3+j,color);const expected=new THREE.Color(j===on?[0xff576b,0xffc24b,0x81ffc3][j]:0x26343a);assert.ok(color.distanceTo?color.distanceTo(expected)<1e-5:Math.abs(color.r-expected.r)+Math.abs(color.g-expected.g)+Math.abs(color.b-expected.b)<1e-5);}}
check('Conflicting axes never receive green; all 80 visible heads match the same signal state');
const sidewalk=city.root.getObjectByName('city-sidewalks'),p=sidewalk.geometry.attributes.position,idx=sidewalk.geometry.index.array;let mismatch=0;
for(let k=0;k<idx.length;k+=3){const ids=[idx[k],idx[k+1],idx[k+2]],x=ids.reduce((s,i)=>s+p.getX(i),0)/3,z=ids.reduce((s,i)=>s+p.getZ(i),0)/3,y=ids.reduce((s,i)=>s+p.getY(i),0)/3;mismatch=Math.max(mismatch,Math.abs(city.getSurfaceAt(x,z).height-y));}
assert.ok(mismatch<.00001,'Visible curb corners and contact height must agree');
for(const zone of city.surfaceZones){if(zone.material==='concrete')continue;const x=zone.x+zone.width*.25,z=zone.z+zone.depth*.25;assert.equal(city.getSurfaceAt(x,z).material,zone.material);}
const park=city.landmarks.find(l=>l.kind==='park');assert.equal(city.getSurfaceAt(park.x,park.z+18).material,'concrete');
for(const x of [-270,-160,-40,30,180,270])for(const z of [-270,-110,0,60,210,270]){const reset=city.getResetPose(x,z,.8);assert.ok(city.getRoadInfo(reset.x,reset.z).onRoad);assert.ok(!city.colliders.some(box=>capsuleContact({...reset},{...box},{width:2,length:4.5})));}
result.maxSurfaceHeightMismatch=mismatch;check('Rendered sidewalks/curbs and ground query match; grass, gravel and concrete paths agree; reset poses avoid static geometry');
// Verify every possible legal turn, not only the initially chosen routes.
const car=traffic.states[0];
for(const edge of city.network.edges){traffic.place(car,edge.from,edge.to,0,0);const nexts=city.network.nodeById.get(edge.to).neighbors.filter(id=>id!==edge.from);for(const next of nexts){car.nextId=next;const path=traffic.junctionFor(car),out=traffic.laneLeg(edge.to,next);assert.ok(Math.hypot(path.points.at(-1).x-out.start.x,path.points.at(-1).z-out.start.z)<1e-9);for(const point of path.points){assert.ok(city.getRoadInfo(point.x,point.z).onRoad,'Turn path leaves the road');assert.ok(!city.colliders.some(box=>Math.abs(point.x-box.x)<box.hx+.95&&Math.abs(point.z-box.z)<box.hz+.95),'Turn meets a static object');}result.turnPaths++;}}
check('All legal straight and turning connections stay on roads and join outgoing lanes continuously');
let meshes=0,instances=0;scene.traverse(o=>{if(!o.isMesh)return;meshes++;for(const value of o.geometry.attributes.position.array)assert.ok(Number.isFinite(value));if(o.isInstancedMesh){instances+=o.count;for(const value of o.instanceMatrix.array)assert.ok(Number.isFinite(value));}});
assert.ok(meshes<90);assert.ok(city.colliders.length>80);result.meshes=meshes;result.instances=instances;result.colliders=city.colliders.length;check('Full city and civilian model geometry is finite and instanced within a bounded draw-call count');
result.status='passed';fs.writeFileSync(new URL('./city-v5-results.json',import.meta.url),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
