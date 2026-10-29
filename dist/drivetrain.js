const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const mix=(a,b,t)=>a+(b-a)*t;
export const DRIVE_PARTS={
 driveKit:[
  {id:'stock',name:'FACTORY RWD',description:'Original rear-wheel drive hardware and weight.'},
  {id:'fwd',name:'FRONT TRANSAXLE KIT',description:'Vector GT with I4 or V6 only. Drives the front wheels; adds 18 kg. The axle differential moves to the front.'},
  {id:'awd',name:'AWD CONVERSION',description:'Hachi, Kitsune and Vector; excludes V10/V12. Adds 72 kg, front drive shafts and an open 40:60 center differential.'}
 ],
 frontDifferential:[
  {id:'open',name:'OPEN FRONT DIFF',description:'Included with AWD. Equal torque to the front wheels; a slipping wheel limits traction.'},
  {id:'lsd',name:'FRONT 1-WAY LSD',description:'AWD only. Clutch plates limit front wheel-speed differences under power. Adds 2 kg and resists tight turns.'},
  {id:'locked',name:'FRONT 2-WAY LSD',description:'AWD only. Strong locking under power and overrun. Adds 3 kg; increases steering push and tyre scrub.'}
 ],
 centerDifferential:[
  {id:'open',name:'OPEN CENTER DIFF',description:'AWD only. Nominal front/rear torque split 40:60, with free axle-speed difference.'},
  {id:'lsd',name:'CENTER CLUTCH LSD',description:'AWD only. Transfers torque when axle speeds differ. Adds 4 kg; sustained slip heats and wears its plates.'},
  {id:'locked',name:'LOCKING TRANSFER CASE',description:'AWD only. Couples front and rear shafts up to its torque limit. Adds 6 kg; tight turns increase tyre scrub.'}
 ]
};
export const DRIVE_LABELS={driveKit:'DRIVETRAIN',frontDifferential:'AWD FRONT DIFFERENTIAL',centerDifferential:'AWD CENTER DIFFERENTIAL'};
export const DRIVE_DEFAULTS={driveKit:'stock',frontDifferential:'open',centerDifferential:'open'};
export const DRIVE_PRICES={driveKit:{stock:0,fwd:9000,awd:18500},frontDifferential:{open:0,lsd:2800,locked:4200},centerDifferential:{open:0,lsd:3600,locked:5200}};
export function driveCompatibility(s,key,id){
 if(key==='driveKit'&&id==='fwd'&&(s.carId!=='vector'||!['i4','v6'].includes(s.engineId)))return 'Fits Vector GT with I4 or V6 only.';
 if(key==='driveKit'&&id==='awd'&&(s.carId==='atlas'||['v10','v12'].includes(s.engineId)))return 'Fits Hachi, Kitsune and Vector with engines smaller than V10/V12.';
 if(['frontDifferential','centerDifferential'].includes(key)&&id!=='open'&&s.driveKit!=='awd')return 'Requires the AWD conversion.';
 return '';
}
export function sanitizeDriveSelection(s){
 if(driveCompatibility(s,'driveKit',s.driveKit))s.driveKit='stock';
 if(s.driveKit!=='awd'){s.frontDifferential='open';s.centerDifferential='open';}
 return s;
}
export function resolveDrivetrain(s){
 const awd=s.driveKit==='awd',fwd=s.driveKit==='fwd',front=s.frontDifferential,center=s.centerDifferential;
 return {driveLayout:awd?'AWD':fwd?'FWD':'RWD',frontDriveShare:awd?.4:fwd?1:0,
  driveMass:awd?72+(front==='lsd'?2:front==='locked'?3:0)+(center==='lsd'?4:center==='locked'?6:0):fwd?18:0,
  frontPowerLock:front==='open'?0:front==='locked'?.96:.65,frontCoastLock:front==='open'?0:front==='locked'?.65:.08,
  centerPowerLock:center==='open'?0:center==='locked'?1:.65,centerCoastLock:center==='open'?0:center==='locked'?1:.18,
  centerPreload:center==='locked'?6000:center==='lsd'?100:0,axleCarrierInertia:1.6,frontShaftCapacity:4700,rearShaftCapacity:6900};
}

