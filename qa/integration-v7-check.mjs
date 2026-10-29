import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {InputManager} from '../dist/input.js';
import {ControlsPanel} from '../dist/controls-ui.js';
import {GaragePanel} from '../dist/garage.js';
import {GameUI,paintInputPrompts} from '../dist/game-ui.js';
import {resolveBuild,PARTS,ENGINES} from '../dist/catalog.js';
import {PoseBuffer} from '../dist/presentation.js';
import * as THREE from '../dist/vendor/three.module.js';
import {disposeWorld} from '../dist/world-lifecycle.js';
import {nextFocus} from '../dist/navigation.js';
import {createEnforcement as realEnforcement} from '../dist/enforcement.js';
import {EventStub,Target,parseHTML,installDOM,flushMicrotasks} from './dom-v5-harness.mjs';

const main=fs.readFileSync(new URL('../dist/main.js',import.meta.url),'utf8'),html=fs.readFileSync(new URL('../dist/index.html',import.meta.url),'utf8');
const report={status:'pending',checks:[],verificationLimit:'Actual main.js handlers, frame, tickGameplay, speed-camera enforcement, InputManager, GameUI, ControlsPanel, GaragePanel and controller navigation in a functional DOM; physics, map/AI population, audio and renderer boundaries are tracked fixtures. Core traffic/police have separate deterministic suites. No browser layout, GPU, speaker or hardware claims.'};
const check=async(name,fn)=>{await fn();report.checks.push(name);};
const {doc,ids}=parseHTML(html);installDOM(doc);const $=id=>doc.getElementById(id);
const dynamic=new Set(Object.keys(PARTS).flatMap(key=>['garage-part-'+key,'garage-note-'+key]));
await check('All literal element IDs used by main, GameUI, garage and controls exist, with no duplicate HTML IDs',()=>{
 for(const file of ['main.js','game-ui.js','garage.js','controls-ui.js']){
  const source=fs.readFileSync(new URL('../dist/'+file,import.meta.url),'utf8');for(const match of source.matchAll(/(?:\$|byId|getElementById)\('([^']+)'\)/g))assert.ok(ids.has(match[1])||dynamic.has(match[1]),file+' missing #'+match[1]);
 }
 report.htmlIds=ids.size;
});

let pads=[],clock=0;const keyboard=new Target(),storage=new Map(),paintWaits=[],compileWaits=[],starts=[];
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const input=new InputManager({target:keyboard,document:doc,navigator:{getGamepads:()=>pads},storage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)}});
const calls={cityCreates:0,trafficResets:0,compile:0,physicsReset:0,audioSuspend:[],audioMuted:[],audioStarts:0,audioBuild:[],trafficAudio:[],worldAudio:[],preview:[],hud:[],ticks:[],feedback:[],errors:[],maps:0,worlds:[],trafficDisposals:0,policeDisposals:0,enforcementDisposals:0,trafficUpdates:[],policeUpdates:[],enforcementUpdates:[],policeCreates:[],environmentUpdates:[],cityUpdates:[],audioEvents:[],audioFeedbackResets:0,music:[],acoustics:[],cameraFlashes:[],cameraReports:[]};
const scene=new THREE.Scene();
const makeWorld=(kind,x,z)=>{
 const root=new THREE.Group();root.name={city:'NEON-DISTRICT',dock:'DOCK09',showroom:'SHOWROOM'}[kind];scene.add(root);
 const world={kind,root,name:kind==='city'?'NEON DISTRICT':'MOTOR WORKS',spawn:{x,z,heading:.7},bounds:{minX:-500,maxX:500,minZ:-500,maxZ:500},colliders:[],mapRoads:[{a:{x:-400,z:0},b:{x:400,z:0}}],
  services:kind==='city'?[{id:'fuel',name:'FUEL STOP',kind:'fuel',x,z,radius:8},{id:'garage',name:'GARAGE',kind:'garage',x:x+25,z,radius:8},{id:'police',name:'STATION',kind:'police',x:x+50,z,radius:8,spawn:{x:x+50,z,heading:0}}]:[],
  checkpoints:kind==='dock'?Array.from({length:8},(_,i)=>({x:i*10,z:i*8,heading:0})):undefined,
  speedCameras:kind==='city'?[{id:'test-camera',name:'MARKET STREET',district:'Old Town',x:218,z:330,heading:0,direction:{x:0,z:1},trigger:{x:200,z:345},laneWidth:9,limitKph:50,range:45,cooldown:12}]:[],
  flashSpeedCamera(id,strength){calls.cameraFlashes.push({id,strength});},
  getSurfaceAt:()=>({height:0,friction:1,roughness:.05,surface:'asphalt'}),getRoadInfo:()=>({progress:.5,distance:0,district:'neon',grip:1,onRoad:true}),getDistrict:()=>({id:'oldtown',name:'Old Town'}),
  update(dt,time,context){calls.cityUpdates.push({kind,dt,time,context});},
  sampleAcoustics(px,pz,heading,right){calls.acoustics.push({kind,x:px,z:pz,heading,right});return {enclosure:.75,openness:.25,reflectivity:.8,zone:'street',leftDistance:12,rightDistance:18,frontDistance:70,backDistance:80,ambient:{park:.1,traffic:.8,wind:.3}};},
  curve:{getPointAt:()=>({x:4,z:8}),getTangentAt:()=>({x:0,z:1})},getResetPose:()=>({x:12,z:32,heading:.2})};calls.worlds.push(world);return world;
};
const stage=makeWorld('showroom',0,0);
const makeTraffic=()=>({states:[],events:[],audio:[],reset(){calls.trafficResets++;this.events=[];},update(dt,player,context){calls.trafficUpdates.push({dt,player,context});},consumeEvents(){return this.events.splice(0);},render(){},getNearbyAudio(){return this.audio;},diagnostics:()=>({count:36}),setNight(){},dispose(){calls.trafficDisposals++;}});
const makePolice=(scene,world,traffic,options)=>{
 calls.policeCreates.push(options);
 return {states:[],events:[],audio:[],state:{phase:'patrol',heat:0,heatNormalized:0,officers:[],arrestProgress:0,searchProgress:0},reset(){this.events=[];this.state={phase:'patrol',heat:0,heatNormalized:0,officers:[],arrestProgress:0,searchProgress:0};},render(){},getState(){return this.state;},update(dt,player,context){calls.policeUpdates.push({dt,player,context});},consumeEvents(){return this.events.splice(0);},getNearbyAudio(){return this.audio;},setNight(){},reportCamera(event){calls.cameraReports.push(event);},dispose(){calls.policeDisposals++;}};
};
const makeEnforcement=world=>{
 const instance=realEnforcement(world),update=instance.update,dispose=instance.dispose;
 instance.update=(dt,player,context)=>{calls.enforcementUpdates.push({dt,player,context});return update(dt,player,context);};
 instance.dispose=()=>{calls.enforcementDisposals++;dispose();};return instance;
};
const active=resolveBuild(),ctx={
 document:doc,window:keyboard,Event:EventStub,console:{error:error=>calls.errors.push(error.message)},performance:{now:()=>clock},requestAnimationFrame(){},setTimeout(){},matchMedia:()=>({matches:false}),
 $,THREE,disposeWorld,nextFocus,...{clamp:(n,a,b)=>Math.max(a,Math.min(b,n))},paintInputPrompts,phase:'menu',mode:'free',selectedMode:'free',paused:false,returnToPause:false,modalName:null,transitionSerial:0,promptRevision:-1,inputPresentation:null,
 inputManager:input,activeInputConfig:input.getConfig(),controlsPanel:null,garagePanel:null,gameUI:null,activeBuild:active,padFocus:null,
 settingsTab:'drive',controlsReturn:'settings',dispatchQueue:[],dispatchTime:0,dispatchDuration:5,dispatchLast:new Map(),cameraAlertTime:0,nearMissPulse:0,acousticClock:0,acousticState:null,nearbySounds:[],enforcement:null,enforcementState:{tickets:0,nearbyCamera:null},
 settings:{lookSensitivity:1,invertLook:false,vignette:.38,shading:.6,camera:0,handling:'street',blur:.65,quality:'high',volume:.55,assists:true,telemetry:false,headlights:true,bloom:.65,timeMode:'cycle',dayMinutes:12,music:true,musicVolume:.5,build:active.selection,paints:{},audioMix:{engine:1,mechanical:.8,tyres:.55,environment:.7,drive:.65,sirens:1,radio:.85,reverb:.65,ambience:.65}},mixDefaults:{engine:1,mechanical:.8,tyres:.55,environment:.7,drive:.65,sirens:1,radio:.85,reverb:.65,ambience:.65},
 state:null,renderState:null,world:stage,traffic:null,police:null,policeState:{phase:'patrol',heat:0,officers:[]},crimeContacts:[],environment:{night:.5,setWorld(){},update(...args){calls.environmentUpdates.push(args);return {night:this.night};}},serviceTarget:null,serviceJob:null,arrestStation:null,lookYaw:0,lookPitch:0,escapeMusic:0,conditionSaveClock:0,scene,camera:new THREE.PerspectiveCamera(),renderer:{compileAsync(){calls.compile++;const pending=deferred();compileWaits.push(pending);return pending.promise;}},
 createCity(){calls.cityCreates++;return makeWorld('city',200,320);},createWorld:()=>makeWorld('dock',24,60),createShowroom:()=>makeWorld('showroom',0,0),createTraffic:makeTraffic,createPolice:makePolice,createEnforcement:makeEnforcement,nextPaint(){const pending=deferred();paintWaits.push(pending);return pending.promise;},
 physics:{state:{},update(dt,controls,grip){calls.ticks.push({...controls,dt,grip});return this.state;},setGroundSampler(){},setTune(){},setBuild(){},repair(){this.state.engineHealth=this.state.bodyHealth=1;this.state.wheelAttached=[true,true,true,true];},refuel(amount){this.state.fuelLitres=Math.min(this.state.fuelCapacity,this.state.fuelLitres+amount);},service(){this.state.boost=1;},reset(x=0,z=0,heading=0,options={}){calls.physicsReset++;this.state={x,z,heading,speed:0,forwardSpeed:0,lateralSpeed:0,vx:0,vz:0,boost:1,boosting:false,nitrousIntensity:0,fuelLitres:5,fuelCapacity:55,engineHealth:1,bodyHealth:1,wheelAttached:[true,true,true,true],groundHeight:.012,bodyHeight:.012,bodyPitch:0,bodyRoll:0,gear:options.neutral?0:1,rpm:900,wheelSpins:[0,0,0,0],wheelSteers:[0,0,0,0],suspension:Array.from({length:4},()=>({groundHeight:.012,wheelY:.352,contact:true}))};}},
 audio:{started:false,resetWorldFeedback(){calls.audioFeedbackResets++;},async start(){calls.audioStarts++;this.started=true;return true;},suspend:v=>calls.audioSuspend.push(v),setMuted:v=>calls.audioMuted.push(v),setBuild:b=>calls.audioBuild.push(b.signature),setMix(){},setVolume(){},setCamera(){},update(){},setTraffic:v=>calls.trafficAudio.push(v),tick(){},playEvent(type,payload){calls.audioEvents.push({type,payload});},setWorldContext:value=>calls.worldAudio.push(value),setMusic(value){calls.music.push(value);},updateWorld(){}},
 car:{group:{position:{set(){}},rotation:{y:0}},setBuild:b=>calls.preview.push(b.signature),setColor(){},update(){}},post:{reset(){},setCarBounds(){},render(){}},fx:{reset(){},setBuild(){},update(){}},checkpointGroup:{visible:false,position:{set(){}},rotation:{y:0},userData:{arrow:{position:{y:0}}}},
 presentation:new PoseBuffer(),cameraAnchor:{x:0,z:0},initialCamera:true,totalTime:0,runTime:0,driftRemaining:90,accumulator:0,lastNow:0,hudClock:0,
 nextCheckpoint:0,completedCheckpoints:0,lapArmed:false,comboPoints:0,comboDuration:0,comboGrace:0,score:0,offroadTimer:0,collisionCooldown:0,camShake:0,previousBoost:false,previousCountdown:4,countdownTime:0,distanceDriven:0,lastDistrict:'',discoveredDistricts:new Set(),lastRoad:null,menuOrbit:0,toastTimer:0,comicTimer:0,frames:0,fpsAccum:0,renderFps:60,
 frameControls:{},pendingShiftUp:false,pendingShiftDown:false,pendingNeutral:false,muted:false,isTouch:false,ui:{combo:$('combo')},
 persist(){},resize(){},drawFullMap(){calls.maps++;},updateCamera(){},updateBodyGroundMask(){},drawSpeedFX(){},updateHUD(){calls.hud.push({phase:ctx.phase,mode:ctx.mode,world:ctx.world.kind});if(ctx.mode==='sprint')assert.ok(ctx.world.checkpoints,'Sprint HUD must only read dock checkpoints');},comic(){},resolveCollisions(){},bankCombo(){ctx.comboPoints=0;},finishRun(){}
};
ctx.physics.reset(stage.spawn.x,stage.spawn.z,stage.spawn.heading);ctx.state=ctx.physics.state;ctx.renderState=ctx.presentation.reset(ctx.state);ctx.lastRoad=stage.getRoadInfo();
vm.createContext(ctx);
function loadFunction(name){
 const re=new RegExp('(?:^|\\n)(?:async )?function '+name+'\\('),match=re.exec(main);assert.ok(match,'Missing real function '+name);const start=match.index+(match[0].startsWith('\n')?1:0),tail=main.slice(start);const next=/\n(?:(?:async )?function |\/\/ Read-only diagnostics)/.exec(tail);vm.runInContext(next?tail.slice(0,next.index):tail,ctx,{filename:'main.js:'+name});
}
for(const name of ['syncSettings','syncV6Settings','syncV7Settings','selectSettingsTab','openSettings','queueDispatch','updateDispatch','handleCityEvent','syncAudioSettings','resetPresentation','previewBuild','applyBuild','openGarage','visualState','updateInputPrompts','selectMode','showDialog','hideDialog','resetWorldFeedback','selectWorld','setupUI','clearInputs','setTransmission','requestShift','focusableControls','focusControl','focusDefault','moveFocus','adjustFocused','chooseMode','processInputActions','cycleCamera','toggleSound','toast','openModal','closeModal','setPaused','showMenu','startGame','resetCar','updateCheckpoint','inputState','tickGameplay','toggleLights','nearestService','interact','updateServiceUI','startService','updateServiceJob','handlePoliceEvent','releaseFromStation','recoverVehicle','drawMapOn','frame'])loadFunction(name);
ctx.controlsPanel=new ControlsPanel(input,{onChanged:()=>{ctx.activeInputConfig=input.getConfig();ctx.syncSettings();}});
ctx.garagePanel=new GaragePanel({onPreview:ctx.previewBuild,onCancel:ctx.previewBuild,onApply:ctx.applyBuild});ctx.gameUI=new GameUI(doc);ctx.setupUI();ctx.syncSettings();ctx.gameUI.finishLoading();ctx.focusDefault();
const realStart=ctx.startGame;ctx.startGame=(...args)=>{const promise=realStart(...args);starts.push(promise);return promise;};
const realFeedback=input.updateFeedback.bind(input);input.updateFeedback=(state,dt,options)=>{calls.feedback.push({...options});return realFeedback(state,dt,options);};
const frame=(dt=1/60)=>{clock+=dt*1000;ctx.frame(clock);};
const frames=(n=1,dt=1/60)=>{for(let i=0;i<n;i++)frame(dt);};
const advancePaint=async()=>{const pending=paintWaits.shift();assert.ok(pending,'Expected nextPaint wait');pending.resolve();await flushMicrotasks();};
const advanceCompile=async(error)=>{const pending=compileWaits.shift();assert.ok(pending,'Expected compileAsync wait');error?pending.reject(error):pending.resolve();await flushMicrotasks();};
const finishStart=async promise=>{await advancePaint();await advancePaint();await advanceCompile();await promise;};
const key=(code,down)=>keyboard.emit(down?'keydown':'keyup',{code,target:doc.activeElement});
const tapKey=code=>{key(code,true);frame();key(code,false);frame();};
const button=(pad,index,value)=>{pad.buttons[index]={value,pressed:value>.5};};
const pad={id:'Xbox Controller',index:0,mapping:'standard',connected:true,axes:[0,0,0,0],buttons:Array.from({length:18},()=>({value:0,pressed:false}))};
const tapButton=index=>{button(pad,index,1);frame();button(pad,index,0);frame();};

