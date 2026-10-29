import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import MotorLab from '../sdk/motor-engine.mjs';
import * as THREE from '../dist/vendor/three.module.js';
import {resolveBuild,PARTS,ENGINES,DEFAULT_SELECTION} from '../dist/catalog.js';
import {Career,PART_PRICES} from '../dist/career.js';
import {CarPhysics} from '../dist/physics.js';
import {MechanicalSystem} from '../dist/mechanical.js';
import {createVehicleCondition,snapshotVehicleCondition} from '../dist/vehicle-state.js';
import {deformBody,repairBody,bodyDisplacement} from '../dist/body-damage.js';
import {createCar} from '../dist/car.js';

const dt=1/120,root=new URL('../',import.meta.url),report={version:15,status:'pending',checks:[],fixtures:{},limits:['Deterministic native engine, contact/thermal mechanics and real Three.js geometry in Node. No browser GPU or hardware test.','Crush zones deform the render mesh and collision damage affects vehicle mechanics; this is not a soft-body solver.']};
const check=(name,fn)=>{const value=fn();report.checks.push(name);if(value)report.fixtures[name]=value;console.log('PASS '+name);};
const hashes=()=>Object.fromEntries(['dist/catalog.js','dist/career.js','dist/garage.js','dist/physics.js','dist/mechanical.js','dist/vehicle-state.js','dist/body-damage.js','dist/car.js'].map(name=>[name,createHash('sha256').update(fs.readFileSync(new URL(name,root))).digest('hex')]));
const initial=hashes(),near=(a,b,tolerance=1e-9)=>assert.ok(Math.abs(a-b)<=tolerance,`${a} differs from ${b}`);
const make=selection=>new CarPhysics(MotorLab,resolveBuild(selection));
const neutral={transmission:'hpattern',manualClutch:true,clutch:1,gearRequest:0,assists:false};
const impact=(x,z,energy=350000,speed=24)=>({localPoint:{x,z},impulse:Math.max(20000,energy*2/speed),energyJ:energy,closingSpeed:speed,normal:{x:x? -Math.sign(x):0,z:z? -Math.sign(z):0}});
function thermal(selection={},seconds=140,input={}){
 const build=resolveBuild(selection),c=createVehicleCondition(build),m=new MechanicalSystem(build,c);
 for(let i=0;i<Math.round(seconds/dt);i++)m.step(dt,{omega:(input.rpm??5400)*Math.PI/30,speed:input.speed??23,gear:3,clutchTorque:input.torque??200,wallHeatJ:(input.wall??90000)*dt,frictionJ:(input.friction??26000)*dt,brakeWorkJ:[0,0,0,0],tyreWorkJ:[0,0,0,0]},true);
 return {build,c,m};
}

check('Twenty-five independent part slots are priced, migrate old builds and purchase atomically without charging owned parts twice.',()=>{
 assert.equal(Object.keys(PARTS).length,25);
 const old={carId:'hachi',engineId:'i6t',ecu:'sport',differential:'lsd'},migrated=resolveBuild(old);assert.equal(migrated.selection.ecu,'sport');
 for(const key of ['intake','radiator','oilCooler','internals','transmission','finalDrive','chassis','tyreWidth'])assert.equal(migrated.selection[key],'stock');
 for(const [key,parts]of Object.entries(PARTS))for(const part of parts)assert.ok(Number.isFinite(PART_PRICES[key]?.[part.id]));
 const c=new Career();c.wallet=100000;const selection={radiator:'race',oilCooler:'sport',internals:'sport',tyreWidth:'wide',transmission:'sport'},b=resolveBuild(selection),quote=c.quote(b),before=c.wallet;
 assert.equal(quote.items.length,5);assert.ok(quote.total>20000);assert.equal(c.purchase(b).ok,true);assert.equal(c.wallet,before-quote.total);assert.equal(c.quote(b).total,0);
 const saved=c.serialize(),restored=new Career(saved,b.selection);assert.equal(restored.wallet,c.wallet);assert.equal(restored.quote(b).total,0);
 return {categories:Object.keys(PARTS).length,choices:Object.values(PARTS).reduce((n,p)=>n+p.length,0),purchaseCost:quote.total};
});

check('All eight native engine families accept combined hardware upgrades with finite configuration and unchanged stock solver values.',()=>{
 const stock=resolveBuild();assert.equal(stock.physics.mass,1160);assert.equal(stock.physics.finalDrive,3.8);assert.equal(stock.physics.wheelInertia,1.65);assert.equal(stock.physics.muMultiplier,1);assert.equal(stock.physics.bodyStrength,1);
 const signatures=[];
 for(const spec of ENGINES){const b=resolveBuild({engineId:spec.id,intake:'race',radiator:'race',oilCooler:'race',internals:'race',transmission:'race',finalDrive:'short',chassis:'reinforced',tyreWidth:'race'}),e=MotorLab.createEngine(b.physics.engineOptions);assert.ok(Number.isFinite(e.getState().config.intakeCd));assert.equal(e.getState().config.intakeCd,.79);assert.ok(b.physics.gears.every((r,i)=>i===0||r<b.physics.gears[i-1]));signatures.push(spec.id);e.dispose();}
 return {sdk:MotorLab.version,engines:signatures};
});

