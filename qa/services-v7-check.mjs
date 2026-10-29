import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import * as THREE from '../dist/vendor/three.module.js';
import MotorLab from '../sdk/motor-engine.mjs';
import {CarPhysics} from '../dist/physics.js';
import {resolveBuild} from '../dist/catalog.js';
import {PoseBuffer} from '../dist/presentation.js';
import {createCity} from '../dist/city.js';
import {createTraffic} from '../dist/traffic.js';
import {createPolice} from '../dist/police.js';
import {parseHTML,installDOM} from './dom-v5-harness.mjs';

const main=fs.readFileSync(new URL('../dist/main.js',import.meta.url),'utf8'),html=fs.readFileSync(new URL('../dist/index.html',import.meta.url),'utf8');
const city=createCity(new THREE.Scene()),traffic=createTraffic(null,city,{count:0}),police=createPolice(null,city,traffic,{count:1}),physics=new CarPhysics(MotorLab,resolveBuild());physics.setGroundSampler((x,z)=>city.getSurfaceAt(x,z));
const {doc}=parseHTML(html);installDOM(doc);const $=id=>{const el=doc.getElementById(id);assert.ok(el,'Missing real UI element '+id);return el;};
const calls={audio:[],audioSuspended:[],persisted:[],postResets:0,fxResets:0,policeResets:0,carUpdates:[],dialogs:[],inputClears:0};const realPoliceReset=police.reset.bind(police);police.reset=()=>{calls.policeResets++;return realPoliceReset();};
const ctx={console,performance,$,document:doc,physics,state:physics.state,world:city,police,policeState:police.getState(),serviceTarget:null,serviceJob:null,phase:'playing',paused:false,modalName:null,returnToPause:false,arrestStation:null,initialCamera:false,escapeMusic:0,totalTime:0,lastNow:0,toastTimer:0,activeBuild:physics.build,
 crimeContacts:[],nearbySounds:[],acousticState:null,acousticClock:0,dispatchQueue:[],dispatchTime:0,dispatchLast:new Map(),cameraAlertTime:0,nearMissPulse:0,
 clamp:(x,a,b)=>Math.max(a,Math.min(b,x)),presentation:new PoseBuffer(),renderState:null,cameraAnchor:{x:0,z:0},accumulator:.005,pendingShiftUp:false,pendingShiftDown:false,pendingNeutral:false,frameControls:{},
 audio:{suspend:value=>calls.audioSuspended.push(value),playEvent:(name,data)=>calls.audio.push({name,data}),update(){},tick(){}},inputManager:{clear(){calls.inputClears++;}},car:{update(state){calls.carUpdates.push({wheelAttached:[...state.wheelAttached],engineHealth:state.engineHealth,fuelLitres:state.fuelLitres});}},
 post:{reset(){calls.postResets++;}},fx:{reset(){calls.fxResets++;}},showDialog:name=>{calls.dialogs.push(name);$('#'+name);},hideDialog(){},focusDefault(){},drawFullMap(){},controlsPanel:{show(){},hide(){}},garagePanel:{show(){},hide(){}},syncSettings(){},settings:{},
 persist(){calls.persisted.push({condition:physics.getCondition(),phase:ctx.phase});},resetCar(){throw new Error('Unexpected no-service fallback');},setPaused(value){ctx.paused=value;}
};
// Dialog painting is intentionally stubbed; the actual modal helpers still own
// pause, cancellation, state transitions and resource calls below.
ctx.showDialog=name=>{calls.dialogs.push(name);$(name+'-modal').classList.remove('hidden');};ctx.hideDialog=()=>{for(const el of doc.querySelectorAll('.modal'))el.classList.add('hidden');};
vm.createContext(ctx);
const functionNames=['resetWorldFeedback','nearestService','interact','updateServiceUI','startService','updateServiceJob','recoverVehicle','handlePoliceEvent','releaseFromStation','openModal','closeModal','clearInputs','resetPresentation','toast'];
for(const name of functionNames){const match=new RegExp('(?:^|\\n)(?:async )?function '+name+'\\(').exec(main);assert.ok(match,'Missing shipped helper '+name);const start=match.index+(match[0].startsWith('\n')?1:0),tail=main.slice(start),next=/\n(?:(?:async )?function |\/\/ Read-only diagnostics)/.exec(tail);vm.runInContext(next?tail.slice(0,next.index):tail,ctx,{filename:'dist/main.js:'+name});}
const report={status:'pending',checks:[],failures:[],scenarios:{},mainSha256:createHash('sha256').update(main).digest('hex'),extractedFunctions:functionNames,limits:['Actual extracted main.js helpers, real MotorLab CarPhysics, real city service records and police reset logic.','DOM layout, animations, GPU rendering and audible playback are not verified; painting/audio devices are controlled stubs.']};
function check(name,fn){try{fn();report.checks.push(name);console.log('PASS '+name);}catch(error){report.failures.push({name,message:error.message,stack:error.stack});console.error('FAIL '+name+': '+error.message);}}
const fuel=city.services.find(s=>s.kind==='fuel'),garage=city.services.find(s=>s.kind==='garage'),station=city.services.find(s=>s.kind==='police');
const same=(a,b,label)=>assert.ok(Math.abs(a-b)<1e-8,label+': '+a+' vs '+b);
function condition(overrides={}){physics.restoreCondition({...physics.getCondition(),engineHealth:1,bodyHealth:1,gearboxHealth:1,wheelHealth:[1,1,1,1],wheelAttached:[true,true,true,true],engineFault:null,fuelLitres:19,boost:.31,...overrides});physics.reset(physics.state.x,physics.state.z,physics.state.heading);ctx.state=physics.state;}
function place(service,overrides={}){ctx.serviceJob=null;ctx.serviceTarget=null;ctx.modalName=null;ctx.paused=false;ctx.phase='playing';ctx.policeState={...police.getState(),phase:'patrol',heat:0};ctx.world=city;physics.reset(service.x,service.z,service.heading||0);ctx.state=physics.state;Object.assign(ctx.state,overrides);ctx.resetPresentation();}
function openService(service){place(service);ctx.interact();assert.equal(ctx.modalName,'service');assert.equal(ctx.paused,true);assert.equal(ctx.serviceTarget.id,service.id);}
function work(seconds){for(let i=0;i<Math.round(seconds/.05);i++)if(ctx.serviceJob)ctx.updateServiceJob(.05);}
const damaged={engineHealth:.34,bodyHealth:.27,gearboxHealth:.42,wheelHealth:[1,.08,.6,1],wheelAttached:[true,false,true,true],fuelLitres:7.25,boost:.23,damageEnergyJ:80000,damageRevision:4};

