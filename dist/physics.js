import {UNDERBODY_PARTS,underbodyLayout,underbodySupport,underbodyToe,damageUnderbody,stepUnderbody} from './underbody.js';
import {bodyLayout,panelCenter} from './body-layout.js';
import {toggleBodyPanel,stepBodyHinges,bodyMassProperties,openDoorContacts} from './body-hinges.js';
import {advanceDebris,advanceLooseWheel} from './panel-debris.js';
import {partPose} from './part-shapes.js';
import {wetTyreResponse} from './weather.js';
import {damageBrakeLine} from './brake-hydraulics.js';
import {tyreResponse,impactTyre} from './tyres.js';
import {bearingResponse,rackTarget,tieRodAngle,damageChassisCorner} from './chassis-damage.js';
import {steeringDemand,tyreGrip} from './chassis-setup.js';
import {aerodynamicForces} from './aerodynamics.js';
import {WheelHop} from './wheel-hop.js';
import {Drivetrain} from './drivetrain.js';
import {roadPlane,contactFrame} from './road-contact.js';
/* MotorLab owns the crank and combustion. This solver exchanges finite impulses
   with that same shaft, four rolling wheels, brakes and a spring/damper chassis.
   Audio may supply the sole engine stepper; never run two engine clocks. */
import {resolveBuild} from './catalog.js';
import {createVehicleCondition,snapshotVehicleCondition,FUEL_DENSITY_KG_PER_LITRE} from './vehicle-state.js';
import {damageExterior,exteriorLayout,EXTERIOR_PARTS} from './exterior-damage.js';
import {deformBody} from './body-damage.js';
import {MechanicalSystem} from './mechanical.js';
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const smooth=x=>(x=clamp(x,0,1),x*x*(3-2*x));
const mix=(a,b,t)=>a+(b-a)*t;
const TAU=Math.PI*2, G=9.81;
export class CarPhysics {
 constructor(MotorLab,build=resolveBuild()){
  this.MotorLab=MotorLab;this._advanceEngine=null;this._groundSampler=null;this._conditions=new Map();this.condition=null;this._debrisId=0;this.damageEnabled=true;this._mechanicalEvents=[];
  this.setBuild(build);
 }
 setEngineAdvance(fn){this._advanceEngine=typeof fn==='function'?fn:null;return this;}
 setGroundSampler(fn){this._groundSampler=typeof fn==='function'?fn:null;return this;}
 setDebrisColliders(fn){this._debrisColliders=typeof fn==='function'?fn:null;return this;}
 setDamageEnabled(enabled=true){this.damageEnabled=enabled!==false;return this;}
 setBuild(build){
  if(!build?.physics)build=resolveBuild(build);
  const old=this.state,options=build.physics;if(this.condition&&old)this.condition.boost=old.boost;
  this.condition=this._conditions.get(build.vehicle.id)||createVehicleCondition(build);this._conditions.set(build.vehicle.id,this.condition);
  if(this.engine)void this.engine.dispose();
  this.build=build;this._drive=new Drivetrain(options);this._hop=new WheelHop(build);
  this._mechanics=new MechanicalSystem(build,this.condition,event=>{this._mechanicalEvents.push(event);if(this._mechanicalEvents.length>64)this._mechanicalEvents.shift();});
  for(const key of ['mass','inertia','wheelRadius','wheelInertia','halfTrack','frontAxle','rearAxle','cgHeight','finalDrive','clutchCapacity','brakeTorque','brakeBias','muMultiplier','springRate','damperRate','antiRollRate','rideHeight','powerLock','coastLock','boostTarget','redlineRpm'])this[key]=options[key];
  this.suspensionTravel=options.suspensionTravel??.145;this.gears=[...options.gears];
  this._positions=[[-this.halfTrack,this.frontAxle],[this.halfTrack,this.frontAxle],[-this.halfTrack,-this.rearAxle],[this.halfTrack,-this.rearAxle]];
  this._pitchInertia=this.mass*(this.frontAxle+this.rearAxle)**2*.20;
  this._rollInertia=this.mass*(this.halfTrack*2)**2*.24;
  this._staticLoads=[0,0,0,0].map((_,i)=>this.mass*G*(i<2?this.rearAxle:this.frontAxle)/(2*(this.frontAxle+this.rearAxle)));
  this.engine=this.MotorLab.createEngine(options.engineOptions);this._baseLambda=this.engine.getState().controls.lambdaTarget;
  this.engine.start({starterSeconds:1});this.engine.setInputs({throttle:0,boostTarget:this.boostTarget});
  for(let i=0;i<72;i++)this.engineState=this.engine.update(1/60);
  this.engine.setInputs({starter:false});this._warmState=this.engine.save();
  this.reset(old?.x??0,old?.z??0,old?.heading??0);
  return this;
 }
 // Legacy integration hook: old handling names have no effect on physics.
 setTune(){return this;}
 _canWarmStart(){const e=this._mechanics.refreshEffects(0,0);return e.auxiliaries.canCrank&&e.fuelAvailable&&e.ignitionAvailable;}
 _ground(x,z,defaultGrip=1){
  const sample=this._groundSampler?.(x,z);
  const grip=clamp(typeof sample==='number'?defaultGrip:sample?.grip??defaultGrip,.2,1.5);
  return {wetness:clamp(Number.isFinite(sample?.wetness)?sample.wetness:0,0,1),waterDepth:clamp(Number.isFinite(sample?.waterDepth)?sample.waterDepth:0,0,8),height:typeof sample==='number'?sample:Number.isFinite(sample?.height)?sample.height:0,grip,
   material:typeof sample?.material==='string'?sample.material:grip<.8?'gravel':'asphalt',
   roughness:clamp(Number.isFinite(sample?.roughness)?sample.roughness:grip<.8?.025:.001,0,.2)};
 }
 _refreshBodyMass(){
  const m=bodyMassProperties(this.build,this.condition.bodyDamage,this.condition.wheelAttached);this.mass=m.mass;this.inertia=m.inertia;this.cgHeight=m.cgHeight;this._staticLoads=m.loads;
  this._pitchInertia=this.mass*(this.frontAxle+this.rearAxle)**2*.20;this._rollInertia=this.mass*(this.halfTrack*2)**2*.24;
  this._bodyMass=m;this.contactBuild={...this.build,physics:{...this.build.physics,mass:m.mass,inertia:m.inertia}};if(this.state)this.state.bodyMass=m;return m;
 }
 togglePanel(id){const ok=toggleBodyPanel(this.condition.bodyDamage,id,this.state.speed);if(ok){this._mechanics.publish(true);this._publishCondition();}return ok;}
 updateParkedPanels(dt,pose=this.state){
  const body=this.condition.bodyDamage,angles=Object.fromEntries(['left','right','hood','boot'].map(id=>[id,body.zones[id].angle]));
  // Garage inspection holds the car still. Only the actual panel angles move;
  // cached driving velocities and the paused chassis must remain untouched.
  const parked={...pose,vx:0,vz:0,yawRate:0,speed:0,forwardSpeed:0,accelerationLat:0,accelerationLong:0};
  stepBodyHinges(body,Math.min(.05,dt),parked,false);
  openDoorContacts(this.build,body,parked,this._debrisColliders,false,{angles,surface:(x,z)=>this._ground(x,z)});
 }
 _stepPanels(dt,previous,damage=this.damageEnabled){
  const body=this.condition.bodyDamage,s=this.state,angles=Object.fromEntries(['left','right','hood','boot'].map(id=>[id,body.zones[id].angle]));
  for(const panel of stepBodyHinges(body,dt,s,damage)){this._detachPanel(panel);this.condition.damageRevision++;this._mechanics.publish(true);}
  const hits=openDoorContacts(this.build,body,s,this._debrisColliders,damage,{previous,angles,surface:(x,z)=>this._ground(x,z),verticalVelocity:this._heaveVelocity});
  for(const hit of hits){
   this._heaveVelocity+=hit.verticalImpulse/this.mass;if(hit.detached)this._detachPanel(hit.id,hit);
   if(hit.damaged){this.condition.damageRevision++;this._mechanics.publish(true);}
   if(hit.closingSpeed>1){this._mechanicalEvents.push({type:'panelImpact',severity:'info',message:hit.detached?'Body panel torn off':'Open panel struck an obstacle',intensity:Math.min(1,hit.closingSpeed/15)});if(this._mechanicalEvents.length>64)this._mechanicalEvents.shift();}
  }
  if(hits.length){s.speed=Math.hypot(s.vx,s.vz);s.forwardSpeed=s.vx*Math.sin(s.heading)+s.vz*Math.cos(s.heading);s.lateralSpeed=s.vx*Math.cos(s.heading)-s.vz*Math.sin(s.heading);}
 }
 reset(x=0,z=0,heading=0,{neutral=false}={}){
  this._refreshBodyMass();
  if(this.state?.carId===this.condition.carId&&Number.isFinite(this.state.boost))this.condition.boost=this.state.boost;
  // PCM transport has no async device teardown; the SDK releases its clock
  // synchronously before returning the cleanup promise.
  if(this.engine.getTiming().clock!=='manual')void this.engine.disconnectAudio();
  this.engine.load(this._warmState);this.engineState=this.engine.getState();this._mechanics._lastSample={...this._mechanics._lastSample,starterRequested:false,starterTorque:this.engineState.config.starterTorque,starterNoLoadRpm:this.engineState.config.starterNoLoadRpm};
  this._omega=this.engineState.omega;this._wheelOmega=[0,0,0,0];this._drive.reset(this._wheelOmega);this._hop.reset();this._fuelMeter=this.engineState.totals?.fuelInjected??0;this._heatMeter={wall:this.engineState.totals?.wallHeat??0,friction:this.engineState.totals?.frictionWork??0,load:this.engineState.totals?.loadWork??0};
  if(this.condition.engineFault||this.condition.fuelLitres<=0||!this._canWarmStart()){this.engine.stop();this.engine.applyShaftImpulse(-this._omega*this.engineState.config.inertia);this.engineState=this.engine.getState();this._omega=0;}
  this._shift=this._reverseHold=this._shiftMessageTime=0;
  this._shiftUpHeld=this._shiftDownHeld=false;this._accelLong=this._accelLat=0;
  this._tc=1;this._autoEngagement=0;this._stallTime=0;this._stalled=!!this.condition.engineFault||this.condition.fuelLitres<=0||!this._canWarmStart();this._nitrousBlend=0;this._nitrousBlocked=false;this._nitrousCooldown=0;
  this._heaveVelocity=this._pitchVelocity=this._rollVelocity=0;
  this._brakePressures=[0,0,0,0];this._brakeTemps=this.condition.mechanical.temperatures.brakes;
  this._tyreTemps=this.condition.mechanical.temperatures.tyres;this._clutchTemp=this.condition.mechanical.temperatures.clutch;
  const sn=Math.sin(heading),cs=Math.cos(heading);
  const samples=this._positions.map(([u,v])=>this._ground(x+u*cs+v*sn,z-u*sn+v*cs));
  const plane=this._roadPlane=roadPlane(samples,this.frontAxle,this.rearAxle,this.halfTrack);
  this._tyreContact=this.condition.tyres.map((t,i)=>tyreResponse(t,this._tyreTemps[i]));this._tyreRadii=this._tyreContact.map(t=>this.wheelRadius*t.radiusScale);this._previousTyreRadii=[...this._tyreRadii];
  const stance=roadPlane(samples.map((s,i)=>({...s,height:s.height+this._tyreRadii[i]-this.wheelRadius})),this.frontAxle,this.rearAxle,this.halfTrack),ground=stance.height;
  this.state=Object.assign(this.state||{}, {x,z,heading,vx:0,vz:0,yawRate:0,speed:0,forwardSpeed:0,lateralSpeed:0,rpm:this.engineState.rpm,gear:neutral?0:1,
   throttle:0,brake:0,steer:0,driftAngle:0,drifting:false,boost:this.condition.boost,boosting:false,boostAvailable:true,nitrousIntensity:0,nitrousTorque:0,combustionTorque:this.engineState.meanTorque,wheelSpinL:0,wheelSpinR:0,wheelSpinFL:0,wheelSpinFR:0,
   wheelSlipL:0,wheelSlipR:0,differentialLock:this.coastLock,bodyHeight:ground,bodyRoll:stance.lateral,bodyPitch:-stance.longitudinal,groundHeight:plane.height,roadGradeLong:plane.longitudinal,roadGradeLat:plane.lateral,
   engineTorque:this.engineState.meanTorque,clutchTorque:0,tyreForceL:0,tyreForceR:0,surface:1,
   shiftProgress:0,engineClock:'manual',transmission:'auto',handbrake:0,clutch:1,manualClutch:false,requestedGear:neutral?0:1,shiftMessage:'',shiftRejected:false,
   engineRunning:!this._stalled,engineStalled:this._stalled,starterActive:false,clutchSlipRPM:0,inputShaftRpm:0,clutchTemperature:this._clutchTemp,
   wheelOmegas:[0,0,0,0],wheelOmega:[0,0,0,0],wheelSpins:[0,0,0,0],wheelSteers:[0,0,0,0],tieRodAngles:[0,0],wheelSlip:[0,0,0,0],wheelLoads:[...this._staticLoads],brakeTemps:this._brakeTemps,tyreTemps:this._tyreTemps,
   brakePressure:[0,0,0,0],absActive:false,burnout:false,burnoutIntensity:0,halfTrack:this.halfTrack,rearAxle:this.rearAxle,frontAxle:this.frontAxle,wheelRadius:this.wheelRadius,
   aero:{front:0,rear:0,downforce:0,drag:0,pitchMoment:0},wheelHop:this._hop.wheels,driveLayout:this.build.physics.driveLayout,drivenWheels:this._drive.driven,axleTorques:[0,0],centerSlipRPM:0,frontDifferentialLock:0,centerDifferentialLock:0,accelerationLong:0,accelerationLat:0,diffSlipRPM:0,diffTorque:0,diffPower:0,
   fuelFlowLph:0,fuelStarved:this.condition.fuelLitres<=0,overrev:0,damageMessage:'',bodyScrape:0,scrapeLoads:[0,0,0,0],detachedWheels:[],detachedPanels:[],glassShards:[],
   suspension:this._staticLoads.map((load,i)=>({compression:load/this.springRate,travel:0,load,normalLoad:load*plane.normalScale,groundHeight:samples[i].height,contact:true,wheelY:samples[i].height+this._tyreRadii[i],velocity:0,impactSpeed:0,impactCount:0})),
   wheelAudio:this._staticLoads.map(load=>({surface:'asphalt',roughness:.001,contact:true,load,longitudinalSpeed:0,lateralSpeed:0,slipSpeed:0,slipRatio:0,wheelSpeed:0,tyrePower:0,brakePower:0,suspensionVelocity:0,suspensionTravel:0,impactSpeed:0,impactCount:0}))});
  this._previousGround=this.state.suspension.map(p=>p.groundHeight);this._mechanics.observe(this.state.gear,this._omega);this._publishCondition();
  for(let i=0;i<4;i++)if(!this.condition.wheelAttached[i]||underbodySupport(this.condition.bodyDamage,i)===0){this.state.suspension[i].load=0;this.state.suspension[i].normalLoad=0;this.state.suspension[i].contact=false;this.state.wheelLoads[i]=0;this.state.wheelAudio[i].contact=false;this.state.wheelAudio[i].load=0;}
  return this.state;
 }
 /** A new run starts serviced; ordinary road recovery intentionally retains damage. */
 restart(x=0,z=0,heading=0,options={}){
  this.service({repair:true,refuel:true,refillNitrous:true});this.consumeMechanicalEvents();
  return this.reset(x,z,heading,options);
 }
 get _omegaL(){return this._wheelOmega[2];} set _omegaL(v){this._wheelOmega[2]=v;}
 get _omegaR(){return this._wheelOmega[3];} set _omegaR(v){this._wheelOmega[3]=v;}
 _ratio(gear){return(gear<0?-3.35:gear===0?0:this.gears[gear-1])*this.finalDrive;}
 _requestGear(gear,{v=0,speed=0,manualClutch=false,clutchPedal=0,report=true}={}){
  const s=this.state;if(!Number.isInteger(gear)||gear< -1||gear>this.gears.length)return false;if(gear===s.gear)return true;
  // The selector follows the player's request. A limiter cannot protect an
  // engine that the driven wheels mechanically turn beyond its safe speed.
  const before=this._ratio(s.gear),after=this._ratio(gear),wheel=this._drive.meanOmega(this._wheelOmega);
  const engaged=manualClutch?1-clutchPedal:0;
  this._mechanics.shift(before,after,wheel,engaged,gear,this.damageEnabled);
  s.gear=gear;s.requestedGear=gear;s.shiftMessage='';s.shiftRejected=false;this._shiftMessageTime=0;this._shift=gear===0?.08:.19;return true;
 }
 _publishCondition(){
  if(!this.state||!this.condition)return;
  const c=this.condition;this.state.tyres=c.tyres.map((t,i)=>tyreResponse(t,c.mechanical.temperatures.tyres[i],this.state.wheelSpins?.[i]||0));this.state.wheelRadii=this.state.tyres.map(t=>this.wheelRadius*t.radiusScale);Object.assign(this.state,{bodyMass:this._bodyMass,carId:c.carId,engineHealth:c.engineHealth,bodyHealth:c.bodyHealth,bodyDamage:c.bodyDamage,gearboxHealth:c.gearboxHealth,wheelHealth:c.wheelHealth,wheelAttached:c.wheelAttached,
   suspensionHealth:c.suspensionHealth,brakeHealth:c.brakeHealth,wheelToe:c.wheelToe,wheelCamber:c.suspensionHealth.map((health,i)=>(i%2?1:-1)*((1-health)*.14-this.build.physics.alignmentCamber[i<2?0:1])+bearingResponse(c.mechanical.chassisDamage.bearings[i],0,this.state.wheelSpins?.[i]||0,c.wheelAttached[i]).wobble+underbodyToe(c.bodyDamage,i)),damageEnabled:this.damageEnabled,
   fuelLitres:c.fuelLitres,fuelCapacity:c.fuelCapacity,fuelConsumedLitres:c.fuelConsumedLitres,fuelStarved:c.fuelLitres<=0,engineFault:c.engineFault,damageRevision:c.damageRevision,damageEnergyJ:c.damageEnergyJ,distanceMeters:c.distanceMeters,maxRpm:c.maxRpm,
   mechanical:this._mechanics.diagnostics,clutchTemperature:c.mechanical.temperatures.clutch,brakeTemps:c.mechanical.temperatures.brakes,tyreTemps:c.mechanical.temperatures.tyres});
 }
 consumeMechanicalEvents(){return this._mechanicalEvents.splice(0);}
 getMechanicalDiagnostics(){return this._mechanics.publish(true);}
 getCondition(){if(this.state)this.condition.boost=this.state.boost;return snapshotVehicleCondition(this.condition);}
 restoreCondition(saved){
  this.condition=createVehicleCondition(this.build,saved);this._conditions.set(this.build.vehicle.id,this.condition);
  this._mechanics=new MechanicalSystem(this.build,this.condition,event=>{this._mechanicalEvents.push(event);if(this._mechanicalEvents.length>64)this._mechanicalEvents.shift();});
  this._brakeTemps=this.condition.mechanical.temperatures.brakes;this._tyreTemps=this.condition.mechanical.temperatures.tyres;this._clutchTemp=this.condition.mechanical.temperatures.clutch;this._refreshBodyMass();this._publishCondition();
  this._mechanics._lastSample={...this._mechanics._lastSample,starterRequested:false,starterTorque:this.engineState.config.starterTorque,starterNoLoadRpm:this.engineState.config.starterNoLoadRpm};this.state.boost=this.condition.boost;const supplyFailure=!this._canWarmStart();if(this.condition.engineFault||this.condition.fuelLitres<=0||supplyFailure){this.engine.stop();this._stalled=true;this.state.engineRunning=false;this.state.engineStalled=true;if(this.condition.engineFault||supplyFailure){const crank=this.engine.getState();this.engine.applyShaftImpulse(-crank.omega*crank.config.inertia);this._omega=0;this.engineState=this.engine.getState();this.state.rpm=0;}}
  this._mechanics.observe(this.state.gear,this._omega,this.state.speed);this._publishCondition();return this.getCondition();
 }
 getPreviewCondition(build){return this._conditions.get(build.vehicle.id)||createVehicleCondition(build);}
 exportGarageState(){this.getCondition();return Object.fromEntries([...this._conditions].map(([id,c])=>[id,snapshotVehicleCondition(c)]));}
 restoreGarageState(saved={}){
  for(const [id,c] of Object.entries(saved||{}))if(c&&typeof c==='object'&&['hachi','atlas','kitsune','vector'].includes(id))this._conditions.set(id,createVehicleCondition(resolveBuild({carId:id}),c));
  this.condition=this._conditions.get(this.build.vehicle.id)||this.condition;this.restoreCondition(this.condition);return this.exportGarageState();
 }
 repair(){
  const fuel=this.condition.fuelLitres,boost=this.state.boost,old=this.state,revision=this.condition.damageRevision+1;
  this.condition=createVehicleCondition(this.build,{fuelLitres:fuel,boost,damageRevision:revision,fuelConsumedLitres:this.condition.fuelConsumedLitres,distanceMeters:this.condition.distanceMeters});
  this._mechanics=new MechanicalSystem(this.build,this.condition,event=>{this._mechanicalEvents.push(event);if(this._mechanicalEvents.length>64)this._mechanicalEvents.shift();});
  this._conditions.set(this.build.vehicle.id,this.condition);this.reset(old.x,old.z,old.heading,{neutral:old.transmission!=='auto'});this.state.damageMessage='Repairs complete';return {repaired:true,condition:this.getCondition()};
 }
 refuel(litres=Infinity){const available=this.condition.fuelCapacity-this.condition.fuelLitres,added=litres===Infinity?available:clamp(Number(litres)||0,0,available);this.condition.fuelLitres+=added;this._publishCondition();return added;}
 repairComponents(ids=[]){
  const wasFailed=!!this.condition.engineFault,repaired=this._mechanics.repair(ids);
  if(repaired.length){
   this._brakeTemps=this.condition.mechanical.temperatures.brakes;this._tyreTemps=this.condition.mechanical.temperatures.tyres;this._clutchTemp=this.condition.mechanical.temperatures.clutch;
   if(wasFailed&&!this.condition.engineFault&&this._canWarmStart()){if(this.engine.getTiming().clock!=='manual')void this.engine.disconnectAudio();this.engine.load(this._warmState);this.engineState=this.engine.getState();this._mechanics._lastSample={...this._mechanics._lastSample,starterRequested:false,starterTorque:this.engineState.config.starterTorque,starterNoLoadRpm:this.engineState.config.starterNoLoadRpm};this._omega=this.engineState.omega;this._stalled=false;this._stallTime=0;this._fuelMeter=this.engineState.totals?.fuelInjected??0;this._heatMeter={wall:this.engineState.totals?.wallHeat??0,friction:this.engineState.totals?.frictionWork??0,load:this.engineState.totals?.loadWork??0};this.state.engineRunning=this.condition.fuelLitres>0;this.state.engineStalled=false;this.state.rpm=this.engineState.rpm;}
   for(let i=0;i<4;i++)if(repaired.includes('tyre'+['FL','FR','RL','RR'][i])){this._previousTyreRadii[i]=this.wheelRadius;this.state.suspension[i].wheelY=this.state.suspension[i].groundHeight+this.wheelRadius;}
   this.state.detachedWheels=this.state.detachedWheels.filter(w=>!this.condition.wheelAttached[w.index]);this.state.detachedPanels=this.state.detachedPanels.filter(p=>p.panel.startsWith('underbody:')?this.condition.bodyDamage.underbody[p.panel.slice(10)]?.detached:p.panel.startsWith('exterior:')?this.condition.bodyDamage.exterior[p.panel.slice(9)]?.detached:this.condition.bodyDamage.zones[p.panel]?.detached);this._refreshBodyMass();this.state.damageMessage='Repairs complete';this._mechanics.observe(this.state.gear,this._omega,this.state.speed);this._publishCondition();
  }
  return {repaired:repaired.length>0,components:repaired,condition:this.getCondition()};
 }
 service({repair=false,refuel=false,refillNitrous=false}={}){const result={repaired:false,fuelAdded:0,nitrousAdded:0};if(repair)result.repaired=this.repair().repaired;if(refuel)result.fuelAdded=this.refuel();if(refillNitrous){result.nitrousAdded=1-this.state.boost;this.state.boost=this.condition.boost=1;}result.condition=this.getCondition();return result;}
 applyImpact(contact={}){
  if(!this.damageEnabled)return {damage:0,detached:[]};
  const s=this.state,c=this.condition,closing=Math.max(0,Number(contact.closingSpeed)||0),impulse=Math.max(0,Number(contact.impulse)||0);
  if(closing<2.2||impulse<150)return {damage:0,detached:[]};
  const attachedBefore=[...c.wheelAttached];
  const energy=Math.max(0,Number(contact.energyJ)||impulse*closing*.5),severity=energy/(this.mass*180),damage=clamp(severity*.25/(this.build.physics.bodyStrength??1),0,.9);
  const point=contact.point||s,dx=point.x-s.x,dz=point.z-s.z,sn=Math.sin(s.heading),cs=Math.cos(s.heading);
  const local=contact.localPoint||{x:dx*cs-dz*sn,z:dx*sn+dz*cs};
  c.bodyHealth=Math.max(0,c.bodyHealth-damage);c.damageEnergyJ+=energy;c.damageRevision++;
  const bodyHit=deformBody(c.bodyDamage,this.build,{local,energyJ:energy,closingSpeed:closing});
  for(const panel of bodyHit.detached)this._detachPanel(panel,contact);
  const exteriorHit=damageExterior(c.bodyDamage,this.build,{local,energyJ:energy,closingSpeed:closing});
  for(const id of exteriorHit.detached)if(EXTERIOR_PARTS[id].kind!=='glass')this._detachPanel('exterior:'+id,contact);
  for(const id of exteriorHit.brokenGlass)this._shatterGlass(id,contact);
  if(exteriorHit.changed)this._refreshBodyMass();
  const underHit=damageUnderbody(c.bodyDamage,this.build,{local,energyJ:energy,closingSpeed:closing});this._releaseUnderbody(underHit,contact);
  s.lastImpactLocal={...local};
  const front=clamp((local.z+this.rearAxle)/(this.frontAxle+this.rearAxle),0,1);
  this._mechanics.impact({damage,front,local,closing,severity});s.damageMessage='Body damage';
  const nearest=this._positions.map(([x,z],index)=>({index,distance:Math.hypot(local.x-x,local.z-z)})).sort((a,b)=>a.distance-b.distance)[0];
  if(nearest.distance<1.4&&Math.abs(local.x)>.28){
   const i=nearest.index,wheelDamage=clamp(severity*.65/(this.build.physics.bodyStrength??1)*(1-nearest.distance/2.1),0,1);c.wheelHealth[i]=Math.max(0,c.wheelHealth[i]-wheelDamage);impactTyre(c.tyres[i],wheelDamage);damageBrakeLine(c.mechanical.brakeHydraulics,i,wheelDamage);
   const bend=Math.sign((contact.normal?.x||0)*cs-(contact.normal?.z||0)*sn)||Math.sign(local.x)||1;
   c.suspensionHealth[i]=Math.max(0,c.suspensionHealth[i]-wheelDamage*.86);c.brakeHealth[i]=Math.max(0,c.brakeHealth[i]-wheelDamage*.52);
   damageChassisCorner(c.mechanical.chassisDamage,i,wheelDamage,bend);c.mechanical.brakeHydraulics.absValves[i]=clamp(c.mechanical.brakeHydraulics.absValves[i]-Math.max(0,wheelDamage-.2)*1.5,0,1);
   c.wheelToe[i]=clamp(c.wheelToe[i]+bend*wheelDamage*.13,-.16,.16);if(wheelDamage>.08)s.damageMessage='Wheel alignment damaged';
   if(c.wheelAttached[i]&&closing>13&&(wheelDamage>.48||c.wheelHealth[i]<.22)){this._detachWheel(i,contact);s.damageMessage='Wheel detached';}
  }
  if(c.engineHealth<=.025){c.engineHealth=0;c.engineFault='Impact damage';this._stalled=true;this.engine.stop();s.damageMessage='Engine failure';}
  this._mechanics.publish(true);this._publishCondition();return {damage,detached:attachedBefore.flatMap((attached,i)=>attached&&!c.wheelAttached[i]?[i]:[]),panels:bodyHit.detached,exterior:exteriorHit.detached,brokenGlass:exteriorHit.brokenGlass,underbody:underHit.detached,energyJ:energy};
 }
 _releaseUnderbody(hit,contact={}){
  const c=this.condition,s=this.state;
  for(const id of hit.detached){const d=UNDERBODY_PARTS[id];if(d.kind==='rod'){c.mechanical.chassisDamage.tieRods[d.corner].health=0;}if(d.kind==='arm'&&c.wheelAttached[d.corner])this._detachWheel(d.corner,{closingSpeed:s.speed||0,...contact});this._detachPanel('underbody:'+id,contact);if(id==='exhaustRear'&&!c.bodyDamage.exterior.exhaustTip.detached){c.bodyDamage.exterior.exhaustTip.detached=true;this._detachPanel('exterior:exhaustTip',contact);}this._mechanicalEvents.push({type:'panelImpact',severity:'warning',message:d.label+' detached',intensity:.65});if(this._mechanicalEvents.length>64)this._mechanicalEvents.shift();}
  if(hit.changed){c.damageRevision++;this._refreshBodyMass();this._mechanics.refreshEffects(s.gear,this._omega);this._mechanics.publish(true);}
 }
 _detachWheel(index,contact){
  const s=this.state,c=this.condition,[x,z]=this._positions[index],sn=Math.sin(s.heading),cs=Math.cos(s.heading),normal=contact.normal||{x:0,z:0};
  c.wheelAttached[index]=false;damageChassisCorner(c.mechanical.chassisDamage,index,0,1,true);c.mechanical.brakeHydraulics.absValves[index]=0;damageBrakeLine(c.mechanical.brakeHydraulics,index,0,true);c.wheelHealth[index]=0;
  const lateral=s.yawRate*z,longitudinal=-s.yawRate*x;
  s.detachedWheels.push({id:++this._debrisId,index,x:s.x+x*cs+z*sn,z:s.z-x*sn+z*cs,y:s.suspension[index].wheelY,
   vx:s.vx+lateral*cs+longitudinal*sn+normal.x*Math.min(5,contact.closingSpeed*.12),vz:s.vz-lateral*sn+longitudinal*cs+normal.z*Math.min(5,contact.closingSpeed*.12),vy:Math.min(4,1+contact.closingSpeed*.05),heading:s.heading,omega:this._wheelOmega[index],spin:s.wheelSpins[index],age:0,radius:this.wheelRadius,width:this.build.physics.tyreWidth,lean:0,leanVelocity:0,contacts:0});
  if(s.detachedWheels.length>8)s.detachedWheels.shift();this._refreshBodyMass();
  s.suspension[index].contact=false;s.suspension[index].load=0;s.wheelLoads[index]=0;s.wheelAudio[index].contact=false;s.wheelAudio[index].load=0;
 }
 _detachPanel(panel,contact={}){
  const s=this.state,layout=bodyLayout(this.build),external=panel.startsWith('exterior:'),part=panel.startsWith('underbody:')?underbodyLayout(this.build)[panel.slice(10)]:external?exteriorLayout(this.build)[panel.slice(9)]:layout.parts[panel];if(!part)return;
  const hinge=part.parent&&layout.parts[part.parent];if(hinge?.pivot){Object.assign(part,{pivot:hinge.pivot,axis:hinge.axis,sign:hinge.sign});}
  const pose=partPose(this.build,panel,this.condition.bodyDamage,s),sn=Math.sin(s.heading),cs=Math.cos(s.heading),normal=contact.normal||{x:0,z:0};
  const [x,,z]=part.center;
  const kick=Math.min(3,(contact.closingSpeed||s.speed)*.09),rot=this.condition.bodyDamage.zones[panel]?.angle||0;
  s.detachedPanels.push({id:++this._debrisId,panel,x:pose.center[0],z:pose.center[2],y:pose.center[1],axes:pose.axes,half:[...pose.half],angularVelocity:[(x<0?-1:1)*(1+kick),s.yawRate||0,.35*(1+kick)],
   vx:s.vx+s.yawRate*z*cs+normal.x*kick,vz:s.vz-s.yawRate*x*cs+normal.z*kick,vy:.7+kick*.2,heading:s.heading,rotation:0,spin:(x<0?-1:1)*(1+kick),age:0,radius:part.radius,floorOffset:.10,mass:part.mass,opening:rot,contacts:0});
  if(s.detachedPanels.length>8)s.detachedPanels.shift();this._refreshBodyMass();
 }
 _shatterGlass(id,contact={}){
  const s=this.state,part=exteriorLayout(this.build)[id],parent=bodyLayout(this.build).parts[part.parent];
  if(parent?.pivot)Object.assign(part,{pivot:parent.pivot,axis:parent.axis,sign:parent.sign});
  const [x,y,z]=panelCenter(part,this.condition.bodyDamage.zones[part.parent]?.angle),sn=Math.sin(s.heading),cs=Math.cos(s.heading),normal=contact.normal||{x:0,z:0};
  for(let i=0;i<6;i++){const a=i*2.399,spread=.10+(i%3)*.06;s.glassShards.push({id:++this._debrisId,x:s.x+x*cs+z*sn+Math.cos(a)*spread,z:s.z-x*sn+z*cs+Math.sin(a)*spread,y:(s.bodyHeight||0)+this.rideHeight+y, vx:s.vx+normal.x*1.5+Math.cos(a)*2,vz:s.vz+normal.z*1.5+Math.sin(a)*2,vy:1+(i%3)*.45,spin:3+i*.4,rotation:a,heading:s.heading+a,age:0,radius:.035,floorOffset:.025,contacts:0,size:.09+(i%3)*.03});}
  if(s.glassShards.length>24)s.glassShards.splice(0,s.glassShards.length-24);
 }
 _updateDebris(dt){
  const s=this.state;
  for(const shard of s.glassShards)advanceDebris(shard,dt,(x,z)=>this._ground(x,z),this._debrisColliders);
  s.glassShards=s.glassShards.filter(p=>p.age<8&&Math.hypot(p.x-s.x,p.z-s.z)<100);
  for(const panel of s.detachedPanels)advanceDebris(panel,dt,(x,z)=>this._ground(x,z),this._debrisColliders);
  s.detachedPanels=s.detachedPanels.filter(p=>p.age<24&&Math.hypot(p.x-s.x,p.z-s.z)<180);
  for(const wheel of s.detachedWheels)advanceLooseWheel(wheel,dt,(x,z)=>this._ground(x,z),this._debrisColliders);
  s.detachedWheels=s.detachedWheels.filter(w=>w.age<24&&Math.hypot(w.x-s.x,w.z-s.z)<180);
 }
 _updateCondition(dt,omega,work={}){
  const c=this.condition,s=this.state,rpm=Math.abs(omega)*60/TAU;c.maxRpm=Math.max(c.maxRpm,rpm);c.distanceMeters+=s.speed*dt;
  const excess=Math.max(0,rpm/this.redlineRpm-1.025),backwards=omega< -25?Math.min(1,Math.abs(omega)/800):0;
  s.overrev=excess;
  const total=this.engineState.totals?.fuelInjected??this._fuelMeter,kg=Math.max(0,total-this._fuelMeter);this._fuelMeter=total;
  const nativeLitres=kg/FUEL_DENSITY_KG_PER_LITRE;
  // The explicit shaft-power NOS adapter needs additional fuel. Its demand is
  // accounted separately from the SDK's actual injected fuel mass.
  const nosLitres=s.nitrousTorque*Math.max(0,omega)*dt/(.27*44e6*FUEL_DENSITY_KG_PER_LITRE);
  const used=Math.min(c.fuelLitres,Math.max(0,nativeLitres+nosLitres));c.fuelLitres=Math.max(0,c.fuelLitres-used);c.fuelConsumedLitres+=used;
  s.fuelFlowLph+=(used/dt*3600-s.fuelFlowLph)*(1-Math.exp(-dt*4));
  const wall=this.engineState.totals?.wallHeat??this._heatMeter.wall,friction=this.engineState.totals?.frictionWork??this._heatMeter.friction,load=this.engineState.totals?.loadWork??this._heatMeter.load;
  this._mechanics.step(dt,{omega,speed:s.speed,lateralAcceleration:s.accelerationLat,gear:s.gear,ratio:this._ratio(s.gear),clutchTorque:s.clutchTorque,
   wallHeatJ:Math.max(0,wall-this._heatMeter.wall),frictionJ:Math.max(0,friction-this._heatMeter.friction),// Generator work powers electrics and heats the alternator, not engine oil.
   extraFrictionJ:Math.max(0,load-this._heatMeter.load)*(1-(this._auxLoadFraction||0)),
   nosHeatJ:nosLitres*FUEL_DENSITY_KG_PER_LITRE*44e6*.22,exhaustC:(this.engineState.exhaust?.T??297.15)-273.15,exhaustFlow:this.engineState.flows?.turbine??0,turboRpm:this.engineState.boost?.rpm??0,...work},this.damageEnabled);
  this._heatMeter={wall,friction,load};this._clutchTemp=c.mechanical.temperatures.clutch;
  if(c.engineFault){this._stalled=true;this.engine.stop();s.engineRunning=false;s.engineStalled=true;s.damageMessage=c.engineFault;}
  if(c.fuelLitres<=0){this._stalled=true;this.engine.stop();s.engineRunning=false;s.engineStalled=true;s.damageMessage='Fuel tank empty';s.nitrousTorque=0;}
 }
 _suspension(dt,road){
  const s=this.state,sn=Math.sin(s.heading),cs=Math.cos(s.heading),travel=this.suspensionTravel;
  const deflections=[],velocities=[],samples=[];this._tyreContact=this.condition.tyres.map((t,i)=>tyreResponse(t,this._tyreTemps[i],s.wheelSpins[i]));this._tyreRadii=this._tyreContact.map(t=>this.wheelRadius*t.radiusScale);
  for(let i=0;i<4;i++){
   const [x,z]=this._positions[i],p=this._ground(s.x+x*cs+z*sn,s.z-x*sn+z*cs,road);
   const corner=s.bodyHeight-s.bodyPitch*z+s.bodyRoll*x;
   deflections[i]=p.height-corner+this._tyreRadii[i]-this.wheelRadius;
   const groundVelocity=clamp((p.height-this._previousGround[i])/dt,-8,8);
   velocities[i]=groundVelocity+clamp((this._tyreRadii[i]-this._previousTyreRadii[i])/dt,-3,3)-this._heaveVelocity+this._pitchVelocity*z-this._rollVelocity*x;this._previousTyreRadii[i]=this._tyreRadii[i];
   this._previousGround[i]=p.height;samples[i]=p;
  }
  const plane=this._roadPlane=roadPlane(samples,this.frontAxle,this.rearAxle,this.halfTrack);
  s.roadGradeLong=plane.longitudinal;s.roadGradeLat=plane.lateral;
  let total=0,pitchMoment=0,rollMoment=0;
  const aero=s.aero=aerodynamicForces(this.build,this.condition,s.speed,s.forwardSpeed,s.lateralSpeed);
  this._hop.advance(dt,this.condition.suspensionHealth,this.condition.wheelAttached);
  for(let i=0;i<4;i++){
   const [x,z]=this._positions[i],load0=this._staticLoads[i],d=deflections[i],opposite=i^1,health=this.condition.suspensionHealth[i],support=underbodySupport(this.condition.bodyDamage,i),cornerTravel=travel*(.5+.5*health),spring=this.springRate*(.4+.6*health);
   const antiroll=(d-deflections[opposite])*this.antiRollRate*(i<2?this.build.physics.frontRollFactor:this.build.physics.rearRollFactor)*(.45+.55*health);
   const bump=Math.max(0,d-cornerTravel*.85)*this.springRate*7;
   const raw=load0*(.65+.35*health)+d*spring+velocities[i]*this.damperRate*(.12+.88*health)+antiroll+bump;
   const attached=this.condition.wheelAttached[i],supported=attached&&support>0&&d>=-cornerTravel,hop=this._hop.contact(i,clamp(raw*support,0,load0*5.5)),load=supported?hop.load:0;
   const corner=s.bodyHeight-s.bodyPitch*z+s.bodyRoll*x;
   const skidDepth=(!attached||support===0)?Math.max(0,samples[i].height-corner-.19):0;
   const skid=skidDepth>0?clamp(skidDepth*this.springRate*4+Math.max(0,velocities[i])*this.damperRate*.8,0,load0*7):0;
   s.scrapeLoads[i]=skid;total+=load+skid;pitchMoment-=(load+skid)*z;rollMoment+=(load+skid)*x;
   const suspension=s.suspension[i],contact=load>1&&d>= -cornerTravel;
   // A brief acoustic envelope records actual recontact or a compression
   // shock; static vehicle weight never creates a perpetual impact sound.
   const contactVelocity=velocities[i]-(supported?hop.velocity:0);
   const shock=contact&&contactVelocity>.45&&(!suspension.contact||contactVelocity>(suspension.velocity??0)+.8)?contactVelocity:0;
   Object.assign(suspension,{compression:Math.max(0,load0/spring+d),travel:clamp(d,-cornerTravel,cornerTravel),load,normalLoad:load*plane.normalScale,groundHeight:samples[i].height,grip:samples[i].grip,health,travelLimit:cornerTravel,
    material:samples[i].material,wetness:samples[i].wetness,waterDepth:samples[i].waterDepth,roughness:samples[i].roughness,velocity:contactVelocity,hopTravel:hop.travel,impactSpeed:Math.max(shock,(suspension.impactSpeed??0)*Math.exp(-dt*18)),impactCount:(suspension.impactCount??0)+(shock>.45?1:0),
    contact,wheelY:Math.max(samples[i].height+this._tyreRadii[i]+(supported?hop.gap:0),corner+this.wheelRadius-cornerTravel)});
   s.wheelLoads[i]=load;
  }
  this._heaveVelocity+=(total-this.mass*G-aero.downforce)/this.mass*dt;
  this._pitchVelocity+=(pitchMoment+aero.pitchMoment-this._accelLong*this.mass*this.cgHeight)/this._pitchInertia*dt;
  this._rollVelocity+=(rollMoment+this._accelLat*this.mass*this.cgHeight)/this._rollInertia*dt;
  // End stops limit suspension attitude relative to the road, not the horizon.
  const relativePitch=s.bodyPitch+plane.longitudinal,relativeRoll=s.bodyRoll-plane.lateral;
  if(total>1){
   this._pitchVelocity-=Math.sign(relativePitch)*Math.max(0,Math.abs(relativePitch)-.24)*dt*80;
   this._rollVelocity-=Math.sign(relativeRoll)*Math.max(0,Math.abs(relativeRoll)-.28)*dt*90;
  }
  this._pitchVelocity*=Math.exp(-dt*.6);this._rollVelocity*=Math.exp(-dt*.6);
  s.bodyHeight+=this._heaveVelocity*dt;s.bodyPitch+=this._pitchVelocity*dt;s.bodyRoll+=this._rollVelocity*dt;
  s.groundHeight=plane.height;
 }
 update(dt,input={},surface=1){
  dt=clamp(Number.isFinite(dt)?dt:0,0,1/30);if(!dt)return this.state;
  // Substep coarse callers as well as the game's fixed 120 Hz loop.
  if(dt>1/120+1e-9){const n=Math.ceil(dt*120);for(let i=0;i<n;i++)this.update(dt/n,input,surface);return this.state;}
  const s=this.state,previousPanelPose={x:s.x,z:s.z,heading:s.heading},sn=Math.sin(s.heading),cs=Math.cos(s.heading),assists=input.assists!==false;
  let v=s.vx*sn+s.vz*cs,u=s.vx*cs-s.vz*sn,speed=Math.hypot(v,u);
  let pedal=clamp(input.throttle||0,0,1),brake=clamp(input.brake||0,0,1);
  const steerInput=clamp(input.steer||0,-1,1),handbrake=clamp(Number(input.handbrake)||0,0,1);
  const transmission=['auto','sequential','hpattern'].includes(input.transmission)?input.transmission:'auto';
  const manualClutch=transmission!=='auto'&&!!input.manualClutch,clutchPedal=manualClutch?clamp(input.clutch||0,0,1):0;
  const road=clamp(typeof surface==='number'?surface:surface.grip??1,.2,1.5);
  Object.assign(s,{surface:road,transmission,manualClutch,handbrake});
  this._shift=Math.max(0,this._shift-dt);this._shiftMessageTime=Math.max(0,this._shiftMessageTime-dt);
  if(!this._shiftMessageTime){s.shiftMessage='';s.shiftRejected=false;}
  const up=!!input.shiftUp&&!this._shiftUpHeld,down=!!input.shiftDown&&!this._shiftDownHeld;
  this._shiftUpHeld=!!input.shiftUp;this._shiftDownHeld=!!input.shiftDown;
  const context={v,speed,manualClutch,clutchPedal};
  if(transmission!=='auto'){
   if(input.gearRequest!==undefined)this._requestGear(input.gearRequest,context);
   else if(transmission==='sequential'&&up!==down)this._requestGear(clamp(s.gear+(up?1:-1),-1,this.gears.length),context);
  }
  if(transmission==='auto'){
   if(s.gear>=0){
    this._reverseHold=brake>.4&&pedal<.1&&Math.abs(v)<.8&&speed<1.6?this._reverseHold+dt:0;
    if(this._reverseHold>.28){this._requestGear(-1,{...context,report:false});this._reverseHold=0;}
    else if(s.gear===0&&pedal>.1){let g=1;while(g<this.gears.length&&Math.abs(v)/this.wheelRadius*Math.abs(this._ratio(g))*60/TAU>this.redlineRpm*.88)g++;this._requestGear(g,{...context,report:false});}
   }else if(pedal>.1&&v> -.8)this._requestGear(1,{...context,report:false});
   if(s.gear===-1){const p=pedal;pedal=brake;brake=p;}
  }
  const rpm=Math.max(0,this._omega*60/TAU);
  if(transmission==='auto'&&s.gear>0&&this._shift===0){
   const roadRpm=Math.abs(v)/this.wheelRadius*this._ratio(s.gear)*60/TAU;
   if(rpm>this.redlineRpm*.93&&roadRpm>this.redlineRpm*.73&&s.gear<this.gears.length&&Math.abs(v)>9&&!handbrake)this._requestGear(s.gear+1,{...context,report:false});
   else if(rpm<this.redlineRpm*.33&&s.gear>1)this._requestGear(s.gear-1,{...context,report:false});
  }
  const ratio=this._ratio(s.gear),steering=steeringDemand(steerInput,speed,this.build.physics,input.deviceKind);
  const steerRate=(Math.abs(steerInput)<.01?steering.returnRate:steering.rate)*15.5/this.build.physics.steeringRatio;
  const chassisDamage=this.condition.mechanical.chassisDamage;
  s.steer+=(rackTarget(steering.target,s.steer,chassisDamage.rack)-s.steer)*(1-Math.exp(-dt*steerRate*(.18+.82*chassisDamage.rack)));
  // NOS is a declared arcade shaft-power adapter, not simulated nitrous
  // chemistry. The valve has no speed, gear, brake, clutch or RPM interlock.
  const requestedBoost=!!input.boost&&s.boost>0;
  this._nitrousBlend+=(Number(requestedBoost)-this._nitrousBlend)*(1-Math.exp(-dt*(requestedBoost?12:22)));
  const litres=(this.build.engine.displacementCc||3000)/1000,nosPower=45000+litres*9000,nosTorqueLimit=65+litres*35;
  const combustionReady=!this._stalled&&!this.condition.engineFault&&this.condition.fuelLitres>0&&this.engineState.controls?.ignition!==false&&!this.engineState.revCut&&this._omega>0;
  s.nitrousTorque=requestedBoost&&combustionReady?Math.min(nosTorqueLimit,nosPower/Math.max(120,this._omega))*this._nitrousBlend:0;
  s.nitrousIntensity=requestedBoost?this._nitrousBlend:0;s.boosting=requestedBoost;
  if(requestedBoost){s.boost=Math.max(0,s.boost-dt*.18);this._nitrousCooldown=1.1;}
  else{this._nitrousCooldown=Math.max(0,this._nitrousCooldown-dt);if(!input.boost&&this._nitrousCooldown===0&&speed>4)s.boost=clamp(s.boost+dt*(s.drifting?.10:.035),0,1);}
  this.condition.boost=s.boost;
  const tyreSlip=Math.max(...this._drive.driven.map(i=>Math.abs(s.wheelSlip[i])));
  // Simultaneous service brake and throttle is a deliberate left-foot/burnout
  // manoeuvre; traction control yields, but no grip or power is invented.
  const tcTarget=!assists||brake>.1?1:clamp(1-Math.max(0,tyreSlip-.17)*this.build.physics.tractionControl*1.5,.25,1);
  this._tc+=(tcTarget-this._tc)*Math.min(1,dt*9);
  s.throttle+=(pedal*this._tc-s.throttle)*Math.min(1,dt*15);s.brake=brake;
  const restartRequested=!!input.starter&&!this.condition.engineFault&&(!manualClutch||ratio===0||clutchPedal>.65);
  this._mechanics._lastSample={...this._mechanics._lastSample,headlights:!!input.headlights,starterRequested:restartRequested,starterTorque:this.engineState.config.starterTorque,starterNoLoadRpm:this.engineState.config.starterNoLoadRpm};
  const mechanical=this._mechanics.refreshEffects(s.gear,this._omega),aux=mechanical.auxiliaries,starter=aux.starterActive,supplyReady=aux.ignition&&mechanical.fuelAvailable&&mechanical.ignitionAvailable;
  const damageDrag=mechanical.loadTorqueNm+aux.loadTorque+aux.starterDrag;this._auxLoadFraction=damageDrag>0?(aux.loadTorque+aux.starterDrag+mechanical.exhaustLoadNm)/damageDrag:0;
  if(!supplyReady)this._stalled=true;
  // Re-enabling ignition can catch a crank still coasting after starvation;
  // the starter motor itself does not engage above its safe cranking speed.
  if(supplyReady&&restartRequested&&(this.condition.fuelLitres>0||starter))this._stalled=false;
  // Bump-starting is possible when the driven wheels turn an otherwise stalled
  // crank fast enough. No RPM assignment or artificial restart torque is used.
  if(supplyReady&&this._stalled&&rpm>400&&ratio!==0&&!this.condition.engineFault&&this.condition.fuelLitres>0)this._stalled=false;
  const canFire=supplyReady&&!this._stalled&&!this.condition.engineFault&&this.condition.fuelLitres>0;
  if(!canFire){s.nitrousTorque=0;s.nitrousIntensity=0;s.boosting=false;}
  const misfire=mechanical.misfire,cycle=Math.floor((this.engineState.angle||0)/(TAU*2));
  const cylinders=this.engineState.controls.cylinders.map((_,i)=>((cycle+i*7)%19+19)%19>=misfire*19);
  this.engine.setInputs({throttle:clamp(s.throttle,0,1)*mechanical.intakeFactor,lambdaTarget:clamp(this._baseLambda+mechanical.lambdaOffset,.6,1.8),externalTorqueNm:s.nitrousTorque,loadNm:damageDrag,boostTarget:this.boostTarget*mechanical.boostFactor,
   fuel:canFire,ignition:canFire&&this._shift<=.09,starter,cylinders});
  this.engineState=this._advanceEngine?this._advanceEngine(this.engine,dt):this.engine.update(dt);
  this._omega=this.engineState.omega;
  const engineInertia=this.engineState.config.inertia;
  let engagement;
  if(manualClutch){engagement=smooth((1-clutchPedal-.06)/.88);this._autoEngagement=engagement;}
  else{
   if(pedal<.06&&speed<2.2||s.gear===0||starter)this._autoEngagement=Math.max(0,this._autoEngagement-dt*7);
   else if(pedal>.08){
    const bite=smooth((rpm-(this.engineState.config.idleRpm??900)+100)/1100);
    // The automatic foot finishes releasing the pedal after biting. It does
    // not hold a permanent anti-stall slip against the parking brake.
    this._autoEngagement=Math.min(1,this._autoEngagement+dt*(bite>this._autoEngagement?2.5:.65));
   }else if(speed>3)this._autoEngagement=Math.min(1,this._autoEngagement+dt*4);
   engagement=this._autoEngagement;
  }
  if(this._shift>.08&&!manualClutch)engagement*=.08;
  if(!ratio)engagement=0;
  const capacity=this.clutchCapacity*engagement*mechanical.clutchCapacityFactor*mechanical.driveCapacityFactor;
  s.clutch=1-engagement;s.starterActive=starter;
  this._suspension(dt,road);
  const oldV=v,oldU=u;
  const normalLoad=s.wheelLoads.reduce((sum,load)=>sum+load,0);
  const contactFraction=clamp(normalLoad/(this.mass*G),0,1);
  const supportLoad=normalLoad+s.scrapeLoads.reduce((sum,load)=>sum+load,0);
  const plane=this._roadPlane,grounded=supportLoad>1;
  const gradeLong=grounded?plane.longitudinal:0,gradeLat=grounded?plane.lateral:0;
  // The spring support is the vertical component of the road normal. Its
  // horizontal reaction produces downhill motion; vertical gravity is already
  // integrated by suspension. No support means no lateral terrain force.
  const gravityLong=-gradeLong*supportLoad/this.mass,gravityLat=-gradeLat*supportLoad/this.mass;
  v+=gravityLong*dt;u+=gravityLat*dt;
  const rollingLoad=s.suspension.reduce((sum,p)=>sum+p.load*(.014+Math.max(0,1-p.grip)*.08),0);
  const rolling=Math.tanh(v*8)*rollingLoad*(this.build.physics.rollingResistanceFactor??1),drag=s.aero.drag;
  const scrapeLoad=s.scrapeLoads.reduce((a,b)=>a+b,0),scrapeImpulse=Math.min(Math.hypot(v,u)*this.mass,scrapeLoad*.55*dt),scrapeSpeed=Math.hypot(v,u);
  if(scrapeSpeed>0){const fraction=Math.max(0,1-scrapeImpulse/(this.mass*scrapeSpeed));v*=fraction;u*=fraction;}s.bodyScrape=dt>0?scrapeImpulse*scrapeSpeed/dt:0;
  v-= (rolling+drag)/this.mass*dt;
  u-=u*(road<.8?160:35)*contactFraction/this.mass*dt;
  let yaw=s.yawRate;const tyreRollingWorkJ=[0,0,0,0];
  for(let i=0;i<4;i++){
   const x=this._positions[i][0],along=v-yaw*x,inverse=1/this.mass+x*x/this.inertia,corner=s.suspension[i];
   const rolling=s.wheelLoads[i]*this._tyreContact[i].rollingExtra,water=corner.contact?.5*1000*this.build.physics.tyreWidth*(corner.waterDepth*.001)*along*along:0;
   const force=rolling+water,j=Math.sign(along)*Math.min(Math.abs(along)/inverse,force*dt);v-=j/this.mass;yaw+=j*x/this.inertia;
   // Pushing water aside consumes kinetic energy, but does not heat the tyre.
   tyreRollingWorkJ[i]=Math.max(0,j*along-.5*j*j*inverse)*(force>0?rolling/force:0);
  }
  if(scrapeLoad>0){const torque=s.scrapeLoads.reduce((sum,load,i)=>sum+load*.55*Math.hypot(...this._positions[i]),0),beforeYaw=yaw;
   yaw-=Math.sign(yaw)*Math.min(Math.abs(yaw),torque*dt/this.inertia);s.bodyScrape+=(beforeYaw*beforeYaw-yaw*yaw)*this.inertia*.5/dt;}
  // Yaw comes only from wheel/contact forces. Traction control reduces
  // throttle; it cannot rotate the body or manufacture extra tyre grip.
  const wheels=this._wheelOmega,bearingBounds=[],brakeBounds=[],tireBounds=[],frames=[],armsLong=[],armsLat=[],softLong=[],softLat=[];
  s.absActive=false;
  for(let i=0;i<4;i++){
   const [x,z]=this._positions[i],front=i<2,wheelbase=this.frontAxle+this.rearAxle;
   // Inner and outer front wheels follow different radii during manoeuvres.
   // Blend toward parallel steering as tyre slip angles dominate at speed.
   const ackermann=Math.atan(Math.tan(s.steer)/(1-x*Math.tan(s.steer)/wheelbase));
   const alignment=((i%2?1:-1)*(1-this.condition.wheelHealth[i])*.045+this.condition.wheelToe[i]+underbodyToe(this.condition.bodyDamage,i))*(front?1:.65)-(i%2?1:-1)*this.build.physics.alignmentToe[front?0:1],wobble=Math.sin(s.wheelSpins[i]*1.01)*(1-this.condition.wheelHealth[i])**2*.012;
   const bearing=bearingResponse(chassisDamage.bearings[i],s.suspension[i].normalLoad,s.wheelSpins[i],this.condition.wheelAttached[i]);bearingBounds[i]=bearing.torque*dt;
   const command=mix(s.steer,ackermann,this.build.physics.ackermann*(1-.65*smooth(speed/35)))+alignment;
   const freeAngle=Math.atan2((u+yaw*z)*Math.sign(v-yaw*x||1),Math.abs(v-yaw*x)+3);
   s.tieRodAngles??=[0,0];const rodAngle=front?tieRodAngle(this.condition.bodyDamage.underbody['tieRod'+(i?'FR':'FL')].detached?{health:0,bend:0}:chassisDamage.tieRods[i],command,freeAngle,s.tieRodAngles[i],dt):alignment;if(front)s.tieRodAngles[i]=rodAngle;
   const delta=rodAngle+wobble+bearing.wobble;
   s.wheelSteers[i]=delta;
   const frame=frames[i]=contactFrame(delta,gradeLong,gradeLat);
   armsLong[i]=z*frame.longU-x*frame.longV;armsLat[i]=z*frame.latU-x*frame.latV;
   const corner=s.suspension[i];
   const contactLong=(v-yaw*x)*frame.longV+(u+yaw*z)*frame.longU,contactLat=(v-yaw*x)*frame.latV+(u+yaw*z)*frame.latU;
   const wet=wetTyreResponse({wetness:corner.wetness,waterDepth:corner.waterDepth,speed:contactLong,material:corner.material,compound:this.build.selection.tyres,tread:this.condition.wheelHealth[i],pressureBar:this._tyreContact[i].pressureBar});corner.wetGrip=wet.grip;corner.aquaplaning=wet.aquaplaning;
   const friction=tyreGrip({front,load:corner.normalLoad,referenceLoad:this._staticLoads[i]/plane.normalScale,temperature:this._tyreTemps[i],health:this.condition.wheelHealth[i],slipRatio:(wheels[i]*this._tyreRadii[i]-contactLong)/Math.max(3,Math.abs(contactLong)),slipAngle:Math.atan2(contactLat,Math.max(2.5,Math.abs(contactLong))),compound:this.build.selection.tyres,chassis:this.build.physics,roll:s.bodyRoll})*this.muMultiplier*corner.grip*this._tyreContact[i].grip*wet.grip;
   tireBounds[i]=Math.max(0,corner.normalLoad*friction*dt);
   let requested=brake;
   // ABS controls hydraulic pressure only. Parking brake remains mechanical.
   const contactV=contactLong;
   if(this.build.physics.abs&&this.condition.mechanical.brakeHydraulics.absValves[i]>.25&&Math.abs(contactV)>4&&brake>.05&&Math.sign(contactV)*wheels[i]*this._tyreRadii[i]<Math.abs(contactV)*.82){requested=brake*.12;s.absActive=true;}
   const pressureRate=requested<this._brakePressures[i]?22:7;
   this._brakePressures[i]+=(requested-this._brakePressures[i])*Math.min(1,dt*pressureRate);
   const fade=1-.42*smooth((this._brakeTemps[i]-520)/280);
   const health=this.condition.brakeHealth[i],bind=this.brakeTorque*.026*(1-health)**2*Math.min(1,Math.abs(wheels[i])*.08);
   const total=this.brakeTorque*(front?this.brakeBias:1-this.brakeBias)*.5*this._brakePressures[i]*mechanical.brakeHydraulicFactors[i]*fade*(.15+.85*health)+(front?0:handbrake*4800)+bind;
   brakeBounds[i]=this.condition.wheelAttached[i]?total*dt:0;
   // Static contact is rigid at parking speeds. At speed tyre carcass
   // relaxation gives finite slip instead of infinite longitudinal stiffness.
   softLong[i]=smooth((speed-.35)/2.1)*this._tyreContact[i].compliance/(10000*dt);
   softLat[i]=Math.max(2.5,Math.abs(v))*smooth((speed-.35)/2.1)*this._tyreContact[i].compliance/(32000*dt);
  }
  const Jlong=[0,0,0,0],Jlat=[0,0,0,0],Jbrake=[0,0,0,0],Jbearing=[0,0,0,0];
  let omega=this._omega,roadVerticalImpulse=0;
  const invMass=1/this.mass,invYaw=1/this.inertia,invWheel=this.condition.wheelAttached.map(attached=>1/(this.wheelInertia*(attached?1:.18))),invEngine=1/engineInertia;
  // Small mesh/bearing losses are removed from actual wheel kinetic energy;
  // their work becomes oil/casing heat instead of free, decorative heating.
  this._drive.begin({wheels,invWheel,invEngine,ratio,dt,capacity,pedal,mechanical,health:this.condition.mechanical.health,priorTorque:s.clutchTorque||0});
  const initialClutchSlip=Math.abs(omega-ratio*this._drive.meanOmega(wheels));
  const applyTire=(i,dLong,dLat)=>{
   const frame=frames[i];
   v+=(dLong*frame.forceLongV+dLat*frame.forceLatV)*invMass;
   u+=(dLong*frame.forceLongU+dLat*frame.forceLatU)*invMass;
   yaw+=(dLong*armsLong[i]+dLat*armsLat[i])*invYaw;
   wheels[i]-=dLong*this._tyreRadii[i]*invWheel[i];
   roadVerticalImpulse+=dLong*frame.forceLongY+dLat*frame.forceLatY;
  };
  // Sequential impulses solve the same gear, brake and contact constraints
  // together. Brake torque can hold a wheel against its road/clutch reaction.
  for(let iteration=0;iteration<36;iteration++){
   omega=this._drive.solve(omega);
   for(let i=0;i<4;i++){
    const nextBrake=clamp(Jbrake[i]-wheels[i]/invWheel[i],-brakeBounds[i],brakeBounds[i]),db=nextBrake-Jbrake[i];Jbrake[i]=nextBrake;wheels[i]+=db*invWheel[i];
    const nextBearing=clamp(Jbearing[i]-wheels[i]/invWheel[i],-bearingBounds[i],bearingBounds[i]),dBearing=nextBearing-Jbearing[i];Jbearing[i]=nextBearing;wheels[i]+=dBearing*invWheel[i];
    const [x,z]=this._positions[i],cv=v-yaw*x,cu=u+yaw*z;
    const frame=frames[i],long=cv*frame.longV+cu*frame.longU-wheels[i]*this._tyreRadii[i],lat=cv*frame.latV+cu*frame.latU;
    const kLong=invMass+armsLong[i]**2*invYaw+this._tyreRadii[i]**2*invWheel[i]+softLong[i];
    const kLat=invMass+armsLat[i]**2*invYaw+softLat[i];
    let nl=Jlong[i]-(long+softLong[i]*Jlong[i])/kLong,nf=Jlat[i]-(lat+softLat[i]*Jlat[i])/kLat;
    const length=Math.hypot(nl,nf),bound=tireBounds[i];
    if(length>bound){const scale=bound/Math.max(length,1e-9);nl*=scale;nf*=scale;}
    applyTire(i,nl-Jlong[i],nf-Jlat[i]);Jlong[i]=nl;Jlat[i]=nf;
   }
  }
  // Tangent tyre forces also act vertically. Feeding that impulse into heave
  // prevents uphill braking from falsely unloading (or downhill from loading)
  // the entire suspension as though tyre forces were purely horizontal.
  this._heaveVelocity+=roadVerticalImpulse*invMass;
  const Jclutch=this._drive.Jclutch;
  this.engine.applyShaftImpulse(-Jclutch);
  // Catastrophic shaft speeds consume their excess kinetic energy as failure,
  // keeping the SDK within its documented numeric working range. Gear choice
  // remains unchanged; this is damage, not a protected downshift.
  if(Math.abs(omega)>2400){const bounded=clamp(omega,-2400,2400);this.engine.applyShaftImpulse((bounded-omega)*engineInertia);if(this.damageEnabled){this.condition.damageEnergyJ+=.5*engineInertia*(omega*omega-bounded*bounded);this._mechanics.catastrophicOverrev();this.condition.damageRevision++;}omega=bounded;}
  this._omega=omega;
  // These are dissipated energies, not timer-based wear. Units: joules into
  // a lumped heat capacity, with speed-dependent cooling toward ambient.
  const drive=this._drive.finish(omega),{shaft,clutchSlip}=drive;
  // A locked constraint does no slip work. The small free-crank mismatch of
  // each staggered solver step must not become fictitious clutch heating.
  const clutchWorkJ=clutchSlip>3||initialClutchSlip>15?Math.abs(Jclutch)*.5*(initialClutchSlip+clutchSlip):0;

  const bearingWorkJ=[],brakeWorkJ=[],tyreWorkJ=[],tyreLockedWorkJ=[];
  for(let i=0;i<4;i++){
   const [x,z]=this._positions[i],cv=v-yaw*x,cu=u+yaw*z;
   const frame=frames[i],long=cv*frame.longV+cu*frame.longU,lat=cv*frame.latV+cu*frame.latU,slip=wheels[i]*this._tyreRadii[i]-long;
   const tyreWork=Math.abs(Jlong[i]*slip)+Math.abs(Jlat[i]*lat),brakeWork=Math.abs(Jbrake[i]*wheels[i]);
   const hopWork=this._hop.excite(i,dt,{force:Jlong[i]/dt,slipWork:Math.abs(Jlong[i]*slip),slipSpeed:slip,driven:this._drive.driven.includes(i),contact:s.suspension[i].contact,load:this._staticLoads[i]});
   bearingWorkJ[i]=Math.abs(Jbearing[i]*wheels[i]);brakeWorkJ[i]=brakeWork;tyreWorkJ[i]=Math.max(0,tyreWork-hopWork);tyreLockedWorkJ[i]=Math.abs(long)>4&&Math.abs(wheels[i]*this._tyreRadii[i])<Math.abs(long)*.12&&(brakeBounds[i]>0||bearingBounds[i]>0)?Math.abs(Jlong[i]*slip):0;
   s.wheelSlip[i]=slip/Math.max(3,Math.abs(long));s.wheelSpins[i]+=wheels[i]*dt;s.wheelOmegas[i]=s.wheelOmega[i]=wheels[i];
   s.brakeTemps[i]=this._brakeTemps[i];s.tyreTemps[i]=this._tyreTemps[i];s.brakePressure[i]=this._brakePressures[i]*mechanical.brakeHydraulicFactors[i];
   const corner=s.suspension[i];
   Object.assign(s.wheelAudio[i],{surface:corner.material,wetness:corner.wetness,waterDepth:corner.waterDepth,aquaplaning:corner.aquaplaning,roughness:corner.roughness,contact:corner.contact,load:corner.load,longitudinalSpeed:long,lateralSpeed:lat,slipSpeed:slip,slipRatio:s.wheelSlip[i],wheelSpeed:wheels[i]*this._tyreRadii[i],
    bearingWear:(1-chassisDamage.bearings[i].health)**2,bearingPower:bearingWorkJ[i]/dt,tyrePower:tyreWork/dt,brakePower:brakeWork/dt,suspensionVelocity:corner.velocity,suspensionTravel:corner.travel,impactSpeed:corner.impactSpeed,impactCount:corner.impactCount});
  }
  // Resting brake constraints may sleep only with spare tyre AND brake force.
  // A released brake never pins the car to a hill; saturated brakes cannot sleep.
  const brakeHolding=grounded&&brakeBounds.some(bound=>bound>0)&&(brake>.1||handbrake>.1)&&wheels.every(w=>Math.abs(w)<.2)&&
   Jlong.every((j,i)=>Math.hypot(j,Jlat[i])<tireBounds[i]*.95+.00001&&Math.abs(Jbrake[i])<brakeBounds[i]*.95+.00001);
  if(Math.abs(v)<.035&&Math.abs(u)<.035&&Math.abs(yaw)<.04&&pedal<.04&&(Math.hypot(gradeLong,gradeLat)<1e-4||brakeHolding)){v=u=yaw=0;}
  yaw=clamp(yaw,-2.6,2.6);
  this._accelLong+=(clamp((v-oldV)/dt-gravityLong,-35,35)-this._accelLong)*Math.min(1,dt*12);
  this._accelLat+=(clamp((u-oldU)/dt-gravityLat,-35,35)-this._accelLat)*Math.min(1,dt*12);
  s.accelerationLong=this._accelLong;s.accelerationLat=this._accelLat;
  s.vx=v*sn+u*cs;s.vz=v*cs-u*sn;s.yawRate=yaw;s.heading+=yaw*dt;
  if(Math.abs(s.heading)>Math.PI*200)s.heading%=TAU;
  s.x+=s.vx*dt;s.z+=s.vz*dt;
  const ns=Math.sin(s.heading),nc=Math.cos(s.heading);
  s.forwardSpeed=s.vx*ns+s.vz*nc;s.lateralSpeed=s.vx*nc-s.vz*ns;s.speed=Math.hypot(s.vx,s.vz);
  s.driftAngle=Math.atan2(s.lateralSpeed,Math.max(2,Math.abs(s.forwardSpeed)));
  s.drifting=s.speed>7&&Math.abs(s.driftAngle)>.115&&Math.abs(s.driftAngle)<1.28;
  s.rpm=Math.max(0,omega*60/TAU);this._stallTime=s.rpm<220&&!starter?this._stallTime+dt:0;
  if(this._stallTime>.12)this._stalled=true;
  s.engineStalled=this._stalled;s.engineRunning=!this._stalled&&!this.condition.engineFault&&this.condition.fuelLitres>0&&s.rpm>250;
  s.combustionTorque=this.engineState.meanTorque;s.engineTorque=s.combustionTorque+s.nitrousTorque;s.clutchTorque=Jclutch/dt;s.clutchSlipRPM=clutchSlip*60/TAU;s.inputShaftRpm=Math.abs(shaft)*60/TAU;s.clutchTemperature=this._clutchTemp;
  s.tyreForceL=Jlong[this._drive.main]/dt;s.tyreForceR=Jlong[this._drive.main+1]/dt;
  Object.assign(s,{driveLayout:this.build.physics.driveLayout,drivenWheels:this._drive.driven,axleTorques:drive.axleTorques,centerSlipRPM:drive.centerSlipRPM,differentialLock:drive.differentialLock,frontDifferentialLock:drive.frontDifferentialLock,centerDifferentialLock:drive.centerDifferentialLock,diffSlipRPM:drive.diffSlipRPM,diffTorque:drive.diffTorque,diffPower:drive.diffPower});
  s.wheelSpinFL=s.wheelSpins[0];s.wheelSpinFR=s.wheelSpins[1];s.wheelSpinL=s.wheelSpins[2];s.wheelSpinR=s.wheelSpins[3];s.wheelSlipL=s.wheelSlip[2];s.wheelSlipR=s.wheelSlip[3];
  const drivenSlipSpeed=Math.max(...this._drive.driven.map(i=>Math.abs(s.wheelAudio[i].slipSpeed)));
  s.burnoutIntensity=clamp((drivenSlipSpeed-2)/15,0,1)*clamp(1-s.speed/12,0,1);s.burnout=s.burnoutIntensity>.12;
  s.shiftProgress=clamp(this._shift/.19,0,1);s.engineClock=this.engine.getTiming().clock;
  this._updateCondition(dt,omega,{...drive,fuelLitres:this.condition.fuelLitres,headlights:!!input.headlights,starterRequested:restartRequested,starterTorque:this.engineState.config.starterTorque,starterNoLoadRpm:this.engineState.config.starterNoLoadRpm,brakePedal:brake,clutchWorkJ,bearingWorkJ,referenceLoads:this._staticLoads,wheelOmegas:wheels,attached:this.condition.wheelAttached,brakeWorkJ,tyreWorkJ,tyreLockedWorkJ,tyreRollingWorkJ,tyreSpeeds:s.wheelAudio.map(w=>w.longitudinalSpeed),tyreLoads:s.wheelLoads,tyreAngles:s.wheelSpins,tyreWetness:s.suspension.map(w=>w.contact?w.wetness:0)});this._stepPanels(dt,previousPanelPose);if(this.damageEnabled)this._releaseUnderbody(stepUnderbody(this.condition.bodyDamage,this.build,s,dt));this._updateDebris(dt);this._publishCondition();
  return s;
 }
}
