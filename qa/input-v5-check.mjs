import assert from 'node:assert/strict';
import fs from 'node:fs';
import {InputManager} from '../dist/input.js';
import {DrivingFeedback} from '../dist/haptics.js';

class Target{
 constructor(){this.events=new Map();this.hidden=false;}
 addEventListener(k,fn){this.events.set(k,[...(this.events.get(k)||[]),fn]);}
 removeEventListener(k,fn){this.events.set(k,(this.events.get(k)||[]).filter(f=>f!==fn));}
 emit(k,e={}){for(const fn of this.events.get(k)||[])fn({target:{tagName:'CANVAS'},preventDefault(){},...e});}
}
const pad=(id,index=0,mapping='standard')=>({id,index,mapping,connected:true,axes:[0,0,0,0],buttons:Array.from({length:18},()=>({value:0,pressed:false}))});
const press=(p,i,v=1)=>p.buttons[i]={value:v,pressed:v>.5};
function setup(pads=[]){
 const t=new Target(),doc=new Target(),saved=new Map(),env={pads},storage={getItem:k=>saved.get(k),setItem:(k,v)=>saved.set(k,v)};
 const input=new InputManager({target:t,document:doc,navigator:{getGamepads:()=>env.pads},storage});
 const tick=(n=1,dt=1/60)=>{let r;for(let i=0;i<n;i++)r=input.sample(dt);return r;};
 const release=()=>{for(const p of env.pads)if(p){for(let i=0;i<p.buttons.length;i++)press(p,i,0);}input.clear();tick(8);};
 tick(8);return {input,t,doc,env,storage,saved,tick,release};
}
const report={status:'pending',checks:[],haptics:{}};
function check(name,fn){fn();report.checks.push(name);}

check('Standard layout is A/Cross NOS, B/Circle handbrake, Y/Triangle camera, R3 transmission; menu face buttons remain contextual',()=>{
 for(const [id,kind,labels] of [['Xbox Wireless Controller','xbox',['A','B','Y']],['Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)','playstation',['✕','○','△']]]){
  const p=pad(id),{input,tick,release}=setup([p]);
  press(p,0);let r=tick();assert.equal(r.controls.boost,true);assert.equal(r.controls.handbrake,0);assert.equal(input.getPresentation().kind,kind);assert.equal(input.prompt('boost').label,labels[0]);release();
  press(p,1);r=tick();assert.equal(r.controls.handbrake,1);assert.equal(r.controls.boost,false);assert.equal(input.prompt('handbrake').label,labels[1]);release();
  press(p,3);r=tick();assert.ok(r.actions.includes('camera'));assert.ok(!r.actions.includes('transmission'));assert.equal(input.prompt('camera').label,labels[2]);assert.ok(!tick().actions.includes('camera'));release();
  press(p,11);r=tick();assert.ok(r.actions.includes('transmission'));assert.ok(!r.actions.includes('camera'));release();
  input.setContext('menu');input.setEnabled(false);tick(8);press(p,0);r=tick();assert.ok(r.actions.includes('confirm'));assert.equal(r.controls.boost,false);release();press(p,1);r=tick();assert.ok(r.actions.includes('back'));assert.equal(r.controls.handbrake,0);release();
  press(p,7,.85);r=tick(60);assert.ok(!r.actions.some(a=>a.startsWith('menu')));input.destroy();
 }
});

check('Meaningful activity selects glyphs without connected-device, idle-stick or held-trigger flicker; keyboard and touch reclaim immediately',()=>{
 const p=pad('Xbox Controller'),w=pad('Logitech G920 Driving Force',1,'');w.axes=[0,1,1,1];const {input,t,tick}=setup([p,w]);
 assert.equal(input.getPresentation().kind,'keyboard');
 for(let i=0;i<120;i++){p.axes[0]=Math.sin(i)*.06;p.axes[1]=Math.cos(i)*.08;tick();}assert.equal(input.getPresentation().kind,'keyboard');
 p.axes[0]=.8;tick();assert.equal(input.getPresentation().kind,'xbox');press(p,7,.9);tick();
 t.emit('keydown',{code:'KeyW'});assert.equal(input.getPresentation().kind,'keyboard');tick(60);assert.equal(input.getPresentation().kind,'keyboard','Held trigger stole prompts without activity');t.emit('keyup',{code:'KeyW'});
 p.axes[0]=0;tick();p.axes[0]=-.9;tick();assert.equal(input.getPresentation().kind,'xbox');
 input.setTouch('handbrake',1);assert.equal(input.getPresentation().kind,'touch');input.setTouch('handbrake',0);t.emit('pointerdown',{pointerType:'mouse'});assert.equal(input.getPresentation().kind,'keyboard');
 const revision=input.getPresentation().revision;tick(20);assert.equal(input.getPresentation().revision,revision);input.destroy();
});

