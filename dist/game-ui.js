const EASE='cubic-bezier(0.23, 1, 0.32, 1)';
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));

/** Console-style choices and short interruptible transitions. Native selects
 * keep the actual setting values; their visible controls never open OS menus. */
export class GameUI {
 constructor(doc=globalThis.document){
  this.doc=doc;this.selects=new Map();this.animations=new WeakMap();this.clock=0;
  this.reduced=globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches??false;
  this.map=new MapPresentation(doc);this.scan();
 }
 scan(){
  for(const select of this.doc.querySelectorAll('select')){
   if(this.selects.has(select)||!select.id)continue;
   const wrap=this.doc.createElement('span');wrap.className='game-choice';
   const previous=this.doc.createElement('button'),choice=this.doc.createElement('button'),next=this.doc.createElement('button');
   previous.type=choice.type=next.type='button';previous.className=next.className='choice-arrow';choice.className='choice-value';
   previous.textContent='‹';next.textContent='›';choice.dataset.selectId=select.id;
   previous.tabIndex=next.tabIndex=-1;previous.setAttribute('aria-label','Previous option');next.setAttribute('aria-label','Next option');
   select.parentNode.insertBefore(wrap,select);wrap.append(previous,choice,next,select);
   select.classList.add('native-choice');select.tabIndex=-1;select.setAttribute('aria-hidden','true');
   const step=direction=>{this.change(select,direction);choice.focus({preventScroll:true});};
   previous.addEventListener('click',()=>step(-1));next.addEventListener('click',()=>step(1));choice.addEventListener('click',()=>step(1));
   select.addEventListener('change',()=>this.sync());this.selects.set(select,{wrap,previous,choice,next});
  }
  this.sync();
 }
 sync(){
  for(const [select,view]of this.selects){
   const current=select.options[select.selectedIndex],text=current?.textContent||'NOT AVAILABLE';
   if(view.choice.textContent!==text)view.choice.textContent=text;
   const label=select.getAttribute('aria-label')||select.closest('label')?.querySelector('span')?.textContent||'Selection';
   view.choice.setAttribute('aria-label',label+': '+text+'. Use left and right to change.');
   const disabled=select.disabled||select.options.length===0;
   view.previous.disabled=disabled||select.selectedIndex<=0;view.next.disabled=disabled||select.selectedIndex>=select.options.length-1;view.choice.disabled=disabled;
   view.wrap.classList.toggle('disabled',disabled);
  }
 }
 change(select,direction){
  if(!select||select.disabled||!select.options.length)return false;
  const old=select.selectedIndex;let next=clamp(old+direction,0,select.options.length-1);
  while(select.options[next]?.disabled&&next!==old){const more=next+direction;if(more<0||more>=select.options.length)return false;next=more;}
  select.selectedIndex=next;if(next!==old)select.dispatchEvent(new Event('change',{bubbles:true}));
  this.sync();this.press(this.selects.get(select)?.choice);return true;
 }
 control(element){return this.selects.get(element)?.choice||element;}
 adjust(element,direction){const id=element?.dataset?.selectId;return id?this.change(this.doc.getElementById(id),direction):false;}
 update(dt){this.clock+=dt;if(this.clock>.3){this.clock=0;this.scan();}}
 stopAnimation(el){const current=this.animations.get(el);if(current){current.cancel();this.animations.delete(el);}}
 enter(el){
  if(!el)return;this.stopAnimation(el);el.classList.remove('hidden','ui-leaving');
  if(!el.animate)return;
  const keyframes=this.reduced?[{opacity:0},{opacity:1}]:[{opacity:0,transform:'translateY(12px) scale(.98)'},{opacity:1,transform:'translateY(0) scale(1)'}];
  const animation=el.animate(keyframes,{duration:200,easing:EASE});this.animations.set(el,animation);
  animation.finished.then(()=>{if(this.animations.get(el)===animation)this.animations.delete(el);}).catch(()=>{});
 }
 leave(el){
  if(!el||el.classList.contains('hidden'))return;this.stopAnimation(el);el.classList.add('ui-leaving');
  if(!el.animate){el.classList.add('hidden');el.classList.remove('ui-leaving');return;}
  const keyframes=this.reduced?[{opacity:1},{opacity:0}]:[{opacity:1,transform:'translateY(0) scale(1)'},{opacity:0,transform:'translateY(8px) scale(.98)'}];
  const animation=el.animate(keyframes,{duration:160,easing:EASE,fill:'forwards'});this.animations.set(el,animation);
  animation.finished.then(()=>{if(this.animations.get(el)!==animation)return;el.classList.add('hidden');el.classList.remove('ui-leaving');animation.cancel();this.animations.delete(el);}).catch(()=>{});
 }
 press(el){if(!el?.animate||this.reduced)return;el.animate([{transform:'scale(.97)'},{transform:'scale(1)'}],{duration:120,easing:EASE});}
 loading(title,detail){
  const el=this.doc.getElementById('loading');this.stopAnimation(el);el.classList.remove('hidden','ui-leaving');
  const heading=this.doc.getElementById('loading-title');if(heading)heading.textContent=title;
  this.doc.getElementById('loading-status').textContent=detail;
 }
 loadingStatus(text){this.doc.getElementById('loading-status').textContent=text;}
 finishLoading(){this.leave(this.doc.getElementById('loading'));}
}

