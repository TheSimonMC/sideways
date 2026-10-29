import * as THREE from './vendor/three.module.js';
import {resolveVehicleContacts,capsuleContact} from './contact.js';
import {captureAgent,validAgent,applyAgent} from './agent-snapshot.js';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const wrap=a=>Math.atan2(Math.sin(a),Math.cos(a));
const lerp=(a,b,t)=>a+(b-a)*t;
const dir=(a,b)=>{const len=Math.hypot(b.x-a.x,b.z-a.z);return{x:(b.x-a.x)/len,z:(b.z-a.z)/len,len};};
export const STYLES=[{name:'sedan',length:4.45,width:1.82,height:1.38},{name:'hatch',length:3.92,width:1.77,height:1.46},{name:'wagon',length:4.78,width:1.90,height:1.47},{name:'van',length:4.88,width:1.98,height:2.05}];
const PAINTS=[0xc5d4c8,0x5e899b,0xb26e76,0xddd0aa,0x647680,0x748a6d,0x8981a0,0x508f96];
function rand(car){car.seed=(1664525*car.seed+1013904223)>>>0;return car.seed/4294967296;}
function mergedBoxes(boxes){
 const pos=[],norm=[],matrix=new THREE.Matrix4(),normal=new THREE.Matrix3(),v=new THREE.Vector3();
 for(const [x,y,z,w,h,d,ry=0]of boxes){const g=new THREE.BoxGeometry(w,h,d).toNonIndexed();matrix.makeRotationY(ry);matrix.setPosition(x,y,z);normal.getNormalMatrix(matrix);for(let i=0;i<g.attributes.position.count;i++){v.fromBufferAttribute(g.attributes.position,i).applyMatrix4(matrix);pos.push(v.x,v.y,v.z);v.fromBufferAttribute(g.attributes.normal,i).applyMatrix3(normal).normalize();norm.push(v.x,v.y,v.z);}g.dispose();}
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(norm,3));return g;
}
function modelGeometry(style){
 const s=STYLES[style],L=s.length,W=s.width,van=style===3,hatch=style===1;
 const roofH=van?1.83:hatch?1.26:1.20,roofLength=van?L*.70:hatch?L*.48:L*.43,roofZ=van?-.22:hatch?-.34:-.17;
 return {
  paint:mergedBoxes([[0,.56,0,W,.53,L*.96],[0,.81,L*.29,W*.93,.18,L*.37],[0,roofH,roofZ,W*.78,.18,roofLength],[0,van?1.20:.90,-L*.32,W*.88,van?.92:.24,L*.20]]),
  glass:mergedBoxes([[0,(roofH+.79)*.5,roofZ,W*.75,roofH-.78,roofLength*.96]]),
  dark:mergedBoxes([[0,.30,0,W*.96,.15,L*.92],[0,.43,L*.49,W,.14,.12],[0,.43,-L*.49,W,.14,.12]]),
  lamps:mergedBoxes([[-W*.30,.67,L*.486,W*.21,.14,.035],[W*.30,.67,L*.486,W*.21,.14,.035]]),
  tails:mergedBoxes([[-W*.34,.67,-L*.486,W*.19,.15,.035],[W*.34,.67,-L*.486,W*.19,.15,.035]])
 };
}
/** Shared graph geometry for civilian drivers and police route planning. */
export function createRoadGuide(city){
 const graph=city.network,nodes=graph.nodeById,lane=graph.laneOffset,stop=graph.stopDistance,legs=new Map(),turns=new Map(),edgeMap=new Map(graph.edges.map(e=>[e.from+'>'+e.to,e]));
 function table(points){const distances=[0];for(let i=1;i<points.length;i++)distances.push(distances.at(-1)+Math.hypot(points[i].x-points[i-1].x,points[i].z-points[i-1].z));return{points,distances,length:distances.at(-1)};}
 function sample(path,distance){const s=clamp(distance,0,path.length);let i=0;while(i<path.distances.length-2&&path.distances[i+1]<s)i++;const a=path.points[i],b=path.points[i+1],d=dir(a,b),f=(s-path.distances[i])/Math.max(.00001,path.distances[i+1]-path.distances[i]);return{x:lerp(a.x,b.x,f),z:lerp(a.z,b.z,f),dx:d.x,dz:d.z,heading:Math.atan2(d.x,d.z)};}
 function leg(fromId,toId){
  const key=fromId+'>'+toId;if(legs.has(key))return legs.get(key);const a=nodes.get(fromId),b=nodes.get(toId),edge=edgeMap.get(key),center=table(edge?.points||[a,b]),margin=Math.min(stop,center.length*.28),points=[];
  for(let s=margin;s<center.length-margin;s+=3){const p=sample(center,s);points.push({x:p.x+p.dz*lane,z:p.z-p.dx*lane});}const end=sample(center,center.length-margin);points.push({x:end.x+end.dz*lane,z:end.z-end.dx*lane});
  const geometry=table(points),first=dir(points[0],points[1]),last=dir(points.at(-2),points.at(-1)),p={type:'road',fromId,toId,axis:edge?.axis||(Math.abs(b.x-a.x)>Math.abs(b.z-a.z)?'x':'z'),...geometry,start:points[0],end:points.at(-1),startDx:first.x,startDz:first.z,dx:last.x,dz:last.z};legs.set(key,p);return p;
 }
 function nextNode(car,goalId=null){const at=nodes.get(car.toId),options=at.neighbors.filter(id=>id!==car.fromId);if(goalId!==null){const distances=new Map([[goalId,0]]),queue=[goalId];for(let i=0;i<queue.length;i++)for(const id of nodes.get(queue[i]).neighbors)if(!distances.has(id)){distances.set(id,distances.get(queue[i])+1);queue.push(id);}return options.sort((a,b)=>(distances.get(a)??999)-(distances.get(b)??999))[0]??car.fromId;}
  const incoming=leg(car.fromId,car.toId),straight=options.find(id=>{const out=leg(car.toId,id);return incoming.dx*out.startDx+incoming.dz*out.startDz>.94;});if(straight!==undefined&&rand(car)<.60)return straight;return options[Math.floor(rand(car)*options.length)]??car.fromId;
 }
 function junction(car){const key=car.fromId+'>'+car.toId+'>'+car.nextId;if(turns.has(key))return turns.get(key);const incoming=leg(car.fromId,car.toId),out=leg(car.toId,car.nextId),start=incoming.end,end=out.start,turn=incoming.dx*out.startDz-incoming.dz*out.startDx,k=Math.hypot(end.x-start.x,end.z-start.z)*.55,controls=[start,{x:start.x+incoming.dx*k,z:start.z+incoming.dz*k},{x:end.x-out.startDx*k,z:end.z-out.startDz*k},end],points=[];
  for(let i=0;i<=32;i++){const t=i/32,u=1-t;points.push({x:u*u*u*controls[0].x+3*u*u*t*controls[1].x+3*u*t*t*controls[2].x+t*t*t*controls[3].x,z:u*u*u*controls[0].z+3*u*u*t*controls[1].z+3*u*t*t*controls[2].z+t*t*t*controls[3].z});}
  const p={type:'junction',nodeId:car.toId,fromId:car.fromId,toId:car.toId,nextId:car.nextId,...table(points),turn,axis:incoming.axis,start,end,dx:out.startDx,dz:out.startDz};turns.set(key,p);return p;
 }
 function project(path,x,z){let best=Infinity,s=0;for(let i=0;i<path.points.length-1;i++){const a=path.points[i],b=path.points[i+1],dx=b.x-a.x,dz=b.z-a.z,t=clamp(((x-a.x)*dx+(z-a.z)*dz)/(dx*dx+dz*dz),0,1),d=(a.x+dx*t-x)**2+(a.z+dz*t-z)**2;if(d<best){best=d;s=path.distances[i]+(path.distances[i+1]-path.distances[i])*t;}}return s;}
 function lookAhead(car,ahead,canEnter=true){const s=car.distance+ahead;if(s<=car.path.length)return sample(car.path,s);if(car.path.type==='road'){if(!canEnter)return sample(car.path,car.path.length);return sample(junction(car),s-car.path.length);}return sample(leg(car.path.toId,car.path.nextId),s-car.path.length);}
 function nearestNode(x,z){let id=0,best=Infinity;for(const n of graph.nodes){const d=(n.x-x)**2+(n.z-z)**2;if(d<best){best=d;id=n.id;}}return id;}
 return{leg,nextNode,junction,sample,project,lookAhead,nearestNode};
}
export function syncAgent(car){car.speed=Math.hypot(car.vx,car.vz);car.rpm=850+Math.abs(car.vx*Math.sin(car.heading)+car.vz*Math.cos(car.heading))*180;Object.assign(car.collider,{x:car.x,z:car.z,heading:car.heading,vx:car.vx,vz:car.vz,yawRate:car.yawRate,mass:car.mass,inertia:car.inertia,body:car});}
export function agentBuild(car){return{vehicle:{model:{width:car.width,length:car.length}},physics:{mass:car.mass,inertia:car.inertia}};}
export function createAgent(id,index,style=0,kind='traffic'){
 const spec=STYLES[style],mass=style===3?1780:style===2?1460:style===1?1140:1380;
 const car={id,index,style,...spec,mass,inertia:mass*(spec.length*spec.length+spec.width*spec.width)/12,paint:PAINTS[index%PAINTS.length],seed:(50927+index*3779)>>>0,x:0,z:0,heading:0,vx:0,vz:0,yawRate:0,speed:0,rpm:900,throttle:0,brake:false,wheelSpin:0,previousWheelSpin:0,steer:0,previousX:0,previousZ:0,previousHeading:0,previousY:0,y:0,bodyRoll:0,bodyPitch:0,hitHold:0,indicator:0,horn:0,hornCooldown:0,blockedTime:0,swerve:0,entries:0,turns:0,stopReason:'',cruise:[11.2,12.4,13.8][index%3]+(index%2)*.25,temperament:['cautious','steady','assertive'][index%3],headway:[1.35,1.15,1.0][index%3],yieldTimer:0,yielding:false,nearMissCooldown:0,nearMisses:0,visible:true};
 car.collider={x:0,z:0,hx:spec.width*.5,hz:spec.length*.5,heading:0,material:'metal',kind,npcId:id,vx:0,vz:0,yawRate:0,mass:car.mass,inertia:car.inertia,body:car};return car;
}
export function setAgentPose(car,pose,speed=0,city=null){Object.assign(car,{x:pose.x,z:pose.z,heading:pose.heading,vx:Math.sin(pose.heading)*speed,vz:Math.cos(pose.heading)*speed,yawRate:0,previousX:pose.x,previousZ:pose.z,previousHeading:pose.heading,bodyRoll:0,bodyPitch:0,steer:0});car.y=city?.getSurfaceAt(car.x,car.z).height??.012;car.previousY=car.y;syncAgent(car);}
/** A small dynamic bicycle/tyre model. Steering changes yaw gradually; impacts
 * survive AI updates as linear/angular velocity and return through tyre grip. */
