import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as THREE from '../dist/vendor/three.module.js';
import {PoseBuffer} from '../dist/presentation.js';
import {resolveBuild,VEHICLES} from '../dist/catalog.js';
import {createCar} from '../dist/car.js';
import {ComicRenderer} from '../dist/post.js';

const source=fs.readFileSync(new URL('../dist/main.js',import.meta.url),'utf8');
const report={status:'pending',checks:[],rates:[],cameras:[],chase:[],standstill:[],flow:[],nos:[]},step=1/120;
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const smooth=(a,b,speed,dt)=>a+(b-a)*(1-Math.exp(-speed*dt));
const wrap=a=>Math.atan2(Math.sin(a),Math.cos(a));
const near=(a,b,e=1e-9)=>assert.ok(Math.abs(a-b)<=e,`${a} differs from ${b}`);
function functionSource(name){const start=source.indexOf('function '+name+'(');assert.ok(start>=0,name+' missing');const tail=source.slice(start),next=/\n(?:async )?function /.exec(tail);return next?tail.slice(0,next.index):tail.slice(0,tail.indexOf('// Read-only diagnostics'));}
function fixture(t=0){return {x:13*t,z:50*t,heading:.3+t*.2,vx:13,vz:50,speed:Math.hypot(13,50),forwardSpeed:50,lateralSpeed:13,yawRate:.2,bodyHeight:.02+t*.03,bodyPitch:.01+t*.02,bodyRoll:-.01+t*.01,groundHeight:.012,steer:.12+t*.02,driftAngle:.1+t*.01,brake:0,boosting:false,engineRunning:true,wheelSpins:[t*20,t*22,t*24,t*26],wheelSteers:[.12+t*.04,.10+t*.03,0,0],wheelLoads:[3000+t*10,3200+t*20,2900+t*30,3100+t*40],suspension:[0,1,2,3].map(i=>({compression:.10+t*.01,travel:.01+t*.005,load:3000+i*50+t*10,groundHeight:.012,wheelY:.35+t*.01+i*.002,contact:true,material:'asphalt'}))};}

for(const rate of [30,60,120,144,240,'uneven']){
 const buffer=new PoseBuffer(),raw=fixture(0);buffer.reset(raw);let time=0,sim=0,accumulator=0,maxError=0,minAdvance=Infinity;let last=-Infinity;
 const pattern=[1/240,1/48,1/90,1/144,1/32,1/75,1/200];
 for(let frame=0;frame<500;frame++){
  const dt=rate==='uneven'?pattern[frame%pattern.length]:1/rate;time+=dt;accumulator+=dt;
  while(accumulator>=step){sim+=step;Object.assign(raw,fixture(sim));buffer.push(raw);accumulator-=step;}
  const before=JSON.stringify(raw),view=buffer.sample(raw,accumulator/step),target=fixture(Math.max(0,time-step));
  maxError=Math.max(maxError,Math.abs(view.x-target.x),Math.abs(view.z-target.z),Math.abs(view.bodyHeight-target.bodyHeight),Math.abs(view.wheelSpins[3]-target.wheelSpins[3]));
  assert.equal(JSON.stringify(raw),before,'Sampling mutated authoritative physics');
  assert.notEqual(view,raw);assert.notEqual(view.suspension,raw.suspension);assert.notEqual(view.wheelSpins,raw.wheelSpins);assert.notEqual(view.suspension[0],raw.suspension[0]);
  if(frame>3){minAdvance=Math.min(minAdvance,view.z-last);assert.ok(view.z>last,'A moving render pose froze on a high-refresh frame');}
  last=view.z;
 }
 assert.ok(maxError<1e-8);report.rates.push({rate,maxError,minAdvance});
}
report.checks.push('Fixed-step interpolation follows continuous motion at30/60/120/144/240Hz and uneven frames without mutating live physics');

