import {countyHeight,landField,ISLANDS,coastRadius,expandCounty} from './county-layout.js';
import {createArchitecture} from './county-architecture.js';
import {splitCrossings} from './county-junctions.js';
import * as THREE from './vendor/three.module.js';
import {createCity as createDowntown} from './city.js';
import {pathLength} from './city-shape.js';

const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
const smooth=v=>{v=clamp(v);return v*v*(3-2*v);};
const CORE=768,STEP=24;
export const REGION_BOUNDS={minX:-5592,maxX:5592,minZ:-4608,maxZ:4608};
const inside=(x,z)=>Math.abs(x)<CORE&&Math.abs(z)<CORE;

/** Authored county roads share one graph, surface sampler and rendered ribbons.
 * The compact city is one district, rather than a warp applied to the whole map. */
export function createCity(scene){
 const city=createDowntown(scene,{openRegion:true}),root=city.root;
 const original={surface:city.getSurfaceAt,road:city.getRoadInfo,reset:city.getResetPose,signal:city.getSignal,district:city.getDistrict,colliders:city.getColliders,acoustics:city.sampleAcoustics,update:city.update,night:city.setNight};
 const graph=city.network,roads=[],segments=[],roundabouts=[],extraColliders=[],buckets=new Map(),surfaceMeshes=[];
 const bounds={...REGION_BOUNDS};
 const terrainBase=countyHeight,height=countyHeight,nodeIndex=new Map(graph.nodes.map(n=>[Math.round(n.x*10)+','+Math.round(n.z*10),n]));
 function node(x,z,name){const ix=Math.round(x*10),iz=Math.round(z*10),key=ix+','+iz;for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++){const existing=nodeIndex.get((ix+dx)+','+(iz+dz));if(existing&&Math.hypot(existing.x-x,existing.z-z)<.1)return existing;}const n={id:graph.nodes.length,x,z,name,neighbors:[],signalOffset:0,regional:true};graph.nodes.push(n);graph.nodeById.set(n.id,n);nodeIndex.set(key,n);return n;}
 function addRoad(a,b,controls=[],kind='country',name='COUNTY ROAD',width=16,oneWay=false){
  const input=[a,...controls.map(p=>({x:p[0],z:p[1]})),b],curve=new THREE.CatmullRomCurve3(input.map(p=>new THREE.Vector3(p.x,0,p.z)),false,'centripetal');
  const length=curve.getLength(),points=curve.getSpacedPoints(Math.max(2,Math.ceil(length/7))).map(p=>({x:p.x,z:p.z,y:height(p.x,p.z)}));
  const road={a,b,from:a.id,to:b.id,points,width,kind,name,oneWay};roads.push(road);
  return road;
 }
 function circle(x,z,name){
  const radius=48,ports=[];for(let i=0;i<8;i++){const a=-i*Math.PI/4;ports.push(node(x+Math.sin(a)*radius,z+Math.cos(a)*radius,name));}
  for(let i=0;i<8;i++){const a=-(i+.5)*Math.PI/4;const road=addRoad(ports[i],ports[(i+1)%8],[[x+Math.sin(a)*radius,z+Math.cos(a)*radius]],'roundabout',name,20,true);road.center={x,z};}
  const r={x,z,radius,name,ports};roundabouts.push(r);return {south:ports[0],west:ports[2],north:ports[4],east:ports[6]};
 }
 const west=circle(-1050,0,'PALM CIRCLE'),east=circle(1050,0,'EASTGATE CIRCLE'),south=circle(0,1050,'COAST CIRCLE');
 addRoad(node(-720,0),west.east,[],'avenue','PALM AVENUE',22);
 addRoad(node(720,0),east.west,[],'avenue','EASTGATE AVENUE',22);
 addRoad(node(0,720),south.north,[],'avenue','COAST BOULEVARD',22);
 const hw=node(-1900,0,'WEST INTERCHANGE'),hnw=node(-1700,-1100,'ORCHARD INTERCHANGE'),hn=node(0,-1300,'CANYON INTERCHANGE'),hne=node(1700,-1100,'EAST INTERCHANGE'),he=node(1900,0,'EASTPORT INTERCHANGE'),hse=node(1700,1450,'DOCK INTERCHANGE'),hs=node(0,1800,'COAST INTERCHANGE'),hsw=node(-1700,1450,'SUNSET INTERCHANGE');
 const highway=(a,b,c)=>addRoad(a,b,c,'highway','COUNTY EXPRESSWAY 01',30);
 highway(hw,hnw,[[-1950,-550]]);highway(hnw,hn,[[-1000,-1350]]);highway(hn,hne,[[1000,-1350]]);highway(hne,he,[[1950,-550]]);highway(he,hse,[[2000,750]]);highway(hse,hs,[[900,1790]]);highway(hs,hsw,[[-900,1790]]);highway(hsw,hw,[[-2000,750]]);
 addRoad(west.west,hw,[],'avenue','WESTGATE ACCESS',22);addRoad(east.east,he,[],'avenue','EASTPORT ACCESS',22);
 addRoad(south.south,hs,[[120,1450]],'avenue','OCEAN DRIVE',22);
 addRoad(node(0,-720),hn,[[0,-1000]],'avenue','CANYON BOULEVARD',22);
 const orchard=node(-1350,-700,'ORCHARD VILLAGE'),ranch=node(-1450,800,'SUNSET RANCH'),port=node(1350,800,'HARBOR YARD'),lake=node(1350,-700,'RESERVOIR GATE');
 addRoad(west.north,orchard,[[-1180,-330]],'country','ORCHARD ROAD');addRoad(orchard,hnw,[[-1460,-950]],'country','ORCHARD ROAD');
 addRoad(west.south,ranch,[[-1250,380]],'country','SUNSET FARM ROAD');addRoad(ranch,hsw,[[-1600,1150]],'country','SUNSET FARM ROAD');
 addRoad(ranch,south.west,[[-1100,1250],[-600,1350]],'country','PALM COAST ROAD');
 addRoad(east.south,port,[[1170,350]],'avenue','HARBOR ROAD',22);addRoad(port,hse,[[1530,1130]],'avenue','DOCK ACCESS',22);addRoad(port,south.east,[[900,1250],[480,1300]],'avenue','MARINA DRIVE',22);
 addRoad(east.north,lake,[[1180,-350]],'country','RESERVOIR ROAD');addRoad(lake,hne,[[1450,-980]],'country','RESERVOIR ROAD');
 const villa=node(-1200,-2090,'SUNSET ESTATES'),summit=node(0,-2680,'SKYLINE OBSERVATORY'),lookout=node(1050,-2100,'RIDGE LOOKOUT');
 addRoad(hnw,villa,[[-1800,-1440],[-1500,-1570],[-1770,-1760],[-1450,-1920]],'hills','SUNSET SWITCHBACKS',15);
 addRoad(villa,summit,[[-1100,-2400],[-650,-2560]],'hills','SKYLINE CREST',16);
 addRoad(summit,lookout,[[600,-2650],[900,-2390]],'hills','SKYLINE CREST',16);
 addRoad(lookout,hne,[[1460,-1980],[1250,-1720],[1600,-1550]],'hills','RIDGE DESCENT',15);
 addRoad(hn,summit,[[-200,-1580],[300,-1820],[-140,-2100],[230,-2370]],'hills','OBSERVATORY CLIMB',16);

 const layout=expandCounty({node,addRoad,anchors:{west:hw,east:he,south:hs,north:hn,summit,lookout,westSouth:west.south,westNorth:west.north,southWest:south.west,southEast:south.east,eastSouth:east.south}});
 for(const r of roads.filter(r=>r.bridge)){const length=pathLength(r.points);for(let i=0;i<r.points.length;i++){const t=i/(r.points.length-1),flat=smooth((t*length-40)/Math.max(1,length-80));r.points[i].y=height(r.a.x,r.a.z)*(1-flat)+height(r.b.x,r.b.z)*flat+r.bridge.deck*Math.sin(Math.PI*flat)**2;}}
 const joined=splitCrossings(roads,node);roads.splice(0,roads.length,...joined);
 for(const road of roads){const {a,b,points,width,kind,name,oneWay}=road;
  function edge(from,to,p){const d={x:p[1].x-p[0].x,z:p[1].z-p[0].z},l=Math.hypot(d.x,d.z);from.neighbors.push(to.id);graph.edges.push({id:from.id+'>'+to.id,from:from.id,to:to.id,points:p,length:pathLength(p),width,kind,name,dx:d.x/l,dz:d.z/l,axis:Math.abs(d.x)>Math.abs(d.z)?'x':'z'});}
  edge(a,b,points);if(!oneWay)edge(b,a,[...points].reverse());
  for(let i=1;i<points.length;i++){
   const a=points[i-1],b=points[i],dx=b.x-a.x,dz=b.z-a.z,len=Math.hypot(dx,dz),seg={a,b,dx,dz,len,width,road};segments.push(seg);
   const margin=width/2+70;for(let ix=Math.floor((Math.min(a.x,b.x)-margin)/128);ix<=Math.floor((Math.max(a.x,b.x)+margin)/128);ix++)for(let iz=Math.floor((Math.min(a.z,b.z)-margin)/128);iz<=Math.floor((Math.max(a.z,b.z)+margin)/128);iz++){const key=ix+','+iz;if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(seg);}
  }

 }

 function nearest(x,z,global=false){let best=null,score=Infinity;const list=global?segments:buckets.get(Math.floor(x/128)+','+Math.floor(z/128))||[];for(const s of list){const t=clamp(((x-s.a.x)*s.dx+(z-s.a.z)*s.dz)/(s.len*s.len)),px=s.a.x+s.dx*t,pz=s.a.z+s.dz*t,d=Math.hypot(px-x,pz-z),edgeDistance=d-s.width/2;if(edgeDistance<score){score=edgeDistance;best={segment:s,t,x:px,z:pz,distance:d,height:s.a.y+(s.b.y-s.a.y)*t};}}return best;}
 function bed(x,z){const base=terrainBase(x,z),n=nearest(x,z);if(!n)return base;if(n.segment.road.bridge)return base;const blend=smooth((n.distance-n.segment.width/2-32)/64);const clearance=.2+Math.min(1.8,Math.abs(height(x+12,z)-height(x-12,z))+Math.abs(height(x,z+12)-height(x,z-12)));return base-clearance*(1-blend);}
 const nx=(bounds.maxX-bounds.minX)/STEP,nz=(bounds.maxZ-bounds.minZ)/STEP,grid=new Float32Array((nx+1)*(nz+1));
 for(let iz=0;iz<=nz;iz++)for(let ix=0;ix<=nx;ix++){const x=bounds.minX+ix*STEP,z=bounds.minZ+iz*STEP;grid[iz*(nx+1)+ix]=inside(x,z)?-.06:bed(x,z);}
 function ground(x,z){const gx=clamp((x-bounds.minX)/STEP,0,nx-.00001),gz=clamp((z-bounds.minZ)/STEP,0,nz-.00001),ix=Math.floor(gx),iz=Math.floor(gz),u=gx-ix,v=gz-iz,i=iz*(nx+1)+ix,a=grid[i],b=grid[i+1],c=grid[i+nx+1],d=grid[i+nx+2];return u>=v?a+(b-a)*u+(d-b)*v:a+(d-c)*u+(c-a)*v;}
 const material=(color,extra={})=>new THREE.MeshStandardMaterial({color,roughness:.95,flatShading:true,...extra});
 const terrainMaterial=material(0xffffff,{vertexColors:true});
 const grass=material(0x66765a),asphalt=material(0x303b43),shoulder=material(0x9b9077),white=new THREE.MeshBasicMaterial({color:0xe4dfbe}),yellow=new THREE.MeshBasicMaterial({color:0xd6bb63});
 function mesh(positions,mat,name){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.computeVertexNormals();if(name==='county-terrain'){const colors=[],sand=new THREE.Color(0xc4b38b),green=new THREE.Color(0x66765a),west=new THREE.Color(0x89856b),colour=new THREE.Color();for(let i=0;i<positions.length;i+=3){const x=positions[i],z=positions[i+2],t=smooth((landField(x,z)-.005)/.06);colour.copy(sand).lerp(x< -2600?west:green,t);colors.push(colour.r,colour.g,colour.b);}g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));mat=terrainMaterial;}const m=new THREE.Mesh(g,mat);m.name=name;m.receiveShadow=true;root.add(m);return m;}
 for(let cz=0;cz<nz;cz+=16)for(let cx=0;cx<nx;cx+=16){const p=[];for(let iz=cz;iz<Math.min(nz,cz+16);iz++)for(let ix=cx;ix<Math.min(nx,cx+16);ix++){const x=bounds.minX+ix*STEP,z=bounds.minZ+iz*STEP;if(inside(x+STEP/2,z+STEP/2))continue;const i=iz*(nx+1)+ix,a=[x,grid[i],z],b=[x+STEP,grid[i+1],z],c=[x,grid[i+nx+1],z+STEP],d=[x+STEP,grid[i+nx+2],z+STEP];for(const triangle of[[a,d,b],[a,c,d]])if(triangle.some(v=>v[1]>=-3))for(const v of triangle)p.push(...v);}if(p.length)surfaceMeshes.push(mesh(p,grass,'county-terrain'));}
 const water=[];
 function waterTriangle(triangle){const poly=[];for(let i=0;i<3;i++){const a=triangle[i],b=triangle[(i+1)%3],ai=a[1]<-3,bi=b[1]<-3;if(ai)poly.push([a[0],-3,a[2]]);if(ai!==bi){const t=(-3-a[1])/(b[1]-a[1]);poly.push([a[0]+(b[0]-a[0])*t,-3,a[2]+(b[2]-a[2])*t]);}}for(let i=1;i<poly.length-1;i++)water.push(...poly[0],...poly[i],...poly[i+1]);}
 for(let iz=0;iz<nz;iz++)for(let ix=0;ix<nx;ix++){const x=bounds.minX+ix*STEP,z=bounds.minZ+iz*STEP,i=iz*(nx+1)+ix,a=[x,grid[i],z],b=[x+STEP,grid[i+1],z],c=[x,grid[i+nx+1],z+STEP],d=[x+STEP,grid[i+nx+2],z+STEP];waterTriangle([a,d,b]);waterTriangle([a,c,d]);}
 const strips=[],shoulders=[],marks=[],centers=[];
 function ribbon(out,a,b,offset,width,lift=0){const p=(v,o)=>{const x=v.x+v.rx*o,z=v.z+v.rz*o;return[x,(v.bridge?v.y:height(x,z))+lift,z];},aa=p(a,offset-width/2),bb=p(a,offset+width/2),cc=p(b,offset-width/2),dd=p(b,offset+width/2);for(const v of[aa,dd,bb,aa,cc,dd])out.push(...v);}
 // Adjacent ribbons share their edge vertices. Per-segment normals leave wedge
 // gaps outside bends, particularly on roundabouts.
 for(const road of roads)for(let i=0;i<road.points.length;i++){const p=road.points[i];p.bridge=!!road.bridge;const a=road.points[Math.max(0,i-1)],b=road.points[Math.min(road.points.length-1,i+1)],dx=b.x-a.x,dz=b.z-a.z,l=Math.hypot(dx,dz);if(road.center){const x=p.x-road.center.x,z=p.z-road.center.z,r=Math.hypot(x,z);p.rx=x/r;p.rz=z/r;}else{p.rx=dz/l;p.rz=-dx/l;}}
 for(const road of roads){let along=0;for(let i=1;i<road.points.length;i++){const a=road.points[i-1],b=road.points[i],length=Math.hypot(b.x-a.x,b.z-a.z);for(const side of[-1,1])ribbon(shoulders,a,b,side*(road.width/2+2.5),5,-.04);ribbon(strips,a,b,0,road.width,.008);for(const side of[-1,1])ribbon(marks,a,b,side*(road.width/2-.55),.18,.025);if(road.kind==='highway'){ribbon(centers,a,b,0,1.2,.027);if(Math.floor(along/7)%2)for(const side of[-1,1])ribbon(marks,a,b,side*7.5,.16,.025);}else if(road.kind!=='roundabout'&&Math.floor(along/7)%2)ribbon(centers,a,b,0,.16,.026);along+=length;}}
 white.polygonOffset=yellow.polygonOffset=true;white.polygonOffsetFactor=yellow.polygonOffsetFactor=-2;white.polygonOffsetUnits=yellow.polygonOffsetUnits=-2;
 const roadMesh=mesh(strips,asphalt,'county-road-ribbons');surfaceMeshes.push(roadMesh);mesh(shoulders,shoulder,'county-shoulders');mesh(marks,white,'county-road-markings');mesh(centers,yellow,'county-centrelines');
 // Use the same triangles as the visible road, including overlapping bends.
 const faceCells=new Map();
 for(const [data,material]of[[strips,'asphalt'],[shoulders,'gravel']])for(let i=0;i<data.length;i+=9){const f={v:data.slice(i,i+9),material};const v=f.v;for(let x=Math.floor(Math.min(v[0],v[3],v[6])/128);x<=Math.floor(Math.max(v[0],v[3],v[6])/128);x++)for(let z=Math.floor(Math.min(v[2],v[5],v[8])/128);z<=Math.floor(Math.max(v[2],v[5],v[8])/128);z++){const k=x+','+z;if(!faceCells.has(k))faceCells.set(k,[]);faceCells.get(k).push(f);}}
 function roadSurface(x,z){let hit=null;for(const f of faceCells.get(Math.floor(x/128)+','+Math.floor(z/128))||[]){const v=f.v,ax=v[3]-v[0],az=v[5]-v[2],bx=v[6]-v[0],bz=v[8]-v[2],det=ax*bz-az*bx;if(Math.abs(det)<1e-9)continue;const u=((x-v[0])*bz-(z-v[2])*bx)/det,t=(ax*(z-v[2])-az*(x-v[0]))/det;if(u>=-1e-7&&t>=-1e-7&&u+t<=1.0000001){const y=v[1]+u*(v[4]-v[1])+t*(v[7]-v[1]);if(!hit||y>hit.height)hit={height:y,material:f.material,onRoad:f.material==='asphalt',grip:f.material==='asphalt'?1:.7,roughness:.001};}}return hit;}
 function getSurfaceAt(x,z){const hit=roadSurface(x,z);if(hit)return hit;if(inside(x,z))return original.surface(x,z);for(const r of roundabouts)if(Math.hypot(x-r.x,z-r.z)<28)return{height:height(r.x,r.z)-.02,material:'grass',grip:.6,roughness:.01,onRoad:false};return{height:ground(x,z),material:ground(x,z)<-3?'water':'grass',grip:.55,roughness:.016,onRoad:false};}
 function getRoadInfo(x,z){if(inside(x,z)){const core=original.road(x,z),n=nearest(x,z);if(core.onRoad||!n||n.distance>n.segment.width/2)return core;}const n=nearest(x,z)||nearest(x,z,true),s=n.segment;return{onRoad:n.distance<=s.width/2,grip:n.distance<=s.width/2?1:.55,distance:n.distance,nearest:{x:n.x,z:n.z},tangent:{x:s.dx/s.len,z:s.dz/s.len},axis:Math.abs(s.dx)>Math.abs(s.dz)?'x':'z',kind:s.road.kind,roadName:s.road.name,district:getDistrict(x,z),progress:0};}
 function getResetPose(x,z,heading=0){if(inside(x,z))return original.reset(x,z,heading);const n=nearest(x,z,true),s=n.segment,sign=s.road.oneWay?1:Math.sin(heading)*s.dx+Math.cos(heading)*s.dz<0?-1:1,offset=-Math.min(4.5,s.width*.24)*sign;return{x:n.x+s.dz/s.len*offset,z:n.z-s.dx/s.len*offset,heading:Math.atan2(s.dx*sign,s.dz*sign)};}
 function getDistrict(x,z){if(inside(x,z))return original.district(x,z);for(const t of layout.towns)if(Math.hypot((x-t.x)/(t.cols*80),(z-t.z)/(t.rows*80))<1)return t.name;if(x>2600)return'PALM ISLAND';if(x< -2600)return'WESTHAVEN COAST';if(z>2800)return'SUNSET KEYS';if(z< -1550)return'SKYLINE HILLS';if(z< -800)return x<0?'ORCHARD VALLEY':'RESERVOIR';if(z>1350)return'PALM COAST';if(x< -800)return'SUNSET COUNTY';if(x>800)return'HARBOR DISTRICT';return'COAST GATE';}
 const groups=new Map(),boxGeo=new THREE.BoxGeometry(1,1,1),treeGeo=new THREE.IcosahedronGeometry(1,0),dummy=new THREE.Object3D();
 const paints=[material(0xa7967d),material(0x658a89),material(0x788394),material(0xc5bea1)],dark=material(0x26333c),leaves=material(0x53795b),trunk=material(0x605246),pool=material(0x4ba6ad),glass=material(0x6c9fa5,{roughness:.25,metalness:.15});
 function instance(geometry,mat,x,y,z,sx,sy,sz,heading=0){let group=groups.get(mat);if(!group)groups.set(mat,group={geometry,matrices:[]});dummy.position.set(x,y,z);dummy.rotation.set(0,heading,0);dummy.scale.set(sx,sy,sz);dummy.updateMatrix();group.matrices.push(dummy.matrix.clone());}
 const extraMapBuildings=[];
 function building(x,z,w,d,h,heading=0,paint=0){
  if(inside(x,z))return;const n=nearest(x,z);if(n&&n.distance<n.segment.width/2+Math.hypot(w,d)/2+12)return;
  const cs=Math.cos(heading),sn=Math.sin(heading),at=(lx,lz)=>({x:x+cs*lx+sn*lz,z:z-sn*lx+cs*lz});
  const heights=[[-w/2,-d/2],[w/2,-d/2],[-w/2,d/2],[w/2,d/2]].map(([lx,lz])=>{const p=at(lx,lz);return getSurfaceAt(p.x,p.z).height;}),base=Math.min(...heights),y=Math.max(...heights)+.1;
  const part=(mat,lx,ly,lz,sx,sy,sz)=>{const p=at(lx,lz);instance(boxGeo,mat,p.x,ly,p.z,sx,sy,sz,heading);};
  part(dark,0,(base+y)/2,0,w+.5,y-base+.2,d+.5);part(paints[paint%paints.length],0,y+h/2,0,w,h,d);part(dark,0,y+h+.25,0,w+1,.5,d+1);
  for(const side of[-1,1])for(let level=2;level<h-1;level+=4)for(let lx=-w/2+4;lx<w/2-2;lx+=6)part(glass,lx,y+level,side*(d/2+.03),2.8,1.8,.09);
  part(dark,0,y+1.8,d/2+.05,2.4,3.6,.12);
  extraColliders.push({x,z,hx:w/2,hz:d/2,heading,kind:'building',material:'concrete',height:h+y-base});extraMapBuildings.push({x,z,width:w,depth:d,height:h,heading});
 }
 let seed=1309;const rnd=()=>((seed=Math.imul(seed,1664525)+1013904223)>>>0)/4294967296;
 serviceAt(orchard,'fuel','Orchard Fuel');serviceAt(port,'garage','Harbor Customs');serviceAt(villa,'garage','Sunset Motor Club');serviceAt(lookout,'fuel','Ridge Fuel');
 for(const d of layout.destinations)serviceAt(d.node,d.kind,d.name,25);
 const architecture=createArchitecture({root,ground:(x,z)=>getSurfaceAt(x,z).height,nearest,inside,landField,colliders:extraColliders,mapBuildings:extraMapBuildings,services:city.services});
 for(const lot of layout.lots)architecture.building(lot);
 for(const road of roads.filter(r=>['hills','country','avenue'].includes(r.kind)))for(let i=5;i<road.points.length-5;i+=12){const a=road.points[i],b=road.points[i+1],angle=Math.atan2(b.x-a.x,b.z-a.z);for(const side of[-1,1]){const x=a.x+Math.cos(angle)*side*35,z=a.z-Math.sin(angle)*side*35;architecture.building({x,z,w:22,d:25,heading:angle,style:road.kind==='hills'?'resort':x< -2600?'brick':'suburb',seed:i*17+road.from});}}
 for(const road of roads.filter(r=>r.kind==='urban')){const a=road.points[Math.floor(road.points.length/2)],b=road.points[Math.min(road.points.length-1,Math.floor(road.points.length/2)+1)],angle=Math.atan2(b.x-a.x,b.z-a.z),side=road.from%2?1:-1;architecture.street(a.x+Math.cos(angle)*side*(road.width/2+4),a.z-Math.sin(angle)*side*(road.width/2+4),angle,a.x>2600?'deco':a.z>2800?'resort':'urban');}
 for(const l of layout.landmarks)architecture.landmark(l);
 for(const road of roads.filter(r=>r.bridge))architecture.bridge(road);
 for(let i=0;i<8500;i++){const x=bounds.minX+rnd()*(bounds.maxX-bounds.minX),z=bounds.minZ+rnd()*(bounds.maxZ-bounds.minZ);if(inside(x,z)||landField(x,z)<.07||layout.towns.some(t=>Math.abs(x-t.x)<t.cols*80&&Math.abs(z-t.z)<t.rows*80))continue;const n=nearest(x,z);if(n&&n.distance<n.segment.width/2+12)continue;if(x>2600||z>2800){architecture.palm(x,z,9+rnd()*7);continue;}const y=getSurfaceAt(x,z).height,h=7+rnd()*13;instance(boxGeo,trunk,x,y+h*.33,z,.7,h*.65,.7);instance(treeGeo,leaves,x,y+h*.8,z,h*.28,h*.5,h*.28);}
 for(const r of roundabouts){const y=height(r.x,r.z);const island=new THREE.Mesh(new THREE.CylinderGeometry(28,28,.32,48),grass);island.position.set(r.x,y-.18,r.z);root.add(island);instance(boxGeo,dark,r.x,y+3,r.z,4,6,4);extraColliders.push({x:r.x,z:r.z,hx:2,hz:2,kind:'monument',material:'concrete'});}
 // Named destinations offer a reason to travel beyond the city grid.
 function serviceAt(n,kind,name,offset=25){const edge=roads.find(r=>r.a===n||r.b===n),p=edge.points[edge.a===n?3:edge.points.length-4],q=edge.points[edge.a===n?4:edge.points.length-5],angle=Math.atan2(q.x-p.x,q.z-p.z),x=p.x+Math.cos(angle)*offset,z=p.z-Math.sin(angle)*offset,y=getSurfaceAt(x,z).height;const service={id:'county-'+city.services.length,kind,name,x,z,radius:10,spawn:{x,z,heading:angle}};city.services.push(service);city.landmarks.push({...service});building(x+Math.cos(angle)*28,z-Math.sin(angle)*28,28,18,8,angle,1);for(const side of[-1,1])for(let i=-10;i<10;i+=2){const px=x+Math.cos(angle)*side*10+Math.sin(angle)*i,pz=z-Math.sin(angle)*side*10+Math.cos(angle)*i;instance(boxGeo,paints[3],px,getSurfaceAt(px,pz).height+.04,pz,.2,.08,2,angle);}sign(name,kind.toUpperCase(),x,y+5,z,angle);return service;}
 function sign(title,sub,x,y,z,angle=0){if(!globalThis.document?.createElement)return;const c=document.createElement('canvas');c.width=512;c.height=128;const ctx=c.getContext('2d');if(!ctx)return;ctx.fillStyle='#172d31';ctx.fillRect(0,0,512,128);ctx.fillStyle='#e5ebbc';ctx.font='bold 38px Arial';ctx.textAlign='center';ctx.fillText(title,256,55,488);ctx.font='bold 24px Arial';ctx.fillText(sub,256,99,488);const tex=new THREE.CanvasTexture(c);tex.colorSpace=THREE.SRGBColorSpace;const m=new THREE.Mesh(new THREE.PlaneGeometry(18,4.5),new THREE.MeshBasicMaterial({map:tex,side:THREE.DoubleSide}));m.position.set(x,y,z);m.rotation.y=angle;root.add(m);}
 city.landmarks.push(...layout.landmarks.map(l=>({...l,kind:'place'})));
 city.landmarks.push({kind:'place',name:'SKYLINE OBSERVATORY',x:summit.x,z:summit.z},{kind:'place',name:'RIDGE LOOKOUT',x:lookout.x,z:lookout.z});
 for(const n of [summit,lookout,villa,orchard,port])sign(n.name,'NEON COUNTY',n.x+30,height(n.x+30,n.z)+6,n.z);
 for(const r of roads.filter(r=>r.kind==='highway')){const p=r.points[Math.floor(r.points.length/2)],q=r.points[Math.floor(r.points.length/2)+1],angle=Math.atan2(q.x-p.x,q.z-p.z);sign('EXPRESSWAY 01','NEON / COAST / SKYLINE',p.x+Math.cos(angle)*22,p.y+7,p.z-Math.sin(angle)*22,angle);}
 for(const {geometry,matrices} of groups.values()){const mat=[...groups].find(([,g])=>g.matrices===matrices)[0];const m=new THREE.InstancedMesh(geometry,mat,matrices.length);matrices.forEach((matrix,i)=>m.setMatrixAt(i,matrix));m.computeBoundingSphere();m.castShadow=true;m.receiveShadow=true;m.name='county-props';root.add(m);}
 const waterMat=material(0x367f91,{roughness:.28,metalness:.2});mesh(water,waterMat,'island-water');
 for(const [x,z,w,d]of[[bounds.minX-1200,0,2400,14000],[bounds.maxX+1200,0,2400,14000],[0,bounds.minZ-1200,11184,2400],[0,bounds.maxZ+1200,11184,2400]]){const sea=new THREE.Mesh(new THREE.PlaneGeometry(w,d),waterMat);sea.rotation.x=-Math.PI/2;sea.position.set(x,-3,z);root.add(sea);}

 architecture.finish();city.streetLights.push(...architecture.lights);
 const extraCells=new Map();for(const c of extraColliders){const r=Math.hypot(c.hx,c.hz);for(let x=Math.floor((c.x-r)/128);x<=Math.floor((c.x+r)/128);x++)for(let z=Math.floor((c.z-r)/128);z<=Math.floor((c.z+r)/128);z++){const k=x+','+z;if(!extraCells.has(k))extraCells.set(k,[]);extraCells.get(k).push(c);}}
 function getColliders(player,radius=48){const found=new Set(original.colliders(player,radius));for(let x=Math.floor((player.x-radius)/128);x<=Math.floor((player.x+radius)/128);x++)for(let z=Math.floor((player.z-radius)/128);z<=Math.floor((player.z+radius)/128);z++)for(const c of extraCells.get(x+','+z)||[])found.add(c);return [...found];}
 const coreNodeCount=81;Object.assign(city,{name:'NEON ARCHIPELAGO',bounds,setNight(n){original.night(n);architecture.setNight(n);},update(dt,time,player){original.update(dt,time,player);architecture.update(player?.player||player);},getSurfaceAt,getRoadInfo,getResetPose,getDistrict,getColliders,getSignal(n,axis,time){const id=typeof n==='object'?n.id:n;return id>=coreNodeCount?'green':original.signal(n,axis,time);},sampleAcoustics(x,z,...args){if(inside(x,z))return original.acoustics(x,z,...args);return{zone:z< -1500?'hills':'open',enclosure:.05,reflectivity:.15,openness:.95,leftDistance:90,rightDistance:90,frontDistance:90,backDistance:90,ambient:{park:.4,water:z>1400?.8:0,industrial:x>1000&&z>300?.7:0,traffic:.35,wind:.7,insects:.4}};},region:{roads,roundabouts,segments,ground,terrainBase,height,roadMesh,surfaceMeshes,layout,architecture:architecture.stats,landKm2:grid.reduce((n,h)=>n+(h>-3?1:0),0)*STEP*STEP/1e6,areaKm2:(bounds.maxX-bounds.minX)*(bounds.maxZ-bounds.minZ)/1e6}});
 city.colliders.push(...extraColliders);city.mapRoads.push(...roads);city.mapBuildings.push(...extraMapBuildings);city.mapDistricts.push(...layout.towns.map(t=>({name:t.name,x:t.x,z:t.z})));city.mapDistricts.push({name:'SKYLINE HILLS',x:0,z:-2250},{name:'ORCHARD VALLEY',x:-1300,z:-1000},{name:'SUNSET COUNTY',x:-1350,z:650},{name:'HARBOR DISTRICT',x:1300,z:800},{name:'PALM COAST',x:0,z:1650},{name:'RESERVOIR',x:1300,z:-900});city.length+=roads.reduce((n,r)=>n+pathLength(r.points),0);
 city.mapSurfaces=[{material:'water',points:[{x:bounds.minX,z:bounds.minZ},{x:bounds.maxX,z:bounds.minZ},{x:bounds.maxX,z:bounds.maxZ},{x:bounds.minX,z:bounds.maxZ}]},...ISLANDS.map((s,i)=>({material:'grass',points:Array.from({length:96},(_,j)=>{const a=j*Math.PI*2/96,r=coastRadius(a,i);return{x:s.x+Math.cos(a)*s.rx*r,z:s.z+Math.sin(a)*(Math.sin(a)<0?(s.rzNorth||s.rz):s.rz)*r};})}))];
 return city;
}

