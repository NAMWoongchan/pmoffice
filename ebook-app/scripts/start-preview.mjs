import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import {spawn} from 'node:child_process';
const app=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),stateDir=path.join(app,'.preview'),port=Number(process.env.EBOOK_PREVIEW_PORT||4179);
if(!Number.isInteger(port)||port<1024||port>65535)throw Error('미리보기 포트가 올바르지 않습니다.');
if(!fs.existsSync(path.join(app,'dist','app.js')))throw Error('먼저 이북 앱을 빌드해 주세요.');
const url=`http://127.0.0.1:${port}`;
async function health(){try{const r=await fetch(url+'/__preview_health',{signal:AbortSignal.timeout(1200)});const d=await r.json();return r.ok&&d.service==='pmoffice-ebook-preview'&&d.ready?d:null}catch{return null}}
let running=await health();
if(!running){
 fs.mkdirSync(stateDir,{recursive:true});const stdout=fs.openSync(path.join(stateDir,'preview.log'),'a'),stderr=fs.openSync(path.join(stateDir,'preview-error.log'),'a');
 const child=spawn(process.execPath,[path.join(app,'scripts','preview.mjs')],{cwd:app,detached:true,windowsHide:true,stdio:['ignore',stdout,stderr],env:{...process.env,EBOOK_PREVIEW_PORT:String(port)}});child.unref();fs.closeSync(stdout);fs.closeSync(stderr);
 for(let i=0;i<12;i++){running=await health();if(running)break;await new Promise(r=>setTimeout(r,250))}
 if(!running)throw Error('미리보기 서버가 응답하지 않습니다. 포트 충돌과 .preview/preview-error.log를 확인해 주세요. 기존 프로세스는 종료하지 않았습니다.');
 fs.writeFileSync(path.join(stateDir,`server-${port}.json`),JSON.stringify({pid:running.pid,port,url:url+'/?demo=1',started_at:new Date().toISOString()},null,2));
}
console.log('미리보기 준비 완료: '+url+'/?demo=1');console.log('이 창을 닫아도 미리보기 서버는 계속 실행됩니다. PC 재시작 후에는 다시 실행해 주세요.');
