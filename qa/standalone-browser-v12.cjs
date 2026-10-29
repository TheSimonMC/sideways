const path=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict'),{pathToFileURL}=require('node:url');
const modules=process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES;
const {chromium}=modules?require(path.join(modules,'playwright')):require('playwright');
(async()=>{
 const launch={headless:true,args:['--enable-unsafe-swiftshader']};if(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE)launch.executablePath=process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
 const browser=await chromium.launch(launch),page=await browser.newPage({viewport:{width:1366,height:768}}),errors=[],external=[];
 try{
  const file=path.resolve(__dirname,'../dist/SIDEWAYS.html'),entryURL=pathToFileURL(file).href;
  page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',route=>{const url=route.request().url();if(/^https?:/.test(url)||url.startsWith('file:')&&url!==entryURL){external.push(url);return route.abort();}return route.continue();});
  await page.goto(entryURL);await page.waitForFunction(()=>window.sidewaysDiagnostics?.().phase==='menu',null,{timeout:90000});
  assert.equal(await page.evaluate(()=>sidewaysDiagnostics().version),12);
  await page.evaluate(()=>{window.testPad={id:'Xbox Controller QA',index:0,mapping:'standard',connected:true,axes:[0,0,0,0],buttons:Array.from({length:18},()=>({value:0,pressed:false})),timestamp:0};Object.defineProperty(navigator,'getGamepads',{value:()=>[testPad],configurable:true});});
  // Synchronize emulated hardware to rendered frames. A wall-clock sleep can
  // elapse before a slow software-rendered frame samples the button at all.
  const frames=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const pad=async index=>{await frames();await page.evaluate(i=>{testPad.buttons[i]={value:1,pressed:true};testPad.timestamp=performance.now();},index);await frames();await page.evaluate(i=>{testPad.buttons[i]={value:0,pressed:false};testPad.timestamp=performance.now();},index);await frames();};
  await page.locator('#settings-button').click();await page.locator('#settings-tab-audio').click();await page.locator('#volume-range').focus();const volume=Number(await page.locator('#volume-range').inputValue());await page.keyboard.press('ArrowLeft');await page.waitForTimeout(350);assert.ok(Number(await page.locator('#volume-range').inputValue())<volume);
  await pad(4);assert.equal(await page.locator('#settings-tab-visuals').getAttribute('aria-selected'),'true');await pad(4);assert.equal(await page.locator('#settings-tab-drive').getAttribute('aria-selected'),'true');await page.locator('#controls-button').click();await pad(1);assert.equal(await page.evaluate(()=>document.activeElement.id),'controls-button');await pad(1);await page.locator('#modal-wrap').waitFor({state:'hidden'});
  console.log('PASS offline settings, keyboard taps and controller Back');
  await page.locator('#multiplayer-button').click();await page.locator('#lobby-modal summary').focus();await pad(0);assert.equal(await page.locator('#lobby-modal details').getAttribute('open'),'');assert.equal(await page.locator('#menu').getAttribute('inert'),'');await page.locator('#network-password').focus();await page.keyboard.press('Tab');assert.ok(await page.evaluate(()=>document.activeElement.closest('#lobby-modal')!==null));
  await page.locator('#lobby-name').focus();await pad(0);await page.locator('#text-keyboard').waitFor({state:'visible'});await page.locator('#keyboard-clear').click();await page.locator('#keyboard-key-1-0').focus();await pad(0);await page.locator('#keyboard-done').focus();await pad(0);assert.equal(await page.locator('#lobby-name').inputValue(),'q');assert.equal(await page.evaluate(()=>document.activeElement.id),'lobby-name');await pad(0);await page.locator('#keyboard-key-1-1').focus();await pad(0);await pad(1);assert.equal(await page.locator('#lobby-name').inputValue(),'q');await pad(1);await page.locator('#modal-wrap').waitFor({state:'hidden'});
  console.log('PASS offline lobby modal and controller keyboard');
  await page.locator('#garage-button').click();await page.locator('#garage-category-exhaust').click();await page.waitForTimeout(250);
  assert.equal(await page.locator('#garage-option-cards .part-card').count(),3);
  const wallet=await page.evaluate(()=>sidewaysDiagnostics().career.wallet);
  await page.locator('[data-nav-key="part-exhaust-sport"]').click();
  assert.equal(await page.evaluate(()=>sidewaysDiagnostics().career.wallet),wallet,'Preview must not spend points');
  assert.match(await page.locator('#garage-apply').textContent(),/2,900/);await page.locator('#garage-apply').focus();await pad(0);await page.locator('#modal-wrap').waitFor({state:'hidden'});
  assert.equal(await page.evaluate(()=>sidewaysDiagnostics().build.exhaust),'sport');assert.equal(await page.evaluate(()=>sidewaysDiagnostics().career.wallet),wallet-2900);
  await page.locator('#garage-button').click();await page.locator('#garage-category-exhaust').click();assert.match(await page.locator('[data-nav-key="part-exhaust-sport"]').textContent(),/OWNED/);
  await page.locator('#garage-apply').click();await page.locator('#modal-wrap').waitFor({state:'hidden'});assert.equal(await page.evaluate(()=>sidewaysDiagnostics().career.wallet),wallet-2900,'Owned parts must not charge again');
  console.log('PASS offline part purchase, installation and ownership');
  await page.locator('[data-mode="race"]').click();await page.locator('#start-button').click();await page.waitForFunction(()=>sidewaysDiagnostics().phase==='playing',null,{timeout:90000});
  console.log('PASS offline Club Race startup');
  await pad(8);await page.locator('#map-modal').waitFor({state:'visible'});assert.equal(await page.evaluate(()=>document.activeElement.id),'full-map');await pad(8);assert.notEqual(await page.evaluate(()=>document.activeElement.id),'full-map');await pad(8);assert.equal(await page.evaluate(()=>document.activeElement.id),'full-map');await pad(1);await page.locator('#modal-wrap').waitFor({state:'hidden'});
  await page.keyboard.down('w');await page.waitForTimeout(2000);await page.keyboard.up('w');const drive=await page.evaluate(()=>sidewaysDiagnostics());
  assert.ok(drive.rpm>0);assert.ok(drive.speed>0);assert.equal(drive.mode,'race');assert.ok(drive.audio.nativeListener.scene.emitters.length>=10);assert.equal(errors.length,0,errors.join('\n'));assert.equal(external.length,0,'Unexpected external runtime requests');
  await page.screenshot({path:path.resolve(__dirname,'../../standalone-v12-driving.png')});
  const result={status:'passed',checks:['file:// load with all HTTP(S) and secondary file requests blocked','Settings keyboard range, simulated shoulder tabs and nested Back focus restoration','Lobby summary activation, modal Tab trap and controller keyboard commit/cancel','V12 menu and garage cards load from one file','Part preview preserves wallet; controller buy and install charges exactly once; owned parts stay free','Club Race starts; View switches map/panel focus; Back resumes driving; keyboard throttle moves car','native model emitters available in standalone','no JavaScript errors or external runtime requests'],htmlSha256:require('node:crypto').createHash('sha256').update(fs.readFileSync(file)).digest('hex'),speed:drive.speed,errors,external,limits:['Isolated Chromium software renderer with simulated standard Gamepad API; not a physical controller or listening test.']};
  fs.writeFileSync(path.join(__dirname,'standalone-browser-v12-results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }catch(error){await page.screenshot({path:path.resolve(__dirname,'../../standalone-v12-failure.png')}).catch(()=>{});console.error(JSON.stringify(await page.evaluate(()=>window.sidewaysDiagnostics?.()).catch(()=>null)));throw error;}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