await check('The first successful sound-button click enables audio; later clicks mute and unmute with matching labels, while a failed start leaves audio off',async()=>{
 assert.equal(ctx.audio.started,false);assert.equal(ctx.muted,false);assert.equal($('sound-button').getAttribute('aria-label'),'Enable audio');
 const start=ctx.audio.start;ctx.audio.start=async()=>false;$('sound-button').click();await flushMicrotasks();assert.equal(ctx.audio.started,false);assert.equal(ctx.muted,false);assert.equal($('toast').textContent,'AUDIO COULD NOT START');assert.equal($('sound-button').getAttribute('aria-label'),'Enable audio');ctx.audio.start=start;
 $('sound-button').click();await flushMicrotasks();assert.equal(ctx.audio.started,true);assert.equal(ctx.muted,false);assert.equal(calls.audioMuted.at(-1),false);assert.equal($('sound-button').getAttribute('aria-label'),'Mute audio');assert.equal($('sound-button').classList.contains('muted'),false);assert.equal($('toast').textContent,'SOUND ON');
 $('sound-button').click();await flushMicrotasks();assert.equal(ctx.muted,true);assert.equal(calls.audioMuted.at(-1),true);assert.equal($('sound-button').getAttribute('aria-label'),'Enable audio');assert.equal($('sound-button').classList.contains('muted'),true);assert.equal($('toast').textContent,'SOUND OFF');ctx.syncSettings();assert.equal($('sound-button').getAttribute('aria-label'),'Enable audio');
 $('sound-button').click();await flushMicrotasks();assert.equal(ctx.muted,false);assert.equal(calls.audioMuted.at(-1),false);assert.equal($('sound-button').getAttribute('aria-label'),'Mute audio');assert.equal($('toast').textContent,'SOUND ON');ctx.syncSettings();assert.equal($('sound-button').getAttribute('aria-label'),'Mute audio');
});