{
 const buffer=new PoseBuffer(),raw=fixture();raw.heading=Math.PI-.04;raw.driftAngle=Math.PI-.06;buffer.reset(raw);raw.heading=-Math.PI+.04;raw.driftAngle=-Math.PI+.06;buffer.push(raw);const view=buffer.sample(raw,.5);near(Math.abs(view.heading),Math.PI);near(Math.abs(view.driftAngle),Math.PI);
 raw.x=800;raw.z=-900;raw.heading=-1.7;raw.wheelSpins=[0,0,0,0];buffer.reset(raw);for(const alpha of [0,.25,.75,1]){const v=buffer.sample(raw,alpha);near(v.x,800);near(v.z,-900);near(v.heading,-1.7);assert.deepEqual(v.wheelSpins,[0,0,0,0]);}
}
report.checks.push('Heading wrap uses the shortest rotation; reset discards old position and wheel-spin history at every interpolation phase');

function cameraContext(mode=1){
 const raw=fixture();raw.x=raw.z=raw.heading=0;raw.vx=0;raw.vz=raw.speed=50;const buffer=new PoseBuffer();const view=buffer.reset(raw);
 const ctx={THREE,Math,document:{body:{classList:{toggle(){}}}},state:raw,renderState:view,presentation:buffer,accumulator:0,cameraAnchor:{x:0,z:0},phase:'playing',paused:false,frameControls:{lookX:0,lookY:0,lookBack:false},lookYaw:0,lookPitch:0,modalName:null,garagePanel:null,activeBuild:resolveBuild(),settings:{camera:mode,blur:.65},camera:new THREE.PerspectiveCamera(63,16/9,.16,950),sun:new THREE.DirectionalLight(),forward:new THREE.Vector3(),desiredPosition:new THREE.Vector3(),desiredLook:new THREE.Vector3(),cameraLook:new THREE.Vector3(),camHeading:0,camShake:0,totalTime:0,initialCamera:true,menuOrbit:0,innerWidth:1600,innerHeight:900,clamp,smooth,wrap,post:{cuts:0,reset(){this.cuts++;}}};
 vm.createContext(ctx);for(const name of ['visualState','resetPresentation','updateCamera'])vm.runInContext(functionSource(name),ctx);return ctx;
}
for(const mode of [0,1,2])for(const fps of [30,60,120,144,240]){
 const c=cameraContext(mode);c.updateCamera(1/fps,true);const offsets=[];
 for(let frame=0;frame<fps*3;frame++){c.renderState.z+=50/fps;c.totalTime+=1/fps;c.updateCamera(1/fps);offsets.push(c.camera.position.z-c.renderState.z);}
 const expected=mode===0?17:mode===1?-(6.6+Math.pow(50/65,.82)*3.1):c.activeBuild.physics.frontAxle*.87;
 near(offsets.at(-1),expected,1e-8);assert.ok(Math.max(...offsets)-Math.min(...offsets)<1e-8,'Follow distance depends on translation smoothing');
 report.cameras.push({mode,fps,distance:offsets.at(-1)});
}
report.checks.push('Actual camera helper keeps the intended translation offset at every tested refresh rate, without speed/stiffness drift');

for(const mode of [1,2]){
 const c=cameraContext(mode);c.camHeading=-1.8;c.renderState.heading=1.1;c.initialCamera=true;c.updateCamera(1/60);
 const dx=c.camera.position.x-c.renderState.x,dz=c.camera.position.z-c.renderState.z,lateral=dx*Math.cos(1.1)-dz*Math.sin(1.1);
 near(lateral,0,1e-8);near(c.camHeading,1.1);assert.ok(c.post.cuts>0);
 c.renderState.x=100;c.renderState.z=-50;c.renderState.heading=-2.5;c.initialCamera=true;c.updateCamera(1/144);
 const lateral2=(c.camera.position.x-100)*Math.cos(-2.5)-(c.camera.position.z+50)*Math.sin(-2.5);near(lateral2,0,1e-8);
}
report.checks.push('Camera switches and teleports use the new heading on the first cut frame and reset the blur history');

