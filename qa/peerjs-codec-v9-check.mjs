import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {createCity} from '../dist/city.js';
import {createTraffic} from '../dist/traffic.js';
import {createPolice} from '../dist/police.js';
import {sanitizeNetworkPose,sanitizeWorldSnapshot,MULTIPLAYER_VERSION} from '../dist/multiplayer.js';

const report={version:9,status:'pending',checks:[],fixtures:[],verificationLimit:'Runs the shipped PeerJS 1.5.5 JSON and BinaryPack classes, including real chunking/reassembly, in a VM without WebRTC. This verifies serialization, not signaling, ICE traversal, browser rendering or live internet connectivity.'};
const vendorPath=new URL('../dist/vendor/peerjs.min.js',import.meta.url),vendor=fs.readFileSync(vendorPath,'utf8');
const hook='window.peerjs={Peer:eG,util:ef},window.Peer=eG';
assert.equal(vendor.split(hook).length,2,'The test hook must identify exactly one export in the shipped vendor source');
// Expose existing private classes for the test; do not replace their methods.
const source=vendor.replace(hook,'window.__codecQA={Json:eV,Binary:ez,Chunker:n};'+hook);
const window={navigator:{userAgent:'Node codec QA'},location:{protocol:'https:',hostname:'qa.invalid'}};
const context=vm.createContext({window,navigator:window.navigator,TextEncoder,TextDecoder,Uint8Array,ArrayBuffer,DataView,Blob,console,setTimeout,clearTimeout,setInterval,clearInterval});
vm.runInContext(source,context,{filename:'peerjs.min.js'});
function encodeAndDecode(packets,{interleave=false}={}){
 context.packetJSON=JSON.stringify(packets);context.interleave=interleave;
 // BinaryPack tests object constructors. Parse in the vendor's own realm, as a
 // browser does, instead of passing Node objects with a different constructor.
 vm.runInContext(`{
  const {Json,Binary,Chunker}=window.__codecQA,packets=JSON.parse(packetJSON),channels=[],jsonErrors=[],jsonBuffers=[],received=[],sender=Object.create(Binary.prototype);
  Object.assign(sender,{chunker:new Chunker(),_bufferedSend:data=>channels[channels.length-1].push(data),send(value,chunked){this._send(value,chunked);}});
  for(const packet of packets){
   Json.prototype._send.call({encoder:new TextEncoder(),stringify:JSON.stringify,emitError:(type,message)=>jsonErrors.push({type,message}),_bufferedSend:buffer=>jsonBuffers.push(buffer.byteLength)},packet,false);
   channels.push([]);sender._send(packet,false);
  }
  const receiver=Object.create(Binary.prototype);Object.assign(receiver,{_chunkedData:{},emit:(type,data)=>{if(type==='data')received.push(data);}});
  if(interleave){const count=Math.max(...channels.map(c=>c.length));for(let i=0;i<count;i++)for(const channel of channels)if(channel[i])receiver._handleDataMessage({data:channel[i]});}
  else for(const channel of channels)for(const data of channel)receiver._handleDataMessage({data});
  globalThis.codecResult=JSON.stringify({jsonErrors,jsonBuffers,chunkSizes:channels.map(c=>c.map(b=>b.byteLength)),received,pendingChunks:Object.keys(receiver._chunkedData).length});
 }`,context,{filename:'shipped-peerjs-codec-qa'});
 return JSON.parse(context.codecResult);
}
const city=createCity(null),traffic=createTraffic(null,city,{count:36}),police=createPolice(null,city,traffic,{count:6,dayCount:3,nightCount:6});
const basePose={x:city.spawn.x,z:city.spawn.z,heading:city.spawn.heading,vx:0,vz:0,speed:0,forwardSpeed:0,rpm:900,gear:0,width:2,length:4.4,mass:1160,inertia:1680,playerId:'sideways-v8-ABCD2345'};
let sequence=0;
function packet(label,players=1,world=null){
 const snapshot=sanitizeWorldSnapshot(world||{traffic:traffic.captureSnapshot(),police:police.captureSnapshot(),hour:23,trafficTime:traffic.time});assert.ok(snapshot,label+' must pass the actual world validator');
 return {v:MULTIPLAYER_VERSION,room:'ABCD2345',type:'frame',n:++sequence,payload:{runId:1,players:Array.from({length:players},(_,i)=>({id:i?'guest-'+i:basePose.playerId,state:sanitizeNetworkPose({...basePose,x:basePose.x+i*6,bodyHealth:i===2?.35:1,wheelAttached:[true,i!==2,true,true],headlights:true}),active:true})),world:snapshot}};
}
function verify(label,frame,{fragmented=false}={}){
 const bytes=Buffer.byteLength(JSON.stringify(frame));assert.ok(bytes>16300,label+' must reproduce the old JSON failure');assert.ok(bytes<96000,label+' must fit the game packet bound');
 const result=encodeAndDecode([frame]);assert.equal(result.jsonErrors[0]?.type,'message-too-big');assert.equal(result.jsonBuffers.length,0);assert.deepEqual(result.received,[frame]);assert.equal(result.pendingChunks,0);if(fragmented)assert.ok(result.chunkSizes[0].length>1,'Expected actual vendor fragmentation');
 assert.ok(result.chunkSizes.flat().every(bytes=>bytes<=16384),'Vendor chunks must fit a conservative 16 KiB data-channel message');
 report.fixtures.push({label,jsonBytes:bytes,jsonError:result.jsonErrors[0].type,binaryChunks:result.chunkSizes[0].length,binaryBytes:result.chunkSizes[0].reduce((a,b)=>a+b,0),largestChunk:Math.max(...result.chunkSizes[0])});
 console.log('PASS '+label);
}
verify('First live city frame, 36 traffic cars and six police',packet('initial'));
for(let i=0;i<120;i++){traffic.update(1/120,basePose,{night:.9,emergency:police.states});police.update(1/120,basePose,{night:.9,players:[]});}
verify('Real city after one second with four player poses',packet('running',4));
report.checks.push('The actual shipped JSON codec reproduces message-too-big for first and evolved city frames; BinaryPack decodes the same frames without losing any fields');

// Stress the validator's 96-entry bound using real captured agent records.
// Normal gameplay uses 36 traffic cars; this is deliberately a larger fixture.
const world={traffic:traffic.captureSnapshot(),police:police.captureSnapshot(),hour:23,trafficTime:traffic.time};
world.traffic.cars=Array.from({length:96},(_,i)=>({...world.traffic.cars[i%36],id:'stress-'+i}));
const stressA=packet('bounded stress A',4,world),stressB=packet('bounded stress B',4,{...world,hour:23.1,trafficTime:traffic.time+.1});
verify('Bounded 96-agent stress frame uses real vendor fragmentation',stressA,{fragmented:true});
const interleaved=encodeAndDecode([stressA,stressB],{interleave:true});assert.ok(interleaved.chunkSizes.every(s=>s.length>1));assert.deepEqual(interleaved.received,[stressA,stressB]);assert.equal(interleaved.pendingChunks,0);
report.checks.push('Two interleaved fragmented frames reassemble independently and clear all vendor chunk buffers');console.log('PASS Interleaved vendor fragments');
traffic.dispose();police.dispose();city.dispose();report.status='passed';report.vendorSHA256=createHash('sha256').update(vendor).digest('hex');report.multiplayerSHA256=createHash('sha256').update(fs.readFileSync(new URL('../dist/multiplayer.js',import.meta.url))).digest('hex');
fs.writeFileSync(new URL('./peerjs-codec-v9-results.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