check('Service interaction requires a nearby bay, a stopped vehicle and no pursuit or search',()=>{
 place(fuel);ctx.state.x=fuel.x+fuel.radius+.1;ctx.interact();assert.equal(ctx.modalName,null);assert.match($('toast').textContent,/Find a fuel/);
 place(fuel,{speed:.81});ctx.interact();assert.equal(ctx.modalName,null);assert.match($('toast').textContent,/Stop inside/);
 for(const phase of ['chase','search']){place(fuel);ctx.policeState.phase=phase;ctx.interact();assert.equal(ctx.modalName,null);assert.match($('toast').textContent,/Lose the police/);}
 place(station);ctx.interact();assert.equal(ctx.modalName,null);assert.equal($('toast').textContent,'POLICE STATION');
 place(fuel,{speed:.8});ctx.state.x+=fuel.radius;ctx.interact();assert.equal(ctx.modalName,'service');assert.equal(ctx.paused,true);assert.equal(calls.audioSuspended.at(-1),true);ctx.closeModal();assert.equal(ctx.paused,false);assert.equal(ctx.modalName,null);
});
check('Fuel and mechanic panels expose only their supported services',()=>{
 openService(fuel);assert.equal($('service-fuel').classList.contains('hidden'),false);assert.equal($('service-repair').classList.contains('hidden'),true);assert.equal($('service-nos').classList.contains('hidden'),true);ctx.closeModal();
 openService(garage);assert.equal($('service-fuel').classList.contains('hidden'),true);assert.equal($('service-repair').classList.contains('hidden'),false);assert.equal($('service-nos').classList.contains('hidden'),false);ctx.closeModal();
});
check('Refueling adds 5 L per second, cancellation keeps partial fuel and preserves damage/NOS',()=>{
 condition(damaged);openService(fuel);const before=physics.getCondition(),steps=physics.engine.getTiming().totalSteps;ctx.startService('fuel');assert.ok(ctx.serviceJob);assert.equal($('service-fuel').disabled,true);work(1.25);same(ctx.state.fuelLitres,before.fuelLitres+6.25,'Gradual refuel');assert.equal(physics.engine.getTiming().totalSteps,steps,'Service time must not step the native engine in the background');const job=ctx.serviceJob;ctx.startService('repair');assert.equal(ctx.serviceJob,job,'An active job cannot be replaced by a second selection');ctx.closeModal();
 assert.equal(ctx.serviceJob,null);same(ctx.state.fuelLitres,before.fuelLitres+6.25,'Cancel retains delivered fuel');same(ctx.state.engineHealth,before.engineHealth,'Fuel cannot repair the engine');same(ctx.state.bodyHealth,before.bodyHealth,'Fuel cannot repair body damage');same(ctx.state.boost,before.boost,'Fuel cannot refill NOS');assert.deepEqual(ctx.state.wheelAttached,before.wheelAttached);same(calls.persisted.at(-1).condition.fuelLitres,ctx.state.fuelLitres,'Cancellation persists partial fuel');report.scenarios.partialFuel={before:before.fuelLitres,after:ctx.state.fuelLitres,seconds:1.25};
});
check('Fuel completion clamps to tank capacity and keeps the completed UI status visible',()=>{
 condition({...damaged,fuelLitres:49.6});openService(fuel);ctx.startService('fuel');work(1);assert.equal(ctx.serviceJob,null);same(ctx.state.fuelLitres,ctx.state.fuelCapacity,'Tank cap');same(ctx.state.engineHealth,damaged.engineHealth,'No implicit repair');assert.equal($('service-fuel').disabled,false);assert.match($('service-progress-label').textContent,/COMPLETE/,'Completion message must survive updateServiceUI');assert.equal($('service-progress').style.getPropertyValue('--progress'),'1');ctx.closeModal();
});
check('Cancelling a repair preserves the original condition and consumed resources',()=>{
 condition(damaged);openService(garage);const before=physics.getCondition();ctx.startService('repair');work(2);ctx.closeModal();assert.equal(ctx.serviceJob,null);assert.deepEqual(physics.getCondition(),before);
});
check('Completed repair restores physical parts while leaving fuel and NOS unchanged',()=>{
 condition(damaged);openService(garage);const before=physics.getCondition(),visualUpdates=calls.carUpdates.length;ctx.startService('repair');work(4.5);assert.equal(ctx.serviceJob,null);assert.equal(ctx.state,physics.state);assert.equal(ctx.state.engineHealth,1);assert.equal(ctx.state.bodyHealth,1);assert.equal(ctx.state.gearboxHealth,1);assert.ok(ctx.state.wheelAttached.every(Boolean));assert.ok(ctx.state.wheelHealth.every(v=>v===1));same(ctx.state.fuelLitres,before.fuelLitres,'Repair preserves fuel');same(ctx.state.boost,before.boost,'Repair preserves NOS');assert.equal(ctx.accumulator,0);assert.equal(ctx.renderState.x,ctx.state.x);assert.ok(calls.carUpdates.length>visualUpdates,'Repaired wheels should update while the service modal pauses physics');report.scenarios.repair={fuel:ctx.state.fuelLitres,nos:ctx.state.boost,wheelAttached:[...ctx.state.wheelAttached]};ctx.closeModal();
});
check('NOS service refills the bottle independently of damage and fuel',()=>{
 condition(damaged);openService(garage);const before=physics.getCondition();ctx.startService('nitrous');work(1.7);assert.equal(ctx.serviceJob,null);same(ctx.state.boost,1,'NOS refill');same(ctx.state.fuelLitres,before.fuelLitres,'NOS service cannot refill fuel');same(ctx.state.engineHealth,before.engineHealth,'NOS service cannot repair');assert.deepEqual(ctx.state.wheelAttached,before.wheelAttached);ctx.closeModal();
});
check('Recovery is blocked during chase/search without moving or repairing the vehicle',()=>{
 condition(damaged);place(garage);ctx.state.x+=50;for(const phase of ['chase','search']){ctx.policeState.phase=phase;const before=physics.getCondition(),x=ctx.state.x,z=ctx.state.z,resets=calls.policeResets;ctx.recoverVehicle();assert.equal(ctx.state.x,x);assert.equal(ctx.state.z,z);assert.deepEqual(physics.getCondition(),before);assert.equal(calls.policeResets,resets);assert.match($('toast').textContent,/unavailable/);}
});
check('Recovery moves to the nearest mechanic without repairing, refueling or refilling NOS',()=>{
 condition({...damaged,engineHealth:0,engineFault:'Impact damage'});place(garage);ctx.state.x=420;ctx.state.z=160;const before=physics.getCondition(),target=city.services.find(s=>s.name==='Eastside Customs'),resets=calls.policeResets;ctx.recoverVehicle();assert.equal(ctx.serviceTarget.id,target.id);same(ctx.state.x,target.spawn.x,'Recovery X');same(ctx.state.z,target.spawn.z,'Recovery Z');assert.deepEqual(physics.getCondition(),before);assert.equal(calls.policeResets,resets+1);assert.equal(ctx.policeState.phase,'patrol');assert.equal(ctx.modalName,'service');assert.equal(ctx.paused,true);assert.equal(ctx.phase,'playing');assert.equal(ctx.renderState.x,target.spawn.x);assert.equal(ctx.accumulator,0);assert.equal(ctx.state.engineFault,'Impact damage');report.scenarios.recovery={target:target.id,conditionPreserved:true};ctx.closeModal();
});
check('An empty tank recovers to the nearest fuel stop and stays empty until refueling',()=>{
 condition({...damaged,fuelLitres:0});place(fuel);ctx.state.x=-410;ctx.state.z=470;const before=physics.getCondition(),target=city.services.find(s=>s.name==='Garden Fuel');ctx.recoverVehicle();assert.equal(ctx.serviceTarget.id,target.id);same(ctx.state.x,target.spawn.x,'Fuel recovery X');same(ctx.state.z,target.spawn.z,'Fuel recovery Z');assert.equal(ctx.state.fuelStarved,true);assert.equal(ctx.state.engineRunning,false);assert.deepEqual(physics.getCondition(),before);ctx.startService('fuel');work(.5);same(ctx.state.fuelLitres,2.5,'Empty-tank refuel');ctx.closeModal();
});
check('Arrest event pauses once; release uses the station, repairs damage, clears police and guarantees 8 L',()=>{
 condition({...damaged,engineHealth:0,engineFault:'Engine failure',fuelLitres:0});place(garage);const oldPosition={x:ctx.state.x,z:ctx.state.z},nos=ctx.state.boost,resets=calls.policeResets;ctx.policeState={phase:'chase',heat:2,arrestProgress:1};ctx.frameControls={throttle:1,boost:true};ctx.handlePoliceEvent({type:'arrest',station:station.spawn});assert.equal(ctx.phase,'arrested');assert.equal(ctx.paused,true);assert.equal(ctx.modalName,'arrest');assert.equal(ctx.state.x,oldPosition.x);assert.equal(ctx.state.z,oldPosition.z);assert.equal(ctx.frameControls.throttle,0);assert.equal(calls.audioSuspended.at(-1),true);
 ctx.releaseFromStation();assert.equal(ctx.phase,'playing');assert.equal(ctx.paused,false);assert.equal(ctx.modalName,null);assert.equal(ctx.arrestStation,null);same(ctx.state.x,station.spawn.x,'Station X');same(ctx.state.z,station.spawn.z,'Station Z');assert.equal(ctx.state.engineHealth,1);assert.equal(ctx.state.bodyHealth,1);assert.equal(ctx.state.gearboxHealth,1);assert.ok(ctx.state.wheelAttached.every(Boolean));assert.equal(ctx.state.engineFault,null);same(ctx.state.fuelLitres,8,'Minimum release fuel');same(ctx.state.boost,nos,'Release preserves NOS bottle');assert.equal(calls.policeResets,resets+1);assert.equal(ctx.policeState.phase,'patrol');assert.equal(ctx.policeState.heat,0);assert.equal(calls.audioSuspended.at(-1),false);assert.equal(ctx.renderState.x,station.spawn.x);assert.equal(ctx.accumulator,0);const once=calls.policeResets;ctx.releaseFromStation();assert.equal(calls.policeResets,once,'Release is idempotent after station token clears');
 const atRelease=ctx.state.fuelLitres;for(let i=0;i<120;i++)physics.update(1/120,{transmission:'sequential',manualClutch:true,clutch:1,gearRequest:0,starter:true,throttle:.1});assert.ok(physics.state.engineRunning,'Repaired and fueled engine must restart through the actual native engine');report.scenarios.arrest={fuelAtRelease:atRelease,nosAtRelease:nos,nativeRestartRpm:physics.state.rpm,station:station.spawn};
});
check('Station release preserves fuel above the minimum and does not give a full tank',()=>{
 condition({...damaged,fuelLitres:19});place(garage);ctx.handlePoliceEvent({type:'arrest',station:station.spawn});ctx.releaseFromStation();same(ctx.state.fuelLitres,19,'Existing fuel above 8 L');same(ctx.state.boost,damaged.boost,'Existing NOS');
});
check('Dock recovery remains a usable fuel/repair/NOS pit when no fuel station exists',()=>{
 condition({...damaged,fuelLitres:0});ctx.world={kind:'dock',services:[{id:'dock-pit',kind:'garage',name:'DOCK PIT',x:0,z:-75,radius:8,spawn:{x:0,z:-75,heading:0}}]};ctx.policeState.phase='patrol';ctx.modalName=null;ctx.paused=false;ctx.phase='playing';ctx.recoverVehicle();assert.equal(ctx.serviceTarget.id,'dock-pit');assert.equal($('service-fuel').classList.contains('hidden'),false);assert.equal($('service-repair').classList.contains('hidden'),false);assert.equal($('service-nos').classList.contains('hidden'),false);assert.equal(ctx.state.fuelLitres,0);ctx.closeModal();ctx.world=city;
});

report.finalMainSha256=createHash('sha256').update(fs.readFileSync(new URL('../dist/main.js',import.meta.url))).digest('hex');report.mainChangedDuringRun=report.mainSha256!==report.finalMainSha256;report.status=report.failures.length?'failed':'passed';
fs.writeFileSync(new URL('./services-v7-results.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,checks:report.checks.length,failures:report.failures,scenarios:report.scenarios,mainChangedDuringRun:report.mainChangedDuringRun},null,2));
await physics.engine.dispose();police.dispose();traffic.dispose();city.dispose();if(report.failures.length)process.exitCode=1;
