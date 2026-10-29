import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import MotorLab from '../sdk/motor-engine.mjs';
import {CarPhysics} from '../dist/physics.js';
import {resolveBuild,DEFAULT_SELECTION} from '../dist/catalog.js';
import {GameAudio} from '../dist/audio.js';
import {SpatialWorldAudio} from '../dist/audio/world.js';
import {StreetAcoustics} from '../dist/audio/acoustics.js';
import {GameMusic} from '../dist/music.js';
import {RADIO_KIT} from '../dist/audio/radio-kit.js';
import {AMBIENT_KIT} from '../dist/audio/ambient-kit.js';
import {MUSIC_DATA,MUSIC_BPM,MUSIC_BARS,MUSIC_DURATION} from '../dist/audio/music-track.js';
import {CHASE_DATA,CHASE_BPM,CHASE_DURATION} from '../dist/audio/chase-track.js';

const RATE=48000;
const report={status:'pending',scope:'Deterministic PCM/DSP and mocked Web Audio scheduling; real MP3 decoding through ffmpeg. No browser, speaker or controller listening claim.',checks:[],fixtures:{}};
const recordCheck=report.checks.push.bind(report.checks);report.checks.push=message=>{console.error('PASS: '+message);return recordCheck(message);};
const metrics=data=>{let energy=0,peak=0;for(const x of data){assert.ok(Number.isFinite(x));energy+=x*x;peak=Math.max(peak,Math.abs(x));}return {rms:Math.sqrt(energy/Math.max(1,data.length)),peak};};
const space=(extra={})=>({zone:'test',enclosure:.55,reflectivity:.65,openness:.45,leftDistance:8,rightDistance:35,frontDistance:90,backDistance:90,...extra});
function render(world,seconds,options={}){let lEnergy=0,rEnergy=0,peak=0,sums={};const frames=Math.round(seconds*RATE),left=new Float32Array(960),right=new Float32Array(960);for(let n=0;n<frames;n+=960){left.fill(0);right.fill(0);world.renderInto(left,right,options);for(let i=0;i<left.length;i++){assert.ok(Number.isFinite(left[i])&&Number.isFinite(right[i]));lEnergy+=left[i]**2;rEnergy+=right[i]**2;peak=Math.max(peak,Math.abs(left[i]),Math.abs(right[i]));}for(const[k,v]of Object.entries(world.levels))sums[k]=(sums[k]||0)+v*v;}const blocks=Math.ceil(frames/960);return {left:Math.sqrt(lEnergy/(blocks*960)),right:Math.sqrt(rEnergy/(blocks*960)),peak,levels:Object.fromEntries(Object.entries(sums).map(([k,v])=>[k,Math.sqrt(v/blocks)]))};}

{
 const w=new SpatialWorldAudio();w.setContext({listenerPosition:{x:0,z:0},listenerRight:{x:1,z:0},engineRunning:false});
 const sources=[...Array.from({length:20},(_,i)=>({id:'civil'+i,x:i+2,z:0,rpm:1800,throttle:.6})),...Array.from({length:5},(_,i)=>({id:'police'+i,x:0,z:100+i*42,siren:true,rpm:1800}))];w.setSources(sources,0);
 assert.equal(w.diagnostics().activeVoices,6);assert.equal(w.diagnostics().sirenVoices,3);assert.deepEqual(w.voices.filter(v=>v.targetSiren>0).map(v=>v.id),['police0','police1','police2']);
 const fixture=d=>{const q=new SpatialWorldAudio();q.setContext({listenerPosition:{x:0,z:0},listenerRight:{x:1,z:0},engineRunning:false});q.setSources([{id:'one',x:0,z:d,siren:true,rpm:1800}]);return {world:q,...render(q,2,{mix:{environment:0,sirens:1,reverb:0}})};};
 const distances=[30,100,200,320].map(d=>({distance:d,...fixture(d)}));for(const f of distances){assert.equal(f.world.voices.length,1);assert.ok(f.levels.sirens>.009);assert.equal(f.levels.traffic,0);}
 assert.ok(distances[1].levels.sirens>.045);assert.ok(distances[1].levels.sirens>distances[2].levels.sirens*1.8);
 const muted=render(distances[1].world,1,{mix:{environment:0,sirens:0,reverb:0}});assert.ok(distances[1].world.levels.sirens<1e-9);assert.equal(distances[1].world.mixDucking({sirens:0}).sirenThreat,0);
 for(let frame=0;frame<25;frame++){w.setSources(sources.map(s=>({...s,id:s.id+':'+frame})),frame/60);render(w,.02);assert.ok(w.voices.length<=10);assert.ok(w.diagnostics().activeVoices<=6);assert.ok(w.diagnostics().sirenVoices<=3);}
 w.setSources([]);render(w,1);w.setSources([]);assert.equal(w.voices.length,0);
 report.fixtures.sirens={distances:distances.map(f=>({distance:f.distance,rms:f.levels.sirens})),maxActive:6,maxFading:10,reservedEmergency:3,mutedReleaseRms:muted.levels.sirens};
 report.checks.push('Emergency voices survive a crowd of closer civilians, remain audible in measured PCM to320m, use an independent siren mix, and obey6active/10total bounds.');
}

