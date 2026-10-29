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
import {EventStub,Target,parseHTML,installDOM,flushMicrotasks} from './dom-v5-harness.mjs';

const main=fs.readFileSync(new URL('../dist/main.js',import.meta.url),'utf8'),html=fs.readFileSync(new URL('../dist/index.html',import.meta.url),'utf8');
const report={status:'pending',checks:[],verificationLimit:'Actual main.js handlers, InputManager, GameUI, ControlsPanel and GaragePanel in a functional DOM; renderer/world/audio are controlled stubs. No browser layout, GPU or hardware claims.'};
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
const calls={cityCreates:0,trafficResets:0,compile:0,physicsReset:0,audioSuspend:[],audioBuild:[],trafficAudio:[],worldAudio:[],preview:[],hud:[],ticks:[],feedback:[],errors:[],maps:0,worlds:[],trafficDisposals:0,policeDisposals:0};
const scene=new THREE.Scene();
const makeWorld=(kind,x,z)=>{const root=new THREE.Group();root.name={city:'NEON-DISTRICT',dock:'DOCK09',showroom:'SHOWROOM'}[kind];scene.add(root);const world={kind,root,spawn:{x,z,heading:.7},services:kind==='city'?[{id:'fuel',name:'FUEL STOP',kind:'fuel',x,z,radius:8},{id:'garage',name:'GARAGE',kind:'garage',x:x+25,z,radius:8},{id:'police',name:'STATION',kind:'police',x:x+50,z,radius:8,spawn:{x:x+50,z,heading:0}}]:[],checkpoints:kind==='dock'?Array.from({length:8},(_,i)=>({x:i*10,z:i*8,heading:0})):undefined,getSurfaceAt:()=>({height:0,friction:1,roughness:.05,surface:'asphalt'}),getRoadInfo:()=>({progress:.5,distance:0,district:'neon'}),update(){},curve:{getPointAt:()=>({x:4,z:8}),getTangentAt:()=>({x:0,z:1})},getResetPose:()=>({x:12,z:32,heading:.2})};calls.worlds.push(world);return world;};
const stage=makeWorld('showroom',0,0),makeTraffic=()=>({reset(){calls.trafficResets++;},render(){},getNearbyAudio:()=>[],diagnostics:()=>({count:36}),setNight(){},dispose(){calls.trafficDisposals++;}}),makePolice=()=>({reset(){},render(){},getState:()=>({phase:'patrol',heat:0,officers:[],arrestProgress:0}),getNearbyAudio:()=>[],setNight(){},dispose(){calls.policeDisposals++;}});
const active=resolveBuild(),ctx={
 document:doc,window:keyboard,Event:EventStub,console:{error:error=>calls.errors.push(error.message)},performance:{now:()=>clock},requestAnimationFrame(){},setTimeout(){},matchMedia:()=>({matches:false}),
 $,THREE,disposeWorld,...{clamp:(n,a,b)=>Math.max(a,Math.min(b,n))},paintInputPrompts,phase:'menu',mode:'free',selectedMode:'free',paused:false,returnToPause:false,modalName:null,transitionSerial:0,promptRevision:-1,inputPresentation:null,
 inputManager:input,activeInputConfig:input.getConfig(),controlsPanel:null,garagePanel:null,gameUI:null,activeBuild:active,padFocus:null,
 settings:{camera:0,handling:'street',blur:.65,quality:'high',volume:.55,assists:true,telemetry:false,headlights:true,bloom:.65,timeMode:'cycle',dayMinutes:12,music:true,musicVolume:.5,build:active.selection,paints:{},audioMix:{engine:1,mechanical:.8,tyres:.85,environment:.7,drive:.65}},mixDefaults:{engine:1,mechanical:.8,tyres:.85,environment:.7,drive:.65},
 state:null,renderState:null,world:stage,traffic:null,police:null,policeState:{phase:'patrol',heat:0,officers:[]},crimeContacts:[],environment:{setWorld(){},update:()=>({night:.5})},serviceTarget:null,serviceJob:null,arrestStation:null,lookYaw:0,lookPitch:0,escapeMusic:0,conditionSaveClock:0,scene,camera:new THREE.PerspectiveCamera(),renderer:{compileAsync(){calls.compile++;const pending=deferred();compileWaits.push(pending);return pending.promise;}},
 createCity(){calls.cityCreates++;return makeWorld('city',200,320);},createWorld:()=>makeWorld('dock',24,60),createShowroom:()=>makeWorld('showroom',0,0),createTraffic:makeTraffic,createPolice:makePolice,nextPaint(){const pending=deferred();paintWaits.push(pending);return pending.promise;},
 physics:{state:{},setGroundSampler(){},setTune(){},setBuild(){},repair(){this.state.engineHealth=this.state.bodyHealth=1;this.state.wheelAttached=[true,true,true,true];},refuel(amount){this.state.fuelLitres=Math.min(this.state.fuelCapacity,this.state.fuelLitres+amount);},service(){this.state.boost=1;},reset(x=0,z=0,heading=0,options={}){calls.physicsReset++;this.state={x,z,heading,speed:0,forwardSpeed:0,lateralSpeed:0,vx:0,vz:0,boost:1,boosting:false,nitrousIntensity:0,fuelLitres:5,fuelCapacity:55,engineHealth:1,bodyHealth:1,wheelAttached:[true,true,true,true],groundHeight:.012,bodyHeight:.012,bodyPitch:0,bodyRoll:0,gear:options.neutral?0:1,rpm:900,wheelSpins:[0,0,0,0],wheelSteers:[0,0,0,0],suspension:Array.from({length:4},()=>({groundHeight:.012,wheelY:.352,contact:true}))};}},
 audio:{started:true,start:()=>Promise.resolve(true),suspend:v=>calls.audioSuspend.push(v),setMuted(){},setBuild:b=>calls.audioBuild.push(b.signature),setMix(){},setVolume(){},setCamera(){},update(){},setTraffic:v=>calls.trafficAudio.push(v),tick(){},playEvent(){},setWorldContext:value=>calls.worldAudio.push(value),setMusic(){},updateWorld(){}},
 car:{group:{position:{set(){}},rotation:{y:0}},setBuild:b=>calls.preview.push(b.signature),setColor(){},update(){}},post:{reset(){},setCarBounds(){},render(){}},fx:{reset(){},setBuild(){},update(){}},checkpointGroup:{visible:false,position:{set(){}},rotation:{y:0},userData:{arrow:{position:{y:0}}}},
 presentation:new PoseBuffer(),cameraAnchor:{x:0,z:0},initialCamera:true,totalTime:0,runTime:0,driftRemaining:90,accumulator:0,lastNow:0,hudClock:0,
 nextCheckpoint:0,completedCheckpoints:0,lapArmed:false,comboPoints:0,comboDuration:0,comboGrace:0,score:0,offroadTimer:0,previousBoost:false,previousCountdown:4,countdownTime:0,distanceDriven:0,lastDistrict:'',discoveredDistricts:new Set(),lastRoad:null,menuOrbit:0,toastTimer:0,comicTimer:0,frames:0,fpsAccum:0,renderFps:60,
 frameControls:{},pendingShiftUp:false,pendingShiftDown:false,pendingNeutral:false,muted:false,isTouch:false,ui:{combo:$('combo')},
 persist(){},resize(){},drawFullMap(){calls.maps++;},updateCamera(){},updateBodyGroundMask(){},drawSpeedFX(){},updateHUD(){calls.hud.push({phase:ctx.phase,mode:ctx.mode,world:ctx.world.kind});if(ctx.mode==='sprint')assert.ok(ctx.world.checkpoints,'Sprint HUD must only read dock checkpoints');},comic(){},tickGameplay(){calls.ticks.push(ctx.inputState());}
};
ctx.physics.reset(stage.spawn.x,stage.spawn.z,stage.spawn.heading);ctx.state=ctx.physics.state;ctx.renderState=ctx.presentation.reset(ctx.state);ctx.lastRoad=stage.getRoadInfo();
vm.createContext(ctx);
function loadFunction(name){
 const re=new RegExp('(?:^|\\n)(?:async )?function '+name+'\\('),match=re.exec(main);assert.ok(match,'Missing real function '+name);const start=match.index+(match[0].startsWith('\n')?1:0),tail=main.slice(start);const next=/\n(?:(?:async )?function |\/\/ Read-only diagnostics)/.exec(tail);vm.runInContext(next?tail.slice(0,next.index):tail,ctx,{filename:'main.js:'+name});
}
for(const name of ['syncSettings','syncV6Settings','syncAudioSettings','resetPresentation','previewBuild','applyBuild','openGarage','visualState','updateInputPrompts','selectMode','showDialog','hideDialog','selectWorld','setupUI','clearInputs','setTransmission','requestShift','focusableControls','focusControl','focusDefault','moveFocus','adjustFocused','chooseMode','processInputActions','cycleCamera','toggleSound','toast','openModal','closeModal','setPaused','showMenu','startGame','resetCar','updateCheckpoint','inputState','toggleLights','nearestService','interact','updateServiceUI','startService','updateServiceJob','handlePoliceEvent','releaseFromStation','recoverVehicle','frame'])loadFunction(name);
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

