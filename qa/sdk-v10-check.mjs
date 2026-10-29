import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import MotorLab from '../sdk/motor-engine.mjs';
import {GameAudio} from '../dist/audio.js';
import {CarPhysics} from '../dist/physics.js';
import {ENGINES,resolveBuild,DEFAULT_SELECTION} from '../dist/catalog.js';

const rate=48000,dt=1/120;
const sources=['exhaust','intake','combustion','valve','bearing','boost','manifold','mechanical','gearbox','chain'];
const root=new URL('../',import.meta.url),read=path=>fs.readFileSync(new URL(path,root));
const hash=path=>createHash('sha256').update(read(path)).digest('hex');
const sourcePaths=['sdk/motor-engine.mjs','dist/vendor/motor-engine.js','dist/audio.js','dist/catalog.js','dist/physics.js','dist/mechanical.js','dist/vehicle-state.js'];
const sourceSHA256=Object.fromEntries(sourcePaths.map(path=>[path,hash(path)]));
const report={status:'pending',scope:'Actual MotorLab 1.6 migration, native source processing, camera stereo, one crank clock and V9 damage persistence.',sampleRate:rate,checks:[],engines:[],fixtures:{},limits:['Deterministic Node PCM and vehicle simulation; no browser playback, hardware latency, wheel hardware or listening assessment.','CPU timings are local process measurements in a shared execution environment, not a browser or device performance guarantee.']};
const near=(a,b,tolerance=1e-8)=>assert.ok(Math.abs(a-b)<=tolerance,`${a} != ${b}`);
function check(name,fn){const data=fn();report.checks.push(name);if(data)report.fixtures[name]=data;console.log('PASS '+name);}
function metrics(channels){let sum=0,peak=0,count=0;for(const values of channels)for(const v of values){assert.ok(Number.isFinite(v),'finite PCM sample');sum+=v*v;peak=Math.max(peak,Math.abs(v));count++;}return {rms:Math.sqrt(sum/count),peak,frames:count/channels.length};}
function warm(build=resolveBuild()){const e=MotorLab.createEngine(build.physics.engineOptions);e.start();for(let i=0;i<90;i++)e.update(dt);e.setInputs({starter:false});return e;}
function render(state,options,frames=24000){const e=MotorLab.fromState(state);e.setAudio(options);const l=new Float32Array(frames),r=new Float32Array(frames);e.renderAudio(l,r,{sampleRate:rate});return {e,l,r,metrics:metrics([l,r]),status:e.getAudioStatus()};}
const neutral={transmission:'hpattern',manualClutch:true,clutch:1,gearRequest:0,assists:false};
function runCar(p,seconds,input=neutral){for(let i=0;i<Math.round(seconds/dt);i++){p.update(dt,input);for(const key of ['rpm','speed','clutchTorque','engineHealth','fuelLitres'])assert.ok(Number.isFinite(p.state[key]),key);}}

check('The installed browser and module SDK are the exact supplied 1.6.0 release14 bundles.',()=>{
 assert.equal(MotorLab.version,'1.6.0');assert.equal(MotorLab.physicsRelease,14);assert.equal(MotorLab.audioRelease,14);
 const manifest=JSON.parse(read('sdk/SOURCES.json'));
 for(const name of ['motor-engine.js','motor-engine.mjs','motor-engine.cjs'])assert.equal(hash('sdk/'+name),manifest.generatedSHA256[name],name);
 assert.equal(hash('dist/vendor/motor-engine.js'),manifest.generatedSHA256['motor-engine.js']);
 assert.equal(manifest.generatedSHA256['motor-engine.js'],'52038ca07bc992c0208928877a23cf464a0b43e17197fb805d21c744d22cb71b');
 return {version:MotorLab.version,physicsRelease:MotorLab.physicsRelease,audioRelease:MotorLab.audioRelease,browserBundleSHA256:hash('dist/vendor/motor-engine.js')};
});

