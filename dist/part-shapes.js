import {bodyLayout,panelCenter} from './body-layout.js';
import {exteriorLayout} from './exterior-damage.js';
import {add,transform,multiply,eulerAxes} from './part-contacts.js';
const cache=new WeakMap();
// Authored boxes follow each body's dimensions. They approximate trim and
// dents; they do not replace the original mesh used for visible loose parts.
export function partShapes(build){
 if(cache.has(build))return cache.get(build);
 const l=bodyLayout(build),{W,L,q,front,back}=l,all={};
 for(const [id,part]of Object.entries(l.parts)){
  let half=id==='front'||id==='rear'?[W*1.10,.18,.26]:id==='spoiler'?[W*1.1,.19,.24]:id==='left'||id==='right'?[.15,(q.roof-.32)/2,(front-back)/2]:[W*.91,.10,Math.abs((id==='hood'?L*.96-front:-L*.96-back)/2)];
  const center=[...part.center];if(id==='left'||id==='right')center[1]=(.32+q.roof)/2;
  all[id]={...part,center,half};
 }
 for(const [id,part]of Object.entries(exteriorLayout(build))){
  const half=id.startsWith('glass')?[W*.72,.23,.05]:id.startsWith('lamp')?[.27,.14,.15]:id.startsWith('mirror')?[.14,.10,.16]:id.startsWith('skirt')?[.10,.10,L*.68]:id.startsWith('fender')?[.16,.29,.57]:id==='splitter'||id==='diffuser'?[W*1.10,.07,.32]:id==='grille'?[W*.58,.14,.05]:[build.vehicle.model.kind==='muscle'?.78:.22,.08,.18];
  const hinge=all[part.parent];all['exterior:'+id]={...part,half,...(hinge?.pivot?{pivot:hinge.pivot,axis:hinge.axis,sign:hinge.sign}: {})};
 }
 cache.set(build,all);return all;
}
export function chassisAxes(state){return multiply(eulerAxes(0,state.heading||0,0),eulerAxes(Math.max(-.40,Math.min(.40,state.bodyPitch||0)),0,Math.max(-.42,Math.min(.42,state.bodyRoll||0))));}
export function partPose(build,id,body,state,angle){
 const part=partShapes(build)[id];if(!part)return null;
 angle??=body?.zones?.[id.startsWith('exterior:')?part.parent:id]?.angle||0;
 const base=chassisAxes(state),hinge=eulerAxes(part.axis==='x'?angle*part.sign:0,part.axis==='y'?angle*part.sign:0,0),origin=[state.x||0,(state.bodyHeight||0)+(build.physics.rideHeight||0),state.z||0];
 return {center:add(origin,transform(base,panelCenter(part,angle))),axes:multiply(base,hinge),half:part.half,
  pivot:add(origin,transform(base,part.pivot||part.center)),axis:transform(base,part.axis==='y'?[0,part.sign,0]:[part.sign||1,0,0]),part};
}
