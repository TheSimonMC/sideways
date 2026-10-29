const clamp=v=>Math.max(0,Math.min(1,v)),smooth=v=>{v=clamp(v);return v*v*(3-2*v);};
export const ISLANDS=[
 {name:'NEON MAINLAND',x:0,z:-650,rx:2550,rz:3100,rzNorth:3600},
 {name:'PALM ISLAND',x:3900,z:650,rx:1250,rz:2350},
 {name:'WESTHAVEN',x:-3850,z:-250,rx:1250,rz:2400},
 {name:'SUNSET KEYS',x:0,z:3600,rx:2200,rz:800}
];
export function coastRadius(angle,index){return 1+.035*Math.sin(angle*5+index)+.025*Math.cos(angle*9-index);}
export function landField(x,z){return Math.max(...ISLANDS.map((s,i)=>{const dx=(x-s.x)/s.rx,dz=(z-s.z)/(z<s.z?(s.rzNorth||s.rz):s.rz);return coastRadius(Math.atan2(dz,dx),i)-Math.hypot(dx,dz);}));}
export function countyHeight(x,z){const land=smooth((landField(x,z)+.035)/.035),hill=210*smooth((-z-1050)/1600)*(.75+.25*Math.sin(x/700)**2)*(1-smooth((Math.abs(x)-1900)/600));const west=65*smooth((-z-1700)/900)*smooth((-x-2600)/600);return -18+(18.012+hill+west)*land;}

/** Districts have road frontages and narrow mid-block alleys. Every road is
 * connected to the shared graph; the region builder splits surface crossings. */
