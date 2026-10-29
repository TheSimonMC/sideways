// Coordinates share car.js geometry: +Z is the nose, +X is the right side.
// The renderer can supply deformed world anchors; this fallback also works in QA.
const clamp=(n,a,b)=>Math.max(a,Math.min(b,Number.isFinite(n)?n:a));
const point=(x,y,z)=>({x,y,z});
export function vehicleAudioAnchors(build={},state={}){
 const p=build.physics||{},m=build.vehicle?.model||{},kind=m.kind||'coupe',length=(m.length||4.42)*.5;
 const pitch=clamp(state.bodyPitch||0,-.4,.4),roll=clamp(state.bodyRoll||0,-.42,.42),h=state.heading||0;
 function rotate(x,y,z){const xr=x*Math.cos(roll)-y*Math.sin(roll),yr=x*Math.sin(roll)+y*Math.cos(roll),yp=yr*Math.cos(pitch)-z*Math.sin(pitch),zp=yr*Math.sin(pitch)+z*Math.cos(pitch);return point(xr*Math.cos(h)+zp*Math.sin(h),yp,-xr*Math.sin(h)+zp*Math.cos(h));}
 function body(x,y,z){const r=rotate(x,y,z);return point(r.x+(state.x||0),r.y+(state.bodyHeight||0)+(p.rideHeight||0),r.z+(state.z||0));}
 const pipes=kind==='muscle'?[-.70,.70]:kind==='wedge'?[.60]:[.61,.77];
 return {exhaust:pipes.map(x=>body(x,.32,-length*.976-.119)),engine:body(0,.65,length*.43),intake:body(-.20,.75,length*.52),gearbox:body(0,.28,.20),differential:body(0,.25,-(p.rearAxle||1.3)),exhaustDirection:rotate(0,0,-1),frontDirection:rotate(0,0,1),
  wheels:[0,1,2,3].map(i=>{const x=(i%2?1:-1)*(p.halfTrack||.87),z=i<2?(p.frontAxle||1.3):-(p.rearAxle||1.3);return point((state.x||0)+x*Math.cos(h)+z*Math.sin(h),state.suspension?.[i]?.wheelY??p.wheelRadius??.34,(state.z||0)-x*Math.sin(h)+z*Math.cos(h));})};
}
const xyz=p=>[p.x||0,p.y||0,p.z||0];
export function vehicleAudioScene(build,state={},context={},cameraMode=0,reverb=.65){
 const anchors=context.audioAnchors||vehicleAudioAnchors(build,state),raw=context.listenerPosition||{x:state.x||0,y:1.5,z:(state.z||0)-5};
 let position=xyz(raw);if(!Number.isFinite(raw.y))position[1]=cameraMode===2?1.1:2.6;
 // The overhead view intentionally uses a near-car microphone. Chase and hood
 // retain actual camera distance/height; the ear axis always follows camera yaw.
 if(cameraMode===0){const center=[state.x||0,(state.bodyHeight||0)+.8,state.z||0],d=position.map((n,i)=>n-center[i]),length=Math.hypot(...d),scale=Math.min(1,5.5/Math.max(.01,length));position=center.map((n,i)=>n+d[i]*scale);}
 const h=context.cameraHeading??state.heading??0,right=context.listenerRight?xyz(context.listenerRight):[-Math.cos(h),0,Math.sin(h)];
 const wallRightLength=Math.max(.001,Math.hypot(right[0],right[2])),rx=right[0]/wallRightLength,rz=right[2]/wallRightLength,fx=Math.sin(h),fz=Math.cos(h),space=context.acoustics||{};
 const walls=[[-rx,-rz,space.leftDistance],[rx,rz,space.rightDistance],[fx,fz,space.frontDistance],[-fx,-fz,space.backDistance]];
 const reflectivity=clamp(space.reflectivity??.35,0,1),amount=clamp(reverb,0,1)*reflectivity;
 const emitters=[];
 const add=(id,source,p,direction,gain=1,reflect=false)=>{
  const reflections=[];
  if(reflect)for(let i=0;i<walls.length;i++){const[nx,nz,distance]=walls[i];if(!Number.isFinite(distance)||distance>=89)continue;const plane=(state.x||0)*nx+(state.z||0)*nz+distance,offset=plane-p.x*nx-p.z*nz;if(offset<=0)continue;reflections.push({position:[p.x+2*offset*nx,p.y,p.z+2*offset*nz],gain:amount*.0375});}
  emitters.push({id,source,position:xyz(p),direction:xyz(direction),gain,reflections});
 };
 anchors.exhaust.forEach((p,i)=>add('exhaust-'+i,'exhaust',p,anchors.exhaustDirection,1/anchors.exhaust.length,true));
 add('intake','intake',anchors.intake,anchors.frontDirection,1,true);
 for(const source of ['combustion','valve','bearing','boost','manifold','mechanical','chain'])add(source,source,source==='boost'?anchors.intake:anchors.engine,anchors.frontDirection,1,source==='combustion');
 add('gearbox','gearbox',anchors.gearbox,point(0,0,0));
 return {scene:{position,right,emitters},anchors,microphone:cameraMode===0?'near-car-overhead':'camera'};
}
