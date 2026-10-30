import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import MotorLab from '../sdk/motor-engine.mjs';
import * as THREE from '../dist/vendor/three.module.js';
import {resolveBuild,VEHICLES} from '../dist/catalog.js';
import {CarPhysics} from '../dist/physics.js';
import {createVehicleCondition} from '../dist/vehicle-state.js';
import {EXTERIOR_PARTS,damageExterior,exteriorLayout,exteriorMissing,lampOutput,windowAir} from '../dist/exterior-damage.js';
import {repairBody} from '../dist/body-damage.js';
import {bodyMassProperties} from '../dist/body-hinges.js';
import {aerodynamicForces} from '../dist/aerodynamics.js';
import {createCar} from '../dist/car.js';
import {DayNight} from '../dist/environment.js';
import {GameAudio} from '../dist/audio.js';
import {sanitizeNetworkPose,MULTIPLAYER_VERSION} from '../dist/multiplayer.js';
const checks=[],fixtures={},b=resolveBuild(),dt=1/120;
const check=(name,fn)=>{fixtures[name]=fn()??{};checks.push(name);console.log('PASS '+name);};
check('Existing V1/V2 saves retain dents and door hinges; twenty bounded exterior components default healthy.',()=>{
 const c=createVehicleCondition(b,{bodyDamage:{version:2,zones:{left:{health:.5,crush:.2,angle:.8,open:true},front:{detached:true}}}});
 assert.equal(c.bodyDamage.version,3);assert.equal(Object.keys(c.bodyDamage.exterior).length,20);assert.equal(c.bodyDamage.zones.left.angle,.8);assert.equal(c.bodyDamage.zones.left.crush,.2);assert.ok(c.bodyDamage.zones.front.detached);
 const bad=createVehicleCondition(b,{bodyDamage:{exterior:{lampFL:{health:Infinity,mounts:-5,scratches:NaN},unexpected:{}}}});assert.equal(bad.bodyDamage.exterior.unexpected,undefined);assert.ok(Number.isFinite(bad.bodyDamage.exterior.lampFL.health));assert.equal(bad.bodyDamage.exterior.lampFL.mounts,0);
});
check('Local strikes damage the struck lamp/window and preserve the opposite side; screens crack before shattering.',()=>{
 const c=createVehicleCondition(b),body=c.bodyDamage,l=exteriorLayout(b),point=id=>({x:l[id].center[0],z:l[id].center[2]});
 const hit=damageExterior(body,b,{local:point('lampFL'),energyJ:b.physics.mass*90*.76,closingSpeed:18});
 assert.equal(lampOutput(body,'lampFL'),0);assert.equal(lampOutput(body,'lampFR'),1);assert.equal(body.exterior.lampFL.detached,false);
 repairBody(body);damageExterior(body,b,{local:point('glassFront'),energyJ:b.physics.mass*90*.25,closingSpeed:10});assert.ok(body.exterior.glassFront.cracked);assert.equal(body.exterior.glassFront.detached,false);
 const shattered=damageExterior(body,b,{local:point('glassLeft'),energyJ:b.physics.mass*90,closingSpeed:20});assert.ok(shattered.brokenGlass.includes('glassLeft'));assert.equal(body.exterior.glassRight.health,1);assert.ok(windowAir(body)>.7);
 return {leftLamp:hit,shattered:shattered.brokenGlass};
});
check('Collision integration, exact component repair, migration/reload and reset preserve consistent mass and diagnostics.',()=>{
 const p=new CarPhysics(MotorLab,b),l=exteriorLayout(b),v=l.mirrorLeft.center;
 p.applyImpact({localPoint:{x:v[0],z:v[2]},energyJ:b.physics.mass*150,closingSpeed:25,impulse:50000,normal:{x:1,z:0}});
 assert.ok(p.condition.bodyDamage.exterior.mirrorLeft.detached);assert.equal(p.condition.bodyDamage.exterior.mirrorRight.detached,false);assert.ok(p.state.detachedPanels.some(x=>x.panel==='exterior:mirrorLeft'));assert.ok(p.mass<b.physics.mass);
 const saved=p.getCondition();p.reset();assert.ok(p.condition.bodyDamage.exterior.mirrorLeft.detached);p.restoreCondition(saved);assert.deepEqual(p.getCondition().bodyDamage,saved.bodyDamage);
 const rows=p.state.mechanical.components;assert.equal(rows.filter(x=>x.id.startsWith('exterior:')).length,20);assert.equal(rows.find(x=>x.id==='exterior:mirrorLeft').status,'failed');
 const other=p.condition.bodyDamage.exterior.skirtLeft.health;p.repairComponents(['exterior:mirrorLeft']);assert.equal(p.condition.bodyDamage.exterior.mirrorLeft.detached,false);assert.equal(p.condition.bodyDamage.exterior.skirtLeft.health,other);assert.ok(!p.state.detachedPanels.some(x=>x.panel==='exterior:mirrorLeft'));
 p.repair();assert.equal(p.mass,b.physics.mass);assert.ok(Object.values(p.condition.bodyDamage.exterior).every(x=>x.health===1&&!x.detached));p.engine.dispose();
});
check('Shattered glass emits independently moving, colliding fragments with a fixed 24-slot cap and eight-second lifetime.',()=>{
 const p=new CarPhysics(MotorLab,b),v=exteriorLayout(b).glassFront.center;
 const hit=p.applyImpact({localPoint:{x:v[0],z:v[2]},energyJ:b.physics.mass*90,closingSpeed:18,impulse:30000});assert.ok(hit.brokenGlass.includes('glassFront'));assert.ok(p.state.glassShards.length>=6);const first=p.state.glassShards[0],x=first.x,y=first.y;p._updateDebris(.05);assert.ok(first.x!==x||first.y!==y);
 Object.assign(first,{x:-2,z:0,y:.2,vx:25,vz:0,vy:0});p.setDebrisColliders(()=>[{x:0,z:0,hx:.05,hz:5,height:3}]);for(let i=0;i<60;i++)p._updateDebris(dt);assert.ok(first.contacts>0);assert.ok(first.x<0);
 for(let i=0;i<10;i++)p._shatterGlass('glassLeft');assert.equal(p.state.glassShards.length,24);for(const f of p.state.glassShards)f.age=8;p._updateDebris(.01);assert.equal(p.state.glassShards.length,0);p.engine.dispose();
});
check('Nested assemblies do not subtract child mass twice, and separate splitter/diffuser loss changes downforce.',()=>{
 const c=createVehicleCondition(b),body=c.bodyDamage;body.exterior.mirrorLeft.detached=true;assert.equal(bodyMassProperties(b,body).missingMass,1.2);
 body.zones.left.detached=true;assert.equal(bodyMassProperties(b,body).missingMass,29);body.zones.left.detached=false;assert.equal(bodyMassProperties(b,body).missingMass,1.2);
 const base=aerodynamicForces(b,c,40);body.exterior.splitter.detached=true;const front=aerodynamicForces(b,c,40);assert.ok(front.front<base.front);assert.equal(front.rear,base.rear);body.exterior.diffuser.detached=true;assert.ok(aerodynamicForces(b,c,40).rear<base.rear);
});
const prior=globalThis.document;globalThis.document={createElement(){return {getContext(){return {fillText(){},fillRect(){},createRadialGradient(){return {addColorStop(){}};}};}};}};
try{
check('Every original car and tuned variant has all twenty real exterior assemblies; absent parts disappear without hiding their parent.',()=>{
 const results=[];
 for(const vehicle of VEHICLES)for(const tune of [false,true]){
  const build=resolveBuild({carId:vehicle.id,...(tune?{hood:'vented',frontBumper:'race',rearBumper:'race',sideSkirts:'race'}:{})}),scene=new THREE.Scene(),car=createCar(scene,build),body=createVehicleCondition(build).bodyDamage;
  car.update({bodyDamage:body,headlights:true},dt,0);
  for(const [id,root]of Object.entries(car.exteriorParts)){let count=0;root.traverse(n=>{if(n.isMesh)count++;});assert.ok(count>0,vehicle.id+' '+id+' '+tune);}
  body.exterior.glassLeft={health:.4,mounts:.5,scratches:.6,cracked:true,detached:false};body.exterior.lampFL.health=.2;body.revision++;car.update({bodyDamage:body,headlights:true,brake:1},dt,0);
  assert.equal(car.exteriorDiagnostics().lampFL.emissive,0);assert.ok(car.exteriorDiagnostics().lampFR.emissive>2);let marks=0;car.exteriorParts.glassLeft.traverse(n=>{if(n.name==='surface-damage'&&n.visible&&n.geometry.attributes.position.count>0)marks++;});assert.ok(marks>0);
  body.exterior.mirrorLeft.detached=true;body.exterior.glassLeft.detached=true;body.revision++;car.update({bodyDamage:body,headlights:true,detachedPanels:[{id:1,panel:'exterior:mirrorLeft',x:-4,y:.2,z:0}]},dt,1);
  assert.equal(car.exteriorDiagnostics().mirrorLeft.visible,false);assert.equal(car.exteriorDiagnostics().glassLeft.visible,false);assert.equal(car.bodyParts.left.visible,true);assert.equal(car.exteriorDiagnostics().mirrorRight.visible,true);
  let loose=0;scene.getObjectByName('DETACHED-WHEELS').traverse(n=>{if(n.isMesh&&n.userData.exterior==='mirrorLeft'&&n.visible)loose++;});assert.ok(loose>0);
  repairBody(body,'exterior:glassLeft');car.update({bodyDamage:body},dt,2);assert.ok(car.exteriorDiagnostics().glassLeft.visible);let visibleCracks=0;car.exteriorParts.glassLeft.traverse(n=>{if(n.name==='surface-damage'&&n.visible)visibleCracks++;});assert.equal(visibleCracks,0);
  results.push({vehicle:vehicle.id,tune,loose,marks});car.dispose();assert.equal(scene.children.length,0);
 }
 return results;
});
check('A failed left headlamp extinguishes only its actual night spotlight; component repair restores light.',()=>{
 const scene=new THREE.Scene();scene.fog=new THREE.Fog(0,1,100);const renderer={},sun=new THREE.DirectionalLight(),env=new DayNight(scene,renderer,sun),camera=new THREE.PerspectiveCamera(),body=createVehicleCondition(b).bodyDamage;
 const state={x:0,z:0,heading:0,bodyDamage:body};env.update(0,state,camera,{timeMode:'night',headlights:true,weatherMode:'clear',quality:'medium'});const full=env.headlights.map(p=>p.light.intensity);assert.ok(full.every(x=>x>30));body.exterior.lampFL.health=.2;env.update(0,state,camera,{timeMode:'night',headlights:true,quality:'medium'});assert.equal(env.headlights[0].light.intensity,0);assert.equal(env.headlights[1].light.intensity,full[1]);repairBody(body,'exterior:lampFL');env.update(0,state,camera,{timeMode:'night',headlights:true,quality:'medium'});assert.equal(env.headlights[0].light.intensity,full[0]);return {full};
});
}finally{globalThis.document=prior;}
check('Broken glass increases actual wind PCM; a missing exhaust outlet adds outlet noise; break transient is finite and bounded.',()=>{
 const audio=new GameAudio({pcmEnabled:true}),engine=MotorLab.createEngine('i4'),body=createVehicleCondition(b).bodyDamage,state={x:0,z:0,heading:0,speed:40,bodyDamage:body,engineRunning:true,rpm:1000};audio.setBuild(b);audio.setCamera(1);audio.update(state);engine.setInputs({starter:true,throttle:.4});for(let i=0;i<20;i++)audio.advanceEngine(engine,1/60);const closed=audio._windTarget;
 body.exterior.glassLeft.detached=true;for(let i=0;i<20;i++)audio.advanceEngine(engine,1/60);assert.ok(audio._windTarget>closed*1.2);body.exterior.exhaustTip.detached=true;audio.glassBreak({x:0,z:0});for(let i=0;i<20;i++)audio.advanceEngine(engine,1/60);assert.ok(audio._exhaustLeakTarget>0);assert.ok(audio.getDiagnostics().outputPeak<=.94);engine.dispose();return {closed,broken:audio._windTarget};
});
check('Protocol 18 bounds both damage stores, preserves per-lamp/window state and stays below packet limits.',()=>{
 assert.equal(MULTIPLAYER_VERSION,18);const body=createVehicleCondition(b).bodyDamage;body.exterior.glassFront.detached=true;body.exterior.lampFL.health=.2;body.zones.left.scratches=.5;
 const pose=sanitizeNetworkPose({x:0,z:0,heading:0,bodyDamage:body});assert.ok(pose.bodyDamage.exterior.glassFront.detached);assert.equal(lampOutput(pose.bodyDamage,'lampFL'),0);assert.equal(pose.bodyDamage.zones.left.scratches,.5);assert.equal(Object.keys(pose.bodyDamage.exterior).length,20);assert.ok(JSON.stringify(pose).length<6500);return {bytes:JSON.stringify(pose).length};
});
const sourceSHA256=Object.fromEntries(['exterior-damage','surface-damage','body-damage','body-hinges','physics','car','car-cosmetics','mechanical','environment','audio','aerodynamics','multiplayer','main'].map(n=>{const file='dist/'+n+'.js';return [file,createHash('sha256').update(fs.readFileSync(new URL('../'+file,import.meta.url))).digest('hex')];}));
fs.writeFileSync(new URL('./exterior-v27-results.json',import.meta.url),JSON.stringify({version:27,status:'passed',checks,fixtures,sourceSHA256,limits:['Static contact proxies and locally bounded debris, no full soft body; up to 24 small glass proxies.','No claim of completed cockpit/interior or motor-bay phases.']},null,2)+'\n');
