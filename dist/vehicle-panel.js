const $=id=>document.getElementById(id);
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const degrees=value=>Number.isFinite(value)?Math.round(value)+'°C':'NO DATA';
const level=(value,capacity)=>Number.isFinite(value)&&Number.isFinite(capacity)?value.toFixed(1)+' / '+capacity.toFixed(1)+' L':'NO DATA';
const category=component=>{
 const group=String(component.group||'').toLowerCase();
 if(['engine','lubrication','turbo'].includes(group))return 'engine';
 if(['cooling'].includes(group))return 'cooling';
 if(['drivetrain','transmission','gearbox','clutch','differential'].includes(group))return 'drivetrain';
 return 'chassis';
};
const status=part=>part.status?String(part.status).replace(/[_-]/g,' ').toUpperCase():part.health<=.025?'FAILED':part.health<.5?'DAMAGED':part.health<.9?'WORN':'OK';
const warningRank=warning=>({critical:5,failure:5,danger:4,severe:4,warning:3,caution:2,info:1}[warning?.severity]||2);
export const primaryMechanicalWarning=state=>(state?.mechanical?.warnings||[]).slice().sort((a,b)=>warningRank(b)-warningRank(a))[0]||null;

/** Displays measured condition. Repairs are requested from the service controller. */
export class VehiclePanel{
 constructor({onRepair,onLayout}={}){
  this.filter='all';this.rows=new Map();this.onRepair=onRepair;this.onLayout=onLayout;this.signature='';this.current=null;
  for(const filter of ['all','engine','cooling','drivetrain','chassis'])$('vehicle-tab-'+filter).addEventListener('click',()=>{this.filter=filter;this.renderCurrent();});
  $('vehicle-fluid-service').addEventListener('click',()=>{if(this.current?.options.service&&!this.current.options.busy)this.onRepair?.(['fluids'],'FLUID TOP-UP');});
 }
 renderCurrent(){if(this.current)this.render(this.current.state,this.current.build,this.current.options);}
 render(state,build,options={}){
  this.current={state,build,options};const m=state?.mechanical,parts=(m?.components||[]).filter(part=>part.applicable!==false);
  $('vehicle-name').textContent=build?.vehicle?.name||'YOUR CAR';
  const warning=primaryMechanicalWarning(state),failed=parts.filter(part=>part.health<=.025).length;
  $('vehicle-summary').textContent=warning?warning.label+(warning.reason?'. '+warning.reason:''):failed?failed+' component'+(failed===1?' has':'s have')+' failed.':m?'No active faults. Inspect each part below.':'Component data is not available yet.';
  $('vehicle-summary').classList.toggle('warning',!!warning||failed>0);
  $('vehicle-coolant').textContent=degrees(m?.temperatures?.coolant);
  $('vehicle-oil').textContent=degrees(m?.temperatures?.oil)+(Number.isFinite(m?.oilPressureBar)?' · '+m.oilPressureBar.toFixed(1)+' BAR':'');
  $('vehicle-clutch').textContent=degrees(m?.temperatures?.clutch);
  $('vehicle-oil-level').textContent=level(m?.oilLitres,m?.oilCapacity);
  $('vehicle-coolant-level').textContent=level(m?.coolantLitres,m?.coolantCapacity);
  $('vehicle-inspect-note').textContent=options.service?'Replace one damaged part or use Repair Car for a full repair. Fluid top-ups do not fix leaks.':'Stop at a mechanic to replace parts or top up fluids. Recovery keeps the damage and temperatures.';
  const signature=parts.map(part=>part.id).join('|');
  if(signature!==this.signature){
   this.signature=signature;this.rows.clear();$('vehicle-components').replaceChildren();
   for(const part of parts){
    const row=document.createElement('article');row.className='component-row';row.dataset.component=part.id;
    const name=document.createElement('strong'),reason=document.createElement('small'),label=document.createElement('div');label.className='component-label';label.append(name,reason);
    const condition=document.createElement('div');condition.className='component-condition';const value=document.createElement('b'),temperature=document.createElement('small'),bar=document.createElement('div'),fill=document.createElement('i');bar.className='component-bar';bar.append(fill);condition.append(value,temperature,bar);
    const button=document.createElement('button');button.type='button';button.className='small-button';button.textContent='REPLACE';button.setAttribute('aria-label','Replace '+part.label);button.addEventListener('click',()=>{if(this.current?.options.service&&!this.current.options.busy)this.onRepair?.([part.id],part.label);});
    row.append(label,condition,button);$('vehicle-components').append(row);this.rows.set(part.id,{row,name,reason,value,temperature,fill,button});
   }
  }
  for(const part of parts){
   const row=this.rows.get(part.id),health=clamp(Number.isFinite(part.health)?part.health:1,0,1);
   row.row.classList.toggle('hidden',this.filter!=='all'&&category(part)!==this.filter);
   row.row.classList.toggle('damaged',health<.5);row.row.classList.toggle('failed',health<=.025);row.row.classList.toggle('hot',part.status==='hot'||part.status==='critical');
   row.name.textContent=part.label;row.reason.textContent=part.reason||'';row.reason.classList.toggle('hidden',!part.reason);
   row.value.textContent=status({...part,health})+' · '+Math.round(health*100)+'%';
   row.row.classList.toggle('tyre-row',Number.isFinite(part.pressureBar));
   row.temperature.textContent=(Number.isFinite(part.temperature)?degrees(part.temperature):'')+(Number.isFinite(part.pressureBar)?' · '+part.pressureBar.toFixed(1)+' BAR\nCASING '+Math.round(part.carcass*100)+'%\nFLAT SPOT '+Math.round(part.flatspot*100)+'%':'');
   row.fill.style.transform='scaleX('+health+')';row.button.classList.toggle('hidden',!options.service);row.button.textContent=part.id.startsWith('brakeFluid')?'REFILL':'REPLACE';row.button.setAttribute('aria-label',(part.id.startsWith('brakeFluid')?'Refill ':'Replace ')+part.label);row.button.disabled=!!options.busy||health>=.999;
  }
  for(const filter of ['all','engine','cooling','drivetrain','chassis']){const selected=this.filter===filter;$('vehicle-tab-'+filter).classList.toggle('active',selected);$('vehicle-tab-'+filter).setAttribute('aria-pressed',String(selected));}
  const lowFluids=!!m&&(m.oilLitres<m.oilCapacity-.04||m.coolantLitres<m.coolantCapacity-.04||m.brakeHydraulics?.fluid.some(v=>v<.299));
  $('vehicle-fluid-service').classList.toggle('hidden',!options.service);$('vehicle-fluid-service').disabled=!!options.busy||!lowFluids;
  $('vehicle-service-progress').classList.toggle('hidden',!options.busy);$('vehicle-service-progress').style.setProperty('--progress',String(clamp(options.progress||0,0,1)));
  $('vehicle-service-label').textContent=options.busy?(options.jobLabel||'REPAIRING')+' · '+Math.round(clamp(options.progress||0,0,1)*100)+'%':options.completed?'SERVICE COMPLETE':'';
  this.onLayout?.();
 }
}
