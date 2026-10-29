import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import MotorLab from '../sdk/motor-engine.mjs';
import {CarPhysics} from '../dist/physics.js';
import {InputManager} from '../dist/input.js';
const source=fs.readFileSync(new URL('../dist/main.js',import.meta.url),'utf8');
const extract=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
class Target{constructor(){this.events={}}addEventListener(k,f){(this.events[k]??=[]).push(f)}removeEventListener(){}emit(k,code){for(const f of this.events[k]||[])f({code,target:{tagName:'CANVAS'},preventDefault(){}})}}
const target=new Target(),doc=new Target(),pads=[];
const input=new InputManager({navigator:{getGamepads:()=>pads},target,document:doc,storage:{getItem(){return null},setItem(){}}});
const car=new CarPhysics(MotorLab),result={};
const context={frameControls:{},activeInputConfig:input.getConfig(),pendingShiftUp:false,pendingShiftDown:false,pendingNeutral:false,phase:'playing',paused:false};
context.setTransmission=value=>{input.setConfig({transmission:value});context.activeInputConfig=input.getConfig()};
vm.createContext(context);vm.runInContext(extract('function inputState(){','function resolveCollisions()')+extract('function requestShift(direction)','function focusableControls()'),context);
const reset=()=>{input.clear();car.reset(0,0,0);context.pendingShiftUp=false;context.pendingShiftDown=false;context.pendingNeutral=false;context.activeInputConfig=input.getConfig();};
function run(seconds){for(let i=0;i<seconds*60;i++){const sample=input.sample(1/60);context.frameControls=sample.controls;for(const a of sample.actions){if(a==='shiftUp')context.requestShift(1);if(a==='shiftDown')context.requestShift(-1);}for(let j=0;j<2;j++)car.update(1/120,context.inputState());}return car.state;}
reset();target.emit('keydown','KeyA');let s=run(3);assert.equal(s.heading,0);assert.equal(s.x,0);assert.equal(s.z,0);result.stationarySteering='no motion';
reset();target.emit('keydown','KeyW');run(3);target.emit('keydown','KeyD');s=run(1.5);assert.ok(s.heading<-.05);result.keyboardRightHeading=s.heading;
reset();target.emit('keydown','KeyW');run(3);target.emit('keydown','KeyA');s=run(1.5);assert.ok(s.heading>.05);result.keyboardLeftHeading=s.heading;
reset();target.emit('keydown','KeyW');run(4);target.emit('keydown','Space');s=run(.8);assert.equal(s.handbrake,1);assert.equal(car._omegaL,0);assert.equal(car._omegaR,0);target.emit('keyup','Space');s=run(.1);assert.equal(s.handbrake,0);result.spaceHandbrake='locks and releases both rear wheels';
reset();input.setConfig({transmission:'hpattern',shifter:{enabled:true}});context.activeInputConfig=input.getConfig();context.frameControls={steer:.6,gearRequest:0};context.requestShift(1);const command=context.inputState();assert.equal(command.transmission,'sequential');assert.equal(command.gearRequest,undefined);assert.equal(command.steer,-.6);assert.equal(command.shiftUp,true);car.update(1/120,command);assert.equal(car.state.gear,2);assert.equal(context.inputState().shiftUp,false);result.hToSequential='paddles override H mode without stale neutral';
context.pendingNeutral=true;const neutral=context.inputState();assert.equal(neutral.gearRequest,0);car.update(1/120,neutral);assert.equal(car.state.gear,0);result.explicitNeutral='works in sequential';
input.setConfig({transmission:'hpattern'});context.activeInputConfig=input.getConfig();context.frameControls={gearRequest:3,clutch:1};const h=context.inputState();assert.equal(h.gearRequest,3);car.update(1/120,h);assert.equal(car.state.gear,3);result.hGate='held gear reaches physics';
fs.writeFileSync(new URL('driving-input-v2-results.json',import.meta.url),JSON.stringify({status:'passed',...result},null,2));console.log(JSON.stringify({status:'passed',...result},null,2));input.destroy();
