import {frontLip,rearDiffuser,aeroPartMass,resolveExteriorTuning} from './exterior-tuning.js';
export const BODY_PROFILES={
      coupe:{rings:[[-.94,.86,.72],[-.76,1,.83],[-.35,1,.84],[.28,.98,.80],[.70,1,.68],[.96,.87,.60]],roofBack:-.51,roofFront:.29,screenFront:.94,screenBack:-1.06,roof:1.28,roofW:.55,sill:.84},
      muscle:{rings:[[-.96,.91,.82],[-.72,1.02,.92],[-.30,1,.89],[.30,1,.84],[.78,1.04,.80],[.96,.96,.77]],roofBack:-.97,roofFront:.12,screenFront:.80,screenBack:-1.48,roof:1.43,roofW:.63,sill:.91},
      wedge:{rings:[[-.96,.91,.66],[-.69,1,.79],[-.24,.97,.75],[.35,.96,.68],[.75,.91,.48],[.97,.83,.42]],roofBack:-.64,roofFront:.18,screenFront:.91,screenBack:-1.12,roof:1.15,roofW:.53,sill:.77},
      tourer:{rings:[[-.96,.96,.89],[-.78,1,.91],[-.36,1,.88],[.34,1,.86],[.76,.98,.81],[.96,.95,.76]],roofBack:-1.11,roofFront:.33,screenFront:.87,screenBack:-1.79,roof:1.47,roofW:.64,sill:.89}
    };
// Dimensions shared by shell geometry, hinges and detached rigid proxies.
export function bodyLayout(build){
 const model=build.vehicle.model,q=BODY_PROFILES[model.kind]||BODY_PROFILES.coupe,L=model.length*.5,W=model.width*.46;
 const top=z=>{let i=0;while(i<q.rings.length-2&&q.rings[i+1][0]*L<z)i++;const a=q.rings[i],b=q.rings[i+1],t=Math.max(0,Math.min(1,(z-a[0]*L)/((b[0]-a[0])*L)));return a[2]+(b[2]-a[2])*t;};
 const front=q.screenFront,back=q.screenBack,mid=(front+back)/2,doorZ=front-.03;
 return {q,L,W,top,front,back,parts:{
  front:{center:[0,.35,L*.976],mass:12+aeroPartMass(frontLip(build.selection)),radius:.72},
  rear:{center:[0,.35,-L*.976],mass:11+aeroPartMass(rearDiffuser(build.selection)),radius:.72},
  spoiler:{center:[0,1.04,-L*.87],mass:build.selection.spoiler==='none'?0:build.selection.spoiler==='gt'?8:build.selection.spoiler==='ducktail'?3:2,radius:.62},
  left:{center:[-W*.91,(q.sill+.46)/2,mid],pivot:[-W*.94,.46,doorZ],axis:'y',sign:1,mass:29,radius:.54},
  right:{center:[W*.91,(q.sill+.46)/2,mid],pivot:[W*.94,.46,doorZ],axis:'y',sign:-1,mass:29,radius:.54},
  hood:{center:[0,top((front+L*.96)/2),(front+L*.96)/2],pivot:[0,top(front),front],axis:'x',sign:-1,mass:18+resolveExteriorTuning(build.selection).componentMass.hood,radius:.60},
  boot:{center:[0,top((back-L*.96)/2),(back-L*.96)/2],pivot:[0,top(back),back],axis:'x',sign:1,mass:15,radius:.52}
 }};
}
export function panelCenter(part,angle=0){
 const c=[...part.center];if(!part.pivot||!angle)return c;
 const p=part.pivot,a=angle*part.sign,s=Math.sin(a),k=Math.cos(a),x=c[0]-p[0],y=c[1]-p[1],z=c[2]-p[2];
 return part.axis==='y'?[p[0]+x*k+z*s,c[1],p[2]-x*s+z*k]:[c[0],p[1]+y*k-z*s,p[2]+y*s+z*k];
}
