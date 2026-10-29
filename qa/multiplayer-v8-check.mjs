import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import * as THREE from '../dist/vendor/three.module.js';
import {MultiplayerSession,normalizeLobbyRules,validLobbyCode,normalizeLobbyCode,makeLobbyCode,sanitizeNetworkPose,sanitizeWorldSnapshot,peerOptions} from '../dist/multiplayer.js';
import {createNetworkCars} from '../dist/network-cars.js';
import {resolveBuild} from '../dist/catalog.js';
import {createCity} from '../dist/city.js';
import {createTraffic} from '../dist/traffic.js';
import {createPolice} from '../dist/police.js';

const report={version:8,status:'pending',checks:[],limits:['Protocol tests use an in-memory PeerJS-compatible transport. They do not prove ICE traversal, signaling availability or real browser WebRTC connectivity.','Remote geometry tests use actual Three.js and createCar without GPU rendering.','Solid player contacts are local kinematic contacts; no rollback or anti-cheat system is asserted.']};
const check=async(name,fn)=>{await fn();report.checks.push(name);console.log('PASS '+name);};
const flush=async()=>{for(let i=0;i<10;i++)await Promise.resolve();};
let now=1000,serial=0;
class Emitter{constructor(){this.events=new Map();}on(type,fn){const list=this.events.get(type)||[];list.push(fn);this.events.set(type,list);return this;}emit(type,value){for(const fn of this.events.get(type)||[])fn(value);}}
class Connection extends Emitter{
 constructor(peer,metadata){super();this.peer=peer;this.metadata=metadata;this.open=false;this.bufferSize=0;this.dataChannel={bufferedAmount:0};this.sent=[];}
 send(value){if(!this.open)throw new Error('Closed');this.sent.push(value);queueMicrotask(()=>{if(this.partner?.open)this.partner.emit('data',structuredClone(value));});}
 close(){if(this.closed)return;this.closed=true;this.open=false;const partner=this.partner;queueMicrotask(()=>this.emit('close'));if(partner&&!partner.closed)partner.close();}
}
const peers=new Map();
class Peer extends Emitter{
 constructor(id){super();this.id=id||'guest-'+(++serial);this.destroyed=false;this.disconnected=false;this.links=[];if(peers.has(this.id)){queueMicrotask(()=>this.emit('error',{type:'unavailable-id'}));}else{peers.set(this.id,this);queueMicrotask(()=>{if(!this.destroyed)this.emit('open',this.id);});}}
 connect(id,options){const local=new Connection(id,options.metadata);this.links.push(local);queueMicrotask(()=>{const remotePeer=peers.get(id);if(!remotePeer){this.emit('error',{type:'peer-unavailable'});return;}const remote=new Connection(this.id,options.metadata);local.partner=remote;remote.partner=local;remotePeer.links.push(remote);remotePeer.emit('connection',remote);local.open=remote.open=true;local.emit('open');remote.emit('open');});return local;}
 reconnect(){this.disconnected=false;}
 destroy(){if(this.destroyed)return;this.destroyed=true;if(peers.get(this.id)===this)peers.delete(this.id);for(const c of this.links)c.close();queueMicrotask(()=>this.emit('close'));}
}
const random={getRandomValues(bytes){for(let i=0;i<bytes.length;i++)bytes[i]=(serial*7+i*3)%256;serial++;return bytes;}};
const session=()=>new MultiplayerSession({peerFactory:(id)=>new Peer(id),now:()=>now,random,autoHeartbeat:false});
const host=session(),alice=session(),bob=session(),cara=session();
const pose=(x=0,z=0)=>({x,z,heading:0,vx:0,vz:10,speed:10,forwardSpeed:10,rpm:2200,throttle:.6,brake:0,bodyHeight:.02,groundHeight:.012,wheelSpins:[0,0,0,0],wheelAttached:[true,true,true,true],headlights:true,engineRunning:true});
const world={traffic:{version:8,cars:[{id:'t1',x:5,z:7,speed:4}]},police:{version:8,phase:'chase',heat:1,targetId:'test',cars:[{id:'p1',x:20,z:30,siren:true}]},hour:23.5,trafficTime:150,hostPaused:false};
const step=async(count=1)=>{for(let i=0;i<count;i++){now+=50;host.update(.05,{state:pose(0,now/1000),world,active:true});alice.update(.05,{state:pose(10,now/1000),active:true});bob.update(.05,{state:pose(-10,now/1000),active:true});cara.update(.05,{state:pose(20,now/1000),active:true});await flush();}};

