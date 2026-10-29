import assert from 'node:assert/strict';
import fs from 'node:fs';
import MotorLab from '../sdk/motor-engine.mjs';
import {CarPhysics} from '../dist/physics.js';
import {GameAudio} from '../dist/audio.js';
import {resolveBuild} from '../dist/catalog.js';
const dt=1/120,report={status:'pending',scope:'Real MotorLab crank, finite wheel/clutch impulses, persistent damage and manual/PCM clock boundary.',checks:[],fixtures:{}};
const make=selection=>new CarPhysics(MotorLab,resolveBuild(selection));
const neutral={transmission:'hpattern',manualClutch:true,clutch:1,gearRequest:0,assists:false};
function run(p,seconds,input){let maxRpm=0,maxTorque=0;for(let i=0;i<Math.round(seconds/dt);i++){p.update(dt,input);for(const key of ['rpm','speed','x','z','clutchTorque','engineHealth','fuelLitres'])assert.ok(Number.isFinite(p.state[key]),key);maxRpm=Math.max(maxRpm,p.state.rpm);maxTorque=Math.max(maxTorque,Math.abs(p.state.clutchTorque));}return {maxRpm,maxTorque};}
function moving(p,speed,gear){Object.assign(p.state,{vx:0,vz:speed,speed,forwardSpeed:speed,gear,requestedGear:gear});p._wheelOmega.fill(speed/p.wheelRadius);const omega=speed/p.wheelRadius*p._ratio(gear);p.engine.applyShaftImpulse((omega-p.engine.getState().omega)*p.engine.getState().config.inertia);p._omega=omega;p.engineState=p.engine.getState();p.state.rpm=omega*30/Math.PI;p._autoEngagement=1;}
function check(name,fn){const data=fn();report.checks.push(name);if(data)report.fixtures[name]=data;console.log('PASS '+name);}
check('A held partial clutch heats from measured slip work; reset, car switching and serialization preserve the hot worn plate.',()=>{
 const p=make();run(p,30,{transmission:'hpattern',manualClutch:true,clutch:.6,gearRequest:1,throttle:1,brake:1,handbrake:1,assists:false});
 assert.equal(p.state.speed,0);assert.ok(p.state.rpm>4000);assert.ok(p.state.clutchTemperature>300);assert.ok(p.condition.mechanical.energy.clutchJ>3e6);assert.ok(p.condition.mechanical.health.clutch<.95);assert.ok(p.state.mechanical.clutchCapacityFactor<.9);
 const hot=p.getCondition();p.reset(12,34,.5);assert.deepEqual(p.getCondition().mechanical.temperatures,hot.mechanical.temperatures);assert.equal(p.condition.mechanical.health.clutch,hot.mechanical.health.clutch);
 p.setBuild(resolveBuild({carId:'atlas'}));p.setBuild(resolveBuild());assert.equal(p.state.clutchTemperature,hot.mechanical.temperatures.clutch);
 const copy=make();copy.restoreGarageState(JSON.parse(JSON.stringify(p.exportGarageState())));assert.equal(copy.state.clutchTemperature,hot.mechanical.temperatures.clutch);assert.equal(copy.condition.mechanical.health.clutch,hot.mechanical.health.clutch);
 const oldHealth=copy.condition.mechanical.health.clutch;run(copy,1,neutral);assert.ok(copy.state.clutchTemperature<hot.mechanical.temperatures.clutch);assert.equal(copy.condition.mechanical.health.clutch,oldHealth);
 const fixture={rpm:p.state.rpm,clutchC:hot.mechanical.temperatures.clutch,health:hot.mechanical.health.clutch,workJ:hot.mechanical.energy.clutchJ};p.engine.dispose();copy.engine.dispose();return fixture;
});
check('A forced downshift exceeds the native fuel limiter and separately damages valves, pistons and the selected gear.',()=>{
 const p=make();moving(p,58,6);const sample=run(p,1.3,{transmission:'hpattern',manualClutch:true,clutch:0,gearRequest:1,assists:false});
 assert.equal(p.state.gear,1);assert.ok(sample.maxRpm>p.engineState.config.revLimitRpm*1.2);assert.ok(p.condition.mechanical.health.valvetrain<.99); /* More than 1% measured valve damage; V15 sliding tyres reduce transmitted overrev work. */assert.ok(p.condition.mechanical.health.pistons<1);assert.ok(p.condition.mechanical.gearHealth[1]<1);assert.equal(p.condition.mechanical.gearHealth[2],1);
 const open=make();moving(open,58,6);run(open,1.3,{transmission:'hpattern',manualClutch:true,clutch:1,gearRequest:1,assists:false});assert.equal(open.condition.engineHealth,1);assert.equal(open.condition.mechanical.gearHealth[1],1);assert.equal(open.condition.mechanical.health.valvetrain,1);
 const fixture={maxRpm:sample.maxRpm,limiter:p.engineState.config.revLimitRpm,health:p.getCondition().mechanical.health,gear1:p.condition.mechanical.gearHealth[1]};p.engine.dispose();open.engine.dispose();return fixture;
});
check('A stripped selected gear or broken driveshaft removes propulsion; selecting an intact gear restores that path.',()=>{
 const p=make(),saved=p.getCondition();saved.mechanical.gearHealth[1]=0;p.restoreCondition(saved);
 run(p,1,{transmission:'sequential',gearRequest:1,throttle:1});assert.equal(p.state.speed,0);assert.equal(p.state.clutchTorque,0);assert.ok(p.state.rpm>3000);assert.ok(p.state.mechanical.warnings.some(w=>w.id==='drive-failure'));
 run(p,2,{transmission:'sequential',gearRequest:2,throttle:1});assert.ok(p.state.speed>3);assert.ok(Math.abs(p.state.clutchTorque)>1);
 const shaft=make(),broken=shaft.getCondition();broken.mechanical.health.driveshaft=0;shaft.restoreCondition(broken);run(shaft,1,{transmission:'sequential',gearRequest:3,throttle:1,boost:true});assert.equal(shaft.state.speed,0);assert.equal(shaft.state.clutchTorque,0);assert.ok(shaft.state.nitrousTorque>=0);
 const fixture={intactGearSpeed:p.state.speed,brokenShaftSpeed:shaft.state.speed};p.engine.dispose();shaft.engine.dispose();return fixture;
});
check('Selective engine repair releases PCM ownership safely and resumes exactly one native clock without repairing coolant leaks.',()=>{
 const p=make(),audio=new GameAudio({pcmEnabled:true});audio.setBuild(p.build);p.setEngineAdvance((engine,step)=>audio.advanceEngine(engine,step));
 const broken=p.getCondition();broken.mechanical.health.pistons=0;broken.mechanical.health.radiator=.2;broken.mechanical.oilLitres=3;broken.fuelLitres=18;broken.boost=.2;p.restoreCondition(broken);
 run(p,.1,neutral);assert.equal(p.engine.getTiming().clock,'pcm');assert.ok(p.state.engineFault);const fuel=p.state.fuelLitres,nos=p.state.boost,oil=p.condition.mechanical.oilLitres;
 const result=p.repairComponents(['pistons']);assert.equal(result.repaired,true);assert.equal(p.engine.getTiming().clock,'manual');assert.equal(p.state.engineFault,null);assert.equal(p.condition.mechanical.health.radiator,.2);assert.equal(p.condition.mechanical.oilLitres,oil);assert.equal(p.state.fuelLitres,fuel);assert.equal(p.state.boost,nos);
 const before=p.engine.getTiming().totalSteps;run(p,.2,neutral);const timing=p.engine.getTiming();assert.equal(timing.clock,'pcm');assert.equal(timing.totalSteps-before,4800);assert.equal(timing.discardedSeconds,0);assert.ok(p.state.engineRunning);assert.ok(p.state.fuelLitres<fuel);
 const fixture={clock:timing.clock,stepsForPointTwoSeconds:timing.totalSteps-before,radiator:p.condition.mechanical.health.radiator};p.engine.dispose();return fixture;
});
check('The damage-off rule preserves component condition under a real downshift and collision while fuel and thermal work continue.',()=>{
 const p=make();p.setDamageEnabled(false);moving(p,58,6);const before=p.getCondition();run(p,1,{transmission:'hpattern',manualClutch:true,clutch:0,gearRequest:1,throttle:.4,assists:false});p.applyImpact({impulse:50000,closingSpeed:30,localPoint:{x:0,z:1.5}});
 assert.deepEqual(p.condition.mechanical.health,before.mechanical.health);assert.deepEqual(p.condition.mechanical.gearHealth,before.mechanical.gearHealth);assert.equal(p.state.engineFault,null);assert.equal(p.state.bodyHealth,before.bodyHealth);assert.equal(p.condition.mechanical.oilLitres,before.mechanical.oilLitres);assert.ok(p.condition.mechanical.energy.clutchJ>before.mechanical.energy.clutchJ);p.engine.dispose();
});
check('A swapped large engine retains its fluid volumes when an inactive garage condition is restored.',()=>{
 const selection={carId:'hachi',engineId:'v12'},p=make(selection),saved=p.exportGarageState(),q=make(selection);assert.equal(p.condition.mechanical.oilCapacity,8);q.restoreGarageState(JSON.parse(JSON.stringify(saved)));assert.equal(q.condition.mechanical.oilCapacity,8);assert.equal(q.condition.mechanical.oilLitres,8);assert.equal(q.condition.mechanical.coolantLitres,p.condition.mechanical.coolantLitres);p.engine.dispose();q.engine.dispose();
});
report.status='passed';fs.writeFileSync(new URL('./damage-v15-results.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
