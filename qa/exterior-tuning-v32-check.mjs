import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import * as THREE from '../dist/vendor/three.module.js';
import MotorLab from '../sdk/motor-engine.mjs';
import {resolveBuild,VEHICLES,PARTS} from '../dist/catalog.js';
import {EXTERIOR_TUNING_PARTS,EXTERIOR_TUNING_PRICES,exteriorCompatibility,outletPositions} from '../dist/exterior-tuning.js';
import {createCar} from '../dist/car.js';
import {Career} from '../dist/career.js';
import {CarPhysics} from '../dist/physics.js';
import {createVehicleCondition} from '../dist/vehicle-state.js';
import {bodyMassProperties} from '../dist/body-hinges.js';
import {exteriorLayout,repairExterior,damageExterior} from '../dist/exterior-damage.js';
import {underbodyLayout} from '../dist/underbody.js';
import {aerodynamicForces} from '../dist/aerodynamics.js';
import {capsuleContact} from '../dist/contact.js';
import {MULTIPLAYER_VERSION} from '../dist/multiplayer.js';
const checks=[],fixtures={},check=(name,fn)=>{fixtures[name]=fn()??{};checks.push(name);console.log('PASS '+name);};
const oldDoc=globalThis.document;globalThis.document={createElement(){return {getContext(){return {fillText(){},fillRect(){}};}};}};
try{
check('56 categories preserve old choices and reject invalid IDs and incompatible GT/stock-tyre combinations before quoting.',()=>{
 assert.equal(Object.keys(PARTS).length,56);assert.equal(MULTIPLAYER_VERSION,21);
 const saved={carId:'atlas',hood:'scoop',rims:'mesh',frontBumper:'race'};const b=resolveBuild(saved);for(const [k,v]of Object.entries(saved))assert.equal(b.selection[k],v);
 for(const k of Object.keys(EXTERIOR_TUNING_PARTS)){assert.equal(b.selection[k],'stock');assert.equal(resolveBuild({[k]:'__invalid__'}).selection[k],'stock');for(const part of EXTERIOR_TUNING_PARTS[k])assert.ok(Number.isFinite(EXTERIOR_TUNING_PRICES[k][part.id]));}
 assert.ok(exteriorCompatibility({tyreWidth:'stock'},'widebody','gt'));assert.equal(resolveBuild({widebody:'gt'}).selection.widebody,'stock');assert.equal(resolveBuild({widebody:'gt',tyreWidth:'wide'}).selection.widebody,'gt');
});
check('Independent lips and diffusers alter downforce, drag and assembly mass; damage removes their effect without double-counting children.',()=>{
 const base=resolveBuild(),none=resolveBuild({splitter:'none',diffuser:'none'}),race=resolveBuild({splitter:'race',diffuser:'race'}),f=b=>aerodynamicForces(b,createVehicleCondition(b),30);
 assert.ok(f(none).downforce<f(base).downforce&&f(race).downforce>f(base).downforce);assert.ok(f(race).drag>f(base).drag);assert.ok(none.physics.mass<base.physics.mass&&race.physics.mass>base.physics.mass);
 const c=createVehicleCondition(race),before=f(race);c.bodyDamage.exterior.splitter.detached=true;c.bodyDamage.exterior.diffuser.detached=true;assert.ok(aerodynamicForces(race,c,30).downforce<before.downforce);
 const lost=bodyMassProperties(race,c.bodyDamage).missingMass;assert.equal(lost,12);c.bodyDamage.zones.front.detached=true;const frontLoss=bodyMassProperties(race,c.bodyDamage).missingMass;c.bodyDamage.exterior.splitter.detached=false;assert.equal(bodyMassProperties(race,c.bodyDamage).missingMass,frontLoss);
 const absent=createVehicleCondition(none);damageExterior(absent.bodyDamage,none,{local:{x:0,z:2},energyJ:1e9,closingSpeed:40});assert.equal(absent.bodyDamage.exterior.splitter.detached,false);return {base:f(base),none:f(none),race:f(race),lost};
});
check('Wide kits change wheel track and collision width; lightweight skins and their detached masses agree.',()=>{
 for(const v of VEHICLES){const base=resolveBuild({carId:v.id,tyreWidth:'wide'}),wide=resolveBuild({...base.selection,widebody:'gt'}),carbon=resolveBuild({...base.selection,fenders:'carbon',hood:'carbon'});
  assert.ok(wide.physics.halfTrack>base.physics.halfTrack&&wide.physics.bodyWidth>base.physics.bodyWidth&&wide.physics.mass>base.physics.mass);assert.ok(carbon.physics.mass<base.physics.mass);
  const box={x:(base.physics.bodyWidth+wide.physics.bodyWidth)/4+.02,z:0,hx:.01,hz:1};assert.equal(capsuleContact({x:0,z:0,heading:0},box,base),null);assert.ok(capsuleContact({x:0,z:0,heading:0},box,wide));
  const c=createVehicleCondition(carbon);c.bodyDamage.exterior.fenderFL.detached=true;assert.equal(bodyMassProperties(carbon,c.bodyDamage).missingMass,exteriorLayout(carbon).fenderFL.mass);
 }
});
check('Every exterior variant fits all four bodies, keeps finite meshes, mounted children, wrap coordinates and connected outlets, and disposes.',()=>{
 let variants=0,maxMeshes=0;
 for(const v of VEHICLES){const scene=new THREE.Scene(),car=createCar(scene,resolveBuild({carId:v.id}));
  for(const [key,parts]of Object.entries(EXTERIOR_TUNING_PARTS))for(const part of parts){const b=resolveBuild({carId:v.id,tyreWidth:'wide',[key]:part.id});car.setBuild(b);car.group.updateMatrixWorld(true);let count=0;car.group.traverse(n=>{if(!n.isMesh)return;count++;const a=n.geometry.attributes.position?.array;assert.ok(!a||a.every(Number.isFinite));const wrap=n.geometry.attributes.wrapPosition;if(wrap)assert.ok(wrap.array.every(Number.isFinite));});maxMeshes=Math.max(maxMeshes,count);
   const d=car.tuningDiagnostics();assert.ok(d.glassOpacity>0&&d.glassOpacity<1);assert.deepEqual(d.outlets,outletPositions(v.model.kind,b.selection));const branches=underbodyLayout(b).exhaustRear.lines.slice(1).map(line=>line[1][0]);assert.deepEqual(branches,d.outlets);if(key==='splitter'&&part.id==='none')assert.equal(car.exteriorParts.splitter.children.length,0);if(key==='diffuser'&&part.id==='none')assert.equal(car.exteriorParts.diffuser.children.length,0);assert.equal(car.exteriorParts.splitter.parent,car.bodyParts.front);variants++;
  }
  const tuned=resolveBuild({carId:v.id,tyreWidth:'wide',widebody:'gt',grille:'mesh',lightDesign:'led',splitter:'race',diffuser:'race',livery:'sweep',paintFinish:'metallic',windowTint:'dark'});car.setBuild(tuned);const p=new CarPhysics(MotorLab,tuned);car.update(p.state,0,0);p.condition.bodyDamage.exterior.fenderFL.detached=true;p.condition.bodyDamage.exterior.lampFL.health=0;p.condition.bodyDamage.revision++;car.update(p.state,0,0);assert.equal(car.exteriorParts.fenderFL.visible,false);assert.equal(car.exteriorDiagnostics().lampFL.emissive,0);repairExterior(p.condition.bodyDamage,'exterior:fenderFL');car.update(p.state,0,0);assert.equal(car.exteriorParts.fenderFL.visible,true);assert.equal(p.condition.bodyDamage.exterior.lampFL.health,0);car.dispose();assert.equal(scene.children.length,0);
 }
 return {variants,maxMeshes};
});
check('Preview is free; purchase charges once; ownership/build and unrelated damage survive reload and installation.',()=>{
 const career=new Career();career.wallet=100000;const b=resolveBuild({tyreWidth:'wide',widebody:'gt',fenders:'carbon',splitter:'race',grille:'mesh',windowTint:'medium',livery:'sweep',paintFinish:'gloss',exhaustTips:'quad',lightDesign:'led'}),before=career.wallet,q=career.quote(b);assert.ok(q.total>0);assert.equal(career.wallet,before);assert.equal(career.purchase(b).ok,true);assert.equal(career.wallet,before-q.total);assert.equal(career.quote(b).total,0);
 const p=new CarPhysics(MotorLab,resolveBuild());p.condition.bodyDamage.exterior.glassLeft.detached=true;p.condition.bodyDamage.zones.hood.crush=.3;p.setBuild(b);assert.equal(p.condition.bodyDamage.exterior.glassLeft.detached,true);assert.equal(p.condition.bodyDamage.zones.hood.crush,.3);
 const saved=JSON.parse(JSON.stringify({career:career.serialize(),build:b.selection,garage:p.exportGarageState()})),restored=new Career(saved.career,saved.build),b2=resolveBuild(saved.build),p2=new CarPhysics(MotorLab,b2);p2.restoreGarageState(saved.garage);assert.equal(restored.quote(b2).total,0);assert.equal(p2.condition.bodyDamage.exterior.glassLeft.detached,true);assert.equal(b2.signature,b.signature);return {charged:q.total};
});
}finally{globalThis.document=oldDoc;}
const files=['exterior-tuning','exterior-tuning-view','catalog','career','garage','car','car-cosmetics','aerodynamics','body-layout','exterior-damage','underbody','part-shapes','contact','environment','mechanical','main','multiplayer','network-cars'];
const report={version:32,status:'passed',checks,fixtures,sourceSHA256:Object.fromEntries(files.map(n=>['dist/'+n+'.js',createHash('sha256').update(fs.readFileSync(new URL('../dist/'+n+'.js',import.meta.url))).digest('hex')])),limits:['Native geometry/solver checks do not prove rendered appearance or physical hardware performance; browser verification follows.']};fs.writeFileSync(new URL('exterior-tuning-v32-results.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