check('Gearing, body mass, wheel width and track alter the actual constraint solver and native intake geometry.',()=>{
 const stock=make(),short=make({finalDrive:'short'}),wide=make({tyreWidth:'race',chassis:'reinforced',intake:'race'});
 near(short._ratio(3)/stock._ratio(3),1.12);assert.ok(wide.mass>stock.mass);assert.ok(wide.halfTrack>stock.halfTrack);assert.ok(wide.wheelInertia>stock.wheelInertia);assert.ok(wide.muMultiplier>stock.muMultiplier);
 assert.ok(wide._positions[0][0]<stock._positions[0][0]);assert.equal(wide.engineState.config.throttleCd,.82);assert.ok(wide.engineState.config.intakeLength<stock.engineState.config.intakeLength);
 const values={stockMass:stock.mass,reinforcedWideMass:wide.mass,stockTrack:stock.halfTrack*2,wideTrack:wide.halfTrack*2,shortThirdRatio:short._ratio(3)};stock.engine.dispose();short.engine.dispose();wide.engine.dispose();return values;
});

check('Larger radiator and oil cooler reject measured heat and add fluid capacity instead of multiplying engine power.',()=>{
 const stock=thermal(),radiator=thermal({radiator:'race'}),oil=thermal({oilCooler:'race'});
 assert.ok(radiator.c.mechanical.temperatures.coolant<stock.c.mechanical.temperatures.coolant-3);assert.ok(oil.c.mechanical.temperatures.oil<stock.c.mechanical.temperatures.oil-3);
 near(stock.c.mechanical.energy.engineHeatJ,radiator.c.mechanical.energy.engineHeatJ);near(stock.c.mechanical.energy.oilHeatJ,oil.c.mechanical.energy.oilHeatJ);
 assert.equal(radiator.c.mechanical.coolantCapacity-stock.c.mechanical.coolantCapacity,2);near(oil.c.mechanical.oilCapacity-stock.c.mechanical.oilCapacity,1.2);
 return {coolantStock:stock.c.mechanical.temperatures.coolant,coolantRace:radiator.c.mechanical.temperatures.coolant,oilStock:stock.c.mechanical.temperatures.oil,oilRace:oil.c.mechanical.temperatures.oil};
});

check('Upgraded rotating parts and gearsets resist the same overrev/torque load while severe abuse can still break them.',()=>{
 const load={rpm:10500,torque:450,wall:0,friction:0},stock=thermal({},.8,load),forged=thermal({internals:'race'},.8,load),shaft=thermal({},8,{torque:1400,wall:0,friction:0}),gears=thermal({transmission:'race'},8,{torque:1400,wall:0,friction:0}),abused=thermal({internals:'race'},2,{rpm:19000,torque:800,wall:0,friction:0});
 assert.ok(forged.c.mechanical.health.valvetrain>stock.c.mechanical.health.valvetrain);assert.ok(forged.c.mechanical.health.pistons>stock.c.mechanical.health.pistons);assert.ok(gears.c.mechanical.health.driveshaft>shaft.c.mechanical.health.driveshaft);assert.ok(gears.c.mechanical.gearHealth[3]>shaft.c.mechanical.gearHealth[3]);assert.ok(abused.c.mechanical.health.valvetrain<.1);
 return {stockValve:stock.c.mechanical.health.valvetrain,raceValve:forged.c.mechanical.health.valvetrain,stockShaft:shaft.c.mechanical.health.driveshaft,raceShaft:gears.c.mechanical.health.driveshaft};
});

check('Front, rear and side hits create independent persistent crush zones and functional wheel alignment damage.',()=>{
 const p=make();p.applyImpact(impact(0,2.1));const front={...p.condition.bodyDamage.zones.front};assert.ok(front.crush>0);assert.equal(p.condition.bodyDamage.zones.rear.crush,0);
 p.applyImpact(impact(0,-2.1));assert.deepEqual(p.condition.bodyDamage.zones.front,front);assert.ok(p.condition.bodyDamage.zones.rear.crush>0);
 p.applyImpact(impact(.88,1.30,180000,18));assert.ok(p.condition.suspensionHealth[1]<1);assert.ok(Math.abs(p.condition.wheelToe[1])>0);assert.equal(p.condition.wheelToe[0],0);
 const body=JSON.parse(JSON.stringify(p.condition.bodyDamage)),condition=p.getCondition();p.reset(20,30,.2);assert.deepEqual(p.condition.bodyDamage,body);
 condition.bodyDamage.zones.front.crush=0;assert.notEqual(p.condition.bodyDamage.zones.front.crush,0);
 const result={frontCrush:p.condition.bodyDamage.zones.front.crush,rearCrush:p.condition.bodyDamage.zones.rear.crush,wheelToe:p.condition.wheelToe};p.engine.dispose();return result;
});

