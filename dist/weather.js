/** Persistent world moisture. Querying a surface never advances weather.
 * Coefficients are fictional game calibration, not certified tyre data. */
const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,Number.isFinite(v)?v:a));
const smooth=v=>(v=clamp(v),v*v*(3-2*v));
export const WEATHER_MODES=['cycle','clear','rain'];
export function normalizeWeather(saved={}){return {elapsed:clamp(saved?.elapsed,0,1e10),rain:clamp(saved?.rain),wetness:clamp(saved?.wetness)};}
export function puddleMask(x,z){return smooth(((Math.sin(x*.07+Math.sin(z*.021))*Math.sin(z*.05+Math.sin(x*.019))+1)*.5-.35)/.43);}
export function wetTyreResponse({wetness=0,waterDepth=0,speed=0,material='asphalt',compound='street',tread=1,pressureBar=2.3}={}){
 const wet=clamp(wetness),hard=['asphalt','concrete','curb','metal'].includes(material);
 const road={asphalt:.73,concrete:.70,curb:.60,metal:.42,gravel:.86,grass:.61,dirt:.67}[material]??.75;
 const drainage=compound==='sport'?.8:compound==='drift'?.65:1;
 const grooves=.3+.7*clamp(tread),pressure=Math.sqrt(clamp(pressureBar/2.3,.3,1.2));
 const threshold=(18+14*grooves)*pressure*drainage;
 const aquaplaning=hard?smooth((Math.abs(speed)-threshold)/18)*smooth(clamp(waterDepth,0,8)/3.5)*.88:0;
 const grip=(1-wet*(1-road+(1-grooves)*.16+(1-drainage)*.12))*(1-aquaplaning);
 return {grip:clamp(grip,.06,1),aquaplaning};
}
export class RoadWeather{
 constructor(saved){Object.assign(this,normalizeWeather(saved));this._bound=new WeakMap();}
 snapshot(){return {elapsed:this.elapsed,rain:this.rain,wetness:this.wetness};}
 restore(saved){Object.assign(this,normalizeWeather(saved));}
 step(dt,mode='cycle'){
  dt=clamp(dt,0,1);if(!dt)return this.snapshot();this.elapsed+=dt;
  const phase=this.elapsed%720,target=mode==='rain'?1:mode==='clear'?0:smooth((phase-180)/55)*(1-smooth((phase-450)/70));
  this.rain+=(target-this.rain)*(-Math.expm1(-dt/12));
  const a=this.rain/65-(1-this.rain)*.0008,b=(1-this.rain)*.004;
  this.wetness=clamp(b>1e-8?this.wetness*Math.exp(-b*dt)+a*(-Math.expm1(-b*dt))/b:this.wetness+a*dt);
  return this.snapshot();
 }
 surface(base,x,z,covered=false){
  const exposed=!covered&&base?.weatherExposed!==false,wetness=exposed?this.wetness:0;
  const hard=['asphalt','concrete','curb','metal'].includes(base?.material);
  return {...base,wetness,waterDepth:hard?Math.max(0,wetness-.55)/.45*4*puddleMask(x,z):0};
 }
 bindWorld(world){
  if(!world?.getSurfaceAt)return;
  if(!this._bound.has(world))this._bound.set(world,world.getSurfaceAt.bind(world));
  const original=this._bound.get(world);world.weather=this;
  world.getSurfaceAt=(x,z)=>this.surface(original(x,z),x,z,world.kind==='showroom');
 }
}
