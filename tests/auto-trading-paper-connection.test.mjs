import test from 'node:test';
import assert from 'node:assert/strict';
import {createClient} from '@supabase/supabase-js';
import {corsHeaders} from '@supabase/supabase-js/cors';
import {createPaperHandler,drain} from '../supabase/functions/auto-trading-paper/core.mjs';
const tid='00000000-0000-0000-0000-000000000071';
const demoFetch=async u=>({ok:true,json:async()=>u.endsWith('/time')?{serverTime:Date.now()}:u.includes('premiumIndex')?{markPrice:'40',time:Date.now()}:{symbols:[{symbol:'SOXLUSDT',status:'TRADING',filters:[{filterType:'MARKET_LOT_SIZE',stepSize:'0.01',minQty:'0.01',maxQty:'2000'},{filterType:'MIN_NOTIONAL',notional:'5'}]}]}});

test('real Supabase SDK browser headers pass preflight and diagnosis makes no trade/quote mutation',async()=>{
 const actions=[];const handler=createPaperHandler({admin:async()=>({item:{id:tid,data_enabled:false}}),worker:async(a,p)=>{actions.push({a,p});return {}},checkCron:async()=>false,fetcher:demoFetch,corsAllowHeaders:corsHeaders['Access-Control-Allow-Headers']});
 const sdk=createClient('https://example.supabase.co','sb_publishable_'+'a'.repeat(40),{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:async(input,init)=>{
  const request=new Request(input,init);request.headers.set('Origin','https://pmoffice.co.kr');
  const sent=[...request.headers.keys()].filter(x=>x!=='origin');assert.ok(sent.includes('x-client-info'));
  const pre=await handler(new Request(request.url,{method:'OPTIONS',headers:{Origin:'https://pmoffice.co.kr','Access-Control-Request-Headers':sent.join(','),'Access-Control-Request-Method':'POST'}}));
  assert.equal(pre.status,204);assert.equal(pre.headers.get('Access-Control-Allow-Origin'),'https://pmoffice.co.kr');
  const allowed=pre.headers.get('Access-Control-Allow-Headers').toLowerCase().split(',').map(x=>x.trim());assert.ok(sent.every(x=>allowed.includes(x)),sent.join(','));
  return handler(request);
 }}});
 const {data,error}=await sdk.functions.invoke('auto-trading-paper',{body:{action:'diagnose',id:tid},headers:{Authorization:'Bearer admin'}});assert.equal(error,null);assert.equal(data.checks.quote,true);assert.deepEqual(actions.map(x=>x.a),['health']);assert.equal(actions[0].p.code,'OK');
 const bad=await handler(new Request('https://example.supabase.co/functions/v1/auto-trading-paper',{method:'OPTIONS',headers:{Origin:'https://untrusted.example'}}));assert.equal(bad.status,403);assert.equal(bad.headers.get('Access-Control-Allow-Origin'),null);
});

test('quote and processing failures persist only sanitized health codes',async()=>{
 const calls=[];const worker=async(a,p)=>{calls.push({a,p});if(a==='next')throw Error('private internal detail');return {}};
 const fail=await drain(tid,worker,async()=>{throw Error('secret URL detail')});assert.equal(fail.error_code,'DEMO_QUOTE_FAILED');assert.deepEqual(calls.map(x=>x.a),['health']);assert.equal(calls[0].p.code,'DEMO_QUOTE_FAILED');
 calls.length=0;const processing=await drain(tid,worker,demoFetch);assert.equal(processing.error_code,'PROCESSING_FAILED');assert.equal(calls.at(-1).p.code,'PROCESSING_FAILED');assert.ok(!JSON.stringify({calls,fail,processing}).includes('private internal detail'));assert.ok(!JSON.stringify({calls,fail,processing}).includes('secret URL detail'));
});

test('diagnostic requires administrator authorization and disabled data cannot drain queued events',async()=>{
 let reads=0;const handler=createPaperHandler({admin:async token=>{if(token!=='Bearer admin')throw Error();return {item:{id:tid,data_enabled:false}}},worker:async()=>{reads++;return {}},checkCron:async()=>false,fetcher:demoFetch});
 const request=(token,action='diagnose')=>new Request('https://example.supabase.co/functions/v1/auto-trading-paper',{method:'POST',headers:token?{Authorization:token}:{},body:JSON.stringify({action,id:tid})});
 assert.equal((await handler(request(null))).status,401);assert.equal((await handler(request('Bearer member'))).status,403);assert.equal((await handler(request('Bearer admin','refresh'))).status,409);assert.equal(reads,0);
});
