import test from 'node:test';import assert from 'node:assert/strict';import {handle} from '../server/gateway.mjs';
test('canonical reader links preserve book/query, reject cross-host mutations and leave custom host assets working',async()=>{
 const env={CANONICAL_HOST:'ebooks.pmoffice.co.kr',ASSETS:{fetch:()=>new Response('asset')}};
 for(const path of ['/','/book/10000000-0000-0000-0000-000000000001?view=reader','/auth/callback?code=test-code']){const r=await handle(new Request('https://pmoffice-ebooks.pages.dev'+path),env);assert.equal(r.status,307);assert.equal(r.headers.get('Location'),'https://ebooks.pmoffice.co.kr'+path);assert.equal(r.headers.get('Referrer-Policy'),'no-referrer');}
 assert.equal((await handle(new Request('https://pmoffice-ebooks.pages.dev/api/rpc',{method:'POST',body:'{}'}),env)).status,403);
 assert.equal(await (await handle(new Request('https://ebooks.pmoffice.co.kr/book/test'),env)).text(),'asset');
 assert.equal(await (await handle(new Request('https://pmoffice-ebooks.pages.dev/'),{ASSETS:env.ASSETS})).text(),'asset');
});
