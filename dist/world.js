import * as THREE from './vendor/three.module.js';
import {createFacadeSampler} from './audio/geometry.js';

/** Original procedural dock district. All geometry and lettering are made locally. */
export function createWorld(scene) {
  const root = new THREE.Group();
  root.name = 'DOCK-09';
  scene.add(root);
  const C = {
    ink: 0x17262c, asphalt: 0x303b43, shoulder: 0x24313a, sand: 0x66817b,
    lime: 0xd7ff45, pale: 0xd5dec0, coral: 0xf06a80, teal: 0x397f84,
    water: 0x3d7184, waterLight: 0x69979b, purple: 0x64516f, brick: 0x986976,
    metal: 0x869c98, darkTeal: 0x275c64, grass: 0x6c8b71,
  };
  let seed = 90427;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: .94, metalness: .03, flatShading: true, ...extra });
  const M = {};
  Object.entries(C).forEach(([k, c]) => { M[k] = mat(c); });
  M.lamp = mat(0xffe8aa, { emissive: 0xffd58a, emissiveIntensity: 1.5 });
  M.neon = mat(C.lime, { emissive: C.lime, emissiveIntensity: .28 });
  M.glass = mat(0x96bfc3, { roughness: .32, metalness: .16 });
  M.black = mat(0x101e28);
  const geometries = {
    box: new THREE.BoxGeometry(1, 1, 1),
    cone: new THREE.ConeGeometry(1, 1, 5),
    cylinder: new THREE.CylinderGeometry(1, 1, 1, 6),
    leaf: new THREE.IcosahedronGeometry(1, 0),
  };
  const batches = new Map(), colliders = [];
  const dummy = new THREE.Object3D();
  function instance(type, material, x, y, z, sx, sy, sz, ry = 0, rz = 0) {
    let byGeometry = batches.get(material);
    if (!byGeometry) batches.set(material, byGeometry = new Map());
    let list = byGeometry.get(type);
    if (!list) byGeometry.set(type, list = []);
    dummy.position.set(x, y, z); dummy.rotation.set(0, ry, rz); dummy.scale.set(sx, sy, sz); dummy.updateMatrix();
    list.push(dummy.matrix.clone());
  }
  function box(x, y, z, sx, sy, sz, material = M.ink, ry = 0) {
    instance('box', material, x, y, z, sx, sy, sz, ry);
  }
  function beam(a, b, width, material = M.ink) {
    const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b), delta = vb.clone().sub(va);
    dummy.position.copy(va).add(vb).multiplyScalar(.5);
    dummy.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.clone().normalize());
    dummy.scale.set(width, delta.length(), width); dummy.updateMatrix();
    let byGeometry = batches.get(material);
    if (!byGeometry) batches.set(material, byGeometry = new Map());
    let list = byGeometry.get('box');
    if (!list) byGeometry.set('box', list = []);
    list.push(dummy.matrix.clone());
  }
  function addCollider(x, z, hx, hz, heading=0, material='metal', kind='structure') { colliders.push({ x, z, hx, hz, heading, material, kind }); }

  const control = [
    [-174, 68], [-181, -46], [-142, -139], [-56, -171],
    [38, -141], [132, -157], [187, -75], [159, 24],
    [188, 106], [105, 164], [-21, 150], [-120, 145],
  ];
  const curve = new THREE.CatmullRomCurve3(control.map(([x, z]) => new THREE.Vector3(x, .06, z)), true, 'catmullrom', .42);
  curve.arcLengthDivisions = 1600;
  const length = curve.getLength();
  const N = 480;
  const samples = Array.from({ length: N }, (_, i) => {
    const progress = i / N, p = curve.getPointAt(progress), t = curve.getTangentAt(progress);
    return { x: p.x, z: p.z, tx: t.x, tz: t.z, progress };
  });
  const mapPoints = samples.filter((_, i) => i % 4 === 0).map(s => ({ x: s.x, z: s.z }));
  function getRoadInfo(x, z) {
    let best = Infinity, bx = 0, bz = 0, bi = 0, bt = 0;
    for (let i = 0; i < N; i++) {
      const a = samples[i], b = samples[(i + 1) % N], dx = b.x - a.x, dz = b.z - a.z;
      const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz)));
      const px = a.x + dx * t, pz = a.z + dz * t, d = (x - px) ** 2 + (z - pz) ** 2;
      if (d < best) { best = d; bx = px; bz = pz; bi = i; bt = t; }
    }
    const a = samples[bi], b = samples[(bi + 1) % N], dx = b.x - a.x, dz = b.z - a.z;
    const norm = Math.hypot(dx, dz), distance = Math.sqrt(best);
    return { onRoad: distance <= 12.35, grip: distance <= 12.35 ? 1 : distance <= 14.4 ? .87 : .57,
      progress: ((bi + bt) / N) % 1, distance, segment: bi, fraction: bt,
      tangent: { x: dx / norm, z: dz / norm }, nearest: { x: bx, z: bz } };
  }
  const GROUND_HEIGHT=-.06, ROAD_HEIGHT=.012;
  const expansionJoints=[.20,.50,.79].map(progress=>({progress,height:.04,length:6}));
  const surfacePlates=expansionJoints.map(joint=>({...at(joint.progress),progress:joint.progress,width:23.6,depth:1.3,material:'metal'}));
  const surfaceMaterials={
    asphalt:{grip:1,roughness:.001},concrete:{grip:.94,roughness:.004},
    curb:{grip:.86,roughness:.012},gravel:{grip:.60,roughness:.027},
    grass:{grip:.48,roughness:.022},metal:{grip:.88,roughness:.006}
  };
  // Material patches are visible, walkable pieces of the dock. Their sampled
  // boundaries use the same polygon as the mesh, never an invisible sound zone.
  const surfacePatches=[
    {progress:.085,offset:21,rx:6,rz:18,material:'gravel'},
    {progress:.39,offset:-22,rx:7,rz:21,material:'gravel'},
    {progress:.68,offset:21,rx:6,rz:20,material:'gravel'},
    {progress:.29,offset:-25,rx:9,rz:17,material:'grass'},
    {progress:.89,offset:-24,rx:8,rz:19,material:'grass'}
  ].map(p=>{
    const center=at(p.progress,p.offset),sn=Math.sin(center.heading),cs=Math.cos(center.heading);
    return {...p,x:center.x,z:center.z,heading:center.heading,vertices:Array.from({length:20},(_,i)=>{const angle=i/20*Math.PI*2,lx=Math.cos(angle)*p.rx,lz=Math.sin(angle)*p.rz;return {x:center.x+cs*lx+sn*lz,z:center.z-sn*lx+cs*lz};})};
  });
  function insidePatch(x,z,patch){
    if(Math.abs(x-patch.x)>patch.rx+patch.rz||Math.abs(z-patch.z)>patch.rx+patch.rz)return false;
    let inside=false;const points=patch.vertices;
    for(let i=0,j=points.length-1;i<points.length;j=i++){
      const a=points[i],b=points[j];
      if((a.z>z)!==(b.z>z)&&x<(b.x-a.x)*(z-a.z)/(b.z-a.z)+a.x)inside=!inside;
    }
    return inside;
  }
  // Rendering and collision share the same piecewise-linear triangle surface.
  // Extra rows resolve the smooth 6m joint profile without increasing the whole road mesh.
  const crossOffsets=[-14.5,-14,-13.3,-12.92,-12.28,-12,12,12.28,12.92,13.3,14,14.5];
  const rowProgress=Array.from({length:N+1},(_,i)=>i/N);
  for(const joint of expansionJoints)for(let offset=-3;offset<=3;offset+=.5)rowProgress.push(joint.progress+offset/length);
  rowProgress.sort((a,b)=>a-b);
  const uniqueProgress=rowProgress.filter((v,i)=>i===0||v-rowProgress[i-1]>1e-9);
  function jointRise(progress){
    let rise=0;
    for(const joint of expansionJoints){const delta=Math.abs(progress-joint.progress),distance=Math.min(delta,1-delta)*length;if(distance<joint.length*.5)rise+=joint.height*.5*(1+Math.cos(Math.PI*distance/(joint.length*.5)));}
    return rise;
  }
  function crossHeight(offset,progress){
    const d=Math.abs(offset),rise=jointRise(progress)*Math.max(0,Math.min(1,(14.5-d)/.5));
    let base=GROUND_HEIGHT;
    if(d<=12)base=ROAD_HEIGHT;
    else if(d<12.28)base=ROAD_HEIGHT+(d-12)/.28*.11;
    else if(d<=12.92)base=ROAD_HEIGHT+.11;
    else if(d<13.3)base=ROAD_HEIGHT+.11-(d-12.92)/.38*.12;
    else if(d<=14)base=.002;
    else if(d<14.5)base=.002+(d-14)/.5*(GROUND_HEIGHT-.002);
    return base+rise;
  }
  const surfaceRows=uniqueProgress.map(progress=>{
    const f=progress*N,i=Math.min(N-1,Math.floor(f+1e-8)),blend=progress===1?1:f-i,a=samples[i],b=samples[(i+1)%N];
    const tx=a.tx+(b.tx-a.tx)*blend,tz=a.tz+(b.tz-a.tz)*blend,norm=Math.hypot(tx,tz);
    return {progress,x:a.x+(b.x-a.x)*blend,z:a.z+(b.z-a.z)*blend,tx:tx/norm,tz:tz/norm};
  });
  const surfaceVertices=surfaceRows.map(row=>crossOffsets.map(offset=>({x:row.x+row.tz*offset,z:row.z-row.tx*offset,y:crossHeight(offset,row.progress)})));
  const segmentRows=Array.from({length:N},()=>[]);
  for(let i=0;i<surfaceRows.length-1;i++)segmentRows[Math.min(N-1,Math.floor(surfaceRows[i].progress*N+1e-7))].push(i);
  function triangleHeight(x,z,a,b,c){
    const denominator=(b.z-c.z)*(a.x-c.x)+(c.x-b.x)*(a.z-c.z);
    if(Math.abs(denominator)<1e-12)return null;
    const u=((b.z-c.z)*(x-c.x)+(c.x-b.x)*(z-c.z))/denominator;
    const v=((c.z-a.z)*(x-c.x)+(a.x-c.x)*(z-c.z))/denominator,w=1-u-v;
    return u>=-1e-7&&v>=-1e-7&&w>=-1e-7?a.y*u+b.y*v+c.y*w:null;
  }
  function getSurfaceAt(x,z){
    if(!Number.isFinite(x)||!Number.isFinite(z))return {height:GROUND_HEIGHT,...surfaceMaterials.concrete,material:'concrete',onRoad:false};
    const road=getRoadInfo(x,z),d=road.distance;
    let height=null;
    if(d<15.1){
      search:for(let adjacent=-1;adjacent<=1;adjacent++){
        const segment=(road.segment+adjacent+N)%N;
        for(const row of segmentRows[segment])for(let col=0;col<crossOffsets.length-1;col++){
          const a=surfaceVertices[row][col],b=surfaceVertices[row+1][col],c=surfaceVertices[row][col+1],e=surfaceVertices[row+1][col+1];
          height=triangleHeight(x,z,a,b,c);
          if(height===null)height=triangleHeight(x,z,c,b,e);
          if(height!==null)break search;
        }
      }
    }
    let material=d<=12?'asphalt':d<=13.3?'curb':'concrete';
    if(d>14.5){const patch=surfacePatches.find(p=>insidePatch(x,z,p));if(patch)material=patch.material;}
    if(d<=12&&surfacePlates.some(p=>{const dx=x-p.x,dz=z-p.z,sn=Math.sin(p.heading),cs=Math.cos(p.heading);return Math.abs(dx*cs-dz*sn)<=p.width*.5&&Math.abs(dx*sn+dz*cs)<=p.depth*.5;}))material='metal';
    return {height:height===null?GROUND_HEIGHT:height,...surfaceMaterials[material],material,onRoad:d<=12};
  }
  function at(t, offset = 0) {
    const p = curve.getPointAt((t + 1) % 1), d = curve.getTangentAt((t + 1) % 1);
    return { x: p.x + d.z * offset, z: p.z - d.x * offset, heading: Math.atan2(d.x, d.z), tx: d.x, tz: d.z };
  }
  const s = at(.985);
  const spawn = { x: s.x, z: s.z, heading: s.heading };
  const checkpoints = Array.from({ length: 8 }, (_, i) => ({ ...at(i / 8), progress: i / 8 }));

  // A bevelled, asymmetrical dock island, with deep water visible at its edges.
  const shore = [[-244,-211],[-158,-237],[32,-228],[211,-220],[249,-155],[241,-22],[254,135],[202,207],[36,222],[-142,209],[-236,158],[-253,-26]];
  const island = new THREE.Shape();
  shore.forEach(([x,z],i) => i ? island.lineTo(x,z) : island.moveTo(x,z)); island.closePath();
  const groundGeo = new THREE.ExtrudeGeometry(island, { depth: 5.6, bevelEnabled: true, bevelSegments: 1, steps: 1, bevelSize: .9, bevelThickness: .7 });
  groundGeo.rotateX(Math.PI / 2);
  groundGeo.translate(0,-.7,0); // Normalize the bevel cap so the visible top is local y=0.
  const ground = new THREE.Mesh(groundGeo, [M.sand, M.darkTeal]); ground.position.y = GROUND_HEIGHT; ground.name='dock-ground'; ground.receiveShadow = true; root.add(ground);
  const patchMats={gravel:mat(0x8b8671),grass:mat(0x57765d)};
  for(const patch of surfacePatches){
    const positions=[],colors=[],color=new THREE.Color(patchMats[patch.material].color);
    for(let i=0;i<patch.vertices.length;i++){
      const a=patch.vertices[i],b=patch.vertices[(i+1)%patch.vertices.length];
      positions.push(patch.x,GROUND_HEIGHT+.001,patch.z,a.x,GROUND_HEIGHT+.001,a.z,b.x,GROUND_HEIGHT+.001,b.z);
      const shade=.93+(i%5)*.025;for(let j=0;j<3;j++)colors.push(color.r*shade,color.g*shade,color.b*shade);
    }
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geometry.computeVertexNormals();
    const mesh=new THREE.Mesh(geometry,mat(0xffffff,{vertexColors:true,side:THREE.DoubleSide}));mesh.name='surface-'+patch.material;mesh.userData.surfaceMaterial=patch.material;mesh.userData.patch=patch;mesh.receiveShadow=true;root.add(mesh);
    // Tiny embedded flecks suggest aggregate and blades without extra draw calls.
    for(let i=0;i<90;i++){
      const angle=rnd()*Math.PI*2,rad=Math.sqrt(rnd())*.92,sn=Math.sin(patch.heading),cs=Math.cos(patch.heading),lx=Math.cos(angle)*patch.rx*rad,lz=Math.sin(angle)*patch.rz*rad;
      const x=patch.x+cs*lx+sn*lz,z=patch.z-sn*lx+cs*lz;
      if(getRoadInfo(x,z).distance<=14.6)continue;
      const gravel=patch.material==='gravel',size=gravel?.07+rnd()*.10:.09+rnd()*.13;
      box(x,GROUND_HEIGHT+(gravel?.012:.022),z,size,gravel?.018:.035,gravel?size:.04,gravel?(i%3?M.pale:M.shoulder):M.grass,rnd()*6.28);
    }
  }
  const waterMat = mat(C.water, { roughness: .34, metalness: .08 });
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(2200, 2200), waterMat);
  sea.rotation.x = -Math.PI / 2; sea.position.y = -4.6; root.add(sea);
  const waterLines = [];
  const rippleGeo = new THREE.PlaneGeometry(1, 1);
  rippleGeo.rotateX(-Math.PI / 2);
  const rippleMat = new THREE.MeshBasicMaterial({ color: C.waterLight, transparent: true, opacity: .28, depthWrite: false });
  for (let i = 0; i < 95; i++) {
    const x = (rnd()-.5)*1100, z = (rnd()-.5)*1100;
    if (Math.abs(x) < 262 && Math.abs(z) < 240) continue;
    waterLines.push({x,z,width:8+rnd()*32,depth:.3+rnd()*1.1,phase:rnd()*Math.PI*2});
  }
  const ripples = new THREE.InstancedMesh(rippleGeo, rippleMat, waterLines.length);
  ripples.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  waterLines.forEach((q,i)=>{
    dummy.position.set(q.x,-4.57,q.z);dummy.rotation.set(0,0,0);dummy.scale.set(q.width,1,q.depth);dummy.updateMatrix();ripples.setMatrixAt(i,dummy.matrix);
  });
  root.add(ripples);
  for (let i=0;i<shore.length;i++) {
    const a=shore[i],b=shore[(i+1)%shore.length],dist=Math.hypot(b[0]-a[0],b[1]-a[1]),angle=Math.atan2(b[0]-a[0],b[1]-a[1]);
    box((a[0]+b[0])/2,-.05,(a[1]+b[1])/2,1.8,.7,dist,M.metal,angle);
    const count=Math.max(1,Math.floor(dist/19));
    for(let k=0;k<count;k++){const q=(k+.4)/count;box(a[0]+(b[0]-a[0])*q,-1.8,a[1]+(b[1]-a[1])*q,2.6,4.8,2.6,M.ink);}
  }

  function ribbon(offset,width,elevation,material,vertexColor=false,name='road-detail'){
    const positions=[],indices=[],colors=[];
    const c0=new THREE.Color(C.lime),c1=new THREE.Color(C.pale);
    for(let i=0;i<surfaceRows.length;i++){
      const q=surfaceRows[i];
      for(const edge of [-.5,.5]){
        const lateral=offset+width*edge,x=q.x+q.tz*lateral,z=q.z-q.tx*lateral;
        positions.push(x,crossHeight(lateral,q.progress)+elevation,z);
        if(vertexColor){const c=Math.floor(q.progress*N/6)%2?c0:c1;colors.push(c.r,c.g,c.b);}
      }
      if(i<surfaceRows.length-1){const k=i*2;indices.push(k,k+2,k+1,k+1,k+2,k+3);}
    }
    const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geo.setIndex(indices);geo.computeVertexNormals();
    if(vertexColor)geo.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
    const mesh=new THREE.Mesh(geo,material);mesh.name=name;mesh.userData.surfaceElevation=elevation;mesh.receiveShadow=true;root.add(mesh);return mesh;
  }
  M.asphalt.side=THREE.DoubleSide;M.shoulder.side=THREE.DoubleSide;M.pale.side=THREE.DoubleSide;
  ribbon(0,24,0,M.asphalt,false,'road-asphalt');
  for(const side of [-1,1]){
    ribbon(side*13.65,.7,0,M.shoulder,false,'road-shoulder');
    ribbon(side*14.25,.5,0,M.shoulder,false,'road-edge-ramp');
  }
  const curbMat=mat(0xffffff,{vertexColors:true,side:THREE.DoubleSide});
  for(const side of [-1,1])for(const [inner,outer] of [[12,12.28],[12.28,12.92],[12.92,13.3]])ribbon(side*(inner+outer)*.5,outer-inner,0,curbMat,true,'road-curb');
  ribbon(-11.55,.17,.010,M.pale,false,'road-edge-line');ribbon(11.55,.17,.010,M.pale,false,'road-edge-line');
  const oldRubber=mat(0x243039,{side:THREE.DoubleSide});
  ribbon(-2.8,.17,.007,oldRubber,false,'road-rubber');ribbon(-1.3,.17,.007,oldRubber,false,'road-rubber');
  ribbon(2.2,.12,.007,oldRubber,false,'road-rubber');ribbon(3.7,.12,.007,oldRubber,false,'road-rubber');
  // Paint is tessellated and draped on the same surface as the tyres.
  const roadPaint=new Map();
  function paintQuad(x,z,width,depth,heading,material){
    let batch=roadPaint.get(material);if(!batch)roadPaint.set(material,batch={positions:[],indices:[]});
    const subdivisions=Math.max(1,Math.ceil(depth/.4)),sn=Math.sin(heading),cs=Math.cos(heading),start=batch.positions.length/3;
    for(let i=0;i<=subdivisions;i++)for(const side of [-.5,.5]){
      const along=(i/subdivisions-.5)*depth,lateral=side*width,px=x+cs*lateral+sn*along,pz=z-sn*lateral+cs*along;
      batch.positions.push(px,getSurfaceAt(px,pz).height+.009,pz);
    }
    for(let i=0;i<subdivisions;i++){const k=start+i*2;batch.indices.push(k,k+2,k+1,k+1,k+2,k+3);}
  }
  for(let i=0;i<Math.floor(length/12);i++){const p=at(i*12/length);paintQuad(p.x,p.z,.13,4.8,p.heading,M.pale);}
  function roadArrow(t,offset=0,size=1,material=M.lime){
    const p=at(t,offset),points=[[-1.8,-2.8],[-.65,-2.8],[-.65,.2],[-2,.2],[0,3.2],[2,.2],[.65,.2],[.65,-2.8]];
    const shape=new THREE.Shape();points.forEach(([x,z],i)=>i?shape.lineTo(x*size,z*size):shape.moveTo(x*size,z*size));shape.closePath();
    const g=new THREE.ShapeGeometry(shape);g.rotateX(Math.PI/2);g.rotateY(p.heading);g.translate(p.x,0,p.z);
    const vertices=g.attributes.position;for(let i=0;i<vertices.count;i++)vertices.setY(i,getSurfaceAt(vertices.getX(i),vertices.getZ(i)).height+.010);g.computeVertexNormals();
    const mesh=new THREE.Mesh(g,new THREE.MeshBasicMaterial({color:material.color,side:THREE.DoubleSide}));mesh.name='road-arrow';mesh.userData.surfaceElevation=.010;root.add(mesh);
  }
  for(const t of [.035,.16,.29,.43,.56,.69,.82,.925]){roadArrow(t,-4.6,1);roadArrow(t,4.6,1);}
  const finish=at(0);
  for(let row=0;row<3;row++)for(let col=0;col<20;col++){
    const off=(col-9.5)*1.12,along=(row-1)*1.12;
    paintQuad(finish.x+finish.tz*off+finish.tx*along,finish.z-finish.tx*off+finish.tz*along,1.12,1.12,finish.heading,(row+col)%2?M.pale:M.ink);
  }
  // Steel covers sit on the physical expansion joints; each axle crosses them
  // independently and the same footprint selects the metal contact sound.
  const plateMat=mat(0x71868a,{metalness:.48,roughness:.65,side:THREE.DoubleSide});
  for(const p of surfacePlates){
    paintQuad(p.x,p.z,p.width,p.depth,p.heading,plateMat);
    for(let i=-11;i<=11;i++){const x=p.x+p.tz*i,z=p.z-p.tx*i;paintQuad(x,z,.055,1.12,p.heading,M.ink);}
  }
  for(const [material,batch] of roadPaint){const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(batch.positions,3));geo.setIndex(batch.indices);geo.computeVertexNormals();const mesh=new THREE.Mesh(geo,material);mesh.name='road-paint';mesh.userData.surfaceElevation=.009;root.add(mesh);}

  function textureLabel(title, subtitle, background='#d7ff45', foreground='#17262c') {
    const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=256;
    const ctx=canvas.getContext('2d');ctx.fillStyle=background;ctx.fillRect(0,0,1024,256);
    ctx.globalAlpha=.13;ctx.fillStyle=foreground;
    for(let y=10;y<256;y+=18)for(let x=10;x<1024;x+=18){ctx.beginPath();ctx.arc(x,y,2.4,0,Math.PI*2);ctx.fill();}
    ctx.globalAlpha=1;ctx.fillStyle=foreground;ctx.font='italic 900 132px Arial, sans-serif';ctx.textAlign='center';ctx.fillText(title,512,153,950);
    ctx.font='bold 26px Arial, sans-serif';ctx.fillText(subtitle,512,208,940);
    ctx.fillRect(26,23,100,8);ctx.fillRect(898,225,100,8);
    const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=4;return texture;
  }
  function sign(x,y,z,width,height,heading,title,subtitle,bg,fg) {
    box(x,y,z,width+.5,height+.5,.44,M.ink,heading);
    const mesh=new THREE.Mesh(new THREE.PlaneGeometry(width,height),new THREE.MeshBasicMaterial({map:textureLabel(title,subtitle,bg,fg)}));
    mesh.rotation.y=heading;mesh.position.set(x+Math.sin(heading)*.24,y,z+Math.cos(heading)*.24);root.add(mesh);
    const back=mesh.clone();back.rotation.y=heading+Math.PI;back.position.set(x-Math.sin(heading)*.24,y,z-Math.cos(heading)*.24);root.add(back);
    return mesh;
  }
  // Start gantry frames the road without an opaque roof above the car.
  for(const side of [-1,1]) {
    const x=finish.x+finish.tz*15*side,z=finish.z-finish.tx*15*side;
    box(x,4,z,.7,8,.7,M.ink);box(x,1.1,z,1.7,2.2,1.7,M.lime);
    addCollider(x,z,1.1,1.1);
  }
  sign(finish.x,8.1,finish.z,31,3.8,finish.heading,'SIDEWAYS','DOCK 09  /  NEVER LIFT');
  const raceSign=at(.025,-20);sign(raceSign.x,3.8,raceSign.z,8,3,raceSign.heading+.4,'09','INDUSTRIAL DISTRICT','#f06a80','#17262c');
  box(raceSign.x,1.2,raceSign.z,.5,2.4,.5,M.ink);

  // Striped concrete corner blocks and trackside chevrons guide every bend.
  for(const t of [.13,.255,.355,.48,.60,.72,.86,.955]) {
    for(let j=-2;j<=2;j++){
      const p=at(t+j*.0048,15.6);
      box(p.x,.62,p.z,1.2,1.25,3.8,j%2?M.coral:M.pale,p.heading);
      addCollider(p.x,p.z,.6,1.9,p.heading,'concrete','barrier');
    }
    const p=at(t,19);
    sign(p.x,2.4,p.z,6,2.2,p.heading+Math.PI*.22,'>>>','KEEP IT SIDEWAYS','#d7ff45','#17262c');
    box(p.x,.8,p.z,.35,1.6,.35,M.ink);
  }

  function warehouse(x,z,w,d,h,color=M.teal,number='09') {
    if(getRoadInfo(x,z).distance<Math.hypot(w,d)/2+22)return false;
    box(x,h/2-.2,z,w,h,d,color);addCollider(x,z,w/2+.4,d/2+.4);
    box(x,h+.08,z,w+1,.5,d+1,M.ink);
    const bays=Math.max(2,Math.floor(w/9));
    for(let i=0;i<bays;i++){
      const xx=x+(i-(bays-1)/2)*(w/(bays+.1));
      box(xx,2.8,z+d/2+.045,w/bays*.67,5.4,.15,M.ink);
      for(let j=1;j<5;j++)box(xx,j*1.06,z+d/2+.14,w/bays*.66,.11,.05,M.metal);
      box(xx,6.45,z+d/2+.1,w/bays*.72,.45,.1,M.lamp);
      box(xx,h+.6,z-d*.13,w/bays*.65,.65,d*.48,M.metal);
      box(xx,h+.97,z-d*.13,w/bays*.54,.07,d*.40,M.darkTeal);
    }
    for(const side of [-1,1])for(let k=0;k<Math.floor(d/7);k++)box(x+side*(w/2+.04),h*.71,z-d/2+4+k*7,.12,1.2,4,M.glass);
    sign(x,h*.77,z+d/2+.16,Math.min(w*.7,22),Math.min(h*.26,3.7),0,`DOCK ${number}`,'FREIGHT / NIGHT SHIFT','#d5dec0','#17262c');
    for(let i=0;i<5;i++)box(x+(i-2)*w*.16,.03,z+d/2+7,.15,.035,8,M.pale);
    return true;
  }
  warehouse(-58,21,62,66,15,M.teal,'09');
  warehouse(38,48,54,38,11,M.brick,'04');
  warehouse(50,-49,64,42,17,M.darkTeal,'08');
  warehouse(-84,-70,37,30,10,M.purple,'03');
  warehouse(-102,96,28,25,9,M.teal,'02');

  // Shipping containers use inset doors and ribs, not featureless colored boxes.
  function container(x,z,y,color,rot=false) {
    const w=rot?12:5.4,d=rot?5.4:12;
    box(x,y+1.55,z,w,3.1,d,color);
    box(x,y+3.17,z,w+.1,.18,d+.1,M.ink);
    for(let i=0;i<7;i++){
      if(rot){const xx=x-w/2+.7+i*(w-1.4)/6;box(xx,y+1.55,z+d/2+.035,.14,2.75,.08,M.ink);}
      else {const zz=z-d/2+.7+i*(d-1.4)/6;box(x+w/2+.035,y+1.55,zz,.08,2.75,.14,M.ink);}
    }
    if(rot){box(x+w/2+.03,y+1.55,z,.08,2.75,.10,M.pale);}
    else{box(x,y+1.55,z+d/2+.03,.1,2.75,.08,M.pale);}
    if(y<.5)addCollider(x,z,w/2+.12,d/2+.12);
  }
  const containerMats=[M.coral,M.teal,M.lime,M.purple,M.pale,M.brick];
  for(const cluster of [{x:91,z:3,cols:4,rows:3,rot:false},{x:17,z:-105,cols:5,rows:2,rot:true},{x:-90,z:57,cols:3,rows:2,rot:true},{x:220,z:-50,cols:2,rows:5,rot:false}]){
    for(let row=0;row<cluster.rows;row++)for(let col=0;col<cluster.cols;col++){
      const x=cluster.x+col*(cluster.rot?13:6.4),z=cluster.z+row*(cluster.rot?6.5:13);
      if(getRoadInfo(x,z).distance<22)continue;
      container(x,z,0,containerMats[(row+col)%containerMats.length],cluster.rot);
      if(rnd()>.45)container(x,z,3.35,containerMats[(row+col+2)%containerMats.length],cluster.rot);
    }
  }

  function crane(x,z,rotation=0) {
    const tr=(a,b,c)=>[x+a*Math.cos(rotation)+c*Math.sin(rotation),b,z-a*Math.sin(rotation)+c*Math.cos(rotation)];
    for(const side of [-1,1]) {
      beam(tr(side*10,0,-5),tr(side*7.5,27,-5),1.2,M.coral);
      beam(tr(side*10,0,5),tr(side*7.5,27,5),1.2,M.coral);
      beam(tr(side*10,4,-5),tr(side*7.5,22,5),.45,M.ink);
      beam(tr(side*10,4,5),tr(side*7.5,22,-5),.45,M.ink);
      const p=tr(side*10,.6,0);box(p[0],p[1],p[2],3.5,1.2,14,M.ink,rotation);
    }
    beam(tr(-14,27,-5),tr(20,27,-5),1.4,M.lime);
    beam(tr(-14,27,5),tr(20,27,5),1.4,M.lime);
    for(let i=-13;i<18;i+=5){beam(tr(i,27,-5),tr(i+5,27,5),.4,M.ink);beam(tr(i,29,-5),tr(i+5,27,-5),.32,M.ink);}
    const p=tr(11,25,0);box(p[0],p[1],p[2],4,3,6,M.coral,rotation);
    beam(tr(13,25,-2),tr(13,9,-2),.12,M.ink);beam(tr(13,25,2),tr(13,9,2),.12,M.ink);
    const hook=tr(13,8.7,0);box(hook[0],hook[1],hook[2],2.4,.6,7,M.lime,rotation);
  }
  crane(236,-117,.08);crane(238,85,.1);

  // Fuel station and service yard in the inner district.
  const stationX=-6,stationZ=102;
  box(stationX,4.2,stationZ,29,.8,14,M.pale);
  box(stationX,4.65,stationZ,29,.2,14,M.coral);
  for(const x of [-17,5]){box(x,2.1,stationZ,.55,4.2,.55,M.ink);addCollider(x,stationZ,.5,.5);}
  for(let i=0;i<3;i++){
    const x=stationX-9+i*9;box(x,1.25,stationZ,1.5,2.5,1.1,M.coral);box(x,1.8,stationZ+.58,1.1,.7,.08,M.ink);
    box(x,.13,stationZ,3.7,.25,5,M.pale);addCollider(x,stationZ,1.8,2.5);
  }
  sign(stationX,5.5,stationZ+7.16,23,2,0,'NITRO','MORE NOISE. MORE NIGHT.','#d7ff45','#17262c');

  function tree(x,z,scale=1) {
    instance('cylinder',M.ink,x,1.7*scale,z,.22*scale,3.4*scale,.22*scale);
    instance('leaf',M.grass,x,4.8*scale,z,2.7*scale,3.4*scale,2.7*scale,rnd()*6);
    instance('leaf',M.teal,x+1.1*scale,4*scale,z+.7*scale,1.7*scale,2*scale,1.8*scale,rnd()*6);
  }
  for(let i=0;i<145;i++){
    const x=(rnd()-.5)*450,z=(rnd()-.5)*400;
    if(getRoadInfo(x,z).distance<22)continue;
    if(colliders.some(c=>Math.abs(x-c.x)<c.hx+5&&Math.abs(z-c.z)<c.hz+5))continue;
    tree(x,z,.75+rnd()*.55);
  }
  for(let i=0;i<36;i++){
    const p=at(i/36,17.3);
    box(p.x,3.6,p.z,.19,7.2,.19,M.ink);
    const nx=-p.tz,nz=p.tx;
    box(p.x+nx*1.4,7.1,p.z+nz*1.4,3.2,.18,.2,M.ink,p.heading);
    box(p.x+nx*2.7,7.02,p.z+nz*2.7,1.2,.13,.65,M.lamp,p.heading);
    box(p.x,.2,p.z,.75,.4,.75,M.metal);
  }

  // Little props build scale: bollards, cable reels, pallets, parking and trailers.
  for(let i=0;i<42;i++){
    const p=at((i+.6)/42,-16.1);
    instance('cylinder',i%3?M.lime:M.coral,p.x,.48,p.z,.25,.96,.25);
    box(p.x,.62,p.z,.54,.16,.54,M.ink,p.heading);
  }
  for(let i=0;i<26;i++){
    const x=-35+rnd()*115,z=-110+rnd()*190;
    if(getRoadInfo(x,z).distance<25||colliders.some(c=>Math.abs(x-c.x)<c.hx+3&&Math.abs(z-c.z)<c.hz+3))continue;
    box(x,.35,z,2.4,.7,1.9,M.brick);box(x,.75,z,2.4,.12,1.9,M.pale);
  }
  for(let i=0;i<8;i++){
    const x=-139+i*7,z=36;
    if(getRoadInfo(x,z).distance<24)continue;
    box(x,.03,z,3.5,.025,7.5,M.ink);
    for(const offset of [-2,2])box(x+offset,.055,z,.13,.025,8,M.pale);
  }

  // Outlying city and mountains are stylized silhouettes beyond the harbor.
  for(let i=0;i<39;i++){
    const angle=(i/39)*Math.PI*2,rad=365+rnd()*85;
    const x=Math.cos(angle)*rad,z=Math.sin(angle)*rad,h=15+rnd()*58,w=12+rnd()*23,d=12+rnd()*20;
    const color=[M.purple,M.brick,M.darkTeal,M.teal][i%4];
    box(x,h/2-5,z,w,h,d,color);box(x,h-4.6,z,w*.82,.9,d*.82,M.ink);
    if(i%3===0)box(x,h+2,z,w*.34,12,d*.34,color);
    for(let y=5;y<h-5;y+=5.5)for(let k=-1;k<=1;k++){
      if(rnd()>.38)box(x+k*w*.22,y-2,z+d/2+.1,w*.13,1.5,.12,i%4===0?M.lamp:M.glass);
    }
    if(i%4===0)box(x,h+6,z,.2,14,.2,M.ink);
  }
  const mountainMat=mat(0x646a80);
  for(let i=0;i<16;i++){
    const angle=i/16*Math.PI*2,rad=670+rnd()*80;
    const geo=new THREE.ConeGeometry(80+rnd()*90,55+rnd()*70,5,1);
    const mesh=new THREE.Mesh(geo,mountainMat);mesh.position.set(Math.cos(angle)*rad,5,Math.sin(angle)*rad);mesh.rotation.y=rnd()*6.28;root.add(mesh);
  }
  // Offshore cargo ship: faceted hull, stacked freight and a small bridge.
  const shipX=330,shipZ=55;
  box(shipX,-2.5,shipZ,31,6,102,M.ink,.07);
  box(shipX,.6,shipZ,29,.45,99,M.pale,.07);
  for(let r=0;r<5;r++)for(let c=0;c<3;c++){
    const x=shipX-9+c*9,z=shipZ-32+r*13;
    box(x,2.8,z,7.8,4,11.5,containerMats[(c+r)%5],.07);
    if(r<3)box(x,6.9,z,7.8,4,11.5,containerMats[(c+r+2)%5],.07);
  }
  box(shipX,6.8,shipZ+40,23,12,15,M.pale,.07);
  box(shipX,11,shipZ+31.9,20,2,.15,M.ink,.07);
  box(shipX,16,shipZ+43,.35,12,.35,M.ink);

  // One instanced draw per primitive/material combination keeps the city inexpensive.
  for(const [material,groups] of batches)for(const [type,matrices] of groups){
    const mesh=new THREE.InstancedMesh(geometries[type],material,matrices.length);
    matrices.forEach((m,i)=>mesh.setMatrixAt(i,m));mesh.instanceMatrix.needsUpdate=true;
    mesh.castShadow=true;mesh.receiveShadow=true;mesh.name=`district-${type}`;root.add(mesh);
  }
  function update(dt,time) {
    waterLines.forEach((q,i)=>{
      dummy.position.set(q.x+Math.sin(time*.17+q.phase)*2.4,-4.57,q.z);dummy.rotation.set(0,0,0);dummy.scale.set(q.width,1,q.depth);dummy.updateMatrix();ripples.setMatrixAt(i,dummy.matrix);
    });
    ripples.instanceMatrix.needsUpdate=true;
  }
  const sampleAcoustics=createFacadeSampler(colliders);
  return {root,curve,samples,length,spawn,checkpoints,colliders,update,getRoadInfo,getSurfaceAt,sampleAcoustics,mapPoints,surfaceMaterials,surfacePatches,surfacePlates,surfaceProfile:{groundHeight:GROUND_HEIGHT,roadHeight:ROAD_HEIGHT,expansionJoints,curb:{inner:12,outer:13.3,peakHeight:.122},rowCount:surfaceRows.length},bounds:{minX:-265,maxX:265,minZ:-245,maxZ:235}};
}
