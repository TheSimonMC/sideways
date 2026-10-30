/** One MotorLab session supplies crank physics and pressure-derived stereo PCM.
 * Vehicle time owns the engine. Native source layers shape that PCM; this mixer adds
 * acoustic models from actual contact/work signals. The player never uses a
 * second engine clock or a pitch-shifted engine loop. Distant NPCs use a small
 * offline SDK bed; tyre squeal uses an attributed recording. */
import {windowAir,exteriorMissing} from './exterior-damage.js';
import {TYRE_SAMPLE,TYRE_SAMPLE_RATE} from './audio/samples.js';
import {AUDIO_KIT} from './audio/kit.js';
import {SpatialWorldAudio} from './audio/world.js';
import {StreetAcoustics} from './audio/acoustics.js';
import {vehicleAudioScene} from './audio-anchors.js';
import {GameMusic} from './music.js';
const clamp=(n,lo,hi)=>Math.max(lo,Math.min(hi,Number.isFinite(n)?n:lo));
const lerp=(a,b,t)=>a+(b-a)*t;
const smooth=(param,value,now,lag=.045)=>param.setTargetAtTime(value,now,lag);
const RATE=48000,BLOCK=960,TAU=Math.PI*2;
const DEFAULT_VOICE={exhaust:.80,intake:.58,combustion:.55,valve:.20,bearing:.12,boost:.42,manifold:.34,mechanical:.26,chain:.16,brightness:8500,gearboxGain:1,outputGain:6,hoodGain:1};
const DEFAULT_MIX={engine:1,mechanical:.8,tyres:.85,environment:.7,drive:.65,sirens:1,radio:.85,reverb:.65,ambience:.65};
// Roughness is geometric RMS in metres. Material changes timbre, not tyre grip.
export const SOUND_SURFACES={
 asphalt:{roll:1,body:135,texture:1550,squeal:1,grit:0,grain:0},
 concrete:{roll:1.18,body:200,texture:2300,squeal:.85,grit:.04,grain:.04},
 curb:{roll:1.30,body:245,texture:2800,squeal:.66,grit:.06,grain:.12},
 gravel:{roll:1.18,body:105,texture:3800,squeal:.07,grit:1,grain:1},
 dirt:{roll:.90,body:90,texture:1900,squeal:.05,grit:.55,grain:.65},
 grass:{roll:.72,body:70,texture:1100,squeal:.025,grit:.16,grain:.35},
 metal:{roll:1.34,body:360,texture:4100,squeal:.44,grit:.02,grain:.08}
};
const pole=(hz)=>1-Math.exp(-TAU*hz/RATE);
const limit=x=>{const a=Math.abs(x);return Math.sign(x)*(a<.76?a:.76+.18*(1-Math.exp(-(a-.76)/.18)));};
class Band {
 constructor(hz=1000,q=1){this.x1=this.x2=this.y1=this.y2=0;this.tune(hz,q);}
 tune(hz,q=1){const w=TAU*clamp(hz,30,17000)/RATE,a=Math.sin(w)/(2*q),d=1+a;this.b0=a/d;this.b2=-a/d;this.a1=-2*Math.cos(w)/d;this.a2=(1-a)/d;}
 sample(x){const y=this.b0*x+this.b2*this.x2-this.a1*this.y1-this.a2*this.y2;this.x2=this.x1;this.x1=x;this.y2=this.y1;this.y1=y;return y;}
 reset(){this.x1=this.x2=this.y1=this.y2=0;}
}
const makeWheel=i=>({seed:(54721+i*71993)>>>0,low:0,texture:0,grain:0,roll:0,scrub:0,brake:0,grit:0,damper:0,bearing:0,pan:i%2? .48:-.48,
 targetRoll:0,targetScrub:0,targetBrake:0,targetGrit:0,targetDamper:0,targetBearing:0,grainRate:0,bodyPole:pole(135),texturePole:pole(1550),
 rubberA:new Band(1850,2.1),rubberB:new Band(3600,1.65),pad:new Band(4400,1.25),stone:new Band(2750,.9),damperCase:new Band(800,.65),
 samplePosition:i*TYRE_SAMPLE.length*.217,sampleRate:1,targetSampleRate:1,sampleLow:0,material:'asphalt',contact:false,groundSpeed:0,slipSpeed:0,load:0,lastImpact:0,lastImpactCount:0,travel:0});
const sampleLoop=(data,position)=>{const i=Math.floor(position),t=position-i;return data[i]+(data[(i+1)%data.length]-data[i])*t;};
const random=object=>{let x=object.seed;x^=x<<13;x^=x>>>17;x^=x<<5;object.seed=x>>>0;return (object.seed/2147483648)-1;};