await check('Actual controller focus skips hidden native selects and arrows; visible choices, checkboxes and sliders operate through real handlers',()=>{
 ctx.openModal('settings');assert.equal(doc.activeElement.dataset.selectId,'camera-select');const choices=ctx.focusableControls();assert.ok(choices.includes(doc.activeElement));assert.ok(choices.every(el=>!el.classList.contains('native-choice')&&el.tabIndex!==-1));assert.ok(!choices.includes($('audio-engine')));
 ctx.processInputActions(['menuRight']);assert.equal(ctx.settings.camera,1);assert.equal(doc.activeElement.textContent,'Chase');ctx.processInputActions(['confirm']);assert.equal(ctx.settings.camera,2);assert.equal(doc.activeElement.textContent,'Hood');ctx.processInputActions(['menuLeft']);assert.equal(ctx.settings.camera,1);
 ctx.focusControl($('assists-toggle'));const before=ctx.settings.assists;ctx.processInputActions(['confirm']);assert.equal(ctx.settings.assists,!before);ctx.processInputActions(['confirm']);assert.equal(ctx.settings.assists,before);
 ctx.selectSettingsTab('audio',true);$('audio-mix-toggle').click();assert.ok(ctx.focusableControls().includes($('audio-engine')));ctx.focusControl($('audio-drive'));ctx.processInputActions(['menuRight']);assert.equal(ctx.settings.audioMix.drive,.7);assert.equal($('audio-drive-value').textContent,'70%');ctx.closeModal();
});
await check('Garage uses real dynamic engine and part choices; preview is cancelled and installation updates the active build',()=>{
 ctx.openGarage();assert.equal(doc.activeElement.dataset.selectId,'garage-engine');const before=ctx.activeBuild.signature;ctx.processInputActions(['menuRight']);assert.notEqual(ctx.garagePanel.draft.signature,before);assert.equal(ctx.activeBuild.signature,before);assert.equal(doc.activeElement.textContent,ctx.garagePanel.draft.engine.name);
 for(const key of Object.keys(PARTS))assert.ok(ctx.gameUI.control($('garage-part-'+key)).classList.contains('choice-value'));
 const nonturbo=ENGINES.find(e=>!e.turbo);ctx.garagePanel.change({engineId:nonturbo.id});assert.equal(ctx.gameUI.control($('garage-part-turbo')).disabled,true);assert.ok(!ctx.focusableControls().includes(ctx.gameUI.control($('garage-part-turbo'))));ctx.closeModal();assert.equal(ctx.activeBuild.signature,before);assert.equal(calls.preview.at(-1),before);
 ctx.openGarage();ctx.garagePanel.change({engineId:'rotary'});const chosen=ctx.garagePanel.draft;ctx.focusControl($('garage-apply'));ctx.processInputActions(['confirm']);assert.equal(ctx.activeBuild.signature,chosen.signature);assert.equal(ctx.phase,'menu');assert.equal(ctx.garagePanel.open,false);assert.equal(calls.audioBuild.at(-1),chosen.signature);
});
await check('Starting free roam waits for both visible loading frames and compilation, then activates only the city and traffic',async()=>{
 const start=ctx.startGame('free');assert.equal(ctx.phase,'loading');assert.equal(ctx.paused,true);assert.equal($('loading').classList.contains('hidden'),false);assert.equal($('hud').classList.contains('hidden'),true);frame();assert.equal(calls.feedback.at(-1).active,false);
 await advancePaint();assert.equal(ctx.world.kind,'city');assert.equal(calls.cityCreates,1);assert.equal(calls.trafficResets,1);assert.equal(stage.disposed,true);assert.equal(stage.root.parent,null);assert.equal(scene.children.length,1);assert.equal(scene.children[0],ctx.world.root);assert.equal(ctx.phase,'loading');await advancePaint();assert.equal(ctx.phase,'loading');await advanceCompile();await start;
 assert.equal(ctx.phase,'playing');assert.equal(ctx.paused,false);assert.equal($('loading').classList.contains('hidden'),true);assert.equal($('hud').classList.contains('hidden'),false);assert.equal(doc.activeElement,$('game'));assert.equal(ctx.renderState.x,200);frame();assert.equal(calls.feedback.at(-1).active,true);assert.equal($('mode-label').textContent,'CITY FREE ROAM');
});
await check('Escape during driving goes directly to the main menu; P/Start pause, controller B resumes, and Escape from pause opens main menu',async()=>{
 tapKey('Escape');assert.equal(ctx.phase,'menu');assert.equal(ctx.world.kind,'showroom');assert.equal(ctx.modalName,null);assert.equal(calls.audioSuspend.at(-1),true);assert.equal(calls.feedback.at(-1).active,false);
 await finishStart(ctx.startGame('free'));frames(2);tapKey('KeyP');assert.equal(ctx.modalName,'pause');assert.equal(ctx.paused,true);assert.equal(doc.activeElement,$('resume-button'));
 pads=[pad];frames(8);tapButton(1);assert.equal(ctx.paused,false);assert.equal(ctx.modalName,null);tapButton(9);assert.equal(ctx.paused,true);tapKey('Escape');assert.equal(ctx.phase,'menu');assert.equal(ctx.paused,false);assert.equal(ctx.modalName,null);
});
await check('Nested controls back preserves pause and Escape while learning cancels both capture and panel state before leaving the nested screen',async()=>{
 await finishStart(ctx.startGame('free'));frames(2);tapKey('KeyP');ctx.openModal('settings');ctx.openModal('controls');ctx.controlsPanel.selectTab('bindings');ctx.controlsPanel.startBinding('camera');assert.ok(ctx.controlsPanel.learning);assert.equal(input.snapshot().learn.active,true);
 tapKey('Escape');assert.equal(ctx.modalName,'controls');assert.equal(ctx.controlsPanel.learning,null);assert.equal(ctx.controlsPanel.wizard,null);assert.equal(input.snapshot().learn.active,false);assert.equal($('cancel-binding').classList.contains('hidden'),true);assert.match($('control-message').textContent,/cancelled/i);
 ctx.controlsPanel.selectTab('calibrate');ctx.controlsPanel.startCalibration('throttle');assert.ok(ctx.controlsPanel.wizard);tapKey('Escape');assert.equal(ctx.modalName,'controls');assert.equal(ctx.controlsPanel.learning,null);assert.equal(ctx.controlsPanel.wizard,null);assert.equal($('calibration-wizard').classList.contains('hidden'),true);
 tapKey('Escape');assert.equal(ctx.modalName,'settings');assert.equal(ctx.paused,true);tapKey('Escape');assert.equal(ctx.modalName,'pause');assert.equal(ctx.paused,true);tapKey('Escape');assert.equal(ctx.phase,'menu');
});
await check('Loading can be cancelled before world creation, after world selection and during compile; stale completion never reopens a cancelled run',async()=>{
 const before=ctx.startGame('free');frame();tapKey('Escape');assert.equal(ctx.phase,'menu');await advancePaint();await before;assert.equal(ctx.phase,'menu');assert.equal(compileWaits.length,0);
 const middle=ctx.startGame('free');await advancePaint();assert.equal(ctx.world.kind,'city');frame();tapButton(1);assert.equal(ctx.phase,'menu');assert.equal(ctx.world.kind,'showroom');await advancePaint();await middle;assert.equal(ctx.phase,'menu');assert.equal(compileWaits.length,0);
 const old=ctx.startGame('free');await advancePaint();await advancePaint();const oldCompile=compileWaits.shift();assert.ok(oldCompile);frame();tapKey('Escape');assert.equal(ctx.phase,'menu');const current=ctx.startGame('sprint');await advancePaint();await advancePaint();oldCompile.resolve();await old;assert.equal(ctx.phase,'loading');assert.equal(ctx.mode,'sprint');await advanceCompile();await current;assert.equal(ctx.phase,'countdown');assert.equal(ctx.world.kind,'dock');assert.equal(scene.children.length,1);assert.ok(calls.worlds.filter(w=>w.kind==='city').every(w=>w.disposed));
});
await check('Countdown Escape returns home; city to sprint loading never draws the sprint HUD against the old city; load errors recover to the menu',async()=>{
 frame();tapKey('Escape');assert.equal(ctx.phase,'menu');await finishStart(ctx.startGame('free'));frames(2);const hudBefore=calls.hud.length;const race=ctx.startGame('sprint');assert.equal(ctx.world.kind,'city');assert.equal(ctx.mode,'sprint');frames(10);assert.equal(calls.hud.length,hudBefore,'HUD must not update during loading');await finishStart(race);assert.equal(ctx.phase,'countdown');
 ctx.showMenu();const fail=ctx.startGame('free');await advancePaint();await advancePaint();await advanceCompile(new Error('Controlled compile failure'));await fail;assert.equal(ctx.phase,'menu');assert.equal(ctx.world.kind,'showroom');assert.match($('toast').textContent,/Controlled compile failure/);assert.equal($('loading').classList.contains('hidden'),true);assert.equal(calls.errors.at(-1),'Controlled compile failure');
});
await check('Held menu confirm/back/starter never leak into NOS, handbrake or starter after actual loading/resume; RT remains a driving pedal only',async()=>{
 frames(2);ctx.focusDefault();button(pad,0,1);frame();assert.equal(ctx.phase,'loading');await finishStart(starts.at(-1));frames(4);assert.equal(ctx.frameControls.boost,false);button(pad,0,0);frame();button(pad,0,1);frame();assert.equal(ctx.frameControls.boost,true);button(pad,0,0);frame();
 tapButton(9);assert.equal(ctx.paused,true);button(pad,1,1);frame();assert.equal(ctx.paused,false);frames(3);assert.equal(ctx.frameControls.handbrake,0);button(pad,1,0);frame();button(pad,1,1);frame();assert.equal(ctx.frameControls.handbrake,1);button(pad,1,0);frame();
 tapButton(9);button(pad,12,1);frame();ctx.focusControl($('resume-button'));button(pad,0,1);frame();assert.equal(ctx.paused,false);frames(3);assert.equal(ctx.frameControls.starter,false);button(pad,12,0);button(pad,0,0);frame();
 tapButton(9);const focus=doc.activeElement;button(pad,7,1);frames(40);assert.equal(doc.activeElement,focus);assert.equal(ctx.frameControls.throttle,0);button(pad,7,0);frame();tapButton(1);
});
await check('Real frame updates prompt glyphs for the last active device and keyboard fallback; pause, blur and hidden document disable feedback',()=>{
 tapButton(3);assert.equal($('camera-button').querySelector('[data-prompt]').textContent,'Y');assert.equal(doc.body.dataset.inputKind,'xbox');tapKey('KeyW');assert.equal(doc.body.dataset.inputKind,'keyboard');assert.equal($('camera-button').querySelector('[data-prompt]').textContent,'C');
 button(pad,7,1);frame();button(pad,7,0);frame();assert.equal(doc.body.dataset.inputKind,'xbox');keyboard.emit('blur');frame();assert.equal(ctx.paused,true);assert.equal(calls.feedback.at(-1).active,false);tapButton(1);frame();assert.equal(ctx.paused,false);doc.hidden=true;doc.emit('visibilitychange');frame();assert.equal(ctx.paused,true);assert.equal(calls.feedback.at(-1).active,false);doc.hidden=false;doc.emit('visibilitychange');tapKey('Escape');assert.equal(ctx.phase,'menu');
});
await check('Quick wheel calibration leaves a visible focus target in the calibration tab',()=>{
 ctx.controlsPanel.selectTab('devices');$('quick-calibrate').classList.remove('hidden');$('quick-calibrate').click();assert.equal(ctx.modalName,'controls');assert.equal(ctx.controlsPanel.tab,'calibrate');assert.ok(doc.activeElement?.offsetParent!==null,'Quick calibration focus must not remain in the now hidden devices tab');assert.ok(ctx.focusableControls().includes(doc.activeElement));ctx.closeModal();ctx.closeModal();
});

