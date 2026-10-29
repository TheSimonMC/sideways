import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import MotorLab from '../sdk/motor-engine.mjs';
import {GameAudio} from '../dist/audio.js';
import {SpatialWorldAudio} from '../dist/audio/world.js';
import {GameMusic} from '../dist/music.js';
import {AUDIO_KIT} from '../dist/audio/kit.js';
import {MUSIC_DATA,MUSIC_BPM,MUSIC_DURATION} from '../dist/audio/music-track.js';
import {resolveBuild,DEFAULT_SELECTION} from '../dist/catalog.js';

const RATE=48000,DT=1/120,FRAMES=400;
const report={status:'pending',checks:[],fixtures:{},scope:'Deterministic PCM, scheduling and source checks; no claim of listening or browser execution.'};
const metrics=data=>{let sum=0,square=0,peak=0,edge=0;for(let n=0;n<data.length;n++){const v=data[n];assert.ok(Number.isFinite(v));sum+=v;square+=v*v;peak=Math.max(peak,Math.abs(v));if(n)edge+=(v-data[n-1])**2;}return {rms:Math.sqrt(square/Math.max(1,data.length)),peak,dc:sum/Math.max(1,data.length),brightness:Math.sqrt(edge/Math.max(square,1e-20))};};
const wheel=(extra={})=>({surface:'asphalt',contact:true,load:3300,longitudinalSpeed:20,lateralSpeed:0,slipSpeed:0,wheelSpeed:20,tyrePower:0,brakePower:0,roughness:.0015,...extra});
const state=()=>({x:0,z:0,heading:0,speed:20,forwardSpeed:20,lateralSpeed:0,steer:0,yawRate:0,gear:0,clutch:1,handbrake:0,rpm:0,engineRunning:false,engineHealth:1,wheelAttached:[true,true,true,true],wheelAudio:[0,1,2,3].map(()=>wheel())});
const quiet={rpm:0,meanTorque:0,controls:{throttle:0,starter:false}};
function render(audio,s,seconds=.8){const left=[],right=[];for(let n=0;n<Math.round(seconds/DT);n++){audio.update(s);audio._updateTargets(s,DT,quiet);const l=new Float32Array(FRAMES),r=new Float32Array(FRAMES);audio._renderSound(l,r,quiet);if(n>12){left.push(...l);right.push(...r);}}return {left:metrics(left),right:metrics(right),layers:{...audio.getDiagnostics().layers}};}
function tyreFixture(extra,stationary=false){const a=new GameAudio();a.setMix({engine:0,environment:0,mechanical:0,tyres:.85});const s=state();for(const w of s.wheelAudio)Object.assign(w,extra);if(stationary){s.speed=s.forwardSpeed=0;for(let i=0;i<2;i++)s.wheelAudio[i]=wheel({longitudinalSpeed:0,wheelSpeed:0});}return {a,s,result:render(a,s)};}
function renderWorld(world,seconds=.8,options={}){const left=[],right=[];for(let n=0;n<Math.ceil(seconds*50);n++){const l=new Float32Array(960),r=new Float32Array(960);world.renderInto(l,r,options);left.push(...l);right.push(...r);}return {left:metrics(left),right:metrics(right),levels:{...world.levels}};}

