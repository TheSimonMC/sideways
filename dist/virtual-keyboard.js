import {focusableControls,isTextEntry,nextFocus} from './navigation.js';

/** Controller text entry edits a draft. Cancel never changes the original field. */
export class VirtualKeyboard{
 constructor(navigation,{doc=globalThis.document}={}){this.nav=navigation;this.doc=doc;this.active=false;this.upper=false;this.symbols=false;}
 build(){
  if(this.root)return;
  const doc=this.doc,root=doc.createElement('section');root.id='text-keyboard';root.className='text-keyboard hidden';root.setAttribute('aria-labelledby','text-keyboard-title');
  // Self-contained so this also works in the single-file build.
  const style=doc.createElement('style');style.textContent='.text-keyboard{position:fixed;inset:0;z-index:200;display:grid;place-content:center;padding:20px;background:rgba(10,12,17,.96);overflow:auto}.text-keyboard.hidden{display:none}.text-keyboard-panel{width:min(760px,94vw)}.text-keyboard h2{font-size:clamp(24px,4vw,42px);margin:0 0 16px}.text-keyboard input{box-sizing:border-box;width:100%;padding:14px;font:inherit;font-size:22px;background:#131720;color:#fff;border:2px solid #9aabbe}.text-keyboard-row{display:flex;gap:6px;margin-top:7px}.text-keyboard button{flex:1;min-width:0;min-height:46px;padding:8px 3px;font:inherit;font-weight:800;color:#f2f3e9;background:#2a303c;border:1px solid #637081;cursor:pointer}.text-keyboard button.pad-focus,.text-keyboard button:focus-visible{color:#10131a;background:#d8ff60;outline:3px solid white;outline-offset:2px}.text-keyboard-help{color:#b8c3d4;margin:16px 0 0;font-size:14px}.text-keyboard .keyboard-done{background:#d8ff60;color:#10131a}.text-keyboard-actions{flex-wrap:wrap}.text-keyboard-actions button{min-width:70px}@media(max-width:480px){.text-keyboard{padding:10px}.text-keyboard-row{gap:3px}.text-keyboard button{min-height:38px;font-size:12px}}';
  root.append(style);this.panel=doc.createElement('div');this.panel.className='text-keyboard-panel';root.append(this.panel);
  this.title=doc.createElement('h2');this.title.id='text-keyboard-title';this.panel.append(this.title);
  this.field=doc.createElement('input');this.field.id='keyboard-draft';this.field.autocomplete='off';this.field.spellcheck=false;this.field.setAttribute('aria-label','Text to enter');this.panel.append(this.field);
  this.keys=doc.createElement('div');this.panel.append(this.keys);this.actions=doc.createElement('div');this.actions.className='text-keyboard-row text-keyboard-actions';this.panel.append(this.actions);
  this.button('SHIFT',()=>{this.upper=!this.upper;this.renderKeys();},this.actions,'keyboard-shift');
  this.button('SYMBOLS',()=>{this.symbols=!this.symbols;this.renderKeys();},this.actions,'keyboard-symbols');
  this.button('SPACE',()=>this.insert(' '),this.actions,'keyboard-space');this.button('DELETE',()=>this.erase(),this.actions,'keyboard-delete');
  this.button('CLEAR',()=>{this.field.value='';this.caret(0);},this.actions,'keyboard-clear');
  const bottom=doc.createElement('div');bottom.className='text-keyboard-row';this.panel.append(bottom);
  this.button('‹ CURSOR',()=>this.caret(Math.max(0,this.selection()[0]-1)),bottom,'keyboard-left');
  this.button('CURSOR ›',()=>this.caret(Math.min(this.field.value.length,this.selection()[1]+1)),bottom,'keyboard-right');
  this.button('CANCEL',()=>this.close(false),bottom,'keyboard-cancel');this.button('DONE',()=>this.close(true),bottom,'keyboard-done').classList.add('keyboard-done');
  const help=doc.createElement('p');help.className='text-keyboard-help';help.textContent='Choose a key to type. DONE saves. Back cancels. A keyboard also works.';this.panel.append(help);
  this.field.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();e.stopPropagation();this.close(true);}});
  doc.body.append(root);this.root=root;
 }
 button(label,action,parent,id){const b=this.doc.createElement('button');b.type='button';b.id=id;b.textContent=label;b.addEventListener('click',action);parent.append(b);return b;}
 renderKeys(){
  const old=this.doc.activeElement?.id;this.keys.replaceChildren();
  const rows=this.symbols?['!@#$%^&*()','-_=+[]{}\\|',';:\'",.<>/?','`~']:['1234567890','qwertyuiop','asdfghjkl','zxcvbnm'];
  rows.forEach((letters,row)=>{const wrap=this.doc.createElement('div');wrap.className='text-keyboard-row';wrap.dataset.navGroup='keyboard-row-'+row;wrap.dataset.navAxis='horizontal';
   [...letters].forEach((letter,col)=>{const value=!this.symbols&&this.upper?letter.toUpperCase():letter;this.button(value,()=>this.insert(value),wrap,'keyboard-key-'+row+'-'+col);});this.keys.append(wrap);
  });
  this.doc.getElementById('keyboard-shift')?.setAttribute('aria-pressed',String(this.upper));this.doc.getElementById('keyboard-symbols')?.setAttribute('aria-pressed',String(this.symbols));
  const previous=old?this.doc.getElementById(old):null;if(previous&&this.root.contains(previous))this.nav.focus(previous);
 }
 open(input){
  if(!isTextEntry(input)||input.disabled||input.readOnly)return false;
  this.build();if(this.active)this.close(false);this.target=input;this.parent=this.nav.scope;this.upper=false;this.symbols=false;
  this.field.type=input.type==='password'?'password':'text';this.field.maxLength=input.maxLength>0?input.maxLength:2048;this.field.value=input.value||'';
  this.title.textContent=input.getAttribute('aria-label')||input.closest('label')?.childNodes?.[0]?.textContent?.trim()||input.placeholder||'ENTER TEXT';
  this.root.classList.remove('hidden');this.active=true;this.renderKeys();this.caret(this.field.value.length);this.nav.enter(this.root);this.nav.focus(this.doc.getElementById('keyboard-key-0-0'));return true;
 }
 selection(){return [this.field.selectionStart??this.field.value.length,this.field.selectionEnd??this.field.value.length];}
 caret(at){this.field.setSelectionRange?.(at,at);this.position=at;}
 insert(text){const [start,end]=this.selection(),value=this.field.value,max=this.field.maxLength;const allowed=text.slice(0,Math.max(0,max-(value.length-(end-start))));this.field.value=value.slice(0,start)+allowed+value.slice(end);this.caret(start+allowed.length);}
 erase(){const [start,end]=this.selection(),from=start===end?Math.max(0,start-1):start;this.field.value=this.field.value.slice(0,from)+this.field.value.slice(end);this.caret(from);}
 close(apply=false){
  if(!this.active)return;const target=this.target,value=this.field.value;this.active=false;this.root.classList.add('hidden');
  if(this.parent)this.nav.enter(this.parent,{modal:this.parent.id!=='menu'});else this.nav.reset();
  if(apply&&target?.isConnected){target.value=value;target.dispatchEvent(new Event('input',{bubbles:true}));target.dispatchEvent(new Event('change',{bubbles:true}));}
  // Never retain a TURN password in the hidden draft or an instance property.
  this.field.value='';this.target=null;this.parent=null;this.nav.restore(target);
 }
 handleAction(action){
  if(!this.active)return false;
  if(action==='back'||action==='pause'||action==='home'){this.close(false);return true;}
  const directions={menuPrev:'up',menuNext:'down',menuLeft:'left',menuRight:'right'};
  if(directions[action])this.nav.focus(nextFocus(focusableControls(this.root),this.doc.activeElement,directions[action]));
  else if(action==='confirm'){const el=this.doc.activeElement;if(el?.tagName==='BUTTON'&&this.root.contains(el))el.click();else this.nav.focus(this.doc.getElementById('keyboard-key-0-0'));}
  return true;
 }
}
