import {resolveVehicleContacts} from './contact.js';
import {captureAgent,validAgent,applyAgent} from './agent-snapshot.js';
import {createRoadGuide,createAgent,createAgentRenderer,setAgentPose,syncAgent,integrateAgent,agentBuild} from './traffic.js';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,Number.isFinite(v)?v:a));
const wrap=a=>Math.atan2(Math.sin(a),Math.cos(a));
const RADIO_LINES={
 pursuit:['Vehicle failing to stop. Starting pursuit.','Driver is not stopping. Requesting nearby units.','We have a fleeing vehicle. Stay on this channel.'],
 spotted:['Visual regained. Continuing pursuit.','There is the vehicle. Units, follow our position.','We have the suspect again. Back in pursuit.'],
 search:['Visual lost. Cover the last known roads.','Lost the vehicle. Check the next junctions.','No visual. Spread out and search the area.'],
 escaped:['No vehicle located. Return to patrol.','Search complete. All units stand down.','Negative contact. Clearing the search area.'],
 backup:['Requesting backup. Cover the roads ahead.','Additional units needed. Take the next junction.','Bring another unit in. Keep the exits covered.'],
 arrest:['Vehicle stopped. Driver in custody.','Suspect detained. The scene is secure.','We have the driver. End the pursuit.'],
 nightShift:['Night shift reporting. Additional units are on patrol.','Evening patrols, check in and cover your district.','Night units are leaving the precinct.'],
 intercept:['Backup taking the next junction.','Second unit is moving ahead to intercept.','Cover unit taking the road ahead.'],
 sector:['Checking the next search sector.','Searching the side roads. No visual yet.','Unit moving through the last known area.'],
 clear:['Sector clear. Moving to the next road.','Nothing on this block. Continuing the search.','No contact here. Checking the adjacent street.'],
 blocked:['Our route is blocked. Repositioning.','Obstruction ahead. Finding another approach.','Unit held up. Other units continue.'],
 collision:['Pursuit unit has made contact. Still moving.','Vehicle contact. Keep the next lane clear.','Minor collision. Continuing after the suspect.']
};

/** Physical patrols share observations, not the hidden player's live position.
 * Spare cars are parked at the station and drive out when the shift changes. */
