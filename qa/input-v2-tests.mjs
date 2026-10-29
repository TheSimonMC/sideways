import assert from 'node:assert/strict';
import { InputManager } from '../dist/input.js';
class Target{
 constructor(){this.events=new Map();}
 addEventListener(k,f){const arr=this.events.get(k)||[];arr.push(f);this.events.set(k,arr);}
 removeEventListener(k,f){this.events.set(k,(this.events.get(k)||[]).filter(x=>x!==f));}
 emit(k,e={}){for(const f of this.events.get(k)||[])f({target:{tagName:'BODY'},preventDefault(){},...e});}
}
const makePad=(id,index,axes=4,buttons=18,mapping='')=>({id,index,connected:true,mapping,axes:Array(axes).fill(0),buttons:Array.from({length:buttons},()=>({value:0,pressed:false})),timestamp:0});
const press=(pad,i,value=1)=>{pad.buttons[i]={value,pressed:value>.5};};
const storeData=new Map();const storage={getItem:k=>storeData.get(k)||null,setItem:(k,v)=>storeData.set(k,v)};
let pads=[];const target=new Target(),doc=new Target();doc.hidden=false;
const input=new InputManager({navigator:{getGamepads:()=>pads},target,document:doc,storage});
const tick=(n=1)=>{let result;for(let i=0;i<n;i++)result=input.sample(1/60);return result;};
const release=()=>{for(const p of pads)if(p){p.axes.fill(0);for(let i=0;i<p.buttons.length;i++)press(p,i,0);}input.clear();tick(8);};
let tests=0;function test(name,fn){fn();tests++;console.log('PASS '+name);}

