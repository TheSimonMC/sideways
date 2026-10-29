import * as THREE from './vendor/three.module.js';
import {createWorld} from './world.js';
import {createCity} from './region.js';
import {createTraffic} from './traffic.js';
import {createPolice} from './police.js';
import {createRace} from './race.js';
import {RaceUI,ordinal} from './race-ui.js';
import {createEnforcement} from './enforcement.js';
import {nextFocus,focusableControls as navigationControls,ScreenNavigation,adjustRange,isTextEntry,cycleTab} from './navigation.js';
import {VirtualKeyboard} from './virtual-keyboard.js';
import {createShowroom,disposeWorld} from './world-lifecycle.js';
import {DayNight} from './environment.js';
import {GameUI,paintInputPrompts} from './game-ui.js';
import {createCar,createEffects} from './car.js';
import {CarPhysics} from './physics.js';
import {ComicRenderer} from './post.js';
import {GameAudio} from './audio.js';
import {InputManager} from './input.js';
import {ControlsPanel} from './controls-ui.js';
import {resolveBuild,ENGINES,VEHICLES} from './catalog.js';
import {Instruments,setupSettingsDetails} from './instruments.js';
import {GaragePanel} from './garage.js';
import {PoseBuffer} from './presentation.js';
import {resolveVehicleContacts} from './contact.js';
import {RemoteContactTracker} from './remote-contacts.js';
import {Career} from './career.js';
import {RoadNavigator,MapView,drawRoadMap} from './navigation-map.js';
import {PhonePanel} from './phone.js';
import {MultiplayerSession} from './multiplayer.js';
import {createNetworkCars} from './network-cars.js';
import {LobbyPanel} from './lobby-panel.js';
import {VehiclePanel,primaryMechanicalWarning} from './vehicle-panel.js';

