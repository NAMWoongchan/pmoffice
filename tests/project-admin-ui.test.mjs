import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {JSDOM} from 'jsdom';import {build} from 'esbuild';import {parse,compileScript} from 'vue/compiler-sfc';
const stub=`
const workId='00000000-0000-0000-0000-000000000099', createdAt='2026-11-11T00:00:00Z';let item=null, admin=true;export function revokeWorkAccess(){admin=false}
async function workRpc(name,args){if(name==='is_admin')return {data:admin};if(!admin)return {error:{code:'42501'}};const {p_action:action,p_values:values,p_version:version}=args;if(action==='list')return {data:item&&item.archived===values.archived?[item]:[]};if(action==='get')return {data:item};if(item&&version!==item.version)return {error:{code:'40001'}};const previous=item?.status;const event=action==='archive'?'archived':action==='restore'?'restored':!item?'created':previous!==values.status?'status':null;const nextVersion=(item?.version??0)+1;const when=nextVersion===1?createdAt:'2026-11-11T01:00:00Z';item={...item,...values,id:workId,version:nextVersion,created_at:createdAt,updated_at:when,updated_by_name:'합성 관리자',archived:action==='archive',events:[...(event?[{version:nextVersion,event_type:event,previous_status:previous,status:values?.status??previous,occurred_at:when,actor_name:'합성 관리자'}]:[]),...(item?.events??[])]};return {data:item}};
export const calls=[],callbacks=[];let projects=[{slug:'existing-demo',title:'기존 합성 프로젝트',customer:'합성 기관',description:'',status:'published',access_mode:'assigned',version:1},{slug:'synthetic-epc',title:'합성 EPC 프로젝트',customer:'',description:'',status:'draft',access_mode:'assigned',version:1}];export const labels={assigned:'지정 그룹 회원'};export function notify(){callbacks.forEach(cb=>cb({new:{scope:'projects'}}))}export function addProject(){projects.push({slug:'added-demo',title:'추가 합성 프로젝트',status:'draft',access_mode:'assigned',version:1});notify()}export const client=()=>({rpc:workRpc,auth:{onAuthStateChange(){return {data:{subscription:{unsubscribe(){}}}}}},channel(){return {on(event,config,cb){callbacks.push(cb);return this},subscribe(){return this}}},removeChannel(){}});export async function call(name,args={}){calls.push({name,args:JSON.parse(JSON.stringify(args))});if(name==='is_admin')return admin;if(name==='pms_catalog')return projects.map(p=>({...p}));if(name==='pms_save_project'){const saved={...args.p_project,version:args.p_version+1};projects=projects.filter(p=>p.slug!==saved.slug).concat(saved);notify();await new Promise(r=>setTimeout(r,5));return saved}return []}export async function action(slug,name){calls.push({name:'action:'+name,args:{slug}});return {current:null}}export async function api(){throw Error('Not called')}`;
async function mount(component,hash){const dom=new JSDOM('<!doctype html><div id="app"></div>',{url:'https://pmoffice.co.kr/admin/'+hash});for(const k of ['window','document','navigator','Document','Element','SVGElement','HTMLElement','Node','Event','CustomEvent','location','history','sessionStorage','MutationObserver'])Object.defineProperty(globalThis,k,{value:dom.window[k],writable:true,configurable:true});const target=path.resolve('docs/.vitepress/theme/'+component+'.vue');const output=await build({stdin:{contents:`import {createApp,nextTick} from 'vue';import Component from './docs/.vitepress/theme/${component}.vue';export {calls,notify,addProject,revokeWorkAccess} from 'fixture';export {nextTick};const app=createApp(Component);app.component('InquiryAdmin',{render(){return null}});app.mount('#app');export const close=()=>app.unmount()`,resolveDir:process.cwd()},bundle:true,write:false,format:'esm',platform:'browser',define:{__VUE_OPTIONS_API__:'true',__VUE_PROD_DEVTOOLS__:'false',__VUE_PROD_HYDRATION_MISMATCH_DETAILS__:'false'},plugins:[{name:'test-fixtures',setup(b){b.onResolve({filter:/pms-client\.js$|^fixture$/},()=>({path:'fixture',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:stub,loader:'js'}));b.onLoad({filter:/\.vue$/},a=>{if(a.path!==target&&!a.path.endsWith('AdminAiWork.vue'))return {contents:'export default {render(){return null}}',loader:'js'};const {descriptor}=parse(fs.readFileSync(a.path,'utf8'));return {contents:compileScript(descriptor,{id:'project-test',inlineTemplate:true}).content,loader:'js',resolveDir:path.dirname(a.path)}})}}]});const m=await import('data:text/javascript;base64,'+Buffer.from(output.outputFiles[0].text).toString('base64')+'#'+crypto.randomUUID());const settle=async()=>{await new Promise(r=>setTimeout(r,40));await m.nextTick()};await settle();return {m,dom,settle,close(){m.close();dom.window.close()}}}
const field=text=>Array.from(document.querySelectorAll('label')).find(l=>l.textContent.startsWith(text)).querySelector('input');
test('draft sites are listed with direct management, protected publishing states, search and change-only refresh',async()=>{const {m,dom,settle,close}=await mount('AdminSites','#pms');try{assert.equal(document.querySelectorAll('article[data-project]').length,2);const draft=document.querySelector('[data-project="synthetic-epc"]');assert.ok(draft.textContent.includes('초안'));assert.equal(draft.querySelector('a').getAttribute('href'),'/admin/#projects?project=synthetic-epc');assert.equal(draft.querySelectorAll('a').length,1);assert.equal(document.querySelector('[data-project="existing-demo"] a[target=_blank]').getAttribute('href'),'/pms/existing-demo/');field('프로젝트 검색').value='EPC';field('프로젝트 검색').dispatchEvent(new dom.window.Event('input',{bubbles:true}));await settle();assert.equal(document.querySelectorAll('article[data-project]').length,1);field('프로젝트 검색').value='';field('프로젝트 검색').dispatchEvent(new dom.window.Event('input',{bubbles:true}));m.addProject();await settle();assert.equal(document.querySelectorAll('article[data-project]').length,3);assert.ok(m.calls.filter(c=>c.name==='pms_catalog').length>=2)}finally{close()}});
test('project management opens the linked draft project directly with existing group/source controls',async()=>{const {m,close}=await mount('PmsAdmin','#projects?project=synthetic-epc');try{assert.equal(field('프로젝트명').value,'합성 EPC 프로젝트');assert.equal(field('주소 이름').value,'synthetic-epc');assert.equal(field('주소 이름').disabled,true);assert.ok(m.calls.some(c=>c.name==='pms_admin_members'&&c.args.p_slug==='synthetic-epc'));assert.ok(document.body.textContent.includes('원본'));assert.ok(document.querySelector('a[href="/admin/#pms"]'))}finally{close()}});
test('new project address is suggested and saving survives its concurrent change notification',async()=>{const {m,dom,settle,close}=await mount('PmsAdmin','#projects?new=1');try{const title=field('프로젝트명');title.value='합성 신규 AI EPC';title.dispatchEvent(new dom.window.Event('input',{bubbles:true}));await settle();assert.equal(field('주소 이름').value,'ai-epc');const form=title.closest('form');form.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));await settle();await settle();const saved=m.calls.find(c=>c.name==='pms_save_project');assert.equal(saved.args.p_version,0);assert.equal(saved.args.p_project.title,'합성 신규 AI EPC');assert.equal(field('프로젝트명').value,'합성 신규 AI EPC');assert.equal(field('주소 이름').disabled,true);assert.equal(location.hash,'#projects?project=ai-epc');assert.ok(document.body.textContent.includes('프로젝트를 등록했습니다.'))}finally{close()}});
test('project address suggestions remain valid, bounded and collision-free',async()=>{const code=fs.readFileSync('docs/.vitepress/theme/project-admin.js','utf8');const {suggestedProjectSlug}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));for(const title of ['한글 프로젝트','123','admin','A','긴 제목 '+ 'long '.repeat(30)])assert.match(suggestedProjectSlug(title),/^[a-z][a-z0-9-]{1,47}$/);assert.equal(suggestedProjectSlug('합성 AI EPC',['ai-epc','ai-epc-2']),'ai-epc-3')});