check('An actual V9 1.5.0 save preserves crank, cylinders, timing and existing mix while adding source-layer defaults.',()=>{
 const legacy=JSON.parse(read('qa/fixtures/motorlab-1.5.0-session.json'));
 assert.equal(legacy.sdkVersion,'1.5.0');assert.equal(legacy.physicsRelease,13);assert.equal(legacy.state.version,1);
 const e=MotorLab.fromState(legacy.state),now=e.save(),beforeCore=structuredClone(legacy.state.coreState),afterCore=structuredClone(now.coreState);
 // Residual diagnostics are recalculated from the saved physical state on load.
 delete beforeCore.numerics;delete afterCore.numerics;assert.deepEqual(afterCore,beforeCore);
 near(e.getState().time,legacy.expected.time,0);near(e.getState().rpm,legacy.expected.rpm,0);assert.deepEqual(now.timing,legacy.state.timing);
 for(const [key,value]of Object.entries(legacy.state.audio))assert.equal(now.audio[key],value,key);
 assert.equal(now.audio.layers.exhaust.preGain,1);assert.equal(now.audio.layers.exhaust.distortion,.55);assert.equal(now.audio.listener.mode,'outside');
 const a=new GameAudio({pcmEnabled:true});a.setBuild(resolveBuild());const before=e.getTiming().totalSteps;a.advanceEngine(e,.025);assert.equal(e.getTiming().totalSteps-before,600);assert.equal(e.getTiming().clock,'pcm');assert.equal(e.save().audio.listener.reflections,0);
 const fixture={from:legacy.sdkVersion,to:MotorLab.version,time:legacy.expected.time,rpm:legacy.expected.rpm,stepsAfterTwentyFiveMilliseconds:600,fixtureSHA256:hash('qa/fixtures/motorlab-1.5.0-session.json')};e.dispose();return fixture;
});

check('Every catalog engine renders finite stereo with native layers and exactly one 24000Hz crank clock.',()=>{
 assert.equal(ENGINES.length,8);
 for(const spec of ENGINES){
  const build=resolveBuild({...DEFAULT_SELECTION,engineId:spec.id}),engine=warm(build),manual=MotorLab.fromState(engine.save());
  let count=0,squares=0,peak=0,crossings=0,previous=0,cpuMicros=0;
  const a=new GameAudio({pcmEnabled:true,onPCM:(l,r)=>{for(let i=0;i<l.length;i++){for(const v of [l[i],r[i]]){assert.ok(Number.isFinite(v));squares+=v*v;peak=Math.max(peak,Math.abs(v));}if(count&&((l[i]>=0)!==(previous>=0)))crossings++;previous=l[i];count++;}}});a.setBuild(build);
  const steps=engine.getTiming().totalSteps,time=engine.getState().time;
  for(let i=0;i<180;i++){
   const inputs={throttle:.28+.30*Math.sin(i/180*Math.PI),externalTorqueNm:-25,boostTarget:build.physics.boostTarget,starter:false};engine.setInputs(inputs);manual.setInputs(inputs);
   const before=process.cpuUsage();a.advanceEngine(engine,dt);const used=process.cpuUsage(before);cpuMicros+=used.user+used.system;manual.update(dt);
  }
  assert.equal(engine.getTiming().clock,'pcm');assert.equal(engine.getTiming().totalSteps-steps,36000);assert.equal(engine.getTiming().discardedSeconds,0);near(engine.getState().time-time,1.5,2e-8);near(engine.getState().rpm,manual.getState().rpm);
  assert.equal(count,72000);const rms=Math.sqrt(squares/(count*2));assert.ok(rms>.001&&rms<.5,`${spec.id} RMS ${rms}`);assert.ok(peak<=1,`${spec.id} peak ${peak}`);
  const status=engine.getAudioStatus(),settings=engine.save().audio;assert.equal(status.backend,'pcm');assert.equal(settings.listener.reflections,0);assert.equal(settings.layers.exhaust.preGain,1.05);assert.equal(settings.bite,a.mix.drive);
  assert.ok(status.layers.exhaust.rms>0);assert.ok(status.layers.combustion.rms>0);assert.ok(status.mix.headroomDb>0);assert.ok(status.layers.exhaust.rms!==status.sources.exhaust.rms,'native layer processing is active');
  for(const name of sources){assert.ok(Number.isFinite(status.layers[name].rms),name);assert.ok(Number.isFinite(status.sources[name].rms),name);}
  if(!spec.turbo)assert.equal(status.layers.boost.rms,0,'no turbo sound without turbo hardware');
  if(spec.id==='rotary')assert.equal(status.layers.chain.rms,0,'no fabricated timing chain on rotary');
  const snapshot=engine.getAudioStatus();status.layers.exhaust.rms=999;assert.deepEqual(engine.getAudioStatus(),snapshot,'meter snapshots are independent and non-destructive');
  report.engines.push({id:spec.id,rpm:engine.getState().rpm,rms,peak,zeroCrossingHz:crossings*rate/(count*2),nativeOutputHeadroomDb:snapshot.mix.headroomDb,nativeSteps:36000,pcmManualRpmDifference:engine.getState().rpm-manual.getState().rpm,cpuMsPerSimulatedSecond:cpuMicros/1500});
  void engine.disconnectAudio();engine.load(manual.save());const resetSteps=engine.getTiming().totalSteps;a.advanceEngine(engine,dt);assert.equal(engine.getTiming().clock,'pcm');assert.equal(engine.getTiming().totalSteps-resetSteps,200);
  engine.dispose();manual.dispose();
 }
 assert.equal(new Set(report.engines.map(e=>e.zeroCrossingHz.toFixed(1))).size,8,'engine signatures remain distinct');
});

