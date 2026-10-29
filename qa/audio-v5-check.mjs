import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import MotorLab from '../sdk/motor-engine.mjs';
import {GameAudio} from '../dist/audio.js';
import {TYRE_SAMPLE,TYRE_SAMPLE_RATE,TRAFFIC_SAMPLE,TRAFFIC_SAMPLE_RATE} from '../dist/audio/samples.js';
import {resolveBuild,DEFAULT_SELECTION,ENGINES} from '../dist/catalog.js';

const DT=1/120,RATE=48000,FRAMES=400;
const report={status:'pending',checks:[],fixtures:{}};
const metrics=values=>{let sum=0,energy=0,peak=0,delta=0;for(let i=0;i<values.length;i++){const v=values[i];assert.ok(Number.isFinite(v));sum+=v;energy+=v*v;peak=Math.max(peak,Math.abs(v));if(i)delta+=(v-values[i-1])**2;}return {rms:Math.sqrt(energy/values.length),peak,dc:sum/values.length,brightness:Math.sqrt(delta/Math.max(energy,1e-14))};};
const hash=file=>createHash('sha256').update(fs.readFileSync(new URL(file,import.meta.url))).digest('hex');
const quietState=()=>({speed:0,forwardSpeed:0,lateralSpeed:0,gear:0,handbrake:0,clutch:1,engineRunning:true,boosting:false,nitrousIntensity:0,wheelAudio:[0,1,2,3].map(()=>({contact:true,load:3300,longitudinalSpeed:0,lateralSpeed:0,slipSpeed:0,wheelSpeed:0,tyrePower:0,brakePower:0,roughness:.0015,surface:'asphalt'}))});
const quietEngine={rpm:900,meanTorque:0,controls:{throttle:0,starter:false}};
const block=(audio,state=quietState())=>{audio.update(state);audio._updateTargets(state,DT,quietEngine);const left=new Float32Array(FRAMES),right=new Float32Array(FRAMES);audio._renderSound(left,right,quietEngine);return {left,right,levels:{...audio.getDiagnostics().layers}};};
const run=(audio,state,seconds)=>{const left=[],right=[],levels=[];for(let n=0;n<Math.round(seconds/DT);n++){const b=block(audio,state);left.push(...b.left);right.push(...b.right);levels.push(b.levels);}return {left:metrics(left),right:metrics(right),levels,diagnostics:audio.getDiagnostics()};};

assert.equal(MotorLab.version,'1.5.0');assert.equal(MotorLab.physicsRelease,13);
const cjs=createRequire(import.meta.url)('../sdk/motor-engine.cjs');assert.equal(cjs.version,MotorLab.version);assert.equal(cjs.physicsRelease,MotorLab.physicsRelease);
assert.equal(hash('../sdk/motor-engine.js'),hash('../dist/vendor/motor-engine.js'));
report.sdk={version:MotorLab.version,physicsRelease:MotorLab.physicsRelease,vendorSHA256:hash('../dist/vendor/motor-engine.js')};
report.checks.push('ESM, CommonJS and distributed classic MotorLab SDK are coherent at 1.5.0 / physics release 13');

{
 assert.equal(ENGINES.length,8);assert.equal(DEFAULT_SELECTION.engineId,'i6t');
 const rows=[];
 for(const ecu of ['stock','track']){
  const build=resolveBuild({engineId:'v6',ecu,turbo:'race',exhaust:ecu==='track'?'race':'street'}),engine=MotorLab.createEngine(build.physics.engineOptions);
  const config=engine.getState().config;assert.equal(config.cylinderCount,6);assert.equal(config.layout,'v');assert.equal(config.bankAngle,60);assert.equal(config.boost,'none');assert.equal(config.boostTarget,0);assert.equal(build.selection.turbo,'stock');assert.equal(build.stats.displacementCc,3200);
  engine.start();for(let n=0;n<90;n++)engine.update(DT);engine.setInputs({starter:false,throttle:.65});
  const manual=MotorLab.fromState(engine.save()),samples=[],a=new GameAudio({pcmEnabled:true,onPCM:l=>samples.push(...l)});a.setBuild(build);const before=engine.getTiming().totalSteps;
  for(let n=0;n<120;n++){const input={throttle:.65,starter:false,externalTorqueNm:-45};engine.setInputs(input);manual.setInputs(input);a.advanceEngine(engine,DT);manual.update(DT);assert.equal(engine.getState().rpm,manual.getState().rpm);}
  assert.equal(engine.getTiming().totalSteps-before,24000);const pcm=metrics(samples);assert.ok(pcm.rms>.001&&pcm.rms<.5);assert.ok(pcm.peak<.94);
  rows.push({id:build.engine.id,name:build.engine.name,ecu,redline:config.redlineRpm,limiter:config.revLimitRpm,boost:config.boost,engineMassKg:build.engine.mass,pcm,rpm:engine.getState().rpm,nativeSteps:24000,pcmManualRpmDifference:engine.getState().rpm-manual.getState().rpm});
 }
 report.fixtures.v6NA=rows;report.checks.push('New 3.2 L 60-degree V6 is naturally aspirated in stock and track builds, ignores turbo hardware, and renders finite bounded PCM with exact manual crank parity');
}

