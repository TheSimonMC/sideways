/** Spatial controller navigation with a stable DOM-order fallback. */
export function nextFocus(elements,current,direction){
 if(!elements.length)return null;
 const explicit=current?.dataset?.['nav'+direction[0].toUpperCase()+direction.slice(1)];
 if(explicit){const target=elements.find(el=>el.id===explicit||el.dataset?.navKey===explicit);if(target)return target;}
 const group=current?.closest?.('[data-nav-group]');
 if(group&&((group.dataset.navAxis||'horizontal')==='horizontal')&&(direction==='left'||direction==='right')){
  const peers=elements.filter(el=>group.contains(el));
  if(peers.length>1){const at=peers.indexOf(current),step=direction==='left'?-1:1;return peers[(at+step+peers.length)%peers.length];}
 }
 const index=elements.indexOf(current),delta=direction==='left'||direction==='up'?-1:1;
 if(index<0)return delta<0?elements.at(-1):elements[0];
 const fallback=()=>elements[(index+delta+elements.length)%elements.length];
 const from=current?.getBoundingClientRect?.();
 if(!from||from.width<=0||from.height<=0)return fallback();
 const vertical=direction==='up'||direction==='down',cx=from.left+from.width/2,cy=from.top+from.height/2;
 let best=null,score=Infinity;
 for(const element of elements){
  if(element===current)continue;const r=element.getBoundingClientRect?.();if(!r||r.width<=0||r.height<=0)continue;
  const dx=r.left+r.width/2-cx,dy=r.top+r.height/2-cy,along=(vertical?dy:dx)*delta,cross=Math.abs(vertical?dx:dy);
  if(along<1)continue;
  const overlap=vertical?Math.min(from.right,r.right)-Math.max(from.left,r.left):Math.min(from.bottom,r.bottom)-Math.max(from.top,r.top);
  const value=along+cross*(overlap>0?.55:2.4)+(overlap>0?0:32);
  if(value<score){score=value;best=element;}
 }
 return best||fallback();
}

export function isTextEntry(el){
 return !!el&&(el.isContentEditable||el.tagName==='TEXTAREA'||el.tagName==='INPUT'&&!['range','checkbox','radio','button','submit','reset','file','color','hidden'].includes(el.type));
}

export function focusableControls(scope){
 if(!scope)return [];
 return Array.from(scope.querySelectorAll('button,input,select,textarea,summary,a[href],[tabindex]')).filter(el=>{
  if(el.disabled||el.hidden||el.offsetParent===null||el.tabIndex===-1||el.classList.contains('native-choice')||el.closest('[inert]'))return false;
  for(let p=el.parentElement;p&&p!==scope;p=p.parentElement)if(p.tagName==='DETAILS'&&!p.open&&el!==p.querySelector('summary'))return false;
  return true;
 });
}

export function adjustRange(el,direction){
 if(el?.type!=='range'||el.disabled)return false;
 const min=el.min===''||el.min==null?0:Number(el.min),max=el.max===''||el.max==null?100:Number(el.max);
 const step=el.step==='any'?(max-min)/100:Number(el.step)||1,old=Number(el.value);
 el.value=String(Math.max(min,Math.min(max,Math.round((old+direction*step)*1e8)/1e8)));
 if(Number(el.value)!==old){el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));}
 return true;
}

const focusKey=el=>el?.id?['id',el.id]:el?.dataset?.navKey?['navKey',el.dataset.navKey]:el?.dataset?.selectId?['selectId',el.dataset.selectId]:null;

/** Keeps screen history and the last real control, even when a card was rebuilt. */
export class ScreenNavigation{
 constructor(doc=globalThis.document){
  this.doc=doc;this.history=[];this.saved=new Map();this.isolated=new Map();this.modal=false;
  this.onFocus=e=>{const scope=this.scope;if(scope?.contains(e.target)){this.remember(e.target);return;}if(this.modal&&scope)this.restore();};
  this.onKey=e=>{if(e.key!=='Tab'||!this.modal||!this.scope)return;const list=focusableControls(this.scope);e.preventDefault();if(!list.length){this.scope.focus?.();return;}const at=list.indexOf(doc.activeElement),step=e.shiftKey?-1:1;this.focus(list[at<0?(e.shiftKey?list.length-1:0):(at+step+list.length)%list.length]);};
  doc.addEventListener('focusin',this.onFocus);doc.addEventListener('keydown',this.onKey,true);
 }
 get scope(){return this.history.at(-1)||null;}
 remember(el=this.doc.activeElement){if(this.scope?.contains(el))this.saved.set(this.scope,{el,key:focusKey(el)});}
 enter(scope,{modal=true}={}){
  if(!scope)return;this.remember();this.release();
  const old=this.history.indexOf(scope);if(old>=0)this.history.length=old+1;else this.history.push(scope);
  this.modal=modal;if(modal){scope.setAttribute('role','dialog');scope.setAttribute('aria-modal','true');this.isolate(scope);}
  return this;
 }
 returnTarget(){return this.history.at(-2)||null;}
 preferred(fallback){
  const list=focusableControls(this.scope),saved=this.saved.get(this.scope);
  return list.includes(saved?.el)?saved.el:saved?.key?list.find(el=>saved.key[0]==='id'?el.id===saved.key[1]:el.dataset?.[saved.key[0]]===saved.key[1])|| (list.includes(fallback)?fallback:list[0]):list.includes(fallback)?fallback:list[0];
 }
 focus(el){if(!el)return;this.doc.querySelectorAll('.pad-focus').forEach(item=>item.classList.remove('pad-focus'));el.classList.add('pad-focus');el.focus({preventScroll:true});el.scrollIntoView?.({block:'nearest',inline:'nearest'});this.remember(el);}
 restore(fallback){const el=this.preferred(fallback);this.focus(el);return el;}
 isolate(scope){
  for(let branch=scope;branch&&branch!==this.doc.body;branch=branch.parentElement){
   for(const sibling of branch.parentElement?.children||[]){if(sibling===branch||['SCRIPT','STYLE','LINK'].includes(sibling.tagName))continue;
    this.isolated.set(sibling,{inert:sibling.inert===true,attribute:sibling.getAttribute('inert')});sibling.inert=true;sibling.setAttribute('inert','');
   }
  }
 }
 release(){for(const [el,old]of this.isolated){el.inert=old.inert;if(old.attribute===null)el.removeAttribute('inert');else el.setAttribute('inert',old.attribute);}this.isolated.clear();if(this.scope)this.scope.removeAttribute('aria-modal');}
 reset(scope=null){this.remember();this.release();this.history=[];this.modal=false;if(scope)this.enter(scope,{modal:false});}
 destroy(){this.reset();this.doc.removeEventListener('focusin',this.onFocus);this.doc.removeEventListener('keydown',this.onKey,true);}
}

/** Shoulder buttons change the active visible tab without visiting every control. */
export function cycleTab(scope,direction,focus){
 const tabs=focusableControls(scope).filter(el=>el.getAttribute('role')==='tab');if(tabs.length<2)return false;
 const active=Math.max(0,tabs.findIndex(el=>el.getAttribute('aria-selected')==='true'||el.classList.contains('active'))),target=tabs[(active+direction+tabs.length)%tabs.length];
 target.click();focus?.(target);return true;
}
