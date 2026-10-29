import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from '../dist/vendor/three.module.js';
import {SpatialWorldAudio} from '../dist/audio/world.js';
import {DrivingFeedback} from '../dist/haptics.js';
import {createEffects} from '../dist/car.js';
import {resolveBuild} from '../dist/catalog.js';

const report={version:9,status:'pending',checks:[],measurements:{},limits:'Actual PCM mixer, particle CPU state and mocked dual-rumble output. No speaker audition, GPU rendering or physical controller test.'};
function pcm(world,seconds,active=true){
 let energy=0,peak=0,leftEnergy=0,rightEnergy=0;const count=Math.ceil(seconds*48000/960),left=new Float32Array(960),right=new Float32Array(960);
 for(let block=0;block<count;block++){left.fill(0);right.fill(0);world.renderInto(left,right,{active,mix:{mechanical:1,environment:0,reverb:0,ambience:0}});for(let i=0;i<960;i++){assert.ok(Number.isFinite(left[i])&&Number.isFinite(right[i]));leftEnergy+=left[i]**2;rightEnergy+=right[i]**2;peak=Math.max(peak,Math.abs(left[i]),Math.abs(right[i]));}}
 energy=leftEnergy+rightEnergy;return{rms:Math.sqrt(energy/(count*960*2)),peak,leftEnergy,rightEnergy};
}
{
 const sound=mechanical=>{const world=new SpatialWorldAudio();world.setContext({listenerPosition:{x:0,z:0},listenerRight:{x:1,z:0},playerPosition:{x:3,z:0},engineRunning:true,rpm:2800,engineHealth:1,mechanical});return{world,output:pcm(world,.8)};};
 const healthy=sound({knock:0,steam:0}),knock=sound({knock:.8,steam:0}),leak=sound({knock:0,steam:1});
 assert.equal(healthy.output.rms,0);assert.ok(knock.output.rms>.0001);assert.ok(leak.output.rms>.001);assert.ok(knock.output.rightEnergy>knock.output.leftEnergy*2,'Damaged engine remains positioned in world stereo');
 pcm(knock.world,1,false);assert.ok(pcm(knock.world,.2,false).rms<1e-8,'Paused damage sound decays');
 leak.world.reset();assert.equal(pcm(leak.world,.2,false).rms,0,'Reset removes steam and stale component state');
 report.measurements.pcm={healthy:healthy.output,knock:knock.output,steam:leak.output};report.checks.push('Bearing knock and hot coolant leakage produce separate finite stereo PCM at full aggregate engine health; pause fades them and reset clears them.');
}
{
 const levels={};for(const event of ['mechanicalWarning','mechanicalFailure']){const world=new SpatialWorldAudio();world.setContext({engineRunning:false});assert.equal(world.playEvent(event,{intensity:.8}),true);assert.equal(world.playEvent(event,{intensity:.8}),false);levels[event]=pcm(world,.75,false);assert.ok(levels[event].rms>.0001);assert.ok(levels[event].peak<.94);assert.equal(world.events.length,0);}
 assert.ok(levels.mechanicalFailure.rms>levels.mechanicalWarning.rms);report.measurements.cues=levels;report.checks.push('Mechanical warning and failure cues use the recorded sample bank, reject duplicate triggers and end without an overlapping loop.');
}
{
 const run=async(state,event)=>{const f=new DrivingFeedback(),calls=[];const target={key:'test',gp:{vibrationActuator:{effects:['dual-rumble'],playEffect(type,value){calls.push(value);return Promise.resolve();},reset(){return Promise.resolve();}}}};if(event)assert.equal(f.event(event),true);let maximum=0;for(let i=0;i<120;i++){maximum=Math.max(maximum,f.update(state,1/120,{target}).weak);await Promise.resolve();}f.update(state,1/120,{target,active:false});assert.equal(f.playing,false);assert.equal(f.lastLevels.weak,0);assert.ok(calls.length<=12);return {calls:calls.length,maximum};};
 const healthy=await run({engineRunning:true,speed:0,rpm:1700,mechanical:{knock:0}}),hurt=await run({engineRunning:true,speed:0,rpm:1700,mechanical:{knock:.8}}),stopped=await run({engineRunning:false,speed:0,rpm:0,mechanical:{knock:1}}),warning=await run({},'mechanicalWarning'),failure=await run({},'mechanicalFailure');
 assert.equal(healthy.calls,0);assert.equal(stopped.calls,0);assert.ok(hurt.calls>=8&&hurt.maximum>.02);assert.ok(warning.calls>0&&failure.maximum>warning.maximum);report.measurements.rumble={healthy,hurt,stopped,warning,failure};report.checks.push('A running damaged engine produces bounded RPM-related rumble at rest; a stopped or healthy engine does not. Failure is stronger than a warning, and pausing cancels output.');
}
{
 const fx=createEffects(new THREE.Scene(),resolveBuild()),state={x:0,z:0,heading:0,speed:0,bodyHeight:0,engineRunning:true,engineHealth:1,mechanical:{steam:.8,smoke:.7},suspension:Array.from({length:4},()=>({contact:false}))};
 for(let i=0;i<600;i++)fx.update(state,1/60,i/60);const hot=fx.debug();assert.ok(hot.activeSteam>0&&hot.activeEngineSmoke>0);assert.ok(hot.activeParticles<=160);
 state.mechanical={steam:0,smoke:0};for(let i=0;i<180;i++)fx.update(state,1/60,10+i/60);const cool=fx.debug();assert.equal(cool.activeSteam,0);assert.equal(cool.activeEngineSmoke,0);fx.reset();assert.equal(fx.debug().activeParticles,0);report.measurements.particles={hot,cool};report.checks.push('Measured coolant steam and engine smoke drive separate bounded particle types, stop when their causes disappear, and clear on reset.');
}
report.status='passed';fs.writeFileSync(new URL('./feedback-v9-results.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
