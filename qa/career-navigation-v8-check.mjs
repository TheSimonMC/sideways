import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {Career,CAR_PRICES,ENGINE_PRICES,PART_PRICES} from '../dist/career.js';
import {DEFAULT_SELECTION,resolveBuild} from '../dist/catalog.js';
import {findRoadRoute,nearestOnPath,RoadNavigator,mapProjection,drawRoadMap,MapView} from '../dist/navigation-map.js';
import {createCity} from '../dist/city.js';

const runtimeRequire=createRequire((process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES||process.cwd()+'/node_modules')+'/package.json');
const {createCanvas}=runtimeRequire('@napi-rs/canvas');
const report={version:8,status:'pending',checks:[],limits:['Map checks execute the real Canvas 2D renderer on a CPU canvas. They do not verify browser layout, GPU rendering or physical controller navigation.','Progression is local to the browser save. It is not an anti-cheat or server-backed economy.']};
const check=(name,fn)=>{fn();report.checks.push(name);console.log('PASS '+name);};
const near=(a,b,tolerance=1e-7)=>assert.ok(Math.abs(a-b)<=tolerance,`${a} differs from ${b}`);
const length=points=>points.reduce((sum,p,i)=>sum+(i?Math.hypot(p.x-points[i-1].x,p.z-points[i-1].z):0),0);
const state=(x=0,z=0,speed=0)=>({x,z,speed,heading:0,bodyHealth:1});
const fresh=()=>new Career({},DEFAULT_SELECTION);
const city=createCity(null);
const job=(career,kind)=>{career.setWorld(city);for(let i=0;i<10&&career.getState().offer?.kind!==kind;i++)career.nextOffer();assert.equal(career.getState().offer?.kind,kind);assert.equal(career.accept(state(city.spawn.x,city.spawn.z)),true);return career.getState().active;};
const advance=(career,seconds,pose=state())=>{for(let i=0;i<Math.round(seconds*10);i++)career.update(.1,pose);};

check('Garage quotes include the car, engine and new parts; failed purchases are atomic and repeated installation is free',()=>{
 const c=fresh(),build=resolveBuild({carId:'atlas',engineId:'v12',ecu:'track',exhaust:'race',tyres:'sport',suspension:'race',brakes:'race',differential:'locked',clutch:'race'});
 const expected=CAR_PRICES.atlas+ENGINE_PRICES.v12+PART_PRICES.ecu.track+PART_PRICES.exhaust.race+PART_PRICES.tyres.sport+PART_PRICES.suspension.race+PART_PRICES.brakes.race+PART_PRICES.differential.locked+PART_PRICES.clutch.race;
 assert.equal(c.quote(build).total,expected);const before=c.serialize();assert.equal(c.purchase(build).ok,false);assert.deepEqual(c.serialize(),before);
 for(let i=0;i<4;i++)c.award(50000,'TEST FUNDS');c.consumeEvents();const balance=c.wallet;
 const result=c.purchase(build);assert.equal(result.ok,true);assert.equal(c.wallet,balance-expected);assert.equal(c.spent,expected);assert.equal(c.quote(build).total,0);assert.equal(c.owns('engine','v8'),true);
 assert.equal(c.purchase(build).ok,true);assert.equal(c.wallet,balance-expected);assert.equal(c.consumeEvents().filter(e=>e.type==='purchase').length,1);
 const restored=new Career(JSON.parse(JSON.stringify(c.serialize())),build.selection);assert.equal(restored.wallet,c.wallet);assert.equal(restored.spent,c.spent);assert.equal(restored.quote(build).total,0);
 const stock=fresh();assert.equal(stock.quote(resolveBuild({carId:'vector',engineId:'i4'})).total,CAR_PRICES.vector);
 report.economy={expensiveBuildCost:expected,startingWallet:fresh().wallet,transactionRoundtrip:true};
});

check('Legacy migration retains the installed setup once; later saves and forged build descriptors cannot unlock unpaid parts',()=>{
 const expensive=resolveBuild({carId:'atlas',engineId:'v12',ecu:'track',clutch:'race'}),legacy=new Career({},expensive.selection);assert.equal(legacy.quote(expensive).total,0);
 const saved=fresh().serialize(),restored=new Career(saved,expensive.selection);assert.equal(restored.owns('car','atlas'),false);assert.equal(restored.owns('engine','v12'),false);assert.ok(restored.quote(expensive).total>0);assert.equal(restored.quote(DEFAULT_SELECTION).total,0);
 const forged={...resolveBuild(DEFAULT_SELECTION),selection:expensive.selection};assert.equal(restored.quote(forged).total,restored.quote(expensive).total);assert.equal(restored.purchase(forged).ok,false);assert.equal(restored.owns('car','atlas'),false);
 const invalid=new Career({...saved,wallet:NaN,owned:['car:hachi:extra','engine:unknown'],active:{kind:'distance',goal:0,reward:4000,progress:0,elapsed:0}},DEFAULT_SELECTION);assert.equal(invalid.wallet,0);assert.equal(invalid.active,null);assert.equal(invalid.owned.has('car:hachi:extra'),false);
});

