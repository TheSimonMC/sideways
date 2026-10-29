import {MultiplayerSession} from '../dist/multiplayer.js';
/** In-memory PeerJS-compatible data transport. No network, ICE or WebRTC claim. */
export function createMemorySessionHost(now=()=>performance.now(),{jsonLimit=16300}={}){
 let serial=0;const peers=new Map(),messages=[],transportErrors=[];
 class Emitter{constructor(){this.events=new Map();}on(type,fn){const list=this.events.get(type)||[];list.push(fn);this.events.set(type,list);return this;}emit(type,value){for(const fn of this.events.get(type)||[])fn(value);}}
 class Connection extends Emitter{
  constructor(peer,metadata,serialization='binary'){super();this.peer=peer;this.metadata=metadata;this.serialization=serialization;this.open=false;this.bufferSize=0;this.dataChannel={bufferedAmount:0};this.sent=[];}
  send(value){if(!this.open)throw new Error('Closed');const bytes=new TextEncoder().encode(JSON.stringify(value)).byteLength;messages.push({peer:this.peer,serialization:this.serialization,bytes,type:value?.type});if(this.serialization==='json'&&bytes>=jsonLimit){const error={type:'message-too-big',message:'Message too big for JSON channel',bytes};transportErrors.push(error);queueMicrotask(()=>this.emit('error',error));return;}this.sent.push(value);queueMicrotask(()=>{if(this.partner?.open)this.partner.emit('data',structuredClone(value));});}
  close(){if(this.closed)return;this.closed=true;this.open=false;const partner=this.partner;queueMicrotask(()=>this.emit('close'));if(partner&&!partner.closed)partner.close();}
 }
 class Peer extends Emitter{
  constructor(id){super();this.id=id||'guest-'+(++serial);this.destroyed=false;this.links=[];if(peers.has(this.id))queueMicrotask(()=>this.emit('error',{type:'unavailable-id'}));else{peers.set(this.id,this);queueMicrotask(()=>{if(!this.destroyed)this.emit('open',this.id);});}}
  connect(id,options){const local=new Connection(id,options.metadata,options.serialization);this.links.push(local);queueMicrotask(()=>{const remotePeer=peers.get(id);if(!remotePeer){this.emit('error',{type:'peer-unavailable'});return;}const remote=new Connection(this.id,options.metadata,options.serialization);local.partner=remote;remote.partner=local;remotePeer.links.push(remote);remotePeer.emit('connection',remote);local.open=remote.open=true;local.emit('open');remote.emit('open');});return local;}
  reconnect(){}
  destroy(){if(this.destroyed)return;this.destroyed=true;if(peers.get(this.id)===this)peers.delete(this.id);for(const c of this.links)c.close();queueMicrotask(()=>this.emit('close'));}
 }
 const random={getRandomValues(bytes){for(let i=0;i<bytes.length;i++)bytes[i]=(serial*7+i*3)%256;serial++;return bytes;}};
 return{peers,messages,transportErrors,session:()=>new MultiplayerSession({peerFactory:id=>new Peer(id),now,random,autoHeartbeat:false})};
}
