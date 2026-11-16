import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire, Module } from 'node:module';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { buildSync } from 'esbuild';
import { JSDOM } from 'jsdom';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
const project = 'nexpharm-8088c44595a3';
const user = n => '00000000-0000-0000-0000-' + String(n).padStart(12, '0');
const bundle = buildSync({
  stdin: { contents: `export { defaultScheduleLayout, displayHours } from './pms-app/lib/nexpharm-schedule-layout';
    export { NexpharmProductionSchedule } from './pms-app/components/NexpharmProductionSchedule';`, resolveDir: process.cwd() },
  resolveExtensions: ['.ts', '.tsx', '.js'], bundle: true, platform: 'node', packages: 'external', format: 'cjs', write: false,
});
const compilation = new Module(import.meta.filename);
compilation.require = require;
compilation._compile(bundle.outputFiles[0].text, import.meta.filename);
const { defaultScheduleLayout, displayHours, NexpharmProductionSchedule } = compilation.exports;

test('production layout stores one validated preference per permitted account and project', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create schema auth;
      create schema pmoffice_private;
      create table auth.users(id uuid primary key);
      create table public.pms_projects(slug text primary key);
      insert into auth.users values ('${user(1)}'),('${user(2)}'),('${user(3)}');
      insert into public.pms_projects values ('${project}');
      create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
      create function public.nexpharm_access(text) returns jsonb language sql as $$
        select jsonb_build_object('canRead', auth.uid() in ('${user(1)}'::uuid,'${user(2)}'::uuid),
          'project', jsonb_build_object('status','published','template','production_outsourcing'))
      $$;
    `);
    await db.exec(readFileSync('supabase/migrations/202611160003_nexpharm_schedule_layout.sql', 'utf8'));
    const identity = n => db.query("select set_config('test.uid',$1,false)", [n ? user(n) : '']);
    const get = async (slug = project) => (await db.query('select public.nexpharm_schedule_layout($1) as layout', [slug])).rows[0].layout;
    const put = async layout => (await db.query('select public.nexpharm_schedule_layout($1,$2) as layout', [project, layout])).rows[0].layout;
    await db.exec('set role anon');
    await assert.rejects(get);
    await db.exec('reset role; set role authenticated');
    await identity(1);
    assert.equal(await get(), null);
    const custom = defaultScheduleLayout();
    custom.fields.reverse();
    custom.fields.find(field => field.key === 'hours').visible = false;
    custom.ganttVisible = false;
    custom.ganttWidth = 100;
    assert.deepEqual(await put(custom), custom);
    await assert.rejects(() => get('nexpharm-583d09bdd195'));
    await assert.rejects(() => db.query('select * from pmoffice_private.nexpharm_schedule_layout'));
    await identity(2);
    assert.equal(await get(), null);
    const second = defaultScheduleLayout();
    await put(second);
    await identity(1);
    assert.deepEqual(await get(), custom);
    const invalid = structuredClone(custom);
    invalid.fields.find(field => field.key === 'name').visible = false;
    await assert.rejects(() => put(invalid));
    assert.deepEqual(await get(), custom);
    await identity(3);
    await assert.rejects(get);
    await assert.rejects(() => put(second));
  } finally { await db.close(); }
});

test('full production view keeps every matching row, follows field order and formats hours alone', () => {
  const tasks = Array.from({ length: 654 }, (_, i) => ({ id: String(i + 1), name: '작업 ' + (i + 1), level: i % 3 + 1,
    hours: i % 3 === 0 ? 2.65 : i % 3 === 1 ? 3 : '', quantity: 3, color: '기타', start: '', finish: '' }));
  const schedule = { tasks, days: [{ date: '2026-11-01', workday: false }] };
  const layout = defaultScheduleLayout();
  const render = level => new JSDOM(renderToStaticMarkup(
    React.createElement(NexpharmProductionSchedule, { schedule, layout, level }))).window.document;
  const initial = render('');
  assert.equal(initial.querySelectorAll('tbody tr').length, 654);
  assert.equal(initial.querySelector('tbody tr:last-child th').textContent, '작업 654');
  assert.equal(initial.querySelector('.nex-production-toolbar'), null);
  assert.deepEqual([...initial.querySelectorAll('tbody .prod-hours')].slice(0, 3).map(el => el.textContent), ['2.7','3.0','']);
  assert.equal(initial.querySelector('tbody .prod-quantity').textContent, '3');
  assert.equal(render('1').querySelectorAll('tbody tr').length, 218);
  assert.equal(render('2').querySelectorAll('tbody tr').length, 436);
  assert.equal(displayHours(2.64), '2.6');
  layout.fields.reverse();
  layout.fields = layout.fields.map(field => ({ ...field, visible: false, width: field.key === 'name' ? 182 : field.width }));
  layout.ganttVisible = false;
  const personal = render('');
  assert.deepEqual([...personal.querySelectorAll('thead th')].map(el => el.textContent), ['작업 이름']);
  assert.equal(personal.querySelector('col').style.width, '182px');
  assert.equal(personal.querySelectorAll('tbody tr').length, 654);
});
