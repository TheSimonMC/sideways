import {addCosmetics,addRim} from './car-cosmetics.js';
import {brakeGlow} from './brake-hydraulics.js';
import * as THREE from './vendor/three.module.js';
import { resolveBuild } from './catalog.js';
import {bodyDisplacement} from './body-damage.js';
import {createTerrainEffects} from './terrain-fx.js';

const INK = 0x101321;
const ACID = 0xd7ff48;
const PINK = 0xff528c;
const CYAN = 0x64eedb;
const NOS_BLUE = 0x64dfff;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function material(color, extra = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.82, metalness: 0.08, flatShading: true, side: THREE.DoubleSide, ...extra });
}
function outline(mesh, color = INK, opacity = 1, threshold = 28) {
  const edge = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry, threshold), new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity }));
  edge.renderOrder = 2;
  mesh.add(edge);
  return mesh;
}
function box(parent, x, y, z, w, h, d, mat, ink = false) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  if (ink) outline(mesh);
  parent.add(mesh);
  return mesh;
}
function panel(parent, points, mat, ink = true) {
  const vertices = [];
  for (let i = 1; i < points.length - 1; i++) vertices.push(...points[0], ...points[i], ...points[i + 1]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  if (ink) outline(mesh);
  parent.add(mesh);
  return mesh;
}
function beam(parent, a, b, thickness, mat) {
  const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b);
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(thickness, thickness, start.distanceTo(end), 5), mat);
  mesh.position.copy(start).add(end).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), end.sub(start).normalize());
  mesh.castShadow = true;
  parent.add(mesh);
  return mesh;
}
function bodyHull(parent, rings, mat) {
  const verts = [], index = [];
  for (const {z, w, y} of rings) {
    for (const [x, yy] of [[-w * .86,.28],[w * .86,.28],[w,.46],[w * .96,y - .075],[w * .72,y],[-w * .72,y],[-w * .96,y - .075],[-w,.46]]) verts.push(x,yy,z);
  }
  for (let n = 0; n < rings.length - 1; n++) for (let k = 0; k < 8; k++) {
    const a = n * 8 + k, b = n * 8 + (k + 1) % 8, c = (n + 1) * 8 + k, d = (n + 1) * 8 + (k + 1) % 8;
    index.push(a,b,c,b,d,c);
  }
  for (let k = 1; k < 7; k++) index.push(0,k + 1,k);
  const last = (rings.length - 1) * 8;
  for (let k = 1; k < 7; k++) index.push(last,last + k,last + k + 1);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setIndex(index); g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, mat); mesh.castShadow = true; mesh.receiveShadow = true;
  outline(mesh, INK, .85, 24); parent.add(mesh);
  return mesh;
}
function decalTexture(text, width = 256, height = 128, color = '#f7f6dc', bg = null) {
  const c = document.createElement('canvas'); c.width = width; c.height = height;
  const ctx = c.getContext('2d');
  if (bg) {ctx.fillStyle = bg; ctx.fillRect(0,0,width,height);}
  ctx.fillStyle = color; ctx.font = `italic 900 ${Math.round(height * .82)}px Arial Black, sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, width * .49, height * .54);
  const texture = new THREE.CanvasTexture(c); texture.colorSpace = THREE.SRGBColorSpace; texture.minFilter = THREE.LinearFilter;
  return texture;
}
function decal(parent, texture, x, y, z, w, h, ry = 0, rx = 0) {
  const m = new THREE.MeshBasicMaterial({map:texture, transparent:true, side:THREE.DoubleSide, depthWrite:false, polygonOffset:true, polygonOffsetFactor:-2});
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w,h), m); mesh.position.set(x,y,z); mesh.rotation.set(rx,ry,0); mesh.renderOrder=3; parent.add(mesh); return mesh;
}

export function createCar(scene, initialBuild = resolveBuild()) {
  const group = new THREE.Group(); scene.add(group);
  const debris=new THREE.Group();debris.name='DETACHED-WHEELS';scene.add(debris);
  const debrisTyre=new THREE.CylinderGeometry(1,1,.72,12),debrisRim=new THREE.CylinderGeometry(.58,.58,.75,10),debrisRubber=material(0x171820),debrisMetal=material(0x8f9ba5,{metalness:.6,roughness:.35});
  const panelGeometry=new THREE.BoxGeometry(1,.13,.17),panelMaterial=material(0x242938);
  const loosePanels=Array.from({length:4},()=>{const mesh=new THREE.Mesh(panelGeometry,panelMaterial);mesh.castShadow=true;mesh.visible=false;debris.add(mesh);return mesh;});
  const rodStart=new THREE.Vector3(),rodEnd=new THREE.Vector3(),rodMid=new THREE.Vector3(),rodDirection=new THREE.Vector3(),rodAxis=new THREE.Vector3(0,1,0);
  const damagePoint=new THREE.Vector3(),damageOffset={x:0,y:0,z:0},damageColour=new THREE.Color(0x52555a);
  const looseWheels=Array.from({length:8},()=>{const pivot=new THREE.Group(),spin=new THREE.Group();pivot.add(spin);for(const [geo,mat]of [[debrisTyre,debrisRubber],[debrisRim,debrisMetal]]){const mesh=new THREE.Mesh(geo,mat);mesh.rotation.z=Math.PI/2;mesh.castShadow=true;spin.add(mesh);}pivot.visible=false;debris.add(pivot);return {pivot,spin};});
  let model=null, build=initialBuild, paintHex=initialBuild.vehicle.color || '#d8fa50';
  const disposeModel=()=>{
    if(!model)return;
    const geometries=new Set(),materials=new Set(),textures=new Set();
    for(const root of [model.content,model.spoilerDebris].filter(Boolean))root.traverse(node=>{if(node.geometry)geometries.add(node.geometry);for(const mat of node.material?(Array.isArray(node.material)?node.material:[node.material]):[]){materials.add(mat);for(const key of ['map','emissiveMap','normalMap'])if(mat[key])textures.add(mat[key]);}});
    for(const g of geometries)g.dispose();for(const m of materials)m.dispose();for(const t of textures)t.dispose();
    group.remove(model.content);if(model.spoilerDebris)debris.remove(model.spoilerDebris);model=null;
  };
  function assemble(nextBuild) {
    disposeModel();build=nextBuild;
    const spec=build.vehicle.model,p=build.physics,kind=spec.kind,L=spec.length*.5,W=spec.width*.46,R=p.wheelRadius;
    group.name=build.vehicle.name;
    const content=new THREE.Group(),chassis=new THREE.Group();group.add(content);content.add(chassis);
    const paint=material(paintHex),dark=material(INK),graphite=material(0x242938),glass=material(0x244851,{roughness:.26,metalness:.32});
    const glint=new THREE.MeshBasicMaterial({color:0x81d9cf,side:THREE.DoubleSide});
    const white=material(0xf3f0df),accent=material(kind==='muscle'?CYAN:PINK),rubber=material(0x10111a),chrome=material(0xa4adb4,{metalness:.78,roughness:.28});
    const headlamp=new THREE.MeshStandardMaterial({color:0xd7e8ec,emissive:0xd2eaff,emissiveIntensity:2.5,roughness:.25});
    const tail=new THREE.MeshStandardMaterial({color:0xff315b,emissive:0xff174d,emissiveIntensity:.5,roughness:.4});
    const profiles={
      coupe:{rings:[[-.94,.86,.72],[-.76,1,.83],[-.35,1,.84],[.28,.98,.80],[.70,1,.68],[.96,.87,.60]],roofBack:-.51,roofFront:.29,screenFront:.94,screenBack:-1.06,roof:1.28,roofW:.55,sill:.84},
      muscle:{rings:[[-.96,.91,.82],[-.72,1.02,.92],[-.30,1,.89],[.30,1,.84],[.78,1.04,.80],[.96,.96,.77]],roofBack:-.97,roofFront:.12,screenFront:.80,screenBack:-1.48,roof:1.43,roofW:.63,sill:.91},
      wedge:{rings:[[-.96,.91,.66],[-.69,1,.79],[-.24,.97,.75],[.35,.96,.68],[.75,.91,.48],[.97,.83,.42]],roofBack:-.64,roofFront:.18,screenFront:.91,screenBack:-1.12,roof:1.15,roofW:.53,sill:.77},
      tourer:{rings:[[-.96,.96,.89],[-.78,1,.91],[-.36,1,.88],[.34,1,.86],[.76,.98,.81],[.96,.95,.76]],roofBack:-1.11,roofFront:.33,screenFront:.87,screenBack:-1.79,roof:1.47,roofW:.64,sill:.89}
    };
    const q=profiles[kind]||profiles.coupe;
    const shell=bodyHull(chassis,q.rings.map(([z,w,y])=>({z:z*L,w:w*W,y})),paint),shellBase=shell.geometry.attributes.position.array.slice();
    box(chassis,0,.27,0,W*1.93,.14,L*1.88,dark);
    const frontBumper=box(chassis,0,.34,L*.976,W*2.02,.12,.17,kind==='muscle'?chrome:graphite,true);frontBumper.userData.panel='front';
    const rearBumper=box(chassis,0,.35,-L*.976,W*2.02,.15,.17,kind==='muscle'?chrome:graphite,true);rearBumper.userData.panel='rear';
    // Splitter, separate grille and sculpted lamps give each body its own face.
    panel(chassis,[[-W*1.04,.31,L*1.015],[W*1.04,.31,L*1.015],[W*1.10,.28,L*.78],[-W*1.10,.28,L*.78]],graphite).userData.panel='front';
    box(chassis,0,kind==='wedge'?.435:kind==='muscle'?.68:.51,L*.974,W*1.12,kind==='muscle'?.24:.15,.035,dark);
    if(kind==='muscle'){
      for(const side of [-1,1])for(const off of [-.125,.125]){
        const lamp=new THREE.Mesh(new THREE.CylinderGeometry(.105,.105,.035,12),headlamp);lamp.rotation.x=Math.PI/2;lamp.position.set(side*W*.72+off,.715,L*.984);chassis.add(lamp);
        const rim=new THREE.Mesh(new THREE.TorusGeometry(.108,.014,3,12),chrome);rim.position.copy(lamp.position);rim.position.z+=.024;chassis.add(rim);
      }
      if(build.selection.hood==='stock'){box(chassis,0,.915,.96,.55,.17,.85,graphite,true);box(chassis,0,.95,1.39,.44,.06,.03,dark);}
      for(const side of [-1,1])panel(chassis,[[side*.13,.94,.70],[side*.34,.94,.70],[side*.34,.81,L*.94],[side*.13,.81,L*.94]],dark,false);
    } else if(kind==='wedge'){
      for(const side of [-1,1]){
        const bucket=box(chassis,side*W*.65,.68,1.20,.43,.23,.32,paint,true);bucket.rotation.x=-.20;
        box(chassis,side*W*.65,.72,1.37,.32,.13,.025,headlamp);
        box(chassis,side*W*.65,.395,L*.98,.32,.04,.03,white);
      }
      panel(chassis,[[-.58,.69,.96],[.58,.69,.96],[.49,.44,L*.94],[-.49,.44,L*.94]],graphite);
      for(const side of [-1,1])for(let n=0;n<4;n++)box(chassis,side*.46,.73-n*.018,.80+n*.10,.18,.014,.033,dark);
    } else {
      for(const side of [-1,1]){
        const y=kind==='tourer'?.715:.59;
        box(chassis,side*W*.64,y,L*.972,W*.55,.15,.055,graphite);
        box(chassis,side*W*.64,y+.015,L*.99,W*.48,kind==='tourer'?.10:.055,.027,headlamp);
        if(kind==='tourer')box(chassis,side*W*.91,y,L*.993,.075,.12,.03,accent);
      }
      if(kind==='coupe'){
        panel(chassis,[[-.65,.805,.75],[.65,.805,.75],[.59,.625,L*.90],[-.59,.625,L*.90]],graphite);
        panel(chassis,[[.25,.808,.76],[.39,.808,.76],[.04,.63,L*.90],[-.11,.63,L*.90]],accent,false);
        for(let n=0;n<3;n++)box(chassis,-.23,.775-n*.022,1.02+n*.16,.29,.015,.055,dark);
      }else{
        for(const side of [-1,1])box(chassis,side*.47,.872,.97,.045,.028,.66,graphite);
      }
    }
    // Four glass planes, roof, visible pillars and specular comic strokes.
    const sideW=W*.79,rw=q.roofW;
    panel(chassis,[[-sideW,q.sill,q.screenBack],[sideW,q.sill,q.screenBack],[rw,q.roof,q.roofBack],[-rw,q.roof,q.roofBack]],glass);
    panel(chassis,[[-rw,q.roof,q.roofBack],[rw,q.roof,q.roofBack],[rw,q.roof+.018,q.roofFront],[-rw,q.roof+.018,q.roofFront]],paint);
    if(kind!=='muscle')panel(chassis,[[-rw+.07,q.roof+.01,q.roofBack+.06],[rw-.07,q.roof+.01,q.roofBack+.06],[rw-.07,q.roof+.028,q.roofFront-.06],[-rw+.07,q.roof+.028,q.roofFront-.06]],dark,false);
    panel(chassis,[[-rw,q.roof+.018,q.roofFront],[rw,q.roof+.018,q.roofFront],[sideW,q.sill,q.screenFront],[-sideW,q.sill,q.screenFront]],glass);
    panel(chassis,[[-rw+.035,q.roof+.017,q.roofFront+.025],[-rw+.14,q.roof+.017,q.roofFront+.025],[-sideW+.16,q.sill+.018,q.screenFront-.04],[-sideW+.035,q.sill+.018,q.screenFront-.04]],glint,false);
    for(const side of [-1,1]){
      panel(chassis,[[side*sideW,q.sill,q.screenFront-.06],[side*rw,q.roof-.025,q.roofFront],[side*rw,q.roof-.025,q.roofBack],[side*sideW,q.sill,q.screenBack+.04]],glass);
      beam(chassis,[side*sideW,q.sill,q.screenFront],[side*rw,q.roof+.025,q.roofFront],.036,paint);
      beam(chassis,[side*sideW,q.sill,q.screenBack],[side*rw,q.roof+.025,q.roofBack],kind==='tourer'?.065:.043,paint);
      beam(chassis,[side*sideW,q.sill,-.32],[side*rw,q.roof,-.32],.028,dark);
      box(chassis,side*W*.96,.59,-.04,.055,.025,1.40,dark);
      box(chassis,side*W*.98,.73,-.44,.035,.035,.18,dark);
      box(chassis,side*W*1.04,q.sill+.01,q.screenFront-.26,.17,.10,.22,graphite,true);
      if(build.selection.sideSkirts==='stock')box(chassis,side*W*1.015,.29,0,.13,.10,1.76,graphite,true);
      panel(chassis,[[side*W*1.004,.49,-1.02],[side*W*1.004,.72,-.61],[side*W*1.004,.72,-.40],[side*W*1.004,.49,-.81]],accent,false);
      // Angular over-fenders stay fixed to the sprung body, wheels move inside them.
      for(const z0 of [p.frontAxle,-p.rearAxle]){
        const shape=new THREE.Shape(),outer=R+.095,inner=R+.041;
        shape.moveTo(z0+outer,R+.015);
        for(let j=0;j<=8;j++){const a=Math.PI*j/8;shape.lineTo(z0+Math.cos(a)*outer,R+.015+Math.sin(a)*outer);}
        for(let j=8;j>=0;j--){const a=Math.PI*j/8;shape.lineTo(z0+Math.cos(a)*inner,R+.015+Math.sin(a)*inner);}shape.closePath();
        const geo=new THREE.ShapeGeometry(shape),positions=geo.attributes.position;
        for(let i=0;i<positions.count;i++){const z=positions.getX(i),y=positions.getY(i);positions.setXYZ(i,side*(p.halfTrack+(p.tyreWidth??.27)*.5+.008),y,z);}geo.computeVertexNormals();
        const fender=new THREE.Mesh(geo,paint);fender.castShadow=true;outline(fender);chassis.add(fender);
        for(const dz of [-.30,.30])box(chassis,side*(p.halfTrack+(p.tyreWidth??.27)*.5+.013),.54,z0+dz,.018,.028,.028,dark);
      }
    }
    // Tail treatment: round sports lamps, long muscle strips or upright tourer clusters.
    for(const side of [-1,1]){
      if(kind==='wedge'){
        for(const off of [-.12,.12]){const lamp=new THREE.Mesh(new THREE.CylinderGeometry(.088,.088,.03,10),tail);lamp.rotation.x=Math.PI/2;lamp.position.set(side*.59+off,.655,-L*.974);chassis.add(lamp);}
      }else if(kind==='tourer'){
        box(chassis,side*W*.86,.72,-L*.978,.19,.33,.035,tail);box(chassis,side*W*.86,.74,-L*.999,.19,.043,.018,white);
      }else{
        box(chassis,side*W*.62,.685,-L*.975,W*.60,.14,.035,dark);
        box(chassis,side*W*.62,.706,-L*.991,W*.52,.042,.025,tail);
        box(chassis,side*W*.62,.65,-L*.991,W*.52,.025,.025,tail);
      }
    }
    box(chassis,0,.60,-L*.992,.29,.13,.022,white);
    for(const x of [-.47,0,.47])box(chassis,x,.23,-L*.94,.04,.14,.32,dark).userData.panel='rear';
    if(build.selection.spoiler==='stock'){
    const wingRoot=new THREE.Group();wingRoot.name='factory-spoiler';wingRoot.userData.panel='spoiler';chassis.add(wingRoot);
    if(kind==='coupe'){
      for(const side of [-1,1]){box(wingRoot,side*.59,.98,-L*.81,.055,.34,.10,dark);box(wingRoot,side*.97,1.15,-L*.86,.047,.20,.42,paint,true);}
      const wing=box(wingRoot,0,1.14,-L*.86,1.98,.075,.36,graphite,true);wing.rotation.x=-.08;
      box(wingRoot,0,1.18,-L*.93,1.9,.018,.04,accent);
    }else if(kind==='muscle'){
      box(wingRoot,0,.96,-L*.91,W*1.92,.12,.22,graphite,true);
    }else if(kind==='wedge'){
      box(wingRoot,0,.82,-L*.87,W*1.90,.065,.21,paint,true);
    }else{
      box(wingRoot,0,1.40,-1.17,1.48,.07,.24,graphite,true);
      for(const side of [-1,1])box(wingRoot,side*.60,1.14,-1.48,.035,.17,.045,graphite);
    }
    }
    addCosmetics({chassis,selection:build.selection,q,L,W,paint,dark,graphite,chrome,accent,box,panel,beam});
    const wingSource=chassis.children.find(node=>node.userData.panel==='spoiler'),spoilerDebris=wingSource?.clone(true);
    if(spoilerDebris){spoilerDebris.name='DETACHED-SPOILER';spoilerDebris.traverse(node=>{if(node.geometry)node.geometry=node.geometry.clone();});const center=new THREE.Box3().setFromObject(spoilerDebris).getCenter(new THREE.Vector3());for(const child of spoilerDebris.children)child.position.sub(center);spoilerDebris.visible=false;debris.add(spoilerDebris);}
    const flames=[],exhaustMouths=[];
    const pipes=kind==='muscle'?[-.70,.70]:kind==='wedge'?[.60]:[.61,.77];
    for(const x of pipes){
      const pipe=new THREE.Mesh(new THREE.CylinderGeometry(.062,.062,.23,8),chrome);pipe.rotation.x=Math.PI/2;pipe.position.set(x,.32,-L*.976);chassis.add(pipe);
      const hole=new THREE.Mesh(new THREE.CircleGeometry(.049,8),dark);hole.rotation.y=Math.PI;hole.position.set(x,.32,-L*.976-.119);chassis.add(hole);exhaustMouths.push(hole);
      const flame=new THREE.Mesh(new THREE.ConeGeometry(.12,.90,5),new THREE.MeshBasicMaterial({color:NOS_BLUE,transparent:true,opacity:.85,side:THREE.DoubleSide,blending:THREE.AdditiveBlending,depthWrite:false}));flame.rotation.x=-Math.PI/2;flame.position.set(x,.32,-L*.976-.48);flame.visible=false;chassis.add(flame);flames.push(flame);
      const core=new THREE.Mesh(new THREE.ConeGeometry(.055,.58,5),new THREE.MeshBasicMaterial({color:0xe5ffff,transparent:true,opacity:.9,blending:THREE.AdditiveBlending,depthWrite:false}));flame.add(core);
    }
    if(build.selection.chassis==='reinforced'){for(const side of [-1,1]){beam(chassis,[side*W*.68,.40,-.80],[side*q.roofW*.88,q.roof-.08,-.46],.045,graphite);beam(chassis,[side*q.roofW*.88,q.roof-.08,-.46],[-side*W*.68,.40,-.80],.035,graphite);}}
    if(build.selection.radiator!=='stock'||build.selection.oilCooler!=='stock'){for(let n=0;n<5;n++)box(chassis,0,.38+n*.035,L*.965,W*.93,.012,.025,chrome);}
    const wheels=[],spinGroups=[],steeringRods=[],tyreWidth=p.tyreWidth??.27;

    for(let index=0;index<4;index++){
      const front=index<2,side=index%2===0?-1:1;
      const pivot=new THREE.Group();pivot.position.set(side*p.halfTrack,R,front?p.frontAxle:-p.rearAxle);content.add(pivot);
      const spin=new THREE.Group();pivot.add(spin);
      // Hollow sidewalls and an open barrel let the actual disc show between spokes.
      const tyreProfile=[[.72,-.5],[.95,-.5],[1,-.3],[1,.3],[.95,.5],[.72,.5],[.72,-.5]].map(([r,y])=>new THREE.Vector2(R*r,tyreWidth*y));
      const tyre=new THREE.Mesh(new THREE.LatheGeometry(tyreProfile,12),rubber);tyre.rotation.z=Math.PI/2;tyre.castShadow=true;tyre.name='tyre-'+index;spin.add(tyre);
      const rim=new THREE.Mesh(new THREE.CylinderGeometry(R*.72,R*.72,tyreWidth+.005,12,1,true),graphite);rim.rotation.z=Math.PI/2;spin.add(rim);
      if(build.selection.rims==='stock'){
      const ring=new THREE.Mesh(new THREE.TorusGeometry(R*.73,.017,3,12),kind==='muscle'?chrome:white);ring.rotation.y=Math.PI/2;ring.position.x=side*(tyreWidth*.5+.009);spin.add(ring);
      const spokes=kind==='wedge'?3:kind==='tourer'?6:5;
      for(let n=0;n<spokes;n++){const spoke=box(spin,side*(tyreWidth*.5+.010),0,0,.024,kind==='wedge'?.08:.05,R*1.23,kind==='muscle'?chrome:white);spoke.rotation.x=n*Math.PI*2/spokes;}
      }else addRim({spin,style:build.selection.rims,R,side,width:tyreWidth,chrome,graphite,box});
      const hub=new THREE.Mesh(new THREE.CylinderGeometry(.064,.064,tyreWidth+.03,8),dark);hub.rotation.z=Math.PI/2;spin.add(hub);
      const rotor=new THREE.Mesh(new THREE.CylinderGeometry(R*.57,R*.57,.012,12),chrome.clone());rotor.name='brake-rotor-'+index;rotor.material.emissive.set(0xff3b08);rotor.material.emissiveIntensity=0;rotor.rotation.z=Math.PI/2;rotor.position.x=side*(tyreWidth*.5-.015);pivot.add(rotor);
      box(pivot,side*(tyreWidth*.5-.005),.09,.11,.045,.16,.08,accent);
      if(front){const halves=[0,1].map(n=>{const part=beam(content,[0,0,0],[0,1,0],.018,graphite);part.name='tie-rod-'+index+'-'+n;return part;});steeringRods.push({index,side,pivot,halves});}
      wheels.push(pivot);spinGroups.push({spin,pivot,front,side,index,tyre,rotor,tyreBase:tyre.geometry.attributes.position.array.slice(),tyreShape:null});
    }
    const number=decalTexture(spec.number,256,128,'#f5f0da');
    for(const side of [-1,1])decal(chassis,number,side*W*1.01,.68,-.02,.62,.29,side*Math.PI/2);
    const roofNo=decal(chassis,number,0,q.roof+.033,(q.roofBack+q.roofFront)*.5,.63,.39,0,-Math.PI/2);roofNo.rotation.z=Math.PI;
    decal(chassis,decalTexture(spec.number,128,64,'#111321'),0,.605,-L*1.004,.23,.10,Math.PI);
    const shadow=new THREE.Mesh(new THREE.CircleGeometry(1,24),new THREE.MeshBasicMaterial({color:0x080e1b,transparent:true,opacity:.27,depthWrite:false}));shadow.rotation.x=-Math.PI/2;shadow.scale.set(W*1.20,L*1.06,1);shadow.position.y=.018;shadow.renderOrder=1;content.add(shadow);
    const glow=new THREE.Mesh(new THREE.PlaneGeometry(W*1.85,L*1.5),new THREE.MeshBasicMaterial({color:CYAN,transparent:true,opacity:.08,depthWrite:false,blending:THREE.AdditiveBlending}));glow.rotation.x=-Math.PI/2;glow.position.y=.024;content.add(glow);
    const ribbon=new THREE.Group();ribbon.visible=false;content.add(ribbon);
    const ribbonMat=new THREE.MeshBasicMaterial({color:NOS_BLUE,side:THREE.DoubleSide,transparent:true,opacity:.65,depthWrite:false});
    for(const side of [-1,1])panel(ribbon,[[side*W,.53,-L*.86],[side*W*1.3,.80,-L-1.4],[side*W,.55,-L-2.8],[side*W*.8,.48,-L]],ribbonMat,false);
    chassis.updateMatrixWorld(true);const bodyInverse=chassis.matrixWorld.clone().invert(),deformables=[];
    chassis.traverse(node=>{if(node.isMesh){let ancestor=node;while(ancestor&&!node.userData.panel){if(ancestor.userData.panel)node.userData.panel=ancestor.userData.panel;ancestor=ancestor.parent;}}if(!node.isMesh||!node.geometry?.attributes.position||node.material?.blending===THREE.AdditiveBlending)return;const toBody=bodyInverse.clone().multiply(node.matrixWorld);deformables.push({mesh:node,base:node.geometry.attributes.position.array.slice(),toBody,toLocal:toBody.clone().invert()});});
    model={content,chassis,spoilerDebris,paint,headlamp,tail,glow,shadow,flames,exhaustMouths,ribbon,wheels,spinGroups,steeringRods,shell,shellBase,deformables,bodyRevision:-1,bodyState:null,health:1};
  }
  assemble(initialBuild);
  return {
    group,
    get wheels(){return model.wheels;},
    get bounds(){return {...build.vehicle.model};},
    getAudioAnchors(){
      group.updateMatrixWorld(true);
      const p=build.physics,L=build.vehicle.model.length*.5;
      const point=(x,y,z)=>model.chassis.localToWorld(new THREE.Vector3(x,y,z));
      return {
        // Circle vertex 0 is its centre, including the visible body deformation.
        exhaust:model.exhaustMouths.map(mesh=>mesh.localToWorld(new THREE.Vector3().fromBufferAttribute(mesh.geometry.attributes.position,0))),
        intake:point(-.20,.75,L*.52),engine:point(0,.65,L*.43),gearbox:point(0,.28,.20),differential:point(0,.25,p.driveLayout==='AWD'?0:p.driveLayout==='FWD'?p.frontAxle:-p.rearAxle),
        wheels:model.wheels.map(wheel=>wheel.getWorldPosition(new THREE.Vector3())),
        exhaustDirection:new THREE.Vector3(0,0,-1).transformDirection(model.chassis.matrixWorld),frontDirection:new THREE.Vector3(0,0,1).transformDirection(model.chassis.matrixWorld)
      };
    },
    setBuild(nextBuild){if(nextBuild?.physics&&nextBuild?.vehicle)assemble(nextBuild);return this;},
    setColor(hex){paintHex=hex;model.paint.color.set(hex);return this;},
    update(state,dt,time){
      const p=build.physics,m=model;
      m.chassis.rotation.x=clamp(state.bodyPitch||0,-.40,.40);
      m.chassis.rotation.z=clamp(state.bodyRoll||0,-.42,.42);
      m.chassis.position.y=(state.bodyHeight||0)+(p.rideHeight||0);
      for(const w of m.spinGroups){
        w.rotor.material.emissiveIntensity=brakeGlow(state.brakeTemps?.[w.index])*2.5;
        const corner=state.suspension?.[w.index];w.pivot.visible=state.wheelAttached?.[w.index]!==false;
        w.pivot.rotation.y=state.wheelSteers?.[w.index]??(w.front?(state.steer||0):0);w.pivot.rotation.z=clamp(state.wheelCamber?.[w.index]??(state.suspensionHealth?(w.side)*((1-state.suspensionHealth[w.index])*.14-(build.physics.alignmentCamber?.[w.front?0:1]||0)):(-w.side*(build.physics.alignmentCamber?.[w.front?0:1]||0))),-.2,.2);
        w.pivot.position.y=Number.isFinite(corner?.wheelY)?corner.wheelY:p.wheelRadius;
        const angle=state.wheelSpins?.[w.index] ?? (w.front?(w.side<0?state.wheelSpinFL:state.wheelSpinFR):(w.side<0?state.wheelSpinL:state.wheelSpinR));
        w.spin.rotation.x=Number.isFinite(angle)?angle:0;
        const t=state.tyres?.[w.index],scale=t?.casingScale??1,spot=t?.flatspot??0,shape=Math.round(scale*1000)+':'+Math.round(spot*1000)+':'+(t?.flatspotAngle??0);
        if(shape!==w.tyreShape){w.tyreShape=shape;const pos=w.tyre.geometry.attributes.position;for(let j=0;j<pos.count;j++){const x=w.tyreBase[j*3],y=w.tyreBase[j*3+1],z=w.tyreBase[j*3+2],r=Math.hypot(x,z),f=scale*(1-.045*spot*Math.max(0,(-x*Math.cos(t?.flatspotAngle??0)+z*Math.sin(t?.flatspotAngle??0))/Math.max(r,.001))**8);pos.setXYZ(j,x*f,y*(1+(1-scale)*.5),z*f);}pos.needsUpdate=true;w.tyre.geometry.computeVertexNormals();w.tyre.geometry.computeBoundingSphere();}
      }
      for(const r of m.steeringRods){
        const damage=state.mechanical?.chassisDamage?.tieRods?.[r.index],broken=damage?.health<=.025||state.wheelAttached?.[r.index]===false;
        rodStart.set(r.side*.35,.36,p.frontAxle-.17).applyEuler(m.chassis.rotation).add(m.chassis.position);
        rodEnd.set(-r.side*.10,0,-.15).applyEuler(r.pivot.rotation).add(r.pivot.position);
        rodMid.copy(rodStart).lerp(rodEnd,.55);rodMid.z+=(damage?.bend||0)*.35;
        for(let n=0;n<2;n++){const a=n?(broken?rodEnd:rodMid):rodStart,b=n?(broken?rodMid:rodEnd):rodMid,mesh=r.halves[n];rodDirection.copy(b).sub(a);if(broken){rodDirection.multiplyScalar(.42);rodDirection.y-=.14;}mesh.position.copy(a).addScaledVector(rodDirection,.5);mesh.scale.y=rodDirection.length();mesh.quaternion.setFromUnitVectors(rodAxis,rodDirection.normalize());mesh.visible=n===0||r.pivot.visible;}
      }
      m.tail.emissiveIntensity=(state.brake>.1?3:state.headlights?.9:.15)*(state.mechanical?.auxiliaries?.lampFactor??1);
      m.headlamp.emissiveIntensity=(state.headlights?Math.max(.2,2.8*(state.bodyHealth??1)):.015)*(state.mechanical?.auxiliaries?.lampFactor??1);
      m.paint.color.set(paintHex).lerp(damageColour,(1-(state.bodyHealth??1))*.5);
      const body=state.bodyDamage,revision=body?.revision??0;
      if(revision!==m.bodyRevision||body!==m.bodyState){
        m.bodyRevision=revision;m.bodyState=body;
        for(const part of m.deformables){
          const mesh=part.mesh,a=mesh.geometry.attributes.position,detached=body?.zones?.[mesh.userData.panel]?.detached;
          mesh.visible=!detached;
          for(let i=0;i<a.count;i++){
            damagePoint.set(part.base[i*3],part.base[i*3+1],part.base[i*3+2]).applyMatrix4(part.toBody);
            bodyDisplacement(body,damagePoint.x,damagePoint.y,damagePoint.z,damageOffset,mesh.userData.panel);
            damagePoint.x+=damageOffset.x;damagePoint.y+=damageOffset.y;damagePoint.z+=damageOffset.z;damagePoint.applyMatrix4(part.toLocal);a.setXYZ(i,damagePoint.x,damagePoint.y,damagePoint.z);
          }
          a.needsUpdate=true;mesh.geometry.computeVertexNormals();mesh.geometry.computeBoundingSphere();
          const edge=mesh.children.find(n=>n.isLineSegments);if(edge){edge.geometry.dispose();edge.geometry=new THREE.EdgesGeometry(mesh.geometry,24);}
        }
      }
      if(m.spoilerDebris)m.spoilerDebris.visible=false;
      for(let i=0;i<loosePanels.length;i++){const body=state.detachedPanels?.[i],view=loosePanels[i];view.visible=!!body&&body.panel!=='spoiler';if(body?.panel==='spoiler'&&m.spoilerDebris){m.spoilerDebris.visible=true;m.spoilerDebris.position.set(body.x,body.y,body.z);m.spoilerDebris.rotation.set(body.rotation||0,body.heading||0,(body.rotation||0)*.35);}if(body){view.position.set(body.x,body.y,body.z);view.rotation.set(body.rotation||0,body.heading||0,(body.rotation||0)*.35);view.scale.set(body.width||2,1,1);}}
      for(let i=0;i<looseWheels.length;i++){const body=state.detachedWheels?.[i],view=looseWheels[i];view.pivot.visible=!!body;if(body){view.pivot.position.set(body.x,body.y,body.z);view.pivot.rotation.set(0,body.heading||0,Math.min(.8,(body.age||0)*.03));view.pivot.scale.setScalar(body.radius||p.wheelRadius);view.spin.rotation.x=body.spin||0;}}

      m.glow.material.opacity=state.boosting?.26:.065;m.glow.material.color.set(state.boosting?NOS_BLUE:CYAN);
      const terrain=state.suspension?.length?state.suspension.reduce((a,w)=>a+(w.groundHeight||0),0)/4:0;
      m.shadow.position.y=terrain+.018;m.glow.position.y=terrain+.024;
      m.shadow.material.opacity=.27*clamp(1-Math.max(0,(state.bodyHeight||0)-terrain)*.8,.15,1);
      m.flames.forEach((flame,i)=>{flame.visible=!!state.boosting&&state.engineRunning!==false;flame.scale.y=1.05+(state.nitrousIntensity??1)*.8+Math.sin(time*32+i*3)*.08;});
      m.ribbon.visible=!!state.boosting;m.ribbon.scale.z=.85+Math.sin(time*35)*.12;
    },
    dispose(){disposeModel();scene.remove(group,debris);debrisTyre.dispose();debrisRim.dispose();debrisRubber.dispose();debrisMetal.dispose();panelGeometry.dispose();panelMaterial.dispose();}
  };
}

export function createEffects(scene, initialBuild = resolveBuild()) {
  let build=initialBuild;
  const lastBursts=[null,null,null,null];let burstParticles=0;
  const terrain=createTerrainEffects(scene,initialBuild);
  const FX_COUNT=160, SKID_COUNT=400, TRAIL_COUNT=60;
  const dummy=new THREE.Object3D();
  const puffGeo=new THREE.IcosahedronGeometry(1,0);
  const puffMat=new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:.63,depthWrite:false});
  const particles=new THREE.InstancedMesh(puffGeo,puffMat,FX_COUNT);particles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);particles.frustumCulled=false;particles.renderOrder=4;scene.add(particles);
  const particlesData=Array.from({length:FX_COUNT},()=>({life:0,max:1,x:0,y:0,z:0,vx:0,vy:0,vz:0,size:0,rot:0,kind:0}));
  const smokeColors=[new THREE.Color(0xf7c3dd),new THREE.Color(0xd8dbef),new THREE.Color(0xc6f6eb),new THREE.Color(0xf2eddd)];
  const dustColors=[new THREE.Color(0xae9c7d),new THREE.Color(0x948d77),new THREE.Color(0xb8a78d)];
  const coolantSteam=[new THREE.Color(0xe0e9eb),new THREE.Color(0xc9d6e1),new THREE.Color(0xf0eeec)];
  const engineSmoke=[new THREE.Color(0x646872),new THREE.Color(0x8a8b93),new THREE.Color(0x3d4652)];
  const earthColors=[new THREE.Color(0x8c8663),new THREE.Color(0x6c7958),new THREE.Color(0xa09b78)];
  const rubberColors=[new THREE.Color(0x15151b),new THREE.Color(0x292933),new THREE.Color(0x393941)];
  const sprayColors=[new THREE.Color(0xaecbd6),new THREE.Color(0xc6dbe2)];
  const sparkColors=[new THREE.Color(ACID),new THREE.Color(0xffb74c),new THREE.Color(PINK)];
  const skidGeo=new THREE.PlaneGeometry(1,1);skidGeo.rotateX(-Math.PI/2);
  const skids=new THREE.InstancedMesh(skidGeo,new THREE.MeshBasicMaterial({color:0x181629,transparent:true,opacity:.48,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1}),SKID_COUNT);
  skids.instanceMatrix.setUsage(THREE.DynamicDrawUsage);skids.frustumCulled=false;skids.renderOrder=1;scene.add(skids);
  const trailGeo=new THREE.PlaneGeometry(1,1);trailGeo.rotateX(-Math.PI/2);
  const trails=new THREE.InstancedMesh(trailGeo,new THREE.MeshBasicMaterial({color:NOS_BLUE,transparent:true,opacity:.65,side:THREE.DoubleSide,depthWrite:false}),TRAIL_COUNT);
  trails.instanceMatrix.setUsage(THREE.DynamicDrawUsage);trails.frustumCulled=false;trails.renderOrder=2;scene.add(trails);
  const trailData=Array.from({length:TRAIL_COUNT},()=>({life:0,x:0,z:0,heading:0,length:0,side:0}));
  let pIndex=0,sIndex=0,tIndex=0,trailClock=0,damageClock=0;
  const wheelClocks=[0,0,0,0],lastContacts=[null,null,null,null],burnoutStamps=[null,null,null,null],wheelParticles=[0,0,0,0];
  const zero=()=>{dummy.position.set(0,-1000,0);dummy.scale.setScalar(0);dummy.rotation.set(0,0,0);dummy.updateMatrix();};
  zero();
  for(let i=0;i<FX_COUNT;i++)particles.setMatrixAt(i,dummy.matrix);
  for(let i=0;i<SKID_COUNT;i++)skids.setMatrixAt(i,dummy.matrix);
  for(let i=0;i<TRAIL_COUNT;i++)trails.setMatrixAt(i,dummy.matrix);
  function spawn(x,y,z,vx,vz,intensity,kind=0){
    const p=particlesData[pIndex],spray=kind===7,spark=kind===1,rubber=kind===6,dust=kind===2||kind===3;p.life=p.max=spray?.25+Math.random()*.25:spark?.28+Math.random()*.3:dust?.35+Math.random()*.4:.45+Math.random()*.5;
    p.x=x;p.y=y;p.z=z;p.floor=spray?y-.08:rubber?y-.16:dust?y-.065:.08;p.vx=vx+(Math.random()-.5)*(spark?10:dust?1.2:2);p.vy=spray?.3+Math.random()*.5:spark?1+Math.random()*4:dust?.25+Math.random()*.3:.6+Math.random();p.vz=vz+(Math.random()-.5)*(spark?10:dust?1.2:2);
    p.size=spray?.035+intensity*.06:rubber?.025+Math.random()*.025:spark?.035+Math.random()*.035:dust?.065+intensity*.11+Math.random()*.04:.13+intensity*.12+Math.random()*.1;p.rot=Math.random()*Math.PI*2;p.kind=kind;
    const colors=spray?sprayColors:rubber?rubberColors:kind===5?coolantSteam:kind===4?engineSmoke:spark?sparkColors:kind===2?dustColors:kind===3?earthColors:smokeColors;
    particles.setColorAt(pIndex,colors[Math.floor(Math.random()*colors.length)]);
    pIndex=(pIndex+1)%FX_COUNT;
  }
  function skid(a,b){
    const dx=b.x-a.x,dz=b.z-a.z,len=Math.hypot(dx,dz);
    if(len<.42)return false;
    if(len>5)return true;
    dummy.position.set((a.x+b.x)/2,.037+((a.y||0)+(b.y||0))*.5,(a.z+b.z)/2);dummy.rotation.set(0,Math.atan2(dx,dz),0);dummy.scale.set(.28,1,len+.07);dummy.updateMatrix();skids.setMatrixAt(sIndex,dummy.matrix);sIndex=(sIndex+1)%SKID_COUNT;return true;
  }
  function contact(s,index){
    const fX=Math.sin(s.heading),fZ=Math.cos(s.heading),rX=fZ,rZ=-fX,p=build.physics;
    const side=index%2?1:-1,axle=index<2?p.frontAxle:-p.rearAxle,corner=s.suspension?.[index];
    return {x:s.x+fX*axle+rX*side*p.halfTrack,z:s.z+fZ*axle+rZ*side*p.halfTrack,y:corner?.groundHeight||0,contact:corner?.contact!==false};
  }
  function stamp(p,heading){
    dummy.position.set(p.x,p.y+.039,p.z);dummy.rotation.set(0,heading,0);dummy.scale.set(.29,1,.68);dummy.updateMatrix();skids.setMatrixAt(sIndex,dummy.matrix);sIndex=(sIndex+1)%SKID_COUNT;
  }
  return {
    setBuild(nextBuild){if(nextBuild?.physics){build=nextBuild;terrain.setBuild(nextBuild);}this.reset();return this;},
    setGroundSampler(fn){terrain.setGroundSampler(fn);return this;},
    debug(){return {wheelParticles:[...wheelParticles],activeParticles:particlesData.filter(p=>p.life>0).length,burstParticles,activeRubber:particlesData.filter(p=>p.life>0&&p.kind===6).length,activeSmoke:particlesData.filter(p=>p.life>0&&p.kind===0).length,activeSpray:particlesData.filter(p=>p.life>0&&p.kind===7).length,activeSteam:particlesData.filter(p=>p.life>0&&p.kind===5).length,activeEngineSmoke:particlesData.filter(p=>p.life>0&&p.kind===4).length,activeDust:particlesData.filter(p=>p.life>0&&(p.kind===2||p.kind===3)).length,terrain:terrain.diagnostics(),skidCursor:sIndex,carId:build.vehicle.id};},
    update(s,dt,time){
      terrain.update(s,dt);
      const speed=s.speed||0;
      const fX=Math.sin(s.heading),fZ=Math.cos(s.heading);trailClock+=dt;damageClock+=dt;
      if(damageClock>.10){damageClock=0;const steam=clamp(s.mechanical?.steam??0,0,1),smoke=clamp(s.mechanical?.smoke??((s.engineHealth??1)<.55?1-(s.engineHealth??1):0),0,1);if(steam>.025)spawn(s.x+fX*1.2,(s.bodyHeight||0)+.9,s.z+fZ*1.2,-fX*speed*.04,-fZ*speed*.04,steam,5);if(smoke>.025&&s.engineRunning)spawn(s.x-fX*build.vehicle.model.length*.48,(s.bodyHeight||0)+.36,s.z-fZ*build.vehicle.model.length*.48,-fX*(speed*.04+.4),-fZ*(speed*.04+.4),smoke,4);if((s.bodyScrape||0)>250&&speed>1)spawn(s.x,(s.groundHeight||0)+.09,s.z,-fX*speed*.14,-fZ*speed*.14,.7,1);}

      for(let i=0;i<4;i++){
        const wheel=s.wheelAudio?.[i],point=contact(s,i),corner=s.suspension?.[i];
        const tyre=s.tyres?.[i];if(tyre&&lastBursts[i]!=null&&tyre.burstCount>lastBursts[i]&&s.wheelAttached?.[i]!==false){for(let n=0;n<10;n++)spawn(point.x,point.y+.16,point.z,-fX*speed*.12,-fZ*speed*.12,.7,6);burstParticles+=10;}lastBursts[i]=tyre?.burstCount??0;
        const surface=wheel?.surface||corner?.material||'asphalt',loose=['gravel','grass','dirt'].includes(surface);
        const fallbackSlip=s.wheelOmegas?Math.abs(s.wheelOmegas[i]*build.physics.wheelRadius-(s.forwardSpeed||0)):Math.abs(s.wheelSlip?.[i]??(i<2?0:i%2?s.wheelSlipR||0:s.wheelSlipL||0))*Math.max(5,speed);
        const slip=Math.abs(wheel?.slipSpeed??fallbackSlip),lateral=Math.abs(wheel?.lateralSpeed??Math.sin(s.driftAngle||0)*speed),rolling=Math.abs(wheel?.longitudinalSpeed??speed);
        const grounded=point.contact&&wheel?.contact!==false&&(wheel?.load===undefined||wheel.load>1);
        const sliding=grounded&&speed>3&&(slip>2.4||lateral>1),burnout=grounded&&speed<8&&slip>3;
        const wetness=wheel?.wetness??corner?.wetness??0,spray=grounded&&wetness>.15&&rolling>5;
        const dust=grounded&&wetness<.3&&loose&&(rolling>3||slip>2.5||lateral>1.3);
        if(wetness<.3&&!loose&&sliding){if(!lastContacts[i]||skid(lastContacts[i],point))lastContacts[i]=point;}else lastContacts[i]=null;
        if(wetness<.3&&!loose&&burnout){if(!burnoutStamps[i]||Math.hypot(point.x-burnoutStamps[i].x,point.z-burnoutStamps[i].z)>.35){stamp(point,s.heading);burnoutStamps[i]=point;}}else burnoutStamps[i]=null;
        const emitting=spray||dust||wetness<.3&&!loose&&(sliding||burnout);
        if(!emitting){wheelClocks[i]=0;continue;}
        const temperatureFactor=.55+.45*clamp(((s.tyreTemps?.[i]??24)-24)/130,0,1);const intensity=spray?clamp(rolling/35,0,1)*wetness:loose?clamp(rolling*.008+slip*.027+lateral*.06,.08,.8)*(surface==='grass'?.6:1):clamp(lateral*.15+slip*.027,0,1)*temperatureFactor*(tyre?.blown?.35:1);
        wheelClocks[i]+=dt;
        if(wheelClocks[i]>(spray?.07:loose?.10-intensity*.045:.025)){
          wheelClocks[i]=0;wheelParticles[i]++;
          spawn(point.x,point.y+(loose?.08:.19),point.z,-fX*(speed*.08+slip*.025),-fZ*(speed*.08+slip*.025),intensity,spray?7:loose?(surface==='grass'?3:2):0);
        }
      }
      if(s.boosting&&speed>4&&trailClock>.033){
        trailClock=0;
        const fX=Math.sin(s.heading),fZ=Math.cos(s.heading);
        for(const side of [-1,1]){
          const p=trailData[tIndex];p.life=.32;p.x=s.x-fX*2.2+fZ*side*.91;p.z=s.z-fZ*2.2-fX*side*.91;p.heading=s.heading;p.length=.8+speed*.045;p.side=side;tIndex=(tIndex+1)%TRAIL_COUNT;
        }
      }
      for(let i=0;i<FX_COUNT;i++){
        const p=particlesData[i];
        if(p.life<=0){zero();particles.setMatrixAt(i,dummy.matrix);continue;}
        p.life=Math.max(0,p.life-dt);p.x+=p.vx*dt;p.y+=p.vy*dt;p.z+=p.vz*dt;p.vx*=Math.exp(-dt*2);p.vz*=Math.exp(-dt*2);if(p.kind===1||p.kind===6||p.kind===7)p.vy-=10*dt;
        const age=1-p.life/p.max;
        const size=p.kind===6?p.size*(1-age*.5):p.kind===1?p.size*(1-age):p.size*(1+age*(p.kind>=2?2:3.3))*Math.min(1,p.life*5);
        dummy.position.set(p.x,Math.max(p.floor??.08,p.y),p.z);dummy.rotation.set(p.rot+age,p.rot*.5+time*.2,p.rot*.8);dummy.scale.set(size,p.kind===1?size*3:size*.8,size);dummy.updateMatrix();particles.setMatrixAt(i,dummy.matrix);
      }
      for(let i=0;i<TRAIL_COUNT;i++){
        const p=trailData[i];p.life=Math.max(0,p.life-dt);
        if(p.life<=0){zero();trails.setMatrixAt(i,dummy.matrix);continue;}
        dummy.position.set(p.x,.06,p.z);dummy.rotation.set(0,p.heading,0);dummy.scale.set(.11*p.life/.32,1,p.length);dummy.updateMatrix();trails.setMatrixAt(i,dummy.matrix);
      }
      particles.instanceMatrix.needsUpdate=true;if(particles.instanceColor)particles.instanceColor.needsUpdate=true;
      skids.instanceMatrix.needsUpdate=true;trails.instanceMatrix.needsUpdate=true;
    },
    impact(x,z,strength=1){for(let i=0;i<Math.min(24,Math.ceil(8+strength*12));i++)spawn(x,.35,z,0,0,strength,1);},
    reset(){
      terrain.reset();lastBursts.fill(null);burstParticles=0;
      for(const p of particlesData)p.life=0;for(const p of trailData)p.life=0;
      zero();for(let i=0;i<SKID_COUNT;i++)skids.setMatrixAt(i,dummy.matrix);skids.instanceMatrix.needsUpdate=true;
      for(let i=0;i<FX_COUNT;i++)particles.setMatrixAt(i,dummy.matrix);particles.instanceMatrix.needsUpdate=true;
      for(let i=0;i<TRAIL_COUNT;i++)trails.setMatrixAt(i,dummy.matrix);trails.instanceMatrix.needsUpdate=true;
      lastContacts.fill(null);burnoutStamps.fill(null);wheelClocks.fill(0);wheelParticles.fill(0);trailClock=0;damageClock=0;
    }
  };
}
