import * as THREE from './vendor/three.module.js';
import {frontLip,rearDiffuser,tintTransmission,lampSpecification} from './exterior-tuning.js';

export function makePaintFinish(paint,s){
 const finish={stock:[.82,.08],gloss:[.24,.12],satin:[.66,.05],metallic:[.34,.55]}[s.paintFinish]||[.82,.08];
 paint.roughness=finish[0];paint.metalness=finish[1];
 if((!s.livery||s.livery==='stock')&&s.paintFinish!=='metallic')return;
 const pattern={stripes:1,sweep:2,rally:3}[s.livery]||0;
 paint.customProgramCacheKey=()=>`sideways-wrap-${pattern}-${s.paintFinish}`;
 paint.onBeforeCompile=shader=>{
  shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nattribute vec3 wrapPosition; varying vec3 vWrapPosition;').replace('#include <begin_vertex>','#include <begin_vertex>\nvWrapPosition=wrapPosition;');
  shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying vec3 vWrapPosition;');
  const code=pattern===1?'float band=step(.13,abs(p.x))*(1.-step(.29,abs(p.x))); diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.88,.84,.65),band);':pattern===2?'float diagonal=p.z+p.x*.8; float band=step(-.65,diagonal)*(1.-step(.35,diagonal)); diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.035,.46,.40),band); float edge=step(.35,diagonal)*(1.-step(.45,diagonal)); diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.88,.84,.65),edge);':pattern===3?'float band=1.-step(.57,p.y); diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.88,.84,.65),band); float stripe=step(.30,p.x)*(1.-step(.46,p.x)); diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.85,.055,.15),stripe);':'';
  shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>\nvec3 p=vWrapPosition; ${code}`);
  if(s.paintFinish==='metallic')shader.fragmentShader=shader.fragmentShader.replace('#include <roughnessmap_fragment>','#include <roughnessmap_fragment>\nfloat flake=fract(sin(dot(floor(vWrapPosition*700.),vec3(12.9898,78.233,37.719)))*43758.5453); roughnessFactor=mix(roughnessFactor,.20,step(.94,flake)*.45);');
 };
}
// Store undeformed chassis coordinates per vertex. Wraps stay on their panel
// when a door opens, bends or detaches, and add no extra mesh/render pass.
export function bindPaintCoordinates(chassis,paint){
 chassis.updateMatrixWorld(true);const inverse=chassis.matrixWorld.clone().invert(),p=new THREE.Vector3();
 chassis.traverse(mesh=>{if(!mesh.isMesh||mesh.material!==paint)return;const pos=mesh.geometry.attributes.position,toBody=inverse.clone().multiply(mesh.matrixWorld),a=new Float32Array(pos.count*3);for(let i=0;i<pos.count;i++){p.fromBufferAttribute(pos,i).applyMatrix4(toBody);p.toArray(a,i*3);}mesh.geometry.setAttribute('wrapPosition',new THREE.BufferAttribute(a,3));});
}
export function makeWindowMaterial(s){
 // Thin tinted glass uses neutral absorption blending rather than another
 // scene render. Fresnel reflection increases at grazing angles; at normal
 // incidence the selected VLT is the actual framebuffer transmission.
 const transmission=tintTransmission(s),m=new THREE.MeshStandardMaterial({color:0x111c21,roughness:.20,metalness:.08,transparent:true,opacity:1-transmission,side:THREE.DoubleSide,depthWrite:false});
 m.name='glass-vlt-'+transmission;m.userData.transmission=transmission;
 m.customProgramCacheKey=()=>`sideways-glass-vlt-${transmission}`;
 m.onBeforeCompile=shader=>{shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>',`diffuseColor.a=1.-${transmission.toFixed(3)}*(1.-.12*pow(1.-abs(dot(normal,normalize(vViewPosition))),5.));\n#include <opaque_fragment>`);};
 return m;
}
export function addExteriorTuning({chassis,build,q,L,W,paint,dark,graphite,chrome,accent,lampMaterials,box,panel,beam}){
 const s=build.selection,p=build.physics;
 const group=(name,id)=>{const g=new THREE.Group();g.name='tuning-'+name;g.userData.exterior=id;chassis.add(g);return g;};
 const lip=frontLip(s),diffuser=rearDiffuser(s);
 if(lip!=='none'){
  const g=group('splitter-'+lip,'splitter'),z=L*.99,extension=lip==='race'?.23:lip==='street'?.13:.06,y=lip==='stock'?.29:.24,width=W*(lip==='race'?1.14:1.08);
  panel(g,[[-width,y,z+extension],[width,y,z+extension],[width*.95,y,z-.35],[-width*.95,y,z-.35]],graphite);
  if(lip==='street')box(g,0,y+.035,z+extension-.025,width*1.94,.06,.06,paint);
  if(lip==='race')for(const side of [-1,1]){beam(g,[side*.56,y+.01,z+.16],[side*.52,.53,z-.05],.013,chrome);panel(g,[[side*width,y,z+.20],[side*width,y+.15,z+.12],[side*width,y+.13,z-.28],[side*width,y,z-.34]],graphite);}
 }
 if(diffuser!=='none'){
  const g=group('diffuser-'+diffuser,'diffuser'),z=-L*.99,n=diffuser==='race'?5:3,deep=diffuser==='race';
  panel(g,[[-W*.84,.28,z-.13],[W*.84,.28,z-.13],[W*.78,.18,z+.38],[-W*.78,.18,z+.38]],graphite);
  for(let i=0;i<n;i++){const x=(i-(n-1)/2)*(deep?.32:.47);panel(g,[[x,.18,z+.38],[x,.31,z-.14],[x,deep?.11:.18,z-.14],[x,deep?.09:.13,z+.38]],graphite);}
 }
 for(const side of [-1,1])for(const z of [p.frontAxle,-p.rearAxle]){
  const id='fender'+(z>0?'F':'R')+(side<0?'L':'R'),g=group(id+'-'+s.fenders+'-'+s.widebody,id),r=p.wheelRadius,inner=r+.043,outer=r+(s.widebody==='gt'?.17:s.widebody==='bolt'?.14:.095),x=side*(p.halfTrack+p.tyreWidth*.5+.018),baseX=side*W*.98,mat=s.fenders==='carbon'?graphite:paint;
  for(let i=0;i<10;i++){
   const a=i*Math.PI/10,b=(i+1)*Math.PI/10,pt=(angle,rad,xx)=>[xx,r+.015+Math.sin(angle)*rad,z+Math.cos(angle)*rad];
   panel(g,[pt(a,inner,x),pt(b,inner,x),pt(b,outer,x),pt(a,outer,x)],mat,false);
   if(s.widebody!=='stock')panel(g,[pt(a,outer,x),pt(b,outer,x),pt(b,outer+.025,baseX),pt(a,outer+.025,baseX)],mat,false);
   if(s.widebody==='bolt'&&i%2===0)box(g,x+side*.006,r+.015+Math.sin(a+.08)*(outer-.025),z+Math.cos(a+.08)*(outer-.025),.016,.022,.022,chrome);
  }
  if(s.fenders==='vented')for(let i=0;i<3;i++){const y=.57+i*.045;box(g,x+side*.006,y,z-.36,.018,.022,.17,dark);}
  if(s.widebody==='gt')panel(g,[[x,.39,z-.47],[x,.66,z-.32],[baseX,.68,z-.61],[baseX,.36,z-.64]],mat);
 }
 if(s.grille!=='stock'){
  const y=build.vehicle.model.kind==='wedge'?.435:build.vehicle.model.kind==='muscle'?.68:.51,h=build.vehicle.model.kind==='muscle'?.24:.15,z=L*.986,g=group('grille-'+s.grille,'grille');
  box(g,0,y,z,W*1.12,h,.05,dark);
  if(s.grille==='billet')for(let i=0;i<4;i++)box(g,0,y-h*.38+i*h*.25,z+.03,W*1.06,.016,.025,chrome);
  else for(let i=0;i<11;i++)for(const angle of [-.55,.55]){const slat=box(g,(i-5)*W*.095,y,z+.031,.012,h*.90,.018,graphite);slat.rotation.z=angle;}
 }
 if(s.lightDesign!=='stock')for(const side of [-1,1]){
  const kind=build.vehicle.model.kind,front=group('headlamp-'+side,'lamp'+(side<0?'FL':'FR')),rear=group('tail-lamp-'+side,'lamp'+(side<0?'RL':'RR')),x=side*W*.67,y=kind==='muscle'?.715:kind==='wedge'?.72:kind==='tourer'?.73:.60,z=kind==='wedge'?1.385:L*.995,mat=lampMaterials[side<0?'lampFL':'lampFR'],tail=lampMaterials[side<0?'lampRL':'lampRR'];
  box(front,x,y,z,.39,.17,.045,graphite);
  if(s.lightDesign==='led'){for(let i=0;i<4;i++)box(front,x+(i-1.5)*.078,y,z+.03,.058,.08,.018,mat);}
  else for(const offset of [-.10,.10]){const lens=new THREE.Mesh(new THREE.CylinderGeometry(.065,.065,.022,12),mat);lens.rotation.x=Math.PI/2;lens.position.set(x+offset,y,z+.035);front.add(lens);const rim=new THREE.Mesh(new THREE.TorusGeometry(.071,.010,4,12),chrome);rim.position.set(x+offset,y,z+.05);front.add(rim);}
  const ty=kind==='tourer'?.72:kind==='wedge'?.655:.68,tz=-L*1.004;
  box(rear,x,ty,tz,.39,.15,.04,graphite);for(let i=0;i<3;i++)box(rear,x+(i-1)*.11,ty,tz-.026,.075,s.lightDesign==='led'?.10:.045,.018,tail);
 }
 const lamp=lampSpecification(s);for(const id of ['lampFL','lampFR']){lampMaterials[id].color.setHex(lamp.color);lampMaterials[id].emissive.setHex(lamp.color);}
 // Batch repeated arch segments, grille slats and lamp elements within their
 // own detachable group. Keep outlined pieces intact with their edge child.
 for(const root of chassis.children.filter(n=>n.name.startsWith('tuning-'))){
  const batches=new Map();for(const mesh of root.children){if(!mesh.isMesh||mesh.children.length)continue;const key=mesh.material.uuid;if(!batches.has(key))batches.set(key,[]);batches.get(key).push(mesh);}
  for(const meshes of batches.values()){
   if(meshes.length<2)continue;const positions=[],normals=[];
   for(const mesh of meshes){mesh.updateMatrix();const g=mesh.geometry.index?mesh.geometry.toNonIndexed():mesh.geometry.clone();g.applyMatrix4(mesh.matrix);positions.push(...g.attributes.position.array);normals.push(...g.attributes.normal.array);g.dispose();mesh.geometry.dispose();root.remove(mesh);}
   const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));const merged=new THREE.Mesh(g,meshes[0].material);merged.castShadow=merged.receiveShadow=true;root.add(merged);
  }
 }
}
