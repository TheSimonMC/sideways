/* The fixed 120 Hz simulation remains authoritative. Only the rendered pose
   is interpolated, so wheels, body, camera and the motion-blur mask agree. */
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const scalarKeys=['x','z','vx','vz','speed','forwardSpeed','lateralSpeed','yawRate','bodyHeight','bodyPitch','bodyRoll','groundHeight','steer'];
const cornerKeys=['compression','travel','load','groundHeight','wheelY'];
const arrayKeys=['wheelSpins','wheelSteers','wheelLoads'];
const value=(n,fallback=0)=>Number.isFinite(n)?n:fallback;
function pose(){return {suspension:Array.from({length:4},()=>({})),wheelSpins:[0,0,0,0],wheelSteers:[0,0,0,0],wheelLoads:[0,0,0,0]};}
function capture(target,source){
 for(const key of scalarKeys)target[key]=value(source[key]);
 target.heading=value(source.heading);target.driftAngle=value(source.driftAngle);
 for(const key of arrayKeys)for(let i=0;i<4;i++)target[key][i]=value(source[key]?.[i],key==='wheelSteers'&&i<2?value(source.steer):0);
 for(let i=0;i<4;i++){const a=source.suspension?.[i]||{};Object.assign(target.suspension[i],a);for(const key of cornerKeys)target.suspension[i][key]=value(a[key]);}
 return target;
}
function angle(a,b,t){return a+Math.atan2(Math.sin(b-a),Math.cos(b-a))*t;}
export class PoseBuffer{
 constructor(){this.previous=pose();this.current=pose();this.output=pose();this.outputCorners=this.output.suspension;this.outputArrays=Object.fromEntries(arrayKeys.map(k=>[k,this.output[k]]));this.ready=false;}
 reset(state){capture(this.previous,state);capture(this.current,state);this.ready=true;return this.sample(state,1);}
 push(state){if(!this.ready)return this.reset(state);const swap=this.previous;this.previous=this.current;this.current=swap;capture(this.current,state);return this;}
 sample(state,alpha){
  if(!this.ready)return this.reset(state);
  const t=clamp(value(alpha,1),0,1),a=this.previous,b=this.current,out=this.output;
  Object.assign(out,state);
  for(const key of scalarKeys)out[key]=a[key]+(b[key]-a[key])*t;
  out.heading=angle(a.heading,b.heading,t);out.driftAngle=angle(a.driftAngle,b.driftAngle,t);
  for(const key of arrayKeys){out[key]=this.outputArrays[key];for(let i=0;i<4;i++)out[key][i]=a[key][i]+(b[key][i]-a[key][i])*t;}
  out.suspension=this.outputCorners;
  for(let i=0;i<4;i++){Object.assign(out.suspension[i],b.suspension[i]);for(const key of cornerKeys)out.suspension[i][key]=a.suspension[i][key]+(b.suspension[i][key]-a.suspension[i][key])*t;}
  [out.wheelSpinFL,out.wheelSpinFR,out.wheelSpinL,out.wheelSpinR]=out.wheelSpins;
  return out;
 }
}
