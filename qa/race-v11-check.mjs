import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import * as THREE from '../dist/vendor/three.module.js';
import {createWorld} from '../dist/world.js';
import {createRace} from '../dist/race.js';
import {resolveVehicleContacts} from '../dist/contact.js';

globalThis.document={createElement(tag){assert.equal(tag,'canvas');return{getContext(){return{fillRect(){},beginPath(){},arc(){},fill(){},fillText(){}};}};}};
const scene=new THREE.Scene(),world=createWorld(scene),dt=1/120;
const report={version:11,status:'pending',checks:[],fixtures:{},limits:['Real Dock09 geometry, physical NPC bodies, lap gates and collision solver in Node. No GPU screenshot, browser input or speaker audition.','Opponent engines use lightweight sound descriptors; player drivetrain remains separate.']};
const paths=['dist/race.js','dist/traffic.js','dist/contact.js'],hashes=()=>Object.fromEntries(paths.map(p=>[p,createHash('sha256').update(fs.readFileSync(new URL('../'+p,import.meta.url))).digest('hex')])),source=hashes();
function check(name,fn){report.fixtures[name]=fn();report.checks.push(name);console.log('PASS '+name);}
const held=race=>({...race.getPlayerSpawn(),vx:0,vz:0,speed:0,heading:race.getPlayerSpawn().heading});
function pose(distance,offset=0,speed=25){const p=world.curve.getPointAt((distance/world.length%1+1)%1),t=world.curve.getTangentAt((distance/world.length%1+1)%1);return{x:p.x+t.z*offset,z:p.z-t.x*offset,vx:t.x*speed,vz:t.z*speed,speed:Math.abs(speed),heading:Math.atan2(t.x,t.z)};}
function run(race,seconds,player,inspect){for(let i=0;i<Math.ceil(seconds/dt);i++){race.update(dt,typeof player==='function'?player(i*dt):player);inspect?.(i);}}

check('Countdown freezes the grid, race clock and lap credit until racing is enabled.',()=>{
 const race=createRace(null,world,{count:5}),player=held(race),before=race.states.map(c=>[c.x,c.z,c.vx,c.vz]);
 for(let i=0;i<360;i++)race.update(dt,player,{racing:false});assert.equal(race.getState().elapsed,0);assert.equal(race.getState().started,false);assert.deepEqual(race.states.map(c=>[c.x,c.z,c.vx,c.vz]),before);race.dispose();return{seconds:3,cars:6};
});

check('Five physical opponents complete all three laps, with ordered gates, unique finish times and bounded continuous movement.',()=>{
 const race=createRace(null,world,{laps:3}),player=held(race);let maxStep=0,maxRoadDistance=0,previous=race.states.map(c=>({x:c.x,z:c.z})),ticks=0;
 for(;ticks<120*240&&!race.getState().entries.filter(r=>!r.isPlayer).every(r=>r.finished);ticks++){
  race.update(dt,player);
  for(const c of race.states){assert.ok([c.x,c.z,c.heading,c.vx,c.vz,c.yawRate,c.speed].every(Number.isFinite));maxStep=Math.max(maxStep,Math.hypot(c.x-previous[c.index].x,c.z-previous[c.index].z));previous[c.index]={x:c.x,z:c.z};maxRoadDistance=Math.max(maxRoadDistance,world.getRoadInfo(c.x,c.z).distance);}
 }
 const state=race.getState(),opponents=state.entries.filter(r=>!r.isPlayer);assert.equal(opponents.length,5);assert.ok(opponents.every(r=>r.finished&&r.completedLaps===3));assert.equal(new Set(opponents.map(r=>r.finishTime)).size,5);assert.ok(maxStep<.5);assert.equal(state.playerFinished,false);assert.equal(state.playerPosition,6);assert.equal(race.diagnostics().invalidMoves,0);const result={seconds:ticks*dt,maxStepM:maxStep,maxRoadDistanceM:maxRoadDistance,finishTimes:opponents.map(r=>({name:r.name,seconds:r.finishTime})),contacts:race.diagnostics().contacts};race.dispose();return result;
});

