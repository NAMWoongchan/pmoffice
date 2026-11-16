import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const source = 'nexpharm-8088c44595a3';
const next = 'nexpharm-aaaaaaaaaaaa';
const uid = n => '00000000-0000-0000-0000-' + String(n).padStart(12, '0');
const digest = 'a'.repeat(64);

test('production settings enforce system administrator scope and synchronize the template', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create schema auth; create schema pmoffice_private; create schema storage;
      create table auth.users(id uuid primary key);
      insert into auth.users values ('${uid(1)}'),('${uid(2)}'),('${uid(3)}'),('${uid(4)}');
      create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
      create table public.pms_projects(slug text primary key, status text);
      create table public.pms_audit(actor uuid, project_slug text, action text, details jsonb);
      create table pmoffice_private.nexpharm_registration(slug text primary key, actor uuid, template text, source_sha256 text, file_etag text);
      create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
      insert into public.pms_projects values ('${source}','published'),('${next}','published');
      insert into pmoffice_private.nexpharm_registration values ('${source}','${uid(1)}','production_outsourcing',null,null);
      create function pmoffice_private.account_ok() returns boolean language sql as $$select auth.uid() is not null$$;
      create function pmoffice_private.is_admin() returns boolean language sql as $$select auth.uid()='${uid(1)}'::uuid$$;
      create function public.nexpharm_access(s text) returns jsonb language sql security definer set search_path='' as $$
        select jsonb_build_object('canRead',auth.uid() in ('${uid(1)}','${uid(2)}','${uid(3)}'),
          'canManage',auth.uid() in ('${uid(1)}','${uid(2)}'),
          'project',jsonb_build_object('template',r.template,'status',p.status))
        from public.pms_projects p join pmoffice_private.nexpharm_registration r on r.slug=p.slug where p.slug=s
      $$;
    `);
    for (const name of ['202611160003_nexpharm_schedule_layout', '202611170001_nexpharm_production_preferences',
      '202611170002_nexpharm_production_snapshot']) await db.exec(readFileSync('supabase/migrations/' + name + '.sql', 'utf8'));

    const identity = async (account, role = 'authenticated') => {
      await db.exec('reset role; set role ' + role);
      await db.query("select set_config('test.uid',$1,false)", [account ? uid(account) : '']);
    };
    const rpc = async (name, args) => (await db.query(
      'select public.' + name + '(' + args.map((_, index) => '$' + (index + 1)).join(',') + ') as value', args,
    )).rows[0].value;
    const get = (project = source) => rpc('nexpharm_schedule_preferences', [project]);
    const save = (action, layout, revision) => rpc('nexpharm_schedule_preferences', [source, action, layout, revision]);

    await identity(null, 'anon');
    await assert.rejects(get);
    await identity(2);
    const initial = await get();
    assert.equal(initial.canApplyGlobal, false);
    const own = structuredClone(initial.layout);
    own.fields.find(field => field.key === 'name').width = 190;
    assert.deepEqual((await save('personal', own, 0)).layout, own);
    await assert.rejects(() => save('global', own, 0));
    await identity(3);
    assert.deepEqual((await get()).layout, initial.common);
    await identity(1);
    assert.equal((await get()).canApplyGlobal, true);
    const shared = structuredClone(initial.common);
    shared.fields.find(field => field.key === 'name').title = '작업';
    const changed = await save('global', shared, 0);
    assert.equal(changed.revision, 1);
    assert.deepEqual(changed.common, shared);
    await db.exec('reset role');
    await db.query('insert into pmoffice_private.nexpharm_registration values ($1,$2,$3,$4,null)', [next, uid(1), 'production_outsourcing', digest]);
    await identity(2);
    assert.deepEqual((await get()).layout, shared);
    assert.deepEqual((await get(next)).layout, shared);
    await assert.rejects(() => save('personal', own, 0), { code: '40001' });
    await save('personal', own, 1);
    await identity(3);
    assert.deepEqual((await get()).layout, shared);

    const schedule = { days: [{ date: '2026-11-01', workday: false }], tasks: [{ id: '1' }] };
    const meta = { name: '원본.xlsm', sha256: digest, etag: 'b'.repeat(40), size: 100 };
    const path = source + '/' + meta.etag;
    const snapshot = () => rpc('nexpharm_production_snapshot', [source]);
    const commit = (...args) => rpc('nexpharm_commit_production_snapshot', args);
    assert.equal(await snapshot(), null);
    await assert.rejects(() => commit(source, uid(3), 'seed', meta, schedule, path, false));
    await identity(null, 'service_role');
    assert.equal(await commit(source, uid(1), 'seed', meta, schedule, path, true), meta.etag);
    await assert.rejects(() => commit(source, uid(1), 'seed', meta, schedule, path, true), { code: '40001' });
    await identity(3);
    const published = await snapshot();
    assert.deepEqual(published.schedule, schedule);
    assert.equal(published.current.sha256, undefined);
    await assert.rejects(() => rpc('nexpharm_production_original_path', [source, meta.etag]));
    await identity(4);
    await assert.rejects(snapshot);
    await identity(null, 'service_role');
    assert.equal(await rpc('nexpharm_production_original_path', [source, meta.etag]), path);
    await commit(source, uid(1), meta.etag, null, null, null, false);
    await identity(1);
    assert.deepEqual(await snapshot(), { current: null, schedule: null, canManage: true });
  } finally { await db.close(); }
});
