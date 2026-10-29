/** A bounded rumble mixer. No steering-torque / force-feedback emulation. */
const clamp=(n,a,b)=>Math.max(a,Math.min(b,Number.isFinite(n)?n:a));
const smooth=(a,b,rate,dt)=>a+(b-a)*(1-Math.exp(-rate*dt));
const TAU=Math.PI*2;
const EVENTS={
 nearMiss:[[0,.08,.10,.36],[.11,.06,.04,.22]],
 objective:[[0,.10,.18,.22],[.17,.14,.28,.35]],
 reward:[[0,.08,.12,.30],[.13,.10,.20,.42]],
 purchase:[[0,.09,.20,.16],[.15,.07,.10,.25]],
 delivery:[[0,.11,.20,.25],[.18,.15,.36,.44]],
 waypoint:[[0,.06,.07,.16]],
 pursuit:[[0,.17,.32,.40],[.25,.13,.22,.34]],
 escape:[[0,.10,.22,.24],[.20,.17,.13,.32]],
 mechanicalWarning:[[0,.07,.08,.19],[.17,.08,.06,.16]],
 mechanicalFailure:[[0,.13,.39,.30],[.19,.12,.24,.44]]
};
export class DrivingFeedback{
 constructor(){this.time=0;this.target=null;this.nextSend=0;this.strong=0;this.weak=0;this.pulseStrong=0;this.pulseWeak=0;this.pulseTime=0;this.lastGear=null;this.playing=false;this.inFlight=new Set();this.revision=0;this.failedUntil=0;this.calls=0;this.stops=0;this.lastLevels={strong:0,weak:0};this.events=[];this._eventLast=new Map();this.eventCounts={};}
 pulse(strength=.3,duration=90){this.pulseStrong=Math.max(this.pulseStrong,clamp(strength,0,1));this.pulseWeak=Math.max(this.pulseWeak,clamp(strength*.78,0,1));this.pulseTime=Math.max(this.pulseTime,clamp(duration,0,500)/1000);}
 event(type,intensity=1){const pattern=EVENTS[type];if(!pattern)return false;const last=this._eventLast.get(type)??-100;if(this.time-last<(type==='nearMiss'?.45:.18))return false;this._eventLast.set(type,this.time);this.eventCounts[type]=(this.eventCounts[type]||0)+1;for(const [delay,duration,strong,weak]of pattern)this.events.push({start:this.time+delay,end:this.time+delay+duration,strong:strong*clamp(intensity,0,1),weak:weak*clamp(intensity,0,1)});if(this.events.length>12)this.events.splice(0,this.events.length-12);return true;}
 _actuator(target){
  const a=target?.gp?.vibrationActuator;
  if(a?.playEffect&&(!a.effects?.length||a.effects.includes('dual-rumble')))return {node:a,kind:'dual-rumble'};
  const legacy=target?.gp?.hapticActuators?.find?.(a=>typeof a?.pulse==='function');
  return legacy?{node:legacy,kind:'pulse'}:null;
 }
 stop(){
  const old=this.target,actuator=this._actuator(old),wasPlaying=this.playing||this.inFlight.size>0;
  this.revision++;this.playing=false;this.inFlight.clear();this.events.length=0;this.strong=this.weak=this.pulseStrong=this.pulseWeak=this.pulseTime=0;this.lastGear=null;this.lastLevels={strong:0,weak:0};
  if(wasPlaying&&actuator){
   this.stops++;
   try{const p=actuator.node.reset?.()??(actuator.kind==='pulse'?actuator.node.pulse(0,0):actuator.node.playEffect('dual-rumble',{duration:0,startDelay:0,strongMagnitude:0,weakMagnitude:0}));Promise.resolve(p).catch(()=>{});}catch{}
  }
  this.target=null;this.nextSend=this.time;return this;
 }
 update(state,dt,{active=true,target=null,enabled=true,intensity=1}={}){
  dt=clamp(dt,0,.1);this.time+=dt;
  if(!active||!enabled||!target||!this._actuator(target)){this.stop();return this.lastLevels;}
  if(this.target?.key!==target.key){if(this.target)this.stop();this.target=target;}
  else this.target=target;
  const s=state||{},speed=Math.abs(s.speed||0),wheels=s.wheelAudio||[],contacts=wheels.filter(w=>w.contact&&w.load>20);
  const work=contacts.reduce((sum,w)=>sum+Math.max(0,w.tyrePower||0),0);
  const slip=clamp(Math.sqrt(work/65000),0,1);
  const rough=contacts.length?contacts.reduce((sum,w)=>sum+(w.roughness||0)*Math.min(35,Math.hypot(w.longitudinalSpeed||0,w.lateralSpeed||0)),0)/contacts.length:0;
  const hit=contacts.reduce((max,w)=>Math.max(max,w.impactSpeed||0),0);
  const boost=!!(s.boosting||s.nosActive||s.nitroActive),throttle=clamp(s.throttle||0,0,1);
  const boostStrong=boost?.40+.035*Math.sin(this.time*TAU*9):0,boostWeak=boost?.58+.055*Math.sin(this.time*TAU*15):0;
  const road=clamp(rough,0,.6),chassis=clamp(hit*.13,0,.40),drive=s.engineRunning&&speed>.8?throttle*.035:0;
  const absPulse=s.absActive?(.5+.5*Math.sin(this.time*TAU*13)):0;
  if(this.lastGear!==null&&s.gear!==this.lastGear&&s.gear!==undefined)this.pulse(.25,95);this.lastGear=s.gear??this.lastGear;
  if(this.pulseTime>0)this.pulseTime=Math.max(0,this.pulseTime-dt);else this.pulseStrong=this.pulseWeak=0;
  this.events=this.events.filter(event=>event.end>this.time);let eventStrong=0,eventWeak=0;for(const event of this.events)if(event.start<=this.time){const envelope=Math.min(1,(this.time-event.start)/.015,(event.end-this.time)/.025);eventStrong=Math.max(eventStrong,event.strong*envelope);eventWeak=Math.max(eventWeak,event.weak*envelope);}
  const damage=clamp(1-Math.min(...(s.wheelHealth||[1,1,1,1])),0,1)*clamp((speed-2)/24,0,1),wheelPulse=damage*(.5+.5*Math.sin((s.wheelSpins?.[0]||this.time*speed)*1.01));
  const knock=s.engineRunning?clamp(s.mechanical?.knock??0,0,1)*(.55+.45*Math.sin(this.time*TAU*clamp((s.rpm||900)/120,4,22))):0;
  const targetStrong=clamp(boostStrong+slip*.19+road*.18+chassis+absPulse*.12+drive+this.pulseStrong+eventStrong+wheelPulse*.045+knock*.035,0,.90)*clamp(intensity,0,1);
  const targetWeak=clamp(boostWeak+slip*(s.drifting?.34:.23)+road*(.20+.08*Math.sin(this.time*TAU*23))+absPulse*.28+chassis*.4+drive*.6+this.pulseWeak+eventWeak+wheelPulse*.14+knock*.065,0,.98)*clamp(intensity,0,1);
  const energetic=boost||work>300||rough>.005||hit>.1||this.pulseTime>0||drive>.01||s.absActive||this.events.length>0||damage>.01||knock>.02;
  this.strong=smooth(this.strong,energetic?targetStrong:0,boost?22:30,dt);this.weak=smooth(this.weak,energetic?targetWeak:0,boost?22:30,dt);
  this.lastLevels={strong:this.strong,weak:this.weak};
  if(!energetic||Math.max(this.strong,this.weak)<.012){if(!this.events.length&&(this.playing||this.inFlight.size))this.stop();return this.lastLevels;}
  if(this.time<this.nextSend||this.time<this.failedUntil||this.inFlight.size>=2)return this.lastLevels;
  this._send(this.strong,this.weak);return this.lastLevels;
 }
 _send(strong,weak){
  const actuator=this._actuator(this.target);if(!actuator)return;
  const token={revision:this.revision};this.inFlight.add(token);this.nextSend=this.time+.085;this.playing=true;this.calls++;
  try{
   const p=actuator.kind==='pulse'?actuator.node.pulse(Math.max(strong,weak),170):actuator.node.playEffect('dual-rumble',{startDelay:0,duration:170,strongMagnitude:clamp(strong,0,1),weakMagnitude:clamp(weak,0,1)});
   Promise.resolve(p).then(()=>this.inFlight.delete(token),()=>{this.inFlight.delete(token);if(token.revision===this.revision){this.failedUntil=this.time+2;this.stop();}});
  }catch{this.inFlight.delete(token);this.failedUntil=this.time+2;this.stop();}
 }
 diagnostics(){return {calls:this.calls,stops:this.stops,pending:this.inFlight.size,playing:this.playing,levels:{...this.lastLevels},deviceKey:this.target?.key??null,eventSegments:this.events.length,eventCounts:{...this.eventCounts}};}
}
