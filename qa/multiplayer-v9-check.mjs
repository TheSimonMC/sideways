import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {createMemorySessionHost} from './network-v9-harness.mjs';
import {createCity} from '../dist/city.js';
import {createTraffic} from '../dist/traffic.js';
import {createPolice} from '../dist/police.js';
import {sanitizeWorldSnapshot,MULTIPLAYER_VERSION} from '../dist/multiplayer.js';

const report={version:9,status:'pending',checks:[],fixtures:{},verificationLimit:'Protocol and lifecycle tests use an in-memory PeerJS-compatible transport that records serialization and enforces the shipped JSON byte cap. Actual vendor encoding/chunking is tested in peerjs-codec-v9-check.mjs. These checks do not establish signaling availability or internet ICE connectivity.'};
const check=async(name,fn)=>{await fn();report.checks.push(name);console.log('PASS '+name);};
const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
let now=1000;const memory=createMemorySessionHost(()=>now),sessions=[];
const session=()=>{const s=memory.session();sessions.push(s);return s;};
const pose=(x=0)=>({x,z:0,heading:0,vx:0,vz:10,speed:10,forwardSpeed:10,rpm:2200,throttle:.6,bodyHeight:.02,groundHeight:.012,wheelAttached:[true,true,true,true],wheelSpins:[0,0,0,0]});
const tinyWorld={traffic:{version:1,time:0,cars:[]},police:{version:1,time:0,cars:[],phase:'patrol'},hour:23,trafficTime:0};
async function pair({hostOptions={},playing=true}={}){
 const host=session(),guest=session();await host.host({name:'Host',...hostOptions});await guest.join(host.code,{name:'Guest'});await flush();
 if(playing){guest.setReady();await flush();assert.equal(host.start(),true);await flush();}return{host,guest};
}
const dispose=(...values)=>values.forEach(s=>s.dispose());

await check('A real 36-car, six-police world reaches every member of a four-player binary room without the legacy JSON kick',async()=>{
 const city=createCity(null),traffic=createTraffic(null,city,{count:36}),police=createPolice(null,city,traffic,{count:6,dayCount:3,nightCount:6});
 const host=session(),guests=Array.from({length:3},session);await host.host({name:'Host'});for(const guest of guests){await guest.join(host.code,{name:'Guest'});guest.setReady();}await flush();assert.equal(host.start(),true);await flush();
 const local={...pose(city.spawn.x),z:city.spawn.z,width:2,length:4.4,mass:1160,inertia:1680,playerId:host.id};
 for(let i=0;i<120;i++){traffic.update(1/120,local,{night:.9,emergency:police.states});police.update(1/120,local,{night:.9,players:[]});}
 const world={traffic:traffic.captureSnapshot(),police:police.captureSnapshot(),hour:23,trafficTime:traffic.time};assert.ok(sanitizeWorldSnapshot(world));
 for(const [i,guest]of guests.entries())guest.update(.1,{state:pose(i*8+10)});await flush();host.update(.1,{state:local,world});await flush();
 const frames=memory.messages.filter(m=>m.type==='frame');assert.ok(frames.length>=3);assert.ok(frames.every(m=>m.serialization==='binary'));assert.ok(frames.at(-1).bytes>16300);assert.equal(memory.transportErrors.length,0);
 for(const guest of guests){assert.equal(guest.playing,true);assert.equal(guest.lastIssue,null);assert.equal(guest.getRemotePlayers().length,3);const received=guest.takeWorldSnapshot();assert.equal(received.traffic.cars.length,36);assert.equal(received.police.cars.length,6);assert.deepEqual(received.traffic,world.traffic);}
 report.fixtures.city={trafficCars:36,policeCars:6,players:4,jsonMeasureBytes:frames.at(-1).bytes,transport:'binary'};dispose(host,...guests);traffic.dispose();police.dispose();city.dispose();await flush();
});

