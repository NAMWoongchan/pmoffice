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
await db.exec(fs.readFileSync('supabase/migrations/202611020006_member_views.sql','utf8'));
await db.exec(`create function public.member_position_save(p_user uuid,p_position text) returns void language plpgsql as $$begin end$$;`);await db.exec(fs.readFileSync('supabase/migrations/202611020007_member_compact_signup.sql','utf8'));await db.exec(`create table public.test_change_signals(scope text);create function pmoffice_private.change_signal() returns trigger language plpgsql security definer as $$begin insert into public.test_change_signals values(TG_ARGV[0]);return null;end$$;`);await db.exec(fs.readFileSync('supabase/migrations/202611020008_admin_service_requests.sql','utf8'));return {db,uid,rpc}}




test('admin requested services preserve original answers and actual grants, reject other users and stale updates, emit change signal',async()=>{const {db,uid}=await setup();const q=async(sql,args=[])=>{await db.exec('set role authenticated');try{return (await db.query(sql,args)).rows[0]?.a}finally{await db.exec('reset role')}};try{await uid(2);await q('select member_signup_service_request($1,$2) a',[['ai:vip'],'직함']);let d=await q('select member_detail() a');const original=d.original_answers;await assert.rejects(()=>q('select member_admin_requested_services_save($1,$2) a',[id(2),['msp:premium']]));await uid(1);await assert.rejects(()=>q('select member_admin_requested_services_save($1,$2) a',[id(1),['msp:premium']]));await q('select member_admin_requested_services_save($1,$2,$3,$4) a',[id(2),['msp:premium'],'관리자 검증',d.details_updated_at]);await assert.rejects(()=>q('select member_admin_requested_services_save($1,$2,$3,$4) a',[id(2),['ai:premium'],'오래된 화면',d.details_updated_at]));await uid(2);d=await q('select member_detail() a');assert.deepEqual(d.requested_services,['msp:premium']);assert.equal(d.requested_source,'admin');assert.deepEqual(d.original_answers,original);assert.deepEqual(d.services,['seedling']);await assert.rejects(()=>q('select member_signup_service_request($1,$2) a',[['ai:premium'],'직함']));await uid(1);const a=await q('select member_admin_signup_answers($1) a',[[id(2)]]);assert.deepEqual(a[0].requested_names,['MS Project: 프리미엄']);assert.equal(a[0].requested_source,'admin');assert.ok((await db.query('select count(*)::int n from test_change_signals')).rows[0].n>0);await db.exec('set role anon');await assert.rejects(()=>db.query('select member_admin_requested_services_save($1,$2)',[id(2),['ai:vip']]));}finally{await db.close()}});

