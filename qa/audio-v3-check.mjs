import assert from 'node:assert/strict';
import fs from 'node:fs';
import MotorLab from '../sdk/motor-engine.mjs';
import {GameAudio} from '../dist/audio.js';
import {ENGINES,resolveBuild,DEFAULT_SELECTION} from '../dist/catalog.js';
const report={status:'pending',source:'same MotorLab session renderAudio',sampleRate:48000,engines:[],checks:[]};
const near=(a,b,tol=1e-7)=>assert.ok(Math.abs(a-b)<=tol,`${a} != ${b}`);
const makeEngine=build=>{const e=MotorLab.createEngine(build.physics.engineOptions);e.start();for(let i=0;i<90;i++)e.update(1/120);e.setInputs({starter:false});return e;};
const metrics=values=>{let squares=0,peak=0,crossings=0,derivative=0;for(let i=0;i<values.length;i++){const v=values[i];assert.ok(Number.isFinite(v));squares+=v*v;peak=Math.max(peak,Math.abs(v));if(i){crossings+=(v>=0)!==(values[i-1]>=0)?1:0;derivative+=(v-values[i-1])**2;}}return {rms:Math.sqrt(squares/values.length),peak,zeroCrossingHz:crossings*48000/(values.length*2),brightnessRatio:Math.sqrt(derivative/Math.max(1e-10,squares))};};
let audition=null;
for(const spec of ENGINES){
 const build=resolveBuild({...DEFAULT_SELECTION,engineId:spec.id}),engine=makeEngine(build),manual=MotorLab.fromState(engine.save()),chunks=[];
 const audio=new GameAudio({pcmEnabled:true,onPCM:(l,r)=>chunks.push(new Float32Array(l))});audio.setBuild(build);
 const startSteps=engine.getTiming().totalSteps,startTime=engine.getState().time,t0=performance.now();let pcmCpuMicros=0;
 for(let i=0;i<240;i++){
  const input={throttle:.28+.30*Math.sin(i/240*Math.PI),externalTorqueNm:-25,boostTarget:build.physics.boostTarget,starter:false};
  engine.setInputs(input);manual.setInputs(input);
  const cpuBefore=process.cpuUsage();const state=audio.advanceEngine(engine,1/120);const used=process.cpuUsage(cpuBefore);pcmCpuMicros+=used.user+used.system;manual.update(1/120);
  assert.ok(Number.isFinite(state.rpm));
 }
 const wallMs=performance.now()-t0,state=engine.getState(),other=manual.getState();
 assert.equal(engine.getTiming().clock,'pcm');assert.equal(engine.getTiming().totalSteps-startSteps,48000);near(state.time-startTime,2,2e-8);near(state.rpm,other.rpm,1e-8);
 const values=Float32Array.from(chunks.flatMap(c=>Array.from(c))),m=metrics(values);
 assert.ok(m.rms>.001&&m.rms<.5,`audible, bounded ${spec.id}: ${m.rms}`);assert.ok(m.peak<=1,`non clipping ${spec.id}`);
 report.engines.push({id:spec.id,...m,rpm:state.rpm,exactNativeSteps:48000,pcmVsManualRpmDifference:state.rpm-other.rpm,combinedPcmAndManualWallMs:wallMs,pcmAndEngineCpuMsPerSimulatedSecond:pcmCpuMicros/2000});
 if(spec.id==='i6t')audition=values;
 // Reset the very same session after PCM; the SDK releases ownership synchronously.
 void engine.disconnectAudio();engine.load(manual.save());audio.advanceEngine(engine,1/120);assert.equal(engine.getTiming().clock,'pcm');
}
assert.equal(new Set(report.engines.map(e=>e.zeroCrossingHz.toFixed(1))).size,ENGINES.length);report.checks.push(`Distinct SDK voices, finite PCM and bounded output for all ${ENGINES.length} engines`,'Exactly 24000 engine steps per second, identical crank state to manual-only stepping','PCM release/reset/reclaim on the same engine without a second clock');
// Cold, stopped engine has no looping engine tone. A started engine then produces PCM.
{
 const e=MotorLab.createEngine(resolveBuild(DEFAULT_SELECTION).physics.engineOptions);let chunks=[];
 const a=new GameAudio({pcmEnabled:true,onPCM:l=>chunks.push(new Float32Array(l))});a.setBuild(resolveBuild(DEFAULT_SELECTION));
 for(let i=0;i<120;i++)a.advanceEngine(e,1/120);
 const stopped=metrics(Float32Array.from(chunks.flatMap(c=>Array.from(c))));assert.ok(stopped.rms<1e-5);
 e.start();chunks=[];for(let i=0;i<120;i++)a.advanceEngine(e,1/120);
 const starting=metrics(Float32Array.from(chunks.flatMap(c=>Array.from(c))));assert.ok(starting.rms>.001);report.stoppedRms=stopped.rms;report.startingRms=starting.rms;
 report.checks.push('A stationary, unstarted SDK engine is silent; real starter/combustion creates audio');
}
// Queue test uses a minimal deterministic playback host, not a real browser.
{
 const live=new Set(),ctx={currentTime:0,state:'running',createBuffer:(channels,n,rate)=>({data:Array.from({length:channels},()=>new Float32Array(n)),getChannelData(i){return this.data[i];},duration:n/rate}),createBufferSource(){const node={connect(){},disconnect(){},start(t){this.end=t+this.buffer.duration;live.add(this);},stop(){live.delete(this);}};return node;}};
 const a=new GameAudio({pcmEnabled:true});a.context=ctx;a.nodes={engineBus:{},master:{gain:{setTargetAtTime(){}}}};a.started=true;
 const l=new Float32Array(400),r=new Float32Array(400);let maxBuffers=0,maxQueue=0;
 for(let i=0;i<600;i++){
  ctx.currentTime+=1/120;
  for(const node of [...live])if(node.end<=ctx.currentTime){live.delete(node);node.onended?.();}
  a._queue(l,r);maxBuffers=Math.max(maxBuffers,a._scheduled.size);maxQueue=Math.max(maxQueue,a.getDiagnostics().queuedMs);
 }
 assert.ok(maxBuffers<=8);assert.ok(maxQueue<=120);
 a.setMuted(true);assert.equal(a._scheduled.size,0);assert.equal(a._stagingCount,0);
 report.transport={maxBuffers,maxQueueMs:maxQueue,mutingClearsQueuedAudio:true};report.checks.push('Playback buffers stay bounded and mute clears already scheduled PCM');
}
// Fractional frame durations preserve the engine time rather than rounding each update.
{
 const e=makeEngine(resolveBuild(DEFAULT_SELECTION)),a=new GameAudio({pcmEnabled:true}),before=e.getTiming().totalSteps;
 for(let i=0;i<180;i++)a.advanceEngine(e,1/180);
 assert.equal(e.getTiming().totalSteps-before,24000);report.checks.push('Fractional 1/180 s updates keep exact cumulative one-second time');
}
report.status='passed';fs.writeFileSync(new URL('./audio-v3-results.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
if(audition){const bytes=Buffer.alloc(44+audition.length*2);bytes.write('RIFF',0);bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8);bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);bytes.writeUInt32LE(48000,24);bytes.writeUInt32LE(96000,28);bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);bytes.write('data',36);bytes.writeUInt32LE(audition.length*2,40);for(let i=0;i<audition.length;i++)bytes.writeInt16LE(Math.max(-32768,Math.min(32767,Math.round(audition[i]*32767))),44+i*2);fs.writeFileSync(new URL('./audio-v3-sdk-i6t.wav',import.meta.url),bytes);}
console.log(JSON.stringify(report,null,2));
