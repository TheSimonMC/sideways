import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import MotorLab from '../sdk/motor-engine.mjs';
import * as THREE from '../dist/vendor/three.module.js';
import {resolveBuild,VEHICLES} from '../dist/catalog.js';
import {GameAudio} from '../dist/audio.js';
import {CarPhysics} from '../dist/physics.js';
import {createVehicleCondition} from '../dist/vehicle-state.js';
import {deformBody,repairBody} from '../dist/body-damage.js';
import {stepBodyHinges,bodyMassProperties,openDoorContacts} from '../dist/body-hinges.js';
import {bodyLayout,panelCenter} from '../dist/body-layout.js';
import {advanceDebris} from '../dist/panel-debris.js';
import {createCar} from '../dist/car.js';
import {sanitizeNetworkPose,MULTIPLAYER_VERSION} from '../dist/multiplayer.js';
import {aerodynamicForces} from '../dist/aerodynamics.js';
const checks=[],fixtures={},dt=1/120,b=resolveBuild(),make=()=>new CarPhysics(MotorLab,b);
const check=(name,fn)=>{fixtures[name]=fn()??{};checks.push(name);console.log('PASS '+name);};
check('V1 body saves migrate mounts and hinges without healing crush; malformed values remain finite.',()=>{
 const c=createVehicleCondition(b,{bodyDamage:{version:1,zones:{left:{health:.4,crush:.21,detached:false},front:{health:0,detached:true}}}});
 assert.equal(c.bodyDamage.zones.left.health,.4);assert.equal(c.bodyDamage.zones.left.mounts,.4);assert.equal(c.bodyDamage.zones.left.crush,.21);assert.equal(c.bodyDamage.zones.front.detached,true);assert.equal(c.bodyDamage.zones.left.angle,0);
 const malformed=createVehicleCondition(b,{bodyDamage:{zones:{hood:{angle:Infinity,mounts:-2,velocity:NaN}}}});assert.ok(Number.isFinite(malformed.bodyDamage.zones.hood.angle));assert.equal(malformed.bodyDamage.zones.hood.mounts,0);
});
check('Stopped car opens four actual hinges, high-speed operation is rejected, positions persist and selective repair leaves other panels damaged.',()=>{
 const p=make();for(const id of ['left','right','hood','boot'])assert.equal(p.togglePanel(id),true);
 for(let i=0;i<240;i++)p.updateParkedPanels(dt);
 for(const id of ['left','right','hood','boot'])assert.ok(p.condition.bodyDamage.zones[id].angle>.8,id);
 p.state.speed=15;assert.equal(p.togglePanel('hood'),false);p.state.speed=0;assert.equal(p.togglePanel('hood'),true);const angle=p.condition.bodyDamage.zones.hood.angle;p.updateParkedPanels(dt);assert.ok(p.condition.bodyDamage.zones.hood.angle>0&&p.condition.bodyDamage.zones.hood.angle<angle);for(let i=0;i<360;i++)p.updateParkedPanels(dt);assert.equal(p.condition.bodyDamage.zones.hood.angle,0);
 const saved=p.getCondition(),q=make();q.restoreCondition(JSON.parse(JSON.stringify(saved)));assert.deepEqual(q.getCondition().bodyDamage,saved.bodyDamage);
 q.reset();assert.equal(q.condition.bodyDamage.zones.left.open,true);q.condition.bodyDamage.zones.right.health=.3;q.repairComponents(['panel:left']);assert.equal(q.condition.bodyDamage.zones.left.open,false);assert.equal(q.condition.bodyDamage.zones.right.health,.3);p.engine.dispose();q.engine.dispose();
});
check('Hit-side energy breaks door mounts, detaches the actual side, changes mass and static load, and repair restores them.',()=>{
 const p=make(),oldMass=p.mass;p.applyImpact({localPoint:{x:-b.vehicle.model.width*.48,z:0},energyJ:900000,impulse:60000,closingSpeed:30,normal:{x:1,z:0}});
 const wheel=p.condition.wheelAttached.indexOf(false);assert.ok(wheel>=0);const wheelMass=22*b.physics.tyreWidth/.27;
 assert.equal(p.condition.bodyDamage.zones.left.detached,true);assert.equal(p.condition.bodyDamage.zones.right.detached,false);assert.equal(p.mass,oldMass-31.5-wheelMass);assert.ok(p._staticLoads[0]<p._staticLoads[1]);assert.equal(p.contactBuild.physics.mass,p.mass);
 const piece=p.state.detachedPanels.find(x=>x.panel==='left');assert.ok(piece.x<0);assert.ok(piece.mass===29&&piece.radius>0);const damaged=p.getCondition();p.reset();assert.equal(p.mass,oldMass-31.5-wheelMass);p.restoreCondition(damaged);assert.equal(p.mass,oldMass-31.5-wheelMass);p.repairComponents(['panel:left']);assert.equal(p.mass,oldMass-2.5-wheelMass);p.repairComponents(['exterior:skirtLeft']);assert.equal(p.mass,oldMass-wheelMass);p.repairComponents(['tyre'+['FL','FR','RL','RR'][wheel]]);assert.equal(p.mass,oldMass);assert.equal(p._staticLoads[0],p._staticLoads[1]);p.engine.dispose();
});
check('Damaged latch opens under airflow; compromised mounts can tear away, damage-off preserves mounts and open panels increase drag.',()=>{
 const c=createVehicleCondition(b),p=c.bodyDamage.zones.hood;p.latch=0;p.mounts=.04;
 let detached=[];for(let i=0;i<2400&&!p.detached;i++)detached.push(...stepBodyHinges(c.bodyDamage,dt,{forwardSpeed:65},true));assert.ok(p.detached);assert.deepEqual(detached,['hood']);
 repairBody(c.bodyDamage);p.latch=0;p.mounts=.04;for(let i=0;i<1200;i++)stepBodyHinges(c.bodyDamage,dt,{forwardSpeed:65},false);assert.equal(p.mounts,.04);assert.equal(p.detached,false);
 const open=aerodynamicForces(b,c,30).drag;repairBody(c.bodyDamage);assert.ok(open>aerodynamicForces(b,c,30).drag);
});
check('Detached proxies bounce from rotated static walls, slide on terrain, expire by age/distance and remain bounded after repeated repairs.',()=>{
 const p={x:-3,z:0,y:.15,vx:55,vz:0,vy:0,spin:4,rotation:0,age:0,radius:.5,contacts:0};
 const wall={x:0,z:0,hx:.08,hz:8,heading:.3,height:3};for(let i=0;i<120;i++)advanceDebris(p,dt,()=>({height:0}),()=>[wall]);assert.ok(p.contacts>0);assert.ok(p.x<0);assert.ok(Math.abs(p.vx)<55);assert.ok(p.y>=.1);
 const car=make();car.condition.bodyDamage.zones.left.detached=true;for(let i=0;i<20;i++)car._detachPanel('left');assert.equal(car.state.detachedPanels.length,8);car.state.detachedPanels[0].x=1000;car._updateDebris(dt);assert.equal(car.state.detachedPanels.length,7);for(const item of car.state.detachedPanels)item.age=24;car._updateDebris(dt);assert.equal(car.state.detachedPanels.length,0);car.engine.dispose();return {contacts:p.contacts,speed:Math.hypot(p.vx,p.vz)};
});
check('Four authored bodies contain separate nonempty skins, working hinge transforms and exact-shaped loose pieces; no second intact skin fills the openings.',()=>{
 const old=globalThis.document;globalThis.document={createElement(){return {getContext(){return {fillText(){},fillRect(){}};}};}};
 try{const counts=[];for(const vehicle of VEHICLES){const build=resolveBuild({carId:vehicle.id}),scene=new THREE.Scene(),car=createCar(scene,build),c=createVehicleCondition(build),layout=bodyLayout(build);
  for(const id of ['left','right','hood','boot']){const root=car.bodyParts[id],skin=root.children.find(n=>n.name==='body-skin-'+id);assert.ok(skin?.geometry.attributes.position.count>0,id);c.bodyDamage.zones[id].open=true;c.bodyDamage.zones[id].angle=.9;}
  car.update({bodyDamage:c.bodyDamage},dt,0);assert.ok(car.bodyParts.left.rotation.y>.8);assert.ok(car.bodyParts.right.rotation.y<-.8);assert.ok(car.bodyParts.hood.rotation.x<-.8);assert.ok(panelCenter(layout.parts.hood,.9)[1]>layout.parts.hood.center[1]);
  const frame=car.group.getObjectByName('body-skin-frame').geometry.attributes.position;for(let i=0;i<frame.count;i+=3){const z=(frame.getZ(i)+frame.getZ(i+1)+frame.getZ(i+2))/3,y=(frame.getY(i)+frame.getY(i+1)+frame.getY(i+2))/3,x=(frame.getX(i)+frame.getX(i+1)+frame.getX(i+2))/3;assert.ok(!(Math.abs(x)<.35&&y>.6&&z>layout.back&&z<layout.front),'no hidden cabin deck');}
  c.bodyDamage.zones.left.detached=true;c.bodyDamage.revision++;car.update({bodyDamage:c.bodyDamage,detachedPanels:[{id:1,panel:'left',x:-3,y:.2,z:0}]},dt,1);assert.equal(car.bodyParts.left.visible,false);let loose=0;scene.children.find(n=>n.name==='DETACHED-WHEELS').traverse(n=>{if(n.isMesh&&n.userData.panel==='left')loose++;});assert.ok(loose>=4);counts.push({car:vehicle.id,looseMeshes:loose});car.dispose();assert.equal(scene.children.length,0);
 }return counts;}finally{globalThis.document=old;}
});
check('An open door catches an obstacle outside the closed car body and transfers an impulse only to that side.',()=>{
 const c=createVehicleCondition(b),part=bodyLayout(b).parts.left,p=c.bodyDamage.zones.left;p.angle=.9;p.open=true;
 const center=panelCenter(part,.9),x=part.pivot[0]+(center[0]-part.pivot[0])*1.85,z=part.pivot[2]+(center[2]-part.pivot[2])*1.85;
 const wall={x:x-.10,z,hx:.10,hz:.50},state={x:0,z:0,heading:0,vx:-15,vz:0};
 assert.ok(x<-b.vehicle.model.width*.5);const hits=openDoorContacts(b,c.bodyDamage,state,()=>[wall]);assert.equal(hits.length,1);assert.equal(hits[0].id,'left');assert.ok(p.mounts<1);assert.equal(c.bodyDamage.zones.right.mounts,1);assert.ok(state.vx>-15);
 repairBody(c.bodyDamage);assert.equal(openDoorContacts(b,c.bodyDamage,state,()=>[wall]).length,0);
});
check('Opening or losing a door increases the speed-dependent wind signal and preserves finite, limited PCM.',()=>{
 const audio=new GameAudio({pcmEnabled:true}),engine=MotorLab.createEngine('i4'),c=createVehicleCondition(b),state={x:0,z:0,heading:0,speed:40,bodyDamage:c.bodyDamage,engineRunning:true,rpm:1000};audio.setBuild(b);audio.setCamera(1);audio.update(state);engine.setInputs({starter:true,throttle:.4});
 for(let i=0;i<20;i++)audio.advanceEngine(engine,1/60);const closed=audio._windTarget;
 c.bodyDamage.zones.left.angle=1;for(let i=0;i<20;i++)audio.advanceEngine(engine,1/60);const open=audio._windTarget;assert.ok(open>closed*1.2);
 c.bodyDamage.zones.left.angle=0;c.bodyDamage.zones.left.detached=true;for(let i=0;i<20;i++)audio.advanceEngine(engine,1/60);assert.ok(audio._windTarget>=open);assert.ok(Number.isFinite(audio.getDiagnostics().outputPeak)&&audio.getDiagnostics().outputPeak<=.94);engine.dispose();return {closed,open,missing:audio._windTarget};
});
check('Protocol 18 sanitizes bounded panel poses and keeps hinged/detached state for remote cars without extra messages.',()=>{
 assert.equal(MULTIPLAYER_VERSION,18);const c=createVehicleCondition(b);c.bodyDamage.zones.left.detached=true;c.bodyDamage.zones.hood.angle=.8;
 const pose=sanitizeNetworkPose({x:0,z:0,heading:0,bodyDamage:c.bodyDamage});assert.equal(pose.bodyDamage.zones.left.detached,true);assert.equal(pose.bodyDamage.zones.hood.angle,.8);assert.equal(Object.keys(pose.bodyDamage.zones).length,8);
 const broken=sanitizeNetworkPose({x:0,z:0,heading:0,bodyDamage:{zones:{hood:{crush:Infinity,angle:NaN,x:999},unexpected:{}}}});assert.equal(broken.bodyDamage.zones.hood.x,3);assert.ok(Number.isFinite(broken.bodyDamage.zones.hood.angle));assert.equal(broken.bodyDamage.zones.unexpected,undefined);assert.ok(JSON.stringify(pose).length<6500);
});
const sourceSHA256=Object.fromEntries(['body-layout','body-hinges','body-damage','panel-debris','physics','car','mechanical','aerodynamics','multiplayer','network-cars','main','audio','car-cosmetics'].map(name=>{const file='dist/'+name+'.js';return [file,createHash('sha256').update(fs.readFileSync(new URL('../'+file,import.meta.url))).digest('hex')];}));
fs.writeFileSync(new URL('./body-panels-v28-results.json',import.meta.url),JSON.stringify({version:28,status:'passed',checks,fixtures,sourceSHA256,limits:['Authored rigid box proxies, no full soft body or debris-to-debris collision.','Full Phase 4 interior/Phase 6 engine bay remain open; exterior integration has a separate V28 suite.']},null,2));
