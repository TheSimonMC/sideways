import {DRIVE_PRICES} from './drivetrain.js';
import {CHASSIS_PRICES} from './chassis-setup.js';
import {COSMETIC_PRICES} from './cosmetics.js';
import {VEHICLES,ENGINES,PARTS,DEFAULT_SELECTION,resolveBuild} from './catalog.js';

const clamp=(v,a,b)=>Math.max(a,Math.min(b,Number.isFinite(v)?v:a));
const copy=value=>JSON.parse(JSON.stringify(value));
const integer=value=>Math.floor(clamp(value,0,1e9));
export const CAR_PRICES={hachi:0,vector:32000,kitsune:46000,atlas:58000};
export const ENGINE_PRICES={i4:12000,i6t:24000,v8:29000,rotary:22000,boxer6:33000,v6:26000,v10:48000,v12:62000};
export const PART_PRICES={...COSMETIC_PRICES,...CHASSIS_PRICES,...DRIVE_PRICES,ecu:{stock:0,sport:3600,track:6800},turbo:{stock:0,street:6200,race:11500},exhaust:{street:0,sport:2900,race:5400},tyres:{street:0,sport:4800,drift:3400},suspension:{street:0,sport:5600,race:9200},brakes:{street:0,sport:4200,race:7800},differential:{open:0,lsd:4500,locked:6500},clutch:{street:0,sport:3200,race:6100},intake:{stock:0,sport:2600,race:5300},radiator:{stock:0,sport:3400,race:6200},oilCooler:{stock:0,sport:2900,race:5700},internals:{stock:0,sport:8500,race:16500},transmission:{stock:0,sport:7200,race:13800},finalDrive:{stock:0,short:2400,long:2400},chassis:{stock:0,light:5800,reinforced:6800},tyreWidth:{stock:0,wide:3900,race:7100}};
const validItem=(kind,id)=>kind==='car'?VEHICLES.some(v=>v.id===id):kind==='engine'?ENGINES.some(v=>v.id===id):!!PARTS[kind]?.some(v=>v.id===id);
const buildFrom=value=>resolveBuild(value?.selection||value||DEFAULT_SELECTION);
function restoreObjective(value){
 if(!value||!['delivery','closeCalls','drift','escape','distance','cleanRun'].includes(value.kind)||![value.goal,value.reward,value.progress,value.elapsed].every(Number.isFinite)||value.goal<=0||value.progress<0||value.progress>=value.goal||value.reward<0)return null;
 if(value.kind==='delivery'&&(!['pickup','delivery'].includes(value.stage)||![value.pickup?.x,value.pickup?.z,value.destination?.x,value.destination?.z,value.duration,value.cargo].every(Number.isFinite)||value.duration<=0))return null;
 const out=copy(value);out.reward=integer(clamp(out.reward,0,50000));out.elapsed=clamp(out.elapsed,0,1e9);out.cleanTime=clamp(out.cleanTime,0,out.goal);out.cargo=clamp(out.cargo??1,0,1);return out;
}

