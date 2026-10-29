import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from '../dist/vendor/three.module.js';
import {createCity} from '../dist/region.js';
import {createTraffic,createRoadGuide,setAgentPose} from '../dist/traffic.js';
import {createPolice} from '../dist/police.js';
const city=createCity(new THREE.Scene()),traffic=createTraffic(null,city,{count:8}),police=createPolice(null,city,traffic),guide=createRoadGuide(city),checks=[];
const edges=city.network.edges.filter(e=>e.kind==='hills');
for(const [i,car] of traffic.states.entries()){const e=edges[i%edges.length];car.fromId=e.from;car.toId=e.to;car.path=guide.leg(e.from,e.to);car.distance=100;car.nextId=guide.nextNode(car);setAgentPose(car,guide.sample(car.path,100),8,city);}
const initial=traffic.states.map(c=>({x:c.x,z:c.z})),player={x:0,z:-2680,heading:0,speed:0,vx:0,vz:0};let maxStep=0;
for(let t=0;t<20*120;t++){const before=traffic.states.map(c=>({x:c.x,z:c.z}));traffic.update(1/120,player);police.update(1/120,player);for(const [i,c]of traffic.states.entries()){maxStep=Math.max(maxStep,Math.hypot(c.x-before[i].x,c.z-before[i].z));assert.ok([c.x,c.y,c.z,c.heading].every(Number.isFinite));}}
assert.ok(maxStep<.5);assert.ok(traffic.states.every((c,i)=>Math.hypot(c.x-initial[i].x,c.z-initial[i].z)>20));checks.push('Eight civilian drivers advance continuously on hill routes for 20 simulated seconds');
traffic.render(1);const wheels=traffic.root.getObjectByName('traffic-wheels'),m=new THREE.Matrix4(),v=new THREE.Vector3();for(let i=0;i<wheels.count;i++){wheels.getMatrixAt(i,m);v.setFromMatrixPosition(m);assert.ok(Math.abs(v.y-city.getSurfaceAt(v.x,v.z).height-.31)<.002);}checks.push('NPC wheel rendering follows the road height at every wheel');
const snapshot=police.captureSnapshot();snapshot.searchCenter={x:0,z:-2680};snapshot.lastPlayer=player;const replica=createPolice(null,city,traffic);assert.equal(replica.applySnapshot(snapshot),true);const invalid=structuredClone(snapshot);invalid.searchCenter.z=-99999;assert.equal(replica.applySnapshot(invalid),false);checks.push('Police snapshots accept hill search/player coordinates and reject out-of-world values');
replica.dispose();police.dispose();traffic.dispose();city.dispose();const report={version:14,status:'passed',checks,maxStepM:maxStep};fs.writeFileSync(new URL('county-agents-v14-results.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
