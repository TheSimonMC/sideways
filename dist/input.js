/** Browser-visible controller input only. No assumed wheel axes or steering-force API. */
import {STANDARD_BUTTONS,deviceKind,buttonPrompt,keyboardPrompt,standardPrompt} from './input-prompts.js';
import {DrivingFeedback} from './haptics.js';
import {isTextEntry} from './navigation.js';
const clamp=(n,a,b)=>Math.max(a,Math.min(b,Number.isFinite(Number(n))?Number(n):a));
const clone=v=>JSON.parse(JSON.stringify(v));
const ACTIONS=['shiftUp','shiftDown','home','pause','camera','reset','mute','confirm','back','menuPrev','menuNext','menuLeft','menuRight','transmission','neutral','settings','garage','lights','interact','map'];
const DRIVE=['steer','steerLeft','steerRight','throttle','brake','clutch','handbrake','boost','starter','horn','lookBack','lookX','lookY','lookLeft','lookRight','lookUp','lookDown'];
const SIGNED=new Set(['steer','lookX','lookY']);
const GEARS=['gear1','gear2','gear3','gear4','gear5','gear6','gearReverse'];
const ALL=new Set([...ACTIONS,...DRIVE,...GEARS]);
const MENU=new Set(['menuPrev','menuNext','menuLeft','menuRight']);
const MENU_ACTIONS=new Set([...MENU,'confirm','back','pause','settings','garage']);
const DEFAULT_KEYS={
 throttle:['KeyW','ArrowUp'],brake:['KeyS','ArrowDown'],steerLeft:['KeyA','ArrowLeft'],steerRight:['KeyD','ArrowRight'],
 clutch:['ControlLeft','ControlRight'],handbrake:['Space'],boost:['ShiftLeft','ShiftRight'],starter:['KeyI'],garage:['KeyG'],
 horn:['KeyH'],lights:['KeyL'],interact:['KeyF'],map:['Tab'],lookBack:['KeyB'],lookLeft:['Numpad4'],lookRight:['Numpad6'],lookUp:['Numpad8'],lookDown:['Numpad2'],
 shiftDown:['KeyQ'],shiftUp:['KeyE'],home:['Escape'],pause:['KeyP'],camera:['KeyC'],reset:['KeyR'],mute:['KeyM'],
 transmission:['KeyT'],neutral:['KeyN'],settings:['KeyO'],confirm:['Enter','Space'],back:['Escape'],
 menuPrev:['ArrowUp','KeyW'],menuNext:['ArrowDown','KeyS'],menuLeft:['ArrowLeft','KeyA'],menuRight:['ArrowRight','KeyD']
};
const DEFAULT_CONFIG={version:4,mode:'auto',transmission:'auto',manualClutch:false,haptics:true,steerDeadzone:.1,steerCurve:1.25,pedalDeadzone:.025,bindings:{},keys:DEFAULT_KEYS,shifter:{enabled:false,mode:'buttons',tolerance:.22,slots:{}}};
const standardButton=STANDARD_BUTTONS;
const standardAxis={steer:0,lookX:2,lookY:3};
const isEditable=el=>isTextEntry(el)||el?.tagName==='SELECT';
const buttonValue=b=>typeof b==='number'?clamp(b,0,1):clamp(b?.value??(b?.pressed?1:0),0,1);
const fingerprint=g=>`${g.id}\u001f${g.axes.length}\u001f${g.buttons.length}`;
const deviceKey=r=>`${encodeURIComponent(r.id)}::${r.axes}:${r.buttons}:${r.ordinal}`;
const hasOwn=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);

