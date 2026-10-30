import * as THREE from './vendor/three.module.js';
import {lampOutput} from './exterior-damage.js';
import {RoadWeather} from './weather.js';
import {WeatherRenderer} from './weather-renderer.js';
const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
const mix=(a,b,t)=>a+(b-a)*t;

/** Moving sun, moon, ambient light and a procedural low-poly sky. */
export class DayNight {
 constructor(scene,renderer,sun,{hour=17.2,weather}={}){
  this.scene=scene;this.renderer=renderer;this.sun=sun;this.hour=hour;this.night=0;this.world=null;this.weather=new RoadWeather(weather);this.weatherView=new WeatherRenderer(scene,this.weather);
  this.root=new THREE.Group();this.root.name='SKY-AND-LIGHT';scene.add(this.root);
  this.ambient=new THREE.HemisphereLight(0xd4e4ff,0x5a656d,1.9);scene.add(this.ambient);
  this.fill=new THREE.AmbientLight(0xa8bdd4,.14);scene.add(this.fill);
  this.moonLight=new THREE.DirectionalLight(0xa0b7ed,.12);scene.add(this.moonLight,this.moonLight.target);
  this.uniforms={sunDirection:{value:new THREE.Vector3()},day:{value:1},night:{value:0},time:{value:0},sunset:{value:0},rain:{value:0}};
  this.sky=new THREE.Mesh(new THREE.SphereGeometry(1050,32,20),new THREE.ShaderMaterial({side:THREE.BackSide,depthWrite:false,uniforms:this.uniforms,vertexShader:'varying vec3 ray;void main(){ray=normalize(position);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragmentShader:`
   precision highp float;varying vec3 ray;uniform vec3 sunDirection;uniform float day,night,time,sunset,rain;
   void main(){vec3 r=normalize(ray);float h=clamp(r.y,0.,1.);vec3 horizon=mix(vec3(.045,.065,.14),vec3(.73,.77,.74),day);vec3 zenith=mix(vec3(.012,.022,.075),vec3(.18,.39,.61),day);horizon=mix(horizon,vec3(.90,.42,.27),sunset*.72);vec3 color=mix(horizon,zenith,smoothstep(-.02,.78,h));float angle=max(0.,dot(r,sunDirection));color+=vec3(1.,.64,.32)*pow(angle,28.)*(.13+sunset*.25)*day;float horizonGlow=pow(1.-clamp(abs(r.y)*3.,0.,1.),3.);color+=vec3(.20,.065,.025)*horizonGlow*sunset*(.35+.65*pow(angle,4.));float moonGlow=pow(max(0.,dot(r,-sunDirection)),120.);color+=vec3(.08,.11,.19)*moonGlow*night;color*=mix(.72,1.,smoothstep(-.2,.02,r.y));color=mix(color,mix(vec3(.025,.04,.065),vec3(.31,.36,.40),day),rain*.72);gl_FragColor=vec4(color,1.);}`
  }));this.sky.renderOrder=-30;this.root.add(this.sky);
  this.sunDisc=new THREE.Mesh(new THREE.CircleGeometry(14,32),new THREE.MeshBasicMaterial({color:0xffdb9a,fog:false,depthWrite:false}));this.sunDisc.renderOrder=-20;this.root.add(this.sunDisc);
  this.moon=new THREE.Mesh(new THREE.IcosahedronGeometry(8,2),new THREE.MeshBasicMaterial({color:0xd5e0fb,fog:false,depthWrite:false}));this.moon.renderOrder=-20;this.root.add(this.moon);
  const craterMat=new THREE.MeshBasicMaterial({color:0xa5b5d5,fog:false});for(let i=0;i<6;i++){const crater=new THREE.Mesh(new THREE.IcosahedronGeometry(.5+(i%3)*.28,0),craterMat);crater.position.set(Math.sin(i*2.3)*4,Math.cos(i*3.1)*4,6.5);this.moon.add(crater);}
  const starPositions=[];let seed=92831;const random=()=>((seed=Math.imul(seed,1664525)+1013904223)>>>0)/4294967296;
  for(let i=0;i<240;i++){const y=.08+random()*.92,a=random()*Math.PI*2,r=Math.sqrt(1-y*y);starPositions.push(Math.cos(a)*r*840,y*840,Math.sin(a)*r*840);}
  const starGeo=new THREE.BufferGeometry();starGeo.setAttribute('position',new THREE.Float32BufferAttribute(starPositions,3));this.stars=new THREE.Points(starGeo,new THREE.PointsMaterial({color:0xd7e7ff,size:1.6,sizeAttenuation:true,transparent:true,opacity:0,depthWrite:false,fog:false}));this.root.add(this.stars);
  const cloudGeo=new THREE.IcosahedronGeometry(1,1),cloudMat=new THREE.MeshStandardMaterial({color:0xe4e2db,roughness:1,flatShading:true});this.cloudMat=cloudMat;this.clouds=new THREE.InstancedMesh(cloudGeo,cloudMat,45);const dummy=new THREE.Object3D();
  for(let i=0;i<45;i++){const cluster=Math.floor(i/3),a=cluster/15*Math.PI*2;dummy.position.set(Math.sin(a)*280+(i%3-1)*20,105+(cluster%4)*16,Math.cos(a)*280);dummy.scale.set(27+(i%4)*7,5+(i%3)*2,16+(i%5)*4);dummy.rotation.y=a;dummy.updateMatrix();this.clouds.setMatrixAt(i,dummy.matrix);}this.root.add(this.clouds);
  this.headlights=[];for(const side of [-1,1]){const light=new THREE.SpotLight(0xd6eaff,0,90,.30,.52,1.25);light.castShadow=side===-1;light.shadow.mapSize.set(512,512);light.shadow.bias=-.0004;scene.add(light,light.target);this.headlights.push({light,side});}
  this.streetPool=Array.from({length:4},()=>{const light=new THREE.PointLight(0xffcf88,0,24,1.5);scene.add(light);return light;});
  this.nosLight=new THREE.PointLight(0x67dcff,0,11,1.5);scene.add(this.nosLight);
  this.policePool=Array.from({length:2},()=>{const light=new THREE.PointLight(0x398cff,0,25,1.5);light.castShadow=false;scene.add(light);return light;});
  this._lampClock=0;this._lamps=[];this._lampAnchor={x:Infinity,z:Infinity};
  this._cloudNight=new THREE.Color(0x303b5b);this._sunWarm=new THREE.Color(0xff9b6b);this._ambientNight=new THREE.Color(0x5975a8);this._groundNight=new THREE.Color(0x263447);
  this._skyColor=new THREE.Color();this._groundColor=new THREE.Color();this._fogDay=new THREE.Color(0x9fbdc7);this._fogNight=new THREE.Color(0x172338);this._sunDir=new THREE.Vector3();
 }
 setWorld(world){this.world=world;this.weather.bindWorld(world);this.weatherView.setWorld(world);this._lampClock=0;this._lamps=[];this.world?.setNight?.(this.night);for(const light of this.policePool)light.intensity=0;}
 update(dt,state,camera,settings={},time=0,context={}){
  this.weather.step(dt,settings.weatherMode);const rain=this.weather.rain;this.uniforms.rain.value=rain;
  if(settings.timeMode==='day')this.hour=13.5;else if(settings.timeMode==='night')this.hour=23;else if(settings.timeMode==='sunset')this.hour=17.6;else this.hour=(this.hour+dt*24/Math.max(180,(settings.dayMinutes??12)*60))%24;
  const angle=(this.hour-6)/24*Math.PI*2,elevation=Math.sin(angle);const day=clamp((elevation+.12)/.38),sunset=clamp(1-Math.abs(elevation)/.33)*day;
  this.night=1-day;this._sunDir.set(Math.cos(angle)*.90,elevation,Math.cos(angle)*.43).normalize();
  const x=state.x||0,z=state.z||0,y=state.groundHeight||0;this.root.position.set(x,y,z);
  this.uniforms.sunDirection.value.copy(this._sunDir);this.uniforms.day.value=day;this.uniforms.night.value=this.night;this.uniforms.sunset.value=sunset;this.uniforms.time.value=time;
  this.sunDisc.position.copy(this._sunDir).multiplyScalar(780);this.sunDisc.visible=elevation>-.12;this.sunDisc.lookAt(camera.position);
  this.moon.position.copy(this._sunDir).multiplyScalar(-780);this.moon.visible=this.night>.1;this.moon.lookAt(camera.position);
  this.stars.material.opacity=this.night*.85*(1-rain);this.cloudMat.color.setHex(0xe7e3dc).lerp(this._cloudNight,this.night);this.cloudMat.color.multiplyScalar(1-rain*.35);this.clouds.rotation.y=time*.0007;
  this.sun.position.set(x+this._sunDir.x*140,y+Math.max(8,this._sunDir.y*140),z+this._sunDir.z*140);this.sun.target.position.set(x,y,z);this.sun.target.updateMatrixWorld();this.sun.intensity=(1.9+elevation*.8)*day*(1-rain*.8);this.sunDisc.visible=this.sunDisc.visible&&rain<.6;
  this.sun.color.setHex(0xfff2d6).lerp(this._sunWarm,sunset*.6);
  this.moonLight.position.set(x-this._sunDir.x*100,y+60,z-this._sunDir.z*100);this.moonLight.target.position.set(x,y,z);this.moonLight.intensity=.30*this.night*(1-rain*.65);
  this.ambient.intensity=mix(1.65,.38,this.night)*(1-rain*.25);this.ambient.color.setHex(0xbcd7ed).lerp(this._ambientNight,this.night);this.ambient.groundColor.setHex(0x64747c).lerp(this._groundNight,this.night);this.fill.intensity=.08+.06*this.night;
  this.scene.fog.color.copy(this._fogDay).lerp(this._fogNight,this.night);this.scene.fog.near=mix(220,130,this.night);this.scene.fog.far=mix(this.world?.region?2400:980,this.world?.region?1200:610,this.night);
  this.scene.fog.near*=1-rain*.65;this.scene.fog.far*=1-rain*.6;
  this.weatherView.update(state,camera,time,settings.quality);this.renderer.toneMappingExposure=mix(1.03,.91,this.night);
  const heading=state.heading||0,sn=Math.sin(heading),cs=Math.cos(heading),on=!!settings.headlights;
  for(const {light,side}of this.headlights){light.position.set(x+sn*1.9+cs*side*.65,(state.bodyHeight||0)+.68,z+cs*1.9-sn*side*.65);light.target.position.set(x+sn*32+cs*side*.7,(state.groundHeight||0)+.03,z+cs*32-sn*side*.7);light.intensity=on?mix(12,45,this.night)*(state.mechanical?.auxiliaries?.lampFactor??1)*lampOutput(state.bodyDamage,side<0?'lampFL':'lampFR'):0;light.castShadow=on&&light.intensity>0&&side<0&&settings.quality==='high';light.target.updateMatrixWorld();}
  this._lampClock-=Math.max(0,dt);if(this._lampClock<=0||Math.hypot(x-this._lampAnchor.x,z-this._lampAnchor.z)>8){this._lampClock=.25;this._lampAnchor={x,z};this._lamps=(this.world?.streetLights||[]).map(p=>({p,d:(p.x-x)**2+(p.z-z)**2})).filter(q=>q.d<65**2).sort((a,b)=>a.d-b.d).slice(0,4);}
  this.streetPool.forEach((light,i)=>{const p=this._lamps[i]?.p;if(p){light.position.set(p.x,p.y||6.5,p.z);light.intensity=22*this.night;}else light.intensity=0;});
  const officers=(context.police||[]).filter(p=>p.siren&&Number.isFinite(p.x)&&Number.isFinite(p.z)&&Math.hypot(p.x-x,p.z-z)<90).sort((a,b)=>Math.hypot(a.x-x,a.z-z)-Math.hypot(b.x-x,b.z-z));
  this.policePool.forEach((light,i)=>{const p=officers[i];if(!p){light.intensity=0;return;}const phase=(time*2.5+i*.43)%1,blue=phase<.5,flash=.35+.65*Math.pow(Math.sin(phase*Math.PI*4),2),heading=p.heading||0;light.color.setHex(blue?0x247cff:0xff3051);light.position.set(p.x+Math.cos(heading)*(blue?-.48:.48),(this.world?.getSurfaceAt?.(p.x,p.z)?.height||0)+1.65,p.z-Math.sin(heading)*(blue?-.48:.48));light.distance=settings.quality==='psx'?16:25;light.intensity=(settings.quality==='psx'?35:82)*(.28+this.night*.72)*flash;});
  this.nosLight.position.set(x-sn*2,(state.bodyHeight||0)+.5,z-cs*2);this.nosLight.intensity=state.boosting?14*(state.nitrousIntensity??1):0;
  this.world?.setNight?.(this.night);return {hour:this.hour,night:this.night,day};
 }
 getClock(){const h=Math.floor(this.hour),m=Math.floor(this.hour%1*60);return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;}
}
