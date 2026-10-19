import test from 'node:test';import assert from 'node:assert/strict';
import {createHandler,validSlug,MAX_BYTES} from '../supabase/functions/pms/core.mjs';
function fixture({allowed=true,admin=false,privateRepo=true,current=null}={}){
 const calls=[];let access={allowed,admin};
 const handler=createHandler({dataRepo:'owner/private-data',rpc:async(_a,n)=>n==='pms_access'?access:{},
 github:async(path,options={},missing=false)=>{calls.push({path,options});if(path==='/repos/owner/private-data')return {private:privateRepo};
 if(options.method==='PUT')return {content:{sha:'newblob'},commit:{sha:'a'.repeat(40)}};
 if(path.includes('/commits/'))return {files:[{filename:'projects/other/workbook.json'}]};
 if(path.includes('/commits?'))return [];
 if(options.raw)return {schema:1,name:'원본.xlsm',at:'2026-10-20',size:4,content:'UEsDBA=='};
 return current;}});
 const req=(action='meta',options={})=>new Request('https://api.test/pms?project=korail&action='+action,options);
 return {handler,calls,req,setAccess:a=>access=a};
}
test('slug validation excludes reserved routes and traversal',()=>{for(const x of ['../korail','korail/other','app','callback','index','Acorp','a'])assert.equal(validSlug(x),false);assert.equal(validSlug('korail'),true)});
test('anonymous denied before any GitHub call',async()=>{const f=fixture({allowed:false});assert.equal((await f.handler(f.req())).status,403);assert.equal(f.calls.length,0)});
test('member cannot publish or create route',async()=>{for(const a of ['publish','route']){const f=fixture();assert.equal((await f.handler(f.req(a,{method:'POST',body:'PK'}))).status,403);assert.equal(f.calls.length,0)}});
test('public data repository fails closed',async()=>{const f=fixture({privateRepo:false});assert.equal((await f.handler(f.req())).status,503)});
test('missing source never falls back to public workbook',async()=>{const f=fixture();assert.equal((await f.handler(f.req('file'))).status,404)});
test('publish requires matching current SHA',async()=>{const f=fixture({admin:true,current:{sha:'latest'}});const r=await f.handler(f.req('publish',{method:'POST',headers:{'X-Filename':'book.xlsm','If-Match':'stale'},body:new Uint8Array([80,75,3,4])}));assert.equal(r.status,409);assert.equal(f.calls.some(c=>c.options.method==='PUT'),false)});
test('publish writes workbook only into validated project path',async()=>{const f=fixture({admin:true});const r=await f.handler(f.req('publish',{method:'POST',headers:{'X-Filename':encodeURIComponent('원본.xlsm'),'If-Match':'seed'},body:new Uint8Array([80,75,3,4])}));assert.equal(r.status,200);const c=f.calls.find(c=>c.options.method==='PUT');assert.equal(c.path,'/repos/owner/private-data/contents/projects/korail/workbook.json');assert.equal((await r.json()).etag,'newblob')});
test('oversized streaming payload blocked',async()=>{const f=fixture({admin:true});assert.equal((await f.handler(f.req('publish',{method:'POST',headers:{'X-Filename':'a.xlsm','If-Match':'seed'},body:new Uint8Array(MAX_BYTES+1)}))).status,413)});
test('history from a different project rejected',async()=>{const f=fixture({current:{sha:'x'}});assert.equal((await f.handler(new Request(f.req('file').url+'&version='+'a'.repeat(40)))).status,404)});
test('authorized download no-store, original name, bytes intact',async()=>{const f=fixture({current:{sha:'x'}});const r=await f.handler(f.req('file'));assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'private, no-store');assert.equal(decodeURIComponent(r.headers.get('x-filename')),'원본.xlsm');assert.deepEqual([...new Uint8Array(await r.arrayBuffer())],[80,75,3,4])});
test('unexpected Origin rejected',async()=>{const f=fixture();assert.equal((await f.handler(f.req('meta',{headers:{Origin:'https://evil.test'}}))).status,403);assert.equal(f.calls.length,0)});
test('read-only user does not receive version history',async()=>{const f=fixture({current:{sha:'x'}});assert.deepEqual((await (await f.handler(f.req())).json()).versions,[])});

