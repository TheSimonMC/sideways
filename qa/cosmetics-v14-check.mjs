import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import * as THREE from '../dist/vendor/three.module.js';
import {resolveBuild,VEHICLES,PARTS} from '../dist/catalog.js';
import {COSMETIC_PARTS,COSMETIC_DEFAULTS} from '../dist/cosmetics.js';
import {Career} from '../dist/career.js';
import {createCar} from '../dist/car.js';
const checks=[],previous=globalThis.document;
globalThis.document={createElement(){return{getContext(){return{fillRect(){},fillText(){}};}};}};
let variants=0;
try{
 assert.equal(Object.keys(PARTS).length,22);const stock=resolveBuild();for(const key of Object.keys(COSMETIC_DEFAULTS))assert.equal(stock.selection[key],'stock');assert.equal(resolveBuild({rims:'invalid'}).selection.rims,'stock');checks.push('Old saves and invalid cosmetic IDs resolve to the original factory parts');
 for(const vehicle of VEHICLES){const scene=new THREE.Scene(),base=resolveBuild({carId:vehicle.id}),car=createCar(scene,base);
  for(const [key,options]of Object.entries(COSMETIC_PARTS)){const hashes=new Set();for(const option of options){const build=resolveBuild({...base.selection,[key]:option.id});assert.deepEqual(build.physics,base.physics);assert.deepEqual(build.audio,base.audio);car.setBuild(build);car.group.updateMatrixWorld(true);const hash=createHash('sha256');car.group.traverse(mesh=>{if(!mesh.isMesh)return;const data=mesh.geometry.attributes.position?.array;if(data){assert.ok(data.every(Number.isFinite));hash.update(Buffer.from(data.buffer,data.byteOffset,data.byteLength));}hash.update(JSON.stringify(mesh.matrixWorld.elements));});hashes.add(hash.digest('hex'));variants++;}assert.equal(hashes.size,options.length,vehicle.id+' '+key+' variants must have different geometry');}
  car.dispose();assert.equal(scene.children.length,0);
 }
 checks.push('Every cosmetic choice produces distinct finite geometry on all four bodies and releases its models');checks.push('Visual parts preserve drivetrain parameters and engine audio');
 const c=new Career(),build=resolveBuild({hood:'vented',spoiler:'ducktail',sideSkirts:'street',rims:'five'}),before=c.wallet;assert.equal(c.quote(build).total,3500);assert.equal(c.wallet,before);assert.equal(c.purchase(build).ok,true);assert.equal(c.wallet,0);assert.equal(c.quote(build).total,0);const saved=JSON.parse(JSON.stringify({career:c.serialize(),build:build.selection})),restored=new Career(saved.career,saved.build);assert.equal(restored.quote(resolveBuild(saved.build)).total,0);assert.equal(restored.purchase(resolveBuild({rims:'mesh'})).ok,false);assert.equal(restored.wallet,0);checks.push('Preview is free; installation charges once, ownership survives save/load and unaffordable purchases are rejected');
}finally{globalThis.document=previous;}
const report={version:14,status:'passed',checks,variants};fs.writeFileSync(new URL('cosmetics-v14-results.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
