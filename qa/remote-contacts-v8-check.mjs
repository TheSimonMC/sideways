import assert from 'node:assert/strict';
import fs from 'node:fs';
import {RemoteContactTracker} from '../dist/remote-contacts.js';
const report={status:'pending',checks:[],scope:'Real planar collision solver with authoritative NPC body fixtures; no native engine update and no live network claim.'};
function agent(kind,x,z){const body={x,z,vx:0,vz:0,yawRate:0,heading:0},calls=[],box={kind,npcId:kind+'-one',x,z,hx:1,hz:2.1,heading:0,mass:1200,inertia:1700,body};return{body,calls,getColliders(){Object.assign(box,{x:body.x,z:body.z,vx:body.vx,vz:body.vz,yawRate:body.yawRate});return[box];},onPlayerContact(contact){calls.push(contact);}};}
const member=(id,x=0,z=0,stamp=1000,extra={})=>({id,active:true,updatedAt:stamp,ageMs:0,build:{carId:'hachi'},state:{x,z,vx:0,vz:20,heading:0,yawRate:0},...extra});
{
 const tracker=new RemoteContactTracker(),traffic=agent('traffic',0,3.2),player=member('guest'),before=structuredClone(player),contacts=tracker.update([player],{traffic,now:1000});assert.deepEqual(player,before);assert.ok(traffic.body.vz>1);assert.ok(traffic.body.z>3.2);assert.equal(traffic.calls.length,1);assert.equal(contacts[0].playerId,'guest');assert.ok(contacts[0].closingSpeed>5);const body={...traffic.body};assert.deepEqual(tracker.update([player],{traffic,now:1010}),[]);assert.deepEqual(traffic.body,body);assert.equal(tracker.diagnostics().resolvedPoses,1);report.checks.push('A guest impact transfers real impulse to the shared NPC, returns a guest-tagged offense contact, preserves the owner pose, and resolves a received pose only once.');
}
{
 const tracker=new RemoteContactTracker(),police=agent('police',10,3.2),player=member('guest-police',10);const contacts=tracker.update([player],{police,now:1000});assert.equal(police.calls.length,1);assert.equal(police.calls[0].playerId,'guest-police');assert.ok(police.body.vz>1);assert.equal(contacts[0].collider.kind,'police');report.checks.push('Shared police receive the colliding guest ID, allowing the normal offense path to target the guest instead of the host.');
}
{
 const tracker=new RemoteContactTracker(),traffic=agent('traffic',0,0),first=member('fast-guest',0,-5,1000,{state:{x:0,z:-5,vx:0,vz:80,heading:0,yawRate:0}});tracker.update([first],{traffic,now:1000});const crossed={...first,updatedAt:1100,state:{...first.state,z:5}};const hits=tracker.update([crossed],{traffic,now:1100});assert.ok(hits.length>0);assert.ok(traffic.body.vz>1);report.checks.push('Plausible fast motion between received poses uses a swept contact and cannot skip through an NPC between snapshots.');
}
{
 const tracker=new RemoteContactTracker(),traffic=agent('traffic',50,0),first=member('teleporter',0,0,1000,{state:{x:0,z:0,vx:0,vz:0,heading:Math.PI/2,yawRate:0}});tracker.update([first],{traffic,now:1000});assert.equal(tracker.update([{...first,updatedAt:1050,state:{...first.state,x:100}}],{traffic,now:1050}).length,0);assert.equal(traffic.body.vx,0);assert.equal(traffic.body.x,50);tracker.update([{...first,active:false}],{traffic,now:1100});assert.equal(tracker.frames.size,0);tracker.update([{...first,ageMs:3000}],{traffic,now:4000});assert.equal(tracker.frames.size,0);tracker.update([{...first,state:{...first.state,x:NaN}}],{traffic,now:4100});assert.equal(tracker.frames.size,0);tracker.reset();assert.equal(tracker.cooldowns.size,0);report.checks.push('Teleports do not sweep across the map; away, stale and nonfinite poses cannot hit traffic, and reset clears contact history.');
}
report.status='passed';fs.writeFileSync(new URL('./remote-contacts-v8-results.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
