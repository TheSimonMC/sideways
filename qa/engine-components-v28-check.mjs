import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import MotorLab from '../sdk/motor-engine.mjs';
import {CarPhysics} from '../dist/physics.js';
import {resolveBuild,VEHICLES,ENGINES} from '../dist/catalog.js';
import {MechanicalSystem} from '../dist/mechanical.js';
import {createVehicleCondition,snapshotVehicleCondition} from '../dist/vehicle-state.js';
import {GameAudio} from '../dist/audio.js';
const checks=[],fixtures={},dt=1/120,neutral={transmission:'hpattern',gearRequest:0,manualClutch:true,clutch:1,assists:false};
const check=(name,fn)=>{fixtures[name]=fn()??{};checks.push(name);console.log('PASS '+name);};
const drive=(p,seconds,input={})=>{for(let i=0;i<seconds*120;i++)p.update(dt,{...neutral,...input});};
const fixture=(patch={},build=resolveBuild())=>{const c=createVehicleCondition(build);Object.assign(c.mechanical.health,patch);return {c,m:new MechanicalSystem(build,c)};};
check('Old saves gain ten healthy components, existing damage survives, and new internal failures reload without damaging unrelated pistons.',()=>{
 const old=createVehicleCondition(resolveBuild(),{engineHealth:.4});assert.equal(old.mechanical.health.engineBlock,1);assert.equal(old.mechanical.health.pistons,.4);
 for(const id of ['engineBlock','cylinderHead','connectingRods','crankshaft','timingDrive']){const {c,m}=fixture({[id]:0});assert.equal(c.engineHealth,0);const copy=createVehicleCondition(resolveBuild(),JSON.parse(JSON.stringify(snapshotVehicleCondition(c))));const n=new MechanicalSystem(resolveBuild(),copy);assert.equal(copy.mechanical.health[id],0);assert.equal(copy.mechanical.health.pistons,1);assert.equal(copy.engineFault,c.engineFault);n.repair([id]);assert.equal(copy.engineFault,null);assert.equal(copy.engineHealth,1);m.repair(['ignition']);assert.equal(c.engineHealth,0);}
});
check('Engine swaps and inactive-car sanitization do not transfer piston-only failures to a rotary or invent failed pistons.',()=>{
 const b=resolveBuild(),rotary=resolveBuild({engineId:'rotary'}),{c}=fixture({timingDrive:0},b),save=snapshotVehicleCondition(c),copy=createVehicleCondition(rotary,save);new MechanicalSystem(rotary,copy);assert.equal(copy.engineFault,null);assert.equal(copy.mechanical.health.pistons,1);assert.equal(copy.mechanical.health.timingDrive,0);new MechanicalSystem(b,copy);assert.equal(copy.engineFault,'Timing drive failure');
});
check('All eight engine choices and four stock cars run; rotary diagnosis exposes housings and eccentric shaft without imaginary rods or timing chain.',()=>{
 for(const engine of ENGINES){const p=new CarPhysics(MotorLab,resolveBuild({engineId:engine.id}));drive(p,.5);assert.ok(p.state.engineRunning&&Number.isFinite(p.state.rpm),engine.id);assert.equal(p.engineState.controls.lambdaTarget,p._baseLambda);assert.equal(p.condition.engineHealth,1);p.engine.dispose();}
 const result=[];for(const car of VEHICLES){const p=new CarPhysics(MotorLab,resolveBuild({carId:car.id}));drive(p,.5);assert.ok(Number.isFinite(p.state.rpm)&&p.state.engineRunning);assert.equal(p.condition.engineHealth,1);assert.equal(p.engineState.controls.lambdaTarget,p._baseLambda);if(p.build.engine.rotors){for(const id of ['connectingRods','valvetrain','timingDrive'])assert.equal(p.state.mechanical.components.find(x=>x.id===id).applicable,false);assert.equal(p.state.mechanical.components.find(x=>x.id==='crankshaft').label,'Eccentric shaft');p.condition.mechanical.health.timingDrive=0;drive(p,.1);assert.equal(p.condition.engineFault,null);}result.push({car:car.id,rpm:p.state.rpm});p.engine.dispose();}return result;
});
check('Fuel pump and ignition failures cut native combustion and NOS without destroying internals; recovery, tuning and reload cannot bypass them.',()=>{
 for(const id of ['fuelPump','ignition']){const p=new CarPhysics(MotorLab,resolveBuild());p.condition.mechanical.health[id]=0;drive(p,.2,{throttle:1,boost:true,starter:true});assert.equal(p.engineState.controls.fuel,false);assert.equal(p.engineState.controls.ignition,false);assert.equal(p.state.engineRunning,false);assert.equal(p.state.nitrousTorque,0);assert.equal(p.condition.engineFault,null);p.reset();assert.equal(p.state.rpm,0);p.setBuild(resolveBuild({exhaust:'sport'}));assert.equal(p.state.rpm,0);const save=JSON.parse(JSON.stringify(p.exportGarageState()));p.restoreGarageState(save);assert.equal(p.state.rpm,0);p.repairComponents([id]);assert.equal(p.condition.mechanical.health.pistons,1);drive(p,2,{starter:true});assert.ok(p.state.engineRunning);p.engine.dispose();}
});
check('Crushed intake reduces native air admission and boost, fuel-pump wear leans the native mixture, and exhaust obstruction creates measured shaft load work.',()=>{
 const p=new CarPhysics(MotorLab,resolveBuild());Object.assign(p.condition.mechanical.health,{intake:.2,fuelPump:.35,exhaust:.2});drive(p,.5,{throttle:.7});assert.ok(p.engineState.controls.throttle<p.state.throttle*.4);assert.ok(p.engineState.controls.lambdaTarget>p._baseLambda+.2);assert.ok(p.state.mechanical.exhaustLoadNm>0);assert.ok(p.engineState.totals.loadWork>0);assert.ok(p.state.mechanical.intakeLeak>0&&p.state.mechanical.exhaustLeak>0);const before=p.condition.mechanical.health.intake;p.repairComponents(['exhaust']);assert.equal(p.condition.mechanical.health.intake,before);assert.equal(p.condition.mechanical.health.fuelPump,.35);const result={throttle:p.engineState.controls.throttle,lambda:p.engineState.controls.lambdaTarget,loadWork:p.engineState.totals.loadWork};p.engine.dispose();return result;
});
check('Cracked block and head leak independently; replacing the radiator or refilling does not heal either component.',()=>{
 const {c,m}=fixture({engineBlock:.3,cylinderHead:.4});m.step(dt,{omega:180,speed:15});assert.ok(m.effects.oilLeakLps>0&&m.effects.coolantLeakLps>0);assert.ok(c.mechanical.oilLitres<c.mechanical.oilCapacity);m.repair(['radiator','fluids']);assert.equal(c.mechanical.health.engineBlock,.3);assert.equal(c.mechanical.health.cylinderHead,.4);m.repair(['engineBlock']);assert.equal(c.mechanical.health.cylinderHead,.4);m.step(dt,{omega:180});assert.ok(m.effects.coolantLeakLps>0);
});
function thermal(thermostat){const {c,m}=fixture({thermostat});for(let i=0;i<120*600;i++)m.step(dt,{omega:250,speed:25,wallHeatJ:60000*dt,frictionJ:15000*dt});return {c,m};}
check('Stuck thermostat causes heat and subsequent internal damage; cooling repairs preserve that damage and fluid loss.',()=>{
 const good=thermal(1),bad=thermal(0);assert.ok(bad.c.mechanical.temperatures.engine>good.c.mechanical.temperatures.engine+20);assert.ok(bad.c.mechanical.health.cylinderHead<1);const before=bad.c.mechanical.health.cylinderHead,fluid=bad.c.mechanical.coolantLitres;bad.m.repair(['thermostat']);assert.equal(bad.c.mechanical.health.cylinderHead,before);assert.equal(bad.c.mechanical.coolantLitres,fluid);return {healthy:good.c.mechanical.temperatures.engine,failed:bad.c.mechanical.temperatures.engine,headHealth:before};
});
check('Oil starvation and mechanical overrev damage crank and chain; a broken chain damages valves while turning, and chain replacement cannot repair them.',()=>{
 const {c,m}=fixture({timingDrive:0});for(let i=0;i<120;i++)m.step(dt,{omega:300});assert.ok(c.mechanical.health.valvetrain<.5);assert.ok(c.mechanical.health.pistons<1);const valves=c.mechanical.health.valvetrain;m.repair(['timingDrive']);assert.equal(c.mechanical.health.valvetrain,valves);
 const dry=fixture();dry.c.mechanical.oilLitres=0;for(let i=0;i<240;i++)dry.m.step(dt,{omega:500});assert.ok(dry.c.mechanical.health.crankshaft<1&&dry.c.mechanical.health.timingDrive<1);
 const fast=fixture();for(let i=0;i<360;i++)fast.m.step(dt,{omega:1200});assert.ok(fast.c.mechanical.health.connectingRods<.9&&fast.c.mechanical.health.crankshaft<.9);
 const frozen=fixture();const initial=JSON.stringify(frozen.c.mechanical.health);for(let i=0;i<120;i++)frozen.m.step(dt,{omega:1200},false);assert.equal(JSON.stringify(frozen.c.mechanical.health),initial);
});
check('Front impacts damage the engine and manifold; rear impacts preserve the manifold; diagnostic rows and warning messages name the faulty component.',()=>{
 const f=fixture(),r=fixture();f.m.impact({damage:.7,front:1,local:{x:0},closing:25});r.m.impact({damage:.7,front:0,local:{x:0},closing:25});assert.ok(f.c.mechanical.health.intake<r.c.mechanical.health.intake);assert.ok(f.c.mechanical.health.exhaust<r.c.mechanical.health.exhaust);assert.equal(r.c.mechanical.health.exhaust,1);assert.ok(f.m.diagnostics.warnings.some(w=>w.id==='intake-fault'));assert.ok(f.m.diagnostics.components.find(p=>p.id==='engineBlock').health<1);
});
check('Damaged intake and exhaust produce separate PCM targets tied to running state and mechanical volume; reset clears them.',()=>{
 const p=new CarPhysics(MotorLab,resolveBuild()),a=new GameAudio({pcmEnabled:true});a.setBuild(p.build);p.condition.mechanical.health.intake=.3;p.condition.mechanical.health.exhaust=.2;drive(p,.1);a.update(p.state);a.advanceEngine(p.engine,dt);assert.ok(a._intakeLeakTarget>0&&a._exhaustLeakTarget>0);a.mix.mechanical=0;a.advanceEngine(p.engine,dt);assert.equal(a._intakeLeakTarget,0);assert.equal(a._exhaustLeakTarget,0);assert.ok(Number.isFinite(a.getDiagnostics().outputPeak));a._resetAcoustics();assert.equal(a._exhaustLeakGain,0);p.engine.dispose();
});
const files=['dist/mechanical.js','dist/physics.js','dist/audio.js','dist/vehicle-state.js'];
fs.writeFileSync(new URL('./engine-components-v28-results.json',import.meta.url),JSON.stringify({version:28,status:'passed',checks,fixtures,sourceSHA256:Object.fromEntries(files.map(f=>[f,createHash('sha256').update(fs.readFileSync(f)).digest('hex')])),limits:['Lumped component model, not finite-element or calibrated real-car damage.','Timing loss uses misfires, valve-contact damage and combustion cut; no new tooth-by-tooth chain solver.','Exhaust restriction uses the native dissipative crank-load channel. Internal parts share engine/oil thermal nodes.']},null,2)+'\n');
