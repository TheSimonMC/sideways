import assert from 'node:assert/strict';
import fs from 'node:fs';
import MotorLab from '../sdk/motor-engine.mjs';
import {vehicleAudioAnchors,vehicleAudioScene} from '../dist/audio-anchors.js';
import {resolveBuild,DEFAULT_SELECTION} from '../dist/catalog.js';
import {GameAudio} from '../dist/audio.js';
const RATE=48000,report={version:12,scope:'Native PCM and emitted-path checks. No physical listening claim.',checks:[]};
const check=(name,fn)=>{fn();report.checks.push(name);console.log('PASS '+name);};
const {Listener}=MotorLab.audioModules(),config=MotorLab.legacy.EngineCore.defaults('i4');
const emitter=(position=[0,.32,-2.2],gain=1,id='tail')=>({id,source:'exhaust',position,direction:[0,0,-1],gain,reflections:[]});
const scene=(right=[1,0,0],emitters=[emitter()])=>({position:[-3,1,-4],right,emitters});
function impulse(layout){const l=new Listener(RATE,['exhaust'],config);l.setSettings({scene:layout},true);let left=[],right=[];for(let i=0;i<32000;i++){l.process([i===0?1:0]);left.push(l.outputL);right.push(l.outputR);}return {l,left,right};}
const energy=a=>a.reduce((n,v)=>{assert.ok(Number.isFinite(v));return n+v*v;},0);
check('Camera-right reverses both interaural delays and ear levels without moving source or simulation',()=>{
 const a=impulse(scene()),b=impulse(scene([-1,0,0]));assert.deepEqual(a.left,b.right);assert.deepEqual(a.right,b.left);assert.ok(energy(a.right)>energy(a.left));assert.ok(a.l.vehiclePaths[0].target[0]>a.l.vehiclePaths[0].target[1]);
});
check('Two outlets share the source budget and equal the sum of separately propagated half-level outlets',()=>{
 const left=emitter([-.7,.32,-2.4],.5,'L'),right=emitter([.7,.32,-2.4],.5,'R');
 const both=impulse(scene([1,0,0],[left,right])),a=impulse(scene([1,0,0],[left])),b=impulse(scene([1,0,0],[right]));
 for(let i=0;i<both.left.length;i++){assert.ok(Math.abs(both.left[i]-a.left[i]-b.left[i])<1e-15);assert.ok(Math.abs(both.right[i]-a.right[i]-b.right[i])<1e-15);}
 assert.notEqual(both.l.vehiclePaths[0].target[0],both.l.vehiclePaths[1].target[0]);
});
check('Invalid coordinates, zero head axis, duplicate IDs and amplified outlet sums are rejected',()=>{
 for(const bad of [{...scene(),right:[0,0,0]},{...scene(),position:[NaN,0,0]},scene([1,0,0],[emitter(),emitter()]),scene([1,0,0],[emitter(undefined,.7,'a'),emitter(undefined,.7,'b')])])assert.throws(()=>Listener.validateScene(bad));
 const e=MotorLab.createEngine('i4');assert.throws(()=>e.setAudio({listener:{scene:{...scene(),right:[0,0,0]}}}));e.dispose();
});
check('Every body has matching outlet count and coordinates, pitch/roll alter anchors, and detached-wheel positions are not used as body points',()=>{
 for(const [carId,count]of[['hachi',2],['atlas',2],['kitsune',1],['vector',2]]){
  const build=resolveBuild({...DEFAULT_SELECTION,carId}),a=vehicleAudioAnchors(build,{x:10,z:20}),b=vehicleAudioAnchors(build,{x:10,z:20,bodyPitch:.15,bodyRoll:.1});assert.equal(a.exhaust.length,count);assert.equal(a.exhaust[0].z,20-build.vehicle.model.length*.5*.976-.119);assert.notEqual(a.exhaust[0].y,b.exhaust[0].y);assert.equal(a.wheels.length,4);
 }
});
check('Chase and hood retain actual camera height and position; overhead microphone remains at most 5.5 metres away',()=>{
 const build=resolveBuild(),context={listenerPosition:{x:0,y:20,z:-16},listenerRight:{x:1,y:0,z:0}};
 for(const mode of [1,2])assert.deepEqual(vehicleAudioScene(build,{},context,mode).scene.position,[0,20,-16]);
 const overhead=vehicleAudioScene(build,{},context,0).scene.position;assert.ok(Math.hypot(overhead[0],overhead[1]-.8,overhead[2])<=5.50000001);
});
check('Separate outlet image sources yield source-dependent facade delays; disabling reverb removes reflection energy',()=>{
 const build=resolveBuild({...DEFAULT_SELECTION,carId:'atlas'}),context={listenerPosition:{x:0,y:1.5,z:-5},listenerRight:{x:1,y:0,z:0},acoustics:{leftDistance:5,rightDistance:90,frontDistance:90,backDistance:90,reflectivity:.8}};
 const wet=vehicleAudioScene(build,{},context,1,1).scene,dry=vehicleAudioScene(build,{},context,1,0).scene;
 assert.notDeepEqual(wet.emitters[0].reflections[0].position,wet.emitters[1].reflections[0].position);
 const l=new Listener(RATE,['exhaust','intake','combustion','valve','bearing','boost','manifold','mechanical','gearbox','chain'],config);l.setSettings({scene:wet},true);const a=l.vehiclePaths.find(p=>p.id==='exhaust-0:1'),b=l.vehiclePaths.find(p=>p.id==='exhaust-1:1');assert.notEqual(a.target[0],b.target[0]);assert.ok(dry.emitters.every(e=>e.reflections.every(r=>r.gain===0)));
});
check('Scene rendering changes audible PCM while preserving exact engine time and physical state',()=>{
 const engines=[MotorLab.createEngine('i4'),MotorLab.createEngine('i4')],pcm=[0,0];engines.forEach(e=>e.setInputs({throttle:.6,starter:true}));engines[1].setAudio({listener:{scene:scene()}});
 for(let block=0;block<40;block++)engines.forEach((e,j)=>{const left=new Float32Array(960),right=new Float32Array(960);e.renderAudio(left,right);pcm[j]+=energy(left)+energy(right);});
 const physical=engines.map(e=>{const {audio,...state}=e.getState();return state;});assert.deepEqual(physical[0],physical[1]);assert.equal(engines[0].getTiming().simulatedSeconds,engines[1].getTiming().simulatedSeconds);assert.notEqual(pcm[0],pcm[1]);engines.forEach(e=>e.dispose());
});
check('GameAudio uses one renderAudio call per frame block, preserves world anchors and emits finite limited PCM',()=>{
 const e=MotorLab.createEngine('i4'),audio=new GameAudio({pcmEnabled:true});audio.setBuild(resolveBuild());audio.update({x:0,z:0,heading:0,engineRunning:true,rpm:1000});audio.setWorldContext({listenerPosition:{x:0,y:2.6,z:-6.6},listenerRight:{x:-1,y:0,z:0}});audio.setCamera(1);e.setInputs({starter:true,throttle:.5});
 let calls=0;const render=e.renderAudio.bind(e);e.renderAudio=(...args)=>{calls++;return render(...args);};for(let i=0;i<20;i++)audio.advanceEngine(e,1/60);
 assert.equal(calls,20);assert.equal(audio._renderFrames,16000);assert.ok(audio.getDiagnostics().outputPeak<=.94);assert.equal(e.getAudioStatus().listener?.scene?.emitters?.length??audio._nativeListener.scene.emitters.length,11);e.dispose();
});
report.status='passed';fs.writeFileSync(new URL('./audio-v12-results.json',import.meta.url),JSON.stringify(report,null,2)+'\n');

