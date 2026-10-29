import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url));
const raw=read('docs/goal.txt'),progress=JSON.parse(read('docs/goal-progress.json')),source=raw.toString('utf8');
assert.equal(progress.sourceSHA256,createHash('sha256').update(raw).digest('hex'));
const expected=[];
for(const m of source.matchAll(/^PHASE (\d+): (.+)\n([\s\S]*?)(?=^PHASE |^PRIORITÄT UND UMSETZUNG|(?![\s\S]))/gm)){
 let index=0;for(const line of m[3].split('\n'))if(line.startsWith('- ')||/^  \d+\)/.test(line))expected.push({id:'P'+m[1].padStart(2,'0')+'.'+String(++index).padStart(2,'0'),phase:Number(m[1]),requirement:line.replace(/^(?:- |  \d+\) )/,'').replace(/\r$/,'')});
}
assert.equal(new Set(expected.map(r=>r.phase)).size,19);assert.equal(expected.length,156);
assert.deepEqual(progress.requirements.map(({id,phase,requirement})=>({id,phase,requirement})),expected);
assert.ok(progress.requirements.every(r=>['erledigt','teilweise erledigt','offen'].includes(r.status)));
const result={version:23,status:'passed',phases:19,requirements:expected.length,sourceSHA256:progress.sourceSHA256,checks:['Every Phase 0–18 bullet and all fourteen acceptance scenarios appear verbatim with stable IDs and explicit status.','The local goal copy matches the recorded SHA-256.']};
fs.writeFileSync(new URL('goal-coverage-v23-results.json',import.meta.url),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
