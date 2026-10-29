import {resolveVehicleContacts} from './contact.js';
import {resolveBuild} from './catalog.js';
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const poseOf=state=>({x:state.x,z:state.z,heading:state.heading||0,vx:state.vx||0,vz:state.vz||0,yawRate:state.yawRate||0});

/** Host-side contacts for remotely owned cars. Only copied poses and shared NPC
 * bodies enter the planar solver; this never advances or corrects a peer engine. */
export class RemoteContactTracker{
 constructor(){this.reset();}
 reset(){this.frames=new Map();this.cooldowns=new Map();this.resolvedPoses=0;this.contacts=0;}
 update(players,{traffic,police,now=0}={}){
  const alive=new Set(),contacts=[];
  for(const player of (players||[]).slice(0,3)){
   if(!player?.active||!player.state||player.ageMs>2500)continue;
   const id=String(player.id),state=player.state;if(![state.x,state.z,state.vx,state.vz].every(Number.isFinite))continue;alive.add(id);
   const stamp=Number.isFinite(player.updatedAt)?player.updatedAt:now,previous=this.frames.get(id);if(previous&&stamp<=previous.stamp)continue;
   const source=poseOf(state),proxy={...source},elapsed=previous?(stamp-previous.stamp)/1000:.05,speed=Math.hypot(source.vx,source.vz),distance=previous?Math.hypot(source.x-previous.source.x,source.z-previous.source.z):0;
   const sweep=previous&&elapsed>0&&elapsed<=.3&&distance<=Math.max(12,(speed+previous.speed)*elapsed*1.6)?previous.source:null;
   this.frames.set(id,{stamp,source,speed});this.resolvedPoses++;
   const colliders=[...(traffic?.getColliders?.(proxy,60)||[]),...(police?.getColliders?.(proxy,60)||[])].filter(c=>c?.body&&['traffic','police'].includes(c.kind));
   const result=resolveVehicleContacts(proxy,colliders,resolveBuild(player.build),{dt:clamp(elapsed,1/120,1/15),previousPosition:sweep});
   for(const hit of result.contacts.slice(0,8)){
    if(hit.closingSpeed<=1&&hit.impulse<=100)continue;
    const key=id+':'+(hit.collider.npcId??hit.collider.id??hit.collider.kind),last=this.cooldowns.get(key)??-Infinity;
    if(now-last<180)continue;this.cooldowns.set(key,now);this.contacts++;
    const contact={...hit,playerId:id};if(hit.collider.kind==='traffic')traffic?.onPlayerContact?.(contact);else police?.onPlayerContact?.(contact);
    if(hit.closingSpeed>2)contacts.push(contact);
   }
  }
  for(const id of this.frames.keys())if(!alive.has(id))this.frames.delete(id);
  for(const[key,time]of this.cooldowns)if(now-time>2500)this.cooldowns.delete(key);
  while(this.cooldowns.size>128)this.cooldowns.delete(this.cooldowns.keys().next().value);
  return contacts;
 }
 diagnostics(){return{tracked:this.frames.size,resolvedPoses:this.resolvedPoses,contacts:this.contacts,cooldowns:this.cooldowns.size};}
}