check('Native master remains linear after source distortion; disabling drive changes timbre without changing crank physics.',()=>{
 const e=warm();e.setInputs({throttle:.65,externalTorqueNm:-25,starter:false});const state=e.save();e.dispose();
 const options={listener:{mode:'direct',reflections:0},bite:.8,layers:{exhaust:{preGain:1.28,distortion:.68}}};
 const full=render(state,{...options,master:.8}),quarter=render(state,{...options,master:.2}),dry=render(state,{...options,master:.8,bite:0});
 let maxDifference=0,timbreDifference=0;for(let i=0;i<full.l.length;i++){maxDifference=Math.max(maxDifference,Math.abs(quarter.l[i]-full.l[i]*.25),Math.abs(quarter.r[i]-full.r[i]*.25));timbreDifference+=(dry.l[i]-full.l[i])**2;}
 assert.ok(maxDifference<2e-8,`linear master error ${maxDifference}`);near(quarter.metrics.rms/full.metrics.rms,.25,1e-6);assert.ok(timbreDifference>1e-5,'new source drive has an audible signal effect');
 near(full.e.getState().rpm,quarter.e.getState().rpm,0);near(full.e.getState().rpm,dry.e.getState().rpm,0);assert.deepEqual(full.status.layers,quarter.status.layers,'master does not change source processing');
 const fixture={quarterMasterRatio:quarter.metrics.rms/full.metrics.rms,maxSampleLinearityError:maxDifference,driveDifferenceRms:Math.sqrt(timbreDifference/full.l.length)};full.e.dispose();quarter.e.dispose();dry.e.dispose();return fixture;
});

check('Exhaust upgrades, source drive and all three cameras reach the native SDK with dry geometry-aware reflections.',()=>{
 const profiles=[];for(const exhaust of ['street','sport','race']){const build=resolveBuild({exhaust}),e=warm(build),a=new GameAudio({pcmEnabled:true});a.setBuild(build);a.setMix({drive:.73});a.advanceEngine(e,dt);const settings=e.save().audio;profiles.push(settings.layers.exhaust);assert.equal(settings.bite,.73);const saved=structuredClone(settings);a.setVolume(.2);a.advanceEngine(e,dt);assert.deepEqual(e.save().audio,saved,'volume cannot alter source distortion');e.dispose();}
 assert.ok(profiles[0].preGain<profiles[1].preGain&&profiles[1].preGain<profiles[2].preGain);assert.ok(profiles[0].distortion<profiles[1].distortion&&profiles[1].distortion<profiles[2].distortion);
 const build=resolveBuild(),e=warm(build),a=new GameAudio({pcmEnabled:true});a.setBuild(build);a.update({x:0,z:0,heading:0,speed:0});
 const listeners=[];for(const [camera,mode,distance]of [[0,'outside',2.4],[1,'outside',1.8],[2,'engine',.7]]){a.setCamera(camera);a.setWorldContext({listenerPosition:{x:3,z:-3},listenerRight:{x:Math.SQRT1_2,z:Math.SQRT1_2}});a.advanceEngine(e,dt);const listener=e.save().audio.listener;assert.equal(listener.mode,mode);assert.equal(listener.distance,distance);near(listener.azimuth,45,1.01);assert.equal(listener.reflections,0);listeners.push(listener);}
 a.setWorldContext({listenerPosition:{x:-3,z:-3}});a.advanceEngine(e,dt);near(e.save().audio.listener.azimuth,-45,1.01);
 e.dispose();return {exhaustProfiles:profiles,cameraListeners:listeners};
});

