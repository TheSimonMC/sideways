import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from '../dist/vendor/three.module.js';
import {createCity} from '../dist/city.js';
import {createTraffic} from '../dist/traffic.js';
import {capsuleContact,resolveVehicleContacts} from '../dist/contact.js';
import {resolveBuild} from '../dist/catalog.js';
const dt=1/120,far={x:2000,z:2000,heading:0,speed:0,vx:0,vz:0},city=createCity(new THREE.Scene()),report={status:'pending',checks:[],limits:['Dynamic civilian bicycle model and reciprocal planar contacts; no independent SDK engines or full vehicle drivetrain per NPC.','Rendered instance matrices verified in Node; no browser GPU or visual-quality claim.']};
const check=name=>{report.checks.push(name);console.log('PASS '+name);},run=(t,seconds,player=far,fn=null)=>{for(let i=0;i<seconds*120;i++){t.update(dt,player);fn?.();}};
function alignment(t,alpha=1){t.render(alpha);const matrix=new THREE.Matrix4();let error=0;for(const car of t.states){assert.equal(car.collider.body,car);assert.equal(car.collider.x,car.x);assert.equal(car.collider.z,car.z);assert.equal(car.collider.vx,car.vx);assert.equal(car.collider.vz,car.vz);}t.root.traverse(mesh=>{if(!mesh.isInstancedMesh)return;assert.equal(mesh.frustumCulled,false,'Moving instance batch must not reuse stale bounds');for(let i=0;i<mesh.count;i++){mesh.getMatrixAt(i,matrix);assert.ok(matrix.elements.every(Number.isFinite));if(mesh.userData.stateIndices){const c=t.states[mesh.userData.stateIndices[i]],x=c.previousX+(c.x-c.previousX)*alpha,z=c.previousZ+(c.z-c.previousZ)*alpha;error=Math.max(error,Math.hypot(matrix.elements[12]-x,matrix.elements[14]-z));}}});assert.ok(error<.00008,'Rendered bodies must match live simulation positions');return error;}
{
 const t=createTraffic(null,city,{count:36}),refs=[...t.states];let error=0;for(let r=0;r<3;r++){t.reset();assert.ok(refs.every((c,i)=>c===t.states[i]),'Reset must preserve shared body identity');run(t,1.5);error=Math.max(error,alignment(t,1),alignment(t,.37));}report.resetAlignment={resets:3,cars:36,maxErrorM:error};t.dispose();check('Repeated reset retains body identity and all body/collider/render positions remain aligned');
}
{
 const t=createTraffic(null,city,{count:1}),c=t.states[0];t.place(c,39,40,110,10);let maxDistance=0;
 run(t,14,far,()=>{assert.equal(c.path.type,'road');maxDistance=Math.max(maxDistance,c.distance);assert.ok(c.distance<c.path.length);});assert.ok(c.speed<.15);const front=c.x+c.length*.5;assert.ok(front< -17.4,'Front bumper must remain behind visible stop bar');const stopped={x:c.x,z:c.z,speed:c.speed};run(t,12);assert.ok(c.entries>0);assert.equal(c.enteredSignal,'green');assert.ok(c.speed>3);report.redLight={stopped,frontBumper:front,entries:c.entries,maxDistance};t.dispose();check('Dynamic braking stops behind a red signal and accelerates through green');
}
{
 const t=createTraffic(null,city,{count:2}),a=t.states[0],b=t.states[1];t.place(a,39,40,138.8,0);t.place(b,39,40,105,12);let minGap=Infinity;
 run(t,13,far,()=>{minGap=Math.min(minGap,Math.hypot(a.x-b.x,a.z-b.z)-(a.length+b.length)*.5);assert.ok(!capsuleContact(a,b.collider,{width:a.width*.98,length:a.length*.98}));});assert.ok(a.speed<.15&&b.speed<.15);assert.ok(minGap>1);report.queueMinGapM=minGap;t.dispose();check('Follower braking keeps a physical gap behind a red-light queue');
}
{
 const t=createTraffic(null,city,{count:1}),c=t.states[0];t.place(c,31,40,32,4);const player={x:c.x,z:c.z+8,heading:0,vx:0,vz:0,speed:0,width:2,length:4.5};run(t,6,player);assert.ok(c.speed<.2);assert.ok(t.diagnostics().horns>=1);const pos={x:c.x,z:c.z};run(t,4);assert.ok(Math.hypot(c.x-pos.x,c.z-pos.z)>5);report.playerBlock={horns:t.diagnostics().horns,recoveredSpeed:c.speed};t.dispose();check('A close player obstruction causes braking and a bounded horn, followed by recovery');
}
{
 const t=createTraffic(null,city,{count:1}),c=t.states[0];t.place(c,31,40,20,9);const player={x:c.x,z:c.z+28,heading:0,vx:0,vz:0,speed:0,width:2,length:4.5};let maxSwerve=0,minDistance=Infinity,overlap=0;
 run(t,9,player,()=>{maxSwerve=Math.max(maxSwerve,Math.abs(c.x-5));minDistance=Math.min(minDistance,Math.hypot(c.x-player.x,c.z-player.z));if(capsuleContact(c,{x:player.x,z:player.z,hx:1,hz:2.25,heading:0},{width:c.width*.98,length:c.length*.98}))overlap++;assert.ok(city.getRoadInfo(c.x,c.z).onRoad);});assert.ok(maxSwerve>1,'Driver must make a visible avoidance steering response');assert.equal(overlap,0,'Avoidance must not drive through the player');report.avoidance={maxSwerveM:maxSwerve,minDistanceM:minDistance,passed:c.z>player.z};t.dispose();check('Early obstacle avoidance steers within the street without passing through the player');
}
{
 const t=createTraffic(null,city,{count:1}),c=t.states[0];t.place(c,31,40,80,10);const build=resolveBuild(),p={x:2.6,z:c.z,heading:Math.PI/2,vx:14,vz:0,yawRate:0},momentumBefore={x:p.vx*build.physics.mass+c.vx*c.mass,z:p.vz*build.physics.mass+c.vz*c.mass};
 const hit=resolveVehicleContacts(p,[c.collider],build,{dt,restitution:.1,friction:.2});assert.ok(hit.collided);assert.ok(c.vx>1,'NPC body must receive reciprocal collision velocity');assert.ok(Math.abs(p.vx*build.physics.mass+c.vx*c.mass-momentumBefore.x)<1e-7);assert.ok(Math.abs(p.vz*build.physics.mass+c.vz*c.mass-momentumBefore.z)<1e-7);
 const impactVX=c.vx,start={x:c.x,z:c.z};t.onPlayerContact(hit.contacts[0]);assert.equal(c.vx,impactVX,'AI reaction must not apply a second impulse or erase the first');run(t,.15);assert.ok(c.x>start.x+.1,'Impact motion must persist through the AI update');assert.ok(c.vx>0);run(t,7);assert.ok(city.getRoadInfo(c.x,c.z).onRoad);assert.ok(c.speed>2,'Driver should recover and continue');report.impact={npcImpactVX:impactVX,npcRecoveredSpeed:c.speed,energyLostJ:hit.contacts[0].energyJ};alignment(t);t.dispose();check('Player impact transfers momentum to the NPC, persists as dynamic motion and recovers to its route');
}
{
 const t=createTraffic(null,city,{count:36}),initial=t.states.map(c=>({x:c.x,z:c.z})),last=t.states.map(c=>c.entries),travel=t.states.map(()=>0);let offroad=0,redEntries=0,overlaps=0,maxMatrixError=0;const start=performance.now();
 for(let frame=0;frame<120*120;frame++){t.update(dt,far);for(const c of t.states){assert.ok([c.x,c.z,c.vx,c.vz,c.heading,c.yawRate,c.speed,c.steer].every(Number.isFinite));travel[c.index]=Math.max(travel[c.index],Math.hypot(c.x-initial[c.index].x,c.z-initial[c.index].z));if(!city.getRoadInfo(c.x,c.z).onRoad)offroad++;if(c.entries!==last[c.index]){if(c.enteredSignal!=='green')redEntries++;last[c.index]=c.entries;}}if(frame%60===0){maxMatrixError=Math.max(maxMatrixError,alignment(t,.5));for(let i=0;i<t.states.length;i++)for(let j=i+1;j<t.states.length;j++){const a=t.states[i],b=t.states[j];if(Math.hypot(a.x-b.x,a.z-b.z)<6){const hit=capsuleContact(a,b.collider,{width:a.width*.96,length:a.length*.96});if(hit&&hit.penetration>.02)overlaps++;}}}}
 assert.equal(redEntries,0);assert.equal(offroad,0);assert.equal(overlaps,0);assert.ok(t.diagnostics().entries>120);assert.ok(t.diagnostics().turns>30);assert.ok(travel.every(d=>d>60));report.population={...t.diagnostics(),seconds:120,redEntries,offroad,overlaps,maxMatrixError,minTravelM:Math.min(...travel),wallMs:performance.now()-start};t.dispose();check('Thirty-six dynamic cars navigate for two minutes with finite states, turns, signal compliance and aligned rendered bodies');
}
city.dispose();report.status='passed';fs.writeFileSync(new URL('./traffic-v7-results.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
