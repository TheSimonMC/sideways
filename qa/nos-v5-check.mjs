import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import MotorLab from '../sdk/motor-engine.mjs';
import {CarPhysics} from '../dist/physics.js';
import {GameAudio} from '../dist/audio.js';
import {resolveBuild} from '../dist/catalog.js';

const DT=1/120,TAU=Math.PI*2;
const report={status:'pending',scope:'Native NA/turbo NOS shaft torque, activation gates, bottle lifecycle and PCM/manual simulation parity',checks:[],failures:[],scenarios:{}};
const sourceHashes=()=>Object.fromEntries(['dist/physics.js','dist/audio.js','dist/catalog.js','sdk/motor-engine.mjs'].map(path=>[path,createHash('sha256').update(fs.readFileSync(new URL('../'+path,import.meta.url))).digest('hex')]));
report.sourceHashes=sourceHashes();
const close=(a,b,message,tolerance=1e-8)=>assert.ok(Math.abs(a-b)<=tolerance,`${message}: ${a} versus ${b}`);
const activeInput={transmission:'sequential',manualClutch:true,clutch:0,throttle:1,boost:true,assists:false};
const make=id=>new CarPhysics(MotorLab,resolveBuild({engineId:id}));
const external=p=>p.engine.save().externalTorqueNm;
function finite(p){
 const visit=(v,path)=>{if(typeof v==='number')assert.ok(Number.isFinite(v),`${path} must be finite`);else if(v&&typeof v==='object')for(const [k,n] of Object.entries(v))visit(n,`${path}.${k}`);};
 visit(p.state,'state');
 assert.ok(p.state.boost>=0&&p.state.boost<=1,'Bottle remains bounded');
 assert.ok(p.state.nitrousIntensity>=0&&p.state.nitrousIntensity<=1,'NOS intensity remains bounded');
 assert.ok(p.state.nitrousTorque>=0&&p.state.nitrousTorque<=65+p.build.engine.displacementCc/1000*35+1e-9,'NOS torque remains within engine-size cap');
 close(p.state.engineTorque,p.state.combustionTorque+p.state.nitrousTorque,'Displayed total torque includes exactly one NOS contribution');
}
function step(p,input,frames=1){for(let i=0;i<frames;i++){p.update(DT,input);finite(p);}return p.state;}
// A dynamometer fixture uses the public shaft-impulse interface to establish a
// known rolling RPM. It does not replace the native engine or advance its clock.
function roll(p,{rpm=4000,speed,gear=3}={}){
 const omega=rpm*TAU/60;
 speed??=omega*p.wheelRadius/Math.abs(p._ratio(gear||3));
 const native=p.engine.getState();
 p.engine.applyShaftImpulse((omega-native.omega)*native.config.inertia);
 p.engineState=p.engine.getState();p._omega=omega;
 Object.assign(p.state,{heading:0,vx:0,vz:speed,yawRate:0,speed:Math.abs(speed),forwardSpeed:speed,lateralSpeed:0,gear,requestedGear:gear,rpm});
 p._wheelOmega.fill(speed/p.wheelRadius);p._autoEngagement=1;
 return p;
}
function fixture(p,options={}){p.reset();roll(p,options);p.state.throttle=1;return p;}
function dyno(p,input,frames){for(let i=0;i<frames;i++){roll(p);step(p,input);}return p.state;}
async function check(name,fn){try{await fn();report.checks.push(name);console.log('PASS '+name);}catch(error){report.failures.push({name,message:error.message,stack:error.stack});console.error('FAIL '+name+': '+error.message);}}