check('Rookie and Pro use different physical pace settings and both finish complete NPC races.',()=>{
 const results=[];for(const difficulty of ['rookie','pro']){const race=createRace(null,world,{laps:1,difficulty}),player=held(race);let ticks=0;for(;ticks<120*160&&!race.getState().entries.filter(r=>!r.isPlayer).every(r=>r.finished);ticks++)race.update(dt,player);const entries=race.getState().entries.filter(r=>!r.isPlayer);assert.ok(entries.every(r=>r.finished),difficulty);results.push({difficulty,leaderSeconds:entries[0].finishTime,lastSeconds:entries.at(-1).finishTime});race.dispose();}assert.ok(results[1].leaderSeconds<results[0].leaderSeconds);return results;
});

check('A continuously driven player lap finishes once, has a real position and returns ordered gaps and audio descriptors.',()=>{
 const race=createRace(null,world,{count:2,laps:1,playerName:'Test Driver'}),spawn=race.getPlayerSpawn(),start=world.getRoadInfo(spawn.x,spawn.z).progress*world.length-world.length;let distance=start;
 // This grid index starts on the left; keep that lane for the initial pose.
 for(let i=0;i<120*70&&!race.getState().playerFinished;i++){distance+=28*dt;race.update(dt,pose(distance,-3.2,28));}
 const state=race.getState();assert.equal(state.playerFinished,true);assert.equal(state.entries.find(e=>e.isPlayer).name,'Test Driver');assert.equal(state.completedLaps,1);assert.ok(state.entries.every((e,i)=>e.position===i+1&&Number.isFinite(e.gapSeconds)&&Number.isFinite(e.gapMetres)));const finished=race.consumeEvents().filter(e=>e.type==='raceFinished');assert.equal(finished.length,1);run(race,1,pose(distance,-3.2,0));assert.equal(race.consumeEvents().filter(e=>e.type==='raceFinished').length,0);const audio=race.getNearbyAudio(race.states[0]);assert.ok(audio.length>0&&audio.every(s=>s.engineId&&Number.isFinite(s.rpm)&&Number.isFinite(s.vx)&&s.engineRunning&&!s.siren));const result={position:state.playerPosition,finishTime:state.playerTime,audioFamilies:audio.map(s=>s.engineId)};race.dispose();return result;
});

check('Backwards driving and teleports cannot award a lap; recovery returns to the last legitimate gate.',()=>{
 const race=createRace(null,world,{count:0,laps:1}),initial=race.getPlayerSpawn();let distance=world.getRoadInfo(initial.x,initial.z).progress*world.length-world.length;
 run(race,1,time=>pose(distance-time*18,-3.2,-18));assert.equal(race.getState().wrongWay,true);assert.equal(race.getState().completedLaps,0);
 const reset=race.getPlayerRecoveryPose();race.markPlayerReset(reset);distance=world.getRoadInfo(reset.x,reset.z).progress*world.length-world.length;
 for(let i=0;i<120*25&&distance<world.length*.4;i++){distance+=24*dt;race.update(dt,pose(distance,-3.2,24));}
 assert.equal(race.getState().nextCheckpoint,4);const next=race.getState().nextCheckpoint,completed=race.getState().completedLaps;
 for(let i=0;i<16;i++)race.update(dt,pose((i%8+.01)/8*world.length,0,40),{teleported:true});assert.equal(race.getState().nextCheckpoint,next);assert.equal(race.getState().completedLaps,completed);assert.equal(race.getState().playerFinished,false);
 const recovery=race.getPlayerRecoveryPose(),road=world.getRoadInfo(recovery.x,recovery.z);assert.ok(Math.abs(road.progress-(3/8+3/world.length))<.001);race.markPlayerReset(recovery);assert.equal(race.getState().checkpointMissed,false);assert.equal(race.getState().nextCheckpoint,4);const result={gateAfterRecovery:4,recoveryProgress:road.progress,invalidMoves:race.diagnostics().invalidMoves};race.dispose();return result;
});