check('Only completed close passes earn points; duplicate traffic IDs are cooled down and an objective pays once',()=>{
 const c=fresh();job(c,'closeCalls');c.consumeEvents();const balance=c.wallet,s=state(0,0,25);
 assert.equal(c.onNearMiss({npcId:'one'},s),null);assert.equal(c.onNearMiss({npcId:'one',completed:true},state(0,0,5)),null);assert.equal(c.wallet,balance);
 for(let i=0;i<5;i++){assert.ok(c.onNearMiss({npcId:'npc-'+i,completed:true,clearance:.4,speed:25},s));assert.equal(c.onNearMiss({npcId:'npc-'+i,completed:true},s),null);}
 assert.equal(c.stats.closeCalls,5);assert.equal(c.completed,1);assert.equal(c.active,null);const events=c.consumeEvents();assert.equal(events.filter(e=>e.type==='objective'&&e.phase==='completed').length,1);assert.equal(events.filter(e=>e.kind==='objective').length,1);assert.equal(c.getState().closeChain,5);
 const after=c.wallet;c.update(.1,s);assert.equal(c.wallet,after);assert.equal(c.consumeEvents().filter(e=>e.kind==='objective').length,0);
 advance(c,16,s);assert.ok(c.onNearMiss({npcId:'npc-0',completed:true},s));assert.equal(c.getState().closeChain,1);
});

check('Drift points remain bankable on the dock while city objectives, delivery timers and police payouts stay in the city',()=>{
 const c=fresh();job(c,'drift');const balance=c.wallet;c.setWorld({kind:'dock',services:[]});c.bankDrift(1000);assert.equal(c.wallet,balance+1000);assert.equal(c.active.progress,0);const elapsed=c.active.elapsed;
 c.update(.1,state(3,0,30));assert.equal(c.active.elapsed,elapsed);c.onPolice({type:'pursuit'});advance(c,6);c.onPolice({type:'escaped'});assert.equal(c.stats.escapes,0);
 c.setWorld(city);c.bankDrift(5000);assert.equal(c.active,null);assert.equal(c.completed,1);assert.equal(c.stats.drift,6000);
 const delivery=fresh();job(delivery,'delivery');delivery.setWorld({kind:'dock',services:[]});advance(delivery,3);assert.equal(delivery.active.elapsed,0);
});

check('Distance counts plausible motion, rejects teleport jumps and invalid states, and recovery cancels the active job',()=>{
 const c=fresh();job(c,'distance');let x=0;c.update(.1,state(x,0,20));for(let i=0;i<100;i++){x+=2;c.update(.1,state(x,0,20));}near(c.active.progress,200);near(c.stats.distance,200);
 c.update(.1,state(x+900,0,20));near(c.active.progress,200);c.update(.1,state(x+901,0,0));near(c.active.progress,200);const old=c.serialize();c.update(.1,state(NaN,0,20));assert.deepEqual(c.serialize(),old);
 c.teleport();assert.equal(c.active,null);assert.ok(c.consumeEvents().some(e=>e.type==='objective'&&e.phase==='cancelled'));assert.equal(c.stats.distance,200);
});

check('Delivery pickup, cargo damage, payment and persisted jobs survive normal play without duplicate rewards',()=>{
 const c=fresh(),a=job(c,'delivery');advance(c,.9,state(a.pickup.x,a.pickup.z,0));assert.equal(c.active.stage,'delivery');const snapshot=JSON.parse(JSON.stringify(c.serialize()));
 const restored=new Career(snapshot,DEFAULT_SELECTION);restored.setWorld(city);assert.equal(restored.active.stage,'delivery');assert.equal(restored.getTarget().id,a.destinationId);
 restored.update(.1,{...state(a.destination.x,a.destination.z,0),bodyHealth:.9});advance(restored,.9,{...state(a.destination.x,a.destination.z,0),bodyHealth:.9});assert.equal(restored.active,null);assert.equal(restored.stats.deliveries,1);assert.equal(restored.completed,1);const expected=Math.round(a.reward*(.55+.45*.75));assert.equal(restored.wallet,c.wallet+expected);
 const balance=restored.wallet;advance(restored,2,state(a.destination.x,a.destination.z,0));assert.equal(restored.wallet,balance);
 const reloaded=new Career(JSON.parse(JSON.stringify(restored.serialize())),DEFAULT_SELECTION);reloaded.setWorld(city);assert.equal(reloaded.completed,1);assert.equal(reloaded.stats.deliveries,1);assert.equal(reloaded.active,null);
 const timeout=fresh();job(timeout,'delivery');timeout.active.duration=.2;advance(timeout,.4);assert.equal(timeout.active,null);assert.equal(timeout.completed,0);
});

