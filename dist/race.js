import {wetTyreResponse} from './weather.js';
import {createAgent,createAgentRenderer,setAgentPose,integrateAgent,syncAgent,agentBuild} from './traffic.js';
import {resolveVehicleContacts} from './contact.js';

const clamp=(v,a,b)=>Math.max(a,Math.min(b,Number.isFinite(v)?v:a));
const wrap=a=>Math.atan2(Math.sin(a),Math.cos(a));
const unit=v=>(v%1+1)%1;
const signedProgress=(a,b)=>{let d=a-b;if(d>.5)d--;if(d<-.5)d++;return d;};
const DRIVERS=[
 {name:'JUNO',engineId:'i4',style:1,paint:0xe9ba44,pace:1.01,acceleration:6.4,lane:-.35},
 {name:'ROWAN',engineId:'i6t',style:0,paint:0x69c5d6,pace:1.04,acceleration:6.1,lane:.4},
 {name:'MARA',engineId:'rotary',style:1,paint:0xed769d,pace:.97,acceleration:6.7,lane:.15},
 {name:'DEX',engineId:'v8',style:2,paint:0x9bb86c,pace:.95,acceleration:6.0,lane:-.2},
 {name:'KAI',engineId:'v6',style:0,paint:0xa39cde,pace:1.0,acceleration:6.25,lane:.3},
];
const DIFFICULTY={rookie:{speed:.83,grip:6.0,brake:6.0},club:{speed:1,grip:7.2,brake:7.6},pro:{speed:1.12,grip:8.1,brake:8.8}};

/** Circuit opponents use the same reciprocal planar contacts as street traffic.
 * Lap credit requires forward gate crossings plus continuous on-track travel.
 * No speed boost, position teleport or player-distance catch-up is used. */
