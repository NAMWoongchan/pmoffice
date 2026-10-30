import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {PGlite} from '@electric-sql/pglite';
const id=n=>'00000000-0000-0000-0000-'+String(n).padStart(12,'0');
test('real inherited membership policies: group migration, email accounts, withdrawal, private documents, VIP and mail authorization',async()=>{
 const db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema storage;create schema extensions;
 create table auth.users(id uuid primary key,email text unique,email_confirmed_at timestamptz,banned_until timestamptz,last_sign_in_at timestamptz,raw_app_meta_data jsonb default '{}');
 create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id),not_after timestamptz);
 create table auth.identities(user_id uuid,provider text,provider_id text,identity_data jsonb);
 create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text,metadata jsonb,owner uuid);alter table storage.objects enable row level security;
 grant usage on schema storage to authenticated;grant select,insert,update,delete on storage.objects to authenticated;`);
 for(const f of ['202610130001_membership.sql','202610130002_education.sql','202610130003_unified_regular.sql'])await db.exec(fs.readFileSync('tests/fixtures/'+f,'utf8'));
 await db.exec(`create table pmoffice_private.inquiry_settings(singleton boolean,bridge_secret text);insert into pmoffice_private.inquiry_settings values(true,'test-only');
 create table public.inquiry_notifications(id uuid default gen_random_uuid(),inquiry_id uuid,recipient text,state text default '대기',error text,updated_at timestamptz default now());`);
 for(let n=1;n<=8;n++){await db.query('insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data) values($1,$2,now(),$3)',[id(n),n===1?'namwoongchan@gmail.com':`user${n}@example.test`,n===5?{member_created_by:id(1),member_request_id:id(105)}:{}]);if(n!==5&&n!==7)await db.query("update profiles set signup_accepted_at=now(),signup_version=(select signup_version from pmoffice_private.service_settings) where id=$1",[id(n)]);}
 await db.query("insert into auth.identities values($1,'google','google-admin',$2)",[id(1),{email:'namwoongchan@gmail.com',email_verified:true}]);
 await db.query("update pmoffice_private.admin_identity_config set allowed_user_id=$1,allowed_google_provider_id='google-admin'",[id(1)]);await db.query('insert into admin_roles(user_id) values($1)',[id(1)]);
 for(const f of ['202610200001_pms.sql','202610200002_pms_groups.sql'])await db.exec(fs.readFileSync('supabase/migrations/'+f,'utf8'));
 await db.exec("update pms_projects set status='published',access_mode='public',listed=true where slug='korail'");
 await db.query("insert into pms_members(project_slug,user_id,role,expires_at) values('korail',$1,'viewer',now()+interval '2 days'),('korail',$2,'editor',now()-interval '1 day')",[id(2),id(4)]);
 await db.exec(fs.readFileSync('supabase/migrations/202610290001_member_access.sql','utf8'));
 await db.exec(fs.readFileSync('supabase/migrations/202610290002_member_private_rls.sql','utf8'));
 await db.exec(fs.readFileSync('supabase/migrations/202610290003_member_mail_bridge.sql','utf8'));
 await db.exec(fs.readFileSync('supabase/migrations/202610290004_korail_tasks.sql','utf8'));
 await db.exec(fs.readFileSync('supabase/migrations/202610290005_member_table_sessions.sql','utf8'));
 await db.exec(fs.readFileSync('supabase/migrations/202610300001_korail_full_tasks.sql','utf8'));
 assert.equal((await db.query("select count(*)::int n from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='r' and n.nspname in('public','pmoffice_private') and c.relname like 'member_%' and not c.relrowsecurity")).rows[0].n,0,'every new public and private member table has RLS');
 const uid=async n=>{await db.exec('reset role');await db.query("select set_config('test.uid',$1,false)",[n?id(n):''])};
 const access=async slug=>(await db.query('select public.pms_access($1) a',[slug])).rows[0].a;
 const rpc=async(sql,args=[])=>{await db.exec('set role authenticated');try{return await db.query(sql,args)}finally{await db.exec('reset role')}};
 await uid(null);assert.equal((await access('korail')).canRead,false);assert.equal((await access('korail')).project,undefined);assert.deepEqual((await db.query('select pms_catalog() a')).rows[0].a,[]);
 await uid(2);assert.equal((await access('korail')).canRead,true);assert.equal((await access('korail')).canPublish,false);
 await uid(4);assert.equal((await access('korail')).canRead,false);await uid(3);assert.equal((await access('korail')).canRead,false);
 await uid(1);assert.equal((await access('korail')).canManage,true);assert.equal((await db.query('select count(*)::int n from pmoffice_private.member_access_migration_backup')).rows[0].n,3);
 await assert.rejects(()=>rpc("select pms_save_project($1,$2)",[{slug:'korail',title:'private',status:'published',access_mode:'public',listed:true},2]));
 const group=(await rpc("select pms_save_group(null,'기업 A',true) id")).rows[0].id;
 await rpc('select pms_set_group_person($1,$2,true)',[group,id(2)]);await rpc("select pms_set_group_grant('korail',$1,'editor',true,null)",[group]);
 await uid(2);assert.equal((await access('korail')).canPublish,true);await uid(1);await rpc('select member_group_expiry($1,$2,$3)',[group,id(2),'2020-01-01T00:00:00Z']);await uid(2);assert.equal((await access('korail')).canPublish,false);await uid(1);await rpc('select member_group_expiry($1,$2,null)',[group,id(2)]);await uid(2);await assert.rejects(()=>rpc("select pms_save_group(null,'bad',true)"));await assert.rejects(()=>rpc("select pms_set_person('korail',$1,'editor',true,null)",[id(3)]));
 await uid(1);await rpc('select member_admin_register($1,$2,$3,$4)',[id(5),'김기업','기업 B','business']);await rpc('select member_admin_register($1,$2,$3,$4)',[id(5),'김기업','기업 B','business']);
 assert.equal((await db.query('select count(*)::int n from member_mail_jobs where signup_user_id=$1',[id(5)])).rows[0].n,1);
 await uid(5);assert.equal((await rpc('select member_account() a')).rows[0].a.member,true);assert.equal((await rpc('select member_account() a')).rows[0].a.profile.signup_accepted_at,null);assert.equal((await access('korail')).canRead,false);
 await uid(7);await rpc('select member_complete_registration($1,$2,$3,true)',['김개인','','individual']);assert.equal((await rpc('select member_account() a')).rows[0].a.member,true);await rpc('select member_complete_registration($1,$2,$3,true)',['김개인','','individual']);assert.equal((await db.query('select count(*)::int n from member_mail_jobs where signup_user_id=$1',[id(7)])).rows[0].n,1);
 await assert.rejects(()=>rpc('select member_admin_register($1,$2,$3,$4)',[id(3),'bad','','individual']));
 const board=(await db.query("insert into boards(slug,title,policy_mode) values('vip-ai','AI VIP','groups') returning id")).rows[0].id;
 await db.query("insert into board_access_rules values($1,'ai','vip','minimum')",[board]);const post=(await db.query("insert into posts(board_id,title,body,status) values($1,'VIP 보호','VIP only','published') returning id",[board])).rows[0].id;
 await db.query("insert into user_memberships(user_id,membership_id,tier_id,status,reason) values($1,'ai','vip','active','test')",[id(8)]);
 await uid(1);const doc={path:'/project-management.html',title:'일반 지식',category:'PM',body_html:'<h1>일반</h1><p>권한 시험문장</p>',body_text:'권한 시험문장',toc:[],source_sha256:'a'.repeat(64)};
 await rpc('select member_document_import($1,$2)',[doc,[]]);await db.query("insert into member_documents(path,title,category,body_html,body_text,source_sha256,linked_post_id) values('/vip.html','VIP 자료','VIP','<p>VIP</p>','VIP',$1,$2)",['b'.repeat(64),post]);
 await uid(2);assert.equal((await rpc('select member_document_list() a')).rows[0].a.length,1);assert.equal((await rpc("select member_document_get('/vip.html') a")).rows[0].a,null);assert.equal((await rpc("select member_document_search('시험문장') a")).rows[0].a.length,1);await assert.rejects(()=>rpc('select member_document_import($1,$2)',[doc,[]]));
 await db.exec('set role authenticated');assert.equal((await db.query('select count(*)::int n from member_documents')).rows[0].n,1);await db.exec('reset role');
 await uid(8);assert.equal((await rpc('select member_document_list() a')).rows[0].a.length,3);assert.equal((await rpc('select member_post_get($1) a',[post])).rows[0].a.body,'VIP only');
 await uid(null);await db.exec('set role anon');await assert.rejects(()=>db.query('select * from member_documents'));await assert.rejects(()=>db.query('select member_document_list()'));await db.exec('reset role');
 await uid(1);await rpc('select pms_set_group_person($1,$2,true)',[group,id(8)]);
 const people=(await rpc('select member_mail_preview($1,$2) a',[[group],[id(2)]])).rows[0].a;assert.equal(people.length,2);
 const args=[id(100),[group],[id(2)],'안내','본문',people.map(x=>x.email)];const job=(await rpc('select member_mail_send($1,$2,$3,$4,$5,$6) id',args)).rows[0].id;assert.equal((await rpc('select member_mail_send($1,$2,$3,$4,$5,$6) id',args)).rows[0].id,job);assert.equal((await db.query('select count(*)::int n from member_mail_messages where job_id=$1',[job])).rows[0].n,2);
 await assert.rejects(()=>rpc('select member_mail_send($1,$2,$3,$4,$5,$6)',[...args.slice(0,4),'다른 본문',args[5]]));
 await db.query("insert into inquiry_notifications(recipient) values('nam@msproject.kr'),('nam@pmoffice.co.kr'),('namwoongchan@gmail.com')");assert.equal((await db.query('select count(*)::int n from inquiry_notifications')).rows[0].n,1);
 assert.equal((await db.query("select count(*)::int n from member_mail_messages m join member_mail_jobs j on j.id=m.job_id where j.kind='signup_admin' and m.recipient<>'namwoongchan@gmail.com'")).rows[0].n,0);
 await rpc('select member_admin_withdraw($1)',[id(2)]);await uid(2);assert.equal((await access('korail')).canRead,false);assert.equal((await rpc('select member_account() a')).rows[0].a.member,false);assert.deepEqual((await rpc('select member_document_list() a')).rows[0].a,[]);
 await uid(1);await assert.rejects(()=>rpc('select member_admin_withdraw($1)',[id(1)]));assert.equal((await db.query("select count(*)::int n from member_mail_messages where user_id=$1 and state='queued'",[id(2)])).rows[0].n,0);
 await uid(3);await assert.rejects(()=>rpc('select member_mail_history()'));await assert.rejects(()=>rpc('select member_admin_list()'));await assert.rejects(()=>rpc('select member_registration_gate($1)',['a'.repeat(64)]));

 await uid(null);await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[id(9),'new9@example.test']);await uid(9);
 await rpc('select accept_signup($1)',[(await db.query('select signup_version v from pmoffice_private.service_settings')).rows[0].v]);
 assert.equal((await rpc('select member_account() a')).rows[0].a.member,false,'legacy acceptance cannot bypass new profile completion');
 await rpc('select member_complete_registration($1,$2,$3,true)',['새 회원','기업','business']);assert.equal((await rpc('select member_account() a')).rows[0].a.member,true);
 assert.equal((await rpc('select member_account() a')).rows[0].a.profile.signup_version,'member-v1.1');
 await uid(1);assert.equal((await rpc('select is_admin() a')).rows[0].a,true,'existing admin consent remains valid');

 // Test-only HMAC stub exercises SQL branches; real cryptographic verification is tested with the existing Apps Script bridge in production.
 await db.exec("create function extensions.hmac(bytea,bytea,text) returns bytea language sql as $$select decode('00','hex')$$");
 const bridge=async body=>rpc('select member_mail_bridge($1,$2) a',[JSON.stringify({...body,ts:Math.floor(Date.now()/1000),nonce:crypto.randomUUID()}),'00']);
 const waiting=(await bridge({action:'poll'})).rows[0].a;assert.ok(waiting.length>0);
 const claim=(await bridge({action:'claim',id:waiting[0].id})).rows[0].a;assert.equal(claim.claimed,true);
 await bridge({action:'result',id:waiting[0].id,claim_id:claim.claim_id,state:'unknown',error:'test unknown'});
 assert.equal((await bridge({action:'poll'})).rows[0].a.some(x=>x.id===waiting[0].id),false);
 await assert.rejects(()=>rpc('select member_mail_bridge($1,$2)',[JSON.stringify({action:'poll',ts:Math.floor(Date.now()/1000),nonce:crypto.randomUUID()}),'bad-signature']));

 await uid(1);await rpc('select member_profile_save($1,$2,$3,$4)',[id(9),'기관회원','한국철도공사','business']);
 await rpc('select member_position_save($1,$2)',[id(9),'책임연구원']);
 await rpc('select member_bulk_attach($1,$2)',[id(9),'한국철도공사']);
 assert.equal((await rpc('select member_bulk_lookup($1) a',['NEW9@EXAMPLE.TEST'])).rows[0].a.position,'책임연구원');
 await uid(9);let policy=(await rpc('select pms_task_policy($1) a',['korail'])).rows[0].a;assert.deepEqual(policy.organizations,['한국철도공사']);assert.equal(policy.admin,false);assert.equal(policy.allTasks,true);assert.equal((await access('korail')).canManage,false);assert.equal((await access('korail')).canPublish,false);
 const korailGroup=(await db.query("select group_id from pms_org_grants where project_slug='korail' and org_name='한국철도공사'")).rows[0].group_id;
 await uid(1);await db.query('update pms_group_members set active=false where group_id=$1 and user_id=$2',[korailGroup,id(9)]);
 await uid(9);assert.equal((await rpc("select pms_task_policy('korail') a")).rows[0].a.allTasks,false);
 await uid(1);await db.query('update pms_group_members set active=true where group_id=$1 and user_id=$2',[korailGroup,id(9)]);
 await uid(3);assert.equal((await db.query("select coalesce((pms_access('korail')->>'canRead')::boolean,false) a")).rows[0].a,false);
 await uid(9);
 await assert.rejects(()=>rpc('select pms_set_org_grant($1,$2,$3,true)',['korail','다른기관',id(1)]));
 await assert.rejects(()=>rpc('select member_bulk_lookup($1)',['namwoongchan@gmail.com']));
 await assert.rejects(()=>rpc('select member_position_save($1,$2)',[id(1),'위조']));
 await uid(1);await db.exec("update pms_group_members set expires_at=now()-interval '1 second' where user_id='"+id(9)+"'");
 await uid(9);await assert.rejects(()=>rpc('select pms_task_policy($1)',['korail']));
 await uid(1);await rpc('select member_bulk_attach($1,$2)',[id(9),'한국철도공사']);
 await rpc('select member_admin_withdraw($1)',[id(9)]);await uid(9);await assert.rejects(()=>rpc('select pms_task_policy($1)',['korail']));
 assert.equal((await db.query("select count(*)::int n from public.member_mail_messages m join public.member_mail_jobs j on j.id=m.job_id where j.kind='signup_admin' and m.recipient<>'namwoongchan@gmail.com' and m.state in('queued','sending')")).rows[0].n,0);

 await db.exec(fs.readFileSync('supabase/migrations/202610290006_bulk_passwords.sql','utf8'));
 await uid(1);let resetRows=(await rpc('select member_password_targets(0) a')).rows[0].a;
 assert.equal(resetRows.find(x=>x.id===id(1)).is_admin,true);
 assert.equal((await rpc('select member_password_target($1) a',[id(1)])).rows[0].a,false);
 assert.equal((await rpc('select member_password_target($1) a',[id(2)])).rows[0].a,true);
 await db.query('insert into admin_roles(user_id) values($1)',[id(2)]);
 assert.equal((await rpc('select member_password_target($1) a',[id(2)])).rows[0].a,false);
 assert.equal((await rpc('select member_password_target($1) a',[id(999)])).rows[0].a,false);
 await uid(3);await assert.rejects(()=>rpc('select member_password_targets(0)'));
 await assert.rejects(()=>rpc('select member_password_target($1)',[id(2)]));
 await uid(null);await db.exec('set role anon');await assert.rejects(()=>db.query('select member_password_targets(0)'));
 await db.exec('reset role');


 // Actual SQL pagination, server login sessions, revoked/expired sessions and access control.
 await uid(1);
 let count=0;
 for(const total of [0,1,99,100,101,200,201]){
  while(count<total){count++;await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[id(1000+count),`table-${count}@example.test`]);await db.query("update public.profiles set display_name='페이지회원',company='PAGE_CASE',created_at='2026-10-29T00:00:00Z' where id=$1",[id(1000+count)]);}
  const seen=[];
  for(let offset=0;offset<Math.max(1,total);offset+=100){
   const result=(await rpc('select member_admin_list($1,$2) a',['PAGE_CASE',offset])).rows[0].a;
   assert.equal(result.length,Math.min(101,total-offset));
   assert.equal(result.length>100,total-offset>100);
   seen.push(...result.slice(0,100).map(x=>x.id));
  }
  assert.equal(seen.length,total);assert.equal(new Set(seen).size,total);
  assert.deepEqual(seen,[...seen].sort(),'stable secondary ID order for identical creation timestamps');
 }
 await db.query("update auth.users set last_sign_in_at='2026-10-28T16:04:59Z' where id=$1",[id(1001)]);
 await db.query("insert into auth.sessions values($1,$2,null),($3,$2,now()-interval '1 minute'),($4,$5,now()-interval '1 minute')",[id(3001),id(1001),id(3002),id(3003),id(1002)]);
 let listed=(await rpc('select member_admin_list($1,0) a',['PAGE_CASE'])).rows[0].a;
 const first=listed.find(x=>x.id===id(1001));assert.equal(first.login_status,'signed_in');assert.ok(first.last_sign_in_at.startsWith('2026-10-28T16:04:59'));
 assert.equal(listed.find(x=>x.id===id(1002)).login_status,'signed_out','expired session is not a login');
 assert.equal(listed.find(x=>x.id===id(1003)).last_sign_in_at,null,'never logged in remains null');
 assert.equal(first.session_id,undefined);assert.equal(first.access_token,undefined);assert.equal(first.refresh_token,undefined);
 await db.query('delete from auth.sessions where id=$1',[id(3001)]);
 assert.equal((await rpc('select member_admin_list($1,0) a',['table-1@'])).rows[0].a[0].login_status,'signed_out','last valid session removed by signOut');
 await db.query('insert into auth.sessions values($1,$2,null),($3,$2,null)',[id(3004),id(1001),id(3005)]);
 await db.query('delete from auth.sessions where id=$1',[id(3004)]);
 assert.equal((await rpc('select member_admin_list($1,0) a',['table-1@'])).rows[0].a[0].login_status,'signed_in','another device remains signed in');
 await db.query("update auth.users set banned_until=now()+interval '1 day' where id=$1",[id(1001)]);
 assert.equal((await rpc('select member_admin_list($1,0) a',['table-1@'])).rows[0].a[0].login_status,'blocked');
 await db.query("update profiles set withdrawn_at=now(),status='suspended' where id=$1",[id(1002)]);
 const withdrawn=(await rpc('select member_admin_list($1,0) a',['table-2@'])).rows[0].a[0];assert.ok(withdrawn.withdrawn_at);assert.equal(withdrawn.login_status,'blocked');
 assert.equal((await rpc('select member_admin_list($1,0) a',['페이지회원'])).rows[0].a.length,101);
 assert.equal((await rpc('select member_admin_list($1,0) a',['nonexistent-table-case'])).rows[0].a.length,0);
 assert.equal((await rpc('select member_admin_list($1,-1) a',['PAGE_CASE'])).rows[0].a.length,101);
 await uid(3);await assert.rejects(()=>rpc('select member_admin_list()'));
 await uid(null);await db.exec('set role anon');await assert.rejects(()=>db.query('select member_admin_list()'));await db.exec('reset role');

 await db.close();
});
