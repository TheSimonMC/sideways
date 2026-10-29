import assert from 'node:assert/strict';import fs from 'node:fs';
import MotorLab from '../sdk/motor-engine.mjs';import {CarPhysics}from '../dist/physics.js';import {VEHICLES,resolveBuild}from '../dist/catalog.js';
const result=[];const p=new CarPhysics(MotorLab),dt=1/120;
for(const car of VEHICLES){
 p.setBuild(resolveBuild({carId:car.id,engineId:car.defaultEngine}));let maxTorque=0,maxRoll=0;
 for(let i=0;i<480;i++){p.update(dt,{throttle:1,steer:i>350?.15:0});maxTorque=Math.max(maxTorque,p.state.engineTorque);maxRoll=Math.max(maxRoll,Math.abs(p.state.bodyRoll));assert.ok(Number.isFinite(p.state.rpm));assert.ok(p.state.rpm<13000);assert.ok(p.state.wheelLoads.every(x=>Number.isFinite(x)&&x>=0));}
 const s=p.state;assert.ok(s.speed>7,`${car.id} cannot launch`);assert.ok(!s.engineStalled,`${car.id} stalled during assisted launch`);assert.ok(s.speed<70);assert.ok(maxRoll<.5);
 const sample={car:car.id,engine:car.defaultEngine,speedAfter4SecondsKph:s.speed*3.6,gear:s.gear,rpm:s.rpm,maxEngineMeanTorque:maxTorque,maxBodyRoll:maxRoll,boostAvailable:s.boostAvailable};result.push(sample);console.log(sample);
}
assert.ok(new Set(result.map(x=>Math.round(x.speedAfter4SecondsKph))).size>2,'Different cars should have different dynamics');
fs.writeFileSync(new URL('./physics-v3-builds-results.json',import.meta.url),JSON.stringify({status:'passed',builds:result},null,2));
