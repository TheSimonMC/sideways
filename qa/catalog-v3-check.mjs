import assert from 'node:assert/strict';
import fs from 'node:fs';
import MotorLab from '../sdk/motor-engine.mjs';
import * as THREE from '../dist/vendor/three.module.js';
import {VEHICLES,ENGINES,PARTS,DEFAULT_SELECTION,resolveBuild} from '../dist/catalog.js';
import {createCar,createEffects} from '../dist/car.js';
const results={status:'passed',catalog:[],models:[],engineBench:[],checks:[]};
const check=(name,fn)=>{fn();results.checks.push(name);};
check('Four distinct model shapes and eight engine choices',()=>{assert.equal(VEHICLES.length,4);assert.equal(new Set(VEHICLES.map(v=>v.model.kind)).size,4);assert.equal(ENGINES.length,8);});
check('Unknown and incompatible part selections sanitize safely',()=>{const b=resolveBuild({carId:'missing',engineId:'i4',ecu:'missing',turbo:'race'});assert.equal(b.selection.carId,'hachi');assert.equal(b.selection.turbo,'stock');assert.equal(b.selection.ecu,'stock');});
check('Car default engine is selected when no swap is specified',()=>{for(const v of VEHICLES)assert.equal(resolveBuild({carId:v.id}).engine.id,v.defaultEngine);});
check('No mutations leak into catalogue defaults',()=>{const b=resolveBuild();b.physics.gears[0]=99;b.engine.options.overrides.inertia=99;assert.notEqual(resolveBuild().physics.gears[0],99);assert.notEqual(resolveBuild().engine.options.overrides.inertia,99);});
for(const e of ENGINES){
 const stock=resolveBuild({engineId:e.id});
 const full=resolveBuild({engineId:e.id,ecu:'track',turbo:'race',exhaust:'race',tyres:'sport',suspension:'race',brakes:'race',differential:'locked',clutch:'race'});
 for(const build of [stock,full]){const engine=MotorLab.createEngine(build.physics.engineOptions);const c=engine.getState().config;assert.equal(c.redlineRpm,build.physics.redlineRpm);assert.equal(c.cylinderCount,e.cylinders);if(e.rotors)assert.equal(c.rotorCount,e.rotors);results.catalog.push({engine:e.id,tune:build.selection.ecu,redline:c.redlineRpm,kind:c.kind,cylinders:c.cylinderCount,rotors:e.rotors,exhaustDiameter:c.exhaustDiameter});engine.dispose();}
 assert.notEqual(stock.physics.engineOptions.overrides.exhaustDiameter,full.physics.engineOptions.overrides.exhaustDiameter);
 assert(full.physics.clutchCapacity>stock.physics.clutchCapacity);assert(full.physics.brakeTorque>stock.physics.brakeTorque);assert(full.physics.springRate>stock.physics.springRate);assert(full.physics.damperRate>stock.physics.damperRate);assert(full.physics.antiRollRate>stock.physics.antiRollRate);
}
results.checks.push('Every stock and fully tuned engine validates in the original SDK');
for(const [category,options] of Object.entries(PARTS))for(const part of options){const b=resolveBuild({[category]:part.id});const engine=MotorLab.createEngine(b.physics.engineOptions);assert(Number.isFinite(engine.getState().config.inertia));engine.dispose();}
results.checks.push('Every selectable part constructs a valid MotorLab engine');
globalThis.document={createElement:tag=>({width:0,height:0,getContext:()=>({fillRect(){},fillText(){}})})};
const scene=new THREE.Scene(),car=createCar(scene,resolveBuild());
for(const v of VEHICLES){
 const build=resolveBuild({carId:v.id});car.setBuild(build);car.setColor('#64d5de');
 assert.equal(scene.children.length,1);assert.equal(car.wheels.length,4);
 car.update({bodyHeight:.04,bodyPitch:.09,bodyRoll:-.07,wheelSpins:[.3,.6,1.1,1.5],suspension:[.36,.35,.37,.34].map(wheelY=>({wheelY,groundHeight:0,contact:true})),brake:.5},1/60,1);
 const expectedZ=[build.physics.frontAxle,build.physics.frontAxle,-build.physics.rearAxle,-build.physics.rearAxle];
 car.wheels.forEach((wheel,i)=>{assert.equal(wheel.position.z,expectedZ[i]);assert.equal(wheel.position.x,(i%2?-1:1)*-build.physics.halfTrack);assert.equal(wheel.children[0].rotation.x,[.3,.6,1.1,1.5][i]);});
 let meshes=0,vertices=0;car.group.traverse(node=>{if(node.isMesh){meshes++;vertices+=node.geometry.attributes.position.count;for(const value of node.geometry.attributes.position.array)assert(Number.isFinite(value));}});
 results.models.push({car:v.id,meshes,vertices,wheelbase:build.physics.frontAxle+build.physics.rearAxle,bounds:car.bounds});
}
results.checks.push('All model meshes finite, exactly four aligned wheels, real independent wheel angles');
car.dispose();assert.equal(scene.children.length,0);results.checks.push('Model replacement preserves one root and disposal removes it');
const fx=createEffects(scene,resolveBuild());
const stationary={x:0,z:0,heading:0,speed:0,forwardSpeed:0,wheelSlipL:4,wheelSlipR:4,wheelOmegas:[0,0,65,65],suspension:Array.from({length:4},()=>({groundHeight:0,contact:true})),throttle:1};
for(let i=0;i<60;i++)fx.update(stationary,1/60,i/60);
assert(fx.debug().activeParticles>0);assert(fx.debug().skidCursor>0);results.checks.push('Stationary physical wheelspin produces smoke and rubber patches');
fx.reset();for(let i=0;i<60;i++)fx.update({...stationary,wheelSlipL:0,wheelSlipR:0,wheelOmegas:[0,0,0,0]},1/60,i/60);assert.equal(fx.debug().activeParticles,0);results.checks.push('Stationary locked wheels do not generate fake burnout smoke');
fx.setBuild(resolveBuild({carId:'atlas'}));assert.equal(fx.debug().carId,'atlas');
for(const e of ENGINES){
 const build=resolveBuild({engineId:e.id});const engine=MotorLab.createEngine(build.physics.engineOptions);engine.start();engine.setInputs({throttle:1,boostTarget:build.physics.boostTarget,starter:false});let torque=0,count=0,shaft=0;
 for(let i=0;i<240;i++){
  const s=engine.getState(),target=4000*Math.PI/30;engine.applyShaftImpulse((target-s.omega)*s.config.inertia);
  const next=engine.update(1/120);if(i>=120){torque+=next.meanTorque;shaft+=(next.omega-target)*next.config.inertia*120;count++;}
 }
 const row={engine:e.id,referenceRpm:4000,meanCombustionTorqueNm:Number((torque/count).toFixed(2)),netShaftTorqueNm:Number((shaft/count).toFixed(2)),note:'Fixed-speed SDK fixture, not a real-world dyno rating'};results.engineBench.push(row);engine.dispose();
}
assert(new Set(results.engineBench.map(r=>Math.round(r.netShaftTorqueNm))).size===8);results.checks.push('Eight engines produce distinct actual SDK net shaft torque at the same speed');
fs.writeFileSync(new URL('./catalog-v3-results.json',import.meta.url),JSON.stringify(results,null,2)+'\n');
console.log(JSON.stringify(results,null,2));