check('Detected wheels report calibration needs and real assigned button numbers; calibrated wheel profiles do not disable standard controllers',()=>{
 const p=pad('Xbox Controller'),w=pad('Logitech G920 Driving Force',1,'');w.axes=[0,1,1,1];const {input,tick,release}=setup([p,w]);
 press(w,4);tick();assert.equal(input.getPresentation().kind,'wheel');assert.equal(input.getPresentation().needsCalibration,true);release();
 const ref=input.listDevices().find(d=>d.id===w.id).ref;
 input.bind('steer',{type:'axis',device:ref,index:0,min:-1,center:0,max:1});input.bind('throttle',{type:'axis',device:ref,index:1,rest:1,pressed:-1});
 input.bind('camera',{type:'button',device:ref,index:9});input.bind('handbrake',{type:'button',device:ref,index:1});input.bind('boost',{type:'button',device:ref,index:0});input.setConfig({mode:'custom'});
 w.axes[0]=.6;w.axes[1]=-.5;let r=tick();assert.ok(r.controls.steer>.5&&r.controls.throttle>.7);assert.equal(input.getPresentation().needsCalibration,false);assert.equal(input.prompt('throttle').label,'GAS');assert.equal(input.prompt('camera').label,'B9');
 w.axes=[0,1,1,1];release();press(w,9);assert.ok(tick().actions.includes('camera'));release();
 press(p,3);r=tick();assert.ok(r.actions.includes('camera'));assert.equal(input.getPresentation().kind,'xbox');assert.equal(input.prompt('camera').label,'Y');release();
 press(p,7,.8);assert.ok(tick().controls.throttle>.7);input.destroy();
});

check('Per-device custom bindings override conflicting standard driving buttons but do not steal canonical menu confirm/back',()=>{
 const p=pad('Xbox Controller'),{input,tick,release}=setup([p]);const ref=input.listDevices()[0].ref;
 input.bind('camera',{type:'button',device:ref,index:2});input.bind('boost',{type:'button',device:ref,index:0});
 press(p,2);const r=tick();assert.ok(r.actions.includes('camera'));assert.ok(!r.actions.includes('settings'));assert.equal(input.prompt('camera').label,'X');release();
 press(p,3);assert.ok(!tick().actions.includes('camera'));release();input.setContext('menu');input.setEnabled(false);tick(8);press(p,0);assert.ok(tick().actions.includes('confirm'));release();press(p,1);assert.ok(tick().actions.includes('back'));input.destroy();
});

check('Escape emits game home without legacy duplicate pause; nested UI Escape stays back and P remains pause',()=>{
 const {input,t,tick}=setup();input.setConfig({keys:{pause:['Escape','KeyP']}});
 t.emit('keydown',{code:'Escape'});let r=tick();assert.ok(r.actions.includes('home'));assert.ok(!r.actions.includes('pause')&&!r.actions.includes('back'));assert.ok(!tick().actions.includes('home'));t.emit('keyup',{code:'Escape'});tick();
 t.emit('keydown',{code:'KeyP'});assert.ok(tick().actions.includes('pause'));t.emit('keyup',{code:'KeyP'});tick();
 input.setContext('menu');input.setEnabled(false);t.emit('keydown',{code:'Escape',target:{tagName:'SELECT'}});r=tick();assert.ok(r.actions.includes('back'));assert.ok(!r.actions.includes('home')&&!r.actions.includes('pause'));input.destroy();
});

check('Held menu confirm, back and D-pad navigation cannot accidentally fire NOS, handbrake or starter when resuming',()=>{
 for(const [button,control] of [[0,'boost'],[1,'handbrake'],[12,'starter']]){
  const p=pad('Xbox Controller'),{input,tick}=setup([p]);input.setContext('menu');input.setEnabled(false);tick(8);press(p,button);tick();input.clear();input.setContext('game');input.setEnabled(true);
  assert.equal(Boolean(tick().controls[control]),false);assert.equal(Boolean(tick(8).controls[control]),false);
  press(p,button,0);tick();press(p,button);assert.equal(Boolean(tick().controls[control]),true);input.destroy();
 }
});

