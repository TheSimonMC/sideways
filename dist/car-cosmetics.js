import * as THREE from './vendor/three.module.js';

/** Body-specific mount points and shared authored components, all under the
 * deforming chassis. Cosmetic choices deliberately leave the drivetrain alone. */
export function addCosmetics({chassis,selection:s,q,L,W,paint,dark,graphite,chrome,accent,box,panel,beam}){
 const part=key=>{const g=new THREE.Group();g.name='cosmetic-'+key+'-'+s[key];g.userData.cosmetic=key;chassis.add(g);return g;};
 const top=z=>{const r=q.rings;let i=0;while(i<r.length-2&&r[i+1][0]*L<z)i++;const a=r[i],b=r[i+1],t=Math.max(0,Math.min(1,(z-a[0]*L)/((b[0]-a[0])*L)));return a[2]+(b[2]-a[2])*t+.018;};
 if(s.hood!=='stock'){
  const g=part('hood'),rear=q.screenFront+.04,front=L*.88,mid=(rear+front)/2,mat=s.hood==='carbon'?graphite:paint;
  panel(g,[[-W*.68,top(rear),rear],[W*.68,top(rear),rear],[W*.59,top(front),front],[-W*.59,top(front),front]],mat);
  if(s.hood==='carbon'){
   panel(g,[[-.29,top(rear)+.08,rear],[.29,top(rear)+.08,rear],[.20,top(front)+.035,front],[-.20,top(front)+.035,front]],graphite);
   for(const side of[-1,1])for(const z of[rear+.09,front-.08])box(g,side*W*.55,top(z)+.015,z,.035,.014,.035,chrome);
  }else if(s.hood==='vented'){
   for(const side of[-1,1]){panel(g,[[side*.15,top(rear+.12)+.01,rear+.12],[side*.47,top(rear+.12)+.01,rear+.12],[side*.44,top(front-.12)+.01,front-.12],[side*.15,top(front-.12)+.01,front-.12]],dark,false);for(let i=0;i<5;i++){const z=rear+.16+(front-rear-.30)*i/4;box(g,side*.31,top(z)+.045,z,.33,.035,.045,mat);}}
  }else{
   const a=rear+.10,b=front-.12;panel(g,[[-.33,top(a),a],[-.27,top(a)+.23,a],[.27,top(a)+.23,a],[.33,top(a),a]],mat);
   panel(g,[[-.27,top(a)+.23,a],[.27,top(a)+.23,a],[.30,top(b)+.23,b],[-.30,top(b)+.23,b]],mat);
   for(const side of[-1,1])panel(g,[[side*.33,top(a),a],[side*.27,top(a)+.23,a],[side*.30,top(b)+.23,b],[side*.36,top(b),b]],mat);
   box(g,0,top(b)+.12,b+.006,.54,.18,.018,dark);for(const x of[-.15,0,.15])box(g,x,top(b)+.12,b+.02,.016,.16,.02,chrome);
  }
 }
 if(s.spoiler!=='stock'&&s.spoiler!=='none'){
  const g=part('spoiler'),z=-L*.87,y=q.rings[0][2]+.05;
  if(s.spoiler==='ducktail'){panel(g,[[-W*.94,y,z+.17],[W*.94,y,z+.17],[W*.98,y+.23,z-.12],[-W*.98,y+.23,z-.12]],paint);panel(g,[[-W*.98,y+.23,z-.12],[W*.98,y+.23,z-.12],[W*.94,y-.02,z-.12],[-W*.94,y-.02,z-.12]],paint);}
  else{for(const side of[-1,1]){panel(g,[[side*W*.60,y,z+.12],[side*W*.60,y+.64,z-.04],[side*W*.60,y+.64,z-.20],[side*W*.60,y,z-.08]],graphite);panel(g,[[side*W*1.10,y+.50,z-.38],[side*W*1.10,y+.84,z-.32],[side*W*1.10,y+.80,z+.20],[side*W*1.10,y+.57,z+.16]],paint);}panel(g,[[-W*1.10,y+.70,z-.35],[W*1.10,y+.70,z-.35],[W*1.10,y+.64,z+.18],[-W*1.10,y+.64,z+.18]],graphite);box(g,0,y+.72,z-.31,W*2.08,.025,.045,accent);}
 }
 if(s.sideSkirts!=='stock'){const g=part('sideSkirts');for(const side of[-1,1]){const x=side*W*1.06;panel(g,[[x,.41,-.96],[x,.39,.99],[side*W*1.14,.19,.90],[side*W*1.16,.19,-.98]],s.sideSkirts==='street'?paint:graphite);box(g,side*W*1.14,.20,-.02,.035,.025,1.8,s.sideSkirts==='race'?accent:dark);if(s.sideSkirts==='race')panel(g,[[x,.23,-1.02],[side*W*1.17,.23,-1.02],[side*W*1.17,.48,-.87],[x,.35,-.87]],graphite);}}
 if(s.frontBumper!=='stock'){const g=part('frontBumper'),z=L*.99;for(const side of[-1,1]){box(g,side*W*.84,.44,z,.31,.27,.21,paint,true);box(g,side*W*.84,.44,z+.114,.19,.12,.018,dark);}
  panel(g,[[-W*1.10,.24,z+.18],[W*1.10,.24,z+.18],[W*1.05,.25,z-.30],[-W*1.05,.25,z-.30]],graphite);if(s.frontBumper==='race')for(const side of[-1,1]){panel(g,[[side*W*1.05,.49,z-.10],[side*W*1.20,.44,z+.05],[side*W*1.13,.42,z-.35]],graphite);beam(g,[side*.57,.29,z+.15],[side*.54,.56,z-.02],.013,chrome);}}
 if(s.rearBumper!=='stock'){const g=part('rearBumper'),z=-L*.99;for(const side of[-1,1])box(g,side*W*.88,.40,z,.27,.27,.22,paint,true);panel(g,[[-W*.83,.27,z-.13],[W*.83,.27,z-.13],[W*.80,.18,z+.40],[-W*.80,.18,z+.40]],graphite);if(s.rearBumper==='race')for(const x of[-.64,-.32,0,.32,.64])panel(g,[[x,.18,z+.40],[x,.32,z-.16],[x,.13,z-.16],[x,.09,z+.40]],graphite);}
}

