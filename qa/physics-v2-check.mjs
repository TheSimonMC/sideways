import assert from 'node:assert/strict';
import fs from 'node:fs';
import MotorLab from '../sdk/motor-engine.mjs';
import {CarPhysics} from '../dist/physics.js';
const p = new CarPhysics(MotorLab), dt=1/120;
const result={stationary:[],direction:[],handbrake:{},manual:{}};
const simulate=(seconds,input,check)=>{for(let i=0;i<Math.round(seconds/dt);i++){const s=p.update(dt,typeof input==='function'?input(i*dt):input);for(const[k,v]of Object.entries(s))if(typeof v==='number')assert.ok(Number.isFinite(v),k+' not finite');check?.(s,i*dt);}return p.state;};
const step=input=>p.update(dt,input);
const reset=(heading=0)=>{p.reset(0,0,heading);p.setTune('street');};
for(const heading of[0,1.37,-2.4])for(const steer of[-1,1]){
 reset(heading);simulate(3,{steer});const item={heading,steer,headingDelta:p.state.heading-heading,distance:Math.hypot(p.state.x,p.state.z),yawRate:p.state.yawRate};result.stationary.push(item);
 assert.ok(Math.abs(item.headingDelta)<1e-12);assert.ok(item.distance<1e-12);assert.equal(item.yawRate,0);
}
for(const tune of['drift','grip']){reset();p.setTune(tune);simulate(2,{steer:1});assert.equal(p.state.heading,0);assert.equal(p.state.speed,0);}
console.log('stationary passed');
for(const reverse of[false,true])for(const semanticRight of[-1,1]){
 reset(.6);simulate(reverse?2:3,reverse?{brake:1}:{throttle:1});const h=p.state.heading,x=p.state.x,z=p.state.z;
 simulate(.75,{steer:-semanticRight*.5,throttle:reverse?0:.5,brake:reverse?.5:0});
 const delta=p.state.heading-h;
 assert.ok((reverse?1:-1)*semanticRight*delta>.025,`Wrong direction: ${reverse} ${semanticRight} ${delta}`);
 result.direction.push({reverse,semanticRight,headingDelta:delta,x:p.state.x-x,z:p.state.z-z});
}
console.log('direction passed');
reset();simulate(5,{throttle:1});const speedBefore=p.state.speed;
simulate(.35,{handbrake:1,steer:.7,throttle:.6});const wheelBefore=[p.state.wheelSpinL,p.state.wheelSpinR];
simulate(.25,{handbrake:1,steer:.7,throttle:.6});result.handbrake={speedBefore,speedAfter:p.state.speed,angle:p.state.driftAngle,rotationWhileLocked:[p.state.wheelSpinL-wheelBefore[0],p.state.wheelSpinR-wheelBefore[1]],wheelOmega:[p._omegaL,p._omegaR]};
assert.equal(p._omegaL,0);assert.equal(p._omegaR,0);assert.ok(Math.abs(p.state.driftAngle)>.08);assert.ok(p.state.speed<speedBefore);assert.ok(result.handbrake.rotationWhileLocked.every(x=>Math.abs(x)<1e-12));
reset();simulate(3,{handbrake:1,steer:1,throttle:1,boost:true});assert.equal(p.state.speed,0);assert.equal(p.state.heading,0);assert.equal(p.state.boosting,false);
reset();step({handbrake:.4});assert.equal(p.state.handbrake,.4);console.log('handbrake passed');
reset();const manual={transmission:'sequential'};
simulate(7,{...manual,throttle:1});assert.equal(p.state.gear,1,'Manual first gear should not auto-upshift');result.manual.firstGearKph=p.state.speed*3.6;
step({...manual,shiftUp:true});assert.equal(p.state.gear,2);simulate(.3,{...manual,shiftUp:true});assert.equal(p.state.gear,2,'Held shift should not repeat');step(manual);step({...manual,shiftUp:true});assert.equal(p.state.gear,3);
result.manual.sequentialHeldGuard=true;
reset();const sequence=[];for(let i=0;i<5;i++){step({...manual,shiftUp:true});sequence.push(p.state.gear);step(manual);}assert.deepEqual(sequence,[2,3,4,5,6]);
for(let i=0;i<7;i++){step({...manual,shiftDown:true});sequence.push(p.state.gear);step(manual);}assert.deepEqual(sequence,[2,3,4,5,6,5,4,3,2,1,0,-1]);result.manual.sequentialOrder=sequence;
simulate(2,{...manual,throttle:1});assert.equal(p.state.gear,-1);assert.ok(p.state.forwardSpeed< -2);result.manual.reverseThrottleSpeed=p.state.forwardSpeed;
reset();const gate={transmission:'hpattern',manualClutch:true};step({...gate,gearRequest:2,clutch:0});assert.equal(p.state.gear,1);assert.equal(p.state.shiftMessage,'KUPPLUNG TRETEN');
step({...gate,gearRequest:2,clutch:1});assert.equal(p.state.gear,2);simulate(2,{...gate,gearRequest:2,clutch:1,throttle:1});assert.equal(p.state.speed,0);assert.equal(p.state.clutchTorque,0);assert.equal(p.state.clutch,1);assert.ok(p.state.rpm>3000);result.manual.clutchRpm=p.state.rpm;
simulate(3,{...gate,gearRequest:2,clutch:0,throttle:1});assert.equal(p.state.gear,2);assert.ok(p.state.speed>3);result.manual.releaseSpeed=p.state.speed;
reset();simulate(3,{transmission:'hpattern',gearRequest:0,throttle:1},s=>{assert.equal(s.gear,0);assert.equal(s.clutchTorque,0);assert.equal(s.speed,0);});result.manual.neutralRpm=p.state.rpm;
reset();const selected=[];for(const gear of[-1,0,1,2,3,4,5,6]){step({transmission:'hpattern',gearRequest:gear});selected.push(p.state.gear);}assert.deepEqual(selected,[-1,0,1,2,3,4,5,6]);result.manual.hPatternAllGears=selected;
reset();simulate(10,{throttle:1});const previousGear=p.state.gear;
step({...gate,clutch:1,gearRequest:-1});assert.equal(p.state.gear,previousGear);assert.equal(p.state.shiftMessage,'ERST ANHALTEN');
step({...gate,clutch:1,gearRequest:1});assert.equal(p.state.gear,previousGear);assert.equal(p.state.shiftMessage,'DREHZAHL ZU HOCH');result.manual.unsafeShiftGuard=true;
step({...gate,clutch:1,gearRequest:0});assert.equal(p.state.gear,0);assert.equal(p.state.clutchTorque,0);
step({...gate,clutch:1,gearRequest:6});assert.equal(p.state.gear,6);assert.equal(p.state.clutchTorque,0);
simulate(.5,{transmission:'auto',throttle:1});assert.equal(p.state.transmission,'auto');result.manual.modeSwitch=true;
reset();p.state.vz=40;p._omegaL=p._omegaR=40/p.wheelRadius;step({transmission:'hpattern',gearRequest:0});step({transmission:'auto',throttle:1});assert.equal(p.state.gear,4);result.manual.neutralToAutoAt144Kph=4;
result.passed=true;fs.writeFileSync(new URL('./physics-v2-results.json',import.meta.url),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
