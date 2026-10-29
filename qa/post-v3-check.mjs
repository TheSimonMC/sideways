import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as THREE from '../dist/vendor/three.module.js';
import {ComicRenderer} from '../dist/post.js';
import {VEHICLES,resolveBuild} from '../dist/catalog.js';
import {createCar} from '../dist/car.js';
import {createWorld} from '../dist/world.js';
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const smoothstep=(a,b,x)=>{const t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);};
const renderer=()=>({info:{reset(){}},setRenderTarget(){},render(){}});
globalThis.document={createElement:()=>({width:0,height:0,getContext:()=>({fillRect(){},fillText(){},beginPath(){},arc(){},fill(){}})})};
function project(world,vp){const p=new THREE.Vector4(world.x,world.y,world.z,1).applyMatrix4(vp);return {uv:new THREE.Vector2(p.x/p.w*.5+.5,p.y/p.w*.5+.5),depth:p.z/p.w*.5+.5,w:p.w};}
function reconstruct(p,inverse){const h=new THREE.Vector4(p.uv.x*2-1,p.uv.y*2-1,p.depth*2-1,1).applyMatrix4(inverse);return new THREE.Vector3(h.x/h.w,h.y/h.w,h.z/h.w);}
function mask(world,u,vp){
 const uv=project(world,vp).uv,r=u.playerScreenRect.value;
 if(!u.playerEnabled.value||uv.x<r.x||uv.x>r.z||uv.y<r.y||uv.y>r.w)return 0;
 const p=world.clone().sub(u.playerPosition.value).applyMatrix3(u.playerInverseBasis.value),size=u.playerHalfSize.value;
 const footprint=Math.max(Math.abs(p.x)/size.x,Math.abs(p.z)/size.z);
 return (1-smoothstep(.98,1.035,footprint))*smoothstep(.045,.10,p.y)*(1-smoothstep(size.y-.12,size.y,p.y))*smoothstep(u.playerGround.value+.025,u.playerGround.value+.06,world.y);
}
function cameraFor(mode,state){
 const camera=new THREE.PerspectiveCamera(mode===0?51:mode===1?75:82,16/9,.16,950),f=new THREE.Vector3(Math.sin(state.heading),0,Math.cos(state.heading)),base=new THREE.Vector3(state.x,0,state.z);
 if(mode===0){camera.position.copy(base).addScaledVector(f,-17);camera.position.y=33;camera.lookAt(base.clone().addScaledVector(f,4));}
 else if(mode===1){camera.position.copy(base).addScaledVector(f,-8);camera.position.y=3.1;const look=base.clone().addScaledVector(f,12);look.y=1.2;camera.lookAt(look);}
 else{camera.position.copy(base).addScaledVector(f,1.1);camera.position.y=1.2;const look=base.clone().addScaledVector(f,29);look.y=1.3;camera.lookAt(look);}
 camera.updateMatrixWorld();return camera;
}
const summary={status:'passed',verificationLimit:'CPU geometry and shader-equivalent math only; GPU shader compilation and visual browser inspection unavailable',checks:[],poses:[],flow:[],warnings:[],raisedGround:[]};
const poses=[{name:'flat',heading:0,bodyHeight:.012,groundHeight:.012,bodyPitch:0,bodyRoll:0,suspension:'street'},{name:'braking-lowered',heading:1.2,bodyHeight:.045,groundHeight:.012,bodyPitch:.08,bodyRoll:-.045,suspension:'sport'},{name:'curb-roll',heading:-.8,bodyHeight:.075,groundHeight:.04,bodyPitch:.045,bodyRoll:.09,suspension:'race'},{name:'airborne',heading:-2,bodyHeight:.26,groundHeight:-.06,bodyPitch:-.11,bodyRoll:.10,suspension:'race'}];
for(const vehicle of VEHICLES)for(const pose of poses){
 const build=resolveBuild({carId:vehicle.id,suspension:pose.suspension}),scene=new THREE.Scene(),car=createCar(scene,build),post=new ComicRenderer(renderer());post.resize(1920,1080);post.setCarBounds({...build.vehicle.model,rideHeight:build.physics.rideHeight});
 const state={...pose,x:12,z:54,speed:35,vx:Math.sin(pose.heading)*35,vz:Math.cos(pose.heading)*35,boosting:false,wheelSpins:[1,1,1,1],suspension:Array.from({length:4},()=>({wheelY:pose.groundHeight+build.physics.wheelRadius,groundHeight:pose.groundHeight,contact:true}))};
 car.group.position.set(state.x,0,state.z);car.group.rotation.y=state.heading;car.update(state,1/60,1);car.group.updateMatrixWorld(true);
 const chassis=car.group.children[0].children[0],cam=cameraFor(0,state);post.render(scene,cam,state,1/60,1,{blur:.65,quality:'high',camera:0},{active:true,cameraMode:0});
 const u=post.material.uniforms,bodyToWorld=chassis.matrixWorld;
 let maxTransformError=0,protectedBodyPoints=0,screenPoints=0,protectedModelVertices=0,maxReconstructionError=0;
 for(const local of [new THREE.Vector3(0,.7,1),new THREE.Vector3(.6,.85,-1),new THREE.Vector3(-.55,1.05,0),new THREE.Vector3(0,build.vehicle.model.height-.02,-.2)]){
  const world=local.clone().applyMatrix4(bodyToWorld),restored=world.clone().sub(u.playerPosition.value).applyMatrix3(u.playerInverseBasis.value);
  maxTransformError=Math.max(maxTransformError,restored.distanceTo(local));assert(restored.distanceTo(local)<1e-12,'Body mask transform must invert the actual model transform, including ride height');
  assert(mask(world,u,post.current)>.999,'Visible body points must be protected');protectedBodyPoints++;
  const projected=project(world,post.current),reconstructed=reconstruct(projected,post.inverse);maxReconstructionError=Math.max(maxReconstructionError,world.distanceTo(reconstructed));assert(world.distanceTo(reconstructed)<1e-8);
 }
 chassis.traverse(node=>{if(!node.isMesh||!node.visible)return;let parent=node.parent;while(parent&&parent!==chassis){if(!parent.visible)return;parent=parent.parent;}const positions=node.geometry.attributes.position;for(let i=0;i<positions.count;i++){
  const world=new THREE.Vector3(positions.getX(i),positions.getY(i),positions.getZ(i)).applyMatrix4(node.matrixWorld),p=project(world,post.current);
  if(p.w>cam.near&&p.uv.x>=0&&p.uv.x<=1&&p.uv.y>=0&&p.uv.y<=1){const r=u.playerScreenRect.value;assert(p.uv.x>=r.x-1e-7&&p.uv.x<=r.z+1e-7&&p.uv.y>=r.y-1e-7&&p.uv.y<=r.w+1e-7,'Projected rectangle must enclose actual visible chassis vertices');screenPoints++;const bodyLocal=world.clone().sub(u.playerPosition.value).applyMatrix3(u.playerInverseBasis.value);if(bodyLocal.y>.15&&bodyLocal.y<build.vehicle.model.height+.04&&world.y>u.playerGround.value+.06){assert(mask(world,u,post.current)>.999,'Actual visible upper-body mesh vertices must be protected');protectedModelVertices++;}}
 }});
 for(const dx of [-.8,0,.8])for(const dz of [-1.7,0,1.7]){
  const point=new THREE.Vector3(dx,0,dz).applyAxisAngle(new THREE.Vector3(0,1,0),state.heading);point.x+=state.x;point.z+=state.z;point.y=state.groundHeight;
  assert.equal(mask(point,u,post.current),0,'Flat ground beneath pitched/rolled/lowered car must remain unmasked');
 }
 summary.poses.push({car:vehicle.id,pose:pose.name,rideHeight:build.physics.rideHeight,maxTransformError,maxReconstructionError,protectedBodyPoints,actualChassisScreenPoints:screenPoints,protectedModelVertices});car.dispose();post.target.dispose();post.material.dispose();
}
summary.checks.push('All four model poses invert the actual chassis transform including heave, pitch, roll, yaw and ride height','Dynamic screen rectangle contains actual chassis geometry across four models','Projected depth reconstructs true world position','Flat road remains unmasked below every tested body pose');
const mainSource=fs.readFileSync(new URL('../dist/main.js',import.meta.url),'utf8'),groundFunction=mainSource.match(/function updateBodyGroundMask\([^)]*\)\{[\s\S]*?\n\}/)?.[0];
assert(groundFunction,'The real main-loop ground rejection sampler must be available');
const sampledWorld=createWorld(new THREE.Scene());
for(const vehicle of VEHICLES)for(const terrain of ['curb','joint']){
 const build=resolveBuild({carId:vehicle.id,suspension:'race'}),progress=terrain==='curb'?.10:.79,offset=terrain==='curb'?12.3:0;
 const center=sampledWorld.curve.getPointAt(progress),tangent=sampledWorld.curve.getTangentAt(progress),heading=Math.atan2(tangent.x,tangent.z),sn=Math.sin(heading),cs=Math.cos(heading);
 const state={x:center.x+cs*offset,z:center.z-sn*offset,heading,speed:35,vx:sn*35,vz:cs*35,bodyHeight:.05,bodyPitch:.04,bodyRoll:.06,groundHeight:.04};
 state.suspension=[[-1,build.physics.frontAxle],[1,build.physics.frontAxle],[-1,-build.physics.rearAxle],[1,-build.physics.rearAxle]].map(([side,z])=>({groundHeight:sampledWorld.getSurfaceAt(state.x+side*build.physics.halfTrack*cs+z*sn,state.z-side*build.physics.halfTrack*sn+z*cs).height}));
 const context=vm.createContext({state,garagePanel:null,activeBuild:build,world:sampledWorld,Math});new vm.Script('('+groundFunction+')()').runInContext(context);
 const post=new ComicRenderer(renderer());post.resize(1920,1080);post.setCarBounds({...build.vehicle.model,rideHeight:build.physics.rideHeight});post.render(new THREE.Scene(),cameraFor(0,state),state,1/60,1,{blur:.65,quality:'high',camera:0},{active:true,cameraMode:0});
 const u=post.material.uniforms;assert.equal(u.playerGround.value,state.maskGroundHeight);let maxRoadMask=0,highestActual=-Infinity;
 for(let ix=0;ix<=20;ix++)for(let iz=0;iz<=20;iz++){
  const x=(ix/20-.5)*build.vehicle.model.width,z=(iz/20-.5)*build.vehicle.model.length,point=new THREE.Vector3(state.x+x*cs+z*sn,0,state.z-x*sn+z*cs);point.y=sampledWorld.getSurfaceAt(point.x,point.z).height;
  highestActual=Math.max(highestActual,point.y);maxRoadMask=Math.max(maxRoadMask,mask(point,u,post.current));
 }
 assert.equal(maxRoadMask,0,'Raised curb or expansion joint beneath the body volume must keep full environment blur');
 const local=new THREE.Vector3(0,.8,0),bodyWorld=local.applyMatrix4(post.playerMatrix);assert(mask(bodyWorld,u,post.current)>.999,'Conservative ground rejection must retain the upper body mask');
 summary.raisedGround.push({car:vehicle.id,terrain,maskGroundHeight:state.maskGroundHeight,highestActual,maxRoadMask,samples:441});post.target.dispose();post.material.dispose();
}
summary.checks.push('Actual main-loop footprint sampler rejects raised curbs and joints beneath every lowered car','Conservative ground rejection still protects upper car body');
for(const mode of [0,1,2])for(const fps of [30,60,120]){
 const dt=1/fps,speed=50,state={x:0,z:50,heading:0,speed,vx:0,vz:speed,bodyHeight:.012,groundHeight:.012,bodyPitch:.04,bodyRoll:-.03},old={...state,z:state.z-speed*dt};
 const post=new ComicRenderer(renderer());post.resize(1920,1080);post.setCarBounds({...resolveBuild({carId:'atlas'}).vehicle.model,rideHeight:-.025});const scene=new THREE.Scene(),settings={camera:mode,blur:.65,quality:'high'};
 post.render(scene,cameraFor(mode,old),old,dt,1-dt,settings,{active:true,cameraMode:mode});assert.equal(post.material.uniforms.motionActive.value,0);const previous=post.current.clone();
 post.render(scene,cameraFor(mode,state),state,dt,1,settings,{active:true,cameraMode:mode});const u=post.material.uniforms;assert.equal(u.motionActive.value,1);
 const point=mode===0?new THREE.Vector3(9,.012,54):new THREE.Vector3(8,.012,72),current=project(point,post.current),prior=project(point,previous),world=reconstruct(current,post.inverse);
 assert.equal(mask(world,u,post.current),0);const pixels=current.uv.clone().sub(prior.uv).multiplyScalar(u.exposureTime.value*settings.blur).multiply(new THREE.Vector2(1920,1080)).length();assert(pixels>1);
 const seconds=u.exposureTime.value*dt;
 post.render(scene,cameraFor(mode,state),state,dt,1+dt,settings,{active:false,cameraMode:mode});assert.equal(u.motionActive.value,0);
 post.reset();post.render(scene,cameraFor(mode,state),state,dt,1+2*dt,settings,{active:true,cameraMode:mode});assert.equal(u.motionActive.value,0);
 summary.flow.push({mode,fps,pixels,shutterSeconds:seconds});post.target.dispose();post.material.dispose();
}
for(const mode of [0,1,2]){const group=summary.flow.filter(r=>r.mode===mode),min=Math.min(...group.map(r=>r.pixels)),max=Math.max(...group.map(r=>r.pixels));assert(max/min<1.12,'World-flow exposure should stay stable across30/60/120fps');}
summary.checks.push('Environment translation remains visible in all three cameras','World exposure stable across 30/60/120fps','Pause and camera cuts suppress motion blur');
const source=fs.readFileSync(new URL('../dist/post.js',import.meta.url),'utf8');
for(const expression of ['playerInverseBasis*(world-playerPosition)','smoothstep(.045,.10,p.y)','smoothstep(playerGround+.025,playerGround+.06,world.y)','color*=1.12','2.51*color+.03','pow(color,vec3(1./2.2))','color=mix(vec3(luma),color,1.07)','90.-retro*65.','(.08+retro*.07)'])assert(source.includes(expression),`Shader expression changed; update corresponding mathematical oracle: ${expression}`);
summary.checks.push('Shader uses tested matrix/mask expressions and retains original color/filter constants');
fs.writeFileSync(new URL('./post-v3-results.json',import.meta.url),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify({status:summary.status,poses:summary.poses.length,flow:summary.flow,checks:summary.checks,raisedGround:summary.raisedGround,warnings:summary.warnings},null,2));
