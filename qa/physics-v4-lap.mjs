import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from '../dist/vendor/three.module.js';
import MotorLab from '../sdk/motor-engine.mjs';
import {createWorld} from '../dist/world.js';
import {CarPhysics} from '../dist/physics.js';
import {resolveVehicleContacts} from '../dist/contact.js';
globalThis.document = {createElement() {return {width:0,height:0,getContext(){return {fillRect(){},beginPath(){},arc(){},fill(){},fillText(){}}}};}};
const world=createWorld(new THREE.Scene()),physics=new CarPhysics(MotorLab),dt=1/120;
physics.setGroundSampler(world.getSurfaceAt);physics.reset(world.spawn.x,world.spawn.z,world.spawn.heading);physics.setTune('street');
let state=physics.state,runTime=0,nextCheckpoint=0,completedCheckpoints=0,lapArmed=false,finished=false,elapsed=0,collisionCount=0,outsideFrames=0;
let maxRoadDistance=0,maxSpeed=0,maxDriftAngle=0,previousProgress=.985,totalProgress=0;
const events=[],path=[]; const clamp=(x,a,b)=>Math.max(a,Math.min(b,x)),wrap=a=>Math.atan2(Math.sin(a),Math.cos(a));
function resolveCollisions(previousPosition){
 const hit=resolveVehicleContacts(state,world.colliders,physics.build,{dt,previousPosition});
 collisionCount+=hit.contacts.length;
 if(hit.collided){const sn=Math.sin(state.heading),cs=Math.cos(state.heading);state.speed=Math.hypot(state.vx,state.vz);state.forwardSpeed=state.vx*sn+state.vz*cs;state.lateralSpeed=state.vx*cs-state.vz*sn;}
 assert.ok(Math.abs(state.x)<=242&&Math.abs(state.z)<=211,'Outside game reset bounds');
}
const started=performance.now();
for(let frame=0;frame<120*150&&!finished;frame++){
 const road=world.getRoadInfo(state.x,state.z);
 const lookahead=8+state.speed*.5;
 const target=world.curve.getPointAt((road.progress+lookahead/world.length)%1);
 const alpha=wrap(Math.atan2(target.x-state.x,target.z-state.z)-state.heading);
 const steerAngle=Math.atan2(2*2.6*Math.sin(alpha),Math.hypot(target.x-state.x,target.z-state.z));
 const maxSteer=.57/(1+state.speed/24);
 const steer=clamp((steerAngle*1.3-state.driftAngle*.4)/maxSteer,-1,1);
 let curvature=0;
 for(const ahead of [0,12,24,36]){
  const t0=world.curve.getTangentAt((road.progress+ahead/world.length)%1),t1=world.curve.getTangentAt((road.progress+(ahead+8)/world.length)%1);
  curvature=Math.max(curvature,Math.abs(wrap(Math.atan2(t1.x,t1.z)-Math.atan2(t0.x,t0.z)))/8);
 }
 // The old driver forced at least70km/h even on17.6m bends (>2g).
 // Respect the measured curvature now that tyres share a physicalfrictionbudget.
 const targetSpeed=clamp(Math.sqrt(7.3/Math.max(.004,curvature)),10.0,27.77);
 const speedError=targetSpeed-state.speed;
 const throttle=clamp(.2+speedError*.2,0,1),brake=clamp(-speedError*.22,0,.7);
 const previousPosition={x:state.x,z:state.z,heading:state.heading};
 state=physics.update(dt,{throttle,brake,steer},world.getSurfaceAt(state.x,state.z));resolveCollisions(previousPosition);
 if(lapArmed)runTime+=dt;elapsed+=dt;
 const after=world.getRoadInfo(state.x,state.z);
 maxRoadDistance=Math.max(maxRoadDistance,after.distance);if(!after.onRoad)outsideFrames++;
 maxSpeed=Math.max(maxSpeed,state.speed);maxDriftAngle=Math.max(maxDriftAngle,Math.abs(state.driftAngle));
 let difference=after.progress-previousProgress;if(difference<-.5)difference++;if(difference>.5)difference--;totalProgress+=difference;previousProgress=after.progress;
 for(const [k,v]of Object.entries(state))if(typeof v==='number')assert.ok(Number.isFinite(v),k+' not finite');
 const cp=world.checkpoints[nextCheckpoint],dx=state.x-cp.x,dz=state.z-cp.z;
 const approach=state.vx*Math.sin(cp.heading)+state.vz*Math.cos(cp.heading);
 if(Math.hypot(dx,dz)<13&&approach>1){
  events.push({checkpoint:nextCheckpoint,elapsed:+elapsed.toFixed(3),kph:+(state.speed*3.6).toFixed(1),roadDistance:+after.distance.toFixed(3)});
  if(!lapArmed){lapArmed=true;runTime=0;nextCheckpoint=1;}
  else if(nextCheckpoint===0&&completedCheckpoints>=7){finished=true;}
  else{completedCheckpoints++;nextCheckpoint=(nextCheckpoint+1)%8;}
 }
 if(frame%30===0)path.push({t:+elapsed.toFixed(3),x:+state.x.toFixed(3),z:+state.z.toFixed(3),kph:+(state.speed*3.6).toFixed(2),roadDistance:+after.distance.toFixed(3),progress:+after.progress.toFixed(5)});
 if(frame%1200===1199)console.log('progress',elapsed.toFixed(1),after.progress.toFixed(3),'distance',after.distance.toFixed(2),'kph',(state.speed*3.6).toFixed(1),'checkpoint',nextCheckpoint);
}
const result={passed:finished&&collisionCount===0&&outsideFrames===0,finished,lapTimeSeconds:runTime,totalSimulationSeconds:elapsed,wallTimeSeconds:(performance.now()-started)/1000,trackLengthMeters:world.length,completedCheckpoints,checkpointOrder:events.map(x=>x.checkpoint),maxCenterlineDistanceMeters:maxRoadDistance,minimumAsphaltEdgeClearanceMeters:12-physics.build.vehicle.model.length*.5-maxRoadDistance,collisionModel:'model-sized capsule against rotated world colliders with swept movement',maxSpeedKph:maxSpeed*3.6,maxDriftAngleDegrees:maxDriftAngle*180/Math.PI,offroadFrames:outsideFrames,collisionCount,totalProgress,events,path};
fs.writeFileSync(new URL('./physics-v4-lap-results.json',import.meta.url),JSON.stringify(result,null,2));
console.log(JSON.stringify({...result,path:'Saved in qa/physics-v4-lap-results.json'},null,2));
assert.ok(finished,'Failed to finish lap');assert.equal(completedCheckpoints,7);assert.deepEqual(events.map(x=>x.checkpoint),[0,1,2,3,4,5,6,7,0]);assert.equal(collisionCount,0);assert.equal(outsideFrames,0);assert.ok(result.minimumAsphaltEdgeClearanceMeters>0,'Conservative full-body envelope left asphalt');
