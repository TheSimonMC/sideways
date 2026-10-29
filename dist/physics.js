import {steeringDemand,tyreGrip} from './chassis-setup.js';
/* MotorLab owns the crank and combustion. This solver exchanges finite impulses
   with that same shaft, four rolling wheels, brakes and a spring/damper chassis.
   Audio may supply the sole engine stepper; never run two engine clocks. */
import {resolveBuild} from './catalog.js';
import {createVehicleCondition,snapshotVehicleCondition,FUEL_DENSITY_KG_PER_LITRE} from './vehicle-state.js';
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
 setDamageEnabled(enabled=true){this.damageEnabled=enabled!==false;return this;}
 setBuild(build){
  if(!build?.physics)build=resolveBuild(build);
  const old=this.state,options=build.physics;if(this.condition&&old)this.condition.boost=old.boost;
  this.condition=this._conditions.get(build.vehicle.id)||createVehicleCondition(build);this._conditions.set(build.vehicle.id,this.condition);
  if(this.engine)void this.engine.dispose();
  this.build=build;
  this._mechanics=new MechanicalSystem(build,this.condition,event=>{this._mechanicalEvents.push(event);if(this._mechanicalEvents.length>64)this._mechanicalEvents.shift();});
  for(const key of ['mass','inertia','wheelRadius','wheelInertia','halfTrack','frontAxle','rearAxle','cgHeight','finalDrive','clutchCapacity','brakeTorque','brakeBias','muMultiplier','springRate','damperRate','antiRollRate','rideHeight','powerLock','coastLock','boostTarget','redlineRpm'])this[key]=options[key];
  this.suspensionTravel=options.suspensionTravel??.145;this.gears=[...options.gears];
  this._positions=[[-this.halfTrack,this.frontAxle],[this.halfTrack,this.frontAxle],[-this.halfTrack,-this.rearAxle],[this.halfTrack,-this.rearAxle]];
  this._pitchInertia=this.mass*(this.frontAxle+this.rearAxle)**2*.20;
  this._rollInertia=this.mass*(this.halfTrack*2)**2*.24;
  this._staticLoads=[0,0,0,0].map((_,i)=>this.mass*G*(i<2?this.rearAxle:this.frontAxle)/(2*(this.frontAxle+this.rearAxle)));
  this.engine=this.MotorLab.createEngine(options.engineOptions);
  this.engine.start({starterSeconds:1});this.engine.setInputs({throttle:0,boostTarget:this.boostTarget});
  for(let i=0;i<72;i++)this.engineState=this.engine.update(1/60);
  this.engine.setInputs({starter:false});this._warmState=this.engine.save();
  this.reset(old?.x??0,old?.z??0,old?.heading??0);
  return this;
 }
 // Legacy integration hook: old handling names have no effect on physics.
 setTune(){return this;}
 _ground(x,z,defaultGrip=1){
  const sample=this._groundSampler?.(x,z);
  const grip=clamp(typeof sample==='number'?defaultGrip:sample?.grip??defaultGrip,.2,1.5);
  return {height:typeof sample==='number'?sample:Number.isFinite(sample?.height)?sample.height:0,grip,
   material:typeof sample?.material==='string'?sample.material:grip<.8?'gravel':'asphalt',
   roughness:clamp(Number.isFinite(sample?.roughness)?sample.roughness:grip<.8?.025:.001,0,.2)};
 }
 reset(x=0,z=0,heading=0,{neutral=false}={}){
  if(this.state?.carId===this.condition.carId&&Number.isFinite(this.state.boost))this.condition.boost=this.state.boost;
  // PCM transport has no async device teardown; the SDK releases its clock
  // synchronously before returning the cleanup promise.
  if(this.engine.getTiming().clock!=='manual')void this.engine.disconnectAudio();
  this.engine.load(this._warmState);this.engineState=this.engine.getState();
  this._omega=this.engineState.omega;this._wheelOmega=[0,0,0,0];this._fuelMeter=this.engineState.totals?.fuelInjected??0;this._heatMeter={wall:this.engineState.totals?.wallHeat??0,friction:this.engineState.totals?.frictionWork??0,load:this.engineState.totals?.loadWork??0};
  if(this.condition.engineFault||this.condition.fuelLitres<=0){this.engine.stop();this.engine.applyShaftImpulse(-this._omega*this.engineState.config.inertia);this.engineState=this.engine.getState();this._omega=0;}
  this._shift=this._reverseHold=this._shiftMessageTime=0;
  this._shiftUpHeld=this._shiftDownHeld=false;this._accelLong=this._accelLat=0;
  this._tc=1;this._autoEngagement=0;this._stallTime=0;this._stalled=!!this.condition.engineFault||this.condition.fuelLitres<=0;this._nitrousBlend=0;this._nitrousBlocked=false;this._nitrousCooldown=0;
  this._heaveVelocity=this._pitchVelocity=this._rollVelocity=0;
  this._brakePressures=[0,0,0,0];this._brakeTemps=this.condition.mechanical.temperatures.brakes;
  this._tyreTemps=this.condition.mechanical.temperatures.tyres;this._clutchTemp=this.condition.mechanical.temperatures.clutch;
  const ground=this._ground(x,z).height;
  this.state=Object.assign(this.state||{}, {x,z,heading,vx:0,vz:0,yawRate:0,speed:0,forwardSpeed:0,lateralSpeed:0,rpm:this.engineState.rpm,gear:neutral?0:1,
   throttle:0,brake:0,steer:0,driftAngle:0,drifting:false,boost:this.condition.boost,boosting:false,boostAvailable:true,nitrousIntensity:0,nitrousTorque:0,combustionTorque:this.engineState.meanTorque,wheelSpinL:0,wheelSpinR:0,wheelSpinFL:0,wheelSpinFR:0,
   wheelSlipL:0,wheelSlipR:0,differentialLock:this.coastLock,bodyHeight:ground,bodyRoll:0,bodyPitch:0,groundHeight:ground,
   engineTorque:this.engineState.meanTorque,clutchTorque:0,tyreForceL:0,tyreForceR:0,surface:1,
   shiftProgress:0,engineClock:'manual',transmission:'auto',handbrake:0,clutch:1,manualClutch:false,requestedGear:neutral?0:1,shiftMessage:'',shiftRejected:false,
   engineRunning:!this._stalled,engineStalled:this._stalled,starterActive:false,clutchSlipRPM:0,inputShaftRpm:0,clutchTemperature:this._clutchTemp,
   wheelOmegas:[0,0,0,0],wheelOmega:[0,0,0,0],wheelSpins:[0,0,0,0],wheelSteers:[0,0,0,0],wheelSlip:[0,0,0,0],wheelLoads:[...this._staticLoads],brakeTemps:this._brakeTemps,tyreTemps:this._tyreTemps,
   brakePressure:[0,0,0,0],absActive:false,burnout:false,burnoutIntensity:0,halfTrack:this.halfTrack,rearAxle:this.rearAxle,frontAxle:this.frontAxle,wheelRadius:this.wheelRadius,
   accelerationLong:0,accelerationLat:0,diffSlipRPM:0,diffTorque:0,diffPower:0,
   fuelFlowLph:0,fuelStarved:this.condition.fuelLitres<=0,overrev:0,damageMessage:'',bodyScrape:0,scrapeLoads:[0,0,0,0],detachedWheels:[],detachedPanels:[],
   suspension:this._staticLoads.map(load=>({compression:load/this.springRate,travel:0,load,groundHeight:ground,contact:true,wheelY:ground+this.wheelRadius,velocity:0,impactSpeed:0,impactCount:0})),
   wheelAudio:this._staticLoads.map(load=>({surface:'asphalt',roughness:.001,contact:true,load,longitudinalSpeed:0,lateralSpeed:0,slipSpeed:0,slipRatio:0,wheelSpeed:0,tyrePower:0,brakePower:0,suspensionVelocity:0,suspensionTravel:0,impactSpeed:0,impactCount:0}))});
  this._previousGround=this.state.suspension.map(p=>p.groundHeight);this._mechanics.observe(this.state.gear,this._omega);this._publishCondition();
  for(let i=0;i<4;i++)if(!this.condition.wheelAttached[i]){this.state.suspension[i].load=0;this.state.suspension[i].contact=false;this.state.wheelLoads[i]=0;this.state.wheelAudio[i].contact=false;this.state.wheelAudio[i].load=0;}
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
  const before=this._ratio(s.gear),after=this._ratio(gear),wheel=(this._omegaL+this._omegaR)*.5;
  const engaged=manualClutch?1-clutchPedal:0;
  this._mechanics.shift(before,after,wheel,engaged,gear,this.damageEnabled);
  s.gear=gear;s.requestedGear=gear;s.shiftMessage='';s.shiftRejected=false;this._shiftMessageTime=0;this._shift=gear===0?.08:.19;return true;
 }
 _publishCondition(){
  if(!this.state||!this.condition)return;
  const c=this.condition;Object.assign(this.state,{carId:c.carId,engineHealth:c.engineHealth,bodyHealth:c.bodyHealth,bodyDamage:c.bodyDamage,gearboxHealth:c.gearboxHealth,wheelHealth:c.wheelHealth,wheelAttached:c.wheelAttached,
   suspensionHealth:c.suspensionHealth,brakeHealth:c.brakeHealth,wheelToe:c.wheelToe,wheelCamber:c.suspensionHealth.map((health,i)=>(i%2?1:-1)*((1-health)*.14-this.build.physics.alignmentCamber[i<2?0:1])),damageEnabled:this.damageEnabled,
   fuelLitres:c.fuelLitres,fuelCapacity:c.fuelCapacity,fuelConsumedLitres:c.fuelConsumedLitres,fuelStarved:c.fuelLitres<=0,engineFault:c.engineFault,damageRevision:c.damageRevision,damageEnergyJ:c.damageEnergyJ,distanceMeters:c.distanceMeters,maxRpm:c.maxRpm,
   mechanical:this._mechanics.diagnostics,clutchTemperature:c.mechanical.temperatures.clutch,brakeTemps:c.mechanical.temperatures.brakes,tyreTemps:c.mechanical.temperatures.tyres});
 }
 consumeMechanicalEvents(){return this._mechanicalEvents.splice(0);}
 getMechanicalDiagnostics(){return this._mechanics.publish(true);}
 getCondition(){if(this.state)this.condition.boost=this.state.boost;return snapshotVehicleCondition(this.condition);}
 restoreCondition(saved){
  this.condition=createVehicleCondition(this.build,saved);this._conditions.set(this.build.vehicle.id,this.condition);
  this._mechanics=new MechanicalSystem(this.build,this.condition,event=>{this._mechanicalEvents.push(event);if(this._mechanicalEvents.length>64)this._mechanicalEvents.shift();});
  this._brakeTemps=this.condition.mechanical.temperatures.brakes;this._tyreTemps=this.condition.mechanical.temperatures.tyres;this._clutchTemp=this.condition.mechanical.temperatures.clutch;this._publishCondition();
  this.state.boost=this.condition.boost;if(this.condition.engineFault||this.condition.fuelLitres<=0){this.engine.stop();this._stalled=true;this.state.engineRunning=false;this.state.engineStalled=true;if(this.condition.engineFault){const crank=this.engine.getState();this.engine.applyShaftImpulse(-crank.omega*crank.config.inertia);this._omega=0;this.engineState=this.engine.getState();this.state.rpm=0;}}
  this._mechanics.observe(this.state.gear,this._omega,this.state.speed);this._publishCondition();return this.getCondition();
 }
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
   if(wasFailed&&!this.condition.engineFault){if(this.engine.getTiming().clock!=='manual')void this.engine.disconnectAudio();this.engine.load(this._warmState);this.engineState=this.engine.getState();this._omega=this.engineState.omega;this._stalled=false;this._stallTime=0;this._fuelMeter=this.engineState.totals?.fuelInjected??0;this._heatMeter={wall:this.engineState.totals?.wallHeat??0,friction:this.engineState.totals?.frictionWork??0,load:this.engineState.totals?.loadWork??0};this.state.engineRunning=this.condition.fuelLitres>0;this.state.engineStalled=false;this.state.rpm=this.engineState.rpm;}
   this.state.detachedWheels=this.state.detachedWheels.filter(w=>!this.condition.wheelAttached[w.index]);this.state.detachedPanels=this.state.detachedPanels.filter(p=>this.condition.bodyDamage.zones[p.panel]?.detached);this.state.damageMessage='Repairs complete';this._mechanics.observe(this.state.gear,this._omega,this.state.speed);this._publishCondition();
  }
  return {repaired:repaired.length>0,components:repaired,condition:this.getCondition()};
 }
 service({repair=false,refuel=false,refillNitrous=false}={}){const result={repaired:false,fuelAdded:0,nitrousAdded:0};if(repair)result.repaired=this.repair().repaired;if(refuel)result.fuelAdded=this.refuel();if(refillNitrous){result.nitrousAdded=1-this.state.boost;this.state.boost=this.condition.boost=1;}result.condition=this.getCondition();return result;}
 applyImpact(contact={}){
  if(!this.damageEnabled)return {damage:0,detached:[]};
  const s=this.state,c=this.condition,closing=Math.max(0,Number(contact.closingSpeed)||0),impulse=Math.max(0,Number(contact.impulse)||0);
  if(closing<2.2||impulse<150)return {damage:0,detached:[]};
  const energy=Math.max(0,Number(contact.energyJ)||impulse*closing*.5),severity=energy/(this.mass*180),damage=clamp(severity*.25/(this.build.physics.bodyStrength??1),0,.9);
  const point=contact.point||s,dx=point.x-s.x,dz=point.z-s.z,sn=Math.sin(s.heading),cs=Math.cos(s.heading);
  const local=contact.localPoint||{x:dx*cs-dz*sn,z:dx*sn+dz*cs};
  c.bodyHealth=Math.max(0,c.bodyHealth-damage);c.damageEnergyJ+=energy;c.damageRevision++;
  const bodyHit=deformBody(c.bodyDamage,this.build,{local,energyJ:energy,closingSpeed:closing});
  for(const panel of bodyHit.detached)this._detachPanel(panel,contact);
  s.lastImpactLocal={...local};
  const front=clamp((local.z+this.rearAxle)/(this.frontAxle+this.rearAxle),0,1);
  this._mechanics.impact({damage,front,local,closing,severity});s.damageMessage='Body damage';
  const nearest=this._positions.map(([x,z],index)=>({index,distance:Math.hypot(local.x-x,local.z-z)})).sort((a,b)=>a.distance-b.distance)[0],detached=[];
  if(nearest.distance<1.4&&Math.abs(local.x)>.28){
   const i=nearest.index,wheelDamage=clamp(severity*.65/(this.build.physics.bodyStrength??1)*(1-nearest.distance/2.1),0,1);c.wheelHealth[i]=Math.max(0,c.wheelHealth[i]-wheelDamage);
   const bend=Math.sign((contact.normal?.x||0)*cs-(contact.normal?.z||0)*sn)||Math.sign(local.x)||1;
   c.suspensionHealth[i]=Math.max(0,c.suspensionHealth[i]-wheelDamage*.86);c.brakeHealth[i]=Math.max(0,c.brakeHealth[i]-wheelDamage*.52);
   c.wheelToe[i]=clamp(c.wheelToe[i]+bend*wheelDamage*.13,-.16,.16);if(wheelDamage>.08)s.damageMessage='Wheel alignment damaged';
   if(c.wheelAttached[i]&&closing>13&&(wheelDamage>.48||c.wheelHealth[i]<.22)){this._detachWheel(i,contact);detached.push(i);s.damageMessage='Wheel detached';}
  }
  if(c.engineHealth<=.025){c.engineHealth=0;c.engineFault='Impact damage';this._stalled=true;this.engine.stop();s.damageMessage='Engine failure';}
  this._mechanics.publish(true);this._publishCondition();return {damage,detached,panels:bodyHit.detached,energyJ:energy};
 }
 _detachWheel(index,contact){
  const s=this.state,c=this.condition,[x,z]=this._positions[index],sn=Math.sin(s.heading),cs=Math.cos(s.heading),normal=contact.normal||{x:0,z:0};
  c.wheelAttached[index]=false;c.wheelHealth[index]=0;
  const lateral=s.yawRate*z,longitudinal=-s.yawRate*x;
  s.detachedWheels.push({id:++this._debrisId,index,x:s.x+x*cs+z*sn,z:s.z-x*sn+z*cs,y:s.suspension[index].wheelY,
   vx:s.vx+lateral*cs+longitudinal*sn+normal.x*Math.min(5,contact.closingSpeed*.12),vz:s.vz-lateral*sn+longitudinal*cs+normal.z*Math.min(5,contact.closingSpeed*.12),vy:Math.min(4,1+contact.closingSpeed*.05),heading:s.heading,omega:this._wheelOmega[index],spin:s.wheelSpins[index],age:0,radius:this.wheelRadius});
  s.suspension[index].contact=false;s.suspension[index].load=0;s.wheelLoads[index]=0;s.wheelAudio[index].contact=false;s.wheelAudio[index].load=0;
 }
 _detachPanel(panel,contact){
  const s=this.state,front=panel==='front',z=(front?1:-1)*this.build.vehicle.model.length*.48,sn=Math.sin(s.heading),cs=Math.cos(s.heading),normal=contact.normal||{x:0,z:0};
  s.detachedPanels.push({id:++this._debrisId,panel,x:s.x+z*sn,z:s.z+z*cs,y:(s.bodyHeight||0)+.35,vx:s.vx+normal.x*2,vz:s.vz+normal.z*2,vy:1.2,heading:s.heading,rotation:0,spin:(front?1:-1)*(1+contact.closingSpeed*.1),age:0,width:this.build.vehicle.model.width*.96});
 }
 _updateDebris(dt){
  for(const panel of this.state.detachedPanels){panel.age+=dt;panel.vy-=G*dt;panel.x+=panel.vx*dt;panel.z+=panel.vz*dt;panel.y+=panel.vy*dt;panel.rotation+=panel.spin*dt;const floor=this._ground(panel.x,panel.z).height+.10;if(panel.y<floor){panel.y=floor;panel.vy=Math.abs(panel.vy)>1?-panel.vy*.18:0;panel.vx*=Math.exp(-dt*3);panel.vz*=Math.exp(-dt*3);panel.spin*=Math.exp(-dt*4);}}
  this.state.detachedPanels=this.state.detachedPanels.filter(p=>p.age<24);
  for(const wheel of this.state.detachedWheels){wheel.age+=dt;wheel.vy-=G*dt;wheel.x+=wheel.vx*dt;wheel.z+=wheel.vz*dt;wheel.y+=wheel.vy*dt;wheel.spin+=wheel.omega*dt;const floor=this._ground(wheel.x,wheel.z).height+wheel.radius;
   if(wheel.y<floor){wheel.y=floor;wheel.vy=Math.abs(wheel.vy)>1?-wheel.vy*.28:0;const drag=Math.exp(-dt*1.2);wheel.vx*=drag;wheel.vz*=drag;wheel.omega*=Math.exp(-dt*.7);}else{wheel.vx*=Math.exp(-dt*.05);wheel.vz*=Math.exp(-dt*.05);}}
  this.state.detachedWheels=this.state.detachedWheels.filter(w=>w.age<24);
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
   wallHeatJ:Math.max(0,wall-this._heatMeter.wall),frictionJ:Math.max(0,friction-this._heatMeter.friction),extraFrictionJ:Math.max(0,load-this._heatMeter.load),
   nosHeatJ:nosLitres*FUEL_DENSITY_KG_PER_LITRE*44e6*.22,exhaustC:(this.engineState.exhaust?.T??297.15)-273.15,exhaustFlow:this.engineState.flows?.turbine??0,turboRpm:this.engineState.boost?.rpm??0,...work},this.damageEnabled);
  this._heatMeter={wall,friction,load};this._clutchTemp=c.mechanical.temperatures.clutch;
  if(c.engineFault){this._stalled=true;this.engine.stop();s.engineRunning=false;s.engineStalled=true;s.damageMessage=c.engineFault;}
  if(c.fuelLitres<=0){this._stalled=true;this.engine.stop();s.engineRunning=false;s.engineStalled=true;s.damageMessage='Fuel tank empty';s.nitrousTorque=0;}
 }
 _suspension(dt,road){
  const s=this.state,sn=Math.sin(s.heading),cs=Math.cos(s.heading),travel=this.suspensionTravel;
  const deflections=[],velocities=[],samples=[];
  for(let i=0;i<4;i++){
   const [x,z]=this._positions[i],p=this._ground(s.x+x*cs+z*sn,s.z-x*sn+z*cs,road);
   const corner=s.bodyHeight-s.bodyPitch*z+s.bodyRoll*x;
   deflections[i]=p.height-corner;
   const groundVelocity=clamp((p.height-this._previousGround[i])/dt,-8,8);
   velocities[i]=groundVelocity-this._heaveVelocity+this._pitchVelocity*z-this._rollVelocity*x;
   this._previousGround[i]=p.height;samples[i]=p;
  }
  let total=0,pitchMoment=0,rollMoment=0;
  const aero=s.speed*s.speed*this.build.physics.aeroDownforce;
  for(let i=0;i<4;i++){
   const [x,z]=this._positions[i],load0=this._staticLoads[i],d=deflections[i],opposite=i^1,health=this.condition.suspensionHealth[i],cornerTravel=travel*(.5+.5*health),spring=this.springRate*(.4+.6*health);
   const antiroll=(d-deflections[opposite])*this.antiRollRate*(i<2?this.build.physics.frontRollFactor:this.build.physics.rearRollFactor)*(.45+.55*health);
   const bump=Math.max(0,d-cornerTravel*.85)*this.springRate*7;
   const raw=load0*(.65+.35*health)+d*spring+velocities[i]*this.damperRate*(.12+.88*health)+antiroll+bump;
   const attached=this.condition.wheelAttached[i],load=!attached||d< -cornerTravel?0:clamp(raw,0,load0*5.5);
   const corner=s.bodyHeight-s.bodyPitch*z+s.bodyRoll*x;
   const skidDepth=!attached?Math.max(0,samples[i].height-corner-.19):0;
   const skid=skidDepth>0?clamp(skidDepth*this.springRate*4+Math.max(0,velocities[i])*this.damperRate*.8,0,load0*7):0;
   s.scrapeLoads[i]=skid;total+=load+skid;pitchMoment-=(load+skid)*z;rollMoment+=(load+skid)*x;
   const suspension=s.suspension[i],contact=load>1&&d>= -cornerTravel;
   // A brief acoustic envelope records actual recontact or a compression
   // shock; static vehicle weight never creates a perpetual impact sound.
   const shock=contact&&velocities[i]>.45&&(!suspension.contact||velocities[i]>(suspension.velocity??0)+.8)?velocities[i]:0;
   Object.assign(suspension,{compression:Math.max(0,load0/spring+d),travel:clamp(d,-cornerTravel,cornerTravel),load,groundHeight:samples[i].height,grip:samples[i].grip,health,travelLimit:cornerTravel,
    material:samples[i].material,roughness:samples[i].roughness,velocity:velocities[i],impactSpeed:Math.max(shock,(suspension.impactSpeed??0)*Math.exp(-dt*18)),impactCount:(suspension.impactCount??0)+(shock>.45?1:0),
    contact,wheelY:Math.max(samples[i].height+this.wheelRadius,corner+this.wheelRadius-cornerTravel)});
   s.wheelLoads[i]=load;
  }
  this._heaveVelocity+=(total-this.mass*G-aero)/this.mass*dt;
  this._pitchVelocity+=(pitchMoment-this._accelLong*this.mass*this.cgHeight)/this._pitchInertia*dt;
  this._rollVelocity+=(rollMoment+this._accelLat*this.mass*this.cgHeight)/this._rollInertia*dt;
  // End-stop forces bound the body without replacing its dynamic response.
  this._pitchVelocity-=Math.sign(s.bodyPitch)*Math.max(0,Math.abs(s.bodyPitch)-.24)*dt*80;
  this._rollVelocity-=Math.sign(s.bodyRoll)*Math.max(0,Math.abs(s.bodyRoll)-.28)*dt*90;
  this._pitchVelocity*=Math.exp(-dt*.6);this._rollVelocity*=Math.exp(-dt*.6);
  s.bodyHeight+=this._heaveVelocity*dt;s.bodyPitch+=this._pitchVelocity*dt;s.bodyRoll+=this._rollVelocity*dt;
  s.groundHeight=samples.reduce((sum,p)=>sum+p.height,0)/4;
 }
 update(dt,input={},surface=1){
  dt=clamp(Number.isFinite(dt)?dt:0,0,1/30);if(!dt)return this.state;
  // Substep coarse callers as well as the game's fixed 120 Hz loop.
  if(dt>1/120+1e-9){const n=Math.ceil(dt*120);for(let i=0;i<n;i++)this.update(dt/n,input,surface);return this.state;}
  const s=this.state,sn=Math.sin(s.heading),cs=Math.cos(s.heading),assists=input.assists!==false;
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
  s.steer+=(steering.target-s.steer)*(1-Math.exp(-dt*steerRate));
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
  const tyreSlip=Math.max(Math.abs(s.wheelSlipL),Math.abs(s.wheelSlipR));
  // Simultaneous service brake and throttle is a deliberate left-foot/burnout
  // manoeuvre; traction control yields, but no grip or power is invented.
  const tcTarget=!assists||brake>.1?1:clamp(1-Math.max(0,tyreSlip-.17)*this.build.physics.tractionControl*1.5,.25,1);
  this._tc+=(tcTarget-this._tc)*Math.min(1,dt*9);
  s.throttle+=(pedal*this._tc-s.throttle)*Math.min(1,dt*15);s.brake=brake;
  const restartRequested=!!input.starter&&!this.condition.engineFault&&(!manualClutch||ratio===0||clutchPedal>.65);
  const starter=restartRequested&&rpm<1200;
  // Re-enabling ignition can catch a crank still coasting after starvation;
  // the starter motor itself does not engage above its safe cranking speed.
  if(restartRequested&&(this.condition.fuelLitres>0||starter))this._stalled=false;
  // Bump-starting is possible when the driven wheels turn an otherwise stalled
  // crank fast enough. No RPM assignment or artificial restart torque is used.
  if(this._stalled&&rpm>400&&ratio!==0&&!this.condition.engineFault&&this.condition.fuelLitres>0)this._stalled=false;
  const canFire=!this._stalled&&!this.condition.engineFault&&this.condition.fuelLitres>0;
  const mechanical=this._mechanics.refreshEffects(s.gear,this._omega),damageDrag=mechanical.loadTorqueNm;
  const misfire=mechanical.misfire,cycle=Math.floor((this.engineState.angle||0)/(TAU*2));
  const cylinders=this.engineState.controls.cylinders.map((_,i)=>((cycle+i*7)%19+19)%19>=misfire*19);
  this.engine.setInputs({throttle:clamp(s.throttle,0,1),externalTorqueNm:s.nitrousTorque,loadNm:damageDrag,boostTarget:this.boostTarget*mechanical.boostFactor,
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
  const rollingLoad=s.suspension.reduce((sum,p)=>sum+p.load*(.014+Math.max(0,1-p.grip)*.08),0);
  const rolling=Math.tanh(v*8)*rollingLoad*(this.build.physics.rollingResistanceFactor??1),drag=this.build.physics.aeroDrag*v*Math.abs(v)*(1+(1-this.condition.bodyHealth)*.35);
  const scrapeLoad=s.scrapeLoads.reduce((a,b)=>a+b,0),scrapeImpulse=Math.min(Math.hypot(v,u)*this.mass,scrapeLoad*.55*dt),scrapeSpeed=Math.hypot(v,u);
  if(scrapeSpeed>0){const fraction=Math.max(0,1-scrapeImpulse/(this.mass*scrapeSpeed));v*=fraction;u*=fraction;}s.bodyScrape=dt>0?scrapeImpulse*scrapeSpeed/dt:0;
  v-= (rolling+drag)/this.mass*dt;
  u-=u*(road<.8?160:35)*contactFraction/this.mass*dt;
  let yaw=s.yawRate;
  if(scrapeLoad>0){const torque=s.scrapeLoads.reduce((sum,load,i)=>sum+load*.55*Math.hypot(...this._positions[i]),0),beforeYaw=yaw;
   yaw-=Math.sign(yaw)*Math.min(Math.abs(yaw),torque*dt/this.inertia);s.bodyScrape+=(beforeYaw*beforeYaw-yaw*yaw)*this.inertia*.5/dt;}
  // Yaw comes only from wheel/contact forces. Traction control reduces
  // throttle; it cannot rotate the body or manufacture extra tyre grip.
  const wheels=this._wheelOmega,brakeBounds=[],tireBounds=[],coss=[],sins=[],armsLong=[],armsLat=[],softLong=[],softLat=[];
  s.absActive=false;
  for(let i=0;i<4;i++){
   const [x,z]=this._positions[i],front=i<2,wheelbase=this.frontAxle+this.rearAxle;
   // Inner and outer front wheels follow different radii during manoeuvres.
   // Blend toward parallel steering as tyre slip angles dominate at speed.
   const ackermann=Math.atan(Math.tan(s.steer)/(1-x*Math.tan(s.steer)/wheelbase));
   const alignment=((i%2?1:-1)*(1-this.condition.wheelHealth[i])*.045+this.condition.wheelToe[i])*(front?1:.65)-(i%2?1:-1)*this.build.physics.alignmentToe[front?0:1],wobble=Math.sin(s.wheelSpins[i]*1.01)*(1-this.condition.wheelHealth[i])**2*.012;
   const delta=(front?mix(s.steer,ackermann,this.build.physics.ackermann*(1-.65*smooth(speed/35)))+alignment:alignment)+wobble,c=Math.cos(delta),n=Math.sin(delta);
   s.wheelSteers[i]=delta;
   coss[i]=c;sins[i]=n;armsLong[i]=z*n-x*c;armsLat[i]=z*c+x*n;
   const corner=s.suspension[i];
   const contactLong=(v-yaw*x)*c+(u+yaw*z)*n,contactLat=(u+yaw*z)*c-(v-yaw*x)*n;
   const friction=tyreGrip({front,load:corner.load,referenceLoad:this._staticLoads[i],temperature:this._tyreTemps[i],health:this.condition.wheelHealth[i],slipRatio:(wheels[i]*this.wheelRadius-contactLong)/Math.max(3,Math.abs(contactLong)),slipAngle:Math.atan2(contactLat,Math.max(2.5,Math.abs(contactLong))),compound:this.build.selection.tyres,chassis:this.build.physics,roll:s.bodyRoll})*this.muMultiplier*corner.grip;
   tireBounds[i]=Math.max(0,corner.load*friction*dt);
   let requested=brake;
   // ABS controls hydraulic pressure only. Parking brake remains mechanical.
   const contactV=v-yaw*x;
   if(this.build.physics.abs&&Math.abs(contactV)>4&&brake>.05&&Math.sign(contactV)*wheels[i]*this.wheelRadius<Math.abs(contactV)*.82){requested=brake*.12;s.absActive=true;}
   const pressureRate=requested<this._brakePressures[i]?22:7;
   this._brakePressures[i]+=(requested-this._brakePressures[i])*Math.min(1,dt*pressureRate);
   const fade=1-.42*smooth((this._brakeTemps[i]-520)/280);
   const health=this.condition.brakeHealth[i],bind=this.brakeTorque*.026*(1-health)**2*Math.min(1,Math.abs(wheels[i])*.08);
   const total=this.brakeTorque*(front?this.brakeBias:1-this.brakeBias)*.5*this._brakePressures[i]*fade*(.15+.85*health)+(front?0:handbrake*4800)+bind;
   brakeBounds[i]=this.condition.wheelAttached[i]?total*dt:0;
   // Static contact is rigid at parking speeds. At speed tyre carcass
   // relaxation gives finite slip instead of infinite longitudinal stiffness.
   softLong[i]=smooth((speed-.35)/2.1)/(10000*dt);
   softLat[i]=Math.max(2.5,Math.abs(v))/(32000*dt);
  }
  const Jlong=[0,0,0,0],Jlat=[0,0,0,0],Jbrake=[0,0,0,0];
  let Jclutch=0,Jdiff=0,omega=this._omega;
  const invMass=1/this.mass,invYaw=1/this.inertia,invWheel=this.condition.wheelAttached.map(attached=>1/(this.wheelInertia*(attached?1:.18))),invEngine=1/engineInertia;
  // Small mesh/bearing losses are removed from actual wheel kinetic energy;
  // their work becomes oil/casing heat instead of free, decorative heating.
  const mh=this.condition.mechanical.health,priorTorque=Math.abs(s.clutchTorque||0);
  const meshTorque=ratio?(1+priorTorque*.012)*(1+3*(1-mh.gearbox))*Math.abs(ratio):0;
  const finalDriveDrag=(2+priorTorque*Math.abs(ratio)*.006)*(1+3*(1-mh.differential));
  const dissipate=torque=>{let work=0;for(const i of [2,3]){const before=wheels[i],j=Math.min(Math.abs(before)/invWheel[i],torque*.5*dt);wheels[i]-=Math.sign(before)*j*invWheel[i];work+=(before*before-wheels[i]*wheels[i])/(2*invWheel[i]);}return Math.max(0,work);};
  const gearboxWorkJ=dissipate(meshTorque),differentialDragJ=dissipate(finalDriveDrag);
  const initialClutchSlip=Math.abs(omega-ratio*(wheels[2]+wheels[3])*.5),initialDiffSlip=Math.abs(wheels[3]-wheels[2]);
  const applyTire=(i,dLong,dLat)=>{
   v+=(dLong*coss[i]-dLat*sins[i])*invMass;
   u+=(dLong*sins[i]+dLat*coss[i])*invMass;
   yaw+=(dLong*armsLong[i]+dLat*armsLat[i])*invYaw;
   wheels[i]-=dLong*this.wheelRadius*invWheel[i];
  };
  // Sequential impulses solve the same gear, brake and contact constraints
  // together. Brake torque can hold a wheel against its road/clutch reaction.
  for(let iteration=0;iteration<36;iteration++){
   if(capacity>0){
    const slip=omega-ratio*(wheels[2]+wheels[3])*.5;
    const next=clamp(Jclutch+slip/(invEngine+ratio*ratio*(invWheel[2]+invWheel[3])*.25),-capacity*dt,capacity*dt),d=next-Jclutch;
    Jclutch=next;omega-=d*invEngine;wheels[2]+=d*ratio*.5*invWheel[2];wheels[3]+=d*ratio*.5*invWheel[3];
   }
   const lock=mix(this.coastLock,this.powerLock,pedal)*mechanical.differentialLockFactor,diffBound=(Math.abs(Jclutch*ratio)*.5*lock+lock*45*dt);
   const nextDiff=clamp(Jdiff+(wheels[3]-wheels[2])/(invWheel[2]+invWheel[3]),-diffBound,diffBound),dd=nextDiff-Jdiff;
   Jdiff=nextDiff;wheels[2]+=dd*invWheel[2];wheels[3]-=dd*invWheel[3];
   for(let i=0;i<4;i++){
    const nextBrake=clamp(Jbrake[i]-wheels[i]/invWheel[i],-brakeBounds[i],brakeBounds[i]),db=nextBrake-Jbrake[i];Jbrake[i]=nextBrake;wheels[i]+=db*invWheel[i];
    const [x,z]=this._positions[i],cv=v-yaw*x,cu=u+yaw*z;
    const long=cv*coss[i]+cu*sins[i]-wheels[i]*this.wheelRadius,lat=cu*coss[i]-cv*sins[i];
    const kLong=invMass+armsLong[i]**2*invYaw+this.wheelRadius**2*invWheel[i]+softLong[i];
    const kLat=invMass+armsLat[i]**2*invYaw+softLat[i];
    let nl=Jlong[i]-(long+softLong[i]*Jlong[i])/kLong,nf=Jlat[i]-(lat+softLat[i]*Jlat[i])/kLat;
    const length=Math.hypot(nl,nf),bound=tireBounds[i];
    if(length>bound){const scale=bound/Math.max(length,1e-9);nl*=scale;nf*=scale;}
    applyTire(i,nl-Jlong[i],nf-Jlat[i]);Jlong[i]=nl;Jlat[i]=nf;
   }
  }
  this.engine.applyShaftImpulse(-Jclutch);
  // Catastrophic shaft speeds consume their excess kinetic energy as failure,
  // keeping the SDK within its documented numeric working range. Gear choice
  // remains unchanged; this is damage, not a protected downshift.
  if(Math.abs(omega)>2400){const bounded=clamp(omega,-2400,2400);this.engine.applyShaftImpulse((bounded-omega)*engineInertia);if(this.damageEnabled){this.condition.damageEnergyJ+=.5*engineInertia*(omega*omega-bounded*bounded);this._mechanics.catastrophicOverrev();this.condition.damageRevision++;}omega=bounded;}
  this._omega=omega;
  // These are dissipated energies, not timer-based wear. Units: joules into
  // a lumped heat capacity, with speed-dependent cooling toward ambient.
  const shaft=ratio*(wheels[2]+wheels[3])*.5,clutchSlip=Math.abs(omega-shaft);
  // A locked constraint does no slip work. The small free-crank mismatch of
  // each staggered solver step must not become fictitious clutch heating.
  const clutchWorkJ=clutchSlip>3||initialClutchSlip>15?Math.abs(Jclutch)*.5*(initialClutchSlip+clutchSlip):0;
  const diffSlip=Math.abs(wheels[3]-wheels[2]),diffSlipJ=diffSlip>1||initialDiffSlip>10?Math.abs(Jdiff)*.5*(initialDiffSlip+diffSlip):0;
  const brakeWorkJ=[],tyreWorkJ=[];
  for(let i=0;i<4;i++){
   const [x,z]=this._positions[i],cv=v-yaw*x,cu=u+yaw*z;
   const long=cv*coss[i]+cu*sins[i],lat=cu*coss[i]-cv*sins[i],slip=wheels[i]*this.wheelRadius-long;
   const tyreWork=Math.abs(Jlong[i]*slip)+Math.abs(Jlat[i]*lat),brakeWork=Math.abs(Jbrake[i]*wheels[i]);
   brakeWorkJ[i]=brakeWork;tyreWorkJ[i]=tyreWork;
   s.wheelSlip[i]=slip/Math.max(3,Math.abs(long));s.wheelSpins[i]+=wheels[i]*dt;s.wheelOmegas[i]=s.wheelOmega[i]=wheels[i];
   s.brakeTemps[i]=this._brakeTemps[i];s.tyreTemps[i]=this._tyreTemps[i];s.brakePressure[i]=this._brakePressures[i];
   const corner=s.suspension[i];
   Object.assign(s.wheelAudio[i],{surface:corner.material,roughness:corner.roughness,contact:corner.contact,load:corner.load,longitudinalSpeed:long,lateralSpeed:lat,slipSpeed:slip,slipRatio:s.wheelSlip[i],wheelSpeed:wheels[i]*this.wheelRadius,
    tyrePower:tyreWork/dt,brakePower:brakeWork/dt,suspensionVelocity:corner.velocity,suspensionTravel:corner.travel,impactSpeed:corner.impactSpeed,impactCount:corner.impactCount});
  }
  if(Math.abs(v)<.035&&Math.abs(u)<.035&&Math.abs(yaw)<.04&&pedal<.04){v=u=yaw=0;}
  yaw=clamp(yaw,-2.6,2.6);
  this._accelLong+=(clamp((v-oldV)/dt,-35,35)-this._accelLong)*Math.min(1,dt*12);
  this._accelLat+=(clamp((u-oldU)/dt,-35,35)-this._accelLat)*Math.min(1,dt*12);
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
  s.tyreForceL=Jlong[2]/dt;s.tyreForceR=Jlong[3]/dt;s.differentialLock=mix(this.coastLock,this.powerLock,pedal)*mechanical.differentialLockFactor;
  s.diffSlipRPM=(wheels[3]-wheels[2])*60/TAU;s.diffTorque=Jdiff/dt;s.diffPower=Math.abs(Jdiff*(wheels[3]-wheels[2]))/dt;
  s.wheelSpinFL=s.wheelSpins[0];s.wheelSpinFR=s.wheelSpins[1];s.wheelSpinL=s.wheelSpins[2];s.wheelSpinR=s.wheelSpins[3];s.wheelSlipL=s.wheelSlip[2];s.wheelSlipR=s.wheelSlip[3];
  const rearSlipSpeed=Math.max(Math.abs(wheels[2]*this.wheelRadius-v),Math.abs(wheels[3]*this.wheelRadius-v));
  s.burnoutIntensity=clamp((rearSlipSpeed-2)/15,0,1)*clamp(1-s.speed/12,0,1);s.burnout=s.burnoutIntensity>.12;
  s.shiftProgress=clamp(this._shift/.19,0,1);s.engineClock=this.engine.getTiming().clock;
  this._updateCondition(dt,omega,{clutchWorkJ,gearboxWorkJ,differentialWorkJ:differentialDragJ+diffSlipJ,brakeWorkJ,tyreWorkJ});this._updateDebris(dt);this._publishCondition();
  return s;
 }
}
