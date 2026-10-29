/** Fictional chassis calibration, in SI units. Installed parts are the only
 * source of handling changes; input filtering never adds a yaw impulse. */
const rad=degrees=>degrees*Math.PI/180;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const smooth=v=>{v=clamp(v,0,1);return v*v*(3-2*v);};
export const CHASSIS_PARTS={
 steeringRack:[
  {id:'stock',name:'FACTORY STEERING',description:'Original steering lock and ratio for this chassis.'},
  {id:'sport',name:'QUICK RACK',description:'Quicker rack, 38° lock. More responsive, requiring smaller inputs at speed.'},
  {id:'drift',name:'ANGLE KIT',description:'55° lock, reduced Ackermann and revised steering geometry. More countersteer range; adds 4 kg.'}
 ],
 alignment:[
  {id:'stock',name:'ROAD ALIGNMENT',description:'Mild negative camber and rear toe-in for stable road driving.'},
  {id:'sport',name:'SPORT ALIGNMENT',description:'More negative camber for loaded corners. Slightly less straight-line contact.'},
  {id:'drift',name:'DRIFT ALIGNMENT',description:'Front camber and neutral rear toe. Better countersteer geometry, less rear self-centering.'}
 ],
 antiRollBars:[
  {id:'stock',name:'FACTORY ANTI-ROLL BARS',description:'Original front and rear roll stiffness.'},
  {id:'sport',name:'SPORT ANTI-ROLL BARS',description:'Stiffer front and rear bars reduce body roll but transfer more load on uneven roads.'},
  {id:'drift',name:'DRIFT ANTI-ROLL BARS',description:'More rear roll stiffness changes lateral load transfer. Less rear traction in loaded corners.'}
 ]
};
export const CHASSIS_LABELS={steeringRack:'STEERING RACK',alignment:'WHEEL ALIGNMENT',antiRollBars:'ANTI-ROLL BARS'};
export const CHASSIS_DEFAULTS={steeringRack:'stock',alignment:'stock',antiRollBars:'stock'};
export const CHASSIS_PRICES={steeringRack:{stock:0,sport:2600,drift:4800},alignment:{stock:0,sport:900,drift:1200},antiRollBars:{stock:0,sport:2100,drift:2600}};
const STOCK={hachi:{lock:33,ratio:15.5,front:1.10,rear:1.14},atlas:{lock:31,ratio:17,front:1.06,rear:1.10},kitsune:{lock:34,ratio:14.5,front:1.12,rear:1.15},vector:{lock:32,ratio:16.5,front:1.08,rear:1.13}};
export function resolveChassis(vehicle,s){
 const base=STOCK[vehicle.id]||STOCK.hachi,rack=s.steeringRack,bars=s.antiRollBars,alignment=s.alignment;
 return {
  driveLayout:'RWD',steeringLock:rad(rack==='drift'?55:rack==='sport'?38:base.lock),steeringRatio:rack==='drift'?12.5:rack==='sport'?13:base.ratio,
  ackermann:rack==='drift'?.28:.9,frontGrip:base.front,rearGrip:base.rear,
  frontRollFactor:bars==='drift'?1.05:bars==='sport'?1.35:1,rearRollFactor:bars==='drift'?1.65:bars==='sport'?1.25:1,
  alignmentCamber:alignment==='drift'?[rad(-3.5),rad(-.5)]:alignment==='sport'?[rad(-2),rad(-1.5)]:[rad(-.5),rad(-.4)],
  alignmentToe:alignment==='drift'?[rad(-.05),0]:alignment==='sport'?[0,rad(.08)]:[0,rad(.15)],
  rackMass:rack==='drift'?4:rack==='sport'?1:0,barMass:bars==='stock'?0:2,
  // An efficiency multiplier alone cannot create downforce; explicit force
  // coefficients retain the previous body aero until aero parts are modelled.
  aeroDrag:.43,aeroDownforce:.55,tractionControl:.65,abs:true
 };
}
export function steeringDemand(steer,speed,chassis,device='keyboard'){
 const wheel=device==='wheel',keyboard=device==='keyboard'||device==='touch';
 const limit=wheel?chassis.steeringLock:chassis.steeringLock*(.26+.74/(1+(Math.abs(speed)/22)**1.6));
 return {target:clamp(steer,-1,1)*limit,rate:wheel?28:keyboard?7:12,returnRate:wheel?28:keyboard?9:14};
}
/** Smooth adhesion-to-sliding falloff with load sensitivity and compound heat.
 * Slip energy/wear stay owned by MechanicalSystem; no parallel tyre state. */
export function tyreGrip({front,load,referenceLoad,temperature,health,slipRatio,slipAngle,compound,chassis,roll=0}){
 const sliding=compound==='drift'?.86:compound==='sport'?.91:.90;
 const utilization=Math.hypot(slipRatio/.16,Math.tan(slipAngle)/.18);
 const transition=1-(1-sliding)*smooth((utilization-.8)/2.2);
 const temp=compound==='sport'?1-.08*(1-smooth((temperature-24)/45))-.22*smooth((temperature-120)/110):1-.20*smooth((temperature-125)/110);
 const loadFactor=clamp((Math.max(1,load)/Math.max(1,referenceLoad))**-.10,.80,1.14);
 const camber=Math.abs(chassis.alignmentCamber[front?0:1]),corner=Math.min(1,Math.abs(roll)*12);
 const alignment=1-camber*.26+Math.min(camber,.06)*corner*1.1;
 return (front?chassis.frontGrip:chassis.rearGrip)*transition*temp*loadFactor*alignment*(.30+.70*Math.sqrt(clamp(health,0,1)));
}
