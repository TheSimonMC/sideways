import * as THREE from './vendor/three.module.js';

export function cabinMaterials(build,l,material){
 const s=build.selection,palette={graphite:[0x343a42,0x272e36],cream:[0xcdbd9c,0x756351],red:[0x723b43,0x30313a]}[s.interiorColour];
 const trim=material(palette?.[1]??l.trim),cloth=material(palette?.[0]??l.seat,{roughness:s.upholstery==='leather'?.43:s.upholstery==='suede'?1:.86});
 const stitch=material(s.stitching==='stock'?l.accent:0xeee2c7),decor=s.dashTrim==='stock'?trim:material(s.dashTrim==='wood'?0x825138:s.dashTrim==='carbon'?0x333d43:s.dashTrim==='brushed'?0xa4acac:l.accent,{roughness:s.dashTrim==='brushed'?.48:.74,metalness:s.dashTrim==='brushed'?.62:.04});
 return {trim,cloth,stitch,decor};
}

// The caller batches these shapes by material and mount. Door inserts keep
// their own panel parent; seats/cage remain bolted to the cabin floor.
export function addCabinParts({build,l,box,add,material,dark,cloth,stitch,decor,metal}){
 const s=build.selection,t=l.tuning,q=l.q,W=l.W;
 const beam=(a,b,r,mat,tag)=>{const av=new THREE.Vector3(...a),bv=new THREE.Vector3(...b),v=bv.sub(av),g=new THREE.CylinderGeometry(r,r,v.length(),8);g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),v.clone().normalize()));add(g,mat,av.addScaledVector(v,.5).toArray(),[0,0,0],tag);};
 for(const side of [-1,1]){
  const x=side*W*.46,y=-t.seatDrop,tag=side<0?'seat-left':'seat-right',sport=s.frontSeats!=='stock',bucket=s.frontSeats==='bucket';
  box(x,.46+y,l.seatZ,.38,.12,.45,cloth,tag);
  box(x,.70+y,l.seatZ-.22,.37,.43,.10,bucket?dark:cloth,tag,[-.15,0,0]);
  if(bucket){box(x,.72+y,l.seatZ-.157,.28,.31,.03,cloth,tag,[-.15,0,0]);box(x,.96+y,l.seatZ-.26,.28,.20,.11,dark,tag);for(const off of [-.069,.069])box(x+off,.926+y,l.seatZ-.198,.069,.038,.016,metal,tag);}
  else box(x,.955+y,l.seatZ-.26,sport?.27:.23,.15,.10,dark,tag);
  for(const sign of [-1,1]){box(x+sign*.165,.54+y,l.seatZ,sport?.065:.045,sport?.20:.15,.40,dark,tag);box(x+sign*.165,.75+y,l.seatZ-.19,sport?.075:.05,sport?.39:.34,sport?.16:.10,dark,tag);box(x+sign*.13,.387+y,l.seatZ,.025,.035,.40,metal,tag);}
  if(s.stitching==='diamond')for(const a of [-.65,.65])for(let k=-2;k<=2;k++){box(x+k*.047,.527+y,l.seatZ,.006,.006,.30,stitch,tag,[0,a,0]);box(x+k*.047,.73+y,l.seatZ-.153,.006,.27,.006,stitch,tag,[-.15,0,a]);}
  else for(let k=0;k<(s.stitching==='contrast'?4:3);k++){const xx=x+(k-(s.stitching==='contrast'?1.5:1))*.09;box(xx,.526+y,l.seatZ-.01,.008,.007,.31,stitch,tag);if(s.stitching==='contrast')box(xx,.72+y,l.seatZ-.151,.007,.28,.007,stitch,tag,[-.15,0,0]);}
  // Empty seats retain their straps. The driver-side resting straps are
  // shown only during cabin inspection; worn straps move with the driver.
  const beltTag=Math.sign(l.driverX)===side?'resting-belts':tag,offsets=s.harness==='stock'?[.02]:[-.075,.075];for(const off of offsets)box(x+off,.73+y,l.seatZ-.139,.029,.36,.012,stitch,beltTag,[-.15,0,s.harness==='stock'?.4:0]);box(x,.53+y,l.seatZ+.02,.31,.012,.032,stitch,beltTag);if(s.harness==='six')for(const off of [-.035,.035])box(x+off,.531+y,l.seatZ+.12,.026,.012,.18,stitch,beltTag);
 }
 if(s.dashTrim!=='stock'){
  const z=l.dashZ-.132;box(0,q.sill-.15,z,W*1.60,.055,.017,decor,'dash-decor');
  for(const side of [-1,1])box(side*W*.832,.70,(l.front+l.back)/2,.017,.04,.55,decor,side<0?'left':'right');
  if(s.dashTrim==='wood'||s.dashTrim==='carbon')for(let i=0;i<7;i++)box((i-3)*W*.22,q.sill-.15,z-.011,W*.18,.004,.005,dark,'dash-decor',[0,0,s.dashTrim==='wood'?.03:.3]);
 }
 if(t.cage!=='none'){
  const tag='cage',z=l.seatZ-.36,top=q.roof-.10,cx=q.roofW*.85,base=W*.70;
  for(const side of [-1,1]){
   beam([side*base,.37,z],[side*cx,top,z],.023,metal,tag);
   beam([side*cx,top,z],[side*base,.39,l.back+.17],.023,metal,tag);
   if(t.cage==='full'){const roof=[side*q.roofW*.94,top,q.roofFront-.04],bend=[side*W*.81,q.sill-.025,l.front-.045],foot=[side*W*.81,.37,l.front-.045];beam([side*cx,top,z],roof,.023,metal,tag);beam(roof,bend,.023,metal,tag);beam(bend,foot,.023,metal,tag);beam([side*base,.46,z],[foot[0],.46,foot[2]],.023,metal,tag);}
  }
  beam([-cx,top,z],[cx,top,z],.023,metal,tag);beam([-base,.78,z],[base,.78,z],.023,metal,tag);
  beam([-base,.39,z],[cx,top,z],.020,metal,tag);
 }
 let ambient=null;
 if(t.ambient){ambient=material(t.ambient,{emissive:t.ambient,emissiveIntensity:0,roughness:.6});box(0,q.sill-.21,l.dashZ-.14,W*1.58,.008,.014,ambient,'ambient-dash');
  for(const side of [-1,1]){box(side*W*.828,.607,(l.front+l.back)/2,.015,.008,.47,ambient,side<0?'left':'right');box(side*W*.45,.40,l.dashZ-.12,.22,.012,.012,ambient,'ambient-footwell');}
 }
 return {ambient};
}

