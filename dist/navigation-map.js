const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const dist=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
const pointAt=(a,b,t)=>({x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t});
const wrap=a=>Math.atan2(Math.sin(a),Math.cos(a));
export function nearestOnPath(point,points){
 let best=null,travel=0;for(let i=0;i<points.length-1;i++){const a=points[i],b=points[i+1],dx=b.x-a.x,dz=b.z-a.z,length=Math.hypot(dx,dz);if(length<.001)continue;const t=clamp(((point.x-a.x)*dx+(point.z-a.z)*dz)/(length*length),0,1),p=pointAt(a,b,t),distance=dist(point,p);if(!best||distance<best.distance)best={...p,distance,index:i,t,along:travel+t*length,heading:Math.atan2(dx,dz)};travel+=length;}
 return best?{...best,length:travel}:null;
}
const edgePoints=(edge,network)=>edge.points?.length>1?edge.points:[network.nodeById.get(edge.from),network.nodeById.get(edge.to)];

/** Route on the same directed graph used by traffic, including curved segments. */
export function findRoadRoute(world,start,target){
 if(![start?.x,start?.z,target?.x,target?.z].every(Number.isFinite))return{points:[],distance:0,unrouted:true};
 const net=world?.network;if(!net?.edges?.length)return{points:[{x:start.x,z:start.z},{x:target.x,z:target.z}],distance:dist(start,target)};
 const candidates=point=>{const list=net.edges.map(edge=>({edge,path:edgePoints(edge,net),projection:nearestOnPath(point,edgePoints(edge,net))})).filter(v=>v.projection).sort((a,b)=>a.projection.distance-b.projection.distance);return list.filter(v=>v.projection.distance<=list[0].projection.distance+1.5).slice(0,6);};
 const starts=candidates(start),ends=candidates(target);let best=null;
 const adjacency=new Map();for(const edge of net.edges){if(!adjacency.has(edge.from))adjacency.set(edge.from,[]);adjacency.get(edge.from).push(edge);}
 for(const s of starts){
  const costs=new Map([[s.edge.to,s.projection.length-s.projection.along]]),previous=new Map(),open=new Set([s.edge.to]);
  while(open.size){let node=null,value=Infinity;for(const id of open)if(costs.get(id)<value){node=id;value=costs.get(id);}open.delete(node);
   for(const edge of adjacency.get(node)||[]){const length=edge.length||nearestOnPath(net.nodeById.get(edge.from),edgePoints(edge,net))?.length||1,next=value+length;if(next<(costs.get(edge.to)??Infinity)){costs.set(edge.to,next);previous.set(edge.to,edge);open.add(edge.to);}}
  }
  for(const e of ends){
   let middle=[],cost;
   if(s.edge===e.edge&&e.projection.along>=s.projection.along)cost=e.projection.along-s.projection.along;
   else{cost=(costs.get(e.edge.from)??Infinity)+e.projection.along;if(!Number.isFinite(cost))continue;let node=e.edge.from,guard=0;while(node!==s.edge.to&&guard++<net.nodes.length+2){const edge=previous.get(node);if(!edge){cost=Infinity;break;}middle.unshift(edge);node=edge.from;}}
   cost+=s.projection.distance+e.projection.distance;if(!Number.isFinite(cost)||best&&cost>=best.distance)continue;
   let points=[{x:start.x,z:start.z},{x:s.projection.x,z:s.projection.z}];
   if(s.edge===e.edge&&e.projection.along>=s.projection.along){points.push(...s.path.slice(s.projection.index+1,e.projection.index+1));}
   else{points.push(...s.path.slice(s.projection.index+1));for(const edge of middle)points.push(...edgePoints(edge,net).slice(1));points.push(...e.path.slice(0,e.projection.index+1));}
   points.push({x:e.projection.x,z:e.projection.z},{x:target.x,z:target.z});points=points.filter((p,i)=>i===0||dist(p,points[i-1])>.05).map(p=>({x:p.x,z:p.z}));best={points,distance:cost};
  }
 }
 return best||{points:[],distance:dist(start,target),unrouted:true};
}

