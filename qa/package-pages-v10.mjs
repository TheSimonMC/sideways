import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {crc32,deflateRawSync,inflateRawSync} from 'node:zlib';
import MotorLab from '../sdk/motor-engine.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const sha256=data=>createHash('sha256').update(data).digest('hex');
const cleanName=name=>typeof name==='string'&&name.length>0&&!name.startsWith('/')&&!name.includes('\\')&&!name.includes('\0')&&!name.split('/').some(part=>part==='..'||part==='.'||part==='')&&name.length<65536;

/** A deterministic ZIP32 writer. Entries contain regular-file bytes only. */
export function makeZip(entries){
 assert.ok(entries.length<65535,'Too many ZIP entries');const local=[],central=[],names=new Set();let offset=0;
 for(const entry of [...entries].sort((a,b)=>a.name.localeCompare(b.name,'en'))){
  assert.ok(cleanName(entry.name),'Unsafe ZIP entry name');assert.ok(!names.has(entry.name),'Duplicate ZIP entry');names.add(entry.name);
  const name=Buffer.from(entry.name),data=Buffer.from(entry.data),packed=deflateRawSync(data,{level:9}),crc=crc32(data);assert.ok(data.length<0xffffffff&&packed.length<0xffffffff&&offset<0xffffffff,'ZIP32 size limit');
  const header=Buffer.alloc(30);header.writeUInt32LE(0x04034b50,0);header.writeUInt16LE(20,4);header.writeUInt16LE(0x800,6);header.writeUInt16LE(8,8);header.writeUInt16LE(0x21,12);header.writeUInt32LE(crc,14);header.writeUInt32LE(packed.length,18);header.writeUInt32LE(data.length,22);header.writeUInt16LE(name.length,26);local.push(header,name,packed);
  const directory=Buffer.alloc(46);directory.writeUInt32LE(0x02014b50,0);directory.writeUInt16LE(0x0314,4);directory.writeUInt16LE(20,6);directory.writeUInt16LE(0x800,8);directory.writeUInt16LE(8,10);directory.writeUInt16LE(0x21,14);directory.writeUInt32LE(crc,16);directory.writeUInt32LE(packed.length,20);directory.writeUInt32LE(data.length,24);directory.writeUInt16LE(name.length,28);directory.writeUInt32LE((0o100644<<16)>>>0,38);directory.writeUInt32LE(offset,42);central.push(directory,name);offset+=header.length+name.length+packed.length;
 }
 const directory=Buffer.concat(central),end=Buffer.alloc(22);assert.ok(offset+directory.length<0xffffffff,'ZIP32 archive size limit');end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...local,directory,end]);
}

export function verifyZip(zip,entries){
 const end=zip.length-22;assert.equal(zip.readUInt32LE(end),0x06054b50);assert.equal(zip.readUInt16LE(end+10),entries.length);assert.equal(zip.readUInt16LE(end+20),0);const expected=new Map(entries.map(e=>[e.name,Buffer.from(e.data)]));let position=zip.readUInt32LE(end+16);
 for(let i=0;i<entries.length;i++){
  assert.equal(zip.readUInt32LE(position),0x02014b50);const size=zip.readUInt32LE(position+20),rawSize=zip.readUInt32LE(position+24),nameLength=zip.readUInt16LE(position+28),extraLength=zip.readUInt16LE(position+30),commentLength=zip.readUInt16LE(position+32),offset=zip.readUInt32LE(position+42),name=zip.subarray(position+46,position+46+nameLength).toString();assert.ok(expected.has(name),'Unexpected ZIP file');assert.equal(zip.readUInt32LE(offset),0x04034b50);assert.equal(zip.readUInt16LE(offset+8),8);
  const start=offset+30+zip.readUInt16LE(offset+26)+zip.readUInt16LE(offset+28),data=inflateRawSync(zip.subarray(start,start+size));assert.equal(data.length,rawSize);assert.equal(crc32(data),zip.readUInt32LE(position+16));assert.ok(data.equals(expected.get(name)),'ZIP data changed');expected.delete(name);position+=46+nameLength+extraLength+commentLength;
 }
 assert.equal(position,end);assert.equal(expected.size,0);return true;
}

async function readTree(directory,prefix=''){
 const files=[];for(const item of (await fs.readdir(directory,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name,'en'))){
  if(prefix===''&&item.name==='downloads'&&item.isDirectory())continue;
  const source=path.join(directory,item.name),name=prefix+item.name;assert.ok(!item.isSymbolicLink(),'Symlinks cannot be packaged: '+name);
  if(item.isDirectory())files.push(...await readTree(source,name+'/'));else{assert.ok(item.isFile(),'Only regular files can be packaged: '+name);const stat=await fs.stat(source),data=await fs.readFile(source);files.push({name,data,source,mtimeMs:stat.mtimeMs,size:stat.size});}
 }return files;
}

