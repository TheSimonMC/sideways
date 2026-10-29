import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as THREE from '../dist/vendor/three.module.js';
import {DayNight} from '../dist/environment.js';
import {createShowroom,disposeWorld} from '../dist/world-lifecycle.js';
import {createWorld} from '../dist/world.js';
import {createCity} from '../dist/city.js';
import {createTraffic} from '../dist/traffic.js';
import {createPolice} from '../dist/police.js';
const report={status:'pending',checks:[],lighting:[],worlds:[],verificationLimit:'Actual Three.js scene objects, camera transforms, lights and owned-resource disposal in Node. No GPU render or visual validation.'};
const check=name=>report.checks.push(name);
const canvasContext=new Proxy({measureText:()=>({width:120}),createLinearGradient:()=>({addColorStop(){}}),createRadialGradient:()=>({addColorStop(){}})},{get:(o,k)=>k in o?o[k]:(()=>{}),set:(o,k,v)=>(o[k]=v,true)});
globalThis.document={createElement:()=>({width:0,height:0,getContext:()=>canvasContext})};
{
 const scene=new THREE.Scene();scene.fog=new THREE.Fog(0,10,100);const renderer={toneMappingExposure:1},sun=new THREE.DirectionalLight();scene.add(sun,sun.target);const e=new DayNight(scene,renderer,sun);const camera=new THREE.PerspectiveCamera(60,16/9,.16,1400);camera.position.set(502,7,-414);camera.lookAt(500,1,-400);
 const state={x:500,z:-400,heading:.7,bodyHeight:.02,groundHeight:0,boosting:false},world={streetLights:[{x:500,z:-400,y:6},{x:505,z:-401,y:6},{x:800,z:800,y:6}],night:null,setNight(v){this.night=v;}};e.setWorld(world);
 for(const timeMode of ['day','sunset','night']){
  const s={timeMode,headlights:true,quality:'high'};const light=e.update(1/60,state,camera,s,2);scene.updateMatrixWorld(true);
  assert.ok(Number.isFinite(light.night)&&light.night>=0&&light.night<=1);assert.equal(world.night,light.night);assert.ok(e.ambient.intensity>0&&renderer.toneMappingExposure>0);assert.ok(scene.fog.far>scene.fog.near);
  for(const {light:lamp} of e.headlights){const direction=lamp.target.position.clone().sub(lamp.position).normalize(),forward=new THREE.Vector3(Math.sin(state.heading),0,Math.cos(state.heading));assert.ok(direction.dot(forward)>.99);assert.ok(lamp.intensity>0);}
  const disc=e.sunDisc.visible?e.sunDisc:e.moon,normal=new THREE.Vector3(0,0,1).applyQuaternion(disc.getWorldQuaternion(new THREE.Quaternion())),toCamera=camera.position.clone().sub(disc.getWorldPosition(new THREE.Vector3())).normalize();assert.ok(normal.dot(toCamera)>.9999,'Sun/moon must face the world-space camera, even far from map origin');
  assert.ok(camera.far>1050+camera.position.distanceTo(e.root.position),'Sky sphere must fit the camera far plane');
  report.lighting.push({timeMode,hour:light.hour,night:light.night,sun:sun.intensity,ambient:e.ambient.intensity,headlight:e.headlights[0].light.intensity,stars:e.stars.material.opacity,activeStreetLights:e.streetPool.filter(l=>l.intensity>0).length});
 }
 assert.equal(report.lighting[0].night,0);assert.equal(report.lighting[2].night,1);assert.ok(report.lighting[2].stars>.8);assert.equal(report.lighting[2].activeStreetLights,2);
 e.update(0,state,camera,{timeMode:'night',headlights:false,quality:'psx'},3);assert.ok(e.headlights.every(({light})=>light.intensity===0&&!light.castShadow));
 state.boosting=true;state.nitrousIntensity=1;e.update(0,state,camera,{timeMode:'night',headlights:false},4);assert.ok(e.nosLight.intensity>0);state.boosting=false;e.update(0,state,camera,{timeMode:'night'},5);assert.equal(e.nosLight.intensity,0);
 const start=e.hour;e.update(30,state,camera,{timeMode:'cycle',dayMinutes:12},6);assert.ok(Math.abs(e.hour-(start+1)%24)<1e-9);const paused=e.hour;e.update(0,state,camera,{timeMode:'cycle',dayMinutes:12},7);assert.equal(e.hour,paused);
 check('Day/night cycle changes sun, moon, sky, ambient, fog, exposure, stars and nearby street lights; zero dt pauses the cycle');
 check('Headlight targets follow vehicle heading and switches; sun/moon billboards face the camera away from the world origin');
}
const main=fs.readFileSync(new URL('../dist/main.js',import.meta.url),'utf8');
function helper(name){const a=main.indexOf('function '+name+'('),b=main.slice(a).search(/\n(?:async )?function /);assert.ok(a>=0);return b<0?main.slice(a):main.slice(a,a+b);}
{
 const scene=new THREE.Scene(),calls={city:0,dock:0,showroom:1},labels={};
 const ctx={THREE,scene,world:createShowroom(scene),traffic:null,police:null,crimeContacts:[],serviceTarget:null,serviceJob:null,policeState:{},audio:{setTraffic(){}},physics:{setGroundSampler(){}},environment:{setWorld(){}},gameUI:{loadingStatus(){}},$:id=>labels[id]||(labels[id]={}),disposeWorld,createCity(s){calls.city++;return createCity(s);},createWorld(s){calls.dock++;return createWorld(s);},createShowroom(s){calls.showroom++;return createShowroom(s);},createTraffic,createPolice};vm.createContext(ctx);vm.runInContext(helper('selectWorld'),ctx);
 assert.deepEqual(calls,{city:0,dock:0,showroom:1});assert.equal(scene.children.length,1);assert.equal(scene.children[0].name,'SHOWROOM');
 for(const target of ['free','sprint','menu','free','menu','drift','free','menu']){
  const previous=ctx.world,owned=new Set(),disposed=new Set();previous.root.traverse(o=>{if(o.geometry)owned.add(o.geometry);for(const m of o.material?(Array.isArray(o.material)?o.material:[o.material]):[]){owned.add(m);for(const v of Object.values(m))if(v?.isTexture)owned.add(v);}});for(const resource of owned)resource.addEventListener('dispose',()=>disposed.add(resource));
  ctx.selectWorld(target);assert.equal(scene.children.length,1,'Only the selected world owns a scene root');assert.notEqual(ctx.world,previous);assert.equal(previous.root.parent,null);for(const resource of owned)assert.ok(disposed.has(resource),'Old world geometry/material/texture must be released');
  assert.equal(ctx.world.kind,target==='free'?'city':target==='menu'?'showroom':'dock');if(target==='free'){assert.equal(ctx.traffic.states.length,36);assert.equal(ctx.police.getState().officers.length,3);assert.equal(ctx.traffic.root.parent,ctx.world.root);}else{assert.equal(ctx.traffic,null);assert.equal(ctx.police,null);}
  const current=ctx.world,counts={...calls};ctx.selectWorld(target);assert.equal(ctx.world,current);assert.deepEqual(calls,counts,'Selecting the current map must not rebuild it');report.worlds.push({target,kind:ctx.world.kind,disposedResources:disposed.size});
 }
 disposeWorld(ctx.world);assert.equal(scene.children.length,0);check('Actual map selection constructs only the selected map and removes every owned geometry, material and texture on eight mode changes');
 check('Menu uses a small showroom; city traffic/police only exist while the city is active and selecting the current map reuses it');
}
report.status='passed';fs.writeFileSync(new URL('./environment-v6-results.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
