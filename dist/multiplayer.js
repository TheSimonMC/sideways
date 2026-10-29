import {resolveBuild} from './catalog.js';

export const MULTIPLAYER_VERSION=13;
export const DEFAULT_LOBBY_RULES=Object.freeze({maxPlayers:4,traffic:'normal',police:true,damage:true,time:'cycle',collisions:'ghost'});
const CODE_ALPHABET='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const PREFIX='sideways-v13-';
const LIMITS={packet:96000,buffer:256000,events:64,links:7,rate:90,worldNodes:10000};
const utf8=new TextEncoder();
const ISSUE_MESSAGES={
 HOST_START_FAILED:'The host could not load the drive. Reload the game on the host, then create a new lobby.',
 PLAYER_START_FAILED:'The drive could not load on this device. Reload the game, then rejoin the lobby.',
 SESSION_FAILED:'The drive stopped because of an error. Reload the game, then rejoin the lobby.',
 HOST_LEFT:'The host left the lobby. Ask them for a new code.',
 PLAYER_LEFT:'The driver left the lobby.',
 CONNECTION_CLOSED:'The connection to the other driver closed unexpectedly. Check your connection, then rejoin the lobby.',
 CONNECTION_TIMEOUT:'The other driver stopped responding. Check your connection, then rejoin the lobby.',
 CONNECTION_SLOW:'The connection could not keep up with the drive. Rejoin the lobby when the connection improves.',
 SEND_FAILED:'Game data could not be sent. Reload the game on both devices, then rejoin the lobby.',
 PACKET_TOO_LARGE:'A game update exceeded the connection limit. Reload the game on both devices, then rejoin the lobby.',
 TRANSPORT_OUTDATED:'One game is using the old network transport. Reload the game on both devices, then create a new lobby.',
 PROTOCOL_MISMATCH:'These game versions cannot share a lobby. Reload the game on both devices, then create a new lobby.',
 LOBBY_FULL:'This lobby is full. Ask the host to free a slot or create another lobby.',
 LOBBY_NOT_FOUND:'Lobby not found. Check the code and ask the host to keep the lobby open.',
 LOBBY_CODE_IN_USE:'That lobby code is already in use. Create another lobby.',
 WEBRTC_UNAVAILABLE:'This browser does not support WebRTC. Open the game in a current browser.',
 WEBRTC_FAILED:'The direct connection failed. A TURN relay may be needed on this network.',
 SIGNALING_UNAVAILABLE:'Cannot reach the lobby service. Check your connection and try again.',
 INVALID_LOBBY_DATA:'The lobby returned invalid data. Reload the game on both devices, then try again.',
 RATE_LIMIT:'The connection sent too many messages and was closed. Reload the game, then rejoin the lobby.',
 CONNECTION_FAILED:'The lobby connection failed. Check your connection and try again.'
};
const finite=(v,d=0)=>Number.isFinite(v)?v:d;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,finite(v,a)));
const wrap=v=>Math.atan2(Math.sin(finite(v)),Math.cos(finite(v)));
const copy=v=>v==null?v:JSON.parse(JSON.stringify(v));
const bounded=(v,a,b)=>Number.isFinite(v)&&v>=a&&v<=b;
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const safeId=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(v);
const color=v=>typeof v==='string'&&/^#[0-9a-f]{6}$/i.test(v)?v:'#d8fa50';
const name=v=>String(v||'Driver').normalize('NFKC').replace(/[\u0000-\u001f<>\u007f]/g,'').trim().slice(0,20)||'Driver';
export function normalizeLobbyCode(value){return String(value||'').toUpperCase().replace(/[\s-]/g,'');}
export function validLobbyCode(value){return new RegExp('^['+CODE_ALPHABET+']{8}$').test(normalizeLobbyCode(value));}
export function makeLobbyCode(random=globalThis.crypto){
 if(!random?.getRandomValues)throw new Error('Secure random numbers are unavailable in this browser.');
 const bytes=new Uint8Array(8);random.getRandomValues(bytes);return Array.from(bytes,n=>CODE_ALPHABET[n&31]).join('');
}
export function normalizeLobbyRules(value={}){
 return {maxPlayers:Math.round(clamp(value.maxPlayers??4,2,4)),traffic:['off','light','normal'].includes(value.traffic)?value.traffic:'normal',police:value.police!==false,damage:value.damage!==false,time:['cycle','day','sunset','night'].includes(value.time)?value.time:'cycle',collisions:value.collisions==='solid'?'solid':'ghost'};
}
export function sanitizeNetworkPose(value){
 if(!object(value)||![value.x,value.z,value.heading].every(Number.isFinite)||!bounded(value.x,-8192,8192)||!bounded(value.z,-8192,8192))return null;
 const out={x:value.x,z:value.z,heading:wrap(value.heading)};
 const ranges={vx:[-170,170],vz:[-170,170],yawRate:[-12,12],speed:[0,180],forwardSpeed:[-180,180],bodyHeight:[-32,512],groundHeight:[-32,512],bodyPitch:[-.8,.8],bodyRoll:[-.8,.8],steer:[-1.5,1.5],brake:[0,1],throttle:[0,1],rpm:[0,16000],bodyHealth:[0,1],engineHealth:[0,1],nitrousIntensity:[0,1],driftAngle:[-Math.PI,Math.PI],gear:[-1,8]};
 for(const [key,[a,b]]of Object.entries(ranges))out[key]=clamp(value[key]??(key.endsWith('Health')?1:0),a,b);
 for(const key of ['headlights','boosting','horn','drifting'])out[key]=!!value[key];out.engineRunning=value.engineRunning!==false;
 out.wheelAttached=Array.from({length:4},(_,i)=>value.wheelAttached?.[i]!==false);
 out.wheelSpins=Array.from({length:4},(_,i)=>wrap(value.wheelSpins?.[i]));
 out.wheelSteers=Array.from({length:4},(_,i)=>clamp(value.wheelSteers?.[i]??(i<2?out.steer:0),-1.5,1.5));
 out.suspension=Array.from({length:4},(_,i)=>({wheelY:clamp(value.suspension?.[i]?.wheelY??out.groundHeight+.34,-32,513),groundHeight:clamp(value.suspension?.[i]?.groundHeight??out.groundHeight,-32,512),contact:value.suspension?.[i]?.contact!==false}));
 if(object(value.lastImpactLocal))out.lastImpactLocal={x:clamp(value.lastImpactLocal.x,-3,3),z:clamp(value.lastImpactLocal.z,-5,5)};
 return out;
}
function safeTree(value,budget={count:0},depth=0){
 if(++budget.count>LIMITS.worldNodes||depth>7)throw new Error('Snapshot too large');
 if(value===null||typeof value==='boolean')return value;
 if(typeof value==='number'){if(!bounded(value,-1e10,1e10))throw new Error('Invalid snapshot number');return value;}
 if(typeof value==='string'){if(value.length>180)throw new Error('Snapshot string too long');return value;}
 if(Array.isArray(value)){if(value.length>96)throw new Error('Snapshot list too long');return value.map(v=>safeTree(v,budget,depth+1));}
 if(object(value)){const keys=Object.keys(value);if(keys.length>64)throw new Error('Snapshot object too large');const out={};for(const key of keys){if(['__proto__','prototype','constructor'].includes(key)||key.length>48)throw new Error('Invalid snapshot key');out[key]=safeTree(value[key],budget,depth+1);}return out;}
 throw new Error('Invalid snapshot value');
}
export function sanitizeWorldSnapshot(value){
 if(!object(value))return null;
 try{return {traffic:value.traffic==null?null:safeTree(value.traffic),police:value.police==null?null:safeTree(value.police),hour:clamp(value.hour??17.2,0,24),trafficTime:clamp(value.trafficTime??0,0,1e10),hostPaused:!!value.hostPaused};}catch{return null;}
}
function sanitizeProfile(value={}){return {name:name(value.name),build:resolveBuild(object(value.build)?value.build:{}).selection,color:color(value.color)};}
export function peerOptions(config={}){
 const options={debug:0,secure:true};
 if(typeof config.host==='string'&&/^[a-z0-9.-]{1,253}$/i.test(config.host)){options.host=config.host;options.port=Math.round(clamp(config.port??443,1,65535));options.path=typeof config.path==='string'&&/^\/[a-z0-9/_-]*$/i.test(config.path)?config.path:'/';}
 const ice=Array.isArray(config.iceServers)?config.iceServers.slice(0,6).flatMap(server=>{
  if(!object(server))return[];const urls=(Array.isArray(server.urls)?server.urls:[server.urls]).filter(u=>typeof u==='string'&&/^(stun|stuns|turn|turns):[a-z0-9.:[\]_-]+(?::\d+)?(?:\?transport=(?:udp|tcp))?$/i.test(u)).slice(0,4);if(!urls.length)return[];
  return [{urls,...(typeof server.username==='string'?{username:server.username.slice(0,160)}:{}),...(typeof server.credential==='string'?{credential:server.credential.slice(0,256)}:{})}];
 }):[];
 if(ice.length)options.config={iceServers:ice};
 return options;
}
async function defaultPeerFactory(id,options){
 if(typeof globalThis.RTCPeerConnection!=='function')throw new Error('This browser does not support WebRTC.');
 if(!globalThis.Peer){await import('./vendor/peerjs.min.js');}
 const Peer=globalThis.Peer||globalThis.window?.Peer;if(typeof Peer!=='function')throw new Error('The multiplayer library could not load.');
 return id?new Peer(id,options):new Peer(options);
}
function errorCode(error){
 return {'peer-unavailable':'LOBBY_NOT_FOUND','unavailable-id':'LOBBY_CODE_IN_USE','browser-incompatible':'WEBRTC_UNAVAILABLE',network:'SIGNALING_UNAVAILABLE','server-error':'SIGNALING_UNAVAILABLE','socket-error':'SIGNALING_UNAVAILABLE','socket-closed':'SIGNALING_UNAVAILABLE','ssl-unavailable':'SIGNALING_UNAVAILABLE',webrtc:'WEBRTC_FAILED','message-too-big':'PACKET_TOO_LARGE'}[error?.type]||'CONNECTION_FAILED';
}

