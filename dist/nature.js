import * as THREE from './vendor/three.module.js';
const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,Number.isFinite(v)?v:a));
const TAU=Math.PI*2;

function foldedLeaf(){
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute([0,.035,-.28,-.17,0,0,0,.06,.40,.17,0,0,0,.035,0],3));g.setIndex([0,1,4,1,2,4,2,3,4,3,0,4]);g.computeVertexNormals();return g;
}
function windMaterial(color,uniforms,kind='leaf'){
 const m=new THREE.MeshStandardMaterial({color,roughness:.94,metalness:0,flatShading:true,side:THREE.DoubleSide});
 m.onBeforeCompile=shader=>{
  shader.uniforms.natureTime=uniforms.time;shader.uniforms.natureWind=uniforms.wind;shader.uniforms.naturePlayer=uniforms.player;shader.uniforms.natureSpeed=uniforms.speed;
  shader.vertexShader='uniform float natureTime,natureWind,natureSpeed;uniform vec2 naturePlayer;varying float vNatureHeight;\n'+shader.vertexShader;
  shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
   vec3 anchor=vec3(0.);\n#ifdef USE_INSTANCING\nanchor=instanceMatrix[3].xyz;\n#endif
   float phase=dot(anchor.xz,vec2(.19,.13));float sway=sin(natureTime*1.7+phase)+sin(natureTime*.93+phase*1.7)*.37;
   vNatureHeight=position.y;
   ${kind==='grass'?`vec2 away=anchor.xz-naturePlayer;float wake=(1.-smoothstep(.8,4.2,length(away)))*clamp(natureSpeed/20.,0.,1.);vec2 push=away/max(.4,length(away));transformed.xz+=(vec2(sway,.48*sway)*natureWind*.12+push*wake*.8)*max(0.,position.y);transformed.y*=1.-wake*.44;`:`transformed.x+=sway*natureWind*${kind==='crown'?'.034*(position.y+1.)':'.065'};transformed.z+=cos(natureTime*1.23+phase)*natureWind*${kind==='crown'?'.022*(position.y+1.)':'.043'};`}
  `);
  shader.fragmentShader='varying float vNatureHeight;\n'+shader.fragmentShader;
  shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>\ndiffuseColor.rgb*=mix(.78,1.10,clamp(vNatureHeight*.6+.45,0.,1.));`);
 };
 m.customProgramCacheKey=()=>`sideways-nature-v7-${kind}`;return m;
}

