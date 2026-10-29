import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {inflateRawSync,crc32} from 'node:zlib';
import {parseHTML,Target,EventStub} from './dom-v5-harness.mjs';

const root=new URL('../',import.meta.url);
const read=path=>fs.readFileSync(new URL(path,root));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const paths={page:'dist/downloads.html',html:'dist/SIDEWAYS.html',zip:'dist/downloads/SIDEWAYS-v10-pages.zip',release:'release/SIDEWAYS-v10-pages.zip'};
const input=Object.fromEntries(Object.entries(paths).map(([key,path])=>[key,read(path)]));
const page=input.page.toString(),script=[...page.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)][0]?.[1];
assert.ok(script,'Downloads page must contain its inline handler');new vm.Script(script,{filename:'downloads.html'});
const report={version:10,status:'pending',checks:[],fixtures:{},verificationLimit:'Actual downloads.html handlers in a functional DOM, with native Response/Blob streams and the built V10 payloads. ZIP content and bytes are checked locally. No real HTTP transfer, browser save dialog, visual layout or multiple-PC test is claimed.'};
const site='https://sideways-dock-09-q7v4.pizzadanielyt.chatgpt.site';
const passed=(name,fixture)=>{report.checks.push(name);if(fixture)report.fixtures[name]=fixture;console.log('PASS '+name);};

function setup({origin=site,fetcher=async()=>new Response(input.html,{headers:{'Content-Length':String(input.html.length)}})}={}){
 const {doc}=parseHTML(page),window=new Target(),urls=new Map(),timers=new Map(),calls=[];
 class TestURL extends URL{
  static createObjectURL(blob){const id='blob:test/'+urls.size;urls.set(id,blob);return id;}
  static revokeObjectURL(id){urls.delete(id);}
 }
 const ctx={document:doc,window,location:new URL(origin+'/downloads.html'),URL:TestURL,Blob,TextDecoder,Uint8Array,AbortController,
  setTimeout(fn){const id={};timers.set(id,fn);return id;},clearTimeout(id){timers.delete(id);},
  fetch:async(...args)=>{calls.push(args);return fetcher(...args);}};
 vm.runInNewContext(script,ctx,{filename:'downloads.html'});
 return{doc,window,urls,timers,calls,$:id=>doc.getElementById(id)};
}
async function settle(host,kind){
 const deadline=Date.now()+10000;while(Date.now()<deadline){await new Promise(resolve=>setTimeout(resolve,1));if(host.$('download-'+kind).getAttribute('aria-busy')===null)return;}
 throw new Error('Download did not settle: '+kind);
}
function zipEntries(zip){
 const end=zip.length-22;assert.equal(zip.readUInt32LE(end),0x06054b50,'ZIP end record');assert.equal(zip.readUInt16LE(end+20),0,'No ZIP comment expected');
 const count=zip.readUInt16LE(end+10),entries=new Map();let cursor=zip.readUInt32LE(end+16);
 for(let i=0;i<count;i++){
  assert.equal(zip.readUInt32LE(cursor),0x02014b50,'ZIP central record');
  const method=zip.readUInt16LE(cursor+10),packedSize=zip.readUInt32LE(cursor+20),size=zip.readUInt32LE(cursor+24),nameLength=zip.readUInt16LE(cursor+28),extraLength=zip.readUInt16LE(cursor+30),commentLength=zip.readUInt16LE(cursor+32),offset=zip.readUInt32LE(cursor+42),name=zip.subarray(cursor+46,cursor+46+nameLength).toString();
  assert.ok(!entries.has(name),'Duplicate ZIP name');assert.ok(!name.startsWith('/')&&!name.split('/').includes('..'),'Safe relative ZIP name');
  assert.equal(zip.readUInt32LE(offset),0x04034b50,'ZIP local record');assert.equal(method,8,'ZIP uses deflate');
  const start=offset+30+zip.readUInt16LE(offset+26)+zip.readUInt16LE(offset+28),data=inflateRawSync(zip.subarray(start,start+packedSize));
  assert.equal(data.length,size);assert.equal(crc32(data),zip.readUInt32LE(cursor+16));entries.set(name,data);cursor+=46+nameLength+extraLength+commentLength;
 }
 assert.equal(cursor,end);return entries;
}

