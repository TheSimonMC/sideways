import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as THREE from '../dist/vendor/three.module.js';
import {PoseBuffer} from '../dist/presentation.js';
import {resolveBuild} from '../dist/catalog.js';
import {createCar} from '../dist/car.js';
import {ComicRenderer} from '../dist/post.js';

const source=fs.readFileSync(new URL('../dist/main.js',import.meta.url),'utf8');
const report={status:'pending',checks:[],rates:[],cameras:[]},step=1/120;
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
 const ctx={THREE,Math,state:raw,renderState:view,presentation:buffer,accumulator:0,cameraAnchor:{x:0,z:0},phase:'playing',modalName:null,garagePanel:null,activeBuild:resolveBuild(),settings:{camera:mode,blur:.65},camera:new THREE.PerspectiveCamera(63,16/9,.16,950),sun:new THREE.DirectionalLight(),forward:new THREE.Vector3(),desiredPosition:new THREE.Vector3(),desiredLook:new THREE.Vector3(),cameraLook:new THREE.Vector3(),camHeading:0,camShake:0,totalTime:0,initialCamera:true,menuOrbit:0,innerWidth:1600,innerHeight:900,clamp,smooth,wrap,post:{cuts:0,reset(){this.cuts++;}}};
 vm.createContext(ctx);for(const name of ['visualState','resetPresentation','updateCamera'])vm.runInContext(functionSource(name),ctx);return ctx;
}
for(const mode of [0,1,2])for(const fps of [30,60,120,144,240]){
 const c=cameraContext(mode);c.updateCamera(1/fps,true);const offsets=[];
 for(let frame=0;frame<fps*3;frame++){c.renderState.z+=50/fps;c.totalTime+=1/fps;c.updateCamera(1/fps);offsets.push(c.camera.position.z-c.renderState.z);}
 const expected=mode===0?17:mode===1?-7.5:c.activeBuild.physics.frontAxle*.87;
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

// Execute the actual main-loop frame with boundary stubs to inspect what each
// consumer receives, rather than asserting source substrings.
{
 const c=cameraContext(1),calls={};Object.assign(c,{lastNow:0,totalTime:0,frames:0,fpsAccum:0,renderFps:0,paused:false,frameControls:{},toastTimer:0,comicTimer:0,hudClock:-1e9,checkpointGroup:{visible:false},inputManager:{setContext(){},setEnabled(){},sample(){return {controls:{},actions:[]};}},controlsPanel:{update(){}},processInputActions(){},tickGameplay(dt){Object.assign(c.state,fixture((c.state.time||0)+dt));c.state.time=(c.state.time||0)+dt;c.presentation.push(c.state);},car:{group:new THREE.Group(),update:s=>calls.car=s},fx:{update:s=>calls.fx=s},world:{update(){}},audio:{update:s=>calls.audio=s},updateCamera(){calls.camera=c.visualState();},updateBodyGroundMask(view){view.maskGroundHeight=.123;calls.mask=view;},drawSpeedFX:s=>calls.lines=s,post:{render:(scene,camera,s)=>calls.post=s},scene:new THREE.Scene(),requestAnimationFrame(){}});
 vm.runInContext(functionSource('frame'),c);c.frame(1000/144);
 for(const key of ['fx','camera','mask','lines','post'])assert.equal(calls[key],calls.car,key+' received a different pose');assert.equal(calls.audio,c.state);assert.notEqual(calls.audio,calls.car);assert.equal(c.state.maskGroundHeight,undefined);
 c.tickGameplay=()=>{Object.assign(c.state,fixture(0),{x:400,z:-600});c.resetPresentation();c.presentation.push(c.state);};c.frame(c.lastNow+1000/60);
 assert.ok(c.accumulator>=0,'A reset inside the fixed-step loop made the accumulator negative');near(c.renderState.x,400);near(c.renderState.z,-600);
}
report.checks.push('Actual frame wiring shares render pose across car/FX/camera/blur and passes raw physics to audio; masking cannot contaminate physics');
report.checks.push('A reset inside a running fixed-step frame clears old poses and cannot produce a negative accumulator');
report.status='passed';report.verificationLimit='CPU math and actual JS consumers only. Browser rendering and GPU shader execution are not available.';
fs.writeFileSync(new URL('./presentation-v4-results.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
