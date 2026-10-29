import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('../',import.meta.url)),qa=path.join(root,'qa');
// Reuse established assertions unchanged; only release/report identifiers and
// the explicitly versioned protocol expectation differ. Historical reports
// are never overwritten. Temporary modules share the original import base.
const suites=[['chassis',15],['physics',6],['damage',15],['thermal',15],['modular',15],['cosmetics',15],['restart',15],['input-taps',12],['navigation-main',14],['race',11],['police',11],['multiplayer',9],['archipelago',14]];
const selected=process.argv.slice(2),checks=[];
for(const [name,base] of suites){
 if(selected.length&&!selected.includes(name))continue;
 const original=`${name}-v${base}-check.mjs`,bytes=fs.readFileSync(path.join(qa,original));
 let source=bytes.toString().replaceAll(`${name}-v${base}-results.json`,`${name}-v16-results.json`);
 if(name==='restart')source=source.replace('assert.equal(MULTIPLAYER_VERSION,11)','assert.equal(MULTIPLAYER_VERSION,12)');
 const temporary=path.join(qa,`.v16-${name}-check.mjs`);
 try{
  fs.writeFileSync(temporary,source);
  const result=spawnSync(process.execPath,[temporary],{cwd:root,encoding:'utf8',maxBuffer:8*1024*1024});
  if(result.status!==0){process.stderr.write(result.stdout||'');process.stderr.write(result.stderr||'');throw new Error(original+' failed');}
  const reportPath=path.join(qa,`${name}-v16-results.json`),report=JSON.parse(fs.readFileSync(reportPath));assert.equal(report.status,'passed');
  Object.assign(report,{version:16,verifiedInRelease:16,suiteSource:'qa/'+original,suiteSHA256:createHash('sha256').update(bytes).digest('hex')});
  fs.writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');checks.push(name);console.log('PASS '+name+' ('+(report.checks?.length||0)+' groups)');
 }finally{fs.rmSync(temporary,{force:true});}
}
console.log(JSON.stringify({status:'passed',suites:checks}));
