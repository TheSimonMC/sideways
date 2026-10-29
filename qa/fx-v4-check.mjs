import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from '../dist/vendor/three.module.js';
import {createEffects} from '../dist/car.js';
import {resolveBuild} from '../dist/catalog.js';
const scene=new THREE.Scene(),fx=createEffects(scene),result={status:'passed',checks:[]};
function state(surface,{speed=0,slip=0,contact=true}={}){return{x:0,z:0,heading:0,speed,forwardSpeed:speed,drifting:true,driftAngle:.8,wheelSlipL:9,wheelSlipR:9,wheelOmegas:[0,0,60,60],suspension:Array.from({length:4},()=>({contact,groundHeight:0,material:surface})),wheelAudio:Array.from({length:4},()=>({surface,contact,load:contact?2800:0,slipSpeed:slip,lateralSpeed:0,longitudinalSpeed:speed,wheelSpeed:speed+slip}))};}
function run(s){fx.reset();const before=fx.debug().skidCursor;for(let i=0;i<90;i++){s.z+=s.speed/60;fx.update(s,1/60,i/60);}return{...fx.debug(),marks:(fx.debug().skidCursor-before+400)%400};}
for(const surface of ['asphalt','gravel','grass','dirt']){const v=run(state(surface));assert.equal(v.activeParticles,0);assert.equal(v.marks,0);}
result.checks.push('Actual stationary tyre contacts override stale global drift/slip flags on hard and loose ground');
const smoke=run(state('asphalt',{slip:20}));assert.ok(smoke.activeSmoke>0);assert.equal(smoke.activeDust,0);assert.equal(smoke.marks,2);
result.checks.push('Actual standing burnout retains comic smoke and one rubber patch per grounded rear tyre on asphalt');
for(const surface of ['gravel','grass','dirt']){const v=run(state(surface,{slip:20}));assert.ok(v.activeDust>0);assert.equal(v.activeSmoke,0);assert.equal(v.marks,0);}
result.checks.push('Loose-ground wheelspin emits dust without rubber or hard-surface smoke');
const loose=run(state('gravel',{speed:14})),hard=run(state('asphalt',{speed:14}));assert.ok(loose.activeDust>0);assert.equal(loose.marks,0);assert.equal(hard.activeParticles,0);assert.equal(hard.marks,0);
result.checks.push('Rolling over loose ground emits restrained dust; clean asphalt rolling stays quiet despite legacy drift flags');
for(const surface of ['asphalt','grass']){const v=run(state(surface,{speed:15,slip:20,contact:false}));assert.equal(v.activeParticles,0);assert.equal(v.marks,0);}
result.checks.push('Airborne spinning tyres emit neither contact particles nor skid marks');
const mixed=state('asphalt',{slip:20});mixed.wheelAudio[3].surface='grass';const v=run(mixed);assert.ok(v.activeSmoke>0&&v.activeDust>0);assert.equal(v.marks,1);
result.checks.push('Mixed rear materials emit independently and only the hard-ground tyre stamps rubber');
fx.reset();fx.impact(0,0,1);assert.ok(fx.debug().activeParticles>0);fx.setBuild(resolveBuild({carId:'atlas'}));assert.equal(fx.debug().activeParticles,0);assert.equal(fx.debug().carId,'atlas');
const legacy={...state('asphalt'),driftAngle:0,drifting:false,wheelOmegas:[0,0,65,65]};delete legacy.wheelAudio;assert.ok(run(legacy).activeSmoke>0);
scene.traverse(o=>{if(o.isInstancedMesh){for(const n of o.instanceMatrix.array)assert.ok(Number.isFinite(n));if(o.instanceColor)for(const n of o.instanceColor.array)assert.ok(Number.isFinite(n));}});
result.checks.push('Impact, reset, build replacement and legacy wheelspin fallback retain finite visual data');
result.samples={asphaltBurnout:smoke,gravelRolling:loose,mixedRear:v};
fs.writeFileSync(new URL('./fx-v4-results.json',import.meta.url),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