check('Camera-right orientation swaps the actual PCM ears without altering the native crank or sound-source setup.',()=>{
 const build=resolveBuild(),warmEngine=warm(build),state=warmEngine.save();warmEngine.dispose();
 function side(sign){let l,r;const e=MotorLab.fromState(state),a=new GameAudio({pcmEnabled:true,onPCM:(left,right)=>{l=new Float32Array(left);r=new Float32Array(right);}});a.setBuild(build);a.setCamera(1);a.setMix({mechanical:0,tyres:0,environment:0,reverb:0});a.update({x:0,z:0,heading:0,speed:0});a.setWorldContext({listenerPosition:{x:4,z:-4},listenerRight:{x:Math.SQRT1_2*sign,z:Math.SQRT1_2*sign}});for(let i=0;i<24;i++)a.advanceEngine(e,dt);return {e,a,l,r};}
 const normal=side(1),reversed=side(-1);assert.equal(normal.a.getDiagnostics().nativeStereoFlip,false);assert.equal(reversed.a.getDiagnostics().nativeStereoFlip,true);assert.deepEqual(normal.e.save().audio,reversed.e.save().audio);near(normal.e.getState().rpm,reversed.e.getState().rpm,0);
 let maxError=0,stereoEnergy=0;for(let i=0;i<normal.l.length;i++){maxError=Math.max(maxError,Math.abs(normal.l[i]-reversed.r[i]),Math.abs(normal.r[i]-reversed.l[i]));stereoEnergy+=(normal.l[i]-normal.r[i])**2;}
 assert.ok(stereoEnergy>1e-8,'perspective produces a measurable stereo field');assert.ok(maxError<1e-7,`ear swap error ${maxError}`);normal.e.dispose();reversed.e.dispose();return {maxEarSwapError:maxError,stereoDifferenceRms:Math.sqrt(stereoEnergy/normal.l.length)};
});

check('PCM, manual fallback and fractional frame durations advance a single physical clock through a real vehicle.',()=>{
 const p=new CarPhysics(MotorLab,resolveBuild()),manual=new CarPhysics(MotorLab,resolveBuild()),a=new GameAudio({pcmEnabled:true});a.setBuild(p.build);p.setEngineAdvance((engine,step)=>a.advanceEngine(engine,step));
 const input={transmission:'sequential',gearRequest:2,throttle:.8,steer:.1,assists:false};for(let i=0;i<120;i++){p.update(dt,input);manual.update(dt,input);}
 for(const key of ['rpm','speed','x','z','clutchTorque','fuelLitres','clutchTemperature'])near(p.state[key],manual.state[key],1e-6);
 const before=p.engine.getTiming().totalSteps;void p.engine.disconnectAudio();const silent=new GameAudio();p.setEngineAdvance((engine,step)=>silent.advanceEngine(engine,step));runCar(p,.2);assert.equal(p.engine.getTiming().clock,'manual');assert.equal(p.engine.getTiming().totalSteps-before,4800);
 p.setEngineAdvance((engine,step)=>a.advanceEngine(engine,step));const next=p.engine.getTiming().totalSteps;runCar(p,.2);assert.equal(p.engine.getTiming().clock,'pcm');assert.equal(p.engine.getTiming().totalSteps-next,4800);
 p.reset(10,20,.4);assert.equal(p.engine.getTiming().clock,'manual');const resetSteps=p.engine.getTiming().totalSteps;runCar(p,.1);assert.equal(p.engine.getTiming().totalSteps-resetSteps,2400);assert.equal(p.engine.getTiming().discardedSeconds,0);p.engine.dispose();manual.engine.dispose();
 const e=warm(),fractional=new GameAudio({pcmEnabled:true}),start=e.getTiming().totalSteps;for(let i=0;i<180;i++)fractional.advanceEngine(e,1/180);assert.equal(e.getTiming().totalSteps-start,24000);e.dispose();
 return {vehiclePcmManualParity:true,manualFallbackSteps:4800,pcmReclaimSteps:4800,resetSteps:2400,fractionalOneSecondSteps:24000};
});

