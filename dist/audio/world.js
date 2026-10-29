import {AUDIO_KIT} from './kit.js';
import {RADIO_KIT} from './radio-kit.js';
import {AMBIENT_KIT} from './ambient-kit.js';
import {StreetAcoustics} from './acoustics.js';
import {NPC_ENGINES} from './npc-engines.js';

const RATE=48000,TAU=Math.PI*2,MAX_ACTIVE=6,MAX_FADING=10,MAX_SIRENS=3;
const clamp=(n,a,b)=>Math.max(a,Math.min(b,Number.isFinite(n)?n:a));
const pole=hz=>1-Math.exp(-TAU*hz/RATE);
const loop=(data,p)=>{const at=Math.floor(p),i=at%data.length,f=p-at;return data[i]+(data[(i+1)%data.length]-data[i])*f;};
const noise=o=>{let x=o.seed;x^=x<<13;x^=x>>>17;x^=x<<5;o.seed=x>>>0;return o.seed/2147483648-1;};
const panGains=pan=>[Math.sqrt((1-pan)*.5),Math.sqrt((1+pan)*.5)];
const limit=x=>Math.sign(x)*Math.min(.94,Math.abs(x));
export const RADIO_VARIANTS={
 pursuit:['radioPriority','radioCall','radioReply1'],backup:['radioCall','radioRoger','radioAffirmative','radioReply1'],
 search:['radioCall','radioStanding','radioReply3'],spotted:['radioReply','radioAffirmative','radioReply1'],
 escaped:['radioReply3','radioRoger','radioReply'],arrest:['radioCall','radioReply1','radioAffirmative'],
 nightShift:['radioCall','radioStanding','radioRoger'],camera:['radioReply','radioRoger','radioAffirmative'],
 location:['radioReply1','radioReply','radioCall','radioReply3'],intercept:['radioRoger','radioReply1','radioAffirmative'],
 sector:['radioStanding','radioReply1','radioRoger'],clear:['radioReply3','radioReply','radioStanding'],
 blocked:['radioReply1','radioCall','radioReply3'],collision:['radioCall','radioReply1','radioReply'],
 check:['radioCall','radioAffirmative','radioRoger','radioReply1','radioReply3','radioStanding']
};
const RADIO_PHASES={pursuit:['chase'],backup:['chase'],spotted:['chase'],location:['chase'],intercept:['chase'],search:['search'],sector:['search'],clear:['search'],blocked:['chase','search'],collision:['chase','search'],escaped:['escaped','patrol'],arrest:['arrested','patrol']};
const npcProfile=value=>NPC_ENGINES[value]?value:['v6','boxer6','i6'].includes(value)?'i6t':['v10','v12'].includes(value)?'v8':'i4';
const LEVEL_KEYS=['traffic','horns','sirens','service','damage','worldEvents','radio','ambience','reflections'];