{
 const ordinary=tyreFixture({lateralSpeed:1.6,slipSpeed:.7,wheelSpeed:20.7,tyrePower:5000});
 const marginal=tyreFixture({lateralSpeed:2.4,slipSpeed:1.5,wheelSpeed:21.5,tyrePower:11000});
 const severe=tyreFixture({lateralSpeed:6,slipSpeed:5,wheelSpeed:25,tyrePower:48000});
 const burnout=tyreFixture({longitudinalSpeed:0,lateralSpeed:0,slipSpeed:20,wheelSpeed:20,tyrePower:60000},true);
 assert.equal(ordinary.result.layers.tyres,0);assert.equal(marginal.result.layers.tyres,0);assert.ok(severe.result.layers.tyres>.012);assert.ok(burnout.result.layers.tyres>.01);
 const previous={rms:.08941133819275737}; // V5 fixture captured before this change, at the same .85 tyre mix.
 assert.ok(burnout.result.left.rms<.045,'old .85 setting must be materially quieter even before the new UI default');
 for(const w of burnout.s.wheelAudio)Object.assign(w,{slipSpeed:0,wheelSpeed:0,tyrePower:0});const released=render(burnout.a,burnout.s,1.2);assert.ok(released.layers.tyres<1e-5);
 report.fixtures.tyres={mix:.85,ordinary:ordinary.result.layers.tyres,marginal:marginal.result.layers.tyres,severe:severe.result.layers.tyres,burnout:burnout.result,priorFixtureRms:previous.rms,release:released.layers.tyres};
 report.checks.push('Saved .85 tyre mix stays quiet in ordinary corners; severe skid and stationary burnout remain audible, with a quieter filtered recording and a smooth release');
}

{
 const a=new GameAudio();a.setMix({engine:1,environment:0,mechanical:0,tyres:0});const s=state();s.speed=s.forwardSpeed=0;s.boosting=true;s.nitrousIntensity=1;for(const w of s.wheelAudio)Object.assign(w,{longitudinalSpeed:0,wheelSpeed:0});
 const open=render(a,s,.8);assert.ok(open.layers.nitrous>.03);assert.equal(s.engineRunning,false);s.boosting=false;s.nitrousIntensity=0;const shut=render(a,s,.8);assert.ok(shut.layers.nitrous<1e-10);assert.equal(a.getDiagnostics().events.nitro,2);
 report.fixtures.nos={engineOffValveOpen:open.layers.nitrous,valveShut:shut.layers.nitrous};report.checks.push('NOS airflow follows the valve while the engine is stopped, remains continuous during a hold, and releases on valve close');
}

{
 const world=new SpatialWorldAudio();world.setContext({listenerPosition:{x:0,z:0},cameraHeading:0,playerPosition:{x:0,z:10},heading:0});
 const normal=world.spatial(12,10).pan;const wheelNormal=world.wheelPan(0);world.setContext({cameraHeading:Math.PI});const backward=world.spatial(12,10).pan,wheelBack=world.wheelPan(0);assert.ok(normal<-.5&&backward>.5);assert.ok(wheelNormal*wheelBack<0);
 world.setContext({listenerRight:{x:1,z:0}});assert.ok(world.spatial(12,10).pan>.5);
 world.setContext({listenerRight:null,cameraHeading:0});world.setSources([{id:'exact',x:0,z:0,rpm:900}]);assert.equal(world.voices.length,1);assert.ok(world.voices[0].targetGain>0);
 const fixture=(x,z,siren=false,horn=false)=>{const w=new SpatialWorldAudio();w.setContext({listenerPosition:{x:0,z:0},cameraHeading:0,engineRunning:false});w.setSources([{id:'one',x,z,rpm:1800,throttle:.4,siren,horn}],0);return {world:w,...renderWorld(w)};};
 const left=fixture(8,10),right=fixture(-8,10),far=fixture(70,10),siren=fixture(100,100,true),horn=fixture(-3,3,false,true),front=fixture(0,12),rear=fixture(0,-12);assert.ok(rear.world.voices[0].lp<front.world.voices[0].lp);assert.ok(rear.world.voices[0].targetGain<front.world.voices[0].targetGain);
 assert.ok(left.left.rms>left.right.rms*1.9);assert.ok(right.right.rms>right.left.rms*1.9);assert.ok(left.left.rms>far.left.rms*8);assert.ok(siren.levels.sirens>.0004);assert.ok(horn.levels.horns>.005);
 world.setSources([{id:'doppler',x:10,z:10}],0);world.setSources([{id:'doppler',x:2,z:2}],.02);assert.ok(world.voices.find(v=>v.id==='doppler').doppler<=1.13);
 for(let n=0;n<15;n++){world.setSources(Array.from({length:12},(_,i)=>({id:`${n}:${i}`,distance:i+1,pan:0,siren:i===11})),n/60);assert.ok(world.voices.length<=8);assert.ok(world.voices.filter(v=>v.targetGain>0).length<=4);renderWorld(world,.02);}
 world.setSources([]);renderWorld(world,1);world.setSources([]);assert.equal(world.voices.length,0);
 report.fixtures.spatial={normal,backward,wheelNormal,wheelBack,left:left.left.rms,leftOther:left.right.rms,right:right.right.rms,far:far.left.rms,distantSiren:siren.levels.sirens,horn:horn.levels.horns};
 report.checks.push('Camera look-back reverses world and wheel stereo; explicit camera-right overrides yaw; distance, rear filtering, Doppler and four-active/eight-fading voice bounds remain finite');
}

