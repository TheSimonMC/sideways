const clamp=(value,low,high)=>Math.max(low,Math.min(high,Number.isFinite(value)?value:low));

/** Directional roadside cameras observe a crossing, not a distance bubble.
 * Police receive the photographed location, never the player's future position. */
export function createEnforcement(city){
 const cameras=city?.speedCameras||[],events=[],cooldowns=new Map(),playersState=new Map(),captures=new Map();
 let time=0,tickets=0,lastCapture=null,nearbyCamera=null,disposed=false,localPlayerId='local';
 function reset(){time=0;playersState.clear();captures.clear();tickets=0;lastCapture=null;nearbyCamera=null;cooldowns.clear();events.length=0;}
 function inspect(player,police){
  if(disposed||!player||![player.x,player.z].every(Number.isFinite))return;
  const playerId=String(player.playerId??player.id??'local').slice(0,80),record=playersState.get(playerId)||{previous:null,tickets:0},previous=record.previous;playersState.set(playerId,record);const speedKph=Math.hypot(player.vx||0,player.vz||0)*3.6,actualSpeed=Number.isFinite(player.speed)?Math.max(speedKph,player.speed*3.6):speedKph;
  const jumped=previous&&Math.hypot(player.x-previous.x,player.z-previous.z)>Math.max(12,actualSpeed/3.6*.15);
  for(const camera of cameras){
   const p=camera.trigger||camera,d=camera.direction||{x:Math.sin(camera.heading||0),z:Math.cos(camera.heading||0)},length=Math.hypot(d.x,d.z)||1,dx=d.x/length,dz=d.z/length;
   const x=player.x-p.x,z=player.z-p.z,along=x*dx+z*dz,lateral=x*dz-z*dx,distance=Math.hypot(x,z),forward=(player.vx||0)*dx+(player.vz||0)*dz;
   if(playerId===localPlayerId&&distance<(camera.range||45)&&Math.abs(lateral)<(camera.laneWidth||9)*.6&&forward>.2&&(!nearbyCamera||distance<nearbyCamera.distance))nearbyCamera={id:camera.id,name:camera.name,limitKph:camera.limitKph||70,distance,approaching:along<0};
   if(!previous||jumped||time<(cooldowns.get(playerId+'|'+camera.id)||0)||forward<1||actualSpeed<=(camera.limitKph||70)+5)continue;
   const old=(previous.x-p.x)*dx+(previous.z-p.z)*dz;
   if(old>=0||along<0||Math.abs(along-old)>Math.max(12,actualSpeed/3.6*.15))continue;
   const fraction=-old/Math.max(.00001,along-old),crossX=previous.x+(player.x-previous.x)*fraction-p.x,crossZ=previous.z+(player.z-previous.z)*fraction-p.z;
   if(Math.abs(crossX*dz-crossZ*dx)>(camera.laneWidth||9)*.5)continue;
   tickets++;record.tickets++;const measured=Math.round(actualSpeed),limit=camera.limitKph||70,excess=measured-limit,reported=excess>=30;
   lastCapture={type:'speedCamera',playerId,cameraId:camera.id,name:camera.name||'Speed camera',district:camera.district||city.getDistrict?.(p.x,p.z)||'NEON CITY',x:p.x,z:p.z,speedKph:measured,limitKph:limit,excessKph:excess,tickets:record.tickets,reported,time,message:`${measured} KM/H IN A ${limit} ZONE${reported?' · POLICE NOTIFIED':''}`};
   captures.set(playerId,lastCapture);events.push({...lastCapture});if(events.length>16)events.shift();cooldowns.set(playerId+'|'+camera.id,time+(camera.cooldown||12));city.flashSpeedCamera?.(camera.id,1);
   if(reported)police?.reportCamera?.({...lastCapture,heading:Math.atan2(dx,dz),direction:{x:dx,z:dz}});
  }
  record.previous={x:player.x,z:player.z};
 }
 function update(dt,player,{police,players=[]}={}){if(disposed||!player)return;time+=clamp(dt,0,.1);localPlayerId=String(player.playerId??player.id??'local').slice(0,80);nearbyCamera=null;const seen=new Set();for(const p of[player,...players].slice(0,4)){if(!p||p.active===false)continue;const id=String(p.playerId??p.id??'local').slice(0,80);if(seen.has(id))continue;seen.add(id);inspect(p,police);}}
 function getState(){const capture=captures.get(localPlayerId);return{tickets:playersState.get(localPlayerId)?.tickets||0,totalTickets:tickets,lastCapture:capture?{...capture}:null,nearbyCamera:nearbyCamera?{...nearbyCamera}:null,cameras,time};}
 function dispose(){disposed=true;events.length=0;cooldowns.clear();playersState.clear();captures.clear();}
 return{update,reset,getState,dispose,consumeEvents(){return events.splice(0);}};
}
