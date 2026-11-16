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
    export { NexpharmProductionGrid } from './pms-app/components/NexpharmProductionGrid';
    export { productionOutline, presetBranches } from './pms-app/lib/nexpharm-outline';
    export { productionTimescale } from './pms-app/lib/nexpharm-production-timescale';`, resolveDir: process.cwd() },
  resolveExtensions: ['.ts', '.tsx', '.js'], bundle: true, platform: 'node', packages: 'external', format: 'cjs', write: false,
});
const compilation = new Module(import.meta.filename);
compilation.require = require;
compilation._compile(bundle.outputFiles[0].text, import.meta.filename);
const { defaultScheduleLayout, displayHours, NexpharmProductionGrid, productionOutline, presetBranches, productionTimescale } = compilation.exports;

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

test('production grid keeps the rows and chart aligned within a bounded render window', () => {
  const tasks = Array.from({ length: 654 }, (_, i) => ({ id: String(i + 1), name: '작업 ' + (i + 1), level: i % 3 + 1,
    hours: i % 3 === 0 ? 2.65 : i % 3 === 1 ? 3 : '', quantity: 3, color: '기타', start: '2026-11-01', finish: '2026-11-01' }));
  const days = Array.from({ length: 12 }, (_, i) => ({ date: '2026-11-' + String(i + 1).padStart(2, '0'), workday: i % 7 !== 0 }));
  const schedule = { tasks, days };
  const layout = defaultScheduleLayout();
  const { parents, ancestors } = productionOutline(tasks);
  assert.deepEqual(ancestors.get('3'), ['1', '2']);
  assert.deepEqual(ancestors.get('4'), []);
  assert.equal(parents.has('3'), false);
  assert.equal(presetBranches(tasks, '1').size, 0);
  assert.equal(presetBranches(tasks.slice(0, 3), '2').has('2'), false);
  const render = (rows, expanded = new Set(), scale = 'day') => new JSDOM(renderToStaticMarkup(
    React.createElement(NexpharmProductionGrid, { schedule, layout, rows, parents, expanded, toggle: () => {}, scale }))).window.document;
  const initial = render(tasks.filter(task => task.level === 1).slice(0, 5));
  const taskRows = doc => [...doc.querySelectorAll('.nex-task-pane tbody tr[data-task-id]')];
  const chartRows = doc => [...doc.querySelectorAll('.nex-chart-pane [data-task-id]')];
  const ids = rows => rows.map(row => row.dataset.taskId);
  assert.equal(taskRows(initial).length, 5);
  assert.equal(initial.querySelector('button[aria-expanded=false]').textContent, '+');
  assert.equal(initial.querySelector('.nex-chart-pane thead th').textContent, '11월 초순');
  const full = render(tasks, presetBranches(tasks, 'all'), 'week');
  assert.equal(taskRows(full).length, 80);
  assert.equal(full.querySelector('.nex-task-pane table').getAttribute('aria-rowcount'), '655');
  assert.equal(full.querySelector('.nex-row-gap td').style.height, String(574 * 32) + 'px');
  assert.deepEqual(ids(chartRows(full)), ids(taskRows(full)));
  assert.equal(full.querySelector('button[aria-expanded=true]').textContent, '−');
  assert.equal(taskRows(full)[2].querySelector('button'), null);
  assert.equal(full.querySelector('.nex-chart-pane .prod-bar').textContent, '작업 1');
  assert.deepEqual([...full.querySelectorAll('tbody .prod-value-hours')].slice(0, 3).map(el => el.textContent), ['2.7','3.0','']);
  assert.equal(displayHours(2.64), '2.6');
  assert.deepEqual(productionTimescale(days,'week').columns.map(col => [col.date,col.detail]),
    [['2026-11-01','W1'],['2026-11-02','W2'],['2026-11-09','W3']]);
  layout.fields.reverse();
  layout.fields = layout.fields.map(field => ({ ...field, visible: false, width: field.key === 'name' ? 182 : field.width,
    title: field.key === 'name' ? '새 작업명' : undefined }));
  layout.ganttVisible = false;
  const personal = render(tasks);
  assert.deepEqual([...personal.querySelectorAll('thead th')].map(el => el.textContent), ['새 작업명']);
  assert.equal(personal.querySelector('col').style.width, '182px');
  assert.equal(personal.querySelector('.nex-chart-pane'), null);
});
