const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.SIDEWAYS_PLAYWRIGHT||'playwright');
const out=process.env.SIDEWAYS_SHOTS||path.resolve(__dirname,'../qa/browser-v12');fs.mkdirSync(out,{recursive:true});
const report={status:'pending',checks:[],errors:[],selection:process.env.SIDEWAYS_TEST_ONLY||'all',limit:'Chromium headless with software WebGL and simulated standard Gamepad API. No physical controller, speaker listening or live multiplayer claim.'};
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.SIDEWAYS_BROWSER?{executablePath:process.env.SIDEWAYS_BROWSER}:{}),args:['--enable-unsafe-swiftshader','--disable-dev-shm-usage']});
 const page=await browser.newPage({viewport:{width:1440,height:900}});page.on('pageerror',e=>report.errors.push(e.message));page.setDefaultTimeout(25000);
 await page.addInitScript(()=>{
  localStorage.setItem('sideways-v1',JSON.stringify({quality:'medium'}));
  window.testPad={id:'Xbox Controller QA',index:0,mapping:'standard',connected:true,axes:[0,0,0,0],buttons:Array.from({length:18},()=>({value:0,pressed:false})),timestamp:0};
  Object.defineProperty(navigator,'getGamepads',{value:()=>[window.testPad]});
 });
 const check=async(name,fn)=>{if(process.env.SIDEWAYS_TEST_ONLY&&!new RegExp(process.env.SIDEWAYS_TEST_ONLY,'i').test(name))return;await fn();report.checks.push(name);console.log('PASS '+name);};
 const wait=ms=>page.waitForTimeout(ms);
 const pad=async index=>{await page.evaluate(i=>{testPad.buttons[i]={value:1,pressed:true};testPad.timestamp=performance.now();},index);await wait(300);await page.evaluate(i=>{testPad.buttons[i]={value:0,pressed:false};testPad.timestamp=performance.now();},index);await wait(300);};
 const key=async code=>{await page.keyboard.down(code);await wait(220);await page.keyboard.up(code);await wait(200);};
 const shot=async name=>page.screenshot({path:path.join(out,name+'.png')});
 try{
  await page.goto(process.env.SIDEWAYS_URL||'http://127.0.0.1:8765',{waitUntil:'load'});await page.waitForFunction(()=>window.sidewaysDiagnostics?.().phase==='menu'&&!document.getElementById('menu').classList.contains('hidden'),{},{timeout:90000});await wait(800);
  await check('Actual keyboard slider arrows, shoulder tabs and nested Back restoration',async()=>{
   await page.locator('#settings-button').click();await page.locator('#settings-tab-audio').click();await page.locator('#volume-range').focus();const before=await page.locator('#volume-range').inputValue();await key('ArrowLeft');const after=await page.locator('#volume-range').inputValue();assert.ok(Number(after)<Number(before));
   await pad(4);assert.equal(await page.locator('#settings-tab-visuals').getAttribute('aria-selected'),'true');await pad(4);assert.equal(await page.locator('#settings-tab-drive').getAttribute('aria-selected'),'true');
   await page.locator('#controls-button').click();await pad(1);assert.equal(await page.evaluate(()=>document.activeElement.id),'controls-button');assert.equal(await page.locator('#settings-modal').isVisible(),true);await shot('settings-v12');await pad(1);await page.locator('#modal-wrap').waitFor({state:'hidden'});
  });
  await check('Browser modal Tab trap, summary activation and controller text commit/cancel',async()=>{
   await page.locator('#multiplayer-button').click();await wait(250);const summary=page.locator('#lobby-modal summary');await summary.focus();await pad(0);assert.equal(await page.locator('#lobby-modal details').getAttribute('open'),'');
   const last=page.locator('#network-password');await last.focus();await key('Tab');assert.equal(await page.evaluate(()=>document.activeElement.closest('#lobby-modal')!==null),true);assert.equal(await page.locator('#menu').getAttribute('inert'),'');
   await page.locator('#lobby-name').focus();const original=await page.locator('#lobby-name').inputValue();await pad(0);assert.equal(await page.locator('#text-keyboard').isVisible(),true);await page.locator('#keyboard-clear').click();await page.locator('#keyboard-key-1-0').focus();await pad(0);await page.locator('#keyboard-done').focus();await pad(0);assert.equal(await page.locator('#lobby-name').inputValue(),'q');assert.equal(await page.evaluate(()=>document.activeElement.id),'lobby-name');
   await pad(0);await page.locator('#keyboard-key-1-1').focus();await pad(0);await pad(1);assert.equal(await page.locator('#lobby-name').inputValue(),'q');assert.equal(await page.locator('#lobby-modal').isVisible(),true);await shot('lobby-v12');await pad(1);
  });
  await check('Garage cards enforce budget, preview without spending and restore the installed build on Cancel',async()=>{
   const before=await page.evaluate(()=>({build:sidewaysDiagnostics().build,career:sidewaysDiagnostics().career}));await page.locator('#garage-button').click();await page.locator('#garage-category-engine').click();await page.locator('#garage-option-cards .part-card').last().click();assert.equal(await page.locator('#garage-apply').isDisabled(),true);
   assert.deepEqual(await page.evaluate(()=>sidewaysDiagnostics().build),before.build);assert.equal((await page.evaluate(()=>sidewaysDiagnostics().career)).wallet,before.career.wallet);await pad(1);assert.deepEqual(await page.evaluate(()=>sidewaysDiagnostics().build),before.build);await page.locator('#modal-wrap').waitFor({state:'hidden'});
  });
  await check('Paid garage installation charges once, installs the chosen part and retains ownership',async()=>{
   const before=await page.evaluate(()=>sidewaysDiagnostics().career.wallet);await page.locator('#garage-button').click();await page.locator('#garage-category-exhaust').click();await page.locator('[data-nav-key="part-exhaust-sport"]').click();assert.equal(await page.locator('#garage-apply').isEnabled(),true);assert.match(await page.locator('#garage-apply').textContent(),/2,900/);await page.locator('#garage-apply').focus();await pad(0);await page.locator('#modal-wrap').waitFor({state:'hidden'});
   assert.equal(await page.evaluate(()=>sidewaysDiagnostics().build.exhaust),'sport');assert.equal(await page.evaluate(()=>sidewaysDiagnostics().career.wallet),before-2900);await page.locator('#garage-button').click();await page.locator('#garage-category-exhaust').click();assert.match(await page.locator('[data-nav-key="part-exhaust-sport"]').textContent(),/OWNED/);await page.locator('#garage-apply').focus();await pad(0);await page.locator('#modal-wrap').waitFor({state:'hidden'});assert.equal(await page.evaluate(()=>sidewaysDiagnostics().career.wallet),before-2900);
  });
  await check('Free roam starts and map View switches cursor/panel without closing; Back returns to drive',async()=>{
   await page.locator('[data-mode="free"]').click();await page.locator('#start-button').click();await page.waitForFunction(()=>sidewaysDiagnostics().phase==='playing',{},{timeout:90000});await wait(600);await shot('hud-v12');
   await pad(8);await page.waitForSelector('#map-modal:not(.hidden)');assert.equal(await page.evaluate(()=>document.activeElement.id),'full-map');await pad(8);assert.notEqual(await page.evaluate(()=>document.activeElement.id),'full-map');assert.equal(await page.locator('#map-modal').isVisible(),true);await pad(8);assert.equal(await page.evaluate(()=>document.activeElement.id),'full-map');await pad(1);await page.locator('#modal-wrap').waitFor({state:'hidden'});
  });
  await check('Club Race loads opponents, enters countdown and begins racing',async()=>{
   await key('Escape');await page.waitForFunction(()=>sidewaysDiagnostics().phase==='menu');await page.locator('[data-mode="race"]').click();await page.locator('#start-button').click();await page.waitForFunction(()=>sidewaysDiagnostics().phase==='countdown'||sidewaysDiagnostics().phase==='playing',{},{timeout:90000});await page.waitForFunction(()=>sidewaysDiagnostics().phase==='playing',{},{timeout:120000});const d=await page.evaluate(()=>sidewaysDiagnostics());assert.equal(d.mode,'race');assert.ok(d.race);await shot('race-v12');report.race={phase:d.phase,race:d.race};
  });
  assert.deepEqual(report.errors,[]);report.status='passed';
 }catch(error){report.status='failed';report.failure=error.stack;await shot('navigation-failure').catch(()=>{});throw error;}
 finally{fs.writeFileSync(path.join(out,'browser-navigation-v12-results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
