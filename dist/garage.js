import {EXTERIOR_TUNING_LABELS,exteriorCompatibility} from './exterior-tuning.js';
import {AERO_LABELS,aeroCompatibility} from './aerodynamics.js';
import {HOP_LABELS} from './wheel-hop.js';
import {DRIVE_LABELS,driveCompatibility} from './drivetrain.js';
import {CHASSIS_LABELS} from './chassis-setup.js';
import {COSMETIC_LABELS} from './cosmetics.js';
import {VEHICLES,ENGINES,PARTS,PART_LABELS,resolveBuild} from './catalog.js';

const $=id=>document.getElementById(id);
const number=value=>Number(value).toLocaleString('en-GB');

/** Garage choices stay a preview until the player installs the build. */
export class GaragePanel {
 constructor({onPreview,onApply,onCancel,economy}={}) {
  this.onPreview=onPreview;this.onApply=onApply;this.onCancel=onCancel;this.economy=economy;
  this.active=null;this.draft=null;this.open=false;this.category='cars';this.cardSignature='';this.onCategory=null;
  const cars=$('garage-cars');
  for(const vehicle of VEHICLES){
   const button=document.createElement('button');button.type='button';button.className='garage-car';button.dataset.carId=vehicle.id;
   const number=document.createElement('span');number.className='garage-car-number';number.textContent=vehicle.model.number;
   const name=document.createElement('strong');name.textContent=vehicle.name;
   const desc=document.createElement('small');desc.textContent=vehicle.subtitle;
   const price=document.createElement('b');price.className='garage-car-price';price.dataset.priceCar=vehicle.id;
   button.append(number,name,desc,price);button.addEventListener('click',()=>this.change({carId:vehicle.id,engineId:vehicle.defaultEngine}));cars.append(button);
  }
  const engineSelect=$('garage-engine');
  for(const engine of ENGINES){const option=document.createElement('option');option.value=engine.id;option.textContent=engine.name;engineSelect.append(option);}
  engineSelect.addEventListener('change',()=>this.change({engineId:engineSelect.value}));
  for(const [key,options]of Object.entries(PARTS)){
   const row=document.createElement('label');row.className='garage-part';
   const top=document.createElement('span');top.className='garage-part-title';top.textContent=PART_LABELS[key];
   const select=document.createElement('select');select.id='garage-part-'+key;select.setAttribute('aria-label',PART_LABELS[key]);
   for(const part of options){const option=document.createElement('option');option.value=part.id;option.textContent=part.name;select.append(option);}
   const note=document.createElement('small');note.id='garage-note-'+key;
   row.append(top,select,note);$('garage-parts').append(row);
   select.addEventListener('change',()=>this.change({[key]:select.value}));
  }
  $('garage-apply').addEventListener('click',()=>{
   if(!this.draft)return;if(this.onApply?.(this.draft)!==false)this.open=false;
  });
  $('garage-stock').addEventListener('click',()=>this.change({carId:this.draft.selection.carId,engineId:this.draft.vehicle.defaultEngine},true));
 }
 setupWorkbench(){
  if(!$('garage-categories')||this.workbench)return;this.workbench=true;
  this.categories=[['cars','YOUR RIDES'],['engine','ENGINE SWAP'],...Object.entries(PART_LABELS)];
  this.categories.forEach(([key,label],i)=>{const button=document.createElement('button');button.type='button';button.id='garage-category-'+key;button.dataset.navKey=key;button.setAttribute('role','tab');button.innerHTML='<small>'+String(i+1).padStart(2,'0')+'</small><span></span><b>↗</b>';button.querySelector('span').textContent=label;button.addEventListener('click',()=>this.selectCategory(key));$('garage-categories').append(button);});
 }
 selectCategory(key){this.category=key;this.cardSignature='';this.renderCards();this.onCategory?.(key);}
 renderCards(){
  if(!this.workbench||!this.draft)return;
  const key=this.category,build=this.draft,selected=key==='cars'?build.vehicle.id:key==='engine'?build.engine.id:build.selection[key];
  const items=key==='cars'?VEHICLES:key==='engine'?ENGINES:PARTS[key],group=key==='cars'?'car':key;
  $('garage-category-title').textContent=key==='differential'?(build.physics.driveLayout==='FWD'?'FRONT':'REAR')+' DIFFERENTIAL':this.categories.find(x=>x[0]===key)?.[1]||key;
  for(const el of $('garage-categories').children){const active=el.dataset.navKey===key;el.classList.toggle('active',active);el.setAttribute('aria-selected',String(active));}
  const signature=key+':'+build.signature+':'+(this.economy?.wallet||0);if(this.cardSignature===signature)return;this.cardSignature=signature;
  const focused=document.activeElement?.dataset?.navKey;$('garage-option-cards').replaceChildren();
  for(const [i,item]of items.entries()){
   const active=item.id===selected,installed=(key==='cars'?this.active?.vehicle.id:key==='engine'?this.active?.engine.id:this.active?.selection[key])===item.id;
   const owned=this.economy?.owns(group,item.id),price=this.economy?.price(group,item.id)||0;
   const button=document.createElement('button');button.type='button';button.className='part-card'+(active?' active':'');button.dataset.navKey='part-'+key+'-'+item.id;button.setAttribute('aria-pressed',String(active));
   button.innerHTML='<span class="part-tier"></span><strong></strong><p></p><div class="part-bottom"><b></b><span></span></div>';
   button.querySelector('.part-tier').textContent=key==='cars'?item.model.number:key==='engine'?item.layout.toUpperCase():(COSMETIC_LABELS[key]||EXTERIOR_TUNING_LABELS[key])?'BODY PART':AERO_LABELS[key]?'AERO PART':HOP_LABELS[key]?'CHASSIS PART':DRIVE_LABELS[key]?'DRIVETRAIN PART':CHASSIS_LABELS[key]?'CHASSIS PART':['STREET','SPORT','RACE'][i]||'PART';
   button.querySelector('strong').textContent=item.name;button.querySelector('p').textContent=item.description;
   button.querySelector('.part-bottom b').textContent=owned?'OWNED':number(price)+' PTS';button.querySelector('.part-bottom span').textContent=installed?'INSTALLED':active?'SELECTED':'PREVIEW';
   const incompatible=driveCompatibility(build.selection,key,item.id)||aeroCompatibility(build.selection,key,item.id)||exteriorCompatibility(build.selection,key,item.id);button.disabled=!!incompatible||key==='turbo'&&!build.engine.turbo;if(button.disabled)button.querySelector('p').textContent=incompatible||'Requires a turbocharged engine.';
   button.addEventListener('click',()=>{this.change(key==='cars'?{carId:item.id,engineId:item.defaultEngine}:key==='engine'?{engineId:item.id}:{[key]:item.id});});
   $('garage-option-cards').append(button);if(focused===button.dataset.navKey){button.focus({preventScroll:true});button.classList.add('pad-focus');}
  }
  const current=this.active?.stats,changes=[];for(const [field,label,unit]of [['aeroDownforce100','downforce at 100 km/h',' N'],['aeroDrag100','drag at 100 km/h',' N'],['massKg','weight',' kg'],['redlineRpm','redline',' RPM'],['clutchNm','clutch capacity',' Nm'],['boostBar','boost',' bar'],['tyreWidthMm','tyre width',' mm'],['steeringLockDeg','steering lock','°'],['steeringRatio','steering ratio',':1'],['frontRollRate','front roll stiffness',' N/m'],['rearRollRate','rear roll stiffness',' N/m']]){const delta=build.stats[field]-(current?.[field]??build.stats[field]);if(Math.abs(delta)>.001)changes.push((delta>0?'+':'')+Number(delta.toFixed(2)) + unit+' '+label);}
  if(build.physics.driveLayout!==this.active?.physics.driveLayout)changes.unshift(build.physics.driveLayout+' drivetrain');
  if(build.physics.driveLayout==='AWD')changes.push('40:60 nominal front/rear torque');
  $('garage-comparison').textContent=changes.length?'VS INSTALLED: '+changes.join(' · '):'Compare the part descriptions above. Install to confirm your changes.';
  const cards=$('garage-option-cards'),chosen=cards.querySelector('.active');if(chosen)cards.scrollLeft=chosen.offsetLeft-cards.offsetLeft;
 }
 show(build){this.compatibilityMessage='';this.setupWorkbench();this.active=build;this.draft=resolveBuild(build.selection);this.open=true;this.render();this.onPreview?.(this.draft);}
 hide(restore=true){this.open=false;if(restore&&this.active)this.onCancel?.(this.active);}
 change(patch,replace=false){
  const request=replace?patch:{...this.draft.selection,...patch};this.compatibilityMessage=driveCompatibility(request,'driveKit',request.driveKit)||exteriorCompatibility(request,'widebody',request.widebody);
  this.draft=resolveBuild(request);this.render();this.onPreview?.(this.draft);
 }
 render(){
  const build=this.draft,{vehicle,engine,selection,stats}=build;
  document.querySelectorAll('[data-car-id]').forEach(el=>{const active=el.dataset.carId===vehicle.id;el.classList.toggle('active',active);el.setAttribute('aria-pressed',String(active));});
  $('garage-engine').value=engine.id;
  $('garage-engine-description').textContent=engine.description;
  if(this.economy){
   for(const vehicle of VEHICLES){const label=document.querySelector('[data-price-car="'+vehicle.id+'"]');if(label)label.textContent=this.economy.owns('car',vehicle.id)?'OWNED':number(this.economy.price('car',vehicle.id))+' PTS';}
   for(const option of $('garage-engine').options){const e=ENGINES.find(v=>v.id===option.value),included=e.id===vehicle.defaultEngine&&!this.economy.owns('car',vehicle.id);option.textContent=e.name+' · '+(this.economy.owns('engine',e.id)?'OWNED':included?'INCLUDED':number(this.economy.price('engine',e.id))+' PTS');}
  }
  $('garage-preview-name').textContent=vehicle.name;
  $('garage-preview-type').textContent=vehicle.subtitle+' / '+build.physics.driveLayout;
  $('garage-preview-engine').textContent=engine.name;
  $('garage-car-description').textContent=vehicle.description;
  $('garage-mass').textContent=number(stats.massKg)+' kg';
  $('garage-displacement').textContent=(stats.displacementCc/1000).toLocaleString('en-GB',{maximumFractionDigits:2})+' l';
  $('garage-redline').textContent=number(stats.redlineRpm);
  $('garage-boost').textContent=engine.turbo?stats.boostBar.toFixed(2)+' bar':'NATURALLY ASPIRATED';
  $('garage-bias').textContent=stats.brakeBias+' / '+(100-stats.brakeBias);
  $('garage-clutch').textContent=number(stats.clutchNm)+' Nm';
  if($('garage-gearing'))$('garage-gearing').textContent=stats.finalDrive.toFixed(2)+' FINAL / '+stats.topGear.toFixed(2)+' TOP';
  if($('garage-cooling'))$('garage-cooling').textContent=Math.round(stats.radiatorEfficiency*100)+'% WATER / '+Math.round(stats.oilCoolingFactor*100)+'% OIL';
  if($('garage-durability'))$('garage-durability').textContent=Math.round(stats.internalStrength*100)+'% ENGINE / '+stats.tyreWidthMm+' MM TYRES';
  for(const [key,parts]of Object.entries(PARTS)){
   const select=$('garage-part-'+key);select.value=selection[key];
   const part=parts.find(item=>item.id===selection[key]);
   if(this.economy)for(const option of select.options){const item=parts.find(v=>v.id===option.value);option.textContent=item.name+' · '+(this.economy.owns(key,item.id)?'OWNED':number(this.economy.price(key,item.id))+' PTS');}
   $('garage-note-'+key).textContent=key==='turbo'&&!engine.turbo?'This engine is naturally aspirated.':part.description;
   for(const option of select.options)option.disabled=!!(driveCompatibility(selection,key,option.value)||aeroCompatibility(selection,key,option.value)||exteriorCompatibility(selection,key,option.value));
   select.disabled=key==='turbo'&&!engine.turbo;
  }
  const changed=build.signature!==this.active?.signature;
  const quote=this.economy?.quote(build);
  $('garage-change-status').textContent=quote?.total?quote.items.length+' NEW '+(quote.items.length===1?'ITEM':'ITEMS'):changed?'OWNED PARTS':'CURRENT SETUP';
  $('garage-apply').textContent=quote?.total?'BUY & INSTALL · '+number(quote.total)+' PTS':changed?'INSTALL OWNED PARTS ↗':'INSTALL SETUP ↗';
  $('garage-apply').disabled=!!quote&&!quote.canAfford;
  if($('garage-wallet'))$('garage-wallet').textContent=number(this.economy?.wallet??0)+' PTS';
  this.renderCards();
  if($('garage-cost'))$('garage-cost').textContent=quote?.shortfall?'Need '+number(quote.shortfall)+' more points.':quote?.total?'Purchased parts stay in your garage.':'You own this setup.';
  if(this.compatibilityMessage&&$('garage-cost'))$('garage-cost').textContent+=' '+this.compatibilityMessage+' Incompatible parts were returned to factory specification in this preview.';
 }
}