{
 const w=new SpatialWorldAudio();w.setContext({engineRunning:false,speed:0,playerHorn:true});const horn=renderWorld(w,.7);assert.ok(horn.levels.horns>.01);w.setContext({playerHorn:false});const off=renderWorld(w,.6);assert.ok(off.levels.horns<1e-10);
 w.setContext({servicing:'fuel'});const fuel=renderWorld(w,.8);assert.ok(fuel.levels.service>.002);w.setContext({servicing:'repair'});const repair=renderWorld(w,1.4);assert.ok(repair.levels.service>.001);assert.ok(w.events.length<8);w.setContext({servicing:null});const stop=renderWorld(w,.8);assert.ok(stop.levels.service<1e-8);
 w.setContext({engineRunning:true,rpm:2100,engineHealth:.2,engineFault:true});const hurt=renderWorld(w,.8);assert.ok(hurt.levels.damage>1e-5);w.setContext({engineRunning:false,engineHealth:1,engineFault:false,speed:20,wheelAttached:[true,false,true,true],bodyScrape:30000});const scrape=renderWorld(w,.8);assert.ok(scrape.levels.damage>.001);
 w.setContext({worldActive:false});for(const name of ['lightToggle','wheelLoss','engineHurt','refuel','service','escape','arrest']){assert.equal(w.playEvent(name,{intensity:.8}),true);renderWorld(w,.10,{active:false});}assert.ok(w.events.length<=32);const cue=renderWorld(w,.2,{active:false});assert.ok(cue.levels.worldEvents>.001);assert.ok(cue.levels.service<1e-12);w.clearTransients();assert.equal(w.events.length,0);
 const stateBefore=JSON.stringify(w.context);renderWorld(w,.2);assert.equal(JSON.stringify(w.context),stateBefore);w.reset();assert.equal(w.hasSignal(),false);
 report.fixtures.world={heldHorn:horn.levels.horns,hornReleased:off.levels.horns,fuel:fuel.levels.service,repair:repair.levels.service,serviceEnded:stop.levels.service,engineHurt:hurt.levels.damage,scrape:scrape.levels.damage,suspendedCue:cue.levels.worldEvents};
 report.checks.push('Recorded horn works with the engine stopped; pump, repair, damaged engine and detached-wheel scrape follow actual state; event cues remain finite and never mutate simulation state');
}

class FakeParam{constructor(value=0){this.value=value;}setTargetAtTime(v){this.value=v;}setValueAtTime(v){this.value=v;}linearRampToValueAtTime(v){this.value=v;}}
class FakeContext{
 constructor(){this.currentTime=0;this.state='running';this.live=new Set();this.sources=[];this.destination={};this.decodes=0;}
 node(){return {connect(){},disconnect(){}};}
 createGain(){return {...this.node(),gain:new FakeParam()};}
 createBiquadFilter(){return {...this.node(),frequency:new FakeParam(),Q:new FakeParam()};}
 createDynamicsCompressor(){return {...this.node(),threshold:new FakeParam(),knee:new FakeParam(),ratio:new FakeParam(),attack:new FakeParam(),release:new FakeParam()};}
 createStereoPanner(){return {...this.node(),pan:new FakeParam()};}
 createBuffer(channels,length,rate){const data=Array.from({length:channels},()=>new Float32Array(length));return {duration:length/rate,sampleRate:rate,length,numberOfChannels:channels,getChannelData:i=>data[i]};}
 async decodeAudioData(bytes){assert.ok(bytes.byteLength>500000);this.decodes++;return this.createBuffer(2,Math.round(MUSIC_DURATION*RATE),RATE);}
 createBufferSource(){const ctx=this,node={...this.node(),playbackRate:new FakeParam(1),loop:false,onended:null,start(time,offset=0){assert.ok(time>=ctx.currentTime-1e-8,`scheduled in past: ${time} < ${ctx.currentTime}`);this.startTime=time;this.offset=offset;this.end=this.loop?Infinity:time+(this.buffer.duration-offset)/this.playbackRate.value;ctx.live.add(this);},stop(){ctx.live.delete(this);this.onended?.();}};this.sources.push(node);return node;}
 advance(dt){this.currentTime+=dt;for(const source of [...this.live])if(source.end<=this.currentTime){this.live.delete(source);source.onended?.();}}
}

