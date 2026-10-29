// Run against a local dist/ server. Optional PLAYWRIGHT_MODULE/CHROMIUM_PATH
// select an installed runtime; no host-specific paths are part of this test.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--enable-unsafe-swiftshader']});
 try{
  const page=await browser.newPage();await page.goto(process.env.SIDEWAYS_URL||'http://127.0.0.1:8765');
  const result=await page.evaluate(async()=>{
   const {CHASE_DATA}=await import('/audio/chase-track.js'),{MUSIC_DATA}=await import('/audio/music-track.js'),audio=new AudioContext({sampleRate:48000}),assets=[];
   for(const [name,data]of [['chase',CHASE_DATA],['drive',MUSIC_DATA]]){
    const bytes=Uint8Array.from(atob(data),c=>c.charCodeAt(0)),decoded=await audio.decodeAudioData(bytes.buffer);let energy=0,peak=0,finite=true;
    for(let c=0;c<decoded.numberOfChannels;c++)for(const v of decoded.getChannelData(c)){finite&&=Number.isFinite(v);energy+=v*v;peak=Math.max(peak,Math.abs(v));}
    const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',Uint8Array.from(atob(data),c=>c.charCodeAt(0))))).map(n=>n.toString(16).padStart(2,'0')).join('');
    assets.push({name,sha256:hash,duration:decoded.duration,channels:decoded.numberOfChannels,sampleRate:decoded.sampleRate,frames:decoded.length,rms:Math.sqrt(energy/(decoded.length*decoded.numberOfChannels)),peak,finite});
   }
   await audio.close();
   const THREE=await import('/vendor/three.module.js'),{createCar}=await import('/car.js'),{resolveBuild,DEFAULT_SELECTION}=await import('/catalog.js'),{vehicleAudioAnchors,vehicleAudioScene}=await import('/audio-anchors.js');
   const models=[];
   for(const carId of ['hachi','atlas','kitsune','vector']){
    const build=resolveBuild({...DEFAULT_SELECTION,carId}),scene=new THREE.Scene(),car=createCar(scene,build),state={x:8,z:-4,heading:.7,bodyPitch:.18,bodyRoll:-.1,bodyHeight:.12},fallback=vehicleAudioAnchors(build,state);
    car.group.position.set(state.x,0,state.z);car.group.rotation.y=state.heading;car.update(state,0,0);const anchors=car.getAudioAnchors(),layout=vehicleAudioScene(build,state,{audioAnchors:anchors,listenerPosition:{x:2,y:3,z:-6},listenerRight:{x:1,y:0,z:0}},1);
    let maxError=0;for(const [key,point]of Object.entries(fallback)){if(!anchors[key])continue;const a=Array.isArray(point)?point:[point],b=Array.isArray(anchors[key])?anchors[key]:[anchors[key]];for(let i=0;i<a.length;i++)for(const axis of ['x','y','z'])maxError=Math.max(maxError,Math.abs(a[i][axis]-b[i][axis]));}
    models.push({carId,outlets:anchors.exhaust.length,maxFallbackError:maxError,emitters:layout.scene.emitters.length});car.dispose();
   }
   return {assets,models};
  });
  for(const a of result.assets){assert.ok(a.finite);assert.equal(a.channels,2);assert.ok(a.duration>30);assert.ok(a.rms>.02&&a.peak<=1.01);}
  for(const m of result.models){assert.ok(m.maxFallbackError<1e-6,JSON.stringify(m));assert.equal(m.outlets,m.carId==='kitsune'?1:2);}
  result.status='passed';result.scope='Real Chromium decodeAudioData and car model transform checks; no speaker or headphone listening claim.';
  fs.writeFileSync(path.join(__dirname,'audio-v12-browser-results.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
