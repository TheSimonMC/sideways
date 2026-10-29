import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {makeZip,verifyZip} from './archive.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const output=path.resolve(process.argv[2]||path.join(root,'release'));
const hash=data=>createHash('sha256').update(data).digest('hex');
const entries=[];
async function collect(relative){
 for(const item of await fs.readdir(path.join(root,relative),{withFileTypes:true})){
  const name=relative+'/'+item.name;if(item.name==='__pycache__'||name==='dist/downloads'||name==='dist/downloads.html'||name==='dist/SIDEWAYS.html')continue;
  assert.ok(!item.isSymbolicLink(),'No symlinks in release');
  if(item.isDirectory())await collect(name);else if(item.isFile())entries.push({name,data:await fs.readFile(path.join(root,name))});
 }
}
for(const dir of ['dist','sdk','docs','qa'])await collect(dir);
for(const name of ['README.md','READ-ME-V14.txt','kontext.md','package.json','package-lock.json','build.mjs'])entries.push({name,data:await fs.readFile(path.join(root,name))});
const html=await fs.readFile(path.join(root,'dist/SIDEWAYS.html')),text=html.toString();
assert.ok(!/<script\b[^>]*\bsrc=|<link\b[^>]*\brel=["']stylesheet["']|\.chatgpt\.site/i.test(text));
assert.ok(text.includes('CITY SESSIONS / V14'));
assert.ok((await fs.readFile(path.join(root,'sdk/motor-engine.js'))).equals(await fs.readFile(path.join(root,'dist/vendor/motor-engine.js'))));
const checked=JSON.parse(await fs.readFile(path.join(root,'qa/standalone-browser-v14-results.json')));assert.equal(checked.status,'passed');assert.equal(checked.htmlSha256,hash(html),'Browser test must cover these exact standalone bytes');
entries.push({name:'SIDEWAYS.html',data:html});
const manifest={game:'SIDEWAYS',version:14,entry:'SIDEWAYS.html',sdk:'1.6.3 + SIDEWAYS spatial extension',files:Object.fromEntries(entries.map(e=>[e.name,{bytes:e.data.length,sha256:hash(e.data)}]))};
entries.push({name:'package-manifest.json',data:Buffer.from(JSON.stringify(manifest,null,2))});
assert.ok(entries.every(e=>!e.name.endsWith('.zip')&&!/(^|\/)(?:node_modules|node-cache|\.git|\.openai)(\/|$)/.test(e.name)));
const zip=makeZip(entries);verifyZip(zip,entries);await fs.mkdir(output,{recursive:true});
await fs.writeFile(path.join(output,'SIDEWAYS-v14.html'),html);await fs.writeFile(path.join(output,'SIDEWAYS-v14.zip'),zip);
console.log(JSON.stringify({status:'passed',entries:entries.length,html:{bytes:html.length,sha256:hash(html)},zip:{bytes:zip.length,sha256:hash(zip)}}));