export class GameAudio {
 constructor({pcmEnabled=false,onPCM=null}={}){
  this.context=null;this.nodes=null;this.sources=[];this.available=true;this.started=false;this.muted=false;this.suspended=false;this.volume=.48;
  this._starting=null;this._lastImpact=-10;this._gear=null;this._lastStarter=false;this._lastHandbrake=0;this._lastClutch=1;this._lastShiftRejected=false;
  this._pcmEnabled=!!pcmEnabled;this._onPCM=typeof onPCM==='function'?onPCM:null;this._engine=null;this._lastEngineTime=-1;this._sourceRevision=0;this._appliedRevision=-1;
  this._buffers=new Map();this._frameRemainder=0;this._audibility=0;this._stagingL=new Float32Array(BLOCK);this._stagingR=new Float32Array(BLOCK);
  this._stagingCount=0;this._nextTime=0;this._needsFade=true;this._scheduled=new Set();this._uiScheduled=new Set();this._renderFrames=0;this._underruns=0;this._state=null;
  this.voice={...DEFAULT_VOICE};this.mix={...DEFAULT_MIX};this.cameraMode=0;this.wheelRadius=.34;this.gearboxGain=1;this.engineSize=3;this.exhaustKind='street';this.diffLock=.32;
  this._wheels=[0,1,2,3].map(makeWheel);this._engineFilters=[{dc:0,low:0,presence:0,air:0,outDC:0},{dc:0,low:0,presence:0,air:0,outDC:0}];
  this._nativeListener={mode:'outside',distance:2.4,azimuth:0,reflections:0};this._nativeListenerKey='';this._nativeStereoFlip=false;
  this._noise={seed:709123};this._stereoNoise={seed:950639};this._windSide=0;this._nosSide=0;this._windLow=0;this._windBody=0;this._wind=0;this._windTarget=0;this._nos=0;this._nosTarget=0;this._nosAir=0;this._nosBody=0;this._lastNOS=false;
  this.world=new SpatialWorldAudio();this.acoustics=new StreetAcoustics();this._acousticSpace=null;this._reverbMix=-1;this._engineDuck=1;this.music=new GameMusic();this._worldContext={};this._musicPreferences={enabled:true,volume:.42,mode:'menu',intensity:0,paused:null};this._traffic=this.world.traffic;this._trafficVoices=this.world.voices;
  this._worldIndependent=false;this._worldScheduled=new Set();this._worldNextTime=0;this._worldFrames=0;this.focus={hidden:false,reading:false,paused:false,backgroundMusic:false};
  this._intakeLeakCase=new Band(1800,.6);this._exhaustLeakCase=new Band(180,1.1);this._intakeLeakGain=this._exhaustLeakGain=this._intakeLeakTarget=this._exhaustLeakTarget=0;this._fanCase=new Band(350,.7);this._beltCase=new Band(3200,2);this._fanGain=0;this._beltGain=0;this._fanTarget=0;this._beltTarget=0;
  this._gearMesh=new Band(420,3.6);this._gearCase=new Band(920,.8);this._starterCase=new Band(470,1.7);this._clutchCase=new Band(290,.75);this._diffCase=new Band(780,1.1);
  this._gearGain=0;this._gearTarget=0;this._starterGain=0;this._starterTarget=0;this._clutchGain=0;this._clutchTarget=0;this._diffGain=0;this._diffTarget=0;
  this._events=[];this._eventCount={shift:0,handbrake:0,suspension:0,impact:0,starter:0,clutch:0,selector:0,ui:0,nitro:0};this._foleyTime=0;this._lastSuspension=[-10,-10,-10,-10];
  this._rawPeak=0;this._outputPeak=0;this._layerLevels={engine:0,rolling:0,tyres:0,brakes:0,mechanical:0,wind:0,nitrous:0,traffic:0,transients:0};
 }

 setBuild(build={}){
  this._buildSpec=build;
  this.voice={...DEFAULT_VOICE,...build.audio};for(const key of ['exhaust','intake','combustion','valve','bearing','boost','manifold','mechanical','chain'])this.voice[key]=clamp(this.voice[key],0,1);
  this.voice.brightness=clamp(this.voice.brightness,4000,15000);this.voice.outputGain=clamp(this.voice.outputGain,1,12);this.voice.hoodGain=clamp(this.voice.hoodGain,.5,3);this.gearboxGain=clamp(this.voice.gearboxGain,.2,2);this.wheelRadius=clamp(build.physics?.wheelRadius??.34,.2,.6);
  this.engineSize=clamp((build.engine?.displacementCc??3000)/1000,.6,9);this.exhaustKind=build.selection?.exhaust??'street';this.diffLock=clamp(Math.max(build.physics?.powerLock??.32,...(build.physics?.driveLayout==='AWD'?[build.physics.frontPowerLock,build.physics.centerPowerLock]:[])),0,1);
  this._sourceRevision++;this._engine=null;this._lastEngineTime=-1;this._resetAcoustics();this._flush();this._applyCameraMix();return this;
 }
 setMix(values={}){const priorDrive=this.mix.drive,priorMechanical=this.mix.mechanical;for(const key of Object.keys(DEFAULT_MIX))if(Number.isFinite(values?.[key]))this.mix[key]=clamp(values[key],0,1);if(priorDrive!==this.mix.drive||priorMechanical!==this.mix.mechanical)this._sourceRevision++;return this;}
 setCamera(mode=0){const next=clamp(Math.round(mode),0,3);if(next===this.cameraMode)return;this.cameraMode=next;this._sourceRevision++;this._applyCameraMix();}
 _sourceMix(){
  const v=this.voice,hood=this.cameraMode===2,exhaust=this.exhaustKind==='race'?{preGain:1.28,distortion:.68}:this.exhaustKind==='sport'?{preGain:1.16,distortion:.6}:{preGain:1.05,distortion:.52};
  return {master:.65,exhaust:clamp(v.exhaust*(hood?.81:1.1),0,1),intake:clamp(v.intake*(hood?1.30:1.05),0,1),combustion:clamp(v.combustion*1.08,0,1),
   valve:clamp(v.valve*(hood?1.22:1.06),0,1),bearing:v.bearing,boost:clamp(v.boost*1.15,0,1),manifold:clamp(v.manifold*(hood?1.22:1),0,1),
   mechanical:v.mechanical*this.mix.mechanical,chain:v.chain*this.mix.mechanical,gearbox:0,bite:this.mix.drive,muted:false,
   layers:{exhaust,intake:{preGain:1.03,distortion:.14},combustion:{preGain:1,distortion:.18},valve:{preGain:1,distortion:.06},bearing:{preGain:1,distortion:0},boost:{preGain:1,distortion:.07},manifold:{preGain:exhaust.preGain,distortion:exhaust.distortion*.75},mechanical:{preGain:1,distortion:.14},gearbox:{preGain:1,distortion:.1},chain:{preGain:1,distortion:.1}},listener:{...this._nativeListener}};
 }
 setTraffic(sources=[]){
  this.world.setSources(sources,this.context?.currentTime??this.world.time);this._trafficVoices=this.world.voices;return this;
 }
 setTrafficSources(sources){return this.setTraffic(sources);}
 resetWorldFeedback(){this._flushWorld();this.world.reset();this.acoustics.reset();this._trafficVoices=this.world.voices;this._worldContext={...this._worldContext,acoustics:null,ambient:null,playerHorn:false,servicing:null,worldActive:false};this._acousticSpace=null;this._reverbMix=-1;this._engineDuck=1;this.music.reset();return this;}
 setWorldContext(values={}){this._worldContext={...this._worldContext,...values};this._updateWorldContext();return this;}
 _updateWorldContext(){this._updateNativeListener();const s=this._state||{};this.world.setContext({playerPosition:{x:s.x||0,z:s.z||0},heading:s.heading||0,rpm:s.rpm||0,speed:s.speed||0,engineRunning:s.engineRunning,engineHealth:s.engineHealth,engineFault:s.engineFault,mechanical:s.mechanical,wheelAttached:s.wheelAttached,audioAnchors:this._audioAnchors,fuelLitres:s.fuelLitres,bodyScrape:s.bodyScrape??0,...this._worldContext});const space=this._worldContext.acoustics;if(this._acousticSpace!==space||this._reverbMix!==this.mix.reverb){this._acousticSpace=space;this._reverbMix=this.mix.reverb;this.acoustics.setSpace({...space,earlyReflections:false},this.mix.reverb);}}
 setMusic(values={}){this._musicPreferences={...this._musicPreferences,...values};const paused=typeof this._musicPreferences.paused==='boolean'?this._musicPreferences.paused:this.suspended&&this._musicPreferences.mode!=='menu';this.music.setState({...this._musicPreferences,paused});return this;}
 setFocusState(values={}){const wasHidden=this.focus.hidden;for(const key of ['hidden','reading','paused','backgroundMusic'])if(typeof values[key]==='boolean')this.focus[key]=values[key];this.music.setFocus(this.focus);if(this.focus.hidden&&!wasHidden){this._flush();this._flushUI();this._flushWorld();this.world.clearTransients();}this._setMaster();return this;}
 playEvent(type,detail={}){if(this.muted||this.focus.hidden)return false;return this.world.playEvent(type,detail);}
 updateWorld(dt=1/60){
  this._updateWorldContext();this.setMusic({});const duck=this.world.mixDucking(this.mix);this._engineDuck=duck.engine;this._setMaster();this.music.setGlobal({volume:this.volume,muted:this.muted,duck:(1-clamp(this._state?.throttle??0,0,1)*(this._musicPreferences.mode==='chase'?.08:.16))*duck.music});this.music.update();
  const ctx=this.context;if(!ctx||!this.started||this.muted||this.focus.hidden||ctx.state!=='running')return;
  const active=typeof this._worldContext.worldActive==='boolean'?this._worldContext.worldActive:!this.suspended;
  if(!this.world.hasSignal(active)){if(!this._worldScheduled.size)for(const key of Object.keys(this.world.levels))this._layerLevels[key]=this.world.levels[key]=0;return;}
  const now=ctx.currentTime;if(this._worldNextTime>now+.12)this._flushWorld();if(this._worldNextTime<now+.007)this._worldNextTime=now+.018;
  let blocks=0;while(this._worldNextTime<now+.075&&this._worldScheduled.size<6&&blocks++<4){
   const buffer=ctx.createBuffer(2,BLOCK,RATE),left=buffer.getChannelData(0),right=buffer.getChannelData(1);this.world.renderInto(left,right,{mix:this.mix,active});Object.assign(this._layerLevels,this.world.levels);
   const node=ctx.createBufferSource();node.buffer=buffer;node.connect(this.nodes.worldGain);this._worldScheduled.add(node);node.onended=()=>{this._worldScheduled.delete(node);try{node.disconnect();}catch{}};node.start(this._worldNextTime);this._worldNextTime+=BLOCK/RATE;this._worldFrames+=BLOCK;
  }
 }
 _flushWorld(){for(const node of this._worldScheduled){try{node.stop();node.disconnect();}catch{}node.onended=null;}this._worldScheduled.clear();this._worldNextTime=0;}


