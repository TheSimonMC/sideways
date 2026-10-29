import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import * as THREE from '../dist/vendor/three.module.js';
import {createCity} from '../dist/city.js';
import {createTraffic,createRoadGuide,setAgentPose} from '../dist/traffic.js';
import {createPolice} from '../dist/police.js';
import {resolveVehicleContacts} from '../dist/contact.js';

const scene=new THREE.Scene(),city=createCity(scene),guide=createRoadGuide(city),dt=1/120;
const edge=[...city.network.edges].sort((a,b)=>guide.leg(b.from,b.to).length-guide.leg(a.from,a.to).length)[0],path=guide.leg(edge.from,edge.to);
const report={version:11,status:'pending',checks:[],fixtures:{},limits:['Current downtown road geometry, planar vehicles, line of sight and recorded event descriptors in Node. No browser GPU image or audible radio/siren test.','Search knowledge comes from sightings and camera reports; the UI still knows the player position to draw nearby police.']};
const files=['dist/police.js','dist/traffic.js'],hashes=()=>Object.fromEntries(files.map(p=>[p,createHash('sha256').update(fs.readFileSync(new URL('../'+p,import.meta.url))).digest('hex')])),source=hashes();
function check(name,fn){report.fixtures[name]=fn();report.checks.push(name);console.log('PASS '+name);}
function systems(options={}){const traffic=createTraffic(null,city,{count:options.traffic??0}),police=createPolice(null,city,traffic,{count:options.count??3,dayCount:options.dayCount??3,nightCount:options.nightCount??3});return{traffic,police,dispose(){police.dispose();traffic.dispose();}};}
function place(car,distance,speed=0){car.fromId=edge.from;car.toId=edge.to;car.path=path;car.distance=distance;car.nextId=guide.nextNode(car);car.routeTimer=0;car.duty=car.role='patrol';car.active=true;setAgentPose(car,guide.sample(path,distance),speed,city);}
function playerAt(distance,speed=0){const p=guide.sample(path,distance);return{...p,speed,vx:p.dx*speed,vz:p.dz*speed};}
function run(s,seconds,player,context={},inspect){for(let i=0;i<Math.ceil(seconds/dt);i++){const p=typeof player==='function'?player(i*dt):player;s.traffic.update(dt,p);s.police.update(dt,p,context);inspect?.(i);}}
const hiddenA={x:1600,z:1500,vx:0,vz:0,speed:0,heading:0},hiddenB={x:-1600,z:-1500,vx:0,vz:0,speed:0,heading:0};

check('Observed normal driving stays legal; sustained speeding triggers pursuit after actual sighting time on the current road geometry.',()=>{
 const s=systems({count:1,dayCount:1,nightCount:1});place(s.police.states[0],5,8);run(s,2,time=>playerAt(25+time*12,12));assert.equal(s.police.getState().phase,'patrol');
 s.police.reset();place(s.police.states[0],5,12);let detection=null;run(s,2,time=>playerAt(24+time*30,30),{},i=>{if(detection===null&&s.police.getState().phase==='chase')detection=i*dt;});assert.ok(detection>=1&&detection<1.5,`detection ${detection}`);assert.equal(s.police.getState().heat,1);assert.ok(s.police.consumeEvents().some(e=>e.type==='pursuit'));const result={pathLength:path.length,detectionSeconds:detection};s.dispose();return result;
});

check('A moving sighting assigns a stable lead officer and distinct road junctions to intercept and containment units.',()=>{
 const s=systems();s.police.states.forEach((c,i)=>place(c,5+i*10,7));const suspect=playerAt(43,32);s.police.reportOffense('Speeding');s.police.update(dt,suspect);const state=s.police.getState(),roles=state.officers.map(c=>c.role),targets=state.officers.filter(c=>c.role!=='pursuit').map(c=>c.interceptTarget);assert.equal(state.phase,'chase');assert.ok(roles.includes('pursuit')&&roles.includes('intercept')&&roles.includes('contain'));assert.ok(targets.every(id=>city.network.nodeById.has(id)));assert.equal(new Set(targets).size,targets.length);assert.ok(state.interceptsAssigned>=2);const lead=state.officers.find(c=>c.role==='pursuit').id;for(let i=0;i<12;i++)s.police.update(dt,playerAt(43+i*32*dt,32));assert.equal(s.police.getState().officers.find(c=>c.role==='pursuit').id,lead);const result={lead,roles,interceptNodes:targets};s.dispose();return result;
});

