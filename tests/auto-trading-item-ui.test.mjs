import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {JSDOM} from 'jsdom';
import {build} from 'esbuild';

test('real table edits persist, summary toggles, condition lines stay complete and stale polls cannot undo a rename',async()=>{
 const dom=new JSDOM('<div id="app"></div>',{url:'https://pmoffice.co.kr/admin/#auto-trading'});
 for(const key of ['window','document','Element','HTMLElement','SVGElement','Node','location','history'])globalThis[key]=dom.window[key];
 const vue=await import('vue'),{parse,compileScript}=await import('vue/compiler-sfc');
 const id='00000000-0000-0000-0000-000000000071',calls=[];
 let backend={id,name:'모의 거래 테스트',account_alias:'Demo',exchange:'BINANCE DEMO',symbol:'TESTUSDT',timeframe:'10S',version:2,last_seen:new Date().toISOString(),snapshot:{position:'0',entries:false,performance:{net:'0'}},entry_conditions:['Test Entry A','Test Entry B','Test Entry C','Test Entry D','Test Entry E'],exit_conditions:['Test Exit A','Test Exit B'],description:'기존 설명',conditions_source:'사용자 확정 설정'};
 const fixture={poll:null,deferNext:false,release:null,async api(action,p){
  calls.push({action,p:structuredClone(p)});
  if(action==='list'){
   const value=[structuredClone(backend)];
   if(fixture.deferNext){fixture.deferNext=false;return new Promise(resolve=>fixture.release=()=>resolve(value))}
   return value;
  }
  if(action==='save'){
   assert.equal(p.id,id);if(p.version!==backend.version)throw Error('다른 변경이 있습니다. 새로 확인해 주세요.');
   assert.ok(p.description.length<=200);backend={...backend,name:p.name,description:p.description,version:backend.version+1};return structuredClone(backend);
  }
  throw Error('unexpected request '+action);
 }};
 globalThis.__tradingMetadataFixture=fixture;
 const originalInterval=globalThis.setInterval;globalThis.setInterval=fn=>{fixture.poll=fn;return 0};
 const generated=path.resolve('tests','.trading-item-'+randomUUID()+'.mjs');
 let app;
 try{
  const result=await build({stdin:{contents:"export {default} from './docs/.vitepress/theme/AdminAutoTrading.vue'",resolveDir:process.cwd()},bundle:true,write:false,format:'esm',platform:'node',external:['vue'],plugins:[{name:'isolated-trading-api',setup(b){
   b.onResolve({filter:/auto-trading-client\.js$/},()=>({path:'api',namespace:'fixture'}));
   b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:"export const tradingApi=(a,p)=>globalThis.__tradingMetadataFixture.api(a,p);export const tradingOnline=x=>!!x.last_seen;",loader:'js'}));
   b.onLoad({filter:/\.vue$/},a=>{const {descriptor}=parse(fs.readFileSync(a.path,'utf8'));return {contents:compileScript(descriptor,{id:'table-item-editor',inlineTemplate:true}).content,loader:'js',resolveDir:path.dirname(a.path)}});
  }}]});
  fs.writeFileSync(generated,result.outputFiles[0].text);const C=(await import(pathToFileURL(generated).href)).default;
  const settle=async()=>{await new Promise(r=>setTimeout(r,30));await vue.nextTick()};
  const root=()=>document.querySelector('#app'),button=text=>[...root().querySelectorAll('button')].find(x=>x.textContent.trim()===text);
  const mount=async()=>{app=vue.createApp(C);app.mount('#app');await settle()};
  const input=(element,value)=>{element.value=value;element.dispatchEvent(new dom.window.Event('input',{bubbles:true}))};
  const submit=()=>root().querySelector('form[data-editor-for]').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));
  await mount();
  assert.equal(root().querySelector('h1').textContent,'Auto Trading 센터');assert.equal(button('새 모의 거래 등록'),undefined);
  assert.deepEqual([...root().querySelectorAll('.at-entry-conditions li')].map(x=>x.textContent),backend.entry_conditions);
  assert.deepEqual([...root().querySelectorAll('.at-exit-conditions li')].map(x=>x.textContent),backend.exit_conditions);
  button('요약').click();await settle();assert.deepEqual([...root().querySelectorAll('.at-summary-grid h3')].map(x=>x.textContent),['진입 조건','청산 조건','설명']);
  assert.match(root().textContent,/기존 설명/);button('요약 접기').click();await settle();assert.equal(root().querySelector('.at-summary'),null);
  assert.equal(button('이름 변경'),undefined);assert.equal(button('보관'),undefined);button('요약').click();await settle();assert.equal(document.activeElement.id,'at-name-'+id);assert.equal(button('취소').nextElementSibling.textContent,'보관');
  const prefix='<img src=x onerror=bad()>\n',description=prefix+'가'.repeat(200-prefix.length);
  input(root().querySelector('input[name=name]'),'변경한 모의 거래');
  input(root().querySelector('textarea[name=description]'),description);submit();await settle();
  assert.equal(backend.name,'변경한 모의 거래');assert.equal(backend.description,description);assert.match(root().textContent,/저장했습니다/);
  assert.equal(root().querySelector('img'),null);assert.equal(root().querySelector('a[href*="trading="]').textContent,'변경한 모의 거래');
  app.unmount();document.querySelector('#app').replaceChildren();await mount();button('요약').click();await settle();
  assert.equal(root().querySelector('.at-description').textContent,description);
  button('요약 접기').click();await settle();button('요약').click();await settle();const saveCount=calls.filter(x=>x.action==='save').length;
  input(root().querySelector('textarea'),'가'.repeat(201));submit();await settle();
  assert.equal(calls.filter(x=>x.action==='save').length,saveCount);assert.match(root().textContent,/200자 이내/);
  input(root().querySelector('textarea'),'정상 설명');input(root().querySelector('input[name=name]'),'입력 유지');
  backend={...backend,name:'다른 관리자 변경',version:backend.version+1};submit();await settle();
  assert.equal(backend.name,'다른 관리자 변경');assert.equal(root().querySelector('input[name=name]').value,'입력 유지');assert.match(root().textContent,/다른 변경/);
  button('취소').click();await settle();button('요약').click();await settle();
  fixture.deferNext=true;fixture.poll();await settle();assert.equal(typeof fixture.release,'function');
  input(root().querySelector('input[name=name]'),'최종 저장 이름');input(root().querySelector('textarea'),'최종 설명');
  submit();await settle();fixture.release();await settle();
  assert.equal(root().querySelector('a[href*="trading="]').textContent,'최종 저장 이름');assert.equal(backend.description,'최종 설명');
 }finally{
  app?.unmount();globalThis.setInterval=originalInterval;delete globalThis.__tradingMetadataFixture;if(fs.existsSync(generated))fs.unlinkSync(generated);dom.window.close();
 }
});
