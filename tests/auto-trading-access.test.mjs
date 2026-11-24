import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {JSDOM} from 'jsdom';
import {build} from 'esbuild';

test('Auto Trading is absent from fixed navigation and business status follows AI work in the admin sidebar',async()=>{
 const dom=new JSDOM('<div id="app"></div>',{url:'https://pmoffice.co.kr/'});
 for(const name of ['window','document','Element','HTMLElement','SVGElement','Node'])globalThis[name]=dom.window[name];
 const vue=await import('vue');const {parse,compileScript}=await import('vue/compiler-sfc');
 const state={memberSession:vue.shallowRef(null),memberAccount:vue.shallowRef(null),memberProjects:vue.shallowRef([]),initializeMember(){},memberLogout(){}};
 globalThis.__adminNavFixture=state;
 const file=path.resolve('docs/.vitepress/theme/BrandNav.vue'),{descriptor}=parse(fs.readFileSync(file,'utf8'));
 const compiled=compileScript(descriptor,{id:'administrator-nav-access',inlineTemplate:true});
 const bundle=await build({stdin:{contents:compiled.content,resolveDir:path.dirname(file),sourcefile:'BrandNav.test.mjs'},bundle:true,write:false,format:'esm',platform:'node',external:['vue'],plugins:[{name:'isolated-auth-fixture',setup(api){
  api.onResolve({filter:/^vitepress$/},()=>({path:'vitepress',namespace:'fixture'}));
  api.onResolve({filter:/member-service\.js$/},()=>({path:'member',namespace:'fixture'}));
  api.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:args.path==='vitepress'?'export const withBase=x=>x;':'export const {memberSession,memberAccount,memberProjects,initializeMember,memberLogout}=globalThis.__adminNavFixture;',loader:'js'}));
 }}]});
 const generated=path.resolve('tests','.nav-access-'+randomUUID()+'.mjs');fs.writeFileSync(generated,bundle.outputFiles[0].text);
 let app;
 try{
  const component=(await import(pathToFileURL(generated).href)).default;
  app=vue.createApp(component);app.mount('#app');
  const check=async(session,account,visible,label)=>{
   state.memberSession.value=session;state.memberAccount.value=account;await vue.nextTick();
   const desktop=document.querySelectorAll('.member-auth a[href="/admin/#auto-trading"]');
   const mobile=document.querySelectorAll('.member-mobile-admin a[href="/admin/#auto-trading"]');
   assert.equal(desktop.length,0,label+' desktop');assert.equal(mobile.length,0,label+' mobile');assert.equal(document.querySelectorAll('.member-auth a[href="/admin/"]').length,visible?1:0,label+' system admin entry');
   if(!visible)assert.equal(document.querySelectorAll('a[href="/admin/#auto-trading"]').length,0,label+' hidden from DOM');
  };
  const {adminSections}=await import('../docs/.vitepress/theme/admin-navigation.js');const section=adminSections.find(x=>x.title==='시스템 관리(Administration)');assert.deepEqual(section.items.map(x=>x[0]),['ai-work','auto-trading','history']);assert.equal(section.items.find(x=>x[0]==='auto-trading')[1],'사업 현황');
  const session={user:{id:'fixture-user'}};
  await check(null,null,false,'logged out');
  await check(session,{member:true,admin:false},false,'ordinary member');
  await check(session,{member:true,admin:false,project_admin:true},false,'project administrator');
  await check(session,{member:true,admin:true},true,'system administrator');
  await check(null,{member:true,admin:true},false,'logged out with a stale administrator record');
  await check(session,{member:true,admin:'true'},false,'unverified string flag');
  await check(session,{member:true,admin:true},true,'administrator signed in again');
  await check(session,{member:true,admin:false},false,'administrator permission revoked');
 }finally{
  app?.unmount();fs.unlinkSync(generated);delete globalThis.__adminNavFixture;dom.window.close();
 }
});
