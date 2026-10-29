import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {createMemorySessionHost} from './network-v9-harness.mjs';
import {MULTIPLAYER_VERSION} from '../dist/multiplayer.js';
let now=1000;const memory=createMemorySessionHost(()=>now),checks=[];
const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
async function pair(){const host=memory.session(),guest=memory.session();await host.host();await guest.join(host.code);guest.setReady();await flush();host.start();await flush();return {host,guest};}
const world={traffic:{cars:[]},police:{cars:[]},hour:21};
const pose=x=>({x,z:0,heading:0});
const packet=(target,link,n,type,payload)=>({v:MULTIPLAYER_VERSION,room:target.code,n,type,payload});
async function check(name,fn){await fn();checks.push(name);console.log('PASS '+name);}
await check('A delayed burst keeps the newest pose and latest world even when its last frame contains no world; replay and oversized snapshots are rejected.',async()=>{
 const {host,guest}=await pair(),link=guest.links.get(host.id),start=link.lastSeq;
 for(let i=1;i<=200;i++)guest._receive(link,packet(guest,link,start+i,'frame',{runId:guest.runId,players:[{id:host.id,state:pose(i),active:true}],world:i===180?world:null}));
 assert.equal(guest.playing,true);assert.ok(link.pendingSnapshot);assert.ok(guest.stats.coalesced>0);const invalid=guest.stats.invalid;guest._receive(link,packet(guest,link,start+199,'frame',{}));guest._receive(link,{...packet(guest,link,start+201,'frame',{}),padding:'x'.repeat(96000)});assert.equal(guest.stats.invalid,invalid+2);await new Promise(r=>setTimeout(r,70));assert.equal(guest.getRemotePlayers()[0].state.x,200);assert.equal(guest.takeWorldSnapshot().hour,21);assert.equal(link.pendingSnapshot,null);host.dispose();guest.dispose();
});
await check('Excess guest poses remain bounded to one pending state and cannot kick the host or lose the latest position.',async()=>{
 const {host,guest}=await pair(),link=host.links.get(guest.id),start=link.lastSeq;for(let i=1;i<=250;i++)host._receive(link,packet(host,link,start+i,'pose',{state:pose(i),active:true}));await new Promise(r=>setTimeout(r,70));assert.equal(host.members.size,2);assert.equal(host.getRemotePlayers()[0].state.x,250);assert.equal(host.lastIssue,null);host.dispose();guest.dispose();
});
await check('Control-message floods still disconnect only the offending guest; strikes reset across separate rate windows.',async()=>{
 const {host,guest}=await pair(),other=memory.session();await other.join(host.code);await flush();const link=host.links.get(guest.id);let seq=link.lastSeq;
 for(let window=0;window<4;window++){now+=1100;for(let i=0;i<100;i++)host._receive(link,packet(host,link,++seq,'away',{}));assert.equal(host.members.size,3);}
 now+=1100;for(let i=0;i<125;i++)host._receive(link,packet(host,link,++seq,'away',{}));await flush();assert.equal(guest.lastIssue.code,'RATE_LIMIT');assert.equal(host.members.size,2);assert.equal(other.playing,true);host.dispose();guest.dispose();other.dispose();
});
await check('Leaving a session clears its queued snapshot and timer; stale callbacks cannot revive the old room.',async()=>{
 const {host,guest}=await pair(),link=host.links.get(guest.id),start=link.lastSeq;for(let i=1;i<160;i++)host._receive(link,packet(host,link,start+i,'pose',{state:pose(i),active:true}));assert.ok(link.pendingSnapshot);host.leave(null);assert.equal(link.pendingSnapshot,null);assert.equal(link.snapshotTimer,null);await new Promise(r=>setTimeout(r,70));assert.equal(host.members.size,0);assert.equal(host.status,'offline');host.dispose();guest.dispose();
});
await check('Slow channel negotiation leaves a fresh handshake window; silent negotiation and silent open channels still time out.',async()=>{
 const host=memory.session();await host.host();const drops=[],drop=host._dropLink;host._dropLink=function(link,issue,options){drops.push(issue);return drop.call(this,link,issue,options);};
 const fake=id=>{const handlers={};return {peer:id,open:false,serialization:'binary',on:(type,fn)=>{handlers[type]=fn;},send(){},close(){this.open=false;},openNow(){this.open=true;handlers.open();}};};
 const c=fake('slow-guest');host._bindConnection(c,true);const link=host.links.get(c.peer);now+=29000;host._heartbeat();assert.ok(host.links.has(c.peer));c.openNow();now+=14000;host._heartbeat();assert.ok(host.links.has(c.peer));host._receive(link,packet(host,link,1,'hello',{profile:{name:'Slow QA'}}));assert.equal(link.joined,true);
 host._dropLink(link,host._issue('PLAYER_LEFT'),{notify:false});const stalled=fake('silent-channel');host._bindConnection(stalled,true);now+=31000;host._heartbeat();assert.equal(host.links.has(stalled.peer),false);assert.match(drops.at(-1).detail,/did not open within 30/);
 const silent=fake('silent-handshake');host._bindConnection(silent,true);silent.openNow();now+=16000;host._heartbeat();assert.equal(host.links.has(silent.peer),false);assert.match(drops.at(-1).detail,/handshake within 15/);host.dispose();
});
const file='dist/multiplayer.js';fs.writeFileSync(new URL('multiplayer-burst-v22-results.json',import.meta.url),JSON.stringify({version:22,status:'passed',checks,sourceSHA256:{[file]:createHash('sha256').update(fs.readFileSync(new URL('../'+file,import.meta.url))).digest('hex')}},null,2));
