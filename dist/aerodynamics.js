/** Lumped C*rho*A/2 coefficients, in N/(m/s)^2. Fictional calibration,
 * not wind-tunnel data. Factory force/drag totals retain the V17 baseline. */
import {exteriorMissing,windowAir} from './exterior-damage.js';
export const AERO_PARTS={wingAngle:[
 {id:'stock',name:'STANDARD WING MOUNTS',description:'GT wing at 6°. A compromise between rear downforce and drag.'},
 {id:'low',name:'LOW-DRAG WING MOUNTS',description:'GT wing only, 2°. Less rear downforce and air resistance. Adds 1 kg.'},
 {id:'high',name:'ATTACK WING MOUNTS',description:'GT wing only, 14°. More rear downforce, more drag and rearward aero balance. Adds 1 kg.'}
]};
export const AERO_LABELS={wingAngle:'GT WING ANGLE'};
export const AERO_DEFAULTS={wingAngle:'stock'};
export const AERO_PRICES={wingAngle:{stock:0,low:1200,high:1800}};
export const wingAngleDegrees=id=>id==='low'?2:id==='high'?14:6;
export function aeroCompatibility(s,key,id){return key==='wingAngle'&&id!=='stock'&&s.spoiler!=='gt'?'Requires a GT wing.':'';}
export function resolveAero(vehicle,s){
 const front={stock:.10,street:.17,race:.42}[s.frontBumper],rear={stock:.04,street:.06,race:.16}[s.rearBumper];
 const wing={none:0,stock:.18,ducktail:.25,gt:s.wingAngle==='low'?.30:s.wingAngle==='high'?.95:.55}[s.spoiler];
 const frontDrag={stock:.015,street:.025,race:.07}[s.frontBumper],rearDrag={stock:.005,street:.008,race:.02}[s.rearBumper],wingDrag={none:0,stock:.025,ducktail:.035,gt:s.wingAngle==='low'?.045:s.wingAngle==='high'?.18:.09}[s.spoiler];
 const wheelbase=vehicle.frontAxle+vehicle.rearAxle;
 return {front,rear,wing,frontDrag,rearDrag,wingDrag,bodyFront:.55*vehicle.rearAxle/wheelbase-.10,bodyRear:.55*vehicle.frontAxle/wheelbase-.22,bodyDrag:.385,
  mass:({none:-2,stock:0,ducktail:1,gt:6}[s.spoiler])+({stock:0,street:1,race:3}[s.frontBumper])+({stock:0,street:1,race:3}[s.rearBumper])+(s.wingAngle==='stock'?0:1)};
}
export function aerodynamicForces(build,condition,speed,forward=speed,lateral=0){
 const a=build.physics.aero,zone=id=>{const p=condition?.bodyDamage?.zones?.[id];return p?.detached?0:Math.max(0,Math.min(1,p?.health??1))**2;};
 const frontHealth=zone('front')*(exteriorMissing(condition?.bodyDamage,'splitter')?.2:1),rearHealth=zone('rear')*(exteriorMissing(condition?.bodyDamage,'diffuser')?.25:1),wingHealth=zone('spoiler');
 // A stalled sideways/reversed appendage cannot keep its forward-flow downforce.
 const forwardFlow=Math.max(0,forward)**2/(1+(lateral/Math.max(1,Math.abs(forward)))**2);
 const bodyQ=speed*speed,front=(a.bodyFront+.10)*bodyQ+(a.front*frontHealth-.10)*forwardFlow,rear=(a.bodyRear+.22)*bodyQ+(a.rear*rearHealth+a.wing*wingHealth-.22)*forwardFlow;
 const openingDrag=['hood','boot','left','right'].reduce((sum,id)=>{const p=condition?.bodyDamage?.zones?.[id];return sum+(p?.detached?.055:.18*Math.sin(p?.angle||0)**2);},0);
 const dragCoefficient=openingDrag+windowAir(condition?.bodyDamage)*.025+a.bodyDrag+a.frontDrag*frontHealth+a.rearDrag*rearHealth+a.wingDrag*wingHealth;
 return {front,rear,downforce:front+rear,pitchMoment:front*build.physics.frontAxle-rear*build.physics.rearAxle,drag:dragCoefficient*forward*Math.abs(forward)*(1+(1-(condition?.bodyHealth??1))*.35),dragCoefficient,wingEfficiency:wingHealth};
}