 /** Called once per vehicle step. The returned snapshot is this exact engine. */
 advanceEngine(engine,dt){
  dt=clamp(dt,0,1/15);if(!engine||!dt)return engine?.getState();const timing=engine.getTiming();
  if(this._engine!==engine||timing.clock==='manual'&&this._lastEngineTime>=0&&this._pcmEnabled){this._engine=engine;this._lastEngineTime=-1;this._appliedRevision=-1;this._frameRemainder=0;const vehicleState=this._state;this._resetAcoustics();this._state=vehicleState;this._flush();}
  if(!this._pcmEnabled)return engine.update(dt);
  if(this._appliedRevision!==this._sourceRevision){engine.setAudio(this._sourceMix());this._appliedRevision=this._sourceRevision;}
  if(timing.clock==='manual'&&timing.pendingSeconds>=timing.stepSeconds-1e-12)engine.update(0,{maxSteps:240000});
  const exactFrames=dt*RATE+this._frameRemainder,frames=Math.floor(exactFrames+1e-8);this._frameRemainder=exactFrames-frames;let state;
  if(frames){
   let channels=this._buffers.get(frames);if(!channels){channels=[new Float32Array(frames),new Float32Array(frames)];if(this._buffers.size>8)this._buffers.clear();this._buffers.set(frames,channels);}
   engine.renderAudio(channels[0],channels[1],{sampleRate:RATE});state=engine.getState();
   this._updateTargets(this._state,dt,state);this._renderSound(channels[0],channels[1],state);
   this._renderFrames+=frames;if(this._onPCM)this._onPCM(channels[0],channels[1],RATE);
   if(this.started&&!this.suspended&&!this.muted&&!this.focus.hidden&&this.context?.state==='running')this._queue(channels[0],channels[1]);
  }
  state??=engine.getState();if(this._lastEngineTime>=0&&state.time<this._lastEngineTime-.001)this._flush();this._lastEngineTime=state.time;return state;
 }