check('Separated search units cover distinct nodes and take identical routes for different hidden player locations.',()=>{
 const a=systems(),b=systems(),suspect=playerAt(43,0);for(const s of[a,b]){s.police.states.forEach((c,i)=>place(c,5+i*11,0));s.police.reportOffense('Collision');s.police.update(dt,suspect);assert.equal(s.police.getState().phase,'chase');}
 let maxDifference=0;for(let i=0;i<120*6;i++){for(const[s,p]of[[a,hiddenA],[b,hiddenB]]){s.traffic.update(dt,p);s.police.update(dt,p);}for(let j=0;j<3;j++)maxDifference=Math.max(maxDifference,Math.hypot(a.police.states[j].x-b.police.states[j].x,a.police.states[j].z-b.police.states[j].z));}
 const state=a.police.getState(),assigned=state.officers.filter(c=>c.active).map(c=>c.searchTarget);assert.equal(state.phase,'search');assert.deepEqual(state.searchCenter,b.police.getState().searchCenter);assert.ok(assigned.every(Number.isInteger));assert.equal(new Set(assigned).size,assigned.length);assert.ok(state.searchSectors.length>=assigned.length);assert.equal(maxDifference,0);const calls=[];run(a,17,hiddenA,{},()=>calls.push(...a.police.consumeEvents()));assert.ok(a.police.diagnostics().sectorsChecked>0);assert.ok(calls.some(e=>e.type==='radio'&&['sector','clear'].includes(e.code)));const result={assignedNodes:assigned,plannedNodes:state.searchSectors.length,maxHiddenLocationTrajectoryDifference:maxDifference,sectorsChecked:a.police.diagnostics().sectorsChecked,radioCodes:[...new Set(calls.filter(e=>e.type==='radio').map(e=>e.code))]};a.dispose();b.dispose();return result;
});

check('An unsuccessful search emits one escape and clears heat; visible reacquisition interrupts search.',()=>{
 const s=systems({count:1,dayCount:1,nightCount:1});place(s.police.states[0],5,0);s.police.reportOffense('Collision');s.police.update(dt,playerAt(30));run(s,6,hiddenA);assert.equal(s.police.getState().phase,'search');const cop=s.police.states[0],near={x:cop.x+Math.sin(cop.heading)*12,z:cop.z+Math.cos(cop.heading)*12,vx:0,vz:0,speed:0,heading:cop.heading};s.police.update(dt,near);assert.equal(s.police.getState().phase,'chase');assert.ok(s.police.consumeEvents().some(e=>e.type==='pursuit'&&e.resumed));run(s,24,hiddenA);const events=s.police.consumeEvents();assert.equal(events.filter(e=>e.type==='escaped').length,1);assert.equal(s.police.getState().heat,0);run(s,5,hiddenA);assert.equal(s.police.getState().phase,'patrol');s.dispose();return{escapeEvents:1,reacquisition:true};
});

check('Arrest requires three stopped seconds beside a slow officer and is interrupted by movement.',()=>{
 const s=systems({count:1,dayCount:1,nightCount:1}),suspect=playerAt(30);place(s.police.states[0],23);s.police.reportOffense('Collision');run(s,2,suspect);assert.equal(s.police.getState().phase,'chase');assert.ok(s.police.getState().arrestProgress>.55);run(s,.7,{...suspect,speed:3});assert.ok(s.police.getState().arrestProgress<.4);run(s,3.2,suspect);assert.equal(s.police.getState().phase,'arrested');assert.equal(s.police.getState().arrestProgress,1);const events=s.police.consumeEvents().filter(e=>e.type==='arrest');assert.equal(events.length,1);assert.deepEqual(events[0].station,city.services.find(x=>x.kind==='police').spawn);s.dispose();return{stopSeconds:3,arrests:1,movementBreaksProgress:true};
});

check('Night patrols physically deploy from the station and expose varied, rate-limited dispatch and engine metadata.',()=>{
 const s=systems({count:6,dayCount:3,nightCount:6});s.police.setNight(1);const prior=s.police.states.map(c=>({x:c.x,z:c.z}));let maxStep=0;run(s,14,hiddenA,{night:1},()=>{for(const c of s.police.states){assert.ok([c.x,c.z,c.vx,c.vz,c.heading].every(Number.isFinite));maxStep=Math.max(maxStep,Math.hypot(c.x-prior[c.index].x,c.z-prior[c.index].z));prior[c.index]={x:c.x,z:c.z};}});const state=s.police.getState();assert.equal(state.nightShift,true);assert.equal(state.activeCount,6);assert.equal(state.deployments,3);assert.ok(maxStep<.6);const calls=s.police.consumeEvents().filter(e=>e.type==='radio');assert.ok(calls.some(c=>c.code==='nightShift'));const nearby=s.police.getNearbyAudio(s.police.states[0]);assert.ok(nearby.length&&nearby.every(x=>x.engineId==='i6t'&&Number.isFinite(x.vx)));s.dispose();return{active:state.activeCount,deployments:state.deployments,maxStepM:maxStep,dispatches:calls.length};
});

