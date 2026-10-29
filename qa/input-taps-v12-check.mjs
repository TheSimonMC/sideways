import fs from 'node:fs';
import assert from 'node:assert/strict';
import {InputManager} from '../dist/input.js';
import {adjustRange} from '../dist/navigation.js';
import {parseHTML,installDOM,Target} from './dom-v5-harness.mjs';
const report={status:'pending',checks:[],limit:'Actual InputManager with event-level keyboard ordering and deterministic Gamepad host; no physical hardware claim.'};
const check=(name,fn)=>{fn();report.checks.push(name);console.log('PASS '+name);};
function setup(context='menu',pads=[]){
 const {doc}=parseHTML('<body><canvas id="game"></canvas><input id="volume" type="range" min="0" max="100" step="1" value="50"><input id="text" type="text"></body>');installDOM(doc);const target=new Target(),input=new InputManager({target,document:doc,navigator:{getGamepads:()=>pads},storage:{getItem:()=>null,setItem(){}}});input.setContext(context);input.setEnabled(context==='game');for(let i=0;i<8;i++)input.sample(1/60);
 const down=(code,options={})=>target.emit('keydown',{code,target:doc.getElementById('game'),...options}),up=code=>target.emit('keyup',{code}),tap=(code,options={})=>{down(code,options);up(code);},tick=()=>input.sample(1/60);
 return{input,doc,target,down,up,tap,tick};
}