export function addAuxiliaryGauges({build,l,root,dark,metal}){
 const mode=build.selection.auxGauges;if(!mode||mode==='stock')return null;
 const group=new THREE.Group();group.name='auxiliary-gauges';group.userData.interior=true;root.add(group);
 const fields=mode==='triple'?['manifoldBar','oilPressure','coolant']:['manifoldBar'],canvas=document.createElement('canvas');canvas.width=fields.length*160;canvas.height=160;
 const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.minFilter=THREE.LinearFilter;texture.generateMipmaps=false;
 const faceMaterial=new THREE.MeshBasicMaterial({map:texture,toneMapped:false}),x=-Math.sign(l.driverX)*.02,y=l.q.sill+(l.kind==='muscle'?.23:.11),z=l.dashZ-.035;
 fields.forEach((field,i)=>{const xx=x+(i-(fields.length-1)/2)*.114;
  const baseY=l.q.sill-.015,stemHeight=y-.048-baseY,stem=new THREE.Mesh(new THREE.CylinderGeometry(.009,.009,stemHeight,8),metal);stem.position.set(xx,baseY+stemHeight*.5,z+.015);group.add(stem);const foot=new THREE.Mesh(new THREE.BoxGeometry(.075,.008,.085),dark);foot.position.set(xx,baseY,z+.015);group.add(foot);
  const housing=new THREE.Mesh(new THREE.CylinderGeometry(.056,.056,.08,16).rotateX(Math.PI/2),dark);housing.position.set(xx,y,z);group.add(housing);
  const ring=new THREE.Mesh(new THREE.TorusGeometry(.052,.005,4,16),metal);ring.position.set(xx,y,z-.044);group.add(ring);
  const geo=new THREE.PlaneGeometry(.099,.099),uv=geo.attributes.uv;for(let j=0;j<uv.count;j++)uv.setX(j,(uv.getX(j)+i)/fields.length);
  const face=new THREE.Mesh(geo,faceMaterial);face.name='gauge-'+field;face.rotation.y=Math.PI;face.position.set(xx,y,z-.045);group.add(face);
 });
 const ctx=canvas.getContext('2d');let values=null;
 return {group,update(r){values=Object.fromEntries(fields.map(k=>[k,r[k]]));if(!ctx?.arc)return;ctx.fillStyle='#11191f';ctx.fillRect(0,0,canvas.width,160);fields.forEach((key,i)=>{const x=i*160+80,y=80,value=r[key],range=key==='coolant'?[20,140]:key==='oilPressure'?[0,8]:[-1,2.5],colour=r.powered?'#e9dfc2':'#3c494d';ctx.strokeStyle=colour;ctx.lineWidth=4;ctx.beginPath();ctx.arc(x,y,69,Math.PI*.75,Math.PI*2.25);ctx.stroke();if(r.powered){const fraction=Math.max(0,Math.min(1,(value-range[0])/(range[1]-range[0]))),angle=Math.PI*.75+fraction*Math.PI*1.5;ctx.strokeStyle='#ee9074';ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+Math.cos(angle)*56,y+Math.sin(angle)*56);ctx.stroke();}ctx.fillStyle=colour;ctx.textAlign='center';ctx.font='bold 20px monospace';ctx.fillText(key==='coolant'?'WATER °C':key==='oilPressure'?'OIL BAR':'BOOST BAR',x,121);ctx.font='bold 26px monospace';ctx.fillText(r.powered?value.toFixed(key==='coolant'?0:1):'OFF',x,152);});texture.needsUpdate=true;},diagnostics:()=>({fields,values})};
}
