const SCALE=.6;
/** A smooth, invertible city layout. Distances are metres after mapping. */
export function mapCityPoint(x,z){return{x:SCALE*x+14*Math.sin(z/170)+5*Math.sin(x/200),z:SCALE*z+11*Math.sin(x/185)+4*Math.sin(z/240)};}
export function unmapCityPoint(x,z){
 let a=x/SCALE,b=z/SCALE;
 for(let i=0;i<5;i++){
  const p=mapCityPoint(a,b),ex=p.x-x,ez=p.z-z,j00=SCALE+.025*Math.cos(a/200),j01=14/170*Math.cos(b/170),j10=11/185*Math.cos(a/185),j11=SCALE+4/240*Math.cos(b/240),det=j00*j11-j01*j10;
  a-=(ex*j11-ez*j01)/det;b-=(ez*j00-ex*j10)/det;
 }
 return{x:a,z:b};
}
export function mapCityDirection(x,z,dx,dz){const vx=(SCALE+.025*Math.cos(x/200))*dx+14/170*Math.cos(z/170)*dz,vz=11/185*Math.cos(x/185)*dx+(SCALE+4/240*Math.cos(z/240))*dz,length=Math.hypot(vx,vz)||1;return{x:vx/length,z:vz/length,scale:length};}
export function mapCityHeading(x,z,heading=0){const d=mapCityDirection(x,z,Math.sin(heading),Math.cos(heading));return Math.atan2(d.x,d.z);}
export function cityPath(a,b,spacing=8){const n=Math.max(1,Math.ceil(Math.hypot(b.x-a.x,b.z-a.z)/spacing)),points=[];for(let i=0;i<=n;i++){const f=i/n;points.push(mapCityPoint(a.x+(b.x-a.x)*f,a.z+(b.z-a.z)*f));}return points;}
export function pathLength(points){let n=0;for(let i=1;i<points.length;i++)n+=Math.hypot(points[i].x-points[i-1].x,points[i].z-points[i-1].z);return n;}
export const CITY_SCALE=SCALE;