/** Bounded foliage and insects, owned by the active city. No invisible colliders. */
export function createNature(parent,{trees=[],grassZones=[],parks=[],streetLights=[],getSurfaceAt=()=>({height:0,material:'concrete'})}={}){
 const root=new THREE.Group();root.name='CITY-NATURE';parent.add(root);let seed=773361,disposed=false,time=0,night=0,player={x:0,z:0,speed:0},dropClock=0,nearClock=0,lastHealth=1;
 const random=()=>((seed=Math.imul(seed,1664525)+1013904223)>>>0)/4294967296;
 const uniforms={time:{value:0},wind:{value:1},player:{value:new THREE.Vector2()},speed:{value:0}};
 const dummy=new THREE.Object3D(),color=new THREE.Color(),palette=[0x6e9458,0x4f8054,0x84a563,0xb1ad63,0x73955c,0x628b67];
 const trunkGeo=new THREE.CylinderGeometry(.65,1,1,6),trunkMat=new THREE.MeshStandardMaterial({color:0x504b41,roughness:1,flatShading:true});
 const trunks=new THREE.InstancedMesh(trunkGeo,trunkMat,trees.length*4);trunks.name='tree-trunks-and-branches';trunks.castShadow=trunks.receiveShadow=true;
 const crownGeo=new THREE.IcosahedronGeometry(1,1),crownMat=windMaterial(0xffffff,uniforms,'crown');
 const crowns=new THREE.InstancedMesh(crownGeo,crownMat,trees.length*4);crowns.name='leafy-tree-crowns';crowns.castShadow=crowns.receiveShadow=true;
 const leafGeo=foldedLeaf(),leafMat=windMaterial(0xffffff,uniforms);const leaves=new THREE.InstancedMesh(leafGeo,leafMat,trees.length*36);leaves.name='tree-individual-leaves';leaves.receiveShadow=true;
 function place(mesh,index,x,y,z,sx,sy,sz,rx=0,ry=0,rz=0){dummy.position.set(x,y,z);dummy.scale.set(sx,sy,sz);dummy.rotation.set(rx,ry,rz);dummy.updateMatrix();mesh.setMatrixAt(index,dummy.matrix);}
 trees.forEach((tree,i)=>{
  const s=tree.scale||1,g=getSurfaceAt(tree.x,tree.z).height;tree.groundHeight=g;tree.height=6.4*s;tree.phase=random()*TAU;tree.lastDrop=-20;tree.lastShake=-20;tree.lastImpact=-20;
  place(trunks,i*4,tree.x,g+2*s,tree.z,.34*s,4*s,.34*s,0,tree.phase,0);
  for(let b=0;b<3;b++){const a=tree.phase+b*TAU/3;place(trunks,i*4+b+1,tree.x+Math.sin(a)*.66*s,g+(3.1+b*.17)*s,tree.z+Math.cos(a)*.66*s,.15*s,2.1*s,.15*s,Math.cos(a)*.65,0,-Math.sin(a)*.65);}
  for(let b=0;b<4;b++){const a=tree.phase+b*TAU/3;const high=b===3;place(crowns,i*4+b,tree.x+(high?0:Math.sin(a)*1.48*s),g+(high?5.7:4.45+b*.17)*s,tree.z+(high?0:Math.cos(a)*1.48*s),(high?1.8:2.2)*s,(high?1.55:1.85)*s,(high?1.8:2.1)*s,0,a,0);crowns.setColorAt(i*4+b,color.setHex(palette[(i+b)%palette.length]));}
  for(let j=0;j<36;j++){const a=j*.61803398875*TAU+tree.phase,r=(2.0+random()*1.4)*s,h=(3.25+random()*2.9)*s;place(leaves,i*36+j,tree.x+Math.cos(a)*r,g+h,tree.z+Math.sin(a)*r,s*(1.2+random()*.8),s,s*(1.0+random()*.6),random()*1.4-.6,a,random()*.7-.35);leaves.setColorAt(i*36+j,color.setHex(palette[(i+j)%palette.length]));}
 });
 for(const mesh of [trunks,crowns,leaves]){mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingBox();mesh.computeBoundingSphere();root.add(mesh);}
 const grassGeo=new THREE.BufferGeometry();grassGeo.setAttribute('position',new THREE.Float32BufferAttribute([-.08,0,0,.03,.8,0,.08,0,0,0,0,-.07,0,.66,.03,0,0,.07,-.06,0,.03,.24,.57,-.10,.02,0,.06],3));grassGeo.computeVertexNormals();
 const grassMat=windMaterial(0xffffff,uniforms,'grass'),tufts=[];
 for(const zone of grassZones)for(let n=0;n<Math.min(120,Math.ceil(zone.width*zone.depth/42));n++){const x=zone.x+(random()-.5)*(zone.width-1),z=zone.z+(random()-.5)*(zone.depth-1),surface=getSurfaceAt(x,z);if(surface.material==='grass')tufts.push({x,z,y:surface.height,scale:.32+random()*.52,angle:random()*TAU});}
 const grass=new THREE.InstancedMesh(grassGeo,grassMat,tufts.length);grass.name='wind-grass-tufts';grass.receiveShadow=true;
 tufts.forEach((p,i)=>{place(grass,i,p.x,p.y+.01,p.z,1,p.scale,1,0,p.angle,0);grass.setColorAt(i,color.setHex(palette[i%3]).multiplyScalar(.90+(i%5)*.035));});grass.instanceMatrix.needsUpdate=true;grass.computeBoundingSphere();root.add(grass);
 const fallingMat=new THREE.MeshStandardMaterial({color:0xe2bd74,roughness:1,side:THREE.DoubleSide,flatShading:true});
 const FALL_COUNT=192,falling=new THREE.InstancedMesh(leafGeo,fallingMat,FALL_COUNT),drops=Array.from({length:FALL_COUNT},()=>({active:false,life:0}));falling.name='falling-leaves';falling.instanceMatrix.setUsage(THREE.DynamicDrawUsage);falling.frustumCulled=false;
 for(let i=0;i<FALL_COUNT;i++){place(falling,i,0,-1000,0,0,0,0);falling.setColorAt(i,color.setHex(palette[(i+3)%palette.length]));}root.add(falling);let cursor=0,emitted=0;
 function drop(tree,count=1,strength=0){if(disposed||!tree)return;for(let n=0;n<Math.min(count,32);n++){const p=drops[cursor],angle=random()*TAU,r=(.4+random()*2.2)*(tree.scale||1);Object.assign(p,{active:true,x:tree.x+Math.cos(angle)*r,y:tree.groundHeight+(3.3+random()*2.7)*(tree.scale||1),z:tree.z+Math.sin(angle)*r,vx:Math.cos(angle)*(.4+strength*2),vy:random()*.4-.35+strength*.7,vz:Math.sin(angle)*(.4+strength*2),angle,spin:random()*TAU,life:9+random()*4,size:.35+random()*.35,settled:0});cursor=(cursor+1)%FALL_COUNT;emitted++;}tree.lastDrop=time;}
 const INSECTS=96,bugPositions=new Float32Array(INSECTS*3),bugSeeds=new Float32Array(INSECTS),bugGeometry=new THREE.BufferGeometry();for(let i=0;i<INSECTS;i++)bugSeeds[i]=random();bugGeometry.setAttribute('position',new THREE.BufferAttribute(bugPositions,3).setUsage(THREE.DynamicDrawUsage));bugGeometry.setAttribute('phase',new THREE.BufferAttribute(bugSeeds,1));
 const bugMaterial=new THREE.ShaderMaterial({transparent:true,depthWrite:false,uniforms:{night:{value:0},time:{value:0}},vertexShader:`attribute float phase;varying float seed;uniform float night,time;void main(){seed=phase;vec4 mv=modelViewMatrix*vec4(position,1.);gl_PointSize=clamp((night>.5?720.:340.)*.10/max(1.,-mv.z),1.1,night>.5?7.:3.8);gl_Position=projectionMatrix*mv;}`,fragmentShader:`precision highp float;varying float seed;uniform float night,time;void main(){vec2 p=gl_PointCoord-.5;float r=length(p);if(r>.5)discard;float glow=1.-smoothstep(.06,.5,r);float flicker=.55+.45*pow(.5+.5*sin(time*(2.1+seed)+seed*31.),3.);vec3 dayColor=vec3(.12,.14,.10);vec3 nightColor=vec3(1.2,1.38,.45)*(1.+glow*.6);float alpha=mix(.68,glow*flicker,night);gl_FragColor=vec4(mix(dayColor,nightColor,night),alpha);}`});
 const insects=new THREE.Points(bugGeometry,bugMaterial);insects.name='park-insects-and-fireflies';insects.frustumCulled=false;root.add(insects);
 let nearTrees=[],anchors=[],activeBugs=0;
 function refreshNear(){nearTrees=trees.filter(t=>Math.hypot(t.x-player.x,t.z-player.z)<95);const nearParks=parks.filter(p=>Math.hypot(p.x-player.x,p.z-player.z)<110);anchors=nearParks.map(p=>({x:p.x,z:p.z,radius:24}));for(const t of nearTrees.filter(t=>Math.hypot(t.x-player.x,t.z-player.z)<32).slice(0,3))anchors.push({x:t.x,z:t.z,radius:5});if(night>.6)for(const light of streetLights.filter(l=>Math.hypot(l.x-player.x,l.z-player.z)<38).slice(0,2))anchors.push({x:light.x,z:light.z,radius:2,light:true,y:light.y});activeBugs=anchors.length?INSECTS:0;}
 function setPlayerContext(value={}){if(Number.isFinite(value.x)&&Number.isFinite(value.z))player=value;}
 function setNight(value){const old=night;night=clamp(value);bugMaterial.uniforms.night.value=night;if((old>.6)!==(night>.6))nearClock=0;}
 function update(dt=0,totalTime=time,context={}){
  if(disposed)return;dt=clamp(dt,0,.10);time=Number.isFinite(totalTime)?totalTime:time+dt;if(context.player)setPlayerContext(context.player);if(Number.isFinite(context.night))setNight(context.night);
  uniforms.time.value=time;uniforms.wind.value=.65+.20*Math.sin(time*.11)+.15*Math.sin(time*.31);uniforms.player.value.set(player.x,player.z);uniforms.speed.value=clamp(player.speed||0,0,80);bugMaterial.uniforms.time.value=time;
  nearClock-=dt;if(nearClock<=0){nearClock=.35;refreshNear();}
  dropClock+=dt;if(nearTrees.length&&dropClock>.34){dropClock=0;drop(nearTrees[Math.floor(random()*nearTrees.length)],1);}
  const health=player.bodyHealth??1,impact=lastHealth-health>.002;lastHealth=health;
  if(dt>0)for(const tree of nearTrees){const distance=Math.hypot(tree.x-player.x,tree.z-player.z);if(distance<((tree.scale||1)*2.8+2)){const hit=impact&&time-tree.lastImpact>.4,wake=(player.speed||0)>6&&time-tree.lastShake>2.5;if(hit||wake){tree.lastShake=time;if(hit)tree.lastImpact=time;drop(tree,hit?22:5,hit?1:.35);}}}
  for(let i=0;i<FALL_COUNT;i++){const p=drops[i];if(!p.active)continue;p.life-=dt;const floor=getSurfaceAt(p.x,p.z).height+.035;if(p.y>floor){p.vx+=(1.0+Math.sin(time*.8)*.3-p.vx)*dt*.3;p.vz+=(.45-p.vz)*dt*.25;p.vy=Math.max(-1.2,p.vy-dt*.85);p.x+=(p.vx+Math.sin(time*3+p.angle)*.22)*dt;p.y+=p.vy*dt;p.z+=(p.vz+Math.cos(time*2.8+p.angle)*.18)*dt;p.spin+=dt*2;}else{p.y=floor;p.settled+=dt;p.spin=.05;}if(p.life<=0||p.settled>2.5){p.active=false;place(falling,i,0,-1000,0,0,0,0);continue;}const size=p.size*clamp(Math.min(p.life,2.5-p.settled)*1.3);place(falling,i,p.x,p.y,p.z,size,size,size,p.settled?.05:p.spin,p.angle+time*.32,p.settled?0:Math.sin(time*4+p.angle)*.7);}
  falling.instanceMatrix.needsUpdate=true;
  for(let i=0;i<INSECTS;i++){const a=anchors[i%Math.max(1,anchors.length)],p=bugSeeds[i],o=i*3;if(!a){bugPositions[o]=0;bugPositions[o+1]=-1000;bugPositions[o+2]=0;continue;}const phase=p*TAU,t=time*(a.light?1.3:.6)+phase*5,r=a.radius*(.18+p*.8);bugPositions[o]=a.x+Math.cos(t)*r+Math.sin(t*3.1+phase)*.38;bugPositions[o+2]=a.z+Math.sin(t*.87)*r+Math.cos(t*2.3)*.4;bugPositions[o+1]=a.light?(a.y||6)-.7+Math.sin(t*2+phase)*.45:.7+p*1.3+Math.sin(t*2.6+phase)*.35;}
  bugGeometry.attributes.position.needsUpdate=true;
 }
 function dispose(){if(disposed)return;disposed=true;root.removeFromParent();const gs=new Set(),ms=new Set();root.traverse(o=>{if(o.geometry)gs.add(o.geometry);if(o.material)ms.add(o.material);});for(const g of gs)g.dispose();for(const m of ms)m.dispose();root.clear();}
 update(0,0);return{root,trees,trunks,crowns,leaves,grass,falling,insects,update,setPlayerContext,setNight,dropLeaves:(index,count=12,strength=.6)=>drop(trees[index],count,strength),dispose,diagnostics:()=>({trees:trees.length,leafInstances:leaves.count,grassTufts:tufts.length,fallingLeaves:drops.filter(p=>p.active).length,emittedLeaves:emitted,insects:activeBugs,night,nearTrees:nearTrees.length,wind:uniforms.wind.value})};
}