{
 const ctx=new FakeContext(),m=new GameMusic();await m.prepare(ctx,ctx.destination);assert.equal(m.ready,true);assert.equal(ctx.decodes,1);await m.prepare(ctx,ctx.destination);assert.equal(ctx.decodes,1);m.update();const base=m.base;assert.ok(base.loop);assert.equal(base.loopEnd,MUSIC_DURATION);m.setState({paused:true});m.update();assert.equal(m.offset,0,'pause before scheduled start preserves offset zero');m.setState({paused:false,mode:'menu'});m.update();
 for(let i=0;i<240;i++){ctx.advance(1/60);m.update();}assert.equal(m.scheduled,0);const stableBase=m.base;m.setState({mode:'drive',intensity:.4});for(let i=0;i<240;i++){ctx.advance(1/60);m.update();}const drive=m.scheduled;assert.ok(drive>10);assert.strictEqual(m.base,stableBase);
 m.setState({mode:'chase',intensity:.9});for(let i=0;i<240;i++){ctx.advance(1/60);m.update();}const chase=m.scheduled-drive;assert.ok(chase>drive*1.3);assert.strictEqual(m.base,stableBase);assert.ok(m.maxVoices<=48);
 ctx.advance(20);const before=m.scheduled;m.update();assert.ok(m.scheduled-before<10,'late frames must not burst old notes');m.setState({mode:'escape'});const escapeBefore=m.scheduled;for(let i=0;i<120;i++){ctx.advance(1/60);m.update();}assert.equal(m.scheduled,escapeBefore);
 m.setState({paused:true});m.update();const offset=m.offset;assert.equal(ctx.live.size,0);ctx.advance(4);m.setState({paused:false});m.update();assert.ok(Math.abs(m.base.offset-offset)<1e-8);m.setState({enabled:false});m.update();assert.equal(ctx.live.size,0);m.setState({enabled:true});m.setGlobal({muted:true});m.update();assert.equal(ctx.live.size,0);
 const bad=new GameMusic(),badCtx=new FakeContext();badCtx.decodeAudioData=()=>{throw new Error('Unsupported sample codec');};assert.equal(await bad.prepare(badCtx,badCtx.destination),false);assert.equal(bad.ready,false);assert.match(bad.error,/codec/);
 report.fixtures.music={bpm:MUSIC_BPM,duration:MUSIC_DURATION,driveHits:drive,chaseHits:chase,maxVoices:m.maxVoices,decodes:ctx.decodes,resumeOffset:offset,decodeFailure:bad.error};
 report.checks.push('One embedded band loop persists across menu, drive, chase and escape; real drum layers intensify, scheduling stays bounded, pause resumes position, off/mute clears nodes and decode failure is isolated');
}

