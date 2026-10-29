/** Offline only. Create lightweight NPC loops from the supplied live SDK. */
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import MotorLab from '../sdk/motor-engine.mjs';
import {resolveBuild} from '../dist/catalog.js';
const sampleRate=48000,rate=24000,dt=1/120,frames=sampleRate/120;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const beds=[],report={sdk:MotorLab.version,method:'Native PCM, physical dynamometer load near1800RPM, mono24kHz, DC removal, fixed peak trim,60ms equal-power loop seam.',engines:[]};
for(const id of ['i4','i6t','v8','rotary']){
 const build=resolveBuild({engineId:id}),e=MotorLab.createEngine(build.physics.engineOptions);e.start();for(let i=0;i<100;i++)e.update(dt);
 e.setAudio({master:.75,bite:.6,exhaust:.88,intake:.43,combustion:.45,boost:0,valve:.1,bearing:.05,mechanical:.05,chain:0,gearbox:0,listener:{mode:'direct',distance:1.5,azimuth:0,reflections:0}});
 const left=new Float32Array(frames),right=new Float32Array(frames),raw=[],rpms=[];
 for(let i=0;i<300;i++){
  const state=e.getState(),torque=-(state.meanTorque||0)-clamp((state.rpm-1800)*.32,-180,180);
  e.setInputs({throttle:.25,externalTorqueNm:torque,starter:false});e.renderAudio(left,right,{sampleRate});
  if(i>=180){rpms.push(e.getState().rpm);for(let j=0;j<frames;j+=2)raw.push((left[j]+right[j]+left[j+1]+right[j+1])*.25);}
 }
 const mean=raw.reduce((s,x)=>s+x,0)/raw.length;let peak=0;for(let i=0;i<raw.length;i++){raw[i]-=mean;peak=Math.max(peak,Math.abs(raw[i]));}
 const scale=.68/peak;for(let i=0;i<raw.length;i++)raw[i]*=scale;
 const seam=1440,count=raw.length-seam,loop=new Float64Array(count);for(let i=0;i<count;i++)loop[i]=raw[i];
 for(let i=0;i<seam;i++){const t=i/(seam-1);loop[i]=raw[count+i]*Math.cos(t*Math.PI/2)+raw[i]*Math.sin(t*Math.PI/2);}
 peak=0;for(const x of loop)peak=Math.max(peak,Math.abs(x));const adjust=.65/peak,pcm=Buffer.alloc(loop.length*2);let square=0;
 for(let i=0;i<loop.length;i++){loop[i]*=adjust;pcm.writeInt16LE(Math.round(loop[i]*32767),i*2);square+=loop[i]*loop[i];}
 const referenceRpm=rpms.reduce((s,x)=>s+x,0)/rpms.length;
 beds.push(`${id}:decode('${pcm.toString('base64')}',${referenceRpm})`);
 report.engines.push({id,rate,frames:loop.length,referenceRpm,minRpm:Math.min(...rpms),maxRpm:Math.max(...rpms),rms:Math.sqrt(square/loop.length),peak:.65,pcmSha256:sha(pcm)});e.dispose();
}
const decode="const decode=(b64,referenceRpm)=>{const raw=atob(b64),data=new Float32Array(raw.length/2);for(let i=0;i<data.length;i++){let n=raw.charCodeAt(i*2)|(raw.charCodeAt(i*2+1)<<8);if(n>32767)n-=65536;data[i]=n/32768;}return {data,rate:24000,referenceRpm};};\n";
fs.writeFileSync(new URL('../dist/audio/npc-engines.js',import.meta.url),'/** Offline MotorLab1.6.3 PCM for ambient/race vehicles. Player uses its own live engine. */\n'+decode+'export const NPC_ENGINES={'+beds.join(',')+'};\n');
fs.writeFileSync(new URL('./npc-audio-v11-assets.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