export class InputManager {
 constructor(options={}) {
  this.storageKey=options.storageKey||'sideways.input.v2';
  this._nav=options.navigator??globalThis.navigator;
  this._target=options.target??globalThis.window;
  this._doc=options.document??globalThis.document;
  try{this._storage=options.storage??globalThis.localStorage;}catch(_){this._storage=null;}
  this.config=clone(DEFAULT_CONFIG);this._profiles=Object.create(null);this.keys=new Set();this.touch={};
  this._devices=new Map();this._byKey=new Map();this._previous={};this._repeat={};this._blockedActions=new Set();this._blockedDrive=new Set();this._pendingActions=[];this._keyActions=[];this.actionKeys=new Set();
  this._time=0;this._enabled=true;this._context='game';this._destroyed=false;this._recentDriver=new Map();this._uiFeedbackUntil=0;
  this._learn=null;this._learnResult=null;this._calibration=null;this._lastLearn=null;this._axisGear=0;
  this._last={controls:this._zero(),actions:[]};this._error=null;this._saveError=null;this._lastVibration=-10;
  this._presentation={kind:'keyboard',deviceKey:null,name:'KEYBOARD',revision:0};this._feedback=new DrivingFeedback();
  this._load();
  this._onKeyDown=e=>{
   if(e.defaultPrevented||e.code==='Tab'&&this._context==='menu')return;
   if(!e.repeat&&this._isGameKey(e.code))this._setActive('keyboard');
   if(e.code==='Escape'&&this._learn){this.cancelLearn();if(this._context==='menu')this._pendingActions.push('back');e.preventDefault?.();return;}
   if(this._learn?.allowKeyboard&&!e.repeat&&!isEditable(e.target)){
    this.setKeys(this._learn.action,[e.code]);this._completeLearn({action:this._learn.action,binding:{type:'key',code:e.code},label:e.code});e.preventDefault?.();return;
   }
   const fresh=!e.repeat&&!this.keys.has(e.code);
   if(isEditable(e.target)){if(e.code==='Escape'){if(fresh)this._queueKeyActions(e.code);this.keys.add(e.code);e.preventDefault?.();}return;}
   if(fresh)this._queueKeyActions(e.code);
   this.keys.add(e.code);
   if(this._isGameKey(e.code))e.preventDefault?.();
  };
  this._onKeyUp=e=>this.keys.delete(e.code);
  this._onPointerDown=e=>this._setActive(e.pointerType==='touch'?'touch':'keyboard');
  this._onBlur=()=>this.clear();
  this._onVisibility=()=>{if(this._doc?.hidden)this.clear();else{this._previous={};this._repeat={};}};
  this._onDisconnected=()=>this._poll();
  if(options.attachKeyboard!==false){this._target?.addEventListener?.('keydown',this._onKeyDown);this._target?.addEventListener?.('keyup',this._onKeyUp);}
  this._target?.addEventListener?.('pointerdown',this._onPointerDown);
  this._target?.addEventListener?.('blur',this._onBlur);
  this._target?.addEventListener?.('gamepaddisconnected',this._onDisconnected);
  this._doc?.addEventListener?.('visibilitychange',this._onVisibility);
 }
 _zero(){return {steer:0,throttle:0,brake:0,clutch:0,handbrake:0,boost:false,starter:false,horn:false,lookBack:false,lookX:0,lookY:0,gearRequest:undefined,transmission:this.config?.transmission||'auto',manualClutch:!!this.config?.manualClutch};}
 _isGameKey(code){for(const list of Object.values(this.config.keys))if(Array.isArray(list)&&list.includes(code))return true;return false;}
 _keyboardActionAllowed(action,code){
  if(this._learn||this._doc?.hidden)return false;
  if(this._calibration&&action!=='confirm'&&action!=='back')return false;
  if(this._context==='game'&&(MENU.has(action)||action==='confirm'||action==='back'))return false;
  if(this._context==='menu'&&(['home','transmission','neutral','camera','reset','mute','lights','interact'].includes(action)||action==='pause'&&(code==='Escape'||this.keys.has('Escape'))))return false;
  return true;
 }
 _queueKeyActions(code){
  // Preserve short presses until sampling without holding throttle, steering,
  // clutch or other continuous controls beyond the actual key release.
  for(const action of ACTIONS){
   const bound=(this.config.keys[action]||[]).includes(code)||(this.config.bindings[action]||[]).some(binding=>binding.type==='key'&&binding.code===code);
   if(bound&&this._keyboardActionAllowed(action,code))this._keyActions.push({action,code,context:this._context});
  }
 }
 wasKeyPressed(code){return this.actionKeys.has(code);}
 _load(){try{const raw=this._storage?.getItem(this.storageKey);if(raw){const saved=JSON.parse(raw);this._applyConfig(saved.config||saved);this._profiles=Object.assign(Object.create(null),saved.profiles&&typeof saved.profiles==='object'?saved.profiles:{});}}catch(_){this._saveError='Could not read saved controls.';}}
 _applyConfig(patch){
  if(!patch||typeof patch!=='object')return;
  const c=this.config;
  for(const k of ['mode','transmission'])if(patch[k]!==undefined)c[k]=patch[k];
  if(!['auto','keyboard','custom'].includes(c.mode))c.mode='auto';
  if(!['auto','sequential','hpattern'].includes(c.transmission))c.transmission='auto';
  for(const k of ['manualClutch','haptics'])if(patch[k]!==undefined)c[k]=!!patch[k];
  for(const [key,min,max] of [['steerDeadzone',0,.45],['steerCurve',.3,3],['pedalDeadzone',0,.4]])if(patch[key]!==undefined)c[key]=clamp(patch[key],min,max);
  if(patch.keys&&typeof patch.keys==='object')for(const action of Object.keys(patch.keys))if(ALL.has(action)&&Array.isArray(patch.keys[action]))c.keys[action]=patch.keys[action].filter(k=>typeof k==='string').slice(0,8);
  if(patch.bindings&&typeof patch.bindings==='object')for(const action of Object.keys(patch.bindings)){
   if(!ALL.has(action))continue;const list=Array.isArray(patch.bindings[action])?patch.bindings[action]:[patch.bindings[action]];
   c.bindings[action]=list.map(b=>this._sanitizeBinding(b,action)).filter(Boolean).slice(0,8);
  }
  if(patch.shifter&&typeof patch.shifter==='object'){
   c.shifter={...c.shifter,...clone(patch.shifter)};
   c.shifter.enabled=!!c.shifter.enabled;c.shifter.mode=c.shifter.mode==='axes'?'axes':'buttons';c.shifter.tolerance=clamp(c.shifter.tolerance??.22,.06,.6);
   if(!c.shifter.slots||typeof c.shifter.slots!=='object')c.shifter.slots={};
  }
  c.version=4;
 }
 _sanitizeBinding(b,action){
  if(!b||!['axis','button','key'].includes(b.type))return null;
  if(b.type==='key')return typeof b.code==='string'?{type:'key',code:b.code}:null;
  const ref=this._resolveRef(b.device||b.deviceKey);if(!ref)return null;
  const index=Number(b.index);if(!Number.isInteger(index)||index<0||index>127)return null;
  const out={type:b.type,device:ref,index,invert:!!b.invert,deadzone:clamp(b.deadzone??(action==='steer'?.04:.025),0,.45),curve:clamp(b.curve??1,.3,3)};
  if(SIGNED.has(action)&&b.type==='axis'){
   out.min=clamp(b.min??-1,-1,1);out.center=clamp(b.center??0,-1,1);out.max=clamp(b.max??1,-1,1);
   if(out.max-out.min<.1||out.center<=out.min||out.center>=out.max)return null;
  }else{out.rest=clamp(b.rest??0,-1,1);out.pressed=clamp(b.pressed??1,-1,1);out.threshold=clamp(b.threshold??.5,.08,.95);if(Math.abs(out.pressed-out.rest)<.05)return null;}
  return out;
 }
 _resolveRef(ref){
  if(typeof ref==='string'){const found=this._byKey.get(ref);return found?{...found.ref}:null;}
  if(!ref||typeof ref.id!=='string')return null;
  return {id:ref.id,axes:Math.max(0,Math.round(Number(ref.axes)||0)),buttons:Math.max(0,Math.round(Number(ref.buttons)||0)),ordinal:Math.max(0,Math.round(Number(ref.ordinal)||0))};
 }
 _poll(){
  if(this._destroyed)return;
  let pads=[];
  try{if(typeof this._nav?.getGamepads==='function'){pads=this._nav.getGamepads()||[];this._error=null;}else this._error='This browser does not provide gamepad input.';}
  catch(error){this._error=error?.name==='SecurityError'?'Gamepad input is blocked. Open the HTTPS game page.':'Could not read controller input.';}
  const live=new Map();for(let i=0;i<pads.length;i++){const gp=pads[i];if(gp&&gp.connected!==false)live.set(gp.index??i,gp);}
  for(const [index,d]of this._devices){const g=live.get(index);if(!g||fingerprint(g)!==d.fingerprint){
   if(this._time-(this._recentDriver.get(d.key)??-100)<30)this._pendingActions.push('deviceLost');
   if(this._presentation.deviceKey===d.key)this._setActive('keyboard');
   if(this._feedback.target?.key===d.key)this.stopFeedback();
   this._devices.delete(index);this._byKey.delete(d.key);this._recentDriver.delete(d.key);
  }}
  for(const [index,g]of live){
   let d=this._devices.get(index);
   if(!d){
    const fp=fingerprint(g);let ordinal=0;const occupied=new Set();for(const existing of this._devices.values())if(existing.fingerprint===fp)occupied.add(existing.ref.ordinal);while(occupied.has(ordinal))ordinal++;
    const ref={id:g.id,axes:g.axes.length,buttons:g.buttons.length,ordinal};
    d={key:deviceKey(ref),ref,fingerprint:fp,index,gp:g,armed:false,neutralTime:0,activityButtons:Array(g.buttons.length).fill(0),activityAxes:Array.from(g.axes),activitySignals:{}};this._devices.set(index,d);this._byKey.set(d.key,d);
   }
   d.gp=g;
  }
 }
 _deviceKind(d){
  const calibratedWheel=(this.config.bindings.steer||[]).some(b=>b.type==='axis'&&deviceKey(b.device)===d.key);
  return deviceKind({id:d.ref.id,mapping:d.gp.mapping},{calibratedWheel});
 }
 _setActive(kind,device=null){
  if(device)kind=this._deviceKind(device);
  const key=device?.key??null;if(this._presentation.kind===kind&&this._presentation.deviceKey===key)return;
  this.stopFeedback();
  this._presentation={kind,deviceKey:key,name:({keyboard:'KEYBOARD',touch:'TOUCH',xbox:'XBOX CONTROLLER',playstation:'PLAYSTATION',wheel:'WHEEL',gamepad:'CONTROLLER'})[kind]||'CONTROLLER',revision:this._presentation.revision+1};
 }
 _trackActivity(){
  if(this.config.mode==='keyboard')return;
  let candidate=null,best=0;
  for(const d of this._devices.values()){
   let score=0;
   for(let i=0;i<d.gp.buttons.length;i++){
    const v=buttonValue(d.gp.buttons[i]),before=d.activityButtons[i]??0;
    if(v>.55&&(before<.35||v-before>.25))score=Math.max(score,.8+v);
    d.activityButtons[i]=v;
   }
   const signals=[];
   if(d.gp.mapping==='standard')for(let i=0;i<4;i++)signals.push(['standard'+i,clamp(d.gp.axes[i]||0,-1,1)]);
   for(const [action,list] of Object.entries(this.config.bindings))for(const b of list||[]){
    if(b.type==='axis'&&deviceKey(b.device)===d.key)signals.push([action+':'+b.index,this._normalized(b,action,this._raw(b))]);
   }
   for(const [key,v] of signals){
    const before=d.activitySignals[key]??0;
    if(Math.abs(v)<.1)d.activitySignals[key]=0;
    else if(Math.abs(v)>.22&&Math.abs(v-before)>.15){score=Math.max(score,Math.abs(v-before));d.activitySignals[key]=v;}
   }
   // An unconfigured wheel may announce itself through deliberate movement,
   // but those raw axes are not used to drive until they have been calibrated.
   if(!signals.length&&d.gp.mapping!=='standard')for(let i=0;i<d.gp.axes.length;i++){
    const v=d.gp.axes[i],before=d.activityAxes[i]??v;
    if(Number.isFinite(v)&&Math.abs(v-before)>.30){score=Math.max(score,Math.abs(v-before)*.65);d.activityAxes[i]=v;}
   }
   if(score>best){candidate=d;best=score;}
  }
  if(candidate)this._setActive(this._deviceKind(candidate),candidate);
 }
 getPresentation(){
  const p=this._presentation,d=this._byKey.get(p.deviceKey),hasRole=role=>(this.config.bindings[role]||[]).some(b=>b.type!=='key'&&!!this._findDevice(b.device));
  return {...p,deviceName:d?.ref.id??p.name,needsCalibration:p.kind==='wheel'&&(!hasRole('steer')||!hasRole('throttle'))};
 }
 prompt(action){
  const p=this.getPresentation(),device=this._byKey.get(p.deviceKey),list=this.config.bindings[action]||[];
  if(p.kind==='keyboard')return keyboardPrompt(action,this.config.keys);
  if(p.kind==='touch')return {label:({steer:'STEER',throttle:'THROTTLE',brake:'BRAKE',handbrake:'HB',boost:'NOS',camera:'CAMERA',confirm:'TAP',back:'BACK'})[action]||keyboardPrompt(action,this.config.keys).label,ariaLabel:'Touch '+action,kind:'touch',bound:true,buttonIndex:null};
  const binding=list.find(b=>b.type!=='key'&&deviceKey(b.device)===p.deviceKey)||
   (p.kind==='wheel'?list.find(b=>b.type!=='key'&&this._findDevice(b.device)):null);
  if(binding){
   if(binding.type==='button')return buttonPrompt(binding.index,this._deviceKind(this._findDevice(binding.device)));
   return {label:({steer:'WHEEL',throttle:'THROTTLE',brake:'BRAKE',clutch:'CLUTCH',handbrake:'LEVER'})[action]||'A'+binding.index,ariaLabel:({steer:'Steering wheel',throttle:'Throttle pedal',brake:'Brake pedal',clutch:'Clutch pedal',handbrake:'Handbrake lever'})[action]||'Axis '+binding.index,kind:p.kind,bound:true,buttonIndex:null,axisIndex:binding.index};
  }
  if(device?.gp.mapping==='standard'&&this._standardAllowed(device,action)){const prompt=standardPrompt(action,p.kind);if(prompt)return prompt;}
  return {...keyboardPrompt(action,this.config.keys),fallback:true};
 }
 _findDevice(ref){if(!ref)return null;return this._byKey.get(deviceKey(ref))||null;}
 _raw(binding){const d=this._findDevice(binding.device);if(!d)return null;return binding.type==='axis'?(Number.isFinite(d.gp.axes[binding.index])?d.gp.axes[binding.index]:null):(binding.index<d.gp.buttons.length?buttonValue(d.gp.buttons[binding.index]):null);}
 _normalized(binding,action,raw){
  if(raw===null)return 0;
  if(SIGNED.has(action)&&binding.type==='axis'){
   const c=binding.center??0;let v=raw<c?(raw-c)/Math.max(.01,c-binding.min):(raw-c)/Math.max(.01,binding.max-c);v=clamp(v,-1,1);
   if(binding.invert)v=-v;const dz=binding.deadzone??.04;if(Math.abs(v)<=dz)return 0;
   return Math.sign(v)*Math.pow(clamp((Math.abs(v)-dz)/(1-dz),0,1),binding.curve??1);
  }
  let v=clamp((raw-(binding.rest??0))/((binding.pressed??1)-(binding.rest??0)),0,1);
  if(binding.invert)v=1-v;
  const dz=binding.deadzone??.025;return v<=dz?0:Math.pow(clamp((v-dz)/(1-dz),0,1),binding.curve??1);
 }
 _value(binding,action,mark=true){
  if(binding.type==='key')return this.keys.has(binding.code)?1:0;
  const d=this._findDevice(binding.device);if(!d||!d.armed||this.config.mode==='keyboard')return 0;
  const v=this._normalized(binding,action,this._raw(binding));
  if(mark&&Math.abs(v)>.08&&(DRIVE.includes(action)||GEARS.includes(action)))this._recentDriver.set(d.key,this._time);
  return v;
 }
 _isNeutral(d){
  if(d.gp.mapping==='standard'){
   if(Math.abs(d.gp.axes[0]||0)>.24)return false;
   for(let i=0;i<d.gp.buttons.length;i++)if(buttonValue(d.gp.buttons[i])>.18)return false;
  }
  for(const action of [...DRIVE,...GEARS])for(const b of this.config.bindings[action]||[]){
   if(b.type==='key'||deviceKey(b.device)!==d.key)continue;
   if(Math.abs(this._normalized(b,action,this._raw(b)))>(action==='steer'?.25:.12))return false;
  }
  return true;
 }
 _keysFor(action){for(const key of this.config.keys[action]||[])if(this.keys.has(key))return 1;return 0;}
 _custom(action){let value=0;for(const b of this.config.bindings[action]||[]){const v=this._value(b,action);if(SIGNED.has(action)){if(Math.abs(v)>Math.abs(value))value=v;}else value=Math.max(value,v);}return value;}
 _hasCustom(action){return (this.config.bindings[action]||[]).some(b=>b.type!=='key');}
 _standardAllowed(d,action){
  if((this.config.bindings[action]||[]).some(b=>b.type!=='key'&&deviceKey(b.device)===d.key))return false;
  const slot=standardButton[action],axis=standardAxis[action],inMenu=this._context==='menu'&&MENU_ACTIONS.has(action);if(slot===undefined&&axis===undefined)return true;
  for(const [other,list] of Object.entries(this.config.bindings)){
   if(other===action)continue;
   const menuAction=MENU_ACTIONS.has(other);
   if(inMenu?!menuAction:MENU.has(other)||other==='confirm'||other==='back')continue;
   if((list||[]).some(b=>((b.type==='button'&&b.index===slot)||(b.type==='axis'&&b.index===axis))&&deviceKey(b.device)===d.key))return false;
  }
  return true;
 }
 _std(action,preview=false,exclude=null){
  if(this.config.mode==='keyboard')return 0;
  let value=0;
  for(const d of this._devices.values()){
   if((!preview&&!d.armed)||d.gp.mapping!=='standard')continue;
   if(!this._standardAllowed(d,action))continue;
   let v=0;
   if(SIGNED.has(action)){
    const axis=action==='lookX'?2:action==='lookY'?3:0,raw=clamp(d.gp.axes[axis]||0,-1,1),dz=action==='steer'?this.config.steerDeadzone:.14;
    v=Math.abs(raw)<=dz?0:Math.sign(raw)*Math.pow((Math.abs(raw)-dz)/(1-dz),action==='steer'?this.config.steerCurve:1.15);
   }else if(hasOwn(standardButton,action)){
    if(exclude&&exclude.type==='button'&&exclude.index===standardButton[action]&&deviceKey(exclude.device)===d.key)continue;
    v=buttonValue(d.gp.buttons[standardButton[action]]);
    if(action==='throttle'||action==='brake'){const dz=this.config.pedalDeadzone;v=v<=dz?0:(v-dz)/(1-dz);}
   }else if(MENU.has(action)){
    const vertical=action==='menuPrev'||action==='menuNext',sign=action==='menuPrev'||action==='menuLeft'?-1:1;
    const axis=d.gp.axes[vertical?1:0]||0;
    const button=action==='menuPrev'?12:action==='menuNext'?13:action==='menuLeft'?14:15;
    v=axis*sign>.52||buttonValue(d.gp.buttons[button])>.5?1:0;
   }
   if(Math.abs(v)>Math.abs(value))value=v;
   if(!preview&&Math.abs(v)>.08&&DRIVE.includes(action))this._recentDriver.set(d.key,this._time);
  }
  return value;
 }
 _combined(action){
  const custom=this._custom(action),standard=this._std(action),key=this._keysFor(action),touch=clamp(this.touch[action]||0,-1,1);
  if(SIGNED.has(action)){let v=custom;for(const n of [standard,touch])if(Math.abs(n)>Math.abs(v))v=n;return v;}
  return Math.max(custom,standard,key,touch);
 }
 _driving(action){
  const value=this._combined(action);if(!this._blockedDrive.has(action))return value;
  let hardware=this._std(action);for(const b of this.config.bindings[action]||[])if(b.type!=='key')hardware=Math.max(hardware,this._value(b,action,false));
  if(hardware<=.12){this._blockedDrive.delete(action);return value;}
  let deliberate=Math.max(this._keysFor(action),clamp(this.touch[action]||0,0,1));
  for(const b of this.config.bindings[action]||[])if(b.type==='key'&&this.keys.has(b.code))deliberate=1;
  return deliberate;
 }
 sample(dt=1/60){
  this._time+=clamp(dt,0,.1);this._poll();this._trackActivity();
  for(const d of this._devices.values())if(!d.armed){d.neutralTime=this._isNeutral(d)?d.neutralTime+clamp(dt,0,.1):0;if(d.neutralTime>=.08)d.armed=true;}
  this._updateLearn();
  const controls=this._zero(),actions=this._pendingActions.splice(0);
  const suppress=!!this._learn||this._doc?.hidden;
  const keyEdges=this._keyActions.splice(0).filter(edge=>!suppress&&edge.context===this._context&&this._keyboardActionAllowed(edge.action,edge.code));
  const keyActions=keyEdges.map(edge=>edge.action),keySet=new Set(keyActions);this.actionKeys=new Set(keyEdges.map(edge=>edge.code));
  if(!suppress){
   for(const action of ACTIONS){
    let pressed=this._combined(action)>.5;
    if(this._calibration){
     if(action==='confirm'||action==='back'){
      const excluded=this._calibration.binding;let value=Math.max(this._keysFor(action),this._std(action,false,excluded),this.touch[action]||0);
      for(const b of this.config.bindings[action]||[])if(b.type==='key'||b.type!==excluded.type||b.index!==excluded.index||deviceKey(b.device)!==deviceKey(excluded.device))value=Math.max(value,this._value(b,action,false));
      pressed=value>.5;
     }else pressed=false;
    }
    if(this._blockedActions.has(action)){
     let hardware=this._std(action);for(const b of this.config.bindings[action]||[])if(b.type!=='key')hardware=Math.max(hardware,this._value(b,action,false));
     if(hardware>.5)pressed=this._keysFor(action)>.5||(this.touch[action]||0)>.5||(this.config.bindings[action]||[]).some(b=>b.type==='key'&&this.keys.has(b.code));
     else this._blockedActions.delete(action);
    }
    if(this._context==='game'&&(MENU.has(action)||action==='confirm'||action==='back'))pressed=false;
    if(this._context==='menu'&&['home','transmission','neutral','camera','reset','mute','lights','interact'].includes(action))pressed=false;
    if(this._context==='menu'&&action==='pause'&&this.keys.has('Escape'))pressed=false;
    if(MENU.has(action)){
     if(pressed){let held=this._repeat[action]??0;held+=clamp(dt,0,.1);if(keySet.has(action)){this._repeat[action]=0;}else if(!this._previous[action]){actions.push(action);this._repeat[action]=0;}else if(held>=.4){actions.push(action);this._repeat[action]=.25;}else this._repeat[action]=held;}
     else this._repeat[action]=0;
    }else if(pressed&&!this._previous[action])actions.push(action);
    this._previous[action]=pressed;
   }
   if(this._enabled&&this._context==='game'&&!this._calibration){
    const left=this._combined('steerLeft'),right=this._combined('steerRight');
    controls.steer=left||right?clamp(right-left,-1,1):clamp(this._combined('steer'),-1,1);
    for(const action of ['throttle','brake','clutch','handbrake'])controls[action]=clamp(this._driving(action),0,1);
    controls.boost=this._driving('boost')>.5;controls.starter=this._driving('starter')>.5;
    controls.horn=this._driving('horn')>.5;controls.lookBack=this._driving('lookBack')>.5;
    controls.lookX=clamp(this._combined('lookX')+this._combined('lookRight')-this._combined('lookLeft'),-1,1);controls.lookY=clamp(this._combined('lookY')+this._combined('lookDown')-this._combined('lookUp'),-1,1);
    if(this.config.shifter.enabled)controls.gearRequest=this._readGear();
   }
  }else for(const action of ACTIONS)this._previous[action]=true;
  // Merge the polled hardware edge with keyboard events, but keep two distinct
  // taps made between frames as two actions in their original order.
  const combined=[...keyActions,...new Set(actions.filter(action=>!keySet.has(action)))];
  const unique=combined.filter(action=>action!=='pause'||!combined.includes('home'));this._last={controls,actions:unique};return this._last;
 }
 _readGear(preview=false){
  const s=this.config.shifter;
  if(s.mode==='axes'){
   const d=this._findDevice(s.device);if(!d||(!preview&&!d.armed))return 0;
   const x=d.gp.axes[s.xAxis],y=d.gp.axes[s.yAxis];if(!Number.isFinite(x)||!Number.isFinite(y))return 0;
   let best=Infinity,gear=0;for(const [key,point]of Object.entries(s.slots||{})){
    const number=Number(key);if(![-1,1,2,3,4,5,6].includes(number)||!Number.isFinite(point.x)||!Number.isFinite(point.y))continue;
    const dist=Math.hypot(x-point.x,y-point.y);if(dist<best){best=dist;gear=number;}
   }
   if(best>(s.tolerance??.22))gear=0;
   if(gear&&!preview)this._recentDriver.set(d.key,this._time);
   this._axisGear=gear;return gear;
  }
  let gear=0,count=0;
  for(let i=0;i<GEARS.length;i++)if((preview?this._previewAction(GEARS[i]):this._combined(GEARS[i]))>.5){gear=i===6?-1:i+1;count++;}
  return count===1?gear:0;
 }
 setContext(context){const next=context==='menu'?'menu':'game';if(next!==this._context){this._context=next;this._keyActions=[];this.actionKeys.clear();if(next==='menu')this.stopFeedback();else this._blockedDrive=new Set(['boost','handbrake','starter','horn','lookBack']);this._previous={};this._repeat={};this._blockedActions=new Set(ACTIONS);}return this;}
 setEnabled(enabled){const next=!!enabled;if(next!==this._enabled){this._enabled=next;if(!next){this.keys.clear();this._keyActions=[];this.actionKeys.clear();this.touch={};this.stopFeedback();}}return this;}
 setTouch(control,value){if(control==='left')control='steerLeft';if(control==='right')control='steerRight';if(ALL.has(control)){this.touch[control]=clamp(value,-1,1);if(Math.abs(value)>.1)this._setActive('touch');}return this;}
 clear(){this.stopFeedback();this.keys.clear();this.touch={};this._previous={};this._repeat={};this._blockedActions=new Set(ACTIONS);this._blockedDrive=new Set(['boost','handbrake','starter','horn','lookBack']);this._pendingActions=[];this._keyActions=[];this.actionKeys.clear();this._last={controls:this._zero(),actions:[]};return this;}
 getConfig(){return clone(this.config);}
 setConfig(patch){this._applyConfig(patch);if(!this.config.haptics)this.stopFeedback();if(this.config.mode==='keyboard')this._setActive('keyboard');this.saveConfig();return this.getConfig();}
 saveConfig(){try{this._storage?.setItem(this.storageKey,JSON.stringify({config:this.config,profiles:this._profiles}));this._saveError=null;return !!this._storage;}catch(_){this._saveError='Controls could not be saved in this browser.';return false;}}
 setKeys(action,codes){
  if(!ALL.has(action))throw new Error('Unknown action.');
  const keys=(Array.isArray(codes)?codes:[codes]).filter(k=>typeof k==='string').slice(0,8);
  const menuActions=new Set(['confirm','back','menuPrev','menuNext','menuLeft','menuRight']);
  if(!menuActions.has(action))for(const [other,bound]of Object.entries(this.config.keys))if(other!==action&&!menuActions.has(other))this.config.keys[other]=bound.filter(key=>!keys.includes(key));
  this.config.keys[action]=keys;this.saveConfig();return this;
 }
 resetKeys(){this.config.keys=clone(DEFAULT_KEYS);this.saveConfig();return this;}
 getKeyBindings(){return clone(this.config.keys);}
 bind(action,binding,{append=false}={}){
  if(!ALL.has(action))throw new Error('Unknown action.');this._poll();
  const clean=this._sanitizeBinding(binding,action);if(!clean)throw new Error('Invalid binding or calibration.');
  this.config.bindings[action]=append?[...(this.config.bindings[action]||[]),clean].slice(-8):[clean];
  if(GEARS.includes(action))this.config.shifter.enabled=true;
  this.saveConfig();return clone(clean);
 }
 clearBinding(action){if(ALL.has(action)){this.config.bindings[action]=[];this.saveConfig();}return this;}
 listDevices(){this._poll();return [...this._devices.values()].map(d=>({key:d.key,id:d.ref.id,name:d.ref.id,index:d.index,axes:d.ref.axes,buttons:d.ref.buttons,mapping:d.gp.mapping||'',kind:this._deviceKind(d),ref:{...d.ref},armed:d.armed,haptics:!!(d.gp.vibrationActuator?.playEffect||d.gp.hapticActuators?.some?.(a=>a?.pulse))}));}
 _previewAction(action){
  let v=0;
  for(const b of this.config.bindings[action]||[]){const value=b.type==='key'?(this.keys.has(b.code)?1:0):this.config.mode==='keyboard'?0:this._normalized(b,action,this._raw(b));if(SIGNED.has(action)){if(Math.abs(value)>Math.abs(v))v=value;}else v=Math.max(v,value);}
  const std=this._std(action,true),touch=clamp(this.touch[action]||0,-1,1);
  if(SIGNED.has(action)){for(const n of [std,touch])if(Math.abs(n)>Math.abs(v))v=n;return v;}
  return Math.max(v,std,touch,this._keysFor(action));
 }
 _previewControls(){
  const c=this._zero(),left=this._previewAction('steerLeft'),right=this._previewAction('steerRight');
  c.steer=left||right?clamp(right-left,-1,1):clamp(this._previewAction('steer'),-1,1);
  for(const a of ['throttle','brake','clutch','handbrake'])c[a]=clamp(this._previewAction(a),0,1);c.boost=this._previewAction('boost')>.5;c.starter=this._previewAction('starter')>.5;
  if(this.config.shifter.enabled)c.gearRequest=this._readGear(true);return c;
 }
 snapshot(){
  const devices=this.listDevices().map(info=>{const d=this._byKey.get(info.key),axes=Array.from(d.gp.axes),buttons=Array.from(d.gp.buttons,buttonValue);return {...info,axisCount:info.axes,buttonCount:info.buttons,axes,buttons,axisValues:axes,buttonValues:buttons};});
  return {supported:typeof this._nav?.getGamepads==='function',secureContext:globalThis.isSecureContext!==false,error:this._error,saveError:this._saveError,context:this._context,enabled:this._enabled,presentation:this.getPresentation(),feedback:this._feedback.diagnostics(),devices,controls:{...this._last.controls},previewControls:this._previewControls(),actions:[...this._last.actions],learn:this._learn?{active:true,action:this._learn.action,status:'listening',remaining:Math.max(0,this._learn.deadline-this._time)}:this._lastLearn||{active:false,status:'idle'},calibration:this._calibration?clone(this._calibration):null,duplicateDevices:devices.some((a,i)=>devices.some((b,j)=>i!==j&&a.id===b.id&&a.axisCount===b.axisCount&&a.buttonCount===b.buttonCount))};
 }
 learn(action,{deviceKey:key,kind='any',allowKeyboard=false,timeout=15000}={}){
  if(!ALL.has(action))throw new Error('Unknown action.');this._poll();this.cancelCalibration();
  const baseline={};for(const d of this._devices.values())if(!key||d.key===key)baseline[d.key]={axes:Array.from(d.gp.axes),buttons:Array.from(d.gp.buttons,buttonValue)};
  this._learn={action,deviceKey:key||null,kind:['axis','button','any','key'].includes(kind)?kind:'any',allowKeyboard:!!allowKeyboard,baseline,deadline:this._time+clamp(timeout,1000,120000)/1000};
  this._learnResult=null;this._lastLearn=null;this.keys.clear();this._keyActions=[];this.actionKeys.clear();this.touch={};return {active:true,action,status:'listening'};
 }
 _updateLearn(){
  const l=this._learn;if(!l)return;
  if(this._time>=l.deadline){this._lastLearn={active:false,action:l.action,status:'timeout',error:'No new input detected. Activate the device and try again.'};this._learnResult=clone(this._lastLearn);this._learn=null;return;}
  if(l.kind==='key')return;
  let candidate=null,best=0;
  for(const d of this._devices.values()){
   if(l.deviceKey&&l.deviceKey!==d.key)continue;
   let base=l.baseline[d.key];if(!base){l.baseline[d.key]={axes:Array.from(d.gp.axes),buttons:Array.from(d.gp.buttons,buttonValue)};continue;}
   if(l.kind!=='axis')for(let i=0;i<d.gp.buttons.length;i++){
    const value=buttonValue(d.gp.buttons[i]),before=base.buttons[i]??0;
    if(before<.22&&value>.62&&value-before>best){best=value-before;candidate={d,type:'button',index:i,rest:before,pressed:1};}
    if(value<.12)base.buttons[i]=value;
   }
   if(l.kind!=='button')for(let i=0;i<d.gp.axes.length;i++){
    const value=d.gp.axes[i],before=base.axes[i]??0,delta=Math.abs(value-before);
    if(delta>.36&&delta>best){best=delta;candidate={d,type:'axis',index:i,rest:before,pressed:value>before?1:-1};}
   }
  }
  if(candidate){
   const c=candidate,b={type:c.type,device:c.d.ref,index:c.index,rest:c.rest,pressed:c.pressed,deadzone:l.action==='steer'?.04:.025,curve:1};
   if(SIGNED.has(l.action)&&c.type==='axis'){b.min=-1;b.max=1;b.center=clamp(c.rest,-.85,.85);}
   try{const binding=this.bind(l.action,b);this._completeLearn({action:l.action,binding,label:`${c.d.ref.id}: ${c.type==='axis'?'Axis':'Button'} ${c.index}`});}
   catch(error){this._lastLearn={active:false,action:l.action,status:'error',error:error.message};this._learnResult=clone(this._lastLearn);this._learn=null;}
  }
 }
 _completeLearn(result){this._learnResult=clone(result);this._lastLearn={active:false,status:'complete',...clone(result)};this._learn=null;this.keys.clear();this._keyActions=[];this.actionKeys.clear();this.touch={};this._previous={};this._blockedActions=new Set(ACTIONS);}
 consumeLearnResult(){const result=this._learnResult;this._learnResult=null;return result;}
 cancelLearn(){if(this._learn){this._lastLearn={active:false,action:this._learn.action,status:'cancelled'};this._keyActions=[];this.actionKeys.clear();}this._learn=null;return this;}
 beginCalibration(role){
  if(!['steer','throttle','brake','clutch','handbrake'].includes(role))throw new Error('This control cannot be calibrated.');
  const binding=(this.config.bindings[role]||[]).find(b=>b.type==='axis'||b.type==='button');
  if(!binding)throw new Error('Assign an axis or button first.');
  this._poll();if(this._raw(binding)===null)throw new Error('The assigned device is disconnected.');
  this.cancelLearn();this._calibration={role,binding:clone(binding),samples:{},status:'capturing'};this.keys.clear();this._keyActions=[];this.actionKeys.clear();this.touch={};return clone(this._calibration);
 }
 captureCalibration(stage){
  const c=this._calibration;if(!c)throw new Error('No calibration is active.');
  const allowed=c.role==='steer'?['left','center','right']:['rest','pressed'];if(!allowed.includes(stage))throw new Error('Invalid calibration step.');
  this._poll();const raw=this._raw(c.binding);if(raw===null)throw new Error('Device disconnected. Calibration cancelled.');
  c.samples[stage]=raw;return {stage,value:raw,samples:{...c.samples}};
 }
 finishCalibration(){
  const c=this._calibration;if(!c)throw new Error('No calibration is active.');
  const b=clone(c.binding),s=c.samples;
  if(c.role==='steer'){
   if(!['left','center','right'].every(k=>Number.isFinite(s[k])))throw new Error('Capture the left limit, center and right limit.');
   if(Math.abs(s.right-s.left)<.3||Math.min(s.left,s.right)>=s.center-.04||Math.max(s.left,s.right)<=s.center+.04)throw new Error('Steering range is too small or the center lies outside the endpoints.');
   b.min=Math.min(s.left,s.right);b.max=Math.max(s.left,s.right);b.center=s.center;b.invert=s.left>s.right;
  }else{
   if(!Number.isFinite(s.rest)||!Number.isFinite(s.pressed)||Math.abs(s.pressed-s.rest)<.15)throw new Error('Release the pedal, then press it fully.');
   b.rest=s.rest;b.pressed=s.pressed;b.invert=false;
  }
  const binding=this.bind(c.role,b);this._calibration=null;this.clear();return {role:c.role,binding};
 }
 cancelCalibration(){if(this._calibration){this._keyActions=[];this.actionKeys.clear();}this._calibration=null;return this;}
 configureAxisShifter({deviceKey:key,device,xAxis,yAxis,tolerance=.22}){
  this._poll();const ref=this._resolveRef(device||key);if(!ref)throw new Error('Select a shifter.');
  if(!Number.isInteger(xAxis)||!Number.isInteger(yAxis)||xAxis<0||yAxis<0||xAxis===yAxis||xAxis>=ref.axes||yAxis>=ref.axes)throw new Error('Select two different available shifter axes.');
  this.config.shifter={enabled:true,mode:'axes',device:ref,xAxis,yAxis,tolerance:clamp(tolerance,.06,.6),slots:{}};this.saveConfig();return clone(this.config.shifter);
 }
 captureShifterGear(gear){
  gear=Number(gear);if(![-1,1,2,3,4,5,6].includes(gear))throw new Error('Select gear 1 to 6 or R.');
  this._poll();const s=this.config.shifter,d=this._findDevice(s.device);if(s.mode!=='axes'||!d)throw new Error('Configure the shifter axes first.');
  const point={x:d.gp.axes[s.xAxis],y:d.gp.axes[s.yAxis]};
  if(!Number.isFinite(point.x)||!Number.isFinite(point.y))throw new Error('Invalid axis signal.');
  for(const [other,p]of Object.entries(s.slots))if(Number(other)!==gear&&Math.hypot(p.x-point.x,p.y-point.y)<s.tolerance*2)throw new Error('Gear positions overlap. Reduce the tolerance or recalibrate.');
  s.slots[String(gear)]=point;this.saveConfig();return {gear,...point};
 }
 saveProfile(name){name=String(name||'').trim().slice(0,60);if(!name)throw new Error('Enter a profile name.');this._profiles[name]=this.getConfig();this.saveConfig();return name;}
 listProfiles(){return Object.keys(this._profiles).sort();}
 loadProfile(name){if(!hasOwn(this._profiles,name))throw new Error('Profile not found.');this.config=clone(DEFAULT_CONFIG);this._applyConfig(this._profiles[name]);this.clear();this.saveConfig();return this.getConfig();}
 deleteProfile(name){delete this._profiles[name];this.saveConfig();return this.listProfiles();}
 _feedbackDevice(){
  if(this._presentation.kind==='keyboard'||this._presentation.kind==='touch')return null;
  const active=this._byKey.get(this._presentation.deviceKey),supports=d=>d?.armed&&this._feedback._actuator(d);
  if(supports(active))return active;
  return [...this._devices.values()].filter(d=>supports(d)&&this._time-(this._recentDriver.get(d.key)??-100)<30).sort((a,b)=>(this._recentDriver.get(b.key)??0)-(this._recentDriver.get(a.key)??0))[0]||null;
 }
 updateFeedback(state,dt,{active=true}={}){
  const visible=!this._doc?.hidden&&this._doc?.hasFocus?.()!==false,driving=!!active&&this._enabled&&this._context==='game'&&visible,uiCue=this._context==='menu'&&this._time<this._uiFeedbackUntil&&visible;
  return this._feedback.update(driving?state:{},dt,{active:driving||uiCue,enabled:this.config.haptics,target:this._feedbackDevice()});
 }
 stopFeedback(){this._uiFeedbackUntil=0;this._feedback?.stop();return this;}
 rumble(strength=.3,duration=90){if(!this.config.haptics||!this._enabled||this._context!=='game'||this._doc?.hidden)return false;this._feedback.pulse(strength,duration);return true;}
 feedbackEvent(type,intensity=1){
  if(!this.config.haptics||this._doc?.hidden||this._doc?.hasFocus?.()===false)return false;
  const driving=this._enabled&&this._context==='game',uiCue=this._context==='menu'&&['purchase','waypoint','objective'].includes(type);if(!driving&&!uiCue)return false;
  const accepted=this._feedback.event(type,intensity);if(accepted&&uiCue)this._uiFeedbackUntil=this._time+.5;return accepted;
 }
 async vibrate(strength=.3,duration=90){return this.rumble(strength,duration);}
 destroy(){
  this.clear();this._destroyed=true;
  this._target?.removeEventListener?.('keydown',this._onKeyDown);this._target?.removeEventListener?.('keyup',this._onKeyUp);this._target?.removeEventListener?.('pointerdown',this._onPointerDown);this._target?.removeEventListener?.('blur',this._onBlur);this._target?.removeEventListener?.('gamepaddisconnected',this._onDisconnected);this._doc?.removeEventListener?.('visibilitychange',this._onVisibility);
 }
}