check('Pursuit rewards require a real pursuit interval and clean-run collisions reset the active streak',()=>{
 const c=fresh();job(c,'escape');const balance=c.wallet;c.onPolice({type:'escaped'});assert.equal(c.wallet,balance);c.onPolice({type:'pursuit'});c.onPolice({type:'escaped'});assert.equal(c.wallet,balance);
 c.onPolice({type:'pursuit'});for(let i=0;i<60;i++)c.update(.1,state(),{police:{heat:2}});c.onPolice({type:'escaped'});assert.equal(c.stats.escapes,1);assert.equal(c.wallet,balance+3000+3600);c.onPolice({type:'escaped'});assert.equal(c.stats.escapes,1);
 const clean=fresh();job(clean,'cleanRun');advance(clean,2,state(0,0,25));near(clean.active.progress,2);clean.update(.1,{...state(0,0,25),bodyHealth:.98});assert.equal(clean.active.progress,0);advance(clean,1,{...state(0,0,25),bodyHealth:.98});near(clean.active.progress,1);
});

check('Road routes follow the actual curved graph and do not cut across neighbouring streets or blocks',()=>{
 const straightDistance=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
 const edge=[...city.network.edges].sort((a,b)=>(length(b.points)-straightDistance(b.points[0],b.points.at(-1)))-(length(a.points)-straightDistance(a.points[0],a.points.at(-1))))[0];
 const start=edge.points[2],target=edge.points.at(-3),route=findRoadRoute(city,start,target);assert.ok(!route.unrouted);assert.ok(route.points.length>5);near(route.distance,length(route.points),1e-6);assert.ok(route.distance>straightDistance(start,target)+.02);
 const roads=city.mapRoads.filter(r=>r.kind==='street');let routeCount=0;
 for(let i=0;i<city.network.edges.length;i+=17){const a=city.network.edges[i].points[5],b=city.network.edges[(i*7+79)%city.network.edges.length].points[14],r=findRoadRoute(city,a,b);assert.ok(!r.unrouted);assert.ok(r.points.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.z)));near(r.distance,length(r.points),1e-5);
  for(let j=1;j<r.points.length;j++){const p={x:(r.points[j-1].x+r.points[j].x)/2,z:(r.points[j-1].z+r.points[j].z)/2};assert.ok(Math.min(...roads.map(road=>nearestOnPath(p,road.points).distance))<.002,'Route leaves the road graph');}routeCount++;
 }
 report.routes={sampledRoutes:routeCount+1,curvedRoutePoints:route.points.length,curvedRouteMetres:route.distance,nodes:city.network.nodes.length,directedEdges:city.network.edges.length};
});

check('Directed unreachable routes stay absent and navigator arrivals cannot leak into a new waypoint or world',()=>{
 const nodes=[{id:0,x:0,z:0},{id:1,x:100,z:0}],world={kind:'city',network:{nodes,nodeById:new Map(nodes.map(n=>[n.id,n])),edges:[{id:'one-way',from:0,to:1,points:nodes,length:100}]}};
 const unreachable=findRoadRoute(world,{x:80,z:0},{x:20,z:0});assert.equal(unreachable.unrouted,true);assert.deepEqual(unreachable.points,[]);assert.equal(findRoadRoute(world,{x:NaN,z:0},nodes[0]).unrouted,true);
 const nav=new RoadNavigator();nav.setWorld(city);assert.equal(nav.setWaypoint({x:NaN,z:0}),false);const target=city.services.find(p=>p.kind==='fuel');assert.equal(nav.setWaypoint(target,'Fuel',{snap:false}),true);nav.update(.1,city.spawn);assert.ok(nav.getState().points.length>1);nav.update(.1,target);assert.equal(nav.getState().arrived,true);assert.equal(nav.consumeEvents().length,1);
 for(let i=0;i<20;i++)nav.update(.1,target);assert.equal(nav.getState().points.length,0);assert.equal(nav.consumeEvents().length,0);nav.setWaypoint(city.spawn,'Spawn',{snap:false});nav.update(.1,city.spawn);nav.setWorld(city);assert.equal(nav.consumeEvents().length,0);assert.equal(nav.getState().target,null);
});