test('AI work form copies a reviewed prompt, saves a plan, displays KST history, and handles access loss', async () => {
  const { m, dom, settle, close } = await mount('PmsAdmin', '#ai-work')
  const button = text => [...document.querySelectorAll('.ai-work button')].find(el => el.textContent.trim() === text)
  const set = (el, value, type = 'input') => {
    el.value = value
    el.dispatchEvent(new dom.window.Event(type, { bubbles: true }))
  }
  const submit = async () => {
    document.querySelector('.ai-work form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }))
    await settle()
  }
  let copied
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { async writeText(value) { copied = value } } })
  dom.window.confirm = () => true
  try {
    assert.ok(document.querySelector('.admin-sidebar a[href="/admin/#ai-work"]'))
    button('새 아이디어').click()
    await settle()
    set(document.querySelector('.ai-work input[required]'), '합성 작업')
    set(document.querySelector('.ai-work textarea[required]'), '진행 현황을 기록한다')
    await submit()
    const sidebar = () => document.querySelector('.work-summary')
    const created = () => sidebar().querySelector('time').dateTime
    assert.equal(created(), '2026-11-11T00:00:00Z')
    assert.match(sidebar().textContent, /09:00.*KST|오전 9:00.*KST/)
    button('요청문 만들기').click()
    await settle()
    const editor = document.querySelector('.prompt-editor textarea')
    assert.match(editor.value, /단계별 작업/)
    set(editor, editor.value + '\n의존성을 정리해 줘.')
    button('요청문 복사').click()
    await settle()
    assert.match(copied, /의존성을 정리해 줘/)
    const labels = [...document.querySelectorAll('.work-panel form label')]
    set(labels.find(label => label.textContent.includes('검토한 개발 계획')).querySelector('textarea'), '단계별 계획')
    set(document.querySelector('.work-panel form select'), 'planning', 'change')
    await submit()
    assert.equal(created(), '2026-11-11T00:00:00Z')
    assert.match(sidebar().textContent, /아이디어 → 계획 수립/)
    assert.match(sidebar().textContent, /합성 관리자/)
    assert.match(location.hash, /^#ai-work\?item=/)
    button('보관').click()
    await settle()
    assert.match(sidebar().textContent, /보관/)
    button('복원').click()
    await settle()
    assert.match(sidebar().textContent, /복원/)
    m.revokeWorkAccess()
    button('목록 새로고침').click()
    await settle()
    assert.equal(document.querySelector('.ai-work'), null)
    assert.equal(document.querySelector('.admin-sidebar'), null)
  } finally {
    close()
  }
})
