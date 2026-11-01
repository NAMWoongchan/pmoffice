import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {PGlite} from '@electric-sql/pglite';
const id=n=>'00000000-0000-0000-0000-'+String(n).padStart(12,'0');
async function setup(){const db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema storage;create schema extensions;
create table auth.users(id uuid primary key,email text unique,email_confirmed_at timestamptz,banned_until timestamptz,last_sign_in_at timestamptz,raw_app_meta_data jsonb default '{}');
create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id),not_after timestamptz);
create table auth.identities(user_id uuid,provider text,provider_id text,identity_data jsonb);
create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text,metadata jsonb,owner uuid);alter table storage.objects enable row level security;
grant usage on schema storage to authenticated;grant select,insert,update,delete on storage.objects to authenticated;`);
for(const f of ['202610130001_membership.sql','202610130002_education.sql','202610130003_unified_regular.sql'])await db.exec(fs.readFileSync('tests/fixtures/'+f,'utf8'));
await db.exec(`create table pmoffice_private.inquiry_settings(singleton boolean,bridge_secret text);insert into pmoffice_private.inquiry_settings values(true,'test-only');create table public.inquiry_notifications(id uuid default gen_random_uuid(),inquiry_id uuid,recipient text,state text default '대기',error text,updated_at timestamptz default now());`);
for(let n=1;n<=4;n++){await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[id(n),n===1?'namwoongchan@gmail.com':`user${n}@example.test`]);await db.query('update profiles set signup_accepted_at=now(),signup_version=(select signup_version from pmoffice_private.service_settings) where id=$1',[id(n)])}
await db.query("insert into auth.identities values($1,'google','google-admin',$2)",[id(1),{email:'namwoongchan@gmail.com',email_verified:true}]);await db.query("update pmoffice_private.admin_identity_config set allowed_user_id=$1,allowed_google_provider_id='google-admin'",[id(1)]);await db.query('insert into admin_roles(user_id) values($1)',[id(1)]);
for(const f of ['202610200001_pms.sql','202610200002_pms_groups.sql','202610290001_member_access.sql','202610310001_ebooks.sql','202610310003_ebook_public_url.sql','202611010001_ebook_admin_unlimited.sql'])await db.exec(fs.readFileSync('supabase/migrations/'+f,'utf8'));
const uid=async n=>{await db.exec('reset role');await db.query("select set_config('test.uid',$1,false)",[n?id(n):''])};
const rpc=async(action,p={},internal=false)=>{await db.exec('set role '+(internal?'service_role':'authenticated'));try{return (await db.query(`select public.${internal?'ebook_internal':'ebook_api'}($1,$2) a`,[action,p])).rows[0].a}finally{await db.exec('reset role')}};
await db.exec("create table public.customer_inquiries(id uuid default gen_random_uuid(),status text);insert into public.customer_inquiries(status) values('신규'),('확인 중'),('처리 완료');");await db.exec(fs.readFileSync('supabase/migrations/202611020001_admin_console.sql','utf8'));await db.exec('alter table public.profiles add column position text not null default '+"''");
await db.exec(fs.readFileSync('supabase/migrations/202611010002_member_services.sql','utf8'));
for(const f of ['202611020002_member_console.sql','202611020003_member_ebook_delete.sql','202611020004_software_issues.sql'])await db.exec(fs.readFileSync('supabase/migrations/'+f,'utf8'));
await db.exec("create function extensions.hmac(bytea,bytea,text) returns bytea language sql as $$select decode('00','hex')$$");
await db.exec(fs.readFileSync('supabase/migrations/202611020005_event_sync_sort.sql','utf8').split('-- Shared change signals')[0].replace('begin;',''));
return {db,uid,rpc}}


test('member service request, administrator multi-domain grades, join-date order, sanctions and read-only profile',async()=>{
 const {db,uid}=await setup();const q=async(sql,args=[])=>{await db.exec('set role authenticated');try{return (await db.query(sql,args)).rows[0]?.a}finally{await db.exec('reset role')}};
 const detail=id=>q('select member_detail($1) a',[id]);const bulk=(request,users,action,codes,versions)=>q('select member_admin_bulk($1,$2,$3,$4,$5,$6) a',[request,users,action,'검증 사유',codes,versions]);
 try{
 await uid(2);await q('select member_signup_service_request($1,$2) a',[['regular','ai:premium'],'연구원']);let d=await detail(id(2));assert.deepEqual(d.services,['seedling']);assert.equal(d.requested_services.length,2);assert.equal(d.original_answers['직함'],'연구원');
 await assert.rejects(()=>q('select register_unified_regular() a'));await assert.rejects(()=>detail(id(3)));await assert.rejects(()=>q('select member_signup_service_request($1,$2) a',[['regular'],'위조']));
 await assert.rejects(()=>bulk(id(901),[id(2)],'grade',['regular'],{[id(2)]:0}));
 await uid(1);assert.equal((await q('select member_service_catalog() a')).length,15);
 await assert.rejects(()=>bulk(id(902),[id(1)],'suspend',[],{[id(1)]:0}));
 await assert.rejects(()=>bulk(id(903),[id(2)],'grade',['regular','ai:vip','ai:premium'],{[id(2)]:0}));
 const args=[id(904),[id(2)],'grade',['regular','ai:premium','msp:vip','partner'],{[id(2)]:0}];await bulk(...args);await bulk(...args);d=await detail(id(2));assert.ok(d.services.includes('ai:premium'));assert.ok(d.services.includes('msp:vip'));assert.ok(d.services.includes('partner'));assert.equal(d.profile.services_revision,1);
 await assert.rejects(()=>bulk(id(905),[id(2)],'grade',['seedling'],{[id(2)]:0}));
 await q('select member_admin_detail_save($1,$2,$3,$4) a',[id(2),{'이름':'교정된 답변'},'회원에게 비공개','교정 검증']);
 await uid(2);d=await detail(id(2));assert.equal(d.admin_memo,null);assert.equal(d.answers['이름'],'교정된 답변');assert.notEqual(d.original_answers['이름'],'교정된 답변');assert.equal(d.management_history.length,0);
 await db.exec('set role authenticated');await assert.rejects(()=>db.query('update public.profiles set service_partner=true where id=$1',[id(2)]));await db.exec('reset role');
 await uid(1);await db.query("update profiles set registered_at=now()-interval '1 day',created_at=now()-interval '10 days' where id=$1",[id(2)]);await db.query("update profiles set registered_at=now()-interval '5 days',created_at=now()-interval '1 hour' where id=$1",[id(3)]);
 const rows=await q("select member_admin_list('') a");assert.ok(rows.findIndex(r=>r.id===id(2))<rows.findIndex(r=>r.id===id(3)));
 await bulk(id(906),[id(2)],'suspend',[],{[id(2)]:1});await uid(2);assert.equal(await q('select pmoffice_private.account_ok() a').catch(()=>false),false);await assert.rejects(()=>detail(id(2)));
 await uid(1);await bulk(id(907),[id(2)],'resume',[],{[id(2)]:2});await uid(2);assert.ok((await detail(id(2))).services.includes('ai:premium'));
 await uid(1);await bulk(id(908),[id(2)],'withdraw',[],{[id(2)]:3});d=await detail(id(2));assert.ok(d.profile.withdrawn_at);await assert.rejects(()=>bulk(id(909),[id(2)],'resume',[],{[id(2)]:4}));
 }finally{await db.close()}
});
test('owner ebook deletion retains original and result access for administrator only',async()=>{
 const {db,uid,rpc}=await setup();try{await uid(1);await rpc('settings',{released:true,max_storage_bytes:1048576,max_daily_jobs:20,max_daily_delivery_bytes:1048576});await uid(2);const b=await rpc('create',{title:'Delete verification',filename:'test.pdf',bytes:1});await db.query("update pmoffice_private.ebook_assets set complete=true where id=$1",[b.source_asset]);await db.query("update pmoffice_private.ebook_books set state='ready',pages=1,visibility='public' where id=$1",[b.id]);await db.query("insert into pmoffice_private.ebook_assets(book_id,kind,page,mime,bytes,complete) values($1,'page',1,'application/pdf',1,true)",[b.id]);await rpc('archive',{book_id:b.id});assert.equal((await rpc('list')).books.length,0);await assert.rejects(()=>rpc('get',{book_id:b.id}));await uid(3);await assert.rejects(()=>rpc('get',{book_id:b.id}));await uid(null);await assert.rejects(()=>rpc('get',{book_id:b.id}));await uid(1);const d=await rpc('admin_detail',{book_id:b.id});assert.ok(d.deleted_at);assert.equal(d.assets.length,2);assert.equal((await rpc('asset',{book_id:b.id,asset_id:b.source_asset})).kind,'source');assert.ok((await rpc('admin_list',{deleted:'deleted'})).books.some(x=>x.id===b.id));}finally{await db.close()}
});
test('software sheet bridge optimistic concurrency, replay rejection, sorting and resolution',async()=>{
 const {db,uid}=await setup();const q=async(sql,args=[])=>{await db.exec('set role authenticated');try{return (await db.query(sql,args)).rows[0]?.a}finally{await db.exec('reset role')}};
 const bridge=(body,nonce=crypto.randomUUID(),signature='00')=>q('select software_sheet_bridge($1,$2) a',[JSON.stringify({...body,ts:Math.floor(Date.now()/1000),nonce}),signature]);
 try{await uid(2);await assert.rejects(()=>q('select software_list() a'));await assert.rejects(()=>q('select software_save($1) a',[[{work_name:'forged'}]]));await assert.rejects(()=>bridge({action:'sync',rows:[]},crypto.randomUUID(),'bad'));
 await uid(1);const first=(await q('select software_save($1) a',[[{issued_at:'2026-11-01T00:00:00+09:00',work_name:'old',software_name:'Software',quantity:5,unit_price:40500}]]))[0];assert.equal(first.total,202500);await assert.rejects(()=>q('select software_save($1) a',[[{...first,version:0,work_name:'stale'}]]));
 const nonce=crypto.randomUUID();await bridge({action:'sync',rows:[]},nonce);await assert.rejects(()=>bridge({action:'sync',rows:[]},nonce));
 await bridge({action:'sync',rows:[{...first,changed:true,work_name:'sheet version'}]});let list=await q('select software_list() a');assert.equal(list.rows[0].work_name,'sheet version');
 await bridge({action:'sync',rows:[{...first,changed:true,work_name:'stale sheet edit'}]});list=await q('select software_list() a');assert.equal(list.conflicts.length,1);assert.equal(list.rows[0].work_name,'sheet version');await q('select software_resolve($1,$2,$3) a',[list.conflicts[0].id,'web',list.rows[0].version]);
 await q('select software_save($1) a',[[{issued_at:'2026-11-02T00:00:00+09:00',work_name:'newest',quantity:1,unit_price:1}]]);list=await q('select software_list() a');assert.equal(list.rows[0].work_name,'newest');assert.equal(list.conflicts.length,0);
 await uid(null);await assert.rejects(()=>q('select software_list() a'));assert.ok((await bridge({action:'sync',rows:[]})).rows.length===2);
 }finally{await db.close()}
});
