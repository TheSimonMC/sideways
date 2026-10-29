import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from '../dist/vendor/three.module.js';
import {createCity} from '../dist/city.js';
import {createTraffic} from '../dist/traffic.js';
import {capsuleContact} from '../dist/contact.js';
globalThis.document={createElement(){return{getContext(){return{fillRect(){},fillText(){}}}}}};
const scene=new THREE.Scene(),city=createCity(scene),dt=1/120,far={x:2000,z:2000,heading:0,speed:0},result={status:'pending',checks:[]};
const check=name=>{result.checks.push(name);console.log('PASS',name);};
const run=(traffic,seconds,player=far,inspect=null)=>{for(let i=0;i<Math.round(seconds/dt);i++){traffic.update(dt,player);inspect?.();}};
{
 const traffic=createTraffic(scene,city,{count:1}),car=traffic.states[0];traffic.place(car,11,12,car.path.length-24,10);const line=car.path.end;
 run(traffic,12,far,()=>{assert.equal(car.path.type,'road','Entered a red-light intersection');assert.ok(car.distance<=car.path.length+.00001);});assert.ok(car.speed<.1);assert.ok(Math.hypot(car.x-line.x,car.z-line.z)<.3);assert.ok(-car.x-car.length*.5>14.45,'Front bumper crossed the painted stop line');
 const stopped={x:car.x,z:car.z,speed:car.speed};run(traffic,12,far);assert.ok(car.entries>0);assert.equal(car.enteredSignal,'green');assert.ok(Math.hypot(car.x-stopped.x,car.z-stopped.z)>15);result.redLight={stopped,entries:car.entries,afterGreenSpeed:car.speed};check('Civilian brakes to a red stop line, waits, then enters on green and clears the junction');
}
{
 const traffic=createTraffic(scene,city,{count:2}),leader=traffic.states[0],follower=traffic.states[1];traffic.place(leader,11,12,72,0);traffic.place(follower,11,12,43,12);
 let smallest=Infinity;run(traffic,11,far,()=>{const gap=Math.hypot(leader.x-follower.x,leader.z-follower.z)-(leader.length+follower.length)*.5;smallest=Math.min(smallest,gap);assert.ok(gap>.9,'Queue cars overlap');});assert.ok(leader.speed<.1&&follower.speed<.1);result.queueMinGap=smallest;check('Following traffic brakes behind a stopped leader with a finite gap and no overlap');
}
{
 const traffic=createTraffic(scene,city,{count:1}),car=traffic.states[0];traffic.place(car,7,12,15,9);const player={x:car.x,z:car.z+19,heading:0,speed:0,vx:0,vz:0,width:2,length:4.5};
 run(traffic,8,player);assert.ok(car.speed<.2);assert.equal(car.stopReason,'player');assert.ok(car.z<player.z-4);assert.ok(traffic.diagnostics().horns>=1);const x=car.x,z=car.z;
 run(traffic,4,far);assert.ok(Math.hypot(car.x-x,car.z-z)>5);assert.ok(car.speed>2);result.blockedPlayer={horns:traffic.diagnostics().horns,recoveredSpeed:car.speed};check('Traffic detects a player blocking its lane, stops, gives a bounded horn, and resumes once clear');
}
{
 const traffic=createTraffic(scene,city,{count:1}),car=traffic.states[0],before={x:car.x,z:car.z};const list=traffic.getColliders(before);assert.equal(list.length,1);assert.equal(list[0].npcId,car.id);assert.ok(Number.isFinite(list[0].vx));traffic.onPlayerContact({collider:list[0],closingSpeed:12});assert.ok(car.hitHold>0);run(traffic,.5,far);assert.ok(car.speed<.2);run(traffic,2,far);assert.ok(car.hitHold===0);assert.ok(traffic.getNearbyAudio(car).length<=4);traffic.reset();assert.equal(traffic.time,0);assert.equal(traffic.reservations.size,0);assert.equal(traffic.diagnostics().contacts,0);check('Nearby moving collision boxes carry NPC identity; impact braking recovers; reset clears state and reservations');
}
{
 const traffic=createTraffic(scene,city,{count:28}),positions=traffic.states.map(c=>({x:c.x,z:c.z}));let entries=0,minGap=Infinity,invalidGreen=0,offroad=0,overlaps=0;const t0=performance.now();
 const lastEntries=traffic.states.map(c=>c.entries);
 for(let step=0;step<120*90;step++){
  traffic.update(dt,far);
  for(const car of traffic.states){assert.ok([car.x,car.z,car.heading,car.speed,car.vx,car.vz,car.wheelSpin].every(Number.isFinite));if(!city.getRoadInfo(car.x,car.z).onRoad)offroad++;if(car.entries!==lastEntries[car.index]){entries++;lastEntries[car.index]=car.entries;if(car.enteredSignal!=='green')invalidGreen++;}}
  if(step%20===0)for(let i=0;i<traffic.states.length;i++)for(let j=i+1;j<traffic.states.length;j++){const a=traffic.states[i],b=traffic.states[j],dist=Math.hypot(a.x-b.x,a.z-b.z);minGap=Math.min(minGap,dist);if(dist<6&&capsuleContact(a,b.collider,{width:a.width*.94,length:a.length*.94}))overlaps++;}
 }
 const moved=traffic.states.filter((c,i)=>Math.hypot(c.x-positions[i].x,c.z-positions[i].z)>20).length;
 assert.equal(invalidGreen,0);assert.equal(offroad,0);assert.equal(overlaps,0,'Normal traffic cars overlap');assert.ok(entries>70);assert.ok(traffic.diagnostics().turns>20);assert.ok(moved>=22);
 result.population={...traffic.diagnostics(),entries,invalidGreen,offroad,overlaps,minCentreDistance:minGap,moved,wallMs:performance.now()-t0};
 traffic.render(.5);const matrix=new THREE.Matrix4();traffic.root.traverse(o=>{if(o.isInstancedMesh)for(let i=0;i<o.count;i++){o.getMatrixAt(i,matrix);assert.ok(matrix.elements.every(Number.isFinite));}});
 check('Twenty-eight cars navigate for 90 seconds, turn, queue and obey signals without collisions or offroad paths; all render matrices stay finite');
}
result.status='passed';fs.writeFileSync(new URL('./traffic-v5-results.json',import.meta.url),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
