import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {PGlite} from '@electric-sql/pglite';
const uid=n=>'00000000-0000-0000-0000-'+String(n).padStart(12,'0');
test('server paper SQL: admin isolation, independent ledgers, entry/close, dedup, inversion, expiry and stop',{timeout:120000},async()=>{
 const db=new PGlite();try{
 await db.exec("create role anon;create role authenticated;create role service_role;create schema auth;create schema storage;create schema extensions;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,banned_until timestamptz,raw_app_meta_data jsonb default '{}');create table auth.identities(user_id uuid,provider text,provider_id text,identity_data jsonb);create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;");
 await db.exec("create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text,metadata jsonb,owner uuid);alter table storage.objects enable row level security;grant usage on schema storage to authenticated;grant select,insert,update,delete on storage.objects to authenticated;");
 for(const name of ['202610130001_membership.sql','202610130002_education.sql','202610130003_unified_regular.sql'])await db.exec(fs.readFileSync('tests/fixtures/'+name,'utf8'));
 // Crypto function substitutes exercise state/permission behavior; production uses Supabase pgcrypto.
 await db.exec("create function extensions.gen_random_bytes(n integer) returns bytea language sql volatile as $$select decode(substr(repeat(md5(gen_random_uuid()::text),100),1,n*2),'hex')$$;create function extensions.digest(v text,k text) returns bytea language sql immutable as $$select decode(md5(v)||md5(v),'hex')$$;");
 await db.exec(fs.readFileSync('supabase/migrations/202611240001_auto_trading.sql','utf8'));
 for(let n=1;n<=2;n++){await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[uid(n),n===1?'namwoongchan@gmail.com':'member@example.test']);await db.query('update profiles set signup_accepted_at=now(),signup_version=(select signup_version from pmoffice_private.service_settings) where id=$1',[uid(n)])}
 await db.query("insert into auth.identities values($1,'google','admin-google',$2)",[uid(1),{email:'namwoongchan@gmail.com',email_verified:true}]);await db.query("update pmoffice_private.admin_identity_config set allowed_user_id=$1,allowed_google_provider_id='admin-google'",[uid(1)]);await db.query('insert into admin_roles(user_id) values($1)',[uid(1)]);

 await db.exec(fs.readFileSync('supabase/migrations/202611240005_cloud_paper.sql','utf8'));
 await db.exec(fs.readFileSync('supabase/migrations/202611240007_cloud_paper_orphan.sql','utf8'));
 await db.exec(fs.readFileSync('supabase/migrations/202611240008_paper_connection.sql','utf8'));
 async function as(n,role,fn){await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[n?uid(n):'']);await db.exec('set role '+role);try{return await fn()}finally{await db.exec('reset role')}}
 const admin=(a,p={})=>as(1,'authenticated',async()=>(await db.query('select auto_trading_paper_admin($1,$2) value',[a,p])).rows[0].value);
 const worker=(a,p={})=>as(null,'service_role',async()=>(await db.query('select auto_trading_paper_worker($1,$2) value',[a,p])).rows[0].value);
 await assert.rejects(()=>as(2,'authenticated',()=>db.query("select auto_trading_paper_admin('list')")));
 await assert.rejects(()=>as(null,'anon',()=>db.query("select auto_trading_paper_admin('list')")));
 await assert.rejects(()=>as(1,'authenticated',()=>db.query("select auto_trading_paper_worker('pending')")));
 const a=await admin('create',{name:'독립 A',entry_conditions:['조건 1','조건 2'],exit_conditions:['청산 1']});
 const b=await admin('create',{name:'독립 B'});assert.equal(a.auto_entries,false);assert.equal(a.data_enabled,false);assert.equal(a.wallet,1000);assert.equal(a.webhook_hash,undefined);
 await assert.rejects(()=>as(1,'authenticated',()=>db.query('select * from pmoffice_private.paper_tradings')));
 await assert.rejects(()=>admin('start',{id:a.id}));
 const get=async id=>(await admin('get',{id})).item;
 const q=price=>({symbol:'SOXLUSDT',price:String(price),at_ms:Date.now(),step:'0.01',min_qty:'0.01',max_qty:'2000',min_notional:'5'});
 const doManual=async(action,price,n)=>{const s=await get(a.id);await admin(action,{id:a.id,request_id:uid(n),expected_entry:s.entry_event,expected_qty:s.qty});const rows=await worker('next',{id:a.id});const e=rows.at(-1);const r=await worker('apply',{id:a.id,seq:e.seq,quote:q(price)});return {r,e}};
 const l=await doManual('long',40,101);assert.equal(l.r.state,'filled');assert.equal((await get(a.id)).qty,0.25);assert.equal((await get(a.id)).wallet,999.996);
 const replay=await worker('apply',{id:a.id,seq:l.e.seq,quote:q(40)});assert.equal(replay.state,'already_processed');assert.equal((await get(a.id)).qty,0.25);
 await assert.rejects(()=>admin('short',{id:a.id,request_id:uid(102),expected_entry:l.e.event_id,expected_qty:'0.25'}));
 await doManual('close',44,103);assert.equal((await get(a.id)).qty,0);assert.equal((await get(a.id)).wallet,1000.9916);assert.equal((await get(b.id)).wallet,1000);
 await doManual('short',40,104);assert.equal((await get(a.id)).qty,-0.25);await doManual('close',36,105);assert.equal((await get(a.id)).qty,0);assert.equal((await get(a.id)).wallet,1001.984);
 const hook=await admin('webhook',{id:a.id});assert.equal(hook.secret.length,64);await admin('start',{id:a.id});
 const beforeMetadata=await get(a.id);assert.equal(beforeMetadata.webhook_issued,true);
 const renamed=await admin('save',{id:a.id,version:beforeMetadata.config_version,name:'이름만 수정',description:'설명만 변경',entry_conditions:beforeMetadata.entry_conditions,exit_conditions:beforeMetadata.exit_conditions,sizing_mode:beforeMetadata.sizing_mode,sizing_value:beforeMetadata.sizing_value});
 assert.equal(renamed.config_version,beforeMetadata.config_version);assert.equal(renamed.webhook_revision,hook.revision);assert.equal(renamed.auto_entries,true);assert.equal(renamed.webhook_issued,true);
 const audit=(await db.query("select action,details from pmoffice_private.paper_audit where trading_id=$1 and action='webhook'",[a.id])).rows;assert.equal(audit.length,1);assert.equal(audit[0].details.revision,hook.revision);assert.ok(!JSON.stringify(audit).includes(hook.secret));
 await worker('health',{id:a.id,code:'DEMO_QUOTE_FAILED'});const connection=(await admin('get',{id:a.id})).connection;assert.equal(connection.signal_count,0);assert.equal(connection.health.code,'DEMO_QUOTE_FAILED');assert.equal(connection.webhook_revision,hook.revision);
 await worker('health',{id:a.id,code:'OK',quote_at_ms:Date.now()});assert.equal((await get(a.id)).connection_health.code,'OK');
 await assert.rejects(()=>as(1,'authenticated',()=>db.query("select auto_trading_paper_admin_base('list')")));await assert.rejects(()=>as(1,'authenticated',()=>db.query("select auto_trading_paper_worker_base('pending')")));
 const now=Date.now(),bar=Math.floor(now/10000)*10000;
 const signal=(event,et=now,br=bar)=>({version:'0.11',event_id:['soxl-0.11','BINANCE:SOXLUSDT.P','10S',br,event].join('|'),event,symbol:'BINANCE:SOXLUSDT.P',timeframe:'10S',event_time_ms:et,bar_open_ms:br,price:40});
 const ingest=s=>worker('ingest',{id:a.id,revision:hook.revision,secret:hook.secret,signal:s});
 await assert.rejects(()=>worker('ingest',{id:b.id,revision:hook.revision,secret:hook.secret,signal:signal('LONG_ENTRY')}));
 await db.query("update pmoffice_private.paper_tradings set started_at_ms=0,qty=0.25,entry_price=40,margin=0.333333,entry_event='old-long',entry_time_ms=$1,entry_bar_ms=$1,last_exit_bar_ms=0 where id=$2",[bar-20000,a.id]);
 await ingest(signal('SHORT_ENTRY'));const waiting=(await worker('next',{id:a.id}))[0];assert.equal((await worker('apply',{id:a.id,seq:waiting.seq,quote:q(40)})).state,'awaiting_exit');assert.equal((await get(a.id)).auto_entries,true);
 await ingest(signal('LONG_EXIT',bar-1,bar-10000));const pending=await worker('next',{id:a.id});assert.equal(pending[0].event,'LONG_EXIT');for(const e of pending)await worker('apply',{id:a.id,seq:e.seq,quote:q(40)});assert.equal((await get(a.id)).qty,-0.25);
 assert.equal((await ingest(signal('SHORT_ENTRY'))).state,'filled');
 assert.ok((await admin('get',{id:a.id})).connection.signal_count>=2);
 await ingest(signal('SHORT_EXIT',now+1));const ex=(await worker('next',{id:a.id}))[0];await worker('apply',{id:a.id,seq:ex.seq,quote:q(40)});assert.equal((await get(a.id)).qty,0);
 await ingest(signal('LONG_EXIT',bar-10001,bar-20000));const orphan=(await worker('next',{id:a.id}))[0];assert.equal((await worker('apply',{id:a.id,seq:orphan.seq,quote:q(40)})).state,'ignored');assert.equal((await get(a.id)).auto_entries,true);
 await admin('stop',{id:a.id});const old=await ingest(signal('LONG_ENTRY',bar-20001,bar-30000));assert.equal(old.state,'ignored');
 const edited=await admin('save',{id:a.id,version:(await get(a.id)).config_version,name:'수정 A',description:'가'.repeat(200),entry_conditions:['A','B'],exit_conditions:['C'],sizing_mode:'available_percent',sizing_value:25});assert.equal(edited.sizing_mode,'available_percent');
 await assert.rejects(()=>ingest(signal('LONG_ENTRY')));await assert.rejects(()=>admin('save',{id:a.id,version:1,name:'충돌',entry_conditions:[],exit_conditions:[],sizing_mode:'fixed_notional',sizing_value:10}));
 const hook2=await admin('webhook',{id:a.id});await admin('start',{id:a.id});await db.query('update pmoffice_private.paper_tradings set started_at_ms=0 where id=$1',[a.id]);
 const late=signal('LONG_ENTRY',bar-20000,bar-20000);await worker('ingest',{id:a.id,revision:hook2.revision,secret:hook2.secret,signal:late});const expired=(await worker('next',{id:a.id}))[0];assert.equal((await worker('apply',{id:a.id,seq:expired.seq,quote:q(40)})).state,'expired');assert.equal((await get(a.id)).auto_entries,true);
 await db.query('delete from admin_roles where user_id=$1',[uid(1)]);await assert.rejects(()=>admin('list'));await db.query('insert into admin_roles(user_id) values($1)',[uid(1)]);
 assert.equal((await db.query("select count(*)::int n from pg_class c join pg_namespace s on s.oid=c.relnamespace where s.nspname='pmoffice_private' and c.relname like 'paper_%' and c.relkind='r' and not c.relrowsecurity")).rows[0].n,0);
 }finally{await db.close()}
});
