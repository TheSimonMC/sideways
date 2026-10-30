import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import * as THREE from '../dist/vendor/three.module.js';
import MotorLab from '../sdk/motor-engine.mjs';
import {VEHICLES,ENGINES,resolveBuild} from '../dist/catalog.js';
import {CarPhysics} from '../dist/physics.js';
import {createCar} from '../dist/car.js';
import {cockpitSettings,cockpitLayout,cockpitReadings} from '../dist/cockpit-state.js';
import {CockpitMirrors} from '../dist/cockpit-mirrors.js';
import {steeringDemand} from '../dist/chassis-setup.js';
import {InputManager} from '../dist/input.js';
import {sanitizeNetworkPose} from '../dist/multiplayer.js';
import {GameAudio} from '../dist/audio.js';
const checks=[],fixtures={},dt=1/120;
const check=(label,fn)=>{fixtures[label]=fn()??{};checks.push(label);console.log('PASS '+label);};
const doc=globalThis.document;globalThis.document={createElement(){return {getContext(){return {fillText(){},fillRect(){}};}};}};
try{
check('Seat/FOV sanitation preserves legacy defaults and stays within each authored cabin; eight engine swaps use their actual redline.',()=>{
 const settings=cockpitSettings({seatHeight:9,seatDistance:-9,fov:Infinity,motion:NaN,wheel:false});assert.equal(settings.seatHeight,.07);assert.equal(settings.seatDistance,-.14);assert.equal(settings.fov,76);assert.equal(settings.wheel,false);
 for(const vehicle of VEHICLES){const b=resolveBuild({carId:vehicle.id}),l=cockpitLayout(b);assert.ok(l.eye[1]+.07<l.q.roof-.07);assert.ok(l.eye[2]-.14>l.back);assert.ok(l.eye[2]+.12<l.dashZ-.2);for(const e of ENGINES){const swapped=resolveBuild({carId:vehicle.id,engineId:e.id});assert.equal(cockpitReadings({},swapped).redline,swapped.physics.redlineRpm);}}
});
check('Instruments expose actual units, gears, coolant/oil, pressure, fuel and component warnings; electrical loss disables the screen.',()=>{
 const b=resolveBuild(),s={speed:-25,rpm:4200,gear:-1,fuelLitres:4,fuelCapacity:50,handbrake:1,mechanical:{oilPressureBar:.2,temperatures:{coolant:118,oil:123,engine:128},auxiliaries:{voltage:10},warnings:['test fault']}};
 const r=cockpitReadings(s,b);assert.equal(r.speed,90);assert.equal(r.rpm,4200);assert.equal(r.gear,'R');assert.equal(r.coolant,118);assert.equal(r.oil,123);assert.equal(r.fuel,.08);assert.ok(Object.values(r.warnings).every(Boolean));assert.equal(r.powered,true);s.mechanical.auxiliaries.voltage=0;assert.equal(cockpitReadings(s,b).powered,false);return r;
});
check('All four existing cars retain fitted animated interiors, camera transforms, real hand contacts, correct console hand, pedal feet and door/mirror damage.',()=>{
 return VEHICLES.map(v=>{const b=resolveBuild({carId:v.id}),p=new CarPhysics(MotorLab,b),scene=new THREE.Scene(),car=createCar(scene,b),l=cockpitLayout(b);try{
  p.reset();const s=p.state,options={cockpit:true,settings:cockpitSettings()},step=()=>{car.group.position.set(s.x,0,s.z);car.group.rotation.y=s.heading;car.update(s,dt,0);car.updateCockpit(s,dt,0,options);};step();
  assert.equal(car.cockpitDiagnostics().driver.headVisible,false);assert.equal(car.cockpitMirrors.length,3);assert.ok(car.group.getObjectByName('navigation-radio-screen'));assert.ok(car.group.getObjectByName('interior-door-left').parent===car.bodyParts.left);
  let regrips=0;for(let n=0;n<260;n++){s.steer=Math.sin(n/65)*b.physics.steeringLock;step();const d=car.cockpitDiagnostics();assert.ok(Math.abs(d.wheelAngle+s.steer*b.physics.steeringRatio)<1e-8);for(const h of d.driver.hands){assert.ok(h.position.every(Number.isFinite));if(h.gripping)assert.ok(Math.abs(h.error)<1e-8);if(h.regripping)regrips++;}for(const name of ['upper-arm-0','upper-arm-1','forearm-0','forearm-1']){const m=car.group.getObjectByName(name);assert.ok(m.position.z<l.dashZ-.1,'arm stays behind dash face');assert.ok(m.scale.y<.50,'bounded limb reach');}}
  assert.ok(regrips>0);s.steer=0;s.handbrake=1;for(let n=0;n<40;n++)step();const d=car.cockpitDiagnostics(),consoleHand=l.driverX<0?1:0;assert.equal(d.driver.hands[consoleHand].gripping,false);assert.ok(Math.abs(d.driver.hands[consoleHand].position[0]-l.handbrake[0])<1e-6);
  s.handbrake=0;s.gear=2;step();assert.ok(car.cockpitDiagnostics().driver.shift>0);s.clutch=1;s.brake=1;step();assert.equal(car.cockpitDiagnostics().pedals[0].angle,-.35);assert.ok(Math.abs(car.cockpitDiagnostics().driver.feet[0][0]-l.driverX)<1e-8);s.brake=0;s.throttle=1;step();assert.ok(car.cockpitDiagnostics().driver.feet[0][0]<l.driverX);
  options.settings.wheel=false;options.settings.hands=false;step();assert.equal(car.cockpitDiagnostics().wheelVisible,false);assert.ok(car.cockpitDiagnostics().driver.hands.every(h=>!h.visible));options.cockpit=false;step();assert.equal(car.cockpitDiagnostics().driver.headVisible,true);assert.ok(car.cockpitDiagnostics().driver.hands.every(h=>h.visible));
  s.heading=.8;s.x=13;s.z=24;s.bodyRoll=.1;step();const pose=car.cockpitPose(cockpitSettings(),.7,.2,s);assert.ok(pose.position.toArray().every(Number.isFinite));assert.ok(Math.abs(pose.up.x)>.01);assert.ok(pose.position.distanceTo(new THREE.Vector3(13,0,24))<3);
  p.condition.bodyDamage.zones.left.detached=true;p.condition.bodyDamage.exterior.mirrorRight.detached=true;p.condition.bodyDamage.revision++;step();assert.equal(car.bodyParts.left.visible,false);assert.equal(car.exteriorParts.mirrorRight.visible,false);p.repairComponents(['panel:left','exterior:mirrorRight']);step();assert.equal(car.bodyParts.left.visible,true);assert.equal(car.exteriorParts.mirrorRight.visible,true);return {car:v.id,regrips,style:d.style};
 }finally{car.dispose();p.engine.dispose();assert.equal(scene.children.length,0);}});
});
check('Mirror rendering stays bounded, skips removed mirrors, restores renderer state and releases targets without flipping UVs twice.',()=>{
 const b=resolveBuild(),p=new CarPhysics(MotorLab,b),scene=new THREE.Scene(),car=createCar(scene,b);let target=null,rendered=0;const r={shadowMap:{autoUpdate:true},info:{autoReset:true,render:{calls:10}},getRenderTarget:()=>target,setRenderTarget:t=>target=t,clear(){},render(){assert.equal(car.group.visible,false);this.info.render.calls+=7;rendered++;}},mirrors=new CockpitMirrors(r);
 try{car.update(p.state,dt,0);for(let n=0;n<120;n++)mirrors.update(scene,car,dt,{active:true});assert.ok(rendered>=15&&rendered<=18);assert.ok(mirrors.diagnostics().mirrors.every(m=>m.frames>0));assert.equal(mirrors.lastCalls,7);assert.equal(r.info.autoReset,true);assert.equal(r.shadowMap.autoUpdate,true);assert.equal(car.group.visible,true);assert.equal(target,null);
  const frames=mirrors.frames;for(let n=0;n<60;n++)mirrors.update(scene,car,dt,{active:false});assert.equal(mirrors.frames,frames);assert.ok(car.cockpitMirrors.every(m=>m.mesh.material.map===null));
  car.exteriorParts.mirrorRight.visible=false;const previous=mirrors.records[2].frames;for(let n=0;n<60;n++)mirrors.update(scene,car,dt,{active:true});assert.equal(mirrors.records[2].frames,previous);
  const uv=[...car.cockpitMirrors[0].mesh.geometry.attributes.uv.array];mirrors.dispose();mirrors.update(scene,car,dt,{active:true});assert.deepEqual([...car.cockpitMirrors[0].mesh.geometry.attributes.uv.array],uv);return {rendered,targets:mirrors.records.length};
 }finally{mirrors.dispose();car.dispose();p.engine.dispose();}
});
check('A calibrated wheel maps its declared rotation through each fitted rack; keyboard/gamepad demand and legacy full-range wheel mapping remain unchanged.',()=>{
 const results=[];for(const v of VEHICLES){const b=resolveBuild({carId:v.id}),p=new CarPhysics(MotorLab,b);try{const expected=(900*.5/2)*Math.PI/180/b.physics.steeringRatio;assert.ok(Math.abs(steeringDemand(.5,60,b.physics,'wheel',900).target-expected)<1e-10);assert.equal(steeringDemand(.8,50,b.physics,'xbox',900).target,steeringDemand(.8,50,b.physics,'xbox').target);assert.equal(steeringDemand(1,50,b.physics,'wheel').target,b.physics.steeringLock);for(let i=0;i<100;i++)p.update(dt,{steer:.5,deviceKind:'wheel',wheelRotation:900});assert.ok(Math.abs(p.state.steer-expected)<.002);results.push({car:v.id,roadAngle:p.state.steer,expected});}finally{p.engine.dispose();}}return results;
});
check('Existing pose packets retain bounded driver controls and physical instrument state without a new message stream.',()=>{const remote=sanitizeNetworkPose({x:0,z:0,heading:0,clutch:1,handbrake:.7,accelerationLong:300,fuelLitres:12,fuelCapacity:50,engineFault:'oil_pressure',mechanical:{temperatures:{coolant:118,oil:124},oilPressureBar:.3,auxiliaries:{voltage:6}}});assert.equal(remote.clutch,1);assert.equal(remote.handbrake,.7);assert.equal(remote.accelerationLong,30);const r=cockpitReadings(remote,resolveBuild());assert.equal(r.fuel,.24);assert.equal(r.powered,false);assert.equal(r.coolant,118);assert.equal(r.oil,124);assert.equal(r.warnings.engine,true);return {bytes:JSON.stringify(remote).length};});
check('Keyboard and assigned controller radio actions work; wheel rotation, bindings and profiles survive saving/loading.',()=>{
 const saved=new Map(),events=new Map(),target={addEventListener(k,f){events.set(k,f);},removeEventListener(){}},storage={getItem:k=>saved.get(k),setItem:(k,v)=>saved.set(k,v)},pad={id:'Logitech G920',index:0,mapping:'',connected:true,axes:[0,1],buttons:Array.from({length:12},()=>({value:0,pressed:false}))},input=new InputManager({target,document:{},storage,navigator:{getGamepads:()=>[pad]}}),tick=()=>input.sample(1/60);
 try{for(let i=0;i<8;i++)tick();for(const [code,action]of [['KeyU','radio'],['BracketRight','radioUp'],['BracketLeft','radioDown']]){events.get('keydown')({code,target:{tagName:'CANVAS'}});assert.ok(tick().actions.includes(action));events.get('keyup')({code});tick();}const ref=input.listDevices()[0].ref;input.bind('steer',{type:'axis',device:ref,index:0,min:-1,center:0,max:1,deadzone:0,curve:1});input.bind('radio',{type:'button',device:ref,index:6});input.setConfig({wheelRotation:900});input.saveProfile('V29 wheel');for(let i=0;i<8;i++)tick();pad.buttons[6]={value:1,pressed:true};assert.ok(tick().actions.includes('radio'));pad.axes[0]=.5;assert.ok(Math.abs(tick().controls.steer-.5)<.001);input.setConfig({wheelRotation:270});input.loadProfile('V29 wheel');assert.equal(input.getConfig().wheelRotation,900);const reload=new InputManager({target:{},document:{},storage,navigator:{getGamepads:()=>[]}});assert.equal(reload.getConfig().wheelRotation,900);assert.ok(reload.getConfig().bindings.radio);reload.destroy();}finally{input.destroy();}
});
check('Cockpit wind is quieter when closed and responds to the actual missing window; processed native audio remains finite and limited.',()=>{
 const b=resolveBuild(),p=new CarPhysics(MotorLab,b),a=new GameAudio({pcmEnabled:true});try{a.setBuild(b);a.update({...p.state,speed:40});a.setCamera(1);for(let i=0;i<10;i++)a.advanceEngine(p.engine,1/60);const outside=a._windTarget;a.setCamera(3);for(let i=0;i<10;i++)a.advanceEngine(p.engine,1/60);const inside=a._windTarget;assert.ok(inside<outside*.5);p.state.bodyDamage.exterior.glassLeft.detached=true;a.update({...p.state,speed:40});for(let i=0;i<10;i++)a.advanceEngine(p.engine,1/60);assert.ok(a._windTarget>inside);assert.ok(a._cabinOpening>0);assert.ok(Number.isFinite(a.getDiagnostics().outputPeak)&&a.getDiagnostics().outputPeak<=.94);return {outside,inside,open:a._windTarget};}finally{p.engine.dispose();}
});
}finally{globalThis.document=doc;}
const files=['car','interior','driver','cockpit-state','cockpit-mirrors','main','input','controls-ui','physics','chassis-setup','audio','multiplayer','network-cars'];
const sourceSHA256=Object.fromEntries(files.map(n=>{const f='dist/'+n+'.js';return [f,createHash('sha256').update(fs.readFileSync(new URL('../'+f,import.meta.url))).digest('hex')];}));
fs.writeFileSync(new URL('cockpit-v29-results.json',import.meta.url),JSON.stringify({version:29,status:'passed',checks,fixtures,sourceSHA256,limits:['Native state/Three.js geometry and mocked browser-visible input. No physical wheel or force-feedback hardware validation.','Canvas drawing, actual mirror pixels and full-game UI are covered by separate browser checks.']},null,2));
