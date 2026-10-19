import {build} from 'esbuild';
import fs from 'node:fs';
const out='docs/public/pms/app';
fs.mkdirSync(out,{recursive:true});
await build({entryPoints:['pms-app/main.tsx'],bundle:true,outdir:out,entryNames:'viewer',format:'esm',platform:'browser',target:'es2022',jsx:'automatic',minify:true,sourcemap:false,external:['/pms/app/fonts/*'],define:{'process.env.NODE_ENV':'"production"'}});
fs.writeFileSync(out+'/index.html','<!doctype html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>프로젝트 현황</title><link rel="stylesheet" href="/pms/app/viewer.css"></head><body><div id="root"></div><script type="module" src="/pms/app/viewer.js"></script></body></html>');
for(const file of fs.readdirSync(out)){if(/\.(xlsx|xlsm|zip|json)$/i.test(file))throw Error('Customer data must not be a static asset: '+file)}
const js=fs.readFileSync(out+'/viewer.js','utf8');
for(const bad of ['/project-original.xlsm','/signin-with-chatgpt','oai-authenticated-user-email'])if(js.includes(bad))throw Error('Legacy access path remains: '+bad);
console.log('PMS viewer built without static workbook or legacy authentication fallback.');

