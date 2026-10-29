import fs from 'node:fs';
import {build} from 'esbuild';
await build({entryPoints:['pms-app/lib/server-engine.ts'],bundle:true,platform:'neutral',mainFields:['module','main'],format:'esm',target:'es2022',supported:{'template-literal':false},outfile:'supabase/functions/pms/workbook-engine.mjs',minify:true,external:['linkedom'],logLevel:'warning'});
console.log('PMS server workbook engine built from shared workbook source.');
const path='supabase/functions/pms/workbook-engine.mjs';fs.writeFileSync(path,fs.readFileSync(path,'utf8').replace(/from\"linkedom\"/g,'from\"npm:linkedom@0.18.12\"'));
