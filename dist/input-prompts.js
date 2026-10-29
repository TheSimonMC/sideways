/** Labels reflect the browser's declared mapping or the player's own bindings. */
export const STANDARD_BUTTONS={throttle:7,brake:6,clutch:10,starter:12,neutral:13,handbrake:1,boost:0,shiftDown:4,shiftUp:5,pause:9,camera:3,map:8,lookBack:11,interact:2,lights:15,horn:14,confirm:0,back:1};
const hasOwn=(object,key)=>Object.prototype.hasOwnProperty.call(object,key);
const WHEEL=/\b(g25|g27|g29|g920|g923|t150|t300|t500|t248|t818|ts-pc|t-gt)\b|racing|wheel|lenkrad|fanatec|thrustmaster|driving force|cammus|simagic|moza|shifter|pedals?/i;
export function deviceKind(device,{calibratedWheel=false}={}){
 const id=String(device?.id??device?.ref?.id??'');
 if(WHEEL.test(id)||calibratedWheel&&device?.mapping!=='standard')return 'wheel';
 if(/054c|sony|dualshock|dualsense|playstation|\bps[345]\b/i.test(id))return 'playstation';
 if(/045e|xbox|xinput|microsoft/i.test(id))return 'xbox';
 return 'gamepad';
}
export function keyLabel(code){
 const names={Space:'SPACE',Enter:'ENTER',Escape:'ESC',ControlLeft:'CTRL',ControlRight:'CTRL',ShiftLeft:'SHIFT',ShiftRight:'SHIFT',ArrowUp:'↑',ArrowDown:'↓',ArrowLeft:'←',ArrowRight:'→',Tab:'TAB',Backspace:'⌫'};
 return names[code]||String(code||'?').replace(/^Key/,'').replace(/^Digit/,'').replace(/^Numpad/,'NUM ');
}
const PS=['✕','○','□','△','L1','R1','L2','R2','SHARE','OPTIONS','L3','R3','↑','↓','←','→','PS','PAD'];
const XB=['A','B','X','Y','LB','RB','LT','RT','VIEW','MENU','L3','R3','↑','↓','←','→','XBOX'];
const PS_NAMES=['Cross','Circle','Square','Triangle','L1','R1','L2','R2','Share','Options','press left stick','press right stick','D-pad up','D-pad down','D-pad left','D-pad right'];
const XB_NAMES=['A','B','X','Y','LB','RB','LT','RT','View','Menu','press left stick','press right stick','D-pad up','D-pad down','D-pad left','D-pad right'];
export function buttonPrompt(index,kind='gamepad'){
 if(kind==='wheel')return {label:'B'+index,ariaLabel:'Button '+index,kind,buttonIndex:index,bound:true};
 const ps=kind==='playstation',labels=ps?PS:XB,names=ps?PS_NAMES:XB_NAMES;
 return {label:labels[index]||'B'+index,ariaLabel:names[index]||'Button '+index,kind,buttonIndex:index,bound:true};
}
export function keyboardPrompt(action,keys={}){
 if(action==='steer'){
  const left=keys.steerLeft?.[0],right=keys.steerRight?.[0];
  return {label:keyLabel(left)+' / '+keyLabel(right),ariaLabel:'Steer with '+keyLabel(left)+' and '+keyLabel(right),kind:'keyboard',bound:!!left&&!!right,buttonIndex:null};
 }
 const code=keys[action]?.[0];return {label:keyLabel(code),ariaLabel:code==='Escape'?'Escape':keyLabel(code),kind:'keyboard',bound:!!code,buttonIndex:null};
}
export function standardPrompt(action,kind){
 if(hasOwn(STANDARD_BUTTONS,action))return buttonPrompt(STANDARD_BUTTONS[action],kind);
 if(action==='steer')return {label:kind==='wheel'?'WHEEL':'LS',ariaLabel:kind==='wheel'?'Steering wheel':'left stick',kind,bound:true,buttonIndex:null};
 if(action==='lookX'||action==='lookY')return {label:'RS',ariaLabel:'right stick',kind,bound:true,buttonIndex:null};
 const directions={menuPrev:12,menuNext:13,menuLeft:14,menuRight:15};
 if(hasOwn(directions,action))return buttonPrompt(directions[action],kind);
 return null;
}
