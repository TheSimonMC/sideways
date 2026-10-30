import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import * as THREE from '../dist/vendor/three.module.js';
import MotorLab from '../sdk/motor-engine.mjs';
import {resolveBuild,VEHICLES} from '../dist/catalog.js';
import {createVehicleCondition} from '../dist/vehicle-state.js';
import {CarPhysics} from '../dist/physics.js';
import {createCar} from '../dist/car.js';
import {createArchitecture} from '../dist/county-architecture.js';
import {openPanelContacts} from '../dist/hinge-contacts.js';
import {partPose} from '../dist/part-shapes.js';
import {eulerAxes,multiply,transform,dot,boxCorners,boxContact,staticBox} from '../dist/part-contacts.js';
import {advanceDebris,advanceLooseWheel} from '../dist/panel-debris.js';
const checks=[],fixtures={},dt=1/120,flat=()=>({height:0,grip:1,wetness:0}),near=(a,b,t=1e-7)=>assert.ok(Math.abs(a-b)<t,`${a} != ${b}`);
const check=(name,fn)=>{fixtures[name]=fn()??{};checks.push(name);console.log('PASS '+name);};
const wheel=()=>({x:0,y:.34,z:0,vx:0,vy:0,vz:12,heading:0,radius:.34,width:.24,omega:0,spin:0,age:0,lean:0,contacts:0});
check('Three-dimensional box bases match Three.js, including combined yaw, pitch and roll; separated heights never collide.',()=>{
 for(const [x,y,z]of [[.3,.8,-.2],[-.4,-1.2,.42],[0,0,0]]){const matrix=new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(x,y,z)),axes=eulerAxes(x,y,z);for(let i=0;i<3;i++)for(let j=0;j<3;j++)near(axes[i][j],matrix.elements[i*4+j]);}
 const a={center:[0,1,0],half:[1,.1,.7],axes:eulerAxes(.4,.5,.2)},b=staticBox({x:0,z:0,hx:1,hz:1,baseY:0,height:.2});assert.equal(boxContact(a,b),null);b.center[1]=1;assert.ok(boxContact(a,b));assert.equal(staticBox({x:0,z:0,hx:1,hz:1,visible:false}),null);assert.equal(staticBox({x:0,z:0,hx:1,hz:1,kind:'network'}),null);
});
check('All four body types catch both doors, hood and trunk in space, with correct height filtering and per-panel damage.',()=>{
 const rows=[];
 for(const car of VEHICLES)for(const id of ['left','right','hood','boot']){
  const b=resolveBuild({carId:car.id}),c=createVehicleCondition(b),s={x:0,z:0,heading:.43,vx:0,vz:0,bodyHeight:3,bodyPitch:.12,bodyRoll:-.1},p=c.bodyDamage.zones[id];p.angle=.85;p.open=true;
  const pose=partPose(b,id,c.bodyDamage,s),axis=pose.axes[id==='left'||id==='right'?0:1],point=pose.center.map((v,i)=>v+axis[i]*.08);
  const obstacle={x:point[0],z:point[2],hx:.13,hz:.13,baseY:point[1]-.13,height:.26};
  const probe=boxContact(pose,staticBox(obstacle));assert.ok(probe,id);s.vx=-probe.normal[0]*25;s.vz=-probe.normal[2]*25;
  const result=openPanelContacts(b,c.bodyDamage,s,()=>[obstacle],true,{verticalVelocity:-probe.normal[1]*25});assert.equal(result.length,1,id);assert.equal(result[0].id,id);assert.ok(result[0].energyJ>0);assert.ok(p.health<1);for(const other of ['left','right','hood','boot'].filter(k=>k!==id))assert.equal(c.bodyDamage.zones[other].health,1);
  const save=createVehicleCondition(b,JSON.parse(JSON.stringify(c)));assert.equal(save.bodyDamage.zones[id].health,p.health);
  const high={...obstacle,baseY:point[1]+10};assert.equal(openPanelContacts(b,c.bodyDamage,{...s},()=>[high]).length,0);rows.push({car:car.id,panel:id,energy:result[0].energyJ});
 }
 return rows;
});
check('Swept hinge travel catches a thin post between its old and final positions; damage-off still resolves contact.',()=>{
 const b=resolveBuild(),c=createVehicleCondition(b),p=c.bodyDamage.zones.left;p.open=true;p.angle=.9;p.velocity=3;
 const s={x:0,z:0,heading:0,vx:0,vz:0},middle=partPose(b,'left',c.bodyDamage,s,.5),corner=boxCorners(middle).sort((a,b)=>a[0]-b[0])[0],post={x:corner[0],z:corner[2],hx:.025,hz:.025,baseY:0,height:3};
 assert.equal(boxContact(partPose(b,'left',c.bodyDamage,s,.1),staticBox(post)),null);assert.equal(boxContact(partPose(b,'left',c.bodyDamage,s,.9),staticBox(post)),null);
 const hits=openPanelContacts(b,c.bodyDamage,s,()=>[post],false,{angles:{left:.1}});assert.equal(hits.length,1);assert.equal(p.health,1);assert.equal(p.mounts,1);assert.ok(p.angle<.9);assert.ok(Number.isFinite(p.velocity));
});
check('Heading wrap uses the short physical turn and produces the same open-panel contact as an unwrapped heading.',()=>{
 const b=resolveBuild(),initial=createVehicleCondition(b);initial.bodyDamage.zones.left.open=true;initial.bodyDamage.zones.left.angle=.9;
 const start={x:0,z:0,heading:0,vx:-12,vz:0},pose=partPose(b,'left',initial.bodyDamage,start),wall={x:pose.center[0]-.12,z:pose.center[2],hx:.16,hz:.4,baseY:0,height:3},run=previousHeading=>{const c=structuredClone(initial),s={...start,heading:.005};const hits=openPanelContacts(b,c.bodyDamage,s,()=>[wall],true,{previous:{x:0,z:0,heading:previousHeading},angles:{left:.89}});return {hits,s,panel:c.bodyDamage.zones.left};};
 const a=run(-.015),wrapped=run(Math.PI*2-.015);assert.equal(a.hits.length,1);assert.equal(wrapped.hits.length,1);for(const key of ['x','z','vx','vz','yawRate'])near(a.s[key],wrapped.s[key],1e-6);near(a.panel.angle,wrapped.panel.angle,1e-6);near(a.panel.health,wrapped.panel.health,1e-6);
});
check('A fast long body panel catches a thin rotated wall, its full width stays above terrain, and no upward collision occurs across a height gap.',()=>{
 const part={x:-5,y:.8,z:0,vx:110,vy:0,vz:0,axes:eulerAxes(.2,.15,.3),half:[.95,.07,.7],angularVelocity:[2,1,0],spin:1,rotation:0,age:0,contacts:0},wall={x:0,z:0,hx:.025,hz:5,heading:.2,baseY:0,height:4};
 for(let i=0;i<300;i++)advanceDebris(part,dt,flat,()=>[wall]);assert.ok(part.contacts>0);assert.ok(part.x<0);assert.ok(Math.hypot(part.vx,part.vy,part.vz)<110);const low=Math.min(...boxCorners({center:[part.x,part.y,part.z],axes:part.axes,half:part.half}).map(p=>p[1]));assert.ok(low>-.001);
 const high={...structuredClone(part),x:-3,y:8,z:0,vx:30,vy:0,vz:0,contacts:0};for(let i=0;i<30;i++)advanceDebris(high,dt,flat,()=>[wall]);assert.equal(high.contacts,0);assert.ok(high.x>0);return {contacts:part.contacts,lowestCorner:low};
});
check('Wheel translation and spin exchange energy through friction, slopes accelerate downhill and slow wheels settle on their side.',()=>{
 const w=wheel(),energy=p=>.5*(p.vx*p.vx+p.vz*p.vz)+.5*.55*p.radius*p.radius*p.omega*p.omega,initial=energy(w);
 for(let i=0;i<240;i++)advanceLooseWheel(w,dt,flat);assert.ok(w.omega>10);assert.ok(Math.abs(w.vz-w.omega*w.radius)<.1);assert.ok(energy(w)<initial);assert.ok(Math.abs(w.lean)<.1);
 const hill={...wheel(),vz:0,omega:0};for(let i=0;i<120;i++)advanceLooseWheel(hill,dt,(x,z)=>({height:-.1*z,grip:1}));assert.ok(hill.z>.15&&hill.vz>.3);
 const slow={...wheel(),vz:0,omega:0};for(let i=0;i<1800;i++)advanceLooseWheel(slow,dt,flat);assert.ok(Math.abs(slow.lean)>1.45);near(slow.y,slow.width/2,.02);return {initialEnergy:initial,finalEnergy:energy(w),rollingSpeed:w.vz,omega:w.omega,leanAtRest:slow.lean};
});
check('Fast loose wheels hit walls and elevated sloped bridge rails; wheels below that bridge do not hit its rail.',()=>{
 const wall={x:0,z:2,hx:4,hz:.025,heading:.2,baseY:0,height:2},w={...wheel(),vz:80,omega:80/.34};for(let i=0;i<120;i++)advanceLooseWheel(w,dt,flat,()=>[wall]);assert.ok(w.contacts>0&&w.z<2);
 const rail={x:0,z:0,hx:.225,hz:4,heading:0,baseY:10,height:2,centerY:10.55,halfHeight:.55,pitch:-.05};
 const upper={...wheel(),x:-3,y:10.34,vx:35,vz:0,heading:Math.PI/2,omega:35/.34};for(let i=0;i<30;i++)advanceLooseWheel(upper,dt,()=>({height:10,grip:1}),()=>[rail]);assert.ok(upper.contacts>0&&upper.x<0);
 const lower={...wheel(),x:-3,vx:35,vz:0,heading:Math.PI/2,omega:35/.34};for(let i=0;i<30;i++)advanceLooseWheel(lower,dt,flat,()=>[rail]);assert.equal(lower.contacts,0);assert.ok(lower.x>0);return {wallContacts:w.contacts,railContacts:upper.contacts};
});
check('Actual physics bounds all loose pools, removes distant/expired wheels, preserves saved absence and removes pieces on selective repair.',()=>{
 const b=resolveBuild(),p=new CarPhysics(MotorLab,b);try{
  p.setGroundSampler(flat);p.setDebrisColliders(()=>[{x:0,z:2,hx:4,hz:.03,baseY:0,height:2}]);
  for(let i=0;i<12;i++)p._detachWheel(0,{normal:{x:0,z:0},closingSpeed:20});assert.equal(p.state.detachedWheels.length,8);const last=p.state.detachedWheels.at(-1);Object.assign(last,{x:0,z:0,y:last.radius,vx:0,vz:40,omega:40/last.radius});for(let i=0;i<60;i++)p._updateDebris(dt);assert.ok(last.contacts>0);
  p.state.detachedWheels[0].x=1000;p.state.detachedWheels[1].age=25;p._updateDebris(dt);assert.equal(p.state.detachedWheels.length,6);
  const saved=p.getCondition();p.restoreCondition(JSON.parse(JSON.stringify(saved)));assert.equal(p.condition.wheelAttached[0],false);p.repairComponents(['tyreFL']);assert.equal(p.condition.wheelAttached[0],true);assert.equal(p.state.detachedWheels.length,0);assert.equal(p.condition.mechanical.chassisDamage.bearings[0].health,0);
 }finally{p.engine.dispose();}
});
check('Parked inspection uses the displayed stationary pose and never changes paused position, velocity, heave or damage.',()=>{
 const b=resolveBuild(),p=new CarPhysics(MotorLab,b);try{
  Object.assign(p.state,{vx:-25,vz:9,speed:27,forwardSpeed:9,yawRate:.7,bodyPitch:.12,bodyRoll:.08});p._heaveVelocity=2;
  const body=p.condition.bodyDamage,door=body.zones.left;door.open=true;door.angle=.7;const display={...p.state,bodyPitch:0,bodyRoll:0,bodyHeight:0},pose=partPose(b,'left',body,display),wall={x:pose.center[0]-.1,z:pose.center[2],hx:.15,hz:.5,baseY:0,height:3};p.setDebrisColliders(()=>[wall]);
  const values=()=>['x','z','vx','vz','speed','forwardSpeed','yawRate','bodyPitch','bodyRoll','bodyHeight'].map(k=>p.state[k]),before=values();for(let i=0;i<240;i++)p.updateParkedPanels(dt,display);assert.deepEqual(values(),before);assert.equal(p._heaveVelocity,2);assert.equal(door.health,1);assert.equal(door.mounts,1);assert.equal(door.detached,false);
 }finally{p.engine.dispose();}
});
check('Loose panel renderer uses simulated axes and loose wheels use physical lean and original tyre width on all four models.',()=>{
 const old=globalThis.document;globalThis.document={createElement(){return {getContext(){return {fillText(){},fillRect(){}};}};}};
 try{for(const vehicle of VEHICLES){const b=resolveBuild({carId:vehicle.id}),p=new CarPhysics(MotorLab,b),scene=new THREE.Scene(),view=createCar(scene,b);try{
  p.condition.bodyDamage.zones.hood.angle=.9;p.condition.bodyDamage.zones.hood.detached=true;p.state.heading=.4;p.state.bodyPitch=.1;p._detachPanel('hood');p._detachWheel(0,{normal:{x:0,z:0},closingSpeed:20});p.state.detachedWheels[0].lean=.8;view.update(p.state,dt,0);
  const loose=scene.getObjectByName('DETACHED-WHEELS'),panel=loose.children.find(n=>n.children.some(c=>c.name==='mounted-hood'));assert.ok(panel);panel.updateMatrix();const axes=p.state.detachedPanels[0].axes;for(let i=0;i<3;i++)for(let j=0;j<3;j++)near(panel.matrix.elements[i*4+j],axes[i][j],1e-6);
  const wheelView=loose.children.find(n=>n.visible&&n.children[0]?.children?.[0]?.geometry?.type==='CylinderGeometry');assert.ok(wheelView);near(wheelView.rotation.z,.8);near(wheelView.scale.x*.72,b.physics.tyreWidth);
 }finally{view.dispose();p.engine.dispose();}assert.equal(scene.children.length,0);}}finally{globalThis.document=old;}
});
check('Bridge collider centre, pitch and dimensions follow the actual rendered rail on a sloped elevated road.',()=>{
 const root=new THREE.Group(),colliders=[],a=createArchitecture({root,ground:()=>10,nearest:()=>null,inside:()=>false,landField:()=>1,colliders,mapBuildings:[]}),points=Array.from({length:20},(_,i)=>({x:0,z:i*6,y:10+i*.3}));a.bridge({points,width:12,bridge:{style:'plain'}});a.finish();const rail=colliders.find(c=>c.kind==='bridge-rail');assert.ok(rail?.baseY>10);assert.ok(rail.pitch<0);near(rail.halfHeight,.55);const box=staticBox(rail);near(box.center[1],rail.centerY);
 let matching=false;const matrix=new THREE.Matrix4();root.traverse(n=>{if(n.isInstancedMesh)for(let i=0;i<n.count;i++){n.getMatrixAt(i,matrix);if(Math.abs(matrix.elements[12]-rail.x)<1e-5&&Math.abs(matrix.elements[14]-rail.z)<1e-5&&Math.abs(matrix.elements[13]-rail.centerY)<1e-5){matching=true;for(let axis=0;axis<3;axis++){const length=Math.hypot(...matrix.elements.slice(axis*4,axis*4+3));near(length,box.half[axis]*2,1e-5);for(let j=0;j<3;j++)near(matrix.elements[axis*4+j]/length,box.axes[axis][j],1e-6);}}}});assert.ok(matching);
 root.traverse(n=>{n.geometry?.dispose();n.material?.dispose();});
});
const sourceSHA256=Object.fromEntries(['part-contacts','part-shapes','hinge-contacts','panel-debris','body-hinges','body-layout','physics','car','world','city','region','county-architecture'].map(n=>{const f='dist/'+n+'.js';return [f,createHash('sha256').update(fs.readFileSync(new URL('../'+f,import.meta.url))).digest('hex')];}));
fs.writeFileSync(new URL('part-contacts-v27-results.json',import.meta.url),JSON.stringify({version:27,status:'passed',checks,fixtures,sourceSHA256,limits:['Authored rigid boxes approximate trim and dents. The rolling wheel uses a cylinder-sized box for walls and analytic ground support, not a full multibody tyre solver.','Local static contacts only; loose objects do not collide with one another or remote/traffic cars.','Remaining individual detachable suspension members and full exhaust routing are outside this contact increment.']},null,2));
