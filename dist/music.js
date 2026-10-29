import {AUDIO_KIT} from './audio/kit.js';
import {MUSIC_DATA,MUSIC_BPM,MUSIC_BARS,MUSIC_DURATION} from './audio/music-track.js';
import {CHASE_DATA,CHASE_BPM,CHASE_DURATION} from './audio/chase-track.js';
const clamp=(n,a,b)=>Math.max(a,Math.min(b,Number.isFinite(n)?n:a));
const modes=new Set(['menu','drive','chase','search','escape','arrest']);
const set=(param,value,time,lag=.2)=>param?.setTargetAtTime?.(value,time,lag);
const approach=(a,b,rate,dt)=>a+(b-a)*(1-Math.exp(-rate*dt));

/** Separate recorded cruising and pursuit arrangements, with continuous release.
 * Audio time schedules every note; no method advances MotorLab. */
export class GameMusic{
 constructor(){
  this.context=null;this.destination=null;this.ready=false;this.error=null;this._preparing=null;
  this.state={enabled:true,volume:.42,mode:'menu',intensity:0,heat:0,proximity:0,speed:0,nitrous:0,drift:0,nearMiss:0,searchProgress:0,paused:false};
  this.masterVolume=.48;this.muted=false;this.duck=1;this.buffers=new Map();this.notes=new Set();this.base=null;this.chaseBases=[];
  this.origin=0;this.offset=0;this.chaseOffset=0;this.nextStep=0;this.nextTensionStep=0;this.scheduled=0;this.maxVoices=0;this.modeChanges=0;this._modeSince=0;this._lastUpdate=null;
  this.energy=0;this.chaseLevel=0;this.bandLevel=.75;this._escapeEnergy=0;this._escapeChase=0;this._transitionSerial=0;this._playedTransition=-1;this._pauseAt=null;this._lastNearMiss=-10;this._nearMissWasHigh=false;this.hits={};
  this.focus={managed:false,hidden:false,reading:false,paused:false,backgroundMusic:false};this._freezeAt=null;this._silenceTimer=null;this.focusGain=1;this.focusCutoff=18000;this.masterLevel=0;
 }
 async prepare(context,destination){
  if(this.context===context&&this._preparing)return this._preparing;if(this.context===context&&this.ready)return true;
  this.context=context;this.destination=destination;this.gain=context.createGain();this.gain.gain.value=0;
  this.filter=context.createBiquadFilter();this.filter.type='lowpass';this.filter.frequency.value=6500;this.filter.Q.value=.45;
  this.bandGain=context.createGain();this.bandGain.gain.value=.75;this.bandGain.connect(this.filter);this.filter.connect(this.gain);
  this.chaseFilter=context.createBiquadFilter();this.chaseFilter.type='lowpass';this.chaseFilter.frequency.value=8000;this.chaseFilter.Q.value=.55;
  this.chaseGain=context.createGain();this.chaseGain.gain.value=0;this.chaseGain.connect(this.chaseFilter);this.chaseFilter.connect(this.gain);
  this.sectionGains=[context.createGain(),context.createGain()];this.sectionGains.forEach((node,i)=>{node.gain.value=i?0:1;node.connect(this.chaseGain);});
  this.focusFilter=context.createBiquadFilter();this.focusFilter.type='lowpass';this.focusFilter.frequency.value=18000;this.focusFilter.Q.value=.4;this.gain.connect(this.focusFilter);this.focusFilter.connect(destination);
  for(const name of ['kick','snare','snareAlt','hat','openHat','crash','piano','metal']){const sample=AUDIO_KIT[name],buffer=context.createBuffer(1,sample.data.length,sample.rate);buffer.getChannelData(0).set(sample.data);this.buffers.set(name,buffer);}
  const decode=async(name,data)=>{try{const bytes=Uint8Array.from(atob(data),c=>c.charCodeAt(0)),buffer=await context.decodeAudioData(bytes.buffer);this.buffers.set(name,buffer);}catch(error){this.error=(this.error?this.error+'; ':'')+name+': '+(error?.message||'decoding unavailable');}};
  this._preparing=Promise.all([decode('band',MUSIC_DATA),decode('chase',CHASE_DATA)]).then(()=>{this.ready=this.buffers.has('band')||this.buffers.has('chase');return this.ready;});return this._preparing;
 }
 setState(values={}){
  const previous=this.state.mode;
  for(const key of ['enabled','paused'])if(typeof values[key]==='boolean')this.state[key]=values[key];
  for(const key of ['volume','intensity','proximity','drift','nearMiss','searchProgress'])if(Number.isFinite(values[key]))this.state[key]=clamp(values[key],0,1);
  if(Number.isFinite(values.speed))this.state.speed=clamp(values.speed,0,120);if(Number.isFinite(values.heat))this.state.heat=clamp(values.heat,0,3);
  if(typeof values.nitrous==='boolean'||Number.isFinite(values.nitrous))this.state.nitrous=clamp(Number(values.nitrous),0,1);
  if(modes.has(values.mode))this.state.mode=values.mode;
  if(previous!==this.state.mode){this.modeChanges++;this._modeSince=this.context?.currentTime??0;if(this._pauseAt!==null)this._pauseAt=this._modeSince;if(this._freezeAt!==null)this._freezeAt=this._modeSince;this._transitionSerial++;if(this.state.mode==='escape'){this._escapeEnergy=this.energy;this._escapeChase=this.chaseLevel;}if(this.state.mode==='chase')this._escapeEnergy=0;}
  return this;
 }
 setFocus(values={}){let changed=!this.focus.managed;this.focus.managed=true;for(const key of ['hidden','reading','paused','backgroundMusic'])if(typeof values[key]==='boolean'&&this.focus[key]!==values[key]){this.focus[key]=values[key];changed=true;}if(changed)this.update();return this;}
 setGlobal({volume=this.masterVolume,muted=this.muted,duck=this.duck}={}){this.masterVolume=clamp(volume,0,1);this.muted=!!muted;this.duck=clamp(duck,.25,1);return this;}
 _stop(preserve=true){
  const now=this.context?.currentTime??0;
  if(this.base){if(preserve)this.offset=((Math.max(now,this.startedAt??now)-this.origin)%MUSIC_DURATION+MUSIC_DURATION)%MUSIC_DURATION;try{this.base.stop();this.base.disconnect();}catch{}this.base=null;}
  this._stopChase(preserve);
  for(const voice of this.notes){try{voice.source.stop();voice.source.disconnect();voice.gain.disconnect();voice.pan?.disconnect();}catch{}}this.notes.clear();
 }
 _stopChase(preserve=true){
  if(preserve&&this.chaseBases.length){const now=this.context?.currentTime??0;this.chaseOffset=((Math.max(now,this.chaseStartedAt??now)-this.chaseOrigin)%(CHASE_DURATION/2)+CHASE_DURATION/2)%(CHASE_DURATION/2);}
  for(const source of this.chaseBases)try{source.stop();source.disconnect();}catch{}this.chaseBases.length=0;
 }
 _start(){
  const ctx=this.context,buffer=this.buffers.get('band');if(!buffer)return;const at=ctx.currentTime+.055,source=ctx.createBufferSource();source.buffer=buffer;source.loop=true;source.loopStart=0;source.loopEnd=Math.min(MUSIC_DURATION,buffer.duration);source.connect(this.bandGain);
  const offset=this.offset%source.loopEnd;this.origin=at-offset;this.startedAt=at;this.nextStep=Math.ceil((at-this.origin)/(60/MUSIC_BPM/4));source.start(at,offset);this.base=source;
 }
 _startChase(){
  const ctx=this.context,buffer=this.buffers.get('chase');if(!buffer)return;const at=ctx.currentTime+.035,half=Math.min(CHASE_DURATION,buffer.duration)/2,offset=this.chaseOffset%half;this.chaseOrigin=at-offset;this.chaseStartedAt=at;this.nextTensionStep=Math.ceil((at-this.chaseOrigin)/(60/CHASE_BPM/4));
  for(let i=0;i<2;i++){const source=ctx.createBufferSource();source.buffer=buffer;source.loop=true;source.loopStart=i*half;source.loopEnd=(i+1)*half;source.connect(this.sectionGains[i]);source.start(at,i*half+offset);this.chaseBases.push(source);}
 }
 _hit(name,time,gain,pan=0,rate=1){
  if(this.notes.size>=48)return;const ctx=this.context,buffer=this.buffers.get(name);if(!buffer||gain<=.0001)return;
  const source=ctx.createBufferSource(),level=ctx.createGain(),panner=ctx.createStereoPanner?.();source.buffer=buffer;source.playbackRate.value=rate;const duration=Math.min(3,buffer.duration/rate);
  level.gain.setValueAtTime(0,time);level.gain.linearRampToValueAtTime(gain,time+.004);level.gain.setValueAtTime(gain,Math.max(time+.006,time+duration-.08));level.gain.linearRampToValueAtTime(0,time+duration);
  source.connect(level);if(panner){panner.pan.value=pan;level.connect(panner);panner.connect(this.gain);}else level.connect(this.gain);
  const voice={source,gain:level,pan:panner,end:time+duration};this.notes.add(voice);source.onended=()=>{this.notes.delete(voice);try{source.disconnect();level.disconnect();panner?.disconnect();}catch{}};
  source.start(time);source.stop?.(time+duration+.005);this.scheduled++;this.hits[name]=(this.hits[name]||0)+1;this.maxVoices=Math.max(this.maxVoices,this.notes.size);
 }
 _step(number,time){
  const step=number%16,bar=Math.floor(number/16),mode=this.state.mode;if(mode!=='drive')return;
  const intensity=clamp(this.state.intensity*.4+this.state.speed/80+this.state.nitrous*.25+this.state.drift*.15,0,1),energy=.055+intensity*.16;
  if([0,8].includes(step))this._hit('kick',time,energy*.8,0);if([4,12].includes(step))this._hit(bar%3?'snare':'snareAlt',time+.004,energy*.48,-.18);
  if(step%2===0||this.state.nitrous>.2)this._hit(step===14&&bar%4===3?'openHat':'hat',time,energy*.24,.40);
 }
 _tensionStep(number,time){
  const step=number%16,bar=Math.floor(number/16),mode=this.state.mode,energy=this.energy;if(!['chase','search','escape'].includes(mode)||energy<.015)return;
  if(mode==='search'){
   if([0,8].includes(step))this._hit('kick',time,.065*energy,-.1,.86);
   if(step===2||step===10)this._hit('piano',time,.085*energy,step===2?-.38:.36,Math.pow(2,((bar%2?50:45)-69)/12));
   if(step===14)this._hit('hat',time,.025*energy,.42,.84);return;
  }
  const release=mode==='escape'?Math.exp(-Math.max(0,time-this._modeSince)/1.8):1;
  if([0,3,8,11].includes(step))this._hit('kick',time,.19*energy*release,0,1);
  if([4,12].includes(step)||energy>.72&&[7,15].includes(step))this._hit(bar%2?'snare':'snareAlt',time+.003,.13*energy*release,-.17,1.02);
  if(step%2===0||energy>.65)this._hit(step===15&&bar%2?'openHat':'hat',time,.058*energy*release,step%2?.42:-.28);
  if(mode==='chase'&&step===0&&bar%4===0)this._hit('crash',time,.10*energy,-.38);
  if(mode==='chase'&&energy>.72&&[2,6,10,14].includes(step))this._hit('metal',time,.025*energy,step%3?.45:-.42,1.2);
 }
 _transition(now){
  if(this._playedTransition===this._transitionSerial)return;this._playedTransition=this._transitionSerial;const mode=this.state.mode;
  if(mode==='chase'){this._hit('kick',now+.01,.26,0,.8);this._hit('crash',now+.015,.15,-.35,.94);}
  // The separate escape event owns the relief phrase. This transport lets the
  // pursuit arrangement breathe out underneath it instead of doubling it.
 }
 update(){
  const ctx=this.context;if(!ctx)return;const now=ctx.currentTime,dt=this._lastUpdate===null?1/60:clamp(now-this._lastUpdate,0,.15);this._lastUpdate=now;
  const hiddenStop=this.focus.hidden&&!this.focus.backgroundMusic,active=this.ready&&this.state.enabled&&!this.muted&&ctx.state==='running'&&!hiddenStop&&(!this.state.paused||this.focus.managed),frozen=!active||this.state.paused||this.focus.paused||this.focus.reading||this.focus.hidden;
  if(frozen&&this._freezeAt===null)this._freezeAt=now;else if(!frozen&&this._freezeAt!==null){this._modeSince+=now-this._freezeAt;this._freezeAt=null;}
  if(!active){if(this._pauseAt===null)this._pauseAt=now;this.masterLevel=0;set(this.gain?.gain,0,now,hiddenStop?.075:.025);
   if(hiddenStop&&!this.muted&&this.state.enabled){if(this._silenceTimer===null)this._silenceTimer=setTimeout(()=>{this._silenceTimer=null;if(this.focus.hidden&&!this.focus.backgroundMusic)this._stop(true);},280);}
   else{if(this._silenceTimer!==null){clearTimeout(this._silenceTimer);this._silenceTimer=null;}this._stop(true);}return;}
  if(this._silenceTimer!==null){clearTimeout(this._silenceTimer);this._silenceTimer=null;}this._pauseAt=null;
  if(!this.base)this._start();if(!frozen)this._transition(now);
  const mode=this.state.mode,elapsed=Math.max(0,(this._freezeAt??now)-this._modeSince),heat=this.state.heat>1?this.state.heat/3:this.state.heat,threat=clamp(this.state.intensity*.43+heat*.28+this.state.proximity*.32+this.state.nitrous*.08+this.state.nearMiss*.12,0,1),simulationDt=frozen?0:dt;
  const targetEnergy=mode==='chase'?.38+threat*.62:mode==='search'?(.20+threat*.22)*(1-this.state.searchProgress*.4):mode==='escape'?this._escapeEnergy*Math.exp(-elapsed/2.8):0;
  this.energy=approach(this.energy,targetEnergy,targetEnergy>this.energy?2.4:.65,simulationDt);
  const chaseTarget=mode==='chase'?.72+this.energy*.46:mode==='search'?.14+this.energy*.12:mode==='escape'?this._escapeChase*Math.exp(-elapsed/2.4):0;
  this.chaseLevel=approach(this.chaseLevel,chaseTarget,chaseTarget>this.chaseLevel?3.4:1.1,simulationDt);
  const bandTarget=mode==='chase'?.015:mode==='search'?0:mode==='arrest'?.10:mode==='escape'?.86*clamp((elapsed-2)/6,0,1):mode==='menu'?.72:.88;
  this.bandLevel=approach(this.bandLevel,bandTarget,mode==='escape'?.8:2.8,frozen?dt:simulationDt);
  if(this.chaseLevel>.002&&!this.chaseBases.length)this._startChase();if(this.chaseLevel<.001&&this.chaseBases.length&&!['chase','search','escape'].includes(mode))this._stopChase(false);
  const nearHigh=this.state.nearMiss>.55;if(!frozen&&nearHigh&&!this._nearMissWasHigh&&now-this._lastNearMiss>2&&['drive','chase'].includes(mode)){this._hit('snareAlt',now+.015,.07,-.25,.82);this._lastNearMiss=now;}this._nearMissWasHigh=nearHigh;
  const reading=this.focus.reading||this.focus.paused||this.state.paused,focusTarget=this.focus.hidden?.18:reading?.28:1;
  this.focusGain=focusTarget;this.focusCutoff=this.focus.hidden?1200:reading?1800:18000;
  const master=mode==='arrest'?.35:mode==='menu'?.65:mode==='chase'?1.05:.80;this.masterLevel=this.masterVolume*this.state.volume*master*this.duck*this.focusGain;set(this.gain.gain,this.masterLevel,now,.12);set(this.focusFilter.frequency,this.focusCutoff,now,.12);
  set(this.bandGain.gain,this.bandLevel,now,.08);set(this.filter.frequency,mode==='menu'?6800:10000+this.state.speed*45,now,.45);
  set(this.chaseGain.gain,this.chaseLevel,now,.08);set(this.chaseFilter.frequency,mode==='search'?1900:mode==='escape'?2500+Math.exp(-elapsed/3)*6500:8000+this.energy*6500,now,.45);
  const high=clamp((this.energy-.40)/.55,0,1);set(this.sectionGains[0].gain,Math.sqrt(1-high),now,.35);set(this.sectionGains[1].gain,Math.sqrt(high),now,.35);
  for(const voice of [...this.notes])if(voice.end<now){this.notes.delete(voice);try{voice.source.disconnect();voice.gain.disconnect();voice.pan?.disconnect();}catch{}}
  const schedule=(field,origin,duration,callback)=>{if(origin+this[field]*duration<now-.08)this[field]=Math.ceil((now+.015-origin)/duration);let n=0;while(origin+this[field]*duration<now+.14&&n++<12){const time=origin+this[field]*duration;if(time>=now+.003)callback.call(this,this[field],time);this[field]++;}};
  if(!frozen){if(this.base)schedule('nextStep',this.origin,60/MUSIC_BPM/4,this._step);
  if(this.chaseBases.length)schedule('nextTensionStep',this.chaseOrigin,60/CHASE_BPM/4,this._tensionStep);}
 }
 reset(){if(this._silenceTimer!==null){clearTimeout(this._silenceTimer);this._silenceTimer=null;}this._stop(false);this.offset=this.chaseOffset=0;this.nextStep=this.nextTensionStep=0;this.energy=this.chaseLevel=0;this._lastUpdate=null;this._pauseAt=this._freezeAt=null;this._nearMissWasHigh=false;}
 diagnostics(){return {ready:this.ready,enabled:this.state.enabled,mode:this.state.mode,intensity:this.state.intensity,energy:this.energy,chaseLevel:this.chaseLevel,bandLevel:this.bandLevel,paused:this.state.paused,focus:{...this.focus,gain:this.focusGain,cutoff:this.focusCutoff},masterLevel:this.masterLevel,volume:this.state.volume,bpm:this.chaseLevel>.1?CHASE_BPM:MUSIC_BPM,bars:MUSIC_BARS,playing:!!this.base,chaseLoops:this.chaseBases.length,activeVoices:this.notes.size,maxVoices:this.maxVoices,scheduledHits:this.scheduled,hits:{...this.hits},error:this.error,source:'Umplix driving rock, bertsz pursuit cue and VCSL acoustic percussion'};}
}
