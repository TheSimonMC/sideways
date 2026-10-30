const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{pathToFileURL}=require('node:url');
const {chromium}=require(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'playwright'));
(async()=>{
 const file=path.resolve(__dirname,'../dist/SIDEWAYS.html'),url=pathToFileURL(file).href,htmlSha256=crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
 const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,args:['--enable-unsafe-swiftshader']}),errors=[],external=[],checks=[],views=[];
 try{
  for(const [carId,engineId]of [['hachi','i6t'],['atlas','v8'],['kitsune','rotary'],['vector','i4']]){
   const context=await browser.newContext({viewport:{width:1440,height:900}}),page=await context.newPage();page.on('pageerror',e=>errors.push(carId+': '+e.message));
   await page.route('**/*',r=>{const u=r.request().url();if(/^https?:/.test(u)||u.startsWith('file:')&&u!==url){external.push(u);return r.abort();}return r.continue();});
   await page.addInitScript(({carId,engineId})=>{if(!sessionStorage.getItem('panels-seeded')){sessionStorage.setItem('panels-seeded','1');localStorage.setItem('sideways-v1',JSON.stringify({quality:'medium',build:{carId,engineId},career:{}}));}},{carId,engineId});
   await page.goto(url);await page.waitForFunction(()=>window.sidewaysDiagnostics?.().phase==='menu',null,{timeout:90000});assert.equal(await page.evaluate(()=>sidewaysDiagnostics().version),28);
   await page.locator('#garage-button').click();for(const id of ['hood','left','right','boot'])await page.locator('#garage-open-'+id).click();
   await page.waitForFunction(()=>{const v=sidewaysDiagnostics().bodyViews;return v.hood.rotation.x<-.8&&v.left.rotation.y>.8&&v.right.rotation.y<-.8&&v.boot.rotation.x>.8;},null,{timeout:30000});
   const open=await page.evaluate(()=>sidewaysDiagnostics());assert.ok(Object.values(open.bodyViews).every(x=>x.visible));assert.equal(open.build.carId,carId);assert.equal(open.build.engineId,engineId);assert.equal(open.bodyDamage.zones.hood.open,true);views.push({carId,parts:open.bodyViews});
   await page.screenshot({path:path.resolve(__dirname,'../../v28-panels-'+carId+'.png')});
   const save=await page.evaluate(()=>JSON.parse(localStorage.getItem('sideways-v1')));for(const id of ['hood','left','right','boot'])assert.equal(save.garageState[carId].bodyDamage.zones[id].open,true);
   await page.reload();await page.waitForFunction(()=>window.sidewaysDiagnostics?.().phase==='menu',null,{timeout:90000});await page.waitForFunction(()=>sidewaysDiagnostics().bodyViews.left.rotation.y>.8);await page.locator('#garage-button').click();
   for(const id of ['hood','left','right','boot'])await page.locator('#garage-open-'+id).click();await page.waitForFunction(()=>Math.abs(sidewaysDiagnostics().bodyViews.hood.rotation.x)<.001);assert.equal(await page.locator('#garage-open-hood').getAttribute('aria-pressed'),'false');
   if(carId==='hachi'){
    await page.setViewportSize({width:390,height:844});await page.locator('#garage-open-hood').click();await page.waitForFunction(()=>sidewaysDiagnostics().bodyViews.hood.rotation.x<-.8);assert.equal(await page.locator('#garage-open-left').isVisible(),true);await page.screenshot({path:path.resolve(__dirname,'../../v28-panels-mobile.png')});await page.locator('#garage-open-hood').click();
    await page.setViewportSize({width:900,height:480});await page.locator('#garage-open-left').click();await page.waitForFunction(()=>sidewaysDiagnostics().bodyViews.left.rotation.y>.8);await page.screenshot({path:path.resolve(__dirname,'../../v28-panels-landscape.png')});await page.locator('#garage-open-left').click();await page.setViewportSize({width:1440,height:900});checks.push('Portrait mobile and short landscape retain working, reachable panel controls');

    await page.evaluate(()=>{const s=JSON.parse(localStorage.getItem('sideways-v1'));const b=s.garageState.hachi.bodyDamage;b.zones.left.detached=true;b.zones.left.health=0;b.zones.left.mounts=0;b.revision++;localStorage.setItem('sideways-v1',JSON.stringify(s));});
    await page.reload();await page.waitForFunction(()=>window.sidewaysDiagnostics?.().phase==='menu',null,{timeout:90000});await page.locator('#garage-button').click();assert.equal(await page.locator('#garage-open-left').isDisabled(),true);assert.equal(await page.evaluate(()=>sidewaysDiagnostics().bodyViews.left.visible),false);assert.equal(await page.evaluate(()=>sidewaysDiagnostics().bodyMass.missingMass),29);await page.screenshot({path:path.resolve(__dirname,'../../v28-missing-door.png')});
    await page.locator('#garage-modal .close-modal').click();await page.locator('#start-button').click();await page.waitForFunction(()=>sidewaysDiagnostics().phase==='playing',null,{timeout:180000});assert.equal(await page.evaluate(()=>sidewaysDiagnostics().bodyDamage.zones.left.detached),false);assert.equal(await page.evaluate(()=>sidewaysDiagnostics().bodyViews.left.visible),true);checks.push('Saved missing door is absent in the garage, disables its opener and reduces mass; a new run restores the serviced car');
   }
   checks.push(carId+': all four visible hinges respond to real garage controls, persist through reload, close and update accessible button states');await context.close();console.log('PASS garage panels',carId);
  }
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.equal(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),htmlSha256);
  fs.writeFileSync(path.join(__dirname,'body-panels-browser-v28-results.json'),JSON.stringify({status:'passed',version:28,htmlSha256,checks,views,errors,external,limits:['Chromium software renderer, fixtures seeded through the existing save format, real UI thereafter.','No physical controller or calibrated GPU performance claim.']},null,2));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
