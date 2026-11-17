import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

const require = createRequire(import.meta.url);
const { parse, compileScript } = require(require.resolve('@vue/compiler-sfc', {
  paths: [path.dirname(require.resolve('vue/package.json'))],
}));
const stub = `
const session = { user: { id: 'manager' }, access_token: 'fixture' };
const slug = 'nexpharm-583d09bdd195';
const production = 'nexpharm-8088c44595a3';
const projects = [{slug, title: '테스트 프로젝트', template:'rd'},
  {slug: production, title: '생산계획 테스트', template:'production_outsourcing'}];
let draft;
const comments = [{ id: 1, author: '작성자', body: '<strong>기존 코멘트</strong><img src=x onerror=bad()>', created_at: '2026-11-16T01:00:00Z' }];
const posts = [];
export const client = () => ({ auth: {
  getSession: async () => ({ data: { session } }),
  onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
} });
export async function call(name, args) {
  if (name === 'nexpharm_catalog') return { canRead: true, canManage: true, projects: projects.map(p => ({...p, comment: comments[0].body})) };
  if (name === 'nexpharm_access') return { canRead: true, canManage: true, project: projects.find(p => p.slug === args.p_slug) };
  if (name === 'nexpharm_comments') return comments.slice();
  if (name === 'nexpharm_posts') return posts.slice();
  if (name === 'nexpharm_add_comment') comments.unshift({ id: 2, author: '작성자', body: args.p_body, created_at: '2026-11-16T02:00:00Z' });
  if (name === 'nexpharm_add_post') posts.unshift({ id: 1, author: '작성자', title: args.p_title, body: args.p_body, created_at: '2026-11-16T02:00:00Z' });
  if (name === 'nexpharm_prepare_typed_project') {
    draft = {slug:'nexpharm-abcdabcdabcd', title:args.p_title, template:args.p_template};
    return {slug:draft.slug, published:false};
  }
  if (name === 'nexpharm_publish_project') projects.push({...draft, status:'published'});
}
export function parseNexpharmFile() { return {tasks: [{ start: '2026-11-01', finish: '2026-11-30' }]}; }
`;

