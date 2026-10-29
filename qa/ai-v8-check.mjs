import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from '../dist/vendor/three.module.js';
import {createCity} from '../dist/city.js';
import {createTraffic,setAgentPose} from '../dist/traffic.js';
import {createPolice} from '../dist/police.js';
import {createEnforcement} from '../dist/enforcement.js';
import {capsuleContact} from '../dist/contact.js';

const dt=1/120,city=createCity(new THREE.Scene()),far={playerId:'host',x:1900,z:1900,heading:0,vx:0,vz:0,speed:0};
const report={status:'pending',checks:[],limits:['Deterministic physical AI and Three.js instance matrices in Node. No GPU image or audible siren claim.','AI uses a bounded bicycle model, steering/braking and shared planar collision bodies. It does not run a full MotorLab drivetrain for each NPC.']};
const cases=[];const test=(name,body)=>cases.push({name,body});
function alignment(system,alpha){system.render(alpha);const matrix=new THREE.Matrix4();let error=0;system.root.traverse(mesh=>{if(!mesh.isInstancedMesh)return;for(let i=0;i<mesh.count;i++){mesh.getMatrixAt(i,matrix);assert.ok(matrix.elements.every(Number.isFinite));if(mesh.userData.stateIndices){const c=system.states[mesh.userData.stateIndices[i]];error=Math.max(error,Math.hypot(matrix.elements[12]-(c.previousX+(c.x-c.previousX)*alpha),matrix.elements[14]-(c.previousZ+(c.z-c.previousZ)*alpha)));}}});assert.ok(error<.00008);return error;}
function run(t,p,seconds,player=far,context={},inspect=null){for(let i=0;i<seconds*120;i++){t?.update(dt,player,context);p?.update(dt,player,context);inspect?.(i);}}

test('traffic',()=>{
 const t=createTraffic(null,city,{count:36}),initial=t.states.map(c=>({x:c.x,z:c.z})),travel=t.states.map(()=>0),entries=t.states.map(c=>c.entries);let offroad=0,redEntries=0,overlaps=0,wrongLane=0,maxError=0,minOffset=0;const started=performance.now();
 run(t,null,120,far,{},frame=>{for(const c of t.states){assert.ok([c.x,c.z,c.heading,c.vx,c.vz,c.speed].every(Number.isFinite));const r=city.getRoadInfo(c.x,c.z);if(!r.onRoad)offroad++;if(c.path.type==='road'&&c.distance>7&&c.distance<c.path.length-8){const p=t.guide.sample(c.path,c.distance),offset=(c.x-r.nearest.x)*p.dz-(c.z-r.nearest.z)*p.dx;minOffset=Math.min(minOffset,offset);if(offset>-.8)wrongLane++;}travel[c.index]=Math.max(travel[c.index],Math.hypot(c.x-initial[c.index].x,c.z-initial[c.index].z));if(c.entries!==entries[c.index]){if(c.enteredSignal!=='green')redEntries++;entries[c.index]=c.entries;}}
  if(frame%60===0){maxError=Math.max(maxError,alignment(t,.5));for(let i=0;i<36;i++)for(let j=i+1;j<36;j++){const a=t.states[i],b=t.states[j];if(Math.hypot(a.x-b.x,a.z-b.z)<6){const hit=capsuleContact(a,b.collider,{width:a.width*.96,length:a.length*.96});if(hit&&hit.penetration>.025)overlaps++;}}}
 });
 assert.equal(offroad,0);assert.equal(redEntries,0);assert.equal(wrongLane,0);assert.equal(overlaps,0);assert.ok(t.diagnostics().entries>120);assert.ok(t.diagnostics().turns>30);assert.ok(travel.every(d=>d>50));report.traffic={...t.diagnostics(),seconds:120,offroad,redEntries,wrongLane,overlaps,minLaneOffset:minOffset,minTravelM:Math.min(...travel),maxInstanceErrorM:maxError,wallMs:performance.now()-started};t.dispose();
});