export class RoadNavigator{
 constructor(){this.world=null;this.target=null;this.route=[];this.distance=0;this.clock=0;this.events=[];this.revision=0;this.arrival=false;}
 setWorld(world){this.world=world;this.clear();}
 setWaypoint(point,name='Waypoint',{snap=true,job=false}={}){
  if(!this.world||![point?.x,point?.z].every(Number.isFinite))return false;
  const p=snap&&this.world.kind==='city'?this.world.getResetPose(point.x,point.z,0):point;
  this.target={x:p.x,z:p.z,name:String(name).slice(0,70),job};this.route=[];this.distance=0;this.clock=0;this.arrival=false;this.events.length=0;this.revision++;return true;
 }
 clear(){this.target=null;this.route=[];this.distance=0;this.clock=0;this.arrival=false;this.events.length=0;this.revision++;}
 update(dt,state){
  if(!this.target||![state?.x,state?.z,dt].every(Number.isFinite))return;
  const distance=dist(state,this.target);if(this.arrival&&!this.target.job&&distance<=25){this.route=[];this.distance=0;return;}
  this.clock-=Math.max(0,dt);const nearest=this.route.length?nearestOnPath(state,this.route):null;
  if(this.clock<=0||!nearest||nearest.distance>18){const route=findRoadRoute(this.world,state,this.target);this.route=route.points;this.distance=route.distance;this.clock=.75;}
  else this.distance=Math.max(0,nearest.length-nearest.along)+nearest.distance;
  if(distance<10&&!this.arrival){this.arrival=true;this.events.push({type:'arrival',target:{...this.target}});if(!this.target.job){this.route=[];this.distance=0;}}else if(distance>25)this.arrival=false;
 }
 getState(){return{target:this.target?{...this.target}:null,points:this.route,distance:this.distance,arrived:this.arrival,revision:this.revision};}
 consumeEvents(){return this.events.splice(0);}
}

export function mapProjection({width,height,world,player,full=false,view={}}){
 const bounds=world.bounds,extent=Math.max(bounds.maxX-bounds.minX,bounds.maxZ-bounds.minZ),zoom=clamp(view.zoom||1,.75,4);
 const scale=full?Math.min(width,height)/(extent+55)*zoom:Math.min(width,height)/(205+Math.min(95,(player.speed||0)*1.4));
 const cx=full?(view.x??(bounds.minX+bounds.maxX)/2):player.x,cz=full?(view.z??(bounds.minZ+bounds.maxZ)/2):player.z,angle=full?0:(view.heading??player.heading)-Math.PI,co=Math.cos(angle),si=Math.sin(angle),ox=width/2,oy=full?height/2:height*.57;
 return{scale,angle,ox,oy,project(x,z){const dx=x-cx,dz=z-cz;return{x:ox+(dx*co-dz*si)*scale,y:oy+(dx*si+dz*co)*scale};},unproject(x,y){const dx=(x-ox)/scale,dy=(y-oy)/scale;return{x:cx+dx*co+dy*si,z:cz-dx*si+dy*co};}};
}

