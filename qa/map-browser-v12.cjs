// Run against the editable dist folder served by HTTP. Playwright is optional
// QA tooling. The game itself has no Playwright/browser-server dependency.
// Required: SIDEWAYS_TEST_URL (for example http://127.0.0.1:8080/).
// Optional: SIDEWAYS_NODE_MODULES, SIDEWAYS_BROWSER_EXECUTABLE,
// SIDEWAYS_SCREENSHOT_DIR, SIDEWAYS_MAP_REPORT.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{createRequire}=require('node:module');
const moduleRoot=process.env.SIDEWAYS_NODE_MODULES||process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES;
const runtimeRequire=moduleRoot?createRequire(path.join(moduleRoot,'package.json')):require;
const {chromium}=runtimeRequire('playwright');
const base=process.env.SIDEWAYS_TEST_URL;if(!base)throw new Error('Set SIDEWAYS_TEST_URL to the served dist folder.');
const screenshots=process.env.SIDEWAYS_SCREENSHOT_DIR;if(screenshots)fs.mkdirSync(screenshots,{recursive:true});
const reportPath=process.env.SIDEWAYS_MAP_REPORT||path.join(__dirname,'map-browser-v12-results.json');
(async()=>{
 let browser;const report={version:12,status:'pending',assertionScope:'Final component checks only; historical full-game issue is recorded separately below.',errors:[],viewports:[],limits:['Uses the shipped MapPresentation and CSS in a real headless Chromium page with a minimal city fixture. Verifies layout, pointer focus, route callbacks, filter and zoom controls. No WebGL, road routing, physical gamepad or audio claim.']};
 const historyPath=path.join(__dirname,'map-integrated-v12-observations.json');if(fs.existsSync(historyPath))report.previousFullGameCheck=JSON.parse(fs.readFileSync(historyPath,'utf8'));
 try{
  const options={headless:true};if(process.env.SIDEWAYS_BROWSER_EXECUTABLE)options.executablePath=process.env.SIDEWAYS_BROWSER_EXECUTABLE;
  browser=await chromium.launch(options);const page=await browser.newPage({viewport:{width:390,height:844}});page.setDefaultTimeout(10000);
  page.on('pageerror',e=>report.errors.push(e.message));
  const source=fs.readFileSync(path.join(__dirname,'../dist/index.html'),'utf8'),match=source.match(/<section id="map-modal"[^]*?<\/section>/);assert.ok(match,'Map markup exists');
  const html=`<!doctype html><html><head><base href="${base}"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="style.css"><link rel="stylesheet" href="polish-v12.css"><link rel="stylesheet" href="map-v12.css"></head><body class="ui-modal"><div class="modal-wrap">${match[0].replace('map-modal hidden','map-modal')}</div></body></html>`;
  const fixtureUrl=new URL('map-layout-fixture',base).href;await page.route(fixtureUrl,r=>r.fulfill({contentType:'text/html',body:html}));await page.goto(fixtureUrl);
  await page.evaluate(async()=>{
   const {GameUI}=await import('./game-ui.js');window.ui=new GameUI(document);
   window.places=[{kind:'police',name:'Central Precinct',x:0,z:50},{kind:'garage',name:'Motor Works',x:150,z:50},{kind:'fuel',name:'Volt Fuel',x:70,z:90},{kind:'garage',name:'Eastside Customs',x:200,z:100},{kind:'fuel',name:'Garden Fuel',x:-50,z:180}];
   window.route={};window.cursor={x:12,z:17};window.zoom=1;
   window.render=()=>ui.map.render({world:{kind:'city'},player:{x:0,z:0},cursor,route,zoom});
   ui.map.setPlaces(places,{onInspect:p=>{cursor={...p};render();},onChoose:p=>{route={target:{...p},distance:126};cursor={...p};render();},onMark:(p,name)=>{route={target:{...p,name},distance:126};render();}});
   document.getElementById('map-zoom-in').addEventListener('click',()=>{zoom*=1.25;render();});
   document.getElementById('map-clear-route').addEventListener('click',()=>{route={};render();});
   document.querySelector('.map-selection').addEventListener('click',()=>{});
   render();
  });
  for(const[width,height]of[[390,844],[1280,720],[2560,1080]]){
   await page.setViewportSize({width,height});await page.locator('#map-modal').evaluate(el=>el.scrollTop=0);
   const result={width,height,routes:[]};report.viewports.push(result);
   for(const id of [0,4,1,0,4]){
    const button=page.locator('#map-place-'+id),expected=await page.evaluate(i=>places[i].name,id);await button.click();
    const actual=await page.evaluate(()=>route.target?.name);assert.equal(actual,expected,`${width}px POI ${id} must receive click despite focus preview`);result.routes.push(actual);
   }
   await page.locator('[data-map-filter="garage"]').click();const visible=await page.locator('#map-poi-list .map-poi:visible').count();assert.equal(visible,2);
   await page.locator('#map-place-3').click();assert.equal(await page.evaluate(()=>route.target?.name),'Eastside Customs');result.filter='passed';
   await page.locator('[data-map-filter="all"]').click();await page.locator('#map-zoom-in').click();result.zoom=await page.locator('.map-north').textContent();
   result.layout=await page.evaluate(()=>{const m=document.getElementById('map-modal'),list=document.getElementById('map-poi-list');return{modalWidth:m.clientWidth,modalScrollWidth:m.scrollWidth,listWidth:list.clientWidth,listScrollWidth:list.scrollWidth,listHeight:list.clientHeight};});
   assert.ok(result.layout.modalScrollWidth<=result.layout.modalWidth+1);assert.ok(result.layout.listScrollWidth<=result.layout.listWidth+1);assert.ok(result.layout.listHeight>=100);
   await page.locator('#map-modal').evaluate(el=>el.scrollTop=0);await page.locator('.map-sidebar').evaluate(el=>el.scrollTop=0);
   if(screenshots)await page.screenshot({path:path.join(screenshots,`map-component-${width}.png`)});
   console.log('PASS '+width+'×'+height+' service clicks, focus stability, filtering, zoom and horizontal bounds');
  }
  assert.deepEqual(report.errors,[]);report.status='passed';
 }catch(error){report.status='failed';report.failure=error.message;throw error;}
 finally{if(browser)await browser.close();fs.writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');}
})().catch(error=>{console.error(error);process.exitCode=1;});
