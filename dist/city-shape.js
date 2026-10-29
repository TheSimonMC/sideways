const SCALE=1;
export function mapCityPoint(x,z){return{x,z};}
export function unmapCityPoint(x,z){return{x,z};}
export function mapCityDirection(x,z,dx,dz){const l=Math.hypot(dx,dz)||1;return{x:dx/l,z:dz/l,scale:1};}
export function mapCityHeading(x,z,heading=0){return heading;}
export function cityPath(a,b,spacing=8){const n=Math.max(1,Math.ceil(Math.hypot(b.x-a.x,b.z-a.z)/spacing)),points=[];for(let i=0;i<=n;i++){const t=i/n;points.push({x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t});}return points;}
export function pathLength(points){let n=0;for(let i=1;i<points.length;i++)n+=Math.hypot(points[i].x-points[i-1].x,points[i].z-points[i-1].z);return n;}
export const CITY_SCALE=SCALE;
