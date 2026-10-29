import * as THREE from './vendor/three.module.js';

/** Reusable architectural modules, spatially batched. Street-level detail fades
 * out independently of the skyline so the enlarged county stays navigable. */
export function createArchitecture({root,ground,nearest,inside,landField,colliders,mapBuildings,services=[]}){
 const batches=new Map(),dummy=new THREE.Object3D(),groups=[],lights=[],stats={buildings:0,palms:0,streetProps:0,landmarks:0,bridges:0,modules:0};
 const mat=(color,extra={})=>new THREE.MeshStandardMaterial({color,roughness:.85,flatShading:true,...extra});
 const M={cream:mat(0xe1cfa7),pink:mat(0xd499a5),mint:mat(0x80b6a9),blue:mat(0x708d9f),brick:mat(0xa16b55),ochre:mat(0xbda078),white:mat(0xe4e3d5),dark:mat(0x27323b),roof:mat(0x70604c),glass:mat(0x456e7a,{roughness:.28,metalness:.22}),gold:mat(0xdcbf73),leaf:mat(0x4d8057),bark:mat(0x7e6b50),red:mat(0xc75b51),sea:mat(0x63a8b5),lamp:mat(0xf1ddb6,{emissive:0xffd68b,emissiveIntensity:.3}),sign:mat(0x76dfca,{emissive:0x285c51,emissiveIntensity:.3})};
 const boxGeo=new THREE.BoxGeometry(1,1,1),poleGeo=new THREE.CylinderGeometry(.5,.6,1,6),crownGeo=new THREE.IcosahedronGeometry(1,0),domeGeo=new THREE.SphereGeometry(1,16,8,0,Math.PI*2,0,Math.PI/2);
 const roofGeo=new THREE.BufferGeometry(),p=[];const a=[-.5,0,-.5],b=[.5,0,-.5],c=[0,1,-.5],d=[-.5,0,.5],e=[.5,0,.5],f=[0,1,.5];for(const v of[a,c,b,d,e,f,a,d,f,a,f,c,b,c,f,b,f,e])p.push(...v);roofGeo.setAttribute('position',new THREE.Float32BufferAttribute(p,3));roofGeo.computeVertexNormals();
 function instance(g,material,x,y,z,sx,sy,sz,heading=0,detail=false,rz=0,pitch=0){const chunk=Math.floor(x/384)+','+Math.floor(z/384),key=g.id+':'+material.id+':'+chunk+':'+detail;let batch=batches.get(key);if(!batch)batches.set(key,batch={g,material,chunk,detail,x:Math.floor(x/384)*384+192,z:Math.floor(z/384)*384+192,matrices:[]});dummy.position.set(x,y,z);dummy.rotation.set(pitch,heading,rz,'YXZ');dummy.scale.set(sx,sy,sz);dummy.updateMatrix();batch.matrices.push(dummy.matrix.clone());stats.modules++;}
 const box=(m,x,y,z,w,h,d,angle=0,detail=false)=>instance(boxGeo,M[m]||m,x,y,z,w,h,d,angle,detail);
 function clear(x,z,r=3){const n=nearest(x,z);return !inside(x,z)&&!services.some(s=>Math.hypot(s.x-x,s.z-z)<s.radius+r+3)&&landField(x,z)>.025&&(!n||n.distance>n.segment.width/2+r);}
 function palm(x,z,h=12){if(!clear(x,z,3))return;const y=ground(x,z);instance(poleGeo,M.bark,x,y+h/2,z,.6,h,.6);for(let i=0;i<7;i++){const angle=i*Math.PI*2/7;instance(roofGeo,M.leaf,x+Math.sin(angle)*2,y+h,z+Math.cos(angle)*2,1.3,.45,7,angle);}stats.palms++;}
 function building(lot){
  const {x,z,w=24,d=31,heading=0,style='suburb',seed=0}=lot;if(!clear(x,z,Math.hypot(w,d)/2+2))return false;
  const cs=Math.cos(heading),sn=Math.sin(heading),at=(u,v)=>({x:x+cs*u+sn*v,z:z-sn*u+cs*v});
  const heights=[[-w/2,-d/2],[w/2,-d/2],[-w/2,d/2],[w/2,d/2]].map(([u,v])=>{const p=at(u,v);return ground(p.x,p.z);}),lo=Math.min(...heights),y=Math.max(...heights)+.08;if(y-lo>10||lo<-.5)return false;
  const v=Math.abs(seed)%11,colour=style==='brick'?'brick':style==='industrial'?'blue':['cream','pink','mint','ochre','white'][v%5];
  const h=style==='deco'?12+v*3.6:style==='brick'?12+(v%5)*4:style==='industrial'?9+v:style==='resort'?8+(v%4)*3:6+(v%3)*2.5;
  function part(m,u,yy,vv,ww,hh,dd,detail=false){const p=at(u,vv);box(m,p.x,y+yy,p.z,ww,hh,dd,heading,detail);}
  part('roof',0,(lo-y)/2,0,w+.4,y-lo+.2,d+.4);
  if(style==='deco'){
   part(colour,0,h*.40,0,w,h*.8,d);part(colour,-w*.08,h*.86,-d*.1,w*.76,h*.32,d*.72);part('cream',-w*.08,h*1.04,-d*.1,w*.80,.7,d*.75);
   for(let yy=4;yy<h*.8;yy+=3.5){part('white',0,yy,d/2+.25,w+.4,.35,.8,true);part('glass',0,yy+1.3,d/2+.04,w*.78,1.5,.1,true);}
   for(const u of[-w*.42,w*.42])part('cream',u,h*.48,d*.51,1,h*.88,.65,true);
   part('sign',0,4,d*.54,w*.8,1,1,true);part('pink',0,3.1,d*.57,w*.9,.4,3,true);
  }else if(style==='brick'){
   part('brick',0,h/2,0,w,h,d);part('cream',0,h+.35,0,w+1,.7,d+1);for(let yy=3;yy<h;yy+=4)for(const u of[-w*.29,w*.29]){part('glass',u,yy+1,d/2+.04,w*.21,2,.1,true);part('cream',u,yy-.15,d/2+.2,w*.25,.3,.55,true);}part('dark',0,2,d/2+.05,3,4,.15,true);
   part('dark',-w*.36,h*.5,-d/2-.7,.45,h,.45,true);for(let yy=4;yy<h;yy+=4)part('dark',-w*.32,yy,-d/2-.8,6,.22,2,true);
  }else if(style==='industrial'){
   part(colour,0,h/2,0,w,h,d);for(let i=0;i<3;i++){const p=at(-w/3+i*w/3,0);instance(roofGeo,M.roof,p.x,y+h,p.z,w/3,2.5,d,heading);}part('dark',0,2.3,d/2+.05,w*.65,4.6,.12,true);for(let yy=.8;yy<4.5;yy+=.65)part('blue',0,yy,d/2+.13,w*.63,.08,.08,true);part('gold',0,h-1,d/2+.12,w*.8,1.5,.2,true);
  }else if(style==='resort'){
   part(colour,-w*.18,h/2,0,w*.62,h,d);part('white',w*.25,h*.38,-d*.18,w*.50,h*.76,d*.64);for(let yy=3;yy<h;yy+=3){part('cream',-w*.18,yy,d/2+1.2,w*.69,.2,3,true);part('glass',-w*.18,yy+1.2,d/2+.04,w*.42,2,.08,true);part('white',-w*.18,yy+.8,d/2+2.6,w*.69,.12,.14,true);}const p=at(w*.25,d*.30);box('sea',p.x,y+.12,p.z,w*.40,.2,d*.24,heading);palm(x+w*.8,z+d*.5,10);
  }else{
   part(colour,0,h/2,0,w,h,d*.78);const p=at(0,0);instance(roofGeo,M.roof,p.x,y+h,p.z,w+2,3,d*.82,heading);part('white',0,2,d*.44,w*.74,.25,4,true);for(const u of[-w*.32,w*.32])part('white',u,1,d*.48,.35,2,.35,true);part('dark',0,1.5,d*.4,2.2,3,.14,true);for(const u of[-w*.30,w*.30])part('glass',u,h*.62,d*.40,3,2,.1,true);
  }
  // Side windows and rooftop equipment give the pieces a readable depth.
  for(const side of[-1,1])for(let yy=3;yy<h-1;yy+=4)part('glass',side*(w/2+.025),yy,-d*.05,.08,1.7,d*.60,true);
  part('dark',-w*.23,h+1.1,-d*.26,w*.22,1.6,d*.18,true);
  colliders.push({x,z,hx:w/2,hz:d/2,heading,kind:'building',material:'concrete',height:h+y-lo});mapBuildings.push({x,z,width:w,depth:d,height:h,heading});stats.buildings++;return true;
 }
 function street(x,z,heading,style='urban'){
  if(!clear(x,z,2))return;const y=ground(x,z);stats.streetProps++;instance(poleGeo,M.dark,x,y+4.2,z,.16,8.4,.16,heading,true);lights.push({x:x+Math.cos(heading)*1.3,y:y+8.35,z:z-Math.sin(heading)*1.3});box('lamp',x+Math.cos(heading)*1.3,y+8.35,z-Math.sin(heading)*1.3,2.8,.15,.65,heading,true);
  if(stats.streetProps%4===0){box('dark',x+1.5,y+.65,z+1.5,.8,1.3,.8,0,true);box('gold',x-1.1,y+2.4,z-1.1,.8,.6,.1,heading,true);}if(style==='deco'||style==='resort')palm(x+8*Math.sin(heading),z+8*Math.cos(heading),10+(stats.streetProps%5));
 }
 function landmark(item){const {x,z,kind}=item;if(!clear(x,z,24))return;const y=ground(x,z);stats.landmarks++;
  if(kind==='lighthouse'){instance(poleGeo,M.white,x,y+16,z,8,32,8);instance(poleGeo,M.red,x,y+28,z,8.4,2,8.4);instance(poleGeo,M.dark,x,y+34,z,11,2,11);instance(poleGeo,M.glass,x,y+37,z,8,5,8);instance(domeGeo,M.roof,x,y+40,z,7,4,7);colliders.push({x,z,hx:5,hz:5,kind:'lighthouse',material:'concrete'});}
  if(kind==='observatory'){box('cream',x,y+7,z,45,14,34);instance(domeGeo,M.white,x,y+14,z,18,18,18);box('glass',x,y+10,z+17.1,30,3,.1);colliders.push({x,z,hx:23,hz:17,kind:'observatory',material:'concrete'});}
  if(kind==='stadium'){for(const side of[-1,1]){box('cream',x+side*70,y+12,z,22,24,120);box('red',x+side*70,y+25,z,30,2,130);box('cream',x,y+10,z+side*67,118,20,18);}box('leaf',x,y+.04,z,110,.08,110);for(const sx of[-1,1])for(const sz of[-1,1]){instance(poleGeo,M.dark,x+sx*90,y+25,z+sz*90,1.2,50,1.2);box('white',x+sx*90,y+50,z+sz*90,12,4,1);}for(const side of[-1,1]){colliders.push({x:x+side*70,z,hx:11,hz:60,kind:'stadium',material:'concrete'},{x,z:z+side*67,hx:59,hz:9,kind:'stadium',material:'concrete'});}}
  if(kind==='port'){for(let i=0;i<9;i++)for(let j=0;j<5;j++){const xx=x+i*15,zz=z+j*10;if(clear(xx,zz,8)){box(['red','blue','ochre'][i%3],xx,y+3+(j%2)*2.7,zz,12,6+(j%2)*5.4,5);colliders.push({x:xx,z:zz,hx:6,hz:2.5,kind:'container',material:'metal'});}}for(let i=0;i<3;i++){const xx=x+i*65;box('gold',xx,y+25,z-30,3,50,4);box('gold',xx,y+50,z-5,3,3,65);box('dark',xx,y+36,z+20,.2,24,.2);}}
  if(kind==='pier'){for(let i=0;i<12;i++){box('roof',x+i*12,y+.2,z,12,1,14);for(const side of[-1,1])instance(poleGeo,M.dark,x+i*12,y-3,z+side*5,.6,7,.6);}box('pink',x+135,y+4,z,20,8,15);}
 }
 function bridge(road){
  stats.bridges++;const pts=road.points,w=road.width;
  function rail(a,b,offset,thickness,height,lift,material='cream',collision=false){const dx=b.x-a.x,dz=b.z-a.z,len=Math.hypot(dx,dz),angle=Math.atan2(dx,dz),x=(a.x+b.x)/2+dz/len*offset,z=(a.z+b.z)/2-dx/len*offset,y=(a.y+b.y)/2+lift;instance(boxGeo,M[material],x,y,z,thickness,height,len+.05,angle,false,0,-Math.atan2(b.y-a.y,len));if(collision)colliders.push({x,z,hx:thickness/2,hz:len/2,heading:angle,kind:'bridge-rail',material:'concrete'});}
  for(let i=1;i<pts.length;i++){const a=pts[i-1],b=pts[i];rail(a,b,0,w+1,1.3,-.67,'dark');if(i>7&&i<pts.length-7)for(const side of[-1,1])rail(a,b,side*(w/2+.65),.45,1.1,.55,'cream',true);if(i%12===0){const dx=b.x-a.x,dz=b.z-a.z,len=Math.hypot(dx,dz);for(const side of[-1,1]){const x=b.x+dz/len*side*(w/2-3),z=b.z-dx/len*side*(w/2-3),bottom=-18;instance(poleGeo,M.cream,x,(b.y+bottom)/2,z,2.8,b.y-bottom,2.8);}}}
  if(road.bridge.style==='suspension')for(const t of[.25,.75]){const i=Math.floor(t*(pts.length-1)),p=pts[i],q=pts[i+1],angle=Math.atan2(q.x-p.x,q.z-p.z),cs=Math.cos(angle),sn=Math.sin(angle);for(const side of[-1,1]){const x=p.x+cs*side*(w/2+3),z=p.z-sn*side*(w/2+3);box('red',x,p.y+26,z,2.2,52,3.5,angle);colliders.push({x,z,hx:1.1,hz:1.75,heading:angle,kind:'bridge-tower',material:'metal'});for(const direction of[-1,1])for(let j=1;j<=6;j++){const k=Math.max(0,Math.min(pts.length-1,i+direction*j*7)),b=pts[k],start=new THREE.Vector3(x,p.y+50,z),end=new THREE.Vector3(b.x+cs*side*(w/2+.8),b.y+1,b.z-sn*side*(w/2+.8)),delta=end.clone().sub(start),length=delta.length(),g=new THREE.CylinderGeometry(.08,.08,length,4);g.applyMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),delta.normalize())));g.translate(...start.add(end).multiplyScalar(.5).toArray());const m=new THREE.Mesh(g,M.cream);root.add(m);}}
   box('red',p.x,p.y+49,p.z,w+9,3,3.5,angle);
  }
 }
 function finish(){for(const b of batches.values()){const mesh=new THREE.InstancedMesh(b.g,b.material,b.matrices.length);b.matrices.forEach((m,i)=>mesh.setMatrixAt(i,m));mesh.computeBoundingSphere();mesh.castShadow=!b.detail;mesh.receiveShadow=true;mesh.name=b.detail?'county-detail':'county-architecture';root.add(mesh);groups.push({mesh,...b});}batches.clear();return stats;}
 function update(player){if(!Number.isFinite(player?.x))return;for(const g of groups)if(g.detail)g.mesh.visible=Math.abs(g.x-player.x)<1050&&Math.abs(g.z-player.z)<1050;}
 return{building,palm,street,landmark,bridge,finish,update,stats,lights,setNight(n){M.glass.emissive.setHex(0xf3c990);M.glass.emissiveIntensity=.04+n*.55;M.lamp.emissiveIntensity=.3+n*3;M.sign.emissiveIntensity=.3+n;}};
}
