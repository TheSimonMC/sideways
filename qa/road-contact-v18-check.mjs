import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import MotorLab from '../sdk/motor-engine.mjs';
import {CarPhysics} from '../dist/physics.js';
import {resolveBuild,VEHICLES} from '../dist/catalog.js';
import {roadPlane,contactFrame} from '../dist/road-contact.js';
import * as THREE from '../dist/vendor/three.module.js';
import {createCity} from '../dist/region.js';
const dt=1/120,checks=[],fixtures={};
const neutral={transmission:'hpattern',manualClutch:true,clutch:1,gearRequest:0,assists:false};
const check=(name,fn)=>{fixtures[name]=fn();checks.push(name);console.log('PASS '+name);};
function make(grade=0,selection={},grip=1,lateral=0){const p=new CarPhysics(MotorLab,resolveBuild(selection));p.setGroundSampler((x,z)=>({height:grade*z+lateral*x,grip}));p.reset();return p;}
function run(p,seconds,input,observe=()=>{}){for(let i=0;i<Math.round(seconds/dt);i++){p.update(dt,input);assert.ok([p.state.x,p.state.z,p.state.bodyHeight,p.state.bodyPitch,p.state.bodyRoll,p.state.speed,p.state.rpm,...p.state.wheelLoads].every(Number.isFinite));observe(i*dt,p.state);}return p.state;}
function moving(p,speed){p.state.vz=speed;p.state.speed=p.state.forwardSpeed=speed;p._wheelOmega.fill(speed*Math.hypot(1,p.state.roadGradeLong)/p.wheelRadius);p._heaveVelocity=speed*p.state.roadGradeLong;p._previousGround=p._previousGround.map(h=>h-p._heaveVelocity*dt);}
check('Slope contact preserves work reciprocity and static load geometry for combined grades and steering.',()=>{
 let combinations=0;for(const long of [-.3,0,.3])for(const lat of [-.2,0,.2])for(const steer of [-.8,0,.8]){
  const f=contactFrame(steer,long,lat),dot=(a,b)=>a[0]*b[0]+a[1]*b[1];
  assert.ok(Math.abs(dot([f.longU,f.longV],[f.forceLongU,f.forceLongV])-1)<1e-12);
  assert.ok(Math.abs(dot([f.latU,f.latV],[f.forceLatU,f.forceLatV])-1)<1e-12);
  assert.ok(Math.abs(dot([f.longU,f.longV],[f.forceLatU,f.forceLatV]))<1e-12);
  const u=4,v=15,y=lat*u+long*v,du=f.forceLongU*3,dv=f.forceLongV*3;
  const before=.5*(u*u+v*v+y*y),after=.5*((u+du)**2+(v+dv)**2+(lat*(u+du)+long*(v+dv))**2);
  assert.ok(Math.abs(after-before-3*(u*f.longU+v*f.longV)-4.5)<1e-10);combinations++;
 }
 const p=roadPlane([{height:1.1},{height:1.5},{height:.5},{height:.9}],1.5,1.5,1);
 assert.ok(Math.abs(p.longitudinal-.2)<1e-12&&Math.abs(p.lateral-.2)<1e-12);return {combinations};
});
check('Every original car resets onto a hill without false wheel impact; brakes hold, release allows rollback.',()=>{
 const rows=[];for(const car of VEHICLES){const p=make(.12,{carId:car.id});
  assert.ok(Math.abs(p.state.bodyPitch+.12)<1e-10);assert.ok(p.state.suspension.every((w,i)=>Math.abs(w.wheelY-p._positions[i][1]*.12-p.wheelRadius)<1e-10));
  run(p,3,{...neutral,brake:1});assert.ok(Math.abs(p.state.z)<.015);assert.ok(p.state.suspension.every(w=>w.impactCount===0));const hold=p.state.z;
  run(p,2,neutral);assert.ok(p.state.z<hold-1.2&&p.state.vz< -1);rows.push({car:car.id,holdDistance:hold,rollbackDistance:p.state.z-hold,rollbackSpeed:p.state.vz});p.engine.dispose();
 }return rows;
});
check('Hills change acceleration and stopping distance; a crossfall loads the downhill side without sideways creep.',()=>{
 const acceleration=[],stopping=[];for(const grade of [-.12,0,.12]){const p=make(grade);run(p,4,{throttle:.5});acceleration.push({grade,speed:p.state.speed});p.engine.dispose();
  const q=make(grade);moving(q,25);let time=0;while(q.state.speed>.2&&time<12){q.update(dt,{...neutral,brake:1});time+=dt;}assert.ok(time<12);stopping.push({grade,distance:q.state.z,time});q.engine.dispose();
 }
 assert.ok(acceleration[0].speed>acceleration[1].speed+1&&acceleration[1].speed>acceleration[2].speed+1);
 assert.ok(stopping[0].distance>stopping[1].distance*1.05&&stopping[1].distance>stopping[2].distance*1.05,JSON.stringify(stopping));
 const side=make(0,{},1,.2);run(side,4,neutral);assert.ok(Math.abs(side.state.x)<.02);assert.ok(side.state.wheelLoads[0]>side.state.wheelLoads[1]+300);const crossfall={displacement:side.state.x,leftLoad:side.state.wheelLoads[0],rightLoad:side.state.wheelLoads[1]};side.engine.dispose();
 const slick=make(.45,{},.2);run(slick,2,{...neutral,brake:1});assert.ok(slick.state.vz< -1,'Saturated tyres cannot pin a braked car to a steep low-grip surface');const slidingSpeed=slick.state.vz;slick.engine.dispose();return {acceleration,stopping,crossfall,slidingSpeed};
});
check('Neutral downhill motion cannot generate more kinetic energy than the gravitational potential it loses.',()=>{
 const p=make(-.12);run(p,4,neutral);const s=p.state;
 const translation=.5*p.mass*(s.vx*s.vx+s.vz*s.vz+(-.12*s.vz)**2),rotation=p._wheelOmega.reduce((sum,w)=>sum+.5*p.wheelInertia*w*w,0),released=-p.mass*9.81*s.groundHeight;
 assert.ok(translation+rotation<released*1.02&&translation+rotation>released*.6);p.engine.dispose();return {kineticJ:translation+rotation,releasedPotentialJ:released,limit:'Height-field chassis approximation; body spring energy and road losses excluded from the upper bound.'};
});
check('Terrain below airborne wheels causes no horizontal force or suspension alignment torque.',()=>{
 const rows=[];for(const grade of [0,.4]){const p=make(grade);moving(p,20);p.state.bodyHeight=20;p.state.bodyPitch=p.state.bodyRoll=0;p._heaveVelocity=0;p.state.yawRate=.2;run(p,.2,{...neutral,steer:.8});assert.ok(p.state.wheelLoads.every(v=>v===0));rows.push([p.state.vx,p.state.vz,p.state.yawRate,p.state.bodyPitch,p.state.bodyRoll]);p.engine.dispose();}for(let i=0;i<5;i++)assert.ok(Math.abs(rows[0][i]-rows[1][i])<1e-9);return {flat:rows[0],overSlope:rows[1]};
});
check('One-sided bumps reach front and rear wheels in order and feed actual suspension motion into audio.',()=>{
 const rows=[];for(const suspension of ['street','race']){const p=make(0,{suspension});p.setGroundSampler((x,z)=>({height:x<0&&Math.abs(z-8)<.9?.045*(1+Math.cos(Math.PI*(z-8)/.9)):0,grip:1,material:'asphalt'}));p.reset();moving(p,12);
  const first=[null,null,null,null];let maxTravel=0,maxRoll=0,maxVelocity=0;run(p,1.6,neutral,(t,s)=>{for(let i=0;i<4;i++)if(first[i]===null&&s.suspension[i].groundHeight>.015)first[i]=t;maxTravel=Math.max(maxTravel,Math.abs(s.suspension[0].travel));maxRoll=Math.max(maxRoll,Math.abs(s.bodyRoll));maxVelocity=Math.max(maxVelocity,Math.abs(s.wheelAudio[0].suspensionVelocity));assert.equal(s.wheelAudio[0].suspensionTravel,s.suspension[0].travel);assert.equal(s.wheelAudio[0].impactCount,s.suspension[0].impactCount);});
  // Load transfer can excite another corner before that wheel reaches the bump;
  // measure its actual road contact time separately from the acoustic shocks.
  assert.ok(first[0]!==null&&first[2]>first[0]+.12,JSON.stringify(first));assert.equal(first[1],null);assert.equal(first[3],null);
  assert.ok(maxTravel>.02&&maxRoll>.003&&maxVelocity>.4);rows.push({suspension,firstBumpContacts:first,maxTravel,maxRoll,maxVelocity});p.engine.dispose();
 }assert.ok(Math.abs(rows[0].maxTravel-rows[1].maxTravel)>.001);
 // A smooth hump excites continuous suspension audio; a sharp curb additionally
 // generates a discrete impact. Do not demand an impact click for every wave.
 const curb=make();curb.setGroundSampler((x,z)=>({height:x<0&&z>8?.07:0,grip:.86,material:'curb'}));curb.reset();moving(curb,12);run(curb,1.1,neutral);assert.ok(curb.state.wheelAudio[0].impactCount>0);const curbImpacts=curb.state.wheelAudio.map(w=>w.impactCount);curb.engine.dispose();return {smoothBumps:rows,curbImpacts};
});
check('Existing Skyline Hills road geometry drives the same slope forces and remains stable through recovery.',()=>{
 const scene=new THREE.Scene(),city=createCity(scene);let chosen;
 for(const road of city.region.roads.filter(r=>r.kind==='hills')){for(let i=10;i<road.points.length-10;i++){const a=road.points[i],b=road.points[i+1],l=Math.hypot(b.x-a.x,b.z-a.z),grade=(b.y-a.y)/l;if(grade>.07&&grade<.18&&l>5){chosen={a,b,road:road.name,grade};break;}}if(chosen)break;}
 assert.ok(chosen,'An existing usable hill segment is required');const {a,b}=chosen,p=make();p.setGroundSampler((x,z)=>city.getSurfaceAt(x,z));p.reset((a.x+b.x)/2,(a.z+b.z)/2,Math.atan2(b.x-a.x,b.z-a.z),{neutral:true});
 const start={x:p.state.x,z:p.state.z,grade:p.state.roadGradeLong};assert.ok(start.grade>.04);run(p,2,neutral);assert.ok(p.state.forwardSpeed<-.4);assert.ok(p.state.suspension.every(w=>w.contact));assert.ok(Math.abs(p.state.bodyHeight-p.state.groundHeight)<.10);
 const saved=p.getCondition();saved.wheelHealth[0]=.6;p.restoreCondition(saved);const pose=city.getResetPose(p.state.x,p.state.z,p.state.heading);p.reset(pose.x,pose.z,pose.heading,{neutral:true});assert.equal(p.condition.wheelHealth[0],.6);assert.equal(p.condition.fuelLitres,saved.fuelLitres);run(p,.1,{...neutral,brake:1});assert.ok(Number.isFinite(p.state.bodyPitch));
 const result={road:chosen.road,start,reset:pose};p.engine.dispose();city.dispose();assert.equal(scene.children.length,0);return result;
});
const source=['dist/physics.js','dist/road-contact.js','dist/region.js'];
fs.writeFileSync(new URL('road-contact-v18-results.json',import.meta.url),JSON.stringify({version:18,status:'passed',checks,fixtures,sourceSHA256:Object.fromEntries(source.map(f=>[f,createHash('sha256').update(fs.readFileSync(new URL('../'+f,import.meta.url))).digest('hex')])),limits:['Synthetic keyboard-like inputs and one sampled existing hill segment; no claim of driving every road or a full 6-DOF body solver.','Rain and tyre pressure remain unfinished; aero and wheel-hop approximation are covered by the separate V18 tests.']},null,2));
