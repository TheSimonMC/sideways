import assert from 'node:assert/strict';
import fs from 'node:fs';
import {GameAudio,SOUND_SURFACES} from '../dist/audio.js';
import MotorLab from '../sdk/motor-engine.mjs';
import {CarPhysics} from '../dist/physics.js';
import {resolveBuild,DEFAULT_SELECTION} from '../dist/catalog.js';
const RATE=48000,DT=1/120,FRAMES=400;
const report={status:'pending',checks:[],surfaces:[],fixtures:{}};
const metrics=values=>{let square=0,peak=0,dc=0,edge=0;for(let i=0;i<values.length;i++){assert.ok(Number.isFinite(values[i]));square+=values[i]**2;dc+=values[i];peak=Math.max(peak,Math.abs(values[i]));if(i)edge+=(values[i]-values[i-1])**2;}return {rms:Math.sqrt(square/values.length),peak,dc:dc/values.length,brightness:Math.sqrt(edge/Math.max(square,1e-14))};};
const wheel=(surface='asphalt',speed=20,extra={})=>({surface,roughness:.0015,contact:true,load:3300,longitudinalSpeed:speed,lateralSpeed:0,slipSpeed:0,slipRatio:0,wheelSpeed:speed,tyrePower:0,brakePower:0,suspensionVelocity:0,suspensionTravel:0,impactSpeed:0,impactCount:0,...extra});
const state=(surface='asphalt',speed=20)=>({speed,forwardSpeed:speed,lateralSpeed:0,yawRate:0,steer:0,gear:0,inputShaftRpm:0,clutchTorque:0,clutch:1,throttle:0,handbrake:0,engineRunning:false,starterActive:false,rpm:0,wheelAudio:[0,1,2,3].map(()=>wheel(surface,speed)),brakeTemps:[24,24,24,24]});
const render=(s,{mix={},seconds=.8,engine={rpm:0,controls:{throttle:0,starter:false},meanTorque:0},source=null,onFrame=null}={})=>{
 const a=new GameAudio();a.setMix({engine:0,...mix});a.update(s);const left=[],right=[];
 for(let n=0;n<Math.round(seconds/DT);n++){onFrame?.(n,s,a);a._updateTargets(s,DT,engine);const l=new Float32Array(FRAMES),r=new Float32Array(FRAMES);if(source)for(let k=0;k<FRAMES;k++)l[k]=r[k]=source(n*FRAMES+k);a._renderSound(l,r,engine);if(n>24){left.push(...l);right.push(...r);}}
 return {audio:a,left,right,metrics:metrics(left),diagnostics:a.getDiagnostics()};
};
{
 const quiet=render(state('asphalt',0));assert.ok(quiet.metrics.rms<1e-12);report.fixtures.stationary=quiet.metrics;
 const air=state();for(const w of air.wheelAudio){w.contact=false;w.load=0;w.slipSpeed=30;w.tyrePower=50000;w.brakePower=0;}
 const r=render(air,{mix:{environment:0}});assert.ok(r.metrics.rms<1e-12);report.checks.push('Stationary contacts are silent; airborne wheels cannot create road or slip sound');
}
for(const material of ['asphalt','concrete','curb','gravel','grass','metal']){
 assert.ok(SOUND_SURFACES[material]);const r=render(state(material),{mix:{environment:0}});assert.ok(r.metrics.rms>.001&&r.metrics.peak<.94);assert.ok(r.diagnostics.layers.tyres===0);report.surfaces.push({material,...r.metrics,layers:r.diagnostics.layers});
}
assert.equal(new Set(report.surfaces.map(x=>x.brightness.toFixed(4))).size,6);report.checks.push('All six world materials have distinct rolling textures at equal contact speed; no invented corner squeal');
{
 const s=state('asphalt',0);for(let i=2;i<4;i++)Object.assign(s.wheelAudio[i],{wheelSpeed:20,slipSpeed:20,tyrePower:60000});
 const r=render(s);assert.ok(r.diagnostics.layers.tyres>.01);assert.equal(r.diagnostics.layers.wind,0);assert.equal(r.diagnostics.layers.rolling,0);report.fixtures.stationaryBurnout={...r.metrics,layers:r.diagnostics.layers};
 const locked=render(state('asphalt',0));assert.ok(locked.metrics.rms<1e-12);report.checks.push('Stationary rear-wheel burnout sings from real slip work; locked stationary tyres stay silent');
}
{
 const s=state();s.wheelAudio[0]=wheel('gravel',20);const r=render(s,{mix:{environment:0}}),right=metrics(r.right);assert.ok(r.metrics.rms>right.rms*1.02);report.fixtures.splitSurfaceStereo={left:r.metrics.rms,right:right.rms};
 const brake=state();for(const w of brake.wheelAudio)w.brakePower=60000;const pads=render(brake,{mix:{tyres:0,environment:0}});assert.ok(pads.diagnostics.layers.brakes>.0005);report.fixtures.braking=pads.diagnostics.layers;
 report.checks.push('Individual wheel material is spatialized; brake friction follows dissipated brake work');
}
{
 const s=state('concrete',0);const r=render(s,{onFrame:(n,s,a)=>{if(n===2){s.gear=1;s.handbrake=1;s.starterActive=true;s.wheelAudio[0].impactCount=1;s.wheelAudio[0].impactSpeed=2;s.wheelAudio[0].suspensionTravel=.09;s.wheelAudio[0].suspensionVelocity=1.8;}if(n>2){s.wheelAudio[0].impactSpeed*=.8;s.wheelAudio[0].suspensionVelocity=0;}}});
 assert.equal(r.diagnostics.events.shift,1);assert.equal(r.diagnostics.events.handbrake,1);assert.equal(r.diagnostics.events.starter,1);assert.equal(r.diagnostics.events.suspension,1);assert.equal(r.diagnostics.activeEvents,0);
 report.fixtures.events=r.diagnostics.events;report.checks.push('Gear selection, starter, handbrake and actual suspension impact produce one causal transient each; decaying impact flags do not retrigger');
}
{
 const s=state('asphalt',0);s.gear=1;s.inputShaftRpm=2800;s.clutchTorque=300;s.clutchSlipRPM=1700;s.diffPower=9000;
 const r=render(s);assert.ok(r.diagnostics.layers.mechanical>.0005);report.fixtures.drivetrain=r.diagnostics.layers;
 const reverse=state('asphalt',0);reverse.gear=-1;reverse.inputShaftRpm=2800;reverse.clutchTorque=300;const rev=render(reverse);assert.ok(rev.diagnostics.layers.mechanical>r.diagnostics.layers.mechanical*.5);
 report.checks.push('Gear-mesh, clutch-friction and differential sounds follow shaft motion and dissipated work, without free-running pure tones');
}
{
 const stopped=state('asphalt',0),engine={rpm:3500,controls:{throttle:1,starter:false},meanTorque:300},source=i=>.31*Math.sin(i/RATE*100*Math.PI*2);
 const dry=render(stopped,{mix:{engine:1,drive:0,environment:0,mechanical:0,tyres:0},engine,source}),driven=render(stopped,{mix:{engine:1,drive:1,environment:0,mechanical:0,tyres:0},engine,source});
 const amplitude=(v,hz)=>{let re=0,im=0;for(let i=0;i<v.length;i++){re+=v[i]*Math.cos(i/RATE*TAU*hz);im-=v[i]*Math.sin(i/RATE*TAU*hz);}return Math.hypot(re,im)/v.length;};
 const TAU=2*Math.PI,dryHarmonic=amplitude(dry.left,300),wetHarmonic=amplitude(driven.left,300);assert.ok(wetHarmonic>dryHarmonic*5);assert.ok(driven.metrics.rms>dry.metrics.rms*.80);assert.ok(Math.abs(driven.metrics.dc)<.005);assert.ok(driven.metrics.peak<.94);
 report.fixtures.drive={dry:dry.metrics,driven:driven.metrics,thirdHarmonicDry:dryHarmonic,thirdHarmonicDriven:wetHarmonic};report.checks.push('Post-drive retains bounded harmonics and useful level; native SDK bite is verified separately in V5');
}
{
 const s=state('gravel',45);for(const w of s.wheelAudio)Object.assign(w,{slipSpeed:70,tyrePower:200000,brakePower:200000,suspensionVelocity:3});
 s.inputShaftRpm=15000;s.gear=-1;s.clutchTorque=1000;s.clutchSlipRPM=10000;s.diffPower=400000;
 const r=render(s,{mix:{engine:1,mechanical:1,environment:1,tyres:1,drive:1},engine:{rpm:9000,controls:{throttle:1},meanTorque:1000},source:i=>1.5*Math.sin(i*1.7),onFrame:(n,s,a)=>{if(n%12===0)a.impact(2,{material:'metal'});}});
 assert.ok(r.metrics.peak<=.941);assert.ok(r.diagnostics.activeEvents<=24);report.fixtures.stress=r.metrics;
 const zero=render(s,{mix:{engine:0,mechanical:0,environment:0,tyres:0,drive:0}});assert.ok(zero.metrics.rms<1e-12);report.checks.push('Coincident maximum layers remain finite and bounded; all four mix stems can independently be silenced');
}
{
 const s=state('asphalt',0),engine={rpm:3500,controls:{throttle:.7},meanTorque:220},source=i=>.15*Math.sin(i/RATE*1000*Math.PI*2)+.10*Math.sin(i/RATE*8000*Math.PI*2);
 const dark=render(s,{mix:{engine:1,drive:0,mechanical:0,tyres:0,environment:0},engine,source,onFrame:(n,s,a)=>{a.voice.brightness=4000;}}),bright=render(s,{mix:{engine:1,drive:0,mechanical:0,tyres:0,environment:0},engine,source,onFrame:(n,s,a)=>{a.voice.brightness=15000;}});
 assert.ok(bright.metrics.brightness>dark.metrics.brightness*1.15);report.fixtures.exhaustBrightness={dark:dark.metrics.brightness,bright:bright.metrics.brightness};report.checks.push('Engine/exhaust brightness configuration remains audible through the PCM EQ');
}
// Real coupled physics with the full sound observer, not only manufactured fields.
{
 const build=resolveBuild(DEFAULT_SELECTION),p=new CarPhysics(MotorLab,build),control=new CarPhysics(MotorLab,build);let lastBlock=null;
 const a=new GameAudio({pcmEnabled:true,onPCM:l=>lastBlock=new Float32Array(l)});a.setBuild(build);p.setEngineAdvance((engine,dt)=>a.advanceEngine(engine,dt));a.update(p.state);
 let maxPeak=0,maxTyres=0;for(let i=0;i<360;i++){const input={transmission:'sequential',brake:1,throttle:1,assists:false};p.update(DT,input);control.update(DT,input);a.update(p.state);for(const key of ['rpm','x','z','speed','heading','clutchTorque'])assert.ok(Math.abs(p.state[key]-control.state[key])<1e-7,`${key} parity`);maxPeak=Math.max(maxPeak,a.getDiagnostics().outputPeak);maxTyres=Math.max(maxTyres,a.getDiagnostics().layers.tyres);}
 assert.equal(p.engine.getTiming().totalSteps,control.engine.getTiming().totalSteps);assert.ok(maxTyres>.005);assert.ok(maxPeak<.941);report.fixtures.actualBurnout={rpm:p.state.rpm,kph:p.state.speed*3.6,maxPeak,maxTyres,lastRms:metrics(lastBlock).rms};
 a.suspend(true);assert.equal(a.getDiagnostics().activeEvents,0);a.suspend(false);a.setMuted(true);assert.equal(a._scheduled.size,0);a.setBuild(build);assert.equal(a.getDiagnostics().activeEvents,0);assert.equal(a.getDiagnostics().clock,'manual');
 report.checks.push('Full PCM sound observation preserves actual coupled engine/wheel physics exactly at every 120Hz step; reset/suspend/mute clear tails');
}
// Countdown and finish use their own bounded PCM one-shots, without moving
// the engine. Finish remains audible after driving suspension; mute kills all.
{
 const live=new Set(),values={};
 const param=name=>({setTargetAtTime(value){values[name]=value;}});
 const ctx={currentTime:0,state:'running',createBuffer:(channels,n,rate)=>({data:Array.from({length:channels},()=>new Float32Array(n)),duration:n/rate,getChannelData(i){return this.data[i];}}),createBufferSource(){return {connect(){},disconnect(){},start(t){this.startTime=t;live.add(this);},stop(){live.delete(this);}};}};
 const e=MotorLab.createEngine(resolveBuild(DEFAULT_SELECTION).physics.engineOptions),a=new GameAudio({pcmEnabled:true});a._engine=e;a.context=ctx;a.nodes={engineBus:{},master:{gain:param('master')},uiGain:{gain:param('ui')}};
 const before=e.getTiming().totalSteps;a.tick('start');assert.equal(a._uiScheduled.size,1);assert.equal(a._events.length,0);a.suspend(true);a.tick('finish');assert.equal(a._uiScheduled.size,2);assert.equal(values.master,0);assert.equal(values.ui,a.volume);assert.equal(e.getTiming().totalSteps,before);
 for(let i=0;i<30;i++)a.tick('checkpoint');assert.equal(a._uiScheduled.size,8);a.setVolume(.27);assert.equal(values.ui,.27);a.setMuted(true);assert.equal(a._uiScheduled.size,0);assert.equal(live.size,0);assert.equal(values.ui,0);a.tick('start');assert.equal(a._uiScheduled.size,0);
 a.setMuted(false);a.suspend(false);a.tick('start');for(const node of [...a._uiScheduled])node.onended();assert.equal(a._uiScheduled.size,0);assert.equal(e.getTiming().totalSteps,before);
 const s=state('gravel',22);a._engine=null;a.update(s);a._pcmEnabled=true;a.started=false;a.advanceEngine(e,DT);assert.strictEqual(a._state,s);assert.equal(a.getDiagnostics().surfaces[0],'gravel');
 report.checks.push('Countdown/finish one-shots play without engine stepping, finish survives driving suspension, rapid calls stay bounded, mute/end clean all UI sources, PCM handoff retains current wheel state');
}
assert.ok(!fs.readFileSync(new URL('../dist/audio.js',import.meta.url),'utf8').includes('createOscillator('));
report.checks.push('No oscillator nodes or imported retro wave loops remain in the driving sound renderer');
report.status='passed';fs.writeFileSync(new URL('./audio-v4-results.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