check('Visibility restoration accepts the first fresh Escape while still requiring held controller buttons to be released',()=>{
 const p=pad('Xbox Controller'),{input,t,doc,tick}=setup([p]);input.setContext('menu');input.setEnabled(false);tick(8);press(p,0);press(p,1);tick();
 doc.hidden=true;doc.emit('visibilitychange');tick(4);doc.hidden=false;doc.emit('visibilitychange');let r=tick();assert.ok(!r.actions.includes('confirm')&&!r.actions.includes('back'));
 doc.hidden=true;doc.emit('visibilitychange');tick(4);doc.hidden=false;doc.emit('visibilitychange');t.emit('keydown',{code:'Escape'});r=tick();assert.ok(r.actions.includes('back'));assert.ok(!r.actions.includes('confirm'));t.emit('keyup',{code:'Escape'});r=tick();assert.ok(!r.actions.includes('back')&&!r.actions.includes('confirm'));
 press(p,0,0);press(p,1,0);tick();press(p,0);assert.ok(tick().actions.includes('confirm'));input.destroy();
});

check('Controller navigation repeats at a bounded rate, suppresses held buttons through context changes and keeps saved mappings intact',()=>{
 const p=pad('Xbox Controller'),{input,tick,release,storage,saved}=setup([p]);input.setContext('menu');input.setEnabled(false);tick(8);
 p.axes[1]=.9;let count=0;for(let i=0;i<120;i++)count+=tick().actions.includes('menuNext');assert.ok(count>=9&&count<=13);p.axes[1]=0;release();
 press(p,0);assert.ok(tick().actions.includes('confirm'));input.setContext('game');input.setEnabled(true);assert.ok(!tick().actions.includes('confirm'));input.setContext('menu');input.setEnabled(false);assert.ok(!tick().actions.includes('confirm'));release();
 const ref=input.listDevices()[0].ref;input.bind('camera',{type:'button',device:ref,index:5});input.saveProfile('Own map');
 const loaded=new InputManager({target:new Target(),document:new Target(),navigator:{getGamepads:()=>[p]},storage});assert.equal(loaded.getConfig().bindings.camera[0].index,5);assert.ok(loaded.listProfiles().includes('Own map'));assert.ok(saved.size>0);loaded.destroy();input.destroy();
});

class Actuator{
 constructor(){this.effects=['dual-rumble'];this.time=0;this.calls=[];this.resets=0;this.current=null;}
 playEffect(type,params){assert.equal(type,'dual-rumble');this.current?.resolve('preempted');this.calls.push({time:this.time,...params});let resolve;const promise=new Promise(r=>resolve=r);this.current={end:this.time+params.duration/1000,resolve};return promise;}
 reset(){this.resets++;this.current?.resolve('preempted');this.current=null;return Promise.resolve('complete');}
 step(dt){this.time+=dt;if(this.current&&this.current.end<=this.time){this.current.resolve('complete');this.current=null;}}
}
const vehicle=(extra={})=>({speed:25,throttle:.6,engineRunning:true,gear:2,boosting:false,drifting:false,absActive:false,wheelAudio:[0,1,2,3].map(()=>({contact:true,load:3200,roughness:.001,longitudinalSpeed:25,lateralSpeed:0,tyrePower:0,impactSpeed:0})),...extra});
async function runFeedback(input,actuator,state,frames=60){let gaps=0,pending=0;for(let i=0;i<frames;i++){input.sample(1/60);input.updateFeedback(state,1/60,{active:true});pending=Math.max(pending,input.snapshot().feedback.pending);if(i>5&&!actuator.current)gaps++;actuator.step(1/60);await Promise.resolve();}return {gaps,pending};}

{
 const p=pad('Xbox Controller');p.vibrationActuator=new Actuator();const {input,t,tick,doc,env}=setup([p]);press(p,7,.8);tick();
 const results=await runFeedback(input,p.vibrationActuator,vehicle({boosting:true}),180);
 assert.equal(results.gaps,0);assert.ok(results.pending<=2);assert.ok(p.vibrationActuator.calls.length>=25&&p.vibrationActuator.calls.length<=36);
 assert.ok(p.vibrationActuator.calls.at(-1).strongMagnitude>.36);assert.ok(p.vibrationActuator.calls.at(-1).weakMagnitude>.5);
 assert.ok(p.vibrationActuator.calls.every(c=>c.duration<=200&&c.strongMagnitude<=1&&c.weakMagnitude<=1));
 const prior=p.vibrationActuator.resets;input.updateFeedback(vehicle(),1/60,{active:false});assert.ok(p.vibrationActuator.resets>prior);assert.equal(p.vibrationActuator.current,null);
 await runFeedback(input,p.vibrationActuator,vehicle({boosting:true}),15);input.setConfig({haptics:false});assert.equal(p.vibrationActuator.current,null);const calls=p.vibrationActuator.calls.length;await runFeedback(input,p.vibrationActuator,vehicle({boosting:true}),15);assert.equal(p.vibrationActuator.calls.length,calls);
 input.setConfig({haptics:true});await runFeedback(input,p.vibrationActuator,vehicle({boosting:true}),15);t.emit('keydown',{code:'KeyW'});assert.equal(p.vibrationActuator.current,null);t.emit('keyup',{code:'KeyW'});press(p,3);tick();await runFeedback(input,p.vibrationActuator,vehicle({boosting:true}),15);doc.hidden=true;doc.emit('visibilitychange');assert.equal(p.vibrationActuator.current,null);doc.hidden=false;
 press(p,3,0);tick();press(p,3);tick();await runFeedback(input,p.vibrationActuator,vehicle({boosting:true}),15);env.pads=[];tick();assert.equal(p.vibrationActuator.current,null);input.destroy();
 report.haptics.sustained={...results,calls:p.vibrationActuator.calls.length,resets:p.vibrationActuator.resets};report.checks.push('NOS rumble remains continuous with bounded calls/promises, and pause, disabled haptics, keyboard takeover, visibility and disconnect stop hardware immediately');
}

