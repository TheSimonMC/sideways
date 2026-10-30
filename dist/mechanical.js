/* Lumped vehicle thermals and component condition for the arcade chassis.
 * MotorLab remains the only combustion/crank solver. Its measured wall heat
 * and friction work feed these thermal masses; wheel/clutch work is supplied
 * by the constraint solver. Masses, thresholds and wear coefficients are
 * fictional vehicle calibration, not a reproduction of another simulator. */
import {UNDERBODY_PARTS,underbodyHealth,repairUnderbody,exhaustRoute} from './underbody.js';
import {createAuxiliaries,snapshotAuxiliaries,auxiliaryResponse,stepAuxiliaries,repairAuxiliary,AUXILIARY_PARTS} from './engine-auxiliaries.js';
import {createBrakeHydraulics,snapshotBrakeHydraulics,hydraulicFactors,stepBrakeHydraulics,BRAKE_CIRCUITS,BRAKE_FLUID_CAPACITY,brakePedalTravel,repairBrakeCircuit} from './brake-hydraulics.js';
import {createChassisDamage,snapshotChassisDamage,stepChassisDamage} from './chassis-damage.js';
import {createTyre,stepTyre,tyrePressure} from './tyres.js';
import {EXTERIOR_PARTS,exteriorMissing,exteriorLayout} from './exterior-damage.js';
import {BODY_PANELS,repairBody} from './body-damage.js';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,Number.isFinite(v)?v:a));
const smooth=v=>(v=clamp(v,0,1),v*v*(3-2*v));
const finite=(v,fallback=0)=>Number.isFinite(v)?v:fallback;
const AMBIENT=24,TAU=Math.PI*2;
export const CORNERS=['FL','FR','RL','RR'];
const CORNER_NAMES=['Front left','Front right','Rear left','Rear right'];
const PARTS={
 engineBlock:['Engine block','engine','engine'],cylinderHead:['Cylinder head','engine','engine'],connectingRods:['Connecting rods','engine','oil'],crankshaft:['Crankshaft','engine','oil'],timingDrive:['Timing chain','engine','oil'],
 intake:['Intake tract','engine',null],exhaust:['Exhaust manifold','engine',null],thermostat:['Thermostat','cooling','coolant'],fuelPump:['Fuel pump','engine',null],ignition:['Ignition coils and plugs','engine',null],
 pistons:['Pistons and rings','engine','engine'],bearings:['Crank bearings','engine','oil'],
 valvetrain:['Valvetrain','engine','engine'],headGasket:['Head gasket','engine','engine'],
 radiator:['Radiator','cooling','coolant'],waterPump:['Water pump','cooling','coolant'],
 oilPump:['Oil pump','lubrication','oil'],oilPan:['Oil pan','lubrication','oil'],
 clutch:['Clutch plate','drivetrain','clutch'],gearbox:['Gearbox bearings','drivetrain','gearbox'],
 differential:['Differential','drivetrain','differential'],driveshaft:['Driveshaft','drivetrain',null],
 frontDifferential:['AWD front differential','drivetrain','frontDifferential'],frontDriveshaft:['AWD front drive shafts','drivetrain',null],centerDifferential:['Center differential / transfer case','drivetrain','centerDifferential'],
 turbo:['Turbocharger','engine','turbo']
};
const REPAIR_GROUPS={engine:['pistons','bearings','valvetrain','headGasket','turbo','engineBlock','cylinderHead','connectingRods','crankshaft','timingDrive','intake','exhaust','fuelPump','ignition'],cooling:['radiator','waterPump','thermostat'],lubrication:['oilPump','oilPan'],drivetrain:['clutch','gearbox','differential','driveshaft','frontDifferential','frontDriveshaft','centerDifferential'],brakes:[...CORNERS.flatMap(c=>['brake'+c,'brakeLine'+c,'absValve'+c]),'masterCylinder0','masterCylinder1','brakeBooster','brakeFluidCondition0','brakeFluidCondition1'],tyres:CORNERS.map(c=>'tyre'+c),suspension:CORNERS.map(c=>'suspension'+c),body:['body']};
const HEALTH_KEYS=Object.keys(PARTS);
const AWD_PARTS=['frontDifferential','frontDriveshaft','centerDifferential'];
const INTERNAL_PARTS=['pistons','bearings','engineBlock','cylinderHead','crankshaft','valvetrain','connectingRods','timingDrive'];
const PISTON_ONLY=['valvetrain','connectingRods','timingDrive'];
const applicable=(build,id)=>!PISTON_ONLY.includes(id)||!build.engine.rotors;
const internalHealth=(build,h)=>Math.min(...INTERNAL_PARTS.filter(id=>applicable(build,id)).map(id=>h[id]),.2+.8*h.headGasket);
const INTERNAL_FAULTS={bearings:'Crank bearings seized',pistons:'Piston failure',engineBlock:'Engine block failure',cylinderHead:'Cylinder head failure',crankshaft:'Crankshaft failure',connectingRods:'Connecting rod failure',timingDrive:'Timing drive failure',valvetrain:'Valvetrain failure'};
const HEALTHY_FAULTS=new Set([...Object.values(INTERNAL_FAULTS),'Impact damage','Overrev damage','Engine failure','Piston failure','Crank bearings seized','Valvetrain failure']);

export function createMechanicalCondition(build,saved={},legacy={}){
 const engineHealth=clamp(finite(legacy.engineHealth,1),0,1),gearboxHealth=clamp(finite(legacy.gearboxHealth,1),0,1);
 const health=Object.fromEntries(HEALTH_KEYS.map(id=>[id,clamp(finite(saved.health?.[id],['pistons','bearings','valvetrain'].includes(id)?engineHealth:id==='gearbox'?gearboxHealth:1),0,1)]));
 // A legacy aggregate supplied by old saves/debug tools must not resurrect a
 // failed engine just because the newer nested state was not also replaced.
 if(engineHealth<Math.min(internalHealth(build,health),...INTERNAL_PARTS.map(id=>health[id]))-1e-9)health.pistons=engineHealth;
 // Inactive garage cars are sanitized before their fitted engine is loaded.
 // Keep their saved tank volumes until MechanicalSystem applies that build.
 const oilCapacity=clamp(finite(saved.oilCapacity,3.5+build.engine.displacementCc/1000*.75+(build.physics.oilCapacityExtra??0)),2,12),coolantCapacity=clamp(finite(saved.coolantCapacity,4+build.engine.displacementCc/1000*1.25+(build.physics.coolantCapacityExtra??0)),3,16);
 const initial={engine:90,coolant:84,oil:82,clutch:24,gearbox:24,differential:24,frontDifferential:24,centerDifferential:24,turbo:build.engine.turbo?100:24};
 const temperatures=Object.fromEntries(Object.entries(initial).map(([id,value])=>[id,clamp(finite(saved.temperatures?.[id],value),AMBIENT,id==='turbo'?1200:1200)]));
 temperatures.brakes=CORNERS.map((_,i)=>clamp(finite(saved.temperatures?.brakes?.[i],24),AMBIENT,1600));
 temperatures.tyres=CORNERS.map((_,i)=>clamp(finite(saved.temperatures?.tyres?.[i],24),AMBIENT,900));
 const gearHealth=Array.from({length:build.physics.gears.length+1},(_,i)=>clamp(finite(saved.gearHealth?.[i],1),0,1));
 if(gearboxHealth<Math.min(health.gearbox,gearHealth.reduce((a,b)=>a+b,0)/gearHealth.length)-1e-9)health.gearbox=gearboxHealth;
 const causes={};for(const id of [...HEALTH_KEYS,...gearHealth.map((_,i)=>i?'gear'+i:'gearR'),...CORNERS.flatMap(c=>['brake'+c,'tyre'+c,'suspension'+c])])if(typeof saved.causes?.[id]==='string')causes[id]=saved.causes[id].slice(0,140);
 const energy={};for(const key of ['clutchJ','gearboxJ','differentialJ','frontDifferentialJ','centerDifferentialJ','engineHeatJ','oilHeatJ'])energy[key]=clamp(finite(saved.energy?.[key]),0,1e15);
 energy.brakeJ=CORNERS.map((_,i)=>clamp(finite(saved.energy?.brakeJ?.[i]),0,1e15));energy.tyreJ=CORNERS.map((_,i)=>clamp(finite(saved.energy?.tyreJ?.[i]),0,1e15));
 return {version:6,auxiliaries:createAuxiliaries(saved.auxiliaries),chassisDamage:createChassisDamage(saved.chassisDamage),health,gearHealth,temperatures,oilCapacity,coolantCapacity,brakeHydraulics:createBrakeHydraulics(saved.brakeHydraulics),
  oilLitres:clamp(finite(saved.oilLitres,oilCapacity),0,oilCapacity),coolantLitres:clamp(finite(saved.coolantLitres,coolantCapacity),0,coolantCapacity),oilQuality:clamp(finite(saved.oilQuality,1),0,1),
  causes,energy,eventSequence:Math.round(clamp(finite(saved.eventSequence),0,1e12))};
}
export function snapshotMechanicalCondition(m){return {...m,auxiliaries:snapshotAuxiliaries(m.auxiliaries),chassisDamage:snapshotChassisDamage(m.chassisDamage),brakeHydraulics:snapshotBrakeHydraulics(m.brakeHydraulics),health:{...m.health},gearHealth:[...m.gearHealth],temperatures:{...m.temperatures,brakes:[...m.temperatures.brakes],tyres:[...m.temperatures.tyres]},causes:{...m.causes},energy:{...m.energy,brakeJ:[...m.energy.brakeJ],tyreJ:[...m.energy.tyreJ]}};}
export function validEngineFault(value){return HEALTHY_FAULTS.has(value)?value:'Engine failure';}

