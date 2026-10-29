import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {parseHTML,installDOM,EventStub,makeElement,Target} from './dom-v5-harness.mjs';
import {nextFocus,focusableControls as navigationControls,ScreenNavigation,adjustRange,isTextEntry,cycleTab} from '../dist/navigation.js';
import {VirtualKeyboard} from '../dist/virtual-keyboard.js';
import {InputManager} from '../dist/input.js';
import {GameUI} from '../dist/game-ui.js';

const main=fs.readFileSync(new URL('../dist/main.js',import.meta.url),'utf8'),html=fs.readFileSync(new URL('../dist/index.html',import.meta.url),'utf8');
const {doc}=parseHTML(html);installDOM(doc);const $=id=>doc.getElementById(id),host=new Target();
const input=new InputManager({target:host,document:doc,navigator:{getGamepads:()=>[]},storage:{getItem:()=>null,setItem(){}}});input.setContext('menu');input.sample(1/60);
const nav=new ScreenNavigation(doc),keyboard=new VirtualKeyboard(nav),ui=new GameUI(doc),calls={waypoints:0,cursor:0,zoom:0,draw:0,garageHide:0,controlsHide:0};
const ctx={document:doc,Event:EventStub,performance:{now:()=>0},$,nextFocus,navigationControls,ScreenNavigation,adjustRange,isTextEntry,cycleTab,screenNavigation:nav,textKeyboard:keyboard,gameUI:ui,inputManager:input,
 phase:'menu',modalName:null,paused:false,settingsTab:'drive',controlsReturn:'settings',returnToPause:false,vehicleReturn:null,serviceJob:null,serviceTarget:{kind:'garage'},initialCamera:false,activeBuild:{},padFocus:null,mode:'free',PLAY_MODES:['free','race','sprint','drift'],selectedMode:'free',
 controlsPanel:{active:false,wizard:null,learning:null,show(){this.active=true;},hide(){this.active=false;calls.controlsHide++;},cancel(){this.learning=null;},message(){}},garagePanel:{show(){},hide(){calls.garageHide++;}},
 state:{x:0,z:0},world:{bounds:{minX:-100,maxX:100,minZ:-100,maxZ:100}},mapPointer:null,mapProjectionResult:null,mapView:{cursor:{x:0,z:0},moveCursor(){calls.cursor++;},changeZoom(){calls.zoom++;}},
 network:{connected:false,playing:false,isHost:false},lobbyPanel:{render(){}},audio:{suspend(){},playEvent(){}},post:{reset(){}},
 updateInputPrompts(){},clearInputs(){input.clear();},updateAudioFocus(){},refreshMapPlaces(){},drawFullMap(){calls.draw++;},placeWaypoint(point,name){calls.waypoints++;calls.lastWaypoint={point,name};},syncSettings(){},updateServiceUI(){},renderVehicleCondition(){},persist(){},toast(){},toggleSound(){},toggleLights(){},interact(){},releaseFromStation(){},selectMode(){},startGame(){},openGarage(){ctx.openModal('garage');},showMenu(){ctx.phase='menu';ctx.modalName=null;ctx.hideDialog();},clamp:(x,a,b)=>Math.max(a,Math.min(b,x)),lastNow:0,
};
vm.createContext(ctx);
for(const name of ['selectSettingsTab','openSettings','showDialog','hideDialog','focusableControls','focusControl','focusDefault','moveFocus','adjustFocused','processInputActions','openModal','closeModal','setPaused']){
 const match=new RegExp('(?:^|\\n)function '+name+'\\(').exec(main);assert.ok(match,name);const start=match.index+(match[0][0]==='\n'?1:0),tail=main.slice(start),end=/\n(?:(?:async )?function |\/\/ Read-only diagnostics)/.exec(tail);vm.runInContext(end?tail.slice(0,end.index):tail,ctx);
}
const report={status:'pending',checks:[],limit:'Actual main.js navigation handlers plus InputManager and GameUI in the functional DOM harness. Physics, map drawing and audio are controlled boundaries; no physical device claim.'};
vm.runInContext(main.split('\n').find(line=>line.includes("document.querySelectorAll('[data-settings-tab]').forEach(button=>button.addEventListener")),ctx);
const check=(name,fn)=>{fn();report.checks.push(name);console.log('PASS '+name);};