{
 const fixture=(x,heading=0,right={x:1,z:0})=>{const w=new SpatialWorldAudio();w.setContext({listenerPosition:{x:0,z:0},listenerRight:right,cameraHeading:heading,engineRunning:false});w.setSources([{id:'car',x,z:18,rpm:2200,throttle:.7}]);return {w,...render(w,1,{mix:{environment:1,sirens:0,reverb:0}})};};
 const a=fixture(20),b=fixture(20,Math.PI,{x:-1,z:0}),far=fixture(65);assert.ok(a.right>a.left*2);assert.ok(b.left>b.right*2);assert.ok(a.levels.traffic>.006);assert.ok(far.levels.traffic>.0008);
 a.w.setSources([{id:'car',x:18,z:18,rpm:2200,throttle:.7,horn:true}],1);const horn=render(a.w,.5,{mix:{environment:1,reverb:0}});assert.ok(horn.levels.horns>.015);assert.ok(a.w.voices[0].doppler>=.88&&a.w.voices[0].doppler<=1.13);
 report.fixtures.traffic={near:a.levels.traffic,far:far.levels.traffic,right:a.right,left:a.left,lookBackLeft:b.left,horn:horn.levels.horns};
 report.checks.push('Civilian RPM/load sound and recorded horns carry to practical street distances; actual camera-right reverses stereo, with bounded Doppler.');
}

{
 const w=new SpatialWorldAudio();w.setContext({worldActive:false,engineRunning:false});assert.equal(w.playEvent('sirenTest'),true);const preview=render(w,2.5,{active:false,mix:{environment:0,sirens:1,reverb:0}});assert.ok(preview.levels.sirens>.075);assert.equal(w.events.length,0);assert.equal(w.traffic.size,0);
 assert.equal(w.playEvent('radio',{code:'check',message:'Dispatch to all units. Radio check.'}),true);const radio=render(w,.7,{active:false,mix:{radio:.85,reverb:0}});assert.ok(radio.levels.radio>.025);assert.equal(w.radio.code,'check');assert.ok(w.mixDucking().music<.7);
 for(const code of ['pursuit','backup','search','spotted','camera','nightShift'])w.playEvent('radio',{code,message:code});assert.equal(w.radioQueue.length,3);assert.ok(w.radioDropped>0);assert.equal(w.radio.code,'check','queued calls do not overlap current speech');
 assert.equal(w.playEvent('radio',{code:'arrest',message:'Driver in custody.'}),true);assert.equal(w.radioQueue.length,1);render(w,.6,{active:false});assert.equal(w.radio.code,'arrest');render(w,3,{active:false});assert.equal(w.radio,null);assert.equal(w.radioQueue.length,0);
 const p=w.radioPlayed;assert.equal(w.playEvent('radio',{code:'arrest'}),false);w.clearTransients();assert.equal(w.radio,null);assert.equal(w.radioQueue.length,0);
 w.playEvent('speedCamera',{intensity:.8});assert.ok(render(w,.2,{active:false,mix:{reverb:0}}).levels.worldEvents>.001);
 const off=new SpatialWorldAudio();off.playEvent('radio',{code:'check'});const muted=render(off,2.5,{active:false,mix:{radio:0,reverb:0}});assert.equal(muted.levels.radio,0);
 report.fixtures.radio={testSirenRms:preview.levels.sirens,radioRms:radio.levels.radio,played:p,dropped:w.radioDropped,queueLimit:3,mutedRms:muted.levels.radio};
 report.checks.push('Settings siren preview ends after2.15s without traffic; recorded speech PCM is serialized, priority-interrupted, cooldown/queue bounded and independently muted. Speed-camera cue works while stationary.');
}