globalThis.document={createElement:()=>({width:0,height:0,getContext:()=>({fillRect(){},fillText(){},beginPath(){},arc(){},fill(){}})})};
{
 const build=resolveBuild({carId:'atlas',suspension:'sport'}),buffer=new PoseBuffer(),raw=fixture(.2);buffer.reset(raw);Object.assign(raw,fixture(.5));buffer.push(raw);const before=JSON.stringify(raw),view=buffer.sample(raw,.37),scene=new THREE.Scene(),car=createCar(scene,build);
 car.group.position.set(view.x,0,view.z);car.group.rotation.y=view.heading;car.update(view,1/144,1);car.group.updateMatrixWorld(true);
 const render={info:{reset(){}},setRenderTarget(){},render(){}},post=new ComicRenderer(render),camera=new THREE.PerspectiveCamera(63,16/9,.16,950);post.resize(1600,900);post.setCarBounds({...build.vehicle.model,rideHeight:build.physics.rideHeight});camera.position.set(view.x,5,view.z-9);camera.lookAt(view.x,1,view.z+5);
 post.render(scene,camera,view,1/144,1,{blur:.65,quality:'high'},{active:true,cameraMode:1});
 const chassis=car.group.children[0].children[0],u=post.material.uniforms;
 near(chassis.getWorldPosition(new THREE.Vector3()).x,u.playerPosition.value.x);near(chassis.getWorldPosition(new THREE.Vector3()).y,u.playerPosition.value.y);near(chassis.getWorldPosition(new THREE.Vector3()).z,u.playerPosition.value.z);
 for(const local of [new THREE.Vector3(.4,.7,1),new THREE.Vector3(-.4,.9,-1)]){const w=local.clone().applyMatrix4(chassis.matrixWorld),restored=w.sub(u.playerPosition.value).applyMatrix3(u.playerInverseBasis.value);assert.ok(restored.distanceTo(local)<1e-10);}
 for(let i=0;i<4;i++){const wheel=car.wheels[i];near(wheel.position.y,view.suspension[i].wheelY);near(wheel.rotation.y,view.wheelSteers[i]);near(wheel.children[0].rotation.x,view.wheelSpins[i]);}
 assert.equal(JSON.stringify(raw),before,'Car or post-processing mutated the physical state');car.dispose();post.target.dispose();post.material.dispose();
}
report.checks.push('Actual car wheels, Ackermann pivots, sprung body and postprocess mask consume the same interpolated pose');

// The chase camera pulls back by speed, with a further bounded NOS offset.
for(const fps of [30,60,120,144,240])for(const nitrous of [0,.5,1]){
 let priorDistance=-Infinity,priorFov=-Infinity;
 for(const speed of [0,5,15,30,50,65,90,120]){
  const c=cameraContext(1),v=c.renderState;Object.assign(v,{speed,vx:0,vz:speed,heading:.37,boosting:nitrous>0,nitrousIntensity:nitrous});c.updateCamera(1/fps,true);
  for(let n=0;n<fps*4;n++){v.x+=Math.sin(v.heading)*speed/fps;v.z+=Math.cos(v.heading)*speed/fps;c.totalTime+=1/fps;c.updateCamera(1/fps);}
  const distance=-((c.camera.position.x-v.x)*Math.sin(v.heading)+(c.camera.position.z-v.z)*Math.cos(v.heading));
  const rush=Math.pow(clamp(speed/65,0,1),.82),expectedDistance=6.6+rush*3.1+nitrous*1.2,expectedFov=61+rush*17+nitrous*10;
  near(distance,expectedDistance,1e-8);near(c.camera.fov,expectedFov,1e-6);assert.ok(distance>=priorDistance-1e-8);assert.ok(c.camera.fov>=priorFov-1e-6);assert.ok(distance>=6.6-1e-8&&distance<=10.9+1e-8);assert.ok(c.camera.fov>=61-1e-6&&c.camera.fov<=88+1e-6);
  priorDistance=distance;priorFov=c.camera.fov;if(fps===60)report.chase.push({speedMps:speed,nitrous,distanceM:distance,fov:c.camera.fov});
 }
}
{
 const c=cameraContext(1),v=c.renderState;Object.assign(v,{speed:0,vx:0,vz:0,boosting:false,nitrousIntensity:0});for(let n=0;n<480;n++)c.updateCamera(1/60);
 Object.assign(v,{speed:100,vz:100,boosting:true,nitrousIntensity:1});let priorDistance=6.6,priorFov=c.camera.fov;
 for(let n=0;n<240;n++){c.updateCamera(1/60);const distance=v.z-c.camera.position.z;assert.ok(distance>=priorDistance-1e-9&&distance<=10.9+1e-9);assert.ok(c.camera.fov>=priorFov-1e-9&&c.camera.fov<=88+1e-9);priorDistance=distance;priorFov=c.camera.fov;}
}
report.checks.push('Chase pullback is monotonic and bounded at 6.6–10.9 m, with 61–88 degree FOV, across 30/60/120/144/240 Hz and speed/NOS ramps');

