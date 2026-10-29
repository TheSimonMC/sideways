/** Fictional diagonal dual-circuit model. Heat, vapour and trapped air reduce
 * useful pressure and increase pedal travel. ABS failures are fail-passive:
 * ordinary hydraulic braking remains, but the affected wheel cannot release. */
const clamp=(n,a,b)=>Math.max(a,Math.min(b,Number.isFinite(n)?n:a));
export const BRAKE_FLUID_CAPACITY=.30;
export const BRAKE_CIRCUITS=[[0,3],[1,2]];
export function createBrakeHydraulics(saved={}){
 if(!saved||typeof saved!=='object')saved={};
 const array=(key,n,value,lo=0,hi=1)=>Array.from({length:n},(_,i)=>clamp(saved[key]?.[i]??value,lo,hi));
 return {lines:array('lines',4,1),fluid:array('fluid',2,BRAKE_FLUID_CAPACITY,0,BRAKE_FLUID_CAPACITY),master:array('master',2,1),booster:clamp(saved.booster??1,0,1),absValves:array('absValves',4,1),temperature:array('temperature',2,24,24,500),quality:array('quality',2,1),air:array('air',2,0),vapour:array('vapour',2,0)};
}
export const snapshotBrakeHydraulics=h=>({...h,...Object.fromEntries(Object.entries(h).filter(([,v])=>Array.isArray(v)).map(([key,v])=>[key,[...v]]))});
export function hydraulicFactors(h){
 const factors=[1,1,1,1];
 for(let c=0;c<2;c++){const pair=BRAKE_CIRCUITS[c],seal=Math.min(...pair.map(i=>h.lines[i])),supply=clamp((h.fluid[c]-.015)/.06,0,1),pressure=seal<=.025||h.master[c]<=.025?0:seal*seal*supply*h.master[c]**2*(.22+.78*h.booster)*(1-.96*h.vapour[c])*(1-.90*h.air[c]);for(const i of pair)factors[i]=pressure;}
 return factors;
}
export function damageBrakeLine(h,index,damage,detached=false){
 if(detached)h.lines[index]=0;else h.lines[index]=clamp(h.lines[index]-Math.max(0,damage-.20)*1.4,0,1);
}
export function stepBrakeHydraulics(h,dt,pedal=0,enabled=true,discs=[]){
 for(let c=0;c<2;c++){
  const pair=BRAKE_CIRCUITS[c],leak=pair.reduce((n,i)=>n+(1-h.lines[i])**2,0),target=24+.34*(Math.max(...pair.map(i=>discs[i]??24))-24);
  h.temperature[c]=clamp(h.temperature[c]+(target-h.temperature[c])*(1-Math.exp(-dt/(target>h.temperature[c]?12:35))),24,500);
  const boilingPoint=240-85*(1-h.quality[c]),vapour=clamp((h.temperature[c]-boilingPoint)/45,0,1);
  h.vapour[c]+=(vapour-h.vapour[c])*(1-Math.exp(-dt*(vapour>h.vapour[c]?.8:.12)));
  if(enabled){
   h.fluid[c]=clamp(h.fluid[c]-dt*leak*(.00003+.012*clamp(pedal,0,1)),0,BRAKE_FLUID_CAPACITY);
   if(h.fluid[c]<.03&&pedal>.05)h.air[c]=clamp(h.air[c]+dt*.2,0,1);
   const heat=Math.max(0,(h.temperature[c]-180)/120);h.quality[c]=clamp(h.quality[c]-dt*heat*heat*.0006,0,1);h.master[c]=clamp(h.master[c]-dt*heat*heat*clamp(pedal,0,1)*.00012,0,1);
  }
 }
}
export function brakePedalTravel(h,pedal=0){return clamp(pedal,0,1)*(.18+.82*Math.max(...h.air,...h.vapour,...h.master.map(v=>1-v),...h.fluid.map(v=>1-clamp(v/.075,0,1))));}
export function repairBrakeCircuit(h,id){
 let match=/^(masterCylinder|brakeFluidCondition|brakeBleed)([01])$/.exec(id);
 if(match){const i=Number(match[2]);if(match[1]==='masterCylinder')h.master[i]=1;else if(match[1]==='brakeBleed'){if(h.fluid[i]<=.03)return false;h.air[i]=0;}else{h.quality[i]=1;h.air[i]=h.vapour[i]=0;h.temperature[i]=24;h.fluid[i]=BRAKE_FLUID_CAPACITY;}return true;}
 if(id==='brakeBooster'){h.booster=1;return true;}return false;
}
export function brakeGlow(temperature=24){const t=clamp((temperature-480)/420,0,1);return t*t*(3-2*t);}
