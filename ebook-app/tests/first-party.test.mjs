import test from 'node:test';import assert from 'node:assert/strict';import {apiURL,publicAsset,viewerURL,requestJson,init} from '../src/api.mjs';import {handle} from '../server/gateway.mjs';
test('embedded ebook keeps the current homepage account and migrates legacy auth only when logged out',async()=>{
 const previous=globalThis.location,storage=globalThis.localStorage;let switched=0,removed=0;
 try{
  globalThis.location={origin:'https://pmoffice.co.kr',pathname:'/ebooks/view.html',href:'https://pmoffice.co.kr/ebooks/view.html'};
  globalThis.localStorage={getItem:()=>JSON.stringify({access_token:'fixture-access',refresh_token:'fixture-refresh'}),removeItem:()=>removed++};
  await init({auth:{getSession:async()=>({data:{session:{user:{id:'current-homepage-user'}}}}),setSession:async()=>{switched++;return {error:null}}}});
  assert.equal(switched,0,'existing homepage identity must win');assert.equal(removed,0);
  await init({auth:{getSession:async()=>({data:{session:null}}),setSession:async tokens=>{assert.equal(tokens.access_token,'fixture-access');assert.equal(tokens.refresh_token,'fixture-refresh');switched++;return {error:null}}}});
  assert.equal(switched,1);assert.equal(removed,1);
 }finally{globalThis.location=previous;globalThis.localStorage=storage}
});
test('first-party reader uses protected API internally and keeps customer book/share addresses on pmoffice',async()=>{
 const previous=globalThis.location,fetcher=globalThis.fetch;try{globalThis.location={origin:'https://pmoffice.co.kr',pathname:'/ebooks/view.html'};assert.equal(apiURL('/api/config'),'https://pmoffice-ebooks.pages.dev/api/config');assert.equal(publicAsset('/pdfjs/pdf.mjs'),'/ebook-app/pdfjs/pdf.mjs');assert.equal(publicAsset('/cmaps/'),'/ebook-app/cmaps/');let called;globalThis.fetch=async url=>{called=url;return Response.json({ok:true})};assert.deepEqual(await requestJson('/api/rpc'),{ok:true});assert.equal(called,'https://pmoffice-ebooks.pages.dev/api/rpc');const url=new URL(viewerURL('10000000-0000-0000-0000-000000000001','opaque-token'));assert.equal(url.origin,'https://pmoffice.co.kr');assert.equal(url.pathname,'/ebooks/view.html');assert.equal(url.searchParams.get('book'),'10000000-0000-0000-0000-000000000001');assert.equal(url.hash,'#share=opaque-token');globalThis.location={origin:'http://127.0.0.1:4179',pathname:'/'};assert.equal(apiURL('/api/config'),'/api/config');assert.equal(publicAsset('/pdfjs/pdf.mjs'),'/pdfjs/pdf.mjs');}finally{globalThis.location=previous;globalThis.fetch=fetcher}
});
test('only the exact homepage origin receives CORS; authenticated asset denials remain enforced',async()=>{
 const old=globalThis.fetch;let calls=0;const env={CANONICAL_HOST:'ebooks.pmoffice.co.kr',SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_ANON_KEY:'public-test'};
 globalThis.fetch=async(_url,options)=>{calls++;return JSON.parse(options.body).p_action==='asset'?Response.json({code:'42501'},{status:403}):Response.json({member:false,admin:false,released:false})};
 try{const options=await handle(new Request('https://pmoffice-ebooks.pages.dev/api/rpc',{method:'OPTIONS',headers:{Origin:'https://pmoffice.co.kr','Access-Control-Request-Headers':'authorization,content-type'}}),env);assert.equal(options.status,204);assert.equal(options.headers.get('Access-Control-Allow-Origin'),'https://pmoffice.co.kr');assert.ok(options.headers.get('Access-Control-Allow-Headers').includes('Authorization'));
 const good=await handle(new Request('https://pmoffice-ebooks.pages.dev/api/rpc',{method:'POST',headers:{Origin:'https://pmoffice.co.kr','Content-Type':'application/json'},body:JSON.stringify({action:'session'})}),env);assert.equal(good.status,200);assert.equal(good.headers.get('Access-Control-Allow-Origin'),'https://pmoffice.co.kr');assert.equal(good.headers.get('Vary'),'Origin');
 const bad=await handle(new Request('https://pmoffice-ebooks.pages.dev/api/rpc',{method:'POST',headers:{Origin:'https://pmoffice.co.kr.attacker.test'},body:JSON.stringify({action:'session'})}),env);assert.equal(bad.status,403);assert.equal(bad.headers.get('Access-Control-Allow-Origin'),null);assert.equal(calls,1);
 const asset=await handle(new Request('https://pmoffice-ebooks.pages.dev/api/asset?book=x&asset=y',{headers:{Origin:'https://pmoffice.co.kr'}}),env);assert.equal(asset.status,403);assert.equal(asset.headers.get('Access-Control-Allow-Origin'),'https://pmoffice.co.kr');assert.ok(asset.headers.get('Access-Control-Expose-Headers').includes('Content-Range'));
 }finally{globalThis.fetch=old}
});