export function expandCounty({node,addRoad,anchors}){
 const towns=[],lots=[],bridges=[],destinations=[],landmarks=[];
 function town({name,x,z,cols,rows,sx=140,sz=140,angle=0,style}){
  const cs=Math.cos(angle),sn=Math.sin(angle),at=(u,v)=>({x:x+u*cs+v*sn,z:z-u*sn+v*cs});const grid=[];
  for(let j=0;j<=rows*2;j++){const row=[];for(let i=0;i<=cols*2;i++){const p=at((i-cols)*sx/2,(j-rows)*sz/2);row.push(node(p.x,p.z,name));}grid.push(row);}
  for(let j=0;j<=rows*2;j++)for(let i=0;i<=cols*2;i++){
   if(i<cols*2&&(j%2===0||j%6===3)){const avenue=j===rows||j%6===0,width=avenue?22:j%2===0?13:7;addRoad(grid[j][i],grid[j][i+1],[],width===7?'alley':'urban',name+(width===7?' LANE':avenue?' AVENUE':' STREET'),width);}
   if(j<rows*2){const avenue=i===cols||i%6===0,width=avenue?22:i%2===0?13:7;addRoad(grid[j][i],grid[j+1][i],[],width===7?'alley':'urban',name+(width===7?' MEWS':avenue?' BOULEVARD':' ROAD'),width);}
  }
  for(let j=0;j<rows;j++)for(let i=0;i<cols;i++)for(const dx of[-.25,.25])for(const dz of[-.25,.25]){const p=at((i+.5-cols/2+dx)*sx,(j+.5-rows/2+dz)*sz);lots.push({...p,w:24,d:31,heading:angle,style,seed:i*41+j*971+(dx>0?13:0)+(dz>0?31:0),district:name});}
  const t={name,x,z,style,cols,rows,at,grid,west:grid[rows][0],east:grid[rows][cols*2],north:grid[0][cols],south:grid[rows*2][cols],center:grid[rows][cols]};towns.push(t);return t;
 }
 const palm=town({name:'PALM BEACH',x:3900,z:650,cols:8,rows:14,style:'deco'});
 const haven=town({name:'WESTHAVEN',x:-3850,z:-200,cols:8,rows:10,sx:145,sz:150,style:'brick',angle:-.08});
 const keys=town({name:'SUNSET KEYS',x:0,z:3600,cols:14,rows:4,sx:150,sz:140,style:'resort'});
 const palms=town({name:'PALM JUNCTION',x:-1270,z:800,cols:5,rows:5,sx:125,sz:130,style:'suburb'});
 const harbor=town({name:'EASTPORT',x:1300,z:650,cols:5,rows:5,sx:125,sz:130,style:'industrial'});
 const orchard=town({name:'ORCHARD VILLAGE',x:-1170,z:-1050,cols:5,rows:3,sx:130,sz:120,style:'suburb'});
 function link(a,b,name,kind='avenue',width=22,controls=[]){return addRoad(a,b,controls,kind,name,width);}
 link(palms.north,anchors.westSouth,'PALM MARKET ROAD');link(palms.east,anchors.southWest,'SOUTHBANK BOULEVARD');link(harbor.north,anchors.eastSouth,'EASTPORT MAIN');link(harbor.west,anchors.southEast,'MARINA LINK');link(orchard.south,anchors.westNorth,'ORCHARD HIGH STREET');link(orchard.east,anchors.north,'CANYON MARKET ROAD');
 function bridge(a,b,name,style='suspension',controls=[]){const r=link(a,b,name,'bridge',26,controls);r.bridge={name,style,deck:20};bridges.push(r);return r;}
 bridge(anchors.south,keys.north,'SUNSET CAUSEWAY','causeway');
 const eastSouth=node(3500,2500,'CORAL POINT'),westSouth=node(-3500,1750,'WEST DOCKS');
 link(palm.south,eastSouth,'CORAL COAST ROAD','country',18,[[3850,2150]]);link(haven.south,westSouth,'WEST DOCK ROAD','avenue',22,[[-3800,1200]]);
 const keyEast=node(1500,3600,'CORAL LANDING'),keyWest=node(-1500,3600,'SUNSET LANDING');link(keys.east,keyEast,'CORAL ACCESS');link(keys.west,keyWest,'SUNSET ACCESS');
 bridge(eastSouth,keyEast,'CORAL SEA LINK','causeway',[[2950,3000],[2150,3370]]);bridge(westSouth,keyWest,'SUNSET VIADUCT','arch',[[-2900,2400],[-2300,3100]]);
 function ring(island,town,name){const ports=[];for(let i=0;i<12;i++){const a=i*Math.PI/6;ports.push(node(island.x+Math.cos(a)*island.rx*.77,island.z+Math.sin(a)*island.rz*.77,name));}for(let i=0;i<12;i++){const a=(i+.5)*Math.PI/6;link(ports[i],ports[(i+1)%12],name,'country',18,[[island.x+Math.cos(a)*island.rx*.77,island.z+Math.sin(a)*island.rz*.77]]);}for(const[key,i]of[['east',0],['south',3],['west',6],['north',9]])link(town[key],ports[i],name+' ACCESS','avenue',22);return ports;}
 const palmCoast=ring(ISLANDS[1],palm,'OCEAN PROMENADE'),westCoast=ring(ISLANDS[2],haven,'WEST COAST DRIVE');
 bridge(anchors.east,palmCoast[6],'PALM BAY BRIDGE');bridge(anchors.west,westCoast[0],'WESTHAVEN BRIDGE','arch');
 const north=node(-500,-3420,'CANYON PASS'),ridge=node(1050,-3190,'CANYON VIEW');link(anchors.summit,north,'NORTH RIDGE ROAD','hills',16,[[-750,-2950]]);link(north,ridge,'CANYON PASS','hills',16,[[0,-3550],[650,-3390]]);link(ridge,anchors.lookout,'CANYON DESCENT','hills',16,[[1450,-2860],[1300,-2450]]);
 for(const [t,kind,name,port]of[[palm,'garage','Ocean Customs','south'],[palm,'fuel','Palm Fuel','north'],[haven,'garage','Westhaven Workshop','west'],[haven,'fuel','West Dock Fuel','south'],[keys,'garage','Sunset Bodyshop','center'],[keys,'fuel','Keys Fuel','west'],[palms,'fuel','Palm Junction Fuel','west'],[harbor,'garage','Eastport Tuning','east']])destinations.push({node:t[port],kind,name});
 landmarks.push({kind:'lighthouse',name:'CORAL LIGHT',x:palmCoast[2].x+100,z:palmCoast[2].z},{kind:'port',name:'WESTHAVEN CONTAINER TERMINAL',x:-4110,z:1350},{kind:'stadium',name:'SOUTHBANK ARENA',x:600,z:1550},{kind:'observatory',name:'SKYLINE OBSERVATORY',x:anchors.summit.x+80,z:anchors.summit.z-90},{kind:'pier',name:'PALM PIER',x:4840,z:800});
 return{towns,lots,bridges,destinations,landmarks,islands:ISLANDS};
}
