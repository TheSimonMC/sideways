import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import MotorLab from '../sdk/motor-engine.mjs';
import {CarPhysics} from '../dist/physics.js';
import {resolveBuild,VEHICLES} from '../dist/catalog.js';
import {Career} from '../dist/career.js';
import {steeringDemand,tyreGrip} from '../dist/chassis-setup.js';
const dt=1/120,checks=[],fixtures={};
assert.deepEqual(VEHICLES,JSON.parse(fs.readFileSync(new URL('fixtures/vehicles-v14.json',import.meta.url))),'Original vehicle specifications must remain unchanged');
const check=(name,fn)=>{fixtures[name]=fn();checks.push(name);console.log('PASS '+name);};
const make=selection=>new CarPhysics(MotorLab,resolveBuild(selection));
const neutral={transmission:'hpattern',manualClutch:true,clutch:1,gearRequest:0,assists:false};
const drift={steeringRack:'drift',alignment:'drift',antiRollBars:'drift',tyres:'drift',differential:'locked'};
function run(p,seconds,input){let maxBeta=0,maxRoll=0;for(let i=0;i<Math.round(seconds/dt);i++){p.update(dt,input);const s=p.state;assert.ok([s.x,s.z,s.speed,s.rpm,s.steer,s.yawRate,...s.wheelLoads].every(Number.isFinite));maxBeta=Math.max(maxBeta,Math.abs(s.driftAngle));maxRoll=Math.max(maxRoll,Math.abs(s.bodyRoll));}return {speed:p.state.speed,maxBeta,maxRoll};}
function moving(p,speed){Object.assign(p.state,{vz:speed,speed,forwardSpeed:speed,gear:0});p._wheelOmega.fill(speed/p.wheelRadius);}
function stop(selection={},grip=1){const p=make(selection);p.setGroundSampler(()=>({height:0,grip,material:grip<1?'wet-asphalt':'asphalt'}));moving(p,100/3.6);let distance=0,time=0;while(p.state.speed>.3&&time<12){const before=p.state.z;p.update(dt,{...neutral,brake:1});distance+=Math.abs(p.state.z-before);time+=dt;}assert.ok(p.state.speed<=.3);p.engine.dispose();return {distance,time};}
check('All four factory cars accelerate straight without self-initiated drift and corner with dynamic wheel load transfer.',()=>{
 const rows=[];for(const car of VEHICLES){const p=make({carId:car.id}),straight=run(p,5,{throttle:.55});assert.ok(straight.speed>12);assert.ok(straight.maxBeta<.01);p.reset();moving(p,22);const turn=run(p,3,{...neutral,steer:.07,deviceKind:'wheel'});assert.ok(turn.maxBeta<.14);assert.ok(turn.maxRoll>.005);assert.ok(Math.abs(p.state.wheelLoads[0]-p.state.wheelLoads[1])>300);rows.push({car:car.id,straight,turn});p.engine.dispose();}return rows;
});
check('Factory 100 km/h braking remains bounded; reduced surface grip lengthens the same stop.',()=>{
 const cars=VEHICLES.map(v=>({car:v.id,...stop({carId:v.id})}));for(const r of cars)assert.ok(r.distance>28&&r.distance<48,JSON.stringify(r));const wet=stop({},.55);assert.ok(wet.distance>cars[0].distance*1.35);return {cars,wet,limit:'Synthetic flat road, new tyres and ABS; not measured real vehicle performance.'};
});
check('The fitted angle kit, alignment, bars, differential and compound change actual wheel geometry, load transfer and breakaway.',()=>{
 const p=make(),q=make(drift),stock=p.build.physics,kit=q.build.physics;assert.ok(kit.steeringLock>stock.steeringLock+.3);assert.ok(kit.mass>stock.mass);assert.ok(kit.rearRollFactor>stock.rearRollFactor);assert.ok(kit.powerLock>stock.powerLock);
 moving(p,22);moving(q,22);const a=run(p,3,{...neutral,steer:.12,deviceKind:'wheel'}),b=run(q,3,{...neutral,steer:.12,deviceKind:'wheel'});assert.ok(b.maxBeta>a.maxBeta+.1);assert.ok(q.state.wheelCamber[0]<0&&q.state.wheelCamber[1]>0);assert.ok(Math.abs(q.state.wheelCamber[0])>Math.abs(p.state.wheelCamber[0])+.04);assert.ok(Math.abs(q.state.wheelSteers[0])>Math.abs(p.state.wheelSteers[0]));p.engine.dispose();q.engine.dispose();return {factory:a,fitted:b,stockLock:stock.steeringLock,kitLock:kit.steeringLock};
});
check('Legacy handling names cannot alter the solver; steering cannot rotate an airborne chassis.',()=>{
 const rows=[];for(const name of ['street','grip','drift']){const p=make();p.setTune(name);run(p,2,{throttle:.45,steer:.12});rows.push([p.state.x,p.state.z,p.state.yawRate,p.state.speed]);p.engine.dispose();}assert.deepEqual(rows[0],rows[1]);assert.deepEqual(rows[0],rows[2]);
 const p=make();moving(p,20);p.state.bodyHeight=6;p.state.yawRate=.4;run(p,.1,{...neutral,steer:1,assists:true});assert.ok(p.state.wheelLoads.every(v=>v===0));assert.ok(Math.abs(p.state.yawRate-.4)<1e-10);p.engine.dispose();return {legacyIdentical:true,airborneYaw:.4};
});
check('Wheel axes retain their full rack travel at speed; keyboard/gamepad filtering and tyre slip transitions stay continuous.',()=>{
 const c=resolveBuild().physics;assert.equal(steeringDemand(1,0,c,'wheel').target,steeringDemand(1,60,c,'wheel').target);assert.ok(steeringDemand(1,60,c,'keyboard').target<c.steeringLock*.5);
 const input={front:false,load:3000,referenceLoad:3000,temperature:70,health:1,slipAngle:0,compound:'street',chassis:c};let previous=null,maxStep=0;for(let slipRatio=0;slipRatio<2;slipRatio+=.001){const mu=tyreGrip({...input,slipRatio});if(previous!==null)maxStep=Math.max(maxStep,Math.abs(mu-previous));previous=mu;}assert.ok(maxStep<.001);assert.ok(tyreGrip({...input,slipRatio:0,health:.2})<tyreGrip({...input,slipRatio:0}));assert.ok(tyreGrip({...input,slipRatio:0,temperature:230})<tyreGrip({...input,slipRatio:0}));return {maxCoefficientStep:maxStep};
});
check('New chassis slots migrate to stock; purchases persist once while existing damage, heat, fuel and upgrades survive changing the setup.',()=>{
 const old=resolveBuild({carId:'atlas',ecu:'sport',hood:'carbon'});for(const k of ['steeringRack','alignment','antiRollBars'])assert.equal(old.selection[k],'stock');assert.equal(old.selection.hood,'carbon');assert.equal(old.selection.ecu,'sport');
 const career=new Career();career.wallet=20000;const b=resolveBuild(drift),price=career.quote(b).total;assert.equal(price,18500);assert.equal(career.purchase(b).ok,true);const restored=new Career(JSON.parse(JSON.stringify(career.serialize())),b.selection);assert.equal(restored.wallet,1500);assert.equal(restored.quote(b).total,0);
 const p=make(),state=p.getCondition();state.wheelHealth[2]=.62;state.mechanical.temperatures.tyres[2]=110;state.mechanical.health.radiator=.6;state.fuelLitres=17;p.restoreCondition(state);p.setBuild(b);assert.equal(p.condition.wheelHealth[2],.62);assert.equal(p.state.tyreTemps[2],110);assert.equal(p.condition.mechanical.health.radiator,.6);assert.equal(p.state.fuelLitres,17);const q=make(drift);q.restoreGarageState(JSON.parse(JSON.stringify(p.exportGarageState())));assert.equal(q.condition.wheelHealth[2],.62);assert.equal(q.state.tyreTemps[2],110);p.engine.dispose();q.engine.dispose();return {price,wallet:restored.wallet};
});
const files=['dist/chassis-setup.js','dist/catalog.js','dist/career.js','dist/physics.js','dist/main.js','dist/garage.js'];
const report={version:15,status:'passed',checks,fixtures,sourceSHA256:Object.fromEntries(files.map(f=>[f,createHash('sha256').update(fs.readFileSync(new URL('../'+f,import.meta.url))).digest('hex')])),limits:['Phase 1 subset: all existing cars remain RWD; pressure/blowouts, weather, aero tuning and wheel hop are not added here.','Synthetic inputs on the native SDK, no physical wheel/gamepad or measured real-world calibration.']};
fs.writeFileSync(new URL('chassis-v15-results.json',import.meta.url),JSON.stringify(report,null,2));
