import * as THREE from './vendor/three.module.js';
import {bodyLayout} from './body-layout.js';
const clamp=(x,a,b)=>Math.max(a,Math.min(b,Number.isFinite(x)?x:a));
export function createInductionView(parent,build){
 const kit=build.physics.induction,root=new THREE.Group();root.name='induction-hardware';root.userData.induction=true;parent.add(root);
 const wearColour=new THREE.Color(0x514346),silver=new THREE.MeshStandardMaterial({color:0x94a4ae,roughness:.66,metalness:.35,flatShading:true}),dark=new THREE.MeshStandardMaterial({color:0x192130,roughness:.85}),accent=new THREE.MeshStandardMaterial({color:kit.level===2?0xc889dd:0x68c9c8,roughness:.65,metalness:.15});
 const box=(name,x,y,z,w,h,d,mat=silver)=>{const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);m.name=name;m.position.set(x,y,z);root.add(m);return m;};
 const l=bodyLayout(build),z=(l.front+l.L*.85)/2,length=Math.max(.24,(l.L*.85-l.front)*.64),top=Math.min(l.top(z-length/2),l.top(z+length/2))-.055,width=clamp(.30+build.engine.displacementCc/40000,.32,.47);
 const beltZ=(l.front+l.L*.89)/2+Math.max(.3,l.L*.89-l.front)*.35+.045;
 let housing=null,blower=null,crank=null,belt=null,cooler=null,angle=0,crankAngle=0;
 if(kit.supercharged){
  const offset=build.vehicle.model.kind==='wedge'?.18:0;
  housing=box('supercharger-housing',offset,top-.085,z,width,.15,length,silver.clone());
  for(let i=0;i<7;i++)box('blower-cooling-rib',offset-width*.44+i*width*.88/6,top-.003,z,.014,.018,length*.86,accent);
  for(const side of [-1,1])box('blower-bracket',offset+side*width*.54,top-.16,z,.035,.16,length*.63,dark);
  const pulley=(name,y,r,x=0)=>{const g=new THREE.Group();g.name=name;g.position.set(x,y,beltZ);root.add(g);const disk=new THREE.Mesh(new THREE.CylinderGeometry(r,r,.035,12),dark);disk.rotation.x=Math.PI/2;g.add(disk);const spoke=new THREE.Mesh(new THREE.BoxGeometry(r*1.5,.012,.039),accent);g.add(spoke);return g;};
  const crankRadius=.065,blowerRadius=crankRadius/build.physics.engineOptions.overrides.superchargerRatio;
  blower=pulley('blower-pulley',top-.08,blowerRadius,offset);crank=pulley('blower-crank-pulley',Math.max(top-.22,.28),crankRadius);
  const noseLength=beltZ-(z+length*.5);box('blower-nose-shaft',offset,top-.08,z+length*.5+noseLength/2,.035,.035,noseLength,dark);
  belt=new THREE.Group();belt.name='supercharger-drive-belt';root.add(belt);
  const axis=blower.position.clone().sub(crank.position).normalize(),right=new THREE.Vector3(axis.y,-axis.x,0),points=[];for(const [centre,r,start]of [[blower.position,blowerRadius,0],[crank.position,crankRadius,Math.PI]])for(let i=0;i<=12;i++){const a=start+i*Math.PI/12;points.push(centre.clone().addScaledVector(right,Math.cos(a)*r).addScaledVector(axis,Math.sin(a)*r));}points.push(points[0].clone());
  const path=new THREE.CurvePath();for(let i=1;i<points.length;i++)path.add(new THREE.LineCurve3(points[i-1],points[i]));const loop=new THREE.Mesh(new THREE.TubeGeometry(path,64,.006,4,false),dark);loop.name='belt-loop';belt.add(loop);
  box('charge-inlet',offset-width*.5-.045,top-.10,z-length*.22,.09,.075,length*.7,dark);
  box('charge-outlet',offset+width*.5+.045,top-.11,z+length*.17,.09,.075,length*.55,dark);
 }
 if(kit.charged){
  const w=.53+kit.cooling*.10,h=.11+kit.cooling*.025;
  cooler=box('charge-cooler-core',0,.35,l.L*.91,w,h,.065);
  for(let i=0;i<5;i++)box('cooler-fin',0,.35-h*.4+i*h*.2,l.L*.91+.036,w*.94,.006,.009,dark);
  for(const side of [-1,1]){box('cooler-end-tank',side*(w*.5+.025),.35,l.L*.91,.05,h,.08,accent);box('charge-hose',side*(w*.5+.025),.39,(l.L*.91+z)/2,.065,.065,Math.max(.12,l.L*.91-z),dark);}
 }
 return {root,inspectionPose(){parent.updateWorldMatrix(true,false);return {position:parent.localToWorld(new THREE.Vector3(.9,1.9,l.L+1.0)),look:parent.localToWorld(new THREE.Vector3(0,top-.1,z)),up:new THREE.Vector3(0,1,0)};},update(state,dt){
  const s=state.induction||{},rpm=clamp(s.rpm,0,50000);angle=(angle+rpm*Math.PI/30*clamp(dt,0,.1))%(Math.PI*2);crankAngle=(crankAngle+clamp(state.rpm,0,16000)*Math.PI/30*clamp(dt,0,.1))%(Math.PI*2);
  if(blower){blower.rotation.z=angle;crank.rotation.z=crankAngle;belt.visible=(s.beltHealth??1)>.025;housing.material.color.set(0x94a4ae).lerp(wearColour,1-clamp(s.health??1,0,1));}
  if(cooler)cooler.scale.z=.35+.65*clamp(s.coolerHealth??1,0,1);
 },diagnostics(){return {fitted:!!kit.supercharged,cooler:!!kit.charged,meshes:(()=>{let n=0;root.traverse(x=>{if(x.isMesh)n++;});return n;})(),blowerAngle:angle,crankAngle,beltVisible:!!belt?.visible,top,housingTop:housing?housing.position.y+.075:null};}};
}
