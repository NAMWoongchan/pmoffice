import http from 'node:http';import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
export const PREVIEW_ID='pmoffice-ebook-preview';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../dist');
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.pdf':'application/pdf','.png':'image/png','.svg':'image/svg+xml','.wasm':'application/wasm'};
export function createPreviewServer(directory=root){
 return http.createServer((req,res)=>{
  const reply=(status,text,type='text/plain; charset=utf-8')=>{res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(req.method==='HEAD'?'':text)};
  try{
   if(!['GET','HEAD'].includes(req.method)){reply(405,'Method not allowed');return}
   const url=new URL(req.url,'http://127.0.0.1');
   if(url.pathname==='/__preview_health'){reply(200,JSON.stringify({service:PREVIEW_ID,pid:process.pid,ready:fs.existsSync(path.join(directory,'app.js'))}),'application/json');return}
   if(url.pathname.startsWith('/api/')){reply(503,JSON.stringify({error:'로컬 화면 미리보기입니다. 실제 서비스 연결 전입니다.'}),'application/json');return}
   let pathname;try{pathname=decodeURIComponent(url.pathname)}catch{reply(400,'Invalid URL encoding');return}
   const relative=pathname==='/'||pathname.startsWith('/book/')||pathname==='/auth/callback'?'index.html':pathname.replace(/^\//,'');
   if(relative.includes('\0')||relative.includes('\\')||relative.split('/').some(x=>x.startsWith('.')||x.startsWith('_'))){reply(404,'Not found');return}
   const file=path.resolve(directory,relative);
   if(!file.startsWith(directory+path.sep)){reply(404,'Not found');return}
   let stat;try{stat=fs.statSync(file)}catch{reply(404,'Not found');return}
   if(!stat.isFile()){reply(404,'Not found');return}
   res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Content-Length':stat.size,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
   if(req.method==='HEAD'){res.end();return}
   const stream=fs.createReadStream(file);stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());stream.pipe(res);
  }catch{if(!res.headersSent)reply(500,'Preview request failed');else res.destroy()}
 });
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const port=Number(process.env.EBOOK_PREVIEW_PORT||4179);if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid preview port');
 const server=createPreviewServer();server.on('error',e=>{console.error(e.code==='EADDRINUSE'?'Preview port is occupied. No existing process was stopped.':'Preview startup failed: '+e.code);process.exitCode=1});
 server.listen(port,'127.0.0.1',()=>console.log(`Local UI preview (synthetic data only): http://127.0.0.1:${port}/?demo=1`));
}