test('Nexpharm center renders a full month and connects registration, comments, board and schedule routes', async () => {
  const dom = new JSDOM('<!doctype html><div id="app"></div>', {url: 'https://pmoffice.co.kr/pms/nexpharm/'});
  for (const key of ['window', 'document', 'Document', 'ShadowRoot', 'Element', 'SVGElement', 'HTMLElement', 'Node', 'Event', 'location', 'history']) {
    Object.defineProperty(globalThis, key, { value: dom.window[key], writable: true, configurable: true });
  }
  globalThis.fetch = async (url, options) => {
    const { searchParams } = new URL(url);
    if (searchParams.get('action') === 'meta') {
      return Response.json({current: {etag: 'test', name: '공정표.xlsx'}});
    }
    if (searchParams.get('action') === 'publish') return Response.json({etag: 'test', audit_recorded: true});
    return new Response('xlsx bytes', {headers: {ETag: 'test'}});
  };
  const result = await build({
    stdin: { contents: `
      import {createApp, nextTick} from 'vue';
      import Portal from './docs/.vitepress/theme/NexpharmPortal.vue';
      export {nextTick};
      export {timeline, timelineBar} from './pms-app/lib/nexpharm-timescale.ts';
      const app = createApp(Portal);
      app.mount('#app');
      export const close = () => app.unmount();
    `, resolveDir: process.cwd() },
    bundle: true, write: false, format: 'esm', platform: 'browser',
    loader: {'.css': 'empty'},
    define: {__VUE_OPTIONS_API__: 'true', __VUE_PROD_DEVTOOLS__: 'false', __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false'},
    plugins: [{ name: 'fixture', setup(builder) {
      builder.onResolve({filter: /pms-client\.js$|nexpharm-book\.ts$/}, () => ({path: 'stub', namespace: 'fixture'}));
      builder.onLoad({filter: /.*/, namespace: 'fixture'}, () => ({contents: stub, loader: 'js'}));
      builder.onLoad({filter: /\.vue$/}, args => {
        const { descriptor } = parse(fs.readFileSync(args.path, 'utf8'));
        return {contents: compileScript(descriptor, {id: args.path, inlineTemplate: true}).content, loader: 'js', resolveDir: path.dirname(args.path)};
      });
    }}],
  });
  const app = await import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
  const find = (selector, text) => [...document.querySelectorAll(selector)].find(el => el.textContent.trim() === text);
  const wait = async (condition) => {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (condition()) return;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.ok(condition(), 'Expected visible state was not rendered');
  };
  const click = (selector, text) => find(selector, text).dispatchEvent(new window.MouseEvent('click', {bubbles: true, cancelable: true}));
  const fill = (element, text) => {
    element.value = text;
    element.dispatchEvent(new window.Event('input', {bubbles: true}));
  };
  const submit = selector => document.querySelector(selector).dispatchEvent(new window.Event('submit', {bubbles: true, cancelable: true}));

  try {
    await wait(() => document.querySelector('.nex-bar'));
    assert.deepEqual([...document.querySelectorAll('.nex-sidebar nav a')].map(el => el.textContent),
      ['프로젝트 센터', '테스트 프로젝트', '생산계획 테스트', '자유 게시판']);
    assert.equal(document.querySelector('.nex-schedule-menu summary').textContent, '프로젝트 일정');
    assert.equal(document.querySelector('.nex-schedule-menu a').href, document.querySelector('.nex-table a').href);
    assert.ok(find('.nex-month-grid span', '26-11'));
    assert.equal(document.querySelector('.nex-bar').style.gridColumn, '1 / span 1');
    assert.equal(document.querySelector('.nex-bar').getAttribute('aria-label'), '일정 1개월');
    const {periods} = app.timeline('2026-11-01', '2027-01-10', 0);
    assert.deepEqual(periods.map(period => period.label), ['26-11', '26-12', '27-01']);
    assert.deepEqual(app.timelineBar('2026-11-01', '2026-11-30', false, periods[0]), {left: 0, width: 100});
    assert.equal(app.timelineBar('2026-11-01', '2026-11-30', false, periods[1]), null);

    click('button', '상세 정보');
    await wait(() => document.querySelector('.nex-rich strong'));
    assert.equal(document.querySelector('.nex-rich img'), null);
    document.querySelector('.nex-editor').innerHTML = '<strong>굵은 코멘트</strong>';
    submit('.nex-compose');
    await wait(() => find('.nex-comment-preview', '굵은 코멘트'));
    click('button', '닫기');
    await app.nextTick();
    assert.equal(document.querySelector('.nex-drawer'), null);

    click('a', '자유 게시판');
    await wait(() => document.querySelector('.nex-compose textarea'));
    fill(document.querySelector('.nex-compose input'), '공지 제목');
    fill(document.querySelector('.nex-compose textarea'), '첫 줄\n둘째 줄');
    submit('.nex-compose');
    await wait(() => find('.nex-entry h3', '공지 제목'));
    assert.equal(document.querySelector('.nex-plain').textContent, '첫 줄\n둘째 줄');

    click('a', '프로젝트 센터');
    await wait(() => find('button', '엑셀로 등록'));
    click('button', '엑셀로 등록');
    await app.nextTick();
    const fileInput = document.querySelector('input[type=file]');
    Object.defineProperty(fileInput, 'files', {value: [{name: '새 프로젝트.xlsx', size: 100, arrayBuffer: async () => new ArrayBuffer(100)}]});
    fileInput.dispatchEvent(new window.Event('change', {bubbles: true}));
    await app.nextTick();
    assert.equal(document.querySelector('.nex-register input:not([type=file])').value, '새 프로젝트');
    assert.deepEqual([...document.querySelectorAll('.nex-register option')].map(option => option.label), ['R&D', '생산위수탁관리']);
    fill(document.querySelector('.nex-register input:not([type=file])'), '사용자가 수정한 이름');
    await wait(() => !find('button', '프로젝트 등록').disabled);
    submit('.nex-register');
    await wait(() => document.querySelector('iframe'));
    assert.equal(location.search, '?project=nexpharm-abcdabcdabcd');
    assert.ok(find('.nex-schedule-menu a', '사용자가 수정한 이름'));
    click('a', '테스트 프로젝트');
    await wait(() => document.querySelector('iframe[src*="nexpharm-583d09bdd195"]'));
    assert.equal(location.search, '?project=nexpharm-583d09bdd195');
    assert.equal(document.querySelector('h1').textContent, '프로젝트 일정');
    assert.match(document.querySelector('iframe').getAttribute('src'), /project=nexpharm-583d09bdd195/);
    assert.ok(find('.nex-heading button', '로그아웃'));

    click('a', '생산계획 테스트');
    const production = 'nexpharm-8088c44595a3';
    await wait(() => document.querySelector(`iframe[src*="${production}"]`));
    assert.equal(new URL(document.querySelector('iframe').src).searchParams.get('v'), 'production-v311');
    assert.equal(find('.nex-production-nav button', '파일 관리'), undefined);
    assert.equal(find('.nex-heading button', '로그아웃'), undefined);
    assert.equal(find('.nex-heading a', '로그인'), undefined);
    const reportView = async view => {
      window.dispatchEvent(new window.MessageEvent('message', {
        origin: location.origin, source: document.querySelector('iframe').contentWindow,
        data: { type: 'pmoffice-nexpharm-view', project: production, view },
      }));
      await app.nextTick();
    };
    await reportView('calendar');
    assert.ok(find('.nex-heading button', '로그아웃'));
    await reportView('schedule');
    assert.equal(find('.nex-heading button', '로그아웃'), undefined);
  } finally {
    app.close();
    dom.window.close();
  }
});
