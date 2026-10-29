import assert from 'node:assert/strict';
import fs from 'node:fs';
import MotorLab from '../sdk/motor-engine.mjs';
import {CarPhysics} from '../dist/physics.js';
import {resolveBuild} from '../dist/catalog.js';
import {FUEL_DENSITY_KG_PER_LITRE} from '../dist/vehicle-state.js';
const dt=1/120,report={status:'pending',checks:[]};
const make=selection=>new CarPhysics(MotorLab,resolveBuild(selection));
const finite=p=>{for(const key of ['x','z','vx','vz','yawRate','rpm','bodyHeight','bodyPitch','bodyRoll','fuelLitres','engineHealth','gearboxHealth'])assert.ok(Number.isFinite(p.state[key]),key+' became non-finite');};
function run(p,seconds,input){let maxRpm=0,maxNos=0;for(let i=0;i<Math.round(seconds/dt);i++){p.update(dt,typeof input==='function'?input(i):input);finite(p);maxRpm=Math.max(maxRpm,p.state.rpm);maxNos=Math.max(maxNos,p.state.nitrousTorque);}return {maxRpm,maxNos};}
const neutral={transmission:'sequential',manualClutch:true,clutch:1,gearRequest:0};

{
 const p=make(),initial=p.state.boost;const sample=run(p,1,{...neutral,boost:true,throttle:0,brake:1,handbrake:1});
 assert.ok(p.state.boosting&&sample.maxNos>20);assert.equal(p.state.speed,0);assert.ok(Math.abs(p.state.boost-(initial-.18))<1e-9);assert.ok(sample.maxRpm>3000);
 report.checks.push({name:'Stationary neutral NOS accepts no throttle, full brake and handbrake; adds shaft torque, consumes bottle, and cannot propel a disconnected gearbox',...sample,bottle:p.state.boost});
 p.restoreCondition({...p.getCondition(),engineHealth:0,engineFault:'Engine failure'});const bottle=p.state.boost;run(p,.25,{...neutral,boost:true});assert.equal(p.state.nitrousTorque,0);assert.ok(p.state.boost<bottle);assert.equal(p.state.speed,0);
 report.checks.push({name:'Failed engine still allows NOS valve activation and bottle use, but gets no combustion torque'});p.engine.dispose();
}

