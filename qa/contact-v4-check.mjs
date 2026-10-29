import assert from 'node:assert/strict';
import fs from 'node:fs';
import {capsuleContact,resolveVehicleContacts} from '../dist/contact.js';
import {resolveBuild,VEHICLES} from '../dist/catalog.js';

const report={status:'pending',checks:[],scenarios:0};
const hachi=resolveBuild(),atlas=resolveBuild({carId:'atlas'}),kitsune=resolveBuild({carId:'kitsune'});
const state=(values={})=>({x:0,z:0,heading:0,vx:0,vz:0,yawRate:0,...values});
const kinetic=(s,b)=>.5*b.physics.mass*(s.vx*s.vx+s.vz*s.vz)+.5*b.physics.inertia*s.yawRate*s.yawRate;
const finite=s=>{for(const k of ['x','z','heading','vx','vz','yawRate'])assert.ok(Number.isFinite(s[k]),`${k} must remain finite`);};
function resolve(s,boxes,build=hachi,options={}){
 const before=kinetic(s,build),heading=s.heading,result=resolveVehicleContacts(s,boxes,build,options);finite(s);
 assert.equal(s.heading,heading,'Contact must not integrate orientation twice');
 assert.ok(kinetic(s,build)<=before+1e-7,`Contact created kinetic energy: ${kinetic(s,build)} > ${before}`);
 for(const c of result.contacts){assert.ok(Math.abs(Math.hypot(c.normal.x,c.normal.z)-1)<1e-9);assert.ok(c.penetration>0&&c.impulse>=0&&c.closingSpeed>=0);}
 report.scenarios++;return result;
}

// Dimensions follow the installed chassis, not a universal circle.
const wall={x:0,z:2.5,hx:10,hz:.1,material:'concrete'};
assert.equal(capsuleContact(state(),wall,kitsune),null);
assert.ok(capsuleContact(state(),wall,atlas));
report.checks.push('ATLAS front contact occurs before the shorter KITSUNE reaches the same wall');

for(const build of VEHICLES.map(v=>resolveBuild({carId:v.id}))){
 const half=build.vehicle.model.length*.5,width=build.vehicle.model.width*.5;
 for(const direction of [-1,1]){
  const s=state({z:direction*.10,vz:direction*22}),box={x:0,z:direction*(half+.08),hx:8,hz:.10};
  const hit=resolve(s,[box],build);assert.ok(hit.collided&&hit.maxClosingSpeed>20);assert.equal(capsuleContact(s,box,build),null);assert.ok(Math.abs(s.yawRate)<1e-9,'Centered front/rear strike must not invent yaw');
 }
 for(const direction of [-1,1]){
  const s=state({x:direction*.10,vx:direction*12}),box={x:direction*(width+.08),z:0,hx:.10,hz:8};
  const hit=resolve(s,[box],build);assert.ok(hit.collided);assert.equal(capsuleContact(s,box,build),null);assert.ok(Math.abs(s.yawRate)<1e-9,'Centered broadside strike must not invent yaw');
 }
}
report.checks.push('Four chassis sizes resolve centered front, rear and both side contacts without false yaw');

{
 const s=state({x:.65,z:.35,vz:19}),box={x:1.3,z:2.5,hx:.28,hz:.2};
 const hit=resolve(s,[box]);assert.ok(hit.collided&&Math.abs(s.yawRate)>.1);assert.equal(capsuleContact(s,box,hachi),null);
 report.offsetHit={yawRate:s.yawRate,closingSpeed:hit.maxClosingSpeed,impulse:hit.contacts[0].impulse};
}
report.checks.push('Offset corner contact exchanges angular impulse at the impact point');

for(const box of [{x:0,z:0,hx:4,hz:4},{x:0,z:0,hx:.3,hz:4},{x:0,z:0,hx:2,hz:.2,heading:.71}]){
 const s=state({heading:.29});const result=resolve(s,[box]);assert.ok(result.collided);assert.equal(kinetic(s,hachi),0);assert.equal(result.contacts[0].impulse,0);assert.equal(capsuleContact(s,box,hachi),null);
}
report.checks.push('Contained and center-line-intersecting spawns depenetrate without imparting energy');