await check('Actual controller focus skips hidden native selects and arrows; visible choices, checkboxes and sliders operate through real handlers',()=>{
 ctx.openModal('settings');assert.equal(doc.activeElement.dataset.selectId,'camera-select');const choices=ctx.focusableControls();assert.ok(choices.includes(doc.activeElement));assert.ok(choices.every(el=>!el.classList.contains('native-choice')&&el.tabIndex!==-1));assert.ok(!choices.includes($('audio-engine')));
 ctx.processInputActions(['menuRight']);assert.equal(ctx.settings.camera,1);assert.equal(doc.activeElement.textContent,'Chase');ctx.processInputActions(['confirm']);assert.equal(ctx.settings.camera,2);assert.equal(doc.activeElement.textContent,'Hood');ctx.processInputActions(['menuLeft']);assert.equal(ctx.settings.camera,1);
 ctx.focusControl($('assists-toggle'));const before=ctx.settings.assists;ctx.processInputActions(['confirm']);assert.equal(ctx.settings.assists,!before);ctx.processInputActions(['confirm']);assert.equal(ctx.settings.assists,before);
 $('audio-mix-toggle').click();assert.ok(ctx.focusableControls().includes($('audio-engine')));ctx.focusControl($('audio-drive'));ctx.processInputActions(['menuRight']);assert.equal(ctx.settings.audioMix.drive,.7);assert.equal($('audio-drive-value').textContent,'70%');ctx.closeModal();
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
 ctx.state.fuelLitres=1;ctx.state.engineHealth=.1;ctx.handlePoliceEvent({type:'arrest',station:{x:250,z:320,heading:1}});frame();assert.equal(ctx.phase,'arrested');assert.equal(ctx.paused,true);assert.equal(ctx.modalName,'arrest');assert.equal(doc.activeElement,$('release-button'));assert.equal(calls.feedback.at(-1).active,false);
 tapButton(9);assert.equal(ctx.phase,'arrested');assert.equal(ctx.paused,true);pad.axes[2]=.9;frame();assert.equal(ctx.frameControls.lookX,0);pad.axes[2]=0;
 button(pad,0,1);frame();assert.equal(ctx.phase,'playing');assert.equal(ctx.paused,false);assert.equal(ctx.modalName,null);assert.equal(ctx.state.x,250);assert.equal(ctx.state.z,320);assert.equal(ctx.state.engineHealth,1);assert.ok(ctx.state.fuelLitres>=8);frames(4);assert.equal(ctx.frameControls.boost,false);button(pad,0,0);frame();
 ctx.handlePoliceEvent({type:'arrest',station:{x:252,z:321,heading:0}});frames(2);tapKey('Escape');assert.equal(ctx.phase,'playing');assert.equal(ctx.state.x,252);assert.equal(ctx.modalName,null);assert.equal(scene.children.length,1);
});

await check('World transitions leave one map root and dispose both traffic and police when returning to the showroom',()=>{
 const trafficDisposed=calls.trafficDisposals,policeDisposed=calls.policeDisposals,oldWorld=ctx.world;ctx.showMenu();assert.equal(ctx.world.kind,'showroom');assert.equal(oldWorld.disposed,true);assert.equal(oldWorld.root.parent,null);assert.equal(calls.trafficDisposals,trafficDisposed+1);assert.equal(calls.policeDisposals,policeDisposed+1);assert.equal(scene.children.length,1);assert.equal(scene.children[0],ctx.world.root);assert.equal(ctx.traffic,null);assert.equal(ctx.police,null);
});

input.destroy();report.status='passed';report.asyncCompileCalls=calls.compile;report.cityCreations=calls.cityCreates;report.worldSwitchesVerified=['showroom→city','city→showroom','city→dock','cancel before first paint','cancel after world selection','cancel during compilation','superseded compile completion','compile rejection'];fs.writeFileSync(new URL('./integration-v6-results.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
