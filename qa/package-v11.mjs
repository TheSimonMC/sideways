import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {makeZip,verifyZip} from './archive.mjs';
import MotorLab from '../sdk/motor-engine.mjs';

const root=fileURLToPath(new URL('../',import.meta.url)),release=path.join(root,'release');
const hash=data=>createHash('sha256').update(data).digest('hex');
const omitted=new Set(['dist/downloads.html','dist/downloads','qa/package-v11-results.json','qa/release-v11.json','qa/zip-v11-results.json']);
async function collect(directory,prefix=''){
 const files=[];
 for(const entry of(await fs.readdir(directory,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name,'en'))){
  const name=prefix+entry.name;if(omitted.has(name)||entry.name==='__pycache__')continue;
  const source=path.join(directory,entry.name);assert.ok(!entry.isSymbolicLink(),'Symlink in package input: '+name);
  if(entry.isDirectory())files.push(...await collect(source,name+'/'));
  else if(entry.isFile()){
   if(prefix.startsWith('qa/')&&!/\.(?:js|mjs|cjs|py|json|md|txt)$/.test(name))continue;
   const stat=await fs.stat(source),data=await fs.readFile(source);files.push({name,source,data,size:stat.size,mtimeMs:stat.mtimeMs});
  }
 }
 return files;
}
const dist=await collect(path.join(root,'dist'),'dist/'),byName=new Map(dist.map(f=>[f.name,f]));
for(const name of ['index.html','SIDEWAYS.html','main.js','race.js','race-ui.js','body-damage.js','style.css','audio/radio-kit.js','audio/npc-engines.js','audio/geometry.js','vendor/motor-engine.js'])assert.ok(byName.get('dist/'+name)?.data.length,'Missing game file '+name);
assert.equal(MotorLab.version,'1.6.3');
const standalone=byName.get('dist/SIDEWAYS.html');
assert.ok(dist.every(f=>f===standalone||f.mtimeMs<=standalone.mtimeMs+1),'Run node build.mjs after all runtime edits');
const html=standalone.data.toString();assert.ok(!html.includes('.chatgpt.site'),'The game must not point at Sites');
assert.ok(html.includes('MotorLab SDK 1.6.3.')&&html.includes('id="race-standings"'));
assert.ok(!/<script\b[^>]*\bsrc=/i.test(html)&&!/<link\b[^>]*\brel=["']stylesheet["']/i.test(html),'Standalone still needs external runtime files');
assert.ok(byName.get('dist/vendor/motor-engine.js').data.equals(await fs.readFile(path.join(root,'sdk/motor-engine.js'))),'SDK browser mirror differs');

const sources=[...dist];
for(const dir of ['sdk','docs','qa'])sources.push(...await collect(path.join(root,dir),dir+'/'));
for(const name of ['README.md','package.json','package-lock.json','build.mjs','.github/workflows/pages.yml']){
 const source=path.join(root,name),stat=await fs.stat(source);sources.push({name,source,data:await fs.readFile(source),size:stat.size,mtimeMs:stat.mtimeMs});
}
const readme=Buffer.from('SIDEWAYS / CITY SESSIONS V11\n\n1. Extract this ZIP.\n2. Open SIDEWAYS.html in a current browser.\n3. Click or press a key to enable sound.\n\nSingle-player works offline, including Club Race against five rivals.\nNo Sites address is needed. Multiplayer requires an internet connection.\n\nThe dist folder is the editable modular game. sdk contains MotorLab 1.6.3.\nREADME.md explains the game, controls, parts, damage and source build.\nAudio credits: dist/audio/ATTRIBUTION.txt. All included license files apply.\nYour career saves in the browser where you play. Copying this file does\nnot transfer browser storage.\n\nTo rebuild: npm ci, then node build.mjs (Node.js24).\nFor an optional static hosting folder: node qa/package-v11.mjs.\n');
const entries=sources.map(file=>({name:file.name==='dist/SIDEWAYS.html'?'SIDEWAYS.html':file.name,data:file.data}));
entries.push({name:'READ-ME.txt',data:readme});
const manifest={game:'SIDEWAYS',version:11,sdkVersion:MotorLab.version,entry:'SIDEWAYS.html',offlineSinglePlayer:true,files:Object.fromEntries(entries.map(e=>[e.name,{bytes:e.data.length,sha256:hash(e.data)}]))};
entries.push({name:'package-manifest.json',data:Buffer.from(JSON.stringify(manifest,null,2)+'\n')});
assert.ok(entries.every(e=>!e.name.endsWith('.zip')&&!e.name.startsWith('.git/')&&!e.name.startsWith('.openai/')&&!e.name.startsWith('release/')),'Generated, private or repository metadata leaked into package');
const archive=makeZip(entries);verifyZip(archive,entries);
for(const file of sources){const stat=await fs.stat(file.source);assert.equal(stat.size,file.size,'Input changed while packaging: '+file.name);assert.equal(stat.mtimeMs,file.mtimeMs,'Input changed while packaging: '+file.name);}

await fs.mkdir(release,{recursive:true});
const targets=[{name:'SIDEWAYS-v11.html',data:standalone.data},{name:'SIDEWAYS-v11.zip',data:archive}];
for(const target of targets){const filename=path.join(release,target.name);await fs.writeFile(filename+'.tmp',target.data);await fs.rename(filename+'.tmp',filename);}
// An optional self-hosting folder. It is never uploaded by this script.
const staging=path.join(release,'.pages-v11-tmp'),pages=path.join(release,'pages');await fs.rm(staging,{recursive:true,force:true});await fs.mkdir(staging,{recursive:true});
for(const file of dist){const target=path.join(staging,file.name.slice(5));await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,file.data);}
await fs.writeFile(path.join(staging,'.nojekyll'),'');
await fs.rm(pages,{recursive:true,force:true});await fs.rename(staging,pages);
const report={version:11,status:'passed',files:entries.length,artifacts:targets.map(t=>({path:'release/'+t.name,bytes:t.data.length,sha256:hash(t.data)})),checks:['Standalone contains all runtime code and new SDK/racing modules.','No Sites link or runtime dependency appears in the HTML.','Supplied SDK browser bytes match the installed runtime.','Complete source, SDK, QA, documentation and licenses are included.','ZIP entries round-trip with exact bytes and CRC32.','No nested ZIP, build output, Git metadata or private Site metadata is included.','Inputs remained unchanged during packaging.','Root SIDEWAYS.html provides one-file offline play.'],limits:['Packaging does not test a browser save dialog or another physical PC.','No external website or repository is published.']};
await fs.writeFile(path.join(root,'qa/package-v11-results.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