test('shift',()=>{
 const t=createTraffic(null,city,{count:0}),p=createPolice(null,city,t,{count:6,dayCount:3,nightCount:6}),identity=[...p.states],stages=[];let maxStep=0,offroad=0,wrongLane=0;
 for(const c of p.states.filter(c=>!c.active))assert.ok(!city.colliders.some(b=>capsuleContact(c,b,{width:c.width,length:c.length})));
 for(const[seconds,night]of[[100,1],[180,0]]){let before=p.states.map(c=>({x:c.x,z:c.z}));run(t,p,seconds,far,{night},()=>{for(const c of p.states){maxStep=Math.max(maxStep,Math.hypot(c.x-before[c.index].x,c.z-before[c.index].z));before[c.index]={x:c.x,z:c.z};if(c.duty==='patrol'){const r=city.getRoadInfo(c.x,c.z);if(!r.onRoad)offroad++;if(c.path.type==='road'&&c.distance>12&&c.distance<c.path.length-12){const sample=t.guide.sample(c.path,c.distance),offset=(c.x-r.nearest.x)*sample.dz-(c.z-r.nearest.z)*sample.dx;if(offset>-.7)wrongLane++;}}}});stages.push({night,active:p.getState().activeCount,duties:p.states.map(c=>c.duty)});assert.equal(p.getState().activeCount,night?6:3);assert.ok(p.states.slice(3).every(c=>c.duty===(night?'patrol':'reserve')));}
 assert.ok(maxStep<.3);assert.equal(offroad,0);assert.equal(wrongLane,0);assert.ok(identity.every((v,i)=>v===p.states[i]));assert.equal(p.getState().deployments,3);assert.equal(p.getState().returns,3);report.shift={stages,maxStepM:maxStep,offroad,wrongLane};p.dispose();t.dispose();
});

test('courtesy',()=>{
 const t=createTraffic(null,city,{count:1}),c=t.states[0];t.place(c,31,40,12,8);const pose=t.guide.sample(c.path,0),d={x:Math.sin(pose.heading),z:Math.cos(pose.heading)},police={x:c.x-d.x*32,z:c.z-d.z*32,heading:pose.heading,vx:d.x*18,vz:d.z*18,speed:18,width:1.82,length:4.45,siren:true,active:true};let minSwerve=0;
 run(t,null,3,far,{emergency:[police]},()=>{police.x+=police.vx*dt;police.z+=police.vz*dt;minSwerve=Math.min(minSwerve,c.swerve);assert.ok(city.getRoadInfo(c.x,c.z).onRoad);});assert.ok(minSwerve<-.9);assert.ok(t.diagnostics().emergencyYields>0);run(t,null,3);assert.equal(c.yielding,false);
 t.reset();t.place(c,31,40,12,6);const remote={playerId:'guest',x:c.x-d.x*17,z:c.z-d.z*17,heading:pose.heading,vx:d.x*12,vz:d.z*12,speed:12,horn:true};run(t,null,.8,far,{players:[remote]},()=>{remote.x+=remote.vx*dt;remote.z+=remote.vz*dt;});assert.ok(t.diagnostics().courtesyYields>0);assert.ok(c.swerve<-.5);report.courtesy={leftPullOverM:minSwerve,remoteHornYield:true};t.dispose();
});

