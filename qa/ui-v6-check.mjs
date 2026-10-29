import fs from 'node:fs';
import assert from 'node:assert/strict';
import {GameUI,paintInputPrompts} from '../dist/game-ui.js';
import {InputManager} from '../dist/input.js';
import {EventStub,Target,parseHTML,installDOM,makeElement,flushMicrotasks} from './dom-v5-harness.mjs';

const report={status:'pending',checks:[],verificationLimit:'Functional DOM and mocked animation/gamepad APIs; no browser layout, WebGL or physical device validation.'};
const check=async(name,fn)=>{await fn();report.checks.push(name);};
const {doc}=parseHTML('<body><label><span>Camera</span><select id="camera"><option value="0">Top-down</option><option value="1">Chase</option><option value="2">Hood</option></select></label><div id="panel" class="hidden"></div><div id="loading" class="hidden"><strong id="loading-title"></strong><span id="loading-status"></span></div><span id="input-device-name"></span><button id="quick-calibrate" class="hidden"></button></body>',{animations:true});
installDOM(doc);const ui=new GameUI(doc),select=doc.getElementById('camera'),view=ui.selects.get(select);

await check('Each native select has one visible, labelled controller focus target; repeated scans do not duplicate wrappers',()=>{
 assert.equal(doc.querySelectorAll('.game-choice').length,1);assert.equal(ui.control(select),view.choice);assert.equal(view.choice.dataset.selectId,'camera');assert.equal(view.choice.textContent,'Top-down');assert.equal(select.tabIndex,-1);assert.equal(select.getAttribute('aria-hidden'),'true');assert.equal(view.previous.tabIndex,-1);assert.equal(view.next.tabIndex,-1);assert.equal(view.choice.tabIndex,0);assert.match(view.choice.getAttribute('aria-label'),/^Camera: Top-down/);
 for(let i=0;i<20;i++)ui.scan();assert.equal(doc.querySelectorAll('.game-choice').length,1);assert.equal(ui.selects.size,1);
});
await check('Mouse arrows, confirm and controller left/right change the real value once and keep focus on the visible choice',()=>{
 let changes=0;select.addEventListener('change',()=>changes++);view.next.click();assert.equal(select.value,'1');assert.equal(view.choice.textContent,'Chase');assert.equal(doc.activeElement,view.choice);assert.equal(changes,1);
 view.choice.click();assert.equal(select.value,'2');assert.equal(view.choice.textContent,'Hood');assert.equal(changes,2);assert.equal(view.next.disabled,true);view.next.click();assert.equal(changes,2);
 assert.equal(ui.adjust(view.choice,-1),true);assert.equal(select.value,'1');assert.equal(changes,3);assert.equal(ui.adjust(doc.body,1),false);
 select.value='0';select.dispatchEvent(new EventStub('change'));assert.equal(view.choice.textContent,'Top-down');assert.equal(view.previous.disabled,true);
});
await check('Disabled options are skipped and disabled or empty select controls cannot change settings',()=>{
 select.options[1].disabled=true;select.value='0';assert.equal(ui.change(select,1),true);assert.equal(select.value,'2');assert.equal(ui.change(select,-1),true);assert.equal(select.value,'0');
 select.disabled=true;ui.sync();assert.equal(view.choice.disabled,true);assert.equal(view.previous.disabled,true);assert.equal(view.next.disabled,true);assert.equal(ui.change(select,1),false);assert.equal(select.value,'0');select.disabled=false;
 const empty=makeElement(doc,'select','empty');ui.scan();assert.equal(ui.control(empty).disabled,true);assert.equal(ui.control(empty).textContent,'NOT AVAILABLE');assert.equal(ui.adjust(ui.control(empty),1),false);
});
await check('Dynamic garage/setup selects and replacement option lists update the same visible controls',()=>{
 const label=makeElement(doc,'label','dynamic-label'),title=makeElement(doc,'span',null,label);title.textContent='Engine';const engines=makeElement(doc,'select','engines',label);engines.setAttribute('aria-label','Choose engine');engines.append(new Option('I6','i6'),new Option('V8','v8'));ui.update(.31);const control=ui.control(engines);assert.equal(control.textContent,'I6');assert.match(control.getAttribute('aria-label'),/^Choose engine:/);
 engines.value='v8';ui.sync();assert.equal(control.textContent,'V8');engines.replaceChildren(new Option('Rotary','rotary'));engines.value='rotary';ui.update(.31);assert.equal(ui.control(engines),control);assert.equal(control.textContent,'Rotary');assert.equal(doc.querySelectorAll('.game-choice').length,3);
});
await check('Interrupted leave/enter animations cannot hide a reopened menu; completed leave is hidden with its animation cleared',async()=>{
 const panel=doc.getElementById('panel');ui.enter(panel);const opening=panel.animations.at(-1);ui.leave(panel);const closing=panel.animations.at(-1);assert.equal(opening.cancelled,true);ui.enter(panel);const reopening=panel.animations.at(-1);assert.equal(closing.cancelled,true);closing.finish();await flushMicrotasks();assert.equal(panel.classList.contains('hidden'),false);assert.equal(panel.classList.contains('ui-leaving'),false);
 reopening.finish();await flushMicrotasks();assert.equal(ui.animations.has(panel),false);ui.leave(panel);panel.animations.at(-1).finish();await flushMicrotasks();assert.equal(panel.classList.contains('hidden'),true);assert.equal(panel.classList.contains('ui-leaving'),false);assert.equal(ui.animations.has(panel),false);
});
await check('Loading transitions are restartable and reduced motion removes transform animations',async()=>{
 ui.loading('NEON DISTRICT','STRASSEN');assert.equal(doc.getElementById('loading-title').textContent,'NEON DISTRICT');assert.equal(doc.getElementById('loading-status').textContent,'STRASSEN');ui.finishLoading();const old=doc.getElementById('loading').animations.at(-1);ui.loading('DOCK 09','STARTLINIE');assert.equal(old.cancelled,true);old.finish();await flushMicrotasks();assert.equal(doc.getElementById('loading').classList.contains('hidden'),false);assert.equal(doc.getElementById('loading-title').textContent,'DOCK 09');
 ui.reduced=true;const panel=doc.getElementById('panel');ui.enter(panel);assert.ok(panel.animations.at(-1).keyframes.every(frame=>!('transform'in frame)));const before=panel.animations.length;ui.press(panel);assert.equal(panel.animations.length,before);
});
await check('Real input presentation paints contextual keyboard, Xbox, PlayStation and wheel prompts without idle-noise flicker',()=>{
 const actions=['camera','boost','handbrake','confirm','back'];for(const action of actions){const el=makeElement(doc,'kbd','prompt-'+action);el.dataset.prompt=action;}
 let pads=[];const target=new Target(),input=new InputManager({target,document:doc,navigator:{getGamepads:()=>pads},storage:{getItem:()=>null,setItem(){}}});
 const tick=(n=1)=>{for(let i=0;i<n;i++)input.sample(1/60);paintInputPrompts(input,doc);};
 tick();assert.equal(doc.body.dataset.inputKind,'keyboard');assert.equal(doc.getElementById('prompt-camera').textContent,'C');assert.equal(doc.getElementById('prompt-confirm').textContent,'ENTER');
 const pad=(id,index,mapping='standard')=>({id,index,mapping,connected:true,axes:[0,0,0,0],buttons:Array.from({length:18},()=>({value:0,pressed:false}))});const xbox=pad('Xbox Controller',0);pads=[xbox];tick(8);assert.equal(doc.body.dataset.inputKind,'keyboard');xbox.buttons[3]={value:1,pressed:true};tick();assert.equal(doc.body.dataset.inputKind,'xbox');assert.equal(doc.getElementById('prompt-camera').textContent,'Y');assert.equal(doc.getElementById('prompt-boost').textContent,'A');assert.equal(doc.getElementById('prompt-handbrake').textContent,'B');
 xbox.buttons[3]={value:0,pressed:false};target.emit('keydown',{code:'KeyW'});tick();assert.equal(doc.body.dataset.inputKind,'keyboard');target.emit('keyup',{code:'KeyW'});for(let i=0;i<30;i++){xbox.axes[0]=Math.sin(i)*.02;tick();}assert.equal(doc.body.dataset.inputKind,'keyboard');
 const sony=pad('DualSense Wireless Controller (Vendor: 054c Product: 0ce6)',1);pads.push(sony);tick(8);sony.buttons[3]={value:1,pressed:true};tick();assert.equal(doc.body.dataset.inputKind,'playstation');assert.equal(doc.getElementById('prompt-camera').textContent,'△');assert.equal(doc.getElementById('prompt-boost').textContent,'✕');assert.equal(doc.getElementById('prompt-handbrake').textContent,'○');assert.equal(doc.getElementById('prompt-back').textContent,'○');assert.equal(doc.getElementById('input-device-name').textContent,'PLAYSTATION');
 const wheel=pad('Logitech G920 Driving Force',2,'');pads.push(wheel);tick(8);wheel.axes[0]=.8;tick();assert.equal(doc.body.dataset.inputKind,'wheel');assert.equal(doc.getElementById('quick-calibrate').classList.contains('hidden'),false);assert.equal(doc.getElementById('prompt-camera').dataset.kind,'keyboard');assert.equal(doc.getElementById('prompt-camera').textContent,'C');
 input.destroy();
});

doc.settleAnimations();await flushMicrotasks();report.status='passed';fs.writeFileSync(new URL('./ui-v6-results.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
