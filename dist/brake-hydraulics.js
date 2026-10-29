/** Fictional diagonal dual-circuit hydraulic approximation. No pedal-travel,
 * fluid boiling or ABS-valve model; the existing ABS still modulates each wheel. */
const clamp=(n,a,b)=>Math.max(a,Math.min(b,Number.isFinite(n)?n:a));
export const BRAKE_FLUID_CAPACITY=.30;
export const BRAKE_CIRCUITS=[[0,3],[1,2]];
export function createBrakeHydraulics(saved={}){
 if(!saved||typeof saved!=='object')saved={};
 return {lines:Array.from({length:4},(_,i)=>clamp(saved.lines?.[i]??1,0,1)),fluid:Array.from({length:2},(_,i)=>clamp(saved.fluid?.[i]??BRAKE_FLUID_CAPACITY,0,BRAKE_FLUID_CAPACITY))};
}
export const snapshotBrakeHydraulics=h=>({lines:[...h.lines],fluid:[...h.fluid]});
export function hydraulicFactors(h){
 const factors=[1,1,1,1];
 for(let c=0;c<2;c++){const pair=BRAKE_CIRCUITS[c],seal=Math.min(...pair.map(i=>h.lines[i])),supply=clamp((h.fluid[c]-.015)/.06,0,1),pressure=seal<=.025?0:seal*seal*supply;for(const i of pair)factors[i]=pressure;}
 return factors;
}
export function damageBrakeLine(h,index,damage,detached=false){
 if(detached)h.lines[index]=0;else h.lines[index]=clamp(h.lines[index]-Math.max(0,damage-.20)*1.4,0,1);
}
export function stepBrakeHydraulics(h,dt,pedal=0,enabled=true){
 if(!enabled)return;
 for(let c=0;c<2;c++){const leak=BRAKE_CIRCUITS[c].reduce((n,i)=>n+(1-h.lines[i])**2,0);h.fluid[c]=clamp(h.fluid[c]-dt*leak*(.00003+.012*clamp(pedal,0,1)),0,BRAKE_FLUID_CAPACITY);}
}
export function brakeGlow(temperature=24){const t=clamp((temperature-480)/420,0,1);return t*t*(3-2*t);}
