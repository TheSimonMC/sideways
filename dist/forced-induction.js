const item=(id,name,description)=>({id,name,description});
const clamp=(v,a,b)=>Math.max(a,Math.min(b,Number.isFinite(v)?v:a));
export const INDUCTION_PARTS={
 supercharger:[item('stock','FACTORY INDUCTION','Keep the original naturally aspirated engine or factory turbo.'),item('street','STREET SUPERCHARGER','Belt-driven displacement blower and charge cooler. 0.45 bar target; draws power from the crank and adds heat and weight. Requires a naturally aspirated engine.'),item('race','HIGH-OUTPUT SUPERCHARGER','Larger blower and faster pulley. 0.80 bar target; greater shaft load, heat and drivetrain stress. Requires a naturally aspirated engine.')],
 chargeCooler:[item('stock','STANDARD CHARGE COOLER','Keep the cooler supplied with the turbo or blower.'),item('sport','LARGE CHARGE COOLER','More charge-air heat rejection and 4 kg more mass. Requires a turbo or supercharger.'),item('race','COMPETITION CHARGE COOLER','Largest cooling core, 8 kg more mass. Keeps intake air cooler under sustained boost; damage still reduces cooling.')]
};
export const INDUCTION_LABELS={supercharger:'SUPERCHARGER',chargeCooler:'CHARGE AIR COOLING'};
export const INDUCTION_DEFAULTS={supercharger:'stock',chargeCooler:'stock'};
export const INDUCTION_PRICES={supercharger:{stock:0,street:10500,race:17800},chargeCooler:{stock:0,sport:3600,race:6500}};
export function inductionCompatibility(s,key,id){
 if(!id||id==='stock')return '';
 if(key==='supercharger'&&s.engineId==='i6t')return 'This engine already has its factory turbo. Fit a naturally aspirated engine for a supercharger.';
 if(key==='chargeCooler'&&s.engineId!=='i6t'&&(!s.supercharger||s.supercharger==='stock'))return 'Requires a turbocharged engine or an installed supercharger kit.';
 return '';
}
export function sanitizeInductionSelection(s){
 if(inductionCompatibility(s,'supercharger',s.supercharger))s.supercharger='stock';
 if(inductionCompatibility(s,'chargeCooler',s.chargeCooler))s.chargeCooler='stock';
}
export function resolveInduction(engine,s,ecu=0){
 const level=s.supercharger==='race'?2:s.supercharger==='street'?1:0,cooling=s.chargeCooler==='race'?2:s.chargeCooler==='sport'?1:0,supercharged=level>0,charged=supercharged||engine.turbo;
 const litres=engine.displacementCc/1000,volume=engine.displacementCc/1e6,blowerMass=supercharged?(level===2?24+litres*2.4:18+litres*2):0,coolerMass=charged?[0,4,8][cooling]:0;
 const target=supercharged?[0,45000,80000][level]+[0,8000,14000][ecu]:null,efficiency=charged?(cooling?[0,.74,.84][cooling]:supercharged?.45:.60):0;
 const overrides=supercharged?{boost:'supercharger',superchargerRatio:level===2?1.9:1.7,superchargerDisplacement:volume*(engine.rotors?2:1)*(level===2?.50:.45),superchargerFriction:.08*litres/2,compressorArea:volume*(engine.rotors?1.4:.7),bypassArea:volume*(engine.rotors?1.4:.7),compressorEfficiency:level===2?.72:.68,intercoolerEnabled:true,intercoolerEfficiency:efficiency,boostTarget:target}:charged&&cooling?{intercoolerEnabled:true,intercoolerEfficiency:efficiency}:{};
 return {supercharged,charged,level,cooling,target,efficiency,overrides,mass:blowerMass+coolerMass,momentY:blowerMass*.72+coolerMass*.48,maxRotorRpm:level===2?24000:21000};
}
export function inductionResponse(build,m,aux,sample={}){
 const kit=build.physics.induction,active=!!kit?.supercharged,charged=!!kit?.charged,h=m.health,t=m.temperatures;
 const health=active?clamp(h.supercharger,0,1):1,drive=active&&health>.025?clamp(aux.beltDrive,0,1):0;
 const coolerHealth=charged?clamp(h.chargeCooler,0,1):1;
 const slipping=active?clamp(aux.beltSlip,0,1):0,rotating=clamp(Math.abs(sample.omega??0)/50,0,1);
 // A seized rotor loads the shared accessory belt; a snapped belt transmits
 // neither torque nor friction heat. Existing water-pump/alternator faults remain.
 const seized=active&&health<=.025&&m.auxiliaries.health.accessoryBelt>.025;
 const slipPower=active&&m.auxiliaries.health.accessoryBelt>.025?clamp(Math.max(0,sample.compressorPowerW??0)*slipping/Math.max(.15,1-slipping)+(seized?65*Math.abs(sample.omega??0):0),0,90000):0;
 return {active,charged,health,drive,flow:active?.30+.70*health*health:1,efficiency:active?.45+.55*health:1,friction:active?1+(1-health)**2*10:1,coolerHealth,
  bypass:active?clamp(Math.max(1-drive,1-health),0,1):0,slipPowerW:slipPower,slipLoadNm:Math.abs(sample.omega??0)>1?slipPower/Math.abs(sample.omega):0,
  beltWear:active?rotating*(seized?.06:slipping*.0015*(1+Math.max(0,(m.auxiliaries.temperatures.belt-100)/80))):0,
  temperature:t.supercharger??24,coolerTemperature:t.chargeCooler??24};
}