test('keyboard signed steering and analog clutch convention',()=>{
 target.emit('keydown',{code:'KeyD'});target.emit('keydown',{code:'KeyW'});target.emit('keydown',{code:'ControlLeft'});
 const s=tick();assert.equal(s.controls.steer,1);assert.equal(s.controls.throttle,1);assert.equal(s.controls.clutch,1);
 target.emit('keyup',{code:'KeyD'});target.emit('keyup',{code:'KeyW'});target.emit('keyup',{code:'ControlLeft'});assert.equal(tick().controls.throttle,0);
});
test('shift action is one edge while held',()=>{target.emit('keydown',{code:'KeyE'});assert.ok(tick().actions.includes('shiftUp'));assert.ok(!tick().actions.includes('shiftUp'));target.emit('keyup',{code:'KeyE'});tick();});
test('touch analog input and clear release',()=>{input.setTouch('throttle',.7);input.setTouch('steer',-.4);assert.equal(tick().controls.throttle,.7);assert.equal(tick().controls.steer,-.4);input.clear();assert.equal(tick().controls.throttle,0);});
const pad=makePad('Xbox Controller',0,4,18,'standard');pads=[pad];tick(8);
test('standard controller triggers, stick and bumpers',()=>{
 pad.axes[0]=.7;press(pad,7,.6);press(pad,6,.25);press(pad,4);const s=tick();assert.ok(s.controls.steer>.5);assert.ok(s.controls.throttle>.58&&s.controls.throttle<.60);assert.ok(s.controls.brake>.22);assert.ok(s.actions.includes('shiftDown'));assert.ok(!tick().actions.includes('shiftDown'));release();
});
test('clear and context transitions do not retrigger held Start',()=>{
 press(pad,9);assert.ok(tick().actions.includes('pause'));input.clear();input.setContext('menu');input.setEnabled(false);assert.ok(!tick(12).actions.includes('pause'));press(pad,9,0);tick(8);press(pad,9);assert.ok(tick().actions.includes('pause'));release();
});
test('disabled driving retains menu keyboard and repeating navigation',()=>{
 target.emit('keydown',{code:'ArrowDown'});input.setEnabled(false);assert.ok(tick().actions.includes('menuNext'));assert.equal(tick().controls.throttle,0);
 let repeat=0;for(let i=0;i<60;i++){input.setEnabled(false);repeat+=tick().actions.includes('menuNext')?1:0;}assert.ok(repeat>=4&&repeat<=6);
 target.emit('keyup',{code:'ArrowDown'});tick();
});
test('menu horizontal stick and A confirm mapping',()=>{pad.axes[0]=.8;assert.ok(tick().actions.includes('menuRight'));pad.axes[0]=0;press(pad,0);assert.ok(tick().actions.includes('confirm'));assert.equal(tick().controls.handbrake,0);release();});
input.setContext('game');input.setEnabled(true);tick(8);
const wheel=makePad('Logitech G920 test',2,4,16);wheel.axes=[0,1,1,1];const shifter=makePad('USB H Shifter test',5,2,8);pads=[pad,null,wheel,null,null,shifter];tick(8);
const wheelInfo=input.listDevices().find(d=>d.id===wheel.id),shiftInfo=input.listDevices().find(d=>d.id===shifter.id);
input.bind('steer',{type:'axis',device:wheelInfo.ref,index:0,min:-1,center:0,max:1});
for(const [role,index]of [['throttle',1],['brake',2],['clutch',3]])input.bind(role,{type:'axis',device:wheelInfo.ref,index,rest:1,pressed:-1});
input.setConfig({mode:'custom',manualClutch:true,transmission:'hpattern'});
test('independent inverted pedals and calibrated center',()=>{assert.equal(tick().controls.throttle,0);wheel.axes[1]=-1;wheel.axes[2]=0;wheel.axes[3]=-.4;const c=tick().controls;assert.equal(c.throttle,1);assert.ok(c.brake>.47&&c.brake<.5);assert.ok(c.clutch>.68);wheel.axes=[0,1,1,1];tick();});
test('steering calibration detects reversed axis',()=>{
 input.beginCalibration('steer');wheel.axes[0]=0.04;input.captureCalibration('center');wheel.axes[0]=.94;input.captureCalibration('left');wheel.axes[0]=-.91;input.captureCalibration('right');const result=input.finishCalibration();assert.equal(result.binding.invert,true);wheel.axes[0]=.04;tick(8);wheel.axes[0]=.94;assert.equal(tick().controls.steer,-1);wheel.axes[0]=-.91;assert.equal(tick().controls.steer,1);wheel.axes[0]=.04;tick();
});
test('pedal calibration and disabled preview are live',()=>{
 input.beginCalibration('throttle');wheel.axes[1]=.82;input.captureCalibration('rest');wheel.axes[1]=-.84;input.captureCalibration('pressed');input.finishCalibration();wheel.axes[1]=.82;tick(8);input.setEnabled(false);wheel.axes[1]=-.84;const s=tick();assert.equal(s.controls.throttle,0);assert.equal(input.snapshot().previewControls.throttle,1);wheel.axes[1]=.82;input.setEnabled(true);tick();
});
test('combined pedal axis uses opposite halves without phantom throttle',()=>{
 input.bind('throttle',{type:'axis',device:wheelInfo.ref,index:1,rest:0,pressed:-1});input.bind('brake',{type:'axis',device:wheelInfo.ref,index:1,rest:0,pressed:1});wheel.axes[1]=0;assert.equal(tick().controls.throttle,0);assert.equal(tick().controls.brake,0);
 wheel.axes[1]=-.7;assert.ok(tick().controls.throttle>.68);assert.equal(tick().controls.brake,0);wheel.axes[1]=.8;assert.equal(tick().controls.throttle,0);assert.ok(tick().controls.brake>.79);wheel.axes[1]=0;tick();
});
for(let i=0;i<7;i++)input.bind(i===6?'gearReverse':`gear${i+1}`,{type:'button',device:shiftInfo.ref,index:i});
test('separate H-shifter holds all gears, neutral and conflicting buttons',()=>{
 assert.equal(tick().controls.gearRequest,0);
 for(let i=0;i<7;i++){press(shifter,i);assert.equal(tick().controls.gearRequest,i===6?-1:i+1);press(shifter,i,0);assert.equal(tick().controls.gearRequest,0);}
 press(shifter,0);press(shifter,1);assert.equal(tick().controls.gearRequest,0);press(shifter,0,0);press(shifter,1,0);tick();
});
test('active shifter disconnect pauses and clears held gear',()=>{press(shifter,2);assert.equal(tick().controls.gearRequest,3);pads[5]=null;const result=tick();assert.equal(result.controls.gearRequest,0);assert.ok(result.actions.includes('deviceLost'));assert.ok(!tick().actions.includes('deviceLost'));});
test('reconnect at a different index restores device identity after release',()=>{shifter.index=7;press(shifter,2,0);pads[7]=shifter;tick(8);press(shifter,5);assert.equal(tick().controls.gearRequest,6);press(shifter,5,0);tick();});
test('unused accessory disconnect does not pause driving',()=>{const unused=makePad('Unused joystick',4);pads[4]=unused;tick(8);pads[4]=null;assert.ok(!tick().actions.includes('deviceLost'));});
test('learn detects actual button, auto-binds and suppresses captured action',()=>{
 input.setContext('menu');input.setEnabled(false);tick(8);input.learn('pause',{deviceKey:wheelInfo.key,kind:'button'});press(wheel,10);const result=tick();assert.ok(!result.actions.includes('pause'));const learned=input.consumeLearnResult();assert.equal(learned.binding.index,10);assert.equal(input.getConfig().bindings.pause[0].device.id,wheel.id);assert.equal(input.consumeLearnResult(),null);assert.equal(input.snapshot().learn.status,'complete');press(wheel,10,0);tick(8);
});
test('learn ignores idle axis noise then binds pedal travel',()=>{
 input.learn('clutch',{deviceKey:wheelInfo.key,kind:'axis'});wheel.axes[3]=.98;tick(3);assert.equal(input.snapshot().learn.active,true);wheel.axes[3]=-.8;tick();const result=input.consumeLearnResult();assert.equal(result.binding.index,3);assert.equal(result.binding.pressed,-1);assert.equal(result.binding.rest,1);wheel.axes[3]=1;tick(8);
});
test('profile persistence keeps IDs, not browser indexes',()=>{
 input.saveProfile('G920 + USB Shifter');assert.ok(input.listProfiles().includes('G920 + USB Shifter'));input.setConfig({transmission:'auto'});input.loadProfile('G920 + USB Shifter');assert.equal(input.getConfig().transmission,'hpattern');
 const other=new InputManager({navigator:{getGamepads:()=>pads},target:new Target(),document:doc,storage});assert.equal(other.getConfig().bindings.gear1[0].device.id,shifter.id);assert.ok(!hasIndex(other.getConfig().bindings.gear1[0].device));other.destroy();
});
function hasIndex(object){return Object.prototype.hasOwnProperty.call(object,'index');}
test('axis-pair H pattern resolves captured slots and neutral gate',()=>{
 input.configureAxisShifter({deviceKey:shiftInfo.key,xAxis:0,yAxis:1,tolerance:.15});shifter.axes=[-.8,-.8];input.captureShifterGear(1);shifter.axes=[-.8,.8];input.captureShifterGear(2);shifter.axes=[.8,.8];input.captureShifterGear(-1);shifter.axes=[0,0];input.setContext('game');input.setEnabled(true);tick(8);assert.equal(tick().controls.gearRequest,0);shifter.axes=[-.79,-.82];assert.equal(tick().controls.gearRequest,1);shifter.axes=[.8,.8];assert.equal(tick().controls.gearRequest,-1);shifter.axes=[0,0];tick();
});
test('raw diagnostics expose values, counts and preview separately',()=>{input.setEnabled(false);const s=input.snapshot(),w=s.devices.find(d=>d.id===wheel.id);assert.equal(w.axisCount,4);assert.ok(Array.isArray(w.axes));assert.ok(Array.isArray(w.buttons));assert.ok(s.previewControls);assert.equal(s.controls.throttle,0);});
test('blur releases keyboard, touch and requires device release',()=>{input.setEnabled(true);target.emit('keydown',{code:'KeyW'});input.setTouch('boost',1);target.emit('blur');assert.equal(tick().controls.throttle,0);assert.equal(tick().controls.boost,false);});
test('security-blocked API fails safely with keyboard available',()=>{const denied=new InputManager({navigator:{getGamepads(){const e=new Error();e.name='SecurityError';throw e;}},target:new Target(),document:doc,storage});assert.equal(denied.sample().controls.throttle,0);assert.match(denied.snapshot().error,/HTTPS/);denied.destroy();});