for(const id of ['i4','i6t']){
 await check(`${id}: actual native shaft torque increases road acceleration`,async()=>{
  const boosted=make(id),stock=make(id);let maxTorque=0,nosImpulse=0,activeSteps=0;
  try{
   for(let i=0;i<420;i++){step(boosted,{transmission:'auto',throttle:1});step(stock,{transmission:'auto',throttle:1});}
   const startSpeed=boosted.state.speed;close(startSpeed,stock.state.speed,'Matched pre-NOS acceleration');
   const startSteps=boosted.engine.getTiming().totalSteps;
   for(let i=0;i<360;i++){
    step(boosted,{transmission:'auto',throttle:1,boost:true});step(stock,{transmission:'auto',throttle:1});
    maxTorque=Math.max(maxTorque,boosted.state.nitrousTorque);nosImpulse+=boosted.state.nitrousTorque*DT;
    if(boosted.state.boosting){activeSteps++;if(activeSteps===1)close(external(boosted),boosted.state.nitrousTorque,'Native SDK received positive shaft torque');}
   }
   assert.ok(activeSteps>240,'NOS must deliver sustained torque during the run');assert.ok(maxTorque>40);
   assert.ok(boosted.state.speed-stock.state.speed>1,'NOS must increase actual vehicle speed, not only a UI metric');
   assert.ok(boosted.state.boost<.9&&boosted.state.boost>0);
   close(stock.state.boost,1,'Stock drive does not spend the bottle');
   close(boosted.engine.getState().controls.boostTarget,boosted.build.physics.boostTarget,'NOS does not modify the authored turbo pressure target');
   assert.equal(boosted.engine.getTiming().totalSteps-startSteps,72000,'Exactly 24 kHz native stepping during the 3 second test');
   assert.equal(boosted.engine.getTiming().totalSteps,stock.engine.getTiming().totalSteps);
   report.scenarios[id]={startKph:startSpeed*3.6,nosKph:boosted.state.speed*3.6,stockKph:stock.state.speed*3.6,advantageKph:(boosted.state.speed-stock.state.speed)*3.6,maxTorqueNm:maxTorque,shaftImpulseNms:nosImpulse,activeSteps,bottleRemaining:boosted.state.boost,boostTargetPa:boosted.engine.getState().controls.boostTarget};
  }finally{await boosted.engine.dispose();await stock.engine.dispose();}
 });

 await check(`${id}: idle, stationary, neutral, reverse, clutch, brakes, shift, stall and redline gates`,async()=>{
  const p=make(id),gates=[];
  const cases=[
   {name:'released button',input:{boost:false}},
   {name:'idle pedal',input:{throttle:0}},
   {name:'70 percent pedal threshold',input:{throttle:.7}},
   {name:'stationary high revs',pose:{speed:0}},
   {name:'4 m/s speed threshold',pose:{speed:4}},
   {name:'neutral',pose:{gear:0}},
   {name:'reverse gear',pose:{gear:-1,speed:-12}},
   {name:'fully depressed clutch',input:{clutch:1}},
   {name:'20 percent clutch threshold',input:{clutch:.2}},
   {name:'handbrake',input:{handbrake:1}},
   {name:'10 percent handbrake threshold',input:{handbrake:.1}},
   {name:'service brake',input:{brake:1}},
   {name:'12 percent service brake threshold',input:{brake:.12}},
   {name:'shift torque cut',setup:p=>p._shift=.15},
   {name:'stalled engine',pose:{rpm:0,speed:0},setup:p=>p._stalled=true},
   {name:'idle crank speed',pose:{rpm:900}},
   {name:'1700 RPM lower cutoff',pose:{rpm:1700}},
   {name:'redline',pose:{rpm:p.redlineRpm}},
   {name:'above redline',pose:{rpm:p.redlineRpm+200}},
   {name:'10 percent bottle start threshold',setup:p=>p.state.boost=.1}
  ];
  try{
   for(const c of cases){fixture(p,c.pose);c.setup?.(p);const before=p.state.boost;step(p,{...activeInput,...c.input});assert.equal(p.state.boosting,false,c.name);close(p.state.nitrousTorque,0,c.name+' torque');close(p.state.nitrousIntensity,0,c.name+' intensity');close(external(p),0,c.name+' native shaft input');close(p.state.boost,before,c.name+' does not spend bottle');gates.push(c.name);}
   fixture(p);step(p,activeInput);assert.ok(p.state.nitrousTorque>1,'Positive control must activate');
   // Once active, a physical inhibit must clear the native shaft input in the
   // very next fixed step, even while the visual blend is decaying.
   for(const input of [{boost:false},{handbrake:1},{brake:1},{clutch:1},{throttle:0}]){
    fixture(p);dyno(p,activeInput,24);assert.ok(p.state.boosting);const before=p.state.boost;
    step(p,{...activeInput,...input});close(p.state.nitrousTorque,0,'Immediate safety gate');close(external(p),0,'No stale external torque after inhibit');close(p.state.boost,before,'Inhibit must stop consumption');
   }
   fixture(p);step(p,{...activeInput,manualClutch:false,shiftUp:true});assert.equal(p.state.gear,4);assert.equal(p.state.boosting,false,'Accepted upshift interrupts NOS');
   for(let i=0;i<42;i++){step(p,{...activeInput,manualClutch:false});if(p._shift>=.08)assert.equal(p.state.nitrousTorque,0,'Shift window gates torque');}
   assert.ok(p.state.boosting,'NOS resumes after the shift when conditions permit');
   report.scenarios[id].gates=gates;report.scenarios[id].immediateInhibits=5;
  }finally{await p.engine.dispose();}
 });
}

