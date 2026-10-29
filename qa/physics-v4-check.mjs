import assert from 'node:assert/strict';
import fs from 'node:fs';
import MotorLab from '../sdk/motor-engine.mjs';
import {CarPhysics} from '../dist/physics.js';

const p=new CarPhysics(MotorLab),dt=1/120,result={status:'passed',checks:[],scenarios:{}};
const free={transmission:'sequential',manualClutch:true,clutch:1,assists:false};
const record=(name,data)=>{result.checks.push(name);result.scenarios[name]=data;console.log('PASS',name);};
function setRolling(speed){p.state.vz=speed;for(let i=0;i<4;i++)p._wheelOmega[i]=speed/p.wheelRadius;}
function finite(s){for(const wheel of s.wheelAudio)for(const [key,value]of Object.entries(wheel))if(typeof value==='number')assert.ok(Number.isFinite(value),key);}

// One fixed physical input across the old discontinuity, not an assertion
// against the new interpolation formula.
const speeds=[1.49,1.499,1.5,1.501,1.51],probes=[];
for(const speed of speeds){p.reset();setRolling(speed);for(let i=0;i<4;i++)p._wheelOmega[i]=(speed+.5)/p.wheelRadius;p.update(dt,free);probes.push({speed,acceleration:(p.state.vz-speed)/dt,slip:p.state.wheelSlip[0]});}
const step=Math.abs(probes[2].acceleration-probes[1].acceleration);
assert.ok(step<.005,'Low-speed tyre response still jumps across 1.5 m/s');
record('continuous low-speed grip through previous threshold',{baselineAccelerationJump:.3958983908248825,currentAccelerationJump:step,probes});

// A body two metres above ground has no steering or rolling contact forces.
p.reset();setRolling(15);p.state.bodyHeight=2;
let predictedSpeed=15;
for(let i=0;i<12;i++){predictedSpeed-=.43*predictedSpeed**2/p.mass*dt;p.update(dt,{...free,assists:true,steer:1});finite(p.state);assert.equal(p.state.wheelLoads.reduce((a,b)=>a+b,0),0);}
assert.equal(p.state.yawRate,0);assert.equal(p.state.heading,0);
assert.ok(Math.abs(p.state.vz-predictedSpeed)<1e-9,'Invisible ground resistance still acts in air');
assert.ok(p.state.wheelAudio.every(w=>!w.contact&&w.load===0&&w.tyrePower===0&&w.impactSpeed===0));
record('airborne steering and invisible ground drag removed',{baselineYawAfter100ms:.1809670498959428,currentYaw:p.state.yawRate,speed:p.state.vz,aerodynamicOnlySpeed:predictedSpeed});

// Mirrored turns require the inside front tyre to turn through a larger angle.
const steering=[];
for(const steer of[-1,1]){p.reset();for(let i=0;i<120;i++)p.update(dt,{...free,steer});const angles=[...p.state.wheelSteers];assert.equal(p.state.speed,0);assert.equal(p.state.heading,0);const inside=steer>0?1:0,outside=inside^1;assert.ok(Math.abs(angles[inside])>Math.abs(angles[outside])+.05);assert.ok(angles.slice(0,2).every(a=>a*steer>0));assert.equal(angles[2],0);assert.equal(angles[3],0);steering.push(angles);}
assert.ok(Math.abs(steering[0][0]+steering[1][1])<1e-12);assert.ok(Math.abs(steering[0][1]+steering[1][0])<1e-12);
record('inner and outer tyres follow mirrored steering radii without moving parked car',steering);

// Real ground metadata and solved contact powers must survive per wheel.
p.setGroundSampler((x,z)=>({height:0,grip:x<0?.62:1,roughness:x<0?.027:.001,material:x<0?'gravel':'asphalt'}));p.reset();setRolling(8);
for(let i=0;i<24;i++)p.update(dt,{...free,brake:.5,steer:.18});
const rolling=p.state.wheelAudio.map(w=>({...w}));
for(let i=0;i<4;i++){assert.equal(rolling[i].surface,i%2===0?'gravel':'asphalt');assert.equal(rolling[i].roughness,i%2===0?.027:.001);assert.ok(rolling[i].load>0);assert.ok(rolling[i].brakePower>=0&&rolling[i].tyrePower>=0);}
assert.ok(rolling.some(w=>w.brakePower>100));assert.ok(rolling.some(w=>Math.abs(w.lateralSpeed)>.01));
record('surface and mechanical work telemetry reflects each actual contact',rolling);

p.setGroundSampler(null);p.reset();p.state.bodyHeight=.65;
let peakImpact=0,totalImpacts=0,contactSeen=false;
for(let i=0;i<360;i++){p.update(dt,free);finite(p.state);peakImpact=Math.max(peakImpact,...p.state.wheelAudio.map(w=>w.impactSpeed));if(i>30&&p.state.wheelAudio.some(w=>w.contact))contactSeen=true;}
totalImpacts=p.state.wheelAudio.reduce((n,w)=>n+w.impactCount,0);
assert.ok(contactSeen&&peakImpact>.45&&totalImpacts>0);assert.ok(Math.max(...p.state.wheelAudio.map(w=>w.impactSpeed))<.01);assert.ok(p.state.wheelAudio.every(w=>w.tyrePower===0&&w.brakePower===0));
record('suspension impacts decay after real landing instead of sounding under static load',{peakImpact,totalImpacts,settledImpact:p.state.wheelAudio.map(w=>w.impactSpeed)});

p.reset();for(let i=0;i<600;i++)p.update(dt,{transmission:'sequential',throttle:1,brake:1,assists:false});
assert.ok(p.state.burnout);assert.ok(p.state.wheelAudio.slice(2).some(w=>Math.abs(w.slipSpeed)>4&&w.tyrePower>1000));assert.ok(p.state.wheelAudio.slice(0,2).every(w=>Math.abs(w.wheelSpeed)<.5));
assert.ok(Number.isFinite(p.state.diffSlipRPM)&&Number.isFinite(p.state.diffTorque)&&p.state.diffPower>=0);
record('stationary burnout has rear tyre work while front wheels stay stopped',{speed:p.state.speed,rear:p.state.wheelAudio.slice(2).map(w=>({slipSpeed:w.slipSpeed,tyrePower:w.tyrePower,brakePower:w.brakePower})),diffPower:p.state.diffPower});

fs.writeFileSync(new URL('./physics-v4-results.json',import.meta.url),JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));
