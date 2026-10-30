import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {GameAudio} from '../dist/audio.js';
import MotorLab from '../sdk/motor-engine.mjs';
import * as THREE from '../dist/vendor/three.module.js';
import {resolveBuild,ENGINES,VEHICLES,PARTS} from '../dist/catalog.js';
import {INDUCTION_PARTS,INDUCTION_PRICES} from '../dist/forced-induction.js';
import {advanceInduction} from '../dist/induction-drive.js';
import {CarPhysics} from '../dist/physics.js';
import {createCar} from '../dist/car.js';
import {Career} from '../dist/career.js';
import {sanitizeNetworkPose,MULTIPLAYER_VERSION} from '../dist/multiplayer.js';
const dt=1/120,checks=[],fixtures={},check=(name,fn)=>{fixtures[name]=fn()??{};checks.push(name);console.log('PASS '+name);};
function dyno(build,condition={active:true,charged:true,drive:1,flow:1,efficiency:1,friction:1,coolerHealth:1}){
 const engine=MotorLab.createEngine(build.physics.engineOptions);let s=engine.getState();
 engine.setInputs({fuel:true,ignition:true,starter:false,throttle:1,boostTarget:build.physics.boostTarget});
 const run=(change={},seconds=1)=>{Object.assign(condition,change);const start=s.time,work=s.totals.compressorShaftWork;
  for(let i=0;i<Math.round(seconds/dt);i++){engine.applyShaftImpulse((3500*Math.PI/30-s.omega)*s.config.inertia);engine.setInputs({bypass:1-condition.drive});s=advanceInduction(engine,condition,()=>engine.update(dt));}
  assert.ok(Math.abs(s.time-start-seconds)<1e-6);assert.ok(Number.isFinite(s.meanTorque));assert.equal(engine.getState().config.superchargerRatio,build.physics.engineOptions.overrides.superchargerRatio);
  return {bar:(s.intake.p-s.config.ambientP)/1e5,rpm:s.boost.rpm,torque:s.meanTorque,shaftTorque:s.superchargerTorque,work:s.totals.compressorShaftWork-work,chargeC:s.charge.T-273.15,time:s.time};
 };return {engine,run};
}
check('56 priced categories preserve factory builds and prevent turbo/blower stacking or unfitted charge coolers.',()=>{
 assert.equal(Object.keys(PARTS).length,56);assert.equal(MULTIPLAYER_VERSION,21);
 for(const e of ENGINES){const b=resolveBuild({engineId:e.id});assert.equal(b.physics.induction.supercharged,false);assert.equal(b.physics.induction.mass,0);assert.equal(b.engine.name,e.name);}
 assert.equal(resolveBuild({supercharger:'race'}).selection.supercharger,'stock');assert.equal(resolveBuild({engineId:'i4',chargeCooler:'race'}).selection.chargeCooler,'stock');
 for(const [k,parts]of Object.entries(INDUCTION_PARTS))for(const p of parts)assert.ok(Number.isFinite(INDUCTION_PRICES[k][p.id]));
 const a=resolveBuild({engineId:'i4'}),b=resolveBuild({engineId:'i4',supercharger:'street',chargeCooler:'race'});assert.ok(b.physics.mass>a.physics.mass+25);assert.ok(b.physics.cgHeight>a.physics.cgHeight);assert.ok(b.audio.boost>0);assert.match(b.engine.subtitle,/SUPERCHARGED/);
 const c=new Career();c.wallet=100000;const q=c.quote(b);assert.ok(c.purchase(b).ok);assert.equal(c.wallet,100000-q.total);assert.equal(new Career(c.serialize(),b.selection).quote(b).total,0);return {charged:q.total,massAdded:b.physics.mass-a.physics.mass};
});
check('All seven NA engines produce native blower pressure/work; a snapped belt stops rotors and shaft work, repair recovers pressure on the same clock.',()=>{
 const results={};for(const e of ENGINES.filter(e=>!e.turbo)){const b=resolveBuild({engineId:e.id,supercharger:'street'}),d=dyno(b);try{
  const healthy=d.run({},2),slipping=d.run({drive:.4}),broken=d.run({drive:0}),fixed=d.run({drive:1});
  assert.ok(healthy.bar>.20&&healthy.bar<.7,e.id+': '+healthy.bar);assert.ok(healthy.work>100&&healthy.shaftTorque>0);assert.ok(slipping.bar<healthy.bar-.1);assert.equal(broken.rpm,0);assert.equal(broken.work,0);assert.equal(broken.shaftTorque,0);assert.ok(broken.bar<.05);assert.ok(fixed.bar>.2);
  const saved=d.engine.save();d.engine.load(saved);assert.ok(Math.abs(d.engine.getState().time-fixed.time)<1e-8);results[e.id]={healthy,slipping,broken,fixed};
 }finally{d.engine.dispose();}}return results;
});
check('Charge cooler hardware and damage change native gas temperature; high-output hardware produces more boost and shaft load.',()=>{
 const results=[];for(const [supercharger,chargeCooler,health]of [['street','stock',1],['race','stock',1],['race','race',1],['race','race',0]]){const d=dyno(resolveBuild({engineId:'i4',supercharger,chargeCooler}));try{results.push(d.run({coolerHealth:health},2));}finally{d.engine.dispose();}}
 assert.ok(results[1].bar>results[0].bar+.2);assert.ok(results[1].shaftTorque>results[0].shaftTorque);assert.ok(results[2].chargeC<results[1].chargeC-3);assert.ok(results[3].chargeC>results[2].chargeC+10);return results;
});
check('Actual physics shares belt failure with cooling/charging, persists individual faults, repairs only requested parts and uses the PCM advance callback once.',()=>{
 const b=resolveBuild({engineId:'i4',supercharger:'street',chargeCooler:'sport'}),p=new CarPhysics(MotorLab,b);try{
  const input={throttle:.6,clutch:1,manualClutch:true,transmission:'hpattern',gearRequest:0};for(let i=0;i<30;i++)p.update(dt,input);
  let calls=0;p._advanceEngine=(engine,step)=>{calls++;return engine.update(step);};p.update(dt,input);assert.equal(calls,1);
  p.condition.mechanical.health.supercharger=0;p.condition.mechanical.health.chargeCooler=.2;const before=p.engineState.time,beltBefore=p.condition.mechanical.auxiliaries.health.accessoryBelt;
  for(let i=0;i<15;i++)p.update(dt,input);assert.equal(p.state.induction.rpm,0);assert.equal(p.state.mechanical.auxiliaries.beltDrive,0);assert.equal(p.state.mechanical.auxiliaries.generatorA,0);assert.ok(p.condition.mechanical.auxiliaries.health.accessoryBelt<beltBefore);assert.ok(p.condition.mechanical.auxiliaries.temperatures.belt>24);assert.ok(p.engineState.time>before);
  const saved=JSON.parse(JSON.stringify(p.exportGarageState()));p.restoreGarageState(saved);assert.equal(p.condition.mechanical.health.supercharger,0);p.repairComponents(['supercharger']);assert.equal(p.condition.mechanical.health.supercharger,1);assert.equal(p.condition.mechanical.health.chargeCooler,.2);
  p.condition.mechanical.auxiliaries.health.accessoryBelt=0;for(let i=0;i<30;i++)p.update(dt,input);assert.equal(p.state.induction.rpm,0);p.repairComponents(['accessoryBelt']);for(let i=0;i<30;i++)p.update(dt,input);assert.ok(p.state.induction.rpm>0);assert.ok(p.condition.mechanical.energy.superchargerHeatJ>0);assert.ok(p.condition.mechanical.energy.chargeCoolerHeatJ>0);
  const clock=p.engineState.time;assert.throws(()=>advanceInduction(p.engine,{charged:true,active:true,drive:0,flow:.5,efficiency:.5,friction:2,coolerHealth:.2},()=>{throw Error('fixture');}),/fixture/);assert.equal(p.engine.getState().config.superchargerRatio,b.physics.engineOptions.overrides.superchargerRatio);assert.equal(p.engineState.time,clock);
  const net=sanitizeNetworkPose({...p.state,induction:{...p.state.induction,rpm:Infinity,drive:-2,health:NaN,extra:'discard'}});assert.equal(net.induction.rpm,0);assert.equal(net.induction.drive,0);assert.equal(net.induction.health,0);assert.equal(net.induction.extra,undefined);return {clock,heat:p.condition.mechanical.energy,belt:p.condition.mechanical.auxiliaries.temperatures.belt};
 }finally{p.engine.dispose();}
});
check('Native PCM owns the same shaft clock and remains finite through belt failure and recovery.',()=>{
 const b=resolveBuild({engineId:'i4',supercharger:'street'}),p=new CarPhysics(MotorLab,b);let frames=0,energy=0;
 const audio=new GameAudio({pcmEnabled:true,onPCM:(l,r)=>{frames+=l.length;for(const v of [...l,...r]){assert.ok(Number.isFinite(v));energy+=v*v;}}});audio.setBuild(b);p._advanceEngine=(e,dt)=>audio.advanceEngine(e,dt);
 try{const start=p.engineState.time,input={throttle:.5,clutch:1,manualClutch:true,transmission:'hpattern',gearRequest:0};for(let i=0;i<60;i++){if(i===20)p.condition.mechanical.auxiliaries.health.accessoryBelt=0;if(i===40)p.repairComponents(['accessoryBelt']);audio.update(p.state);p.update(dt,input);if(i===39)assert.equal(p.state.induction.rpm,0);}assert.ok(Math.abs(p.engineState.time-start-.5)<.0001);assert.equal(frames,24000);assert.ok(energy>0);assert.ok(p.state.induction.rpm>0);return {frames,energy,clock:p.engine.getTiming().clock};}finally{p.engine.dispose();}
});
check('Blower, pulley, belt and cooling hardware fit all four bodies; broken belts disappear and rotors follow actual telemetry.',()=>{
 const old=globalThis.document;globalThis.document={createElement:()=>({getContext:()=>({fillText(){},fillRect(){}})})};const results={};try{for(const v of VEHICLES){const b=resolveBuild({carId:v.id,engineId:'v8',supercharger:'race',chargeCooler:'race'}),car=createCar(new THREE.Scene(),b);try{
  car.update({rpm:2000,induction:{rpm:3400,beltHealth:1}},dt,0);const a=car.inductionDiagnostics();assert.ok(a.fitted&&a.cooler&&a.meshes<45);assert.ok(a.housingTop<a.top);const crank=car.group.getObjectByName('blower-crank-pulley');assert.ok(crank.position.y-.065>.21,'Crank pulley clears the bay floor');const block=car.group.getObjectByName('engine-block-foundation');assert.ok(crank.position.z>block.position.z+block.geometry.parameters.depth/2,'Drive clears the block front');assert.ok(a.blowerAngle>0);car.update({rpm:2000,induction:{rpm:0,beltHealth:0}},dt,dt);const next=car.inductionDiagnostics();assert.equal(next.blowerAngle,a.blowerAngle);assert.equal(next.beltVisible,false);assert.notEqual(next.crankAngle,a.crankAngle);car.group.traverse(n=>{if(n.geometry?.attributes.position)assert.ok(n.geometry.attributes.position.array.every(Number.isFinite));});results[v.id]=next;
 }finally{car.dispose();}}}finally{globalThis.document=old;}return results;
});
const files=['forced-induction','induction-drive','induction-view','catalog','career','garage','mechanical','engine-auxiliaries','physics','audio','multiplayer','car','main'];
fs.writeFileSync(new URL('forced-induction-v32-results.json',import.meta.url),JSON.stringify({version:32,status:'passed',checks,fixtures,sourceSHA256:Object.fromEntries(files.map(n=>['dist/'+n+'.js',createHash('sha256').update(fs.readFileSync(new URL('../dist/'+n+'.js',import.meta.url))).digest('hex')])),limits:['Fictional belt, thermal and wear calibration; not a real vehicle specification.','Pinned private MotorLab 1.6.3 coefficient adapter, requiring revalidation before SDK upgrades.','Component mount removal and detailed engine internals remain Phase 6 work.']},null,2)+'\n');
