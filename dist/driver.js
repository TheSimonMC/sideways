import * as THREE from './vendor/three.module.js';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const Y=new THREE.Vector3(0,1,0);
export function createDriver(parent,layout,wheel,levers){
 const root=new THREE.Group();root.name='driver';parent.add(root);
 const cloth=new THREE.MeshStandardMaterial({color:0x526573,roughness:1,flatShading:true}),skin=new THREE.MeshStandardMaterial({color:0xc89472,roughness:.9,flatShading:true}),glove=new THREE.MeshStandardMaterial({color:0x272e37,roughness:1,flatShading:true}),shoe=new THREE.MeshStandardMaterial({color:0x1d232b,roughness:1});
 const cylinder=new THREE.CylinderGeometry(1,1,1,7),sphere=new THREE.IcosahedronGeometry(1,1),cube=new THREE.BoxGeometry(1,1,1);
 const piece=(name,geo,mat,size)=>{const mesh=new THREE.Mesh(geo,mat);mesh.name=name;mesh.scale.set(...size);mesh.castShadow=true;root.add(mesh);return mesh;};
 const torso=piece('driver-torso',cube,cloth,[.29,.32,.17]),head=piece('driver-head',sphere,skin,[.095,.115,.10]),cap=piece('driver-cap',sphere,glove,[.098,.055,.104]);
 const arms=[0,1].map(i=>({upper:piece('upper-arm-'+i,cylinder,cloth,[.047,.24,.047]),lower:piece('forearm-'+i,cylinder,cloth,[.038,.24,.038]),hand:piece('hand-'+i,sphere,glove,[.041,.047,.038]),theta:i?0:Math.PI,regrip:null,grip:true,error:0}));
 const legs=[0,1].map(i=>({upper:piece('thigh-'+i,cylinder,cloth,[.065,.27,.065]),lower:piece('shin-'+i,cylinder,cloth,[.05,.28,.05]),foot:piece('shoe-'+i,cube,shoe,[.095,.055,.16])}));
 let previousAngle=0,previousGear=null,shift=0,bob=0;
 const bind=(mesh,a,b,radius)=>{const delta=b.clone().sub(a);mesh.position.copy(a).add(b).multiplyScalar(.5);mesh.scale.set(radius,delta.length(),radius);mesh.quaternion.setFromUnitVectors(Y,delta.normalize());};
 // Two links reach a target with the elbow/knee constrained away from the dash.
 const joint=(a,b,length,bend)=>{const v=b.clone().sub(a),distance=Math.min(length*1.999,v.length()),mid=a.clone().lerp(b,.5),direction=v.normalize(),offset=bend.clone().addScaledVector(direction,-bend.dot(direction)).normalize();return mid.addScaledVector(offset,Math.sqrt(Math.max(.002,length*length-distance*distance/4)));};
 function update(s,dt,angle,{cockpit=false,hands=true}={}){
  const h=Math.min(.05,Math.max(0,dt)),lat=clamp(s.accelerationLat||0,-12,12)*-.002,long=clamp(s.accelerationLong||0,-12,12)*-.002;
  const suspension=(s.suspension||[]).reduce((sum,w)=>sum+(w.velocity||0),0)/4;bob+=(clamp(suspension,-2,2)*-.007-bob)*(1-Math.exp(-h*12));
  torso.position.set(layout.driverX+lat,layout.eye[1]-.28+bob,layout.seatZ-.08+long);torso.rotation.z=lat*1.5;torso.rotation.x=-.12+long;
  head.position.set(layout.driverX+lat*.65,layout.eye[1]-.005,layout.seatZ-.035+long);cap.position.copy(head.position).add(new THREE.Vector3(0,.083,0));head.visible=cap.visible=!cockpit;
  if(previousGear!==null&&previousGear!==s.gear)shift=.34;previousGear=s.gear;shift=Math.max(0,shift-h);
  const delta=angle-previousAngle;previousAngle=angle;wheel.updateMatrix();
  for(let i=0;i<2;i++){
   const arm=arms[i],side=i?1:-1,base=i?0:Math.PI;arm.theta+=clamp(delta,-1,1);
   if(!arm.regrip&&Math.abs(arm.theta-base)>1.3&&!arms[1-i].regrip)arm.regrip={from:arm.theta,to:base-Math.sign(delta||arm.theta-base)*.6,time:0};
   let radius=layout.wheelRadius,depth=0;
   if(arm.regrip){const r=arm.regrip;r.time+=h;const t=clamp(r.time/.24,0,1),ease=t*t*(3-2*t);arm.theta=r.from+(r.to-r.from)*ease;radius+=Math.sin(t*Math.PI)*.04;depth=-Math.sin(t*Math.PI)*.06;if(t===1)arm.regrip=null;}
   let target=new THREE.Vector3(Math.cos(arm.theta)*radius,Math.sin(arm.theta)*radius,depth).applyMatrix4(wheel.matrix);
   let reach=0;if(i===(layout.driverX<0?1:0)){if((s.handbrake||0)>.05)reach=clamp(s.handbrake*3,0,1);else if(shift>0)reach=Math.sin(Math.PI*shift/.34);const lever=(s.handbrake||0)>.05?levers.handbrake:levers.shifter;lever.updateMatrix();if(reach>0)target.lerp(new THREE.Vector3(0,(s.handbrake||0)>.05?.10:.075,0).applyMatrix4(lever.matrix),reach);}
   const shoulder=new THREE.Vector3(layout.driverX+side*.15+lat,layout.eye[1]-.22+bob,layout.seatZ-.025+long),elbow=joint(shoulder,target,.255,new THREE.Vector3(side*.7,-1,-.2));
   bind(arm.upper,shoulder,elbow,.047);bind(arm.lower,elbow,target,.038);arm.hand.position.copy(target);arm.hand.rotation.z=arm.theta;
   for(const mesh of [arm.upper,arm.lower,arm.hand])mesh.visible=!cockpit||hands;
   arm.grip=!arm.regrip&&reach<.01;arm.error=arm.grip?target.clone().applyMatrix4(wheel.matrix.clone().invert()).length()-layout.wheelRadius:null;
  }
  for(let i=0;i<2;i++){
   const side=i?1:-1,leg=legs[i],hip=new THREE.Vector3(layout.driverX+side*.08,.49,layout.seatZ-.02),pedal=i?(s.clutch||0):Math.max(s.throttle||0,s.brake||0),pedalX=i?.08:(s.brake||0)>.02?0:-.08,foot=new THREE.Vector3(layout.driverX+pedalX,.34,layout.dashZ+.01+pedal*.015),knee=joint(hip,foot,.34,new THREE.Vector3(side*.2,1,-.15));
   bind(leg.upper,hip,knee,.065);bind(leg.lower,knee,foot,.05);leg.foot.position.copy(foot);leg.foot.rotation.x=-.16-pedal*.3;
  }
 }
 return {root,update,get bob(){return bob;},diagnostics:()=>({hands:arms.map(a=>({gripping:a.grip,error:a.error,visible:a.hand.visible,position:a.hand.position.toArray(),regripping:!!a.regrip})),feet:legs.map(l=>l.foot.position.toArray()),headVisible:head.visible,shift,bob})};
}