check('V9 component condition survives garage save and recovery; selective repair safely releases and reclaims PCM ownership.',()=>{
 const p=new CarPhysics(MotorLab,resolveBuild()),a=new GameAudio({pcmEnabled:true});a.setBuild(p.build);p.setEngineAdvance((engine,step)=>a.advanceEngine(engine,step));
 const broken=p.getCondition();Object.assign(broken.mechanical.health,{pistons:0,radiator:.2,clutch:.65});broken.mechanical.gearHealth[1]=.35;broken.mechanical.temperatures.clutch=350;broken.mechanical.oilLitres=3;broken.fuelLitres=18;broken.boost=.2;p.restoreCondition(broken);runCar(p,.1);
 assert.equal(p.engine.getTiming().clock,'pcm');assert.ok(p.state.engineFault);const saved=JSON.parse(JSON.stringify(p.exportGarageState())),copy=new CarPhysics(MotorLab,resolveBuild());copy.restoreGarageState(saved);
 for(const key of ['pistons','radiator','clutch'])assert.equal(copy.condition.mechanical.health[key],p.condition.mechanical.health[key]);assert.equal(copy.condition.mechanical.gearHealth[1],.35);assert.equal(copy.state.clutchTemperature,p.state.clutchTemperature);
 const fuel=p.state.fuelLitres,nos=p.state.boost,oil=p.condition.mechanical.oilLitres,plate=p.condition.mechanical.health.clutch,temperature=p.state.clutchTemperature;
 assert.equal(p.repairComponents(['pistons']).repaired,true);assert.equal(p.engine.getTiming().clock,'manual');assert.equal(p.state.engineFault,null);assert.equal(p.condition.mechanical.health.radiator,.2);assert.equal(p.condition.mechanical.health.clutch,plate);assert.equal(p.condition.mechanical.gearHealth[1],.35);assert.equal(p.condition.mechanical.oilLitres,oil);assert.equal(p.state.fuelLitres,fuel);assert.equal(p.state.boost,nos);assert.equal(p.state.clutchTemperature,temperature);
 const before=p.engine.getTiming().totalSteps;runCar(p,.2);assert.equal(p.engine.getTiming().clock,'pcm');assert.equal(p.engine.getTiming().totalSteps-before,4800);assert.equal(p.engine.getTiming().discardedSeconds,0);assert.ok(p.state.engineRunning);assert.ok(p.state.clutchTemperature<temperature);
 const fixture={radiatorHealth:p.condition.mechanical.health.radiator,clutchHealth:p.condition.mechanical.health.clutch,gearOneHealth:p.condition.mechanical.gearHealth[1],hotClutchC:temperature,afterRepairAndCoolingC:p.state.clutchTemperature,exactReclaimedSteps:4800};p.engine.dispose();copy.engine.dispose();return fixture;
});

check('A stopped native engine stays silent instead of receiving a fabricated sound loop.',()=>{
 const e=MotorLab.createEngine(resolveBuild().physics.engineOptions);let power=0,frames=0;const a=new GameAudio({pcmEnabled:true,onPCM:(l,r)=>{for(let i=0;i<l.length;i++){power+=l[i]**2+r[i]**2;frames++;}}});a.setBuild(resolveBuild());for(let i=0;i<60;i++)a.advanceEngine(e,dt);const stoppedRms=Math.sqrt(power/(frames*2));assert.ok(stoppedRms<1e-5);e.dispose();return {stoppedRms};
});

assert.deepEqual(Object.fromEntries(sourcePaths.map(path=>[path,hash(path)])),sourceSHA256,'Production source changed during this test run; rerun against frozen sources.');
report.status='passed';report.sourceSHA256=sourceSHA256;
fs.writeFileSync(new URL('./sdk-v10-results.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