await check('The keyboard tab keeps focus visible, captures keys through its actual buttons, updates prompts and cancels capture before switching tabs or restoring defaults',()=>{
 ctx.openModal('controls');ctx.controlsPanel.selectTab('devices');ctx.focusControl(ctx.gameUI.control($('input-mode')));ctx.controlsPanel.selectTab('keyboard');assert.equal(doc.activeElement.dataset.controlsTab,'keyboard');assert.ok(ctx.focusableControls().includes(doc.activeElement));
 const horn=ctx.controlsPanel.keyRows.get('horn'),cameraRow=ctx.controlsPanel.keyRows.get('camera');ctx.focusControl(horn.button);horn.button.click();frame();button(pad,3,1);frames(8);button(pad,3,0);frame();assert.equal(input.snapshot().learn.active,true);assert.ok(ctx.controlsPanel.learning);tapKey('KeyW');frames(8);
 assert.equal(ctx.controlsPanel.learning,null);assert.equal(horn.value.textContent,'W');assert.deepEqual(input.getKeyBindings().horn,['KeyW']);assert.deepEqual(ctx.activeInputConfig.keys.horn,['KeyW']);assert.equal(ctx.controlsPanel.keyRows.get('throttle').value.textContent,'↑');assert.equal(doc.querySelector('[data-prompt="horn"]').textContent,'W');
 ctx.focusControl(cameraRow.button);cameraRow.button.click();tapKey('Escape');assert.equal(ctx.modalName,'controls');assert.equal(ctx.controlsPanel.learning,null);assert.deepEqual(input.getKeyBindings().camera,['KeyC']);assert.match($('control-message').textContent,/cancelled/i);
 cameraRow.button.click();ctx.focusControl($('cancel-keybinding'));$('cancel-keybinding').click();assert.equal(doc.activeElement,cameraRow.button);assert.ok(doc.activeElement.offsetParent!==null);assert.ok(doc.activeElement.classList.contains('pad-focus'));
 cameraRow.button.click();ctx.controlsPanel.selectTab('devices');assert.equal(input.snapshot().learn.active,false);assert.equal(ctx.controlsPanel.learning,null);assert.equal(doc.activeElement.dataset.controlsTab,'devices');assert.ok(ctx.focusableControls().includes(doc.activeElement));
 ctx.controlsPanel.selectTab('keyboard');ctx.focusControl(cameraRow.button);cameraRow.button.click();$('reset-keybinds').click();assert.equal(input.snapshot().learn.active,false);assert.equal(ctx.controlsPanel.learning,null);assert.deepEqual(input.getKeyBindings().horn,['KeyH']);assert.equal(horn.value.textContent,'H');
 ctx.focusControl(horn.row.lastElementChild);horn.row.lastElementChild.click();assert.deepEqual(input.getKeyBindings().horn,[]);assert.equal(horn.value.textContent,'UNBOUND');assert.equal(input.prompt('horn').bound,false);$('reset-keybinds').click();assert.deepEqual(input.getKeyBindings().horn,['KeyH']);
 ctx.closeModal();ctx.closeModal();ctx.openModal('controls');assert.ok(ctx.focusableControls().includes(doc.activeElement),'Reopening with Keyboard selected must focus a visible control');ctx.closeModal();ctx.closeModal();
});