{
 const box={x:0,z:2.15,hx:8,hz:.1},s=state({vz:-7});const result=resolve(s,[box]);assert.ok(result.collided);assert.equal(result.contacts[0].impulse,0);assert.equal(s.vz,-7);
}
report.checks.push('Separating contacts correct overlap without a braking or bounce impulse');

for(const heading of [.23,.785,1.4,-.82]){
 const box={x:4,z:-3,hx:7,hz:.2,heading},s=state({heading,x:4-Math.sin(heading)*2.25,z:-3-Math.cos(heading)*2.25,vx:Math.sin(heading)*20,vz:Math.cos(heading)*20});
 const hit=resolve(s,[box]);assert.ok(hit.collided);assert.equal(capsuleContact(s,box,hachi),null);assert.ok(Math.abs(s.yawRate)<1e-7);
}
report.checks.push('Oriented barriers return world normals and contact points with consistent response');

{
 const boxes=[{x:0,z:3,hx:8,hz:.2},{x:2,z:0,hx:.2,hz:8}],s=state({x:1.1,z:1.1,vx:18,vz:24,yawRate:.6});
 const hit=resolve(s,boxes);assert.ok(hit.collided&&hit.contacts.length===2);for(const box of boxes)assert.equal(capsuleContact(s,box,hachi),null);
}
report.checks.push('Two-wall corners settle against both faces without added kinetic energy');

{
 const s=state({z:12,vz:2880}),box={x:0,z:0,hx:8,hz:.03};
 const result=resolve(s,[box],hachi,{dt:1/120,previousPosition:{x:0,z:-12,heading:0}});
 assert.ok(result.collided);assert.ok(s.z< -hachi.vehicle.model.length*.5,'Swept fast vehicle tunneled through thin wall');assert.equal(capsuleContact(s,box,hachi),null);
 report.sweep={startZ:-12,predictedZ:12,resolvedZ:s.z,closingSpeed:result.maxClosingSpeed};
}
report.checks.push('Swept subdivision catches a thin wall even when the predicted endpoint has fully crossed it');

{
 const s=state({x:1,z:2,heading:1,vx:4,vz:8,yawRate:.3}),before={...s};const result=resolve(s,[{x:500,z:500,hx:3,hz:3}],hachi,{previousPosition:{x:.96,z:1.92,heading:.99},dt:.01});assert.equal(result.collided,false);assert.deepEqual(s,before);
}
report.checks.push('Unobstructed prediction is preserved exactly');

let seed=96141;const random=()=>((seed=Math.imul(seed,1664525)+1013904223>>>0)/4294967296);
let randomContacts=0,maxEnergyRatio=0;
for(let i=0;i<500;i++){
 const build=resolveBuild({carId:VEHICLES[i%4].id}),box={x:0,z:0,hx:.1+random()*2,hz:.1+random()*2,heading:(random()-.5)*Math.PI};
 const s=state({x:(random()-.5)*6,z:(random()-.5)*6,heading:(random()-.5)*Math.PI*2,vx:(random()-.5)*90,vz:(random()-.5)*90,yawRate:(random()-.5)*5});
 const before=kinetic(s,build),result=resolve(s,[box],build);if(result.collided){randomContacts++;assert.equal(capsuleContact(s,box,build),null,'Single-box depenetration left residual overlap');maxEnergyRatio=Math.max(maxEnergyRatio,kinetic(s,build)/before);}
}
report.checks.push('500 seeded poses, velocities and rotated boxes stay finite, separate cleanly and never create kinetic energy');
report.randomContacts=randomContacts;report.maxEnergyRatio=maxEnergyRatio;report.status='passed';
fs.writeFileSync(new URL('./contact-v4-results.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