await check('Codes use eight unambiguous cryptographic characters; rules, profiles, signaling and ICE inputs are bounded',()=>{
 assert.equal(CODE_POINTS(makeLobbyCode(random)),8);assert.ok(validLobbyCode('ABCD-EF23'));assert.equal(normalizeLobbyCode(' abcd ef23 '),'ABCDEF23');assert.ok(!validLobbyCode('IO01AAAA'));
 assert.deepEqual(normalizeLobbyRules({maxPlayers:99,traffic:'many',police:false,damage:false,time:'night',collisions:'solid'}),{maxPlayers:4,traffic:'normal',police:false,damage:false,time:'night',collisions:'solid'});
 const options=peerOptions({host:'lobby.example.com',port:443,path:'/peer',iceServers:[{urls:'turn:relay.example.com:3478?transport=udp',username:'driver',credential:'test-only'},{urls:'https://evil.example/'}]});assert.equal(options.host,'lobby.example.com');assert.equal(options.config.iceServers.length,1);assert.equal(options.config.iceServers[0].username,'driver');assert.equal(peerOptions({host:'https://bad/path'}).host,undefined);
});
function CODE_POINTS(s){return [...s].length;}
await check('Host creates a short-code room; joining clients exchange a bounded roster, ready status and host-only rules',async()=>{
 await host.host({name:'Host',build:{carId:'atlas'},rules:{...normalizeLobbyRules(),maxPlayers:4},color:'#ffffff'});assert.equal(host.status,'lobby');assert.ok(validLobbyCode(host.code));
 await alice.join(host.code,{name:'Alice <script>',build:{carId:'kitsune'},color:'#66aadd'});await bob.join(host.code,{name:'Bob',build:{carId:'hachi'}});await flush();assert.equal(host.getState().players.length,3);assert.equal(alice.getState().players.length,3);assert.equal(host.getState().players[1].name,'Alice script');assert.equal(alice.setRules({police:false}),false);assert.equal(host.start(),false);
 alice.setReady();bob.setReady();await flush();assert.ok(host.getState().players.every(p=>p.ready));host.setRules({...host.rules,time:'night',traffic:'light'});await flush();assert.equal(alice.rules.time,'night');assert.equal(alice.getState().players.find(p=>p.id===alice.id).ready,false);alice.setReady();bob.setReady();await flush();assert.equal(host.start(),true);await flush();assert.ok(alice.playing&&bob.playing);assert.ok(alice.consumeEvents().some(e=>e.type==='start'));
});
await check('Twenty-Hz owner poses and ten-Hz host AI/time reach all clients; late join starts the same run and full rooms reject cleanly',async()=>{
 await step(8);assert.equal(host.getRemotePlayers().filter(p=>p.active).length,2);assert.equal(alice.getRemotePlayers().filter(p=>p.active).length,2);const w=alice.takeWorldSnapshot();assert.equal(w.hour,23.5);assert.equal(w.traffic.cars[0].id,'t1');assert.equal(w.police.phase,'chase');assert.equal(alice.takeWorldSnapshot(),null);
 await cara.join(host.code,{name:'Cara'});await flush();assert.equal(cara.status,'playing');assert.equal(cara.runId,host.runId);assert.equal(cara.getState().players.length,4);host.peer.emit('error',{type:'webrtc'});assert.equal(host.status,'playing');assert.equal(host.links.size,3);
 const extra=session();await assert.rejects(extra.join(host.code,{name:'Fifth'}),/full/);extra.dispose();await step(4);assert.equal(bob.getRemotePlayers().filter(p=>p.active).length,3);report.room={players:4,codeLength:8,poseRate:20,worldRate:10,lateJoin:true};
});
await check('Clients cannot change host rules or inject shared-world events; replayed packets and nonfinite player poses are rejected',async()=>{
 const link=host.links.get(alice.id),before=host.stats.invalid,oldTime=host.rules.time;host._receive(link,{v:8,room:host.code,type:'start',n:link.lastSeq+1,payload:{rules:{time:'day'}}});assert.equal(host.rules.time,oldTime);
 host._receive(link,{v:8,room:host.code,type:'frame',n:link.lastSeq+1,payload:{world:{hour:2}}});const last=link.lastSeq;host._receive(link,{v:8,room:host.code,type:'pose',n:last,payload:{state:pose(99),active:true}});assert.notEqual(host.members.get(alice.id).state.x,99);
 host._receive(link,{v:8,room:host.code,type:'pose',n:link.lastSeq+1,payload:{state:{...pose(),x:Infinity},active:true}});assert.ok(host.stats.invalid>=before+4);
 assert.equal(sanitizeNetworkPose({...pose(),x:5000}),null);assert.equal(sanitizeWorldSnapshot({traffic:{states:Array(97).fill(1)}}),null);assert.equal(sanitizeWorldSnapshot({police:{bad:NaN}}),null);assert.equal(sanitizeWorldSnapshot({police:JSON.parse('{"__proto__":{"polluted":true}}')}),null);assert.equal({}.polluted,undefined);
 // Restore the sending sequence after deliberately injected future packets.
 alice._seq=link.lastSeq;
});
await check('Host-only game events preserve target IDs; names remain data, and snapshot size/backpressure cannot grow transport queues',async()=>{
 alice.consumeEvents();assert.equal(alice.broadcastEvent('arrest',{targetId:host.id}),false);assert.equal(host.broadcastEvent('arrest',{targetId:alice.id,station:{x:2,z:3,heading:1}}),true);await flush();const event=alice.consumeEvents().find(e=>e.type==='gameEvent');assert.equal(event.event.type,'arrest');assert.equal(event.event.payload.targetId,alice.id);
 assert.equal(alice.broadcastEvent('nearMiss',{playerId:alice.id}),false);assert.equal(host.broadcastEvent('nearMiss',{playerId:alice.id,npcId:'traffic-4',completed:true,clearance:.5,relativeSpeed:22,speed:24}),true);await flush();const pass=alice.consumeEvents().find(e=>e.type==='gameEvent');assert.equal(pass.event.type,'nearMiss');assert.equal(pass.event.payload.playerId,alice.id);assert.equal(pass.event.payload.completed,true);
 const link=host.links.get(bob.id);const sent=link.connection.sent.length;link.connection.dataChannel.bufferedAmount=300000;await step(3);assert.equal(link.connection.sent.length,sent);assert.ok(host.stats.backpressure>0);link.connection.dataChannel.bufferedAmount=0;await step(2);assert.ok(link.connection.sent.length>sent);assert.equal(host.broadcastEvent('arrest',{payload:'x'.repeat(200)}),false);
});
await check('Away state removes a remote car from active play; ping, timeout and client departure have bounded cleanup',async()=>{
 alice.setAway();await flush();assert.equal(host.getRemotePlayers().find(p=>p.id===alice.id).active,false);await step(2);assert.equal(host.getRemotePlayers().find(p=>p.id===alice.id).active,true);
 now+=20;host._heartbeat();await flush();assert.ok(host.ping>=0);const id=cara.id;cara.leave();await flush();assert.ok(!host.members.has(id));assert.ok(!alice.getState().players.some(p=>p.id===id));
 const bobId=bob.id,link=host.links.get(bobId);now+=26000;link.lastSeen=now-26000;host.links.get(alice.id).lastSeen=now;host._heartbeat();await flush();assert.ok(!host.links.has(bobId));assert.ok(['offline','error'].includes(bob.status));assert.ok(bob.events.some(e=>e.type==='sessionEnded'));
});
await check('Host departure ends clients, destroys connections and discards queued starts; cancelled factory completion cannot create a zombie room',async()=>{
 host.leave();await flush();assert.equal(host.status,'offline');assert.equal(alice.status,'offline');assert.equal(alice.members.size,0);assert.equal(host.links.size,0);assert.equal(host.events.filter(e=>e.type==='start').length,0);
 let finish;const delayed=new MultiplayerSession({peerFactory:()=>new Promise(resolve=>{finish=resolve;}),now:()=>now,random,autoHeartbeat:false});const promise=delayed.host({name:'Late'});await flush();delayed.leave();const deadPeer=new Peer('late-peer');finish(deadPeer);await assert.rejects(promise,/cancelled/);await flush();assert.equal(deadPeer.destroyed,true);assert.equal(delayed.peer,null);assert.equal(delayed.status,'offline');
 const missing=session();await assert.rejects(missing.join('ZZZZ2222'),/Lobby not found/);missing.dispose();delayed.dispose();
});
await check('Real 36-car and 6-officer world snapshots survive transport validation and apply to matching replicas without local AI advancement',async()=>{
 const cityA=createCity(null),cityB=createCity(null),trafficA=createTraffic(null,cityA,{count:36}),trafficB=createTraffic(null,cityB,{count:36}),policeA=createPolice(null,cityA,trafficA,{count:6,dayCount:3,nightCount:6}),policeB=createPolice(null,cityB,trafficB,{count:6,dayCount:3,nightCount:6});
 const h=session(),g=session();await h.host({name:'World host'});await g.join(h.code,{name:'World guest'});g.setReady();await flush();h.start();await flush();
 const local={...pose(cityA.spawn.x,cityA.spawn.z),playerId:h.id,width:2,length:4.4,mass:1160,inertia:1680};
 for(let i=0;i<120;i++){trafficA.update(1/120,local,{night:.9,emergency:policeA.states});policeA.update(1/120,local,{night:.9,players:[]});}
 const snapshot={traffic:trafficA.captureSnapshot(),police:policeA.captureSnapshot(),hour:23,trafficTime:trafficA.time};assert.ok(sanitizeWorldSnapshot(snapshot));report.worldBytes=Buffer.byteLength(JSON.stringify(snapshot));assert.ok(report.worldBytes<96000);
 now+=100;h.update(.1,{state:local,world:snapshot,active:true});await flush();const received=g.takeWorldSnapshot();assert.ok(received);assert.equal(trafficB.applySnapshot(received.traffic),true);assert.equal(policeB.applySnapshot(received.police),true);
 assert.equal(trafficB.states.length,36);assert.equal(policeB.states.length,6);for(let i=0;i<36;i++){assert.equal(trafficB.states[i].x,trafficA.states[i].x);assert.equal(trafficB.states[i].z,trafficA.states[i].z);}
 const before=trafficB.captureSnapshot();trafficB.update(.05,local);assert.deepEqual(trafficB.captureSnapshot(),before);trafficB.advanceSnapshot(.1);policeB.advanceSnapshot(.1);trafficB.render();policeB.render();assert.equal(trafficB.diagnostics().replica,true);assert.equal(policeB.diagnostics().replica,true);
 h.dispose();g.dispose();trafficA.dispose();trafficB.dispose();policeA.dispose();policeB.dispose();cityA.dispose();cityB.dispose();await flush();
});
await check('Actual remote cars interpolate wrapped headings and wheel motion, snap teleports, carry damage/lights and expose matching audio/contact poses',()=>{
 globalThis.document={createElement:()=>({width:0,height:0,getContext:()=>({fillRect(){},fillText(){}})})};
 now=1000;const scene=new THREE.Scene(),cars=createNetworkCars(scene,{now:()=>now});const build=resolveBuild({carId:'kitsune'}).selection;
 const player=(stamp,state)=>({id:'remote-one',name:'REMOTE',color:'#66aadd',build,state,updatedAt:stamp,active:true});cars.sync([player(1,{...pose(0),heading:Math.PI-.1})]);cars.update(.016,0);
 now=1050;cars.sync([player(2,{...pose(1),heading:-Math.PI+.1,wheelAttached:[true,false,true,true],bodyHealth:.3})]);now=1125;cars.update(.016,.125);const state=cars.getStates()[0];assert.ok(Math.abs(state.x-.5)<1e-6);assert.ok(Math.abs(Math.abs(state.heading)-Math.PI)<1e-6);assert.equal(state.wheelAttached[1],false);assert.equal(state.bodyHealth,.3);assert.equal(cars.diagnostics().count,1);
 const audio=cars.getNearbyAudio({x:0,z:0})[0],contact=cars.getColliders({x:0,z:0})[0];assert.equal(audio.x,state.x);assert.equal(contact.x,state.x);assert.equal(contact.peerId,'remote-one');assert.equal(contact.kind,'network');assert.equal(contact.body,undefined);
 now=1200;cars.sync([player(3,pose(180,50))]);cars.update(.016,.2);assert.ok(cars.getStates()[0].x>=180);assert.equal(cars.diagnostics().teleports,1);
 for(let i=4;i<50;i++){now+=50;cars.sync([player(i,pose(180+i*.1,50))]);cars.update(.05,now/1000);}assert.ok(cars.diagnostics().buffers.every(n=>n<=8));
 now+=3000;cars.update(.016,3);assert.equal(cars.diagnostics().visible,0);assert.equal(cars.getNearbyAudio({x:180,z:50}).length,0);assert.equal(cars.getColliders({x:180,z:50}).length,0);
 cars.sync([]);assert.equal(cars.diagnostics().count,0);assert.equal(scene.children.length,0);cars.dispose();cars.dispose();
});
for(const s of [host,alice,bob,cara])s.dispose();await flush();assert.equal(peers.size,0);
report.status='passed';report.modules=Object.fromEntries(['dist/multiplayer.js','dist/network-cars.js'].map(file=>[file,createHash('sha256').update(fs.readFileSync(new URL('../'+file,import.meta.url))).digest('hex')]));fs.writeFileSync(new URL('./multiplayer-v8-results.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,checks:report.checks.length,room:report.room},null,2));
