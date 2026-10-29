/* Persistent local crush zones. This is a lightweight plastic deformation
 * model coupled to collision energy, not a soft-body structural solver. */
const clamp=(v,a,b)=>Math.max(a,Math.min(b,Number.isFinite(v)?v:a));
export const BODY_PANELS={
 front:{label:'Front bumper',x:0,z:.48,radius:.29,detach:true},
 rear:{label:'Rear bumper',x:0,z:-.48,radius:.29,detach:true},
 left:{label:'Left door and sill',x:-.48,z:0,radius:.38},
 right:{label:'Right door and sill',x:.48,z:0,radius:.38},
 hood:{label:'Hood and front rails',x:0,z:.30,radius:.35},
 boot:{label:'Trunk and rear rails',x:0,z:-.30,radius:.35},
 roof:{label:'Roof and pillars',x:0,z:0,radius:.36}
};
const BODY_KEYS=Object.keys(BODY_PANELS);
export function createBodyDamage(build,saved={},legacyHealth=1){
 const zones={},width=build.vehicle.model.width,length=build.vehicle.model.length;
 for(const [id,definition]of Object.entries(BODY_PANELS)){
  const prior=saved?.zones?.[id]||{},legacy=Object.keys(saved?.zones||{}).length?0:(1-clamp(legacyHealth,0,1))*.25;
  zones[id]={health:clamp(prior.health??1-legacy,0,1),crush:clamp(prior.crush??legacy*.25,0,.7),x:clamp(prior.x??definition.x*width,-width,width),z:clamp(prior.z??definition.z*length,-length,length),pushX:clamp(prior.pushX??0,-1,1),pushZ:clamp(prior.pushZ??(definition.z>0?-1:1),-1,1),detached:!!definition.detach&&prior.detached===true};
 }
 return {version:1,revision:Math.round(clamp(saved?.revision??0,0,1e9)),zones};
}
export const snapshotBodyDamage=body=>({version:1,revision:body.revision,zones:Object.fromEntries(Object.entries(body.zones).map(([id,zone])=>[id,{...zone}]))});

export function deformBody(body,build,{local,energyJ,closingSpeed}){
 const width=build.vehicle.model.width,length=build.vehicle.model.length,scale=build.physics.bodyStrength??1;
 const specific=clamp(energyJ/(build.physics.mass*140*scale),0,5),strength=clamp((closingSpeed-2.2)/12,0,1),detached=[];
 const front=local.z>length*.26,rear=local.z<-length*.26,side=Math.abs(local.x)>width*.27;
 const direction={x:-local.x,z:-local.z},magnitude=Math.hypot(direction.x,direction.z)||1;direction.x/=magnitude;direction.z/=magnitude;
 let changed=false;
 for(const [id,definition]of Object.entries(BODY_PANELS)){
  const zone=body.zones[id],cx=definition.x*width,cz=definition.z*length;
  let weight=Math.max(0,1-Math.hypot((local.x-cx)*1.15,local.z-cz)/(definition.radius*length));
  if(id==='roof')weight*=specific>.9?.16:0;
  if(id==='left'&&local.x>0||id==='right'&&local.x<0)weight*=.05;
  if(id==='front'&&!front||id==='rear'&&!rear)weight*=.10;
  if((id==='hood'&&!front||id==='boot'&&!rear)&&side)weight*=.32;
  const loss=specific*weight*.33*strength;if(loss<.0001)continue;
  const previous=zone.crush,increment=Math.min(.20,specific*weight*.16*strength),next=Math.min(.7,previous+increment);
  zone.health=clamp(zone.health-loss,0,1);zone.crush=next;
  const blend=increment/Math.max(.0001,previous+increment);zone.x+=(local.x-zone.x)*blend;zone.z+=(local.z-zone.z)*blend;zone.pushX+=(direction.x-zone.pushX)*blend;zone.pushZ+=(direction.z-zone.pushZ)*blend;
  if(definition.detach&&!zone.detached&&zone.health<.14&&closingSpeed>9){zone.detached=true;detached.push(id);}
  changed=true;
 }
 if(changed)body.revision++;
 return {changed,detached};
}

export function repairBody(body,id='body'){
 const keys=id==='body'?Object.keys(BODY_PANELS):id.startsWith('panel:')?[id.slice(6)]:[];
 let repaired=false;for(const key of keys){const zone=body.zones[key];if(!zone)continue;Object.assign(zone,{health:1,crush:0,detached:false,pushX:0,pushZ:0});repaired=true;}
 if(repaired)body.revision++;return repaired;
}

// Writes into the caller-owned vector to keep rendering allocation-free.
export function bodyDisplacement(body,x,y,z,out={x:0,y:0,z:0}){
 out.x=out.y=out.z=0;if(!body?.zones)return out;
 for(const id of BODY_KEYS){const zone=body.zones[id];
  if(zone.crush<=0)continue;
  const radius=id==='roof'?1.2:id==='left'||id==='right'?1.35:1.65;
  const distance=Math.hypot(x-zone.x,z-zone.z),t=Math.max(0,1-distance/radius),weight=t*t*(3-2*t),heightWeight=id==='roof'?clamp((y-.65)/.55,0,1):1;
  const dent=zone.crush*weight*heightWeight;out.x+=zone.pushX*dent;out.z+=zone.pushZ*dent;out.y-=dent*(id==='roof'?.60:.17);
 }
 out.x=clamp(out.x,-.68,.68);out.z=clamp(out.z,-.68,.68);out.y=clamp(out.y,-.42,.10);return out;
}