await check('Bottle depletion latches while held, release permits recovery and restart',async()=>{
 const p=make('i6t');
 try{
  fixture(p);let frames=0,consumed=0,prior=1;
  while(p.state.boost>.002&&frames<960){dyno(p,activeInput,1);assert.ok(p.state.boost<=prior+1e-12);consumed+=prior-p.state.boost;prior=p.state.boost;frames++;}
  assert.ok(p.state.boost<=.002,'Sustained eligible NOS consumes the bottle');assert.ok(p._nitrousBlocked,'Empty bottle sets release latch');
  const empty=p.state.boost;dyno(p,activeInput,240);assert.equal(p.state.boosting,false);close(external(p),0,'Held empty bottle leaves no crank torque');close(p.state.boost,empty,'Holding NOS cannot refill or pulse the bottle');
  dyno(p,{...activeInput,boost:false},1);assert.equal(p._nitrousBlocked,false,'Button release clears depletion latch');
  dyno(p,{...activeInput,boost:false},420);assert.ok(p.state.boost>.1,'Moving release refills past start threshold');
  const recovered=p.state.boost;dyno(p,activeInput,24);assert.ok(p.state.boosting);assert.ok(p.state.boost<recovered);
  report.scenarios.bottle={eligibleSecondsToEmpty:frames*DT,consumed,emptyResidual:empty,heldEmptySeconds:2,recoveredBeforeRestart:recovered,restartTorqueNm:p.state.nitrousTorque};
 }finally{await p.engine.dispose();}
});

await check('Recharge requires released NOS, cooldown and motion, and caps at full',async()=>{
 const p=make('i4');
 try{
  fixture(p);dyno(p,activeInput,36);const used=p.state.boost;
  dyno(p,{...activeInput,boost:false},60);close(p.state.boost,used,'No refill during 0.5 second cooldown');
  dyno(p,{...activeInput,boost:false},120);assert.ok(p.state.boost>used,'Refill begins after cooldown');
  const moving=p.state.boost;
  for(let i=0;i<90;i++){roll(p,{speed:0,rpm:1000,gear:0});step(p,{transmission:'sequential',boost:false,throttle:0});}
  close(p.state.boost,moving,'Stationary car does not regenerate NOS');
  p.state.boost=.9999;dyno(p,{...activeInput,boost:false},30);close(p.state.boost,1,'Recharge clamps to a full bottle');
  p.state.boost=.05;dyno(p,activeInput,30);assert.equal(p.state.boosting,false,'Below-threshold bottle cannot restart');close(p.state.boost,.05,'Held inactive button does not regenerate');
  report.scenarios.recharge={afterUse:used,afterMovingCooldown:moving,stationaryUnchanged:true,fullClamp:true};
 }finally{await p.engine.dispose();}
});

