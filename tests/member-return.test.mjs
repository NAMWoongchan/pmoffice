import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
test('safe member login defaults to account while preserving explicit admin knowledge and project returns',()=>{
 const text=fs.readFileSync('docs/.vitepress/theme/member-service.js','utf8');const start=text.indexOf('export function safeMemberReturn('),end=text.indexOf('export async function refreshMember',start);assert.ok(start>=0&&end>start);const context=vm.createContext({URL});vm.runInContext(text.slice(start,end).replace('export ','')+'\nthis.checkReturn=safeMemberReturn;',context);
 for(const input of [undefined,'','https://untrusted.example/','javascript:alert(1)','/unknown'])assert.equal(context.checkReturn(input),'/account.html');
 assert.equal(context.checkReturn('/pms/korail/'),'/pms/korail/');assert.equal(context.checkReturn('/knowledge/'),'/knowledge/');assert.equal(context.checkReturn('/auth/ebook-bridge.html?state=00000000-0000-0000-0000-000000000001'),'/auth/ebook-bridge.html?state=00000000-0000-0000-0000-000000000001');
});