{
 const h=setup(),link=h.$('download-html');link.click();assert.equal(link.getAttribute('aria-busy'),'true');await settle(h,'html');
 assert.equal(h.urls.size,1);assert.ok(Buffer.from(await [...h.urls.values()][0].arrayBuffer()).equals(input.html));
 assert.equal(link.download,'SIDEWAYS.html');assert.match(link.href,/^blob:/);assert.match(h.$('html-status').textContent,/Save request sent/);assert.match(link.querySelector('.button-label').textContent,/SAVE HTML AGAIN/);
 link.click();assert.equal(h.calls.length,1);assert.equal(h.timers.size,0);
 h.window.emit('pagehide',{persisted:true});assert.equal(h.urls.size,1);h.window.emit('pagehide',{persisted:false});assert.equal(h.urls.size,0);
 passed('Built standalone HTML transfers byte-for-byte into a named Blob; Save Again avoids a refetch and back-forward cache keeps the ready file.',{bytes:input.html.length,sha256:sha(input.html)});
}
{
 const h=setup({fetcher:async()=>new Response(input.zip,{headers:{'Content-Length':String(input.zip.length)}})});
 h.$('download-zip').click();await settle(h,'zip');assert.equal(h.urls.size,1);assert.equal(h.$('download-zip').download,'SIDEWAYS-v10-pages.zip');
 assert.ok(Buffer.from(await [...h.urls.values()][0].arrayBuffer()).equals(input.zip));assert.equal(h.$('zip-progress').getAttribute('aria-valuenow'),'100');assert.equal(h.timers.size,0);
 passed('The hosted V10 ZIP transfers byte-for-byte with its versioned filename and completed progress.',{bytes:input.zip.length,sha256:sha(input.zip)});
}
for(const [label,fetcher,expected]of [
 ['HTTP 404',async()=>new Response('missing',{status:404}),/not available/],
 ['HTTP 403',async()=>new Response('denied',{status:403}),/requires access/],
 ['An HTML login/error page',async()=>new Response('<!doctype html><title>Sign in</title>'+'.'.repeat(2000)),/different page/],
 ['A truncated transfer',async()=>new Response(input.html,{headers:{'Content-Length':String(input.html.length+1)}}),/incomplete/]
]){
 const h=setup({fetcher});h.$('download-html').click();await settle(h,'html');assert.equal(h.urls.size,0);assert.match(h.$('html-status').textContent,expected);assert.equal(h.$('download-html').getAttribute('aria-disabled'),null);assert.equal(h.timers.size,0);
 passed(label+' produces a visible retryable error and does not save a bad file.');
}
{
 const h=setup({origin:'https://example.github.io/game',fetcher:async()=>{throw new Error('Cross-origin fetch should not run');}}),event=new EventStub('click');
 h.$('download-zip').dispatchEvent(event);assert.equal(event.defaultPrevented,false);assert.equal(h.calls.length,0);
 passed('The republished Pages copy leaves the canonical ZIP link to the browser without a cross-origin fetch.');
}
{
 const h=setup({fetcher:(url,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('aborted'))))});
 h.$('download-html').click();h.$('html-cancel').click();await settle(h,'html');assert.match(h.$('html-status').textContent,/cancelled/);assert.equal(h.urls.size,0);assert.equal(h.timers.size,0);
 passed('Cancel aborts an in-flight request, restores retry and releases the timeout.');
}
{
 assert.ok(input.zip.equals(input.release),'Hosted ZIP must match the release ZIP exactly');const entries=zipEntries(input.zip);
 assert.ok(entries.has('index.html')&&entries.has('downloads.html')&&entries.has('.nojekyll'),'Publishing root is complete');
 assert.ok(entries.get('SIDEWAYS.html')?.equals(input.html),'Packaged standalone matches hosted standalone');assert.ok(entries.get('downloads.html')?.equals(input.page),'Packaged downloads page matches hosted page');
 assert.ok([...entries.keys()].every(name=>!name.startsWith('downloads/')&&!/\.zip$/i.test(name)),'The ZIP must exclude generated download payloads and nested ZIPs');
 const manifest=JSON.parse(entries.get('package-manifest.json').toString());assert.equal(manifest.version,10);assert.equal(manifest.files['SIDEWAYS.html'].sha256,sha(input.html));
 passed('The release and hosted ZIP match, contain current V10 HTML and exclude generated downloads to prevent ZIP recursion.',{files:entries.size,version:manifest.version,recursiveArchives:0});
}

report.inputs=Object.entries(paths).map(([key,path])=>{assert.ok(read(path).equals(input[key]),'Release input changed during download checks: '+path);return{path,bytes:input[key].length,sha256:sha(input[key])};});
report.status='passed';fs.writeFileSync(new URL('./downloads-v10-results.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