/** Independent, bounded world sound transport. Vehicle state is read only. */
export class SpatialWorldAudio{
 constructor(){
  this.context={listenerPosition:{x:0,z:0},heading:0,cameraHeading:0,playerHorn:false,servicing:null};this.hasListener=false;
  this.traffic=new Map();this.voices=[];this.events=[];this.counts={};this.time=0;this.seed=284917;this._lastEvent=new Map();
  this._playerHorn=0;this._hornPosition=0;this._service=0;this._serviceLow=0;this._serviceBody=0;this._serviceClock=0;this._serviceMode=null;
  this._damage=0;this._steam=0;this._steamLow=0;this._damagePosition=0;this._damagePhase=0;this._scrape=0;this._scrapeLow=0;
  this.acoustics=new StreetAcoustics();this._space=null;this._reverbMix=-1;
  this.radio=null;this.radioQueue=[];this._lastRadio=new Map();this._radioNext=0;this.radioDuck=0;this.radioPlayed=0;this.radioDropped=0;this._radioSerial=0;this._radioHistory=[];this._radioVariants=new Map();this.radioExpired=0;
  this._ambient={rain:0,birds:0,crickets:0,wind:0,water:0,industrial:0};this._birdPosition=0;this._cricketPosition=0;this._ambientLowL=0;this._ambientLowR=0;this._waterL=0;this._waterR=0;this._industry=0;this._ambientSeed={seed:849157};this._ambientTime=0;
  this.levels=Object.fromEntries(LEVEL_KEYS.map(k=>[k,0]));this.active=true;
 }
 setContext(value={}){
  this.context={...this.context,...value};
  if(value.listenerPosition&&Number.isFinite(value.listenerPosition.x)&&Number.isFinite(value.listenerPosition.z))this.hasListener=true;
  return this;
 }
 spatial(x,z,fallback=0){
  if(!this.hasListener||!Number.isFinite(x)||!Number.isFinite(z))return {pan:clamp(fallback,-.94,.94),distance:0,rear:1};
  const c=this.context,p=c.listenerPosition,dx=x-p.x,dz=z-p.z,distance=Math.hypot(dx,dz),heading=Number.isFinite(c.cameraHeading)?c.cameraHeading:(c.heading||0),right=c.listenerRight;
  const rx=Number.isFinite(right?.x)?right.x:-Math.cos(heading),rz=Number.isFinite(right?.z)?right.z:Math.sin(heading),length=Math.max(1e-5,Math.hypot(rx,rz));
  const pan=(dx*rx+dz*rz)/(length*Math.max(2,distance)),front=(dx*Math.sin(heading)+dz*Math.cos(heading))/Math.max(1,distance);
  return {pan:clamp(pan,-.94,.94),distance,rear:clamp(.78+.22*(front+1)*.5,.78,1)};
 }
 playerPoint(localX=0,localZ=0){const c=this.context,p=c.playerPosition??c.listenerPosition,h=c.heading||0;return {x:(p?.x||0)+localX*Math.cos(h)+localZ*Math.sin(h),z:(p?.z||0)-localX*Math.sin(h)+localZ*Math.cos(h)};}
 wheelPan(index,fallback=0){const p=this.context.audioAnchors?.wheels?.[index]||this.playerPoint(index%2?.87:-.87,index<2?1.30:-1.30);return this.hasListener?clamp(this.spatial(p.x,p.z,fallback).pan*2.4,-.78,.78):fallback;}
 setSources(sources=[],now=this.time){
  const candidates=(Array.isArray(sources)?sources:[]).filter(s=>s&&(Number.isFinite(s.distance)||(Number.isFinite(s.x)&&Number.isFinite(s.z)))).map(s=>{const spatial=this.spatial(s.x,s.z,s.pan),distance=this.hasListener&&Number.isFinite(s.x)&&Number.isFinite(s.z)?spatial.distance:Math.max(0,s.distance??0);return {source:s,spatial,distance};}).filter(v=>v.distance<(v.source.siren?330:110));
  // Reserve slots before taking nearby traffic. A crowd of civilian cars can
  // no longer remove every emergency vehicle from the mix.
  const sirens=candidates.filter(v=>v.source.siren).sort((a,b)=>a.distance-b.distance).slice(0,MAX_SIRENS);
  const selected=[...sirens,...candidates.filter(v=>!v.source.siren).sort((a,b)=>a.distance-b.distance).slice(0,MAX_ACTIVE-sirens.length)],active=new Set();
  for(const entry of selected){
   const s=entry.source,id=String(s.id??active.size),profile=npcProfile(s.engineId??s.engineFamily??(s.siren?'i6t':'i4')),bed=NPC_ENGINES[profile];if(active.has(id))continue;active.add(id);let voice=this.traffic.get(id);
   if(!voice){voice={id,profile,data:bed.data,referenceRpm:bed.referenceRpm,rate:bed.rate,position:(this.traffic.size*.23%1)*bed.data.length,gain:0,targetGain:0,pitch:.5,targetPitch:.5,pan:0,targetPan:0,low:0,lp:pole(4000),sirenLP:pole(6000),horn:0,targetHorn:0,hornPosition:0,siren:0,targetSiren:0,sirenPosition:clamp(s.sirenPhase??this.traffic.size*.287%1,0,1)*AUDIO_KIT.siren.data.length,sirenLow:0,doppler:1,ear:new Float32Array(48),earCursor:0,lastDistance:null,lastTime:now};this.traffic.set(id,voice);}
   if(voice.profile!==profile){voice.profile=profile;voice.data=bed.data;voice.referenceRpm=bed.referenceRpm;voice.rate=bed.rate;voice.position=0;voice.gain=0;voice.low=0;}
   const distance=entry.distance,throttle=clamp(s.throttle??.2,0,1),rpm=clamp(s.rpm??900+Math.abs(s.speed??0)*180,650,6500),delta=now-voice.lastTime;
   if(voice.lastDistance!==null&&delta>.003){const radial=clamp((distance-voice.lastDistance)/delta,-45,45);voice.doppler=clamp(343/(343+radial),.88,1.13);}
   voice.lastTime=now;voice.lastDistance=distance;voice.attenuation=1/(1+(distance/17)**1.8);
   const occlusion=1-clamp(s.occlusion??0,0,1)*.58;
   voice.targetGain=s.engineRunning===false?0:(.12+.10*throttle)*voice.attenuation*entry.spatial.rear*occlusion;voice.targetPitch=clamp(rpm/voice.referenceRpm,.42,3.2)*(voice.rate/RATE)*voice.doppler;voice.targetPan=entry.spatial.pan;
   voice.lp=pole(clamp((6500-distance*32)*entry.spatial.rear*occlusion,750,6500));voice.targetHorn=s.horn?.27*voice.attenuation:0;
   voice.targetSiren=s.siren?.40/(1+(distance/90)**1.6)*Math.sqrt(occlusion):0;voice.sirenLP=pole(clamp(7400-distance*10,2300,7400));voice.isSiren=!!s.siren;
  }
  for(const [id,v] of this.traffic)if(!active.has(id)){v.targetGain=v.targetHorn=v.targetSiren=0;if(v.gain<1e-5&&v.horn<1e-5&&v.siren<1e-5)this.traffic.delete(id);}
  while(this.traffic.size>MAX_FADING){const old=[...this.traffic.values()].find(v=>!active.has(v.id));if(!old)break;this.traffic.delete(old.id);}
  this.voices=[...this.traffic.values()];return this;
 }
 _sample(name,gain,{pan=0,delay=0,rate=1,x,z,duration=null,bus='world',fade=.015}={}){
  const kit=AUDIO_KIT[name]||RADIO_KIT[name];if(!kit||gain<=0)return;
  if(this.events.length>=32)this.events.shift();const spatial=this.spatial(x,z,pan),attenuation=Number.isFinite(x)&&this.hasListener?1/(1+(spatial.distance/16)**2):1,gains=panGains(spatial.pan);
  this.events.push({name,data:kit.data,position:-Math.max(0,delay)*RATE,rate:kit.rate/RATE*rate,end:duration?Math.min(kit.data.length,duration*kit.rate*rate):kit.data.length,gain:gain*attenuation,pan:spatial.pan,left:gains[0],right:gains[1],bus,fade:fade*kit.rate});
 }
 _queueRadio(detail={}){
  const code=String(detail.code||'check'),last=this._lastRadio.get(code)??-100,cooldown=code==='check'?1.8:code==='pursuit'?18:code==='camera'?8:5;
  if(this.time-last<cooldown){this.radioDropped++;return false;}
  const priority=code==='check'?10:code==='arrest'||code==='escaped'?8:Math.max(code==='pursuit'?7:code==='spotted'||code==='collision'?5:3,clamp(detail.priority??0,0,9));
  this._lastRadio.set(code,this.time);
  if(code==='arrest'||code==='escaped'){this.radioQueue.length=0;if(this.radio)this.radio.fadeOut=RATE*.12;}
  const item={code,message:String(detail.message??detail.text??'').slice(0,240),sample:null,priority,serial:++this._radioSerial,expires:this.time+(priority>=7?22:10),phaseBound:typeof detail.phase==='string'};
  if(code==='check'&&this.radio){this.radio.fadeOut=RATE*.08;this.radioQueue.length=0;}
  this.radioQueue.push(item);this.radioQueue.sort((a,b)=>b.priority-a.priority||a.serial-b.serial);if(this.radioQueue.length>3){this.radioQueue.pop();this.radioDropped++;}
  this.counts.radio=(this.counts.radio??0)+1;return true;
 }
 _startRadio(){
  if(this.radio||!this.radioQueue.length||this.time<this._radioNext)return;
  const phase=this.context.policePhase;this.radioQueue=this.radioQueue.filter(item=>{const valid=item.expires>=this.time&&(!item.phaseBound||!phase||!RADIO_PHASES[item.code]||RADIO_PHASES[item.code].includes(phase));if(!valid){this.radioDropped++;this.radioExpired++;}return valid;});
  if(!this.radioQueue.length)return;
  const item=this.radioQueue.shift(),pool=RADIO_VARIANTS[item.code]||RADIO_VARIANTS.location,start=this._radioVariants.get(item.code)||0;
  let choice=start%pool.length;for(let offset=0;offset<pool.length;offset++){const index=(start+offset)%pool.length;if(!this._radioHistory.slice(-2).includes(pool[index])){choice=index;break;}}
  if(pool[choice]===this._radioHistory.at(-1)&&pool.length>1)choice=(choice+1)%pool.length;
  item.sample=pool[choice];this._radioVariants.set(item.code,choice+1);this._radioHistory.push(item.sample);if(this._radioHistory.length>12)this._radioHistory.shift();
  const kit=RADIO_KIT[item.sample];this.radio={...item,data:kit.data,rate:kit.rate/RATE,position:-RATE*.08,fadeOut:null,fadeLength:0};this.radioPlayed++;
  this._sample('radioIn',.14,{pan:-.12,bus:'radio',fade:.005});
 }
 playEvent(type,detail={}){
  if(type==='radio')return this._queueRadio(detail);
  const intensity=clamp(detail.intensity??1,0,1.5),key=type+':'+(detail.phase||''),last=this._lastEvent.get(key)??-10;
  if(this.time-last<.085)return false;this._lastEvent.set(key,this.time);this.counts[type]=(this.counts[type]??0)+1;
  const position={x:detail.x,z:detail.z,pan:detail.pan??0};
  if(type==='lightToggle')this._sample('switch',.24*intensity,{...position,rate:detail.on===false?.92:1.04});
  else if(type==='horn')this._sample('horn',.22*intensity,position);
  else if(type==='sirenTest'){this.events=this.events.filter(e=>e.name!=='siren');this._sample('siren',.43,{duration:2.15,bus:'sirens',fade:.16,pan:.14});}
  else if(type==='speedCamera'){this._sample('click',.30*intensity,{pan:.25,rate:.72});this._sample('switch',.14*intensity,{delay:.045,pan:-.15,rate:1.4});}
  else if(type==='nearMiss'){this._sample('hat',.14*intensity,{pan:clamp(detail.pan??.25,-.8,.8),rate:.76});this._sample('snareAlt',.075*intensity,{delay:.025,pan:-.18,rate:1.25});}
  else if(type==='waypoint')this._sample('switch',.19*intensity,{pan:-.20,rate:1.30});
  else if(type==='objective'||type==='purchase'){this._sample('click',.18*intensity,{pan:-.22,rate:type==='purchase'?.8:1.1});this._sample('switch',.21*intensity,{pan:.22,delay:.10,rate:1.4});}
  else if(type==='reward'||type==='delivery'){this._sample('kick',.10*intensity,{rate:1.3});for(const[note,delay,pan]of[[67,.035,-.25],[72,.16,.18],[76,.30,.32]])this._sample('piano',.15*intensity,{delay,pan,rate:Math.pow(2,(note-69)/12)});if(type==='delivery')this._sample('snareAlt',.095*intensity,{delay:.10,pan:.05,rate:1.1});}
  else if(type==='mechanicalWarning'){this._sample('switch',.11*intensity,{pan:-.16,rate:1.18});this._sample('click',.08*intensity,{pan:-.10,delay:.18,rate:1.05});}
  else if(type==='mechanicalFailure'){this._sample('metal',.22*intensity,{...position,rate:1.28});this._sample('switch',.08*intensity,{...position,delay:.09,rate:.8});}
  else if(type==='engineHurt'){this._sample('metal',.16*intensity,{...position,rate:1.45});this._sample('switch',.10*intensity,{...position,delay:.06,rate:.65});}
  else if(type==='wheelLoss'){this._sample('metal',.42*intensity,{...position,rate:.74});this._sample('kick',.33*intensity,{...position,delay:.018,rate:1.1});this._sample('metal',.16*intensity,{...position,delay:.22,rate:1.32});}
  else if(type==='refuel'||type==='service'){
   const complete=detail.phase==='end'||detail.phase==='complete';this._sample('switch',.22*intensity,{...position,rate:complete?.88:1.1});this._sample(type==='service'?'metal':'click',.13*intensity,{...position,delay:.10,rate:type==='service'?1.4:.9});
  }else if(type==='escape'){
   // Original E-G-C-E phrase, using a recorded piano, below the music release.
   for(const [note,delay,gain,pan] of [[64,0,.18,-.25],[67,.14,.18,.14],[72,.31,.22,-.10],[76,.52,.17,.24],[60,.74,.14,-.18],[64,.76,.10,0],[67,.78,.10,.18]])this._sample('piano',gain*intensity,{delay,pan,rate:Math.pow(2,(note-69)/12)});
  }else if(type==='arrest'){
   this._sample('switch',.24*intensity,{pan:-.18});this._sample('metal',.12*intensity,{delay:.11,pan:.16,rate:.72});this._sample('piano',.18*intensity,{delay:.27,rate:Math.pow(2,(57-69)/12)});
  }else if(type==='pursuit'){this._sample('click',.19*intensity,{pan:-.2});this._sample('switch',.12*intensity,{delay:.12,pan:.2});}
  else if(type==='ui')this._sample('click',.15*intensity,position);
  else return false;
  return true;
 }
 clearTransients(){
  this.events.length=0;this._playerHorn=0;this._service=0;this.radio=null;this.radioQueue.length=0;this.radioDuck=0;this._radioNext=this.time;
  for(const v of this.voices)v.gain=v.horn=v.siren=0;for(const key of Object.keys(this._ambient))this._ambient[key]=0;this.acoustics.reset();
 }
 reset(){
  this.traffic.clear();this.voices=[];this.clearTransients();this._serviceMode=null;this._serviceClock=0;this._damage=this._scrape=this._steam=this._steamLow=0;this._lastEvent.clear();this._lastRadio.clear();this._radioHistory.length=0;this._radioVariants.clear();
  this.context={...this.context,playerHorn:false,servicing:null,engineHealth:1,engineFault:false,mechanical:null,damage:0,bodyScrape:0,wheelAttached:[true,true,true,true]};for(const k of LEVEL_KEYS)this.levels[k]=0;
 }
 hasSignal(active=true){
  const c=this.context,d=c.damage,health=c.engineHealth??d?.engineHealth??(typeof d==='number'?1-d:1),fault=c.engineFault??d?.engineFault,lost=(c.wheelAttached??d?.wheelAttached??[]).some(x=>x===false);
  return this.events.length>0||this.radio!==null||this.radioQueue.length>0||active&&(c.weather?.rain>0||this._ambient.rain>1e-5||!!c.acoustics?.ambient||this.voices.length>0||c.playerHorn||c.servicing||fault||health<.65||c.mechanical?.knock>0||c.mechanical?.steam>0||lost||c.bodyScrape>10||this._playerHorn>1e-5||this._service>1e-5||this._damage>1e-5||this._scrape>1e-5||this.acoustics.tail>1e-5);
 }
 mixDucking(mix={}){
  const nearest=this.voices.reduce((best,v)=>v.targetSiren>0?Math.min(best,v.lastDistance??330):best,Infinity),threat=(this.context.worldActive!==false&&Number.isFinite(nearest)?clamp((250-nearest)/220,0,1):0)*clamp(mix.sirens??1,0,1),radio=Math.max(this.radioDuck,(this.radio||this.radioQueue.length)?.65*clamp(mix.radio??.85,0,1):0);
  return {engine:1-radio*.24-threat*.08,music:1-radio*.62-threat*.18,radio,sirenThreat:threat};
 }
 renderInto(left,right,{mix={},active=true}={}){
  const c=this.context,environment=clamp(mix.environment??.7,0,1),mechanical=clamp(mix.mechanical??.8,0,1),sirens=clamp(mix.sirens??1,0,1),radioMix=clamp(mix.radio??.85,0,1),ambientMix=clamp(mix.ambience??.65,0,1),reverbMix=clamp(mix.reverb??.65,0,1),smooth=1-Math.exp(-1/(RATE*.045)),sums=Object.fromEntries(LEVEL_KEYS.map(k=>[k,0]));
  if(this._space!==c.acoustics||this._reverbMix!==reverbMix){this._space=c.acoustics;this._reverbMix=reverbMix;this.acoustics.setSpace(c.acoustics||{},reverbMix);}
  this._startRadio();
  const service=active?c.servicing:null,damage=c.damage,health=clamp(c.engineHealth??damage?.engineHealth??(typeof damage==='number'?1-damage:1),0,1),fault=c.engineFault??damage?.engineFault;
  const rpm=clamp(c.rpm??0,0,24000),hurtTarget=active&&c.engineRunning!==false&&rpm>250?Math.max(clamp(c.mechanical?.knock??0,0,1),fault?1:clamp((.65-health)/.65,0,1))*.045*mechanical:0,steamTarget=active?clamp(c.mechanical?.steam??0,0,1)*.025*mechanical:0;
  const lost=(c.wheelAttached??damage?.wheelAttached??[]).some(value=>value===false),scrapeWork=clamp(Math.sqrt(Math.max(0,c.bodyScrape??damage?.bodyScrape??0)/30000),0,1.4),scrapeTarget=active?Math.max(lost?clamp(Math.abs(c.speed||0)/15,0,1)*.045:0,scrapeWork*.065)*mechanical:0;
  const hornTarget=active&&c.playerHorn?.23*environment:0,serviceTarget=service==='fuel'?.060*environment:(service==='repair'||service==='components')?.035*mechanical:0;
  const hornPoint=this.playerPoint(0,1.5),hornG=panGains(this.spatial(hornPoint.x,hornPoint.z).pan),serviceG=panGains(service==='fuel'?.42:-.25),hurtPoint=this.playerPoint(0,1),hurtG=panGains(this.spatial(hurtPoint.x,hurtPoint.z).pan);
  const ambient=c.acoustics?.ambient??{},night=clamp(c.night??0,0,1),bedLevel=active&&c.acoustics?.ambient?ambientMix/(1+Math.abs(c.speed||0)/35):0,park=clamp(ambient.park??0,0,1);
  const ambientTargets={rain:active&&c.worldActive!==false?clamp(c.weather?.rain??0,0,1)*.13*ambientMix*environment:0,birds:(.012+park*.125)*(1-night)*bedLevel,crickets:(.010+clamp(ambient.insects??park,0,1)*.085)*night*bedLevel,wind:clamp(ambient.wind??.3,0,1)*.020*bedLevel,water:clamp(ambient.water??0,0,1)*.024*bedLevel,industrial:clamp(ambient.industrial??0,0,1)*.025*bedLevel};
  if(service!==this._serviceMode){this._serviceMode=service;this._serviceClock=0;}
  if(service==='repair'||service==='components'){this._serviceClock-=left.length/RATE;if(this._serviceClock<=0){this._sample('metal',.055*mechanical,{pan:-.3,rate:1.3+noise(this)*.15});this._sample('switch',.05*mechanical,{pan:.2,delay:.10,rate:.8});this._serviceClock=.64+noise(this)*.12;}}
  const birds=AMBIENT_KIT.birds,crickets=AMBIENT_KIT.crickets;
  for(let k=0;k<left.length;k++){
   let l=0,r=0,trafficEnergy=0,hornEnergy=0,sirenEnergy=0;
   for(const v of this.voices){
    v.gain+=((active?v.targetGain*environment:0)-v.gain)*smooth;v.horn+=((active?v.targetHorn*environment:0)-v.horn)*smooth;v.siren+=((active?v.targetSiren*sirens:0)-v.siren)*smooth;v.pitch+=(v.targetPitch-v.pitch)*smooth;v.pan+=(v.targetPan-v.pan)*smooth;
    if(v.gain<1e-7&&v.horn<1e-7&&v.siren<1e-7)continue;
    const raw=loop(v.data,v.position);v.position=(v.position+v.pitch)%v.data.length;v.low+=(raw-v.low)*v.lp;
    const horn=loop(AUDIO_KIT.horn.data,v.hornPosition)*v.horn;v.hornPosition=(v.hornPosition+AUDIO_KIT.horn.rate/RATE*clamp(v.doppler,.88,1.13))%AUDIO_KIT.horn.data.length;
    const source=loop(AUDIO_KIT.siren.data,v.sirenPosition);v.sirenPosition=(v.sirenPosition+AUDIO_KIT.siren.rate/RATE*v.doppler)%AUDIO_KIT.siren.data.length;v.sirenLow+=(source-v.sirenLow)*v.sirenLP;const siren=v.sirenLow*v.siren;
    const engine=v.low*v.gain,value=engine+horn+siren;v.ear[v.earCursor]=value;const delay=Math.round(Math.abs(v.pan)*20),delayed=v.ear[(v.earCursor-delay+48)%48];v.earCursor=(v.earCursor+1)%48;
    l+=(v.pan>0?delayed:value)*Math.sqrt((1-v.pan)*.5);r+=(v.pan<0?delayed:value)*Math.sqrt((1+v.pan)*.5);trafficEnergy+=engine*engine;hornEnergy+=horn*horn;sirenEnergy+=siren*siren;
   }
   this._playerHorn+=(hornTarget-this._playerHorn)*(hornTarget>this._playerHorn?.002:.001);
   const playerHorn=loop(AUDIO_KIT.horn.data,this._hornPosition)*this._playerHorn;this._hornPosition=(this._hornPosition+AUDIO_KIT.horn.rate/RATE)%AUDIO_KIT.horn.data.length;l+=playerHorn*hornG[0];r+=playerHorn*hornG[1];hornEnergy+=playerHorn*playerHorn;
   const random=noise(this),other=noise(this._ambientSeed);this._serviceLow+=(random-this._serviceLow)*.065;this._serviceBody+=(random-this._serviceBody)*.010;this._service+=(serviceTarget-this._service)*smooth;
   const pump=(this._serviceLow*.8+this._serviceBody*2.0+(random-this._serviceLow)*.10)*this._service;l+=pump*serviceG[0];r+=pump*serviceG[1];
   this._steam+=(steamTarget-this._steam)*smooth;this._steamLow+=(random-this._steamLow)*.12;this._damage+=(hurtTarget-this._damage)*smooth;this._scrape+=(scrapeTarget-this._scrape)*smooth;this._scrapeLow+=(random-this._scrapeLow)*.18;
   const oldPhase=this._damagePhase;this._damagePhase=(this._damagePhase+rpm/60/RATE*.5)%1;if(this._damagePhase<oldPhase&&this._damage>1e-5)this._damagePosition=0;const rattle=loop(AUDIO_KIT.metal.data,this._damagePosition);this._damagePosition=(this._damagePosition+1.15*AUDIO_KIT.metal.rate/RATE)%AUDIO_KIT.metal.data.length;
   const hurt=(random-this._steamLow)*this._steam+rattle*this._damage*Math.pow(.5+.5*Math.cos(TAU*this._damagePhase),5)+(this._scrapeLow*.65+rattle*.50)*this._scrape;l+=hurt*hurtG[0];r+=hurt*hurtG[1];
   for(const key in this._ambient)this._ambient[key]+=(ambientTargets[key]-this._ambient[key])*.000035;
   this._ambientLowL+=(random-this._ambientLowL)*.018;this._ambientLowR+=(other-this._ambientLowR)*.023;this._waterL+=(random-this._waterL)*.095;this._waterR+=(other-this._waterR)*.11;this._industry+=(random-this._industry)*.004;
   this._ambientTime=(this._ambientTime+1/RATE)%1000;const waterSwell=.65+.35*Math.sin(this._ambientTime*.83);
   const ambL=(this._waterL-this._ambientLowL)*this._ambient.rain+loop(birds.left,this._birdPosition)*this._ambient.birds+loop(crickets.left,this._cricketPosition)*this._ambient.crickets+this._ambientLowL*this._ambient.wind+(this._waterL-this._ambientLowL)*this._ambient.water*waterSwell+this._industry*this._ambient.industrial;
   const ambR=(this._waterR-this._ambientLowR)*this._ambient.rain+loop(birds.right,this._birdPosition)*this._ambient.birds+loop(crickets.right,this._cricketPosition)*this._ambient.crickets+this._ambientLowR*this._ambient.wind+(this._waterR-this._ambientLowR)*this._ambient.water*waterSwell+this._industry*this._ambient.industrial*.78;
   this._birdPosition=(this._birdPosition+birds.rate/RATE)%birds.left.length;this._cricketPosition=(this._cricketPosition+crickets.rate/RATE)%crickets.left.length;
   l+=ambL;r+=ambR;let eventEnergy=0,radioL=0,radioR=0;
   for(const event of this.events){
    if(event.position<0){event.position++;continue;}if(event.position>=event.end)continue;
    const at=Math.floor(event.position),part=event.position-at,envelope=Math.min(1,event.position/Math.max(1,event.fade),(event.end-event.position)/Math.max(1,event.fade)),bus=event.bus==='sirens'?sirens:event.bus==='radio'?radioMix:1,value=(event.data[at]+((event.data[at+1]??0)-event.data[at])*part)*event.gain*envelope*bus;event.position+=event.rate;
    if(event.bus==='radio'){radioL+=value*event.left;radioR+=value*event.right;}else {l+=value*event.left;r+=value*event.right;}eventEnergy+=value*value;if(event.bus==='sirens')sirenEnergy+=value*value;
   }
   const dryL=l,dryR=r,echo=this.acoustics.sample(l,r);l=echo[0];r=echo[1];sums.reflections+=(l-dryL)**2+(r-dryR)**2;
   const radio=this.radio;let radioValue=0;
   if(radio){
    const at=Math.max(0,Math.floor(radio.position)),f=Math.max(0,radio.position-at);let fade=1;
    if(radio.fadeOut!==null){if(!radio.fadeLength)radio.fadeLength=radio.fadeOut;fade=radio.fadeOut/Math.max(1,radio.fadeLength);radio.fadeOut--;}
    radioValue=(radio.position<0?0:Math.min(1,radio.position/(RATE*.01)))*((radio.data[at]??0)+((radio.data[at+1]??0)-(radio.data[at]??0))*f)*.70*radioMix*fade;radio.position+=radio.rate;
    if(radio.position>=radio.data.length||radio.fadeOut!==null&&radio.fadeOut<=0){this.radio=null;this._radioNext=this.time+k/RATE+.38;this._sample('radioIn',.075,{pan:-.12,bus:'radio',fade:.005});}
   }
   this.radioDuck+=(((this.radio?1:0)*radioMix-this.radioDuck))*.0003;
   l+=radioL+radioValue*.76;r+=radioR+radioValue*.65;
   left[k]=limit(left[k]+l);right[k]=limit(right[k]+r);sums.traffic+=trafficEnergy;sums.horns+=hornEnergy;sums.sirens+=sirenEnergy;sums.service+=pump*pump;sums.damage+=hurt*hurt;sums.worldEvents+=eventEnergy;sums.radio+=radioValue*radioValue;sums.ambience+=(ambL*ambL+ambR*ambR)*.5;
  }
  this.events=this.events.filter(e=>e.position<e.end);this.time+=left.length/RATE;for(const key of LEVEL_KEYS)this.levels[key]=Math.sqrt(sums[key]/Math.max(1,left.length));return this.levels;
 }
 diagnostics(){return {time:this.time,voices:this.voices.length,activeVoices:this.voices.filter(v=>v.targetGain>0||v.targetSiren>0).length,engineProfiles:[...new Set(this.voices.map(v=>v.profile))],sirenVoices:this.voices.filter(v=>v.targetSiren>0).length,events:this.events.length,eventCounts:{...this.counts},listenerHeading:this.context.cameraHeading,playerHorn:this._playerHorn,servicing:this._serviceMode,levels:{...this.levels},spatial:this.hasListener,radio:{active:this.radio?.code??null,sample:this.radio?.sample??null,variantCount:8,recentSamples:[...this._radioHistory],expired:this.radioExpired,summary:this.radio?.message??null,queued:this.radioQueue.length,played:this.radioPlayed,dropped:this.radioDropped,duck:this.radioDuck,kind:'recorded contextual chatter; captions carry tactical summaries'},ambience:{...this._ambient},acoustics:this.acoustics.diagnostics(),ducking:this.mixDucking()};}
}