export class MechanicalSystem{
 constructor(build,condition,onEvent){
  this.build=build;this.condition=condition;this.m=condition.mechanical;this.onEvent=onEvent;
  this.m.oilCapacity=3.5+build.engine.displacementCc/1000*.75+(build.physics.oilCapacityExtra??0);this.m.coolantCapacity=4+build.engine.displacementCc/1000*1.25+(build.physics.coolantCapacityExtra??0);this.m.oilLitres=Math.min(this.m.oilLitres,this.m.oilCapacity);this.m.coolantLitres=Math.min(this.m.coolantLitres,this.m.coolantCapacity);
  this._warningLevels=new Map();this._diagnosticClock=0;this._lastSample={};this._revisionHealth={...this.m.health};
  this.effects={clutchCapacityFactor:1,driveCapacityFactor:1,differentialLockFactor:1,loadTorqueNm:0,misfire:0,boostFactor:1,oilPressureBar:0,coolantPressureBar:0,oilLeakLps:0,coolantLeakLps:0,steam:0,smoke:0,knock:0,clutchSlipPowerW:0};
  this.diagnostics={components:[],warnings:[],temperatures:this.m.temperatures};
  this.syncAggregates();this.refreshEffects(0,0);this.publish(true);
 }
 _event(component,code,severity,message){const event={id:++this.m.eventSequence,component,code,severity,message};this.onEvent?.(event);return event;}
 _damage(id,amount,reason){
  const h=this.m.health;if(!(amount>0)||!(id in h))return;
  if(reason==='Mechanical overrev'&&INTERNAL_PARTS.includes(id))amount/=this.build.physics.internalStrength??1;
  const before=h[id];h[id]=clamp(before-amount,0,1);if(before===h[id])return;
  if(amount>1e-7)this.m.causes[id]=reason;
  if(before>.025&&h[id]<=.025){h[id]=0;this._event(id,'failed','critical',PARTS[id][0]+' failed: '+reason.toLowerCase());this.condition.damageRevision++;}
  else if(before>.65&&h[id]<=.65){this._event(id,'damaged','warning',PARTS[id][0]+' damaged: '+reason.toLowerCase());this.condition.damageRevision++;}
  else if(this._revisionHealth[id]-h[id]>.025){this.condition.damageRevision++;this._revisionHealth[id]=h[id];}
 }
 _damageGear(index,amount,reason){
  if(!(amount>0))return;const before=this.m.gearHealth[index];this.m.gearHealth[index]=clamp(before-amount/(this.build.physics.drivetrainStrength??1),0,1);const id=index?'gear'+index:'gearR';this.m.causes[id]=reason;
  if(before>.025&&this.m.gearHealth[index]<=.025){this.m.gearHealth[index]=0;this._event(id,'stripped','critical',(index?'Gear '+index:'Reverse gear')+' stripped');}
  if(Math.floor(before*40)!==Math.floor(this.m.gearHealth[index]*40))this.condition.damageRevision++;
 }
 syncAggregates(){
  const c=this.condition,h=this.m.health;
  c.engineHealth=internalHealth(this.build,h);
  c.gearboxHealth=Math.min(h.gearbox,this.m.gearHealth.reduce((a,b)=>a+b,0)/this.m.gearHealth.length);
  if(PISTON_ONLY.some(id=>!applicable(this.build,id)&&c.engineFault===INTERNAL_FAULTS[id]))c.engineFault=null;
  const failed=Object.keys(INTERNAL_FAULTS).find(id=>applicable(this.build,id)&&h[id]<=.025);if(failed)c.engineFault=INTERNAL_FAULTS[failed];
  if(c.engineFault)c.engineHealth=0;
 }
 refreshEffects(gear,omega){
  const m=this.m,h=m.health,t=m.temperatures,e=this.effects,rpm=Math.abs(finite(omega))*60/TAU,rpmRatio=rpm/(this.build.physics.redlineRpm*(this.build.physics.safeRpmFactor??1));
  e.auxiliaries=auxiliaryResponse(m.auxiliaries,{...this._lastSample,omega,coolant:t.coolant,waterPump:h.waterPump,starterTorque:this._lastSample.starterTorque??this.build.engine.starterTorque,starterNoLoadRpm:this._lastSample.starterNoLoadRpm??this.build.engine.starterNoLoadRpm});
  e.brakeHydraulicFactors=hydraulicFactors(m.brakeHydraulics);e.brakePedalTravel=brakePedalTravel(m.brakeHydraulics,this._lastSample.brakePedal);
  const oilLevel=m.oilLitres/m.oilCapacity,hotThin=1-.72*smooth((t.oil-125)/85),oilFeed=smooth((oilLevel-.08)/.5)*h.oilPump*(.25+.75*m.oilQuality);
  const surge=1-clamp((Math.abs(finite(this._lastSample.lateralAcceleration))-6)/10,0,.65)*(1-smooth((oilLevel-.35)/.45))/(this.build.physics.oilSurgeProtection??1);
  e.oilPressureBar=clamp((.65+rpm/950)*oilFeed*hotThin*surge*(.35+.65*h.bearings)*smooth(rpm/400),0,5.5);
  e.coolantPressureBar=clamp((t.coolant-50)/55,0,1.3)*smooth(m.coolantLitres/m.coolantCapacity)*(.25+.75*h.radiator);
  const selected=gear<0?0:Math.round(clamp(gear,0,m.gearHealth.length-1)),gearHealth=gear===0?1:m.gearHealth[selected];
  const clutchFade=1-.82*smooth((t.clutch-240)/440);
  e.clutchCapacityFactor=h.clutch<=.025?0:clutchFade*(.08+.92*h.clutch);
  const awd=this.build.physics.driveLayout==='AWD';
  const driveHealth=awd?Math.min(h.gearbox,gearHealth,h.centerDifferential):Math.min(h.gearbox,gearHealth,h.differential,h.driveshaft);
  e.driveCapacityFactor=driveHealth<=.025?0:(.3+.7*Math.sqrt(driveHealth))*(1-.32*smooth((Math.max(t.gearbox,awd?t.centerDifferential:t.differential)-160)/120));
  e.differentialLockFactor=h.differential<=.025?0:h.differential*(1-.6*smooth((t.differential-140)/120));
  e.frontDifferentialLockFactor=h.frontDifferential<=.025?0:h.frontDifferential*(1-.6*smooth((t.frontDifferential-140)/120));
  e.centerDifferentialLockFactor=h.centerDifferential<=.025?0:h.centerDifferential*(1-.6*smooth((t.centerDifferential-140)/120));
  const branch=(health,temperature)=>health<=.025?0:(.3+.7*Math.sqrt(health))*(1-.32*smooth((temperature-160)/120));
  e.frontDriveCapacityFactor=branch(Math.min(h.frontDifferential,h.frontDriveshaft),t.frontDifferential);
  e.rearDriveCapacityFactor=branch(Math.min(h.differential,h.driveshaft),t.differential);
  const needPressure=clamp(.55+rpm/3500,.55,2.4),starvation=clamp(1-e.oilPressureBar/needPressure,0,1)*smooth(rpm/650);
  e.loadTorqueNm=(1-h.bearings)**2*(18+Math.abs(omega)*.055)+(1-h.pistons)**2*24+starvation*(6+Math.abs(omega)*.035)+(this.condition.engineFault?(h.bearings<=.025?950:210):0);
  const rods=this.build.engine.rotors?1:h.connectingRods,timing=this.build.engine.rotors?1:h.timingDrive;
  e.loadTorqueNm+=(1-h.crankshaft)**2*(12+Math.abs(omega)*.035)+(1-rods)**2*25;
  // A crushed exhaust raises pumping work; the SDK load channel owns this work.
  const routing=exhaustRoute(this.condition.bodyDamage);e.exhaustRouting=routing;
  e.exhaustLoadNm=Math.max(1-h.exhaust,routing.restriction)**2*(4+rpm*.003)*smooth(rpm/400);e.loadTorqueNm+=e.exhaustLoadNm;
  e.intakeFactor=.12+.88*h.intake;e.fuelAvailable=h.fuelPump>.025;e.ignitionAvailable=h.ignition>.025;
  e.lambdaOffset=(1-h.fuelPump)**2*.65;
  e.intakeLeak=(1-h.intake)*smooth(rpm/800);e.exhaustLeak=Math.max(1-h.exhaust,routing.leak)*smooth(rpm/800);
  e.misfire=clamp(Math.max(0,.65-h.pistons)*.8+Math.max(0,.65-h.valvetrain)*(this.build.engine.rotors?0:.65)+(1-h.headGasket)*.38+(1-h.engineBlock)*.25+(1-h.cylinderHead)*.3+(1-rods)*.25+(1-timing)**2*.65+(1-h.ignition)**2*.8+(1-h.fuelPump)**2*.3,0,.95);
  e.boostFactor=h.turbo<=.025?0:h.intake*h.turbo*(1-.45*smooth((t.turbo-850)/250));
  e.knock=clamp((1-h.bearings)*.8+(1-rods)*.55+(1-h.crankshaft)*.55+(1-timing)*.3+starvation*.65+smooth((rpmRatio-1.05)/.5)*.4,0,1)*smooth(rpm/400);
  e.smoke=clamp((1-h.pistons)*.7+(1-h.headGasket)*.5+(1-h.engineBlock)*.35+(1-h.cylinderHead)*.25+(this.build.engine.turbo?(1-h.turbo)*.35:0),0,1)*smooth(rpm/400);
  return e;
 }
 shift(beforeRatio,afterRatio,wheelOmega,engagement,gear,damageEnabled){
  if(!damageEnabled||gear===0||engagement<=.02)return;
  const mismatch=Math.abs((afterRatio-beforeRatio)*wheelOmega),strain=Math.max(0,mismatch-180);
  // Synchronizer/gear impact proxy from reflected input-shaft mismatch energy.
  // Opening the clutch removes the engine inertia from the shift load.
  const shockJ=.5*.018*strain*strain*engagement*engagement,index=gear<0?0:gear;
  if(shockJ<1)return;
  this._damageGear(index,shockJ/260000,'Shift under load');this._damage('gearbox',shockJ/950000,'Shift under load');
  const share=this.build.physics.driveLayout==='AWD'?this.build.physics.frontDriveShare:0;
  this._damage('driveshaft',shockJ*(1-share)/1600000,'Drivetrain shock');this._damage('differential',shockJ*(1-share)/2200000,'Drivetrain shock');
  if(share){this._damage('frontDriveshaft',shockJ*share/1600000,'Drivetrain shock');this._damage('frontDifferential',shockJ*share/2200000,'Drivetrain shock');this._damage('centerDifferential',shockJ/3000000,'Drivetrain shock');}
  this.m.temperatures.gearbox+=shockJ*.18/24000;this.m.energy.gearboxJ+=shockJ*.18;
  if(shockJ>1000)this._event(index?'gear'+index:'gearR','gear-grind','warning','Gear clash: clutch engaged during shift');
  this.syncAggregates();this.publish(true);
 }
 impact({damage,front,local,closing,severity}){
  const severityEngine=damage*(.12+.75*front)*clamp((closing-7)/17,0,1);
  this._damage('pistons',severityEngine,'Front impact');this._damage('bearings',severityEngine*.55,'Impact load');
  this._damage('engineBlock',severityEngine*.55,'Block cracked by impact');this._damage('cylinderHead',severityEngine*.35,'Head impact');this._damage('intake',damage*front*.9,'Intake crushed by impact');
  this._damage('exhaust',damage*front*.8,'Exhaust manifold impact');this._damage('fuelPump',damage*(1-front)*.3,'Rear impact');this._damage('ignition',severityEngine*.25,'Ignition impact');
  this._damage('gearbox',damage*.12,'Impact load');
  if(front>.5){const cooling=damage*front*1.2;this._damage('radiator',cooling,'Front impact');this._damage('waterPump',cooling*.25,'Front impact');this._damage('headGasket',severityEngine*.16,'Front impact');}
  const center=1-smooth((Math.abs(local.x)-.15)/1.2);
  if(front>.6&&closing>9){const shock=damage*center*front;this.m.chassisDamage.rack=clamp(this.m.chassisDamage.rack-shock*.8,0,1);const h=this.m.brakeHydraulics;h.booster=clamp(h.booster-shock*.35,0,1);for(let i=0;i<2;i++)h.master[i]=clamp(h.master[i]-shock*.3,0,1);}
  if(front>.6&&closing>9){const a=this.m.auxiliaries.health;for(const [id,factor] of [['radiatorFan',1.1],['alternator',.5],['beltTensioner',.7],['accessoryBelt',.8],['battery',.35]])a[id]=clamp(a[id]-damage*center*front*factor,0,1);}
  this._damage('oilPan',damage*center*(.22+.25*front),'Underbody impact');this._damage('oilPump',severityEngine*.16,'Impact load');
  const mainFront=this.build.physics.driveLayout==='FWD',mainLocation=mainFront?front:1-front;
  this._damage('driveshaft',damage*center*mainLocation*.55,'Underbody impact');this._damage('differential',damage*mainLocation*.45,mainFront?'Front impact':'Rear impact');
  if(this.build.physics.driveLayout==='AWD'){this._damage('frontDriveshaft',damage*center*front*.55,'Front impact');this._damage('frontDifferential',damage*front*.45,'Front impact');this._damage('centerDifferential',damage*center*.18,'Underbody impact');}
  if(this.build.engine.turbo)this._damage('turbo',severityEngine*.45,'Front impact');
  this.syncAggregates();if(this.condition.engineHealth<=.025)this.condition.engineFault='Impact damage';this.publish(true);
 }
 catastrophicOverrev(){this._damage('pistons',1,'Mechanical overrev');this.condition.engineFault='Overrev damage';this.syncAggregates();this.publish(true);}
 observe(gear,omega,speed=0){this._lastSample={...this._lastSample,gear,omega,speed};this.refreshEffects(gear,omega);return this.publish(true);}
 step(dt,sample={},damageEnabled=true){
  dt=clamp(dt,0,.05);if(!dt)return this.diagnostics;
  if(dt>1/120+1e-9){const n=Math.ceil(dt*120);for(let i=0;i<n;i++){const part={...sample};for(const key of ['wallHeatJ','frictionJ','extraFrictionJ','nosHeatJ','clutchWorkJ','gearboxWorkJ','differentialWorkJ','frontDifferentialWorkJ','centerDifferentialWorkJ'])part[key]=finite(sample[key])/n;for(const key of ['bearingWorkJ','brakeWorkJ','tyreWorkJ','tyreLockedWorkJ','tyreRollingWorkJ'])part[key]=(sample[key]||[0,0,0,0]).map(v=>v/n);this.step(dt/n,part,damageEnabled);}return this.diagnostics;}
  this._lastSample=sample;stepBrakeHydraulics(this.m.brakeHydraulics,dt,sample.brakePedal,damageEnabled,this.m.temperatures.brakes);stepChassisDamage(this.m.chassisDamage,dt,sample,damageEnabled);
  const m=this.m,h=m.health,t=m.temperatures,e=this.refreshEffects(sample.gear||0,finite(sample.omega)),rpm=Math.abs(finite(sample.omega))*60/TAU,speed=Math.abs(finite(sample.speed));
  stepAuxiliaries(m.auxiliaries,dt,e.auxiliaries,damageEnabled,speed);
  // Chassis hardware keeps its original torque rating after an engine/clutch
  // upgrade. A stronger clutch can therefore expose the next weak component.
  const ratedInput=({hachi:650,atlas:800,kitsune:480,vector:500}[this.build.vehicle.id]||650)*(this.build.physics.drivetrainStrength??1);
  const rpmRatio=rpm/(this.build.physics.redlineRpm*(this.build.physics.safeRpmFactor??1)),rotating=smooth(rpm/500),load=clamp(Math.abs(finite(sample.clutchTorque))/ratedInput,0,4);
  const engineC=this.build.engine.mass*.72*460,coolantC=4000+Math.max(.1,m.coolantLitres)*3600,oilC=8000+Math.max(.1,m.oilLitres)*1700;
  const engineJ=Math.max(0,finite(sample.wallHeatJ))*.72+Math.max(0,finite(sample.frictionJ))*.35+Math.max(0,finite(sample.extraFrictionJ))*.4+Math.max(0,finite(sample.nosHeatJ));
  const oilJ=Math.max(0,finite(sample.frictionJ))*.65+Math.max(0,finite(sample.extraFrictionJ))*.6;
  t.engine+=engineJ/engineC;t.oil+=oilJ/oilC;m.energy.engineHeatJ+=engineJ;m.energy.oilHeatJ+=oilJ;
  const exchange=(a,b,ca,cb,k)=>{const inverse=1/ca+1/cb,q=(t[a]-t[b])*(-Math.expm1(-k*inverse*dt))/inverse;t[a]-=q/ca;t[b]+=q/cb;};
  const cool=(id,c,k)=>{t[id]=AMBIENT+(t[id]-AMBIENT)*Math.exp(-k*dt/c);};
  const coolantFill=smooth(m.coolantLitres/m.coolantCapacity),pump=h.waterPump*e.auxiliaries.beltDrive*clamp(rpm/2400,.025,1),thermostat=smooth((t.coolant-80)/16)*smooth(h.thermostat/.8),fan=e.auxiliaries.fan;
  const scale=this.build.engine.mass/190;
  exchange('engine','coolant',engineC,coolantC,(100+4600*pump)*coolantFill*scale);
  exchange('engine','oil',engineC,oilC,(65+260*rotating)*smooth(m.oilLitres/m.oilCapacity));
  exchange('oil','coolant',oilC,coolantC,120*pump*coolantFill);
  cool('engine',engineC,18+speed*2.5);cool('oil',oilC,(14+speed*1.15)*(this.build.physics.oilCoolingFactor??1));
  cool('coolant',coolantC,(18+speed*18+fan*220)*h.radiator*thermostat*(.18+.82*pump)*scale*(this.build.physics.radiatorEfficiency??1));
  const clutchJ=Math.max(0,finite(sample.clutchWorkJ)),gearboxJ=Math.max(0,finite(sample.gearboxWorkJ)),diffJ=Math.max(0,finite(sample.differentialWorkJ));
  t.clutch+=clutchJ/12000;t.gearbox+=gearboxJ/24000;t.differential+=diffJ/18000;
  m.energy.clutchJ+=clutchJ;m.energy.gearboxJ+=gearboxJ;m.energy.differentialJ+=diffJ;e.clutchSlipPowerW=clutchJ/dt;
  if(this.build.physics.driveLayout==='AWD')for(const [id,capacity]of [['frontDifferential',15000],['centerDifferential',17000]]){const work=Math.max(0,finite(sample[id+'WorkJ']));t[id]+=work/capacity;m.energy[id+'J']+=work;cool(id,capacity,14+speed*2.4);if(damageEnabled)this._damage(id,work/5e8*40*smooth((t[id]-150)/120),'Differential overheating');}
  cool('clutch',12000,90+speed*3);cool('gearbox',24000,18+speed*3);cool('differential',18000,14+speed*2.6);
  if(this.build.engine.turbo){const exhaustC=clamp(finite(sample.exhaustC,AMBIENT),AMBIENT,1500),gasConductance=Math.min(90,Math.abs(finite(sample.exhaustFlow))*70),q=(exhaustC-t.turbo)*(-Math.expm1(-gasConductance*dt/3600))*3600;t.turbo+=q/3600;exchange('turbo','oil',3600,oilC,12*rotating*h.oilPump);cool('turbo',3600,2+speed*.10);}
  for(let i=0;i<4;i++){
   const brakeJ=Math.max(0,finite(sample.brakeWorkJ?.[i])),tyreJ=Math.max(0,finite(sample.tyreWorkJ?.[i])),rollingJ=Math.max(0,finite(sample.tyreRollingWorkJ?.[i]));
   t.brakes[i]=AMBIENT+(t.brakes[i]+brakeJ/4300-AMBIENT)*Math.exp(-dt*(.012+speed*.0017));
   t.tyres[i]=AMBIENT+(t.tyres[i]+(tyreJ+rollingJ)/9500-AMBIENT)*Math.exp(-dt*(.016+speed*.0008+clamp(finite(sample.tyreWetness?.[i]),0,1)*(.025+speed*.0015)));
   t.brakes[i]=clamp(t.brakes[i],AMBIENT,1600);t.tyres[i]=clamp(t.tyres[i],AMBIENT,900);
   m.energy.brakeJ[i]+=brakeJ;m.energy.tyreJ[i]+=tyreJ+rollingJ;
   if(damageEnabled){
    const beforeBrake=this.condition.brakeHealth[i],beforeTyre=this.condition.wheelHealth[i];
    this.condition.brakeHealth[i]=clamp(beforeBrake-brakeJ/1.8e9*(1+30*smooth((t.brakes[i]-650)/400)),0,1);
    this.condition.wheelHealth[i]=clamp(beforeTyre-tyreJ/90e6*(1+18*smooth((t.tyres[i]-150)/150)),0,1);
    if(beforeBrake!==this.condition.brakeHealth[i])m.causes['brake'+CORNERS[i]]=t.brakes[i]>650?'Brake overheating':'Pad wear';
    if(beforeTyre!==this.condition.wheelHealth[i])m.causes['tyre'+CORNERS[i]]=t.tyres[i]>150?'Tyre overheating':'Tread wear';

   }
   const tyre=this.condition.tyres[i],burst=stepTyre(tyre,{dt,temperature:t.tyres[i],tread:this.condition.wheelHealth[i],slipWork:tyreJ,lockedWork:sample.tyreLockedWorkJ?.[i],rollingWork:sample.tyreRollingWorkJ?.[i],speed:sample.tyreSpeeds?.[i]??speed,load:sample.tyreLoads?.[i]??0,angle:sample.tyreAngles?.[i]??0,attached:this.condition.wheelAttached[i],enabled:damageEnabled});
   if(burst){m.causes['tyre'+CORNERS[i]]='Casing rupture / tread worn through';this.condition.damageRevision++;this._event('tyre'+CORNERS[i],'tyre-blowout','critical',CORNER_NAMES[i]+' tyre burst');}
  }
  e.oilLeakLps=.02*(1-h.engineBlock)**2+.035*(1-h.oilPan)**2+.003*(1-h.pistons)**2*rotating+(this.build.engine.turbo?.004*(1-h.turbo)**2*rotating:0);
  e.coolantLeakLps=.025*(1-h.engineBlock)**2+.018*(1-h.cylinderHead)**2+.055*(1-h.radiator)**2+.012*(1-h.waterPump)**2+.018*(1-h.headGasket)**2*rotating;
  e.oilLeakLps=Math.min(e.oilLeakLps,m.oilLitres/dt);e.coolantLeakLps=Math.min(e.coolantLeakLps,m.coolantLitres/dt);
  const boilPoint=104+e.coolantPressureBar*12;
  const boilJ=Math.max(0,(t.coolant-boilPoint)*coolantC),boilLitres=Math.min(Math.max(0,m.coolantLitres-e.coolantLeakLps*dt),boilJ/2.26e6);
  if(damageEnabled){m.coolantLitres=clamp(m.coolantLitres-e.coolantLeakLps*dt-boilLitres,0,m.coolantCapacity);m.oilLitres=clamp(m.oilLitres-e.oilLeakLps*dt,0,m.oilCapacity);m.oilQuality=clamp(m.oilQuality-dt*.0005*Math.max(0,(t.oil-145)/50)**2,0,1);}
  if(boilLitres>0)t.coolant-=boilLitres*2.26e6/coolantC;
  e.steam=clamp(boilLitres/dt*18+e.coolantLeakLps*smooth((t.coolant-75)/30)*10,0,1);
  if(damageEnabled){
   const needPressure=clamp(.55+rpm/3500,.55,2.4),starvation=clamp(1-e.oilPressureBar/needPressure,0,1)*rotating;
   // Inertial loads grow with angular speed squared. Fuel cut does not appear
   // in this path: a mechanically driven crank can still exceed the redline.
   const excess=Math.max(0,rpmRatio*rpmRatio-1.06**2),backwards=finite(sample.omega)<-25?clamp(rpmRatio,0,1):0;
   if(!this.build.engine.rotors)this._damage('valvetrain',dt*(excess*excess*.23+backwards*.025),'Mechanical overrev');
   this._damage('pistons',dt*(excess*excess*.075+backwards*.055+Math.max(0,(t.engine-155)/65)**2*.012*rotating),excess>0?'Mechanical overrev':backwards?'Crank driven backwards':'Piston overheating');
   this._damage('bearings',dt*(excess*excess*.035+starvation*starvation*(.012+.075*rpmRatio+.025*load)+Math.max(0,(t.oil-155)/65)**2*.006*rotating),starvation>.1?'Low oil pressure':excess>0?'Mechanical overrev':'Oil overheating');
   const overheat=Math.max(0,(t.engine-145)/65)**2,overloadInternal=Math.max(0,load-1.15)/(this.build.physics.internalStrength??1);
   this._damage('engineBlock',dt*overheat*.003*rotating,'Block heat distortion');this._damage('cylinderHead',dt*overheat*.009*rotating,'Head heat distortion');
   this._damage('crankshaft',dt*(excess*excess*.025+starvation*starvation*.015*rotating+overloadInternal**2*.004*rotating),excess>0?'Mechanical overrev':starvation>.1?'Low oil pressure':'Crankshaft overloaded');
   if(!this.build.engine.rotors){
    this._damage('connectingRods',dt*(excess*excess*.09+overloadInternal**2*.008*rotating),excess>0?'Mechanical overrev':'Connecting rods overloaded');
    this._damage('timingDrive',dt*(excess*excess*.012+starvation*starvation*.006*rotating),excess>0?'Mechanical overrev':'Timing chain oil starvation');
    if(h.timingDrive<=.025){this._damage('valvetrain',dt*.8*rotating,'Lost valve timing');this._damage('pistons',dt*.12*rotating,'Valve contact');}
    if(h.connectingRods<=.025)this._damage('engineBlock',dt*.4*rotating,'Broken connecting rod');
   }
   this._damage('thermostat',dt*Math.max(0,(t.coolant-120)/65)**2*.002,'Thermostat overheated');
   this._damage('ignition',dt*overheat*.005*rotating,'Ignition overheated');
   this._damage('fuelPump',dt*(finite(sample.fuelLitres,10)<.25?1:0)*rotating*.0005,'Fuel pump running dry');
   this._damage('headGasket',dt*Math.max(0,(t.engine-129)/55)**2*.014*rotating,'Engine overheating');
   this._damage('oilPump',dt*excess*excess*.008,'Mechanical overrev');this._damage('waterPump',dt*excess*excess*.006,'Mechanical overrev');
   const clutchWear=clutchJ/80e6*(1+22*smooth((t.clutch-270)/420));this._damage('clutch',clutchWear,t.clutch>270?'Clutch overheating':'Clutch slip wear');
   this._damage('gearbox',gearboxJ/6e8*35*smooth((t.gearbox-150)/120),'Gearbox overheating');
   this._damage('differential',diffJ/5e8*40*smooth((t.differential-150)/120),'Differential overheating');
   const overload=Math.max(0,load-1.15);
   if(this.build.physics.driveLayout==='AWD'){for(const [a,id,rating]of [[0,'frontDriveshaft',this.build.physics.frontShaftCapacity],[1,'driveshaft',this.build.physics.rearShaftCapacity]]){const strain=Math.max(0,Math.abs(finite(sample.axleTorques?.[a]))/(rating*(this.build.physics.drivetrainStrength??1))-.82);this._damage(id,dt*strain*strain*.025,'Driveshaft overloaded');}}
   else this._damage('driveshaft',dt*overload*overload*.025,'Driveshaft overloaded');
   if(Math.abs(sample.gear)>0)this._damageGear(sample.gear<0?0:sample.gear,dt*(overload*overload*.018+excess*excess*load*.003),'Gear teeth overloaded');
   if(this.build.engine.turbo)this._damage('turbo',dt*(starvation*starvation*.075*smooth(finite(sample.turboRpm)/80000)+Math.max(0,(t.turbo-850)/220)**2*.01),'Turbo bearing damage');
  }
  for(const key of ['engine','coolant','oil','clutch','gearbox','differential','frontDifferential','centerDifferential','turbo'])t[key]=clamp(t[key],AMBIENT,1200);
  this.syncAggregates();this.refreshEffects(sample.gear||0,finite(sample.omega));
  this._diagnosticClock+=dt;this.publish(false);return this.diagnostics;
 }
 publish(force=false){
  if(!force&&this._diagnosticClock<.05)return this.diagnostics;this._diagnosticClock=0;
  const m=this.m,h=m.health,t=m.temperatures,c=this.condition,e=this.effects,components=[],warnings=[],rpm=Math.abs(finite(this._lastSample.omega))*60/TAU;
  const add=(id,label,group,health,temperature,applicable=true)=>{
   let status=!applicable?'unavailable':health<=.025?'failed':health<.25?'critical':health<.75?'worn':'ok';
   const limits=id==='clutch'?[270,430]:id.startsWith('brake')?[620,850]:id.startsWith('tyre')?[150,240]:id==='turbo'?[850,1050]:group==='engine'?[125,155]:group==='lubrication'?[135,165]:group==='cooling'?[108,118]:[145,195];
   if(applicable&&temperature!=null&&temperature>limits[0]&&status!=='failed')status=temperature>limits[1]?'critical':status==='ok'?'hot':status;
   const reason=!applicable?'Not fitted':m.causes[id]|| (status==='hot'||status==='critical'&&temperature>limits[0]?'Temperature too high':status==='failed'?'Component failed':status==='worn'?'Component wear':'');
   components.push({id,label,group,health,temperature:temperature??null,status,reason,applicable});
  };
  for(const [id,[label,group,temp]]of Object.entries(PARTS)){const axle=this.build.physics.driveLayout==='FWD'?'Front':'Rear',name=id==='differential'?axle+' differential':id==='driveshaft'?axle+' drive shafts':this.build.engine.rotors?(id==='pistons'?'Rotors and apex seals':id==='headGasket'?'Housing seals':id==='engineBlock'?'Rotor housing':id==='cylinderHead'?'Side housings':id==='crankshaft'?'Eccentric shaft':label):label;add(id,name,group,h[id],temp?t[temp]:null,AWD_PARTS.includes(id)?this.build.physics.driveLayout==='AWD':id==='turbo'?!!this.build.engine.turbo:applicable(this.build,id));}
  for(const [id,label] of Object.entries(AUXILIARY_PARTS)){const a=m.auxiliaries,temp={accessoryBelt:'belt',alternator:'alternator',starterMotor:'starter'}[id];add(id,label,id==='radiatorFan'?'cooling':'engine',a.health[id],temp?a.temperatures[temp]:null);if(id==='accessoryBelt'&&a.health[id]<=.025)components.at(-1).reason='No alternator or water-pump drive';if(id==='beltTensioner'&&a.health[id]<.75)components.at(-1).reason='Belt slips under accessory load';}
  add('batteryCharge','Battery charge','engine',m.auxiliaries.charge,null);Object.assign(components.at(-1),{status:m.auxiliaries.charge<=.002?'empty':m.auxiliaries.charge<.15?'low':'charge',action:'CHARGE',serviceNeeded:m.auxiliaries.charge<.999&&m.auxiliaries.health.battery>.025,reason:Math.round(m.auxiliaries.charge*100)+'% · '+e.auxiliaries.voltage.toFixed(1)+' V · '+e.auxiliaries.netA.toFixed(1)+' A'+(m.auxiliaries.health.battery<=.025?' · Replace failed battery':'')});
  m.gearHealth.forEach((health,i)=>add(i?'gear'+i:'gearR',i?'Gear '+i:'Reverse gear','drivetrain',health,t.gearbox));
  for(let i=0;i<4;i++){add('brake'+CORNERS[i],CORNER_NAMES[i]+' brake','chassis',c.brakeHealth[i],t.brakes[i]);const tyre=c.tyres[i],pressure=tyrePressure(tyre,t.tyres[i]);add('tyre'+CORNERS[i],CORNER_NAMES[i]+' tyre','chassis',tyre.blown?0:Math.min(c.wheelHealth[i],tyre.carcass,1-tyre.flatspot,pressure/2.3),t.tyres[i]);Object.assign(components.at(-1),{pressureBar:pressure,carcass:tyre.carcass,flatspot:tyre.flatspot,reason:tyre.blown?'Blowout: replace tyre':tyre.punctured?'Puncture: leaking air':tyre.flatspot>.05?'Flat spot from locked-wheel sliding':components.at(-1).reason});add('suspension'+CORNERS[i],CORNER_NAMES[i]+' suspension','chassis',c.suspensionHealth[i],null);}
  for(let i=0;i<4;i++){const health=m.brakeHydraulics.lines[i];add('brakeLine'+CORNERS[i],CORNER_NAMES[i]+' brake line','chassis',health,null);if(health<.999)components.at(-1).reason='Hydraulic leak; diagonal circuit loses pressure';}
  for(let i=0;i<2;i++){const h=m.brakeHydraulics,fill=h.fluid[i],pair=BRAKE_CIRCUITS[i],leak=pair.some(c=>h.lines[c]<.999);add('brakeFluid'+i,'Brake fluid '+(i?'FR / RL':'FL / RR'),'chassis',fill/BRAKE_FLUID_CAPACITY,null);components.at(-1).reason=fill.toFixed(2)+' / '+BRAKE_FLUID_CAPACITY.toFixed(2)+' L'+(leak?' · Repair leaking line before refill':'');}
  const cd=m.chassisDamage,bh=m.brakeHydraulics;
  for(let i=0;i<4;i++){const b=cd.bearings[i];add('wheelBearing'+CORNERS[i],CORNER_NAMES[i]+' wheel bearing','chassis',b.health,b.temperature);components.at(-1).reason=b.health<=.025?'Bearing seized':b.health<.999?'Friction, heat and wheel play':'';add('absValve'+CORNERS[i],CORNER_NAMES[i]+' ABS channel','chassis',bh.absValves[i],null,!!this.build.physics.abs);if(bh.absValves[i]<=.25)components.at(-1).reason='ABS release unavailable; hydraulic braking remains';}
  add('steeringRack','Steering rack','chassis',cd.rack,null);components.at(-1).reason=cd.rack<=.025?'Rack seized at its current angle':cd.rack<.999?'Backlash and reduced steering response':'';
  for(let i=0;i<2;i++){const rod=cd.tieRods[i];add('tieRod'+CORNERS[i],CORNER_NAMES[i]+' tie rod','chassis',Math.min(rod.health,1-Math.abs(rod.bend)),null);components.at(-1).reason=rod.health<=.025?'Broken: wheel no longer follows the rack':Math.abs(rod.bend)>.001?'Bent '+(rod.bend*180/Math.PI).toFixed(1)+' degrees':'';}
  add('brakeBooster','Brake booster','chassis',bh.booster,null);if(bh.booster<.999)components.at(-1).reason='Less brake assistance for the same pedal input';
  for(let i=0;i<2;i++){
   const circuit=i?'FR / RL':'FL / RR';add('masterCylinder'+i,'Master cylinder '+circuit,'chassis',bh.master[i],null);if(bh.master[i]<.999)components.at(-1).reason='Internal seal leakage reduces circuit pressure';
   add('brakeFluidCondition'+i,'Fluid condition '+circuit,'chassis',bh.quality[i],bh.temperature[i]);Object.assign(components.at(-1),{action:'CHANGE',serviceNeeded:bh.quality[i]<.999,reason:'Boils at '+Math.round(240-85*(1-bh.quality[i]))+'°C · vapour '+Math.round(bh.vapour[i]*100)+'%'});
   add('brakeBleed'+i,'Bleed circuit '+circuit,'chassis',1-bh.air[i],null);Object.assign(components.at(-1),{action:'BLEED',serviceNeeded:bh.air[i]>.001&&bh.fluid[i]>.03,reason:bh.fluid[i]<=.03?'Refill fluid before bleeding':bh.air[i]>.001?'Trapped air: refill alone cannot restore pressure':'No trapped air'});
  }
  add('body','Body structure','chassis',c.bodyHealth,null);
  for(const [id,panel]of Object.entries(BODY_PANELS)){const zone=c.bodyDamage?.zones[id];if(zone&&(id!=='spoiler'||this.build.selection.spoiler!=='none')){add('panel:'+id,panel.label,'chassis',Math.min(zone.health,zone.mounts??1,zone.latch??1),null);const row=components.at(-1);if(zone.detached){row.status='failed';row.reason='Panel detached';}else{row.reason=[zone.latch<.08?'Latch broken':zone.open?'Open':null,zone.mounts<.75?'Mounts '+Math.round(zone.mounts*100)+'%':null,zone.crush>.01?Math.round(zone.crush*100)+' cm local crush':null].filter(Boolean).join(' · ');}}}
  for(const [id,part]of Object.entries(exteriorLayout(this.build))){const p=c.bodyDamage?.exterior?.[id];if(!p||part.mass<=0)continue;add('exterior:'+id,part.label,'chassis',Math.min(p.health,p.mounts,1-p.scratches*.4),null);const row=components.at(-1);row.reason=exteriorMissing(c.bodyDamage,id)?(p.detached?'Missing / shattered':'Mounting assembly missing'):part.kind==='lamp'&&p.health<=.25?'Lamp circuit broken':p.cracked?'Cracked':p.scratches>.015?'Surface scraped':'';if(exteriorMissing(c.bodyDamage,id))row.status='failed';}
  for(const [id,d]of Object.entries(UNDERBODY_PARTS)){const part=c.bodyDamage?.underbody?.[id];add('underbody:'+id,d.label,d.kind==='pipe'?'engine':'chassis',underbodyHealth(part),null);const row=components.at(-1);row.reason=part?.detached?'Assembly missing':part?.crush>.01?'Crush '+Math.round(part.crush*100)+'% · mounts '+Math.round(part.mounts*100)+'%':part?.mounts<.99?'Mounts '+Math.round(part.mounts*100)+'%':'';}
  const warn=(id,label,severity,reason)=>warnings.push({id,label,severity,reason});
  for(const [id,d]of Object.entries(UNDERBODY_PARTS))if(c.bodyDamage?.underbody?.[id]?.detached)warn('mount-'+id,d.label+' missing',d.kind==='pipe'?'warning':'critical','Replace this assembly; other damaged components need separate repairs');
  for(let i=0;i<4;i++){const tyre=c.tyres[i],pressure=tyrePressure(tyre,t.tyres[i]);if(!c.wheelAttached[i])warn('wheel-'+CORNERS[i],CORNER_NAMES[i]+' wheel missing','critical','Replace the wheel assembly');else if(tyre.blown||pressure<1.5)warn('tyre-'+CORNERS[i],CORNER_NAMES[i]+(tyre.blown?' tyre burst':' tyre pressure low'),tyre.blown||pressure<.6?'critical':'warning',pressure.toFixed(1)+' bar; replace the damaged tyre');}

  for(let i=0;i<2;i++){const pair=BRAKE_CIRCUITS[i],factor=e.brakeHydraulicFactors[pair[0]];if(factor<.8)warn('brake-hydraulic-'+i,'Brake circuit '+(i?'FR / RL':'FL / RR')+(factor<=.01?' failed':' pressure loss'),factor<.25?'critical':'warning','Inspect lines, fluid, master cylinder and booster; cool boiling fluid and bleed trapped air');}
  if(cd.rack<.75)warn('rack-fault','Steering rack '+(cd.rack<=.025?'seized':'damaged'),cd.rack<=.025?'critical':'warning','Replace the rack');
  for(let i=0;i<4;i++){if(cd.bearings[i].health<.75)warn('bearing-'+i,CORNER_NAMES[i]+' wheel bearing '+(cd.bearings[i].health<=.025?'seized':'damaged'),cd.bearings[i].health<.25?'critical':'warning','Replace this bearing');if(this.build.physics.abs&&bh.absValves[i]<=.25)warn('abs-'+i,CORNER_NAMES[i]+' ABS unavailable','warning','Replace this ABS channel');if(i<2&&cd.tieRods[i].health<.75)warn('tie-rod-'+i,CORNER_NAMES[i]+' tie rod '+(cd.tieRods[i].health<=.025?'broken':'bent'),cd.tieRods[i].health<=.025?'critical':'warning','Replace this tie rod');}
  for(const [id,label] of Object.entries(AUXILIARY_PARTS))if(m.auxiliaries.health[id]<.75)warn(id+'-fault',label+(m.auxiliaries.health[id]<=.025?' failed':' damaged'),m.auxiliaries.health[id]<=.025?'critical':'warning','Inspect and replace this component');
  if(m.auxiliaries.charge<.15||!e.auxiliaries.ignition)warn('battery-low','Battery low',!e.auxiliaries.ignition?'critical':'warning','Charge the battery and check the belt and alternator');
  if(rpm>900&&e.auxiliaries.netA<-.5)warn('charging-fault','Battery discharging','warning','Check belt tension and alternator output');
  for(const id of ['engineBlock','cylinderHead','connectingRods','crankshaft','timingDrive','intake','exhaust','thermostat','fuelPump','ignition'])if(applicable(this.build,id)&&h[id]<.75)warn(id+'-fault',PARTS[id][0]+(h[id]<=.025?' failed':' damaged'),h[id]<=.025?'critical':'warning','Inspect and replace this component');
  if(c.engineFault)warn('engine-failure',c.engineFault,'critical','Repair the failed engine components');
  if(rpm>700&&e.oilPressureBar<.55)warn('oil-pressure','Low oil pressure','critical','Stop the engine to protect the bearings');
  if(m.oilLitres<m.oilCapacity*.45)warn('oil-level','Oil level low',m.oilLitres<m.oilCapacity*.18?'critical':'warning',e.oilLeakLps>.001||h.oilPan<.7?'Oil leak: repair the source and refill':'Refill engine oil');
  if(m.coolantLitres<m.coolantCapacity*.55)warn('coolant-level','Coolant level low',m.coolantLitres<m.coolantCapacity*.2?'critical':'warning',e.coolantLeakLps>.001||h.radiator<.7||h.waterPump<.5||h.headGasket<.5?'Coolant leak: repair the source and refill':'Refill coolant');
  if(t.coolant>108||t.engine>125)warn('engine-temperature','Engine overheating',t.engine>150?'critical':'warning','Reduce load and check the cooling system');
  if(t.oil>135)warn('oil-temperature','Oil temperature high',t.oil>165?'critical':'warning','Reduce load and check oil level');
  if(t.clutch>270)warn('clutch-temperature','Clutch overheating',t.clutch>430?'critical':'warning','Release the clutch fully or select neutral');
  if(t.gearbox>150)warn('gearbox-temperature','Gearbox overheating',t.gearbox>195?'critical':'warning','Reduce drivetrain load');
  if(this.build.physics.driveLayout==='AWD')for(const id of AWD_PARTS){if(h[id]<=.025)warn(id+'-failure',PARTS[id][0]+' failed','critical','Repair this drivetrain component');else if(t[id]>150)warn(id+'-temperature',PARTS[id][0]+' overheating',t[id]>195?'critical':'warning','Reduce drivetrain slip and load');}
  if(this.build.physics.driveLayout==='AWD'&&e.rearDriveCapacityFactor===0)warn('rear-drive-failure','Rear drive disconnected','critical','Repair the rear differential or drive shafts');
  if(t.differential>150)warn('diff-temperature','Differential overheating',t.differential>195?'critical':'warning','Reduce wheelspin and let it cool');
  if(Math.max(...t.brakes)>620)warn('brake-temperature','Brake fade',Math.max(...t.brakes)>850?'critical':'warning','Braking force falls while the brakes are hot');
  if(Math.max(...t.tyres)>150)warn('tyre-temperature','Tyres overheating',Math.max(...t.tyres)>240?'critical':'warning','Grip is reduced and tread wear is increasing');
  if(rpm/(this.build.physics.redlineRpm*(this.build.physics.safeRpmFactor??1))>1.08)warn('mechanical-overrev','Mechanical overrev','critical','Open the clutch or select a higher gear');
  if(e.driveCapacityFactor===0)warn('drive-failure','Drive disconnected','critical','Repair the failed gear, differential or driveshaft');
  if(h.clutch<=.025)warn('clutch-failure','Clutch worn out','critical','Replace the clutch plate');
  const now=new Map(warnings.map(w=>[w.id,w.severity]));
  for(const w of warnings)if(this._warningLevels.get(w.id)!==w.severity)this._event(w.id,'warning',w.severity,w.label+': '+w.reason.toLowerCase());
  this._warningLevels=now;
  Object.assign(this.diagnostics,{components,warnings,temperatures:t,chassisDamage:snapshotChassisDamage(m.chassisDamage),brakeHydraulics:snapshotBrakeHydraulics(m.brakeHydraulics),oilLitres:m.oilLitres,oilCapacity:m.oilCapacity,coolantLitres:m.coolantLitres,coolantCapacity:m.coolantCapacity,oilQuality:m.oilQuality,...e,lastEventId:m.eventSequence});
  return this.diagnostics;
 }
 repair(ids=[]){
  const selected=new Set();for(const id of Array.isArray(ids)?ids:[ids]){for(const item of REPAIR_GROUPS[id]||[id])selected.add(item);if(id==='drivetrain')for(let i=0;i<this.m.gearHealth.length;i++)selected.add(i?'gear'+i:'gearR');}
  const m=this.m,c=this.condition,repaired=[];
  for(const id of selected){
   if(!applicable(this.build,id)||AWD_PARTS.includes(id)&&this.build.physics.driveLayout!=='AWD')continue;
   if(id==='fluids'){m.oilLitres=m.oilCapacity;m.coolantLitres=m.coolantCapacity;m.oilQuality=1;m.brakeHydraulics.fluid.fill(BRAKE_FLUID_CAPACITY);repaired.push(id);continue;}
   if(id.startsWith('underbody:')){const key=id.slice(10),d=UNDERBODY_PARTS[key];if(d&&repairUnderbody(c.bodyDamage,key)){if(d.kind==='strut')c.suspensionHealth[d.corner]=1;if(d.kind==='rod')m.chassisDamage.tieRods[d.corner]={health:1,bend:0};repaired.push(id);}continue;}
   if(repairAuxiliary(m.auxiliaries,id)){repaired.push(id);continue;}
   if(id in m.health){m.health[id]=1;delete m.causes[id];const temp=PARTS[id][2];if(temp&&!['engine','oil','coolant'].includes(temp))m.temperatures[temp]=AMBIENT;this._revisionHealth[id]=1;repaired.push(id);continue;}
   const gear=/^gear(R|[1-9])$/.exec(id);if(gear){const index=gear[1]==='R'?0:Number(gear[1]);if(index<m.gearHealth.length){m.gearHealth[index]=1;delete m.causes[id];repaired.push(id);}continue;}
   if(repairBrakeCircuit(m.brakeHydraulics,id)){repaired.push(id);continue;}
   if(id==='steeringRack'){m.chassisDamage.rack=1;repaired.push(id);continue;}
   let chassisCorner=CORNERS.findIndex(v=>id==='wheelBearing'+v);if(chassisCorner>=0){m.chassisDamage.bearings[chassisCorner]={health:1,temperature:24,workJ:0};repaired.push(id);continue;}
   chassisCorner=CORNERS.slice(0,2).findIndex(v=>id==='tieRod'+v);if(chassisCorner>=0){m.chassisDamage.tieRods[chassisCorner]={health:1,bend:0};repairUnderbody(c.bodyDamage,'tieRod'+CORNERS[chassisCorner]);repaired.push(id);continue;}
   chassisCorner=CORNERS.findIndex(v=>id==='absValve'+v);if(chassisCorner>=0&&this.build.physics.abs){m.brakeHydraulics.absValves[chassisCorner]=1;repaired.push(id);continue;}
   if(/^brakeFluid[01]$/.test(id)){m.brakeHydraulics.fluid[Number(id.at(-1))]=BRAKE_FLUID_CAPACITY;repaired.push(id);continue;}
   let corner=CORNERS.findIndex(v=>id==='brakeLine'+v);if(corner>=0){m.brakeHydraulics.lines[corner]=1;repaired.push(id);continue;}
   corner=CORNERS.findIndex(v=>id==='brake'+v);if(corner>=0){c.brakeHealth[corner]=1;m.temperatures.brakes[corner]=AMBIENT;delete m.causes[id];repaired.push(id);continue;}
   corner=CORNERS.findIndex(v=>id==='tyre'+v);if(corner>=0){c.wheelHealth[corner]=1;c.tyres[corner]=createTyre();c.wheelAttached[corner]=true;m.temperatures.tyres[corner]=AMBIENT;delete m.causes[id];repaired.push(id);continue;}
   corner=CORNERS.findIndex(v=>id==='suspension'+v);if(corner>=0){c.suspensionHealth[corner]=1;c.wheelToe[corner]=0;repairUnderbody(c.bodyDamage,'strut'+CORNERS[corner]);delete m.causes[id];repaired.push(id);continue;}
   if(id==='body'){c.bodyHealth=1;if(c.bodyDamage)repairBody(c.bodyDamage);repaired.push(id);}
   else if((id.startsWith('panel:')||id.startsWith('exterior:'))&&c.bodyDamage&&repairBody(c.bodyDamage,id))repaired.push(id);
  }
  if(repaired.length){
   c.damageRevision++;const essentialHealthy=internalHealth(this.build,m.health)>.025;
   if(essentialHealthy&&repaired.some(id=>REPAIR_GROUPS.engine.includes(id)))c.engineFault=null;this.syncAggregates();
   this._warningLevels.clear();this.refreshEffects(this._lastSample.gear||0,finite(this._lastSample.omega));this.publish(true);
  }
  return repaired;
 }
}