test('close-pass',()=>{
 function pass({side=3,stop=false,teleport=false,remote=false,lateContact=false}={}){
  const t=createTraffic(null,city,{count:1}),c=t.states[0];t.place(c,31,40,20,8);const origin={x:c.x,z:c.z},h=c.heading,fx=Math.sin(h),fz=Math.cos(h),rx=fz,rz=-fx,player={playerId:remote?'guest':'host',x:origin.x+rx*side-fx*11,z:origin.z+rz*side-fz*11,heading:h,vx:fx*35,vz:fz*35,speed:35,width:1.82,length:4.45};let firstEventAt=null,completedSeparation=0;const events=[];
  for(let n=0;n<150;n++){
   if(teleport&&n===1){player.x+=fx*30;player.z+=fz*30;}else if(!stop||n<12){player.x+=player.vx*dt;player.z+=player.vz*dt;}
   if(lateContact){const along=(player.x-c.x)*fx+(player.z-c.z)*fz;if(along>0&&along<3.5){player.x=c.x+fx*along+rx*.7;player.z=c.z+fz*along+rz*.7;}}
   t.update(dt,remote?far:player,remote?{players:[player]}:{});const rows=t.consumeEvents();if(rows.length&&firstEventAt===null){firstEventAt=n*dt;completedSeparation=(player.x-c.x)*fx+(player.z-c.z)*fz;}events.push(...rows);
  }
  t.dispose();return{events,firstEventAt,completedSeparation};
 }
 const a=pass(),b=pass({remote:true});for(const result of[a,b]){assert.equal(result.events.length,1);assert.equal(result.events[0].completed,true);assert.ok(result.events[0].clearance>.12);assert.ok(result.completedSeparation>4.5,'Do not reward while the car bodies are still alongside');}assert.equal(a.events[0].playerId,'host');assert.equal(b.events[0].playerId,'guest');for(const fixture of[{side:1.2},{side:8},{stop:true},{teleport:true},{lateContact:true}])assert.equal(pass(fixture).events.length,0,JSON.stringify(fixture));report.closePass={local:a,remote:b,falsePositiveCases:5};
});

test('cameras',()=>{
 const e=createEnforcement(city),camera=city.speedCameras[0],d=camera.direction,r={x:d.z,z:-d.x},origin=camera.trigger,reports=[];const police={reportCamera:row=>reports.push(row)},at=(along,side=0,speed=35,id='host')=>({playerId:id,x:origin.x+d.x*along+r.x*side,z:origin.z+d.z*along+r.z*side,vx:d.x*speed,vz:d.z*speed,speed:Math.abs(speed),heading:camera.heading});
 const center=city.getRoadInfo(origin.x,origin.z).nearest;assert.ok((origin.x-center.x)*d.z-(origin.z-center.z)*d.x< -2.5);
 e.update(dt,at(-1),{police,players:[at(-1,0,35,'guest')]});e.update(dt,at(1),{police,players:[at(1,0,35,'guest')]});const events=e.consumeEvents();assert.equal(events.length,2);assert.equal(e.getState().tickets,1);assert.equal(e.getState().totalTickets,2);assert.equal(reports.length,2);assert.deepEqual(events.map(e=>e.playerId),['host','guest']);assert.equal(camera.flash,1);
 e.update(dt,at(-1),{police,players:[at(-1,0,35,'guest')]});e.update(dt,at(1),{police,players:[at(1,0,35,'guest')]});assert.equal(e.consumeEvents().length,0);
 for(const[description,a,b]of[['wrong direction',at(1,0,-35),at(-1,0,-35)],['opposite lane',at(-1,5.4),at(1,5.4)],['under limit',at(-1,0,14),at(1,0,14)],['teleport',at(-800),at(800)],['sideways teleport',at(-1,-800),at(1,800)]]){e.reset();e.update(dt,a,{police});e.update(dt,b,{police});assert.equal(e.consumeEvents().length,0,description);}
 report.cameras={count:city.speedCameras.length,players:events.map(e=>({playerId:e.playerId,tickets:e.tickets,speedKph:e.speedKph})),falsePositiveCases:5};e.dispose();
});

