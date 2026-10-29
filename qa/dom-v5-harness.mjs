// A deliberately small DOM for exercising the shipped UI handlers in Node.
// This verifies behavior and state, not browser layout, rendering or hardware.
export class EventStub {
 constructor(type,options={}){this.type=type;this.bubbles=false;this.defaultPrevented=false;Object.assign(this,options);}
 preventDefault(){this.defaultPrevented=true;}
 stopPropagation(){this.cancelBubble=true;}
}
export class Target {
 constructor(){this.listeners=new Map();}
 addEventListener(type,fn){const list=this.listeners.get(type)||[];list.push(fn);this.listeners.set(type,list);}
 removeEventListener(type,fn){this.listeners.set(type,(this.listeners.get(type)||[]).filter(x=>x!==fn));}
 dispatchEvent(event){event.target??=this;event.currentTarget=this;for(const fn of [...(this.listeners.get(event.type)||[])])fn(event);if(event.bubbles&&!event.cancelBubble)this.parentNode?.dispatchEvent?.(event);return !event.defaultPrevented;}
 emit(type,extra={}){return this.dispatchEvent(new EventStub(type,extra));}
}
const dataKey=name=>name.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase());
const decode=value=>String(value).replace(/&(?:amp|lt|gt|quot|apos|nbsp);/g,m=>({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'",'&nbsp;':' '}[m]));
function matchesOne(el,selector){
 const s=selector.trim();if(!s)return false;
 if(s.startsWith('#'))return el.id===s.slice(1);
 if(s.startsWith('.'))return el.classList.contains(s.slice(1));
 const attr=/^([\w-]+)?\[([^=\]]+)(?:=["']?([^"'\]]*)["']?)?\]$/.exec(s);
 if(attr)return (!attr[1]||el.tagName===attr[1].toUpperCase())&&el.getAttribute(attr[2])!==null&&(attr[3]===undefined||el.getAttribute(attr[2])===attr[3]);
 return el.tagName===s.toUpperCase();
}
export class ElementStub extends Target {
 constructor(tag='div',doc=null){
  super();this.ownerDocument=doc;this.tagName=tag.toUpperCase();this.children=[];this.parentNode=null;this.attributes={};this.dataset={};this.style={setProperty(name,value){this[name]=String(value);},getPropertyValue(name){return this[name]||'';}};this._classes=new Set();this._value=null;this._selectedIndex=null;this.checked=false;this.disabled=false;this._text='';this.animations=[];
  this.classList={add:(...names)=>names.forEach(n=>this._classes.add(n)),remove:(...names)=>names.forEach(n=>this._classes.delete(n)),contains:n=>this._classes.has(n),toggle:(n,force)=>{const value=force===undefined?!this._classes.has(n):!!force;value?this._classes.add(n):this._classes.delete(n);return value;}};
 }
 get parentElement(){return this.parentNode instanceof ElementStub?this.parentNode:null;}
 set id(value){this._id=String(value);this.ownerDocument?.ids.set(this._id,this);}get id(){return this._id||'';}
 set className(value){this._classes=new Set(String(value).split(/\s+/).filter(Boolean));}get className(){return [...this._classes].join(' ');}
 set textContent(value){this._text=String(value);this.replaceChildren();}get textContent(){return this._text+this.children.map(c=>c.textContent).join('');}
 set value(value){this._value=String(value);if(this.tagName==='SELECT')this._selectedIndex=this.options.findIndex(o=>o.value===this._value);}
 get value(){return this.tagName==='SELECT'?(this.options[this.selectedIndex]?.value??''):this._value??(this.tagName==='OPTION'?this.textContent:'');}
 get options(){return this.children.flatMap(c=>c.tagName==='OPTION'?[c]:c.tagName==='OPTGROUP'?c.options:[]);}
 set selectedIndex(index){this._selectedIndex=Number(index);this._value=this.options[index]?.value??'';}get selectedIndex(){return this._selectedIndex??(this.options.length?0:-1);}
 set tabIndex(value){this._tabIndex=Number(value);}get tabIndex(){return this._tabIndex??(['BUTTON','SELECT','INPUT','TEXTAREA','A','SUMMARY'].includes(this.tagName)?0:-1);}
 get firstElementChild(){return this.children[0]||null;}get lastElementChild(){return this.children.at(-1)||null;}
 get isConnected(){for(let el=this;el;el=el.parentNode)if(el===this.ownerDocument)return true;return false;}
 get offsetParent(){for(let el=this;el instanceof ElementStub;el=el.parentNode)if(el.classList.contains('hidden')||el.classList.contains('native-choice')||el.style.display==='none')return null;return this.isConnected?(this.parentElement||this.ownerDocument.body):null;}
 append(...elements){for(const el of elements){el.remove?.();el.parentNode=this;el.ownerDocument??=this.ownerDocument;this.children.push(el);}}
 add(el){this.append(el);}
 insertBefore(el,before){el.remove?.();const index=this.children.indexOf(before);if(index<0)throw new Error('insertBefore target is not a child');el.parentNode=this;el.ownerDocument??=this.ownerDocument;this.children.splice(index,0,el);return el;}
 remove(){if(this.parentNode?.children){const at=this.parentNode.children.indexOf(this);if(at>=0)this.parentNode.children.splice(at,1);}this.parentNode=null;}
 replaceChildren(...elements){for(const child of this.children)child.parentNode=null;this.children=[];this.append(...elements);}
 setAttribute(key,value){
  this.attributes[key]=String(value);if(key==='id')this.id=value;if(key==='class')this.className=value;if(key==='value')this.value=value;if(key==='type')this.type=value;if(key==='disabled')this.disabled=true;if(key==='checked')this.checked=true;if(key==='tabindex')this.tabIndex=Number(value);if(['min','max','step'].includes(key))this[key]=String(value);if(key.startsWith('data-'))this.dataset[dataKey(key)]=String(value);
 }
 getAttribute(key){if(key==='id')return this.id||null;if(key==='class')return this.className;if(key.startsWith('data-'))return this.dataset[dataKey(key)]??null;return this.attributes[key]??null;}
 removeAttribute(key){delete this.attributes[key];if(key.startsWith('data-'))delete this.dataset[dataKey(key)];if(key==='disabled')this.disabled=false;}
 matches(selector){return selector.split(',').some(s=>matchesOne(this,s));}
 closest(selector){for(let el=this;el instanceof ElementStub;el=el.parentNode)if(el.matches(selector))return el;return null;}
 contains(el){for(let current=el;current;current=current.parentNode)if(current===this)return true;return false;}
 querySelectorAll(selector){const result=[];const walk=el=>{for(const child of el.children){if(child.matches(selector))result.push(child);walk(child);}};walk(this);return result;}
 querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
 focus(){if(!this.disabled)this.ownerDocument.activeElement=this;}
 scrollIntoView(){}setPointerCapture(){}
 click(){if(!this.disabled)this.emit('click',{bubbles:true});}
 animate(keyframes,options){
  if(!this.ownerDocument.animationsEnabled)throw new Error('Animations not enabled in this fixture');
  let resolve,reject,done=false;
  const animation={keyframes,options,cancelled:false,finished:new Promise((r,j)=>{resolve=r;reject=j;}),finish(){if(!done){done=true;resolve();}},cancel(){animation.cancelled=true;if(!done){done=true;reject(new Error('Animation cancelled'));}}};
  this.animations.push(animation);this.ownerDocument.animations.push(animation);return animation;
 }
}
export class DocumentStub extends Target {
 constructor({animations=false}={}){super();this.ids=new Map();this.children=[];this.hidden=false;this.activeElement=null;this.animationsEnabled=animations;this.animations=[];this.root=this.createElement('document');this.root.parentNode=this;this.children.push(this.root);this.body=null;}
 createElement(tag){const element=new ElementStub(tag,this);if(!this.animationsEnabled)element.animate=undefined;return element;}
 getElementById(id){const found=this.ids.get(id);return found?.isConnected?found:null;}
 querySelectorAll(selector){return this.root.querySelectorAll(selector);}querySelector(selector){return this.root.querySelector(selector);}
 settleAnimations(){for(const a of this.animations)a.finish();}
}
export function installDOM(doc){
 globalThis.document=doc;globalThis.Event=EventStub;
 globalThis.Option=class extends ElementStub{constructor(label,value){super('option',doc);this.textContent=label;this.value=value;if(!doc.animationsEnabled)this.animate=undefined;}};
 return doc;
}
export function parseHTML(source,{animations=false}={}){
 const doc=new DocumentStub({animations}),stack=[doc.root],seen=new Set();
 const html=source.replace(/<!--[^]*?-->/g,'').replace(/(<(?:script|style)\b[^>]*>)[^]*?(<\/(?:script|style)>)/gi,'$1$2');
 for(const match of html.matchAll(/<\/?[\w-]+[^>]*>|[^<]+/g)){
  const token=match[0];if(!token.startsWith('<')){stack.at(-1)._text+=decode(token);continue;}
  const tagMatch=/^<\/?([\w-]+)([^>]*)>/.exec(token);if(!tagMatch)continue;const [,tagName,attrs]=tagMatch,tag=tagName.toLowerCase();
  if(token[1]==='/'){const found=stack.findLastIndex(el=>el.tagName===tag.toUpperCase());if(found>0)stack.length=found;continue;}
  const el=doc.createElement(tag);
  for(const a of attrs.matchAll(/([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)){
   if(a[1]==='id'){const id=a[2]??a[3]??a[4]??'';if(seen.has(id))throw new Error('Duplicate HTML id '+id);seen.add(id);}
   el.setAttribute(a[1],decode(a[2]??a[3]??a[4]??''));
  }
  stack.at(-1).append(el);if(tag==='body')doc.body=el;
  if(!['meta','link','input','br','hr','img','path','source','area','wbr'].includes(tag)&&!token.endsWith('/>'))stack.push(el);
 }
 if(!doc.body){doc.body=doc.createElement('body');doc.root.append(doc.body);}
 doc.activeElement=doc.body;return {doc,ids:seen};
}
export function makeElement(doc,tag,id,parent=doc.body){const el=doc.createElement(tag);if(id)el.id=id;parent.append(el);return el;}
export const flushMicrotasks=async()=>{for(let i=0;i<6;i++)await Promise.resolve();};