check('Player contacts exchange one reciprocal impulse, retain collision velocity and reduce opponent condition.',()=>{
 const race=createRace(null,world,{count:1}),car=race.states[0],sn=Math.sin(car.heading),cs=Math.cos(car.heading),player={x:car.x-cs*2.3,z:car.z+sn*2.3,heading:car.heading+Math.PI/2,vx:cs*13,vz:-sn*13,yawRate:0};
 const contact=resolveVehicleContacts(player,[car.collider],{width:2,length:4.4,mass:1200,inertia:1800},{dt});assert.ok(contact.collided);const speed=Math.hypot(car.vx,car.vz);assert.ok(speed>1);const vx=car.vx,vz=car.vz;race.onPlayerContact(contact.contacts[0]);assert.equal(car.vx,vx);assert.equal(car.vz,vz);assert.ok(car.health<1);race.update(dt,{...player,speed:Math.hypot(player.vx,player.vz)});assert.ok(Math.hypot(car.vx,car.vz)>speed*.75);const result={opponentSpeedAfterImpulse:speed,health:car.health};race.dispose();return result;
});

check('A blocked opponent physically reverses, then finishes after the obstruction is removed without a teleport.',()=>{
 const race=createRace(null,world,{count:1,laps:1}),car=race.states[0],player=held(race),sn=Math.sin(car.heading),cs=Math.cos(car.heading),wall={x:car.x+sn*3,z:car.z+cs*3,hx:4,hz:.35,heading:car.heading,material:'metal',kind:'test-barrier'};world.colliders.push(wall);let reverse=false,maxStep=0,prior={x:car.x,z:car.z};
 run(race,12,player,()=>{reverse ||= car.vx*Math.sin(car.heading)+car.vz*Math.cos(car.heading)<-.3;maxStep=Math.max(maxStep,Math.hypot(car.x-prior.x,car.z-prior.z));prior={x:car.x,z:car.z};});world.colliders.splice(world.colliders.indexOf(wall),1);assert.ok(reverse);assert.ok(race.diagnostics().recoveries>0);assert.ok(maxStep<.5);
 for(let i=0;i<120*110&&!race.getState().entries.find(r=>!r.isPlayer).finished;i++)race.update(dt,player);assert.ok(race.getState().entries.find(r=>!r.isPlayer).finished);const result={recoveries:race.diagnostics().recoveries,maxStepM:maxStep,finishTime:race.getState().entries.find(r=>!r.isPlayer).finishTime};race.dispose();return result;
});

check('Opponent render matrices, reset, retirement and repeated disposal stay finite and release the race root.',()=>{
 const race=createRace(null,world,{count:5}),player=held(race);run(race,3,player);race.render(.35);let matrices=0;const matrix=new THREE.Matrix4();race.root.traverse(mesh=>{if(mesh.isInstancedMesh)for(let i=0;i<mesh.count;i++){mesh.getMatrixAt(i,matrix);assert.ok(matrix.elements.every(Number.isFinite));matrices++;}});assert.ok(matrices>30);assert.equal(race.retirePlayer().playerRetired,true);assert.equal(race.consumeEvents().filter(e=>e.type==='raceRetired').length,1);race.retirePlayer();assert.equal(race.consumeEvents().length,0);race.reset();assert.equal(race.getState().elapsed,0);assert.equal(race.getState().playerRetired,false);assert.equal(race.getState().completedLaps,0);race.dispose();race.dispose();assert.equal(race.root.parent,null);return{matrices,retirementOnce:true};
});
assert.deepEqual(hashes(),source,'Race production source changed during verification');report.sourceSHA256=source;report.status='passed';fs.writeFileSync(new URL('./race-v11-results.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