test('calibration permits deliberate confirm/back and blocks steering navigation',()=>{
 const p=makePad('Calibration pad',0,4,18,'standard'),w=makePad('Calibration wheel',1,3,4);const t=new Target();
 const m=new InputManager({navigator:{getGamepads:()=>[p,w]},target:t,document:doc,storage:{getItem(){return null;},setItem(){}}});
 m.setContext('menu');m.setEnabled(false);for(let i=0;i<8;i++)m.sample();
 m.bind('steer',{type:'axis',device:m.listDevices()[1].ref,index:0,min:-1,center:0,max:1});m.beginCalibration('steer');
 w.axes[0]=1;p.axes[0]=.9;p.axes[1]=.9;let r=m.sample();assert.ok(!r.actions.some(a=>a.startsWith('menu')));assert.equal(r.controls.steer,0);
 press(p,0);assert.ok(m.sample().actions.includes('confirm'));assert.ok(!m.sample().actions.includes('confirm'));press(p,0,0);m.sample();press(p,1);assert.ok(m.sample().actions.includes('back'));
 press(p,1,0);p.axes.fill(0);m.cancelCalibration();m.sample();m.bind('handbrake',{type:'button',device:m.listDevices()[0].ref,index:0});m.beginCalibration('handbrake');
 press(p,0);assert.ok(!m.sample().actions.includes('confirm'));t.emit('keydown',{code:'Enter'});assert.ok(m.sample().actions.includes('confirm'));m.destroy();
});
test('learn timeout produces one consumable terminal result',()=>{
 const m=new InputManager({navigator:{getGamepads:()=>[]},target:new Target(),document:doc,storage:{getItem(){return null;},setItem(){}}});m.learn('pause',{kind:'button',timeout:1000});for(let i=0;i<65;i++)m.sample();const result=m.consumeLearnResult();assert.equal(result.status,'timeout');assert.ok(result.error);assert.equal(m.consumeLearnResult(),null);m.destroy();
});
test('countdown-to-driving transition retains held keyboard throttle',()=>{
 const t=new Target(),m=new InputManager({navigator:{getGamepads:()=>[]},target:t,document:doc,storage:{getItem(){return null;},setItem(){}}});m.setContext('menu');m.setEnabled(false);t.emit('keydown',{code:'KeyW'});m.sample();m.setContext('game');m.setEnabled(true);assert.equal(m.sample().controls.throttle,1);m.destroy();
});

input.destroy();
console.log(JSON.stringify({tests,status:'passed'}));