{
 assert.equal(TYRE_SAMPLE_RATE,48000);assert.equal(TYRE_SAMPLE.length,142560);assert.equal(TRAFFIC_SAMPLE_RATE,24000);assert.equal(TRAFFIC_SAMPLE.length,46800);
 const tyre=metrics(TYRE_SAMPLE),traffic=metrics(TRAFFIC_SAMPLE);assert.ok(tyre.rms>.15&&tyre.peak<.92);assert.ok(traffic.rms>.1&&traffic.peak<.9);assert.ok(Math.abs(TYRE_SAMPLE[0]-TYRE_SAMPLE.at(-1))<.06);assert.ok(Math.abs(TRAFFIC_SAMPLE[0]-TRAFFIC_SAMPLE.at(-1))<.06);
 const attribution=fs.readFileSync(new URL('../dist/audio/ATTRIBUTION.txt',import.meta.url),'utf8');for(const text of ['audible-edge (Tom Haigh)','qubodup','https://opengameart.org/content/car-tire-squeal-skid-loop','https://creativecommons.org/licenses/by/3.0/','SIDEWAYS modifications'])assert.ok(attribution.includes(text));
 assert.ok(!/\bfetch\s*\(/.test(fs.readFileSync(new URL('../dist/audio/samples.js',import.meta.url),'utf8')));
 report.fixtures.assets={tyre,traffic,tyreSeconds:TYRE_SAMPLE.length/TYRE_SAMPLE_RATE,trafficSeconds:TRAFFIC_SAMPLE.length/TRAFFIC_SAMPLE_RATE};
 report.checks.push('Real attributed CC BY 3.0 tyre recording and offline SDK traffic bed are finite, seam-crossfaded and embedded without runtime downloads');
}

// Exercise native source-local saturation on identical actual engine states.
// Post EQ is deliberately bypassed here: the change must be in SDK pressure PCM.
{
 const build=resolveBuild(DEFAULT_SELECTION),warm=MotorLab.createEngine(build.physics.engineOptions);warm.start();for(let n=0;n<90;n++)warm.update(DT);warm.setInputs({starter:false,throttle:.7});
 const saved=warm.save(),a=MotorLab.fromState(saved),b=MotorLab.fromState(saved),voice=new GameAudio();voice.setBuild(build);
 const settings=voice._sourceMix();a.setAudio({...settings,bite:0});b.setAudio({...settings,bite:1});const dry=[],driven=[],differences=[];
 for(let n=0;n<90;n++){
  const input={starter:false,throttle:.7,externalTorqueNm:-65};a.setInputs(input);b.setInputs(input);
  const al=new Float32Array(FRAMES),ar=new Float32Array(FRAMES),bl=new Float32Array(FRAMES),br=new Float32Array(FRAMES);a.renderAudio(al,ar,{sampleRate:RATE});b.renderAudio(bl,br,{sampleRate:RATE});
  assert.equal(a.getState().rpm,b.getState().rpm);assert.equal(a.getTiming().totalSteps,b.getTiming().totalSteps);
  if(n>12){dry.push(...al);driven.push(...bl);for(let k=0;k<FRAMES;k++)differences.push(bl[k]-al[k]);}
 }
 const d=metrics(dry),w=metrics(driven),diff=metrics(differences);assert.ok(d.rms>.001&&w.rms>.001);assert.ok(diff.rms>.0001,'native bite must alter actual PCM');assert.ok(d.peak<=1&&w.peak<=1);
 assert.equal(a.save().audio.bite,0);assert.equal(b.save().audio.bite,1);
 const before=voice._sourceRevision;voice.setMix({drive:1,mechanical:.25});assert.ok(voice._sourceRevision>before);assert.equal(voice._sourceMix().bite,.95);assert.equal(voice._sourceMix().gearbox,0);assert.ok(voice._sourceMix().mechanical>0&&voice._sourceMix().chain>0);
 const sourceLevels={};for(const key of ['manifold','mechanical','chain']){
  const engine=MotorLab.fromState(saved);engine.setAudio({master:.7,exhaust:0,intake:0,combustion:0,valve:0,bearing:0,boost:0,manifold:0,mechanical:0,chain:0,gearbox:0,bite:.7,[key]:.7});const sample=[];
  for(let n=0;n<30;n++){const l=new Float32Array(FRAMES),r=new Float32Array(FRAMES);engine.renderAudio(l,r,{sampleRate:RATE});if(n>3)sample.push(...l);}sourceLevels[key]=metrics(sample);assert.ok(sourceLevels[key].rms>1e-6,`${key} is active on configured chain-drive I4`);
 }
 report.fixtures.nativeBite={dry:d,driven:w,difference:diff,rpm:a.getState().rpm,sources:sourceLevels};
 report.checks.push('Native bite changes actual engine PCM with exactly unchanged crank physics; manifold, mechanical and declared timing-chain sources are active');
}

{
 const a=new GameAudio(),s=quietState();a.setMix({environment:0,mechanical:0,tyres:0,engine:1});
 const baseline=run(a,s,.2);assert.equal(baseline.left.rms,0);s.boosting=true;s.nitrousIntensity=1;
 const active=run(a,s,3);assert.ok(active.left.rms>.02);assert.ok(active.levels.slice(24).every(l=>l.nitrous>.04));assert.equal(a.getDiagnostics().events.nitro,1,'hold must not retrigger release/attack event');
 s.boosting=false;s.nitrousIntensity=0;const release=run(a,s,.8);assert.equal(a.getDiagnostics().events.nitro,2);assert.ok(release.levels.at(-1).nitrous<1e-10);assert.ok(a.getDiagnostics().nitrousLevel<1e-10);
 s.boosting=true;s.nitrousIntensity=.3;const part=run(a,s,.4);assert.ok(part.levels.at(-1).nitrous<active.levels.at(-1).nitrous*.45);s.engineRunning=false;const stopped=run(a,s,.8);assert.ok(stopped.levels.at(-1).nitrous>.01,'V6: an open NOS valve hisses even without combustion');
 a.setBuild(resolveBuild(DEFAULT_SELECTION));assert.equal(a.getDiagnostics().nitrousLevel,0);assert.equal(a.getDiagnostics().trafficVoices,0);assert.equal(a.getDiagnostics().activeEvents,0);
 report.fixtures.nitrous={heldRms:active.left.rms,activeLast:active.levels.at(-1).nitrous,releasedLast:release.levels.at(-1).nitrous,intensity30Last:part.levels.at(-1).nitrous};
 report.checks.push('NOS air sound remains continuous for a three-second hold, follows valve intensity even without combustion, triggers only edges, and decays after release');
}

{
 const fixture=(distance,pan,horn=false)=>{const a=new GameAudio();a.setMix({engine:0,mechanical:0,tyres:0,environment:1});a.setTrafficSources([{id:'civilian',distance,pan,rpm:1800,speed:7,throttle:.45,horn}]);return {a,...run(a,quietState(),.8)};};
 const near=fixture(3,-.8),far=fixture(40,-.8),right=fixture(3,.8),horn=fixture(3,0,true);assert.ok(near.left.rms>far.left.rms*8);assert.ok(near.left.rms>near.right.rms*2.7);assert.ok(right.right.rms>right.left.rms*2.7);assert.ok(horn.left.rms>near.left.rms*2);
 near.a.setTraffic([]);const fade=run(near.a,quietState(),.8);near.a.setTraffic([]);assert.ok(fade.levels.at(-1).traffic<1e-10);assert.equal(near.a.getDiagnostics().trafficVoices,0);
 const a=new GameAudio();a.setMix({engine:0,mechanical:0,tyres:0,environment:1});let maxVoices=0;
 for(let n=0;n<14;n++){a.setTraffic(Array.from({length:12},(_,i)=>({id:`${n}:${i}`,distance:2+i,pan:0,rpm:1400+i*100})));maxVoices=Math.max(maxVoices,a.getDiagnostics().trafficVoices);block(a);assert.ok(a._trafficVoices.filter(v=>v.targetGain>0).length<=4);}
 assert.ok(maxVoices<=8);a.setMix({environment:0});const muted=run(a,quietState(),.8);assert.ok(muted.levels.at(-1).traffic<1e-10);a.setBuild(resolveBuild(DEFAULT_SELECTION));assert.equal(a.getDiagnostics().trafficVoices,0);
 report.fixtures.traffic={nearLeft:near.left.rms,nearRight:near.right.rms,farLeft:far.left.rms,rightLeft:right.left.rms,rightRight:right.right.rms,hornRms:horn.left.rms,maxVoices};
 report.checks.push('Traffic bed follows distance and stereo position, adds a bounded horn, fades removed sources, respects environment mix and limits CPU to four active/eight fading voices');
}

{
 const a=new GameAudio({pcmEnabled:true}),build=resolveBuild(DEFAULT_SELECTION),engine=MotorLab.createEngine(build.physics.engineOptions),values={};
 a.context={currentTime:0,state:'running'};a.nodes={master:{gain:{setTargetAtTime:v=>values.master=v}},uiGain:{gain:{setTargetAtTime:v=>values.ui=v}}};a._engine=engine;
 a._nos=.19;a._events.push({kind:'nitro'});const before=engine.getTiming().totalSteps;a.suspend(true);assert.equal(values.master,0);assert.equal(a.getDiagnostics().activeEvents,0);assert.equal(engine.getTiming().totalSteps,before);a.setMuted(true);assert.equal(values.ui,0);assert.equal(a._scheduled.size,0);a.setBuild(build);assert.equal(a.getDiagnostics().nitrousLevel,0);
 report.checks.push('Pause and mute silence transport and clear transient queues without advancing engine time; new build clears continuous NOS and traffic state');
}

report.status='passed';fs.writeFileSync(new URL('./audio-v5-results.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