await check('A host startup failure reaches guests with the original stage and persists through menu teardown without leaking relay credentials',async()=>{
 const username='relay-test-driver',credential='test-only-secret-9824';
 const {host,guest}=await pair({hostOptions:{config:{iceServers:[{urls:'turn:relay.example.com:3478',username,credential}]}}});
 const failure=new Error(`Shader compile failed; username=${username} password=${credential} token=ephemeral-token https://example.test/private?token=other-token`);
 const issue=host.failStart(failure,{stage:'shaders'});host.leave(null);await flush();assert.equal(issue.code,'HOST_START_FAILED');assert.equal(host.lastIssue.code,'HOST_START_FAILED');assert.equal(guest.lastIssue.code,'HOST_START_FAILED');assert.equal(guest.lastIssue.stage,'shaders');assert.match(guest.lastIssue.detail,/Shader compile failed/);assert.equal(guest.status,'error');
 guest.leave(null);assert.equal(guest.getState().lastIssue.code,'HOST_START_FAILED');assert.equal(guest.error,'');assert.equal(guest.events.some(e=>e.type==='start'),false);
 const diagnostics=JSON.stringify({host:host.diagnostics(),guest:guest.diagnostics()});for(const secret of [username,credential,'ephemeral-token','other-token','example.test'])assert.ok(!diagnostics.includes(secret),'Diagnostic leaked '+secret);
 const copy=host.getState().lastIssue;copy.code='MUTATED';assert.equal(host.lastIssue.code,'HOST_START_FAILED');report.fixtures.startFailure={code:issue.code,stage:issue.stage,detail:issue.detail,persistent:true};dispose(host,guest);await flush();
});

await check('A guest startup failure removes only that driver and gives the host a specific player-left reason',async()=>{
 const {host,guest}=await pair({playing:false}),other=session();await other.join(host.code,{name:'Other'});guest.setReady();other.setReady();await flush();host.start();await flush();host.consumeEvents();const failedId=guest.id;
 guest.failStart(new Error('Vehicle setup failed'),{stage:'vehicle'});await flush();assert.equal(guest.lastIssue.code,'PLAYER_START_FAILED');assert.equal(host.playing,true);assert.equal(other.playing,true);assert.equal(host.members.has(failedId),false);assert.equal(other.getState().players.length,2);
 const left=host.consumeEvents().find(e=>e.type==='playerLeft'&&e.id===failedId);assert.equal(left.code,'PLAYER_START_FAILED');assert.equal(left.issue.stage,'vehicle');assert.match(left.issue.detail,/Vehicle setup failed/);dispose(host,guest,other);await flush();
});

await check('An intentional host exit and an unexpected channel close produce different retained reasons',async()=>{
 let {host,guest}=await pair();host.leave();await flush();assert.equal(guest.status,'offline');assert.equal(guest.lastIssue.code,'HOST_LEFT');assert.ok(guest.consumeEvents().some(e=>e.type==='sessionEnded'&&e.code==='HOST_LEFT'));dispose(host,guest);
 ({host,guest}=await pair());const link=host.links.get(guest.id);link.connection.close();await flush();assert.equal(guest.status,'error');assert.equal(guest.lastIssue.code,'CONNECTION_CLOSED');assert.match(guest.lastIssue.detail,/without a departure message/);assert.ok(!guest.lastIssue.message.includes('host left'));assert.equal(host.playing,true);dispose(host,guest);await flush();
});

await check('A heartbeat timeout is reported as a timeout on both ends instead of an intentional host exit',async()=>{
 const {host,guest}=await pair();const id=guest.id;host.links.get(id).lastSeen=now-26000;host._heartbeat();await flush();assert.equal(guest.lastIssue.code,'CONNECTION_TIMEOUT');assert.equal(guest.status,'error');assert.equal(host.members.has(id),false);assert.equal(host.playing,true);assert.ok(host.consumeEvents().some(e=>e.type==='playerLeft'&&e.code==='CONNECTION_TIMEOUT'));dispose(host,guest);await flush();
});

await check('A synchronous data-channel send failure includes packet size and reaches the affected guest without ending other drivers',async()=>{
 const {host,guest}=await pair(),link=host.links.get(guest.id),send=link.connection.send.bind(link.connection);link.connection.send=packet=>{if(packet.type==='frame')throw new Error('Data channel write failed');return send(packet);};
 host.update(.1,{state:pose(),world:tinyWorld});await flush();assert.equal(guest.lastIssue.code,'SEND_FAILED');assert.match(guest.lastIssue.detail,/frame packet: \d+ UTF-8 bytes; transport: binary/);assert.match(guest.lastIssue.detail,/write failed/);assert.equal(host.playing,true);assert.equal(host.links.size,0);report.fixtures.sendFailure=guest.lastIssue.detail;dispose(host,guest);await flush();
});