const MAP_PLACE_INFO={
 garage:{label:'MECHANIC',symbol:'M',description:'Repair damaged parts, refill NOS or fit your next upgrade.'},
 fuel:{label:'FUEL STATION',symbol:'F',description:'Stop at the pump to refill your tank.'},
 police:{label:'POLICE STATION',symbol:'P',description:'Police headquarters. Patrols operate throughout the city.'},
 job:{label:'JOB DESTINATION',symbol:'J',description:'Follow the route and stop at the marked pickup or delivery point.'},
 waypoint:{label:'CUSTOM WAYPOINT',symbol:'↗',description:'Set a route along the city streets to this location.'}
};
const mapDistance=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
/** Resolve what the cursor points at without replacing an already active route. */
export function mapSelection({places=[],cursor,player,route={},radius=24}={}){
 if(!cursor||![cursor.x,cursor.z].every(Number.isFinite))return null;
 let place=null,best=radius;
 for(const item of places){const at=item.spawn||item,delta=Math.min(mapDistance(cursor,item),mapDistance(cursor,at));if(delta<=best){place=item;best=delta;}}
 const atTarget=route.target&&mapDistance(cursor,route.target)<=radius;
 const target=place?(place.spawn||place):atTarget?route.target:cursor;
 const routed=route.target&&mapDistance(target,route.target)<8;
 const kind=place?.kind||(atTarget&&route.target.job?'job':'waypoint');
 return{...MAP_PLACE_INFO[kind]||MAP_PLACE_INFO.waypoint,kind,name:place?.name||(atTarget?route.target.name:'Marked location'),point:target,place,routed:!!routed,arrived:!!(routed&&route.arrived),distance:routed?Math.max(0,route.distance||0):player?mapDistance(player,target):0};
}