export function integrateAgent(car,target,dt,city,{acceleration=2.6,deceleration=6.8}={}){
 car.previousX=car.x;car.previousZ=car.z;car.previousHeading=car.heading;car.previousWheelSpin=car.wheelSpin;car.previousY=car.y;
 const sn=Math.sin(car.heading),cs=Math.cos(car.heading),forward=car.vx*sn+car.vz*cs,lateral=car.vx*cs-car.vz*sn,dx=target.x-car.x,dz=target.z-car.z,distance=Math.max(1.5,Math.hypot(dx,dz)),error=wrap(Math.atan2(dx,dz)-car.heading),wheelbase=car.length*.61;
 const steer=Math.abs(error)>1.25?Math.sign(error)*.58:clamp(Math.atan2(2*wheelbase*Math.sin(error),distance),-.58,.58);car.steer+=(steer-car.steer)*(1-Math.exp(-dt*8));
 const grip=city.getSurfaceAt(car.x,car.z).grip,yawTarget=clamp(forward/wheelbase*Math.tan(car.steer),-1.35,1.35);car.yawRate+=(yawTarget-car.yawRate)*(1-Math.exp(-dt*(car.hitHold>0?2.2:7)*grip));
 const requested=Number.isFinite(target.speed)?target.speed:0,desired=Math.abs(error)>1.25?Math.min(requested,3.2):requested,a=clamp((desired-forward)*2.4,-deceleration,acceleration),long=forward+a*dt,lat=lateral-clamp(lateral*(1-Math.exp(-dt*5)), -8.2*grip*dt,8.2*grip*dt);
 car.vx=long*sn+lat*cs;car.vz=long*cs-lat*sn;car.heading=wrap(car.heading+car.yawRate*dt);car.x+=car.vx*dt;car.z+=car.vz*dt;
 car.brake=a<-.6||desired<.25;car.throttle=clamp(a/acceleration,0,1);car.wheelSpin+=long*dt/.31;car.bodyRoll+= (clamp(-car.yawRate*forward*.010,-.13,.13)-car.bodyRoll)*Math.min(1,dt*6);car.bodyPitch+=(clamp(-a*.012,-.075,.075)-car.bodyPitch)*Math.min(1,dt*7);car.y=city.getSurfaceAt(car.x,car.z).height;syncAgent(car);
}
export function createAgentRenderer(parent,states,{prefix='traffic',police=false,racing=false}={}){
 const root=new THREE.Group();root.name=prefix.toUpperCase();parent.add(root);const dummy=new THREE.Object3D(),color=new THREE.Color(),num=states.length,batches=[];
 const body=new THREE.MeshStandardMaterial({color:0xffffff,roughness:.78,metalness:.15,flatShading:true}),glass=new THREE.MeshStandardMaterial({color:0x243f50,roughness:.25,metalness:.35}),dark=new THREE.MeshStandardMaterial({color:0x17232e,roughness:.9}),head=new THREE.MeshStandardMaterial({color:0xffedcb,emissive:0xffe5b7,emissiveIntensity:.2}),tail=new THREE.MeshBasicMaterial({color:0xffffff});
 function inst(g,m,n,name){const mesh=new THREE.InstancedMesh(g,m,n);mesh.name=prefix+'-'+name;mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);mesh.frustumCulled=false;root.add(mesh);return mesh;}
 for(let style=0;style<STYLES.length;style++){const indices=states.map((c,i)=>c.style===style?i:-1).filter(i=>i>=0);if(!indices.length)continue;const geometry=modelGeometry(style),parts={};for(const[key,material]of Object.entries({paint:body,glass,dark,lamps:head,tails:tail})){parts[key]=inst(geometry[key],material,indices.length,STYLES[style].name+'-'+key);parts[key].castShadow=key==='paint'||key==='dark';parts[key].receiveShadow=true;parts[key].userData.stateIndices=indices;}batches.push({indices,parts});}
 const wheelGeo=new THREE.CylinderGeometry(.31,.31,.18,8);wheelGeo.rotateZ(Math.PI/2);const wheels=inst(wheelGeo,dark,num*4,'wheels'),shadowGeo=new THREE.PlaneGeometry(1,1);shadowGeo.rotateX(-Math.PI/2);const shadows=inst(shadowGeo,new THREE.MeshBasicMaterial({color:0x10212b,transparent:true,opacity:.24,depthWrite:false}),num,'contact-shadows'),indicators=inst(new THREE.BoxGeometry(.19,.13,.045),new THREE.MeshBasicMaterial({color:0xffbc4b}),num*2,'turn-signals');
 const policeTrim=police?inst(mergedBoxes([[0,.74,0,1.87,.26,3.4],[0,1.34,-.17,1.45,.08,1.9],[0,1.47,-.1,1.46,.09,.25]]),dark,num,'police-trim'):null;
 const raceTrim=racing?inst(mergedBoxes([[0,.32,1.99,1.84,.07,.25],[0,1.24,-1.68,1.98,.09,.35],[-.61,.99,-1.68,.09,.48,.13],[.61,.99,-1.68,.09,.48,.13]]),dark,num,'race-aero'):null;
 const raceStripe=racing?inst(mergedBoxes([[0,.912,1.05,.22,.012,1.10],[0,1.299,-.2,.22,.012,1.65]]),new THREE.MeshStandardMaterial({color:0xf4ebd5,roughness:.8}),num,'race-stripe'):null;
 const beacons=police?inst(new THREE.BoxGeometry(.6,.16,.31),new THREE.MeshBasicMaterial({color:0xffffff}),num*2,'beacons'):null;
 let disposed=false;
 function render(alpha=1,time=0){if(disposed)return;const t=clamp(Number.isFinite(alpha)?alpha:1,0,1);
  for(const batch of batches){batch.indices.forEach((index,i)=>{const car=states[index],x=lerp(car.previousX,car.x,t),z=lerp(car.previousZ,car.z,t),y=lerp(car.previousY??car.y,car.y,t),heading=car.previousHeading+wrap(car.heading-car.previousHeading)*t;
   dummy.position.set(x,y,z);dummy.rotation.set(car.bodyPitch,heading,car.bodyRoll,'YXZ');dummy.scale.setScalar(car.visible===false?0:1);dummy.updateMatrix();for(const part of Object.values(batch.parts))part.setMatrixAt(i,dummy.matrix);batch.parts.paint.setColorAt(i,color.setHex(police?0xe2e9df:car.paint));batch.parts.tails.setColorAt(i,color.setHex(car.brake||car.hitHold>0?0xff3d56:0x702d3d));if(policeTrim)policeTrim.setMatrixAt(index,dummy.matrix);if(raceTrim)raceTrim.setMatrixAt(index,dummy.matrix);if(raceStripe)raceStripe.setMatrixAt(index,dummy.matrix);
   const spin=lerp(car.previousWheelSpin,car.wheelSpin,t),sn=Math.sin(heading),cs=Math.cos(heading);
   for(let w=0;w<4;w++){const side=w%2?1:-1,axle=w<2?1:-1,lx=side*(car.width*.5-.05),lz=axle*car.length*.31;dummy.position.set(x+cs*lx+sn*lz,y+.31,z-sn*lx+cs*lz);dummy.rotation.set(spin,heading+(w<2?car.steer:0),0,'YXZ');dummy.scale.setScalar(car.visible===false?0:1);dummy.updateMatrix();wheels.setMatrixAt(index*4+w,dummy.matrix);}
   dummy.position.set(x,y+.022,z);dummy.rotation.set(0,heading,0);dummy.scale.set(car.visible===false?0:car.width*1.1,1,car.visible===false?0:car.length*.99);dummy.updateMatrix();shadows.setMatrixAt(index,dummy.matrix);
   const blink=Math.floor(time*2.7)%2===0,side=car.indicator||1;for(let end=0;end<2;end++){const lx=side*car.width*.42,lz=(end===0?1:-1)*car.length*.49;dummy.position.set(x+cs*lx+sn*lz,y+.68,z-sn*lx+cs*lz);dummy.rotation.set(0,heading,0);dummy.scale.setScalar(car.visible!==false&&car.indicator&&blink?1:0);dummy.updateMatrix();indicators.setMatrixAt(index*2+end,dummy.matrix);}
   if(beacons)for(let side=0;side<2;side++){const lx=(side?1:-1)*.38;dummy.position.set(x+cs*lx-sn*.1,y+1.6,z-sn*lx-cs*.1);dummy.rotation.set(0,heading,0);dummy.scale.setScalar(car.visible===false?0:1);dummy.updateMatrix();beacons.setMatrixAt(index*2+side,dummy.matrix);beacons.setColorAt(index*2+side,color.setHex(car.siren&&(Math.floor(time*9+index)%2===side)?(side?0x65baff:0xff405f):(side?0x203b64:0x602334)));}
  });for(const part of Object.values(batch.parts))part.instanceMatrix.needsUpdate=true;batch.parts.paint.instanceColor.needsUpdate=true;batch.parts.tails.instanceColor.needsUpdate=true;}
  for(const mesh of[wheels,shadows,indicators,policeTrim,beacons,raceTrim,raceStripe])if(mesh)mesh.instanceMatrix.needsUpdate=true;if(beacons?.instanceColor)beacons.instanceColor.needsUpdate=true;
 }
 function setNight(n){head.emissiveIntensity=.2+clamp(n,0,1)*3;}
 function dispose(){if(disposed)return;disposed=true;root.removeFromParent();const gs=new Set(),ms=new Set();root.traverse(o=>{if(o.geometry)gs.add(o.geometry);if(o.material)ms.add(o.material);});for(const g of gs)g.dispose();for(const m of ms)m.dispose();root.clear();}
 return{root,render,setNight,dispose};
}
/** Civilian AI acts through acceleration, steering, brakes and tyre response.
 * Persistent body objects are shared by rendering, collision and route logic. */