await check('Actual frame routes held R3 and right-stick values without changing transmission; horn reaches audio and new lights/map/interact buttons reach their UI actions',async()=>{
 await finishStart(ctx.startGame('free'));frames(2);const transmission=ctx.activeInputConfig.transmission,cameraMode=ctx.settings.camera;button(pad,11,1);frames(12);assert.equal(ctx.frameControls.lookBack,true);assert.equal(ctx.activeInputConfig.transmission,transmission);assert.equal(ctx.settings.camera,cameraMode);button(pad,11,0);frame();assert.equal(ctx.frameControls.lookBack,false);
 pad.axes[2]=-.8;pad.axes[3]=.9;frame();assert.ok(ctx.frameControls.lookX<-.7);assert.ok(ctx.frameControls.lookY>.8);assert.equal(calls.ticks.at(-1).lookX,ctx.frameControls.lookX);pad.axes[2]=pad.axes[3]=0;frame();assert.equal(ctx.frameControls.lookX,0);assert.equal(ctx.frameControls.lookY,0);
 button(pad,14,1);frames(8);assert.equal(calls.worldAudio.at(-1).playerHorn,true);button(pad,14,0);frame();assert.equal(calls.worldAudio.at(-1).playerHorn,false);
 const lights=ctx.settings.headlights;button(pad,15,1);frames(20);assert.equal(ctx.settings.headlights,!lights);assert.equal($('headlights-toggle').checked,!lights);button(pad,15,0);frame();assert.equal(doc.querySelector('[data-prompt="lights"]').textContent,'→');
 const beforeMap=calls.maps,resets=calls.physicsReset;tapButton(8);assert.equal(ctx.modalName,'map');assert.equal(ctx.paused,true);assert.ok(calls.maps>beforeMap);assert.equal(calls.physicsReset,resets);assert.ok(ctx.focusableControls().includes(doc.activeElement));tapButton(1);assert.equal(ctx.modalName,null);assert.equal(ctx.paused,false);
 tapButton(2);assert.equal(ctx.modalName,'service');assert.equal(ctx.serviceTarget.kind,'fuel');assert.equal(doc.activeElement,$('service-fuel'));assert.equal($('service-repair').classList.contains('hidden'),true);tapButton(1);assert.equal(ctx.modalName,null);assert.equal(ctx.paused,false);tapButton(3);assert.equal(ctx.settings.camera,(cameraMode+1)%3);
});

await check('Fuel and mechanic menus run their actual service jobs while paused, can be cancelled, and restore enabled controller controls on completion',()=>{
 ctx.state.fuelLitres=20;tapButton(2);tapButton(0);assert.equal(ctx.modalName,'service');assert.equal(ctx.serviceJob.type,'fuel');assert.equal(ctx.paused,true);assert.equal($('service-fuel').disabled,true);frames(4,.05);assert.ok(ctx.state.fuelLitres>20);assert.ok(Number($('service-progress').style.getPropertyValue('--progress'))>0);tapButton(1);const cancelledFuel=ctx.state.fuelLitres;assert.equal(ctx.serviceJob,null);assert.equal(ctx.paused,false);frames(4,.05);assert.equal(ctx.state.fuelLitres,cancelledFuel);
 ctx.state.fuelLitres=54;tapButton(2);tapButton(0);frames(20,.05);assert.equal(ctx.state.fuelLitres,55);assert.equal(ctx.serviceJob,null);assert.equal(ctx.modalName,'service');assert.equal($('service-fuel').disabled,false);tapButton(1);
 ctx.state.x=225;ctx.state.z=320;ctx.state.engineHealth=.25;ctx.state.bodyHealth=.4;ctx.state.wheelAttached=[true,false,true,true];tapButton(2);assert.equal(ctx.serviceTarget.kind,'garage');assert.equal(doc.activeElement,$('service-repair'));assert.equal($('service-fuel').classList.contains('hidden'),true);tapButton(0);frames(90,.05);assert.equal(ctx.serviceJob,null);assert.equal(ctx.state.engineHealth,1);assert.equal(ctx.state.bodyHealth,1);assert.ok(ctx.state.wheelAttached.every(Boolean));
 ctx.state.boost=0;ctx.focusControl($('service-nos'));tapButton(0);assert.equal(ctx.serviceJob.type,'nitrous');frames(35,.05);assert.equal(ctx.serviceJob,null);assert.equal(ctx.state.boost,1);tapButton(1);assert.equal(ctx.paused,false);assert.equal(ctx.frameControls.boost,false);assert.equal(ctx.frameControls.handbrake,0);
});

await check('Arrest uses the actual modal/release handlers, blocks driving input, releases at the station and prevents held confirm from triggering NOS',()=>{
 const feedbackBefore=calls.audioFeedbackResets;ctx.queueDispatch({code:'old-arrest-call',message:'Stale pursuit location.'});ctx.dispatchTime=2;
 ctx.state.fuelLitres=1;ctx.state.engineHealth=.1;ctx.handlePoliceEvent({type:'arrest',station:{x:250,z:320,heading:1}});frame();assert.equal(ctx.phase,'arrested');assert.equal(ctx.paused,true);assert.equal(ctx.modalName,'arrest');assert.equal(doc.activeElement,$('release-button'));assert.equal(calls.feedback.at(-1).active,false);
 tapButton(9);assert.equal(ctx.phase,'arrested');assert.equal(ctx.paused,true);pad.axes[2]=.9;frame();assert.equal(ctx.frameControls.lookX,0);pad.axes[2]=0;
 button(pad,0,1);frame();assert.equal(ctx.phase,'playing');assert.equal(ctx.paused,false);assert.equal(ctx.modalName,null);assert.equal(ctx.state.x,250);assert.equal(ctx.state.z,320);assert.equal(ctx.state.engineHealth,1);assert.ok(ctx.state.fuelLitres>=8);assert.equal(ctx.dispatchQueue.length,0);assert.equal(ctx.dispatchTime,0);assert.equal(ctx.dispatchLast.size,0);assert.ok(calls.audioFeedbackResets>feedbackBefore);assert.equal($('dispatch-panel').classList.contains('hidden'),true);frames(4);assert.ok(!calls.audioEvents.some(e=>e.type==='radio'&&e.payload.code==='old-arrest-call'));assert.equal(ctx.frameControls.boost,false);button(pad,0,0);frame();
 ctx.handlePoliceEvent({type:'arrest',station:{x:252,z:321,heading:0}});frames(2);tapKey('Escape');assert.equal(ctx.phase,'playing');assert.equal(ctx.state.x,252);assert.equal(ctx.modalName,null);assert.equal(scene.children.length,1);
});