{
 const impulse=(config,mix=1)=>{const a=new StreetAcoustics();a.setSpace(config,mix);for(let i=0;i<RATE;i++)a.sample(0,0);let earlyL=0,earlyR=0,tail=0,peak=0;for(let i=0;i<RATE*2;i++){const input=i<800?Math.sin(i*.22)*.5:0,o=a.sample(input,input);assert.ok(Number.isFinite(o[0])&&Number.isFinite(o[1]));peak=Math.max(peak,Math.abs(o[0]),Math.abs(o[1]));if(i>800&&i<RATE*.10){earlyL+=o[0]**2;earlyR+=o[1]**2;}if(i>800)tail+=o[0]**2+o[1]**2;}return {a,earlyL,earlyR,tail,peak};};
 const open=impulse(space({enclosure:0,leftDistance:90,rightDistance:90})),street=impulse(space({enclosure:.8,leftDistance:5,rightDistance:70})),mirror=impulse(space({enclosure:.8,leftDistance:70,rightDistance:5})),dry=impulse(space({enclosure:1}),0);
 assert.ok(street.tail>open.tail*50);assert.ok(street.earlyL>street.earlyR*8);assert.ok(mirror.earlyR>mirror.earlyL*8);assert.equal(dry.tail,0);assert.ok(street.peak<.8);assert.ok(street.a.tail<1e-6);street.a.reset();assert.equal(street.a.tail,0);assert.equal(street.a.sample(0,0)[0],0);
 const changing=new StreetAcoustics();for(let i=0;i<RATE;i++){if(i%4800===0)changing.setSpace(space({leftDistance:1.5+i/RATE*88,enclosure:i/RATE}),.65);const o=changing.sample(Math.sin(i*.17)*.3,Math.sin(i*.14)*.3);assert.ok(Math.abs(o[0])<1&&Math.abs(o[1])<1);}
 report.fixtures.acoustics={openTailEnergy:open.tail,streetTailEnergy:street.tail,leftFacadeEnergyRatio:street.earlyL/street.earlyR,rightFacadeEnergyRatio:mirror.earlyR/mirror.earlyL,disabledTail:dry.tail,peak:street.peak};
 report.checks.push('Geometry changes reverb tail energy and early stereo reflection direction; changing facade distances remain finite, disabled reverb is dry, tails decay and resets clear buffers.');
}

{
 const fixture=night=>{const w=new SpatialWorldAudio();w.setContext({night,engineRunning:false,speed:0,acoustics:space({enclosure:0,ambient:{park:1,water:1,wind:.4,insects:1,industrial:0}})});return {w,...render(w,1.6,{mix:{ambience:.8,reverb:0}})};};
 const day=fixture(0),night=fixture(1);assert.ok(day.levels.ambience>.004&&night.levels.ambience>.002);assert.ok(day.w._ambient.birds>night.w._ambient.birds+.02);assert.ok(night.w._ambient.crickets>day.w._ambient.crickets+.02);
 const off=render(day.w,1,{mix:{ambience:0,reverb:0}});assert.ok(day.w.levels.ambience<.001);day.w.clearTransients();const pause=render(day.w,.2,{active:false,mix:{reverb:0}});assert.equal(pause.levels.ambience,0);
 assert.notDeepEqual(AMBIENT_KIT.birds.left,AMBIENT_KIT.birds.right);
 report.fixtures.ambience={day:day.levels.ambience,night:night.levels.ambience,mutedRelease:off.levels.ambience,paused:pause.levels.ambience};
 report.checks.push('Real stereo birds and evening insects crossfade with day/night and park context, independent ambience volume fades to silence, and pause clears the beds.');
}

