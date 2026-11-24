import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {PGlite} from '@electric-sql/pglite';
const uid=n=>'00000000-0000-0000-0000-'+String(n).padStart(12,'0');
test('real administrator policy, scoped pairing, replay, isolation and command revocation',async()=>{
 const db=new PGlite();try{
 await db.exec("create role anon;create role authenticated;create role service_role;create schema auth;create schema storage;create schema extensions;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,banned_until timestamptz,raw_app_meta_data jsonb default '{}');create table auth.identities(user_id uuid,provider text,provider_id text,identity_data jsonb);create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;");
 await db.exec("create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text,metadata jsonb,owner uuid);alter table storage.objects enable row level security;grant usage on schema storage to authenticated;grant select,insert,update,delete on storage.objects to authenticated;");
 for(const name of ['202610130001_membership.sql','202610130002_education.sql','202610130003_unified_regular.sql'])await db.exec(fs.readFileSync('tests/fixtures/'+name,'utf8'));
 // Crypto function substitutes exercise state/permission behavior; production uses Supabase pgcrypto.
 await db.exec("create function extensions.gen_random_bytes(n integer) returns bytea language sql volatile as $$select decode(substr(repeat(md5(gen_random_uuid()::text),100),1,n*2),'hex')$$;create function extensions.digest(v text,k text) returns bytea language sql immutable as $$select decode(md5(v)||md5(v),'hex')$$;");
 await db.exec(fs.readFileSync('supabase/migrations/202611240001_auto_trading.sql','utf8'));
 await db.exec(fs.readFileSync('supabase/migrations/202611240002_auto_trading_metadata.sql','utf8'));

 for(let n=1;n<=2;n++){await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[uid(n),n===1?'namwoongchan@gmail.com':'member@example.test']);await db.query('update profiles set signup_accepted_at=now(),signup_version=(select signup_version from pmoffice_private.service_settings) where id=$1',[uid(n)])}
 await db.query("insert into auth.identities values($1,'google','admin-google',$2)",[uid(1),{email:'namwoongchan@gmail.com',email_verified:true}]);await db.query("update pmoffice_private.admin_identity_config set allowed_user_id=$1,allowed_google_provider_id='admin-google'",[uid(1)]);await db.query('insert into admin_roles(user_id) values($1)',[uid(1)]);
 async function as(n,role,fn){await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[n?uid(n):'']);await db.exec('set role '+role);try{return await fn()}finally{await db.exec('reset role')}}
 const admin=(a,p={})=>as(1,'authenticated',async()=>(await db.query('select auto_trading_admin($1,$2) value',[a,p])).rows[0].value);
 const worker=(a,p={})=>as(null,'service_role',async()=>(await db.query('select auto_trading_worker($1,$2) value',[a,p])).rows[0].value);
 await assert.rejects(()=>as(2,'authenticated',()=>db.query("select auto_trading_admin('list')")));
 await assert.rejects(()=>as(null,'anon',()=>db.query("select auto_trading_admin('list')")));
 await assert.rejects(()=>as(1,'authenticated',()=>db.query('select * from pmoffice_private.auto_trading_items')));
 const a=await admin('save',{name:'SOXL 테스트',account_alias:'demo-a',symbol:'SOXLUSDT',timeframe:'10S'});
 await assert.rejects(()=>admin('save',{name:'중복',account_alias:'demo-a',symbol:'SOXLUSDT',timeframe:'10S'}));
 await db.query('update pmoffice_private.auto_trading_items set entry_conditions=$1,exit_conditions=$2 where id=$3',[['Test Entry A','Test Entry B'],['Test Exit C'],a.id]);
 const baseline=(await admin('get',{id:a.id})).item;assert.deepEqual(baseline.entry_conditions,['Test Entry A','Test Entry B']);assert.deepEqual(baseline.exit_conditions,['Test Exit C']);assert.equal(baseline.description,'');
 const edited=await admin('save',{id:a.id,version:a.version,name:'변경된 이름',description:'가'.repeat(200)});
 assert.equal(edited.name,'변경된 이름');assert.equal(edited.description.length,200);assert.equal((await admin('get',{id:a.id})).item.description,'가'.repeat(200));
 await assert.rejects(()=>admin('save',{id:a.id,version:a.version,name:'stale'}));
 await assert.rejects(()=>admin('save',{id:a.id,version:edited.version,name:'too long',description:'가'.repeat(201)}));
 await assert.rejects(()=>as(2,'authenticated',()=>db.query("select auto_trading_admin('save',$1)",[{id:a.id,version:edited.version,name:'blocked',description:'blocked'}])));
 const renamed=await admin('save',{id:a.id,version:edited.version,name:'이름만 변경'});assert.equal(renamed.description,'가'.repeat(200));
 const b=await admin('save',{name:'다른 항목',account_alias:'demo-a',symbol:'ETHUSDT',timeframe:'10S'});
 const pair=await admin('pair',{id:a.id});const cred=await worker('pair',{code:pair.code,symbol:'SOXLUSDT',timeframe:'10S',account_hash:'a'.repeat(64)});
 await assert.rejects(()=>worker('pair',{code:pair.code,symbol:'SOXLUSDT',timeframe:'10S',account_hash:'a'.repeat(64)}));
 await assert.rejects(()=>worker('sync',{id:a.id,revision:1,snapshot:{},events:[]}));
 await assert.rejects(()=>worker('sync',{id:b.id,token:cred.token,revision:1,snapshot:{},events:[]}));
 const duplicate=await admin('save',{name:'다른 별칭 동일 계정',account_alias:'different-label',symbol:'SOXLUSDT',timeframe:'10S'});const duplicateCode=await admin('pair',{id:duplicate.id});await assert.rejects(()=>worker('pair',{code:duplicateCode.code,symbol:'SOXLUSDT',timeframe:'10S',account_hash:'a'.repeat(64)}));
 const identity={id:a.id,token:cred.token};await worker('sync',{...identity,revision:2,snapshot:{environment:'BINANCE DEMO ONLY',position:'0',entries:false},events:[{event_id:'x',revision:2,received_ms:100,state:'filled'}]});
 await worker('sync',{...identity,revision:1,snapshot:{position:'999'},events:[{event_id:'x',revision:1,received_ms:100,state:'queued'}]});
 const value=await admin('get',{id:a.id});assert.equal(value.item.snapshot.position,'0');assert.equal(value.item.worker_hash,undefined);assert.equal((await admin('events',{id:a.id})).rows[0].state,'filled');
 const start=await admin('command',{id:a.id,command_id:uid(101),action:'start'});assert.equal(start.state,'queued');
 await admin('command',{id:a.id,command_id:uid(102),action:'stop'});assert.equal((await worker('claim',{...identity,command_id:uid(101)})).state,'superseded');
 const claim=await worker('claim',{...identity,command_id:uid(102)});assert.equal(claim.state,'executing');await worker('ack',{...identity,command_id:uid(102),state:'completed',result:{entries:false}});
 assert.equal((await admin('command',{id:a.id,command_id:uid(102),action:'stop'})).state,'completed');
 await admin('command',{id:a.id,command_id:uid(103),action:'start'});await db.query('delete from admin_roles where user_id=$1',[uid(1)]);
 assert.equal((await worker('claim',{...identity,command_id:uid(103)})).state,'failed');
 await assert.rejects(()=>admin('list'));await db.query('insert into admin_roles(user_id) values($1)',[uid(1)]);
 await admin('command',{id:a.id,command_id:uid(104),action:'close',expected_position:'0',expected_entry:''});await db.query("update pmoffice_private.auto_trading_commands set expires_at=now()-interval '1 second' where id=$1",[uid(104)]);assert.equal((await worker('claim',{...identity,command_id:uid(104)})).state,'expired');
 assert.equal((await db.query("select count(*)::int n from pg_class c join pg_namespace s on s.oid=c.relnamespace where s.nspname='pmoffice_private' and c.relname like 'auto_trading_%' and c.relkind='r' and not c.relrowsecurity")).rows[0].n,0);
 }finally{await db.close()}
});