/** Persistent local progression. Purchases are atomic; installed V7 parts are retained. */
export class Career {
 constructor(saved={},installed=DEFAULT_SELECTION){
  const migrated=saved?.version===1;
  this.wallet=migrated?integer(saved.wallet):3500;
  this.earned=migrated?integer(saved.earned):0;
  this.spent=migrated?integer(saved.spent):0;
  this.owned=new Set((migrated&&Array.isArray(saved.owned)?saved.owned:[]).filter(key=>typeof key==='string'&&key.split(':').length===2&&validItem(...key.split(':'))));
  this.time=clamp(saved.time,0,1e9);this.serial=integer(saved.serial);this.completed=integer(saved.completed);
  this.stats={closeCalls:integer(saved.stats?.closeCalls),drift:integer(saved.stats?.drift),escapes:integer(saved.stats?.escapes),deliveries:integer(saved.stats?.deliveries),distance:clamp(saved.stats?.distance,0,1e9)};
  this.events=[];this.messages=Array.isArray(saved.messages)?saved.messages.filter(v=>v&&typeof v.text==='string').slice(-12).map(v=>({id:integer(v.id),sender:String(v.sender||'DISPATCH').slice(0,32),text:v.text.slice(0,220),time:clamp(v.time,0,1e9)})):[];
  this.active=migrated?restoreObjective(saved.active):null;
  this.offerIndex=integer(saved.offerIndex);this.offer=null;this.world=null;this.lastPosition=null;this.nearby=new Map();this.closeChain=0;this.chainUntil=0;
  this.pursuit=null;this.deliveryStop=0;this.lastBodyHealth=1;this.revision=0;
  // Only the currently installed setup is carried over from the unlocked editions.
  this.grantBuild(DEFAULT_SELECTION);
  if(!migrated)this.grantBuild(installed);
  for(const[k,parts]of Object.entries(PARTS))for(const part of parts)if(PART_PRICES[k][part.id]===0)this.owned.add(k+':'+part.id);
  if(!migrated)this.message('MOTOR WORKS','Your current setup is yours. Earn points on the road to buy your next parts.');
 }
 grantBuild(build){
  const b=buildFrom(build);this.owned.add('car:'+b.selection.carId);this.owned.add('engine:'+b.selection.engineId);
  for(const key of Object.keys(PARTS))this.owned.add(key+':'+b.selection[key]);
 }
 owns(kind,id){return this.owned.has(kind+':'+id);}
 price(kind,id){return kind==='car'?CAR_PRICES[id]??0:kind==='engine'?ENGINE_PRICES[id]??0:PART_PRICES[kind]?.[id]??0;}
 quote(build){
  const b=buildFrom(build),items=[];
  const add=(kind,id,label)=>{if(!this.owns(kind,id)&&this.price(kind,id)>0)items.push({kind,id,label,price:this.price(kind,id)});};
  add('car',b.vehicle.id,b.vehicle.name);
  const stockIncluded=!this.owns('car',b.vehicle.id)&&b.engine.id===b.vehicle.defaultEngine;
  if(!stockIncluded)add('engine',b.engine.id,b.engine.name);
  for(const key of Object.keys(PARTS))add(key,b.selection[key],PARTS[key].find(v=>v.id===b.selection[key]).name);
  const total=items.reduce((sum,v)=>sum+v.price,0);return{items,total,wallet:this.wallet,canAfford:this.wallet>=total,shortfall:Math.max(0,total-this.wallet)};
 }
 purchase(build){
  const b=buildFrom(build),quote=this.quote(b);if(!quote.canAfford)return{ok:false,...quote};
  this.wallet-=quote.total;this.spent+=quote.total;this.grantBuild(b);this.owned.add('engine:'+b.vehicle.defaultEngine);this.revision++;
  if(quote.total){this.message('MOTOR WORKS','Setup purchased for '+quote.total.toLocaleString('en-GB')+' points.');this.emit({type:'purchase',amount:quote.total,items:quote.items});}
  return{ok:true,...quote,balance:this.wallet};
 }
 message(sender,text){const message={id:++this.serial,sender:String(sender).slice(0,32),text:String(text).slice(0,220),time:this.time};this.messages.push(message);if(this.messages.length>12)this.messages.shift();this.revision++;return message;}
 emit(event){this.events.push(event);if(this.events.length>24)this.events.shift();}
 award(amount,label,kind='reward'){
  amount=Math.min(50000,integer(amount));if(!amount)return null;this.wallet=Math.min(1e9,this.wallet+amount);this.earned=Math.min(1e9,this.earned+amount);this.revision++;
  const event={type:'reward',kind,amount,label,balance:this.wallet};this.emit(event);return event;
 }
 setWorld(world){
  this.world=world;this.lastPosition=null;this.deliveryStop=0;this.pursuit=null;
  if(world?.kind!=='city'){this.offer=null;return;}
  if(this.active?.kind==='delivery'&&![this.active.pickupId,this.active.destinationId].every(id=>this._places().some(p=>p.id===id))){this.active=null;this.message('DISPATCH','That delivery is no longer available. A new job is waiting.');}
  this._makeOffer();
 }
 _places(){
  if(!this.world)return[];
  const list=[...(this.world.services||[]).filter(p=>p.kind!=='police'),...(this.world.landmarks||[]).filter(p=>['place','landmark'].includes(p.kind))];
  return list.map((p,i)=>{const direct=p.spawn||this.world.getResetPose?.(p.x,p.z,0)||p;return{id:p.id||'place-'+i,name:p.name,x:direct.x,z:direct.z,heading:direct.heading||0,radius:p.kind==='fuel'||p.kind==='garage'?p.radius||8:7};}).filter(p=>Number.isFinite(p.x)&&Number.isFinite(p.z));
 }
 _makeOffer(){
  if(this.world?.kind!=='city'||this.active)return;
  const kinds=['delivery','closeCalls','drift','delivery','escape','cleanRun','distance'],kind=kinds[this.offerIndex%kinds.length],id='job-'+this.offerIndex;
  const data={closeCalls:{title:'Thread the traffic',text:'Make 5 clean close passes at 50 km/h or more.',goal:5,reward:2800},drift:{title:'Hold the slide',text:'Bank 5,000 drift points without resetting your car.',goal:5000,reward:3800},escape:{title:'Lose the tail',text:'Escape one police pursuit.',goal:1,reward:3600},distance:{title:'Across the city',text:'Drive 2 km through the city.',goal:2000,reward:2400},cleanRun:{title:'Clean run',text:'Spend 30 seconds above 80 km/h without a collision. A hit resets the streak.',goal:30,reward:3200}};
  if(kind==='delivery'){
   const places=this._places();if(places.length<2){this.offerIndex++;this._makeOffer();return;}
   const origin=places[this.offerIndex%places.length],dest=places.filter(p=>p.id!==origin.id).sort((a,b)=>Math.hypot(b.x-origin.x,b.z-origin.z)-Math.hypot(a.x-origin.x,a.z-origin.z))[this.completed%Math.min(3,places.length-1)];
   this.offer={id,kind,title:'Parts run',text:'Collect a crate at '+origin.name+'. Deliver it to '+dest.name+'.',reward:3600+Math.round(Math.hypot(dest.x-origin.x,dest.z-origin.z)*2),goal:1,pickup:origin,destination:dest,pickupId:origin.id,destinationId:dest.id,duration:240};
  }else this.offer={id,kind,...data[kind]};
  this.revision++;
 }
 accept(state={}){
  if(this.active||!this.offer)return false;
  this.active={...copy(this.offer),progress:0,elapsed:0,stage:this.offer.kind==='delivery'?'pickup':'active',cargo:1,cleanTime:0,baseBody:clamp(state.bodyHealth??1,0,1)};
  this.lastBodyHealth=clamp(state.bodyHealth??1,0,1);this.deliveryStop=0;this.message('DISPATCH',this.active.kind==='delivery'?'Job accepted. Stop at the marked pickup.':'Job accepted. '+this.active.text);
  this.emit({type:'objective',phase:'accepted',objective:copy(this.active),target:this.getTarget()});this.offer=null;this.revision++;return true;
 }
 nextOffer(){if(this.active)return false;this.offerIndex++;this._makeOffer();return true;}
 getTarget(){const a=this.active;if(a?.kind!=='delivery')return null;return a.stage==='pickup'?a.pickup:a.destination;}
 cancel(reason='Job cancelled.'){
  if(!this.active)return;this.message('DISPATCH',reason);this.emit({type:'objective',phase:'cancelled',objective:copy(this.active)});this.active=null;this.offerIndex++;this._makeOffer();this.revision++;
 }
 teleport(){this.lastPosition=null;this.deliveryStop=0;if(this.active)this.cancel('Job cancelled after vehicle recovery. Take another job when you are ready.');}
 onNearMiss(event,state){
  if(this.world?.kind!=='city'||event?.completed!==true||!Number.isFinite(state?.speed)||!(state.speed>=50/3.6)||event.npcId==null)return null;
  const id=String(event.npcId),last=this.nearby.get(id)??-100;if(this.time-last<15)return null;this.nearby.set(id,this.time);if(this.nearby.size>80)this.nearby.delete(this.nearby.keys().next().value);
  this.closeChain=this.time<this.chainUntil?Math.min(5,this.closeChain+1):1;this.chainUntil=this.time+7;
  const points=Math.round((120+clamp(state.speed*3.6-50,0,170)*1.1)*(1+(this.closeChain-1)*.2));this.stats.closeCalls++;
  const reward=this.award(points,this.closeChain>1?'CLOSE PASS ×'+this.closeChain:'CLOSE PASS','nearMiss');
  if(this.active?.kind==='closeCalls'){this.active.progress++;this._checkComplete();}return reward;
 }
 bankDrift(points){points=integer(points);if(!points)return;this.stats.drift+=points;this.award(points,'DRIFT BANKED','drift');if(this.world?.kind==='city'&&this.active?.kind==='drift'){this.active.progress+=points;this._checkComplete();}}
 onPolice(event){
  if(this.world?.kind!=='city'||!event)return;
  if(event.type==='pursuit'&&!this.pursuit)this.pursuit={started:this.time,heat:1};
  if(event.type==='arrest'){this.pursuit=null;if(this.active?.kind==='delivery')this.cancel('Delivery cancelled. The crate was impounded.');}
  if(event.type==='escaped'&&this.pursuit){const p=this.pursuit;this.pursuit=null;if(this.time-p.started<5)return;this.stats.escapes++;this.award(1200+Math.round(p.heat*900),'PURSUIT ENDED','escape');if(this.active?.kind==='escape'){this.active.progress++;this._checkComplete();}}
 }
 update(dt,state,{active=true,police=null}={}){
  if(!active||!this.world||!state||![state.x,state.z,state.speed].every(Number.isFinite))return;dt=clamp(dt,0,.1);if(dt<=0)return;this.time+=dt;
  if(this.pursuit&&police)this.pursuit.heat=Math.max(this.pursuit.heat,clamp(police.heat||0,0,3));
  let travel=0;if(this.lastPosition){travel=Math.hypot(state.x-this.lastPosition.x,state.z-this.lastPosition.z);const motion=Math.max(0,state.speed)*dt;if(travel>Math.max(.35,motion*2.5))travel=0;else travel=Math.min(travel,motion*1.2);}
  this.lastPosition={x:state.x,z:state.z};this.stats.distance+=travel;
  const a=this.active;if(!a||this.world.kind!=='city'){this.lastBodyHealth=clamp(state.bodyHealth??1,0,1);return;}a.elapsed=clamp(a.elapsed+dt,0,1e9);
  if(a.kind==='distance')a.progress+=travel;
  else if(a.kind==='cleanRun'){const hit=state.bodyHealth<this.lastBodyHealth-.0001;a.cleanTime=hit?0:(state.speed>=80/3.6?a.cleanTime+dt:a.cleanTime);a.progress=a.cleanTime;}
  else if(a.kind==='delivery'){
   if(a.elapsed>a.duration){this.cancel('Delivery timed out. Another job is available.');return;}
   if(a.stage==='delivery')a.cargo=Math.max(0,a.cargo-Math.max(0,this.lastBodyHealth-(state.bodyHealth??1))*2.5);
   if(a.cargo<=.05){this.cancel('The crate was damaged beyond repair.');return;}
   const target=this.getTarget(),distance=Math.hypot(state.x-target.x,state.z-target.z);this.deliveryStop=distance<(target.radius||7)&&state.speed<1.1?this.deliveryStop+dt:0;
   if(this.deliveryStop>=.8){this.deliveryStop=0;if(a.stage==='pickup'){a.stage='delivery';this.message('DISPATCH','Crate loaded. Deliver it to '+a.destination.name+'.');this.emit({type:'objective',phase:'pickup',target:this.getTarget(),objective:copy(a)});}else{a.progress=1;this.stats.deliveries++;a.reward=Math.round(a.reward*(.55+.45*a.cargo));}}
  }
  this.lastBodyHealth=clamp(state.bodyHealth??1,0,1);this._checkComplete();
 }
 _checkComplete(){
  const a=this.active;if(!a||a.progress<a.goal)return;
  this.completed++;this.award(a.reward,'JOB COMPLETE',a.kind==='delivery'?'delivery':'objective');this.message('DISPATCH',a.title+' complete. '+a.reward.toLocaleString('en-GB')+' points paid.');
  this.emit({type:'objective',phase:'completed',objective:copy(a)});this.active=null;this.offerIndex++;this._makeOffer();this.revision++;
 }
 getState(){return{wallet:this.wallet,earned:this.earned,spent:this.spent,owned:[...this.owned],stats:{...this.stats},active:this.active?copy(this.active):null,offer:this.offer?copy(this.offer):null,message:this.messages.at(-1)||null,messages:this.messages.map(copy),completed:this.completed,revision:this.revision,closeChain:this.time<this.chainUntil?this.closeChain:0};}
 consumeEvents(){return this.events.splice(0);}
 serialize(){return{version:1,wallet:this.wallet,earned:this.earned,spent:this.spent,owned:[...this.owned],stats:{...this.stats},active:this.active?copy(this.active):null,messages:this.messages.map(copy),time:this.time,serial:this.serial,completed:this.completed,offerIndex:this.offerIndex};}
}
