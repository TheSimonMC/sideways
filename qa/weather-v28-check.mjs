import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import MotorLab from '../sdk/motor-engine.mjs';
import {CarPhysics} from '../dist/physics.js';
import {resolveBuild,VEHICLES} from '../dist/catalog.js';
import {RoadWeather,normalizeWeather,wetTyreResponse,puddleMask} from '../dist/weather.js';
import {normalizeLobbyRules,sanitizeWorldSnapshot,MULTIPLAYER_VERSION} from '../dist/multiplayer.js';
import {SpatialWorldAudio} from '../dist/audio/world.js';
import {createEffects} from '../dist/car.js';
import {WeatherRenderer} from '../dist/weather-renderer.js';
import {createAgent,setAgentPose,integrateAgent} from '../dist/traffic.js';
import * as THREE from '../dist/vendor/three.module.js';
const dt=1/120,checks=[],fixtures={};
const check=(name,fn)=>{fixtures[name]=fn();checks.push(name);console.log('PASS '+name);};
const neutral={transmission:'hpattern',manualClutch:true,clutch:1,gearRequest:0,assists:false};
function make(carId='hachi',wetness=0,depth=0){const p=new CarPhysics(MotorLab,resolveBuild({carId}));p.setGroundSampler((x,z)=>({height:0,grip:1,roughness:.001,material:'asphalt',wetness,waterDepth:typeof depth==='function'?depth(x,z):depth}));p.reset();return p;}
function moving(p,speed=25){p.state.vz=p.state.speed=p.state.forwardSpeed=speed;p._wheelOmega.fill(speed/p.wheelRadius);}
function run(p,seconds,input){for(let i=0;i<Math.round(seconds/dt);i++){p.update(dt,input);assert.ok([p.state.x,p.state.z,p.state.speed,p.state.yawRate,...p.state.wheelLoads].every(Number.isFinite));}}
check('Rain accumulates moisture, clearing preserves it then dries; queries and pause never advance the clock',()=>{
 const w=new RoadWeather();for(let i=0;i<120*120;i++)w.step(dt,'rain');assert.ok(w.rain>.99&&w.wetness>.95);const wet=w.snapshot();w.step(dt,'clear');assert.ok(w.wetness>.95);const paused=w.snapshot();w.step(0,'clear');assert.deepEqual(w.snapshot(),paused);
 const world={kind:'city',getSurfaceAt:(x,z)=>({height:3,grip:1,material:'asphalt'})};w.bindWorld(world);w.bindWorld(world);for(let i=0;i<100;i++)world.getSurfaceAt(i,i);assert.deepEqual(w.snapshot(),paused);assert.equal(world.getSurfaceAt(0,0).height,3);assert.equal(world.getSurfaceAt(0,0).grip,1);
 const shelter=w.surface({height:0,material:'asphalt',weatherExposed:false},4,3);assert.equal(shelter.wetness,0);assert.equal(shelter.waterDepth,0);world.kind='showroom';assert.equal(world.getSurfaceAt(4,3).wetness,0);
 for(let i=0;i<600*30;i++)w.step(1/30,'clear');assert.equal(w.wetness,0);assert.ok(w.rain<1e-10);
 const w30=new RoadWeather(),w120=new RoadWeather();for(let i=0;i<280*30;i++)w30.step(1/30);for(let i=0;i<280*120;i++)w120.step(dt);assert.ok(Math.abs(w30.wetness-w120.wetness)<.001&&Math.abs(w30.rain-w120.rain)<.001);
 assert.deepEqual(normalizeWeather({elapsed:Infinity,rain:NaN,wetness:-5}),{elapsed:0,rain:0,wetness:0});return {wet,afterDry:w.snapshot(),dtDifference:w30.wetness-w120.wetness};
});
check('Wet friction depends on surface, tread, pressure, compound and water speed; no water gives a neutral multiplier',()=>{
 for(const material of ['asphalt','concrete','metal','gravel','grass'])assert.deepEqual(wetTyreResponse({material}),{grip:1,aquaplaning:0});
 const slow=wetTyreResponse({wetness:1,waterDepth:4,speed:15}),fast=wetTyreResponse({wetness:1,waterDepth:4,speed:42}),worn=wetTyreResponse({wetness:1,waterDepth:4,speed:32,tread:.1}),low=wetTyreResponse({wetness:1,waterDepth:4,speed:32,pressureBar:1}),street=wetTyreResponse({wetness:1,waterDepth:4,speed:32}),drift=wetTyreResponse({wetness:1,waterDepth:4,speed:32,compound:'drift'});
 assert.equal(slow.aquaplaning,0);assert.ok(fast.aquaplaning>.4&&fast.grip<slow.grip*.6);assert.ok(worn.grip<street.grip&&low.grip<street.grip&&drift.grip<street.grip);assert.ok(wetTyreResponse({wetness:1,material:'metal'}).grip<slow.grip);
 assert.ok(new Set(Array.from({length:100},(_,i)=>puddleMask(i,i*2).toFixed(2))).size>15);return {slow,fast,worn,low,street,drift};
});
check('All four original cars take longer to stop and turn less sharply on a wet road',()=>{
 const rows=[];for(const car of VEHICLES){const measurements=[];for(const wet of [0,1]){const p=make(car.id,wet);moving(p);let elapsed=0;while(p.state.speed>.2&&elapsed<15){p.update(dt,{...neutral,brake:1});elapsed+=dt;}assert.ok(elapsed<15);const distance=p.state.z;p.engine.dispose();
 const q=make(car.id,wet);moving(q);run(q,1.8,{...neutral,steer:.5});measurements.push({wet,distance,heading:Math.abs(q.state.heading),side:Math.abs(q.state.x),grip:q.state.suspension[0].wetGrip});q.engine.dispose();}
 assert.ok(measurements[1].distance>measurements[0].distance*1.15,JSON.stringify(measurements));assert.ok(measurements[1].heading<measurements[0].heading,JSON.stringify(measurements));rows.push({car:car.id,measurements});}return rows;
});
check('A one-sided puddle produces yaw and dissipates energy without adding rolling heat to the tyres',()=>{
 const rows=[];for(const depth of [0,4,(x)=>x<0?4:0]){const p=make('hachi',1,depth),conditionStep=p._updateCondition.bind(p);let rollingHeat=0;p._updateCondition=(dt,omega,work)=>{rollingHeat+=work.tyreRollingWorkJ.reduce((a,b)=>a+b,0);return conditionStep(dt,omega,work);};moving(p,45);run(p,.18,neutral);assert.equal(rollingHeat,0);rows.push({speed:p.state.speed,yaw:p.state.yawRate,wet:p.state.suspension.map(w=>w.aquaplaning),rollingHeat});p.engine.dispose();}
 assert.ok(rows[1].speed<rows[0].speed-.05);assert.ok(Math.abs(rows[2].yaw)>Math.abs(rows[0].yaw)+.01);assert.ok(rows[1].wet.every(v=>v>.6));return rows;
});
check('Wet contact cools tyres and rain audio continues with a stopped engine',()=>{
 const temps=[];for(const wet of [0,1]){const p=make('hachi',wet);p.condition.mechanical.temperatures.tyres.fill(120);run(p,2,{...neutral,brake:1});temps.push(p.condition.mechanical.temperatures.tyres[0]);p.engine.dispose();}assert.ok(temps[1]<temps[0]-3);
 const audio=new SpatialWorldAudio();audio.setContext({weather:{rain:1},worldActive:true,engineRunning:false});assert.ok(audio.hasSignal());let energy=0;for(let i=0;i<60;i++){const l=new Float32Array(960),r=new Float32Array(960);audio.renderInto(l,r,{active:true});energy+=l.reduce((a,v)=>a+v*v,0);}assert.ok(energy>.001);assert.ok(audio.diagnostics().ambience.rain>0);audio.clearTransients();assert.equal(audio.diagnostics().ambience.rain,0);return {temps,rainPCM:energy};
});
check('Spray and rain use bounded pools and do not emit tyre smoke on an ordinarily rolling wet wheel',()=>{
 const scene=new THREE.Scene(),p=make('hachi',1,3),fx=createEffects(scene,p.build);moving(p,20);run(p,.1,neutral);for(let i=0;i<30;i++)fx.update(p.state,1/60,i/60);const debug=fx.debug();assert.ok(debug.activeSpray>0);assert.equal(debug.activeSmoke,0);assert.ok(debug.activeParticles<=160);fx.reset();assert.equal(fx.debug().activeSpray,0);
 const weather=new RoadWeather({rain:1,wetness:1}),view=new WeatherRenderer(scene,weather);view.setWorld({kind:'city',root:new THREE.Group()});assert.equal(view.diagnostics().drops,0);for(const quality of ['low','medium','high']){view.update(p.state,{},2,quality);assert.equal(view.diagnostics().drops,{low:120,medium:240,high:360}[quality]);assert.ok(view.positions.every(Number.isFinite));}view.setWorld({kind:'showroom'});view.update(p.state,{},3);assert.equal(view.diagnostics().drops,0);view.dispose();p.engine.dispose();return debug;
});
check('Traffic traction and stopping respond to the same wet surface; network validates and preserves host weather',()=>{
 const rows=[];for(const wet of [0,1]){const city={getSurfaceAt:()=>({height:0,grip:1,material:'asphalt',wetness:wet,waterDepth:0})},car=createAgent('weather',0);setAgentPose(car,{x:0,z:0,heading:0},20,city);for(let i=0;i<120;i++)integrateAgent(car,{x:0,z:100,speed:0},dt,city);rows.push({speed:car.speed,z:car.z});}assert.ok(rows[1].speed>rows[0].speed+1);
 assert.equal(MULTIPLAYER_VERSION,18);assert.equal(normalizeLobbyRules({weather:'rain'}).weather,'rain');assert.equal(normalizeLobbyRules({weather:'bad'}).weather,'cycle');const snapshot=sanitizeWorldSnapshot({weather:{elapsed:71,rain:.8,wetness:.92}});assert.deepEqual(snapshot.weather,{elapsed:71,rain:.8,wetness:.92});const guest=new RoadWeather();guest.restore(snapshot.weather);assert.deepEqual(guest.snapshot(),snapshot.weather);assert.deepEqual(sanitizeWorldSnapshot({weather:{rain:999,wetness:-9}}).weather,{elapsed:0,rain:1,wetness:0});return rows;
});
const files=['dist/weather.js','dist/weather-renderer.js','dist/physics.js','dist/mechanical.js','dist/environment.js','dist/car.js','dist/audio.js','dist/audio/world.js','dist/main.js','dist/multiplayer.js','dist/traffic.js','dist/race.js'];
fs.writeFileSync(new URL('weather-v28-results.json',import.meta.url),JSON.stringify({version:28,status:'passed',checks,fixtures,sourceSHA256:Object.fromEntries(files.map(f=>[f,createHash('sha256').update(fs.readFileSync(new URL('../'+f,import.meta.url))).digest('hex')])),limits:['Fictional tyre and weather calibration; comparative tests do not establish real-car stopping distances.','Renderer pool checks here do not compile shaders; final HTML browser test covers rendering.']},null,2));
