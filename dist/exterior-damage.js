import {bodyLayout} from './body-layout.js';

// Fixed component keys also bound save and network input. Masses/thresholds are
// authored game calibrations; an assembly includes the mass of its children.
export const EXTERIOR_PARTS={
 glassFront:{label:'Windshield',kind:'glass',mass:8,radius:1.15},
 glassRear:{label:'Rear window',kind:'glass',mass:5,radius:1.05},
 glassLeft:{label:'Left door glass',kind:'glass',parent:'left',mass:3.5,radius:.85},
 glassRight:{label:'Right door glass',kind:'glass',parent:'right',mass:3.5,radius:.85},
 lampFL:{label:'Left headlamp',kind:'lamp',mass:1.8,radius:.62},
 lampFR:{label:'Right headlamp',kind:'lamp',mass:1.8,radius:.62},
 lampRL:{label:'Left tail lamp',kind:'lamp',mass:1,radius:.55},
 lampRR:{label:'Right tail lamp',kind:'lamp',mass:1,radius:.55},
 mirrorLeft:{label:'Left mirror',parent:'left',mass:1.2,radius:.45},
 mirrorRight:{label:'Right mirror',parent:'right',mass:1.2,radius:.45},
 skirtLeft:{label:'Left side skirt',mass:2.5,radius:.95},
 skirtRight:{label:'Right side skirt',mass:2.5,radius:.95},
 fenderFL:{label:'Left front fender',mass:4.5,radius:.85},
 fenderFR:{label:'Right front fender',mass:4.5,radius:.85},
 fenderRL:{label:'Left rear fender',mass:4,radius:.85},
 fenderRR:{label:'Right rear fender',mass:4,radius:.85},
 splitter:{label:'Front splitter',parent:'front',mass:3,radius:1.05},
 diffuser:{label:'Rear diffuser',parent:'rear',mass:3,radius:1.05},
 grille:{label:'Front grille',mass:1.6,radius:.75},
 exhaustTip:{label:'Exhaust outlet assembly',mass:3.2,radius:.80}
};
const clamp=(x,a,b)=>Math.max(a,Math.min(b,Number.isFinite(x)?x:a));
export function createExterior(saved={}){
 return Object.fromEntries(Object.entries(EXTERIOR_PARTS).map(([id,d])=>{
  const p=saved?.[id]||{};return [id,{health:clamp(p.health??1,0,1),mounts:clamp(p.mounts??1,0,1),scratches:clamp(p.scratches??0,0,1),cracked:p.cracked===true,detached:p.detached===true}];
 }));
}
export function exteriorLayout(build){
 const {q,L,W,front,back}=bodyLayout(build),p=build.physics,mid=(front+back)/2;
 const centers={glassFront:[0,(q.roof+q.sill)/2,(q.roofFront+front)/2],glassRear:[0,(q.roof+q.sill)/2,(q.roofBack+back)/2],glassLeft:[-W*.76,(q.roof+q.sill)/2,mid],glassRight:[W*.76,(q.roof+q.sill)/2,mid],
  lampFL:[-W*.68,.68,L*.98],lampFR:[W*.68,.68,L*.98],lampRL:[-W*.68,.68,-L*.98],lampRR:[W*.68,.68,-L*.98],
  mirrorLeft:[-W*1.04,q.sill+.01,front-.26],mirrorRight:[W*1.04,q.sill+.01,front-.26],skirtLeft:[-W*1.04,.29,0],skirtRight:[W*1.04,.29,0],
  fenderFL:[-W,.62,p.frontAxle],fenderFR:[W,.62,p.frontAxle],fenderRL:[-W,.62,-p.rearAxle],fenderRR:[W,.62,-p.rearAxle],
  splitter:[0,.28,L*.95],diffuser:[0,.23,-L*.94],grille:[0,.53,L*.974],exhaustTip:[build.vehicle.model.kind==='muscle'?0:.68,.32,-L*.976]};
 return Object.fromEntries(Object.entries(EXTERIOR_PARTS).map(([id,d])=>[id,{...d,center:centers[id],radius:Math.min(.65,d.radius*.55)}]));
}
export function exteriorMissing(body,id){const d=EXTERIOR_PARTS[id];return !!body?.exterior?.[id]?.detached||!!(d?.parent&&body?.zones?.[d.parent]?.detached)||id==='exhaustTip'&&!!body?.underbody?.exhaustRear?.detached;}
export function lampOutput(body,id){const p=body?.exterior?.[id];return exteriorMissing(body,id)||p?.health<=.25?0:clamp(p?.health??1,.3,1);}
export function windowAir(body){return Math.max(0,...['glassFront','glassRear','glassLeft','glassRight'].map(id=>exteriorMissing(body,id)?id==='glassFront'?1:.75:0));}
export function damageExterior(body,build,{local,energyJ,closingSpeed}){
 const detached=[],brokenGlass=[],layout=exteriorLayout(build),mass=build.physics.mass,strength=build.physics.bodyStrength??1;
 let changed=false;
 for(const [id,d]of Object.entries(EXTERIOR_PARTS)){
  const p=body.exterior[id];if(!p||exteriorMissing(body,id))continue;
  const [x,,z]=layout[id].center;
  // A side hit cannot directly break the opposite lamp, window or mirror.
  if(x&&local.x*x<0&&Math.abs(local.x)>.2)continue;
  let distance=Math.hypot((local.x-x)*1.2,local.z-z),weight=Math.max(0,1-distance/d.radius);
  if(d.kind==='glass'&&(id==='glassFront'||id==='glassRear')){
   // Laminated screens also receive chassis shock from the adjacent end.
   const end=id==='glassFront'?1:-1;
   weight=Math.max(weight,local.z*end>build.vehicle.model.length*.32?.13:0);
  }
  if(weight<=0||closingSpeed<2.2)continue;
  const specific=energyJ/(mass*90*strength),loss=clamp(specific*weight*(d.kind==='glass'?1.4:d.kind==='lamp'?1.05:.65),0,1);
  if(loss<.002)continue;
  p.health=Math.max(0,p.health-loss);p.scratches=clamp(p.scratches+loss*.85,0,1);p.mounts=Math.max(0,p.mounts-loss*(d.kind==='glass'?.7:1.15));
  if(p.health<.80)p.cracked=true;
  const shatter=d.kind==='glass'&&p.health<(id==='glassFront'?.12:.50);
  if(shatter||p.mounts<.08&&closingSpeed>7){p.detached=true;detached.push(id);if(d.kind==='glass')brokenGlass.push(id);}
  changed=true;
 }
 if(changed)body.revision++;
 return {changed,detached,brokenGlass};
}
export function repairExterior(body,id){
 const key=id.startsWith('exterior:')?id.slice(9):null;if(!key||!EXTERIOR_PARTS[key]||!body.exterior?.[key])return false;
 body.exterior[key]={health:1,mounts:1,scratches:0,cracked:false,detached:false};body.revision++;return true;
}
