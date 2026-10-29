import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {GameUI,mapSelection} from '../dist/game-ui.js';
import {MapView,mapProjection,drawRoadMap} from '../dist/navigation-map.js';
import {parseHTML,installDOM} from './dom-v5-harness.mjs';

const checks=[];
const check=(name,fn)=>{fn();checks.push(name);console.log('PASS '+name);};
const places=[{kind:'garage',name:'Corner Works',x:100,z:50,spawn:{x:108,z:58}},{kind:'fuel',name:'Dock Fuel',x:-80,z:-40},{kind:'police',name:'Central Station',x:60,z:-120}];
const player={x:0,z:0,heading:0,speed:0};
check('Cursor selection finds the visible service and its drivable entrance without altering the active route',()=>{
 const route={target:{x:-80,z:-40,name:'Dock Fuel'},distance:170,arrived:false},before=JSON.stringify(route);
 const selected=mapSelection({places,cursor:{x:100,z:50},player,route});
 assert.equal(selected.kind,'garage');assert.equal(selected.name,'Corner Works');assert.deepEqual(selected.point,places[0].spawn);assert.equal(selected.routed,false);assert.equal(JSON.stringify(route),before);
 assert.equal(mapSelection({places,cursor:places[0].spawn,player,route}).name,'Corner Works');
});
check('Route details use road distance only at the actual target; an unrelated cursor uses straight-line distance',()=>{
 const route={target:{x:-80,z:-40,name:'Dock Fuel'},distance:170,arrived:false};
 const selected=mapSelection({places,cursor:{x:-80,z:-40},player,route});assert.equal(selected.routed,true);assert.equal(selected.distance,170);
 const empty=mapSelection({places,cursor:{x:300,z:400},player,route});assert.equal(empty.kind,'waypoint');assert.equal(empty.routed,false);assert.equal(empty.distance,500);
 const job=mapSelection({places:[],cursor:{x:500,z:500},player,route:{target:{x:500,z:500,job:true,name:'Delivery'},distance:0,arrived:true}});assert.equal(job.kind,'job');assert.equal(job.arrived,true);
 assert.equal(mapSelection({places,cursor:{x:NaN,z:0},player}),null);
});
const {doc}=parseHTML(fs.readFileSync(new URL('../dist/index.html',import.meta.url),'utf8'));installDOM(doc);const ui=new GameUI(doc);let chosen=null,inspected=null,marked=null;
const callbacks={onChoose:p=>chosen=p,onInspect:p=>inspected=p,onMark:(p,n)=>marked={point:p,name:n}};
ui.map.setPlaces(places,callbacks);
check('The map layout keeps the original canvas and route controls while adding service details and navigation groups',()=>{
 assert.ok(doc.getElementById('map-modal').classList.contains('map-v12'));assert.equal(doc.querySelectorAll('.map-layout').length,1);assert.equal(doc.getElementById('full-map').parentNode.className,'full-map-wrap');
 assert.ok(doc.getElementById('map-clear-route'));assert.equal(doc.getElementById('map-poi-list').dataset.navGroup,'map-places');assert.equal(doc.getElementById('map-poi-list').children.length,3);
});
check('Filters hide unavailable focus targets and service selection calls the existing game handlers',()=>{
 ui.map.setFilter('garage');const buttons=doc.getElementById('map-poi-list').children;
 assert.equal(buttons[0].hidden,false);assert.equal(buttons[1].hidden,true);assert.ok(buttons[1].classList.contains('hidden'));
 buttons[0].emit('focus');assert.equal(inspected,places[0]);buttons[0].click();assert.equal(chosen,places[0]);
 ui.map.setPlaces(places,callbacks);assert.equal(doc.getElementById('map-poi-list').children.length,3);assert.equal(ui.map.filter,'garage');assert.equal(doc.getElementById('map-poi-list').children[1].hidden,true);
 ui.map.setFilter('all');assert.ok(doc.getElementById('map-poi-list').children.every(b=>!b.hidden));
});
check('Detail cards display accurate pending and active route states and preserve the waypoint callback',()=>{
 ui.map.render({world:{kind:'city'},player,cursor:places[0],route:{},zoom:2});assert.equal(ui.map.nodes.name.textContent,'Corner Works');assert.equal(ui.map.nodes.distanceLabel.textContent,'STRAIGHT LINE');assert.equal(ui.map.nodes.mark.disabled,false);
 ui.map.nodes.mark.click();assert.deepEqual(marked,{point:places[0].spawn,name:'Corner Works'});
 ui.map.render({world:{kind:'city'},player,cursor:places[0].spawn,route:{target:{...places[0].spawn,name:places[0].name},distance:230,arrived:false}});assert.equal(ui.map.nodes.distance.textContent,'230 M');assert.equal(ui.map.nodes.distanceLabel.textContent,'BY ROAD');assert.equal(ui.map.nodes.mark.disabled,true);
 assert.equal(ui.map.nodes.list.children[0].getAttribute('aria-current'),'location');
});

const require=createRequire((process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES||process.cwd()+'/node_modules')+'/package.json');
const {createCanvas}=require('@napi-rs/canvas');
check('The canvas draws a continuous route, outlined cursor and service symbols at projected world coordinates',()=>{
 const world={kind:'city',bounds:{minX:-500,maxX:500,minZ:-350,maxZ:350},mapRoads:[{points:[{x:-400,z:0},{x:400,z:0}],width:12}],services:places},canvas=createCanvas(1000,650),base=canvas.getContext('2d'),record=[];
 const ctx=new Proxy(base,{get(target,key){const value=Reflect.get(target,key,target);if(typeof value!=='function')return value;return(...args)=>{if(key==='stroke')record.push({type:'stroke',color:target.strokeStyle,width:target.lineWidth});if(key==='arc')record.push({type:'arc',args});for(const v of args)if(typeof v==='number')assert.ok(Number.isFinite(v));return value.apply(target,args);};},set(target,key,value){return Reflect.set(target,key,value,target);}});
 const cursor={x:160,z:80},route={points:[{x:0,z:0},{x:108,z:0},{x:108,z:58}],target:places[0].spawn};
 const projection=drawRoadMap(ctx,{width:1000,height:650,world,player,full:true,navigation:route,cursor});
 const point=projection.project(cursor.x,cursor.z);assert.ok(record.some(r=>r.type==='arc'&&Math.abs(r.args[0]-point.x)<.01&&Math.abs(r.args[1]-point.y)<.01&&r.args[2]===19));
 assert.ok(record.some(r=>r.type==='stroke'&&r.width===6.5&&r.color.toLowerCase()==='#97bfff'));assert.equal(ctx.getImageData(0,0,1,1).data[3],255);
 const mini=createCanvas(256,256),miniCtx=mini.getContext('2d');drawRoadMap(miniCtx,{width:256,height:256,world,player,navigation:route});assert.equal(miniCtx.getImageData(0,0,1,1).data[3],0);
 const view=new MapView();view.reset(world,player);view.changeZoom(2);view.moveCursor(1,-1,world);const p=mapProjection({width:1000,height:650,world,player,full:true,view}),screen=p.project(view.cursor.x,view.cursor.z),roundTrip=p.unproject(screen.x,screen.y);assert.ok(Math.hypot(roundTrip.x-view.cursor.x,roundTrip.z-view.cursor.z)<1e-8);
});
const report={version:12,status:'passed',checks,limits:['DOM events and CPU canvas checked. Browser layout and physical gamepad use require the integrated build.']};fs.writeFileSync(new URL('./map-v12-results.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,checks:checks.length}));
