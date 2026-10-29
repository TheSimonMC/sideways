import {keyLabel} from './input-prompts.js';
const byId = id => document.getElementById(id);
const clamp = (n,a,b) => Math.max(a,Math.min(b,Number(n)||0));
const names = {steer:'Steering',steerLeft:'Steer left',steerRight:'Steer right',throttle:'Throttle',brake:'Brake',clutch:'Clutch',handbrake:'Handbrake',boost:'NOS',starter:'Starter',garage:'Garage',shiftDown:'Downshift',shiftUp:'Upshift',camera:'Camera',home:'Main menu',pause:'Pause',reset:'Reset car',transmission:'Transmission',settings:'Settings',confirm:'Confirm',back:'Back',menuPrev:'Menu up',menuNext:'Menu down',menuLeft:'Menu left',menuRight:'Menu right',mute:'Mute',neutral:'Neutral',lookBack:'Look back',lookX:'Look sideways',lookY:'Look up/down',lookLeft:'Look left',lookRight:'Look right',lookUp:'Look up',lookDown:'Look down',horn:'Horn',lights:'Headlights',interact:'Interact',map:'Map'};
const gearNames = {gear1:'1',gear2:'2',gear3:'3',gear4:'4',gear5:'5',gear6:'6',gearReverse:'R'};
const stageText = {
 center:['Center the wheel','Center the wheel, then choose CAPTURE POSITION.'],
 left:['Turn fully left','Hold the wheel at your left limit, then capture the position.'],
 right:['Turn fully right','Hold the wheel at your right limit, then capture the position.'],
 rest:['Release the pedal','Release the pedal or handbrake lever, then capture its rest position.'],
 pressed:['Press fully','Hold the pedal or lever at full travel, then capture the position.']
};

