import {resolveInteriorTuning} from './interior-tuning.js';
import {bodyLayout} from './body-layout.js';
const limit=(v,a,b,f)=>Math.max(a,Math.min(b,Number.isFinite(v)?v:f));
export function cockpitSettings(saved={}){saved=saved&&typeof saved==='object'?saved:{};return {seatHeight:limit(saved.seatHeight,-.07,.07,0),seatDistance:limit(saved.seatDistance,-.14,.12,0),fov:limit(saved.fov,55,95,76),motion:limit(saved.motion,0,1,.35),wheel:saved.wheel!==false,hands:saved.hands!==false,mirrors:saved.mirrors!==false,hud:saved.hud!==false};}
export function cockpitLayout(build){
 const {q,W,front,back}=bodyLayout(build),kind=build.vehicle.model.kind,tuning=resolveInteriorTuning(build.selection);
 const styles={coupe:{trim:0x424852,seat:0x434d58,accent:0xf28b9b,face:'#f5e7c7',dial:'twin',name:'HACHI',rear:true},muscle:{trim:0x695044,seat:0x96725c,accent:0xc1a572,face:'#eacfa2',dial:'classic',name:'ATLAS',rear:true},wedge:{trim:0x292f43,seat:0x3b4660,accent:0xef9f5c,face:'#ffcc7c',dial:'sport',name:'KITSUNE',rear:false},tourer:{trim:0x37484c,seat:0x536366,accent:0x80c7bb,face:'#b1edda',dial:'digital',name:'VECTOR',rear:true}};
 const x=W*.46*(kind==='muscle'||kind==='tourer'?1:-1),seatZ=kind==='muscle'?-.43:kind==='tourer'?-.42:-.34,dashZ=front-.29;
 return {...styles[kind],tuning,kind,q,W,front,back,driverX:x,seatZ,dashZ,eye:[x,q.roof-.26-tuning.seatDrop,seatZ+.07],wheel:[x,q.sill-.21,dashZ-.32-tuning.wheelDish],wheelRadius:tuning.wheelRadius??(kind==='muscle'?.18:.16),shifter:[-.015,.54,dashZ-.35],handbrake:[.09,.47,seatZ+.12],pedals:[x,.35,dashZ+.04],screen:[kind==='muscle'?-.16:-Math.sign(x)*.13,kind==='muscle'?q.sill+.07:q.sill-.06,kind==='muscle'?dashZ-.02:dashZ-.15],screenSize:kind==='muscle'?[.25,.17]:[.32,.21]};
}
export function cockpitReadings(s,build){
 const m=s.mechanical||{},t=m.temperatures||{},voltage=m.auxiliaries?.voltage??12.6;
 return {manifoldBar:limit(s.manifoldBar,-1,5,0),speed:Math.abs(s.speed||0)*3.6,rpm:Math.max(0,s.rpm||0),redline:build.physics.redlineRpm||build.engine.redlineRpm,gear:s.gear<0?'R':s.gear===0?'N':String(s.gear??'N'),fuel:limit(s.fuelLitres/Math.max(1,s.fuelCapacity),0,1,1),coolant:t.coolant??24,oil:t.oil??24,oilPressure:m.oilPressureBar??0,voltage,powered:voltage>7,
  warnings:{oil:(s.rpm||0)>650&&(m.oilPressureBar??0)<.55,heat:(t.coolant||0)>108||(t.engine||0)>125,battery:voltage<11.6,brake:(s.handbrake||0)>.1||m.brakeHydraulicFactors?.some(v=>v<.3)||false,fuel:(s.fuelLitres??50)<(s.fuelCapacity??50)*.12,engine:!!s.engineFault||(m.warnings?.length||0)>0},lights:!!s.headlights};
}
// The road-wheel command is converted using the fitted steering rack ratio.
export const steeringWheelAngle=(s,build)=>-(s.steer||0)*(build.physics.steeringRatio||14);