await check('Recovery clears pending police dispatch and feedback before opening the mechanic service menu',()=>{
 ctx.setPaused(true);const before=calls.audioFeedbackResets;ctx.queueDispatch({code:'old-recovery-call',message:'Stale unit position.'});ctx.dispatchTime=3;ctx.cameraAlertTime=4;ctx.escapeMusic=7;ctx.nearbySounds=[{id:'old-unit',siren:true}];ctx.acousticState={zone:'old-street'};$('dispatch-panel').classList.remove('hidden');
 $('recovery-button').click();assert.equal(ctx.phase,'playing');assert.equal(ctx.modalName,'service');assert.equal(ctx.paused,true);assert.equal(ctx.serviceTarget.kind,'garage');assert.equal(ctx.state.x,225);assert.equal(ctx.state.z,320);assert.equal(ctx.policeState.phase,'patrol');
 assert.equal(ctx.dispatchQueue.length,0);assert.equal(ctx.dispatchTime,0);assert.equal(ctx.dispatchLast.size,0);assert.equal(ctx.cameraAlertTime,0);assert.equal(ctx.escapeMusic,0);assert.equal(ctx.nearbySounds.length,0);assert.equal(ctx.acousticState,null);assert.ok(calls.audioFeedbackResets>before);assert.equal($('dispatch-panel').classList.contains('hidden'),true);assert.equal(calls.trafficAudio.at(-1).length,0);ctx.processInputActions(['back']);frame();assert.equal(ctx.paused,false);assert.ok(!calls.audioEvents.some(e=>e.type==='radio'&&e.payload.code==='old-recovery-call'));
});

await check('World transitions leave one map root and dispose both traffic and police when returning to the showroom',()=>{
 const trafficDisposed=calls.trafficDisposals,policeDisposed=calls.policeDisposals,oldWorld=ctx.world;ctx.showMenu();assert.equal(ctx.world.kind,'showroom');assert.equal(oldWorld.disposed,true);assert.equal(oldWorld.root.parent,null);assert.equal(calls.trafficDisposals,trafficDisposed+1);assert.equal(calls.policeDisposals,policeDisposed+1);assert.equal(scene.children.length,1);assert.equal(scene.children[0],ctx.world.root);assert.equal(ctx.traffic,null);assert.equal(ctx.police,null);
});


await check('Main-menu left and right use spatial columns; empty or unknown focus has a stable first/last fallback',()=>{
 assert.equal(nextFocus([],null,'right'),null);
 const buttons=[$('start-button'),$('garage-button'),doc.querySelector('[data-mode="free"]'),$('credits-button')];
 assert.ok(nextFocus(buttons,doc.body,'right')===buttons[0]);assert.ok(nextFocus(buttons,doc.body,'down')===buttons[0]);assert.ok(nextFocus(buttons,doc.body,'left')===buttons[3]);assert.ok(nextFocus(buttons,doc.body,'up')===buttons[3]);
 for(let i=0;i<buttons.length;i++){const left=(i%2)*220,top=Math.floor(i/2)*90;buttons[i].getBoundingClientRect=()=>({left,top,width:200,height:70,right:left+200,bottom:top+70});}
 ctx.focusControl(buttons[0]);ctx.processInputActions(['menuRight']);assert.ok(doc.activeElement===buttons[1], 'Expected focus on '+buttons[1].id+', received '+doc.activeElement?.id);ctx.processInputActions(['menuNext']);assert.ok(doc.activeElement===buttons[3], 'Expected focus on '+buttons[3].id+', received '+doc.activeElement?.id);ctx.processInputActions(['menuLeft']);assert.ok(doc.activeElement===buttons[2], 'Expected focus on '+buttons[2].id+', received '+doc.activeElement?.id);ctx.processInputActions(['menuPrev']);assert.ok(doc.activeElement===buttons[0], 'Expected focus on '+buttons[0].id+', received '+doc.activeElement?.id);
 for(const button of buttons)delete button.getBoundingClientRect;ctx.focusDefault();
});

await check('Settings tabs hide inactive controls, retain visible controller focus and expose working look, shading and individual sound controls',async()=>{
 ctx.openSettings('drive');assert.equal(ctx.settingsTab,'drive');assert.equal(doc.activeElement.dataset.selectId,'camera-select');
 const assertTab=tab=>{for(const key of ['drive','visuals','audio']){assert.equal($('settings-'+key).classList.contains('hidden'),key!==tab);assert.equal($('settings-tab-'+key).getAttribute('aria-selected'),String(key===tab));}assert.ok(ctx.focusableControls().includes(doc.activeElement));assert.ok(doc.activeElement.offsetParent!==null);};
 assertTab('drive');assert.ok(!ctx.focusableControls().includes($('volume-range')));assert.ok(!ctx.focusableControls().includes($('vignette-range')));
 ctx.focusControl($('settings-tab-drive'));ctx.processInputActions(['menuRight']);assertTab('visuals');assert.equal(doc.activeElement,$('settings-tab-visuals'));assert.ok(!ctx.focusableControls().includes(ctx.gameUI.control($('camera-select'))));
 ctx.processInputActions(['menuRight']);assertTab('audio');assert.equal(doc.activeElement,$('settings-tab-audio'));ctx.processInputActions(['menuRight']);assertTab('drive');
 ctx.focusControl($('look-sensitivity'));ctx.processInputActions(['menuRight']);assert.equal(ctx.settings.lookSensitivity,1.05);ctx.processInputActions(['menuLeft']);assert.equal(ctx.settings.lookSensitivity,1);
 ctx.focusControl($('invert-look-toggle'));ctx.processInputActions(['confirm']);assert.equal(ctx.settings.invertLook,true);ctx.processInputActions(['confirm']);assert.equal(ctx.settings.invertLook,false);
 $('settings-tab-visuals').click();assertTab('visuals');for(const [id,key] of [['vignette-range','vignette'],['shading-range','shading']]){const old=ctx.settings[key];ctx.focusControl($(id));ctx.processInputActions(['menuRight']);assert.ok(ctx.settings[key]>old);ctx.processInputActions(['menuLeft']);assert.equal(ctx.settings[key],old);}
 ctx.closeModal();ctx.openSettings('audio');assertTab('audio');assert.equal(doc.activeElement,$('volume-range'));
 if($('audio-mix').classList.contains('hidden'))$('audio-mix-toggle').click();
 for(const key of ['sirens','radio','reverb','ambience']){assert.ok(ctx.focusableControls().includes($('audio-'+key)));const old=ctx.settings.audioMix[key];ctx.focusControl($('audio-'+key));ctx.processInputActions([old===1?'menuLeft':'menuRight']);assert.notEqual(ctx.settings.audioMix[key],old);assert.equal($('audio-'+key+'-value').textContent,Math.round(ctx.settings.audioMix[key]*100)+'%');}
 const before=calls.audioEvents.length;$('test-siren').click();$('test-radio').click();await flushMicrotasks();assert.ok(calls.audioEvents.slice(before).some(e=>e.type==='sirenTest'));assert.ok(calls.audioEvents.slice(before).some(e=>e.type==='radio'&&e.payload.code==='check'));$('audio-reset').click();assert.deepEqual({...ctx.settings.audioMix},ctx.mixDefaults);ctx.closeModal();
});

