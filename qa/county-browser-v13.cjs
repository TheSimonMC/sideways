const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'playwright'));
const root=path.resolve(__dirname,'../dist');
const html=`<!doctype html><style>body{margin:0}</style><script type="module">
import * as THREE from '/vendor/three.module.js';import {createCity} from '/region.js';
const scene=new THREE.Scene();scene.background=new THREE.Color(0xa5cad2);const city=createCity(scene);
const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setSize(1440,900);renderer.setPixelRatio(1);renderer.outputColorSpace=THREE.SRGBColorSpace;document.body.append(renderer.domElement);
scene.add(new THREE.HemisphereLight(0xd9f2ff,0x55604a,2.2));const sun=new THREE.DirectionalLight(0xffebcd,2.2);sun.position.set(-600,900,200);scene.add(sun);
const camera=new THREE.PerspectiveCamera(55,1440/900,.2,9000);
window.view=(name)=>{const poses={overview:[[2800,2900,3000],[0,0,-500]],hills:[[-1700,420,-2450],[-1000,110,-1870]],roundabout:[[-1160,135,130],[-1050,0,0]],highway:[[1970,60,720],[1920,0,400]]};const [p,t]=poses[name];camera.position.set(...p);camera.lookAt(...t);renderer.render(scene,camera);return {drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles};};window.ready=true;
</script>`;
(async()=>{
 const server=http.createServer((req,res)=>{const p=decodeURIComponent((req.url||'/').split('?')[0]);if(p==='/'){res.setHeader('Content-Type','text/html');return res.end(html);}const file=path.resolve(root,'.'+p);if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.statusCode=404;return res.end();}res.setHeader('Content-Type',p.endsWith('.js')?'text/javascript':'application/octet-stream');fs.createReadStream(file).pipe(res);});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,args:['--enable-unsafe-swiftshader']});const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[],views={};page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>window.ready,null,{timeout:90000});for(const name of ['overview','hills','roundabout','highway']){views[name]=await page.evaluate(name=>window.view(name),name);await page.screenshot({path:path.resolve(__dirname,'../../v13-'+name+'.png')});}assert.deepEqual(errors,[]);const report={version:13,status:'passed',views,errors,limits:['Static regional views in Chromium software rendering; visual assessment is separate from geometric road checks.']};fs.writeFileSync(path.join(__dirname,'county-browser-v13-results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));}finally{await browser?.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