 async start(){
  if(this._starting)return this._starting;if(!this.available)return false;
  if(this.context){try{await this.context.resume();this.started=this.context.state==='running';if(this.started)this._pcmEnabled=true;this._setMaster();return this.started;}catch{return false;}}
  const Context=globalThis.AudioContext||globalThis.webkitAudioContext;if(!Context){this.available=false;return false;}
  try{const ctx=new Context({latencyHint:'interactive'});this.context=ctx;this._build(ctx);this._starting=ctx.resume().then(()=>{this.started=ctx.state==='running';if(this.started)this._pcmEnabled=true;this._starting=null;this._setMaster();return this.started;}).catch(()=>{this._starting=null;return false;});return await this._starting;}catch{this.available=false;this._starting=null;return false;}
 }
 _build(ctx){
  const master=ctx.createGain(),engineBus=ctx.createGain(),uiGain=ctx.createGain(),worldGain=ctx.createGain();master.gain.value=this.muted||this.suspended?0:this.volume;engineBus.gain.value=1;uiGain.gain.value=this.muted?0:this.volume;worldGain.gain.value=this.muted?0:this.volume;
  // PCM carries the complete mix. A gentle final compressor catches coincident
  // contacts without flattening every firing pulse; the PCM limiter is bounded.
  const limiter=ctx.createDynamicsCompressor();limiter.threshold.value=-5;limiter.knee.value=5;limiter.ratio.value=3;limiter.attack.value=.003;limiter.release.value=.12;
  const dc=ctx.createBiquadFilter();dc.type='highpass';dc.frequency.value=24;dc.Q.value=.6;
  engineBus.connect(dc);dc.connect(master);master.connect(limiter);uiGain.connect(limiter);worldGain.connect(limiter);limiter.connect(ctx.destination);this.nodes={master,engineBus,limiter,uiGain,worldGain};this._worldIndependent=true;this.music.prepare(ctx,limiter);
 }
 _applyCameraMix(){this._updateNativeListener();}
 _updateNativeListener(){
  const s=this._state||{},c=this._worldContext||{},hood=this.cameraMode===2;
  const layout=vehicleAudioScene(this._buildSpec,s,c,this.cameraMode,this.mix.reverb);
  this._audioAnchors=layout.anchors;this._microphone=layout.microphone;
  const next={mode:hood?'engine':'outside',distance:hood?.7:this.cameraMode===1?1.8:2.4,azimuth:0,reflections:0,scene:layout.scene};
  // Keep pose updates independent from the engine clock. Quantization is only
  // an update threshold (one millimetre), never a snapped listener heading.
  const key=JSON.stringify(next,(_,v)=>typeof v==='number'?Math.round(v*1000)/1000:v);
  if(key!==this._nativeListenerKey){this._nativeListener=next;this._nativeListenerKey=key;this._sourceRevision++;}
  this._nativeStereoFlip=false;
 }

 _setMaster(){if(this.nodes&&this.context){smooth(this.nodes.master.gain,this.muted||this.suspended||this.focus.hidden?0:this.volume*this._engineDuck,this.context.currentTime,.05);if(this.nodes.uiGain)smooth(this.nodes.uiGain.gain,this.muted||this.focus.hidden?0:this.volume,this.context.currentTime,.025);if(this.nodes.worldGain)smooth(this.nodes.worldGain.gain,this.muted||this.focus.hidden?0:this.volume,this.context.currentTime,.025);}this.music.setGlobal({volume:this.volume,muted:this.muted});}
 setVolume(value){this.volume=clamp(value,0,1);this._setMaster();}
 setMuted(value){this.muted=!!value;if(this.muted){this._flush();this._flushUI();this._flushWorld();this._events.length=0;this.world.clearTransients();}this._setMaster();this.music.update();}
 update(state){if(state){this._state=state;this._updateWorldContext();}}