{
 const p=pad('Xbox Controller');p.vibrationActuator=new Actuator();const {input,tick}=setup([p]);press(p,7,.8);tick();
 await runFeedback(input,p.vibrationActuator,vehicle(),30);const base=input.snapshot().feedback.levels;
 const drift=vehicle({drifting:true});drift.wheelAudio[2].tyrePower=36000;drift.wheelAudio[3].tyrePower=41000;await runFeedback(input,p.vibrationActuator,drift,30);const sliding=input.snapshot().feedback.levels;assert.ok(sliding.weak>base.weak+.1);
 const abs=vehicle({absActive:true});await runFeedback(input,p.vibrationActuator,abs,30);const absCalls=p.vibrationActuator.calls.slice(-4);assert.ok(absCalls.some(c=>c.weakMagnitude>.07));
 const curb=vehicle();curb.wheelAudio[0].impactSpeed=3;await runFeedback(input,p.vibrationActuator,curb,10);assert.ok(input.snapshot().feedback.levels.strong>.2);
 await runFeedback(input,p.vibrationActuator,vehicle(),20);input.rumble(.65,160);await runFeedback(input,p.vibrationActuator,vehicle(),3);assert.ok(input.snapshot().feedback.levels.strong>.45);
 const newGear=vehicle({gear:3});await runFeedback(input,p.vibrationActuator,newGear,2);assert.ok(input.snapshot().feedback.levels.strong>.12);
 const parked=vehicle({speed:0,throttle:0});parked.wheelAudio.forEach(w=>w.longitudinalSpeed=0);await runFeedback(input,p.vibrationActuator,parked,90);assert.equal(p.vibrationActuator.current,null);
 input.destroy();report.checks.push('Drift slip work, ABS, curb shocks, gear changes and additive collision pulses create distinct feedback; parked idle settles to zero');
}

{
 const pending=new DrivingFeedback(),hung={key:'hung',gp:{vibrationActuator:{effects:['dual-rumble'],playEffect(){return new Promise(()=>{});},reset(){return Promise.resolve();}}}};
 for(let i=0;i<600;i++)pending.update(vehicle({boosting:true}),1/60,{target:hung});assert.equal(pending.calls,2);assert.equal(pending.inFlight.size,2);pending.stop();assert.equal(pending.inFlight.size,0);
 const bad=new DrivingFeedback(),reject={key:'reject',gp:{vibrationActuator:{effects:['dual-rumble'],playEffect(){return Promise.reject(Error('unavailable'));},reset(){return Promise.resolve();}}}};
 bad.update(vehicle({boosting:true}),1/60,{target:reject});await Promise.resolve();await Promise.resolve();assert.equal(bad.playing,false);const calls=bad.calls;for(let i=0;i<60;i++)bad.update(vehicle({boosting:true}),1/60,{target:reject});assert.equal(bad.calls,calls);
 const unsupported=new DrivingFeedback(),wheel={key:'wheel',gp:{vibrationActuator:{effects:['force-feedback'],playEffect(){throw Error('Must not fake wheel FFB');}}}};unsupported.update(vehicle({boosting:true}),1/60,{target:wheel});assert.equal(unsupported.calls,0);
 report.checks.push('Hung and rejected haptic promises cannot create an unbounded queue; unsupported wheel force feedback is never invoked');
}

report.status='passed';report.verificationLimit='Deterministic Gamepad and actuator hosts, no physical controller or wheel test.';
fs.writeFileSync(new URL('./input-v5-results.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