test('AI work is private and persists versioned planning and status history', async () => {
  const { db, uid } = await setup()
  const rpc = async (action, item = {}, values = {}, role = 'authenticated') => {
    await db.exec('set role ' + role)
    try {
      const { rows } = await db.query('select public.admin_ai_work($1,$2,$3,$4) a', [
        action, item.id ?? null, item.version ?? null, values,
      ])
      return rows[0].a
    } finally {
      await db.exec('reset role')
    }
  }
  const denied = { code: '42501' }
  try {
    await db.exec(fs.readFileSync('supabase/migrations/202611110001_admin_ai_work.sql', 'utf8'))
    await uid(1)
    await db.query("update public.profiles set display_name='시험 관리자' where id=$1", [id(1)])
    const idea = { title: '합성 아이디어', problem: '작업 기록을 추적한다' }
    await assert.rejects(() => rpc('save', {}, { title: ' ', problem: idea.problem }), { code: '23514' })
    const created = await rpc('save', {}, idea)
    assert.equal(created.status, 'idea')
    assert.equal(created.created_at, created.updated_at)
    assert.equal(created.updated_by_name, '시험 관리자')
    assert.equal(created.events[0].event_type, 'created')

    const plan = { ...idea, status: 'planning', priority: 'high', development_plan: '검증 계획', next_step: '검토' }
    const updated = await rpc('save', created, plan)
    assert.equal(updated.created_at, created.created_at)
    assert.equal(updated.events[0].previous_status, 'idea')
    assert.equal(updated.events[0].status, 'planning')
    await assert.rejects(() => rpc('save', created, plan), { code: '40001' })
    assert.deepEqual(await rpc('get', created), updated)

    const archived = await rpc('archive', updated)
    assert.deepEqual(await rpc('list'), [])
    assert.equal((await rpc('list', {}, { archived: true }))[0].id, created.id)
    const restored = await rpc('restore', archived)
    assert.equal((await rpc('list'))[0].development_plan, '검증 계획')
    assert.deepEqual(restored.events.map(event => event.event_type), ['restored', 'archived', 'status', 'created'])


    const oldHigh = await rpc('save', {}, { ...idea, priority: 'high' })
    const oldLow = await rpc('save', {}, { ...idea, priority: 'low' })
    await db.exec(fs.readFileSync('supabase/migrations/202611110002_admin_ai_work_fields.sql', 'utf8'))
    assert.deepEqual(await rpc('fields'), [])
    assert.equal((await rpc('get', restored)).priority_rating, 5)
    assert.equal((await rpc('get', oldHigh)).priority_rating, 5)
    assert.equal((await rpc('get', oldLow)).priority_rating, 1)
    const oldDefault = await rpc('save', {}, idea)
    assert.equal(oldDefault.priority_rating, 3)
    assert.deepEqual(oldDefault.fields, [])
    const categorized = await rpc('save', restored, { ...plan, fields: [' AI ', '기획', 'ai'], priority_rating: 4 })
    assert.deepEqual(categorized.fields, ['AI', '기획'])
    assert.equal(categorized.priority_rating, 4)
    const legacy = await rpc('save', categorized, plan)
    assert.equal(legacy.priority_rating, 4)
    assert.deepEqual(legacy.fields, ['AI', '기획'])
    assert.deepEqual((await rpc('get', legacy)).fields, ['AI', '기획'])
    assert.deepEqual(new Set(await rpc('fields')), new Set(['AI', '기획']))
    await assert.rejects(() => rpc('save', {}, { ...idea, title: '', fields: ['실패 시 미등록'] }), { code: '23514' })
    assert.equal((await rpc('fields')).includes('실패 시 미등록'), false)
    for (const rating of [0, 1, 2, 3, 4, 5]) {
      const saved = await rpc('save', {}, { ...idea, fields: ['ai'], priority_rating: rating })
      assert.equal(saved.priority_rating, rating)
      assert.deepEqual(saved.fields, ['AI'])
    }
    const cleared = await rpc('save', legacy, { ...plan, fields: [], priority_rating: 0 })
    assert.deepEqual(cleared.fields, [])
    await rpc('archive', cleared)
    assert.deepEqual(new Set(await rpc('fields')), new Set(['AI', '기획']))
    await assert.rejects(() => rpc('fields', {}, {}, 'anon'), denied)
    await assert.rejects(() => rpc('get', created, {}, 'anon'), denied)
    await uid(2)
    for (const action of ['list', 'get', 'save', 'archive', 'restore', 'fields']) {
      await assert.rejects(() => rpc(action, restored, plan), denied)
    }
    await db.exec('set role authenticated')
    try {
      await assert.rejects(() => db.query('select * from pmoffice_private.ai_work_items'), denied)
      await assert.rejects(() => db.query('select * from pmoffice_private.ai_work_events'), denied)
    } finally {
      await db.exec('reset role')
    }
    await db.exec(fs.readFileSync('supabase/migrations/202611080001_nexpharm_pms.sql', 'utf8'))
    await db.query("insert into public.pms_group_members(group_id, user_id) values('e99358b1-8880-4e2e-894f-d42c9d0efdd0',$1)", [id(2)])
    assert.equal((await db.query('select public.nexpharm_catalog() a')).rows[0].a.canManage, true)
    await assert.rejects(() => rpc('get', restored), denied)
    await uid(1)
    await db.query("update public.profiles set status='suspended' where id=$1", [id(1)])
    await assert.rejects(() => rpc('get', restored), denied)
    await db.query("update public.profiles set status='active' where id=$1", [id(1)])
    await db.query('delete from public.admin_roles where user_id=$1', [id(1)])
    await assert.rejects(() => rpc('get', restored), denied)
  } finally {
    await db.close()
  }
})