const $=id=>document.getElementById(id),clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),lerp=(a,b,t)=>a+(b-a)*t;
const screenNavigation=new ScreenNavigation(),textKeyboard=new VirtualKeyboard(screenNavigation);
const smooth=(a,b,speed,dt)=>lerp(a,b,1-Math.exp(-speed*dt));
const wrap=a=>Math.atan2(Math.sin(a),Math.cos(a));
const formatTime=t=>{const m=Math.floor(t/60),s=Math.floor(t%60),ms=Math.floor((t%1)*1000);return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${String(ms).padStart(3,'0')}`;};
const int=n=>Math.floor(n).toLocaleString('en-GB');
const safeLoad=()=>{try{return JSON.parse(localStorage.getItem('sideways-v1')||'{}')}catch{return {}}};
const saved=safeLoad();
const PLAY_MODES=['free','race','sprint','drift'];
const mixDefaults={engine:1,mechanical:.8,tyres:.55,environment:.7,drive:.65,sirens:1,radio:.85,reverb:.65,ambience:.65};
const savedMix=Object.fromEntries(Object.entries(mixDefaults).map(([key,value])=>[key,Number.isFinite(saved.audioMix?.[key])?clamp(saved.audioMix[key],0,1):value]));
const settings={camera:saved.camera??0,blur:saved.blur??(matchMedia('(prefers-reduced-motion: reduce)').matches?.2:.65),quality:saved.quality??(innerWidth<600?'medium':'high'),volume:saved.volume??.55,assists:saved.assists??true,telemetry:saved.telemetry??false,build:saved.build??{},paints:saved.paints&&typeof saved.paints==='object'?saved.paints:{}};
settings.audioMix=savedMix;
Object.assign(settings,{bloom:saved.bloom??.45,timeMode:saved.timeMode||'cycle',dayMinutes:saved.dayMinutes??12,headlights:saved.headlights??true,music:saved.music??true,musicVolume:saved.musicVolume??.58,lookSensitivity:saved.lookSensitivity??1,invertLook:!!saved.invertLook,vignette:saved.vignette??.38,shading:saved.shading??.6});
Object.assign(settings,{backgroundMusic:!!saved.backgroundMusic,displayMode:['auto','wide','curved'].includes(saved.displayMode)?saved.displayMode:'auto',hudInset:clamp(Number(saved.hudInset)||0,0,12),playerName:String(saved.playerName||'DRIVER 09').slice(0,20)});
settings.raceDifficulty=['rookie','club','pro'].includes(saved.raceDifficulty)?saved.raceDifficulty:'club';settings.raceLaps=[1,3,5].includes(saved.raceLaps)?saved.raceLaps:3;
let activeBuild=resolveBuild(settings.build);
const career=new Career(saved.career,activeBuild.selection),navigation=new RoadNavigator(),mapView=new MapView();
const remoteContacts=new RemoteContactTracker();
if(career.quote(activeBuild).total>0)activeBuild=resolveBuild();settings.build=activeBuild.selection;
const records={sprint:saved.sprint??null,drift:saved.drift??0,free:saved.free??0,raceWins:Math.max(0,Math.floor(Number(saved.raceWins)||0))};
const persist=()=>{try{localStorage.setItem('sideways-v1',JSON.stringify({...settings,...records,gameVersion:20,career:career.serialize(),worldHour:environment?.hour??17.2,garageState:physics?.exportGarageState?.()}))}catch{}};
const isTouch=matchMedia('(pointer: coarse)').matches;
let instruments;
let renderer,post,scene,camera,world,car,fx,physics,audio,sun,checkpointGroup,inputManager,controlsPanel,garagePanel,gameUI,traffic,police,environment,enforcement;
let network,networkCars,lobbyPanel,phonePanel,worldSignature='',windowFocused=document.hasFocus(),hostHold=false,awaitingWorld=false,networkWorldClock=0,networkWorld=null,sessionTimeMode=null;
let rewardTime=0,careerRevision=-1,mapProjectionResult=null,mapPointer=null;
let vehiclePanel,vehicleReturn=null,vehiclePanelClock=0;
let race=null,raceState=null,raceUI,raceRecovery=0,raceRetired=false;
let lookYaw=0,lookPitch=0,policeState={phase:'patrol',heat:0,officers:[],arrestProgress:0},crimeContacts=[],serviceTarget=null,serviceJob=null,escapeMusic=0,conditionSaveClock=0,arrestStation=null;
let settingsTab='drive',controlsReturn='settings',dispatchQueue=[],dispatchTime=0,dispatchDuration=5,dispatchLast=new Map(),cameraAlertTime=0,nearMissPulse=0,acousticClock=0,acousticState=null,nearbySounds=[],enforcementState={tickets:0,nearbyCamera:null};
let transitionSerial=0,promptRevision=-1,inputPresentation=null,discoveredDistricts=new Set(),distanceDriven=0,lastDistrict='';
const nextPaint=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
let state,phase='menu',mode='free',paused=false,returnToPause=false,frameTime=0,totalTime=0,runTime=0,driftRemaining=90,accumulator=0,lastNow=performance.now(),hudClock=0;
const presentation=new PoseBuffer();let renderState=null;
const cameraAnchor={x:0,z:0};
let selectedMode='free',nextCheckpoint=0,completedCheckpoints=0,lapArmed=false,comboPoints=0,comboDuration=0,comboGrace=0,score=0,collisionCooldown=0;
let toastTimer=0,comicTimer=0,countdownTime=0,previousCountdown=4,previousBoost=false,offroadTimer=0,menuOrbit=0,muted=false;
let camHeading=0,camShake=0,lastRoad,initialCamera=true,modalName=null,lowFps=0,frames=0,fpsAccum=0,renderFps=60;
let frameControls={steer:0,throttle:0,brake:0,handbrake:0,clutch:0,boost:false,starter:false,horn:false,lookBack:false,lookX:0,lookY:0};
let pendingShiftUp=false,pendingShiftDown=false,pendingNeutral=false,activeInputConfig=null,lastShiftMessage='',padFocus=null;
const screenCar=new THREE.Vector3(),screenAhead=new THREE.Vector3();
const look=new THREE.Vector3(),desiredPosition=new THREE.Vector3(),desiredLook=new THREE.Vector3(),cameraLook=new THREE.Vector3(),forward=new THREE.Vector3();
const mapCtx=$('minimap').getContext('2d'),speedCtx=$('speed-fx').getContext('2d');
const stars=Array.from({length:40},(_,i)=>({angle:(i*.61803398875%1)*Math.PI*2,phase:(i*.217)%1,length:.05+(i%7)*.012}));
const ui={speed:$('speed'),gear:$('gear'),rpm:$('rpm-fill'),rpmLabel:$('rpm-label'),boost:$('boost-fill'),diff:$('diff-label'),time:$('run-time'),detail:$('run-detail'),score:$('total-score'),best:$('best-label'),combo:$('combo'),comboScore:$('combo-score'),comboMult:$('combo-multiplier'),comboLife:$('combo-life-fill')};

function showError(error){console.error(error);$('loading').classList.add('hidden');const box=$('error');box.classList.remove('hidden');box.textContent='Could not start the game. Use a current browser with WebGL enabled. '+(error?.message||error);}
window.addEventListener('error',e=>{if(!renderer)showError(e.error||e.message)});

function makeSky(){environment=new DayNight(scene,renderer,sun,{hour:Number.isFinite(saved.worldHour)?saved.worldHour:17.2});}
function makeCheckpoint(){
 const group=new THREE.Group();scene.add(group);
 const m=new THREE.MeshBasicMaterial({color:0xd8fa50,transparent:true,opacity:.88,depthWrite:false});
 for(const x of [-11.2,11.2]){const pole=new THREE.Mesh(new THREE.BoxGeometry(.32,6.4,.32),m);pole.position.set(x,3.2,0);group.add(pole);const foot=new THREE.Mesh(new THREE.CylinderGeometry(1.8,1.8,.07,4),m);foot.position.set(x,.1,0);group.add(foot);}
 const arch=new THREE.Mesh(new THREE.BoxGeometry(22.6,.28,.28),m);arch.position.y=6.4;group.add(arch);
 const arrowMat=new THREE.MeshBasicMaterial({color:0xd8fa50,side:THREE.DoubleSide,transparent:true,opacity:.3,depthWrite:false});
 const arrow=new THREE.Mesh(new THREE.ConeGeometry(1.2,2.4,3),arrowMat);arrow.rotation.z=Math.PI;arrow.position.y=8.8;group.add(arrow);group.userData.arrow=arrow;group.visible=false;return group;
}

async function init(){
 $('loading-status').textContent='PREPARING YOUR CAR';
 renderer=new THREE.WebGLRenderer({canvas:$('game'),antialias:false,alpha:false,powerPreference:'high-performance'});
 renderer.info.autoReset=false;renderer.setPixelRatio(1);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.18;
 renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
 scene=new THREE.Scene();scene.background=new THREE.Color(0xb49aa9);scene.fog=new THREE.Fog(0x9a859c,190,690);
 camera=new THREE.PerspectiveCamera(48,innerWidth/innerHeight,.16,3200);

 sun=new THREE.DirectionalLight(0xffdeb9,3.1);sun.position.set(-70,125,-40);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);sun.shadow.camera.left=-65;sun.shadow.camera.right=65;sun.shadow.camera.top=65;sun.shadow.camera.bottom=-65;sun.shadow.camera.near=1;sun.shadow.camera.far=300;sun.shadow.bias=-.0003;sun.shadow.normalBias=.07;scene.add(sun,sun.target);
 makeSky();world=createShowroom(scene);environment.setWorld(world);car=createCar(scene,activeBuild);fx=createEffects(scene,activeBuild);fx.setGroundSampler((x,z)=>world.getSurfaceAt(x,z));checkpointGroup=makeCheckpoint();
 physics=new CarPhysics(window.MotorLab,activeBuild);if(saved.garageState)physics.restoreGarageState?.(saved.garageState);physics.setGroundSampler((x,z)=>world.getSurfaceAt(x,z));physics.reset(world.spawn.x,world.spawn.z,world.spawn.heading);state=physics.state;resetPresentation();
 lastRoad=world.getRoadInfo(state.x,state.z);car.group.position.set(state.x,0,state.z);car.group.rotation.y=state.heading;
 audio=new GameAudio();audio.setVolume(settings.volume);audio.setMix(settings.audioMix);audio.setBuild(activeBuild);audio.setCamera?.(settings.camera);audio.update(state);physics.setEngineAdvance((engine,dt)=>audio.advanceEngine(engine,dt));
 post=new ComicRenderer(renderer);post.setCarBounds({...activeBuild.vehicle.model,rideHeight:activeBuild.physics.rideHeight});inputManager=new InputManager({storageKey:'sideways-input-v2'});activeInputConfig=inputManager.getConfig();controlsPanel=new ControlsPanel(inputManager,{onChanged:()=>{activeInputConfig=inputManager.getConfig();syncSettings()}});
 gameUI=new GameUI();instruments=new Instruments();setupSettingsDetails();raceUI=new RaceUI();garagePanel=new GaragePanel({onPreview:previewBuild,onCancel:previewBuild,onApply:applyBuild,economy:career});garagePanel.onCategory=()=>{};
 network=new MultiplayerSession();networkCars=createNetworkCars(scene);
 lobbyPanel=new LobbyPanel(network,{onLeave:()=>{leaveSession();showMenu();},onResume:()=>closeModal({resume:true}),onProfile:name=>{settings.playerName=String(name).slice(0,20);persist();},onLayout:()=>gameUI?.scan()});
 phonePanel=new PhonePanel({onAccept:acceptJob,onDecline:()=>{career.nextOffer();syncCareerUI();persist();},onTrack:trackJob});
 vehiclePanel=new VehiclePanel({onRepair:startComponentService,onLayout:()=>gameUI?.scan()});
 career.setWorld(world);navigation.setWorld(world);mapView.reset(world,state);previewBuild(activeBuild);resize();setupUI();updateCamera(1,true);syncSettings();updateInputPrompts(true);focusDefault();
 $('garage-count').textContent=VEHICLES.length+' CARS · '+ENGINES.length+' ENGINES';
 gameUI.loadingStatus('PREPARING LIGHTING AND MATERIALS');await nextPaint();if(renderer.compileAsync)await renderer.compileAsync(scene,camera);
 environment.update(0,state,camera,settings,totalTime);syncV6Settings();gameUI.finishLoading();gameUI.enter($('menu'));lastNow=performance.now();requestAnimationFrame(frame);
}
function resize(){
 if(!renderer)return;const w=innerWidth,h=innerHeight;applyDisplayFraming();renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();
 const pixelRatio=settings.quality==='psx'?.52:settings.quality==='medium'?.8:Math.min(devicePixelRatio,1.35);
 post.resize(w,h,pixelRatio);$('speed-fx').width=w;$('speed-fx').height=h;
 renderer.shadowMap.enabled=settings.quality!=='psx';
 initialCamera=true;
}
function syncSettings(){
 $('camera-select').value=settings.camera;$('blur-range').value=settings.blur*100;$('quality-select').value=settings.quality;$('volume-range').value=settings.volume*100;
 const cfg=inputManager?.getConfig();if(cfg){activeInputConfig=cfg;$('transmission-select').value=cfg.transmission;$('manual-clutch-toggle').checked=cfg.manualClutch&&cfg.transmission!=='auto';$('manual-clutch-toggle').disabled=cfg.transmission==='auto';$('touch-shifts').classList.toggle('hidden',cfg.transmission==='auto');}
 $('camera-label').textContent=['TOP DOWN','CHASE CAM','HOOD CAM'][settings.camera];$('handling-label').textContent=activeBuild.selection.tyres.toUpperCase()+' TYRES · '+Math.round(activeBuild.stats.steeringLockDeg)+'° LOCK';
 $('assists-toggle').checked=settings.assists;$('telemetry-toggle').checked=settings.telemetry;$('mechanical-hud').classList.toggle('hidden',!settings.telemetry);
 $('hero-car-name').textContent=activeBuild.vehicle.name;$('hero-car-engine').textContent=activeBuild.engine.name+' / '+activeBuild.physics.driveLayout;audio?.setCamera?.(settings.camera);
 $('sound-button').classList.toggle('muted',muted);$('sound-button').setAttribute('aria-label',audio?.started&&!muted?'Mute audio':'Enable audio');
 syncAudioSettings();syncV6Settings();syncV7Settings();syncV8Settings();gameUI?.sync();updateInputPrompts(true);syncCareerUI();
}
function syncV6Settings(){
 if(!$('bloom-range'))return;
 $('bloom-range').value=settings.bloom*100;$('time-select').value=online()?network.rules.time:settings.timeMode;$('time-select').disabled=online();$('day-length').value=settings.dayMinutes;
 $('headlights-toggle').checked=settings.headlights;$('music-toggle').checked=settings.music;$('music-range').value=settings.musicVolume*100;
 $('lights-button').classList.toggle('active',settings.headlights);$('lights-button').setAttribute('aria-pressed',String(settings.headlights));
}
function syncV7Settings(){
 $('look-sensitivity').value=settings.lookSensitivity*100;$('invert-look-toggle').checked=settings.invertLook;$('vignette-range').value=settings.vignette*100;$('shading-range').value=settings.shading*100;
}
function selectSettingsTab(tab,focus=false){
 settingsTab=['drive','visuals','audio'].includes(tab)?tab:'drive';
 document.querySelectorAll('[data-settings-tab]').forEach(button=>{const active=button.dataset.settingsTab===settingsTab;button.classList.toggle('active',active);button.setAttribute('aria-selected',String(active));});
 for(const id of ['drive','visuals','audio'])$('settings-'+id).classList.toggle('hidden',id!==settingsTab);
 gameUI?.scan();if(focus)focusControl($('settings-tab-'+settingsTab));
}
function openSettings(tab='drive'){selectSettingsTab(tab);openModal('settings');}
function queueDispatch(event){
 const text=event.message||event.text;if(!text)return;const key=event.code||text,last=dispatchLast.get(key)??-100;
 if(totalTime-last<3.5)return;dispatchLast.set(key,totalTime);if(dispatchLast.size>40)dispatchLast.delete(dispatchLast.keys().next().value);
 dispatchQueue.push({...event,message:text});dispatchQueue.sort((a,b)=>(b.priority||0)-(a.priority||0));if(dispatchQueue.length>5)dispatchQueue.length=5;
}
function updateDispatch(dt){
 if(phase!=='playing'||paused)return;dispatchTime=Math.max(0,dispatchTime-dt);
 if(dispatchTime<=0&&dispatchQueue.length){const event=dispatchQueue.shift();dispatchDuration=clamp(event.message.length*.045+1.2,3.8,7);dispatchTime=dispatchDuration;$('dispatch-text').textContent=event.message;$('dispatch-unit').textContent=event.unit||'DISPATCH';audio.playEvent?.('radio',{...event,subtitle:event.message});}
 $('dispatch-panel').classList.toggle('hidden',dispatchTime<=0);$('dispatch-life').style.transform='scaleX('+clamp(dispatchTime/dispatchDuration,0,1)+')';
 cameraAlertTime=Math.max(0,cameraAlertTime-dt);$('camera-alert').classList.toggle('hidden',cameraAlertTime<=0);nearMissPulse=Math.max(0,nearMissPulse-dt*.65);
}
function handleCityEvent(event){
 if(event.type==='radio'){queueDispatch(event);return;}
 if(event.playerId&&event.playerId!==localPlayerId())return;
 if(event.type==='speedCamera'){cameraAlertTime=4.3;$('camera-reading').textContent=Math.round(event.speedKph)+' / '+event.limitKph+' KM/H';$('camera-alert-message').textContent=event.message||event.name;audio.playEvent?.('speedCamera',{x:event.x,z:event.z,intensity:.7});inputManager.feedbackEvent?.('speedCamera',.65);}
 else if(event.type==='nearMiss'&&event.completed&&collisionCooldown<=0){const reward=career.onNearMiss(event,state);if(reward){nearMissPulse=Math.max(nearMissPulse,event.intensity||.5);camShake=Math.max(camShake,.035);handleCareerEvents();}}
}

function syncAudioSettings(){
 for(const key of Object.keys(mixDefaults)){const amount=Math.round(settings.audioMix[key]*100);$('audio-'+key).value=amount;$('audio-'+key+'-value').textContent=amount+'%';}
 audio?.setMix(settings.audioMix);gameUI?.sync();
}
function resetPresentation(){renderState=presentation.reset(state);accumulator=0;cameraAnchor.x=state.x;cameraAnchor.z=state.z;}
function previewBuild(build){const sameCar=car.bounds?.kind===build.vehicle.model.kind;car.setBuild(build);car.setColor(settings.paints[build.vehicle.id]||build.vehicle.color);if(state)car.update(state,0,totalTime);post?.setCarBounds({...build.vehicle.model,rideHeight:build.physics.rideHeight});if(!sameCar)initialCamera=true;gameUI?.sync();}
function applyBuild(build){
 const purchase=career.purchase(build);if(!purchase.ok){toast('NEED '+int(purchase.shortfall)+' MORE POINTS');return false;}
 garagePanel.active=build;garagePanel.hide(false);document.body.classList.remove('garage-open');activeBuild=build;settings.build=build.selection;
 physics.setBuild(build);physics.setDamageEnabled?.(!online()||network.rules.damage);state=physics.state;audio.setBuild(build);previewBuild(build);fx.setBuild(build);persist();
 if(phase==='menu'){modalName=null;hideDialog();initialCamera=true;focusDefault();}else{resetPresentation();returnToPause=false;closeModal({resume:true});}
 handleCareerEvents();syncSettings();focusDefault();toast(build.vehicle.name+' · SETUP INSTALLED');return true;
}

function openGarage(){
 if(mode==='race'&&race&&['playing','countdown'].includes(phase)){toast('Finish or leave the race before changing parts.');return;}
 if(phase==='playing'&&world.kind==='city'){const place=nearestService();if(!place||place.kind!=='garage'||state.speed>.8){toast('Stop at a mechanic to change your setup.');return;}if(['chase','search'].includes(policeState.phase)){toast('Lose the police before entering the garage.');return;}serviceJob=null;}
 openModal('garage');
}

function visualState(){if(modalName!=='garage')return renderState||state;const build=garagePanel.draft;return {...state,speed:0,forwardSpeed:0,bodyHeight:state.groundHeight||0,bodyPitch:0,bodyRoll:0,steer:0,brake:0,boosting:false,suspension:Array.from({length:4},()=>({wheelY:(state.groundHeight||0)+build.physics.wheelRadius,groundHeight:state.groundHeight||0,contact:true})),wheelSpinL:0,wheelSpinR:0,wheelSpins:[0,0,0,0],wheelSteers:[0,0,0,0]};}
function updateBodyGroundMask(view=state){
 const b=(garagePanel?.open?garagePanel.draft:activeBuild).vehicle.model,sn=Math.sin(view.heading),cs=Math.cos(view.heading);
 let highest=view.groundHeight||0;for(const wheel of view.suspension||[])highest=Math.max(highest,wheel.groundHeight||0);
 for(const x of [-b.width*.54,0,b.width*.54])for(const z of [-b.length*.54,0,b.length*.54])highest=Math.max(highest,world.getSurfaceAt(view.x+x*cs+z*sn,view.z-x*sn+z*cs).height);
 view.maskGroundHeight=highest;
}
function updateInputPrompts(force=false){
 if(!inputManager)return;const next=inputManager.getPresentation?.();if(!force&&next?.revision===promptRevision)return;
 promptRevision=next?.revision??0;inputPresentation=paintInputPrompts(inputManager);const label={keyboard:'KEYBOARD',xbox:'XBOX',playstation:'PLAYSTATION',wheel:'WHEEL',gamepad:'CONTROLLER',touch:'TOUCH'}[inputPresentation.kind]||'CONTROLLER';
 $('input-source').textContent=label;
 if(inputPresentation.kind!=='keyboard'&&phase==='menu'&&!modalName&&!focusableControls().includes(document.activeElement))focusDefault();
}
function selectMode(value){
 selectedMode=PLAY_MODES.includes(value)?value:'free';
 document.querySelectorAll('[data-mode]').forEach(el=>{const active=el.dataset.mode===selectedMode;el.classList.toggle('active',active);el.setAttribute('aria-pressed',String(active));});
 $('destination-name').textContent=selectedMode==='free'?'NEON ARCHIPELAGO':'DOCK 09';
 $('destination-detail').textContent=selectedMode==='free'?'CITY · TRAFFIC · POLICE · SERVICES':selectedMode==='race'?'5 RIVALS · '+settings.raceLaps+' LAPS · '+settings.raceDifficulty.toUpperCase():selectedMode==='sprint'?'DOCK LAP · YOUR BEST TIME':'90 SECONDS · DRIFT COMBOS';
 $('race-options').classList.toggle('hidden',selectedMode!=='race');$('race-difficulty').value=settings.raceDifficulty;$('race-laps').value=String(settings.raceLaps);gameUI?.sync();
 $('start-label').textContent=selectedMode==='free'?'ENTER THE CITY':selectedMode==='race'?'JOIN THE GRID':'HIT THE TRACK';
}
function showDialog(name){
 const wrap=$('modal-wrap');if(wrap.classList.contains('hidden')||wrap.classList.contains('ui-leaving'))gameUI?.enter(wrap);else wrap.classList.remove('hidden');
 document.querySelectorAll('.modal').forEach(panel=>{if(panel.id===name+'-modal')gameUI?.enter(panel);else{gameUI?.stopAnimation(panel);panel.classList.add('hidden');}});
 gameUI?.scan();screenNavigation.enter($(name+'-modal'));updateInputPrompts(true);
}
function hideDialog(){textKeyboard.close(false);screenNavigation.reset(phase==='menu'?$('menu'):null);gameUI?.leave($('modal-wrap'));}
function resetWorldFeedback(){
 remoteContacts.reset();
 crimeContacts=[];nearbySounds=[];acousticState=null;acousticClock=0;dispatchQueue=[];dispatchTime=0;dispatchLast.clear();cameraAlertTime=0;nearMissPulse=0;escapeMusic=0;
 $('dispatch-panel').classList.add('hidden');$('camera-alert').classList.add('hidden');$('road-status').classList.add('hidden');audio?.setTraffic?.([]);audio?.resetWorldFeedback?.();
}
function selectWorld(target){
 const kind=target==='free'?'city':target==='menu'?'showroom':'dock',rules=online()?network.rules:null;
 const trafficCount=kind==='city'?(rules?{off:0,light:18,normal:36}[rules.traffic]:36):0,policeCount=kind==='city'&&rules?.police!==false?6:0;
 const signature=kind+':'+trafficCount+':'+policeCount+':'+(online()?'session':'solo');if(world?.kind===kind&&worldSignature===signature)return;
 race?.dispose?.();race=null;raceState=null;raceRecovery=0;raceUI?.render(null);enforcement?.dispose?.();police?.dispose?.();traffic?.dispose?.();enforcement=null;police=null;traffic=null;resetWorldFeedback();enforcementState={tickets:0,nearbyCamera:null};disposeWorld(world);
 if(kind==='city'){
  gameUI?.loadingStatus('BUILDING CITY BLOCKS');world=createCity(scene);traffic=createTraffic(scene,world,{count:trafficCount});police=createPolice(scene,world,traffic,{count:policeCount,dayCount:policeCount?3:0,nightCount:policeCount});enforcement=createEnforcement(world);
 }else if(kind==='dock'){
  world=createWorld(scene);world.kind='dock';const p=world.spawn;world.services=[{id:'dock-pit',kind:'garage',name:'DOCK PIT',x:p.x,z:p.z,radius:8,heading:p.heading,spawn:{...p}}];
  const ring=new THREE.Mesh(new THREE.RingGeometry(6.4,6.7,32),new THREE.MeshBasicMaterial({color:0x8ce3ed,side:THREE.DoubleSide,transparent:true,opacity:.8,depthWrite:false}));ring.rotation.x=-Math.PI/2;ring.position.set(p.x,(world.getSurfaceAt(p.x,p.z).height||0)+.045,p.z);world.root.add(ring);
 }else world=createShowroom(scene);
 worldSignature=signature;physics?.setGroundSampler((x,z)=>world.getSurfaceAt(x,z));environment?.setWorld(world);serviceTarget=null;serviceJob=null;policeState=police?.getState?.()||{phase:'patrol',heat:0,officers:[],arrestProgress:0};
 career.setWorld(world);navigation.setWorld(world);mapView.reset(world,state||world.spawn);refreshMapPlaces();syncCareerUI();
 $('location-name').textContent=world.name||(kind==='dock'?'DOCK 09':'MOTOR WORKS');$('map-title').textContent=kind==='city'?'NEON ARCHIPELAGO':'DOCK 09';
}

function online(){return !!network?.playing;}
function localPlayerId(){return online()?network.id:'local';}
function worldAuthority(){return !online()||network.isHost;}
function localAIPlayer(){return{...state,playerId:localPlayerId(),width:activeBuild.vehicle.model.width,length:activeBuild.vehicle.model.length,mass:activeBuild.physics.mass,inertia:activeBuild.physics.inertia,horn:!!frameControls.horn};}
function remoteAIPlayers(){return online()?network.getRemotePlayers().filter(p=>p.active&&p.state).map(p=>{const build=resolveBuild(p.build);return{...p.state,playerId:p.id,width:build.vehicle.model.width,length:build.vehicle.model.length,mass:build.physics.mass,inertia:build.physics.inertia,active:true};}):[];}
function applyDisplayFraming(){
 const width=innerWidth,height=innerHeight,wide=settings.displayMode==='wide',framed=settings.displayMode==='curved'||!wide&&width/height>2.05;
 const inset=Math.max(16,framed?(width-Math.min(width,height*2.05))/2+28:width>760?34:16,width*settings.hudInset/100);
 document.documentElement.style.setProperty('--hud-inset',inset+'px');document.body.dataset.display=settings.displayMode;
}
function syncV8Settings(){
 $('display-select').value=settings.displayMode;$('hud-inset').value=settings.hudInset;$('background-music-toggle').checked=settings.backgroundMusic;
 $('pause-lobby-button').textContent=online()?'LOBBY & PLAYERS':'MULTIPLAYER';$('restart-button').disabled=online();$('recovery-button').textContent=mode==='race'&&race?'RETIRE FROM RACE':'RECOVER TO SERVICE';
 applyDisplayFraming();updateAudioFocus();
}
function updateAudioFocus(){audio?.setFocusState?.({hidden:document.hidden||!windowFocused,reading:!!modalName||phase==='menu',paused:paused||hostHold||awaitingWorld,backgroundMusic:settings.backgroundMusic});}
function markWindowFocus(focused){
 windowFocused=!!focused&&!document.hidden;
 if(!windowFocused){clearInputs();if(phase==='playing'||phase==='countdown')setPaused(true);inputManager?.updateFeedback?.(state,0,{active:false});network?.setAway();if(online()&&network.isHost)sendNetworkFrame(.1,true);}
 updateAudioFocus();lastNow=performance.now();
}
function syncCareerUI(){
 const data=career.getState(),text=int(data.wallet);$('wallet-value').textContent=text;$('menu-wallet').textContent=text+' PTS';
 $('pause-job-button').textContent=data.active?'TRACK CURRENT JOB':'ACCEPT A JOB';$('pause-job-button').disabled=world?.kind!=='city'||(!data.active&&!data.offer);
 careerRevision=data.revision;
}
function acceptJob(){
 if(world?.kind!=='city'||!['playing'].includes(phase)){toast('Enter the city to take a job.');return false;}
 if(!career.accept(state)){if(career.getState().active)trackJob();return false;}handleCareerEvents();return true;
}
function trackJob(){const target=career.getTarget();if(!target){toast('This job is tracked on your phone.');return false;}placeWaypoint(target,target.name,{snap:false,job:true});return true;}
function handleCareerEvents(){
 let changed=false;for(const event of career.consumeEvents()){
  changed=true;
  if(event.type==='reward'){
   if(event.kind!=='drift')score+=event.amount;if(mode==='free')records.free=Math.max(records.free,score);
   $('reward-label').textContent=event.label;$('reward-value').textContent='+'+int(event.amount);$('reward-chain').textContent=event.kind==='nearMiss'?'CLEAN PASS · KEEP IT GOING':event.kind==='escape'?'BACK TO THE CITY':'POINTS ADDED';
   $('reward-pop').classList.remove('reward-in');void $('reward-pop').offsetWidth;$('reward-pop').classList.remove('hidden');$('reward-pop').classList.add('reward-in');rewardTime=3;
   audio.playEvent?.(event.kind==='nearMiss'?'nearMiss':event.kind==='delivery'?'delivery':'reward',{intensity:event.kind==='nearMiss'?.7:1});inputManager.feedbackEvent?.(event.kind==='nearMiss'?'nearMiss':'reward',.8);
  }else if(event.type==='purchase'){audio.playEvent?.('purchase',{intensity:1});inputManager.feedbackEvent?.('purchase',.75);}
  else if(event.type==='objective'){
   if(event.target)placeWaypoint(event.target,event.target.name,{snap:false,job:true});
   else if(['completed','cancelled'].includes(event.phase)&&navigation.getState().target?.job)navigation.clear();
   audio.playEvent?.(event.phase==='completed'?'delivery':'objective',{intensity:.7});inputManager.feedbackEvent?.(event.phase==='completed'?'delivery':'objective',.8);
  }
 }
 if(changed){syncCareerUI();persist();}
}
function placeWaypoint(point,name='Waypoint',options={}){
 if(!point)return false;const nearest=(world.services||[]).find(p=>Math.hypot(point.x-p.x,point.z-p.z)<22);
 const target=nearest&&!options.job?(nearest.spawn||nearest):point,label=nearest&&!options.job?nearest.name:name;
 if(!navigation.setWaypoint(target,label,{snap:!nearest,...options}))return false;navigation.update(0,state);mapView.cursor={x:target.x,z:target.z};
 audio.playEvent?.('waypoint',{intensity:.5});inputManager.feedbackEvent?.('waypoint',.45);toast(options.job?'JOB ROUTE SET':'WAYPOINT SET');updateRouteUI();return true;
}
function updateRouteUI(){
 const route=navigation.getState();$('route-target').textContent=route.target?.name||'Free roam';$('route-distance').textContent=route.target?(route.arrived?'ARRIVED':route.distance>=1000?(route.distance/1000).toFixed(1)+' KM':Math.round(route.distance)+' M'):'OPEN MAP';
 $('map-selection-name').textContent=route.target?.name||'Choose a destination';$('map-selection-distance').textContent=route.target?(route.arrived?'You have arrived.':Math.round(route.distance)+' m by road'):'Click the map or choose a place below.';$('map-clear-route').disabled=!route.target;
}
function refreshMapPlaces(){
 gameUI.map.setPlaces(world.services||[],{
  onInspect:place=>{mapView.cursor={x:(place.spawn||place).x,z:(place.spawn||place).z};drawFullMap();},
  onChoose:place=>{placeWaypoint(place.spawn||place,place.name,{snap:false});drawFullMap();},
  onMark:(point,name)=>{placeWaypoint(point,name);drawFullMap();}
 });gameUI.scan();
}
function setupMapControls(){
 const canvas=$('full-map'),point=e=>{const rect=canvas.getBoundingClientRect();return{x:(e.clientX-rect.left)*canvas.width/rect.width,y:(e.clientY-rect.top)*canvas.height/rect.height};};
 canvas.addEventListener('pointerdown',e=>{if(!mapProjectionResult)return;e.preventDefault();canvas.setPointerCapture(e.pointerId);const p=point(e);mapPointer={id:e.pointerId,start:p,last:p,moved:false};});
 canvas.addEventListener('pointermove',e=>{if(!mapPointer||e.pointerId!==mapPointer.id||!mapProjectionResult)return;const p=point(e);if(Math.hypot(p.x-mapPointer.start.x,p.y-mapPointer.start.y)>6)mapPointer.moved=true;if(mapPointer.moved){const a=mapProjectionResult.unproject(mapPointer.last.x,mapPointer.last.y),b=mapProjectionResult.unproject(p.x,p.y);mapView.x=clamp(mapView.x+a.x-b.x,world.bounds.minX,world.bounds.maxX);mapView.z=clamp(mapView.z+a.z-b.z,world.bounds.minZ,world.bounds.maxZ);}mapPointer.last=p;drawFullMap();});
 const finish=e=>{if(!mapPointer||e.pointerId!==mapPointer.id)return;if(e.type==='pointerup'&&!mapPointer.moved&&mapProjectionResult){const p=point(e),target=mapProjectionResult.unproject(p.x,p.y);placeWaypoint(target);}mapPointer=null;};for(const event of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(event,finish);
 canvas.addEventListener('wheel',e=>{e.preventDefault();mapView.changeZoom(e.deltaY<0?1.15:1/1.15);drawFullMap();},{passive:false});
 $('map-zoom-in').addEventListener('click',()=>{mapView.changeZoom(1.25);drawFullMap();});$('map-zoom-out').addEventListener('click',()=>{mapView.changeZoom(.8);drawFullMap();});$('map-centre').addEventListener('click',()=>{mapView.x=state.x;mapView.z=state.z;mapView.cursor={x:state.x,z:state.z};drawFullMap();});$('map-clear-route').addEventListener('click',()=>{navigation.clear();updateRouteUI();drawFullMap();});
}


function localPoliceState(shared){
 if(!online()||!shared.targetId||shared.targetId===localPlayerId())return shared;
 return{...shared,sharedPhase:shared.phase,phase:'patrol',heat:0,heatNormalized:0,arrestProgress:0,searchProgress:0};
}
function openLobby(){
 if(phase==='loading')return;lobbyPanel.setProfile({name:settings.playerName,build:activeBuild.selection,color:settings.paints[activeBuild.vehicle.id]||activeBuild.vehicle.color});openModal('lobby');lobbyPanel.render();
}
function leaveSession(){
 network?.leave(null);networkCars?.reset();hostHold=false;awaitingWorld=false;networkWorld=null;networkWorldClock=0;
 if(sessionTimeMode!==null){settings.timeMode=sessionTimeMode;sessionTimeMode=null;}physics?.setDamageEnabled?.(true);$('session-hud').classList.add('hidden');
}
function processNetworkEvents(){
 if(!network)return;
 for(const event of network.consumeEvents()){
  if(event.type==='start'){if(phase!=='loading')startGame('free',{online:true});}
  else if(event.type==='gameEvent'){
   const payload={...event.event.payload,type:event.event.type};if(['nearMiss','speedCamera'].includes(payload.type))handleCityEvent(payload);else handlePoliceEvent(payload);
  }else if(event.type==='warning')toast(event.message);
  else if(event.type==='error'){toast(event.message);}
  else if(event.type==='sessionEnded'){const message=event.message||'The session ended.';if(phase!=='menu')showMenu();openLobby();toast(message);}
  else if(event.type==='playerJoined'||event.type==='playerLeft'){career.message('SESSION',event.name+(event.type==='playerJoined'?' joined the city.':' left the city.'));if(phase==='playing')toast(event.name+(event.type==='playerJoined'?' JOINED':' LEFT'));}
 }
 if(online()&&!network.isHost&&world.kind==='city'&&phase!=='loading'){
  const snapshot=network.takeWorldSnapshot();if(snapshot){traffic.applySnapshot(snapshot.traffic);police.applySnapshot(snapshot.police);environment.hour=snapshot.hour;world.setTrafficTime?.(snapshot.trafficTime);hostHold=!!snapshot.hostPaused;awaitingWorld=false;policeState=localPoliceState(police.getState());}
  if(network.getState().worldAgeMs>2500)hostHold=true;
 }
 networkCars.sync(network.getRemotePlayers());lobbyPanel.render();
}
function sendNetworkFrame(dt,force=false){
 if(!network?.connected)return;
 const present=online()&&world.kind==='city'&&['playing','arrested'].includes(phase)&&windowFocused&&!document.hidden;
 if(network.isHost&&online()&&world.kind==='city'){
  networkWorldClock-=dt;if(force||networkWorldClock<=0||!networkWorld){networkWorldClock=.1;networkWorld={traffic:traffic.captureSnapshot(),police:police.captureSnapshot(),hour:environment.hour,trafficTime:traffic.time,hostPaused:!['playing','arrested'].includes(phase)||!windowFocused||document.hidden};}
  // A hidden host must reach guests before requestAnimationFrame stops.
  networkWorld.hostPaused=!['playing','arrested'].includes(phase)||!windowFocused||document.hidden;
 }
 const pose={...state,headlights:settings.headlights,horn:!!frameControls.horn};if(paused||hostHold||awaitingWorld){pose.vx=pose.vz=pose.speed=pose.forwardSpeed=pose.throttle=0;pose.horn=false;pose.boosting=false;}
 network.update(force?.1:dt,{state:pose,build:activeBuild.selection,color:settings.paints[activeBuild.vehicle.id]||activeBuild.vehicle.color,world:networkWorld,active:present});
 const info=network.getState();$('session-hud').classList.toggle('hidden',!online()||phase==='loading');$('session-room').textContent=info.code;$('session-count').textContent=info.players.length+' / '+info.rules.maxPlayers;
 $('session-ping').textContent=awaitingWorld?'SYNCING CITY':hostHold?'HOST PAUSED':info.isHost?'HOST':info.ping+' MS';$('session-players').textContent=info.players.filter(p=>p.id!==info.id).map(p=>p.name).join(' · ')||'Share the lobby code to invite a friend.';
}

function setupUI(){
 document.querySelectorAll('[data-mode]').forEach(button=>button.addEventListener('click',()=>{selectMode(button.dataset.mode);gameUI.press(button)}));
 document.querySelectorAll('[data-color]').forEach(button=>button.addEventListener('click',()=>{settings.paints[activeBuild.vehicle.id]=button.dataset.color;car.setColor(button.dataset.color);persist();document.querySelectorAll('[data-color]').forEach(el=>el.classList.toggle('selected',el===button));}));
 $('start-button').addEventListener('click',()=>startGame(selectedMode));$('again-button').addEventListener('click',()=>startGame(mode));$('restart-button').addEventListener('click',()=>startGame(mode));
 $('resume-button').addEventListener('click',()=>setPaused(false));$('pause-button').addEventListener('click',()=>setPaused(!paused));
 $('menu-button').addEventListener('click',showMenu);$('result-menu-button').addEventListener('click',showMenu);$('home-button').addEventListener('click',e=>{e.preventDefault();showMenu()});
 $('settings-button').addEventListener('click',()=>openSettings('drive'));$('pause-settings-button').addEventListener('click',()=>openSettings('drive'));$('credits-button').addEventListener('click',()=>openModal('info'));$('controls-button').addEventListener('click',()=>openModal('controls'));
 $('race-difficulty').addEventListener('change',e=>{settings.raceDifficulty=['rookie','club','pro'].includes(e.target.value)?e.target.value:'club';persist();selectMode(selectedMode);});
 $('race-laps').addEventListener('change',e=>{settings.raceLaps=[1,3,5].includes(Number(e.target.value))?Number(e.target.value):3;persist();selectMode(selectedMode);});
 $('quick-calibrate').addEventListener('click',()=>{openModal('controls');controlsPanel.selectTab('calibrate');focusControl(gameUI.control($('calibration-device')));});
 $('garage-button').addEventListener('click',openGarage);$('settings-garage-button').addEventListener('click',openGarage);
 $('assists-toggle').addEventListener('change',e=>{settings.assists=e.target.checked;persist();syncSettings()});$('telemetry-toggle').addEventListener('change',e=>{settings.telemetry=e.target.checked;persist();syncSettings()});
 $('transmission-select').addEventListener('change',e=>setTransmission(e.target.value));$('manual-clutch-toggle').addEventListener('change',e=>{inputManager.setConfig({manualClutch:e.target.checked});inputManager.saveConfig();syncSettings()});
 document.querySelectorAll('.close-modal').forEach(b=>b.addEventListener('click',closeModal));
 $('modal-wrap').addEventListener('click',e=>{if(e.target===$('modal-wrap')&&['settings','info','controls','garage'].includes(modalName))closeModal()});
 $('sound-button').addEventListener('click',()=>toggleSound());$('camera-button').addEventListener('click',cycleCamera);
 $('camera-select').addEventListener('change',e=>{settings.camera=Number(e.target.value);initialCamera=true;post.reset();syncSettings();persist()});
 $('blur-range').addEventListener('input',e=>{settings.blur=Number(e.target.value)/100;persist()});
 $('quality-select').addEventListener('change',e=>{settings.quality=e.target.value;resize();persist()});
 $('volume-range').addEventListener('input',e=>{settings.volume=Number(e.target.value)/100;audio.setVolume(settings.volume);persist()});
 for(const key of Object.keys(mixDefaults))$('audio-'+key).addEventListener('input',e=>{settings.audioMix[key]=clamp(Number(e.target.value)/100,0,1);syncAudioSettings();persist()});
 $('audio-reset').addEventListener('click',()=>{settings.audioMix={...mixDefaults};syncAudioSettings();persist()});
 $('audio-mix-toggle').addEventListener('click',e=>{const hidden=$('audio-mix').classList.toggle('hidden');e.currentTarget.setAttribute('aria-expanded',String(!hidden));e.currentTarget.lastElementChild.textContent=hidden?'+':'−';});
 document.querySelectorAll('[data-touch]').forEach(button=>{
  const key=button.dataset.touch;
  button.addEventListener('pointerdown',e=>{e.preventDefault();button.setPointerCapture(e.pointerId);inputManager.setTouch(key,true);button.classList.add('active')});
  for(const event of ['pointerup','pointercancel','lostpointercapture'])button.addEventListener(event,()=>{inputManager.setTouch(key,false);button.classList.remove('active')});
 });
 document.querySelectorAll('[data-shift]').forEach(button=>button.addEventListener('pointerdown',e=>{e.preventDefault();requestShift(button.dataset.shift==='up'?1:-1)}));
 window.addEventListener('pointerdown',()=>{if(phase==='playing'&&!paused&&!audio.started)audio.start().catch(()=>{})});
 window.addEventListener('blur',()=>markWindowFocus(false));window.addEventListener('focus',()=>markWindowFocus(true));
 document.addEventListener('visibilitychange',()=>markWindowFocus(!document.hidden&&document.hasFocus()));
 window.addEventListener('resize',resize);
 document.addEventListener('click',e=>{const button=e.target.closest?.('button');if(button){gameUI.press(button);if(!button.matches('[data-touch],[data-shift]'))audio.tick('ui');}});
 $('app').addEventListener('contextmenu',e=>e.preventDefault());
 $('lights-button').addEventListener('click',toggleLights);$('map-button').addEventListener('click',()=>modalName==='map'?closeModal():openModal('map'));$('service-button').addEventListener('click',interact);
 $('headlights-toggle').addEventListener('change',e=>{settings.headlights=e.target.checked;audio.playEvent?.('lightToggle',{intensity:.6});syncV6Settings();persist();});
 $('bloom-range').addEventListener('input',e=>{settings.bloom=Number(e.target.value)/100;persist();});
 $('time-select').addEventListener('change',e=>{settings.timeMode=e.target.value;persist();});$('day-length').addEventListener('input',e=>{settings.dayMinutes=Number(e.target.value);persist();});
 $('music-toggle').addEventListener('change',e=>{settings.music=e.target.checked;persist();});$('music-range').addEventListener('input',e=>{settings.musicVolume=Number(e.target.value)/100;persist();});
 $('pause-condition-button').addEventListener('click',()=>openVehicleCondition());$('condition-button').addEventListener('click',()=>openVehicleCondition());$('service-inspect').addEventListener('click',()=>openVehicleCondition({service:true}));
 $('service-garage').addEventListener('click',openGarage);$('service-fuel').addEventListener('click',()=>startService('fuel'));$('service-repair').addEventListener('click',()=>startService('repair'));$('service-nos').addEventListener('click',()=>startService('nitrous'));
 $('release-button').addEventListener('click',releaseFromStation);$('recovery-button').addEventListener('click',recoverVehicle);
 $('pause-map-button').addEventListener('click',()=>openModal('map'));$('pause-controls-button').addEventListener('click',()=>openModal('controls'));$('pause-audio-button').addEventListener('click',()=>openSettings('audio'));$('pause-guide-button').addEventListener('click',()=>openModal('guide'));
 document.querySelectorAll('[data-settings-tab]').forEach(button=>button.addEventListener('click',()=>selectSettingsTab(button.dataset.settingsTab,true)));
 $('look-sensitivity').addEventListener('input',e=>{settings.lookSensitivity=Number(e.target.value)/100;persist();});$('invert-look-toggle').addEventListener('change',e=>{settings.invertLook=e.target.checked;persist();});
 for(const [id,key] of [['vignette-range','vignette'],['shading-range','shading']])$(id).addEventListener('input',e=>{settings[key]=Number(e.target.value)/100;persist();});
 $('test-siren').addEventListener('click',async()=>{await audio.start();audio.playEvent?.('sirenTest',{intensity:1});});$('test-radio').addEventListener('click',async()=>{await audio.start();audio.playEvent?.('radio',{code:'check',message:'Dispatch to all units. Radio check.',intensity:1});});
 $('multiplayer-button').addEventListener('click',openLobby);$('pause-lobby-button').addEventListener('click',openLobby);$('pause-job-button').addEventListener('click',()=>{if(career.getState().active){trackJob();openModal('map');}else{acceptJob();setPaused(false);}});
 $('background-music-toggle').addEventListener('change',e=>{settings.backgroundMusic=e.target.checked;updateAudioFocus();persist();});
 $('display-select').addEventListener('change',e=>{settings.displayMode=e.target.value;resize();persist();});$('hud-inset').addEventListener('input',e=>{settings.hudInset=Number(e.target.value);applyDisplayFraming();persist();});
 setupMapControls();selectSettingsTab(settingsTab);

 selectMode(selectedMode);
}
function clearInputs(){inputManager?.clear();pendingShiftUp=false;pendingShiftDown=false;pendingNeutral=false;frameControls={steer:0,throttle:0,brake:0,clutch:0,handbrake:0,boost:false,starter:false,horn:false,lookBack:false,lookX:0,lookY:0};document.querySelectorAll('[data-touch]').forEach(b=>b.classList.remove('active'));}
function setTransmission(value){
 const cfg=inputManager.getConfig();inputManager.setConfig({transmission:value,...(value==='hpattern'?{shifter:{...cfg.shifter,enabled:true}}:{})});inputManager.saveConfig();syncSettings();toast({auto:'AUTOMATIC',sequential:'MANUAL · Q / E OR PADDLES',hpattern:'H-PATTERN · BIND GEARS IN SETTINGS'}[value]);
}
function requestShift(direction){if(phase!=='playing'||paused)return;if(activeInputConfig.transmission!=='sequential')setTransmission('sequential');if(direction>0)pendingShiftUp=true;else pendingShiftDown=true;}
function focusableControls(){return navigationControls(textKeyboard.active?textKeyboard.root:modalName?$(modalName+'-modal'):phase==='menu'?$('menu'):null);}
function focusControl(el){el=gameUI?.control(el)||el;if(!el)return;padFocus=el;screenNavigation.focus(el);}
function focusDefault(){if(!screenNavigation.scope&&phase==='menu'&&!modalName)screenNavigation.reset($('menu'));const list=focusableControls();const el=modalName==='arrest'?$('release-button'):modalName==='vehicle'?$('vehicle-tab-all'):modalName==='service'?($('service-repair').classList.contains('hidden')?$('service-fuel'):$('service-repair')):modalName==='map'?$('full-map'):modalName==='lobby'?$(network.connected?(network.playing?'lobby-resume':network.isHost?'lobby-start':'lobby-ready'):'lobby-create'):modalName==='pause'?$('resume-button'):modalName==='result'?$('again-button'):modalName==='settings'?$(settingsTab==='audio'?'volume-range':settingsTab==='visuals'?'quality-select':'camera-select'):modalName==='controls'?$('input-mode'):modalName==='garage'?$('garage-category-cars'):phase==='menu'?$('start-button'):null;const target=gameUI?.control(el)||el;focusControl(screenNavigation.preferred(target)||list.find(x=>!x.classList.contains('close-modal'))||list[0]);}
function moveFocus(direction,axis='vertical'){const list=focusableControls();if(!list.length)return;focusControl(nextFocus(list,document.activeElement,axis==='horizontal'?(direction<0?'left':'right'):(direction<0?'up':'down')));}
function adjustFocused(direction){const el=document.activeElement;if(!el)return;if(el.dataset.settingsTab){const tabs=['drive','visuals','audio'];selectSettingsTab(tabs[(tabs.indexOf(settingsTab)+direction+3)%3],true);return;}if(adjustRange(el,direction)||gameUI?.adjust(el,direction))return;if(el.tagName==='SELECT'){el.selectedIndex=clamp(el.selectedIndex+direction,0,el.options.length-1);el.dispatchEvent(new Event('change',{bubbles:true}));}else if(el.type==='checkbox'){el.checked=!el.checked;el.dispatchEvent(new Event('change',{bubbles:true}));}else moveFocus(direction,'horizontal');}
function chooseMode(direction){const modes=PLAY_MODES;selectedMode=modes[(modes.indexOf(selectedMode)+direction+modes.length)%modes.length];selectMode(selectedMode);const button=document.querySelector('[data-mode="'+selectedMode+'"]');focusControl(button);}
function processInputActions(actions){
 for(const action of actions){
  if(action==='deviceLost'){if(phase==='playing'||phase==='countdown')setPaused(true);toast('INPUT DEVICE DISCONNECTED · PAUSED');continue}
  if(textKeyboard.handleAction(action))continue;
  if(action==='mute'){toggleSound();continue}
  if(action==='lights'&&phase==='playing'&&!paused){toggleLights();continue}
  if(action==='interact'&&phase==='playing'&&!paused){interact();continue}
  if(action==='map'&&phase==='playing'){
   if(modalName==='map'){const panelFocus=focusableControls().find(el=>el.dataset.mapPlace!==undefined)||$('map-mark-cursor')||$('map-zoom-in');focusControl(document.activeElement===$('full-map')?panelFocus:$('full-map'));}
   else openModal('map');continue;
  }
  if(action==='home'){if(phase==='playing'||phase==='countdown')setPaused(!paused);continue}
  if(phase==='loading'){if(action==='back')showMenu();continue}
  if(modalName){
   if(modalName==='map'&&document.activeElement===$('full-map')&&['menuPrev','menuNext','menuLeft','menuRight','confirm','shiftUp','shiftDown'].includes(action)){
    if(action==='confirm'){const selected=gameUI.map.selection;placeWaypoint(selected?.point||mapView.cursor||state,selected?.name||'Waypoint');}else if(action==='shiftUp'||action==='shiftDown')mapView.changeZoom(action==='shiftUp'?1.2:1/1.2);else{mapView.moveCursor(action==='menuLeft'?-1:action==='menuRight'?1:0,action==='menuPrev'?-1:action==='menuNext'?1:0,world);const p=mapProjectionResult?.project(mapView.cursor.x,mapView.cursor.z);if(p&&(p.x<60||p.x>$('full-map').width-60||p.y<60||p.y>$('full-map').height-60)){mapView.x=mapView.cursor.x;mapView.z=mapView.cursor.z;}}drawFullMap();continue;
   }
   if(action==='shiftUp'||action==='shiftDown'){cycleTab($(modalName+'-modal'),action==='shiftUp'?1:-1,focusControl);continue;}
   if(action==='back'){if(modalName==='controls'&&(controlsPanel.wizard||controlsPanel.learning)){controlsPanel.cancel();controlsPanel.message('Setup cancelled.');}else if(modalName==='pause')setPaused(false);else if(modalName==='result')showMenu();else if(modalName==='arrest')releaseFromStation();else closeModal();}
   else if(action==='pause'&&modalName==='pause')setPaused(false);
   else if(action==='menuPrev')moveFocus(-1);else if(action==='menuNext')moveFocus(1);
   else if(action==='menuLeft')adjustFocused(-1);else if(action==='menuRight')adjustFocused(1);
   else if(action==='confirm'){const active=document.activeElement;if(active&&focusableControls().includes(active)){if(isTextEntry(active))textKeyboard.open(active);else if(active.type==='checkbox'){active.checked=!active.checked;active.dispatchEvent(new Event('change',{bubbles:true}));}else if(['BUTTON','A','SUMMARY'].includes(active.tagName))active.click();}else focusDefault();}
   continue;
  }
  if(phase==='menu'){
   if(action==='confirm'){const focused=document.activeElement;if(focused&&focusableControls().includes(focused))focused.click();else startGame(selectedMode);}else if(action==='menuPrev')moveFocus(-1);else if(action==='menuNext')moveFocus(1);else if(action==='menuLeft'){if(document.activeElement?.dataset?.selectId)adjustFocused(-1);else moveFocus(-1,'horizontal');}else if(action==='menuRight'){if(document.activeElement?.dataset?.selectId)adjustFocused(1);else moveFocus(1,'horizontal');}else if(action==='settings'||action==='pause')openSettings();else if(action==='garage')openGarage();continue;
  }
  if(action==='pause'||action==='back')setPaused(!paused);else if(action==='settings')openModal('settings');else if(action==='garage')openGarage();else if(action==='camera')cycleCamera();else if(action==='reset'&&phase==='playing')resetCar();else if(action==='transmission')setTransmission(activeInputConfig.transmission==='auto'?'sequential':'auto');else if(action==='shiftUp')requestShift(1);else if(action==='shiftDown')requestShift(-1);else if(action==='neutral'){if(activeInputConfig.transmission==='auto')setTransmission('sequential');pendingNeutral=true;}
 }
}
function cycleCamera(){settings.camera=(settings.camera+1)%3;audio.tick('ui');initialCamera=true;post.reset();syncSettings();persist();toast(['TOP-DOWN CAMERA','CHASE CAMERA','HOOD CAMERA'][settings.camera])}
async function toggleSound(){const wasStarted=audio.started;if(!await audio.start()){toast('AUDIO COULD NOT START');return;}muted=wasStarted?!muted:false;audio.setMuted(muted);$('sound-button').classList.toggle('muted',muted);$('sound-button').setAttribute('aria-label',muted?'Enable audio':'Mute audio');toast(muted?'SOUND OFF':'SOUND ON')}
function toast(text){$('toast').textContent=text;$('toast').classList.add('visible');toastTimer=2.6}
function comic(text,duration=.8){if(settings.blur===0&&matchMedia('(prefers-reduced-motion: reduce)').matches)return;$('comic-word').textContent=text;$('comic-word').classList.add('visible');comicTimer=duration}
function openModal(name){
 if(phase==='loading')return;
 if(name==='controls')controlsReturn=modalName==='pause'?'pause':'settings';
 if(name!=='controls'&&name!=='garage')returnToPause=paused;else if(!modalName||modalName==='pause')returnToPause=paused;
 paused=phase!=='menu';clearInputs();audio?.suspend(true);modalName=name;updateAudioFocus();
 if(name==='map'){mapPointer=null;mapView.cursor=mapView.cursor||{x:state.x,z:state.z};refreshMapPlaces();drawFullMap();}if(name==='lobby')lobbyPanel.render();if(name==='service')updateServiceUI();if(name==='vehicle')renderVehicleCondition();if(name==='controls')controlsPanel.show();if(name==='garage'){garagePanel.show(activeBuild);document.body.classList.add('garage-open');initialCamera=true;}
 showDialog(name);focusDefault();
}
function closeModal({resume=false}={}){
 if(textKeyboard.active){textKeyboard.close(false);return;}
 const previous=resume?null:screenNavigation.returnTarget();
 if(modalName==='vehicle')vehicleReturn=null;
 if(modalName==='arrest'){releaseFromStation();return;}if(modalName==='service'){serviceJob=null;audio.playEvent?.('service',{intensity:.15});persist();}
 if(modalName==='garage'){garagePanel.hide(true);document.body.classList.remove('garage-open');initialCamera=true;}
 if(modalName==='controls')controlsPanel.hide();
 if(previous&&previous.id!=='menu'){
  modalName=previous.id.replace(/-modal$/,'');paused=phase!=='menu';showDialog(modalName);if(modalName==='service')updateServiceUI();if(modalName==='settings')syncSettings();if(modalName==='controls')controlsPanel.show();focusDefault();clearInputs();updateAudioFocus();return;
 }
 modalName=null;hideDialog();paused=false;audio?.suspend(phase==='menu');clearInputs();lastNow=performance.now();post.reset();updateAudioFocus();if(phase==='playing')$('game').focus({preventScroll:true});else if(phase==='menu')focusDefault();
}
function setPaused(value){
 if(phase==='menu'||phase==='result'||phase==='loading'||phase==='arrested'||value===paused)return;
 paused=value;clearInputs();audio.suspend(value);post.reset();updateAudioFocus();
 if(value){modalName='pause';showDialog('pause');focusDefault();}else{modalName=null;hideDialog();lastNow=performance.now();$('game').focus({preventScroll:true});}
}
function showMenu(){
 leaveSession();career.teleport();handleCareerEvents();persist();serviceJob=null;vehicleReturn=null;transitionSerial++;controlsPanel?.hide();if(garagePanel?.open)garagePanel.hide(true);phase='menu';paused=false;modalName=null;clearInputs();hideDialog();gameUI?.finishLoading();
 $('hud').classList.add('hidden');gameUI?.enter($('menu'));$('touch-controls').classList.add('hidden');$('countdown').classList.add('hidden');document.body.classList.remove('playing','boosting','garage-open');checkpointGroup.visible=false;
 selectWorld('menu');physics.reset(world.spawn.x,world.spawn.z,world.spawn.heading);state=physics.state;resetPresentation();fx.reset();audio.suspend(true);audio.setTraffic?.([]);initialCamera=true;post.reset();menuOrbit=0;lastRoad=world.getRoadInfo(state.x,state.z);selectMode(selectedMode);focusDefault();updateInputPrompts(true);syncCareerUI();updateAudioFocus();
}
async function startGame(newMode,options={}){
 if(phase==='loading')return;
 if(!options.online)leaveSession();else{sessionTimeMode=settings.timeMode;awaitingWorld=!network.isHost;hostHold=false;networkWorld=null;networkWorldClock=0;}
 career.teleport();handleCareerEvents();
 const request=++transitionSerial;audio.start().catch(()=>{});controlsPanel?.hide();mode=PLAY_MODES.includes(newMode)?newMode:'free';phase='loading';paused=true;modalName=null;clearInputs();audio.suspend(true);updateAudioFocus();hideDialog();
 $('menu').classList.add('hidden');$('hud').classList.add('hidden');$('touch-controls').classList.add('hidden');
 gameUI.loading(mode==='free'?'NEON ARCHIPELAGO':'DOCK 09',mode==='free'?'PREPARING THE CITY':'PREPARING THE TRACK');
 let loadStage='city';
 try{
  await nextPaint();if(request!==transitionSerial)return;race?.dispose?.();race=null;raceState=null;raceRecovery=0;raceRetired=false;raceUI?.render(null);raceUI?.results(null);selectWorld(mode);resetWorldFeedback();
  loadStage='traffic';gameUI.loadingStatus(mode==='free'?'SETTING UP TRAFFIC AND SIGNALS':'PREPARING THE CAR AND START LINE');
  if(mode==='free'){traffic.reset();police.reset();enforcement.reset();policeState=police.getState();enforcementState=enforcement.getState();}
  if(mode==='race'){gameUI.loadingStatus('PREPARING THE STARTING GRID');race=createRace(scene,world,{count:5,laps:settings.raceLaps,difficulty:settings.raceDifficulty,playerName:settings.playerName,seed:1109});race.reset();raceState=race.getState();}
  let spawn=race?race.getPlayerSpawn():world.spawn;if(online()){const index=network.getState().players.findIndex(p=>p.id===network.id);if(index>0)spawn=world.getResetPose(spawn.x-Math.sin(spawn.heading)*9*index,spawn.z-Math.cos(spawn.heading)*9*index,spawn.heading);}
  loadStage='vehicle';physics.setDamageEnabled?.(!online()||network.rules.damage);physics.restart(spawn.x,spawn.z,spawn.heading,{neutral:activeInputConfig.transmission!=='auto'});state=physics.state;persist();lookYaw=0;lookPitch=0;resetPresentation();audio.update(state);fx.reset();initialCamera=true;post.reset();
  car.group.position.set(state.x,0,state.z);car.group.rotation.y=state.heading;car.update(state,0,totalTime);updateCamera(1,true);world.update(0,totalTime,state);
  await nextPaint();if(request!==transitionSerial)return;loadStage='shaders';gameUI.loadingStatus('FINISHING LIGHTING');if(renderer.compileAsync)await renderer.compileAsync(scene,camera);if(request!==transitionSerial)return;
  phase=mode==='free'?'playing':'countdown';paused=false;document.body.classList.add('playing');$('hud').classList.remove('hidden');if(isTouch)$('touch-controls').classList.remove('hidden');
  runTime=0;driftRemaining=90;score=0;comboPoints=0;comboDuration=0;comboGrace=0;nextCheckpoint=0;completedCheckpoints=0;lapArmed=false;countdownTime=3.15;previousCountdown=4;accumulator=0;offroadTimer=0;previousBoost=false;distanceDriven=0;lastDistrict='';discoveredDistricts=new Set();
  lastRoad=world.getRoadInfo(state.x,state.z);$('mode-label').textContent={free:'CITY FREE ROAM',race:'CLUB RACE',sprint:'TIME ATTACK',drift:'DRIFT RUSH'}[mode];$('checkpoint-label').classList.toggle('hidden',!['sprint','race'].includes(mode));$('countdown').classList.toggle('hidden',phase!=='countdown');ui.combo.classList.remove('visible');updateCheckpoint();
  gameUI.finishLoading();gameUI.enter($('run-panel'));audio.setMuted(muted);audio.suspend(false);$('game').focus({preventScroll:true});syncSettings();lastNow=performance.now();
  if(mode==='free')toast(online()?'CITY SESSION · '+network.getState().code:'NEON ARCHIPELAGO · FREE ROAM');syncCareerUI();updateAudioFocus();
 }catch(error){if(request!==transitionSerial)return;if(options.online)network.failStart(error,{stage:loadStage});showMenu();if(options.online){openLobby();toast(network.lastIssue?.message||'The city could not start. See the lobby for details.');}else toast('COULD NOT START: '+(error?.message||error));console.error(error);}
}
function resetCar(){
 career.teleport();handleCareerEvents();let position;
 if(mode==='race'&&race){position=race.getPlayerRecoveryPose();race.markPlayerReset(position);raceRecovery=5;}
 else if(world.kind==='city')position=world.getResetPose(state.x,state.z,state.heading);
 else{const progress=lastRoad?.progress??.985,p=world.curve.getPointAt(progress),t=world.curve.getTangentAt(progress);position={x:p.x,z:p.z,heading:Math.atan2(t.x,t.z)};}
 const retainedBoost=state.boost;physics.reset(position.x,position.z,position.heading,{neutral:activeInputConfig.transmission!=='auto'});state=physics.state;state.boost=Math.min(retainedBoost,.55);resetPresentation();audio.update(state);fx.reset();initialCamera=true;post.reset();offroadTimer=0;comboPoints=0;comboGrace=0;comboDuration=0;
 if(mode==='race'&&race){toast('BACK TO LAST SECTOR · 5 SECOND HOLD');inputManager.feedbackEvent?.('mechanicalWarning',.4);}
 else if(mode==='sprint'&&lapArmed){runTime+=3;toast('RESET TO TRACK · +3 SECONDS')}else toast(world.kind==='city'?'RESET TO ROAD':'RESET TO TRACK');
}
function updateCheckpoint(){
 checkpointGroup.visible=['sprint','race'].includes(mode)&&phase!=='menu'&&phase!=='result';
 if(!checkpointGroup.visible)return;const index=mode==='race'?(raceState?.nextCheckpoint??0):nextCheckpoint,cp=world.checkpoints[index]||world.checkpoints[0];checkpointGroup.position.set(cp.x,0,cp.z);checkpointGroup.rotation.y=cp.heading;
 $('checkpoint-text').textContent=mode==='race'?(index===0?'START / FINISH':'CHECKPOINT '+index+' / 7'):!lapArmed?'CROSS THE START LINE':nextCheckpoint===0?'FINISH LINE':'CHECKPOINT '+nextCheckpoint+' / 7';
}
function inputState(){
 const controls={...frameControls,steer:-(frameControls.steer||0),transmission:activeInputConfig.transmission,manualClutch:!!activeInputConfig.manualClutch,assists:settings.assists,deviceKind:inputManager.getPresentation().kind,shiftUp:pendingShiftUp,shiftDown:pendingShiftDown};
 if(activeInputConfig.transmission!=='hpattern')delete controls.gearRequest;
 if(pendingNeutral)controls.gearRequest=0;
 pendingShiftUp=false;pendingShiftDown=false;pendingNeutral=false;
 return controls;
}
function resolveCollisions(previousPosition,dt=1/120){
 const colliders=world.kind==='city'?[...(world.getColliders?.(state,60)||world.colliders),...traffic.getColliders(state),...(police?.getColliders(state)||[]),...(online()&&network.rules.collisions==='solid'?networkCars.getColliders(state):[])]:[...world.colliders,...(race?.getColliders(state)||[])];
 const hit=resolveVehicleContacts(state,colliders,activeBuild,{dt,previousPosition});
 for(const contact of hit.contacts){
  if(contact.impulse>0||contact.normalImpulse>0){state.lastImpactLocal=contact.localPoint;const result=physics.applyImpact?.(contact);if(result?.detached?.length)audio.playEvent?.('wheelLoss',{x:contact.point?.x,z:contact.point?.z,intensity:1});}
  if(race)race.onPlayerContact(contact);
  if(world.kind==='city'){if(worldAuthority()){if(contact.collider.kind==='traffic')traffic.onPlayerContact(contact);else if(contact.collider.kind==='police')police?.onPlayerContact(contact);if(contact.closingSpeed>2)crimeContacts.push({...contact,playerId:localPlayerId()});}}
 }
 if(hit.collided){
  const sn=Math.sin(state.heading),cs=Math.cos(state.heading);
  state.speed=Math.hypot(state.vx,state.vz);state.forwardSpeed=state.vx*sn+state.vz*cs;state.lateralSpeed=state.vx*cs-state.vz*sn;
  if(collisionCooldown<=0&&hit.maxClosingSpeed>2){
   const contact=hit.contacts.reduce((best,c)=>c.closingSpeed>(best?.closingSpeed||0)?c:best,null),point=contact?.point||state;
   const intensity=Math.min(1,hit.maxClosingSpeed/25);
   fx.impact(point.x,point.z,intensity);audio.impact(intensity,{material:contact?.collider?.material||'metal',x:point.x,z:point.z});
   inputManager.rumble?.(Math.min(.75,hit.maxClosingSpeed/30),130);camShake=Math.min(.8,hit.maxClosingSpeed*.025);collisionCooldown=.45;
   if(comboPoints>0){comboPoints=0;comboDuration=0;comboGrace=0;comic('OUCH!',.5)}
  }
 }
 const bounds=world.bounds,margin=world.kind==='city'?2:20;
 if(world.getSurfaceAt(state.x,state.z).material==='water'||state.x<bounds.minX+margin||state.x>bounds.maxX-margin||state.z<bounds.minZ+margin||state.z>bounds.maxZ-margin){offroadTimer+=dt;if(offroadTimer>1)resetCar()}else offroadTimer=0;
}
function tickCityAgents(dt){
 const player=localAIPlayer(),players=remoteAIPlayers();if(paused||phase==='arrested'){player.vx=player.vz=player.speed=player.forwardSpeed=player.throttle=0;player.horn=false;}
 if(worldAuthority()){
  if(online()&&network.isHost)crimeContacts.push(...remoteContacts.update(network.getRemotePlayers(),{traffic,police,now:performance.now()}));
  traffic.update(dt,player,{players,emergency:police.states?.filter(c=>c.active!==false&&c.siren)||[],night:environment.night});police.update(dt,player,{players,contacts:crimeContacts,night:environment.night});crimeContacts=[];enforcement?.update(dt,player,{police,players});
  for(const event of [...(enforcement?.consumeEvents()||[]),...(traffic.consumeEvents?.()||[])]){if(online())network.broadcastEvent(event.type,event);handleCityEvent(event);}
 }else{traffic.advanceSnapshot(dt);police.advanceSnapshot(dt);enforcement?.update(dt,player,{});enforcement?.consumeEvents();}
 enforcementState=enforcement?.getState()||enforcementState;
 if(police){policeState=localPoliceState(police.getState());if(worldAuthority())for(const event of police.consumeEvents()){if(online())network.broadcastEvent(event.type,event);handlePoliceEvent(event);}}
}
function tickGameplay(dt){
 const road=world.getRoadInfo(state.x,state.z);lastRoad=road;
 const previousPosition={x:state.x,z:state.z,heading:state.heading};
 if(world.kind==='city')tickCityAgents(dt);if(phase!=='playing')return;
 const input=inputState();if(raceRecovery>0){raceRecovery=Math.max(0,raceRecovery-dt);Object.assign(input,{throttle:0,brake:1,handbrake:1,clutch:1,manualClutch:true,steer:0,boost:false,shiftUp:false,shiftDown:false});}
 state=physics.update(dt,input,road.grip);distanceDriven+=state.speed*dt;resolveCollisions(previousPosition,dt);handleMechanicalEvents();presentation.push(state);collisionCooldown=Math.max(0,collisionCooldown-dt);
 if(phase!=='playing')return;career.update(dt,state,{active:true,police:policeState});handleCareerEvents();
 if(mode==='race'&&race){
  race.update(dt,localAIPlayer(),{racing:true});raceState=race.getState();runTime=raceState.elapsed;nextCheckpoint=raceState.nextCheckpoint??0;updateCheckpoint();
  for(const event of race.consumeEvents()){if(event.type==='lap'){if(event.isPlayer!==false&&(event.id===undefined||event.id==='player'||event.player)){toast('LAP '+Math.min(raceState.playerLap,raceState.laps)+' / '+raceState.laps);audio.tick('checkpoint');inputManager.feedbackEvent?.('objective',.4);}}else if(event.type==='overtake'&&(event.isPlayer!==false)){inputManager.feedbackEvent?.('nearMiss',.35);}}
  if(raceState.playerFinished){finishRun();return;}
 }else if(mode==='free'||mode==='drift'||lapArmed)runTime+=dt;
 if(mode==='drift'){driftRemaining=Math.max(0,90-runTime);if(driftRemaining<=0){bankCombo();finishRun();return}}
 if(state.drifting&&state.speed>6&&(world.kind==='city'?road.onRoad:road.distance<17)){
  comboDuration+=dt;comboGrace=1.4;const multiplier=Math.min(5,1+comboDuration*.22);comboPoints+=dt*state.speed*(.6+Math.abs(state.driftAngle)*2.7)*multiplier*9;
 }else if(comboPoints>0){comboGrace-=dt;if(comboGrace<=0)bankCombo()}
 if(mode==='sprint'){
  const cp=world.checkpoints[nextCheckpoint],dx=state.x-cp.x,dz=state.z-cp.z;
  const approach=state.vx*Math.sin(cp.heading)+state.vz*Math.cos(cp.heading);
  if(Math.hypot(dx,dz)<13&&approach>1){
   if(!lapArmed){lapArmed=true;runTime=0;nextCheckpoint=1;toast('TIMER STARTED');audio.tick('start')}
   else if(nextCheckpoint===0&&completedCheckpoints>=7){finishRun();return}
   else{completedCheckpoints++;nextCheckpoint=(nextCheckpoint+1)%8;audio.tick('checkpoint');toast(nextCheckpoint===0?'FINAL SECTOR':'CHECKPOINT '+completedCheckpoints+' / 7')}
   updateCheckpoint();
  }
 }
 if(state.boosting&&!previousBoost){comic('NOS!',.7);camShake=.07;}previousBoost=state.boosting;
}
function toggleLights(){settings.headlights=!settings.headlights;audio.playEvent?.('lightToggle',{intensity:.65});syncV6Settings();persist();toast(settings.headlights?'HEADLIGHTS ON':'HEADLIGHTS OFF');}
function nearestService(){let closest=null;for(const service of world.services||[]){const distance=Math.hypot(state.x-service.x,state.z-service.z);if(distance<=(service.radius||8)&&(!closest||distance<closest.distance))closest={...service,distance};}return closest;}
function interact(){
 if(mode==='race'&&race&&phase==='playing'){toast('Service is available after the race.');return;}
 const service=nearestService();if(!service){if(career.getState().active)trackJob();else acceptJob();return;}if(state.speed>.8){toast('Stop inside the marked service bay.');return;}if(['chase','search'].includes(policeState.phase)){toast('Lose the police before stopping for service.');return;}
 if(service.kind==='police'){toast('POLICE STATION');return;}serviceTarget=service;openModal('service');
}
function openVehicleCondition({service=false}={}){
 if(phase==='loading')return;vehicleReturn=service&&serviceTarget?'service':modalName==='pause'?'pause':null;vehiclePanelClock=0;openModal('vehicle');
}
function renderVehicleCondition(){
 vehiclePanel?.render(state,activeBuild,{service:vehicleReturn==='service'&&serviceTarget?.kind==='garage',busy:!!serviceJob,progress:serviceJob?serviceJob.elapsed/serviceJob.duration:0,jobLabel:serviceJob?.label||'REPAIRING',completed:vehicleReturn==='service'&&!!serviceTarget?.completed});
}
function startComponentService(ids,label){
 if(serviceJob||modalName!=='vehicle'||vehicleReturn!=='service'||serviceTarget?.kind!=='garage'||state.speed>.8||['chase','search'].includes(policeState.phase))return false;
 const available=new Set((state.mechanical?.components||[]).filter(part=>part.applicable!==false).map(part=>part.id));
 if(!Array.isArray(ids)||!ids.length||ids.some(id=>id!=='fluids'&&!available.has(id)))return false;
 serviceTarget.completed=false;serviceJob={type:'components',ids:[...ids],label:String(label||'REPAIRING'),elapsed:0,duration:ids.includes('fluids')?1.8:2.8};audio.playEvent?.('service',{x:state.x,z:state.z,intensity:.65});renderVehicleCondition();return true;
}
function handleMechanicalEvents(){
 const events=physics.consumeMechanicalEvents?.()||[];if(!events.length)return;
 const severe=events.find(event=>['critical','failure','danger'].includes(event.severity)),event=severe||events.find(event=>event.severity!=='info');
 if(event){const failed=/(?:^|-)failed$/.test(event.code||'')||event.code==='tyre-blowout'||['engine-failure','drive-failure','clutch-failure'].includes(event.component);toast(event.message||'Check vehicle condition.');audio.playEvent?.(failed?'mechanicalFailure':'mechanicalWarning',{intensity:severe?.8:.45});inputManager.feedbackEvent?.(failed?'mechanicalFailure':'mechanicalWarning',severe?.8:.45);}
 persist();
}
function updateMechanicalHUD(){
 const m=state.mechanical,warning=primaryMechanicalWarning(state),temperature=value=>Number.isFinite(value)?Math.round(value)+'°C':'?';
 $('coolant-readout').textContent=temperature(m?.temperatures?.coolant);$('oil-readout').textContent=temperature(m?.temperatures?.oil);$('clutch-readout').textContent=temperature(m?.temperatures?.clutch);
 $('condition-button').classList.toggle('warning',!!warning);$('mechanical-warning').classList.toggle('hidden',!warning);$('mechanical-warning').classList.toggle('critical',['critical','failure','danger'].includes(warning?.severity));
 $('mechanical-warning-title').textContent=warning?.label||'';$('mechanical-warning-reason').textContent=warning?.reason||'';
}
function updateServiceUI(){
 if(!serviceTarget)return;$('service-name').textContent=serviceTarget.name;$('service-description').textContent=serviceTarget.kind==='fuel'?'Fill the tank. Your current fuel level is shown below.':'Repair the whole car, inspect individual parts, or refill NOS.';
 $('service-fuel').classList.toggle('hidden',serviceTarget.kind!=='fuel'&&world.kind==='city');$('service-repair').classList.toggle('hidden',serviceTarget.kind==='fuel');$('service-nos').classList.toggle('hidden',serviceTarget.kind==='fuel');$('service-garage').classList.toggle('hidden',serviceTarget.kind==='fuel');
 $('service-inspect').classList.toggle('hidden',serviceTarget.kind!=='garage');
 $('service-status').textContent=`FUEL ${(state.fuelLitres??0).toFixed(1)} / ${state.fuelCapacity??55} L · ENGINE ${Math.round((state.engineHealth??1)*100)}% · BODY ${Math.round((state.bodyHealth??1)*100)}%`;
 for(const id of ['service-fuel','service-repair','service-nos','service-garage','service-inspect'])$(id).disabled=!!serviceJob;
 $('service-progress').style.setProperty('--progress',String(serviceJob?Math.min(1,serviceJob.elapsed/serviceJob.duration):serviceTarget.completed?1:0));
 $('service-progress-label').textContent=serviceJob?({fuel:'REFUELING',repair:'REPAIRING',nitrous:'REFILLING NOS',components:serviceJob?.label||'REPAIRING'}[serviceJob.type])+' '+Math.round(serviceJob.elapsed/serviceJob.duration*100)+'%':serviceTarget.completed?'SERVICE COMPLETE':'Select a service. Work is free.';
}
function startService(type){if(serviceJob||!serviceTarget)return;serviceTarget.completed=false;const duration=type==='fuel'?Math.max(.6,((state.fuelCapacity||55)-(state.fuelLitres||0))/5):type==='repair'?4.2:1.5;serviceJob={type,elapsed:0,duration};audio.playEvent?.(type==='fuel'?'refuel':'service',{x:state.x,z:state.z,intensity:.75});updateServiceUI();}
function updateServiceJob(dt){
 if(modalName!=='service'&&!(modalName==='vehicle'&&vehicleReturn==='service')){serviceJob=null;return;}const job=serviceJob;if(!job)return;job.elapsed=Math.min(job.duration,job.elapsed+dt);if(job.type==='fuel')physics.refuel(dt*5);
 if(job.elapsed>=job.duration){if(job.type==='repair')physics.repair();else if(job.type==='components')physics.repairComponents(job.ids);else if(job.type==='nitrous')physics.service({refillNitrous:true});state=physics.state;resetPresentation();audio.update(state);audio.playEvent?.('service',{intensity:.6});serviceJob=null;serviceTarget.completed=true;car.update(state,0,totalTime);persist();toast(job.type==='components'?'SERVICE COMPLETE · '+job.label:'READY TO DRIVE');if(modalName==='vehicle')renderVehicleCondition();}
 updateServiceUI();
}
function recoverVehicle(){
 if(mode==='race'&&race){raceRetired=true;race.retirePlayer?.();finishRun();return;}
 if(['chase','search'].includes(policeState.phase)){toast('Recovery is unavailable during a police pursuit.');return;}
 career.teleport();handleCareerEvents();serviceJob=null;let target=(world.services||[]).filter(s=>s.kind===(state.fuelStarved?'fuel':'garage')).sort((a,b)=>Math.hypot(a.x-state.x,a.z-state.z)-Math.hypot(b.x-state.x,b.z-state.z))[0];
 if(!target)target=(world.services||[]).find(s=>s.kind==='garage');if(!target){resetCar();setPaused(false);return;}
 const pose=target.spawn||target;physics.reset(pose.x,pose.z,pose.heading||0);state=physics.state;if(!online())police?.reset();policeState=police?localPoliceState(police.getState()):null;policeState=policeState||{phase:'patrol',heat:0,officers:[]};resetWorldFeedback();phase='playing';paused=false;modalName=null;hideDialog();clearInputs();resetPresentation();audio.update(state);audio.suspend(false);initialCamera=true;post.reset();serviceTarget=target;openModal('service');toast('RECOVERED TO '+target.name);persist();
}
function handlePoliceEvent(event){
 if(event.type==='radio'){queueDispatch(event);return;}
 if(event.targetId&&event.targetId!==localPlayerId())return;
 career.onPolice(event);handleCareerEvents();
 if(event.type==='pursuit'){escapeMusic=0;toast('POLICE PURSUIT · '+(event.reason||'PULL OVER'));audio.playEvent?.('pursuit',{intensity:.75});inputManager.feedbackEvent?.('pursuit',.8);}
 else if(event.type==='search')toast('SEARCHING · STAY OUT OF SIGHT');
 else if(event.type==='escaped'){escapeMusic=10;audio.playEvent?.('escape',{intensity:.9});inputManager.feedbackEvent?.('escape',.85);toast('PURSUIT ENDED');}
 else if(event.type==='arrest'){
  if(garagePanel?.open){garagePanel.hide(true);document.body.classList.remove('garage-open');}controlsPanel?.hide();serviceJob=null;arrestStation=event.station||(world.services||[]).find(s=>s.kind==='police')?.spawn||world.spawn;phase='arrested';paused=true;clearInputs();audio.suspend(true);audio.playEvent?.('arrest',{intensity:.75});modalName='arrest';showDialog('arrest');updateAudioFocus();focusDefault();
 }
}

function releaseFromStation(){
 if(!arrestStation)return;career.teleport();handleCareerEvents();const p=arrestStation;physics.reset(p.x,p.z,p.heading||0);physics.repair();if(physics.state.fuelLitres<8)physics.refuel(8-physics.state.fuelLitres);state=physics.state;if(!online())police?.reset();policeState=police?localPoliceState(police.getState()):null;policeState=policeState||{phase:'patrol',heat:0,officers:[]};resetWorldFeedback();phase='playing';paused=false;modalName=null;arrestStation=null;hideDialog();clearInputs();resetPresentation();fx.reset();audio.update(state);audio.suspend(false);initialCamera=true;post.reset();toast('RELEASED · VEHICLE RECOVERED');persist();
}
function updateVehicleHUD(){
 updateMechanicalHUD();
 $('fuel-value').textContent=(state.fuelLitres??0).toFixed(1)+' L';$('fuel-fill').style.transform='scaleX('+Math.max(0,(state.fuelLitres??0)/(state.fuelCapacity||55))+')';$('fuel-meter').classList.toggle('warning',(state.fuelLitres??55)<7);
 $('engine-health').textContent=Math.round((state.engineHealth??1)*100)+'%';$('body-health').textContent=Math.round((state.bodyHealth??1)*100)+'%';$('condition-line').classList.toggle('warning',(state.engineHealth??1)<.45||state.wheelAttached?.includes(false));
 $('wheel-warning').textContent=state.wheelAttached?.includes(false)?'WHEEL LOST':state.engineFault||'';$('clock-value').textContent=environment.getClock();
 const wanted=['chase','search'].includes(policeState.phase);document.body.classList.toggle('police-active',wanted);$('police-hud').classList.toggle('hidden',!wanted);$('police-phase').textContent=policeState.phase==='search'?'POLICE SEARCH':'POLICE PURSUIT';$('police-heat').textContent='★'.repeat(clamp(Math.ceil(policeState.heat||1),1,3));$('arrest-fill').style.transform='scaleX('+Math.max(0,Math.min(1,policeState.arrestProgress||0))+')';$('arrest-label').textContent=policeState.arrestProgress>0?'PULL OVER · '+Math.round(policeState.arrestProgress*100)+'%':'LEAVE THEIR SIGHT';
 $('police-units').textContent=(policeState.activeCount??3)+' UNITS'+(policeState.nightShift?' · NIGHT SHIFT':'');$('police-state-detail').textContent=policeState.phase==='search'?Math.ceil(policeState.searchRemaining??0)+' SEC SEARCH':policeState.nearestOfficerDistance!=null?Math.round(policeState.nearestOfficerDistance)+' M TO NEAREST UNIT':'VISUAL CONTACT';
 if(policeState.phase==='search'){$('arrest-label').textContent='STAY OUT OF SIGHT';$('arrest-fill').style.transform='scaleX('+clamp(policeState.searchProgress??0,0,1)+')';}
 const cameraZone=enforcementState.nearbyCamera;$('road-status').classList.toggle('hidden',!cameraZone||!cameraZone.approaching||cameraZone.distance>140);if(cameraZone){$('speed-limit').textContent=cameraZone.limitKph;$('speed-zone').textContent=cameraZone.name+' · '+Math.round(cameraZone.distance)+' M';$('road-status').classList.toggle('over-limit',state.speed*3.6>cameraZone.limitKph+3);}
 const nearby=phase==='playing'&&!paused&&mode!=='race'?nearestService():null;$('service-prompt').classList.toggle('hidden',!nearby||nearby.kind==='police');if(nearby)$('service-prompt-label').textContent=(state.speed>.8?'STOP FOR ':'')+nearby.name;
}
function bankCombo(){if(comboPoints<10){comboPoints=0;comboDuration=0;comboGrace=0;return}const points=Math.floor(comboPoints);score+=points;career.bankDrift(points);handleCareerEvents();if(mode==='free'&&score>records.free){records.free=score;persist()}toast('DRIFT BANKED +'+int(points));if(points>2500)comic('CLEAN!',.65);comboPoints=0;comboDuration=0;comboGrace=0;}
function finishRun(){
 if(phase==='result')return;
 if(mode==='race'&&race){finishRace();return;}
 raceUI?.results(null);bankCombo();if(mode==='sprint'&&completedCheckpoints>=7)career.award(2500,'LAP COMPLETE','race');else if(mode==='drift'&&runTime>=89)career.award(1000,'SESSION COMPLETE','race');handleCareerEvents();phase='result';paused=true;clearInputs();audio.tick('finish');audio.suspend(true);checkpointGroup.visible=false;
 let best=false;
 if(mode==='sprint'){best=records.sprint===null||runTime<records.sprint;if(best)records.sprint=runTime;$('result-value').textContent=formatTime(runTime);$('result-description').textContent='Dock 09 lap complete. Best time: '+formatTime(records.sprint)+'.';}
 else{best=score>records.drift;if(best)records.drift=score;$('result-value').textContent=int(score)+' PTS';$('result-description').textContent='90-second drift session. Your record: '+int(records.drift)+' points.';}
 persist();$('result-eyebrow').textContent=best?'NEW PERSONAL BEST':'SESSION COMPLETE';$('result-title').textContent=best?'NEW RECORD.':'RUN COMPLETE.';modalName='result';showDialog('result');focusDefault();
}
function finishRace(){
 const outcome=race.getState();if(!raceRetired&&!outcome.playerFinished)return;
 raceState=outcome;runTime=outcome.elapsed;const place=outcome.playerPosition||6;
 const reward=raceRetired?0:Math.round(([8000,6200,4700,3500,2400,1600][Math.min(5,Math.max(0,place-1))])*({rookie:.75,club:1,pro:1.3}[settings.raceDifficulty]||1)*(settings.raceLaps/3));
 bankCombo();if(reward){career.award(reward,'RACE FINISH','race');if(place===1)records.raceWins++;}handleCareerEvents();
 phase='result';paused=true;clearInputs();audio.tick('finish');audio.suspend(true);checkpointGroup.visible=false;raceUI?.render(null);
 $('result-value').textContent=raceRetired?'DNF':ordinal(place)+' / '+outcome.entries.length;
 $('result-description').textContent=raceRetired?'Race retired. Your car keeps its condition. Starting a new run restores your car.':formatTime(runTime)+' · '+settings.raceLaps+' laps · '+settings.raceDifficulty.toUpperCase()+'. Start a new run with a restored car.';
 $('result-eyebrow').textContent=raceRetired?'RACE RETIRED':place===1?'RACE WINNER':'RACE COMPLETE';$('result-title').textContent=raceRetired?'BACK TO THE GARAGE.':place===1?'FIRST HOME.':'FINISH LINE.';
 raceUI?.results(outcome,{retired:raceRetired,reward});persist();modalName='result';showDialog('result');focusDefault();updateAudioFocus();
}

function updateCamera(dt,snap=false){
 const lookInput=phase==='playing'&&!paused;const yawTarget=lookInput?(frameControls.lookBack?Math.PI:-(frameControls.lookX||0)*2.25*(settings.lookSensitivity??1)*(settings.invertLook?-1:1)):0,pitchTarget=lookInput?(frameControls.lookY||0)*.45:0;
 lookYaw+=wrap(yawTarget-lookYaw)*(1-Math.exp(-13*dt));lookPitch=smooth(lookPitch,pitchTarget,13,dt);if(Math.abs(lookYaw)<.0001)lookYaw=0;
 const view=visualState(),rush=Math.pow(clamp(view.speed/65,0,1),.82),nos=view.boosting?(view.nitrousIntensity??1):0;
 if(initialCamera||snap)camHeading=view.heading;
 const x=view.x,z=view.z,model=(garagePanel?.open?garagePanel.draft:activeBuild).vehicle.model,bodyY=(view.bodyHeight||0)+activeBuild.physics.rideHeight;forward.set(Math.sin(view.heading),0,Math.cos(view.heading));camera.up.set(0,1,0);
 if(phase==='menu'||modalName==='garage'){
  menuOrbit+=dt*.035;const offsetAngle=view.heading+.56+Math.sin(menuOrbit)*.12;
  const portrait=innerWidth<650&&innerHeight>innerWidth;
  const garage=modalName==='garage',category=garagePanel?.category,detail=garage&&!['cars','engine'].includes(category),rear=['exhaust','differential','gearing'].includes(category),distance=(portrait?12.4:detail?8.2:10.8)*Math.max(1,model.length/4.5);
  const orbit=offsetAngle+(rear?2.4:0);desiredPosition.set(x+Math.sin(orbit)*distance,(portrait?6.8:detail?3.6:4.8)+(view.groundHeight||0),z+Math.cos(orbit)*distance);
  const side=new THREE.Vector3(Math.cos(offsetAngle),0,-Math.sin(offsetAngle));
  desiredLook.set(x,(garage?(innerWidth<=900?-1.4:-.9):portrait?-.6:.55)+(view.groundHeight||0),z).addScaledVector(side,garage?0:portrait?-.15:-2.3);
  camera.fov=smooth(camera.fov,portrait?52:47,5,dt);
 }else if(settings.camera===0){
  const ahead=clamp(view.speed*.25,0,9);const height=30+Math.min(7,view.speed*.11)+nos*1.6;
  desiredPosition.set(x+Math.sin(lookYaw)*(16+view.speed*.02),height+lookPitch*7,z+Math.cos(lookYaw)*(16+view.speed*.02));desiredLook.set(x+view.vx*.29,.05,z+view.vz*.29-ahead*.08);
  camera.fov=smooth(camera.fov,47+Math.min(6,view.speed*.08)+(view.boosting?3:0),3,dt);
 }else{
  camHeading+=wrap(view.heading-camHeading)*(1-Math.exp(-(settings.camera===2?20:4.2)*dt));
  const f=new THREE.Vector3(Math.sin(camHeading+lookYaw),0,Math.cos(camHeading+lookYaw)),mount=new THREE.Vector3(Math.sin(camHeading),0,Math.cos(camHeading));
  if(settings.camera===1){desiredPosition.set(x,bodyY+2.6+rush*.48+lookPitch*2,z).addScaledVector(f,-6.6-rush*3.1-nos*1.2);desiredLook.set(x,bodyY+1.15-lookPitch*5,z).addScaledVector(f,11+nos*2).add(new THREE.Vector3(view.vx*.08,0,view.vz*.08));camera.fov=smooth(camera.fov,61+rush*17+nos*10,5,dt);}
  else{const hoodHeight=model.height*.91,pitch=view.bodyPitch||0,roll=(view.bodyRoll||0)*.65;desiredPosition.set(x,bodyY+hoodHeight-pitch*activeBuild.physics.frontAxle,z).addScaledVector(mount,activeBuild.physics.frontAxle*.87);desiredLook.set(x,bodyY+hoodHeight+.08-pitch*18-lookPitch*18,z).addScaledVector(f,28);camera.up.set(-Math.cos(camHeading)*Math.sin(roll),Math.cos(roll),Math.sin(camHeading)*Math.sin(roll));camera.fov=smooth(camera.fov,73+rush*13+nos*9,5,dt);}
 }
 if(initialCamera||snap){camera.position.copy(desiredPosition);cameraLook.copy(desiredLook);camHeading=view.heading;initialCamera=false;post?.reset()}
 else{
  // Follow translation directly; smooth camera offsets and direction instead.
  // Smoothing world coordinates made chase distance grow by speed / stiffness.
  if(phase!=='menu'&&modalName!=='garage'){const dx=view.x-cameraAnchor.x,dz=view.z-cameraAnchor.z;camera.position.x+=dx;camera.position.z+=dz;cameraLook.x+=dx;cameraLook.z+=dz;}
  const stiffness=phase==='menu'?2:settings.camera===2?22:settings.camera===0?8:9;camera.position.lerp(desiredPosition,1-Math.exp(-stiffness*dt));cameraLook.lerp(desiredLook,1-Math.exp(-10*dt));
 }
 cameraAnchor.x=view.x;cameraAnchor.z=view.z;
 camShake=smooth(camShake,0,8,dt);if(camShake>.002&&settings.blur>0){camera.position.x+=Math.sin(totalTime*71)*camShake;camera.position.y+=Math.cos(totalTime*83)*camShake*.45;}
 camera.lookAt(cameraLook);camera.updateProjectionMatrix();

}
function updateHUD(){
 instruments?.update(state,activeBuild.stats.redlineRpm);
 const kph=Math.round(state.speed*3.6);ui.speed.textContent=String(kph).padStart(3,'0');ui.gear.textContent=state.gear===-1?'R':state.gear===0?'N':state.gear;
 $('gear-mode').textContent={auto:'AUTO',sequential:'MAN',hpattern:'H'}[activeInputConfig.transmission]||'AUTO';$('handbrake-status').classList.toggle('active',state.handbrake>.05);$('clutch-status').classList.toggle('active',state.clutch>.35);document.body.classList.toggle('handbrake-on',state.handbrake>.05);
 updateInputPrompts();
 if(state.shiftRejected&&state.shiftMessage&&state.shiftMessage!==lastShiftMessage){toast(state.shiftMessage);lastShiftMessage=state.shiftMessage;}if(!state.shiftRejected)lastShiftMessage='';
 ui.rpm.style.transform='scaleX('+clamp(state.rpm/(activeBuild.stats.redlineRpm+400),0,1)+')';ui.rpm.style.background=state.rpm>activeBuild.stats.redlineRpm-350?'#ff79b3':'#f3f0e5';ui.rpmLabel.textContent=Math.round(state.rpm/10)*10+' RPM';
 ui.boost.style.transform='scaleX('+state.boost+')';$('nos-value').textContent=Math.round(state.boost*100)+'%';$('nos-state').textContent=state.boosting?'NOS ACTIVE':state.boost<.1?'DRIVE TO RECHARGE':'NITROUS OXIDE';ui.diff.textContent=activeBuild.physics.driveLayout+' · '+(activeBuild.selection.differential==='open'?'OPEN DIFF':'LSD '+Math.round(state.differentialLock*100)+'%');
 $('engine-notice').classList.toggle('hidden',(!state.engineStalled&&!state.starterActive&&state.engineRunning)||phase!=='playing');$('engine-notice').querySelector('strong').textContent=state.fuelStarved?'OUT OF FUEL':state.engineHealth<=.04?'ENGINE FAILED':state.starterActive?'STARTING':'ENGINE OFF';
 $('engine-help').textContent=state.fuelStarved?'Use Recovery in the pause menu to reach a fuel stop.':state.engineFault?String(state.engineFault).replace(/_/g,' ')+'. Inspect Vehicle Condition or recover to a mechanic.':state.engineHealth<=.04?'Use Recovery to reach a mechanic.':'Clutch in or select N, then hold the starter.';
 $('engine-running').textContent=state.starterActive?'STARTER':state.engineRunning?'ENGINE ON':'ENGINE OFF';$('engine-running').classList.toggle('stalled',!state.engineRunning);
 if(settings.telemetry){
  for(let i=0;i<4;i++){const load=state.wheelLoads?.[i]||0;$('suspension-'+i).style.transform='scaleY('+clamp(load/(activeBuild.physics.mass*9.81*.5),0,1)+')';$('suspension-'+i).classList.toggle('unloaded',!state.suspension?.[i]?.contact);$('load-'+i).textContent=(load/1000).toFixed(1)+' kN';}
  $('live-torque').textContent=Math.round(state.engineTorque||0)+' Nm';$('live-power').textContent=Math.round((state.engineTorque||0)*(state.rpm||0)*Math.PI/30000)+' kW';
  $('brake-temp').textContent='BRAKE '+Math.round(Math.max(...(state.brakeTemps||[24])))+'°C';$('clutch-temp').textContent='CLUTCH '+Math.round(state.clutchTemperature||24)+'°C';
  $('tyre-state').textContent=state.tyres?.some(t=>t.blown)?'TYRE BLOWOUT':state.burnout?'BURNOUT / WHEELSPIN':state.absActive?'ABS ACTIVE':state.drifting?'SLIDING / DRIFT':state.handbrake>.1?'HANDBRAKE ACTIVE':'TYRES GRIPPING';$('tyre-state').classList.toggle('burning',!!state.burnout);
 }
 ui.time.textContent=mode==='drift'?Math.ceil(driftRemaining).toString().padStart(2,'0')+' SEC':formatTime(runTime);
 ui.detail.textContent=mode==='race'?(raceState?'LAP '+Math.min(raceState.playerLap,raceState.laps)+' / '+raceState.laps:'STARTING GRID'):mode==='drift'?'CHAIN CLEAN DRIFTS':mode==='sprint'?(lapArmed?Math.round(lastRoad.progress*100)+'% OF LAP':'CROSS THE START LINE'):(world.getDistrict?.(state.x,state.z)||'NEON ARCHIPELAGO')+' · '+(distanceDriven/1000).toFixed(1)+' KM';
 if(mode==='free'&&world.kind==='city'){const district=world.getDistrict(state.x,state.z);if(district!==lastDistrict){lastDistrict=district;if(!discoveredDistricts.has(district)){discoveredDistricts.add(district);toast(district+' · DISTRICT DISCOVERED');}}$('city-traffic').textContent=traffic.states.length+' CARS';}
 $('city-status').classList.toggle('hidden',mode!=='free');
 raceUI?.render(raceState,{visible:mode==='race'&&['playing','countdown'].includes(phase),recovery:raceRecovery});
 ui.score.textContent=int(score)+' PTS';ui.best.textContent=mode==='race'?records.raceWins+' WINS':mode==='sprint'?(records.sprint===null?'BEST --':'BEST '+formatTime(records.sprint).slice(0,-1)):'BEST '+int(mode==='drift'?records.drift:records.free);
 ui.combo.classList.toggle('visible',comboPoints>15);ui.comboScore.textContent=int(comboPoints);ui.comboMult.textContent='×'+Math.min(5,1+comboDuration*.22).toFixed(1);ui.comboLife.style.transform='scaleX('+clamp(comboGrace/1.4,0,1)+')';
 updateVehicleHUD();document.body.classList.toggle('boosting',state.boosting);drawMap();
}
function drawMap(){const canvas=$('minimap');drawMapOn(mapCtx,canvas.width,canvas.height,false);updateRouteUI();}

function drawFullMap(){const canvas=$('full-map');if(canvas)mapProjectionResult=drawMapOn(canvas.getContext('2d'),canvas.width,canvas.height,true);updateRouteUI();gameUI?.map?.render({world,player:renderState||state,cursor:mapView.cursor,projection:mapProjectionResult,route:navigation.getState(),zoom:mapView.zoom});}

function drawMapOn(c,w,h,full=false){
 return drawRoadMap(c,{width:w,height:h,world,player:renderState||state,full,view:mapView,navigation:navigation.getState(),police:policeState,traffic:race?.states||traffic?.states||[],peers:networkCars?.getStates()||[],cursor:full?mapView.cursor:null});
}

function drawSpeedFX(view=state){
 const w=$('speed-fx').width,h=$('speed-fx').height,c=speedCtx;c.clearRect(0,0,w,h);
 if(phase!=='playing'||paused||settings.blur<=.01)return;
 const intensity=clamp((view.speed-15)/40,0,.75)+(view.boosting?.5:0);if(intensity<.02)return;
 if(settings.camera===0){
  screenCar.set(view.x,0,view.z).project(camera);screenAhead.set(view.x+view.vx*.5,0,view.z+view.vz*.5).project(camera);
  let dx=-(screenAhead.x-screenCar.x)*w,dy=(screenAhead.y-screenCar.y)*h;const length=Math.hypot(dx,dy);if(length<.001)return;dx/=length;dy/=length;
  for(const line of stars){const p=(line.phase+totalTime*(.5+view.speed*.012))%1;const x=(.5+Math.cos(line.angle)*(.4+p*.2))*w,y=(.5+Math.sin(line.angle)*(.39+p*.19))*h,len=(18+view.speed*.9)*intensity*(.6+line.phase);speedCtx.strokeStyle='rgba(243,240,229,'+(.16*intensity*settings.blur)+')';speedCtx.lineWidth=line.phase>.7?1.6:.9;speedCtx.beginPath();speedCtx.moveTo(x,y);speedCtx.lineTo(x+dx*len,y+dy*len);speedCtx.stroke();}return;
 }
 const cx=w*.5,cy=h*.43,radius=Math.max(w,h)*.59;
 c.lineCap='round';for(const s of stars){const p=(s.phase+totalTime*(view.boosting?1.5:.8))%1,r=radius*(.40+p*.5),len=radius*s.length*intensity;c.strokeStyle=s.phase>.75?'rgba(111,224,255,'+intensity*.60*settings.blur+')':'rgba(249,242,223,'+intensity*.28*settings.blur+')';c.lineWidth=s.phase>.75?2:1;c.beginPath();c.moveTo(cx+Math.cos(s.angle)*r,cy+Math.sin(s.angle)*r*.8);c.lineTo(cx+Math.cos(s.angle)*(r+len),cy+Math.sin(s.angle)*(r+len)*.8);c.stroke();}
 if(view.boosting){const g=c.createRadialGradient(cx,cy,w*.2,cx,cy,w*.65);g.addColorStop(0,'#63dfff00');g.addColorStop(.6,'#63dfff05');g.addColorStop(1,'#65dfff60');c.fillStyle=g;c.fillRect(0,0,w,h);}
}
function frame(now){
 document.body.classList.toggle('ui-open',phase==='menu'||!!modalName);document.body.classList.toggle('ui-modal',!!modalName);
 const dt=Math.min(.05,Math.max(.001,(now-lastNow)/1000));lastNow=now;totalTime+=dt;frames++;fpsAccum+=dt;
 if(fpsAccum>=1){renderFps=Math.round(frames/fpsAccum);frames=0;fpsAccum=0;}
 processNetworkEvents();updateAudioFocus();
 const inputActive=phase==='playing'&&!paused&&!hostHold&&!awaitingWorld&&windowFocused&&!document.hidden;
 inputManager.setContext(inputActive?'game':'menu');inputManager.setEnabled(inputActive);const sampled=inputManager.sample(dt);frameControls=sampled.controls;processInputActions(sampled.actions);controlsPanel.update(dt);gameUI.update(dt);updateInputPrompts();
 if(toastTimer>0){toastTimer-=dt;if(toastTimer<=0)$('toast').classList.remove('visible');}
 if(comicTimer>0){comicTimer-=dt;if(comicTimer<=0)$('comic-word').classList.remove('visible');}
 if(rewardTime>0){rewardTime-=dt;if(rewardTime<=0)$('reward-pop').classList.add('hidden');}
 const canDrive=phase==='playing'&&!paused&&!hostHold&&!awaitingWorld&&windowFocused&&!document.hidden;
 const hostKeepsWorld=online()&&network.isHost&&world.kind==='city'&&['playing','arrested'].includes(phase)&&paused&&windowFocused&&!document.hidden;
 if(!paused&&!hostHold&&!awaitingWorld){
  if(phase==='countdown'){
   countdownTime-=dt;const numeral=Math.ceil(countdownTime);if(numeral!==previousCountdown){previousCountdown=numeral;$('countdown').textContent=numeral>0?numeral:'GO!';audio.tick('start');}
   if(countdownTime<=0){phase='playing';$('countdown').textContent='GO!';setTimeout(()=>$('countdown').classList.add('hidden'),650);comic('LET’S RIDE!',.7);}
  }
  if(canDrive){accumulator=Math.min(accumulator+dt,.1);let ticks=0;while(accumulator>=1/120&&ticks<10){tickGameplay(1/120);accumulator=Math.max(0,accumulator-1/120);ticks++;if(phase!=='playing')break;}}
  renderState=phase==='playing'?presentation.sample(state,accumulator*120):state;
  const view=visualState();view.headlights=settings.headlights;car.group.position.set(view.x,0,view.z);car.group.rotation.y=view.heading;car.update(view,dt,totalTime);if(canDrive)fx.update(view,dt,totalTime);
  updateCamera(dt);audio.update(state,dt);
  if(checkpointGroup.visible)checkpointGroup.userData.arrow.position.y=8.3+Math.sin(totalTime*3)*.5;
 }
 if(hostKeepsWorld)tickCityAgents(dt);
 else if(online()&&!network.isHost&&world.kind==='city'&&!canDrive&&!hostHold&&!awaitingWorld){traffic.advanceSnapshot(dt);police.advanceSnapshot(dt);}
 networkCars.update(dt,totalTime);
 if(world.kind==='city'&&['playing','arrested'].includes(phase)){
  traffic.render(accumulator*120);police.render(accumulator*120);nearbySounds=[...police.getNearbyAudio(state),...traffic.getNearbyAudio(state),...networkCars.getNearbyAudio(state)];audio.setTraffic?.(nearbySounds);
 }else if(race&&['countdown','playing','result'].includes(phase)){race.render(accumulator*120);nearbySounds=race.getNearbyAudio(state);audio.setTraffic?.(nearbySounds);}else{nearbySounds=[];audio.setTraffic?.([]);}
 const worldRunning=(canDrive||hostKeepsWorld||online()&&!network.isHost&&!hostHold&&!awaitingWorld)&&!document.hidden;
 world.update(worldRunning?dt:0,totalTime,{player:canDrive?visualState():null,night:environment.night});
 if(serviceJob&&windowFocused&&!document.hidden)updateServiceJob(dt);if(modalName==='vehicle'){vehiclePanelClock-=dt;if(vehiclePanelClock<=0){vehiclePanelClock=.2;renderVehicleCondition();}}updateDispatch(dt);
 if(paused&&modalName==='garage'){car.group.position.set(state.x,0,state.z);car.group.rotation.y=state.heading;car.update(visualState(),dt,totalTime);updateCamera(dt);}
 mapView.updateHeading((renderState||state).heading,dt);navigation.update(canDrive?dt:0,state);for(const event of navigation.consumeEvents())if(event.type==='arrival'&&!event.target.job){audio.playEvent?.('waypoint',{intensity:.65});toast('DESTINATION REACHED');}
 phonePanel.update(canDrive?dt:0,career.getState(),{visible:world.kind==='city'&&phase==='playing'&&!modalName,state});if(career.getState().revision!==careerRevision)syncCareerUI();
 if(phase!=='menu'&&phase!=='loading'){hudClock+=dt;if(hudClock>=.065){updateHUD();hudClock=0;}}
 const worldSettings=online()?{...settings,timeMode:network.rules.time}:settings;
 const light=environment.update(worldAuthority()&&(!paused||hostKeepsWorld)&&!hostHold&&!awaitingWorld&&!document.hidden?dt:0,state,camera,worldSettings,totalTime,{police:policeState.officers||[]});traffic?.setNight?.(light.night);police?.setNight?.(light.night);race?.setNight?.(light.night);
 const cameraDirection=new THREE.Vector3();camera.getWorldDirection(cameraDirection);const right=new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld,0),cameraHeading=Math.atan2(cameraDirection.x,cameraDirection.z);
 acousticClock-=dt;if(acousticClock<=0||!acousticState){acousticClock=.10;acousticState=world.sampleAcoustics?.(state.x,state.z,cameraHeading,{x:right.x,z:right.z})||{enclosure:0,openness:1,reflectivity:.1,zone:'open',leftDistance:90,rightDistance:90,frontDistance:90,backDistance:90,ambient:{park:0,traffic:world.kind==='city'?.5:.1,wind:.35}};}
 const nearestSirenDistance=nearbySounds.filter(s=>s.siren).reduce((d,s)=>Math.min(d,s.distance??999),999),proximity=clamp(1-nearestSirenDistance/150,0,1);
 audio.setWorldContext?.({audioAnchors:car.getAudioAnchors?.(),listenerPosition:{x:camera.position.x,y:camera.position.y,z:camera.position.z},heading:state.heading,cameraHeading,listenerRight:{x:right.x,y:right.y,z:right.z},cameraMode:settings.camera,night:light.night,acoustics:acousticState,ambient:acousticState.ambient,district:world.getDistrict?.(state.x,state.z)||world.name,policePhase:policeState.phase,nearestSirenDistance,playerHorn:canDrive&&!!frameControls.horn,policeIntensity:policeState.heatNormalized??(policeState.heat||0)/3,speed:state.speed,engineHealth:state.engineHealth,engineFault:state.engineFault,mechanical:state.mechanical,wheelAttached:state.wheelAttached,fuelLitres:state.fuelLitres,damage:1-(state.bodyHealth??1),servicing:serviceJob?.type==='nitrous'?null:serviceJob?.type||null,worldActive:canDrive||!!serviceJob});
 if(canDrive)escapeMusic=Math.max(0,escapeMusic-dt);
 audio.setMusic?.({enabled:settings.music,volume:settings.musicVolume,paused:phase==='loading'||!!modalName&&modalName!=='arrest'&&modalName!=='service',mode:phase==='arrested'?'arrest':escapeMusic>0?'escape':phase==='menu'?'menu':policeState.phase==='search'?'search':policeState.phase==='chase'?'chase':'drive',intensity:policeState.heat?clamp(policeState.heat/3*.6+proximity*.4,0,1):Math.max(nearMissPulse*.7,Math.min(.8,state.speed/60)),heat:policeState.heatNormalized??(policeState.heat||0)/3,proximity,speed:state.speed,nitrous:canDrive&&state.boosting?state.nitrousIntensity??1:0,drift:canDrive&&state.drifting?Math.min(1,Math.abs(state.driftAngle)*2):0,nearMiss:nearMissPulse,searchProgress:policeState.searchProgress??0});audio.updateWorld?.(dt);
 inputManager.updateFeedback?.(state,dt,{active:canDrive});sendNetworkFrame(dt);
 if(canDrive){conditionSaveClock+=dt;if(conditionSaveClock>12){conditionSaveClock=0;persist();}}
 if(modalName==='map')drawFullMap();
 const view=visualState();updateBodyGroundMask(view);drawSpeedFX(view);post.render(scene,camera,view,dt,totalTime,settings,{active:canDrive,cameraMode:settings.camera,heat:policeState.heatNormalized??0});
 requestAnimationFrame(frame);
}
// Read-only diagnostics for local QA. No player controls or game-state shortcuts.
window.sidewaysDiagnostics=()=>({phase,paused,mode,camera:settings.camera,speed:state?.speed,rpm:state?.rpm,gear:state?.gear,heading:state?.heading,x:state?.x,z:state?.z,driftAngle:state?.driftAngle,drifting:state?.drifting,score,runTime,checkpoint:nextCheckpoint,fps:renderFps,drawCalls:renderer?.info.render.calls,roadDistance:lastRoad?.distance,engineVersion:window.MotorLab?.version,engineAudioRelease:window.MotorLab?.audioRelease,enginePhysicsRelease:window.MotorLab?.physicsRelease,engineClock:physics?.engine?.getTiming().clock,transmission:state?.transmission,handbrake:state?.handbrake,clutch:state?.clutch,inputMode:activeInputConfig?.mode,build:activeBuild?.selection,driveLayout:state?.driveLayout,axleTorques:state?.axleTorques,drivenWheels:state?.drivenWheels,tyres:state?.tyres,wheelRadii:state?.wheelRadii,aero:state?.aero,wheelHop:state?.wheelHop,engineRunning:state?.engineRunning,engineStalled:state?.engineStalled,burnout:state?.burnout,wheelLoads:state?.wheelLoads,bodyHeight:state?.bodyHeight,bodyPitch:state?.bodyPitch,bodyRoll:state?.bodyRoll,roadGradeLong:state?.roadGradeLong,roadGradeLat:state?.roadGradeLat,surfaces:state?.wheelAudio?.map(w=>w.surface),audio:audio?.getDiagnostics?.(),world:world?.kind||'dock',traffic:traffic?.diagnostics?.(),input:inputManager?.getPresentation?.(),nitrousIntensity:state?.nitrousIntensity,nitrousTorque:state?.nitrousTorque,version:20,race:race?.diagnostics?.(),raceState,raceRecovery,mechanical:state?.mechanical,career:career.getState(),navigation:navigation.getState(),multiplayer:network?.diagnostics(),remoteCars:networkCars?.diagnostics(),police:policeState,enforcement:enforcementState,acoustics:acousticState,terrain:fx?.debug?.().terrain,worldHour:environment?.hour,worldKind:world?.kind,fuel:state?.fuelLitres,engineHealth:state?.engineHealth,bodyHealth:state?.bodyHealth,wheelAttached:state?.wheelAttached,lookYaw,lookPitch,worldGroups:scene?.children.filter(x=>['NEON-CITY','DOCK-09','SHOWROOM'].includes(x.name)).length});
init().catch(showError);