function path(ctx,points,projection,close=false){if(!points?.length)return;ctx.beginPath();for(let i=0;i<points.length;i++){const p=projection.project(points[i].x,points[i].z);i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y);}if(close)ctx.closePath();}
function arrow(ctx,x,y,heading,color,size=8){ctx.save();ctx.translate(x,y);ctx.rotate(heading);ctx.fillStyle=color;ctx.strokeStyle='#122128';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(0,-size);ctx.lineTo(size*.7,size*.75);ctx.lineTo(0,size*.35);ctx.lineTo(-size*.7,size*.75);ctx.closePath();ctx.fill();ctx.stroke();ctx.restore();}
function icon(ctx,x,y,kind,size=10){const colors={garage:'#87d7c0',fuel:'#f3d28c',police:'#8ab8ec',job:'#e2a7ef',waypoint:'#c8a1ff'};ctx.fillStyle=colors[kind]||colors.waypoint;ctx.strokeStyle='#17242c';ctx.lineWidth=2;ctx.beginPath();ctx.arc(x,y,size,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.fillStyle='#14232a';ctx.font='800 '+Math.round(size*1.15)+'px Barlow';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText({garage:'M',fuel:'F',police:'P',job:'J',waypoint:'•'}[kind]||'•',x,y+.5);}

/** Canvas map, independent of DOM and WebGL. North is world -Z. */
export function drawRoadMap(ctx,{width,height,world,player,full=false,view={},navigation={},police={},traffic=[],peers=[],cursor=null}){
 // Keep symbols readable when the round map uses a high-resolution backing canvas.
 if(!full&&width>=384){const ratio=width/256;ctx.save();ctx.scale(ratio,ratio);const projection=drawRoadMap(ctx,{width:256,height:height/ratio,world,player,full,view,navigation,police,traffic,peers,cursor});ctx.restore();return{...projection,scale:projection.scale*ratio,ox:projection.ox*ratio,oy:projection.oy*ratio,project(x,z){const p=projection.project(x,z);return{x:p.x*ratio,y:p.y*ratio};},unproject(x,y){return projection.unproject(x/ratio,y/ratio);}};}
 const projection=mapProjection({width,height,world,player,full,view}),radius=Math.min(width,height)/2-5,center={x:width/2,y:height/2};
 ctx.clearRect(0,0,width,height);ctx.save();if(!full){ctx.beginPath();ctx.arc(center.x,center.y,radius,0,Math.PI*2);ctx.clip();}ctx.fillStyle='#20272d';ctx.fillRect(0,0,width,height);
 for(const surface of world.mapSurfaces||[]){const color={grass:'#2c443c',gravel:'#45463d',water:'#243d51',concrete:'#29343b',asphalt:'#242e34'}[surface.material];if(!color||!surface.points?.length)continue;path(ctx,surface.points,projection,true);ctx.fillStyle=color;ctx.fill();}
 for(const park of(world.landmarks||[]).filter(p=>p.kind==='park')){const p=projection.project(park.x,park.z);if(!world.mapSurfaces?.length){ctx.fillStyle='#385747';ctx.beginPath();ctx.arc(p.x,p.y,36*projection.scale,0,Math.PI*2);ctx.fill();}ctx.fillStyle='#436a77';ctx.fillRect(p.x-4*projection.scale,p.y-4*projection.scale,8*projection.scale,8*projection.scale);}
 for(const b of world.mapBuildings||[]){const p=projection.project(b.x,b.z),w=(b.width||b.hx*2)*projection.scale,d=(b.depth||b.hz*2)*projection.scale;if(p.x+w<0||p.x-w>width||p.y+d<0||p.y-d>height)continue;ctx.save();ctx.translate(p.x,p.y);ctx.rotate(projection.angle-(b.heading||0));ctx.fillStyle=b.height>32?'#48565f':'#35444c';ctx.fillRect(-w/2,-d/2,w,d);ctx.restore();}
 const roads=world.kind==='city'?world.mapRoads:[{points:world.mapPoints,width:24}];ctx.lineCap='round';ctx.lineJoin='round';
 for(const pass of[0,1])for(const road of roads||[]){const points=road.points||[road.a,road.b];if(!points?.[0])continue;path(ctx,points,projection);ctx.strokeStyle=pass?'#8b9a95':'#142026';ctx.lineWidth=Math.max(road.kind==='alley'?1.8:2.5,(road.width||12)*projection.scale)+(pass?0:2.4);ctx.stroke();}
 if(['chase','search'].includes(police.phase)&&police.searchCenter){const p=projection.project(police.searchCenter.x,police.searchCenter.z);ctx.fillStyle=police.phase==='search'?'#e3bf6227':'#ee6e7526';ctx.strokeStyle=police.phase==='search'?'#e4bf7599':'#ef818a99';ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(p.x,p.y,(police.searchRadius||100)*projection.scale,0,Math.PI*2);ctx.fill();ctx.stroke();}
 if(navigation.points?.length>1){path(ctx,navigation.points,projection);ctx.lineWidth=full?12:8;ctx.strokeStyle='#122438';ctx.stroke();ctx.lineWidth=full?6.5:4.5;ctx.strokeStyle='#97bfff';ctx.stroke();}
 if(full){ctx.font='800 15px Barlow';ctx.fillStyle='#e0e6dca8';ctx.textAlign='center';ctx.textBaseline='middle';const labels=world.mapDistricts||[];for(const d of labels){const p=projection.project(d.x,d.z);ctx.fillText(d.name,p.x,p.y);}}
 for(const npc of traffic){if(npc.active===false)continue;const p=projection.project(npc.x,npc.z);ctx.fillStyle='#3a565e';ctx.fillRect(p.x-1.5,p.y-1.5,3,3);}
 for(const officer of police.officers||[]){if(officer.active===false)continue;const p=projection.project(officer.x,officer.z);arrow(ctx,p.x,p.y,Math.PI-(officer.heading||0)+projection.angle,officer.siren?'#f493a1':'#82b6ea',full?4:5);}
 for(const camera of world.speedCameras||[]){const p=projection.project(camera.x,camera.z);ctx.strokeStyle='#e8c28c';ctx.lineWidth=1.5;ctx.strokeRect(p.x-2.5,p.y-2.5,5,4);ctx.beginPath();ctx.moveTo(p.x,p.y+2);ctx.lineTo(p.x,p.y+5);ctx.stroke();}
 const clipPoint=p=>{if(full)return p;const dx=p.x-center.x,dy=p.y-center.y,l=Math.hypot(dx,dy),r=radius-15;return l>r?{x:center.x+dx/l*r,y:center.y+dy/l*r}:p;};
 for(const service of world.services||[]){if(!full&&dist(service,player)>310)continue;const p=clipPoint(projection.project(service.x,service.z));if(full&&cursor&&Math.min(dist(cursor,service),dist(cursor,service.spawn||service))<Math.max(12,26/projection.scale)){ctx.strokeStyle='#e5f4b4';ctx.lineWidth=2;ctx.beginPath();ctx.arc(p.x,p.y,19,0,Math.PI*2);ctx.stroke();}icon(ctx,p.x,p.y,service.kind,full?12:8);if(full&&(view.zoom||1)>1.3){ctx.font='600 11px Barlow';ctx.textAlign='left';ctx.fillStyle='#e3e6dc';ctx.fillText(service.name,p.x+18,p.y);}}
 if(navigation.target){const target=navigation.target,p=clipPoint(projection.project(target.x,target.z));icon(ctx,p.x,p.y,target.job?'job':'waypoint',full?14:9);}
 for(const peer of peers){if(peer.active===false)continue;const p=projection.project(peer.x,peer.z);arrow(ctx,p.x,p.y,Math.PI-peer.heading+projection.angle,peer.color||'#81dbeb',full?6:7);if(full){ctx.font='700 11px Barlow';ctx.fillStyle='#d8f1ee';ctx.textAlign='left';ctx.fillText(peer.name||'DRIVER',p.x+10,p.y);}}
 const playerPoint=projection.project(player.x,player.z);arrow(ctx,playerPoint.x,playerPoint.y,Math.PI-player.heading+projection.angle,'#d9f57b',full?11:10);
 if(full&&cursor){const p=projection.project(cursor.x,cursor.z);ctx.strokeStyle='#0c1724';ctx.lineWidth=6;ctx.beginPath();ctx.arc(p.x,p.y,19,0,Math.PI*2);ctx.stroke();ctx.strokeStyle='#f4f2df';ctx.lineWidth=2.5;ctx.beginPath();ctx.arc(p.x,p.y,19,0,Math.PI*2);ctx.stroke();ctx.strokeStyle='#d9f57b';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(p.x-29,p.y);ctx.lineTo(p.x-12,p.y);ctx.moveTo(p.x+12,p.y);ctx.lineTo(p.x+29,p.y);ctx.moveTo(p.x,p.y-29);ctx.lineTo(p.x,p.y-12);ctx.moveTo(p.x,p.y+12);ctx.lineTo(p.x,p.y+29);ctx.stroke();ctx.fillStyle='#f4f2df';ctx.beginPath();ctx.arc(p.x,p.y,2.5,0,Math.PI*2);ctx.fill();}
 ctx.restore();
 if(!full){ctx.strokeStyle='#d1e0d580';ctx.lineWidth=2;ctx.beginPath();ctx.arc(center.x,center.y,radius,0,Math.PI*2);ctx.stroke();const dx=Math.sin(projection.angle),dy=-Math.cos(projection.angle),x=center.x+dx*(radius-13),y=center.y+dy*(radius-13);ctx.fillStyle='#13252d';ctx.beginPath();ctx.arc(x,y,10,0,Math.PI*2);ctx.fill();ctx.fillStyle='#e9e9d8';ctx.font='800 12px Barlow';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('N',x,y+.5);}
 return projection;
}

export class MapView{
 constructor(){this.zoom=1;this.x=null;this.z=null;this.heading=0;this.cursor=null;}
 reset(world,player){this.zoom=1;this.x=(world.bounds.minX+world.bounds.maxX)/2;this.z=(world.bounds.minZ+world.bounds.maxZ)/2;this.cursor={x:player.x,z:player.z};this.heading=player.heading;}
 updateHeading(heading,dt){this.heading+=wrap(heading-this.heading)*(1-Math.exp(-10*dt));}
 moveCursor(dx,dz,world){const step=18/this.zoom*Math.max(1,(world.bounds.maxX-world.bounds.minX)/1000);this.cursor=this.cursor||{x:this.x||0,z:this.z||0};this.cursor.x=clamp(this.cursor.x+dx*step,world.bounds.minX+8,world.bounds.maxX-8);this.cursor.z=clamp(this.cursor.z+dz*step,world.bounds.minZ+8,world.bounds.maxZ-8);}
 changeZoom(amount){this.zoom=clamp(this.zoom*amount,.75,4);}
}
