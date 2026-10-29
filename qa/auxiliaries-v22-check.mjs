import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import MotorLab from '../sdk/motor-engine.mjs';
import {CarPhysics} from '../dist/physics.js';
import {resolveBuild,VEHICLES} from '../dist/catalog.js';
import {MechanicalSystem} from '../dist/mechanical.js';
import {createVehicleCondition,snapshotVehicleCondition} from '../dist/vehicle-state.js';
import {createAuxiliaries,auxiliaryResponse,stepAuxiliaries,repairAuxiliary} from '../dist/engine-auxiliaries.js';
import * as THREE from '../dist/vendor/three.module.js';
import {createCar} from '../dist/car.js';
import {GameAudio} from '../dist/audio.js';
const checks=[],fixtures={},dt=1/120,neutral={transmission:'hpattern',gearRequest:0,manualClutch:true,clutch:1,assists:false};
const check=(name,fn)=>{fixtures[name]=fn()??{};checks.push(name);console.log('PASS '+name);};
const drive=(p,seconds,input={})=>{for(let i=0;i<seconds*120;i++)p.update(dt,{...neutral,...input});};
const stop=p=>{p.engine.stop();p.engine.applyShaftImpulse(-p.engine.getState().omega*p.engine.getState().config.inertia);p._omega=0;p._stalled=true;p.engineState=p.engine.getState();p.state.rpm=0;p.state.engineRunning=false;};
check('Old saves gain healthy auxiliaries without healing previous damage; nested snapshots are independent and malformed inputs are sanitized.',()=>{
 const c=createVehicleCondition(resolveBuild(),{engineHealth:.4}),s=snapshotVehicleCondition(c);assert.equal(c.engineHealth,.4);assert.equal(c.mechanical.auxiliaries.charge,.85);s.mechanical.auxiliaries.health.battery=0;s.mechanical.auxiliaries.temperatures.belt=300;assert.equal(c.mechanical.auxiliaries.health.battery,1);assert.equal(c.mechanical.auxiliaries.temperatures.belt,24);assert.equal(createAuxiliaries(null).charge,.85);assert.equal(createAuxiliaries({charge:NaN}).charge,.85);
});
check('Pure observations do not consume charge; actual loads consume amp-hours and alternator speed and belt drive determine charging.',()=>{
 const a=createAuxiliaries(),initial=JSON.stringify(a);for(let i=0;i<100;i++)auxiliaryResponse(a,{omega:200,headlights:true});assert.equal(JSON.stringify(a),initial);
 const off=auxiliaryResponse(a,{omega:0,headlights:false}),lights=auxiliaryResponse(a,{omega:0,headlights:true});assert.equal(off.netA,-5);assert.equal(lights.netA,-15);stepAuxiliaries(a,60,lights);assert.ok(Math.abs(a.charge-(.85-15/60/60))<1e-12);
 const running=auxiliaryResponse(a,{omega:250,headlights:true});assert.ok(running.netA>0&&running.loadTorque>0);stepAuxiliaries(a,60,running);assert.ok(a.chargedAh>0);a.health.accessoryBelt=0;const snapped=auxiliaryResponse(a,{omega:250});assert.equal(snapped.beltDrive,0);assert.equal(snapped.generatorA,0);return {off,lights,running};
});
check('All four native engines can crank after stopping; an empty or failed battery and failed starter prevent cranking without fabricating crank speed.',()=>{
 const out=[];for(const car of VEHICLES){const p=new CarPhysics(MotorLab,resolveBuild({carId:car.id}));stop(p);drive(p,2,{starter:true});assert.ok(p.state.rpm>250,car.id+' healthy starter');const rpm=p.state.rpm;
  for(const fault of ['empty','battery','starterMotor']){p.restart();stop(p);const a=p.condition.mechanical.auxiliaries;if(fault==='empty')a.charge=0;else a.health[fault]=0;drive(p,2,{starter:true});assert.equal(p.state.starterActive,false);assert.equal(p.engineState.controls.starter,false);assert.ok(p.state.rpm<30,car.id+' '+fault);assert.equal(p.condition.engineFault,null);}
  out.push({car:car.id,rpm});p.engine.dispose();}return out;
});
check('Weak battery voltage or worn starter reduces native cranking speed, and prolonged cranking heats and wears that starter.',()=>{
 const out=[];for(const health of [1,.25]){const p=new CarPhysics(MotorLab,resolveBuild());p.condition.fuelLitres=0;stop(p);p.condition.mechanical.auxiliaries.health.starterMotor=health;drive(p,2,{starter:true});out.push(p.state.rpm);assert.ok(p.condition.mechanical.auxiliaries.dischargedAh>0);p.engine.dispose();}assert.ok(out[1]<out[0]*.8);
 const a=createAuxiliaries();a.temperatures.starter=180;const e=auxiliaryResponse(a,{starterRequested:true});stepAuxiliaries(a,1,e,true);assert.ok(a.health.starterMotor<1);return {rpm:out,temperature:a.temperatures.starter};
});
check('Electrical loss cuts real combustion and lamps without destroying the engine; component charging and replacement repair only the selected fault.',()=>{
 const p=new CarPhysics(MotorLab,resolveBuild());p.condition.mechanical.auxiliaries.health.alternator=0;p.condition.mechanical.auxiliaries.charge=0;drive(p,2,{headlights:true});assert.equal(p.state.engineRunning,false);assert.ok(p.state.rpm<50);assert.equal(p.state.mechanical.auxiliaries.lampFactor,0);assert.equal(p.condition.engineFault,null);
 const health=JSON.stringify(p.condition.mechanical.health);p.repairComponents(['batteryCharge']);assert.equal(p.condition.mechanical.auxiliaries.charge,1);assert.equal(p.condition.mechanical.auxiliaries.health.alternator,0);assert.equal(JSON.stringify(p.condition.mechanical.health),health);drive(p,2,{starter:true});assert.ok(p.state.rpm>250);
 p.condition.mechanical.auxiliaries.health.battery=0;p.condition.mechanical.auxiliaries.charge=.1;assert.equal(p.repairComponents(['batteryCharge']).repaired,false);p.repairComponents(['battery']);assert.equal(p.condition.mechanical.auxiliaries.charge,1);assert.equal(p.condition.mechanical.auxiliaries.health.alternator,0);p.engine.dispose();
});
check('Recovery, build changes and garage saves retain electrical damage and charge; a new run repairs auxiliaries.',()=>{
 const p=new CarPhysics(MotorLab,resolveBuild());p.condition.mechanical.auxiliaries.charge=0;p.condition.mechanical.auxiliaries.health.radiatorFan=.2;p.reset();assert.equal(p.state.rpm,0);p.setBuild(resolveBuild({exhaust:'sport'}));assert.equal(p.condition.mechanical.auxiliaries.charge,0);assert.equal(p.state.rpm,0);const garage=JSON.parse(JSON.stringify(p.exportGarageState())),q=new CarPhysics(MotorLab,resolveBuild());q.restoreGarageState(garage);assert.equal(q.state.rpm,0);assert.equal(q.condition.mechanical.auxiliaries.health.radiatorFan,.2);q.restart();assert.equal(q.condition.mechanical.auxiliaries.health.radiatorFan,1);assert.ok(q.state.rpm>250);p.engine.dispose();q.engine.dispose();
});
function thermal(fault,speed=0){const build=resolveBuild(),c=createVehicleCondition(build);if(fault)c.mechanical.auxiliaries.health[fault]=0;const m=new MechanicalSystem(build,c);for(let i=0;i<120*180;i++)m.step(dt,{omega:1800*Math.PI/30,speed,gear:0,wallHeatJ:30000*dt,frictionJ:5000*dt},false);return {engine:c.mechanical.temperatures.engine,coolant:c.mechanical.temperatures.coolant};}
check('A failed fan loses stationary cooling; road airflow still cools it; a broken accessory belt stops the water pump.',()=>{
 const healthy=thermal(),fan=thermal('radiatorFan'),moving=thermal('radiatorFan',25),belt=thermal('accessoryBelt');assert.ok(fan.engine>healthy.engine+5);assert.ok(moving.engine<fan.engine-5);assert.ok(belt.engine>healthy.engine+20);return {healthy,fan,moving,belt};
});
check('Tensioner damage creates rotational slip, belt heat and wear; no rotation and damage-off cannot wear the belt.',()=>{
 const a=createAuxiliaries();a.health.beltTensioner=.15;for(let i=0;i<120*120;i++)stepAuxiliaries(a,dt,auxiliaryResponse(a,{omega:400}),true);assert.ok(a.health.accessoryBelt<.999);assert.ok(a.temperatures.belt>30);const before=a.health.accessoryBelt;for(let i=0;i<120;i++)stepAuxiliaries(a,dt,auxiliaryResponse(a,{omega:0}),true);assert.equal(a.health.accessoryBelt,before);for(let i=0;i<120;i++)stepAuxiliaries(a,dt,auxiliaryResponse(a,{omega:400}),false);assert.equal(a.health.accessoryBelt,before);repairAuxiliary(a,'accessoryBelt');assert.equal(a.health.beltTensioner,.15);return {before,temperature:a.temperatures.belt};
});
check('Diagnosis exposes voltage, charge and distinct repair actions; actual car lamp materials follow electrical power.',()=>{
 const p=new CarPhysics(MotorLab,resolveBuild());p.condition.mechanical.auxiliaries.charge=0;p.condition.mechanical.auxiliaries.health.alternator=0;p.reset();drive(p,.1,{headlights:true});const row=p.state.mechanical.components.find(c=>c.id==='batteryCharge');assert.equal(row.action,'CHARGE');assert.equal(row.serviceNeeded,true);assert.ok(row.reason.includes('V'));assert.ok(p.state.mechanical.warnings.some(w=>w.id==='battery-low'));
 const originalDocument=globalThis.document;globalThis.document={createElement:()=>({getContext:()=>({fillRect(){},fillText(){}})})};const car=createCar(new THREE.Scene(),p.build);car.update({...p.state,headlights:true});let lights=[];car.group.traverse(n=>{if(n.material?.emissive?.getHex()===0xd2eaff)lights.push(n.material.emissiveIntensity);});assert.ok(lights.length>0);assert.ok(lights.every(n=>n===0));p.repairComponents(['batteryCharge']);drive(p,.1);car.update({...p.state,headlights:true});lights=[];car.group.traverse(n=>{if(n.material?.emissive?.getHex()===0xd2eaff)lights.push(n.material.emissiveIntensity);});assert.ok(lights.every(n=>n>2));car.dispose();globalThis.document=originalDocument;p.engine.dispose();
});
check('Fan and slipping belt produce mechanical PCM targets only when their real states are active; mechanical mute disables both.',()=>{
 const p=new CarPhysics(MotorLab,resolveBuild()),audio=new GameAudio({pcmEnabled:true});audio.setBuild(p.build);const s={...p.state,mechanical:{...p.state.mechanical,auxiliaries:{fan:1,beltSlip:.8,beltDrive:.5}}};audio.update(s);audio.advanceEngine(p.engine,dt);assert.ok(audio._fanTarget>0&&audio._beltTarget>0);audio.mix.mechanical=0;audio.advanceEngine(p.engine,dt);assert.equal(audio._fanTarget,0);assert.equal(audio._beltTarget,0);for(let i=0;i<8;i++)audio.advanceEngine(p.engine,1/60);assert.ok(Number.isFinite(audio.getDiagnostics().outputPeak));audio._resetAcoustics();p.engine.dispose();
});
const files=['engine-auxiliaries','physics','mechanical','vehicle-state','car','environment','audio','main'];
fs.writeFileSync(new URL('./auxiliaries-v22-results.json',import.meta.url),JSON.stringify({status:'passed',version:22,checks,fixtures,sourceSHA256:Object.fromEntries(files.map(n=>{const f='dist/'+n+'.js';return [f,createHash('sha256').update(fs.readFileSync(f)).digest('hex')];})),limits:['Fictional lumped 12 V model, not vehicle-certified electrical calibration.','No visible engine bay yet; Phase 6 remains open.','Starter torque loss uses native crank load; alternator losses are kept out of engine/oil load heat.']},null,2)+'\n');