check('Police impacts keep reciprocal body velocity and spatial sirens without a second contact impulse.',()=>{
 const s=systems({count:1,dayCount:1,nightCount:1}),cop=s.police.states[0];place(cop,20,6);const cs=Math.cos(cop.heading),sn=Math.sin(cop.heading),player={x:cop.x-cs*2.4,z:cop.z+sn*2.4,heading:cop.heading+Math.PI/2,vx:cs*12,vz:-sn*12,yawRate:0};const hit=resolveVehicleContacts(player,[cop.collider],{width:2,length:4.4,mass:1200,inertia:1800},{dt});assert.ok(hit.collided);const vx=cop.vx,vz=cop.vz;s.police.onPlayerContact(hit.contacts[0]);assert.equal(cop.vx,vx);assert.equal(cop.vz,vz);s.police.update(dt,{...player,speed:Math.hypot(player.vx,player.vz)});assert.equal(s.police.getState().phase,'chase');assert.ok(s.police.getNearbyAudio(player).some(x=>x.siren&&Number.isFinite(x.sirenPhase)));s.dispose();return{reciprocalImpulse:true,siren:true};
});

check('Civilian traffic and patrols keep finite physical motion and render matrices through a full minute on downtown roads.',()=>{
 const s=systems({traffic:16,count:3,dayCount:3,nightCount:3}),origins=s.police.states.map(c=>({x:c.x,z:c.z})),maxTravel=[0,0,0],matrix=new THREE.Matrix4();let maxStep=0,roadMisses=0,total=0,prior=s.police.states.map(c=>({x:c.x,z:c.z}));
 run(s,60,hiddenA,{},i=>{for(const c of s.police.states){assert.ok([c.x,c.z,c.vx,c.vz,c.yawRate,c.heading].every(Number.isFinite));maxTravel[c.index]=Math.max(maxTravel[c.index],Math.hypot(c.x-origins[c.index].x,c.z-origins[c.index].z));maxStep=Math.max(maxStep,Math.hypot(c.x-prior[c.index].x,c.z-prior[c.index].z));prior[c.index]={x:c.x,z:c.z};total++;if(!city.getRoadInfo(c.x,c.z).onRoad)roadMisses++;}if(i%120===0){s.police.render(.5);s.police.root.traverse(mesh=>{if(mesh.isInstancedMesh)for(let j=0;j<mesh.count;j++){mesh.getMatrixAt(j,matrix);assert.ok(matrix.elements.every(Number.isFinite));}});}});
 assert.equal(s.police.getState().phase,'patrol');assert.ok(maxTravel.every(d=>d>100));assert.ok(maxStep<.5);assert.ok(roadMisses/total<.03);const result={seconds:60,civilians:16,police:3,minTravelM:Math.min(...maxTravel),maxStepM:maxStep,roadMissFraction:roadMisses/total};s.dispose();return result;
});

check('Snapshot replicas and repeated reset/disposal preserve bounded police state.',()=>{
 const a=systems({count:3}),b=systems({count:3});a.police.reportCamera({x:city.spawn.x,z:city.spawn.z,district:'MIDTOWN',speedKph:110});run(a,2,hiddenA);const snapshot=a.police.captureSnapshot();assert.equal(b.police.applySnapshot(snapshot),true);b.police.advanceSnapshot(.05);b.police.render(.5);assert.equal(b.police.getState().heat,a.police.getState().heat);a.police.reset();assert.equal(a.police.getState().searchSectors.length,0);a.dispose();a.dispose();b.dispose();return{snapshotAccepted:true,resetClearsSearch:true};
});

assert.deepEqual(hashes(),source,'Police source changed during verification');report.sourceSHA256=source;report.status='passed';fs.writeFileSync(new URL('./police-v11-results.json',import.meta.url),JSON.stringify(report,null,2)+'\n');city.dispose();console.log(JSON.stringify(report,null,2));
