import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

test('Nexpharm membership, duplicate-safe project registration, expiry, and isolation', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role;
      create schema auth;
      create schema pmoffice_private;
      create table pmoffice_private.service_settings(singleton boolean, signup_version text);
      create table auth.users(id uuid primary key, email text, email_confirmed_at timestamptz);
      create table auth.identities(user_id uuid, provider text, identity_data jsonb);
      create table public.profiles(id uuid primary key, display_name text, status text, withdrawn_at timestamptz, registered_at timestamptz, signup_accepted_at timestamptz);
      create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
      create function pmoffice_private.account_ok() returns boolean language sql as $$select auth.uid() is not null$$;
      create function pmoffice_private.is_admin() returns boolean language sql as $$
        select auth.uid() = '00000000-0000-0000-0000-000000000001'::uuid
      $$;
    `);
    for (const name of ['202610200001_pms', '202610200002_pms_groups']) {
      await db.exec(readFileSync('supabase/migrations/' + name + '.sql', 'utf8'));
    }
    await db.exec('alter table public.pms_group_members add column expires_at timestamptz');
    await db.exec(readFileSync('supabase/migrations/202611080001_nexpharm_pms.sql', 'utf8'));
    await db.exec(readFileSync('supabase/migrations/202611080002_nexpharm_admin.sql', 'utf8'));
    await db.exec(readFileSync('supabase/migrations/202611160001_nexpharm_center.sql', 'utf8'));
    await db.exec(readFileSync('supabase/migrations/202611160002_nexpharm_templates.sql', 'utf8'));
    const id = n => '00000000-0000-0000-0000-' + String(n).padStart(12, '0');
    for (let n = 1; n <= 5; n++) {
      await db.query('insert into auth.users(id,email) values ($1,$2)', [id(n), 'user'+n+'@example.test']);
      await db.query("insert into public.profiles(id,display_name,status,registered_at) values ($1,$2,'active',now())", [id(n), 'User '+n]);
    }
    await db.query(`insert into public.pms_group_members(group_id,user_id) values
      ('e99358b1-8880-4e2e-894f-d42c9d0efdd0',$1),('3d615d9d-c1a6-4aa2-8ab1-4335f54ec541',$2)`, [id(2), id(3)]);

    const uid = n => db.query("select set_config('test.uid',$1,false)", [n ? id(n) : '']);
    const query = async (sql, args = []) => (await db.query(sql, args)).rows[0]?.result;
    const catalog = () => query('select public.nexpharm_catalog() as result');
    const access = slug => query('select public.nexpharm_access($1) as result', [slug]);
    const create = title => query('select public.nexpharm_create_project($1) as result', [title]);

    const update = (slug, version, title) => query('select public.nexpharm_update_project($1,$2,$3,$4) as result', [slug,version,title,'프로젝트 설명']);
    const assign = (user,role) => query('select public.nexpharm_set_member_role($1,$2)', [id(user),role]);
    const roster = () => query('select public.nexpharm_admin_members() as result');
    const prepare = title => query('select public.nexpharm_prepare_project($1) as result', [title]);
    const publish = (slug, etag) => query('select public.nexpharm_publish_project($1,$2)', [slug, etag]);
    const comments = slug => query('select public.nexpharm_comments($1) as result', [slug]);
    const posts = () => query('select public.nexpharm_posts() as result');

    await uid(null);
    await db.exec('set role anon');
    await assert.rejects(catalog);
    await db.exec('reset role');
    await uid(2);
    await db.exec('set role authenticated');
    assert.equal((await catalog()).canManage, true);
    const one = await create('첫 번째 프로젝트');
    const two = await create('두 번째 프로젝트');
    assert.notEqual(one.slug, two.slug);
    assert.deepEqual(await create('첫 번째 프로젝트'), one);
    assert.equal((await catalog()).projects.length, 2);
    assert.equal((await access('korail')).canRead, false);
    await assert.rejects(() => update('korail',1,'범위 외 수정'));
    await assert.rejects(() => assign(3,'manager'));
    await assert.rejects(roster);
    const staged = await prepare('엑셀 프로젝트');
    assert.deepEqual(await prepare('엑셀 프로젝트'), staged);
    assert.equal((await access(staged.slug)).project.status, 'draft');
    assert.equal((await catalog()).projects.some(project => project.slug === staged.slug), false);
    await assert.rejects(() => publish(staged.slug, 'saved-workbook'));
    await assert.rejects(() => comments(staged.slug));
    await uid(3);
    assert.equal((await access(staged.slug)).canRead, false);
    await assert.rejects(() => prepare('직원 등록 차단'));
    await assert.rejects(() => publish(staged.slug, 'saved-workbook'));
    await uid(2);
    await query('select public.nexpharm_file_audit($1,$2,$3)', [
      staged.slug, 'workbook.publish', JSON.stringify({blob: 'saved-workbook'}),
    ]);
    await assert.rejects(() => publish(staged.slug, 'other-workbook'));
    await publish(staged.slug, 'saved-workbook');
    await publish(staged.slug, 'saved-workbook');
    assert.equal((await access(staged.slug)).project.status, 'published');
    await assert.rejects(() => prepare('엑셀 프로젝트'));
    const memberEntry = () => query('select public.nexpharm_member_entry() as result');
    const digest = 'd'.repeat(64);
    const etag = 'e'.repeat(40);
    const typed = (sha = digest) => query('select public.nexpharm_prepare_typed_project($1,$2,$3) as result',
      ['생산 일정', 'production_outsourcing', sha]);
    assert.equal(await memberEntry(), true);
    assert.equal((await access(staged.slug)).project.template, 'rd');
    const production = await typed();
    assert.deepEqual(await typed(), production);
    assert.equal((await catalog()).projects.some(project => project.slug === production.slug), false);
    const receipt = () => query('select public.nexpharm_record_typed_upload($1,$2,$3)', [production.slug, digest, etag]);
    await assert.rejects(receipt);
    await query('select public.nexpharm_file_audit($1,$2,$3)', [production.slug, 'workbook.publish', JSON.stringify({blob: etag})]);
    await assert.rejects(() => publish(production.slug, etag));
    await db.exec('reset role; set role service_role');
    await receipt();
    await db.exec('reset role; set role authenticated');
    await publish(production.slug, etag);
    assert.deepEqual(await typed(), {slug:production.slug,published:true});
    await assert.rejects(() => typed('1'.repeat(64)));
    assert.equal((await catalog()).projects.find(project => project.slug === production.slug).template, 'production_outsourcing');

    const saved = await update(one.slug,1,'수정한 프로젝트');
    assert.equal(saved.version,2);
    assert.equal(saved.description,'프로젝트 설명');
    assert.equal((await access(one.slug)).project.title,'수정한 프로젝트');
    await assert.rejects(() => update(one.slug,1,'이전 버전'));
    await assert.rejects(() => update(one.slug,2,'두 번째 프로젝트'));
    await assert.rejects(() => query('select * from public.pms_projects'));
    await uid(3);
    assert.equal(await memberEntry(), true);
    await assert.rejects(typed);
    assert.equal((await access(production.slug)).canRead, true);
    assert.equal((await access(one.slug)).canRead, true);
    assert.equal((await access(one.slug)).canManage, false);
    await assert.rejects(() => create('차단된 등록'));
    await assert.rejects(() => update(one.slug,2,'직원 수정 차단'));
    await query('select public.nexpharm_add_comment($1,$2)', [staged.slug, '<b>확인</b>']);
    await query('select public.nexpharm_add_post($1,$2)', ['게시글', '첫 줄\n둘째 줄']);
    assert.equal((await comments(staged.slug))[0].body, '<b>확인</b>');
    assert.equal((await catalog()).projects.find(project => project.slug === staged.slug).comment, '<b>확인</b>');
    assert.equal((await posts())[0].body, '첫 줄\n둘째 줄');
    await assert.rejects(() => query('select * from pmoffice_private.nexpharm_post'));
    await uid(4);
    assert.equal(await memberEntry(), false);
    assert.equal((await access(production.slug)).canRead, false);
    await assert.rejects(posts);
    await assert.rejects(() => comments(staged.slug));
    await assert.rejects(() => query('select public.nexpharm_add_post($1,$2)', ['외부인', '차단']));
    assert.deepEqual((await catalog()).projects, []);
    assert.equal((await access(two.slug)).project, null);
    await uid(1);
    assert.equal((await access(two.slug)).canManage, true);
    await assign(3,'manager');
    await assign(5,'staff');
    assert.equal((await roster()).find(item=>item.user_id===id(5)).role,'staff');
    await uid(3);
    assert.equal((await access(one.slug)).canManage,true);
    await uid(1);
    await assign(3,'staff');
    await uid(3);
    assert.equal((await access(one.slug)).canRead,true);
    assert.equal((await access(one.slug)).canManage,false);
    await uid(1);
    await assign(3,'none');
    await uid(3);
    assert.equal((await access(one.slug)).canRead,false);
    await db.exec('reset role');
    await db.query("update public.pms_group_members set expires_at=now()-interval '1 minute' where user_id=$1", [id(2)]);
    await uid(2);
    assert.equal((await access(one.slug)).canRead, false);
  } finally { await db.close(); }
});