function moving(p,speed,gear){const s=p.state;s.vx=0;s.vz=speed;s.speed=s.forwardSpeed=speed;s.gear=gear;s.requestedGear=gear;p._wheelOmega.fill(speed/p.wheelRadius);const omega=speed/p.wheelRadius*p._ratio(gear);p.engine.applyShaftImpulse((omega-p.engine.getState().omega)*p.engine.getState().config.inertia);p._omega=omega;p.engineState=p.engine.getState();s.rpm=Math.max(0,omega*60/(Math.PI*2));p._autoEngagement=1;}
{
 const p=make();moving(p,58,6);const startHealth=p.state.engineHealth;
 p.update(dt,{transmission:'hpattern',manualClutch:true,clutch:0,gearRequest:1,throttle:0,assists:false});assert.equal(p.state.gear,1);assert.equal(p.state.shiftRejected,false);
 const sample=run(p,1.3,{transmission:'hpattern',manualClutch:true,clutch:0,gearRequest:1,throttle:0,assists:false});assert.ok(sample.maxRpm>p.redlineRpm*1.2);assert.ok(p.state.engineHealth<startHealth-.01);assert.ok(p.state.gearboxHealth<1);
 report.checks.push({name:'Forced high-speed first gear is accepted and wheel-driven overrev damages engine and gearbox',...sample,engineHealth:p.state.engineHealth,gearboxHealth:p.state.gearboxHealth});p.engine.dispose();
}
{
 const p=make();moving(p,58,6);const health=p.state.engineHealth;run(p,.6,{transmission:'hpattern',manualClutch:true,clutch:1,gearRequest:1,throttle:0,assists:false});assert.equal(p.state.gear,1);assert.ok(p.state.engineHealth>health-.00001);assert.equal(p.state.gearboxHealth,1);report.checks.push({name:'Selecting a short gear with clutch open does not damage an uncoupled engine'});p.engine.dispose();
}
{
 const p=make();moving(p,28,3);p.update(dt,{transmission:'hpattern',manualClutch:true,clutch:0,gearRequest:-1,throttle:0,assists:false});assert.equal(p.state.gear,-1);assert.equal(p.state.shiftRejected,false);run(p,1,{transmission:'hpattern',manualClutch:true,clutch:0,gearRequest:-1,assists:false});assert.ok(p.state.speed<28);assert.ok(p.state.engineStalled||p.state.engineHealth<.99);
 report.checks.push({name:'Reverse while moving is accepted and produces drivetrain reaction instead of a protected selection',speed:p.state.speed,engineHealth:p.state.engineHealth,gearboxHealth:p.state.gearboxHealth,rpm:p.state.rpm});p.engine.dispose();
}
{
 const p=make();moving(p,-14,-1);p.update(dt,{transmission:'hpattern',manualClutch:true,clutch:0,gearRequest:-1,throttle:1});assert.ok(p.state.throttle>0,'Reverse throttle must be limited by engine/gear ratio, not the old speed gate');report.checks.push({name:'Reverse has no artificial road-speed throttle cutoff'});p.engine.dispose();
}
{
 const p=make(),initial=p.getCondition(),injected=p.engine.getState().totals.fuelInjected;run(p,1.2,{throttle:.7});
 const actual=(p.engine.getState().totals.fuelInjected-injected)/FUEL_DENSITY_KG_PER_LITRE,used=initial.fuelLitres-p.state.fuelLitres;assert.ok(used>0);assert.ok(Math.abs(actual-used)<1e-10);
 p.restoreCondition({...p.getCondition(),fuelLitres:.000001});run(p,.2,{...neutral,throttle:1,boost:true});assert.equal(p.state.fuelLitres,0);assert.equal(p.state.fuelStarved,true);assert.equal(p.state.engineRunning,false);assert.equal(p.state.nitrousTorque,0);
 const added=p.refuel(5);assert.equal(added,5);run(p,2,{...neutral,starter:true,throttle:.1});assert.ok(p.state.engineRunning);assert.ok(p.state.fuelLitres>4.9);
 report.checks.push({name:'Fuel follows SDK injected mass, starvation cuts combustion, and refuel plus starter restores the engine',usedLitres:used,sdkLitres:actual,restartRpm:p.state.rpm});p.engine.dispose();
}
{
 const p=make(),contact={normal:{x:0,z:-1},point:{x:.9,z:1.3},localPoint:{x:.9,z:1.3},impulse:30000,closingSpeed:28};
 const result=p.applyImpact(contact);assert.deepEqual(result.detached,[1]);assert.deepEqual(p.state.wheelAttached,[true,false,true,true]);assert.equal(p.state.wheelAudio[1].contact,false);assert.equal(p.state.wheelLoads[1],0);
 run(p,3,{throttle:.18});assert.equal(p.state.suspension[1].contact,false);assert.equal(p.state.wheelAudio[1].tyrePower,0);assert.ok(p.state.detachedWheels.length===1&&p.state.detachedWheels[0].age>2.9);assert.ok(p.state.bodyHeight>-.3);
 const condition=p.getCondition();p.reset(20,30,.4);assert.equal(p.state.wheelAttached[1],false);assert.equal(p.state.engineHealth,condition.engineHealth);assert.equal(p.state.fuelLitres,condition.fuelLitres);assert.equal(p.state.boost,condition.boost);
 p.setBuild(resolveBuild({carId:'atlas'}));assert.ok(p.state.wheelAttached.every(Boolean));p.setBuild(resolveBuild());assert.equal(p.state.wheelAttached[1],false);assert.equal(p.state.fuelLitres,condition.fuelLitres);
 const beforeRepair=p.getCondition();p.repair();assert.ok(p.state.wheelAttached.every(Boolean));assert.equal(p.state.engineHealth,1);assert.equal(p.state.fuelLitres,beforeRepair.fuelLitres);assert.equal(p.state.boost,beforeRepair.boost);assert.equal(p.state.detachedWheels.length,0);
 const service=p.service({refuel:true,refillNitrous:true});assert.equal(p.state.fuelLitres,p.state.fuelCapacity);assert.equal(p.state.boost,1);assert.ok(service.fuelAdded>0);
 report.checks.push({name:'Localized wheel loss removes real contact forces; respawn and car swaps preserve damage; repair and refuel affect only requested systems',impact:result});p.engine.dispose();
}
{
 const p=make();for(let i=0;i<4;i++){const [x,z]=p._positions[i];p.applyImpact({localPoint:{x,z},point:{x,z},normal:{x:Math.sign(x),z:0},impulse:40000,closingSpeed:35});}
 assert.ok(p.state.wheelAttached.every(attached=>!attached));run(p,2,neutral);assert.ok(p.state.bodyHeight>-.4);assert.ok(p.state.wheelLoads.every(load=>load===0));assert.ok(p.state.scrapeLoads.some(load=>load>0));p.state.yawRate=1;run(p,.5,neutral);assert.ok(Math.abs(p.state.yawRate)<.1,'Chassis contact should dissipate yaw after every wheel is gone');
 const save=p.exportGarageState(),copy=make();copy.restoreGarageState(JSON.parse(JSON.stringify(save)));assert.deepEqual(copy.state.wheelAttached,[false,false,false,false]);assert.equal(copy.state.engineHealth,p.state.engineHealth);assert.equal(copy.state.fuelLitres,p.state.fuelLitres);
 report.checks.push({name:'A wheel-less body settles on chassis support and condition survives serialization',bodyHeight:p.state.bodyHeight});p.engine.dispose();copy.engine.dispose();
}
{
 const p=make();run(p,2,{throttle:1,handbrake:1,transmission:'sequential'});assert.ok(p.state.engineStalled);p.repair();run(p,3,{throttle:1,brake:.63,transmission:'sequential',gearRequest:1});assert.ok(p.state.burnout);assert.ok(p.state.speed<2);
 report.checks.push({name:'Handbrake stall and service-brake burnout still emerge from the coupled drivetrain',burnout:p.state.burnout,speed:p.state.speed,rpm:p.state.rpm});p.engine.dispose();
}
report.status='passed';fs.writeFileSync(new URL('./physics-v6-results.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