for(const mode of [0,1,2])for(const fps of [30,60,144]){
 const c=cameraContext(mode),v=c.renderState;Object.assign(v,{speed:0,vx:0,vz:0,heading:1.2,bodyPitch:.07,bodyRoll:-.04,boosting:false,nitrousIntensity:0});for(let n=0;n<fps*8;n++)c.updateCamera(1/fps);
 const position=c.camera.position.clone(),look=c.cameraLook.clone(),quaternion=c.camera.quaternion.clone(),fov=c.camera.fov;let maxMovement=0,maxLook=0,maxRotation=0,maxFov=0;
 for(let n=0;n<fps*3;n++){c.totalTime+=1/fps;c.updateCamera(1/fps);maxMovement=Math.max(maxMovement,c.camera.position.distanceTo(position));maxLook=Math.max(maxLook,c.cameraLook.distanceTo(look));maxRotation=Math.max(maxRotation,...c.camera.quaternion.toArray().map((v,i)=>Math.abs(v-quaternion.toArray()[i])));maxFov=Math.max(maxFov,Math.abs(c.camera.fov-fov));}
 assert.ok(maxMovement<1e-9&&maxLook<1e-9&&maxRotation<1e-9&&maxFov<1e-7);report.standstill.push({mode,fps,maxMovement,maxLook,maxRotation,maxFov});
}
report.checks.push('All three gameplay cameras settle completely at standstill, without idle orbit, drifting offsets or periodic bobbing');

