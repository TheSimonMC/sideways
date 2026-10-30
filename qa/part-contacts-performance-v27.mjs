import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {advanceDebris,advanceLooseWheel} from '../dist/panel-debris.js';
import {eulerAxes} from '../dist/part-contacts.js';
import * as THREE from '../dist/vendor/three.module.js';
import {createWorld} from '../dist/world.js';
const walls=[{x:5,z:0,hx:.15,hz:12,baseY:0,height:3},{x:-5,z:0,hx:.15,hz:12,baseY:0,height:3},{x:0,z:9,hx:5,hz:.15,baseY:0,height:3},{x:0,z:-9,hx:5,hz:.15,baseY:0,height:3}],dt=1/120;
const measure=(panels,glass,wheels,world=null)=>{
 const parts=Array.from({length:panels+glass},(_,i)=>({x:i%4-2,y:2,z:i%7-3,vx:(i%3-1)*12,vy:3,vz:8,spin:3,rotation:0,age:0,...(i<panels?{half:[.9,.07,.7],axes:eulerAxes(.3*i,.4,.2),angularVelocity:[2,1,3]}:{radius:.035,floorOffset:.025})})),loose=Array.from({length:wheels},(_,i)=>({x:i%4-2,y:1,z:i%3-1,vx:0,vy:0,vz:15,heading:0,radius:.34,width:.24,omega:15/.34,spin:0,age:0,lean:0})),times=[];let queries=0,samples=0;
 if(world)for(const p of [...parts,...loose]){p.x+=world.spawn.x;p.z+=world.spawn.z;p.y+=world.getSurfaceAt(p.x,p.z).height;}
 const surface=(x,z)=>{samples++;return world?world.getSurfaceAt(x,z):{height:0,grip:1};},query=()=>{queries++;return world?world.colliders:walls;};
 for(let i=0;i<660;i++){const t=performance.now();for(const p of parts)advanceDebris(p,dt,surface,query);for(const w of loose)advanceLooseWheel(w,dt,surface,query);if(i>=60)times.push(performance.now()-t);}
 times.sort((a,b)=>a-b);return{world:world?'actual Dock 09':'four synthetic walls',totalColliders:world?.colliders.length??walls.length,panels,glass,wheels,steps:600,meanMs:times.reduce((a,b)=>a+b)/times.length,medianMs:times[300],p95Ms:times[570],colliderQueries:queries,surfaceSamples:samples};
};
const sourceSHA256=Object.fromEntries(['panel-debris','part-contacts','part-shapes','hinge-contacts','world'].map(n=>{const f='dist/'+n+'.js';return [f,createHash('sha256').update(fs.readFileSync(new URL('../'+f,import.meta.url))).digest('hex')];}));
const old=globalThis.document;globalThis.document={createElement(){return {getContext(){return {fillText(){},fillRect(){},beginPath(){},arc(){},fill(){}};}};}};
const scene=new THREE.Scene(),world=createWorld(scene),cases=[measure(1,6,1),measure(8,24,8),measure(8,24,8,world)];globalThis.document=old;scene.traverse(n=>{n.geometry?.dispose();for(const m of Array.isArray(n.material)?n.material:[n.material])m?.dispose();});
const report={version:27,status:'measured',cases,sourceSHA256,limits:['Local Node.js CPU sample, 600 steps after 60 warm-up steps. Objects remain allocated and active throughout the sample, including settled ones.','Two synthetic-wall cases and one case at the actual Dock 09 spawn with its complete collider list and surface sampler. Includes rigid contacts only, not native engine, GPU, AI or audio; no frame-rate guarantee.']};
fs.writeFileSync(new URL('part-contacts-performance-v27-results.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
