import * as THREE from './vendor/three.module.js';

/** One active map. This disposes owned GPU resources as well as scene nodes. */
export function disposeWorld(world){
 if(!world?.root)return;
 if(typeof world.dispose==='function'){world.dispose();return;}
 const geometries=new Set(),materials=new Set(),textures=new Set();
 world.root.traverse(node=>{
  if(node.geometry)geometries.add(node.geometry);
  for(const material of node.material?(Array.isArray(node.material)?node.material:[node.material]):[]){materials.add(material);for(const value of Object.values(material))if(value?.isTexture)textures.add(value);}
 });
 world.root.removeFromParent();for(const g of geometries)g.dispose();for(const t of textures)t.dispose();for(const m of materials)m.dispose();
 world.colliders?.splice(0);world.disposed=true;
}

/** A small menu stage. Neither driving map is constructed on the title screen. */
export function createShowroom(scene){
 const root=new THREE.Group();root.name='SHOWROOM';scene.add(root);
 const floor=new THREE.Mesh(new THREE.CylinderGeometry(22,22,.30,48),new THREE.MeshStandardMaterial({color:0x384552,roughness:.84,metalness:.06,flatShading:true}));floor.position.y=-.15;floor.receiveShadow=true;root.add(floor);
 const rim=new THREE.Mesh(new THREE.TorusGeometry(13,.045,4,64),new THREE.MeshBasicMaterial({color:0x91e6ef}));rim.rotation.x=Math.PI/2;rim.position.y=.02;root.add(rim);
 const material=new THREE.MeshStandardMaterial({color:0x27333f,roughness:.9,flatShading:true}),geometry=new THREE.BoxGeometry(1,1,1),dummy=new THREE.Object3D();
 const skyline=new THREE.InstancedMesh(geometry,material,24);
 for(let i=0;i<24;i++){const angle=i/24*Math.PI*2,h=4+(i*13%19);dummy.position.set(Math.cos(angle)*46,h/2-.2,Math.sin(angle)*46);dummy.rotation.y=-angle;dummy.scale.set(5,h,8);dummy.updateMatrix();skyline.setMatrixAt(i,dummy.matrix);}root.add(skyline);
 const getSurfaceAt=()=>({height:0,material:'concrete',grip:.94,roughness:.004,onRoad:true});
 return {kind:'showroom',root,name:'MOTOR WORKS',spawn:{x:0,z:0,heading:-.28},colliders:[],bounds:{minX:-20,maxX:20,minZ:-20,maxZ:20},getSurfaceAt,getRoadInfo:()=>({onRoad:true,grip:.94,distance:0,progress:0}),update(){},mapPoints:[],services:[]};
}
