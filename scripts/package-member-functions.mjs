import {build} from 'esbuild';import fs from 'node:fs';
const out=process.argv[2];if(!out)throw Error('Private output directory required');fs.mkdirSync(out,{recursive:true});
for(const name of ['member-admin','pms','pms-workbook'])await build({entryPoints:['supabase/functions/'+name+'/index.ts'],bundle:true,platform:'neutral',mainFields:['module','main'],format:'esm',target:'es2022',supported:{'template-literal':false},minify:true,external:['npm:*'],outfile:out+'/'+name+'.ts'});
console.log('Three deployment entries bundled without credentials or membership roster.');
