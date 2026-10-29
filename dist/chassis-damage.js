/** Damage-related wheel-end friction and steering compliance. The nominal
 * bearing loss is already included in the chassis rolling resistance.
 * These are bounded game approximations, not a multibody bearing model. */
const finite=(n,f)=>Number.isFinite(n)?n:f;
const clamp=(n,a,b)=>Math.max(a,Math.min(b,finite(n,a)));
export function createChassisDamage(saved={}){
 saved=saved&&typeof saved==='object'?saved:{};
 return {bearings:Array.from({length:4},(_,i)=>({health:clamp(finite(saved.bearings?.[i]?.health,1),0,1),temperature:clamp(finite(saved.bearings?.[i]?.temperature,24),24,650),workJ:clamp(saved.bearings?.[i]?.workJ,0,1e15)})),rack:clamp(finite(saved.rack,1),0,1),tieRods:Array.from({length:2},(_,i)=>({health:clamp(finite(saved.tieRods?.[i]?.health,1),0,1),bend:clamp(finite(saved.tieRods?.[i]?.bend,0),-.18,.18)}))};
}
export const snapshotChassisDamage=c=>({bearings:c.bearings.map(b=>({...b})),rack:c.rack,tieRods:c.tieRods.map(t=>({...t}))});
export function bearingResponse(b,load,angle,attached=true){
 if(!attached)return {torque:0,wobble:0,play:0};
 const wear=(1-b.health)**2,play=wear*.045;
 return {torque:b.health<=.025?2200:wear*(1.4+Math.max(0,load)*.014)*(1+clamp((b.temperature-160)/200,0,1)),play,wobble:Math.sin(angle*1.03)*play};
}
export function rackTarget(target,current,health){
 if(health<=.025)return current;
 const gap=(1-health)**2*.10,error=target-current;
 return current+Math.sign(error)*Math.max(0,Math.abs(error)-gap);
}
export function tieRodAngle(rod,command,freeAngle,prior,dt){
 if(rod.health<=.025)return prior+(clamp(freeAngle,-.6,.6)-prior)*(1-Math.exp(-dt*5));
 return command+rod.bend;
}
export function damageChassisCorner(c,i,damage,direction=1,detached=false){
 const b=c.bearings[i];b.health=detached?0:clamp(b.health-Math.max(0,damage-.10)*.85,0,1);
 if(i<2){const rod=c.tieRods[i];rod.health=detached?0:clamp(rod.health-damage*.95,0,1);rod.bend=clamp(rod.bend+Math.sign(direction||1)*damage*.13,-.18,.18);}
}
export function stepChassisDamage(c,dt,{bearingWorkJ=[],tyreLoads=[],referenceLoads=[],speed=0,wheelOmegas=[],attached=[]}={},enabled=true){
 for(let i=0;i<4;i++){
  const b=c.bearings[i],work=Math.max(0,finite(bearingWorkJ[i],0));b.workJ+=work;
  b.temperature=clamp(24+(b.temperature+work/950-24)*Math.exp(-dt*(.022+Math.abs(speed)*.0012)),24,650);
  if(enabled&&attached[i]!==false){const overload=Math.max(0,finite(tyreLoads[i],0)/Math.max(1,finite(referenceLoads[i],3000))-1.8),rotation=Math.min(1,Math.abs(finite(wheelOmegas[i],0))/20);b.health=clamp(b.health-work/8e7*(1+25*clamp((b.temperature-140)/180,0,1))+(-dt*overload*overload*.0003*rotation),0,1);}
 }
}
