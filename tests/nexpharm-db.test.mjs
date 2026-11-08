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
      create schema auth;
      create schema pmoffice_private;
      create table pmoffice_private.service_settings(singleton boolean, signup_version text);
      create table auth.users(id uuid primary key, email text, email_confirmed_at timestamptz);
      create table auth.identities(user_id uuid, provider text, identity_data jsonb);
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
    const id = n => '00000000-0000-0000-0000-' + String(n).padStart(12, '0');
    for (let n = 1; n <= 4; n++) await db.query('insert into auth.users(id) values ($1)', [id(n)]);
    await db.query(`insert into public.pms_group_members(group_id,user_id) values
      ('e99358b1-8880-4e2e-894f-d42c9d0efdd0',$1),('3d615d9d-c1a6-4aa2-8ab1-4335f54ec541',$2)`, [id(2), id(3)]);

    const uid = n => db.query("select set_config('test.uid',$1,false)", [n ? id(n) : '']);
    const query = async (sql, args = []) => (await db.query(sql, args)).rows[0]?.result;
    const catalog = () => query('select public.nexpharm_catalog() as result');
    const access = slug => query('select public.nexpharm_access($1) as result', [slug]);
    const create = title => query('select public.nexpharm_create_project($1) as result', [title]);

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
    await assert.rejects(() => query('select * from public.pms_projects'));
    await uid(3);
    assert.equal((await access(one.slug)).canRead, true);
    assert.equal((await access(one.slug)).canManage, false);
    await assert.rejects(() => create('차단된 등록'));
    await uid(4);
    assert.deepEqual((await catalog()).projects, []);
    assert.equal((await access(two.slug)).project, null);
    await uid(1);
    assert.equal((await access(two.slug)).canManage, true);
    await db.exec('reset role');
    await db.query("update public.pms_group_members set expires_at=now()-interval '1 minute' where user_id=$1", [id(2)]);
    await uid(2);
    assert.equal((await access(one.slug)).canRead, false);
  } finally { await db.close(); }
});
