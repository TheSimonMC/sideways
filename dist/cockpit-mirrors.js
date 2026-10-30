import * as THREE from './vendor/three.module.js';
// Rear cameras are a bounded approximation: only the player's three mirrors,
// one small render pass at a time, with the player's shell excluded from it.
export class CockpitMirrors{
 constructor(renderer){this.renderer=renderer;this.records=[];this.clock=0;this.cursor=0;this.frames=0;this.lastMs=0;this.lastCalls=0;this.fog=new THREE.Fog(0x172338,60,140);}
 dispose(){for(const r of this.records){r.mesh.material.map=null;r.mesh.material.color.set(0x9dafb1);r.mesh.material.needsUpdate=true;r.target.dispose();}this.records=[];}
 update(scene,car,dt,{active=false,quality='medium'}={}){
  const mirrors=car.cockpitMirrors;
  if(this.records.length&&this.records[0].mesh!==mirrors?.[0]?.mesh)this.dispose();
  if(!active){for(const r of this.records)if(r.mesh.material.map){r.mesh.material.map=null;r.mesh.material.color.set(0x9dafb1);r.mesh.material.needsUpdate=true;}return;}
  if(!mirrors?.length)return;
  if(!this.records.length){this.records=mirrors.map(m=>{const target=new THREE.WebGLRenderTarget(256,128,{depthBuffer:true,stencilBuffer:false});target.texture.colorSpace=THREE.SRGBColorSpace;
   if(!m.mesh.userData.reflectedUV){const uv=m.mesh.geometry.attributes.uv;for(let i=0;i<uv.count;i++)uv.setX(i,1-uv.getX(i));uv.needsUpdate=true;m.mesh.userData.reflectedUV=true;}
   return {...m,target,camera:new THREE.PerspectiveCamera(m.id==='inside'?65:75,2,.06,140),frames:0};});this.clock=0;}
  for(const r of this.records)if(r.mesh.material.map!==r.target.texture){r.mesh.material.map=r.target.texture;r.mesh.material.color.set(0xffffff);r.mesh.material.needsUpdate=true;}
  this.clock-=dt;if(this.clock>0)return;
  // Keep mirrors from consuming every slow frame; submission time is a CPU
  // budget signal, not a claim about GPU completion or delivered frame rate.
  this.clock=Math.max(quality==='high'?1/24:quality==='psx'||quality==='low'?1/12:1/18,Math.min(.25,this.lastMs*.004));
  const visible=m=>{for(let p=m;p;p=p.parent)if(!p.visible)return false;return true;};
  let r;for(let i=0;i<this.records.length;i++){const candidate=this.records[this.cursor++%this.records.length];if(visible(candidate.mesh)){r=candidate;break;}}if(!r)return;
  const renderer=this.renderer,priorTarget=renderer.getRenderTarget(),priorShadow=renderer.shadowMap.autoUpdate,priorReset=renderer.info.autoReset,priorFog=scene.fog,priorBackground=scene.background,shown=car.group.visible,beforeCalls=renderer.info.render.calls,start=performance.now();
  scene.updateMatrixWorld(true);r.camera.far=quality==='high'?220:140;r.camera.updateProjectionMatrix();r.mesh.getWorldPosition(r.camera.position);const direction=new THREE.Vector3(...r.direction).transformDirection(car.group.matrixWorld);r.camera.lookAt(r.camera.position.clone().add(direction));r.camera.updateMatrixWorld();
  try{car.group.visible=false;renderer.info.autoReset=false;renderer.shadowMap.autoUpdate=false;
   // The distant sky sphere is outside the short mirror range. Its clear
   // background must follow current weather/night fog, not the startup sky.
   if(priorFog?.color){this.fog.color.copy(priorFog.color);this.fog.near=r.camera.far*.45;this.fog.far=r.camera.far*.97;scene.fog=this.fog;scene.background=this.fog.color;}
   renderer.setRenderTarget(r.target);renderer.clear();renderer.render(scene,r.camera);r.frames++;this.frames++;this.lastCalls=renderer.info.render.calls-beforeCalls;}
  finally{car.group.visible=shown;scene.fog=priorFog;scene.background=priorBackground;renderer.info.autoReset=priorReset;renderer.shadowMap.autoUpdate=priorShadow;renderer.setRenderTarget(priorTarget);this.lastMs=performance.now()-start;}
 }
 diagnostics(){return {frames:this.frames,lastMs:this.lastMs,lastCalls:this.lastCalls,mirrors:this.records.map(r=>({id:r.id,frames:r.frames,width:r.target.width,height:r.target.height,position:r.camera.position.toArray()}))};}
}