check('Main-menu → settings → controls → back restores each precise originating control',()=>{
 ctx.focusDefault();ctx.focusControl($('settings-button'));ctx.openModal('settings');ctx.focusControl($('controls-button'));ctx.openModal('controls');assert.equal(ctx.modalName,'controls');ctx.processInputActions(['back']);assert.equal(ctx.modalName,'settings');assert.equal(doc.activeElement,$('controls-button'));ctx.processInputActions(['back']);assert.equal(ctx.modalName,null);assert.equal(ctx.paused,false);assert.equal($('menu').inert,false);
});
check('Pause → settings → controls returns to pause, then resumes without stale history',()=>{
 ctx.phase='playing';ctx.modalName=null;nav.reset();ctx.paused=false;ctx.setPaused(true);ctx.focusControl($('pause-settings-button'));ctx.openModal('settings');ctx.focusControl($('controls-button'));ctx.openModal('controls');ctx.closeModal();assert.equal(doc.activeElement,$('controls-button'));ctx.closeModal();assert.equal(ctx.modalName,'pause');assert.equal(doc.activeElement,$('pause-settings-button'));ctx.processInputActions(['back']);assert.equal(ctx.paused,false);assert.equal(nav.history.length,0);
});
check('Service → garage cancellation returns to service while explicit resume goes to driving',()=>{
 const category=makeElement(doc,'button','garage-category-cars',$('garage-modal'));category.setAttribute('role','tab');ctx.openModal('service');ctx.focusControl($('service-garage'));ctx.openModal('garage');assert.equal(doc.activeElement,category);ctx.closeModal();assert.equal(ctx.modalName,'service');assert.equal(doc.activeElement,$('service-garage'));assert.equal(calls.garageHide,1);ctx.openModal('lobby');ctx.closeModal({resume:true});assert.equal(ctx.modalName,null);assert.equal(ctx.paused,false);assert.equal(nav.history.length,0);
});
check('View switches map cursor and places; confirm on a panel button does not also mark the cursor',()=>{
 const poi=makeElement(doc,'button','navigation-test-poi',$('map-poi-list'));poi.dataset.mapPlace='0';let clicked=0;poi.addEventListener('click',()=>clicked++);ctx.openModal('map');ctx.focusControl($('full-map'));ctx.processInputActions(['menuRight','confirm','shiftUp']);assert.equal(calls.cursor,1);assert.equal(calls.waypoints,1);assert.equal(calls.zoom,1);
 ctx.processInputActions(['map']);assert.equal(ctx.modalName,'map');assert.equal(doc.activeElement,poi);ctx.processInputActions(['confirm']);assert.equal(clicked,1);assert.equal(calls.waypoints,1);ctx.processInputActions(['map']);assert.equal(doc.activeElement,$('full-map'));ctx.processInputActions(['back']);assert.equal(ctx.modalName,null);
});
check('Shoulders change settings tabs and slider arrows work through actual keyboard input',()=>{
 ctx.openSettings('drive');ctx.processInputActions(['shiftUp']);assert.equal(ctx.settingsTab,'visuals');ctx.processInputActions(['shiftDown']);assert.equal(ctx.settingsTab,'drive');ctx.selectSettingsTab('audio');const range=$('volume-range');ctx.focusControl(range);range.value='50';host.emit('keydown',{code:'ArrowRight',target:range});const actions=input.sample(1/60).actions;assert.ok(actions.includes('menuRight'));ctx.processInputActions(actions);assert.equal(range.value,String(50+Number(range.step||1)));host.emit('keyup',{code:'ArrowRight'});input.sample(1/60);ctx.closeModal();
});
check('Map confirmation routes to the destination shown in the detail card, including its entrance',()=>{
 ctx.openModal('map');ctx.focusControl($('full-map'));ui.map.selection={point:{x:80,z:50},name:'North Mechanic'};ctx.mapView.cursor={x:60,z:45};ctx.processInputActions(['confirm']);assert.deepEqual(calls.lastWaypoint.point,{x:80,z:50});assert.equal(calls.lastWaypoint.name,'North Mechanic');ui.map.selection=null;ctx.closeModal();
});
check('Summary confirms and text fields open the keyboard; Back cancels only the keyboard',()=>{
 ctx.openModal('lobby');const summary=$('lobby-modal').querySelector('summary');let toggles=0;summary.addEventListener('click',()=>toggles++);ctx.focusControl(summary);ctx.processInputActions(['confirm']);assert.equal(toggles,1);const name=$('lobby-name');name.value='ORIGINAL';ctx.focusControl(name);ctx.processInputActions(['confirm']);assert.equal(keyboard.active,true);keyboard.field.value='DRAFT';ctx.processInputActions(['back']);assert.equal(keyboard.active,false);assert.equal(name.value,'ORIGINAL');assert.equal(ctx.modalName,'lobby');assert.equal(doc.activeElement,name);ctx.closeModal();
});
check('Prevented key events and menu Tab never leak map actions into InputManager',()=>{
 input.clear();host.emit('keydown',{code:'Tab',key:'Tab',target:$('start-button')});assert.ok(!input.sample(1/60).actions.includes('map'));host.emit('keyup',{code:'Tab'});host.emit('keydown',{code:'Enter',defaultPrevented:true,target:$('start-button')});assert.ok(!input.sample(1/60).actions.includes('confirm'));host.emit('keyup',{code:'Enter'});
});
check('Escape opens Pause during driving and resumes from Pause without leaving the session',()=>{
 ctx.phase='playing';ctx.modalName=null;ctx.paused=false;nav.reset();ctx.processInputActions(['home']);assert.equal(ctx.modalName,'pause');assert.equal(ctx.phase,'playing');host.emit('keydown',{code:'Escape',target:$('resume-button')});host.emit('keyup',{code:'Escape',target:$('resume-button')});const sample=input.sample(1/60);assert.equal(input.keys.has('Escape'),false);assert.ok(sample.actions.includes('back'));ctx.processInputActions(sample.actions);assert.equal(ctx.phase,'playing');assert.equal(ctx.modalName,null);assert.equal(ctx.paused,false);
});
nav.destroy();input.destroy();report.status='passed';fs.writeFileSync(new URL('./navigation-main-v14-results.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
