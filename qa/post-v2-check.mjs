import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from '../dist/vendor/three.module.js';
import {ComicRenderer} from '../dist/post.js';

const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const smoothstep=(a,b,x)=>{const t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);};
const mockRenderer=()=>({info:{reset(){}},setRenderTarget(){},render(){}});
function cameraFor(mode,z){
 const camera=new THREE.PerspectiveCamera(mode===0?51:mode===1?75:82,1920/1080,.16,950);
 if(mode===0){camera.position.set(0,33,z-17);camera.lookAt(0,0,z+4);}
 else if(mode===1){camera.position.set(0,2.9,z-7.5);camera.lookAt(0,1.2,z+12);}
 else{camera.position.set(0,1.2,z+1.1);camera.lookAt(0,1.3,z+29);}
 camera.updateMatrixWorld();return camera;
}
function project(point,vp){const p=new THREE.Vector4(...point,1).applyMatrix4(vp);return {uv:new THREE.Vector2(p.x/p.w*.5+.5,p.y/p.w*.5+.5),depth:p.z/p.w*.5+.5};}
function reconstruct(projected,inverse){const p=new THREE.Vector4(projected.uv.x*2-1,projected.uv.y*2-1,projected.depth*2-1,1).applyMatrix4(inverse);return new THREE.Vector3(p.x/p.w,p.y/p.w,p.z/p.w);}
function mask(world,state){const sx=Math.sin(state.heading),cz=Math.cos(state.heading),dx=world.x-state.x,dz=world.z-state.z;const lx=cz*dx-sx*dz,lz=sx*dx+cz*dz,footprint=Math.max(Math.abs(lx)/1.16,Math.abs(lz)/2.48);return (1-smoothstep(.98,1.035,footprint))*smoothstep(.018,.065,world.y)*(1-smoothstep(1.60,1.85,world.y));}
function trace(mode,fps){
 const dt=1/fps,speed=50,z=50;
 const post=new ComicRenderer(mockRenderer());post.resize(1920,1080);
 const scene=new THREE.Scene(),settings={camera:mode,blur:.65,quality:'high'},state={speed,x:0,z,heading:0,vx:0,vz:speed,boosting:false};
 const prior=cameraFor(mode,z-speed*dt),current=cameraFor(mode,z);
 post.render(scene,prior,{...state,z:z-speed*dt},dt,1-dt,settings,{active:true,cameraMode:mode});
 const previousVP=post.current.clone();
 assert.equal(post.material.uniforms.motionActive.value,0,'First frame must not blur');
 post.render(scene,current,state,dt,1,settings,{active:true,cameraMode:mode});
 const u=post.material.uniforms;
 assert.equal(u.motionActive.value,1);
 const point=mode===0?[9,.012,z+4]:[8,.012,z+22];
 const p=project(point,post.current),world=reconstruct(p,post.inverse);
 assert.ok(world.distanceTo(new THREE.Vector3(...point))<1e-7,'Depth reconstruction must recover world position');
 assert.equal(mask(world,state),0,'Road must remain unmasked, even near player');
 const priorProjection=project(world.toArray(),previousVP);
 const rawFlow=p.uv.clone().sub(priorProjection.uv),flow=rawFlow.clone().multiplyScalar(u.exposureTime.value*settings.blur);
 const px=flow.clone().multiply(new THREE.Vector2(1920,1080)).length();
 assert.ok(px>1,`Visible world flow required in mode ${mode}`);
 const carPoint=mode===2?[0,.7,z+2.1]:[0,.8,z+1];const carProjected=project(carPoint,post.current),carWorld=reconstruct(carProjected,post.inverse);
 assert.ok(mask(carWorld,state)>.999,'Car body must be protected');
 const roadUnder=[0,.012,z+1],roadProjected=project(roadUnder,post.current);
 assert.equal(mask(reconstruct(roadProjected,post.inverse),state),0,'Road directly under screen mask must retain motion');
 const bounds=u.playerScreenRect.value;
 assert.ok(carProjected.uv.x>=bounds.x&&carProjected.uv.x<=bounds.z&&carProjected.uv.y>=bounds.y&&carProjected.uv.y<=bounds.w,'Car reject rectangle must include the visible car point');
 post.render(scene,current,state,dt,1+dt,settings,{active:false,cameraMode:mode});
 assert.equal(u.motionActive.value,0,'Paused render must not retain a speed blur');
 post.reset();post.render(scene,current,state,dt,1+2*dt,settings,{active:true,cameraMode:mode});
 assert.equal(u.motionActive.value,0,'Camera changes must not smear a cut');
 const result={cameraMode:mode,fps,worldPoint:point,worldMotionPixels:px,shutterSeconds:u.exposureTime.value*dt,carMask:mask(carWorld,state),roadMask:mask(world,state),bounds:bounds.toArray()};
 post.target.dispose();post.material.dispose();return result;
}
const results=[];
for(const mode of [0,1,2])for(const fps of [30,60,120])results.push(trace(mode,fps));
for(const mode of [0,1,2]){
 const group=results.filter(r=>r.cameraMode===mode),min=Math.min(...group.map(r=>r.worldMotionPixels)),max=Math.max(...group.map(r=>r.worldMotionPixels));
 assert.ok(max/min<1.12,`Exposure changes too much with frame rate in camera ${mode}: ${max/min}`);
}
const source=fs.readFileSync(new URL('../dist/post.js',import.meta.url),'utf8');
for(const unchanged of ['color*=1.12','2.51*color+.03','pow(color,vec3(1./2.2))','color=mix(vec3(luma),color,1.07)','90.-retro*65.','(.08+retro*.07)'])assert.ok(source.includes(unchanged),`Original color treatment changed: ${unchanged}`);
const summary={passed:true,checks:['World depth reconstruction','World translation flow in all cameras','Exposure stable at 30/60/120 fps','Exact body mask','Road remains unmasked','Pause and camera cut suppression','Original color/filter constants retained'],results};
fs.writeFileSync(new URL('./post-v2-results.json',import.meta.url),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary,null,2));
