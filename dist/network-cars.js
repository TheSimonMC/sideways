import {bodyMassProperties} from './body-hinges.js';
import * as THREE from './vendor/three.module.js';
import {createCar} from './car.js';
import {resolveBuild} from './catalog.js';
import {sanitizeNetworkPose} from './multiplayer.js';
const lerp=(a,b,t)=>a+(b-a)*t;
const wrap=v=>Math.atan2(Math.sin(v),Math.cos(v));
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const interpolate=(a,b,t,key)=>lerp(a[key]??0,b[key]??0,t);
function samplePose(a,b,t){
 const state={...b};
 for(const key of ['x','z','vx','vz','yawRate','speed','forwardSpeed','bodyHeight','groundHeight','bodyPitch','bodyRoll','steer','brake','throttle','rpm','nitrousIntensity'])state[key]=interpolate(a,b,t,key);
 state.heading=a.heading+wrap(b.heading-a.heading)*t;
 state.wheelSpins=b.wheelSpins.map((v,i)=>(a.wheelSpins[i]??0)+wrap(v-(a.wheelSpins[i]??0))*t);
 state.wheelSteers=b.wheelSteers.map((v,i)=>lerp(a.wheelSteers[i]??0,v,t));
 state.suspension=b.suspension.map((s,i)=>({...s,wheelY:lerp(a.suspension[i]?.wheelY??s.wheelY,s.wheelY,t),groundHeight:lerp(a.suspension[i]?.groundHeight??s.groundHeight,s.groundHeight,t)}));return state;
}
function labelTexture(name,color){
 if(!globalThis.document?.createElement)return null;const canvas=document.createElement('canvas');canvas.width=256;canvas.height=64;const ctx=canvas.getContext?.('2d');if(!ctx)return null;
 ctx.fillStyle='#14202bdc';ctx.fillRect(0,0,256,64);ctx.fillStyle=color;ctx.fillRect(0,59,256,5);ctx.fillStyle='#f3f0e5';ctx.font='bold 26px Arial';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(name,128,31,230);
 const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;return texture;
}
/** Three remote cars at most, with delayed interpolation and bounded prediction. */
export function createNetworkCars(scene,{now=()=>performance.now(),createVehicle=createCar}={}){
 const records=new Map();let disposed=false;
 function make(record){
  const build=resolveBuild(record.build),car=createVehicle(scene,build);car.setColor(record.color);car.group.name='REMOTE-'+record.id;
  const texture=labelTexture(record.name,record.color);let label=null;
  if(texture){label=new THREE.Sprite(new THREE.SpriteMaterial({map:texture,transparent:true,depthTest:false,depthWrite:false}));label.position.set(0,3,0);label.scale.set(3.7,.92,1);label.renderOrder=7;car.group.add(label);}
  const item={id:record.id,name:record.name,color:record.color,build,car,texture,label,queue:[],lastStamp:-1,lastReceived:now(),state:null,active:false,teleports:0};records.set(record.id,item);return item;
 }
 function remove(item){item.label?.removeFromParent();item.label?.material?.dispose();item.texture?.dispose();item.car.dispose();records.delete(item.id);}
 function sync(players=[]){
  if(disposed)return;const keep=new Set();for(const player of players.slice(0,3)){
   if(!player?.id||!player.state)continue;keep.add(player.id);let item=records.get(player.id)||make(player);item.active=!!player.active;
   const build=resolveBuild(player.build);if(build.signature!==item.build.signature){item.build=build;item.car.setBuild(build);item.car.group.name='REMOTE-'+player.id;}
   if(player.color!==item.color){item.color=player.color;item.car.setColor(player.color);}
   if(!item.active){item.car.group.visible=false;continue;}
   item.car.group.visible=true;const stamp=player.updatedAt??0;if(stamp===item.lastStamp)continue;
   const pose=sanitizeNetworkPose(player.state);if(!pose)continue;item.lastStamp=stamp;item.lastReceived=now();
   const previous=item.queue.at(-1)?.pose,teleported=previous&&Math.hypot(previous.x-pose.x,previous.z-pose.z)>Math.max(12,(pose.speed+previous.speed)*.12);
   if(teleported){item.queue.length=0;item.teleports++;}
   item.queue.push({at:now(),pose});if(item.queue.length>8)item.queue.shift();if(!item.state||teleported)item.state=pose;
  }
  for(const item of [...records.values()])if(!keep.has(item.id))remove(item);
 }
 function update(dt,time){
  if(disposed)return;const at=now(),target=at-100;
  for(const item of records.values()){
   item.car.group.visible=item.active&&at-item.lastReceived<2500;if(!item.car.group.visible||!item.queue.length)continue;
   const queue=item.queue;while(queue.length>2&&queue[1].at<target)queue.shift();
   const a=queue[0],b=queue[1]||a;
   let pose;if(target<=b.at&&b.at>a.at){pose=samplePose(a.pose,b.pose,clamp((target-a.at)/(b.at-a.at),0,1));}
   else{const last=queue.at(-1),extra=clamp((target-last.at)/1000,0,.12);pose={...last.pose,x:last.pose.x+last.pose.vx*extra,z:last.pose.z+last.pose.vz*extra,heading:last.pose.heading+last.pose.yawRate*extra};}
   item.state=pose;item.car.group.position.set(pose.x,0,pose.z);item.car.group.rotation.y=pose.heading;item.car.update(pose,dt,time);
   if(item.label)item.label.position.y=3+(pose.bodyHeight||0);
  }
 }
 function getNearbyAudio(player){const x=player?.x??0,z=player?.z??0;return [...records.values()].filter(r=>r.active&&r.car.group.visible&&r.state).map(r=>({id:'peer-'+r.id,x:r.state.x,z:r.state.z,distance:Math.hypot(r.state.x-x,r.state.z-z),speed:r.state.speed,rpm:r.state.engineRunning?r.state.rpm:0,throttle:r.state.engineRunning?r.state.throttle:0,engineRunning:r.state.engineRunning,horn:r.state.horn,braking:r.state.brake>.1,engineId:r.build.engine.id,remote:true})).filter(s=>s.distance<125);}
 function getColliders(player,radius=45){
  const x=player?.x??0,z=player?.z??0;return [...records.values()].filter(r=>r.active&&r.car.group.visible&&r.state&&Math.hypot(r.state.x-x,r.state.z-z)<radius).map(r=>({kind:'network',material:'metal',peerId:r.id,x:r.state.x,z:r.state.z,heading:r.state.heading,hx:r.build.vehicle.model.width*.5,hz:r.build.vehicle.model.length*.5,vx:r.state.vx,vz:r.state.vz,visible:true}));
 }
 function getStates(){return [...records.values()].filter(r=>r.active&&r.state).map(r=>({...r.state,playerId:r.id,name:r.name,width:r.build.vehicle.model.width,length:r.build.vehicle.model.length,mass:bodyMassProperties(r.build,r.state.bodyDamage,r.state.wheelAttached).mass,inertia:bodyMassProperties(r.build,r.state.bodyDamage,r.state.wheelAttached).inertia}));}
 function dispose(){if(disposed)return;disposed=true;for(const item of [...records.values()])remove(item);}
 return {sync,update,getNearbyAudio,getColliders,getStates,dispose,reset(){for(const item of [...records.values()])remove(item);},diagnostics(){return {count:records.size,visible:[...records.values()].filter(r=>r.car.group.visible).length,buffers:[...records.values()].map(r=>r.queue.length),teleports:[...records.values()].reduce((n,r)=>n+r.teleports,0)};}};
}
