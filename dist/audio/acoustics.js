const RATE=48000,SIZE=65536,MASK=SIZE-1,LEFT=[.95,.18,.55,.35],RIGHT=[.18,.95,.35,.55];
const clamp=(v,a,b)=>Math.max(a,Math.min(b,Number.isFinite(v)?v:a));
const read=(buffer,index)=>{const i=Math.floor(index),f=index-i;return buffer[i&MASK]+(buffer[(i+1)&MASK]-buffer[i&MASK])*f;};

/** Four measured facade paths plus a bounded, damped diffuse tail.
 * Pure audio observer: it never updates the engine or vehicle. */
export class StreetAcoustics{
 constructor(){
  this.left=new Float32Array(SIZE);this.right=new Float32Array(SIZE);this.cursor=0;this.lowL=this.lowR=0;this.wet=0;this.targetWet=0;this.reflectivity=.35;this.enclosure=0;
  this.reflectionLow=[0,0,0,0];this.reflectionPole=[.3,.3,.3,.3];this.delays=[2800,3900,5100,6700];this.targets=[...this.delays];this.gains=[0,0,0,0];this.targetsG=[0,0,0,0];this.feedback=.12;this.targetFeedback=.12;this.tail=0;this.output=[0,0];this.zone='open';
 }
 setSpace(space={},amount=.65){
  this.enclosure=clamp(space.enclosure??0,0,1);this.reflectivity=clamp(space.reflectivity??.35,0,1);this.zone=space.zone||'open';this.earlyReflections=space.earlyReflections!==false;
  const wet=Number.isFinite(space.wet)?space.wet:.025+this.enclosure*.54;
  this.targetWet=clamp(amount,0,1)*clamp(wet,0,.72);this.targetFeedback=.12+this.enclosure*.41*this.reflectivity;
  const distances=[space.leftDistance,space.rightDistance,space.frontDistance,space.backDistance];
  for(let i=0;i<4;i++){
   const distance=clamp(distances[i]??90,1.4,90);this.targets[i]=clamp((distance*2/343+.004+i*.0017)*RATE,280,27000);
   this.reflectionPole[i]=1-Math.exp(-2*Math.PI*(6500/(1+distance/25))/RATE);
   this.targetsG[i]=(this.earlyReflections===false?0:1)*(distance>=89?.015:.30+.70/(1+(distance/23)**1.5))*(.25+.75*this.reflectivity);
  }
  return this;
 }
 sample(left,right){
  const k=this.cursor,lag=.00015;this.wet+=(this.targetWet-this.wet)*lag;this.feedback+=(this.targetFeedback-this.feedback)*lag;
  let earlyL=0,earlyR=0;
  for(let i=0;i<4;i++){
   this.delays[i]+=(this.targets[i]-this.delays[i])*.00007;this.gains[i]+=(this.targetsG[i]-this.gains[i])*lag;
   const leftWeight=i===0?.72:i===1?.28:.5,incoming=read(this.left,k-this.delays[i])*leftWeight+read(this.right,k-this.delays[i])*(1-leftWeight);
   this.reflectionLow[i]+=(incoming-this.reflectionLow[i])*this.reflectionPole[i];const echo=this.reflectionLow[i]*this.gains[i];
   // Side walls reflect to that side; front/rear scatter across both ears.
   earlyL+=echo*LEFT[i];earlyR+=echo*RIGHT[i];
  }
  const lateL=read(this.left,k-5689)*.43+read(this.right,k-8933)*.31+read(this.left,k-12203)*.26;
  const lateR=read(this.right,k-6317)*.43+read(this.left,k-10009)*.31+read(this.right,k-13679)*.26;
  const damp=.08+.09*(1-this.enclosure);this.lowL+=(lateL-this.lowL)*damp;this.lowR+=(lateR-this.lowR)*damp;
  this.left[k]=clamp(left+this.lowR*this.feedback,-2,2);this.right[k]=clamp(right+this.lowL*this.feedback,-2,2);this.cursor=(k+1)&MASK;
  const wetL=(earlyL*.52+this.lowL*.56)*this.wet,wetR=(earlyR*.52+this.lowR*.56)*this.wet;
  this.tail+=(Math.abs(wetL)+Math.abs(wetR)-this.tail)*.001;
  this.output[0]=left+wetL;this.output[1]=right+wetR;return this.output;
 }
 reset(){this.left.fill(0);this.right.fill(0);this.cursor=0;this.lowL=this.lowR=this.tail=0;this.wet=0;this.gains.fill(0);this.reflectionLow.fill(0);}
 diagnostics(){return {model:'directional early reflections with distance absorption and stereo diffuse tail',zone:this.zone,enclosure:this.enclosure,wet:this.wet,targetWet:this.targetWet,feedback:this.feedback,tail:this.tail,delaysMs:this.delays.map(n=>n/RATE*1000)};}
}
