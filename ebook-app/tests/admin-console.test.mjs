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
for(const f of ['202610130001_membership.sql','202610130002_education.sql','202610130003_unified_regular.sql'])await db.exec(fs.readFileSync('../tests/fixtures/'+f,'utf8'));
await db.exec(`create table pmoffice_private.inquiry_settings(singleton boolean,bridge_secret text);insert into pmoffice_private.inquiry_settings values(true,'test-only');create table public.inquiry_notifications(id uuid default gen_random_uuid(),inquiry_id uuid,recipient text,state text default '대기',error text,updated_at timestamptz default now());`);
for(let n=1;n<=4;n++){await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[id(n),n===1?'namwoongchan@gmail.com':`user${n}@example.test`]);await db.query('update profiles set signup_accepted_at=now(),signup_version=(select signup_version from pmoffice_private.service_settings) where id=$1',[id(n)])}
await db.query("insert into auth.identities values($1,'google','google-admin',$2)",[id(1),{email:'namwoongchan@gmail.com',email_verified:true}]);await db.query("update pmoffice_private.admin_identity_config set allowed_user_id=$1,allowed_google_provider_id='google-admin'",[id(1)]);await db.query('insert into admin_roles(user_id) values($1)',[id(1)]);
for(const f of ['202610200001_pms.sql','202610200002_pms_groups.sql','202610290001_member_access.sql','202610310001_ebooks.sql','202610310003_ebook_public_url.sql','202611010001_ebook_admin_unlimited.sql'])await db.exec(fs.readFileSync('../supabase/migrations/'+f,'utf8'));
const uid=async n=>{await db.exec('reset role');await db.query("select set_config('test.uid',$1,false)",[n?id(n):''])};
const rpc=async(action,p={},internal=false)=>{await db.exec('set role '+(internal?'service_role':'authenticated'));try{return (await db.query(`select public.${internal?'ebook_internal':'ebook_api'}($1,$2) a`,[action,p])).rows[0].a}finally{await db.exec('reset role')}};
await db.exec("create table public.customer_inquiries(id uuid default gen_random_uuid(),status text);insert into public.customer_inquiries(status) values('신규'),('확인 중'),('처리 완료');");await db.exec(fs.readFileSync('../supabase/migrations/202611020001_admin_console.sql','utf8'));return {db,uid,rpc}}

test('admin console: list, source, publication, soft delete/restore, retry leases and audits',async()=>{
 const {db,uid,rpc}=await setup();try{
 await uid(1);await rpc('settings',{released:true,max_storage_bytes:1048576,max_daily_jobs:100,max_daily_delivery_bytes:1048576});
 assert.deepEqual((await db.query('select public.admin_inquiry_summary() a')).rows[0].a,{new:1,processing:1});
 await uid(2);const b=await rpc('create',{title:'회원 문서',filename:'owner.pdf',bytes:1});
 await rpc('chunk',{asset_id:b.source_asset,idx:0,bytes:1,sha256:'a'.repeat(64),object_path:'test/source.bin',git_sha:'b'.repeat(40)},true);
 await rpc('submit',{book_id:b.id});const claim=await rpc('claim',{},true),lease={book_id:b.id,lease_id:claim.job.lease_id};
 await uid(1);const detail=()=>rpc('admin_detail',{book_id:b.id});const act=async(action,extra={})=>{const d=await detail();return rpc('admin_'+action,{book_id:b.id,expected_updated_at:d.updated_at,reason:'검증용 사유',...extra})};
 assert.equal((await detail()).assets[0].kind,'source');assert.equal((await rpc('admin_list',{search:'owner.pdf'})).total,1);
 assert.equal((await rpc('admin_summary')).queued,0);
 await assert.rejects(()=>act('delete',{reason:''}));await assert.rejects(()=>act('delete',{expected_updated_at:'2000-01-01T00:00:00Z'}));
 await act('delete');await assert.rejects(()=>rpc('finish',{...lease,pages:1},true));await assert.rejects(()=>rpc('fail',{...lease,error:'stale'},true));
 assert.equal((await rpc('admin_list')).total,0);assert.equal((await rpc('admin_list',{deleted:'deleted'})).total,1);
 assert.equal((await rpc('asset',{book_id:b.id,asset_id:b.source_asset})).kind,'source');
 await uid(2);for(const action of ['admin_summary','admin_list','admin_detail','admin_history','admin_retry','admin_suspend','admin_resume','admin_delete','admin_restore'])await assert.rejects(()=>rpc(action,{book_id:b.id,reason:'forged'}));
 await assert.rejects(()=>rpc('get',{book_id:b.id}));await assert.rejects(()=>rpc('share',{book_id:b.id,visibility:'public'}));
 await uid(null);await assert.rejects(()=>rpc('admin_list'));await assert.rejects(()=>rpc('get',{book_id:b.id}));
 await uid(1);let r=await act('restore');assert.equal(r.state,'failed');assert.equal(r.publication_suspended,true);assert.equal(r.visibility,'private');
 await act('retry');await assert.rejects(()=>act('retry'));assert.equal((await rpc('admin_summary')).queued,1);
 const c2=await rpc('claim',{},true);assert.notEqual(c2.job.lease_id,lease.lease_id);await assert.rejects(()=>rpc('heartbeat',lease,true));
 await rpc('fail',{book_id:b.id,lease_id:c2.job.lease_id,error:'synthetic failure'},true);assert.equal((await detail()).state,'failed');
 await act('retry');const c3=await rpc('claim',{},true);const l3={book_id:b.id,lease_id:c3.job.lease_id};
 await act('suspend');await assert.rejects(()=>rpc('finish',{...l3,pages:1},true));await assert.rejects(()=>rpc('source',l3,true));assert.equal((await detail()).state,'failed');
 await db.query("update pmoffice_private.ebook_books set state='ready',publication_suspended=false,visibility='public' where id=$1",[b.id]);
 await uid(2);assert.equal((await rpc('get',{book_id:b.id})).state,'ready');await uid(null);assert.equal((await rpc('get',{book_id:b.id})).state,'ready');
 await uid(1);await act('suspend');await uid(2);await assert.rejects(()=>rpc('get',{book_id:b.id}));await assert.rejects(()=>rpc('approve',{book_id:b.id}));await uid(null);await assert.rejects(()=>rpc('get',{book_id:b.id}));
 await uid(1);await act('resume');await uid(2);assert.equal((await rpc('get',{book_id:b.id})).state,'ready');
 await uid(1);await act('delete');await act('restore');let d=await detail();assert.equal(d.publication_suspended,true);assert.equal(d.visibility,'private');assert.ok(d.audit.some(a=>a.action==='admin.delete'&&a.reason&&a.before_state&&a.after_state));
 assert.ok((await rpc('admin_history')).length>=8);
 for(let i=0;i<51;i++)await rpc('create',{title:'페이지 검증 '+i,filename:'page.pdf',bytes:1});
 assert.equal((await rpc('admin_list',{search:'페이지 검증'})).books.length,50);assert.equal((await rpc('admin_list',{search:'페이지 검증',offset:50})).books.length,1);
 await db.query('delete from public.admin_roles where user_id=$1',[id(1)]);await assert.rejects(()=>rpc('admin_list'));
 }finally{await db.close()}
});