check('Chassis reinforcement reduces the same collision damage; switching builds and saved garage state never repairs crush zones.',()=>{
 const stock=make(),strong=make({chassis:'reinforced'});for(const p of [stock,strong])p.applyImpact(impact(.9,1.3,180000,18));assert.ok(strong.condition.bodyHealth>stock.condition.bodyHealth);assert.ok(strong.condition.suspensionHealth[1]>stock.condition.suspensionHealth[1]);
 const saved=stock.getCondition().bodyDamage;stock.setBuild(resolveBuild({carId:'atlas'}));stock.setBuild(resolveBuild({internals:'race'}));assert.deepEqual(stock.getCondition().bodyDamage,saved);
 const copy=make();copy.restoreGarageState(JSON.parse(JSON.stringify(stock.exportGarageState())));assert.deepEqual(copy.getCondition().bodyDamage,saved);
 const result={stockHealth:stock.condition.bodyHealth,reinforcedHealth:strong.condition.bodyHealth};for(const p of [stock,strong,copy])p.engine.dispose();return result;
});

check('Broken bumpers detach with finite motion, selective panel repair leaves other damage and fluids alone, and damage-off suppresses crush.',()=>{
 const p=make();p.applyImpact(impact(0,2.1,600000,26));assert.equal(p.condition.bodyDamage.zones.front.detached,true);assert.equal(p.state.detachedPanels.length,1);const piece={...p.state.detachedPanels[0]},hood=p.condition.bodyDamage.zones.hood.crush,fuel=p.condition.fuelLitres;
 for(let i=0;i<60;i++)p._updateDebris(dt);assert.ok(p.state.detachedPanels[0].age>.49);assert.notEqual(p.state.detachedPanels[0].rotation,piece.rotation);assert.ok(['x','y','z','rotation'].every(k=>Number.isFinite(p.state.detachedPanels[0][k])));
 assert.equal(p.repairComponents(['panel:front']).repaired,true);assert.equal(p.condition.bodyDamage.zones.front.detached,false);assert.equal(p.condition.bodyDamage.zones.front.crush,0);assert.equal(p.condition.bodyDamage.zones.hood.crush,hood);assert.equal(p.condition.fuelLitres,fuel);assert.equal(p.state.detachedPanels.length,0);
 const before=p.getCondition();p.setDamageEnabled(false);p.applyImpact(impact(0,-2.1,900000,30));assert.deepEqual(p.getCondition().bodyDamage,before.bodyDamage);
 p.repairComponents(['body']);assert.ok(Object.values(p.condition.bodyDamage.zones).every(z=>z.crush===0&&z.health===1));p.engine.dispose();
});

check('Mesh deformation changes only the damaged car, keeps all vertices finite and renders actual wider tyres with removable bumpers.',()=>{
 const previous=globalThis.document;globalThis.document={createElement(tag){assert.equal(tag,'canvas');return {width:0,height:0,getContext(){return {fillRect(){},fillText(){}};}};}};
 try{
  const scene=new THREE.Scene(),b=resolveBuild(),wide=resolveBuild({tyreWidth:'race',chassis:'reinforced'}),a=createCar(scene,b),c=createCar(scene,wide),condition=createVehicleCondition(b),state={bodyDamage:condition.bodyDamage,bodyHealth:1,brake:0};
  a.update(state,dt,0);c.update({bodyHealth:1},dt,0);
  const meshList=car=>{const list=[];car.group.traverse(n=>{if(n.isMesh&&n.geometry?.attributes.position)list.push(n);});return list;},am=meshList(a),cm=meshList(c),before=am.map(n=>n.geometry.attributes.position.array.slice()),other=cm.map(n=>n.geometry.attributes.position.array.slice());
  assert.ok(am.every(m=>cm.every(n=>m.geometry!==n.geometry)),'cars own their geometry');
  deformBody(condition.bodyDamage,b,{local:{x:.75,z:1.8},energyJ:450000,closingSpeed:24});a.update(state,dt,1);let changed=0;
  am.forEach((mesh,index)=>{const values=mesh.geometry.attributes.position.array;for(let i=0;i<values.length;i++){assert.ok(Number.isFinite(values[i]));if(Math.abs(values[i]-before[index][i])>1e-6)changed++;}});assert.ok(changed>50);
  cm.forEach((m,i)=>assert.deepEqual(m.geometry.attributes.position.array,other[i]));
  assert.ok(c.wheels.every(w=>{let found=false;w.traverse(n=>{if(n.geometry?.type==='CylinderGeometry'&&n.geometry.parameters.radiusTop===wide.physics.wheelRadius&&n.geometry.parameters.height===.34)found=true;});return found;}));
  repairBody(condition.bodyDamage);a.update(state,dt,2);am.forEach((mesh,index)=>{const values=mesh.geometry.attributes.position.array;for(let i=0;i<values.length;i++)near(values[i],before[index][i],1e-6);});
  a.dispose();c.dispose();return {changedCoordinates:changed,meshes:am.length,wideTyreMetres:.34};
 }finally{globalThis.document=previous;}
});

assert.deepEqual(hashes(),initial,'Modular source changed during its QA run');report.sourceSHA256=initial;report.status='passed';
fs.writeFileSync(new URL('./modular-v15-results.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
