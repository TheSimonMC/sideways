const NUMBERS=['x','z','y','heading','vx','vz','yawRate','speed','rpm','throttle','wheelSpin','steer','bodyRoll','bodyPitch','horn','sirenPhase'];
const FLAGS=['brake','siren','active','visible','yielding'];
const TEXT=['duty','role','stopReason'];
const bounded=(key,value)=>{if(!Number.isFinite(value))return false;const limit=key==='wheelSpin'?1e9:key==='rpm'?25000:key==='x'||key==='z'?4096:key==='heading'?7:key==='y'?512:key==='vx'||key==='vz'||key==='speed'?180:20;return Math.abs(value)<=limit;};
export function captureAgent(car){const row={id:car.id};for(const key of NUMBERS)row[key]=Number.isFinite(car[key])?car[key]:0;for(const key of FLAGS)row[key]=key==='visible'||key==='active'?car[key]!==false:!!car[key];for(const key of TEXT)if(typeof car[key]==='string')row[key]=car[key].slice(0,24);row.indicator=Math.sign(car.indicator||0);return row;}
export function validAgent(row){return !!row&&typeof row==='object'&&typeof row.id==='string'&&row.id.length<40&&NUMBERS.every(key=>bounded(key,row[key]))&&FLAGS.every(key=>typeof row[key]==='boolean')&&TEXT.every(key=>row[key]===undefined||typeof row[key]==='string'&&row[key].length<=24)&&[-1,0,1].includes(row.indicator);}
export function applyAgent(car,row){
 car.previousX=car.x;car.previousZ=car.z;car.previousY=car.y;car.previousHeading=car.heading;car.previousWheelSpin=car.wheelSpin;
 for(const key of NUMBERS)car[key]=row[key];for(const key of FLAGS)car[key]=row[key];for(const key of TEXT)if(row[key]!==undefined)car[key]=row[key];car.indicator=row.indicator;
 if(Math.hypot(car.x-car.previousX,car.z-car.previousZ)>45){car.previousX=car.x;car.previousZ=car.z;car.previousY=car.y;car.previousHeading=car.heading;car.previousWheelSpin=car.wheelSpin;}
}