export function createRace(scene,world,{count=5,laps=3,difficulty='club',seed=71129,playerName='YOU'}={}){
 if(!world?.samples?.length||!Number.isFinite(world.length))throw new Error('Circuit racing requires a sampled track.');
 const samples=world.samples,length=world.length,segment=length/samples.length,gateCount=world.checkpoints?.length||8;
 const totalLaps=clamp(Math.round(laps),1,5),level=DIFFICULTY[difficulty]||DIFFICULTY.club,events=[];
 const states=Array.from({length:clamp(Math.round(count),0,5)},(_,i)=>{
  const profile=DRIVERS[i],car=createAgent('racer-'+i,i,profile.style,'racer');
  Object.assign(car,{name:profile.name,paint:profile.paint,profile,seed:(seed+i*3779)>>>0,active:true,health:1});return car;
 });
 const renderer=createAgentRenderer(world.root||scene,states,{prefix:'race',racing:true});
 const curvature=samples.map((p,i)=>{const a=samples[(i-2+samples.length)%samples.length],b=samples[(i+2)%samples.length];return wrap(Math.atan2(b.tx,b.tz)-Math.atan2(a.tx,a.tz))/(segment*4);});
 const records=new Map(),stats={contacts:0,overtakes:0,recoveries:0,rejectedCrossings:0,invalidMoves:0,finishedOpponents:0};
 let elapsed=0,disposed=false,started=false,playerFinished=false,playerRetired=false,playerFinishPosition=null,lastPlayerPosition=states.length+1,lastRankTime=0;
 const playerId='player',sectorLength=length/gateCount;

 function sample(distance,offset=0){
  const p=unit(distance/length),f=p*samples.length,i=Math.floor(f),t=f-i,a=samples[i],b=samples[(i+1)%samples.length];
  let tx=a.tx+(b.tx-a.tx)*t,tz=a.tz+(b.tz-a.tz)*t;const norm=Math.hypot(tx,tz)||1;tx/=norm;tz/=norm;
  return{x:a.x+(b.x-a.x)*t+tz*offset,z:a.z+(b.z-a.z)*t-tx*offset,heading:Math.atan2(tx,tz),tx,tz,progress:p,curvature:curvature[i]};
 }
 function project(x,z){return world.getRoadInfo(x,z);}
 function gridPose(index){const row=Math.floor(index/2),lane=index%2?3.2:-3.2;return sample(-12-row*9,lane);}
 function record(id,name,isPlayer,pose){
  const road=project(pose.x,pose.z),distance=signedProgress(road.progress,0)*length;
  return{id,name,isPlayer,started:false,gates:0,nextGate:0,completedLaps:0,finished:false,finishTime:null,sectorDistance:0,progress:distance,roadProgress:road.progress,previous:{x:pose.x,z:pose.z},speed:0,wrongWayTime:0,invalidMove:false};
 }
 function emit(type,extra={}){events.push({type,...extra});if(events.length>48)events.shift();}
 function reset(){
  elapsed=0;started=false;playerFinished=false;playerRetired=false;playerFinishPosition=null;lastPlayerPosition=states.length+1;lastRankTime=0;events.length=0;records.clear();for(const key of Object.keys(stats))stats[key]=0;
  for(const car of states){const pose=gridPose(car.index);setAgentPose(car,pose,0,world);Object.assign(car,{health:1,hitHold:0,blockedTime:0,recoveryTimer:0,passTimer:0,passSide:0,passTarget:null,lane:car.index%2?3.2:-3.2,desiredLane:car.index%2?3.2:-3.2,brake:true,throttle:0,wheelSpin:0,previousWheelSpin:0,horn:0,active:true,visible:true});records.set(car.id,record(car.id,car.name,false,pose));}
  const pose=getPlayerSpawn();records.set(playerId,record(playerId,String(playerName||'YOU').trim().slice(0,20)||'YOU',true,pose));renderer.render(1,elapsed);return getState();
 }
 function getPlayerSpawn(){return gridPose(states.length);}
 function getPlayerRecoveryPose(){const r=records.get(playerId);return r?.started?sample((r.gates%gateCount)*sectorLength+3,-4):getPlayerSpawn();}
 function markPlayerReset(pose=getPlayerRecoveryPose()){
  const r=records.get(playerId),road=project(pose.x,pose.z);r.previous={x:pose.x,z:pose.z};r.roadProgress=road.progress;r.sectorDistance=r.started?3:0;r.progress=r.started?r.gates*sectorLength+3:signedProgress(road.progress,0)*length;r.wrongWayTime=0;r.invalidMove=false;r.speed=0;return pose;
 }
 function updateProgress(r,body,dt,teleported=false){
  if(r.finished||r.isPlayer&&playerRetired)return;
  const road=project(body.x,body.z),previous=r.previous,travel=Math.hypot(body.x-previous.x,body.z-previous.z),speed=Math.hypot(body.vx||0,body.vz||0),arc=signedProgress(road.progress,r.roadProgress)*length;
  const validStep=!teleported&&travel<=Math.max(3,Math.max(speed,r.speed,90)*dt*1.8+.5)&&Math.abs(arc)<=Math.max(6,travel*2+1);
  if(!validStep){stats.invalidMoves++;r.invalidMove=true;r.sectorDistance=0;}
  const forward=(body.vx||0)*road.tangent.x+(body.vz||0)*road.tangent.z;
  r.wrongWayTime=forward< -2?r.wrongWayTime+dt:Math.max(0,r.wrongWayTime-dt*2);
  if(validStep&&road.distance<14.5&&r.started)r.sectorDistance=clamp(r.sectorDistance+arc,0,sectorLength*1.35);
  const gate=sample(r.nextGate*sectorLength),before=(previous.x-gate.x)*gate.tx+(previous.z-gate.z)*gate.tz,after=(body.x-gate.x)*gate.tx+(body.z-gate.z)*gate.tz;
  if(validStep&&before<=0&&after>0){
   const t=-before/Math.max(.00001,after-before),crossX=previous.x+(body.x-previous.x)*t-gate.x,crossZ=previous.z+(body.z-previous.z)*t-gate.z;
   if(Math.abs(crossX*gate.tz-crossZ*gate.tx)<12.4&&forward>0){
    const travelled=!r.started||r.sectorDistance>=sectorLength*.80;
    if(travelled&&!r.invalidMove){
     if(!r.started){r.started=true;r.gates=0;}else r.gates++;
     r.nextGate=(r.nextGate+1)%gateCount;r.sectorDistance=Math.max(0,after);r.completedLaps=Math.floor(r.gates/gateCount);
     if(r.completedLaps>=totalLaps){
      r.finished=true;r.finishTime=elapsed-dt*(1-t);r.progress=totalLaps*length;
      if(r.isPlayer){playerFinished=true;playerFinishPosition=1+[...records.values()].filter(q=>!q.isPlayer&&q.finished&&q.finishTime<r.finishTime).length;emit('raceFinished',{position:playerFinishPosition,time:r.finishTime,laps:totalLaps,entries:standings()});}
      else{stats.finishedOpponents++;emit('opponentFinished',{id:r.id,name:r.name,time:r.finishTime});}
     }else if(r.nextGate===1&&r.gates>0)emit('lap',{id:r.id,isPlayer:r.isPlayer,lap:r.completedLaps+1,laps:totalLaps,finalLap:r.completedLaps===totalLaps-1});
    }else{stats.rejectedCrossings++;if(r.isPlayer)emit('checkpointMissed',{checkpoint:r.nextGate});}
   }
  }
  // A rejected discontinuity remains invalid until recovery or a full legitimate
  // sector has been driven again. Merely jumping onto the next gate earns none.
  if(r.invalidMove&&validStep&&road.distance<14.5&&r.sectorDistance>=sectorLength*.95)r.invalidMove=false;
  if(!r.finished){
   if(r.started){const from=(r.gates%gateCount)/gateCount,partial=unit(road.progress-from)*length;r.progress=r.gates*sectorLength+clamp(partial,0,Math.min(sectorLength,r.sectorDistance+3));}
   else r.progress=clamp(signedProgress(road.progress,0)*length,-length*.49,0);
  }
  r.previous={x:body.x,z:body.z};r.roadProgress=road.progress;r.speed=speed;
 }
 function plannedSpeed(car,road){
  const wetGrip=wetTyreResponse({...world.getSurfaceAt(car.x,car.z),speed:car.speed,compound:'sport'}).grip;const profile=car.profile,health=.76+.24*car.health;let target=35*level.speed*profile.pace*health*Math.sqrt(wetGrip);
  for(let ahead=0;ahead<=Math.max(85,car.speed*3.2);ahead+=6){const p=sample(road.progress*length+ahead),bend=Math.abs(p.curvature),corner=Math.sqrt(level.grip*wetGrip/Math.max(.0007,bend));target=Math.min(target,Math.sqrt(corner*corner+2*level.brake*wetGrip*Math.max(0,ahead-7)));}
  if(road.distance>10)target=Math.min(target,Math.max(5,17-(road.distance-10)*1.1));
  return target;
 }
 function nearbyStatic(car,radius=9){return world.getColliders?world.getColliders(car,radius):(world.colliders||[]).filter(c=>Math.abs(c.x-car.x)<radius+c.hx+c.hz&&Math.abs(c.z-car.z)<radius+c.hx+c.hz);}
 function drive(car,dt,player,snapshot){
  const wetGrip=wetTyreResponse({...world.getSurfaceAt(car.x,car.z),speed:car.speed,compound:'sport'}).grip;
  car.hitHold=Math.max(0,car.hitHold-dt);car.horn=Math.max(0,car.horn-dt);car.passTimer=Math.max(0,car.passTimer-dt);
  const road=project(car.x,car.z),centre=road.nearest,tangent=road.tangent,offset=(car.x-centre.x)*tangent.z-(car.z-centre.z)*tangent.x;
  const base=clamp(sample(road.progress*length+20).curvature*145+car.profile.lane,-2.8,2.8);
  const r=records.get(car.id);let target=plannedSpeed(car,road),desiredLane=r.finished?-6.2:elapsed<2.4?car.lane:base;
  const others=[...snapshot,...(player&&[player.x,player.z].every(Number.isFinite)?[{...player,id:playerId,width:player.width||2.1,length:player.length||4.5}]:[])];
  const observations=others.filter(o=>o.id!==car.id).map(o=>{const p=project(o.x,o.z);return{...o,ahead:signedProgress(p.progress,road.progress)*length,lane:(o.x-p.nearest.x)*p.tangent.z-(o.z-p.nearest.z)*p.tangent.x,forward:(o.vx||0)*tangent.x+(o.vz||0)*tangent.z};});
  const lead=observations.filter(o=>o.ahead>0&&o.ahead<48&&Math.abs(o.lane-offset)<2.5).sort((a,b)=>a.ahead-b.ahead)[0];
  if(!r.finished&&car.passTimer>0)desiredLane=car.passSide;
  else if(!r.finished&&lead&&target>lead.forward+1.0&&road.distance<11){
   const choices=[clamp(lead.lane-3.4,-5.2,5.2),clamp(lead.lane+3.4,-5.2,5.2)].filter(lane=>Math.abs(lane-lead.lane)>2.8).filter(lane=>!observations.some(o=>o.ahead>-8&&o.ahead<27&&Math.abs(o.lane-lane)<2.7));
   if(choices.length){desiredLane=choices.sort((a,b)=>Math.abs(a-offset)-Math.abs(b-offset))[0];car.passSide=desiredLane;car.passTimer=2.6;car.passTarget=lead.id;}
  }
  car.desiredLane=desiredLane;car.lane+=(desiredLane-car.lane)*(1-Math.exp(-dt*1.5));
  const lookAhead=clamp(6+car.speed*.38,6,23),aim=sample(road.progress*length+lookAhead,car.lane),fx=Math.sin(car.heading),fz=Math.cos(car.heading),rx=fz,rz=-fx;
  for(const other of observations){
   const dx=other.x-car.x,dz=other.z-car.z,along=dx*fx+dz*fz,lateral=dx*rx+dz*rz;
   if(along<=0||along>55||Math.abs(lateral)>(car.width+other.width)*.5+.25)continue;
   const gap=along-(car.length+other.length)*.5-1.25,closing=Math.max(0,car.speed-other.forward);
   target=Math.min(target,Math.sqrt(Math.max(0,other.forward)**2+2*level.brake*wetGrip*Math.max(0,gap-closing*.34)));
   if(gap<1.2)target=Math.min(target,Math.max(0,gap));
  }
  if(r.finished)target=Math.min(target,18);
  car.blockedTime=target>1&&car.speed<.65&&elapsed>3?car.blockedTime+dt:Math.max(0,car.blockedTime-dt*.8);
  if(car.blockedTime>3.2&&car.recoveryTimer===0){car.recoveryTimer=1.5;car.blockedTime=0;stats.recoveries++;car.passTimer=0;}
  if(car.recoveryTimer>0){car.recoveryTimer=Math.max(0,car.recoveryTimer-dt);const error=wrap(Math.atan2(tangent.x,tangent.z)-car.heading);aim.x=car.x+fx*6+rx*(error>0?-3:3);aim.z=car.z+fz*6+rz*(error>0?-3:3);target=-3.0;}
  if(car.hitHold>0)target=Math.min(target,12);
  aim.speed=target;integrateAgent(car,aim,dt,world,{acceleration:car.profile.acceleration*level.speed*(.65+.35*car.health),deceleration:level.brake});
  const contact=resolveVehicleContacts(car,nearbyStatic(car),agentBuild(car),{dt,previousPosition:{x:car.previousX,z:car.previousZ,heading:car.previousHeading},restitution:.06,friction:.24});
  if(contact.collided){stats.contacts+=contact.contacts.length;if(contact.maxClosingSpeed>3){car.hitHold=.35;car.health=clamp(car.health-contact.contacts.reduce((s,c)=>s+(c.energyJ||0),0)/700000,.35,1);}}
  syncAgent(car);
 }
 function update(dt,player,context={}){
  dt=clamp(dt,0,.05);if(!dt||disposed||!player||![player.x,player.z].every(Number.isFinite)||context.racing===false)return;
  if(dt>1/120+.000001){const n=Math.ceil(dt*120);for(let i=0;i<n;i++)update(dt/n,player,i===0?context:{...context,teleported:false});return;}
  started=true;elapsed+=dt;
  const snapshot=states.map(c=>({id:c.id,x:c.x,z:c.z,vx:c.vx,vz:c.vz,width:c.width,length:c.length}));
  for(const car of states)drive(car,dt,player,snapshot);
  for(let i=0;i<states.length;i++)for(let j=i+1;j<states.length;j++){
   const a=states[i],b=states[j];if(Math.hypot(a.x-b.x,a.z-b.z)>6)continue;
   const contact=resolveVehicleContacts(a,[b.collider],agentBuild(a),{dt,restitution:.06,friction:.24});
   if(contact.collided&&contact.maxClosingSpeed>2){stats.contacts++;a.hitHold=b.hitHold=.25;const damage=contact.contacts.reduce((s,c)=>s+(c.energyJ||0),0)/900000;a.health=clamp(a.health-damage,.35,1);b.health=clamp(b.health-damage,.35,1);}syncAgent(a);syncAgent(b);
  }
  for(const car of states)updateProgress(records.get(car.id),car,dt);
  updateProgress(records.get(playerId),player,dt,!!context.teleported);
  if(elapsed-lastRankTime>.25){lastRankTime=elapsed;const rank=standings().find(r=>r.isPlayer)?.position??lastPlayerPosition;if(elapsed>4&&rank<lastPlayerPosition){stats.overtakes++;emit('overtake',{position:rank,previousPosition:lastPlayerPosition});}lastPlayerPosition=rank;}
 }
 function standings(){
  const rows=[...records.values()].sort((a,b)=>a.finished&&b.finished?a.finishTime-b.finishTime:a.finished?-1:b.finished?1:b.progress-a.progress),leader=rows[0];
  return rows.map((r,i)=>({id:r.id,name:r.name,isPlayer:r.isPlayer,position:i+1,lap:Math.min(totalLaps,r.completedLaps+1),completedLaps:r.completedLaps,finished:r.finished,finishTime:r.finishTime,progress:r.progress/length,gapMetres:Math.max(0,(leader?.progress||0)-r.progress),gapSeconds:r.finished&&leader?.finished?r.finishTime-leader.finishTime:Math.max(0,(leader?.progress||0)-r.progress)/Math.max(12,r.speed,leader?.speed||0)}));
 }
 function getState(){const entries=standings(),player=entries.find(e=>e.isPlayer),r=records.get(playerId);return{started,finished:playerFinished||playerRetired,playerFinished,playerRetired,allFinished:entries.every(e=>e.finished),elapsed,laps:totalLaps,difficulty:DIFFICULTY[difficulty]?difficulty:'club',playerPosition:playerFinishPosition??player?.position??states.length+1,playerLap:player?.lap??1,completedLaps:r?.completedLaps??0,playerTime:r?.finishTime??elapsed,nextCheckpoint:r?.nextGate??0,wrongWay:(r?.wrongWayTime??0)>.45,checkpointMissed:!!r?.invalidMove,entries};}
 function getColliders(player,radius=45){if(disposed)return[];return states.filter(c=>Math.hypot(c.x-(player?.x||0),c.z-(player?.z||0))<radius).map(c=>{syncAgent(c);return c.collider;});}
 function onPlayerContact(contact){const car=states.find(c=>c.id===(contact?.collider?.npcId??contact?.npcId));if(!car)return;stats.contacts++;car.hitHold=Math.max(car.hitHold,.25);car.health=clamp(car.health-(contact.energyJ||0)/700000,.35,1);if((contact.closingSpeed||0)>3)car.horn=.18;syncAgent(car);}
 function getNearbyAudio(player){if(disposed)return[];return states.map(c=>({id:c.id,engineId:c.profile.engineId,x:c.x,z:c.z,vx:c.vx,vz:c.vz,heading:c.heading,distance:Math.hypot(c.x-(player?.x||0),c.z-(player?.z||0)),rpm:c.rpm,throttle:c.throttle,speed:c.speed,engineRunning:true,damage:1-c.health,horn:c.horn>0,siren:false,role:'racer'})).filter(c=>c.distance<160).sort((a,b)=>a.distance-b.distance);}
 function retirePlayer(){if(!playerFinished&&!playerRetired){playerRetired=true;emit('raceRetired',{elapsed});}return getState();}
 function dispose(){if(disposed)return;disposed=true;renderer.dispose();events.length=0;}
 reset();return{root:renderer.root,states,reset,getPlayerSpawn,getPlayerRecoveryPose,markPlayerReset,retirePlayer,update,render(alpha=1){renderer.render(alpha,elapsed);},setNight(value){renderer.setNight(value);},getColliders,onPlayerContact,getNearbyAudio,getState,consumeEvents(){return events.splice(0);},dispose,diagnostics(){return{...getState(),...stats,dynamic:true,teleportRecovery:false};}};
}
