import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {capsuleContact,resolveVehicleContacts} from '../dist/contact.js';
import {resolveBuild,VEHICLES} from '../dist/catalog.js';

const report={status:'pending',checks:[],failures:[],scenarios:{},sourceHash:createHash('sha256').update(fs.readFileSync(new URL('../dist/contact.js',import.meta.url))).digest('hex')};
const hachi=resolveBuild(),state=(overrides={})=>({x:0,z:0,heading:0,vx:0,vz:0,yawRate:0,...overrides});
const front={x:0,z:4.3,hx:1,hz:2.2,heading:0,kind:'traffic',material:'metal',npcId:1};
const close=(a,b,label,tolerance=1e-8)=>assert.ok(Math.abs(a-b)<=tolerance,`${label}: ${a} versus ${b}`);
const relativeEnergy=(s,b,wall)=>.5*b.physics.mass*((s.vx-(wall.vx||0))**2+(s.vz-(wall.vz||0))**2)+.5*b.physics.inertia*s.yawRate**2;
function resolve(s,box,b=hachi){
 const heading=s.heading,before=relativeEnergy(s,b,box),result=resolveVehicleContacts(s,[box],b);
 assert.ok(result.collided,'Fixture must contact');assert.equal(s.heading,heading,'No second orientation integration');
 for(const k of ['x','z','heading','vx','vz','yawRate'])assert.ok(Number.isFinite(s[k]),`${k} stays finite`);
 assert.equal(capsuleContact(s,box,b),null,'Contact depenetrates completely');
 assert.ok(relativeEnergy(s,b,box)<=before+1e-7,'Impulse must not create kinetic energy relative to the kinematic obstacle');
 return result;
}
function check(name,fn){try{fn();report.checks.push(name);console.log('PASS '+name);}catch(error){report.failures.push({name,message:error.message,stack:error.stack});console.error('FAIL '+name+': '+error.message);}}

check('Equal NPC/player velocity depenetrates with zero collision impulse',()=>{
 const s=state({vx:5,vz:15}),box={...front,vx:5,vz:15},hit=resolve(s,box);
 close(hit.maxClosingSpeed,0,'Relative closing speed');close(hit.contacts[0].impulse,0,'Normal impulse');close(hit.contacts[0].frictionImpulse,0,'Tangential impulse');close(s.vx,5,'Preserved X velocity');close(s.vz,15,'Preserved Z velocity');
});

check('Rear-end response uses player-minus-NPC closing velocity',()=>{
 const s=state({vz:30}),hit=resolve(s,{...front,vz:15});
 close(hit.maxClosingSpeed,15,'15 m/s closing speed');close(s.vz,13.8,'Rebound relative to 15 m/s NPC');close(s.yawRate,0,'Centered rear-end has no yaw');
 report.scenarios.rearEnd={playerBefore:30,npcVelocity:15,closingSpeed:hit.maxClosingSpeed,playerAfter:s.vz,impulse:hit.contacts[0].impulse};
});

check('Approaching NPC pushes stationary player and separating NPC has no false impulse',()=>{
 const pushed=state(),hit=resolve(pushed,{...front,z:-4.3,vz:10});close(hit.maxClosingSpeed,10,'Rear NPC approach');close(pushed.vz,10.8,'Kinematic rear contact transfers forward velocity');
 const separating=state({vz:5}),clear=resolve(separating,{...front,vz:15});close(clear.maxClosingSpeed,0,'Faster leading NPC is separating');close(clear.contacts[0].impulse,0,'Separating contact impulse');close(separating.vz,5,'Separating velocity unchanged');
 report.scenarios.rearPush={npcVelocity:10,playerAfter:pushed.vz};
});

check('Oncoming traffic uses combined relative speed',()=>{
 const s=state({vz:20}),hit=resolve(s,{...front,vz:-10});close(hit.maxClosingSpeed,30,'Combined approach speed');close(s.vz,-12.4,'Kinematic oncoming response');
 report.scenarios.oncoming={playerBefore:20,npcVelocity:-10,closingSpeed:hit.maxClosingSpeed,playerAfter:s.vz};
});

check('Normal and friction impulses are invariant under common translation velocity',()=>{
 let cases=0,maxVelocityDelta=0;
 for(const vehicle of VEHICLES){
  const build=resolveBuild({carId:vehicle.id}),half=build.vehicle.model.length*.5;
  for(const heading of [0,.38,1.1,-.74])for(const boost of [{x:17,z:-6},{x:-9,z:23}]){
   const sin=Math.sin(heading),cos=Math.cos(heading),wall={x:0,z:0,hx:3,hz:.12,heading};
   const base=state({x:-sin*(half-.08)+cos*.3,z:-cos*(half-.08)-sin*.3,heading,vx:sin*18+cos*8,vz:cos*18-sin*8,yawRate:.25});
   const shifted={...base,vx:base.vx+boost.x,vz:base.vz+boost.z};
   const a=resolve(base,wall,build),b=resolve(shifted,{...wall,vx:boost.x,vz:boost.z},build);
   close(a.maxClosingSpeed,b.maxClosingSpeed,'Common velocity does not change closing speed');
   close(base.x,shifted.x,'Same depenetration X');close(base.z,shifted.z,'Same depenetration Z');close(base.yawRate,shifted.yawRate,'Same angular impulse');
   close(a.contacts[0].impulse,b.contacts[0].impulse,'Same normal impulse');close(a.contacts[0].frictionImpulse,b.contacts[0].frictionImpulse,'Same relative tangential friction impulse');
   close(shifted.vx-base.vx,boost.x,'X frame shift');close(shifted.vz-base.vz,boost.z,'Z frame shift');
   maxVelocityDelta=Math.max(maxVelocityDelta,Math.abs(shifted.vx-base.vx-boost.x),Math.abs(shifted.vz-base.vz-boost.z));cases++;
  }
 }
 report.scenarios.frameInvariance={cases,maxVelocityDelta};
});

check('Missing or non-finite NPC velocity preserves static response exactly',()=>{
 const base=state({vx:3,vz:20}),reference={...base},hit=resolve(reference,front);
 for(const velocity of [{vx:0,vz:0},{vx:NaN,vz:Infinity},{vx:undefined,vz:undefined}]){
  const s={...base},result=resolve(s,{...front,...velocity});assert.deepEqual(s,reference);close(result.maxClosingSpeed,hit.maxClosingSpeed,'Same fallback closing speed');close(result.contacts[0].impulse,hit.contacts[0].impulse,'Same fallback impulse');
 }
});

try{
 await import('./contact-v4-check.mjs');
 check('Original static collision suite remains unchanged',()=>{
  const result=JSON.parse(fs.readFileSync(new URL('./contact-v4-results.json',import.meta.url),'utf8'));
  assert.equal(result.status,'passed');assert.equal(result.scenarios,528);
  report.scenarios.staticRegression={status:result.status,scenarios:result.scenarios,randomContacts:result.randomContacts,maxEnergyRatio:result.maxEnergyRatio};
 });
}catch(error){check('Original static collision suite remains unchanged',()=>{throw error;});}

report.status=report.failures.length?'failed':'passed';
report.limits=['NPCs are kinematic obstacles. Player energy can increase in the world frame when an NPC pushes it; energy is checked in the NPC frame.','The solver uses NPC linear velocity at contact and does not implement equal-mass rigid-body exchanges or swept NPC trajectories.'];
fs.writeFileSync(new URL('./contact-v5-results.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({status:report.status,checks:report.checks.length,failures:report.failures},null,2));
if(report.failures.length)process.exitCode=1;
