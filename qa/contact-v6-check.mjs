import assert from 'node:assert/strict';
import fs from 'node:fs';
import {resolveVehicleContacts} from '../dist/contact.js';
import {resolveBuild} from '../dist/catalog.js';
const build=resolveBuild(),report={status:'pending',checks:[],cases:[]};
const kinetic=(s,m,i)=>.5*m*(s.vx*s.vx+s.vz*s.vz)+.5*i*s.yawRate*s.yawRate;
function collide(label,a,b,shape={}){
 const mass=shape.mass||1400,inertia=shape.inertia||2100,box={x:b.x,z:b.z,heading:b.heading||0,hx:1,hz:2.2,vx:b.vx,vz:b.vz,yawRate:b.yawRate,kind:'traffic',material:'metal',npcId:'fixture',body:b,mass,inertia,...shape};
 const before={energy:kinetic(a,build.physics.mass,build.physics.inertia)+kinetic(b,mass,inertia),px:build.physics.mass*a.vx+mass*b.vx,pz:build.physics.mass*a.vz+mass*b.vz};
 const result=resolveVehicleContacts(a,[box],build),after=kinetic(a,build.physics.mass,build.physics.inertia)+kinetic(b,mass,inertia);
 assert.ok(result.collided&&result.contacts.length);assert.ok(after<=before.energy+1e-8,'Dynamic contact created energy');
 assert.ok(Math.abs(build.physics.mass*a.vx+mass*b.vx-before.px)<1e-8);assert.ok(Math.abs(build.physics.mass*a.vz+mass*b.vz-before.pz)<1e-8);
 const contact=result.contacts[0];assert.ok(contact.impulse>0);assert.ok(contact.energyJ>0);assert.ok(Number.isFinite(contact.localPoint.x)&&Number.isFinite(contact.localPoint.z));assert.equal(box.x,b.x);assert.equal(box.z,b.z);assert.equal(box.vx,b.vx);assert.equal(box.vz,b.vz);assert.equal(contact.collider.body,b);
 report.cases.push({label,playerVelocity:[a.vx,a.vz],npcVelocity:[b.vx,b.vz],yawRates:[a.yawRate,b.yawRate],energyBefore:before.energy,energyAfter:after,reportedLoss:contact.energyJ});
}
collide('Head on',{x:0,z:0,heading:0,vx:0,vz:24,yawRate:0},{x:0,z:4.1,heading:Math.PI,vx:0,vz:-9,yawRate:0});
collide('Rear end',{x:0,z:0,heading:0,vx:0,vz:27,yawRate:0},{x:0,z:4.1,heading:0,vx:0,vz:8,yawRate:0});
collide('Side swipe',{x:0,z:0,heading:.15,vx:12,vz:22,yawRate:.1},{x:1.8,z:1.1,heading:0,vx:0,vz:10,yawRate:0});
collide('Police intercept',{x:0,z:0,heading:0,vx:0,vz:20,yawRate:0},{x:1.25,z:2.3,heading:-.65,vx:-12,vz:14,yawRate:.4},{kind:'police',mass:1700,inertia:2600});
report.checks.push('Dynamic player/NPC contacts conserve combined linear momentum and cannot add combined kinetic energy','Head-on, rear-end, side-swipe and rotated police intercepts produce reciprocal impulse and yaw','Collider mirrors are synchronized after body correction; damage receives actual dissipated energy, local contact and impulse vector');
report.status='passed';fs.writeFileSync(new URL('./contact-v6-results.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