await check('Pause shortcuts open audio, map, guide or controls directly; controller Back returns to pause and two-dimensional navigation chooses adjacent buttons',async()=>{
 await finishStart(ctx.startGame('free'));frames(2);tapKey('KeyP');
 const buttons=[$('pause-map-button'),$('pause-controls-button'),$('pause-audio-button'),$('pause-guide-button')];
 for(let i=0;i<buttons.length;i++){const left=(i%2)*200,top=Math.floor(i/2)*80;buttons[i].getBoundingClientRect=()=>({left,top,width:180,height:60,right:left+180,bottom:top+60});}
 ctx.focusControl(buttons[0]);ctx.processInputActions(['menuRight']);assert.ok(doc.activeElement===buttons[1], 'Expected focus on '+buttons[1].id+', received '+doc.activeElement?.id);ctx.processInputActions(['menuNext']);assert.ok(doc.activeElement===buttons[3], 'Expected focus on '+buttons[3].id+', received '+doc.activeElement?.id);ctx.processInputActions(['menuLeft']);assert.ok(doc.activeElement===buttons[2], 'Expected focus on '+buttons[2].id+', received '+doc.activeElement?.id);ctx.processInputActions(['menuPrev']);assert.ok(doc.activeElement===buttons[0], 'Expected focus on '+buttons[0].id+', received '+doc.activeElement?.id);
 for(const [id,name] of [['pause-map-button','map'],['pause-controls-button','controls'],['pause-audio-button','settings'],['pause-guide-button','guide']]){
  ctx.focusControl($(id));ctx.processInputActions(['confirm']);assert.equal(ctx.modalName,name);assert.equal(ctx.paused,true);assert.ok(ctx.focusableControls().includes(doc.activeElement));
  if(name==='settings'){assert.equal(ctx.settingsTab,'audio');assert.equal(doc.activeElement,$('volume-range'));}
  if(name==='controls')assert.equal(ctx.controlsReturn,'pause');
  ctx.processInputActions(['back']);assert.equal(ctx.modalName,'pause');assert.equal(ctx.paused,true);assert.equal(doc.activeElement,$('resume-button'));
 }
 $('pause-settings-button').click();assert.equal(ctx.settingsTab,'drive');$('controls-button').click();assert.equal(ctx.controlsReturn,'settings');ctx.processInputActions(['back']);assert.equal(ctx.modalName,'settings');ctx.processInputActions(['back']);assert.equal(ctx.modalName,'pause');ctx.processInputActions(['back']);assert.equal(ctx.paused,false);assert.equal(ctx.modalName,null);
 for(const button of buttons)delete button.getBoundingClientRect;
});

await check('Actual fixed ticks feed night, emergency units and contacts to AI; frame forwards all nearby sirens, listener acoustics and environmental police context',()=>{
 const active={id:'police-a',active:true,siren:true,x:200,z:340},inactive={id:'police-b',active:false,siren:true,x:200,z:360},patrol={id:'police-c',active:true,siren:false,x:200,z:380};
 ctx.police.states=[active,inactive,patrol];ctx.police.state.officers=[active,patrol];ctx.environment.night=.87;
 ctx.police.audio=Array.from({length:6},(_,i)=>({id:'police-audio-'+i,siren:true,distance:[20,45,90,145,210,300][i],x:200,z:340+i*25,rpm:2400,load:.7}));
 ctx.traffic.audio=Array.from({length:8},(_,i)=>({id:'traffic-audio-'+i,distance:i+1,x:202+i,z:321,rpm:1700,load:.4}));
 const contact={closingSpeed:6,collider:{kind:'traffic'}},start={traffic:calls.trafficUpdates.length,police:calls.policeUpdates.length,enforcement:calls.enforcementUpdates.length};ctx.crimeContacts=[contact];ctx.accumulator=0;frame(.009);
 assert.equal(calls.trafficUpdates.length,start.traffic+1);assert.equal(calls.policeUpdates.length,start.police+1);assert.equal(calls.enforcementUpdates.length,start.enforcement+1);
 assert.equal(calls.trafficUpdates.at(-1).context.night,.87);assert.equal(calls.trafficUpdates.at(-1).context.emergency.length,1);assert.equal(calls.trafficUpdates.at(-1).context.emergency[0],active);assert.equal(calls.policeUpdates.at(-1).context.night,.87);assert.equal(calls.policeUpdates.at(-1).context.contacts[0],contact);assert.equal(ctx.crimeContacts.length,0);assert.equal(calls.enforcementUpdates.at(-1).context.police,ctx.police);
 assert.deepEqual({...calls.policeCreates.at(-1)},{count:6,dayCount:3,nightCount:6});const sources=calls.trafficAudio.at(-1);assert.equal(sources.length,14);assert.equal(sources.filter(s=>s.siren).length,6);assert.ok(sources.includes(ctx.police.audio[5]));
 const context=calls.worldAudio.at(-1);assert.equal(context.nearestSirenDistance,20);assert.equal(context.night,.87);assert.equal(context.worldActive,true);assert.equal(context.acoustics.zone,'street');assert.equal(context.acoustics.enclosure,.75);assert.equal(context.ambient.traffic,.8);assert.ok(Number.isFinite(context.listenerRight.x));assert.ok(Number.isFinite(context.cameraHeading));
 const env=calls.environmentUpdates.at(-1);assert.equal(env.length,6);assert.equal(env[5].police,ctx.police.state.officers);assert.equal(env[3],ctx.settings);assert.equal(calls.cityUpdates.at(-1).context.night,.87);assert.ok(calls.cityUpdates.at(-1).context.player);frame(1/120);assert.equal(calls.policeUpdates.at(-1).context.contacts.length,0);
 report.frameRouting={fixedTicksPerFrame:1,audiblePoliceForwarded:6,trafficForwarded:8,sixthEnvironmentContext:true,night:.87};
});

await check('Police dispatch uses captioned, prioritized, rate-limited radio events and waits while paused',()=>{
 ctx.dispatchQueue=[];ctx.dispatchLast.clear();ctx.dispatchTime=0;ctx.police.events.push({type:'radio',code:'location',message:'Suspect heading north on Market Street.',unit:'UNIT 21',priority:0},{type:'radio',code:'pursuit',message:'Vehicle failing to stop. Pursuit active.',unit:'UNIT 22',priority:2},{type:'radio',code:'pursuit',message:'Duplicate pursuit call.',priority:2});
 let before=calls.audioEvents.filter(e=>e.type==='radio').length;frame();const first=calls.audioEvents.filter(e=>e.type==='radio');assert.equal(first.length,before+1);assert.equal(first.at(-1).payload.code,'pursuit');assert.equal(first.at(-1).payload.subtitle,$('dispatch-text').textContent);assert.equal($('dispatch-unit').textContent,'UNIT 22');assert.equal(ctx.dispatchQueue.length,1);assert.equal($('dispatch-panel').classList.contains('hidden'),false);
 frames(20,.05);assert.equal(calls.audioEvents.filter(e=>e.type==='radio').length,before+1);ctx.setPaused(true);const remaining=ctx.dispatchTime;frames(120,.05);assert.equal(ctx.dispatchTime,remaining);assert.equal(calls.audioEvents.filter(e=>e.type==='radio').length,before+1);ctx.setPaused(false);frames(120,.05);assert.equal(calls.audioEvents.filter(e=>e.type==='radio').length,before+2);assert.equal(calls.audioEvents.filter(e=>e.type==='radio').at(-1).payload.code,'location');
 ctx.dispatchQueue=[];ctx.dispatchTime=0;ctx.dispatchLast.clear();
});