await check('A synchronous PeerJS error event during send is counted as failure and retains its concrete size reason',async()=>{
 const {host,guest}=await pair(),link=guest.links.get(guest.hostId),send=link.connection.send.bind(link.connection);link.connection.send=packet=>{if(packet.type==='pose'){link.connection.emit('error',{type:'message-too-big',message:'Message too big for JSON channel'});return;}return send(packet);};
 const sent=guest.stats.sent;guest.update(.1,{state:pose()});await flush();assert.equal(guest.status,'error');assert.equal(guest.lastIssue.code,'PACKET_TOO_LARGE');assert.match(guest.lastIssue.detail,/pose packet: \d+ UTF-8 bytes/);assert.equal(guest.stats.sent,sent);assert.equal(host.playing,true);dispose(host,guest);await flush();
});

await check('Old JSON clients and incompatible metadata receive an update reason before a bounded rejection cleanup',async()=>{
 const host=session();await host.host({name:'Current host'});
 for(const [patch,code]of [[{serialization:'json'},'TRANSPORT_OUTDATED'],[{metadata:{version:MULTIPLAYER_VERSION-1}},'PROTOCOL_MISMATCH']]){
  const guest=session(),factory=guest._factory;guest._factory=(...args)=>{const peer=factory(...args),connect=peer.connect.bind(peer);peer.connect=(id,options)=>connect(id,{...options,...patch});return peer;};
  await assert.rejects(guest.join(host.code),/Reload/);await flush();assert.equal(guest.lastIssue.code,code);assert.equal(guest.lastIssue.stage,'joining');assert.equal(host.members.size,1);assert.equal(host.links.size,0);guest.dispose();
 }
 const current=session();await current.join(host.code);assert.equal(current.status,'lobby');assert.equal(current.lastIssue,null);dispose(host,current);await flush();
});

await check('Fresh connection attempts clear old errors, while an obsolete startup catch cannot replace a completed departure reason',async()=>{
 const guest=session();await assert.rejects(guest.join('ZZZZ2222'),/Lobby not found/);assert.equal(guest.lastIssue.code,'LOBBY_NOT_FOUND');const host=session();await host.host({name:'Retry host'});await guest.join(host.code);assert.equal(guest.lastIssue,null);assert.equal(guest.error,'');guest.setReady();await flush();host.start();await flush();host.leave();host.failStart(new Error('Late rejected compile'),{stage:'shaders'});await flush();assert.equal(host.lastIssue,null);assert.equal(guest.lastIssue.code,'HOST_LEFT');guest.clearIssue();assert.equal(guest.getState().lastIssue,null);dispose(host,guest);await flush();
});

await check('Packet limits count UTF-8 bytes, and oversized nonessential frames drop without disconnecting a healthy room',async()=>{
 const {host,guest}=await pair(),link=guest.links.get(host.id),packet={v:MULTIPLAYER_VERSION,room:host.code,type:'frame',n:link.lastSeq+1,payload:{runId:host.runId,players:[],world:tinyWorld},padding:'界'.repeat(33000)};
 assert.ok(JSON.stringify(packet).length<96000);assert.ok(Buffer.byteLength(JSON.stringify(packet))>96000);const received=guest.stats.received,invalid=guest.stats.invalid;guest._receive(link,packet);assert.equal(guest.stats.received,received);assert.equal(guest.stats.invalid,invalid+1);assert.equal(guest.takeWorldSnapshot(),null);
 const hostLink=host.links.get(guest.id),dropped=host.stats.dropped;assert.equal(host._send(hostLink,'frame',packet,false),false);assert.equal(host.stats.dropped,dropped+1);assert.equal(host.playing,true);assert.equal(guest.playing,true);dispose(host,guest);await flush();
});

await check('A peer that cannot receive the departure reason is forcibly released after the one-second grace period',async()=>{
 const {host,guest}=await pair(),peer=host.peer;host.links.get(guest.id).connection.send=()=>{};host.leave();assert.equal(host.links.size,0);assert.equal(host.peer,null);assert.equal(peer.destroyed,false);await new Promise(resolve=>setTimeout(resolve,1100));await flush();assert.equal(peer.destroyed,true);assert.equal(host._retiring.size,0);assert.equal(guest.lastIssue.code,'CONNECTION_CLOSED');dispose(host,guest);await flush();
});
for(const s of sessions)s.dispose();await flush();assert.equal(memory.peers.size,0);report.status='passed';report.modules=Object.fromEntries(['dist/multiplayer.js','dist/lobby-panel.js','qa/network-v9-harness.mjs'].map(file=>[file,createHash('sha256').update(fs.readFileSync(new URL('../'+file,import.meta.url))).digest('hex')]));
fs.writeFileSync(new URL('./multiplayer-v9-results.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,checks:report.checks.length,fixtures:report.fixtures},null,2));
