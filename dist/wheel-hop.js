const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export const HOP_PARTS={tractionLinks:[
 {id:'stock',name:'FACTORY AXLE LINKS',description:'Standard compliant axle links and bushings. Abrupt traction changes can excite wheel hop.'},
 {id:'braced',name:'BRACED AXLE LINKS',description:'Stiffer links and damped bushings reduce traction-induced wheel hop. Adds 3 kg; no extra tyre grip.'}
]};
export const HOP_LABELS={tractionLinks:'AXLE LINKS'};
export const HOP_DEFAULTS={tractionLinks:'stock'};
export const HOP_PRICES={tractionLinks:{stock:0,braced:3200}};
/** Reduced axle-tramp mode. Force changes excite a damped mode, bounded by
 * actual longitudinal tyre dissipation. No timer, prescribed sine or free grip.
 * This is not a full unsprung-mass/CV-joint suspension simulation. */
export class WheelHop{
 constructor(build){this.braced=build.selection.tractionLinks==='braced';this.mass=28+build.physics.wheelInertia*6;this.stiffness=this.braced?180000:140000;this.reset();}
 reset(){this.wheels=Array.from({length:4},()=>({x:0,v:0,force:0,energy:0,inputJ:0,dissipatedJ:0}));}
 advance(dt,health,attached){
  const k=this.stiffness,m=this.mass;
  for(let i=0;i<4;i++){const w=this.wheels[i];if(!attached[i]){w.dissipatedJ+=w.energy;w.x=w.v=w.force=w.energy=0;continue;}
   const c=(this.braced?1900:650)*(.18+.82*health[i]),before=.5*m*w.v*w.v+.5*k*w.x*w.x;
   // Trapezoidal spring/damper integration is passive at any caller step.
   const v=((1-c*dt/(2*m)-k*dt*dt/(4*m))*w.v-k*dt/m*w.x)/(1+c*dt/(2*m)+k*dt*dt/(4*m));
   w.x+=dt*(w.v+v)*.5;w.v=v;w.energy=.5*m*v*v+.5*k*w.x*w.x;w.dissipatedJ+=Math.max(0,before-w.energy);
  }
 }
 excite(i,dt,{force,slipWork,slipSpeed,driven,contact,load}){
  const w=this.wheels[i],delta=force-w.force;w.force=force;
  if(!driven||!contact||Math.abs(slipSpeed)<3||Math.abs(force)<load*.25)return 0;
  const activity=clamp((Math.abs(slipSpeed)-3)/7,0,1),j=delta*dt*(this.braced?.7:2.8)*activity;
  const old=.5*this.mass*w.v*w.v,budget=Math.max(0,slipWork)*.08*activity;
  let next=w.v+j/this.mass;
  if(.5*this.mass*next*next-old>budget)next=Math.sign(next)*Math.sqrt(w.v*w.v+2*budget/this.mass);
  // The travel stop dissipates excess energy rather than teleporting a wheel.
  next=clamp(next,-4,4);w.v=next;const work=.5*this.mass*next*next-old;w.inputJ+=Math.max(0,work);w.dissipatedJ+=Math.max(0,-work);w.energy=.5*this.mass*next*next+.5*this.stiffness*w.x*w.x;
  return Math.max(0,work);
 }
 contact(i,baseLoad){const w=this.wheels[i],unload=Math.max(0,w.x)*this.stiffness;return {load:Math.max(0,baseLoad-unload),gap:Math.max(0,w.x-baseLoad/this.stiffness),velocity:w.v,travel:w.x};}
}
