/** A footprint plane for the existing height-field chassis, in car coordinates:
 * u points right, v points forward, height = center + lateral*u + longitudinal*v.
 * Four existing wheel samples suffice; no additional world queries per step.
 * Local steps still enter each spring separately rather than becoming a flat road.
 */
export function roadPlane(samples,frontAxle,rearAxle,halfTrack){
 const h=samples.map(p=>Number.isFinite(p.height)?p.height:0);
 const front=(h[0]+h[1])*.5,rear=(h[2]+h[3])*.5;
 let longitudinal=(front-rear)/(frontAxle+rearAxle),lateral=(h[1]+h[3]-h[0]-h[2])/(4*halfTrack);
 // A height-field cliff is not a drivable wall. Bound the footprint plane;
 // the individual spring/contact heights continue to detect the actual ledge.
 const scale=Math.min(1,1.2/Math.max(1e-9,Math.hypot(longitudinal,lateral)));
 longitudinal*=scale;lateral*=scale;
 return {longitudinal,lateral,height:(front*rearAxle+rear*frontAxle)/(frontAxle+rearAxle),normalScale:Math.hypot(1,longitudinal,lateral)};
}

/** Tangent contact Jacobians for planar velocity with its constrained vertical
 * component. Force directions and velocity projections are distinct on a slope.
 * Their dot products give unit inverse mass, preserving impulse/work reciprocity.
 * This is a height-field approximation, not an unconstrained 6-DOF rigid body.
 */
export function contactFrame(steer,longitudinal=0,lateral=0){
 const n=Math.sin(steer),c=Math.cos(steer),q=lateral*n+longitudinal*c;
 const length=Math.hypot(1,q),normal=Math.hypot(1,longitudinal,lateral);
 return {
  longU:(n+lateral*q)/length,longV:(c+longitudinal*q)/length,
  latU:normal*c/length,latV:-normal*n/length,
  forceLongU:n/length,forceLongV:c/length,forceLongY:q/length,
  forceLatU:(c+longitudinal*q)/(normal*length),forceLatV:-(n+lateral*q)/(normal*length),forceLatY:(lateral*c-longitudinal*n)/(normal*length)
 };
}