function checkResources(entries){
 const files=new Map(entries.map(e=>[e.name,e.data]));let references=0;
 const check=(file,reference)=>{if(!reference||/^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i.test(reference))return;assert.ok(!reference.startsWith('/'),'Root-relative resource breaks project Pages URLs: '+file+' -> '+reference);const name=path.posix.normalize(path.posix.join(path.posix.dirname(file),decodeURIComponent(reference.split(/[?#]/)[0])));assert.ok(cleanName(name)&&files.has(name),'Missing relative resource: '+file+' -> '+reference);references++;};
 for(const entry of entries){
  const text=entry.data.toString();if(entry.name==='index.html'||entry.name==='downloads.html')for(const match of text.matchAll(/\b(?:src|href)=["']([^"']+)["']/g))check(entry.name,match[1]);
  else if(entry.name.endsWith('.css'))for(const match of text.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)'"\s]+))\s*\)/g))check(entry.name,match[1]??match[2]??match[3]);
  else if(entry.name.endsWith('.js')&&!entry.name.startsWith('vendor/')){
   for(const match of text.matchAll(/\bfrom\s*["'](\.[^"']+)["']/g))check(entry.name,match[1]);
   for(const match of text.matchAll(/\bimport\s*(?:\(\s*)?["'](\.[^"']+)["']/g))check(entry.name,match[1]);
  }
 }
 return references;
}

export async function packagePages(){
 const dist=path.join(root,'dist'),release=path.join(root,'release'),files=await readTree(dist),byName=new Map(files.map(e=>[e.name,e]));
 const required=['index.html','downloads.html','SIDEWAYS.html','main.js','style.css','vendor/motor-engine.js','vendor/three.module.js','vendor/peerjs.min.js','vendor/THREE-LICENSE.txt','vendor/PEERJS-LICENSE.txt','fonts/barlow-OFL.txt','fonts/barlowcondensed-OFL.txt','audio/ATTRIBUTION.txt','audio/CC0-LICENSE.txt'];
 for(const name of required)assert.ok(byName.get(name)?.data.length,'Required release file is missing: '+name);
 const standalone=byName.get('SIDEWAYS.html'),stale=files.filter(e=>e.name!=='SIDEWAYS.html'&&/\.(?:js|css|html|ttf|woff2|txt)$/.test(e.name)&&e.mtimeMs>standalone.mtimeMs+1);assert.equal(stale.length,0,'Standalone build is stale ('+stale.slice(0,6).map(e=>e.name).join(', ')+'). Run node build.mjs first.');
 const html=standalone.data.toString();assert.ok(!/<script\b[^>]*\bsrc=/i.test(html),'Standalone still loads an external script');assert.ok(!/<link\b[^>]*\brel=["']stylesheet["']/i.test(html),'Standalone still loads external CSS');assert.ok(html.includes('sideways-v8-')&&html.includes('RTCPeerConnection')&&html.includes('HOST_START_FAILED')&&html.includes('vehicle-components'),'Standalone does not contain the multiplayer and vehicle condition bundle');
 assert.equal(MotorLab.version,'1.6.0');assert.equal(MotorLab.physicsRelease,14);assert.equal(MotorLab.audioRelease,14);
 assert.ok(byName.get('vendor/motor-engine.js').data.equals(await fs.readFile(path.join(root,'sdk/motor-engine.js'))),'Browser SDK differs from supplied bundle');
 assert.ok(html.includes('MotorLab SDK 1.6.')&&html.includes('MotorLab 1.6 source layers'),'Standalone is missing the new SDK integration');
 const downloads=byName.get('downloads.html').data.toString();assert.ok(downloads.includes('href="SIDEWAYS.html"'),'Download page must use its local standalone file');assert.ok(downloads.includes('https://sideways-dock-09-q7v4.pizzadanielyt.chatgpt.site/downloads/SIDEWAYS-v10-pages.zip'),'Download page is missing the hosted archive');
 assert.ok(files.every(e=>!e.name.startsWith('downloads/')),'Generated download archives cannot be packaged inside themselves');
 const entries=files.map(e=>({name:e.name,data:e.data}));const tracked=[...files];
 for(const [sourceName,name]of [['README.md','README.md'],['docs/github-pages.md','docs/github-pages.md'],['docs/multiplayer.md','docs/multiplayer.md'],['.github/workflows/pages.yml','docs/pages-workflow.yml']]){
  const source=path.join(root,sourceName),stat=await fs.stat(source),raw=await fs.readFile(source);assert.ok(stat.isFile(),'Documentation must be a regular file');const data=name==='README.md'?Buffer.from(raw.toString().replaceAll('](dist/','](')):raw;entries.push({name,data});tracked.push({source,mtimeMs:stat.mtimeMs,size:stat.size});
 }
 const existing=entries.find(e=>e.name==='.nojekyll');if(existing)existing.data=Buffer.alloc(0);else entries.push({name:'.nojekyll',data:Buffer.alloc(0)});
 const references=checkResources(entries),manifest={game:'SIDEWAYS',version:10,engineSdk:{version:MotorLab.version,physicsRelease:MotorLab.physicsRelease,audioRelease:MotorLab.audioRelease},files:Object.fromEntries([...entries].sort((a,b)=>a.name.localeCompare(b.name,'en')).map(e=>[e.name,{bytes:e.data.length,sha256:sha256(e.data)}]))};entries.push({name:'package-manifest.json',data:Buffer.from(JSON.stringify(manifest,null,2)+'\n')});
 const zip=makeZip(entries);verifyZip(zip,entries);
 for(const input of tracked){const stat=await fs.stat(input.source);assert.equal(stat.mtimeMs,input.mtimeMs,'A package input changed while packaging. Retry after edits finish.');assert.equal(stat.size,input.size,'A package input changed while packaging.');}
 await fs.mkdir(release,{recursive:true});const staging=path.join(release,'.pages-tmp'),folder=path.join(release,'pages');await fs.rm(staging,{recursive:true,force:true});await fs.mkdir(staging,{recursive:true});
 for(const entry of entries){const target=path.join(staging,entry.name);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,entry.data);}
 await fs.rm(folder,{recursive:true,force:true});await fs.rename(staging,folder);const archive=path.join(release,'SIDEWAYS-v10-pages.zip');await fs.writeFile(archive+'.tmp',zip);await fs.rename(archive+'.tmp',archive);
 const downloadDirectory=path.join(dist,'downloads'),hostedArchive=path.join(downloadDirectory,'SIDEWAYS-v10-pages.zip');await fs.mkdir(downloadDirectory,{recursive:true});await fs.writeFile(hostedArchive+'.tmp',zip);await fs.rename(hostedArchive+'.tmp',hostedArchive);assert.ok(zip.equals(await fs.readFile(hostedArchive)),'Hosted archive differs from the release archive');
 const report={version:10,status:'passed',hostedArchive:'dist/downloads/SIDEWAYS-v10-pages.zip',recursiveArchives:false,engineSdk:manifest.engineSdk,archive:'release/SIDEWAYS-v10-pages.zip',site:'release/pages/',files:entries.length,bytes:zip.length,uncompressedBytes:entries.reduce((sum,e)=>sum+e.data.length,0),sha256:sha256(zip),resourceReferences:references,checks:['Standalone is current and contains MotorLab 1.6, native source-layer integration and the multiplayer client.','Both HTML editions, the download page, runtime modules, fonts, audio attribution and third-party licenses are included.','Relative HTML, CSS and local module references resolve inside the publishing folder.','ZIP central directory, decompression, CRC32 and exact entry bytes round-trip.','No symlinks are included; .nojekyll and index.html are at the archive root.','All source inputs stayed unchanged during packaging.','The hosted ZIP is byte-for-byte identical to the release ZIP.','Generated download archives are excluded from the package to prevent recursive ZIP growth.'],limits:['Packaging does not publish to GitHub or exercise GitHub Actions.','No browser image, speaker audition or live WebRTC connection is established by this check.']};await fs.writeFile(path.join(root,'qa/package-pages-v10-results.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));return report;
}

if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
 if(process.argv.includes('--self-test')){const entries=[{name:'.nojekyll',data:Buffer.alloc(0)},{name:'index.html',data:Buffer.from('<!doctype html><title>SIDEWAYS</title>')},{name:'fonts/notice.txt',data:Buffer.from('Unicode: café.\n')}],zip=makeZip(entries);verifyZip(zip,entries);assert.ok(makeZip(entries).equals(zip));assert.throws(()=>makeZip([{name:'../outside',data:Buffer.alloc(0)}]));assert.throws(()=>makeZip([entries[1],entries[1]]));console.log(JSON.stringify({status:'passed',checks:['ZIP roundtrip','Deterministic bytes','Unsafe paths rejected','Duplicates rejected'],bytes:zip.length}));}
 else await packagePages();
}
