/** Fictional vehicle condition and tank sizes used by the game.
 * Fuel quantity comes from MotorLab's injected mass. Density is a fixed game
 * conversion, not a temperature-dependent fuel chemistry simulation. */
import {createTyre} from './tyres.js';
import {createBodyDamage,snapshotBodyDamage} from './body-damage.js';
import {createMechanicalCondition,snapshotMechanicalCondition,validEngineFault} from './mechanical.js';
export const FUEL_DENSITY_KG_PER_LITRE=.745;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,Number.isFinite(v)?v:a));
const capacities={hachi:50,atlas:68,kitsune:45,vector:55};
export function createVehicleCondition(build,saved={}){
 const fuelCapacity=capacities[build.vehicle.id]||52;
 const health=key=>Number.isFinite(saved[key])?clamp(saved[key],0,1):1;
 const engineHealth=health('engineHealth');
 const condition={carId:build.vehicle.id,engineHealth,bodyHealth:health('bodyHealth'),gearboxHealth:health('gearboxHealth'),
  wheelHealth:Array.from({length:4},(_,i)=>Number.isFinite(saved.wheelHealth?.[i])?clamp(saved.wheelHealth[i],0,1):1),
  suspensionHealth:Array.from({length:4},(_,i)=>Number.isFinite(saved.suspensionHealth?.[i])?clamp(saved.suspensionHealth[i],0,1):1),
  brakeHealth:Array.from({length:4},(_,i)=>Number.isFinite(saved.brakeHealth?.[i])?clamp(saved.brakeHealth[i],0,1):1),
  wheelToe:Array.from({length:4},(_,i)=>Number.isFinite(saved.wheelToe?.[i])?clamp(saved.wheelToe[i],-.16,.16):0),
  wheelAttached:Array.from({length:4},(_,i)=>saved.wheelAttached?.[i]!==false),
  fuelCapacity,fuelLitres:Number.isFinite(saved.fuelLitres)?clamp(saved.fuelLitres,0,fuelCapacity):fuelCapacity,
  fuelConsumedLitres:clamp(saved.fuelConsumedLitres??0,0,1e9),boost:Number.isFinite(saved.boost)?clamp(saved.boost,0,1):1,
  engineFault:engineHealth<=.025?validEngineFault(saved.engineFault):null,
  damageEnergyJ:clamp(saved.damageEnergyJ??0,0,1e12),distanceMeters:clamp(saved.distanceMeters??0,0,1e12),maxRpm:clamp(saved.maxRpm??0,0,100000),damageRevision:Math.round(clamp(saved.damageRevision??0,0,1e9))};
 condition.tyres=condition.wheelHealth.map((health,i)=>createTyre(saved.tyres?.[i],health));condition.bodyDamage=createBodyDamage(build,saved.bodyDamage,condition.bodyHealth);condition.mechanical=createMechanicalCondition(build,saved.mechanical,condition);return condition;
}
export function snapshotVehicleCondition(condition){return {...condition,tyres:condition.tyres.map(t=>({...t})),bodyDamage:snapshotBodyDamage(condition.bodyDamage),mechanical:snapshotMechanicalCondition(condition.mechanical),wheelHealth:[...condition.wheelHealth],wheelAttached:[...condition.wheelAttached],suspensionHealth:[...condition.suspensionHealth],brakeHealth:[...condition.brakeHealth],wheelToe:[...condition.wheelToe]};}
