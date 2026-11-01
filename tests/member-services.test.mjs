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
return {db,uid,rpc}}
test('Project Online and member services preserve isolation, legacy education and server revocation',async()=>{
const {db,uid,rpc}=await setup();
const call=async(name,args=[])=>{await db.exec('set role authenticated');try{return (await db.query('select public.'+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') as data',args)).rows[0].data}finally{await db.exec('reset role')}};
try{
await db.query("insert into public.unified_regular_memberships(user_id,status,expires_at,reason) values($1,'active',now()+interval '1 day','legacy test')",[id(2)]);
await db.query("insert into public.user_memberships(user_id,membership_id,tier_id,status,expires_at,reason) values($1,'ai','vip','active',now()+interval '1 day','legacy test')",[id(3)]);
await db.exec(fs.readFileSync('supabase/migrations/202611010002_member_services.sql','utf8'));
await db.exec("insert into public.pms_projects(slug,title,status,access_mode,listed) values('alpha','철도차량 차륜 자동검사시스템','published','assigned',false),('beta','Other client','published','assigned',false),('draft','Admin draft','draft','assigned',false)");
await db.query("insert into public.pms_groups(id,name) values($1,'alpha group')",[id(90)]);await db.query('insert into public.pms_group_members(group_id,user_id) values($1,$2)',[id(90),id(2)]);await db.query("insert into public.pms_group_grants(project_slug,group_id,role) values('alpha',$1,'viewer')",[id(90)]);
await uid(null);assert.deepEqual(await call('pms_catalog'),[]);await assert.rejects(()=>call('member_services'));
await uid(1);assert.equal((await call('pms_catalog')).length,4);assert.equal((await rpc('session')).unlimited,true);
await uid(2);let data=await call('member_services');assert.deepEqual(data.education.map(x=>x.kind),['msp','ai']);assert.equal(data.projects.length,1);assert.equal(data.projects[0].slug,'alpha');assert.equal(data.ebook.books,0);assert.equal(data.ebook.max,10);
await db.query("update public.unified_regular_memberships set expires_at=now()-interval '1 second',starts_at=now()-interval '2 days' where user_id=$1",[id(2)]);assert.equal((await call('member_services')).education.length,0,'legacy expiry retained');
await uid(3);assert.deepEqual((await call('member_services')).education.map(x=>x.kind),['ai']);assert.deepEqual(await call('pms_catalog'),[]);await assert.rejects(()=>call('member_admin_set_education',[id(3),'msp',true]));await assert.rejects(()=>call('member_admin_education',[id(2)]));await assert.rejects(()=>call('member_services',[id(2)]));
await uid(1);await call('member_admin_set_education',[id(2),'msp',true]);await call('member_admin_set_education',[id(2),'ai',true]);await assert.rejects(()=>call('member_admin_set_education',[id(2),'unknown',true]));
await uid(2);assert.equal((await call('member_services')).education.length,2);
await db.exec("insert into public.courses(id,slug,title,membership_id,published,auto_enroll) values('00000000-0000-0000-0000-000000000081','test-msp','Test MSP','msp',true,true); insert into public.lessons(id,course_id,slug,ordinal,title,access_mode,published,media_ready,duration_seconds) values('00000000-0000-0000-0000-000000000082','00000000-0000-0000-0000-000000000081','test',1,'Fixture lesson','member',true,true,1)");
// Content/media readiness is a fixture; real inherited lesson authorization remains under test.
await db.exec("create or replace function pmoffice_private.education_content_ready(p_id uuid) returns boolean language sql stable as $$select true$$; create or replace function pmoffice_private.education_media_ready(p_id uuid) returns boolean language sql stable as $$select true$$");
await call('enroll_course',[id(81)]);assert.equal((await db.query('select pmoffice_private.can_read_lesson($1) as allowed',[id(82)])).rows[0].allowed,true);
await uid(1);await call('member_admin_set_education',[id(2),'msp',false]);await uid(2);assert.deepEqual((await call('member_services')).education.map(x=>x.kind),['ai']);assert.equal((await db.query('select pmoffice_private.can_read_lesson($1) as allowed',[id(82)])).rows[0].allowed,false,'revocation blocks previously enrolled protected lesson');
await uid(1);await db.query("insert into public.pms_groups(id,name) values($1,'member-services fixture')",[id(91)]);await db.query('insert into public.pms_group_members(group_id,user_id) values($1,$2)',[id(91),id(2)]);await db.query("insert into public.pms_group_grants(project_slug,group_id,role) values('beta',$1,'viewer')",[id(91)]);await rpc('group_policy',{group_id:id(91),effect:'deny'});
await uid(2);data=await call('member_services');assert.equal(data.projects.length,2);assert.equal(data.ebook.enabled,false);assert.equal(data.ebook.books,0,'blocked ebook members still see own workspace summary');await assert.rejects(()=>rpc('list'));
await db.query("update public.pms_group_grants set expires_at=now()-interval '1 second' where group_id=$1",[id(91)]);assert.equal((await call('member_services')).projects.length,1);
await db.query('update public.pms_group_members set active=false where group_id=$1',[id(90)]);assert.equal((await call('member_services')).projects.length,0);
await uid(4);assert.equal((await call('member_services')).education.length,0);await db.exec('set role authenticated');await assert.rejects(()=>db.query('select * from pmoffice_private.education_services'));await db.exec('reset role');
}finally{await db.close()}});