 _updateTargets(s,dt,engine){
  this._foleyTime+=dt;const speed=clamp(s?.speed??0,0,110),hood=this.cameraMode===2,doorAir=Math.max(0,...['left','right'].map(id=>{const p=s?.bodyDamage?.zones?.[id];return p?.detached?1:Math.sin(p?.angle||0);}));
  const cabin=this.cameraMode===3,opening=Math.max(doorAir,windowAir(s?.bodyDamage));this._cabinOpening=opening;this._windTarget=(.0018*speed+speed*speed*.000026)*this.mix.environment*(cabin?.30+.70*opening:hood?1:.78)*(1+opening*.35);this._windTarget=clamp(this._windTarget,0,.32);
  const nos=!!s?.boosting;this._nosTarget=nos?clamp(s?.nitrousIntensity??1,0,1)*.19*this.mix.engine:0;
  if(nos!==this._lastNOS){this._event('nitro',nos?.12:.065,0,nos?.16:.12,nos?2700:1900,180);this._lastNOS=nos;}
  const shaft=Math.abs(s?.inputShaftRpm??0),gear=s?.gear??0,torque=clamp(Math.abs(s?.clutchTorque??0)/500,0,1.5);
  const gearHz=clamp(shaft/60*(gear<0?19:24),120,7600);
  this._gearMesh.tune(gearHz,gear<0?5.6:3.5);this._gearCase.tune(Math.min(11000,gearHz*1.97),1.1);
  const gearWear=1-clamp(s?.gearboxHealth??1,0,1),diffWear=1-clamp(Math.min(1,...(s?.mechanical?.components||[]).filter(part=>part.applicable!==false&&['differential','frontDifferential','centerDifferential'].includes(part.id)).map(part=>part.health)),0,1);
  this._gearTarget=gear===0?0:clamp(shaft/750,0,1)*(.008+torque*.014+clamp(speed/20,0,1)*.004)*this.gearboxGain*this.mix.mechanical*(1+gearWear*1.5)*(gear<0?2.4:1)*(hood?1.2:.85);
  const firing=s?.engineRunning&&engine.rpm>250?1:0;this._intakeLeakTarget=(s?.mechanical?.intakeLeak??0)*.05*firing*this.mix.mechanical;this._exhaustLeakTarget=Math.max(s?.mechanical?.exhaustLeak??0,exteriorMissing(s?.bodyDamage,'exhaustTip')?.30:0)*.08*firing*this.mix.mechanical;this._exhaustLeakCase.tune(100+Math.abs(engine.rpm)*.045,1.1);
  const aux=s?.mechanical?.auxiliaries;this._fanTarget=(aux?.fan??0)*.045*this.mix.mechanical;this._beltTarget=(aux?.beltSlip??0)*(aux?.beltDrive??0)*.055*this.mix.mechanical;this._beltCase.tune(1500+clamp(engine.rpm,0,8000)*.45,2);
  const starter=!!(s?.starterActive??engine.controls?.starter)&&!(s?.engineRunning&&engine.rpm>1000);
  this._starterTarget=starter?.065*this.mix.mechanical:0;this._starterCase.tune(260+clamp(engine.rpm,0,700)*.45,1.2);
  if(starter&&!this._lastStarter)this._event('starter',.065,0,.055,1600,430);
  this._lastStarter=starter;
  const slip=clamp(Math.abs(s?.clutchSlipRPM??0)/2200,0,2),clutchWork=slip*torque;
  this._clutchTarget=Math.sqrt(clutchWork)*.014*this.mix.mechanical;
  const diffWork=Math.abs(s?.diffPower??0);this._diffTarget=(clamp(Math.sqrt(diffWork/7000),0,1)*this.diffLock+diffWear*clamp(speed/18,0,1))*.028*this.mix.mechanical;
  if(s){
   if(this._gear!==null&&gear!==this._gear)this._event('shift',.055+torque*.035,0,gear===0?.055:.09,gear===0?1600:950,gear===0?190:115);
   this._gear=gear;
   const hb=clamp(s.handbrake??0,0,1),clutch=clamp(s.clutch??1,0,1);
   if(Math.abs(hb-this._lastHandbrake)>.3)this._event('handbrake',.032,-.22,.065,1800,260);
   if(this._lastClutch-clutch>.26&&torque>.15)this._event('clutch',Math.min(.08,torque*.05),0,.10,580,130);
   if(s.shiftRejected&&!this._lastShiftRejected)this._event('selector',.035,-.12,.055,2250,460);
   this._lastHandbrake=hb;this._lastClutch=clutch;this._lastShiftRejected=!!s.shiftRejected;
  }
  for(let i=0;i<4;i++){
   const w=this._wheels[i],c=s?.suspension?.[i],a=s?.wheelAudio?.[i];
   const contact=!!s&&(a?.contact??c?.contact??true)&&(a?.load??c?.load??100)>20,load=contact?clamp((a?.load??c?.load??3200)/3300,0,3):0;
   const material=a?.surface??a?.material??c?.material??c?.surface??s?.surfaceMaterial??'asphalt',profile=SOUND_SURFACES[material]??SOUND_SURFACES.asphalt;
   // Fallback uses the velocity at this particular steered contact, never the
   // body-centre speed for all four wheels (which falsely squealed in corners).
   const x=(i%2?1:-1)*(s?.halfTrack??.82),z=i<2?(s?.frontAxle??1.25):-(s?.rearAxle??1.35),delta=i<2?(s?.steer??0):0;
   const forward=(s?.forwardSpeed??0)-(s?.yawRate??0)*x,side=(s?.lateralSpeed??0)+(s?.yawRate??0)*z;
   const along=forward*Math.cos(delta)+side*Math.sin(delta),lateral=side*Math.cos(delta)-forward*Math.sin(delta);
   const longitudinal=a?.longitudinalSpeed??along,lat=a?.lateralSpeed??lateral,wheelSpeed=a?.wheelSpeed??((s?.wheelOmega?.[i]??0)*this.wheelRadius);
   const slipSpeed=Math.abs(a?.slipSpeed??wheelSpeed-longitudinal),scrubSpeed=Math.hypot(slipSpeed,lat),groundSpeed=Math.hypot(longitudinal,lat);
   const power=a?.tyrePower??Math.max(0,scrubSpeed-.5)*load*2200;
   // Ordinary contact compliance is rolling texture. Recorded squeal starts
   // only when slip speed, slip angle/ratio and dissipated work agree.
   const angleSlip=Math.abs(lat)/Math.max(3,Math.abs(longitudinal)),ratioSlip=slipSpeed/Math.max(4,groundSpeed,Math.abs(wheelSpeed));
   const excess=Math.max(angleSlip-.13,ratioSlip-.15),slipGate=clamp(excess/.22,0,1)*clamp((scrubSpeed-1.6)/2.6,0,1);
   const work=clamp(Math.sqrt(Math.max(0,power-3500)/36000),0,1.2)*slipGate;
   const motion=clamp(groundSpeed/3,0,1),roughness=clamp(a?.roughness??c?.roughness??.0015,0,.05),rollSpeed=clamp(Math.sqrt(groundSpeed/28),0,1.7);
   const perspective=hood?(i<2?1.08:.75):1;
   w.targetRoll=contact?(.026+.040*rollSpeed)*rollSpeed*profile.roll*(1+(a?.wetness??0)*.8)*Math.sqrt(load)*motion*this.mix.tyres*perspective:0;
   w.targetScrub=contact?work*.17*profile.squeal*(1-(a?.wetness??0)*.65)*Math.sqrt(load)*this.mix.tyres*perspective:0;
   w.pan=this.world.wheelPan(i,i%2?.48:-.48);
   const tyre=s?.tyres?.[i];if(tyre&&w.burstCount!=null&&tyre.burstCount>w.burstCount&&s?.wheelAttached?.[i]!==false)this._event('tyreBlowout',.32,w.pan,.22,1450,110);w.burstCount=tyre?.burstCount??0;
   w.flap=contact?(tyre?.blown?.8:(tyre?.flatspot??0)*.5)*motion:0;w.flapRate=(s?.wheelOmegas?.[i]??0)/RATE;w.flapPhase=(s?.wheelSpins?.[i]??0)-(tyre?.blown?0:tyre?.flatspotAngle??0);

   w.targetSampleRate=(TYRE_SAMPLE_RATE/RATE)*clamp(.89+Math.min(scrubSpeed,30)*.006+Math.min(groundSpeed,55)*.0013+(i<2?.045:-.035),.78,1.22);
   w.targetGrit=contact?profile.grit*Math.sqrt(Math.max(0,groundSpeed+slipSpeed*.65)/22)*.13*Math.sqrt(load)*this.mix.tyres:0;
   const brakePower=a?.brakePower??Math.abs((s?.brakePressure?.[i]??0)*wheelSpeed)*450;
   w.targetBrake=clamp(Math.sqrt(brakePower/65000),0,1)*.018*this.mix.mechanical*clamp(Math.abs(wheelSpeed)/2,0,1);
   w.targetBearing=s?.wheelAttached?.[i]!==false?clamp(a?.bearingWear??0,0,1)*clamp(Math.sqrt(Math.abs(wheelSpeed)/20),0,1.4)*(.025+.045*Math.sqrt(load))*this.mix.mechanical:0;
   w.grainRate=contact?clamp((groundSpeed+slipSpeed*.5)*(profile.grain*15+roughness*120),0,1600)/RATE:0;
   w.bodyPole=pole(profile.body+groundSpeed*2.0);w.texturePole=pole(profile.texture+groundSpeed*9);
   w.rubberA.tune(1450+Math.min(1.5,work)*420+groundSpeed*3,2.3);w.rubberB.tune(2850+Math.min(1.5,work)*750,1.8);
   w.pad.tune(3600+clamp(s?.brakeTemps?.[i]??24,20,700)*2,1.4);w.stone.tune(material==='metal'?2450:3300,.9);
   w.material=material;w.contact=contact;w.load=load;w.groundSpeed=groundSpeed;w.slipSpeed=scrubSpeed;
   const travel=a?.suspensionTravel??c?.travel??0,velocity=Math.abs(a?.suspensionVelocity??c?.velocity??(travel-w.travel)/Math.max(dt,.0001));
   w.targetDamper=contact?clamp(velocity-.045,0,2)*.016*Math.sqrt(load)*this.mix.mechanical:0;
   const hit=Math.abs(a?.impactSpeed??c?.impactSpeed??0),impactCount=a?.impactCount??c?.impactCount;
   const freshImpact=Number.isFinite(impactCount)?impactCount>w.lastImpactCount:hit>w.lastImpact+.15;
   if(Number.isFinite(impactCount))w.lastImpactCount=impactCount;w.lastImpact=hit;
   // Debounce repeated solver contact flags; thresholds reject normal weight
   // transfer and constant spring load. Sound energy follows vertical velocity.
   if(contact&&this._foleyTime-this._lastSuspension[i]>.075&&(freshImpact&&hit>.28||velocity>1.4&&Math.abs(travel)>.065)){
    const strength=clamp(Math.max(hit,velocity*.4),0,6),metal=material==='metal';
    this._event('suspension',Math.min(.18,.025+strength*.033),w.pan,metal?.18:.12,metal?2100:670,metal?460:145);this._lastSuspension[i]=this._foleyTime;
   }
   w.travel=travel;
  }
 }