class FakeParam{constructor(value=0){this.value=value;}setTargetAtTime(v){assert.ok(Number.isFinite(v));this.value=v;}setValueAtTime(v){this.value=v;}linearRampToValueAtTime(v){this.value=v;}}
class FakeContext{
 constructor(){this.currentTime=0;this.state='running';this.live=new Set();this.sources=[];this.destination={};this.decodes=0;}
 node(){return {connect(){},disconnect(){}};}
 createGain(){return {...this.node(),gain:new FakeParam()};}
 createBiquadFilter(){return {...this.node(),frequency:new FakeParam(),Q:new FakeParam()};}
 createDynamicsCompressor(){return {...this.node(),threshold:new FakeParam(),knee:new FakeParam(),ratio:new FakeParam(),attack:new FakeParam(),release:new FakeParam()};}
 createStereoPanner(){return {...this.node(),pan:new FakeParam()};}
 createBuffer(channels,length,rate){const data=Array.from({length:channels},()=>new Float32Array(length));return {duration:length/rate,sampleRate:rate,length,numberOfChannels:channels,getChannelData:i=>data[i]};}
 async decodeAudioData(bytes){assert.ok(bytes.byteLength>500000);return this.createBuffer(2,Math.round((this.decodes++===0?MUSIC_DURATION:CHASE_DURATION)*RATE),RATE);}
 createBufferSource(){const ctx=this,node={...this.node(),playbackRate:new FakeParam(1),loop:false,onended:null,start(time,offset=0){assert.ok(time>=ctx.currentTime-1e-8,'scheduled in past');this.startTime=time;this.offset=offset;this.end=this.loop?Infinity:time+(this.buffer.duration-offset)/this.playbackRate.value;ctx.live.add(this);},stop(time=ctx.currentTime){this.end=Math.min(this.end??Infinity,time);if(time<=ctx.currentTime){ctx.live.delete(this);this.onended?.();}}};this.sources.push(node);return node;}
 advance(dt){this.currentTime+=dt;for(const source of [...this.live])if(source.end<=this.currentTime){this.live.delete(source);source.onended?.();}}
}
const advance=(ctx,m,seconds)=>{for(let i=0;i<Math.round(seconds*60);i++){ctx.advance(1/60);m.update();}return m.diagnostics();};

{
 const ctx=new FakeContext(),m=new GameMusic();await m.prepare(ctx,ctx.destination);await m.prepare(ctx,ctx.destination);assert.equal(ctx.decodes,2);m.update();const menu=advance(ctx,m,1);assert.equal(menu.chaseLoops,0);const stableBand=m.base;
 m.setState({mode:'drive',speed:30,intensity:.4});const drive=advance(ctx,m,4),driveHits=m.scheduled;assert.ok(driveHits>10);
 m.setState({mode:'chase',heat:1,proximity:.9,intensity:.9,nitrous:1});const chase=advance(ctx,m,4),chaseHits=m.scheduled-driveHits;assert.equal(chase.chaseLoops,2);assert.ok(chase.energy>.9&&chase.chaseLevel>.85&&chase.bandLevel<.02);assert.ok(chaseHits>driveHits*1.4);assert.strictEqual(m.base,stableBand);assert.equal(m.chaseBases[0].startTime,m.chaseBases[1].startTime);assert.ok(m.sectionGains[1].gain.value>.9);
 m.setState({mode:'search',searchProgress:.5,intensity:.3,proximity:0,nitrous:0});const search=advance(ctx,m,4);assert.ok(search.energy<chase.energy*.5);assert.ok(search.chaseLevel<chase.chaseLevel*.3);assert.equal(m.chaseFilter.frequency.value,1900);assert.ok(search.bandLevel<.001);
 m.setState({mode:'chase',heat:1,proximity:1,intensity:1});advance(ctx,m,2);m.setState({mode:'escape'});const release=[];for(let i=0;i<10;i++){advance(ctx,m,1);release.push({seconds:i+1,chase:m.chaseLevel,band:m.bandLevel,energy:m.energy});}
 assert.ok(release[0].chase>.4,'escape cannot cut immediately');for(let i=1;i<release.length;i++)assert.ok(release[i].chase<release[i-1].chase);assert.ok(release.at(-1).chase<.035);assert.ok(release.at(-1).band>.8);
 const elapsedBefore=ctx.currentTime-m._modeSince;m.setState({paused:true});m.update();const offset=m.offset,chaseOffset=m.chaseOffset;assert.equal(ctx.live.size,0);ctx.advance(9);m.setState({paused:false});m.update();assert.ok(Math.abs((ctx.currentTime-m._modeSince)-elapsedBefore)<1e-7);assert.ok(Math.abs(m.base.offset-offset)<1e-7);assert.ok(Math.abs(m.chaseBases[0].offset-chaseOffset)<1e-6);
 ctx.advance(25);const scheduled=m.scheduled;m.update();assert.ok(m.scheduled-scheduled<12);assert.ok(m.maxVoices<=48);
 m.setState({mode:'drive'});advance(ctx,m,8);assert.equal(m.chaseBases.length,0);m.setGlobal({muted:true});m.update();assert.equal(ctx.live.size,0);
 const bad=new GameMusic(),badCtx=new FakeContext();badCtx.decodeAudioData=async()=>{throw new Error('codec unavailable');};assert.equal(await bad.prepare(badCtx,badCtx.destination),false);bad.update();assert.equal(badCtx.live.size,0);
 report.fixtures.music={chaseBpm:CHASE_BPM,decodes:ctx.decodes,driveHits,chaseHits,chase,search,release,maxVoices:m.maxVoices,pausedOffset:offset,decodeFailure:bad.error};
 report.checks.push('Two recorded arrangements and real percussion respond distinctly to chase/search;8bar sections stay synchronized, escape decays continuously over10s, pause freezes the release, scheduling is bounded and codec failure isolated.');
}