for(const id of ['i4','i6t'])await check(`${id}: native PCM and manual clocks match through NOS, mute and suspend`,async()=>{
 const pcm=make(id),manual=make(id);let sampleCount=0,samplePeak=0,activeSteps=0,maxDelta=0;
 const audio=new GameAudio({pcmEnabled:true,onPCM:(left,right)=>{sampleCount+=left.length;for(const channels of [left,right])for(const n of channels){assert.ok(Number.isFinite(n),'PCM samples remain finite');samplePeak=Math.max(samplePeak,Math.abs(n));}}});
 audio.setBuild(pcm.build);pcm.setEngineAdvance((engine,dt)=>audio.advanceEngine(engine,dt));
 const keys=['rpm','speed','vx','vz','x','z','heading','clutchTorque','engineTorque','combustionTorque','nitrousTorque','nitrousIntensity','boost','bodyHeight','bodyPitch','bodyRoll'];
 try{
  const initial=pcm.engine.getTiming().totalSteps;
  for(let i=0;i<540;i++){
   if(i===300)audio.setMuted(true);if(i===330)audio.setMuted(false);
   if(i===360){const steps=pcm.engine.getTiming().totalSteps;audio.suspend(true);assert.equal(pcm.engine.getTiming().totalSteps,steps,'Suspend does not advance hidden native time');}
   if(i===390)audio.suspend(false);
   const input={transmission:'auto',throttle:i>480?.4:1,boost:i>=180&&i<450};
   audio.update(pcm.state);step(pcm,input);step(manual,input);
   for(const key of keys){const delta=Math.abs(pcm.state[key]-manual.state[key]);maxDelta=Math.max(maxDelta,delta);assert.ok(delta<1e-7,`${key} differs between PCM and manual: ${delta}`);}
   for(let w=0;w<4;w++)close(pcm.state.wheelOmega[w],manual.state.wheelOmega[w],'Wheel speeds match with native external torque',1e-7);
   assert.equal(pcm.state.boosting,manual.state.boosting);assert.equal(pcm.state.gear,manual.state.gear);
   assert.equal(pcm.engine.getTiming().clock,'pcm');assert.equal(manual.engine.getTiming().clock,'manual');
   assert.equal(pcm.engine.getTiming().totalSteps,manual.engine.getTiming().totalSteps);
   if(pcm.state.boosting)activeSteps++;
  }
  assert.ok(activeSteps>180,'Parity trace includes sustained active NOS');assert.equal(pcm.engine.getTiming().totalSteps-initial,108000);assert.equal(sampleCount,216000);
  close(external(pcm),0,'PCM path clears external torque on release');close(external(manual),0,'Manual path clears external torque on release');
  report.scenarios[id].clockParity={steps:540,nativeSteps:108000,pcmFrames:sampleCount,activeSteps,maxStateDelta:maxDelta,pcmSamplePeak:samplePeak};
 }finally{await pcm.engine.dispose();await manual.engine.dispose();}
});

report.finalSourceHashes=sourceHashes();
report.sourceChangedDuringRun=JSON.stringify(report.sourceHashes)!==JSON.stringify(report.finalSourceHashes);
report.status=report.failures.length?'failed':'passed';
report.limits=['NOS is an arcade external shaft-torque adapter, not a nitrous chemistry simulation.','Bottle lifecycle tests hold a controlled rolling RPM with native shaft impulses to isolate the resource logic.','PCM is rendered offline; audible quality and physical controller/wheel hardware are outside this test.'];
fs.writeFileSync(new URL('./nos-v5-results.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({status:report.status,checks:report.checks.length,failures:report.failures,sourceChangedDuringRun:report.sourceChangedDuringRun},null,2));
if(report.failures.length)process.exitCode=1;