const shader=new ComicRenderer({}).material.fragmentShader;
for(const fragment of ['(uv-oldUV)*exposureTime','(.92+.74*periphery+boost*.34)','(speed*.0048+boost*.016)*periphery*nearWorld','amount*motionActive*(1.-player)','28.+speed*35.+boost*40.','w*=1.-playerMask(p,worldPosition(p,sampleDepth))','vec3(.10,.55,.90)*nosRim*.42'])assert.ok(shader.includes(fragment),'Shader oracle out of date: '+fragment);
const smoothstep=(a,b,x)=>{const v=clamp((x-a)/(b-a),0,1);return v*v*(3-2*v);};
function project(point,matrix){const p=new THREE.Vector4(point.x,point.y,point.z,1).applyMatrix4(matrix);return {uv:new THREE.Vector2(p.x/p.w*.5+.5,p.y/p.w*.5+.5),depth:p.z/p.w*.5+.5,w:p.w};}
function shaderVelocity(point,post,previous){
 const u=post.material.uniforms,current=project(point,post.current),prior=project(point,previous),uv=current.uv,oldUV=prior.w>.0001?prior.uv:uv;
 const near=u.nearFar.value.x,far=u.nearFar.value.y,viewDepth=near*far/Math.max(.00001,far-current.depth*(far-near));
 const nearWorld=1-smoothstep(140,550,viewDepth),centered=uv.clone().sub(u.motionFocus.value).multiply(new THREE.Vector2(u.resolution.value.x/u.resolution.value.y,1)),periphery=smoothstep(.16,.78,centered.length());
 const velocity=uv.clone().sub(oldUV).multiplyScalar(u.exposureTime.value*(.92+.74*periphery+u.boost.value*.34)*(.38+.62*nearWorld));
 if(u.cameraMode.value>.5)velocity.add(uv.clone().sub(u.motionFocus.value).multiplyScalar((u.speed.value*.0048+u.boost.value*.016)*periphery*nearWorld));
 velocity.multiplyScalar(u.amount.value*u.motionActive.value);if(current.depth>.99998)velocity.multiplyScalar(.12);
 const maxPixels=(28+u.speed.value*35+u.boost.value*40)*u.resolution.value.y/900,pixels=velocity.clone().multiply(u.resolution.value).length();velocity.multiplyScalar(Math.min(1,maxPixels/Math.max(.0001,pixels)));
 return {pixels:velocity.multiply(u.resolution.value).length(),maxPixels,periphery};
}
const renderer=()=>({info:{reset(){}},setRenderTarget(){},render(){}});
for(const mode of [0,1,2])for(const fps of [30,60,120,144,240])for(const boost of [0,1]){
 const c=cameraContext(mode),v=c.renderState,scene=new THREE.Scene(),p=new ComicRenderer(renderer());p.resize(1600,900);p.setCarBounds({...c.activeBuild.vehicle.model,rideHeight:c.activeBuild.physics.rideHeight});
 Object.assign(v,{speed:50,vx:0,vz:50,boosting:!!boost,nitrousIntensity:boost});let previous;
 for(let n=0;n<fps*3+2;n++){v.z+=50/fps;c.totalTime+=1/fps;c.updateCamera(1/fps);previous=p.current.clone();p.render(scene,c.camera,v,1/fps,c.totalTime,{blur:.8,quality:'high',camera:mode},{active:true,cameraMode:mode});}
 const u=p.material.uniforms,edgePoint=new THREE.Vector3(12,.012,v.z+(mode===0?5:23)),centerPoint=new THREE.Vector3(0,.012,v.z+(mode===0?5:23)),edge=shaderVelocity(edgePoint,p,previous),center=shaderVelocity(centerPoint,p,previous);
 const seconds=u.exposureTime.value/fps,expectedSeconds=mode===0?.020+50/55*.026+u.boost.value*.016:mode===1?.020+50/55*.034+u.boost.value*.024:.012+50/55*.020+u.boost.value*.015;
 near(seconds,expectedSeconds,1e-10);assert.ok(edge.pixels>0&&edge.pixels<=edge.maxPixels+1e-8);if(mode>0)assert.ok(edge.pixels>center.pixels,'Peripheral world must move more than the central road point');
 report.flow.push({mode,fps,boost,worldPixels:edge.pixels,centerPixels:center.pixels,maxPixels:edge.maxPixels,shutterMs:seconds*1000});
 p.render(scene,c.camera,v,1/fps,c.totalTime,{blur:.8,camera:mode},{active:false,cameraMode:mode});assert.equal(u.motionActive.value,0);assert.equal(u.boost.value,0);
 p.reset();p.render(scene,c.camera,v,1/fps,c.totalTime,{blur:.8,camera:mode},{active:true,cameraMode:mode});assert.equal(u.motionActive.value,0);assert.equal(u.boost.value,0);assert.deepEqual(p.previous.elements,p.current.elements);
 Object.assign(v,{speed:0,vx:0,vz:0,boosting:false,nitrousIntensity:0});p.render(scene,c.camera,v,1/fps,c.totalTime,{blur:.8,camera:mode},{active:true,cameraMode:mode});assert.equal(u.motionActive.value,0);
 p.target.dispose();p.material.dispose();
}
for(const mode of [0,1,2])for(const boost of [0,1]){
 const rows=report.flow.filter(r=>r.mode===mode&&r.boost===boost),ratio=Math.max(...rows.map(r=>r.worldPixels))/Math.min(...rows.map(r=>r.worldPixels));assert.ok(ratio<1.12,'True world-motion blur must remain stable at high refresh rates');
 if(boost){const ordinary=report.flow.find(r=>r.mode===mode&&r.boost===0&&r.fps===60),nitrous=rows.find(r=>r.fps===60);assert.ok(nitrous.worldPixels>ordinary.worldPixels,'NOS must increase world blur');}
}
const rim=(x,y,boost,active,amount,player)=>smoothstep(.24,.78,Math.hypot((x-.5)*1.25,y-.5))*boost*active*amount*(1-player);
assert.equal(rim(.5,.5,1,1,1,0),0);assert.ok(rim(.98,.98,1,1,1,0)>.9);for(const disabled of [[0,1,1,0],[1,0,1,0],[1,1,0,0],[1,1,1,1]])assert.equal(rim(.98,.98,...disabled),0);
report.checks.push('World-flow shutter remains consistent through 240 Hz after exposure cap fix; peripheral motion exceeds central road flow and NOS increases it');
report.checks.push('Shader bounds final blur distance in pixels, protects player samples and limits blue NOS light to peripheral moving-world pixels');
report.checks.push('Pause, reset and standstill suppress both motion blur and visible NOS post effects');

