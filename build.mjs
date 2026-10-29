import { build } from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
const root=process.cwd(),dist=path.join(root,'dist');
const bundle=await build({entryPoints:[path.join(dist,'main.js')],bundle:true,minify:true,format:'iife',target:['es2020'],write:false,legalComments:'inline'});
let css=(await Promise.all(['style.css','polish-v12.css','map-v12.css'].map(file=>fs.readFile(path.join(dist,file),'utf8')))).join('\n');
for(const m of [...css.matchAll(/url\((?:['"])?(fonts\/[^)'"\s]+)(?:['"])?\)/g)]){
 const source=m[1],bytes=await fs.readFile(path.join(dist,source)),mime=source.endsWith('.woff2')?'font/woff2':'font/ttf';
 css=css.replaceAll(m[0],`url(data:${mime};base64,${bytes.toString('base64')})`);
}
let html=await fs.readFile(path.join(dist,'index.html'),'utf8');
const sdk=await fs.readFile(path.join(dist,'vendor/motor-engine.js'),'utf8');
const scriptSafe=s=>s.replace(/<\/script/gi,'<\\/script');
html=html.replace('<link rel="stylesheet" href="style.css">',()=>`<style>${css}</style>`)
 .replace('<link rel="stylesheet" href="polish-v12.css"><link rel="stylesheet" href="map-v12.css">','')
 .replace('<script src="vendor/motor-engine.js"></script><script type="module" src="main.js"></script>',()=>`<script>${scriptSafe(sdk)}</script><script>${scriptSafe(bundle.outputFiles[0].text)}</script>`);
const license=await fs.readFile(path.join(dist,'vendor/THREE-LICENSE.txt'),'utf8');
const peerLicense=await fs.readFile(path.join(dist,'vendor/PEERJS-LICENSE.txt'),'utf8');
const fontLicense=await fs.readFile(path.join(dist,'fonts/barlow-OFL.txt'),'utf8');
const audioAttribution=await fs.readFile(path.join(dist,'audio/ATTRIBUTION.txt'),'utf8');
html=html.replace('<a href="audio/ATTRIBUTION.txt" target="_blank" rel="noopener noreferrer">',()=>`<a href="data:text/plain;charset=utf-8;base64,${Buffer.from(audioAttribution).toString('base64')}" download="SIDEWAYS-audio-credits.txt">`);
html=html.replace('</head>',()=>`<!--\nThree.js license:\n${license.replaceAll('--','')}\nPeerJS license:\n${peerLicense.replaceAll('--','')}\nMotorLab SDK supplied by the user.\nFonts: Barlow and Barlow Condensed.\n${fontLicense.replaceAll('--','')}\n${audioAttribution.replaceAll('--','')}\n-->\n</head>`);
await fs.writeFile(path.join(dist,'SIDEWAYS.html'),html);
console.log(JSON.stringify({standalone:'dist/SIDEWAYS.html',bytes:Buffer.byteLength(html),externalRuntimeDependencies:0}));
