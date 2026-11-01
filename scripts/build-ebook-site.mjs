import {scopeEbookCss} from './scope-ebook-css.mjs';
import fs from 'node:fs';import path from 'node:path';import {spawnSync} from 'node:child_process';
const root=process.cwd(),app=path.join(root,'ebook-app'),dist=path.join(app,'dist'),publicRoot=path.join(root,'docs/public'),target=path.join(publicRoot,'ebook-app');
const build=spawnSync(process.execPath,['build.mjs'],{cwd:app,stdio:'inherit',windowsHide:true});if(build.status!==0)process.exit(build.status||1);
fs.mkdirSync(target,{recursive:true});for(const name of ['app.js','style.css','favicon.svg'])fs.copyFileSync(path.join(dist,name),path.join(target,name));
for(const name of ['pdfjs','cmaps','standard_fonts','wasm'])fs.cpSync(path.join(dist,name),path.join(target,name),{recursive:true});
if(fs.existsSync(path.join(target,'_worker.js')))throw Error('Server code must not be staged as public client assets');
const output=path.join(publicRoot,'ebooks/view.html');fs.mkdirSync(path.dirname(output),{recursive:true});if(fs.existsSync(output)&&!fs.readFileSync(output,'utf8').includes('data-pmoffice-ebook-shell'))throw Error('Existing non-generated ebook entry found; preserve it');
if(fs.existsSync(output))fs.unlinkSync(output);
fs.writeFileSync(path.join(target,'embedded.css'),scopeEbookCss(fs.readFileSync(path.join(app,'src/style.css'),'utf8')));
console.log('First-party ebook frontend staged without server code or private credentials.');