for(const vehicle of VEHICLES){
 const scene=new THREE.Scene(),car=createCar(scene,resolveBuild({carId:vehicle.id})),s={...fixture(0),speed:30,boosting:false,nitrousIntensity:0,engineRunning:true},flames=[];
 car.group.traverse(node=>{if(node.isMesh&&node.geometry.type==='ConeGeometry'&&node.geometry.parameters.radius===.12&&node.geometry.parameters.height===.90)flames.push(node);});assert.ok(flames.length>=1);
 car.update(s,1/60,0);assert.ok(flames.every(f=>!f.visible));s.boosting=true;s.nitrousIntensity=1;car.update(s,1/60,1);
 for(const flame of flames){assert.equal(flame.visible,true);assert.equal(flame.material.color.getHex(),0x64dfff);assert.equal(flame.material.blending,THREE.AdditiveBlending);assert.equal(flame.material.depthWrite,false);assert.ok(flame.scale.y>1.7&&flame.scale.y<2);assert.equal(flame.children[0].material.color.getHex(),0xe5ffff);}
 s.boosting=false;s.nitrousIntensity=0;car.update(s,1/60,2);assert.ok(flames.every(f=>!f.visible));report.nos.push({car:vehicle.id,blueFlames:flames.length,additive:true,whiteCore:true,offStateHidden:true});car.dispose();
}
report.checks.push('All four cars have blue additive NOS exhaust with bright cores, driven by active boost and hidden again on release');


report.look=[];
for(const mode of [0,1,2])for(const fps of [30,60,144,240]){
 const c=cameraContext(mode),v=c.renderState;Object.assign(v,{speed:0,vx:0,vz:0,heading:0});c.updateCamera(1/fps,true);
 for(let n=0;n<fps;n++){c.frameControls.lookX=1;c.frameControls.lookY=.6;c.updateCamera(1/fps);}
 assert.ok(c.lookYaw>2.24&&c.lookYaw<2.251);assert.ok(c.lookPitch>.269);
 c.frameControls={lookX:0,lookY:0,lookBack:true};for(let n=0;n<fps;n++)c.updateCamera(1/fps);
 assert.ok(Math.abs(c.lookYaw-Math.PI)<.001);
 if(mode===1)assert.ok(c.camera.position.z>5.9,'R3 moves chase camera ahead to face behind the car');
 if(mode===2){assert.ok(c.camera.position.z>0,'Rear view keeps the camera at the hood mount');assert.ok(c.camera.getWorldDirection(new THREE.Vector3()).z<-.99);}
 c.frameControls={lookX:0,lookY:0,lookBack:false};for(let n=0;n<Math.ceil(fps*.4);n++)c.updateCamera(1/fps);
 assert.ok(Math.abs(c.lookYaw)<.018,'Released look returns within 0.4 seconds');
 if(mode===2)assert.ok(c.camera.getWorldDirection(new THREE.Vector3()).z>.97);
 for(let n=0;n<fps;n++)c.updateCamera(1/fps);near(c.lookYaw,0,.0001);assert.ok(c.camera.position.toArray().every(Number.isFinite));
 report.look.push({mode,fps,releaseSeconds:.4,yaw:c.lookYaw});
}
report.checks.push('Right stick look and held rear view use the actual camera helper; release recenters in 0.4 seconds with a continuous camera transition');

