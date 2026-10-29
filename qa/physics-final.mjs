import assert from 'node:assert/strict';
import MotorLab from '../sdk/motor-engine.mjs';
import { CarPhysics } from '../dist/physics.js';
const p = new CarPhysics(MotorLab), dt=1/120, result={};
const simulate = (seconds,input,callback)=>{for(let i=0;i<seconds*120;i++){const s=p.update(dt,typeof input==='function'?input(i*dt):input);for(const [k,v]of Object.entries(s))if(typeof v==='number')assert.ok(Number.isFinite(v),k+' finite');callback?.(s,(i+1)*dt);}};
const initial = p.state;
p.reset(0,0,0); assert.equal(p.state,initial,'state identity survives reset');
simulate(2,{}); result.idleDistance=Math.hypot(p.state.x,p.state.z);assert.ok(result.idleDistance<.05,'no idle creep');
p.reset(0,0,0);const gears=[];const accel={};simulate(40,{throttle:1},(s,t)=>{if(gears.at(-1)!==s.gear)gears.push(s.gear);for(const kph of[50,100,150,200])if(!accel[kph]&&s.speed*3.6>=kph)accel[kph]=+t.toFixed(3);}); result.acceleration={seconds:accel,kphAt40:p.state.speed*3.6,gears};assert.ok(accel[100]<7);assert.ok(gears.length>=5);assert.ok(p.state.speed>50);
p.reset(0,0,0);const boosted={};simulate(8,{throttle:1,boost:true},(s,t)=>{for(const kph of[100,150,200])if(!boosted[kph]&&s.speed*3.6>=kph)boosted[kph]=+t.toFixed(3);});result.boost={seconds:boosted,kphAt8:p.state.speed*3.6,charge:p.state.boost};assert.ok(boosted[150]<8);
p.reset(0,0,0);simulate(6,{throttle:1});let stoppedAt=null;simulate(5,{brake:1},(s,t)=>{if(stoppedAt===null&&s.speed<1)stoppedAt=t;});result.brakingSeconds=stoppedAt;assert.ok(stoppedAt<4);assert.equal(p.state.gear,-1);assert.ok(p.state.forwardSpeed<0);
p.reset(0,0,0);simulate(6,{throttle:1});simulate(2,{steer:.7,throttle:.5,handbrake:true});result.driftPeak=p.state.driftAngle;let driftCount=0;simulate(7,t=>({throttle:.7,steer:t<2?-.4:0}),s=>{if(s.drifting)driftCount++});result.driftRecovery={speed:p.state.speed,angle:p.state.driftAngle,driftFrames:driftCount};assert.ok(driftCount>0);
result.tunes={};for(const name of['street','drift','grip']){p.setTune(name);p.reset(0,0,0);simulate(15,t=>({throttle:t%4<3?1:0,brake:t%6>5?.6:0,steer:Math.sin(t*1.3)*.75,handbrake:t>7&&t<7.3,boost:t>10&&t<12}));result.tunes[name]={speed:p.state.speed,angle:p.state.driftAngle,lock:p.state.differentialLock};}
console.log(JSON.stringify(result,null,2));
