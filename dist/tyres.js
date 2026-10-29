/** Four persistent tyre casings. Temperatures and tread health stay in the
 * existing mechanical/vehicle state. Coefficients are fictional game calibration.
 * gasChargeBar is absolute pressure at 24 C, a fixed-volume ideal-gas proxy. */
const clamp=(v,a,b)=>Math.max(a,Math.min(b,Number.isFinite(v)?v:a));
export const TYRE_COLD_BAR=2.3;
export function createTyre(saved={},health=1){
 if(!saved||typeof saved!=='object')saved={};
 return {gasChargeBar:clamp(saved.gasChargeBar??3.3,.25,7),carcass:clamp(saved.carcass??health,0,1),flatspot:clamp(saved.flatspot??0,0,1),flatspotAngle:clamp(saved.flatspotAngle??0,-Math.PI,Math.PI),punctured:saved.punctured===true,blown:saved.blown===true,burstCount:Math.round(clamp(saved.burstCount??0,0,1e9))};
}
export function tyrePressure(t,temperature=24){return t.blown?0:Math.max(0,t.gasChargeBar*(temperature+273.15)/297.15-1);}
export function tyreResponse(t,temperature=24,angle=0){
 const pressureBar=tyrePressure(t,temperature),soft=clamp(1-pressureBar/TYRE_COLD_BAR,0,1),deflation=t.blown?1:soft;
 const casingScale=t.blown?.76:1-.18*deflation*deflation;
 const flatPulse=Math.max(0,Math.cos(angle-(t.flatspotAngle||0)))**8;
 return {pressureBar,casingScale,radiusScale:casingScale*(1-.045*t.flatspot*flatPulse),
  grip:(t.blown?.24:1-.62*soft*soft)*(.75+.25*t.carcass)*(1-.12*clamp((pressureBar-3.5)/2,0,1)),
  compliance:1+3*deflation,rollingExtra:t.blown?.12:.10*soft*soft,
  carcass:t.carcass,flatspot:t.flatspot,flatspotAngle:t.flatspotAngle,punctured:t.punctured,blown:t.blown,burstCount:t.burstCount};
}
export function impactTyre(t,damage){
 t.carcass=clamp(t.carcass-damage*.85,0,1);
 if(damage>.28)t.punctured=true;
}
export function stepTyre(t,{dt,temperature,tread,slipWork=0,lockedWork=0,rollingWork=0,speed=0,load=0,angle=0,attached=true,enabled=true}){
 if(!enabled)return false;
 const ambientCharge=297.15/(temperature+273.15);
 if(t.blown){t.gasChargeBar=ambientCharge;return false;}
 if(t.punctured)t.gasChargeBar=ambientCharge+(t.gasChargeBar-ambientCharge)*Math.exp(-dt*(.12+(1-t.carcass)*.35));
 if(!attached)return false;
 const soft=clamp(1-tyrePressure(t,temperature)/TYRE_COLD_BAR,0,1),heat=Math.max(0,(temperature-155)/100),loaded=load>20||slipWork>0;
 if(loaded){
  t.carcass=clamp(t.carcass-dt*.009*heat*heat-(slipWork+rollingWork)/240e6*(1+heat*8)-Math.abs(speed)*dt*soft*soft/18000,0,1);
  if(lockedWork>0&&t.flatspot===0)t.flatspotAngle=Math.atan2(Math.sin(angle),Math.cos(angle));
  t.flatspot=clamp(t.flatspot+Math.max(0,lockedWork)/9e6,0,1);
 }
 if(loaded&&(Math.abs(speed)>2||slipWork>1)&&(t.carcass<.08||tread<=.025)){
  t.blown=t.punctured=true;t.gasChargeBar=ambientCharge;t.burstCount++;return true;
 }
 return false;
}