 _event(kind,level,pan=0,duration=.1,hz=1000,body=140){
  if(this.suspended||this.muted)return;if(this._events.length>=24)this._events.shift();
  const mechanical=kind==='ui'?1:kind==='nitro'?this.mix.engine:kind==='tyreBlowout'?this.mix.tyres:this.mix.mechanical;
  this._events.push({kind,level:clamp(level*mechanical,0,.6),pan:clamp(pan,-.8,.8),age:0,length:Math.max(1,Math.round(duration*RATE)),filter:new Band(hz,.72),body:new Band(body,1.1),seed:(this._noise.seed+(this._eventCount[kind]??0)*1927)>>>0});
  this._eventCount[kind]=(this._eventCount[kind]??0)+1;
 }
 _renderSound(left,right,engine){
  const target=engine.rpm>180||engine.controls?.starter?1:0,audiblePole=1-Math.exp(-1/(RATE*(target?.018:.10))),controlPole=1-Math.exp(-1/(RATE*.035));
  const throttle=clamp(engine.controls?.throttle??this._state?.throttle??0,0,1),shaftLoad=clamp(Math.abs(this._state?.clutchTorque??engine.meanTorque??0)/(this.engineSize*125),0,1);
  const load=clamp(throttle*.65+shaftLoad*.35,0,1),bodyGain=1.04+load*.06,presenceGain=.08;
  // Linear family trims restore the release-14 source levels to the game mix.
  // They preserve load dynamics and leave distortion inside the native layers.
  const pDC=pole(28),pLow=pole(240),pPresence=pole(1900),pAir=pole(this.voice.brightness*(this.cameraMode===3?.48+.46*(this._cabinOpening||0):this.cameraMode===2?.94:1)),pWind=pole(1800),pWindBody=pole(180),engineGain=this.mix.engine*this.voice.outputGain*(this.cameraMode===3?.78+.40*(this._cabinOpening||0):this.cameraMode===2?1.22*this.voice.hoodGain:1.28);
  const tyreAttack=1-Math.exp(-1/(RATE*.075)),tyreRelease=1-Math.exp(-1/(RATE*.12)),pRubber=pole(4500);
  const gains=point=>{const p=point||this.world.playerPoint(),pan=this.world.spatial(p.x,p.z).pan;return [Math.sqrt((1-pan)*.5),Math.sqrt((1+pan)*.5)];};
  const gearPan=gains(this._audioAnchors?.gearbox),enginePan=gains(this._audioAnchors?.engine),diffPan=gains(this._audioAnchors?.differential),intakePan=gains(this._audioAnchors?.intake);
  const sums={engine:0,rolling:0,tyres:0,brakes:0,mechanical:0,wind:0,nitrous:0,traffic:this._worldIndependent?this._layerLevels.traffic**2*left.length:0,transients:0};let peak=0,rawPeak=0;
  for(let k=0;k<left.length;k++){
   this._audibility+=(target-this._audibility)*audiblePole;
   let l=0,r=0;
   for(let ch=0;ch<2;ch++){
    const f=this._engineFilters[ch],nativeChannel=this._nativeStereoFlip?1-ch:ch,raw=(nativeChannel?right[k]:left[k])*this._audibility;rawPeak=Math.max(rawPeak,Math.abs(raw));
    f.dc+=(raw-f.dc)*pDC;const x=raw-f.dc;f.low+=(x-f.low)*pLow;f.presence+=(x-f.presence)*pPresence;
    const low=f.low,mid=f.presence-low,high=x-f.presence;f.air+=(high-f.air)*pAir;
    // SDK 1.6 owns each source's pre gain and local distortion. Only linear
    // tonal shaping remains here, so one loud source cannot distort another.
    let y=low*bodyGain+mid*(1+presenceGain)+f.air*.98;
    y*=engineGain;f.outDC+=(y-f.outDC)*pDC;y-=f.outDC;
    if(ch)r=y;else l=y;sums.engine+=y*y*.5;
   }
   const reflectedEngine=this.acoustics.sample(l,r);l=reflectedEngine[0];r=reflectedEngine[1];
   for(const w of this._wheels){
    w.roll+=(w.targetRoll-w.roll)*controlPole;w.scrub+=(w.targetScrub-w.scrub)*(w.targetScrub>w.scrub?tyreAttack:tyreRelease);w.brake+=(w.targetBrake-w.brake)*controlPole;w.grit+=(w.targetGrit-w.grit)*controlPole;w.damper+=(w.targetDamper-w.damper)*controlPole;w.bearing+=(w.targetBearing-w.bearing)*controlPole;
    const noise=random(w);w.low+=(noise-w.low)*w.bodyPole;w.texture+=(noise-w.texture)*w.texturePole;
    if((noise+1)*.5<w.grainRate)w.grain=Math.max(w.grain,.25+(random(w)+1)*.375);w.grain*=.9955;
    w.flapPhase=(w.flapPhase??0)+(w.flapRate??0);const rolling=(w.low*2.6+(w.texture-w.low)*.72)*w.roll*(1+(w.flap??0)*Math.max(0,Math.cos(w.flapPhase))**8*5);
    w.sampleRate+=(w.targetSampleRate-w.sampleRate)*controlPole;
    const recorded=sampleLoop(TYRE_SAMPLE,w.samplePosition);w.samplePosition=(w.samplePosition+w.sampleRate)%TYRE_SAMPLE.length;
    w.sampleLow+=(recorded-w.sampleLow)*pRubber;const rubber=(w.sampleLow*.93+(w.rubberA.sample(noise)*.06+w.rubberB.sample(noise)*.03))*w.scrub;
    const stones=(w.texture*.65+w.stone.sample(noise)*w.grain*3.2)*w.grit;
    const brake=w.pad.sample(noise)*w.brake,damper=w.damperCase.sample(noise)*w.damper;
    const bearing=(w.low*2.8+(w.texture-w.low)*.5)*w.bearing*(.75+.25*Math.cos(w.flapPhase));
    const value=rolling+rubber+stones+brake+damper+bearing,pan=w.pan*(this.cameraMode===0?.92:1);
    l+=value*(1-pan)*.5;r+=value*(1+pan)*.5;
    sums.rolling+=rolling*rolling+stones*stones;sums.tyres+=rubber*rubber;sums.brakes+=brake*brake;sums.mechanical+=damper*damper+bearing*bearing;
   }
   const n=random(this._noise),stereoNoise=random(this._stereoNoise);this._windLow+=(n-this._windLow)*pWind;this._windBody+=(n-this._windBody)*pWindBody;this._windSide+=(stereoNoise-this._windSide)*pWind;
   this._wind+=(this._windTarget-this._wind)*controlPole;const wind=(this._windLow*.7+this._windBody)*this._wind;
   this._gearGain+=(this._gearTarget-this._gearGain)*controlPole;this._starterGain+=(this._starterTarget-this._starterGain)*controlPole;this._clutchGain+=(this._clutchTarget-this._clutchGain)*controlPole;this._diffGain+=(this._diffTarget-this._diffGain)*controlPole;
   // Broadband excitation through shaft-speed resonances gives mesh/brush
   // texture. No clean sine, triangle, or sawtooth is layered over the engine.
   this._fanGain+=(this._fanTarget-this._fanGain)*controlPole;this._beltGain+=(this._beltTarget-this._beltGain)*controlPole;this._intakeLeakGain+=(this._intakeLeakTarget-this._intakeLeakGain)*controlPole;this._exhaustLeakGain+=(this._exhaustLeakTarget-this._exhaustLeakGain)*controlPole;const auxiliaries=this._fanCase.sample(n)*this._fanGain+this._beltCase.sample(n)*this._beltGain+this._intakeLeakCase.sample(n)*this._intakeLeakGain+this._exhaustLeakCase.sample(n)*this._exhaustLeakGain;
   const gears=(this._gearMesh.sample(n)*1.8+this._gearCase.sample(n)*.35)*this._gearGain+this._clutchCase.sample(n)*this._clutchGain,starter=this._starterCase.sample(n)*this._starterGain+auxiliaries,differential=this._diffCase.sample(n)*this._diffGain;
   const windSide=this._windSide*this._wind*.35;l+=(wind+windSide)*.65+(gears*gearPan[0]+starter*enginePan[0]+differential*diffPan[0])*.78;r+=(wind-windSide)*.65+(gears*gearPan[1]+starter*enginePan[1]+differential*diffPan[1])*.78;sums.wind+=wind*wind;sums.mechanical+=gears*gears+starter*starter+differential*differential;
   this._nos+=(this._nosTarget-this._nos)*(this._nosTarget>this._nos?.0012:.00065);this._nosAir+=(n-this._nosAir)*.29;this._nosBody+=(n-this._nosBody)*.018;
   this._nosSide+=(stereoNoise-this._nosSide)*.29;
   const nitrous=((n-this._nosAir)*.76+this._nosAir*.65+this._nosBody*2.8)*this._nos,airSide=(stereoNoise-this._nosSide)*this._nos*.22;l+=nitrous*intakePan[0]+airSide*.12;r+=nitrous*intakePan[1]-airSide*.12;sums.nitrous+=nitrous*nitrous;
   let transient=0;
   for(const e of this._events){
    if(e.age>=e.length)continue;const age=e.age++,t=age/e.length,attack=Math.min(1,age/65),envelope=attack*Math.exp(-t*7)*(1-t);
    const noise=random(e),value=(e.filter.sample(noise)*1.6+e.body.sample(noise)*2.6)*envelope*e.level;
    l+=value*(1-e.pan)*.5;r+=value*(1+e.pan)*.5;transient+=value;
   }
   sums.transients+=transient*transient;left[k]=limit(l);right[k]=limit(r);peak=Math.max(peak,Math.abs(left[k]),Math.abs(right[k]));
  }
  this._events=this._events.filter(e=>e.age<e.length);this._rawPeak=rawPeak;this._outputPeak=peak;for(const key of Object.keys(sums))this._layerLevels[key]=Math.sqrt(sums[key]/Math.max(1,left.length));
  // A real browser renders world sound on its independent transport. Headless
  // PCM consumers retain a complete observer mix for deterministic audio QA.
  if(!this._worldIndependent&&this.world.hasSignal(!this.suspended)){this.world.renderInto(left,right,{mix:this.mix,active:!this.suspended});Object.assign(this._layerLevels,this.world.levels);for(let i=0;i<left.length;i++)this._outputPeak=Math.max(this._outputPeak,Math.abs(left[i]),Math.abs(right[i]));}
 }