check('Map projection round-trips across viewports and headings, and vehicle forward and compass north use the same axes',()=>{
 for(const [width,height]of [[240,240],[800,500],[3440,1440]])for(const full of [false,true])for(const heading of [0,Math.PI/2,Math.PI,-Math.PI/2,1.37]){
  const player={...city.spawn,heading,speed:55},p=mapProjection({width,height,world:city,player,full,view:{zoom:2.3,heading}});
  for(const q of [player,{x:170,z:-60},{x:-320,z:280}]){const round=p.unproject(...Object.values(p.project(q.x,q.z)));near(round.x,q.x,1e-8);near(round.z,q.z,1e-8);}
  const center=p.project(player.x,player.z),front=p.project(player.x+Math.sin(heading),player.z+Math.cos(heading));if(!full){near(front.x,center.x,1e-8);assert.ok(front.y<center.y);}else{const north=p.project(player.x,player.z-1);assert.ok(north.y<center.y);near(north.x,center.x);}
 }
 const view=new MapView();view.reset(city,city.spawn);view.heading=Math.PI-.01;view.updateHeading(-Math.PI+.01,.1);assert.ok(view.heading>Math.PI-.01);assert.ok(view.heading<Math.PI+.01);view.changeZoom(100);assert.equal(view.zoom,4);view.moveCursor(1e6,-1e6,city);assert.ok(view.cursor.x<=city.bounds.maxX-8&&view.cursor.z>=city.bounds.minZ+8);
});

function recordingCanvas(width,height){
 const canvas=createCanvas(width,height),base=canvas.getContext('2d'),record={fills:[],texts:[]};let current=[];
 const point=(x,y)=>{const m=base.getTransform();return{x:m.a*x+m.c*y+m.e,y:m.b*x+m.d*y+m.f};};
 const numeric=new Set(['moveTo','lineTo','arc','fillRect','strokeRect','clearRect','translate','rotate']);
 const ctx=new Proxy(base,{get(target,key){const value=Reflect.get(target,key,target);if(typeof value!=='function')return value;return(...args)=>{if(numeric.has(key))for(const value of args)if(typeof value==='number')assert.ok(Number.isFinite(value),'Nonfinite canvas '+key);if(key==='beginPath')current=[];if(key==='moveTo'||key==='lineTo')current.push(point(args[0],args[1]));if(key==='fill')record.fills.push({style:base.fillStyle,points:current.map(p=>({...p}))});if(key==='fillText')record.texts.push({text:String(args[0]),...point(args[1],args[2])});return value.apply(target,args);};},set(target,key,value){return Reflect.set(target,key,value,target);}});
 return{canvas,ctx,record};
}

check('Real CPU canvas renders circular clipping, player orientation, rotating north, district labels and surface polygons',()=>{
 let draws=0;for(const heading of [0,Math.PI/2,Math.PI,-Math.PI/2,.73]){
  const {canvas,ctx,record}=recordingCanvas(260,260),player={...city.spawn,heading,speed:28},projection=drawRoadMap(ctx,{width:260,height:260,world:city,player,view:{heading:heading+.16},navigation:{target:city.services[1]},police:{phase:'search',searchCenter:player,searchRadius:50},peers:[{...player,x:player.x+15,name:'REMOTE',color:'#81dbeb'}]});
  const arrow=record.fills.findLast(p=>p.style.toLowerCase()==='#f2f0dc');assert.ok(arrow?.points.length===4);const origin=projection.project(player.x,player.z),forward=projection.project(player.x+Math.sin(heading),player.z+Math.cos(heading)),tip=arrow.points[0];near((tip.x-origin.x)/10,(forward.x-origin.x)/projection.scale,1e-5);near((tip.y-origin.y)/10,(forward.y-origin.y)/projection.scale,1e-5);
  const north=record.texts.find(p=>p.text==='N');assert.ok(north);const n=projection.project(player.x,player.z-1);near((north.x-130)/112,(n.x-origin.x)/projection.scale);near((north.y-.5-130)/112,(n.y-origin.y)/projection.scale);
  const pixels=ctx.getImageData(0,0,260,260).data;assert.equal(pixels[3],0);assert.ok(pixels[(130*260+130)*4+3]>0);assert.ok(canvas.width===260);draws++;
 }
 const {ctx,record}=recordingCanvas(1000,650);drawRoadMap(ctx,{width:1000,height:650,world:city,player:{...city.spawn,speed:0},full:true,traffic:[{x:0,z:0,active:true}],cursor:city.spawn});
 for(const district of city.mapDistricts)assert.ok(record.texts.some(p=>p.text===district.name));assert.ok(record.fills.some(p=>p.style==='#385747'&&p.points.length>4));assert.equal(ctx.getImageData(0,0,1,1).data[3],255);report.canvas={engine:'@napi-rs/canvas',renders:draws+1,districtLabels:city.mapDistricts.length};
});

city.dispose();report.status='passed';report.modules=Object.fromEntries(['dist/career.js','dist/navigation-map.js'].map(file=>[file,createHash('sha256').update(fs.readFileSync(new URL('../'+file,import.meta.url))).digest('hex')]));fs.writeFileSync(new URL('./career-navigation-v8-results.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,checks:report.checks.length,routes:report.routes,canvas:report.canvas},null,2));
