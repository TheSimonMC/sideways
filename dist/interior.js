import * as THREE from './vendor/three.module.js';
import {cockpitLayout,cockpitReadings,steeringWheelAngle} from './cockpit-state.js';
import {createDriver} from './driver.js';
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
export function createInterior(chassis,build){
 const layout=cockpitLayout(build),l=layout,q=l.q,W=l.W,root=new THREE.Group();root.name='interior-'+build.vehicle.id;root.userData.interior=true;chassis.add(root);
 const material=(color,extra={})=>new THREE.MeshStandardMaterial({color,roughness:.86,metalness:.04,flatShading:true,...extra});
 const dark=material(0x20262e),trim=material(l.trim),cloth=material(l.seat),accent=material(l.accent),metal=material(0xa0a8aa,{roughness:.35,metalness:.65});
 const groups=new Map();
 const add=(geometry,mat,position=[0,0,0],rotation=[0,0,0],tag='')=>{geometry.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...position),new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)),new THREE.Vector3(1,1,1)));const key=mat.uuid+tag;if(!groups.has(key))groups.set(key,{mat,tag,geos:[]});groups.get(key).geos.push(geometry);};
 const box=(x,y,z,w,h,d,mat=trim,tag='',rotation=[0,0,0])=>add(new THREE.BoxGeometry(w,h,d),mat,[x,y,z],rotation,tag);
 const cyl=(x,y,z,r,h,mat=metal,rotation=[Math.PI/2,0,0])=>add(new THREE.CylinderGeometry(r,r,h,10),mat,[x,y,z],rotation);
 box(0,.35,(l.front+l.back)/2,W*1.65,.05,l.front-l.back,dark);
 box(0,q.sill-.19,l.dashZ+.09,W*1.68,.25,.40,trim);
 box(0,q.sill-.05,l.dashZ+.12,W*1.68,.06,.42,dark);
 box(l.driverX,q.sill+.002,l.dashZ-.04,.55,.06,.22,dark);
 box(0,.42,l.seatZ+.30,.23,.20,.70,dark);
 box(0,.54,l.dashZ-.14,.25,.045,.20,trim);
 if(l.kind==='muscle')box(0,q.sill-.11,l.dashZ-.117,W*1.61,.06,.018,accent);
 else if(l.kind==='wedge')box(-.40,q.sill-.25,l.dashZ-.12,.24,.06,.025,accent);
 else box(.30,q.sill-.26,l.dashZ-.14,.30,.07,.025,accent);
 // Seats and trim follow the actual cabin profile, including the small two-seat wedge.
 for(const side of [-1,1]){
  const x=side*W*.46;
  box(x,.46,l.seatZ,.38,.12,.45,cloth);box(x,.70,l.seatZ-.22,.37,.43,.10,cloth,'',[-.15,0,0]);box(x,.955,l.seatZ-.26,.23,.15,.10,dark);
  for(const s of [-1,1]){box(x+s*.165,.54,l.seatZ,.045,.15,.40,dark);box(x+s*.165,.75,l.seatZ-.19,.05,.34,.10,dark);}
  for(let k=0;k<3;k++)box(x+(k-1)*.09,.526,l.seatZ-.01,.012,.008,.31,accent);
  const tag=side<0?'left':'right',doorZ=(l.front+l.back)/2;
  box(side*W*.865,.59,doorZ,.03,.28,l.front-l.back-.13,trim,tag);
  box(side*W*.835,.63,doorZ,.07,.055,.45,dark,tag);
  box(side*W*.81,.70,doorZ+.23,.025,.025,.15,metal,tag);
  box(side*W*.842,.52,doorZ-.43,.012,.12,.22,dark,tag);
  box(side*W*.84,.72,doorZ-.19,.016,.023,.055,accent,tag);
 }
 if(l.rear){const rearZ=Math.max(l.back+.25,l.seatZ-.65);box(0,.48,rearZ,W*1.48,.13,.30,cloth);box(0,.69,rearZ-.15,W*1.48,.34,.09,cloth);for(const side of [-1,1])box(side*W*.46,.89,rearZ-.17,.22,.12,.09,dark);}
 else box(0,.48,l.back+.27,W*1.38,.06,.30,dark);
 box(0,q.roof-.025,(q.roofBack+q.roofFront)/2,q.roofW*1.92,.025,q.roofFront-q.roofBack,trim);
 for(const side of [-1,1])box(side*.27,q.roof-.065,q.roofFront-.09,.27,.025,.13,dark);
 box(0,q.roof-.052,(q.roofBack+q.roofFront)/2,.12,.025,.08,metal);
 for(const x of [-W*.84,W*.84]){box(x,q.sill-.13,l.dashZ-.126,.10,.075,.018,dark);for(let k=0;k<4;k++)box(x,q.sill-.155+k*.017,l.dashZ-.138,.09,.007,.012,metal);}
 // Physical radio knobs and climate controls accompany the display.
 for(const x of [-.10,.10])cyl(x,q.sill-.31,l.dashZ-.146,.026,.025,metal);
 for(let k=0;k<3;k++)cyl((k-1)*.07,.56,l.dashZ-.19,.019,.02,dark);
 for(const {mat,tag,geos}of groups.values()){
  const position=[],normal=[];for(const g of geos){const n=g.toNonIndexed();position.push(...n.attributes.position.array);normal.push(...n.attributes.normal.array);n.dispose();g.dispose();}
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(position,3));geometry.setAttribute('normal',new THREE.Float32BufferAttribute(normal,3));geometry.computeBoundingSphere();
  const mesh=new THREE.Mesh(geometry,mat);mesh.name=tag?'interior-door-'+tag:'interior-trim';mesh.castShadow=mesh.receiveShadow=true;mesh.userData.interior=true;if(tag){mesh.userData.panel=tag;chassis.add(mesh);}else root.add(mesh);
 }
 const mesh=(geo,mat,name,parent=root)=>{const m=new THREE.Mesh(geo,mat);m.name=name;m.userData.interior=true;parent.add(m);return m;};
 const wheel=new THREE.Group();wheel.name='steering-column';wheel.position.set(...l.wheel);wheel.rotation.x=-.25;root.add(wheel);
 const rim=new THREE.Group();rim.name='steering-wheel';wheel.add(rim);mesh(new THREE.TorusGeometry(l.wheelRadius,.014,6,28),dark,'steering-rim',rim);
 mesh(new THREE.CylinderGeometry(.038,.038,.035,10).rotateX(Math.PI/2),metal,'steering-hub',rim);
 for(const a of l.kind==='muscle'?[0,Math.PI]:[0,Math.PI,Math.PI*1.5]){const m=mesh(new THREE.BoxGeometry(l.wheelRadius-.03,.018,.025),metal,'steering-spoke',rim);m.position.set(Math.cos(a)*l.wheelRadius*.53,Math.sin(a)*l.wheelRadius*.53,0);m.rotation.z=a;}
 const lever=(name,position,length)=>{const group=new THREE.Group();group.name=name;group.position.set(...position);root.add(group);const stem=mesh(new THREE.CylinderGeometry(.012,.012,length,6),metal,name+'-stem',group);stem.position.y=length/2;const knob=mesh(new THREE.IcosahedronGeometry(.028,1),dark,name+'-knob',group);knob.position.y=length;return group;};
 const shifter=lever('gear-lever',l.shifter,.075),handbrake=lever('handbrake-lever',l.handbrake,.10);
 const pedals=Array.from({length:3},(_,i)=>{const p=mesh(new THREE.BoxGeometry(i===2?.045:.065,.09,.025),metal,'pedal-'+i);p.position.set(l.driverX+(1-i)*.08,.34,l.dashZ+.04);return p;});
 const surface=(name,position,size,canvasSize)=>{const canvas=document.createElement('canvas');canvas.width=canvasSize[0];canvas.height=canvasSize[1];const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.minFilter=THREE.LinearFilter;texture.generateMipmaps=false;
  const m=mesh(new THREE.PlaneGeometry(...size),new THREE.MeshBasicMaterial({map:texture,toneMapped:false}),name);m.position.set(...position);m.rotation.y=Math.PI;return {mesh:m,canvas,ctx:canvas.getContext('2d'),texture};};
 const cluster=surface('instrument-cluster',[l.driverX,q.sill-.08,l.dashZ-.18],[.51,.235],[768,352]);
 const screen=surface('navigation-radio-screen',l.screen,l.screenSize,[512,336]);
 if(l.kind==='muscle'){const holder=mesh(new THREE.BoxGeometry(.27,.19,.035),dark,'navigation-holder');holder.position.set(l.screen[0],l.screen[1],l.screen[2]+.022);const stalk=mesh(new THREE.CylinderGeometry(.015,.015,.13,6),dark,'navigation-mount');stalk.position.set(l.screen[0],l.screen[1]-.12,l.screen[2]+.025);}
 const mirrors=[];
 for(const [id,position,size,direction]of [['inside',[0,q.roof-.13,q.roofFront-.035],[.27,.095],[0,0,-1]],['mirrorLeft',[-W*1.045,q.sill+.015,q.screenFront-.38],[.145,.08],[-.35,0,-1]],['mirrorRight',[W*1.045,q.sill+.015,q.screenFront-.38],[.145,.08],[.35,0,-1]]]){
  const m=mesh(new THREE.PlaneGeometry(...size),new THREE.MeshBasicMaterial({color:0x9dafb1}),id==='inside'?'interior-mirror':id);m.position.set(...position);m.rotation.y=Math.PI+(id==='inside'?-.08:id==='mirrorLeft'?.25:-.25);
  if(id==='inside'){const housing=mesh(new THREE.BoxGeometry(.29,.115,.024),dark,'mirror-housing');housing.position.set(position[0],position[1],position[2]+.018);housing.rotation.copy(m.rotation);const stem=mesh(new THREE.BoxGeometry(.025,.065,.025),dark,'mirror-stem');stem.position.set(position[0],position[1]+.07,position[2]+.01);}
  if(id!=='inside'){root.remove(m);m.userData.exterior=id;chassis.add(m);}mirrors.push({id,mesh:m,direction});
 }
 const lamp=mesh(new THREE.BoxGeometry(.085,.016,.055),new THREE.MeshStandardMaterial({color:0xffe6ba,emissive:0xffdfaf,emissiveIntensity:0}),'cabin-lamp');lamp.position.set(0,q.roof-.07,(q.roofBack+q.roofFront)/2);
 const light=new THREE.PointLight(0xffd7a1,0,1.8,2);light.position.set(0,q.roof-.16,-.15);root.add(light);
 const driver=createDriver(root,l,wheel,{shifter,handbrake});root.traverse(n=>n.userData.interior=true);
 let displayClock=0,screenClock=0,lastReadings=null,frameData={},eye=new THREE.Vector3(),ahead=new THREE.Vector3(),up=new THREE.Vector3();
 function drawCluster(r){
  const c=cluster.ctx;if(!c?.stroke)return;const w=768,h=352;c.fillStyle=r.powered?'#10191e':'#101316';c.fillRect(0,0,w,h);const color=r.powered?l.face:'#526063';c.strokeStyle=color;c.fillStyle=color;c.textAlign='center';c.textBaseline='middle';
  const text=(s,x,y,size=24)=>{c.font=`600 ${size}px monospace`;c.fillText(s,x,y);};
  if(!r.powered){text('NO POWER',384,176,30);cluster.texture.needsUpdate=true;return;}
  function dial(x,y,radius,value,max,label){c.lineWidth=3;c.strokeStyle='#52606a';c.beginPath();c.arc(x,y,radius,Math.PI*.75,Math.PI*2.25);c.stroke();for(let i=0;i<=8;i++){const a=Math.PI*.75+i/8*Math.PI*1.5;c.strokeStyle=color;c.beginPath();c.moveTo(x+Math.cos(a)*radius*.86,y+Math.sin(a)*radius*.86);c.lineTo(x+Math.cos(a)*radius,y+Math.sin(a)*radius);c.stroke();text(String(Math.round(i/8*max)),x+Math.cos(a)*radius*.67,y+Math.sin(a)*radius*.67,18);}const a=Math.PI*.75+clamp(value/max,0,1)*Math.PI*1.5;c.lineWidth=5;c.strokeStyle=r.powered?'#f38f71':'#526063';c.beginPath();c.moveTo(x,y);c.lineTo(x+Math.cos(a)*radius*.82,y+Math.sin(a)*radius*.82);c.stroke();c.fillStyle=color;text(label,x,y+radius*.40,18);}
  if(l.dial==='digital'){text(String(Math.round(r.powered?r.speed:0)).padStart(3,'0'),200,190,96);text('KM/H',200,263,25);text('RPM '+Math.round(r.powered?r.rpm:0),525,165,36);c.fillStyle='#314248';c.fillRect(365,215,335,26);c.fillStyle=color;c.fillRect(365,215,335*clamp(r.rpm/r.redline,0,1),26);}
  else if(l.dial==='sport'){dial(405,207,108,r.powered?r.rpm/1000:0,Math.ceil(r.redline/1000),'RPM × 1000');c.fillStyle=color;text(String(Math.round(r.speed)),145,190,66);text('KM/H',145,253,22);text(r.gear,650,190,55);text(l.name,650,253,18);}
  else if(l.dial==='classic'){dial(387,207,108,r.powered?r.speed:0,240,'KM/H');dial(135,210,88,r.powered?r.rpm/1000:0,Math.ceil(r.redline/1000),'RPM × 1000');c.fillStyle=color;text(r.gear,638,190,56);text(l.name,638,253,20);}
  else{const maxRpm=Math.ceil(r.redline/1000);dial(195,207,108,r.powered?r.speed:0,240,'KM/H');dial(570,207,108,r.powered?r.rpm/1000:0,maxRpm,'RPM × 1000');}
  c.fillStyle=color;if(l.dial==='twin'||l.dial==='digital'){text(r.gear,382,190,60);text(l.name,382,253,19);}
  text('FUEL '+Math.round(r.fuel*100)+'%',108,26,23);text('WATER '+Math.round(r.coolant)+'°',307,26,23);text('OIL '+Math.round(r.oil)+'°',510,26,23);text(r.oilPressure.toFixed(1)+' BAR',673,26,20);
  const warnings=Object.entries(r.warnings);warnings.forEach(([id,on],i)=>{c.fillStyle=r.powered&&on?'#ff8868':'#344047';text(id.toUpperCase(),70+i*125,64,21);});cluster.texture.needsUpdate=true;
 }
 function update(s,dt,time,options={}){
  frameData=options;const angle=steeringWheelAngle(s,build);rim.rotation.z=angle;rim.visible=!options.cockpit||options.settings?.wheel!==false;
  shifter.rotation.x=s.gear===0?0:(s.gear%2?-.22:.22);shifter.rotation.z=s.gear<0?.22:((Math.ceil((s.gear||1)/2)-2)*-.16);handbrake.rotation.x=-(s.handbrake||0)*.65;
  pedals[0].rotation.x=-(s.clutch||0)*.35;pedals[1].rotation.x=-(s.brake||0)*.35;pedals[2].rotation.x=-(s.throttle||0)*.35;
  driver.update(s,dt,angle,{cockpit:options.cockpit,hands:options.settings?.hands!==false});
  const readings=lastReadings=cockpitReadings(s,build),open=['left','right'].some(id=>{const p=s.bodyDamage?.zones?.[id];return p?.detached||Math.abs(p?.angle||0)>.08;}),on=readings.powered&&(open||readings.lights);
  lamp.material.emissiveIntensity=on?.75:0;light.intensity=options.cockpit&&on?.45:0;
  displayClock-=dt;screenClock-=dt;if(displayClock<=0||dt===0){drawCluster(readings);displayClock=options.cockpit?1/30:.2;}
  if(screenClock<=0||dt===0){const c=screen.ctx;if(c?.drawImage){c.fillStyle='#101d24';c.fillRect(0,0,512,336);if(readings.powered){options.drawNavigation?.(c,512,266);c.fillStyle='#12232c';c.fillRect(0,266,512,70);c.fillStyle=l.face;c.font='600 22px monospace';c.textAlign='center';c.fillText(options.music?.enabled===false?'RADIO OFF':'RADIO · '+Math.round((options.music?.volume??.42)*100)+'%',256,290);c.font='600 24px monospace';['MAP',options.music?.enabled===false?'PLAY':'PAUSE','− VOL','VOL +'].forEach((label,i)=>c.fillText(label,64+i*128,322));}screen.texture.needsUpdate=true;}screenClock=options.cockpit?.125:.6;}
 }
 function cameraPose(settings={},yaw=0,pitch=0,state={}){
  root.updateWorldMatrix(true,false);const motion=settings.motion??.35,lat=clamp(state.accelerationLat||0,-12,12)*-.0016*motion,long=clamp(state.accelerationLong||0,-12,12)*-.0018*motion;
  eye.set(l.eye[0]+lat,l.eye[1]+(settings.seatHeight||0)+driver.bob*motion,l.eye[2]+(settings.seatDistance||0)+long);
  ahead.copy(eye).add(new THREE.Vector3(Math.sin(yaw),-pitch,Math.cos(yaw)).multiplyScalar(12));up.set(0,1,0).transformDirection(root.matrixWorld);eye.applyMatrix4(root.matrixWorld);ahead.applyMatrix4(root.matrixWorld);return {position:eye,look: ahead,up};
 }
 return {root,layout,mirrors,screen:screen.mesh,update,cameraPose,diagnostics:()=>({kind:l.kind,style:l.dial,eye:l.eye,readings:lastReadings,wheelAngle:rim.rotation.z,wheelVisible:rim.visible,pedals:pedals.map(p=>({position:p.position.toArray(),angle:p.rotation.x})),driver:driver.diagnostics(),screenPowered:lastReadings?.powered,settings:frameData.settings})};
}