{
 const ctx=new FakeContext(),a=new GameAudio(),engine=MotorLab.createEngine(resolveBuild(DEFAULT_SELECTION).physics.engineOptions);a.context=ctx;a.started=true;a._build(ctx);await a.music._preparing;a._engine=engine;const nativeSteps=engine.getTiming().totalSteps;
 a.setWorldContext({listenerPosition:{x:0,z:0},listenerRight:{x:1,z:0},engineRunning:false,worldActive:true,acoustics:space({ambient:{park:0,wind:.4}})});a.setTraffic([{id:'police',x:20,z:100,siren:true}]);a.setMusic({mode:'chase',heat:1,paused:false});let maxQueued=0;
 for(let i=0;i<150;i++){a.updateWorld();maxQueued=Math.max(maxQueued,a._worldScheduled.size);ctx.advance(1/60);}assert.ok(a.world.levels.sirens>.03);assert.ok(a._engineDuck<1);assert.equal(engine.getTiming().totalSteps,nativeSteps);assert.equal(a._renderFrames,0);assert.ok(maxQueued<=6);
 a.suspend(true);a.setWorldContext({worldActive:false});a.setMusic({paused:true});a.updateWorld();assert.equal(a._worldScheduled.size,0);a.playEvent('sirenTest');for(let i=0;i<12;i++){a.updateWorld();ctx.advance(1/60);}assert.ok(a.world.levels.sirens>.04);a.playEvent('radio',{code:'check'});let previewRadioPeak=0;for(let i=0;i<30;i++){a.updateWorld();previewRadioPeak=Math.max(previewRadioPeak,a.world.levels.radio);ctx.advance(1/60);}assert.ok(previewRadioPeak>.025);assert.equal(engine.getTiming().totalSteps,nativeSteps);
 a.setMuted(true);assert.equal(ctx.live.size,0);assert.equal(a.world.radio,null);assert.equal(a.world.radioQueue.length,0);assert.equal(a._worldScheduled.size,0);
 a.setMuted(false);a.suspend(false);a.resetWorldFeedback();a.setWorldContext({worldActive:false});a.setMusic({mode:'menu',paused:true});assert.equal(a.playEvent('sirenTest'),true);for(let i=0;i<12;i++){a.updateWorld();ctx.advance(1/60);}assert.ok(a.world.levels.sirens>.04);assert.equal(a.playEvent('radio',{code:'check'}),true);previewRadioPeak=0;for(let i=0;i<30;i++){a.updateWorld();previewRadioPeak=Math.max(previewRadioPeak,a.world.levels.radio);ctx.advance(1/60);}assert.ok(previewRadioPeak>.025);assert.equal(engine.getTiming().totalSteps,nativeSteps);a.setVolume(0);assert.equal(a.nodes.worldGain.gain.value,0);a.setVolume(.48);assert.equal(a.nodes.worldGain.gain.value,.48);a.resetWorldFeedback();assert.equal(a._worldScheduled.size,0);assert.equal(a.world.events.length,0);assert.equal(a.world.radio,null);assert.equal(a.world.radioQueue.length,0);assert.equal(a.world.traffic.size,0);assert.equal(a.music.base,null);assert.equal(a.playEvent('radio',{code:'check'}),true,'restart resets radio cooldown');a.setMuted(true);assert.equal(a.playEvent('sirenTest'),false);assert.equal(a.playEvent('radio',{code:'check'}),false);
 a.setMix({sirens:2,radio:-1,reverb:NaN,ambience:Infinity});assert.equal(a.mix.sirens,1);assert.equal(a.mix.radio,0);assert.equal(a.mix.reverb,.65);assert.equal(a.mix.ambience,.65);
 report.fixtures.transport={worldFrames:a._worldFrames,playerFrames:a._renderFrames,nativeSteps,maxQueued,previews:'menu Settings and suspended-driving Settings'};report.checks.push('World sound, siren/radio previews and music run without advancing the native engine in both menu Settings and suspended-driving Settings; master/mute, independent gains, world-reset flushing and6buffer bound hold.');
}

