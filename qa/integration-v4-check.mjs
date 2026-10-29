import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {InputManager} from '../dist/input.js';
import {GaragePanel} from '../dist/garage.js';
import {ControlsPanel} from '../dist/controls-ui.js';
import {resolveBuild,PARTS} from '../dist/catalog.js';
import {PoseBuffer} from '../dist/presentation.js';
const html=fs.readFileSync(new URL('../dist/index.html',import.meta.url),'utf8'),main=fs.readFileSync(new URL('../dist/main.js',import.meta.url),'utf8');
const report={status:'pending',checks:[]};
class Target {constructor(){this.listeners={};}addEventListener(type,fn){(this.listeners[type]??=[]).push(fn);}removeEventListener(){}dispatchEvent(event){event.target??=this;event.currentTarget=this;for(const fn of this.listeners[event.type]||[])fn(event);return true;}emit(type,extra={}){return this.dispatchEvent({type,preventDefault(){},...extra});}}
let doc;
class El extends Target{
 constructor(tag='div'){super();this.tagName=tag.toUpperCase();this.children=[];this.parentElement=null;this.attributes={};this.dataset={};this.style={};this._classes=new Set();this._value='';this.checked=false;this.disabled=false;this._text='';this.classList={add:(...names)=>names.forEach(n=>this._classes.add(n)),remove:(...names)=>names.forEach(n=>this._classes.delete(n)),contains:n=>this._classes.has(n),toggle:(n,force)=>{const active=force===undefined?!this._classes.has(n):!!force;active?this._classes.add(n):this._classes.delete(n);return active;}};}
 set id(v){this._id=v;doc?.ids.set(v,this);}get id(){return this._id||'';}
 set className(v){this._classes=new Set(String(v).split(/\s+/).filter(Boolean));}get className(){return [...this._classes].join(' ');}
 set textContent(v){this._text=String(v);}get textContent(){return this._text;}
 set value(v){this._value=String(v);}get value(){return this._value;}
 get lastElementChild(){return this.children.at(-1)||null;}
 get options(){return this.children.filter(c=>c.tagName==='OPTION');}set selectedIndex(i){this._value=this.options[i]?.value??'';}get selectedIndex(){return this.options.findIndex(x=>x.value===this.value);}
 get offsetParent(){for(let el=this;el;el=el.parentElement)if(el._classes.has('hidden'))return null;return this.parentElement||{};}
 append(...els){for(const el of els){el.parentElement=this;this.children.push(el);}}add(el){this.append(el);}replaceChildren(...els){this.children=[];this.append(...els);}
 setAttribute(key,value){this.attributes[key]=String(value);if(key==='id')this.id=value;if(key==='class')this.className=value;if(key==='value')this.value=value;if(key==='type')this.type=value;if(key==='disabled')this.disabled=true;if(['min','max','step'].includes(key))this[key]=String(value);if(key.startsWith('data-'))this.dataset[key.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=String(value);}
 querySelectorAll(selector){const selectors=selector.split(',').map(s=>s.trim()),matches=el=>selectors.some(s=>s.startsWith('.')?el._classes.has(s.slice(1)):/^\[/.test(s)?(()=>{const m=/^\[([^=\]]+)(?:=["']?([^"'\]]+)["']?)?\]$/.exec(s);return m&&m[1]in el.attributes&&(m[2]===undefined||el.attributes[m[1]]===m[2]);})():s==='a[href]'?el.tagName==='A'&&'href'in el.attributes:el.tagName===s.toUpperCase());const out=[];const visit=el=>{for(const child of el.children){if(matches(child))out.push(child);visit(child);}};visit(this);return out;}
 querySelector(selector){return this.querySelectorAll(selector)[0]||null;}focus(){doc.activeElement=this;}scrollIntoView(){}click(){this.emit('click');}
}
class Doc extends Target{constructor(){super();this.ids=new Map();this.root=new El('document');this.hidden=false;this.activeElement=null;}createElement(tag){return new El(tag);}getElementById(id){return this.ids.get(id)||null;}querySelectorAll(s){return this.root.querySelectorAll(s);}querySelector(s){return this.root.querySelector(s);}}
doc=new Doc();const stack=[doc.root],seen=new Set();
for(const match of html.matchAll(/<\/?([\w-]+)([^>]*)>/g)){const closing=match[0][1]==='/',tag=match[1].toLowerCase();if(closing){while(stack.length>1){const popped=stack.pop();if(popped.tagName===tag.toUpperCase())break;}continue;}const el=new El(tag);for(const a of match[2].matchAll(/([\w:-]+)(?:="([^"]*)"|='([^']*)')?/g)){if(a[1]==='id'){assert.ok(!seen.has(a[2]||a[3]),'duplicate HTML id');seen.add(a[2]||a[3]);}el.setAttribute(a[1],a[2]??a[3]??'');}stack.at(-1).append(el);if(tag==='body')doc.body=el;if(!['meta','link','input','br','hr','img','path'].includes(tag)&&!match[0].endsWith('/>'))stack.push(el);}
globalThis.document=doc;globalThis.Option=class extends El{constructor(label,value){super('option');this.textContent=label;this.value=value;}};
const dynamic=new Set(Object.keys(PARTS).flatMap(k=>['garage-part-'+k,'garage-note-'+k]));
for(const file of ['main.js','garage.js','controls-ui.js']){const src=fs.readFileSync(new URL('../dist/'+file,import.meta.url),'utf8');for(const m of src.matchAll(/(?:\$|byId)\('([^']+)'\)/g))assert.ok(doc.ids.has(m[1])||dynamic.has(m[1]),file+' missing #'+m[1]);}
report.checks.push('No duplicate HTML IDs; all literal IDs referenced by main, garage and controls exist');
let pads=[];const keyboard=new Target(),storage={getItem(){return null;},setItem(){}};
const input=new InputManager({navigator:{getGamepads:()=>pads},target:keyboard,document:doc,storage});
const controls=new ControlsPanel(input);controls.show();controls.selectTab('bindings');controls.hide();report.checks.push('Actual ControlsPanel constructor, tab navigation and cancellation run without missing DOM nodes');
const active=resolveBuild(),calls={preview:[],physics:[],audioBuild:[],audioSuspend:[],audioMix:[],audioState:[],volume:[],reset:0,postReset:0};
const context={document:doc,$:id=>doc.getElementById(id),Event:class{constructor(type,options){this.type=type;Object.assign(this,options);}},performance:{now:()=>0},phase:'playing',paused:false,returnToPause:false,modalName:null,settings:{paints:{},handling:'street',assists:true},activeBuild:active,state:{x:0,z:0,groundHeight:0},totalTime:0,initialCamera:false,inputManager:input,activeInputConfig:input.getConfig(),controlsPanel:controls,pendingShiftUp:false,pendingShiftDown:false,pendingNeutral:false,frameControls:{},padFocus:null,car:{setBuild:b=>calls.preview.push(b.signature),setColor(){},update(){}},post:{setCarBounds(){},reset(){}},audio:{suspend:v=>calls.audioSuspend.push(v),setBuild:b=>calls.audioBuild.push(b.signature)},physics:{state:{x:0,z:0},setBuild:b=>calls.physics.push(b.signature),setTune(){},reset(){calls.reset++;}},fx:{setBuild(){},reset(){}},world:{spawn:{x:0,z:0,heading:0}},checkpointGroup:{visible:false},resetPresentation(){},persist(){},syncSettings(){},toast(){},clamp:(n,a,b)=>Math.max(a,Math.min(b,n)),menuOrbit:0};
vm.createContext(context);
const names=['previewBuild','applyBuild','openGarage','clearInputs','focusableControls','focusControl','focusDefault','moveFocus','adjustFocused','openModal','closeModal','setPaused','showMenu'];
for(const name of names){const start=main.indexOf('function '+name+'(');assert.ok(start>=0);const tail=main.slice(start);const next=/\n(?:async )?function /.exec(tail);vm.runInContext(next?tail.slice(0,next.index):tail,context);}
const garage=new GaragePanel({onPreview:context.previewBuild,onApply:context.applyBuild,onCancel:context.previewBuild});context.garagePanel=garage;
context.openGarage();assert.equal(context.modalName,'garage');assert.equal(context.paused,true);assert.equal(doc.activeElement.id,'garage-engine');
garage.change({carId:'atlas',engineId:'v8'});assert.equal(context.activeBuild.signature,active.signature);assert.equal(calls.physics.length,0);
context.closeModal();assert.equal(context.modalName,null);assert.equal(context.paused,false);assert.equal(calls.preview.at(-1),active.signature);assert.equal(calls.audioSuspend.at(-1),false);
report.checks.push('Opening and cancelling garage during a run restores the active car and resumes audio without installing preview');
context.setPaused(true);context.openModal('settings');context.openGarage();garage.change({engineId:'rotary'});context.closeModal();assert.equal(context.modalName,'pause');assert.equal(context.paused,true);assert.equal(calls.audioSuspend.at(-1),true);
report.checks.push('Garage opened from pause/settings returns to the paused state on cancel');
context.setPaused(false);context.openGarage();garage.change({carId:'kitsune',engineId:'rotary',exhaust:'race'});const chosen=garage.draft;doc.getElementById('garage-apply').click();assert.equal(context.activeBuild.signature,chosen.signature);assert.equal(context.phase,'menu');assert.equal(context.modalName,null);assert.equal(garage.open,false);assert.equal(calls.physics.at(-1),chosen.signature);assert.equal(calls.audioBuild.at(-1),chosen.signature);assert.ok(calls.reset>0);assert.equal(calls.audioSuspend.at(-1),true);report.checks.push('Garage install updates physics/audio build and returns to a reset menu, cancelling the active run');
const pad={id:'Standard test controller',index:0,mapping:'standard',connected:true,axes:[0,0,0,0],buttons:Array.from({length:18},()=>({value:0,pressed:false}))};pads=[pad];input.setContext('game');input.setEnabled(true);for(let i=0;i<8;i++)input.sample(1/60);const press=(i,v)=>pad.buttons[i]={value:v,pressed:!!v};
press(12,1);press(10,1);let sample=input.sample();assert.equal(sample.controls.starter,true);assert.equal(sample.controls.clutch,1);assert.ok(!sample.actions.includes('menuPrev'));input.setContext('menu');input.setEnabled(false);press(12,0);press(10,0);input.sample();press(12,1);press(10,1);sample=input.sample();assert.equal(sample.controls.starter,false);assert.equal(sample.controls.clutch,0);assert.ok(sample.actions.includes('menuPrev'));report.checks.push('Standard D-pad Up is starter while driving and menu navigation while paused; L3 clutch is driving-only');
press(12,0);press(10,0);input.sample();keyboard.emit('keydown',{code:'Escape',target:doc.getElementById('garage-engine')});sample=input.sample();assert.ok(sample.actions.includes('back'),'Escape from focused select must close modal');report.checks.push('Escape works while a setup/garage select has keyboard focus');
input.clear();input.setContext('game');input.setEnabled(true);keyboard.emit('keydown',{code:'KeyI',target:doc.body});keyboard.emit('keydown',{code:'ControlLeft',target:doc.body});keyboard.emit('keydown',{code:'KeyG',target:doc.body});sample=input.sample();assert.equal(sample.controls.starter,true);assert.equal(sample.controls.clutch,1);assert.ok(sample.actions.includes('garage'));assert.ok(!input.sample().actions.includes('garage'));keyboard.emit('keyup',{code:'KeyI'});keyboard.emit('keyup',{code:'ControlLeft'});keyboard.emit('keyup',{code:'KeyG'});sample=input.sample();assert.equal(sample.controls.starter,false);assert.equal(sample.controls.clutch,0);report.checks.push('I and Ctrl are continuous starter/clutch controls, G is a single garage action, release clears controls');

// Bind the real V4 settings helpers and listeners to the same functional DOM.
const stored=new Map();context.localStorage={getItem:key=>stored.get(key)||null,setItem:(key,value)=>stored.set(key,value)};
Object.assign(context,{window:new Target(),records:{sprint:null,drift:0,free:0},presentation:new PoseBuffer(),renderState:null,accumulator:0,cameraAnchor:{x:0,z:0},lastNow:0,isTouch:false,selectedMode:'free',mode:'free',muted:false,menuOrbit:0,totalTime:0,runTime:0,comboPoints:0,comboDuration:0,comboGrace:0,score:0,offroadTimer:0,lapArmed:false,lastRoad:{progress:.5},ui:{combo:doc.getElementById('combo')},resize(){},updateCheckpoint(){},comic(){}});
context.physics.reset=(x=0,z=0,heading=0,options={})=>{calls.reset++;Object.assign(context.physics.state,{x,z,heading,speed:0,vx:0,vz:0,boost:1,groundHeight:.012,bodyHeight:.012,bodyPitch:0,bodyRoll:0,wheelSpins:[0,0,0,0],wheelSteers:[0,0,0,0],suspension:[0,1,2,3].map(()=>({groundHeight:.012,wheelY:.352})),gear:options.neutral?0:1});};
context.post.reset=()=>calls.postReset++;
context.audio.setMix=m=>calls.audioMix.push({...m});context.audio.setVolume=v=>calls.volume.push(v);context.audio.setCamera=()=>{};context.audio.update=s=>calls.audioState.push(s);context.audio.start=()=>Promise.resolve(true);context.audio.setMuted=()=>{};
context.world.spawn={x:24,z:60,heading:1.2};context.world.curve={getPointAt:()=>({x:4,z:8}),getTangentAt:()=>({x:0,z:1})};
const defaultsSource=main.match(/const mixDefaults=([^;]+);/);assert.ok(defaultsSource);vm.runInContext('mixDefaults='+defaultsSource[1],context);
context.settings={...context.settings,camera:0,blur:.65,quality:'high',volume:.55,telemetry:false,audioMix:{...context.mixDefaults}};
const persistSource=main.match(/const persist=([^\n]+);/);assert.ok(persistSource);vm.runInContext('persist='+persistSource[1]+';',context);
for(const name of ['syncAudioSettings','syncSettings','resetPresentation','setupUI','cycleCamera','setTransmission','requestShift','startGame','resetCar']){const start=main.indexOf('function '+name+'('),tail=main.slice(start),next=/\n(?:async )?function /.exec(tail);vm.runInContext(next?tail.slice(0,next.index):tail,context);}
context.setupUI();context.syncSettings();
for(const key of Object.keys(context.mixDefaults)){
 const slider=doc.getElementById('audio-'+key),output=doc.getElementById('audio-'+key+'-value');assert.ok(slider&&output);assert.equal(slider.value,String(Math.round(context.mixDefaults[key]*100)));
 slider.value='35';slider.emit('input');assert.equal(context.settings.audioMix[key],.35);assert.equal(output.textContent,'35%');assert.equal(calls.audioMix.at(-1)[key],.35);
 assert.equal(JSON.parse(stored.get('sideways-v1')).audioMix[key],.35,'Sound mix was not persisted');
}
report.checks.push('All five real sound sliders update displayed percentages, the audio mixer and persistent settings');
doc.getElementById('audio-engine').value='500';doc.getElementById('audio-engine').emit('input');assert.equal(context.settings.audioMix.engine,1);
doc.getElementById('audio-tyres').value='-30';doc.getElementById('audio-tyres').emit('input');assert.equal(context.settings.audioMix.tyres,0);
doc.getElementById('audio-reset').click();assert.equal(JSON.stringify(context.settings.audioMix),JSON.stringify(context.mixDefaults));assert.equal(JSON.stringify(JSON.parse(stored.get('sideways-v1')).audioMix),JSON.stringify(context.mixDefaults));
report.checks.push('Sound control bounds are clamped and Standard Mix restores/persists every default');
const disclosure=doc.getElementById('audio-mix-toggle'),mixPane=doc.getElementById('audio-mix');assert.ok(mixPane.classList.contains('hidden'));disclosure.click();assert.ok(!mixPane.classList.contains('hidden'));assert.equal(disclosure.attributes['aria-expanded'],'true');assert.equal(disclosure.lastElementChild.textContent,'−');disclosure.click();assert.ok(mixPane.classList.contains('hidden'));assert.equal(disclosure.attributes['aria-expanded'],'false');
context.phase='playing';context.paused=false;context.openModal('settings');assert.equal(doc.activeElement.id,'camera-select');
assert.ok(!context.focusableControls().includes(doc.getElementById('audio-engine')),'Hidden mix controls must not be in controller navigation');disclosure.click();assert.ok(context.focusableControls().includes(doc.getElementById('audio-engine')));
doc.getElementById('audio-drive').focus();const previousMix=context.settings.audioMix.drive;context.adjustFocused(1);assert.ok(Math.abs(context.settings.audioMix.drive-Math.min(1,previousMix+.05))<1e-12);assert.equal(doc.getElementById('audio-drive-value').textContent,'70%');
context.closeModal();assert.equal(context.paused,false);assert.equal(calls.audioSuspend.at(-1),false);
report.checks.push('Sound disclosure accessibility state and controller range adjustment work through actual menu handlers');

// Test the real saved-mix loader independently with corrupt/out-of-range data.
const savedMixSource=main.match(/const savedMix=([^\n]+);/);assert.ok(savedMixSource);
const loaded={saved:{audioMix:{engine:2,mechanical:-4,tyres:'loud',environment:null,drive:.4}},mixDefaults:context.mixDefaults,clamp:context.clamp};vm.createContext(loaded);vm.runInContext('result='+savedMixSource[1]+';',loaded);
assert.equal(loaded.result.engine,1);assert.equal(loaded.result.mechanical,0);assert.equal(loaded.result.tyres,.85);assert.equal(loaded.result.environment,.7);assert.equal(loaded.result.drive,.4);
report.checks.push('Persisted mix migration sanitizes invalid entries without dropping valid user preferences');

// Real lifecycle helpers reset interpolation as well as authoritative state.
context.startGame('free');await Promise.resolve();assert.equal(context.phase,'playing');assert.equal(context.paused,false);assert.equal(context.renderState.x,24);assert.equal(context.renderState.z,60);assert.equal(context.renderState.heading,1.2);assert.notEqual(context.renderState,context.state);assert.equal(calls.audioState.at(-1),context.state);
context.state.x=999;context.state.z=-999;context.presentation.push(context.state);context.accumulator=.007;context.resetCar();assert.equal(context.accumulator,0);assert.equal(context.state.x,4);assert.equal(context.renderState.x,4);assert.equal(context.renderState.z,8);assert.equal(context.presentation.sample(context.state,0).x,4);assert.equal(context.presentation.sample(context.state,1).x,4);
context.setPaused(true);context.openGarage();garage.change({carId:'atlas'});context.closeModal();assert.equal(context.modalName,'pause');assert.equal(context.paused,true);context.setPaused(false);context.showMenu();assert.equal(context.phase,'menu');assert.equal(context.state.x,24);assert.equal(context.renderState.x,24);assert.equal(context.presentation.sample(context.state,0).z,60);assert.equal(calls.audioSuspend.at(-1),true);
report.checks.push('Starting, roadside reset and menu reset clear old render history; pause/garage cancellation preserves the paused run');
input.destroy();report.status='passed';report.htmlIds=seen.size;report.verificationLimit='Functional DOM harness and actual handlers; no browser layout or device hardware validation.';
fs.writeFileSync(new URL('./integration-v4-results.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