export function addRim({spin,style,R,side,width,chrome,graphite,box}){
 const g=new THREE.Group();g.name='cosmetic-rims-'+style;spin.add(g);const face=side*(width*.5+.018),gold=new THREE.MeshStandardMaterial({color:0xc7a35c,roughness:.3,metalness:.75});
 const ring=new THREE.Mesh(new THREE.TorusGeometry(R*.70,.022,5,24),chrome);ring.rotation.y=Math.PI/2;ring.position.x=face;g.add(ring);
 const n=style==='five'?5:style==='mesh'?12:6;
 for(let i=0;i<n;i++){const a=i*Math.PI*2/n;if(style==='dish'){const disc=new THREE.Mesh(new THREE.CircleGeometry(R*.64,24),chrome);disc.rotation.y=side*Math.PI/2;disc.position.x=face-.01*side;if(i===0)g.add(disc);else disc.geometry.dispose();const cut=box(g,face+.008*side,Math.sin(a)*R*.43,Math.cos(a)*R*.43,.014,R*.15,R*.25,graphite);cut.rotation.x=-a+.35;}else{for(const offset of style==='mesh'?[-.15,.15]:[0]){const spoke=box(g,face,Math.sin(a)*R*.32,Math.cos(a)*R*.32,.025,style==='mesh'?R*.055:R*.16,R*.64,style==='mesh'?gold:chrome);spoke.rotation.x=-a+offset;}}}
 if(style!=='mesh')gold.dispose();
}
