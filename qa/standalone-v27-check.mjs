import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const root=new URL('../',import.meta.url);
const html=fs.readFileSync(new URL('dist/SIDEWAYS.html',root),'utf8');
const scripts=[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
assert.equal(scripts.length,2,'two inline runtime scripts');
for(const [i,script] of scripts.entries()){assert.ok(!/\bsrc=/.test(script[1]));new vm.Script(script[2],{filename:'inline-'+i+'.js'})}
assert.ok(!/<link[^>]+rel="stylesheet"/.test(html));assert.ok(!/url\(['"]?(?:fonts\/|https?:)/.test(html));
const index=fs.readFileSync(new URL('dist/index.html',root),'utf8');
const ids=[...index.matchAll(/\bid="([^"]+)"/g)].map(x=>x[1]);assert.equal(new Set(ids).size,ids.length,'unique DOM IDs');
for(const module of ['main.js','controls-ui.js','game-ui.js','phone.js','lobby-panel.js','vehicle-panel.js','race-ui.js']){const code=fs.readFileSync(new URL('dist/'+module,root),'utf8');for(const m of code.matchAll(/(?:\$|byId)\('([^']+)'\)/g))assert.ok(ids.includes(m[1])||['garage-category-cars','map-mark-cursor'].includes(m[1]),module+' references missing #'+m[1]);}
assert.ok(html.includes('<html lang="en">'),'English document language');
assert.ok(!html.includes('href="audio/ATTRIBUTION.txt"'),'Offline audio credits must be embedded');
assert.ok(html.includes('download="SIDEWAYS-audio-credits.txt"'),'Readable downloadable audio credits');
for(const author of ['Umplix','bertsz','Versilian','Kenney','hsaunier10','guitarguy1985'])assert.ok(html.includes(author),'Missing embedded credit: '+author);
assert.ok(html.includes('PeerJS license:'),'PeerJS MIT license embedded');
assert.ok(!/import\(['"]\.\/vendor\/peerjs/.test(html),'PeerJS must be bundled in offline edition');
assert.ok(html.includes('id="full-map" tabindex="0"'),'Controller map canvas is focusable');
assert.ok(html.includes('MotorLab SDK 1.6.3.'),'New SDK is identified in game information');
assert.ok(!html.includes('.chatgpt.site'),'Offline game must not depend on or direct downloads to Sites');
assert.ok(html.includes('data-mode="race"')&&html.includes('id="race-standings"'),'Circuit racing and standings are embedded');
assert.ok(html.includes('panel:')&&html.includes('bodyDamage'),'Modular damage is embedded');
assert.ok(!html.includes('href="downloads.html"'),'Offline file cannot depend on a missing local downloads page');
const result={status:'passed',version:27,bytes:Buffer.byteLength(html),scripts:2,scriptSyntax:'valid',domIds:ids.length,language:'en',embeddedAudioCredits:true,externalRuntimeDependencies:0};fs.writeFileSync(new URL('qa/standalone-v27-results.json',root),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