/** Map details remain normal DOM controls; the canvas keeps its world coordinates. */
export class MapPresentation {
 constructor(doc=globalThis.document){
  this.doc=doc;this.places=[];this.filter='all';this.callbacks={};this.selection=null;this.nodes={};
  const modal=doc.getElementById('map-modal'),canvas=doc.getElementById('full-map');
  if(!modal||!canvas)return;
  this.modal=modal;modal.classList.add('map-v12');
  const el=(tag,className,text)=>{const node=doc.createElement(tag);if(className)node.className=className;if(text)node.textContent=text;return node;};
  const layout=el('div','map-layout'),aside=el('aside','map-sidebar');aside.setAttribute('aria-label','Destination details');
  const detail=el('section','map-detail');detail.dataset.navGroup='map-detail';
  const stamp=el('span','map-place-stamp','↗'),kind=el('span','map-detail-kind','EXPLORE THE CITY'),name=el('h3','map-detail-name','CHOOSE A PLACE'),description=el('p','map-detail-description','Move the cursor or choose a service below.');
  const metric=el('div','map-detail-metric'),distance=el('strong','','—'),distanceLabel=el('span','','DISTANCE');metric.append(distance,distanceLabel);
  const mark=el('button','map-mark','SET WAYPOINT');mark.type='button';mark.id='map-mark-cursor';mark.addEventListener('click',()=>{if(this.selection)this.callbacks.onMark?.(this.selection.point,this.selection.name);});
  detail.append(stamp,kind,name,description,metric,mark);
  const directory=el('div','map-directory'),directoryHeading=el('span','map-directory-title','CITY SERVICES');
  const filters=el('div','map-filters');filters.setAttribute('role','group');filters.setAttribute('aria-label','Filter city services');filters.dataset.navGroup='map-filters';
  for(const [id,label]of [['all','ALL'],['garage','REPAIR'],['fuel','FUEL'],['police','POLICE']]){const button=el('button','map-filter',label);button.type='button';button.dataset.mapFilter=id;button.setAttribute('aria-pressed',id==='all'?'true':'false');button.addEventListener('click',()=>this.setFilter(id));filters.append(button);}
  const list=doc.getElementById('map-poi-list');list.dataset.navGroup='map-places';list.setAttribute('aria-label','City services');
  const empty=el('p','map-directory-empty hidden','No services in this area.');
  directory.append(directoryHeading,filters,list,empty);aside.append(detail,directory);
  const wrap=canvas.parentNode;modal.insertBefore(layout,wrap);layout.append(wrap,aside);
  const selection=modal.querySelector('.map-selection');if(selection)modal.insertBefore(selection,layout);
  const instructions=modal.querySelector('.map-instructions');if(instructions){instructions.classList.add('map-action-bar');const note=el('span','map-focus-help','TAB / SELECT · MAP ↔ PLACES');instructions.append(note);}
  this.nodes={detail,stamp,kind,name,description,distance,distanceLabel,mark,list,filters,empty};
 }
 setPlaces(places=[],callbacks={}){
  this.places=places;this.callbacks=callbacks;if(!this.modal)return;
  const list=this.nodes.list;list.replaceChildren();
  for(const [index,place]of places.entries()){
   const info=MAP_PLACE_INFO[place.kind]||MAP_PLACE_INFO.waypoint,button=this.doc.createElement('button'),symbol=this.doc.createElement('b'),name=this.doc.createElement('span');
   button.type='button';button.className='map-poi';button.dataset.mapKind=place.kind;button.dataset.mapPlace=String(index);button.id='map-place-'+index;
   symbol.textContent=info.symbol;name.textContent=place.name;button.append(symbol,name);
   button.setAttribute('aria-label',info.label+': '+place.name+'. Set waypoint.');
   button.addEventListener('focus',()=>this.callbacks.onInspect?.(place));
   button.addEventListener('click',()=>this.callbacks.onChoose?.(place));list.append(button);
  }
  this.setFilter(this.filter);
 }
 setFilter(kind){
  if(!this.modal)return;this.filter=kind;let visible=0;
  for(const b of this.nodes.filters.children)b.setAttribute('aria-pressed',b.dataset.mapFilter===kind?'true':'false');
  for(const b of this.nodes.list.children){const show=kind==='all'||b.dataset.mapKind===kind;b.hidden=!show;b.classList.toggle('hidden',!show);if(show)visible++;}
  this.nodes.empty.classList.toggle('hidden',visible>0);
 }
 render({world,player,cursor,projection,route={},zoom=1}={}){
  if(!this.modal)return;
  const selected=mapSelection({places:this.places,cursor,player,route,radius:projection?Math.max(12,26/projection.scale):24});this.selection=selected;
  this.modal.dataset.mapWorld=world?.kind||'city';
  if(!selected)return;
  const nodes=this.nodes,was=nodes.name.textContent;
  nodes.stamp.textContent=selected.symbol;nodes.kind.textContent=selected.label;nodes.name.textContent=selected.name;nodes.description.textContent=selected.description;
  nodes.detail.dataset.kind=selected.kind;nodes.distance.textContent=selected.arrived?'HERE':selected.distance>=1000?(selected.distance/1000).toFixed(1)+' KM':Math.round(selected.distance)+' M';
  nodes.distanceLabel.textContent=selected.routed?'BY ROAD':'STRAIGHT LINE';nodes.mark.textContent=selected.routed?'ROUTE SELECTED':'SET WAYPOINT';nodes.mark.disabled=selected.routed;
  nodes.mark.setAttribute('aria-label',(selected.routed?'Route selected: ':'Set waypoint to ')+selected.name);
  for(const button of nodes.list.children){const place=this.places[Number(button.dataset.mapPlace)],active=selected.place===place;button.classList.toggle('map-poi-selected',active);if(active)button.setAttribute('aria-current','location');else button.removeAttribute('aria-current');}
  if(was!==selected.name&&nodes.detail.animate&&!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches)nodes.detail.animate([{opacity:.55,transform:'translateY(5px)'},{opacity:1,transform:'translateY(0)'}],{duration:160,easing:EASE});
  const north=this.modal.querySelector('.map-north');if(north)north.textContent='N ↑  /  '+Math.round(zoom*100)+'%';
 }
}

export function paintInputPrompts(manager,doc=globalThis.document){
 const presentation=manager.getPresentation?.()||{kind:'keyboard',name:'KEYBOARD'};doc.body.dataset.inputKind=presentation.kind;
 for(const el of doc.querySelectorAll('[data-prompt]')){
  const p=manager.prompt?.(el.dataset.prompt);if(!p)continue;
  el.textContent=p.label;el.classList.add('input-glyph');el.dataset.kind=p.kind||presentation.kind;
  el.dataset.button=p.buttonIndex??'';el.setAttribute('aria-label',p.ariaLabel||p.label);el.classList.toggle('unbound',p.bound===false);
 }
 const chip=doc.getElementById('input-device-name');if(chip)chip.textContent=presentation.kind==='keyboard'?'KEYBOARD':presentation.kind==='playstation'?'PLAYSTATION':presentation.kind==='xbox'?'XBOX CONTROLLER':presentation.kind==='wheel'?'WHEEL':presentation.kind==='touch'?'TOUCH':'CONTROLLER';
 const calibration=doc.getElementById('quick-calibrate');if(calibration)calibration.classList.toggle('hidden',!presentation.needsCalibration);
 return presentation;
}