 _resetAcoustics(){
  this._audibility=0;this._gear=null;this._state=null;this._lastStarter=false;this._lastHandbrake=0;this._lastClutch=1;this._lastShiftRejected=false;this._events.length=0;this.acoustics.reset();this._engineDuck=1;
  this._wind=this._windTarget=this._windLow=this._windBody=this._windSide=0;this._nos=this._nosTarget=this._nosAir=this._nosBody=this._nosSide=0;this._lastNOS=false;this.world.reset();this._trafficVoices=this.world.voices;this._flushWorld();this._gearGain=this._gearTarget=this._starterGain=this._starterTarget=this._clutchGain=this._clutchTarget=this._diffGain=this._diffTarget=0;
  this._wheels=[0,1,2,3].map(makeWheel);this._lastSuspension=[-10,-10,-10,-10];for(const f of this._engineFilters)for(const k of Object.keys(f))f[k]=0;
  this._intakeLeakGain=this._exhaustLeakGain=this._intakeLeakTarget=this._exhaustLeakTarget=0;this._fanGain=this._beltGain=this._fanTarget=this._beltTarget=0;
  for(const band of [this._intakeLeakCase,this._exhaustLeakCase,this._fanCase,this._beltCase,this._gearMesh,this._gearCase,this._starterCase,this._clutchCase,this._diffCase])band.reset();
 }
 _queue(left,right){let offset=0;while(offset<left.length){const count=Math.min(BLOCK-this._stagingCount,left.length-offset);this._stagingL.set(left.subarray(offset,offset+count),this._stagingCount);this._stagingR.set(right.subarray(offset,offset+count),this._stagingCount);this._stagingCount+=count;offset+=count;if(this._stagingCount===BLOCK){this._scheduleBlock();this._stagingCount=0;}}}
 _scheduleBlock(){
  const ctx=this.context,now=ctx.currentTime;if(this._nextTime<now+.006){if(this._nextTime>0)this._underruns++;this._nextTime=now+.035;this._needsFade=true;}
  if(this._nextTime>now+.10){this._flushSources();this._nextTime=now+.035;this._needsFade=true;}
  const buffer=ctx.createBuffer(2,BLOCK,RATE);buffer.getChannelData(0).set(this._stagingL);buffer.getChannelData(1).set(this._stagingR);
  if(this._needsFade){for(let i=0;i<128;i++){const g=i/128;buffer.getChannelData(0)[i]*=g;buffer.getChannelData(1)[i]*=g;}this._needsFade=false;}
  const node=ctx.createBufferSource();node.buffer=buffer;node.connect(this.nodes.engineBus);this._scheduled.add(node);node.onended=()=>{this._scheduled.delete(node);try{node.disconnect();}catch{}};node.start(this._nextTime);this._nextTime+=BLOCK/RATE;
 }
 _flushSources(){for(const node of this._scheduled){try{node.stop();node.disconnect();}catch{}node.onended=null;}this._scheduled.clear();}
 _flush(){this._flushSources();this._stagingCount=0;this._nextTime=0;this._needsFade=true;}
 suspend(value){this.suspended=!!value;if(this.suspended){this._flush();this._flushWorld();this._events.length=0;this.world.clearTransients();this.acoustics.reset();}this.setMusic({});this._setMaster();this.music.update();}
 glassBreak(contact={}){if(this.suspended||this.muted||this.focus.hidden)return;this._event('glassBreak',.20,this.world.spatial(contact.x,contact.z,0).pan,.24,6200,1200);}
 impact(strength=1,contact={}){if(this.suspended||this.muted||this.focus.hidden)return;if(this._foleyTime-this._lastImpact<.09)return;this._lastImpact=this._foleyTime;const level=clamp(strength,.05,2),metal=contact?.material==='metal',pan=this.world.spatial(contact?.x,contact?.z,contact?.pan??0).pan;this._event('impact',.12+level*.12,clamp(pan,-.8,.8),(metal?.20:.13)+level*.045,metal?2600:650+level*600,metal?420:110+level*35);}
 _flushUI(){for(const node of this._uiScheduled){try{node.stop();node.disconnect();}catch{}node.onended=null;}this._uiScheduled.clear();}
 tick(type='checkpoint'){
  // Race feedback must not borrow engine time: countdown has no vehicle steps,
  // and the result screen suspends driving immediately after the finish click.
  // Recorded switches and piano use their own mute/volume bus.
  if(this.muted||this.focus.hidden)return;this._eventCount.ui++;
  const ctx=this.context;if(!ctx||!this.nodes?.uiGain||ctx.state==='closed')return;
  const sample=AUDIO_KIT[type==='finish'?'piano':type==='start'?'switch':'click'],duration=type==='finish'?.8:sample.data.length/sample.rate,count=Math.round(RATE*duration),buffer=ctx.createBuffer(1,count,RATE),data=buffer.getChannelData(0),level=type==='finish'?.22:type==='start'?.25:.18;
  const pitch=type==='finish'?Math.pow(2,3/12):1,step=sample.rate/RATE*pitch;
  for(let i=0;i<count;i++){const position=i*step,index=Math.floor(position),fraction=position-index,tail=Math.min(1,(count-i)/Math.min(1200,count));data[i]=((sample.data[index]??0)+((sample.data[index+1]??0)-(sample.data[index]??0))*fraction)*level*tail;}
  while(this._uiScheduled.size>=8){const old=this._uiScheduled.values().next().value;try{old.stop();old.disconnect();}catch{}old.onended=null;this._uiScheduled.delete(old);}
  const node=ctx.createBufferSource();node.buffer=buffer;node.connect(this.nodes.uiGain);this._uiScheduled.add(node);node.onended=()=>{this._uiScheduled.delete(node);try{node.disconnect();}catch{}};node.start(ctx.currentTime+.004);
 }
 getDiagnostics(){return {source:'MotorLab.renderAudio',processing:'MotorLab 1.6.3 + SIDEWAYS emitter extension; one native render, model-mounted outlets, camera ears and source-specific facade paths',microphone:this._microphone,audioAnchors:this._audioAnchors,nativeListener:{...this._nativeListener},nativeStereoFlip:this._nativeStereoFlip,nativeAudio:this._engine?.getAudioStatus?.()??null,sampleRate:RATE,started:this.started,available:this.available,clock:this._engine?.getTiming().clock??'manual',pcmFrames:this._renderFrames,worldFrames:this._worldFrames,queuedMs:this.context?Math.max(0,this._nextTime-this.context.currentTime)*1000:0,activeBuffers:this._scheduled.size,activeUIBuffers:this._uiScheduled.size,activeWorldBuffers:this._worldScheduled.size,underruns:this._underruns,rawPeak:this._rawPeak,outputPeak:this._outputPeak,mix:{...this.mix},layers:{...this._layerLevels},events:{...this._eventCount},activeEvents:this._events.length,tyreSample:'audible-edge / qubodup, CC BY 3.0',nitrousLevel:this._nos,trafficVoices:this._trafficVoices.length,surfaces:this._wheels.map(w=>w.material),acoustics:this.acoustics.diagnostics(),engineDuck:this._engineDuck,world:this.world.diagnostics(),music:this.music.diagnostics()};}
}
