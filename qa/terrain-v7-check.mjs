import * as THREE from '../dist/vendor/three.module.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {resolveBuild} from '../dist/catalog.js';
import {createTerrainEffects} from '../dist/terrain-fx.js';
import {createEffects} from '../dist/car.js';
const report={status:'pending',checks:[],fixtures:[],limits:'Three.js instance matrices and contact-driven effect math in Node, without a GPU render.'};
const build=resolveBuild();
function make(surface='grass'){return{x:0,z:0,heading:0,vx:0,vz:12,speed:12,wheelAttached:[true,true,true,true],suspension:[0,1,2,3].map(()=>({groundHeight:.09,load:3100,contact:true,material:surface})),wheelAudio:[0,1,2,3].map(()=>({surface,longitudinalSpeed:12,slipSpeed:3,lateralSpeed:.6,load:3100,contact:true}))};}
for(const material of['asphalt','grass','dirt','gravel']){
 const scene=new THREE.Scene(),fx=createTerrainEffects(scene,build),s=make(material);
 for(let i=0;i<300;i++){s.z+=s.vz/60;fx.update(s,1/60);}
 const d=fx.diagnostics();if(material==='asphalt'){assert.equal(d.activeClods+d.activeGrass+d.activeTracks,0);}else{assert.ok(d.activeTracks>0);assert.ok(d.counts.tracks>=150);if(material==='grass')assert.ok(d.activeGrass>10);else assert.ok(d.activeClods>10);}
 assert.ok(d.activeClods<=80&&d.activeGrass<=120&&d.activeTracks<=480);fx.root.traverse(n=>{if(n.instanceMatrix)assert.ok(n.instanceMatrix.array.every(Number.isFinite));});report.fixtures.push({material,...d});
 const before={...d.counts};s.wheelAttached=[false,false,false,false];for(let i=0;i<60;i++)fx.update(s,1/60);assert.deepEqual(fx.diagnostics().counts,before,'Lost wheels must not throw new terrain particles');
 fx.reset();assert.equal(fx.diagnostics().activeTracks+fx.diagnostics().activeGrass+fx.diagnostics().activeClods,0);fx.dispose();assert.equal(scene.children.length,0);
}
report.checks.push('All four tyres throw surface-appropriate debris and leave loose-ground tracks; asphalt produces none');
report.checks.push('Detached wheels stop emission, pools remain bounded, every instance transform is finite, reset and disposal clear all active effects');
{
 const scene=new THREE.Scene(),fx=createTerrainEffects(scene,build),s=make();s.speed=s.vz=0;for(const w of s.wheelAudio)w.longitudinalSpeed=w.slipSpeed=w.lateralSpeed=0;for(let n=0;n<60;n++)fx.update(s,1/60);assert.equal(fx.diagnostics().counts.grass,0);
 for(const w of s.wheelAudio)w.slipSpeed=18;for(let n=0;n<60;n++)fx.update(s,1/60);assert.ok(fx.diagnostics().counts.grass>30);const before=fx.diagnostics().counts.grass;for(const w of s.wheelAudio)w.contact=false;for(const c of s.suspension)c.contact=false;for(let n=0;n<60;n++)fx.update(s,1/60);assert.equal(fx.diagnostics().counts.grass,before);
 s.z=800;fx.update(s,1/60);assert.ok(fx.diagnostics().activeTracks<10,'Teleport must not draw a world-spanning rut');fx.dispose();
}
report.checks.push('Stationary tyres do not emit; stationary wheelspin does, and airborne contacts do not create debris or teleport tracks');
function wheelspin(surface='dirt',slip=18,heading=0){
 const s=make(surface);s.speed=s.vz=0;s.heading=heading;s.wheelAttached=[true,false,false,false];
 for(const w of s.wheelAudio){w.longitudinalSpeed=w.lateralSpeed=0;w.slipSpeed=slip;}
 return s;
}
function firstParticle(fx,grass=false){
 const matrix=new THREE.Matrix4();fx.root.children[grass?1:0].getMatrixAt(0,matrix);
 return{position:new THREE.Vector3().setFromMatrixPosition(matrix),active:new THREE.Vector3().setFromMatrixScale(matrix).length()>1e-6};
}
{
 const fixtures=[];
 for(const surface of['dirt','grass'])for(const heading of[0,Math.PI/2]){
  const results=[];
  for(const sign of[1,-1]){
   const fx=createTerrainEffects(new THREE.Scene(),build),s=wheelspin(surface,sign*18,heading);
   for(let n=0;n<18;n++)fx.update(s,1/60);
   const p=firstParticle(fx,surface==='grass'),sn=Math.sin(heading),cs=Math.cos(heading),origin=new THREE.Vector3(sn*build.physics.frontAxle-cs*build.physics.halfTrack,.09,cs*build.physics.frontAxle+sn*build.physics.halfTrack),offset=p.position.sub(origin);
   assert.ok(p.active);results.push({forward:offset.dot(new THREE.Vector3(sn,0,cs)),side:offset.dot(new THREE.Vector3(cs,0,-sn)),height:offset.y});fx.dispose();
  }
  assert.ok(results[0].forward<-.3&&results[1].forward>.3,'Opposite wheelspin must eject debris in opposite directions');
  assert.ok(Math.abs(results[0].side-results[1].side)<1e-5&&Math.abs(results[0].height-results[1].height)<1e-5,'Only the longitudinal launch should change when wheelspin reverses');
  fixtures.push({surface,heading,forward:results[0].forward,reverse:results[1].forward});
 }
 report.fixtures.push({reverseWheelspin:fixtures});
}
report.checks.push('Forward and reverse stationary wheelspin launch both earth and grass in opposite directions at two car headings');
{
 const fixtures=[];
 for(const heightChange of[.18,-.18]){
  const fx=createTerrainEffects(new THREE.Scene(),build),s=wheelspin(),edge=build.physics.frontAxle-.2,height=.09+heightChange;
  let calls=0,maxCallsPerFrame=0,landed=false,crossed=false;
  assert.equal(fx.setGroundSampler((x,z)=>{calls++;return{height:z<edge?height:.09};}),fx);
  for(let n=0;n<105;n++){
   if(n===12)s.wheelAttached.fill(false);
   const before=calls;fx.update(s,1/60);maxCallsPerFrame=Math.max(maxCallsPerFrame,calls-before);
   const p=firstParticle(fx);if(!p.active)continue;
   if(p.position.z<edge){crossed=true;if(Math.abs(p.position.y-height-.025)<1e-5)landed=true;}
  }
  assert.ok(crossed&&landed,`Debris must cross the edge and land on the ${heightChange>0?'raised':'lowered'} surface`);
  assert.ok(calls>0&&maxCallsPerFrame<=200,'Ground sampling is bounded by the 200 debris particles');
  fixtures.push({heightChange,landed,calls,maxCallsPerFrame});fx.dispose();
 }
 report.fixtures.push({surfaceTransitions:fixtures});
}
report.checks.push('Debris crossing raised and lowered surfaces lands at the sampled height with at most one sample per active particle per frame');
{
 for(const sampler of[null,()=>undefined,()=>({height:NaN})]){
  const fx=createTerrainEffects(new THREE.Scene(),build),s=wheelspin();fx.setGroundSampler(sampler);let landed=false;
  for(let n=0;n<105;n++){if(n===12)s.wheelAttached.fill(false);fx.update(s,1/60);const p=firstParticle(fx);assert.ok(p.position.toArray().every(Number.isFinite));if(p.active&&Math.abs(p.position.y-.115)<1e-5)landed=true;}
  assert.ok(landed,'Absent or invalid samplers retain the emitting contact height');fx.dispose();
 }
 const scene=new THREE.Scene(),fx=createEffects(scene,build);let calls=0;
 assert.equal(fx.setGroundSampler(()=>{calls++;return{height:.09};}),fx);
 for(const reset of[()=>{},()=>fx.reset(),()=>fx.setBuild(build)]){
  reset();const before=calls,s=wheelspin();for(let n=0;n<12;n++)fx.update(s,1/60,n/60);assert.ok(calls>before,'FX API forwards the sampler and retains it across reset and vehicle changes');
 }
 scene.traverse(node=>{node.geometry?.dispose();if(Array.isArray(node.material))for(const material of node.material)material.dispose();else node.material?.dispose();});scene.clear();
}
report.checks.push('Absent or invalid samplers retain finite fallback landings; the FX API keeps its sampler across resets and vehicle changes');
{
 for(const heading of[0,.8,Math.PI/2])for(const rise of[-.16,.16]){
  const fx=createTerrainEffects(new THREE.Scene(),build),s=make('dirt');s.heading=heading;fx.update(s,1/60);
  const dx=Math.sin(heading)*.8,dz=Math.cos(heading)*.8;s.x+=dx;s.z+=dz;for(const wheel of s.suspension)wheel.groundHeight+=rise;fx.update(s,1/60);
  const matrix=new THREE.Matrix4();fx.root.children[2].getMatrixAt(0,matrix);
  const a=new THREE.Vector3(0,0,-.5).applyMatrix4(matrix),b=new THREE.Vector3(0,0,.5).applyMatrix4(matrix),direction=b.clone().sub(a).normalize(),expected=new THREE.Vector3(dx,rise,dz).normalize(),center=a.clone().add(b).multiplyScalar(.5);
  assert.ok(direction.distanceTo(expected)<1e-6,'The rut must follow the endpoint slope after yaw');
  assert.ok(Math.abs(center.y-(.09+rise/2+.018))<1e-6,'The rut must remain just above its contact midpoint');
  assert.ok(new THREE.Vector3(0,1,0).transformDirection(matrix).y>.9,'The visible side of the rut must face upwards');fx.dispose();
 }
}
report.checks.push('Track planes follow uphill and downhill contact endpoints at three headings without flipping their visible face');
report.status='passed';fs.writeFileSync(new URL('./terrain-v7-results.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,checks:report.checks},null,2));