check('Complete range-arrow taps between frames are delivered once and subsequent taps still work',()=>{
 const {input,doc,tap,tick}=setup(),range=doc.getElementById('volume');tap('ArrowLeft',{target:range});let sample=tick();assert.deepEqual(sample.actions,['menuLeft']);for(const action of sample.actions)adjustRange(range,action==='menuLeft'?-1:1);assert.equal(range.value,'49');assert.equal(input.keys.has('ArrowLeft'),false);assert.deepEqual(tick().actions,[]);tap('ArrowRight',{target:range});sample=tick();assert.deepEqual(sample.actions,['menuRight']);adjustRange(range,1);assert.equal(range.value,'50');input.destroy();
});
check('Several discrete taps between the same two frames retain their count and order',()=>{
 const {input,tap,tick}=setup();tap('ArrowLeft');tap('ArrowRight');tap('ArrowLeft');assert.deepEqual(tick().actions,['menuLeft','menuRight','menuLeft']);assert.deepEqual(tick().actions,[]);input.destroy();
});
check('Held navigation emits one initial edge, ignores OS repeat, and retains bounded repeat timing',()=>{
 const {input,down,up,tick}=setup();down('ArrowDown');assert.deepEqual(tick().actions,['menuNext']);down('ArrowDown',{repeat:true});for(let i=0;i<20;i++)assert.deepEqual(tick().actions,[]);let repeats=0;for(let i=0;i<35;i++)repeats+=tick().actions.filter(a=>a==='menuNext').length;assert.ok(repeats>=3&&repeats<=5);up('ArrowDown');assert.deepEqual(tick().actions,[]);input.destroy();
});
check('Held confirm never doubles; release and press between sampled frames generates a fresh action',()=>{
 const {input,down,up,tick}=setup();down('Enter');assert.deepEqual(tick().actions,['confirm']);for(let i=0;i<40;i++)assert.deepEqual(tick().actions,[]);up('Enter');down('Enter');assert.deepEqual(tick().actions,['confirm']);up('Enter');assert.deepEqual(tick().actions,[]);input.destroy();
});
check('Text editing, prevented events and native menu Tab do not become game actions',()=>{
 const {input,doc,tap,tick}=setup();tap('ArrowLeft',{defaultPrevented:true});tap('Enter',{defaultPrevented:true});tap('Tab');tap('KeyW',{target:doc.getElementById('text')});assert.deepEqual(tick().actions,[]);tap('Escape',{target:doc.getElementById('text')});assert.deepEqual(tick().actions,['back']);assert.equal(input.wasKeyPressed('Escape'),true);input.destroy();
});
check('Game context buffers discrete camera, shift and Escape actions without latching continuous driving inputs',()=>{
 const {input,tap,tick}=setup('game');for(const code of ['KeyW','ArrowLeft','ControlLeft','Space','ShiftLeft','KeyH'])tap(code);let sample=tick();assert.deepEqual(sample.actions,[]);assert.equal(sample.controls.throttle,0);assert.equal(sample.controls.steer,0);assert.equal(sample.controls.clutch,0);assert.equal(sample.controls.handbrake,0);assert.equal(sample.controls.boost,false);assert.equal(sample.controls.horn,false);
 tap('KeyC');tap('KeyE');tap('Escape');sample=tick();assert.deepEqual(sample.actions,['camera','shiftUp','home']);assert.equal(input.wasKeyPressed('Escape'),true);assert.equal(input.keys.has('Escape'),false);assert.deepEqual(tick().actions,[]);input.destroy();
});
check('Clear, blur, visibility loss, disable and context changes discard queued actions',()=>{
 const {input,doc,target,tap,tick}=setup();tap('Enter');input.clear();assert.deepEqual(tick().actions,[]);tap('Enter');target.emit('blur');assert.deepEqual(tick().actions,[]);tap('Enter');doc.hidden=true;doc.emit('visibilitychange');assert.deepEqual(tick().actions,[]);doc.hidden=false;doc.emit('visibilitychange');assert.deepEqual(tick().actions,[]);
 tap('Enter');input.setContext('game');assert.deepEqual(tick().actions,[]);tap('KeyC');input.setEnabled(true);input.setEnabled(false);assert.deepEqual(tick().actions,[]);input.destroy();
});
check('Consumed key metadata lasts one sample and is cleared with clear or context transition',()=>{
 const {input,tap,tick}=setup();tap('Escape');assert.equal(input.wasKeyPressed('Escape'),false);tick();assert.equal(input.wasKeyPressed('Escape'),true);tick();assert.equal(input.wasKeyPressed('Escape'),false);tap('Escape');tick();input.clear();assert.equal(input.wasKeyPressed('Escape'),false);tap('Escape');tick();input.setContext('game');assert.equal(input.wasKeyPressed('Escape'),false);input.destroy();
});
check('Starting binding capture discards pending input; captured keys do not activate their old or new action',()=>{
 const {input,tap,tick}=setup();tap('Enter');input.learn('camera',{kind:'key',allowKeyboard:true});tap('KeyW');assert.deepEqual(tick().actions,[]);assert.equal(input.consumeLearnResult().action,'camera');assert.deepEqual(input.getKeyBindings().camera,['KeyW']);input.learn('camera',{kind:'key',allowKeyboard:true});tap('Escape');assert.deepEqual(tick().actions,['back']);assert.deepEqual(tick().actions,[]);input.destroy();
});
check('Calibration accepts only fresh confirm/back and cannot leak pending taps after cancellation',()=>{
 const pad={id:'Wheel QA',index:0,mapping:'',connected:true,axes:[0,0],buttons:[{value:0,pressed:false}]};const {input,tap,tick}=setup('menu',[pad]);const device=input.listDevices()[0];input.bind('steer',{type:'axis',index:0,device:device.key,min:-1,max:1,center:0});tap('Enter');input.beginCalibration('steer');assert.deepEqual(tick().actions,[]);tap('ArrowLeft');tap('KeyE');tap('Enter');tap('Escape');assert.deepEqual(tick().actions,['confirm','back']);tap('Enter');input.cancelCalibration();assert.deepEqual(tick().actions,[]);input.destroy();
});
check('Legacy custom key bindings also produce short discrete action taps',()=>{
 const {input,tap,tick}=setup('game');input.bind('camera',{type:'key',code:'KeyZ'});tap('KeyZ');assert.deepEqual(tick().actions,['camera']);assert.deepEqual(tick().actions,[]);input.destroy();
});
report.status='passed';fs.writeFileSync(new URL('./input-taps-v12-results.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