test('target-custody',()=>{
 const t=createTraffic(null,city,{count:0}),p=createPolice(null,city,t,{count:1}),c=p.states[0],path=t.guide.leg(31,40),pose=t.guide.sample(path,25),suspectPose=t.guide.sample(path,32),guest={...suspectPose,playerId:'guest',vx:0,vz:0,speed:0};setAgentPose(c,pose,0,city);p.reportOffense('Collision','guest');p.update(dt,far,{players:[guest]});assert.equal(p.getState().targetId,'guest');assert.equal(p.getState().phase,'chase');run(t,p,3.1,far,{players:[guest]});assert.equal(p.getState().phase,'arrested');const arrested=p.consumeEvents().filter(e=>e.type==='arrest');assert.equal(arrested.length,1);assert.equal(arrested[0].targetId,'guest');const position={x:c.x,z:c.z};run(t,p,3.1,far,{players:[guest]});assert.equal(p.getState().phase,'patrol');assert.equal(p.getState().targetId,null);assert.ok(Math.hypot(c.x-position.x,c.z-position.z)<3,'Custody release must not teleport patrols');guest.speed=35;guest.vx=Math.sin(guest.heading)*35;guest.vz=Math.cos(guest.heading)*35;run(t,p,8,far,{players:[guest]});assert.equal(p.getState().phase,'patrol','Released driver gets a short grace period');report.custody={targetId:arrested[0].targetId,arrests:arrested.length,releasePhase:p.getState().phase,graceSecondsObserved:8};p.dispose();t.dispose();
});

test('observation-radio',()=>{
 const aT=createTraffic(null,city,{count:0}),bT=createTraffic(null,city,{count:0}),a=createPolice(null,city,aT,{count:3}),b=createPolice(null,city,bT,{count:3}),pose=aT.guide.sample(aT.guide.leg(31,40),20),guest={...aT.guide.sample(aT.guide.leg(31,40),32),playerId:'guest',vx:0,vz:-20,speed:20};
 for(const p of[a,b]){setAgentPose(p.states[0],pose,0,city);p.reportOffense('Collision','guest');p.update(dt,far,{players:[guest]});assert.equal(p.getState().targetId,'guest');}
 for(let n=0;n<8*120;n++){aT.update(dt,far);bT.update(dt,far);a.update(dt,far,{players:[{...guest,x:1900,z:1700}]});b.update(dt,far,{players:[]});for(let i=0;i<3;i++){assert.ok(Math.abs(a.states[i].x-b.states[i].x)<1e-9);assert.ok(Math.abs(a.states[i].z-b.states[i].z)<1e-9);}}
 assert.equal(a.getState().phase,'search');assert.equal(b.getState().phase,'search');assert.equal(a.getState().arrestProgress,0);a.dispose();b.dispose();aT.dispose();bT.dispose();
 const t=createTraffic(null,city,{count:0}),p=createPolice(null,city,t,{count:1}),car=p.states[0];setAgentPose(car,pose,0,city);p.reportOffense('Collision','guest');p.update(dt,far,{players:[guest]});const events=[];for(let n=0;n<13*120;n++){const point={playerId:'guest',x:car.x+Math.sin(car.heading)*15,z:car.z+Math.cos(car.heading)*15,vx:0,vz:-18,speed:18,heading:Math.PI};p.update(dt,far,{players:[point]});events.push(...p.consumeEvents());}const location=events.find(e=>e.type==='radio'&&e.code==='location');assert.ok(location?.message.includes('northbound'));assert.equal(location.targetId,'guest');report.observation={hiddenAndDisconnectedSamePaths:true,location:location.message};p.dispose();t.dispose();
});

test('camera-investigation',()=>{
 const t=createTraffic(null,city,{count:0}),p=createPolice(null,city,t,{count:1}),camera=city.speedCameras[0],reportRow={x:camera.trigger.x,z:camera.trigger.z,heading:camera.heading,speedKph:130,district:camera.district,playerId:'guest'};p.reportCamera(reportRow);assert.equal(p.getState().phase,'patrol');assert.equal(p.getState().investigation.playerId,'guest');const c=p.states[0],guest={playerId:'guest',x:c.x+Math.sin(c.heading)*12,z:c.z+Math.cos(c.heading)*12,heading:c.heading,vx:0,vz:0,speed:0};run(t,p,.25,far,{players:[guest]});assert.equal(p.getState().phase,'chase');assert.equal(p.getState().targetId,'guest');const before=p.getState().searchCenter;p.reportCamera({...reportRow,playerId:'other',x:300,z:300});assert.deepEqual(p.getState().searchCenter,before,'Another driver camera capture must not move the active pursuit');report.cameraInvestigation={targetId:p.getState().targetId,otherDriverCannotRetarget:true};p.dispose();t.dispose();
});