export class ControlsPanel {
 constructor(input,{onChanged=()=>{}}={}){
  this.input=input;this.onChanged=onChanged;this.active=false;this.clock=0;this.tab='devices';this.deviceSignature='';this.configSignature='';this.wizard=null;this.learning=null;this.presentationRevision=-1;
  this.bindingRows=new Map();this.keyRows=new Map();this.tabFocus=new Map();
  this.buildBindings();this.buildKeyboard();this.wire();this.refresh();
 }
 message(text,error=false){byId('control-message').textContent=text;byId('control-message').classList.toggle('error-message',error)}
 show(){this.active=true;this.deviceSignature='';this.refresh();this.refreshDevices();}
 hide(){this.active=false;this.cancel();}
 focusVisible(target){if(!target||target.disabled||target.offsetParent===null)return;const current=document.activeElement;if(current?.classList.contains('pad-focus')){current.classList.remove('pad-focus');target.classList.add('pad-focus');}target.focus({preventScroll:true});}
 selectTab(name){
  const tabs=['devices','calibrate','bindings','keyboard'];if(!tabs.includes(name))name='devices';
  const previous=byId('controls-'+this.tab),active=document.activeElement;if(previous?.contains(active))this.tabFocus.set(this.tab,active);
  if(name!==this.tab&&(this.learning||this.wizard)){this.cancel();this.message('Binding cancelled.');}
  this.tab=name;document.querySelectorAll('[data-controls-tab]').forEach(b=>{b.classList.toggle('active',b.dataset.controlsTab===name);b.setAttribute('aria-selected',String(b.dataset.controlsTab===name))});for(const n of tabs)byId('controls-'+n).classList.toggle('hidden',n!==name);
  if(document.activeElement?.closest('.control-page')?.classList.contains('hidden'))this.focusVisible(this.tabFocus.get(name)||document.querySelector('[data-controls-tab="'+name+'"]'));
 }
 wire(){
  const tabBar=document.querySelector('.control-tabs');if(tabBar){tabBar.dataset.navGroup='controls-tabs';tabBar.dataset.navAxis='horizontal';}
  for(const name of ['devices','calibrate','bindings','keyboard'])byId('controls-'+name)?.setAttribute('aria-label',name==='calibrate'?'Calibration':name[0].toUpperCase()+name.slice(1));
  byId('profile-name').setAttribute('aria-description','Confirm opens the controller keyboard. You can also type with a keyboard.');
  byId('reset-keybinds').addEventListener('click',()=>{this.cancel();this.input.resetKeys();this.changed();this.message('Keyboard defaults restored.');});
  document.querySelectorAll('[data-controls-tab]').forEach(b=>b.addEventListener('click',()=>this.selectTab(b.dataset.controlsTab)));
  byId('input-mode').addEventListener('change',e=>{this.input.setConfig({mode:e.target.value});this.changed();this.message(e.target.value==='keyboard'?'Keyboard only.':e.target.value==='custom'?'Your calibrated controls are active. Standard controllers remain available.':'Keyboard, controllers and calibrated wheels switch automatically.')});
  byId('hshifter-mode').addEventListener('change',e=>{const c=this.input.getConfig();this.input.setConfig({shifter:{...c.shifter,mode:e.target.value}});this.changed();this.message(e.target.value==='axes'?'Choose the shifter and its two axes, then capture each gear.':'Each gear uses a separate button signal.');});
  byId('shifter-tolerance').addEventListener('input',e=>{const c=this.input.getConfig();this.input.setConfig({shifter:{...c.shifter,tolerance:Number(e.target.value)/100}});this.onChanged()});
  byId('axis-shifter-device').addEventListener('change',()=>this.refreshShifterAxes());
  byId('configure-axis-shifter').addEventListener('click',()=>{try{this.input.configureAxisShifter({deviceKey:byId('axis-shifter-device').value,xAxis:Number(byId('shifter-x-axis').value),yAxis:Number(byId('shifter-y-axis').value),tolerance:Number(byId('shifter-tolerance').value)/100});this.input.setConfig({transmission:'hpattern'});this.changed();this.message('Shifter axes saved. Capture the gear positions below.');}catch(e){this.message(e.message,true)}});
  byId('haptics-toggle').addEventListener('change',e=>{this.input.setConfig({haptics:e.target.checked});this.changed()});
  byId('hshifter-toggle').addEventListener('change',e=>{const c=this.input.getConfig();this.input.setConfig({shifter:{...c.shifter,enabled:e.target.checked},...(e.target.checked?{transmission:'hpattern'}:c.transmission==='hpattern'?{transmission:'sequential'}:{})});this.changed();this.message(e.target.checked?'H-pattern enabled. Assign each gear below.':'H-pattern disabled.')});
  document.querySelectorAll('[data-calibrate]').forEach(b=>b.addEventListener('click',()=>this.startCalibration(b.dataset.calibrate)));
  byId('calibration-capture').addEventListener('click',()=>this.capture());
  byId('calibration-cancel').addEventListener('click',()=>{this.cancel();this.message('Calibration cancelled.')});
  byId('cancel-binding').addEventListener('click',()=>{this.cancel();this.message('Binding cancelled.')});
  byId('steer-deadzone').addEventListener('input',e=>this.adjustSteering('deadzone',Number(e.target.value)/100));
  byId('steer-curve').addEventListener('input',e=>this.adjustSteering('curve',Number(e.target.value)/100));
  byId('save-profile').addEventListener('click',()=>{const name=byId('profile-name').value.trim();if(!name){this.message('Enter a profile name first.',true);byId('profile-name').focus();return}this.input.saveProfile(name);this.refreshProfiles();this.message('Profile "'+name+'" saved.')});
  byId('load-profile').addEventListener('click',()=>{const name=byId('profile-list').value;if(!name)return;try{this.input.loadProfile(name);this.refresh();this.onChanged();this.message('Profile "'+name+'" loaded.')}catch(e){this.message(e.message||'Could not load the profile.',true)}});
 }
 changed(){this.input.saveConfig();this.refresh();this.onChanged()}
 buildBindings(){
  for(const action of ['handbrake','clutch','starter','boost','shiftDown','shiftUp','camera','lookBack','lookX','lookY','horn','lights','interact','map','pause','home','reset','transmission','neutral','garage','settings','confirm','back','menuPrev','menuNext','menuLeft','menuRight'])this.makeBindingRow(action,names[action],byId('binding-list'));
  for(const [action,label] of Object.entries(gearNames))this.makeBindingRow(action,label,byId('gear-bindings'));
 }
 buildKeyboard(){
  for(const action of ['throttle','brake','steerLeft','steerRight','handbrake','boost','clutch','starter','shiftDown','shiftUp','neutral','transmission','camera','lookBack','lookLeft','lookRight','lookUp','lookDown','horn','lights','interact','map','reset','pause','home','garage','settings','mute']){
   const row=document.createElement('div');row.className='binding-row keyboard-row';row.dataset.navGroup='keybinding-'+action;const title=document.createElement('strong');title.textContent=names[action];const value=document.createElement('span');value.className='binding-value';const button=document.createElement('button');button.className='small-button';button.dataset.navKey='keybind-'+action;button.textContent='BIND KEY';button.setAttribute('aria-label','Bind '+names[action]);button.addEventListener('click',()=>{this.cancel();this.learning={action,type:'keyboard'};this.input.learn(action,{kind:'key',allowKeyboard:true,timeout:20000});row.classList.add('learning');byId('cancel-keybinding').classList.remove('hidden');this.message('Press a key for '+names[action]+'. Escape cancels.');});
   const clear=document.createElement('button');clear.className='binding-clear';clear.textContent='✕';clear.setAttribute('aria-label','Clear '+names[action]);clear.addEventListener('click',()=>{this.cancel();this.input.setKeys(action,[]);this.changed();});row.append(title,value,button,clear);byId('keyboard-bindings').append(row);this.keyRows.set(action,{row,value,button});
  }
  byId('cancel-keybinding').addEventListener('click',()=>{this.cancel();this.message('Key binding cancelled.');});
 }
 makeBindingRow(action,label,parent){
  const row=document.createElement('div');row.className='binding-row';row.dataset.navGroup='binding-'+action;
  const title=document.createElement('strong');title.textContent=label;
  const value=document.createElement('span');value.className='binding-value';
  const button=document.createElement('button');button.className='small-button';button.dataset.navKey='bind-'+action;button.textContent='BIND';button.setAttribute('aria-label',label+' binding');button.addEventListener('click',()=>this.startBinding(action));
  const clear=document.createElement('button');clear.className='binding-clear';clear.textContent='✕';clear.setAttribute('aria-label',label+' clear binding');clear.addEventListener('click',()=>{const c=this.input.getConfig();if(action.startsWith('gear')&&c.shifter?.mode==='axes'){const slots={...c.shifter.slots};delete slots[action==='gearReverse'?-1:Number(action.slice(4))];this.input.setConfig({shifter:{...c.shifter,slots}});}else this.input.clearBinding(action);this.changed();this.message(label+' reset.')});
  row.append(title,value,button,clear);parent.append(row);this.bindingRows.set(action,{row,value,button});
 }
 bindingText(binding,action){
  const b=Array.isArray(binding)?binding[0]:binding;if(!b){const p=action?this.input.prompt?.(action):null;return p?.bound?(p.fallback?'Keyboard: ':p.kind==='keyboard'?'Key: ':'Default: ')+p.label:'Unbound';}
  if(b.type==='key'||b.type==='keyboard')return keyLabel(b.code||b.key);
  return (b.type==='axis'?'Axis ':'Button ')+b.index+(Array.isArray(binding)&&binding.length>1?' +'+(binding.length-1):'');
 }
 refresh(){
  const c=this.input.getConfig();byId('input-mode').value=c.mode;byId('haptics-toggle').checked=c.haptics!==false;byId('hshifter-toggle').checked=!!c.shifter?.enabled;
  byId('shifter-tolerance').value=Math.round((c.shifter?.tolerance??.22)*100);
  byId('hshifter-mode').value=c.shifter?.mode||'buttons';byId('axis-shifter-setup').classList.toggle('hidden',c.shifter?.mode!=='axes');
  for(const [action,{value,button}] of this.bindingRows){const gear=action==='gearReverse'?-1:Number(action.slice(4));const axisGear=action.startsWith('gear')&&c.shifter?.mode==='axes';value.textContent=axisGear?(c.shifter.slots?.[gear]?'Position saved':'Not captured'):this.bindingText(c.bindings?.[action],action);value.title=value.textContent;button.textContent=axisGear?'CAPTURE POSITION':'BIND';}
  let steer=c.bindings?.steer;if(Array.isArray(steer))steer=steer[0];
  byId('steer-deadzone').value=Math.round((steer?.deadzone??c.steerDeadzone??.1)*100);byId('steer-curve').value=Math.round((steer?.curve??c.steerCurve??1.25)*100);
  const summary=byId('calibration-summary');summary.replaceChildren();const title=document.createElement('strong');title.textContent='CURRENT BINDINGS';summary.append(title);
  for(const role of ['steer','throttle','brake','clutch','handbrake']){const span=document.createElement('span');span.textContent=names[role]+': '+this.bindingText(c.bindings?.[role],role);summary.append(span)}
  const keys=this.input.getKeyBindings();for(const [action,{value}]of this.keyRows)value.textContent=(keys[action]||[]).map(keyLabel).join(' / ')||'UNBOUND';
  this.refreshProfiles();
 }
 refreshProfiles(){
  const el=byId('profile-list'),selected=el.value;el.replaceChildren(new Option('Select saved profile',''));
  for(const entry of this.input.listProfiles()){const name=typeof entry==='string'?entry:entry.name;if(name)el.add(new Option(name,name))}el.value=selected;
 }
 refreshDevices(){
  const devices=this.input.listDevices(),signature=JSON.stringify(devices.map(d=>[d.key,d.id,d.axes,d.buttons,d.mapping,d.kind]));if(signature===this.deviceSignature)return;this.deviceSignature=signature;
  const list=byId('device-list');list.replaceChildren();
  if(!devices.length){const e=document.createElement('div');e.className='device-empty';e.textContent='No device detected. Connect it, click the game once, then press a device button. If it stays missing, check the driver and browser. Keyboard controls remain available.';list.append(e)}
  for(const d of devices){const card=document.createElement('div');card.className='device-card';const dot=document.createElement('i');dot.className='device-dot';const text=document.createElement('div');const title=document.createElement('strong');title.textContent=d.id;const info=document.createElement('small');info.textContent=d.axes+' axes · '+d.buttons+' buttons · '+(d.mapping==='standard'?'Standard mapping':'Custom calibration')+(d.haptics?' · Vibration available':'');text.append(title,info);card.append(dot,text);list.append(card)}
  for(const id of ['calibration-device','binding-device','axis-shifter-device']){const el=byId(id),selected=el.value;el.replaceChildren(new Option('All detected devices',''));for(const d of devices)el.add(new Option(d.id,d.key));if(devices.some(d=>d.key===selected))el.value=selected;}
  this.refreshShifterAxes();
 }
 refreshShifterAxes(){
  const chosen=this.input.listDevices().find(d=>d.key===byId('axis-shifter-device').value);const c=this.input.getConfig().shifter;
  for(const [id,defaultAxis] of [['shifter-x-axis',0],['shifter-y-axis',1]]){const el=byId(id);el.replaceChildren();for(let i=0;i<(chosen?.axes||0);i++)el.add(new Option((id==='shifter-x-axis'?'Horizontal: ':'Vertical: ')+'Axis '+i,String(i)));el.value=String(id==='shifter-x-axis'?(c.xAxis??defaultAxis):(c.yAxis??defaultAxis));}
 }
 startBinding(action){
  if(action.startsWith('gear')&&this.input.getConfig().shifter?.mode==='axes'){try{this.input.captureShifterGear(action==='gearReverse'?-1:Number(action.slice(4)));this.changed();this.message('Gear '+gearNames[action]+': position saved.');}catch(e){this.message(e.message,true)}return;}
  this.cancel();this.learning={action,type:'button'};const deviceKey=byId('binding-device').value;
  this.input.learn(action,{...(deviceKey?{deviceKey}:{}),kind:action==='lookX'||action==='lookY'?'axis':'button',allowKeyboard:false,timeout:20000});
  this.bindingRows.get(action)?.row.classList.add('learning');byId('cancel-binding').classList.remove('hidden');
  this.message(gearNames[action]?'Start in neutral, then engage gear '+gearNames[action]+' and hold it briefly.':action==='lookX'||action==='lookY'?'Move the axis for '+names[action]+'.':'Press a button for '+names[action]+'.');
 }
 startCalibration(role){
  this.cancel();this.learning={action:role,type:'calibration'};this.wizard={role,stage:-1,stages:role==='steer'?['center','left','right']:['rest','pressed']};
  document.querySelectorAll('[data-calibrate]').forEach(b=>b.classList.toggle('active',b.dataset.calibrate===role));byId('calibration-wizard').classList.remove('hidden');byId('calibration-capture').disabled=true;
  byId('calibration-step').textContent='DETECT INPUT';byId('calibration-title').textContent=names[role]+' binding';byId('calibration-instruction').textContent=role==='steer'?'Move the wheel clearly in one direction. Move only the axis you want to bind.':'Move only the pedal or handbrake lever you want to bind.';
  const deviceKey=byId('calibration-device').value;this.input.learn(role,{...(deviceKey?{deviceKey}:{}),kind:role==='steer'?'axis':'any',allowKeyboard:false,timeout:20000});this.message('Waiting for '+names[role]+'.');
 }
 beginCapture(){
  if(!this.wizard)return;try{const result=this.input.beginCalibration(this.wizard.role);if(result===false||result?.ok===false)throw Error(result?.error||'Assign a suitable axis first.');this.wizard.stage=0;this.showStage()}catch(e){this.message(e.message,true);this.cancel()}
 }
 showStage(){const w=this.wizard;if(!w)return;const name=w.stages[w.stage];byId('calibration-step').textContent='POSITION '+(w.stage+1)+' / '+w.stages.length;byId('calibration-title').textContent=stageText[name][0];byId('calibration-instruction').textContent=stageText[name][1];byId('calibration-capture').disabled=false;byId('calibration-capture').focus();}
 capture(){
  const w=this.wizard;if(!w||w.stage<0)return;
  try{const result=this.input.captureCalibration(w.stages[w.stage]);if(result===false||result?.ok===false)throw Error(result?.error||'No valid signal.');w.stage++;
   if(w.stage<w.stages.length){this.showStage();return}
   const finished=this.input.finishCalibration();if(finished===false||finished?.ok===false)throw Error(finished?.error||'The endpoints are too close. Calibrate again.');
   this.input.setConfig({mode:'custom'});const label=names[w.role];this.cancel();this.changed();this.message(label+' calibrated. Your profile now uses these endpoints.');
  }catch(e){this.message(e.message||'Calibration failed.',true);if(this.wizard){this.wizard.stage=0;this.showStage()}}
 }
 adjustSteering(key,value){
  const c=this.input.getConfig();let b=c.bindings?.steer;if(Array.isArray(b))b=b[0];if(!b){this.input.setConfig({[key==='deadzone'?'steerDeadzone':'steerCurve']:value});this.onChanged();return}this.input.bind('steer',{...b,[key]:value});this.input.saveConfig();this.onChanged();
 }
 cancel(){
  const origin=this.wizard?document.querySelector('[data-calibrate="'+this.wizard.role+'"]'):this.learning?(this.learning.type==='keyboard'?this.keyRows:this.bindingRows).get(this.learning.action)?.button:null;
  this.input.cancelLearn();this.input.cancelCalibration();this.learning=null;this.wizard=null;for(const {row} of [...this.bindingRows.values(),...this.keyRows.values()])row.classList.remove('learning');byId('cancel-keybinding').classList.add('hidden');document.querySelectorAll('[data-calibrate]').forEach(b=>b.classList.remove('active'));byId('calibration-wizard').classList.add('hidden');byId('cancel-binding').classList.add('hidden');
  if(this.active&&document.activeElement?.closest('#controls-modal')&&document.activeElement.offsetParent===null)this.focusVisible(origin);
 }
 update(dt){
  if(!this.active)return;this.clock+=dt;if(this.clock<.08)return;this.clock=0;this.refreshDevices();
  const presentation=this.input.getPresentation?.();if(presentation&&presentation.revision!==this.presentationRevision){this.presentationRevision=presentation.revision;this.refresh();if(presentation.needsCalibration&&!this.learning&&!this.wizard)this.message('Wheel detected. Set up steering and pedals under CALIBRATION once. Your profile will then load automatically.');}
  const snap=this.input.snapshot(),result=this.input.consumeLearnResult();
  if(snap.error&&!this.learning&&!this.wizard&&snap.error!==this.lastInputError){this.message(snap.error,true);this.lastInputError=snap.error;}
  if(snap.duplicateDevices&&!this.duplicateWarning){this.message('Identical devices detected. Keep their connections consistent and check the bindings if they change.');this.duplicateWarning=true;}
  if(result&&this.learning){
   if(result.error||result.status==='failed'||result.status==='timeout'){this.message(result.error||'No clear signal detected. Try again.',true);this.cancel()}
   else{const {action,type}=this.learning;
    if(type==='calibration'){this.learning=null;this.refresh();this.beginCapture()}
    else{if(action.startsWith('gear')){const c=this.input.getConfig();this.input.setConfig({shifter:{...c.shifter,enabled:true},transmission:'hpattern'})}this.cancel();this.changed();this.message((gearNames[action]?'Gear '+gearNames[action]:names[action])+' bound.');}
   }
  }
  const c=snap.previewControls||snap.controls||{};
  for(const name of ['steer','throttle','brake','clutch','handbrake']){const value=clamp(c[name],name==='steer'?-1:0,1);const fill=byId('live-'+name);if(name==='steer')fill.style.left=`calc(${50+value*48}% - 2px)`;else fill.style.transform=`scaleX(${value})`;byId('live-'+name+'-value').textContent=Math.round(value*100)+'%';}
  const raws=snap.devices||snap.rawDevices||[];
  byId('raw-inputs').textContent=raws.map(d=>{const a=Array.isArray(d.axes)?d.axes:[],b=Array.isArray(d.buttons)?d.buttons:[];return d.id+'\n'+a.map((v,i)=>'A'+i+': '+Number(v).toFixed(3)).join('  ')+'\n'+b.map((v,i)=>{const n=typeof v==='number'?v:v.value;return n>.02?'B'+i+': '+Number(n).toFixed(2):null}).filter(Boolean).join('  ')}).join('\n\n')||'No input yet.';
  if(this.wizard){let b=this.input.getConfig().bindings?.[this.wizard.role];if(Array.isArray(b))b=b[0];const d=raws.find(d=>b?.device?.id===d.id&&(d.ref?.ordinal??0)===(b.device.ordinal??0));const v=b?.type==='axis'?d?.axes?.[b.index]:d?.buttons?.[b?.index];const value=typeof v==='number'?v:v?.value;byId('calibration-raw').textContent=Number.isFinite(value)?value.toFixed(3):'SELECT INPUT';}
 }
}