export function createTraffic(scene,city,{count=36,seed=50927}={}){
 const guide=createRoadGuide(city),graph=city.network,states=Array.from({length:clamp(Math.round(count),0,40)},(_,i)=>createAgent('npc-'+i,i,i%STYLES.length)),reservations=new Map(),stats={entries:0,turns:0,redStops:0,playerStops:0,contacts:0,horns:0,recycled:0,emergencyYields:0,nearMisses:0,courtesyYields:0};let time=0,recycleClock=0,disposed=false,replica=false,snapshotAge=.1;
 const renderer=createAgentRenderer(city.root,states),root=renderer.root,events=[];
 function place(car,fromId,toId,distance=0,speed=0){if(reservations.get(car.path?.nodeId)===car.id)reservations.delete(car.path.nodeId);car.fromId=fromId;car.toId=toId;car.path=guide.leg(fromId,toId);car.distance=clamp(distance,0,car.path.length);car.nextId=guide.nextNode(car);car.hitHold=car.swerve=car.blockedTime=0;setAgentPose(car,guide.sample(car.path,car.distance),speed,city);}
 function initialize(){replica=false;snapshotAge=.1;time=0;recycleClock=0;events.length=0;city.setTrafficTime(0);reservations.clear();for(const key of Object.keys(stats))stats[key]=0;const edges=[...graph.edges].sort((a,b)=>{const am=guide.sample(guide.leg(a.from,a.to),70),bm=guide.sample(guide.leg(b.from,b.to),70);return Math.hypot(am.x-city.spawn.x,am.z-city.spawn.z)-Math.hypot(bm.x-city.spawn.x,bm.z-city.spawn.z);}),used=new Set();
  for(let i=0;i<states.length;i++){const car=states[i];car.seed=(seed+i*3779)>>>0;car.entries=car.turns=0;car.stopReason='';car.brake=false;car.indicator=0;car.throttle=.2;car.horn=car.hornCooldown=car.wheelSpin=car.previousWheelSpin=car.yieldTimer=car.nearMissCooldown=car.nearMisses=0;car.yielding=false;car.visible=true;car.closePasses=new Map();let edge=edges[(i*7+9)%Math.min(edges.length,88)],distance=12+(i*13)%45;
   for(let j=0;j<edges.length;j++){const p=guide.sample(guide.leg(edge.from,edge.to),distance);if(!used.has(edge.id)&&Math.hypot(p.x-city.spawn.x,p.z-city.spawn.z)>28)break;edge=edges[(i*7+10+j)%edges.length];}used.add(edge.id);place(car,edge.from,edge.to,distance,6+(i%4)*.7);}
 }
 function exitClear(car,players){const out=guide.leg(car.toId,car.nextId),p=guide.sample(out,5);if(players.some(player=>Math.hypot(player.x-p.x,player.z-p.z)<7))return false;return !states.some(c=>c!==car&&c.path.type==='road'&&c.fromId===car.toId&&c.toId===car.nextId&&c.distance<14);}
 function update(dt,player,context={}){dt=clamp(Number.isFinite(dt)?dt:0,0,.04);if(!dt||disposed||replica)return;if(dt>1/120+.000001){const n=Math.ceil(dt*120);for(let i=0;i<n;i++)update(dt/n,player,context);return;}time+=dt;city.setTrafficTime(time);
  const players=[player,...(context.players||[])].filter(p=>p&&[p.x,p.z].every(Number.isFinite)&&p.active!==false).slice(0,4),snapshot=states.map(c=>({id:c.id,x:c.x,z:c.z,heading:c.heading,vx:c.vx,vz:c.vz,width:c.width,length:c.length,speed:c.speed}));
  for(const car of states){car.horn=Math.max(0,car.horn-dt);car.hornCooldown=Math.max(0,car.hornCooldown-dt);car.nearMissCooldown=Math.max(0,car.nearMissCooldown-dt);car.yieldTimer=Math.max(0,car.yieldTimer-dt);car.hitHold=Math.max(0,car.hitHold-dt);car.distance=guide.project(car.path,car.x,car.z);const path=car.path,remaining=path.length-car.distance;let target=path.type==='junction'?(Math.abs(path.turn)>.1?6.4:10.5):car.cruise,canEnter=true,playerBlocking=false,swerve=0;car.stopReason='';
   if(path.type==='road'){const signal=city.getSignal(car.toId,path.axis,time),owner=reservations.get(car.toId),clear=exitClear(car,players);canEnter=signal==='green'&&(!owner||owner===car.id)&&clear;const turn=guide.junction(car).turn;car.indicator=remaining<35?Math.sign(-turn):0;if(!canEnter){target=Math.min(target,Math.sqrt(2*3.6*Math.max(0,remaining-.9-car.speed*.55)));car.stopReason=signal!=='green'?'red':!clear?'queue':'junction';}else if(Math.abs(turn)>.1)target=Math.min(target,Math.sqrt(6.4**2+2*3.3*remaining));}
   const fx=Math.sin(car.heading),fz=Math.cos(car.heading),rx=fz,rz=-fx;
   const obstacle=(other,isPlayer=false)=>{const dx=other.x-car.x,dz=other.z-car.z,along=dx*fx+dz*fz,lateral=dx*rx+dz*rz;if(along<=0||along>60||Math.abs(lateral)>(car.width+(other.width??2.1))*.5+.5)return;const gap=along-(car.length+(other.length??4.5))*.5-(1.9+car.headway*.45),projected=Math.max(0,(other.vx??0)*fx+(other.vz??0)*fz);target=Math.min(target,Math.sqrt(projected*projected+2*3.8*Math.max(0,gap-Math.max(0,car.speed-projected)*(.36+car.headway*.14))));if(gap<2)target=Math.min(target,Math.max(0,gap)*.8);if(isPlayer){playerBlocking=true;car.stopReason='player';if(path.type==='road'&&remaining>30&&along>13&&along<36&&(other.speed??0)<3)swerve=-1.35;}};
   for(const other of snapshot)if(other.id!==car.id)obstacle(other);for(const other of players)obstacle(other,true);
   const emergency=(context.emergency||[]).filter(unit=>unit&&unit.active!==false&&unit.siren);
   const approaching=emergency.find(unit=>{const dx=unit.x-car.x,dz=unit.z-car.z,along=dx*fx+dz*fz,lateral=dx*rx+dz*rz;return along<18&&along>-95&&Math.abs(lateral)<9&&((unit.vx||0)*fx+(unit.vz||0)*fz)>2;});
   const courtesy=players.some(player=>player.horn&&((player.x-car.x)*fx+(player.z-car.z)*fz)<0&&Math.hypot(player.x-car.x,player.z-car.z)<30&&Math.cos((player.heading||0)-car.heading)>.65);
   if(approaching||courtesy){if(!car.yielding){stats[approaching?'emergencyYields':'courtesyYields']++;}car.yieldTimer=Math.max(car.yieldTimer,approaching?2.2:1.2);}
   car.yielding=car.yieldTimer>0;
   if(car.yielding&&path.type==='road'&&remaining>25){swerve=Math.min(swerve,approaching?-1.6:-1.3);target=Math.min(target,approaching?4.2:7);car.indicator=-1;car.stopReason=approaching?'emergency':'courtesy';}
   for(const player of players){
    const dx=player.x-car.x,dz=player.z-car.z,rvx=(player.vx||0)-car.vx,rvz=(player.vz||0)-car.vz,relativeSpeed=Math.hypot(rvx,rvz),range=Math.hypot(dx,dz),ttc=relativeSpeed>1?-(dx*rvx+dz*rvz)/(relativeSpeed*relativeSpeed):-1;
    if(ttc>0&&ttc<1.8&&range<35&&Math.hypot(dx+rvx*ttc,dz+rvz*ttc)<3.5&&relativeSpeed>5){target=Math.min(target,ttc<.9?0:car.speed*.45);car.stopReason='crossing';}

   }
   const nearbyPlayers=players,seenPlayers=new Set();
   for(const p of nearbyPlayers){
    const id=String(p.playerId??p.id??'local').slice(0,80);if(seenPlayers.has(id))continue;seenPlayers.add(id);let pass=car.closePasses.get(id);if(!pass){pass={approaching:false,contact:false,cooldown:0,lastX:p.x,lastZ:p.z,lastSeen:time};car.closePasses.set(id,pass);}
    const dx=p.x-car.x,dz=p.z-car.z,rvx=(p.vx||0)-car.vx,rvz=(p.vz||0)-car.vz,relativeSpeed=Math.hypot(rvx,rvz),range=Math.hypot(dx,dz),dot=dx*rvx+dz*rvz,playerSpeed=p.speed??Math.hypot(p.vx||0,p.vz||0),jumped=Math.hypot(p.x-pass.lastX,p.z-pass.lastZ)>Math.max(4,playerSpeed*.05);pass.lastX=p.x;pass.lastZ=p.z;pass.lastSeen=time;
    const resetPass=()=>{pass.approaching=false;pass.contact=false;pass.closestRange=Infinity;pass.clearance=Infinity;};
    if(range>14||relativeSpeed<8||jumped){resetPass();continue;}
    if(dot<0&&!pass.approaching){resetPass();pass.approaching=true;}
    if(!pass.approaching)continue;
    if(capsuleContact(p,car.collider,{width:p.width??2,length:p.length??4.5}))pass.contact=true;
    const extent=(w,l,h,nx,nz)=>Math.abs(nx*Math.cos(h)-nz*Math.sin(h))*w*.5+Math.abs(nx*Math.sin(h)+nz*Math.cos(h))*l*.5;
    if(range<pass.closestRange){const nx=dx/Math.max(.01,range),nz=dz/Math.max(.01,range);pass.closestRange=range;pass.clearance=range-extent(car.width,car.length,car.heading,nx,nz)-extent(p.width??2,p.length??4.5,p.heading||0,nx,nz);pass.relativeSpeed=relativeSpeed;pass.speed=playerSpeed;}
    const nx=rvx/relativeSpeed,nz=rvz/relativeSpeed,clearDistance=extent(car.width,car.length,car.heading,nx,nz)+extent(p.width??2,p.length??4.5,p.heading||0,nx,nz)+.5;
    if(dot/relativeSpeed>=clearDistance){
     if(!pass.contact&&time>=pass.cooldown&&pass.closestRange<5.7&&pass.clearance>.12&&pass.clearance<2.25&&pass.relativeSpeed>11&&pass.speed>12){pass.cooldown=time+5;car.nearMissCooldown=5;car.nearMisses++;stats.nearMisses++;events.push({type:'nearMiss',npcId:car.id,playerId:id,x:car.x,z:car.z,distance:pass.closestRange,clearance:pass.clearance,relativeSpeed:pass.relativeSpeed,speed:pass.speed,intensity:clamp((pass.relativeSpeed-9)/30,.1,1),completed:true});if(events.length>16)events.shift();if(car.hornCooldown===0){car.horn=.18;car.hornCooldown=5;stats.horns++;}}
     resetPass();
    }
   }
   for(const[id,pass]of car.closePasses)if(time-pass.lastSeen>8)car.closePasses.delete(id);
   if(swerve!==0){const probe=guide.lookAhead(car,Math.max(6,car.speed*.6),canEnter),px=probe.x+probe.dz*swerve,pz=probe.z-probe.dx*swerve;if(!city.getRoadInfo(px,pz).onRoad||snapshot.some(other=>other.id!==car.id&&Math.hypot(other.x-px,other.z-pz)<3.4))swerve=0;}
   car.swerve+=(swerve-car.swerve)*(1-Math.exp(-dt*1.8));if(car.hitHold>0){target=Math.min(target,.5);car.stopReason='impact';}
   const look=guide.lookAhead(car,Math.max(5,car.speed*.65),canEnter);look.x+=look.dz*car.swerve;look.z-=look.dx*car.swerve;look.speed=target;integrateAgent(car,look,dt,city);
   const hit=resolveVehicleContacts(car,city.getColliders(car,7),agentBuild(car),{dt,previousPosition:{x:car.previousX,z:car.previousZ,heading:car.previousHeading},restitution:.08,friction:.35});if(hit.collided&&hit.maxClosingSpeed>1){car.hitHold=.35;car.horn=Math.max(car.horn,.15);}syncAgent(car);
   car.distance=guide.project(car.path,car.x,car.z);
   if(path.type==='road'&&car.distance>=path.length-.2&&canEnter){reservations.set(car.toId,car.id);car.path=guide.junction(car);car.distance=guide.project(car.path,car.x,car.z);car.enteredSignal=city.getSignal(car.toId,path.axis,time);car.entries++;stats.entries++;if(Math.abs(car.path.turn)>.1){car.turns++;stats.turns++;}}
   else if(path.type==='junction'&&(car.distance>=path.length-.3||(car.x-path.end.x)*path.dx+(car.z-path.end.z)*path.dz>.1)){if(reservations.get(path.nodeId)===car.id)reservations.delete(path.nodeId);car.fromId=path.toId;car.toId=path.nextId;car.path=guide.leg(car.fromId,car.toId);car.distance=guide.project(car.path,car.x,car.z);car.nextId=guide.nextNode(car);car.indicator=0;}
   if(car.speed<.4&&car.stopReason==='red')stats.redStops++;if(playerBlocking&&car.speed<1){car.blockedTime+=dt;stats.playerStops++;if(car.blockedTime>2.4&&car.hornCooldown<=0){car.horn=.4;car.hornCooldown=7;stats.horns++;}}else car.blockedTime=0;
  }
  for(let i=0;i<states.length;i++)for(let j=i+1;j<states.length;j++){const a=states[i],b=states[j];if(Math.hypot(a.x-b.x,a.z-b.z)>(a.length+b.length)*.6)continue;const hit=resolveVehicleContacts(a,[b.collider],agentBuild(a),{dt,restitution:.1,friction:.25});if(hit.collided){a.hitHold=Math.max(a.hitHold,.2);b.hitHold=Math.max(b.hitHold,.2);syncAgent(a);syncAgent(b);}}
  recycleClock+=dt;if(recycleClock>1&&player&&Math.abs(player.x)<750&&Math.abs(player.z)<750){recycleClock=0;const far=states.find(c=>Math.hypot(c.x-player.x,c.z-player.z)>620&&c.path.type==='road');if(far){const edge=graph.edges.find(e=>{const p=guide.sample(guide.leg(e.from,e.to),55),d=Math.hypot(p.x-player.x,p.z-player.z);return d>220&&d<360&&!states.some(c=>c!==far&&Math.hypot(c.x-p.x,c.z-p.z)<22);});if(edge){place(far,edge.from,edge.to,55,7);stats.recycled++;}}}
 }
 function getColliders(player,radius=42){const x=player?.x??0,z=player?.z??0;return states.filter(c=>c.visible!==false&&Math.abs(c.x-x)<radius&&Math.abs(c.z-z)<radius).map(c=>{syncAgent(c);return c.collider;});}
 function onPlayerContact(contact){const car=states.find(c=>c.id===(contact?.collider?.npcId??contact?.npcId));if(!car)return;car.hitHold=Math.max(car.hitHold,.5+Math.min(1.2,(contact.closingSpeed||0)*.025));car.brake=true;car.horn=Math.max(car.horn,.25);stats.contacts++;syncAgent(car);}
 function getNearbyAudio(player){if(!player)return[];const cs=Math.cos(player.heading||0),sn=Math.sin(player.heading||0);return states.filter(c=>c.visible!==false).map(c=>{const dx=c.x-player.x,dz=c.z-player.z,distance=Math.hypot(dx,dz);return{id:c.id,engineId:['i4','i4','v6','v8'][c.style]||'i4',x:c.x,z:c.z,vx:c.vx,vz:c.vz,heading:c.heading,engineRunning:true,distance,pan:clamp((dx*cs-dz*sn)/Math.max(8,distance),-1,1),speed:c.speed,rpm:c.rpm,throttle:c.throttle,horn:c.horn>0,braking:!!c.brake,style:c.style,temperament:c.temperament};}).filter(c=>c.distance<125).sort((a,b)=>a.distance-b.distance);}
 function captureSnapshot(){return{version:1,time,cars:states.map(captureAgent)};}
 function applySnapshot(value){if(disposed||value?.version!==1||!Number.isFinite(value.time)||value.time<0||value.time>1e9||!Array.isArray(value.cars)||value.cars.length>40||!value.cars.every(validAgent)||new Set(value.cars.map(c=>c.id)).size!==value.cars.length||value.cars.some(c=>!states.some(s=>s.id===c.id)))return false;replica=true;snapshotAge=0;time=value.time;city.setTrafficTime(time);const rows=new Map(value.cars.map(c=>[c.id,c]));for(const car of states){const row=rows.get(car.id);if(row){applyAgent(car,row);syncAgent(car);}else car.visible=false;}return true;}
 function advanceSnapshot(dt){if(replica)snapshotAge=Math.min(.15,snapshotAge+Math.max(0,Number(dt)||0));}
 function render(alpha=1){renderer.render(replica?Math.min(1,snapshotAge/.1):alpha,time);}function reset(){initialize();render(1);city.update();}function dispose(){if(disposed)return;disposed=true;renderer.dispose();reservations.clear();events.length=0;}
 reset();return{root,states,update,render,reset,dispose,captureSnapshot,applySnapshot,advanceSnapshot,consumeEvents(){return events.splice(0);},getColliders,onPlayerContact,getNearbyAudio,setNight:renderer.setNight,get time(){return time;},reservations,guide,laneLeg:guide.leg,junctionFor:guide.junction,place(car,...args){place(car,...args);render(1);},diagnostics(){return{cars:states.length,time,...stats,stopped:states.filter(c=>c.speed<.4).length,intersectionsOccupied:reservations.size,yielding:states.filter(c=>c.yielding).length,temperaments:[...new Set(states.map(c=>c.temperament))],dynamic:true,replica};}};
}
