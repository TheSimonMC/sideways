import * as THREE from './vendor/three.module.js';
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));

/** Bounded, contact-driven grass cuttings, earth clods and loose-ground tracks. */
export function createTerrainEffects(scene,initialBuild){
 let build=initialBuild,groundSampler=null,seed=718312,clodCursor=0,bladeCursor=0,rutCursor=0;
 const random=()=>((seed=Math.imul(seed,1664525)+1013904223)>>>0)/4294967296;
 const root=new THREE.Group();root.name='TERRAIN-CONTACT-FX';scene.add(root);
 const clods=new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1,0),new THREE.MeshStandardMaterial({color:0xffffff,roughness:1,flatShading:true}),80);
 const bladeGeometry=new THREE.BufferGeometry();bladeGeometry.setAttribute('position',new THREE.Float32BufferAttribute([-.18,0,0,.18,0,0,.09,1.4,.12,-.12,0,0,.09,1.4,.12,-.12,1,.08],3));bladeGeometry.computeVertexNormals();
 const blades=new THREE.InstancedMesh(bladeGeometry,new THREE.MeshStandardMaterial({color:0xffffff,roughness:1,flatShading:true,side:THREE.DoubleSide}),120);
 const rutGeometry=new THREE.PlaneGeometry(1,1);rutGeometry.rotateX(-Math.PI/2);
 const ruts=new THREE.InstancedMesh(rutGeometry,new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:.34,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1}),480);
 root.add(clods,blades,ruts);for(const mesh of[clods,blades,ruts]){mesh.frustumCulled=false;mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);}ruts.renderOrder=1;
 const clodData=Array.from({length:80},()=>({life:0})),bladeData=Array.from({length:120},()=>({life:0})),rutData=Array.from({length:480},()=>({life:0})),clocks=[0,0,0,0],previous=[null,null,null,null],dummy=new THREE.Object3D(),color=new THREE.Color();
 const counts={clods:0,grass:0,tracks:0};
 const hide=(mesh,i)=>{dummy.position.set(0,-1000,0);dummy.rotation.set(0,0,0);dummy.scale.setScalar(0);dummy.updateMatrix();mesh.setMatrixAt(i,dummy.matrix);};
 function emit(point,state,wheel,grass){
  const entries=grass?bladeData:clodData,mesh=grass?blades:clods,index=grass?bladeCursor++%entries.length:clodCursor++%entries.length,p=entries[index],sn=Math.sin(state.heading||0),cs=Math.cos(state.heading||0),slip=wheel.slipSpeed||0,speed=wheel.longitudinalSpeed??state.forwardSpeed??((state.vx||0)*sn+(state.vz||0)*cs),launch=speed*.18+slip*.22;
  // Keep longitudinal motion signed: reverse wheelspin ejects material forwards.
  Object.assign(p,{life:grass?1.2+random()*.6:.8+random()*.7,max:1.6,x:point.x+(random()-.5)*.15,y:point.y+.06,z:point.z+(random()-.5)*.15,floor:point.y+.025,fallbackFloor:point.y+.025,floorX:NaN,floorZ:NaN,vx:(state.vx||0)*.20-sn*launch+(random()-.5)*1.7,vz:(state.vz||0)*.20-cs*launch+(random()-.5)*1.7,vy:.9+random()*1.7+Math.min(3,Math.abs(slip)*.10),size:grass?.09+random()*.09:.035+random()*.065,angle:random()*6.28,spin:(random()-.5)*9});
  color.setHex(grass?[0x7f9860,0x566f37,0x9baa66][index%3]:[0x655442,0x887155,0xa18967][index%3]);mesh.setColorAt(index,color);counts[grass?'grass':'clods']++;
 }
 function track(a,b,grass){
  const length=Math.hypot(b.x-a.x,b.z-a.z);if(length<.5)return false;if(length>3)return true;
  const rise=b.y-a.y,i=rutCursor++%rutData.length;rutData[i]={x:(a.x+b.x)/2,z:(a.z+b.z)/2,y:(a.y+b.y)/2+.018,angle:Math.atan2(b.x-a.x,b.z-a.z),pitch:-Math.atan2(rise,length),length:Math.hypot(length,rise)+.08,life:48};ruts.setColorAt(i,color.setHex(grass?0x5c6235:0x574b3d));counts.tracks++;return true;
 }
 function update(state,dt){
  const sn=Math.sin(state.heading||0),cs=Math.cos(state.heading||0),p=build.physics;
  for(let i=0;i<4;i++){
   const w=state.wheelAudio?.[i],s=state.suspension?.[i],material=w?.surface||s?.material,loose=['grass','dirt','gravel'].includes(material),grounded=state.wheelAttached?.[i]!==false&&s?.contact!==false&&w?.contact!==false&&(w?.load??s?.load??0)>20;
   const speed=Math.abs(w?.longitudinalSpeed??state.speed??0),slip=Math.abs(w?.slipSpeed||0),lateral=Math.abs(w?.lateralSpeed||0);
   if(!loose||!grounded||Math.max(speed,slip,lateral)<1.7){clocks[i]=0;previous[i]=null;continue;}
   const side=i%2?1:-1,z=i<2?p.frontAxle:-p.rearAxle,point={x:state.x+sn*z+cs*side*p.halfTrack,z:state.z+cs*z-sn*side*p.halfTrack,y:s?.groundHeight??state.groundHeight??0};
   if(!previous[i]||track(previous[i],point,material==='grass'))previous[i]=point;
   const rate=clamp(speed*.65+slip*.8+lateral*.8,4,25);clocks[i]+=dt*rate;let emitted=0;
   while(clocks[i]>=1&&emitted<3){clocks[i]--;emit(point,state,w||{},material==='grass');if(material==='grass'&&slip>3)emit(point,state,w||{},false);emitted++;}
  }
  for(const[entries,mesh,grass]of[[clodData,clods,false],[bladeData,blades,true]]){
   entries.forEach((p,i)=>{if(p.life<=0){hide(mesh,i);return;}p.life=Math.max(0,p.life-dt);p.vy-=dt*(grass?4.2:9.81);p.vx*=Math.exp(-dt*(grass?1.8:.7));p.vz*=Math.exp(-dt*(grass?1.8:.7));p.x+=p.vx*dt;p.y+=p.vy*dt;p.z+=p.vz*dt;p.angle+=p.spin*dt;
    // At most one query per active particle (200 total). Airborne ascent and
    // settled particles reuse their floor until they move two centimetres.
    if(groundSampler&&(p.vy<=0||p.y<p.floor+.35)&&(!Number.isFinite(p.floorX)||(p.x-p.floorX)**2+(p.z-p.floorZ)**2>.0004)){
     const surface=groundSampler(p.x,p.z),height=typeof surface==='number'?surface:surface?.height;
     p.floor=Number.isFinite(height)?height+.025:p.fallbackFloor;p.floorX=p.x;p.floorZ=p.z;
    }
    if(p.y<p.floor){p.y=p.floor;p.vy=Math.abs(p.vy)*.15;p.vx*=.65;p.vz*=.65;}const fade=Math.min(1,p.life*5);dummy.position.set(p.x,p.y,p.z);dummy.rotation.set(p.angle,p.angle*.7,grass?p.angle*.5:0,'XYZ');dummy.scale.setScalar(p.size*fade);dummy.updateMatrix();mesh.setMatrixAt(i,dummy.matrix);
   });mesh.instanceMatrix.needsUpdate=true;if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;
  }
  rutData.forEach((p,i)=>{if(p.life<=0){hide(ruts,i);return;}p.life=Math.max(0,p.life-dt);dummy.position.set(p.x,p.y,p.z);dummy.rotation.set(p.pitch,p.angle,0,'YXZ');dummy.scale.set(.27*Math.min(1,p.life/8),1,p.length);dummy.updateMatrix();ruts.setMatrixAt(i,dummy.matrix);});ruts.instanceMatrix.needsUpdate=true;if(ruts.instanceColor)ruts.instanceColor.needsUpdate=true;
 }
 function reset(){for(const mesh of[clods,blades,ruts]){for(let i=0;i<mesh.count;i++)hide(mesh,i);mesh.instanceMatrix.needsUpdate=true;}for(const entries of[clodData,bladeData,rutData])for(const p of entries)p.life=0;previous.fill(null);clocks.fill(0);}
 reset();return{root,update,reset,setBuild(next){build=next;reset();},setGroundSampler(fn){groundSampler=typeof fn==='function'?fn:null;for(const entries of[clodData,bladeData])for(const p of entries){p.floor=p.fallbackFloor;p.floorX=p.floorZ=NaN;}return this;},diagnostics(){return{activeClods:clodData.filter(p=>p.life>0).length,activeGrass:bladeData.filter(p=>p.life>0).length,activeTracks:rutData.filter(p=>p.life>0).length,counts:{...counts},capacity:680};},dispose(){root.removeFromParent();for(const mesh of[clods,blades,ruts]){mesh.geometry.dispose();mesh.material.dispose();}}};
}