{
 const build=resolveBuild(DEFAULT_SELECTION),p=new CarPhysics(MotorLab,build);let energy=0,frames=0;const a=new GameAudio({pcmEnabled:true,onPCM:(l,r)=>{for(let i=0;i<l.length;i++)energy+=(l[i]**2+r[i]**2)*.5;frames+=l.length;}});a.setBuild(build);a.setMix({environment:0,mechanical:0,tyres:0,reverb:.65});a._worldIndependent=true;a.setWorldContext({acoustics:space()});p.setEngineAdvance((engine,dt)=>a.advanceEngine(engine,dt));
 for(let i=0;i<240;i++){a.update(p.state);p.update(1/120,{transmission:'auto',throttle:1});}energy=0;frames=0;for(let i=0;i<120;i++){a.update(p.state);p.update(1/120,{transmission:'auto',throttle:1});}
 const engineRms=Math.sqrt(energy/frames),siren=report.fixtures.sirens.distances.find(v=>v.distance===100).rms,ratio=siren/engineRms;assert.ok(ratio>.3,'100m siren must have meaningful level relative to native full-load player mix');
 report.fixtures.nativeMix={engineRms,sirenAt100mRms:siren,monoSirenToStereoEngineRatio:ratio,limitation:'Signal-level proxy before final music/limiter; no loudspeaker or perceptual masking claim.'};report.checks.push('100m siren PCM has measurable headroom relative to actual full-load native-engine output; player native-clock regression is run separately at each120Hz step.');
}