/** Finite shaft/clutch impulses. RWD/FWD retain the original direct axle solve.
 * AWD adds two inertial carriers, so a broken axle is a free output instead of
 * magically redistributing its share to intact wheels. Center clutch impulses
 * can still couple that free output to the healthy branch, with actual slip heat.
 */
export class Drivetrain {
 constructor(physics){this.p=physics;this.awd=physics.driveLayout==='AWD';this.main=physics.driveLayout==='FWD'?0:2;this.driven=this.awd?[0,1,2,3]:[this.main,this.main+1];this.carriers=[0,0];}
 reset(wheels){this.carriers[0]=(wheels[0]+wheels[1])*.5;this.carriers[1]=(wheels[2]+wheels[3])*.5;}
 meanOmega(wheels){return this.awd?this.carriers[0]*this.p.frontDriveShare+this.carriers[1]*(1-this.p.frontDriveShare):(wheels[this.main]+wheels[this.main+1])*.5;}
 begin({wheels,invWheel,invEngine,ratio,dt,capacity,pedal,mechanical,health,priorTorque}){
  Object.assign(this,{wheels,invWheel,invEngine,ratio,dt,capacity,pedal,mechanical});
  this.Jclutch=0;this.Jaxle=[0,0];this.Jlink=[0,0];this.Jcenter=0;this.invCarrier=1/this.p.axleCarrierInertia;
  this.mainLock=mix(this.p.coastLock,this.p.powerLock,pedal)*mechanical.differentialLockFactor;
  this.frontLock=mix(this.p.frontCoastLock,this.p.frontPowerLock,pedal)*(mechanical.frontDifferentialLockFactor??1);
  this.centerLock=mix(this.p.centerCoastLock,this.p.centerPowerLock,pedal)*(mechanical.centerDifferentialLockFactor??1);
  const mesh=ratio?(1+Math.abs(priorTorque)*.012)*(1+3*(1-health.gearbox))*Math.abs(ratio):0;
  const diff=(2+Math.abs(priorTorque)*Math.abs(ratio)*.006)*(1+3*(1-health.differential));
  const dissipate=(indices,torque)=>{let work=0;for(const i of indices){const before=wheels[i],j=Math.min(Math.abs(before)/invWheel[i],torque/indices.length*dt);wheels[i]-=Math.sign(before)*j*invWheel[i];work+=(before*before-wheels[i]*wheels[i])/(2*invWheel[i]);}return Math.max(0,work);};
  if(this.awd){
   const drag=(i,torque)=>{const before=this.carriers[i],j=Math.min(Math.abs(before)/this.invCarrier,torque*dt);this.carriers[i]-=Math.sign(before)*j*this.invCarrier;return Math.max(0,(before*before-this.carriers[i]**2)/(2*this.invCarrier));};
   const share=this.p.frontDriveShare;
   this.gearboxWorkJ=drag(0,mesh*share)+drag(1,mesh*(1-share));
   this.frontDragJ=drag(0,(2+Math.abs(priorTorque*ratio)*.006)*share*(1+3*(1-health.frontDifferential)));
   this.mainDragJ=drag(1,diff*(1-share));
  }else{this.gearboxWorkJ=dissipate(this.driven,mesh);this.mainDragJ=dissipate(this.driven,diff);this.frontDragJ=0;}
  this.initialAxleSlip=[Math.abs(wheels[1]-wheels[0]),Math.abs(wheels[3]-wheels[2])];
  this.initialCenterSlip=Math.abs(this.carriers[1]-this.carriers[0]);
  this.initialLinkSlip=[Math.abs(this.carriers[0]-(wheels[0]+wheels[1])*.5),Math.abs(this.carriers[1]-(wheels[2]+wheels[3])*.5)];
 }
 solve(omega){
  const {wheels:w,invWheel:iw,invEngine:ie,ratio:r,dt}=this,share=this.p.frontDriveShare;
  if(this.capacity>0){
   const wheelInverse=this.awd?this.invCarrier*(share*share+(1-share)**2):(iw[this.main]+iw[this.main+1])*.25;
   const slip=omega-r*this.meanOmega(w),next=clamp(this.Jclutch+slip/(ie+r*r*wheelInverse),-this.capacity*dt,this.capacity*dt),d=next-this.Jclutch;
   this.Jclutch=next;omega-=d*ie;
   if(this.awd){this.carriers[0]+=d*r*share*this.invCarrier;this.carriers[1]+=d*r*(1-share)*this.invCarrier;}
   else{w[this.main]+=d*r*.5*iw[this.main];w[this.main+1]+=d*r*.5*iw[this.main+1];}
  }
  const axle=(a,lock,load)=>{const i=a*2,bound=Math.abs(load)*.5*lock+lock*45*dt;
   const next=clamp(this.Jaxle[a]+(w[i+1]-w[i])/(iw[i]+iw[i+1]),-bound,bound),d=next-this.Jaxle[a];this.Jaxle[a]=next;w[i]+=d*iw[i];w[i+1]-=d*iw[i+1];};
  if(this.awd){
   for(let a=0;a<2;a++){const i=a*2,factor=a?this.mechanical.rearDriveCapacityFactor:this.mechanical.frontDriveCapacityFactor;
    const limit=(a?this.p.rearShaftCapacity:this.p.frontShaftCapacity)*(this.p.drivetrainStrength??1)*factor*dt;
    const slip=this.carriers[a]-(w[i]+w[i+1])*.5,next=clamp(this.Jlink[a]+slip/(this.invCarrier+(iw[i]+iw[i+1])*.25),-limit,limit),d=next-this.Jlink[a];
    this.Jlink[a]=next;this.carriers[a]-=d*this.invCarrier;w[i]+=d*.5*iw[i];w[i+1]+=d*.5*iw[i+1];
   }
   axle(0,this.frontLock,this.Jlink[0]);axle(1,this.mainLock,this.Jlink[1]);
   const bound=(Math.abs(this.Jclutch*r)*.75*this.centerLock+this.p.centerPreload*(this.mechanical.centerDifferentialLockFactor??1)*dt);
   const next=clamp(this.Jcenter+(this.carriers[1]-this.carriers[0])/(2*this.invCarrier),-bound,bound),d=next-this.Jcenter;
   this.Jcenter=next;this.carriers[0]+=d*this.invCarrier;this.carriers[1]-=d*this.invCarrier;
  }else axle(this.main/2,this.mainLock,this.Jclutch*r);
  return omega;
 }
 finish(omega){
  const w=this.wheels,axleSlips=[Math.abs(w[1]-w[0]),Math.abs(w[3]-w[2])],centerSlip=Math.abs(this.carriers[1]-this.carriers[0]);
  const slipWork=(j,before,after)=>after>1||before>10?Math.abs(j)*.5*(before+after):0;
  const axleWork=this.Jaxle.map((j,i)=>slipWork(j,this.initialAxleSlip[i],axleSlips[i]));
  const linkWork=this.awd?this.Jlink.map((j,a)=>slipWork(j,this.initialLinkSlip[a],Math.abs(this.carriers[a]-(w[a*2]+w[a*2+1])*.5))):[0,0];
  const centerWork=this.awd?slipWork(this.Jcenter,this.initialCenterSlip,centerSlip):0;
  return {shaft:this.ratio*this.meanOmega(w),clutchSlip:Math.abs(omega-this.ratio*this.meanOmega(w)),Jclutch:this.Jclutch,
   gearboxWorkJ:this.gearboxWorkJ,differentialWorkJ:this.mainDragJ+axleWork[this.main/2]+linkWork[this.main/2],
   frontDifferentialWorkJ:this.awd?this.frontDragJ+axleWork[0]+linkWork[0]:0,centerDifferentialWorkJ:centerWork,
   axleTorques:this.awd?this.Jlink.map(j=>j/this.dt):[this.main===0?this.Jclutch*this.ratio/this.dt:0,this.main===2?this.Jclutch*this.ratio/this.dt:0],
   diffSlipRPM:(w[this.main+1]-w[this.main])*60/(2*Math.PI),diffTorque:this.Jaxle[this.main/2]/this.dt,
   diffPower:(Math.abs(this.Jaxle[0]*(w[1]-w[0]))+Math.abs(this.Jaxle[1]*(w[3]-w[2]))+(this.awd?Math.abs(this.Jcenter*(this.carriers[1]-this.carriers[0])):0))/this.dt,centerSlipRPM:this.awd?(this.carriers[1]-this.carriers[0])*60/(2*Math.PI):0,
   differentialLock:this.mainLock,frontDifferentialLock:this.awd?this.frontLock:0,centerDifferentialLock:this.awd?this.centerLock:0};
 }
}