/** Host-coordinated room; the transport never advances a native engine. */
export class MultiplayerSession{
 constructor({onEvent=null,peerFactory=defaultPeerFactory,now=()=>performance.now(),autoHeartbeat=true,random=globalThis.crypto}={}){
  this._factory=peerFactory;this._now=now;this._random=random;this._onEvent=onEvent;this._autoHeartbeat=autoHeartbeat;
  this.peer=null;this.links=new Map();this.members=new Map();this.events=[];this._epoch=0;this._seq=0;this._run=0;this._timer=null;this._pending=null;this._lastWorld=null;this._localPose=null;this._lastUpdate=this._now();this._poseClock=0;this._worldClock=0;this._lastPing=0;this._lastFrame=0;this._lastProfile='';this._closed=false;this._retiring=new Set();this._secrets=[];
  this.status='offline';this.id=null;this.code='';this.isHost=false;this.hostId=null;this.rules={...DEFAULT_LOBBY_RULES};this.error='';this.lastIssue=null;this.ping=0;this.runId=0;this.stats={sent:0,received:0,dropped:0,backpressure:0,invalid:0,lastPacketBytes:0,maxPacketBytes:0};
 }
 get connected(){return this.status==='lobby'||this.status==='playing';}
 get playing(){return this.status==='playing';}
 _emit(type,detail={}){const event={type,...detail};if(this.events.length>=LIMITS.events)this.events.shift();this.events.push(event);this._onEvent?.(event);}
 _status(status,message=''){this.status=status;this._emit('status',{status,message});}
 _cleanDetail(value){
  let text=typeof value==='string'?value:'';for(const secret of this._secrets)if(secret)text=text.split(secret).join('[redacted]');
  return text.replace(/(?:https?|wss?|turns?|stuns?):\S+/gi,'[address]').replace(/\b(?:bearer|basic)\s+[a-z0-9._~+\/-]+=*/gi,'[redacted]').replace(/\b(authorization|credential|password|secret|token|username)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,'$1=[redacted]').replace(/[\u0000-\u001f<>\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,320);
 }
 _issue(code,{detail='',stage='connection',role=this.isHost?'host':'guest',retryable=true}={}){
  if(!Object.hasOwn(ISSUE_MESSAGES,code))code='CONNECTION_FAILED';
  return {code,message:ISSUE_MESSAGES[code],detail:this._cleanDetail(detail),stage:(typeof stage==='string'?stage:'connection').replace(/[^a-z0-9_-]/gi,'').slice(0,32)||'connection',retryable:!!retryable,at:Date.now(),role:role==='host'?'host':'guest'};
 }
 _errorDetail(error){return this._cleanDetail(typeof error==='string'?error:[error?.name||error?.type,error?.message].filter(v=>typeof v==='string'&&v).join(': '));}
 _receivedIssue(value,fallback='CONNECTION_CLOSED'){
  return this._issue(typeof value?.code==='string'&&Object.hasOwn(ISSUE_MESSAGES,value.code)?value.code:fallback,{detail:value?.detail||'',stage:value?.stage||'connection',role:value?.role||'host',retryable:value?.retryable!==false});
 }
 _remember(issue){this.lastIssue={...issue};return this.lastIssue;}
 clearIssue(){this.lastIssue=null;this.error='';return this;}
 _finishPending(error=null){const pending=this._pending;if(!pending)return;this._pending=null;clearTimeout(pending.timer);error?pending.reject(error):pending.resolve(this.getState());}
 _newPending(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});promise.catch(()=>{});this._pending={resolve,reject,timer:setTimeout(()=>this._fail(this._issue('CONNECTION_TIMEOUT',{stage:'joining',detail:'No lobby response within 20 seconds. A TURN relay may be needed on a restricted network.'})),20000)};return promise;}
 async host(options={}){return this._connect(true,'',options);}
 async join(code,options={}){
  const normalized=normalizeLobbyCode(code);if(!validLobbyCode(normalized))throw new Error('Enter the eight-character lobby code.');
  return this._connect(false,normalized,options);
 }
 async _connect(host,code,options){
  this.leave(null);this.clearIssue();this.events.length=0;this._secrets=(Array.isArray(options.config?.iceServers)?options.config.iceServers:[]).flatMap(s=>[s?.username,s?.credential]).filter(v=>typeof v==='string'&&v);const epoch=++this._epoch;this._closed=false;this.isHost=host;this.code=host?makeLobbyCode(this._random):code;this.hostId=PREFIX+this.code;this.rules=normalizeLobbyRules(options.rules);this.profile=sanitizeProfile(options);this._status('connecting',host?'Creating lobby...':'Finding lobby...');
  const pending=this._newPending();
  try{
   const candidate=this._factory(host?this.hostId:undefined,peerOptions(options.config));
   const peer=candidate&&typeof candidate.then==='function'?await candidate:candidate;
   if(epoch!==this._epoch){peer.destroy?.();return pending;}
   this.peer=peer;this._bindPeer(peer,epoch);this._lastPing=this._now();
   if(this._autoHeartbeat){this._timer=setInterval(()=>this._heartbeat(),1000);this._timer.unref?.();}
  }catch(error){if(epoch===this._epoch)this._fail(this._issue(errorCode(error),{detail:this._errorDetail(error),stage:'joining'}));}
  return pending;
 }
 _bindPeer(peer,epoch){
  const live=()=>epoch===this._epoch&&!this._closed;
  peer.on('open',id=>{if(!live())return;this.id=id;if(!safeId(id)){this._fail(this._issue('INVALID_LOBBY_DATA',{detail:'The lobby service returned an invalid player ID.'}));return;}
   if(this.isHost){this.members.set(id,{id,...this.profile,ready:true,active:false,state:null,updatedAt:this._now()});this._status('lobby','Lobby ready. Share the code with your friends.');this._emitRoom();this._finishPending();}
   // PeerJS JSON cannot carry a city frame: it rejects messages at 16,300 bytes.
   // BinaryPack includes fragmentation and reassembly for larger world updates.
   else{try{const connection=peer.connect(this.hostId,{label:'sideways-v13',serialization:'binary',reliable:true,metadata:{version:MULTIPLAYER_VERSION,transport:'binary-v1'}});this._bindConnection(connection,false);}catch(error){this._fail(this._issue(errorCode(error),{detail:this._errorDetail(error),stage:'joining'}));}}
  });
  peer.on('connection',connection=>{if(!live()||!this.isHost||this.links.size>=LIMITS.links){connection.close?.();return;}const reject=connection.metadata?.version!==MULTIPLAYER_VERSION?'PROTOCOL_MISMATCH':connection.serialization&&connection.serialization!=='binary'?'TRANSPORT_OUTDATED':null;this._bindConnection(connection,true,reject);});
  peer.on('call',call=>call.close?.());
  peer.on('error',error=>{if(!live())return;if(this.isHost&&this.connected&&error?.type==='webrtc'){this._emit('warning',{message:'A driver could not connect. Their network may need a TURN relay.'});return;}if(this.connected&&['network','socket-error','socket-closed','disconnected'].includes(error?.type)){this.error='Lobby discovery disconnected. Existing players can keep driving.';this._emit('warning',{message:this.error});return;}this._fail(this._issue(errorCode(error),{detail:this._errorDetail(error)}));});
  peer.on('disconnected',()=>{if(!live())return;if(!this.connected){this._fail(this._issue('SIGNALING_UNAVAILABLE',{detail:'The lobby service disconnected before the room opened.'}));return;}this._emit('warning',{message:'Lobby discovery disconnected. Existing players can keep driving.'});try{peer.reconnect?.();}catch{}});
  peer.on('close',()=>{if(live())this._fail(this._issue('CONNECTION_CLOSED',{detail:'The lobby peer closed unexpectedly.'}));});
 }
 _bindConnection(connection,incoming,reject=null){
  if(!connection||!safeId(connection.peer)||this.links.has(connection.peer)){connection?.close?.();return;}
  const link={connection,id:connection.peer,joined:false,lastSeq:0,lastSeen:this._now(),createdAt:this._now(),rateAt:this._now(),rateCount:0,rateFaults:0,reject,lastPacket:null};this.links.set(link.id,link);const epoch=this._epoch;
  connection.on('open',()=>{if(epoch!==this._epoch)return;if(reject){this._dropLink(link,this._issue(reject,{stage:'joining'}),{terminal:'reject'});return;}if(!incoming)this._send(link,'hello',{profile:this.profile});});
  connection.on('data',packet=>{if(epoch===this._epoch)this._receive(link,packet);});
  connection.on('error',error=>{if(epoch===this._epoch){const p=link.lastPacket,detail=[p?`${p.type} packet: ${p.bytes} UTF-8 bytes; transport: ${connection.serialization||'binary'}.`:'',this._errorDetail(error)].filter(Boolean).join(' ');this._dropLink(link,this._issue(error?.type==='message-too-big'?'PACKET_TOO_LARGE':'SEND_FAILED',{detail,stage:this.playing?'driving':'joining'}));}});
  connection.on('close',()=>{if(epoch===this._epoch)this._dropLink(link,this._issue('CONNECTION_CLOSED',{detail:'The data channel closed without a departure message.',stage:this.playing?'driving':'lobby'}),{notify:false});});
 }
 _packet(type,payload){return {v:MULTIPLAYER_VERSION,room:this.code,type,n:++this._seq,payload};}
 _send(link,type,payload,essential=true){
  const connection=link?.connection;if(!connection?.open)return false;
  const bytes=finite(connection.dataChannel?.bufferedAmount),queued=finite(connection.bufferSize);
  if(bytes>LIMITS.buffer||queued>6){this.stats.backpressure++;if(essential)this._dropLink(link,this._issue('CONNECTION_SLOW',{detail:`Buffered data: ${Math.round(bytes)} bytes; queued packets: ${Math.round(queued)}.`,stage:'sending'}));return false;}
  try{const packet=this._packet(type,payload),packetBytes=utf8.encode(JSON.stringify(packet)).byteLength;link.lastPacket={type,bytes:packetBytes};this.stats.lastPacketBytes=packetBytes;this.stats.maxPacketBytes=Math.max(this.stats.maxPacketBytes,packetBytes);if(packetBytes>LIMITS.packet){this.stats.dropped++;if(essential)this._dropLink(link,this._issue('PACKET_TOO_LARGE',{detail:`${type} packet: ${packetBytes} UTF-8 bytes; limit: ${LIMITS.packet}.`,stage:'sending'}));return false;}connection.send(packet);if(!this.links.has(link.id)||!connection.open)return false;this.stats.sent++;return true;}catch(error){const p=link.lastPacket;this._dropLink(link,this._issue('SEND_FAILED',{detail:[p?`${p.type} packet: ${p.bytes} UTF-8 bytes; transport: ${connection.serialization||'binary'}.`:'',this._errorDetail(error)].filter(Boolean).join(' '),stage:'sending'}));return false;}
 }
 _broadcast(type,payload,essential=true){for(const link of [...this.links.values()])if(link.joined)this._send(link,type,payload,essential);}
 _receive(link,packet){
  if(!this.links.has(link.id))return;const now=this._now();if(now-link.rateAt>=1000){link.rateAt=now;link.rateCount=0;}
  if(++link.rateCount>LIMITS.rate){this.stats.dropped++;if(++link.rateFaults>30)this._dropLink(link,this._issue('RATE_LIMIT'));return;}
  try{if(!object(packet)||packet.v!==MULTIPLAYER_VERSION||packet.room!==this.code||typeof packet.type!=='string'||!Number.isSafeInteger(packet.n)||packet.n<=link.lastSeq||utf8.encode(JSON.stringify(packet)).byteLength>LIMITS.packet){this.stats.invalid++;return;}}catch{this.stats.invalid++;return;}
  link.lastSeq=packet.n;link.lastSeen=now;this.stats.received++;
  const type=packet.type,data=packet.payload;
  if(type==='ping'){if(object(data)&&bounded(data.at,0,1e15))this._send(link,'pong',{at:data.at});return;}
  if(type==='pong'){if(object(data)&&bounded(data.at,0,now)){this.ping=Math.round(clamp(now-data.at,0,10000));}return;}
  if(type==='leave'&&this.isHost){this._dropLink(link,this._receivedIssue(data,'PLAYER_LEFT'),{notify:false});return;}
  if(this.isHost){
   if(type==='hello'&&!link.joined){
    if(!object(data)||!object(data.profile))return;
    if(this.members.size>=this.rules.maxPlayers){this._dropLink(link,this._issue('LOBBY_FULL',{stage:'joining'}),{terminal:'reject'});return;}
    link.joined=true;const profile=sanitizeProfile(data.profile);this.members.set(link.id,{id:link.id,...profile,ready:false,active:false,state:null,updatedAt:now});
    this._send(link,'welcome',{id:link.id,hostId:this.id,room:this._roomPayload(),runId:this.runId});this._broadcastRoom();this._emit('playerJoined',{id:link.id,name:profile.name});
    if(this.status==='playing')this._send(link,'start',{runId:this.runId,rules:this.rules});return;
   }
   if(!link.joined)return;
   const member=this.members.get(link.id);if(!member)return;
   if(type==='ready'&&this.status==='lobby'){member.ready=!!data?.ready;this._broadcastRoom();return;}
   if(type==='profile'&&object(data)){Object.assign(member,sanitizeProfile(data));this._broadcastRoom();return;}
   if(type==='pose'&&this.status==='playing'){
    const pose=sanitizeNetworkPose(data?.state);if(!pose){this.stats.invalid++;return;}member.state=pose;member.active=!!data.active;member.updatedAt=now;return;
   }
   if(type==='away'){member.active=false;member.updatedAt=now;return;}
   this.stats.invalid++;return;
  }
  if(link.id!==this.hostId){this.stats.invalid++;return;}
  if(type==='reject'){this._fail(this._receivedIssue(data,/full/i.test(data?.message)?'LOBBY_FULL':'CONNECTION_FAILED'),{notify:false});return;}
  if(type==='ended'){
   const issue=this._receivedIssue(data,'HOST_LEFT');
   if(issue.code==='HOST_LEFT'){this.events.length=0;this._remember(issue);this._finishPending(new Error(issue.message));this._shutdown();this.status='offline';this.error='';this._emit('sessionEnded',{message:issue.message,code:issue.code,issue:{...issue}});}
   else this._fail(issue,{notify:false});return;
  }
  if(type==='welcome'&&!link.joined){
   if(!object(data)||data.id!==this.id||data.hostId!==this.hostId||!this._applyRoom(data.room)){this._fail(this._issue('INVALID_LOBBY_DATA',{stage:'joining'}));return;}
   link.joined=true;this.runId=clamp(data.runId,0,1e9);this._status('lobby','Connected. Ready up when you want to drive.');this._emitRoom();this._finishPending();return;
  }
  if(!link.joined)return;
  if(type==='room'){if(this._applyRoom(data))this._emitRoom();return;}
  if(type==='start'){
   if(!object(data)||!Number.isSafeInteger(data.runId)||data.runId<this.runId||data.runId===this.runId&&this.playing)return;
   this.runId=data.runId;this.rules=normalizeLobbyRules(data.rules);this._status('playing','Session started.');this._emit('start',{runId:this.runId,rules:{...this.rules}});return;
  }
  if(type==='frame'&&this.playing){
   if(!object(data)||data.runId!==this.runId||!Array.isArray(data.players)||data.players.length>4){this.stats.invalid++;return;}
   for(const row of data.players){const member=this.members.get(row?.id);if(!member||member.id===this.id)continue;const pose=sanitizeNetworkPose(row.state);if(!pose)continue;member.state=pose;member.active=!!row.active;member.updatedAt=now;}
   if(data.world){const world=sanitizeWorldSnapshot(data.world);if(world){this._lastWorld=world;this._lastFrame=now;}else this.stats.invalid++;}
   return;
  }
  if(type==='event'&&object(data)&&typeof data.type==='string'&&['arrest','escaped','pursuit','radio','search','speedCamera','nearMiss','checkpoint','sessionNotice'].includes(data.type)){
   try{this._emit('gameEvent',{event:{type:data.type,payload:safeTree(data.payload)}});}catch{this.stats.invalid++;}return;
  }
  this.stats.invalid++;
 }
 _roomPayload(){return {rules:{...this.rules},phase:this.status==='playing'?'playing':'lobby',players:[...this.members.values()].map(m=>({id:m.id,name:m.name,build:m.build,color:m.color,ready:m.ready}))};}
 _applyRoom(value){
  if(!object(value)||!Array.isArray(value.players)||value.players.length<1||value.players.length>4)return false;
  const ids=new Set(),next=new Map();for(const row of value.players){if(!object(row)||!safeId(row.id)||ids.has(row.id))return false;ids.add(row.id);const old=this.members.get(row.id);next.set(row.id,{...sanitizeProfile(row),id:row.id,ready:!!row.ready,active:old?.active||false,state:old?.state||null,updatedAt:old?.updatedAt||this._now()});}
  if(!ids.has(this.hostId)||!ids.has(this.id))return false;
  for(const [id,old]of this.members)if(!next.has(id)&&id!==this.id)this._emit('playerLeft',{id,name:old.name});
  for(const [id,member]of next)if(!this.members.has(id)&&id!==this.id)this._emit('playerJoined',{id,name:member.name});
  this.members=next;this.rules=normalizeLobbyRules(value.rules);return true;
 }
 _emitRoom(){this._emit('room',{room:this.getState()});}
 _broadcastRoom(){this._broadcast('room',this._roomPayload());this._emitRoom();}
 setReady(value=true){const me=this.members.get(this.id);if(!me||this.status!=='lobby')return false;me.ready=!!value;if(this.isHost)this._broadcastRoom();else this._send(this.links.get(this.hostId),'ready',{ready:me.ready});this._emitRoom();return true;}
 setRules(value){if(!this.isHost||this.status!=='lobby')return false;const next=normalizeLobbyRules(value);next.maxPlayers=Math.max(next.maxPlayers,this.members.size);this.rules=next;for(const member of this.members.values())member.ready=member.id===this.id;this._broadcastRoom();return true;}
 start(){
  if(!this.isHost||this.status!=='lobby')return false;if([...this.members.values()].some(m=>!m.ready)){this._emit('warning',{message:'Wait until every driver is ready.'});return false;}
  this.runId=++this._run;this._status('playing','Session started.');this._broadcast('start',{runId:this.runId,rules:this.rules});this._emit('start',{runId:this.runId,rules:{...this.rules}});return true;
 }
 setAway(){const me=this.members.get(this.id);if(me)me.active=false;if(!this.isHost)this._send(this.links.get(this.hostId),'away',{});}
 update(dt,{state,build,color:paint,world,active=true}={}){
  const now=this._now();this._lastUpdate=now;if(!this.connected)return;
  const me=this.members.get(this.id);if(!me)return;
  if(build||paint){const next={...this.profile,build:build?resolveBuild(build.selection||build).selection:this.profile.build,color:paint?color(paint):this.profile.color},key=JSON.stringify(next);if(key!==this._lastProfile){this._lastProfile=key;this.profile=next;Object.assign(me,next);if(this.isHost)this._broadcastRoom();else this._send(this.links.get(this.hostId),'profile',next);}}
  if(!this.playing)return;
  const pose=sanitizeNetworkPose(state);if(pose){me.state=pose;me.active=!!active;me.updatedAt=now;this._localPose=pose;}
  this._poseClock+=clamp(dt,0,.25);this._worldClock+=clamp(dt,0,.25);
  if(this._poseClock<.05)return;this._poseClock%=.05;
  if(this.isHost){
   const players=[...this.members.values()].filter(m=>m.state).map(m=>({id:m.id,state:m.state,active:m.active&&now-m.updatedAt<2500}));
   const snapshot=this._worldClock>=.1?sanitizeWorldSnapshot(world):null;if(snapshot)this._worldClock%=.1;
   this._broadcast('frame',{runId:this.runId,players,world:snapshot},false);
  }else if(this._localPose)this._send(this.links.get(this.hostId),'pose',{state:this._localPose,active:!!active},false);
 }
 broadcastEvent(type,payload={}){if(!this.isHost||!this.playing||!['arrest','escaped','pursuit','radio','search','speedCamera','nearMiss','checkpoint','sessionNotice'].includes(type))return false;try{this._broadcast('event',{type,payload:safeTree(payload)});return true;}catch{return false;}}
 _heartbeat(){
  if(!this.peer||this._closed)return;const now=this._now();
  for(const link of [...this.links.values()]){
   if(!link.joined&&now-link.createdAt>12000){this._dropLink(link,this._issue('CONNECTION_TIMEOUT',{stage:'joining',detail:'The data channel did not join within 12 seconds.'}));continue;}
   if(link.joined&&now-link.lastSeen>25000){this._dropLink(link,this._issue('CONNECTION_TIMEOUT',{stage:this.playing?'driving':'lobby',detail:'No response from this driver for 25 seconds.'}));continue;}
   if(link.joined)this._send(link,'ping',{at:now},false);
  }
 }
 _sendTerminal(link,type,issue){
  if(!link?.connection?.open)return;try{link.connection.send(this._packet(type,{...issue}));}catch{}
 }
 _dropLink(link,issue,{notify=true,terminal='ended'}={}){
  if(!link||!this.links.has(link.id)||this._failing)return;
  if(!this.isHost&&link.id===this.hostId){this._fail(issue,{notify});return;}
  this.links.delete(link.id);const member=this.members.get(link.id);this.members.delete(link.id);
  if(notify)this._sendTerminal(link,terminal,issue);
  if(notify&&link.connection.open)this._retire([link]);else try{link.connection.close?.();}catch{}
  if(member){if(issue.code!=='PLAYER_LEFT')this._remember(issue);this._emit('playerLeft',{id:link.id,name:member.name,message:issue.message,code:issue.code,issue:{...issue}});this._broadcastRoom();}
 }
 _fail(issue,{notify=true}={}){
  if(this._closed||this._failing)return;this._failing=true;this.events.length=0;this._remember(issue);this.error=issue.message;
  if(notify)for(const link of this.links.values())if(link.joined)this._sendTerminal(link,this.isHost?'ended':'leave',issue);
  this._finishPending(Object.assign(new Error(this.error),{code:issue.code}));this._shutdown({graceful:notify});this._failing=false;this.status='error';this._emit('error',{message:this.error,code:issue.code,issue:{...issue}});this._emit('sessionEnded',{message:this.error,code:issue.code,issue:{...issue}});
 }
 failStart(error,{stage='startup'}={}){return this.failSession(error,{stage,code:this.isHost?'HOST_START_FAILED':'PLAYER_START_FAILED'});}
 failSession(error,{stage='session',code='SESSION_FAILED'}={}){this._fail(this._issue(code,{stage,detail:this._errorDetail(error)}));return this.lastIssue;}
 _retire(links,peer=null){
  // Detach game state immediately, but let the terminal reason reach the other
  // browser before destroying its channel. The receiver closes after reading it.
  // A lost receiver cannot retain a peer longer than this one-second grace period.
  const pending=new Set(links.filter(link=>link.connection.open));let timer,finished=false;
  const finish=()=>{if(finished)return;finished=true;clearTimeout(timer);this._retiring.delete(retired);for(const link of links)try{link.connection.close?.();}catch{}try{peer?.destroy?.();}catch{}};
  const retired={finish};this._retiring.add(retired);
  for(const link of links){if(pending.has(link))link.connection.on('close',()=>{pending.delete(link);if(!pending.size)finish();});else try{link.connection.close?.();}catch{}}
  if(!pending.size){finish();return;}timer=setTimeout(finish,1000);timer.unref?.();
 }
 _shutdown({graceful=false}={}){
  this._closed=true;this._epoch++;if(this._timer)clearInterval(this._timer);this._timer=null;const links=[...this.links.values()],peer=this.peer;this.links.clear();this.members.clear();this.peer=null;
  if(graceful)this._retire(links,peer);else{for(const link of links)try{link.connection.close?.();}catch{}try{peer?.destroy?.();}catch{}}
  this._lastWorld=null;this._lastFrame=0;this._lastProfile='';this._localPose=null;this._poseClock=this._worldClock=0;this.id=null;this.hostId=null;
 }
 leave(reason='Left lobby.'){
  const wasActive=this.peer||this.status!=='offline';this.events.length=0;const issue=this._issue(this.isHost?'HOST_LEFT':'PLAYER_LEFT',{stage:this.playing?'driving':'lobby',retryable:true});
  for(const link of this.links.values())if(link.joined)this._sendTerminal(link,this.isHost?'ended':'leave',issue);
  this._finishPending(new Error('Connection cancelled.'));this._shutdown({graceful:true});this.status='offline';this.code='';this.isHost=false;this.error='';this.ping=0;this.runId=0;
  if(reason&&wasActive)this._emit('sessionEnded',{message:reason});return this;
 }
 getRemotePlayers(){const now=this._now();return [...this.members.values()].filter(m=>m.id!==this.id).map(m=>({...copy(m),active:m.active&&!!m.state&&now-m.updatedAt<2500,ageMs:Math.max(0,now-m.updatedAt)}));}
 getState(){return {status:this.status,id:this.id,code:this.code,isHost:this.isHost,hostId:this.hostId,rules:{...this.rules},players:[...this.members.values()].map(m=>({id:m.id,name:m.name,build:copy(m.build),color:m.color,ready:m.ready,active:m.active})),ping:this.ping,error:this.error,lastIssue:this.lastIssue?{...this.lastIssue}:null,runId:this.runId,worldAgeMs:this._lastFrame?this._now()-this._lastFrame:0};}
 takeWorldSnapshot(){const world=this._lastWorld;this._lastWorld=null;return world;}
 consumeEvents(){return this.events.splice(0);}
 diagnostics(){return {...this.getState(),transport:'binary',links:this.links.size,queuedEvents:this.events.length,stats:{...this.stats}};}
 dispose(){this.leave(null);for(const retired of [...this._retiring])retired.finish();this.events.length=0;}
}