for(const vehicle of VEHICLES){
 const scene=new THREE.Scene(),build=resolveBuild({carId:vehicle.id}),car=createCar(scene,build),s={...fixture(),bodyHealth:1,wheelAttached:[true,true,true,true],headlights:true,detachedWheels:[]};
 car.update(s,1/60,0);const lamps=[];car.group.traverse(n=>{if(n.isMesh&&n.material.emissive?.getHex()===0xd2eaff)lamps.push(n);});assert.ok(lamps.length);
 const on=lamps[0].material.emissiveIntensity;s.headlights=false;car.update(s,1/60,0);assert.ok(lamps[0].material.emissiveIntensity<on*.01);
 s.wheelAttached[2]=false;s.detachedWheels=[{x:8,y:.4,z:12,heading:1,spin:7,age:2,radius:.34}];s.bodyHealth=.4;s.lastImpactLocal={x:.9,z:build.vehicle.model.length*.45};car.update(s,1/60,1);assert.equal(car.wheels[2].visible,false);assert.ok(car.wheels[0].visible);
 const debris=scene.getObjectByName('DETACHED-WHEELS');assert.equal(debris.children.filter(n=>n.visible).length,1);near(debris.children[0].position.x,8);near(debris.children[0].position.z,12);
 car.group.traverse(n=>{if(n.geometry?.attributes.position)assert.ok(n.geometry.attributes.position.array.every(Number.isFinite));});
 s.wheelAttached=[true,true,true,true];s.detachedWheels=[];s.bodyHealth=1;car.update(s,1/60,2);assert.ok(car.wheels.every(n=>n.visible));assert.ok(debris.children.every(n=>!n.visible));car.dispose();assert.equal(scene.children.length,0);
}
report.checks.push('All four car models toggle headlamps, hide lost wheels, draw detached-wheel bodies and restore geometry after repair');

{
 const calls=[];let target=null;
 const renderer={info:{reset(){}},setRenderTarget(t){target=t;},render(scene){const material=scene.children[0]?.material;const input=material?.uniforms?.source?.value;if(target&&input)assert.notEqual(input,target.texture,'Post pass must not sample its own output');calls.push({target,input,material});}};
 const post=new ComicRenderer(renderer),scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(61,16/9,.16,1400);camera.position.set(0,5,-10);camera.lookAt(0,1,0);post.resize(1600,900,.8);
 post.render(scene,camera,fixture(),1/60,0,{blur:.5,bloom:.65,quality:'high'},{active:true,cameraMode:1});
 assert.equal(calls.length,5);assert.equal(post.bloomA.width,320);assert.equal(post.bloomA.height,180);assert.equal(calls[0].target,post.target);assert.equal(calls[1].input,post.target.texture);assert.equal(calls[2].input,post.bloomA.texture);assert.equal(calls[3].input,post.bloomB.texture);assert.equal(calls[4].target,null);assert.equal(post.material.uniforms.tBloom.value,post.bloomA.texture);assert.equal(post.material.uniforms.nearFar.value.y,1400);
 calls.length=0;post.render(scene,camera,fixture(),1/60,1,{blur:0,bloom:0,quality:'psx'},{active:false,cameraMode:0});assert.equal(calls.length,2);assert.equal(post.material.uniforms.bloomAmount.value,0);
}
report.checks.push('Quarter-resolution bloom has distinct source/output targets, valid resize and composite wiring; disabling bloom skips all three extra passes');

report.status='passed';report.verificationLimit='CPU Three.js math, actual JS consumers and shader-equivalent expressions only. No GPU shader execution, browser visual inspection, controller hardware or speaker audition.';
fs.writeFileSync(new URL('./presentation-v6-results.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,checks:report.checks,chase:report.chase,flow:report.flow,nos:report.nos,verificationLimit:report.verificationLimit},null,2));