{
 const ctx=new FakeContext(),a=new GameAudio(),engine=MotorLab.createEngine(resolveBuild(DEFAULT_SELECTION).physics.engineOptions);a.context=ctx;a.started=true;a._build(ctx);await a.music._preparing;a._engine=engine;const steps=engine.getTiming().totalSteps;
 a.setWorldContext({listenerPosition:{x:0,z:0},cameraHeading:0,engineRunning:false,playerHorn:true,worldActive:true});a.setTraffic([{id:'police',x:-15,z:20,siren:true,rpm:1500}]);a.setMusic({mode:'menu',paused:false});
 let maxQueued=0;for(let i=0;i<240;i++){a.updateWorld(1/60);maxQueued=Math.max(maxQueued,a._worldScheduled.size);ctx.advance(1/60);}assert.ok(a._worldFrames>RATE*3);assert.ok(maxQueued<=6);assert.equal(engine.getTiming().totalSteps,steps);assert.equal(a._renderFrames,0);assert.ok(a.music.base);assert.ok(a.world.levels.sirens>.001);assert.ok(a.world.levels.horns>.01);
 a.suspend(true);a.setWorldContext({worldActive:false,playerHorn:false,servicing:null});a.setMusic({paused:true});a.updateWorld();assert.equal(a._worldScheduled.size,0);assert.equal(a.music.base,null);a.playEvent('escape');a.updateWorld();assert.ok(a._worldScheduled.size>0);a.setWorldContext({worldActive:true,servicing:'fuel'});for(let i=0;i<60;i++){ctx.advance(1/60);a.updateWorld();}assert.ok(a.world.levels.service>.001);
 a.setMuted(true);assert.equal(a._worldScheduled.size,0);assert.equal(a._uiScheduled.size,0);assert.equal(ctx.live.size,0);assert.equal(engine.getTiming().totalSteps,steps);
 a.setMuted(false);a.setMusic({enabled:false});a.world.reset();a.setTraffic([]);a.setWorldContext({worldActive:false,playerHorn:false,servicing:null});a.playEvent('ui');a.updateWorld();assert.ok(a._worldScheduled.size>0);assert.equal(a.world.events.length,0,'short click has been rendered into queued buffers');ctx.advance(1/60);a.updateWorld();assert.ok(a._worldScheduled.size>0,'rendered event tails must drain rather than being discarded');ctx.advance(.15);a.updateWorld();assert.equal(a._worldScheduled.size,0);
 report.fixtures.transport={worldFrames:a._worldFrames,playerEngineFrames:a._renderFrames,unchangedNativeSteps:steps,maxQueued};report.checks.push('Display-frame world/music transport works with stopped or suspended player physics, service can opt in, fresh pause cues play, mute stops all sources, and no hidden MotorLab steps occur');
}

{
 const assets=JSON.parse(fs.readFileSync(new URL('./audio-v6-assets.json',import.meta.url),'utf8'));assert.equal(Object.keys(AUDIO_KIT).length,12);for(const item of assets.samples){const sample=AUDIO_KIT[item.key];assert.equal(sample.data.length,item.frames);assert.equal(sample.rate,item.rate);const m=metrics(sample.data);assert.ok(m.rms>1e-4&&m.peak<=.91);}
 assert.equal(createHash('sha256').update(Buffer.from(MUSIC_DATA,'base64')).digest('hex'),assets.music.adaptedMp3Sha256);assert.equal(MUSIC_BPM,87);
 const credits=fs.readFileSync(new URL('../dist/audio/ATTRIBUTION.txt',import.meta.url),'utf8');for(const value of ['Joth','Versilian Studios','Kenney','hsaunier10','guitarguy1985','audible-edge','qubodup','c1ea7bcc3c7309650ab0da9d15c9cd1fbc4a4c7e'])assert.ok(credits.includes(value));
 for(const path of ['../dist/audio.js','../dist/audio/world.js','../dist/music.js','../dist/audio/kit.js','../dist/audio/music-track.js']){const source=fs.readFileSync(new URL(path,import.meta.url),'utf8');assert.ok(!/\bfetch\s*\(|createOscillator\s*\(/.test(source));}
 report.fixtures.assets={sampleCount:Object.keys(AUDIO_KIT).length,musicBytes:Buffer.from(MUSIC_DATA,'base64').length,offline:true};report.checks.push('Twelve attributed finite samples and the stereo band phrase are embedded, hash-verified, and require neither runtime downloads nor oscillator nodes');
}

report.status='passed';fs.writeFileSync(new URL('./audio-v6-results.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
