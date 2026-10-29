import assert from 'node:assert/strict';
import fs from 'node:fs';
import {MechanicalSystem} from '../dist/mechanical.js';
import {createVehicleCondition,snapshotVehicleCondition} from '../dist/vehicle-state.js';
import {resolveBuild} from '../dist/catalog.js';
const dt=1/120,build=resolveBuild(),report={status:'pending',scope:'Lumped physical heat and damage with specified power inputs; fictional calibration, not a vehicle-engineering model.',checks:[],fixtures:{}};
function setup(change,selection){const b=selection?resolveBuild(selection):build,c=createVehicleCondition(b),events=[];change?.(c);return {build:b,c,events,m:new MechanicalSystem(b,c,e=>events.push(e))};}
function run(p,seconds,{rpm=4500,speed=25,wall=60000,friction=15000,clutch=0,gearbox=0,diff=0,brakes=[0,0,0,0],tyres=[0,0,0,0],torque=100,enabled=true,step=dt,...rest}={}){
 for(let i=0;i<Math.round(seconds/step);i++)p.m.step(step,{omega:rpm*Math.PI/30,speed,gear:3,ratio:6.95,clutchTorque:torque,wallHeatJ:wall*step,frictionJ:friction*step,clutchWorkJ:clutch*step,gearboxWorkJ:gearbox*step,differentialWorkJ:diff*step,brakeWorkJ:brakes.map(p=>p*step),tyreWorkJ:tyres.map(p=>p*step),exhaustC:850,exhaustFlow:.15,turboRpm:100000,...rest},enabled);
 return p;
}
function check(name,fn){const fixture=fn();report.checks.push(name);if(fixture)report.fixtures[name]=fixture;console.log('PASS '+name);}
check('Healthy cooling reaches a stable working range; loss of radiator area/flow causes heat, leaks and gasket damage.',()=>{
 const healthy=run(setup(),300),radiator=run(setup(c=>c.mechanical.health.radiator=.05),180),pump=run(setup(c=>c.mechanical.health.waterPump=0),180);
 assert.ok(healthy.c.mechanical.temperatures.engine<120);assert.ok(healthy.c.mechanical.temperatures.coolant<108);assert.equal(healthy.c.engineHealth,1);assert.equal(healthy.c.mechanical.coolantLitres,healthy.c.mechanical.coolantCapacity);
 assert.ok(radiator.c.mechanical.temperatures.engine>healthy.c.mechanical.temperatures.engine+40);assert.ok(radiator.c.mechanical.coolantLitres<1);assert.ok(radiator.c.mechanical.health.headGasket<.95);
 assert.ok(pump.c.mechanical.temperatures.engine>160);assert.ok(pump.c.mechanical.health.headGasket<.6);assert.ok(pump.events.some(e=>e.component==='engine-temperature'));
 return {healthy:healthy.c.mechanical.temperatures.engine,radiator:radiator.c.mechanical.temperatures.engine,pump:pump.c.mechanical.temperatures.engine,gasketHealth:pump.c.mechanical.health.headGasket};
});
check('Oil starvation removes pressure, increases physical drag and seizes bearings without a blanket heat kill.',()=>{
 const dry=run(setup(c=>c.mechanical.oilLitres=.05),20),healthy=run(setup(),20);
 assert.equal(dry.m.effects.oilPressureBar,0);assert.ok(dry.m.effects.loadTorqueNm>150);assert.equal(dry.c.mechanical.health.bearings,0);assert.equal(dry.c.engineFault,'Crank bearings seized');assert.equal(dry.c.mechanical.health.pistons,1);assert.equal(healthy.c.mechanical.health.bearings,1);assert.ok(dry.c.mechanical.temperatures.engine<110);
 return {failure:dry.c.engineFault,pressure:dry.m.effects.oilPressureBar,temperature:dry.c.mechanical.temperatures.engine,drag:dry.m.effects.loadTorqueNm};
});
check('Clutch friction work produces heat, torque fade and wear; disengagement cools without repairing the plate.',()=>{
 const p=run(setup(),40,{clutch:200000,rpm:6500,speed:0,wall:40000,friction:12000,torque:200}),before=snapshotVehicleCondition(p.c);
 assert.ok(p.c.mechanical.temperatures.clutch>500);assert.ok(p.c.mechanical.health.clutch<.5);assert.ok(p.m.effects.clutchCapacityFactor<.2);
 run(p,30,{rpm:900,speed:10,wall:0,friction:0,clutch:0,torque:0});assert.ok(p.c.mechanical.temperatures.clutch<before.mechanical.temperatures.clutch);assert.equal(p.c.mechanical.health.clutch,before.mechanical.health.clutch);
 return {hotC:before.mechanical.temperatures.clutch,coolC:p.c.mechanical.temperatures.clutch,health:p.c.mechanical.health.clutch};
});
check('A fuel cut cannot prevent wheel-driven overrev; component failures follow actual crank speed.',()=>{
 const forced=run(setup(),1.1,{rpm:13000,wall:0,friction:0,torque:300,fuelCut:true}),safe=run(setup(),1.1,{rpm:900,wall:0,friction:0,torque:0,inputShaftRpm:18000});
 assert.ok(forced.c.mechanical.health.valvetrain<.2);assert.ok(forced.c.mechanical.health.pistons<1);assert.ok(forced.c.mechanical.health.bearings<1);assert.equal(safe.c.engineHealth,1);assert.ok(forced.events.some(e=>e.component==='mechanical-overrev'));
 return {forced:forced.c.mechanical.health,safeEngineHealth:safe.c.engineHealth};
});
check('A stronger clutch can overload the original shaft and selected gear, while the other gears stay intact.',()=>{
 const stock=run(setup(),8,{torque:550,wall:0,friction:0}),over=run(setup(null,{engineId:'v12',clutch:'race'}),8,{torque:1450,wall:0,friction:0});
 assert.equal(stock.c.mechanical.health.driveshaft,1);assert.ok(over.c.mechanical.health.driveshaft<.8);assert.ok(over.c.mechanical.gearHealth[3]<1);assert.equal(over.c.mechanical.gearHealth[2],1);
 return {shaft:over.c.mechanical.health.driveshaft,gear3:over.c.mechanical.gearHealth[3]};
});
check('Brakes and tyres receive work per corner; unloaded corners stay cool and sustained abuse wears only loaded parts.',()=>{
 const p=run(setup(),40,{wall:0,friction:0,speed:2,brakes:[120000,0,0,0],tyres:[0,0,140000,0]});
 assert.ok(p.c.mechanical.temperatures.brakes[0]>600);assert.equal(p.c.mechanical.temperatures.brakes[1],24);assert.ok(p.c.mechanical.temperatures.tyres[2]>300);assert.equal(p.c.mechanical.temperatures.tyres[3],24);assert.ok(p.c.brakeHealth[0]<1);assert.ok(p.c.wheelHealth[2]<.8);assert.equal(p.c.wheelHealth[3],1);
 return {brakes:p.c.mechanical.temperatures.brakes,tyres:p.c.mechanical.temperatures.tyres,health:p.c.wheelHealth};
});
check('Damage-off preserves all irreversible condition and fluids even during overrev, heat and leaks.',()=>{
 const p=setup(c=>{c.mechanical.health.radiator=.2;c.mechanical.health.oilPan=.2;c.mechanical.oilLitres=1;c.mechanical.coolantLitres=2;});const old=snapshotVehicleCondition(p.c);
 run(p,60,{rpm:14000,speed:0,clutch:300000,brakes:[200000,0,0,0],tyres:[0,0,200000,0],enabled:false});
 assert.deepEqual(p.c.mechanical.health,old.mechanical.health);assert.deepEqual(p.c.mechanical.gearHealth,old.mechanical.gearHealth);assert.deepEqual(p.c.brakeHealth,old.brakeHealth);assert.deepEqual(p.c.wheelHealth,old.wheelHealth);assert.equal(p.c.mechanical.oilLitres,old.mechanical.oilLitres);assert.equal(p.c.mechanical.coolantLitres,old.mechanical.coolantLitres);assert.equal(p.c.engineFault,null);assert.ok(p.c.mechanical.temperatures.clutch>old.mechanical.temperatures.clutch);
});
check('Thermal results stay stable at120Hz and60Hz, including energy, fluids and component wear.',()=>{
 const a=run(setup(c=>c.mechanical.health.radiator=.4),120,{clutch:50000}),b=run(setup(c=>c.mechanical.health.radiator=.4),120,{clutch:50000,step:1/60});
 for(const key of ['engine','coolant','oil','clutch','gearbox','differential','turbo'])assert.ok(Math.abs(a.c.mechanical.temperatures[key]-b.c.mechanical.temperatures[key])<1e-8,key);
 assert.deepEqual(a.c.mechanical.health,b.c.mechanical.health);assert.equal(a.c.mechanical.oilLitres,b.c.mechanical.oilLitres);assert.equal(a.c.mechanical.coolantLitres,b.c.mechanical.coolantLitres);
});
check('Selective repairs and fluid service preserve unrelated failures, fuel and NOS; warnings do not repeat each frame.',()=>{
 const p=setup(c=>{c.mechanical.health.gearbox=.2;c.mechanical.gearHealth[1]=0;c.mechanical.health.radiator=.15;c.mechanical.health.pistons=0;c.mechanical.oilLitres=.5;c.mechanical.coolantLitres=.7;c.fuelLitres=11;c.boost=.3;});
 p.m.repair(['gearbox']);assert.equal(p.c.mechanical.health.gearbox,1);assert.equal(p.c.mechanical.gearHealth[1],0);p.c.mechanical.health.gearbox=.3;p.m.repair(['gear1']);assert.equal(p.c.mechanical.gearHealth[1],1);assert.equal(p.c.mechanical.health.gearbox,.3);
 p.m.repair(['engine']);assert.equal(p.c.engineFault,null);assert.equal(p.c.mechanical.health.radiator,.15);assert.equal(p.c.mechanical.coolantLitres,.7);
 p.m.repair(['fluids']);assert.equal(p.c.mechanical.coolantLitres,p.c.mechanical.coolantCapacity);assert.equal(p.c.mechanical.oilLitres,p.c.mechanical.oilCapacity);assert.equal(p.c.mechanical.health.radiator,.15);assert.equal(p.c.fuelLitres,11);assert.equal(p.c.boost,.3);
 p.m.repair(['drivetrain']);assert.ok(p.c.mechanical.gearHealth.every(h=>h===1));assert.equal(p.c.mechanical.health.gearbox,1);
 const hot=setup(c=>c.mechanical.temperatures.clutch=500);run(hot,2,{wall:0,friction:0,rpm:0,torque:0});assert.equal(hot.events.filter(e=>e.component==='clutch-temperature').length,1);
});
check('Old saves migrate, nested states deep-copy and individual gear/gasket damage survive repeated round trips.',()=>{
 const old=createVehicleCondition(build,{engineHealth:.4,gearboxHealth:.6});assert.equal(old.mechanical.health.pistons,.4);assert.equal(old.mechanical.health.gearbox,.6);
 const p=setup(c=>{c.mechanical.gearHealth[1]=0;c.mechanical.health.headGasket=.1;});let saved=snapshotVehicleCondition(p.c);for(let i=0;i<3;i++){const c=createVehicleCondition(build,JSON.parse(JSON.stringify(saved)));new MechanicalSystem(build,c);saved=snapshotVehicleCondition(c);}
 assert.equal(saved.mechanical.health.pistons,1);assert.equal(saved.mechanical.health.gearbox,1);assert.equal(saved.mechanical.health.headGasket,.1);assert.equal(saved.mechanical.gearHealth[1],0);saved.mechanical.temperatures.brakes[0]=999;saved.mechanical.health.clutch=0;assert.equal(p.c.mechanical.temperatures.brakes[0],24);assert.equal(p.c.mechanical.health.clutch,1);
 const malformed=createVehicleCondition(build,{mechanical:{health:{clutch:NaN,radiator:Infinity},temperatures:{oil:NaN,brakes:[Infinity,-2]},oilLitres:-1,coolantLitres:Infinity}});assert.ok(Number.isFinite(malformed.mechanical.temperatures.oil));assert.equal(malformed.mechanical.oilLitres,0);assert.equal(malformed.mechanical.temperatures.brakes[1],24);
});
report.status='passed';fs.writeFileSync(new URL('./thermal-v15-results.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