test('snapshots',()=>{
 const host=createTraffic(null,city,{count:36}),guest=createTraffic(null,city,{count:36}),a=createPolice(null,city,host,{count:6,dayCount:3,nightCount:6}),b=createPolice(null,city,guest,{count:6,dayCount:3,nightCount:6});run(host,a,.6,far,{night:1});let ta=JSON.parse(JSON.stringify(host.captureSnapshot())),pa=JSON.parse(JSON.stringify(a.captureSnapshot()));assert.equal(guest.applySnapshot(ta),true);assert.equal(b.applySnapshot(pa),true);guest.advanceSnapshot(.1);b.advanceSnapshot(.1);alignment(guest,1);alignment(b,1);const before=guest.states.map(c=>({x:c.x,z:c.z}));run(host,a,.1,far,{night:1});ta=JSON.parse(JSON.stringify(host.captureSnapshot()));pa=JSON.parse(JSON.stringify(a.captureSnapshot()));assert.ok(guest.applySnapshot(ta)&&b.applySnapshot(pa));guest.advanceSnapshot(.05);b.advanceSnapshot(.05);alignment(guest,.5);alignment(b,.5);assert.ok(guest.states.every((c,i)=>c.previousX===before[i].x&&c.previousZ===before[i].z));const at=JSON.stringify(guest.captureSnapshot()),bp=JSON.stringify(b.captureSnapshot());guest.update(.04,far);b.update(.04,far);assert.equal(JSON.stringify(guest.captureSnapshot()),at);assert.equal(JSON.stringify(b.captureSnapshot()),bp);
 for(const mutate of[v=>v.cars[0].x=NaN,v=>v.cars[0].heading=Infinity,v=>v.cars[0].id='unknown',v=>v.cars[1].id=v.cars[0].id,v=>v.time=-1]){const bad=structuredClone(ta);mutate(bad);assert.equal(guest.applySnapshot(bad),false);assert.equal(JSON.stringify(guest.captureSnapshot()),at);}
 const hidden={...ta,cars:ta.cars.slice(1)};assert.equal(guest.applySnapshot(hidden),true);assert.equal(guest.states[0].visible,false);assert.ok(!guest.getColliders(guest.states[0]).some(c=>c.npcId==='npc-0'));guest.render(1);const matrix=new THREE.Matrix4();for(const mesh of guest.root.children.filter(m=>m.userData.stateIndices?.includes(0))){const index=mesh.userData.stateIndices.indexOf(0);mesh.getMatrixAt(index,matrix);assert.equal(new THREE.Vector3().setFromMatrixScale(matrix).length(),0);}
 const emptyPolice={...pa,cars:[]};assert.equal(b.applySnapshot(emptyPolice),true);assert.equal(b.getColliders(b.states[0],2000).length,0);const identities=[...guest.states];guest.reset();assert.ok(identities.every((c,i)=>c===guest.states[i]&&c.visible));report.snapshots={trafficBytes:JSON.stringify(ta).length,policeBytes:JSON.stringify(pa).length,remoteTickFrozen:true,interpolationMilliseconds:100,rejectedMutations:5};b.dispose();a.dispose();guest.dispose();host.dispose();const zero=createTraffic(null,city,{count:0}),none=createPolice(null,city,zero,{count:0});run(zero,none,.1);assert.equal(zero.states.length,0);assert.equal(none.states.length,0);assert.equal(none.getState().activeCount,0);assert.ok(zero.applySnapshot(zero.captureSnapshot()));assert.ok(none.applySnapshot(none.captureSnapshot()));zero.dispose();none.dispose();
});

for(const item of cases){if(process.env.V8_CASE&&!item.name.includes(process.env.V8_CASE))continue;item.body();report.checks.push(item.name);console.log('PASS '+item.name);}
city.dispose();report.status='passed';if(!process.env.V8_CASE)fs.writeFileSync(new URL('./ai-v8-results.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