await check('A real directional speed-camera crossing reaches the HUD, flash, police investigation, sound cue and map without assigning instant wanted heat',()=>{
 ctx.enforcement.reset();ctx.state.x=200;ctx.state.z=344;ctx.state.heading=0;ctx.state.vx=0;ctx.state.vz=35;ctx.state.speed=35;ctx.state.forwardSpeed=35;ctx.accumulator=0;frame(1/60);
 const before=calls.cameraFlashes.length,reported=calls.cameraReports.length;ctx.state.z=346;frame(1/60);assert.equal(calls.cameraFlashes.length,before+1);assert.equal(calls.cameraFlashes.at(-1).id,'test-camera');assert.equal(calls.cameraReports.length,reported+1);assert.equal(ctx.enforcementState.tickets,1);assert.equal(ctx.policeState.heat,0);assert.equal($('camera-reading').textContent,'126 / 50 KM/H');assert.equal($('camera-alert').classList.contains('hidden'),false);assert.match($('camera-alert-message').textContent,/POLICE NOTIFIED/);assert.ok(calls.audioEvents.some(e=>e.type==='speedCamera'&&e.payload.x===200&&e.payload.z===345));
 const drawCalls=[],canvas={fillStyle:'',strokeStyle:'',clearRect(){},fillRect(...args){drawCalls.push({type:'rect',color:this.fillStyle,args});},beginPath(){},moveTo(){},lineTo(){},closePath(){},stroke(){},fill(){},arc(...args){drawCalls.push({type:'arc',color:this.fillStyle,args});},save(){},restore(){},translate(){},rotate(){},fillText(...args){drawCalls.push({type:'text',args});}};
 ctx.police.state={...ctx.police.state,phase:'search',searchCenter:{x:200,z:346},searchRadius:160};ctx.policeState=ctx.police.state;ctx.drawMapOn(canvas,720,540,true);
 const sensors=drawCalls.filter(c=>c.type==='rect'&&c.color==='#ffc77c');assert.equal(sensors.length,ctx.world.speedCameras.length);assert.ok(drawCalls.some(c=>c.type==='arc'&&c.color==='#f9c66c22'));assert.ok(drawCalls.some(c=>c.type==='text'&&c.args[0]==='FUEL STOP'));
 ctx.police.state={...ctx.police.state,phase:'patrol',heat:0};ctx.policeState=ctx.police.state;ctx.state.speed=ctx.state.forwardSpeed=ctx.state.vz=0;frames(90,.05);assert.equal($('camera-alert').classList.contains('hidden'),true);
 report.speedCameraIntegration={reading:'126 / 50 KM/H',tickets:ctx.enforcementState.tickets,visibleFlash:true,policeInvestigation:true,mapMarker:true,instantWantedHeat:false};
});

await check('Music receives distinct chase, search, escape and driving modes with proximity, NOS, drift, near-pass and search progress; a new pursuit interrupts relief',()=>{
 ctx.police.state={...ctx.police.state,phase:'chase',heat:2,heatNormalized:2/3,searchProgress:0};ctx.police.events.push({type:'pursuit',reason:'Speeding'});frame();assert.equal(calls.music.at(-1).mode,'chase');assert.equal(calls.music.at(-1).heat,2/3);assert.ok(calls.music.at(-1).proximity>.8);
 ctx.police.state={...ctx.police.state,phase:'search',searchProgress:.4};ctx.police.events.push({type:'search'});frame();assert.equal(calls.music.at(-1).mode,'search');assert.equal(calls.music.at(-1).searchProgress,.4);
 ctx.police.state={...ctx.police.state,phase:'patrol',heat:0,heatNormalized:0};ctx.police.events.push({type:'escaped'});frame();assert.equal(calls.music.at(-1).mode,'escape');assert.ok(calls.audioEvents.some(e=>e.type==='escape'));frames(205,.05);assert.equal(calls.music.at(-1).mode,'drive');
 ctx.state.boosting=true;ctx.state.nitrousIntensity=.8;ctx.state.drifting=true;ctx.state.driftAngle=.4;ctx.traffic.events.push({type:'nearMiss',intensity:.9});frame();assert.equal(calls.music.at(-1).nitrous,.8);assert.equal(calls.music.at(-1).drift,.8);assert.ok(calls.music.at(-1).nearMiss>.85);assert.equal($('toast').textContent,'CLOSE PASS');ctx.state.boosting=false;ctx.state.drifting=false;
 ctx.police.events.push({type:'escaped'});frame();assert.equal(calls.music.at(-1).mode,'escape');ctx.police.state={...ctx.police.state,phase:'chase',heat:1,heatNormalized:1/3};ctx.police.events.push({type:'pursuit',reason:'Reckless driving'});frame();assert.equal(calls.music.at(-1).mode,'chase','Fresh pursuit must interrupt the ten-second escape relief cue');
 ctx.police.state={...ctx.police.state,phase:'patrol',heat:0,heatNormalized:0};ctx.policeState=ctx.police.state;ctx.escapeMusic=0;
 report.musicModes=['chase','search','escape','drive','fresh pursuit interrupts escape'];
});

await check('Restarting free roam reuses its map but clears old dispatch, camera captures, police state, relief music, acoustics and audio feedback',async()=>{
 const sameWorld=ctx.world,sameEnforcement=ctx.enforcement,creates=calls.cityCreates,disposals=calls.enforcementDisposals,resetCalls=calls.audioFeedbackResets;
 ctx.queueDispatch({code:'old-pursuit',message:'Stale call from the previous drive.',priority:2});ctx.dispatchTime=3;ctx.cameraAlertTime=4;ctx.nearMissPulse=.9;ctx.escapeMusic=8;ctx.acousticState={zone:'old-street'};ctx.nearbySounds=[{id:'old-unit',siren:true}];ctx.crimeContacts=[{closingSpeed:8}];ctx.police.state={...ctx.police.state,phase:'search',heat:2};
 const restart=ctx.startGame('free');await advancePaint();assert.ok(ctx.world===sameWorld,'Same-city restart reuses the world');assert.ok(ctx.enforcement===sameEnforcement,'Same-city restart reuses enforcement');assert.equal(calls.cityCreates,creates);assert.equal(calls.enforcementDisposals,disposals);assert.ok(calls.audioFeedbackResets>resetCalls);
 assert.equal(ctx.dispatchQueue.length,0);assert.equal(ctx.dispatchLast.size,0);assert.equal(ctx.dispatchTime,0);assert.equal(ctx.cameraAlertTime,0);assert.equal(ctx.nearMissPulse,0);assert.equal(ctx.escapeMusic,0);assert.equal(ctx.acousticState,null);assert.equal(ctx.nearbySounds.length,0);assert.equal(ctx.crimeContacts.length,0);assert.equal(ctx.enforcementState.tickets,0);assert.equal(ctx.policeState.phase,'patrol');assert.equal($('dispatch-panel').classList.contains('hidden'),true);assert.equal($('camera-alert').classList.contains('hidden'),true);assert.equal(calls.trafficAudio.at(-1).length,0);
 await advancePaint();await advanceCompile();await restart;assert.equal(ctx.phase,'playing');assert.equal(ctx.paused,false);assert.equal(scene.children.length,1);report.sameCityRestart={reusesMap:true,resetsFeedback:true,resetsCameraRecords:true};
});

await check('Leaving the city disposes enforcement and clears transient dispatch, camera, acoustic and sound-source state',()=>{
 const previous=ctx.enforcement,before=calls.enforcementDisposals;ctx.queueDispatch({code:'location',message:'A queued city-only call.'});ctx.cameraAlertTime=4;ctx.showMenu();assert.ok(previous);assert.equal(calls.enforcementDisposals,before+1);assert.equal(ctx.enforcement,null);assert.equal(ctx.dispatchQueue.length,0);assert.equal(ctx.dispatchTime,0);assert.equal(ctx.cameraAlertTime,0);assert.equal(ctx.nearbySounds.length,0);assert.equal(ctx.acousticState,null);assert.equal($('dispatch-panel').classList.contains('hidden'),true);assert.equal($('camera-alert').classList.contains('hidden'),true);assert.equal(calls.trafficAudio.at(-1).length,0);
});

input.destroy();report.status='passed';report.asyncCompileCalls=calls.compile;report.cityCreations=calls.cityCreates;report.worldSwitchesVerified=['showroom→city','city→showroom','city→dock','cancel before first paint','cancel after world selection','cancel during compilation','superseded compile completion','compile rejection'];fs.writeFileSync(new URL('./integration-v7-results.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
