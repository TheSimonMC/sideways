/* Fictional 12 V accessory system. All four cars use a belt-driven coolant
 * pump and alternator, and an electric radiator fan. Health is distinct from
 * charge; amp-hours integrate once per mechanical substep, never on a read. */
const clamp=(v,a,b)=>Math.max(a,Math.min(b,Number.isFinite(v)?v:a));
const finite=(v,d)=>Number.isFinite(v)?v:d;
const smooth=v=>(v=clamp(v,0,1),v*v*(3-2*v));
export const AUXILIARY_PARTS={accessoryBelt:'Accessory belt',beltTensioner:'Belt tensioner',alternator:'Alternator',battery:'Battery',starterMotor:'Starter motor',radiatorFan:'Radiator fan'};
export function createAuxiliaries(saved={}){
 saved=saved&&typeof saved==='object'?saved:{};
 return {health:Object.fromEntries(Object.keys(AUXILIARY_PARTS).map(id=>[id,clamp(finite(saved.health?.[id],1),0,1)])),charge:clamp(finite(saved.charge,.85),0,1),
  temperatures:Object.fromEntries(['belt','alternator','starter'].map(id=>[id,clamp(finite(saved.temperatures?.[id],24),24,600)])),
  chargedAh:clamp(finite(saved.chargedAh,0),0,1e12),dischargedAh:clamp(finite(saved.dischargedAh,0),0,1e12)};
}
export function snapshotAuxiliaries(a){return {...a,health:{...a.health},temperatures:{...a.temperatures}};}
export function auxiliaryResponse(a,{omega=0,coolant=84,headlights=false,starterRequested=false,starterTorque=150,starterNoLoadRpm=907,waterPump=1}={}){
 const h=a.health,rpm=Math.max(0,omega)*30/Math.PI,rotating=smooth(rpm/500),alive=id=>h[id]>.025;
 const tension=alive('beltTensioner')?smooth(h.beltTensioner/.7):0;
 const obstruction=Math.max(1-waterPump,1-h.alternator),slip=alive('accessoryBelt')?clamp((1-tension)*(.25+.65*rotating)+obstruction*obstruction*.42,0,1):0;
 const beltDrive=alive('accessoryBelt')?(1-slip)*smooth(h.accessoryBelt/.3):0;
 const fanDemand=smooth((coolant-91)/12),fanHealth=alive('radiatorFan')?h.radiatorFan:0;
 const demandA=5+(rpm>250?7:0)+(headlights?10:0)+24*fanDemand*fanHealth;
 const generationCapacity=alive('alternator')?90*smooth((rpm* beltDrive-500)/1100)*h.alternator:0;
 const chargeAcceptance=alive('battery')?(1-a.charge)*35*h.battery:0;
 const generatorA=Math.min(generationCapacity,demandA+chargeAcceptance);
 const openVoltage=alive('battery')&&a.charge>0?10.5+2.1*a.charge:0;
 const resistance=.0018+.035*(1-h.battery)+.012*(1-a.charge)**4;
 // Size the cranking current from the native starter's maximum shaft power.
 const nominalStarterA=Math.max(100,starterTorque*starterNoLoadRpm*Math.PI/30/4/(.55*10));
 const requested=!!starterRequested&&rpm<1200,attemptA=alive('starterMotor')?nominalStarterA:0;
 const attemptVoltage=clamp(openVoltage-(demandA+attemptA-generatorA)*resistance,0,14.2);
 const canCrank=alive('starterMotor')&&attemptVoltage>=7.5&&a.charge>.002,starterActive=requested&&canCrank;
 const starterA=starterActive?attemptA:0,netA=generatorA-demandA-starterA;
 const voltage=generatorA>=demandA+starterA&&generatorA>0?14.2:clamp(openVoltage+netA*resistance,0,14.2);
 const starterFactor=starterActive?smooth((voltage-7)/2.5)*smooth(h.starterMotor/.7):0;
 const nominalTorque=starterTorque*Math.max(0,1-rpm/Math.max(1,starterNoLoadRpm));
 const starterDrag=starterActive?nominalTorque*(1-starterFactor):0;
 const generatorW=generatorA*voltage,loadTorque=omega>1?generatorW/.68/omega:0;
 const lampFactor=smooth((voltage-7)/5),fan=fanDemand*fanHealth*lampFactor;
 return {voltage,attemptVoltage,charge:a.charge,netA:voltage>0&&alive('battery')?netA:0,generatorA,starterA,starterActive,canCrank,starterBlocked:requested&&!starterActive,starterFactor,starterDrag,
  ignition:voltage>=8.5,lampFactor,fan,beltDrive,beltSlip:slip*rotating,loadTorque,generatorW,capacityAh:60*Math.max(.1,h.battery)};
}
export function stepAuxiliaries(a,dt,response,damageEnabled=true,speed=0){
 const e=response,h=a.health,t=a.temperatures;
 const ah=e.netA*dt/3600;
 if(ah>=0){const accepted=Math.min(ah*.85,(1-a.charge)*e.capacityAh);a.charge=clamp(a.charge+accepted/e.capacityAh,0,1);a.chargedAh+=accepted;}
 else {const used=Math.min(-ah,a.charge*e.capacityAh);a.charge=clamp(a.charge-used/e.capacityAh,0,1);a.dischargedAh+=used;}
 const heat={belt:e.beltSlip*e.beltDrive*2200,alternator:e.generatorW*(1/.68-1),starter:e.starterA*e.voltage*.6};
 for(const [id,capacity,cooling] of [['belt',2500,9],['alternator',11000,18],['starter',6500,5]])t[id]=24+(t[id]+heat[id]*dt/capacity-24)*Math.exp(-(cooling+Math.abs(speed)*.7)*dt/capacity);
 if(damageEnabled){
  h.accessoryBelt=clamp(h.accessoryBelt-dt*e.beltSlip*e.beltDrive*(.0006+.018*smooth((t.belt-100)/90)),0,1);
  h.starterMotor=clamp(h.starterMotor-dt*.02*smooth((t.starter-135)/90),0,1);
  h.alternator=clamp(h.alternator-dt*.008*smooth((t.alternator-155)/100),0,1);
 }
}
export function repairAuxiliary(a,id){
 if(id==='batteryCharge'){if(a.health.battery<=.025)return false;a.charge=1;return true;}
 if(!(id in AUXILIARY_PARTS))return false;
 a.health[id]=1;
 if(id==='battery')a.charge=1;
 const temp={accessoryBelt:'belt',alternator:'alternator',starterMotor:'starter'}[id];if(temp)a.temperatures[temp]=24;
 return true;
}
