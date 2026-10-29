import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from '../dist/vendor/three.module.js';
import {createCity} from '../dist/city.js';
import {createTraffic,setAgentPose} from '../dist/traffic.js';
import {createPolice} from '../dist/police.js';
import {createEnforcement} from '../dist/enforcement.js';
import {capsuleContact} from '../dist/contact.js';
const dt=1/120,far={x:3000,z:3000,heading:0,speed:0,vx:0,vz:0},city=createCity(new THREE.Scene());
const report={status:'pending',checks:[],limits:['Deterministic dynamic AI, geometry, rendered instance matrices and event contracts in Node. No browser image or speaker listening claim.','Driver reactions and police planning are bounded authored game behaviours, not a general intelligence simulation.']};
const check=(name)=>{report.checks.push(name);console.log('PASS '+name);};
{
 const t=createTraffic(null,city,{count:0}),p=createPolice(null,city,t,{count:6,dayCount:3,nightCount:6}),refs=[...p.states],initial=p.getState(),deployTimes=[];let maxStep=0,offroad=0,previousActive=initial.activeCount;
 assert.equal(initial.activeCount,3);assert.equal(initial.reserveCount,3);assert.ok(Math.hypot(p.states[0].x-p.states[1].x,p.states[0].z-p.states[1].z)>350);assert.ok(Math.hypot(p.states[1].x-p.states[2].x,p.states[1].z-p.states[2].z)>700);
 for(const c of p.states.filter(c=>!c.active))assert.ok(!city.colliders.some(b=>capsuleContact(c,b,{width:c.width,length:c.length})),'Reserve parking must be clear');
 const stages=[];
 for(const [seconds,night]of[[60,1],[240,0],[75,1]]){
  for(let frame=0;frame<seconds*120;frame++){
   const before=p.states.map(c=>({x:c.x,z:c.z}));t.update(dt,far);p.update(dt,far,{night});
   for(const c of p.states){maxStep=Math.max(maxStep,Math.hypot(c.x-before[c.index].x,c.z-before[c.index].z));assert.ok([c.x,c.z,c.vx,c.vz,c.heading,c.yawRate].every(Number.isFinite));if(c.duty==='patrol'&&!city.getRoadInfo(c.x,c.z).onRoad)offroad++;}
   const now=p.getState().activeCount;if(now>previousActive)deployTimes.push(p.diagnostics().time);previousActive=now;
  }
  stages.push({night,active:p.getState().activeCount,reserve:p.getState().reserveCount,duties:p.states.map(c=>c.duty)});assert.equal(p.getState().activeCount,night?6:3);assert.ok(p.states.slice(3).every(c=>c.duty===(night?'patrol':'reserve')));
 }
 assert.equal(offroad,0);assert.ok(maxStep<.35);assert.ok(deployTimes[1]-deployTimes[0]>3);assert.ok(deployTimes[2]-deployTimes[1]>3);assert.ok(refs.every((c,i)=>c===p.states[i]));assert.equal(p.getState().deployments,6);assert.equal(p.getState().returns,3);
 const events=p.consumeEvents();assert.ok(events.some(e=>e.type==='radio'&&e.code==='nightShift'));report.shifts={stages,deployTimes,maxStepM:maxStep,offroad};p.reset();assert.ok(refs.every((c,i)=>c===p.states[i]));assert.equal(p.getState().activeCount,3);p.dispose();t.dispose();check('Distributed day patrols and visible station reserves perform two night deployments and one daylight return without teleports or stale body identities');
}
{
 const t=createTraffic(null,city,{count:1}),c=t.states[0];t.place(c,31,40,30,10);const police={id:'test-cop',x:c.x,z:c.z-40,heading:0,vx:0,vz:18,speed:18,width:1.82,length:4.45,siren:true,active:true};let maxYield=0,maxSwerve=0;
 for(let frame=0;frame<4*120;frame++){police.z+=18*dt;t.update(dt,far,{emergency:[police],night:1});maxYield=Math.max(maxYield,c.yielding?1:0);maxSwerve=Math.max(maxSwerve,c.x-5);assert.ok(city.getRoadInfo(c.x,c.z).onRoad);}
 assert.equal(maxYield,1);assert.ok(maxSwerve>1.2);assert.ok(t.diagnostics().emergencyYields>0);assert.equal(c.nearMisses,0);const yieldSpeed=c.speed;for(let i=0;i<5*120;i++)t.update(dt,far,{emergency:[]});assert.equal(c.yielding,false);assert.ok(c.speed>yieldSpeed);report.emergency={maxSwerveM:maxSwerve,yieldSpeed,resumedSpeed:c.speed,yields:t.diagnostics().emergencyYields};t.dispose();check('Civilian drivers pull right and slow for an approaching siren, stay on the road and resume after it passes');
}
{
 const t=createTraffic(null,city,{count:1}),c=t.states[0];t.place(c,31,40,20,8);const player={x:c.x,z:c.z-16,heading:0,vx:0,vz:12,speed:12,horn:true};for(let i=0;i<120;i++){player.z+=12*dt;t.update(dt,player);}assert.ok(t.diagnostics().courtesyYields>0);assert.ok(c.swerve>1);
 player.horn=false;player.x=c.x+3;player.z=c.z;player.vx=0;player.vz=35;player.speed=35;t.update(dt,player);const events=t.consumeEvents();assert.equal(events.filter(e=>e.type==='nearMiss').length,1);assert.ok(events[0].intensity>0&&events[0].intensity<=1);assert.ok(c.horn>0);for(let i=0;i<10;i++)t.update(dt,player);assert.equal(t.consumeEvents().length,0);report.courtesy={yields:t.diagnostics().courtesyYields,nearMisses:t.diagnostics().nearMisses,event:events[0]};t.dispose();check('A following horn prompts courtesy movement, and a close fast pass emits one throttled near-miss reaction');
}
{
 const aT=createTraffic(null,city,{count:0}),bT=createTraffic(null,city,{count:0}),a=createPolice(null,city,aT,{count:3}),b=createPolice(null,city,bT,{count:3}),seen={x:5,z:-70,heading:0,vx:0,vz:18,speed:18};
 for(const p of[a,b]){setAgentPose(p.states[0],{x:5,z:-90,heading:0},8,city);p.reportOffense('Collision');p.update(dt,seen);assert.equal(p.getState().phase,'chase');}
 const roles=a.states.map(c=>c.role);assert.ok(roles.includes('pursuit')&&roles.includes('intercept')&&roles.includes('contain'));
 for(let i=0;i<8*120;i++){a.update(dt,{...far,x:2000,z:2000});b.update(dt,{...far,x:-2000,z:-2000});for(let c=0;c<3;c++){assert.ok(Math.abs(a.states[c].x-b.states[c].x)<1e-10);assert.ok(Math.abs(a.states[c].z-b.states[c].z)<1e-10);}}
 assert.equal(a.getState().phase,'search');assert.ok(a.getState().searchProgress>0);assert.ok(a.getState().searchRemaining>0&&a.getState().searchRemaining<18);assert.ok(a.getState().nearestOfficerDistance>1000);const events=a.consumeEvents();assert.ok(events.some(e=>e.type==='radio'&&e.code==='pursuit'));assert.ok(events.some(e=>e.type==='radio'&&e.code==='search'));report.search={roles,remaining:a.getState().searchRemaining,progress:a.getState().searchProgress,events:events.filter(e=>e.type==='radio').map(e=>e.code)};
 a.dispose();b.dispose();aT.dispose();bT.dispose();check('Pursuit, interception and containment use observed motion; two different hidden player positions produce identical police search movement');
}
{
 assert.equal(city.speedCameras.length,12);const camera=city.speedCameras[0],d=camera.direction,r={x:d.z,z:-d.x},point=camera.trigger,e=createEnforcement(city),reports=[];
 const at=(along,side=0,speed=35)=>({x:point.x+d.x*along+r.x*side,z:point.z+d.z*along+r.z*side,vx:d.x*speed,vz:d.z*speed,speed,heading:camera.heading});const police={reportCamera:r=>reports.push(r)};
 e.update(dt,at(-1),{police});assert.equal(e.getState().nearbyCamera.id,camera.id);e.update(dt,at(1),{police});let events=e.consumeEvents();assert.equal(events.length,1);assert.equal(events[0].type,'speedCamera');assert.equal(events[0].cameraId,camera.id);assert.equal(events[0].speedKph,126);assert.equal(events[0].reported,true);assert.equal(reports.length,1);assert.equal(reports[0].x,point.x);assert.equal(camera.flash,1);
 e.update(dt,at(-1),{police});e.update(dt,at(1),{police});assert.equal(e.consumeEvents().length,0,'Repeated line crossing during cooldown must not issue another ticket');
 for(let i=0;i<13*120;i++)e.update(dt,at(2,0,0),{police});e.update(dt,at(-1),{police});e.update(dt,at(1),{police});assert.equal(e.consumeEvents().length,1);
 for(const fixture of[['wrong direction',at(1,0,-35),at(-1,0,-35)],['other lane',at(-1,12),at(1,12)],['under limit',at(-1,0,(camera.limitKph+3)/3.6),at(1,0,(camera.limitKph+3)/3.6)],['map reset',at(-800),at(800)],['sideways teleport',at(-1,-800),at(1,800)]]){e.reset();e.update(dt,fixture[1],{police});e.update(dt,fixture[2],{police});assert.equal(e.consumeEvents().length,0,fixture[0]);}
 report.cameras={count:city.speedCameras.length,firstCapture:events[0],falsePositiveCases:5};e.dispose();check('Twelve visible directional cameras measure forward lane crossings, flash, report serious excess speed, respect cooldown and reject wrong-way/other-lane/reset cases');
}
{
 const t=createTraffic(null,city,{count:0}),p=createPolice(null,city,t,{count:3}),camera=city.speedCameras[0],capture={x:camera.trigger.x,z:camera.trigger.z,heading:camera.heading,speedKph:130,district:camera.district};p.reportCamera(capture);const state=p.getState();assert.equal(state.phase,'patrol');assert.equal(state.heat,0);assert.equal(state.investigation.x,capture.x);assert.equal(state.investigation.z,capture.z);const investigator=p.states.find(c=>c.id===state.investigation.unit),before={x:investigator.x,z:investigator.z};for(let i=0;i<10*120;i++)p.update(dt,far);assert.equal(p.getState().phase,'patrol');assert.ok(Math.hypot(investigator.x-before.x,investigator.z-before.z)>10);assert.equal(investigator.role,'investigate');
 const spotted={x:investigator.x+Math.sin(investigator.heading)*12,z:investigator.z+Math.cos(investigator.heading)*12,heading:investigator.heading,speed:0,vx:0,vz:0};for(let i=0;i<20;i++)p.update(dt,spotted);assert.equal(p.getState().phase,'chase');const sirens=p.getNearbyAudio({x:investigator.x+150,z:investigator.z,heading:0});assert.ok(sirens.some(s=>s.siren&&s.distance>=100&&s.urgency>0));const events=p.consumeEvents();assert.ok(events.some(e=>e.type==='radio'&&e.code==='camera'));assert.ok(events.some(e=>e.type==='pursuit'&&e.reason==='Speed camera report'));report.investigation={unit:state.investigation.unit,reportedPosition:[capture.x,capture.z],distanceBeforeSpotting:Math.hypot(investigator.x-before.x,investigator.z-before.z),sirensInRange:sirens.length};p.dispose();t.dispose();check('Camera report sends a real unit to the photographed location without heat; pursuit starts only after an officer actually sees the car');
}
city.dispose();report.status='passed';fs.writeFileSync(new URL('./ai-v7-results.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