export function createPolice(scene,city,traffic,{count=3,dayCount=count,nightCount=count}={}){
 const guide=createRoadGuide(city),nodes=city.network.nodeById,total=clamp(Math.round(count),0,6),dayPopulation=clamp(Math.round(dayCount),0,total),nightPopulation=clamp(Math.round(nightCount),dayPopulation,total);
 const states=Array.from({length:total},(_,i)=>createAgent('police-'+i,i,0,'police')),renderer=createAgentRenderer(city.root,states,{prefix:'police',police:true}),station=city.services.find(s=>s.kind==='police'),events=[],radioTimes=new Map(),radioVariants=new Map(),searchedNodes=new Map();
 const precinct=station||{x:-90,z:-45,spawn:{x:-90,z:-42,heading:0}},mergeRoad=city.network.edges.find(e=>e.from===39&&e.to===40)||city.network.edges[0];
 const base=station?.base?{x:station.base.x,z:station.base.z+45}:null,stationPoint=(x,z)=>base&&city.shape?city.shape.map(base.x+x,base.z+z):{x:precinct.x+x,z:precinct.z+z};
 const mergePath=guide.leg(mergeRoad.from,mergeRoad.to),mergeAim=stationPoint(32,40),mergeDistance=guide.project(mergePath,mergeAim.x,mergeAim.z),mergePose=guide.sample(mergePath,mergeDistance);
 let radioAvailableAt=0,urgentRadioAt=0,leadId=null,assignmentClock=0,searchPlan=[];
 let phase='patrol',heat=0,time=0,lostTime=0,searchTime=0,arrestTime=0,escapedTime=0,suspicion=0,escalation=0,searchCenter={x:0,z:0},observedVelocity={x:0,z:0},searchRadius=0,disposed=false,forcedOffense=null,night=0,nightShift=false,deploymentClock=0,investigation=null,radioClock=0,lastDispatch=null,lastPlayer=null,targetId=null,replica=false,snapshotAge=.1,custodyTime=0;const releaseGrace=new Map();
 const stats={pursuits:0,escapes:0,arrests:0,contacts:0,detectedSpeeding:0,detectedCrashes:0,deployments:0,returns:0,radioCalls:0,cameraReports:0,recoveries:0,sectorsChecked:0,interceptsAssigned:0,blockedRoutes:0};
 function lineOfSight(a,b){
  const dx=b.x-a.x,dz=b.z-a.z,range=Math.hypot(dx,dz),mid={x:(a.x+b.x)*.5,z:(a.z+b.z)*.5};
  for(const box of city.getColliders(mid,range*.5+2)){
   if(!['building','container','tank','boundary'].includes(box.kind))continue;
   const sn=Math.sin(box.heading||0),cs=Math.cos(box.heading||0),ox=(a.x-box.x)*cs-(a.z-box.z)*sn,oz=(a.x-box.x)*sn+(a.z-box.z)*cs,vx=dx*cs-dz*sn,vz=dx*sn+dz*cs;let lo=0,hi=1;
   for(const[o,v,h]of[[ox,vx,box.hx],[oz,vz,box.hz]]){if(Math.abs(v)<1e-9){if(Math.abs(o)>h){hi=-1;break;}}else{let t0=(-h-o)/v,t1=(h-o)/v;if(t0>t1)[t0,t1]=[t1,t0];lo=Math.max(lo,t0);hi=Math.min(hi,t1);}}
   if(lo<=hi&&hi>.02&&lo<.98)return false;
  }return true;
 }
 function sees(car,player,range=125,cone=false){if(car.active===false)return false;const dx=player.x-car.x,dz=player.z-car.z,d=Math.hypot(dx,dz);if(d>range)return false;if(cone&&d>30&&dx*Math.sin(car.heading)+dz*Math.cos(car.heading)<d*-.10)return false;return lineOfSight(car,player);}
 function emit(type,extra={}){events.push({type,phase,heat,targetId,...extra});if(events.length>32)events.shift();}
 function radio(code,message,extra={}){
  const priority=extra.priority??1;if(time<(radioTimes.get(code)||0)||time<(priority>=2?urgentRadioAt:radioAvailableAt))return;
  const interval={location:10,intercept:12,sector:7,clear:7,blocked:18,collision:9,nightShift:30}[code]??2;
  radioTimes.set(code,time+interval);radioAvailableAt=time+2.6;urgentRadioAt=time+.9;
  if(RADIO_LINES[code]){const index=radioVariants.get(code)||0;message=RADIO_LINES[code][index%RADIO_LINES[code].length];radioVariants.set(code,index+1);if(extra.district&&['pursuit','spotted','search'].includes(code))message+=' '+extra.district+'.';}
  lastDispatch={code,message,text:message,time,...extra};stats.radioCalls++;emit('radio',{...lastDispatch,priority});
 }
 function searchDuration(){return 18+Math.max(0,heat-1)*6+(nightShift?4:0);}
 function prepareSearch(){
  searchedNodes.clear();const velocity=Math.hypot(observedVelocity.x,observedVelocity.z),ux=velocity>1?observedVelocity.x/velocity:0,uz=velocity>1?observedVelocity.z/velocity:1;
  searchPlan=city.network.nodes.filter(n=>Math.hypot(n.x-searchCenter.x,n.z-searchCenter.z)<=230+heat*35).map(n=>{const dx=n.x-searchCenter.x,dz=n.z-searchCenter.z;return{id:n.id,x:n.x,z:n.z,distance:Math.hypot(dx,dz),ahead:dx*ux+dz*uz};}).sort((a,b)=>(a.distance-a.ahead*.5)-(b.distance-b.ahead*.5));
  for(const car of states)car.searchTarget=null;
 }
 function searchGoal(car){
  const current=nodes.get(car.searchTarget);
  if(current&&Math.hypot(current.x-car.x,current.z-car.z)<15){
   if(!searchedNodes.has(current.id)){searchedNodes.set(current.id,time);stats.sectorsChecked++;radio('clear','Sector clear.',{unit:car.id,priority:0});}
   car.searchTarget=null;
  }
  if(car.searchTarget===null||car.searchTarget===undefined){
   const occupied=new Set(states.filter(c=>c!==car&&c.active).map(c=>c.searchTarget)),options=searchPlan.filter(n=>!occupied.has(n.id)&&!searchedNodes.has(n.id));
   const pool=options.length?options:searchPlan.filter(n=>!occupied.has(n.id));
   const goal=pool.sort((a,b)=>Math.hypot(a.x-car.x,a.z-car.z)+a.distance*.25-a.ahead*.18-(Math.hypot(b.x-car.x,b.z-car.z)+b.distance*.25-b.ahead*.18))[0];
   if(goal){car.searchTarget=goal.id;car.routeTimer=0;radio('sector','Checking search sector.',{unit:car.id,priority:0});}
  }
  return nodes.get(car.searchTarget)||nodes.get(guide.nearestNode(searchCenter.x,searchCenter.z));
 }
 function curveSpeed(car,speed,pursuing,canEnter){
  if(!pursuing)return speed;let previous=guide.lookAhead(car,0,canEnter),limit=speed;
  for(let distance=6;distance<=Math.max(60,car.speed*2.6);distance+=6){const point=guide.lookAhead(car,distance,canEnter),bend=Math.abs(wrap(point.heading-previous.heading))/6,corner=Math.sqrt(8.4/Math.max(.0005,bend));limit=Math.min(limit,Math.sqrt(corner*corner+2*7.1*Math.max(0,distance-7)));previous=point;}
  return limit;
 }
 function observe(player){searchCenter={x:player.x,z:player.z};observedVelocity={x:player.vx||0,z:player.vz||0};lostTime=0;}
 function pursuit(player,reason){targetId=String(player.playerId??player.id??'local').slice(0,80);const first=phase==='patrol'||phase==='escaped';phase='chase';heat=Math.max(1,heat);lostTime=searchTime=arrestTime=escapedTime=0;observe(player);searchRadius=0;suspicion=0;investigation=null;radioClock=0;searchPlan=[];searchedNodes.clear();leadId=null;assignmentClock=0;for(const car of states){car.searchTarget=null;car.interceptTarget=null;}if(first){stats.pursuits++;emit('pursuit',{reason});radio('pursuit','Dispatch, vehicle failing to stop. Units respond.',{priority:2,district:city.getDistrict(player.x,player.z)});}else{emit('pursuit',{reason,resumed:true});radio('spotted','Visual regained. Continue pursuit.',{priority:2,district:city.getDistrict(player.x,player.z)});}}
 function assignRoad(car,edge,distance=0,speed=0,resetPose=true){if(traffic?.reservations.get(car.path?.nodeId)===car.id)traffic.reservations.delete(car.path.nodeId);car.fromId=edge.from;car.toId=edge.to;car.path=guide.leg(edge.from,edge.to);car.distance=clamp(distance,0,car.path.length);car.nextId=guide.nextNode(car);if(resetPose)setAgentPose(car,guide.sample(car.path,car.distance),speed,city);}
 function nearestRoad(car){let choice=null,best=Infinity;for(const edge of city.network.edges){const path=guide.leg(edge.from,edge.to),distance=guide.project(path,car.x,car.z),p=guide.sample(path,distance),error=Math.abs(wrap(p.heading-car.heading)),score=Math.hypot(p.x-car.x,p.z-car.z)+error*4;if(score<best){best=score;choice={edge,distance};}}if(choice)assignRoad(car,choice.edge,choice.distance,car.speed,false);}
 function parkingPose(index){const dx=-24+(index-dayPopulation)*9;return{...stationPoint(dx,-14),heading:base&&city.shape?city.shape.heading(base.x+dx,base.z-14,0):0,dx};}
 function reset(){
  replica=false;snapshotAge=.1;targetId=null;custodyTime=0;releaseGrace.clear();phase='patrol';heat=0;time=lostTime=searchTime=arrestTime=escapedTime=suspicion=escalation=radioClock=0;searchCenter={x:city.spawn.x,z:city.spawn.z};observedVelocity={x:0,z:0};searchRadius=0;forcedOffense=null;investigation=null;deploymentClock=1;nightShift=false;lastDispatch=null;lastPlayer=null;events.length=0;radioTimes.clear();radioVariants.clear();searchedNodes.clear();searchPlan=[];radioAvailableAt=urgentRadioAt=assignmentClock=0;leadId=null;for(const key of Object.keys(stats))stats[key]=0;
  const routeIds=[[31,40],[37,38],[24,25],[55,56],[61,70],[12,21]];
  states.forEach((car,i)=>{car.seed=87313+i*991;car.hitHold=car.horn=car.hornCooldown=car.wheelSpin=car.previousWheelSpin=car.entries=car.turns=0;car.siren=false;car.sirenPhase=i/3;car.routeTimer=0;car.blockedTime=car.recoveryTimer=0;car.swerve=0;car.visible=true;car.active=i<dayPopulation;car.duty=car.active?'patrol':'reserve';car.role=car.active?'patrol':'reserve';car.waypoints=null;car.park=parkingPose(i);car.patrolGoal=null;car.searchTarget=null;car.interceptTarget=null;
   const route=routeIds[i%routeIds.length],edge=city.network.edges.find(e=>e.from===route[0]&&e.to===route[1])||mergeRoad;assignRoad(car,edge,30+(i%3)*19,car.active?8:0);if(!car.active)setAgentPose(car,car.park,0,city);
  });renderer.render(1,time);
 }
 function targetCount(){return Math.min(total,Math.max(nightShift?nightPopulation:dayPopulation,['chase','search'].includes(phase)?dayPopulation+heat-1:0));}
 function deploy(car){car.active=true;car.duty='deploying';car.role='joining';car.waypointIndex=0;car.waypoints=[stationPoint(car.park.dx,14),stationPoint(-10,35),guide.sample(mergePath,Math.max(1,mergeDistance-12)),{x:mergePose.x,z:mergePose.z}];stats.deployments++;}
 function followStation(car,dt,player,players=[]){
  if(car.duty==='reserve'){if(car.speed>.01||Math.abs(car.yawRate)>.01)integrateAgent(car,{x:car.x+Math.sin(car.heading)*4,z:car.z+Math.cos(car.heading)*4,speed:0},dt,city);else{car.previousX=car.x;car.previousZ=car.z;car.previousHeading=car.heading;car.previousY=car.y;car.previousWheelSpin=car.wheelSpin;car.brake=true;}syncAgent(car);return;}
  const point=car.waypoints[car.waypointIndex],distance=Math.hypot(point.x-car.x,point.z-car.z),last=car.waypointIndex===car.waypoints.length-1;
  if(distance<(last?3.3:4.5)&&(!last||car.duty==='deploying')){if(last){car.duty='patrol';car.role='patrol';car.waypoints=null;assignRoad(car,mergeRoad,guide.project(mergePath,car.x,car.z),car.speed,false);return;}car.waypointIndex++;}
  const aim=car.waypoints[car.waypointIndex];let speed=car.duty==='parking'&&last?Math.min(3.2,distance*.75):4.6;
  for(const other of[...(traffic?.states||[]),...states,player,...players]){if(!other||other===car)continue;const dx=other.x-car.x,dz=other.z-car.z,along=dx*Math.sin(car.heading)+dz*Math.cos(car.heading),side=dx*Math.cos(car.heading)-dz*Math.sin(car.heading);if(along>0&&along<9&&Math.abs(side)<2.1)speed=Math.min(speed,Math.max(0,(along-5)*.8));}
  integrateAgent(car,{...aim,speed},dt,city,{acceleration:1.8,deceleration:5});resolveVehicleContacts(car,city.getColliders(car,7),agentBuild(car),{dt,previousPosition:{x:car.previousX,z:car.previousZ,heading:car.previousHeading},restitution:.06,friction:.3});syncAgent(car);
  if(car.duty==='parking'&&last&&distance<1.6&&car.speed<.8){car.active=false;car.duty=car.role='reserve';car.waypoints=null;stats.returns++;}
 }
 function chooseNext(car,goal){if(car.duty==='return'&&car.toId===mergeRoad.from)return mergeRoad.to;return guide.nextNode(car,goal?guide.nearestNode(goal.x,goal.z):null);}
 function update(dt,player,context={}){
  dt=clamp(Number.isFinite(dt)?dt:0,0,.04);if(!dt||disposed||replica||!player||![player.x,player.z].every(Number.isFinite))return;if(dt>1/120+.000001){const n=Math.ceil(dt*120);for(let i=0;i<n;i++)update(dt/n,player,i===0?context:{night:context.night,players:context.players});return;}time+=dt;const localPlayer=player,candidates=[player,...(context.players||[])].filter(p=>p&&[p.x,p.z].every(Number.isFinite)&&p.active!==false),key=p=>String(p.playerId??p.id??'local'),hasTarget=candidates.some(p=>key(p)===targetId);
  if(['chase','search','arrested'].includes(phase)&&targetId){player=candidates.find(p=>key(p)===targetId)||{x:searchCenter.x,z:searchCenter.z,vx:0,vz:0,speed:0,playerId:targetId};}
  else{const visible=candidates.filter(p=>(releaseGrace.get(key(p))||0)<=time&&states.some(c=>sees(c,p,105,true)));const suspect=visible.find(p=>forcedOffense&&key(p)===(forcedOffense.playerId??key(localPlayer)))||visible.find(p=>(context.contacts||[]).some(c=>c.playerId===key(p)&&(c.closingSpeed??c.relativeSpeed??0)>5))||visible.find(p=>investigation?.playerId&&key(p)===investigation.playerId)||visible.filter(p=>(p.speed||Math.hypot(p.vx||0,p.vz||0))>27||Math.abs(p.driftAngle||0)>.38&&(p.speed||0)>13||p.burnoutIntensity>.6).sort((a,b)=>(b.speed||0)-(a.speed||0))[0];if(suspect)player=suspect;}
  const targetPresent=!['chase','search','arrested'].includes(phase)||hasTarget;lastPlayer={x:player.x,z:player.z};if(Number.isFinite(context.night))night=clamp(context.night,0,1);
  if(!nightShift&&night>.62){nightShift=true;radio('nightShift','Night shift. Additional patrols leaving the precinct.',{priority:0});}else if(nightShift&&night<.35)nightShift=false;
  deploymentClock-=dt;const target=targetCount(),active=states.filter(c=>c.active!==false);
  if(deploymentClock<=0&&active.length<target){const car=states.find(c=>!c.active&&Math.hypot(c.x-player.x,c.z-player.z)>6&&!states.some(o=>o!==c&&o.active&&Math.hypot(o.x-c.x,o.z-c.z)<7));if(car){deploy(car);deploymentClock=3.4;}else deploymentClock=1;}
  if(!['chase','search','arrested'].includes(phase)){for(const c of active.filter(c=>c.index>=target&&c.duty==='patrol')){c.duty='return';c.role='returning';c.routeTimer=0;}}else for(const c of active)if(c.duty==='return'){c.duty='patrol';c.routeTimer=0;}
  if(investigation&&time>investigation.until)investigation=null;
  const speed=Number.isFinite(player.speed)?player.speed:Math.hypot(player.vx||0,player.vz||0),seen=targetPresent&&states.some(c=>sees(c,player,phase==='patrol'?105:145,phase==='patrol'));
  const crash=(context.contacts||[]).find(c=>(c.playerId?String(c.playerId)===key(player):key(player)===key(localPlayer))&&(c.closingSpeed??c.relativeSpeed??0)>5&&c.collider?.kind!=='boundary');
  if(phase==='patrol'||phase==='escaped'){
   const reason=(forcedOffense&&key(player)===(forcedOffense.playerId??key(localPlayer))?forcedOffense.reason:null)??(crash?'Collision':investigation&&seen&&(!investigation.playerId||investigation.playerId===key(player))?'Speed camera report':speed>27?'Speeding':(Math.abs(player.driftAngle||0)>.38&&speed>13||player.burnoutIntensity>.6)?'Dangerous driving':null);
   if(seen&&reason&&(releaseGrace.get(key(player))||0)<=time){suspicion+=dt*(crash||forcedOffense||investigation?12:speed>42?2.2:1);if(crash||forcedOffense)suspicion=Math.max(suspicion,1.25);if(suspicion>1.1){if(reason==='Speeding')stats.detectedSpeeding++;if(reason==='Collision')stats.detectedCrashes++;pursuit(player,reason);}}
   else suspicion=Math.max(0,suspicion-dt*.65);
  }
  forcedOffense=null;
  if(phase==='chase'||phase==='search'){
   if(seen){observe(player);if(phase==='search')pursuit(player,'Vehicle spotted');}else lostTime+=dt;
   if(phase==='chase'&&lostTime>4.5){phase='search';searchTime=0;radioClock=0;searchRadius=190+Math.max(0,heat-1)*30;arrestTime=0;prepareSearch();emit('search',{center:{...searchCenter},radius:searchRadius});radio('search','Visual lost. Search the last known area.',{priority:1,district:city.getDistrict(searchCenter.x,searchCenter.z)});}
   if(phase==='search'){searchTime+=dt;radioClock+=dt;if(radioClock>7){radioClock=0;radio('sector','Checking search sector.',{priority:0,district:city.getDistrict(searchCenter.x,searchCenter.z)});}searchRadius=Math.max(85,190+Math.max(0,heat-1)*30-searchTime*3.5);if(searchTime>searchDuration()){phase='escaped';heat=0;escapedTime=0;searchRadius=0;stats.escapes++;emit('escaped');radio('escaped','No visual. Stand down and return to patrol.',{priority:1});}}
   if(phase==='chase'){
    if(seen&&(speed>43||crash))escalation+=dt;else escalation=Math.max(0,escalation-dt*.2);if(escalation>9&&heat<3){heat++;escalation=0;emit('heat',{heat});radio('backup','Requesting backup. Set up on the next junction.',{priority:2});}
    const nearby=targetPresent&&states.some(c=>c.active&&Math.hypot(c.x-player.x,c.z-player.z)<9&&c.speed<4&&sees(c,player,12));arrestTime=speed<1.3&&nearby?Math.min(3,arrestTime+dt):Math.max(0,arrestTime-dt*1.8);
    if(arrestTime>=3){phase='arrested';custodyTime=0;stats.arrests++;emit('arrest',{station:{...(station?.spawn??city.spawn)},serviceId:station?.id});radio('arrest','Vehicle stopped. Driver in custody.',{priority:2});}
    radioClock+=dt;if(radioClock>12&&seen&&phase==='chase'){radioClock=0;const direction=Math.abs(observedVelocity.x)>Math.abs(observedVelocity.z)?(observedVelocity.x>0?'eastbound':'westbound'):(observedVelocity.z>0?'southbound':'northbound');radio('location',`Suspect ${direction} in ${city.getDistrict(searchCenter.x,searchCenter.z)}.`,{district:city.getDistrict(searchCenter.x,searchCenter.z),priority:0});}
   }
  }
  if(phase==='arrested'){custodyTime+=dt;if(custodyTime>=3){if(targetId)releaseGrace.set(targetId,time+10);phase='patrol';heat=0;arrestTime=lostTime=searchTime=0;searchRadius=0;targetId=null;custodyTime=0;for(const c of states)c.routeTimer=0;}}
  if(phase==='escaped'){escapedTime+=dt;if(escapedTime>4){phase='patrol';targetId=null;}}
  for(const[id,until]of releaseGrace)if(until<time)releaseGrace.delete(id);
  const ranked=states.filter(c=>c.active&&c.duty!=='deploying'&&c.duty!=='parking').sort((a,b)=>Math.hypot(a.x-searchCenter.x,a.z-searchCenter.z)-Math.hypot(b.x-searchCenter.x,b.z-searchCenter.z));
  assignmentClock-=dt;if(assignmentClock<=0){const current=ranked.find(c=>c.id===leadId),best=ranked[0];if(!current||current.blockedTime>2||best&&Math.hypot(current.x-searchCenter.x,current.z-searchCenter.z)>Math.hypot(best.x-searchCenter.x,best.z-searchCenter.z)*1.25+15)leadId=best?.id??null;assignmentClock=.8;}
  const leadIndex=ranked.findIndex(c=>c.id===leadId);if(leadIndex>0)ranked.unshift(ranked.splice(leadIndex,1)[0]);const assignedJunctions=new Set();
  for(const car of states){
   car.horn=Math.max(0,car.horn-dt);car.hitHold=Math.max(0,car.hitHold-dt);car.routeTimer-=dt;car.siren=car.active&&(phase==='chase'||phase==='search');car.sirenPhase=(time*.24+car.index/3)%1;
   if(car.duty==='reserve'||car.duty==='deploying'||car.duty==='parking'){followStation(car,dt,player,context.players);continue;}
   car.distance=guide.project(car.path,car.x,car.z);let path=car.path,remaining=path.length-car.distance;const pursuing=phase==='chase'||phase==='search',rank=ranked.indexOf(car),prediction=Math.min(2.2,lostTime)+Math.min(3.8,rank*1.4);
   let goal=null;
   if(phase==='chase'){car.role=rank===0?'pursuit':rank%2===1?'intercept':'contain';goal={x:clamp(searchCenter.x+observedVelocity.x*prediction,city.bounds.minX+20,city.bounds.maxX-20),z:clamp(searchCenter.z+observedVelocity.z*prediction,city.bounds.minZ+20,city.bounds.maxZ-20)};if(rank>0&&Math.hypot(observedVelocity.x,observedVelocity.z)>3){const ahead=nodes.get(guide.nearestNode(goal.x,goal.z)),options=ahead.neighbors.map(id=>nodes.get(id)).sort((a,b)=>((b.x-ahead.x)*observedVelocity.x+(b.z-ahead.z)*observedVelocity.z)-((a.x-ahead.x)*observedVelocity.x+(a.z-ahead.z)*observedVelocity.z));goal=options.find(n=>!assignedJunctions.has(n.id))||ahead;assignedJunctions.add(goal.id);if(car.interceptTarget!==goal.id){car.interceptTarget=goal.id;stats.interceptsAssigned++;radio('intercept','Backup moving to intercept.',{unit:car.id,priority:0});}}}
   else if(phase==='search'){car.role='search';goal=searchGoal(car);}
   else if(investigation&&car.id===investigation.unit){car.role='investigate';goal=investigation;}
   else if(car.duty==='return'){car.role='returning';goal=nodes.get(mergeRoad.from);}
   else car.role='patrol';
   const direct=targetPresent&&phase==='chase'&&rank===0&&sees(car,player,46)&&city.getRoadInfo(player.x,player.z).onRoad;
   if(car.routeTimer<=0){car.routeTimer=.65;if(pursuing||goal){const on=guide.sample(path,car.distance);if(Math.hypot(on.x-car.x,on.z-car.z)>17&&!direct){nearestRoad(car);path=car.path;remaining=path.length-car.distance;}if(path.type==='road')car.nextId=chooseNext(car,goal);}}
   if(car.duty==='return'&&path.type==='road'&&car.fromId===mergeRoad.from&&car.toId===mergeRoad.to&&car.distance>mergeDistance-30){car.duty='parking';car.waypointIndex=0;car.waypoints=[stationPoint(25,38),stationPoint(25,-32),stationPoint(car.park.dx+10,-32),stationPoint(car.park.dx,-24),{x:car.park.x,z:car.park.z}];followStation(car,dt,player,context.players);continue;}
   let target=pursuing?29+heat*4.4:car.role==='investigate'?16:12.5,canEnter=true;
   if(path.type==='road'){
    const turn=guide.junction(car).turn,signal=city.getSignal(car.toId,path.axis),owner=traffic?.reservations.get(car.toId);car.indicator=!pursuing&&remaining<35?Math.sign(-turn):0;
    if(!pursuing){canEnter=signal==='green'&&(!owner||owner===car.id);if(!canEnter)target=Math.min(target,Math.sqrt(2*3.8*Math.max(0,remaining-.9-car.speed*.55)));}
    if(Math.abs(turn)>.1)target=Math.min(target,Math.sqrt((pursuing?8.4:6.4)**2+2*3.4*remaining));
   }else target=Math.min(target,Math.abs(path.turn)>.1?(pursuing?8.4:6.4):15);
   target=curveSpeed(car,target,pursuing,canEnter);let aim=guide.lookAhead(car,Math.max(5,car.speed*.53),canEnter),swerve=0;
   if(direct){const distance=Math.hypot(car.x-player.x,car.z-player.z),lead=clamp(distance/25,0,.65);aim={x:player.x+(player.vx||0)*lead,z:player.z+(player.vz||0)*lead};target=Math.min(target,speed+Math.max(0,(distance-6)*.7));}
   if(phase==='arrested')target=0;
   const fx=Math.sin(car.heading),fz=Math.cos(car.heading),rx=fz,rz=-fx;
   for(const other of[...(traffic?.states||[]),...states,...candidates.filter(p=>!direct||key(p)!==targetId)]){if(other===car)continue;const dx=other.x-car.x,dz=other.z-car.z,along=dx*fx+dz*fz,lateral=dx*rx+dz*rz;if(along<=0||along>55||Math.abs(lateral)>(car.width+(other.width??2))*.5+.4)continue;const gap=along-(car.length+(other.length??4.5))*.5-1.6,forward=Math.max(0,(other.vx||0)*fx+(other.vz||0)*fz);target=Math.min(target,Math.sqrt(forward*forward+2*4.7*Math.max(0,gap-Math.max(0,car.speed-forward)*.5)));if(gap<2)target=Math.min(target,Math.max(0,gap));if(pursuing&&path.type==='road'&&remaining>25&&along>10)swerve=2.8;}
   if(swerve){const p=guide.lookAhead(car,Math.max(9,car.speed*.6),canEnter),others=[...(traffic?.states||[]),...states,...candidates];
    swerve=[2.8,-2.2].find(side=>{const candidate={x:p.x+(p.dz||fz)*side,z:p.z-(p.dx||fx)*side};if(!city.getRoadInfo(candidate.x,candidate.z).onRoad)return false;return !others.some(other=>{if(other===car)return false;const dx=other.x-car.x,dz=other.z-car.z,along=dx*fx+dz*fz,lateral=dx*rx+dz*rz;return along> -7&&along<Math.max(25,car.speed*1.5)&&Math.abs(lateral-side)<2.1;});})||0;
   }
   car.swerve+=(swerve-car.swerve)*(1-Math.exp(-dt*2));if(car.swerve){aim.x+=(aim.dz??fz)*car.swerve;aim.z-=(aim.dx??fx)*car.swerve;}if(car.hitHold>0)target=Math.min(target,2);
   car.blockedTime=pursuing&&canEnter&&car.speed<.7&&Math.hypot(car.x-searchCenter.x,car.z-searchCenter.z)>11?car.blockedTime+dt:Math.max(0,car.blockedTime-dt*2);
   if(car.blockedTime>4.5&&car.recoveryTimer===0){car.recoveryTimer=1.15;car.blockedTime=0;stats.recoveries++;stats.blockedRoutes++;radio('blocked','Route blocked.',{unit:car.id,priority:0});}
   if(car.recoveryTimer>0){car.recoveryTimer=Math.max(0,car.recoveryTimer-dt);aim={x:car.x+fx*6+rx*.8,z:car.z+fz*6+rz*.8};target=-2;if(car.recoveryTimer===0){nearestRoad(car);car.routeTimer=0;}}
   aim.speed=target;integrateAgent(car,aim,dt,city,{acceleration:pursuing?5.2:2.6,deceleration:8.2});
   const obstacles=[...city.getColliders(car,8),...(traffic?.getColliders(car,8)||[])];const hit=resolveVehicleContacts(car,obstacles,agentBuild(car),{dt,previousPosition:{x:car.previousX,z:car.previousZ,heading:car.previousHeading},restitution:.08,friction:.28});if(hit.collided&&hit.maxClosingSpeed>3){car.hitHold=.3;car.horn=.15;if(pursuing&&hit.maxClosingSpeed>7)radio('collision','Unit contact.',{unit:car.id,priority:1});}syncAgent(car);car.distance=guide.project(car.path,car.x,car.z);
   if(path!==car.path)continue;
   if(path.type==='road'&&car.distance>=path.length-.2&&canEnter){if(!pursuing)traffic?.reservations.set(car.toId,car.id);car.path=guide.junction(car);car.distance=guide.project(car.path,car.x,car.z);car.entries++;if(Math.abs(car.path.turn)>.1)car.turns++;}
   else if(path.type==='junction'&&(car.distance>=path.length-.3||(car.x-path.end.x)*path.dx+(car.z-path.end.z)*path.dz>.1)){if(traffic?.reservations.get(path.nodeId)===car.id)traffic.reservations.delete(path.nodeId);car.fromId=path.toId;car.toId=path.nextId;car.path=guide.leg(car.fromId,car.toId);car.distance=guide.project(car.path,car.x,car.z);car.nextId=chooseNext(car,goal);}
  }
  for(let i=0;i<states.length;i++)for(let j=i+1;j<states.length;j++)if(Math.hypot(states[i].x-states[j].x,states[i].z-states[j].z)<6){resolveVehicleContacts(states[i],[states[j].collider],agentBuild(states[i]),{dt,restitution:.06,friction:.25});syncAgent(states[i]);syncAgent(states[j]);}
 }
 function getColliders(player,radius=45){return states.filter(c=>c.visible!==false&&Math.hypot(c.x-(player?.x??0),c.z-(player?.z??0))<radius).map(c=>{syncAgent(c);return c.collider;});}
 function onPlayerContact(contact){const car=states.find(c=>c.id===(contact?.collider?.npcId??contact?.npcId));if(!car)return;stats.contacts++;car.hitHold=Math.max(car.hitHold,.25);car.horn=.25;if(!car.active){car.active=true;car.duty='patrol';nearestRoad(car);}syncAgent(car);if((contact.closingSpeed||0)>2)forcedOffense={reason:'Collision with police',playerId:contact.playerId??null};}
 function getNearbyAudio(player){const cs=Math.cos(player?.heading||0),sn=Math.sin(player?.heading||0);return states.filter(c=>c.active).map(c=>{const dx=c.x-(player?.x??0),dz=c.z-(player?.z??0),distance=Math.hypot(dx,dz);return{id:c.id,engineId:'i6t',x:c.x,z:c.z,vx:c.vx,vz:c.vz,heading:c.heading,engineRunning:true,distance,pan:clamp((dx*cs-dz*sn)/Math.max(8,distance),-1,1),speed:c.speed,rpm:c.rpm,throttle:c.throttle,horn:c.horn>0,siren:c.siren,sirenPhase:c.sirenPhase,urgency:c.siren?Math.max(.35,heat/3):0,role:c.role};}).filter(c=>c.distance<(c.siren?320:125)).sort((a,b)=>a.distance-b.distance);}
 function reportCamera(record){if(!record||![record.x,record.z].every(Number.isFinite)||phase==='arrested')return;stats.cameraReports++;const unit=states.filter(c=>c.active&&c.duty==='patrol').sort((a,b)=>Math.hypot(a.x-record.x,a.z-record.z)-Math.hypot(b.x-record.x,b.z-record.z))[0];if(!unit)return;
  investigation={x:record.x,z:record.z,unit:unit.id,until:time+45,district:record.district||city.getDistrict(record.x,record.z),playerId:record.playerId?String(record.playerId).slice(0,80):null};unit.routeTimer=0;radio('camera',`Speed camera report in ${investigation.district}. Nearest unit investigate.`,{priority:1,district:investigation.district,unit:unit.id});
  if((phase==='chase'||phase==='search')&&(!record.playerId||record.playerId===targetId)){searchCenter={x:record.x,z:record.z};const heading=record.heading||0;observedVelocity={x:Math.sin(heading)*(record.speedKph||0)/3.6,z:Math.cos(heading)*(record.speedKph||0)/3.6};lostTime=0;if(phase==='search'){phase='chase';searchRadius=0;emit('pursuit',{reason:'Speed camera sighting',resumed:true});}}
 }
 function getState(){const active=states.filter(c=>c.active);return{phase,heat,targetId,heatNormalized:heat/3,searchCenter:{...searchCenter},searchRadius,lostTime,searchProgress:phase==='search'?clamp(searchTime/searchDuration(),0,1):0,searchRemaining:phase==='search'?Math.max(0,searchDuration()-searchTime):0,nearestOfficerDistance:lastPlayer&&active.length?Math.min(...active.map(c=>Math.hypot(c.x-lastPlayer.x,c.z-lastPlayer.z))):null,arrestProgress:arrestTime/3,suspicion:clamp(suspicion/1.1,0,1),night,nightShift,activeCount:active.length,targetCount:targetCount(),reserveCount:states.length-active.length,investigation:investigation?{...investigation}:null,lastDispatch:lastDispatch?{...lastDispatch}:null,searchSectors:searchPlan.map(n=>({id:n.id,x:n.x,z:n.z,checked:searchedNodes.has(n.id),unit:states.find(c=>c.searchTarget===n.id)?.id??null})),officers:states.map(c=>({id:c.id,x:c.x,z:c.z,heading:c.heading,speed:c.speed,siren:c.siren,active:c.active,duty:c.duty,role:c.role,searchTarget:c.searchTarget??null,interceptTarget:c.interceptTarget??null})),...stats};}
 function captureSnapshot(){return{version:1,time,phase,heat,night,nightShift,searchCenter:{...searchCenter},observedVelocity:{...observedVelocity},searchRadius,lostTime,searchTime,arrestTime,targetId,lastPlayer:lastPlayer?{...lastPlayer}:null,stats:{...stats},cars:states.map(captureAgent)};}
 function applySnapshot(value){
  const point=p=>p&&[p.x,p.z].every(v=>Number.isFinite(v)&&Math.abs(v)<=2000),validNumber=(k,limit)=>Number.isFinite(value[k])&&value[k]>=0&&value[k]<=limit;
  if(disposed||value?.version!==1||!['patrol','chase','search','escaped','arrested'].includes(value.phase)||!validNumber('time',1e9)||!validNumber('heat',3)||!validNumber('night',1)||!validNumber('searchRadius',1000)||!validNumber('lostTime',1e9)||!validNumber('searchTime',1e9)||!validNumber('arrestTime',3)||!point(value.searchCenter)||!point(value.observedVelocity)||value.lastPlayer!==null&&!point(value.lastPlayer)||value.targetId!==null&&(typeof value.targetId!=='string'||value.targetId.length>80)||!Array.isArray(value.cars)||value.cars.length>6||!value.cars.every(validAgent)||new Set(value.cars.map(c=>c.id)).size!==value.cars.length||value.cars.some(c=>!states.some(s=>s.id===c.id)))return false;
  replica=true;snapshotAge=0;time=value.time;phase=value.phase;heat=value.heat;night=value.night;nightShift=!!value.nightShift;searchCenter={...value.searchCenter};observedVelocity={...value.observedVelocity};searchRadius=value.searchRadius;lostTime=value.lostTime;searchTime=value.searchTime;arrestTime=value.arrestTime;targetId=value.targetId;lastPlayer=value.lastPlayer?{...value.lastPlayer}:null;for(const key of Object.keys(stats))if(Number.isFinite(value.stats?.[key]))stats[key]=clamp(value.stats[key],0,1e9);const rows=new Map(value.cars.map(c=>[c.id,c]));for(const car of states){const row=rows.get(car.id);if(row){applyAgent(car,row);syncAgent(car);}else{car.visible=false;car.active=false;}}return true;
 }
 function advanceSnapshot(dt){if(replica)snapshotAge=Math.min(.15,snapshotAge+Math.max(0,Number(dt)||0));}
 function setNight(value){night=clamp(value,0,1);renderer.setNight(night);}
 function dispose(){if(disposed)return;disposed=true;for(const car of states)if(traffic?.reservations.get(car.path?.nodeId)===car.id)traffic.reservations.delete(car.path.nodeId);renderer.dispose();events.length=0;}
 reset();return{root:renderer.root,states,update,render(alpha=1){renderer.render(replica?Math.min(1,snapshotAge/.1):alpha,time);},captureSnapshot,applySnapshot,advanceSnapshot,reset,dispose,setNight,getColliders,onPlayerContact,getNearbyAudio,getState,consumeEvents(){return events.splice(0);},lineOfSight,reportCamera,reportOffense(reason='Dangerous driving',playerId=null){forcedOffense={reason,playerId};},diagnostics(){return{...getState(),time,dynamic:true,replica};}};
}
