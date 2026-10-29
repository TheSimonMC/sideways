import * as THREE from './vendor/three.module.js';
/** One bounded line buffer, with no per-drop scene objects or extra render pass. */
export class WeatherRenderer{
 constructor(scene,weather){
  this.weather=weather;this.materials=new Set();this.uniform={value:0};this.count=360;this.positions=new Float32Array(this.count*6);
  this.geometry=new THREE.BufferGeometry();this.geometry.setDrawRange(0,0);this.geometry.setAttribute('position',new THREE.BufferAttribute(this.positions,3).setUsage(THREE.DynamicDrawUsage));
  this.material=new THREE.LineBasicMaterial({color:0xbbd6e2,transparent:true,opacity:0,depthWrite:false});this.lines=new THREE.LineSegments(this.geometry,this.material);this.lines.name='LOCAL-RAIN';this.lines.frustumCulled=false;scene.add(this.lines);
 }
 setWorld(world){
  this.world=world;this.materials.clear();
  world?.root?.traverse(mesh=>{if(!['road-asphalt','city-curved-roads','county-road-ribbons','surface-metal','surface-concrete'].includes(mesh.name))return;
   for(const material of Array.isArray(mesh.material)?mesh.material:[mesh.material]){
    if(!material?.isMeshStandardMaterial||this.materials.has(material))continue;this.materials.add(material);if(material.userData.sidewaysWet)return;material.userData.sidewaysWet=true;
    const previous=material.onBeforeCompile,cache=material.customProgramCacheKey.bind(material),oldKey=cache(),uniform=this.uniform;
    material.onBeforeCompile=(shader,renderer)=>{previous.call(material,shader,renderer);shader.uniforms.sidewaysWet=uniform;
     shader.vertexShader='varying vec3 vWetWorld;\n'+shader.vertexShader;
     shader.vertexShader=shader.vertexShader.replace('#include <project_vertex>','#include <project_vertex>\nvec4 wetLocal=vec4(transformed,1.);\n#ifdef USE_INSTANCING\nwetLocal=instanceMatrix*wetLocal;\n#endif\nvWetWorld=(modelMatrix*wetLocal).xyz;');
     shader.fragmentShader='varying vec3 vWetWorld;uniform float sidewaysWet;\n'+shader.fragmentShader;
     shader.fragmentShader=shader.fragmentShader.replace('#include <roughnessmap_fragment>','#include <roughnessmap_fragment>\nfloat wetPattern=smoothstep(.35,.78,(sin(vWetWorld.x*.07+sin(vWetWorld.z*.021))*sin(vWetWorld.z*.05+sin(vWetWorld.x*.019))+1.)*.5);float puddle=clamp((sidewaysWet-.55)/.45,0.,1.)*wetPattern;diffuseColor.rgb*=1.-sidewaysWet*.16-puddle*.12;roughnessFactor=mix(roughnessFactor,.16,sidewaysWet*.35+puddle*.65);');
    };material.customProgramCacheKey=()=>oldKey+'-wet24';material.needsUpdate=true;
   }
  });
 }
 update(state,camera,time,quality='high'){
  const rain=this.world?.kind==='showroom'?0:this.weather.rain;this.uniform.value=this.weather.wetness;
  const count=Math.round((quality==='low'||quality==='psx'?120:quality==='medium'?240:360)*rain);this.geometry.setDrawRange(0,count*2);this.lines.visible=count>0;this.material.opacity=.12+.35*rain;
  if(!count)return;
  const x=state.x||0,z=state.z||0,y=state.groundHeight||0;
  for(let i=0;i<count;i++){
   const px=x+((i*17.371)%64)-32,pz=z+((i*31.713)%64)-32,py=y+2+((i*.137-time*24)%25+25)%25,k=i*6;
   this.positions[k]=px;this.positions[k+1]=py;this.positions[k+2]=pz;this.positions[k+3]=px-.25;this.positions[k+4]=py-1.3;this.positions[k+5]=pz+.1;
  }this.geometry.attributes.position.needsUpdate=true;
 }
 diagnostics(){return {drops:this.geometry.drawRange.count/2,capacity:this.count,wetMaterials:this.materials.size};}
 dispose(){this.lines.removeFromParent();this.geometry.dispose();this.material.dispose();this.materials.clear();}
}