{
 const assets=JSON.parse(fs.readFileSync(new URL('./audio-v7-assets.json',import.meta.url),'utf8')),pcm16=channels=>{const buffer=Buffer.alloc(channels[0].length*channels.length*2);for(let i=0;i<channels[0].length;i++)for(let c=0;c<channels.length;c++)buffer.writeInt16LE(Math.round(channels[c][i]*32768),(i*channels.length+c)*2);return buffer;};
 for(const item of assets.radio){const s=RADIO_KIT[item.key];assert.equal(s.data.length,item.frames);assert.equal(createHash('sha256').update(pcm16([s.data])).digest('hex'),item.pcmSha256);}
 for(const item of assets.ambience){const s=AMBIENT_KIT[item.key];assert.equal(s.left.length,item.frames);assert.equal(createHash('sha256').update(pcm16([s.left,s.right])).digest('hex'),item.pcmSha256);}
 const mp3=Buffer.from(CHASE_DATA,'base64');assert.equal(createHash('sha256').update(mp3).digest('hex'),assets.chase.adaptedMp3Sha256);
 const decodeInput=new URL('./audio-v7-decode-input.tmp.mp3',import.meta.url),decodeOutput=new URL('./audio-v7-decode-output.tmp.f32',import.meta.url);fs.writeFileSync(decodeInput,mp3);let pcm;
 try{const decoded=spawnSync('ffmpeg',['-v','error','-nostdin','-y','-i',decodeInput.pathname,'-f','f32le','-acodec','pcm_f32le','-ac','2','-ar','24000',decodeOutput.pathname],{timeout:15000});assert.equal(decoded.status,0,decoded.error?.message||decoded.stderr?.toString());pcm=fs.readFileSync(decodeOutput);}finally{for(const file of [decodeInput,decodeOutput])fs.rmSync(file,{force:true});}
 const decodedData=new Float32Array(pcm.buffer,pcm.byteOffset,pcm.byteLength/4),musicMetrics=metrics(decodedData);assert.ok(musicMetrics.rms>.08&&musicMetrics.peak<=1);assert.ok(decodedData.length/(24000*2)>32.5);
 const credits=fs.readFileSync(new URL('../dist/audio/ATTRIBUTION.txt',import.meta.url),'utf8');for(const author of ['bertsz','bluelinevibes','ciaranm758','synth2','RyanKingArt'])assert.ok(credits.includes(author));
 for(const name of ['audio.js','music.js','audio/world.js','audio/acoustics.js','audio/radio-kit.js','audio/ambient-kit.js','audio/chase-track.js'])assert.ok(!/\bfetch\s*\(|createOscillator\s*\(/.test(fs.readFileSync(new URL('../dist/'+name,import.meta.url),'utf8')));
 report.fixtures.assets={radio:assets.radio.length,ambience:assets.ambience.length,chaseBytes:mp3.length,chaseDecodedSeconds:decodedData.length/(24000*2),chase:musicMetrics,offline:true};report.checks.push('Embedded CC0 asset hashes, stereo channels and rates are verified; actual pursuit MP3 decodes, attribution is complete and no runtime network or oscillator nodes are used.');
}

{
 const ctx=new FakeContext(),m=new GameMusic();await m.prepare(ctx,ctx.destination);m.setState({mode:'drive',speed:28,intensity:.5});advance(ctx,m,2);const normal=m.masterLevel,base=m.base;
 m.setFocus({reading:true,paused:false,hidden:false});const beforeHits=m.scheduled;advance(ctx,m,2);assert.strictEqual(m.base,base);assert.ok(m.masterLevel<normal*.3);assert.equal(m.focusFilter.frequency.value,1800);assert.equal(m.scheduled,beforeHits);
 m.setFocus({reading:false});m.setState({mode:'chase',intensity:1,heat:1,proximity:1});advance(ctx,m,4);const chase=m.masterLevel;assert.ok(chase>normal*1.25);m.setState({mode:'escape'});advance(ctx,m,1);
 const elapsed=ctx.currentTime-m._modeSince,energy=m.energy,chaseLevel=m.chaseLevel;m.setFocus({paused:true});m.setState({paused:true});const hits=m.scheduled;advance(ctx,m,9);assert.ok(ctx.live.size>0,'Pause keeps filtered bed');assert.equal(m.energy,energy);assert.equal(m.chaseLevel,chaseLevel);assert.equal(m.scheduled,hits);m.setState({paused:false});m.setFocus({paused:false});assert.ok(Math.abs(ctx.currentTime-m._modeSince-elapsed)<1e-7);
 m.setFocus({hidden:true,backgroundMusic:false});assert.equal(m.gain.gain.value,0);assert.ok(m._silenceTimer!==null);ctx.advance(.31);await new Promise(resolve=>setTimeout(resolve,310));assert.equal(ctx.live.size,0,'Hidden default stops loops without another animation frame');assert.equal(m.base,null);assert.equal(m._silenceTimer,null);
 m.setFocus({hidden:false});assert.ok(m.base);for(let i=0;i<8;i++){m.setFocus({hidden:true});m.setFocus({hidden:false});}assert.equal(m._silenceTimer,null);assert.equal([...ctx.live].filter(v=>v.loop).length,3,'One band plus two pursuit sections after focus flaps');
 m.setFocus({hidden:true,backgroundMusic:true});const bgHits=m.scheduled;assert.ok(m.base);assert.equal(m.focusGain,.18);assert.equal(m.focusFilter.frequency.value,1200);assert.equal(m._silenceTimer,null);advance(ctx,m,4);assert.equal(m.scheduled,bgHits);assert.ok(m.masterLevel<normal*.25);m.setGlobal({muted:true});m.update();assert.equal(ctx.live.size,0);m.reset();
 report.fixtures.focus={normalMaster:normal,chaseMaster:chase,readingGain:.28,backgroundGain:.18,readingCutoffHz:1800,backgroundCutoffHz:1200,hiddenStopsWithoutFrames:true,liveLoopBound:3};report.checks.push('Focus API ducks and filters reading/pause without replaying music, freezes pursuit release, stops hidden playback without animation frames, and allows bounded quiet background playback; mute always wins.');
}
{
 const ctx=new FakeContext(),a=new GameAudio();a.context=ctx;a.started=true;a._build(ctx);await a.music._preparing;a.setFocusState({hidden:false,paused:false});a.setWorldContext({worldActive:false});a.setMusic({mode:'menu'});a.playEvent('sirenTest');a.tick('ui');a.updateWorld();assert.ok(a._worldScheduled.size>0);assert.ok(a._uiScheduled.size>0);const ui=a._eventCount.ui;
 a.setFocusState({hidden:true,backgroundMusic:true});assert.equal(a._worldScheduled.size,0);assert.equal(a._uiScheduled.size,0);assert.equal(a.world.events.length,0);a.tick('ui');a.impact(1);assert.equal(a._eventCount.ui,ui);assert.equal(a.playEvent('nearMiss'),false);a.updateWorld();assert.equal(a._worldScheduled.size,0);assert.equal(a.nodes.worldGain.gain.value,0);a.setFocusState({hidden:false});assert.equal(a.playEvent('nearMiss'),true);a.updateWorld();assert.ok(a._worldScheduled.size>0);a.setMuted(true);
 report.checks.push('Hidden focus immediately flushes engine/UI/world queues and rejects previews and rewards while optional background music remains independent; visibility restores normal event playback.');
}
{
 const samples={};for(const type of ['nearMiss','objective','reward','purchase','delivery','waypoint']){const w=new SpatialWorldAudio();w.setContext({worldActive:false});assert.equal(w.playEvent(type,{intensity:1}),true,type);const out=render(w,.8,{active:false,mix:{reverb:0}});assert.ok(out.levels.worldEvents>.0001,type+' audible PCM');assert.ok(out.peak<1);samples[type]={rms:out.levels.worldEvents,peak:out.peak};for(let n=0;n<100;n++)w.playEvent(type,{intensity:1});assert.ok(w.events.length<=32);}
 report.fixtures.feedback=samples;report.checks.push('Near miss, objective, reward, purchase, delivery and waypoint cues use existing recorded kit samples, produce finite nonzero PCM, and preserve bounded event queues.');
}
{
 const asset=JSON.parse(fs.readFileSync(new URL('./audio-v8-assets.json',import.meta.url),'utf8')).cruising,mp3=Buffer.from(MUSIC_DATA,'base64');assert.equal(createHash('sha256').update(mp3).digest('hex'),asset.adaptedMp3Sha256);assert.equal(mp3.length,asset.adaptedBytes);assert.equal(MUSIC_BPM,100);assert.equal(MUSIC_BARS,56);
 const input=new URL('./audio-v8-rock.tmp.mp3',import.meta.url),output=new URL('./audio-v8-rock.tmp.f32',import.meta.url);fs.writeFileSync(input,mp3);let pcm;try{const decoded=spawnSync('ffmpeg',['-v','error','-nostdin','-y','-i',input.pathname,'-f','f32le','-acodec','pcm_f32le','-ac','2','-ar','24000',output.pathname],{timeout:15000});assert.equal(decoded.status,0,decoded.error?.message||decoded.stderr?.toString());pcm=fs.readFileSync(output);}finally{for(const file of[input,output])fs.rmSync(file,{force:true});}
 const data=new Float32Array(pcm.buffer,pcm.byteOffset,pcm.byteLength/4),out=metrics(data),seconds=data.length/48000;assert.ok(Math.abs(seconds-134.4)<.03);assert.ok(out.rms>.05&&out.peak<1);const credits=fs.readFileSync(new URL('../dist/audio/ATTRIBUTION.txt',import.meta.url),'utf8');assert.ok(credits.includes('Umplix')&&credits.includes(asset.page));
 report.fixtures.rock={...asset,decodedSeconds:seconds,...out};report.checks.push('The complete licensed Umplix rock arrangement is embedded offline, hashed and decoded as 134.4 seconds of finite stereo PCM with measured headroom and credited provenance.');
}


{
 const w=new SpatialWorldAudio();w.setContext({listenerPosition:{x:0,z:0},listenerRight:{x:1,z:0},engineRunning:false});const source={id:'remote',x:8,z:15,rpm:2100,throttle:.7,engineRunning:true};w.setSources([source]);assert.ok(render(w,.3,{mix:{environment:1,reverb:0}}).levels.traffic>.01);w.setSources([{...source,rpm:0,engineRunning:false,horn:true,siren:true}],.3);render(w,.7,{mix:{environment:1,sirens:1,reverb:0}});const stopped=render(w,.3,{mix:{environment:1,sirens:1,reverb:0}});assert.equal(w.voices[0].targetGain,0);assert.ok(stopped.levels.traffic<1e-8);assert.ok(stopped.levels.horns>.01&&stopped.levels.sirens>.03);report.fixtures.stoppedRemote=stopped.levels;report.checks.push('A remote or NPC engine marked stopped decays to silence while its independent horn and siren remain audible.');
}

report.status='passed';fs.writeFileSync(new URL('./audio-v8-results.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
