<script setup>
import {ref,onMounted,onUnmounted} from 'vue'
import {adminRoute,adminSections} from './admin-navigation.js'
import AdminHome from './AdminHome.vue'
import AdminEbooks from './AdminEbooks.vue'
import AdminSites from './AdminSites.vue'
import AdminSoftware from './AdminSoftware.vue'
import PmsGroups from './PmsGroups.vue'
import MemberAdmin from './MemberAdmin.vue'
import MemberPasswordBulk from './MemberPasswordBulk.vue'
import MemberGroups from './MemberGroups.vue'
import MemberMail from './MemberMail.vue'
import MemberHistory from './MemberHistory.vue'
import KnowledgeImport from './KnowledgeImport.vue'
import {call,action,api,client,labels} from './pms-client.js'
const allowed=ref(false),rows=ref([]),selected=ref(null),message=ref(''),busy=ref(false),members=ref([]),history=ref([]),matches=ref([]),search=ref(''),expires=ref(''),role=ref('viewer'),meta=ref(null),tab=ref(locationSafeHash())
function locationSafeHash(){return adminRoute(typeof location==='undefined'?'':location.hash).tab}
function syncRoute(){const r=adminRoute(location.hash);tab.value=r.tab;if(location.hash!==r.canonical)window.history.replaceState(window.history.state,'',location.pathname+location.search+r.canonical)}
let sub,timer,verifyEpoch=0,disposed=false
const blank=()=>({slug:'',title:'',customer:'',description:'',access_mode:'assigned',status:'draft',listed:false,version:0})
async function verify(){const id=++verifyEpoch;try{const ok=await call('is_admin');if(disposed||id!==verifyEpoch)return;if(!ok){clear();return}allowed.value=true;const data=await call('pms_catalog');if(!disposed&&id===verifyEpoch)rows.value=data}catch{if(id===verifyEpoch)clear()}}
function clear(){allowed.value=false;rows.value=[];selected.value=null;members.value=[];history.value=[];matches.value=[];meta.value=null}
async function run(fn){if(busy.value)return;busy.value=true;message.value='';try{await fn()}catch(e){message.value=e.message}finally{busy.value=false}}
async function open(p){selected.value={...p};meta.value=null;matches.value=[];members.value=[];history.value=[];if(!p.version)return;await run(async()=>{[members.value,history.value]=await Promise.all([call('pms_admin_members',{p_slug:p.slug}),call('pms_history',{p_slug:p.slug})]);try{meta.value=await action(p.slug,'meta')}catch(e){message.value=e.message}})}
async function save(){await run(async()=>{const p=await call('pms_save_project',{p_project:selected.value,p_version:selected.value.version});selected.value=p;rows.value=await call('pms_catalog');message.value='설정을 저장했습니다. 새 프로젝트는 주소 생성을 실행하고 홈페이지 배포 완료 후 배포해 주세요.'})}
async function route(){await run(async()=>{const r=await action(selected.value.slug,'route',{method:'POST'});message.value=r.already_exists?'프로젝트 주소가 이미 등록되어 있습니다.':'주소를 등록했습니다. 홈페이지 배포 완료 후 접속해 주세요.'})}
async function find(){await run(async()=>{matches.value=await call('pms_find_members',{p_search:search.value})})}
async function grant(id,active,chosenRole=role.value){await run(async()=>{await call('pms_set_person',{p_role:chosenRole,p_slug:selected.value.slug,p_user:id,p_active:active,p_expires:expires.value?new Date(expires.value).toISOString():null});members.value=await call('pms_admin_members',{p_slug:selected.value.slug});message.value=active?'프로젝트 회원을 지정했습니다.':'프로젝트 접근을 회수했습니다.'})}
async function checkTaskServer(){await run(async()=>{
 const slug=selected.value.slug;const response=await api(slug,'file');if(!response.ok)throw Error('원본을 확인하지 못했습니다.');const bytes=new Uint8Array(await response.arrayBuffer());
 const {parseBook}=await import('../../../pms-app/lib/workbook');const b=parseBook(bytes,decodeURIComponent(response.headers.get('X-Filename')||'source.xlsm'));const task=b.tasks.find(t=>!t.summary);
 if(!task)throw Error('검사할 개별 작업이 없습니다.');const result=await action(slug,'task-check',{method:'POST',headers:{'Content-Type':'application/json','If-Match':response.headers.get('ETag')},body:JSON.stringify({updates:[{id:task.id,changes:{notes:task.notes}}]})});
 message.value=result.ok?'작업 저장 경로 점검을 완료했습니다. 원본 데이터는 변경하지 않았습니다.':'작업 저장 경로 확인이 필요합니다.';
 })}
async function upload(event){const file=event.target.files?.[0];event.target.value='';if(!file)return;await run(async()=>{
 if(!/\.(xlsx|xlsm)$/i.test(file.name)||file.size>8*1024*1024)throw Error('8MB 이하의 xlsx·xlsm 파일을 선택해 주세요.')
 // Parse and validate discovered schedule sheets before publishing.
 const {parseBook,validateSchedules}=await import('../../../pms-app/lib/workbook')
 const bytes=new Uint8Array(await file.arrayBuffer());validateSchedules(parseBook(bytes,file.name))
 if(!meta.value)throw Error('최신 게시본 확인에 실패했습니다. 다시 선택해 주세요.')
 const r=await action(selected.value.slug,'publish',{method:'POST',headers:{'X-Filename':encodeURIComponent(file.name),'If-Match':meta.value.current?.etag||'seed','Content-Type':'application/octet-stream'},body:bytes})
 meta.value=await action(selected.value.slug,'meta');history.value=await call('pms_history',{p_slug:selected.value.slug})
 message.value=r.audit_recorded?'GitHub에 원본을 새 버전으로 저장했습니다.':'GitHub 저장은 완료했지만 DB 감사 기록 확인이 필요합니다.'
 })}
onMounted(async()=>{syncRoute();window.addEventListener('hashchange',syncRoute);window.addEventListener('popstate',syncRoute);await verify();if(disposed)return;sub=client().auth.onAuthStateChange(e=>{if(e==='SIGNED_OUT'){++verifyEpoch;clear()}else setTimeout(verify,0)}).data.subscription;timer=setInterval(verify,30000)})
onUnmounted(()=>{disposed=true;++verifyEpoch;sub?.unsubscribe();clearInterval(timer);window.removeEventListener('hashchange',syncRoute);window.removeEventListener('popstate',syncRoute)})
</script>
<template>
<div class="admin-shell" :class="{'admin-shell-guest':!allowed}">
<aside v-if="allowed" class="admin-sidebar" aria-label="시스템 관리 메뉴"><a class="admin-home-link" href="/admin/" :aria-current="tab==='home'?'page':undefined">시스템 관리 홈</a><nav><section v-for="section in adminSections" :key="section.title"><h2>{{section.title}}</h2><a v-for="[key,label] in section.items" :key="key" :href="'/admin/#'+key" :aria-current="tab===key?'page':undefined">{{label}}</a></section></nav></aside>
<div class="admin-content">
<InquiryAdmin v-if="!allowed" authentication-only />
<AdminHome v-else-if="tab==='home'" />
<InquiryAdmin v-else-if="tab==='client'" />
<AdminSites v-else-if="tab==='pms'" />
<AdminEbooks v-else-if="tab==='ebooks'" />
<AdminSoftware v-else-if="tab==='sw'" />
<MemberAdmin v-else-if="tab==='members'" /><MemberPasswordBulk v-else-if="tab==='passwords'" /><MemberGroups v-else-if="tab==='groups'" /><MemberMail v-else-if="tab==='mail'" /><KnowledgeImport v-else-if="tab==='knowledge'" /><MemberHistory v-else-if="tab==='history'" /><main v-else class="pms-admin">
<header><div><span>PMOFFICE ADMIN</span><h1>프로젝트 관리</h1><p>기업별 프로젝트의 공개 범위, 회원 접근과 원본 게시를 관리합니다.</p></div><button @click="open(blank())" :disabled="busy">새 프로젝트</button></header>
<p role="status" aria-live="polite">{{message}}</p>
<div class="pms-admin-grid"><aside><button class="pms-project-row" v-for="p in rows" :key="p.slug" @click="open(p)" :disabled="busy"><strong>{{p.title}}</strong><span>{{p.customer}} · {{labels[p.access_mode]}}</span><small>/pms/{{p.slug}}/ · {{p.status}}</small></button></aside>
<section v-if="selected">
<form @submit.prevent="save"><h2>프로젝트 설정</h2><div class="pms-fields">
<label>주소 이름<input v-model="selected.slug" :disabled="selected.version>0" required pattern="[a-z][a-z0-9-]{1,47}" maxlength="48" placeholder="korail"></label>
<label>프로젝트명<input v-model="selected.title" required maxlength="160"></label>
<label>기업·기관<input v-model="selected.customer" maxlength="120"></label>
<p>접근 범위: 지정 그룹 회원</p>
<label>운영 상태<select v-model="selected.status"><option value="draft">초안</option><option value="published">게시</option><option value="archived">보관</option></select></label>
<p>프로젝트 목록과 제목·설명도 허용된 그룹 회원에게만 표시됩니다.</p>
</div><label>소개<textarea v-model="selected.description" maxlength="1000" rows="3"></textarea></label>
<p>지정한 그룹의 유효 회원만 볼 수 있습니다. 기업별 배정 작업의 편집은 별도 기관 매핑으로 관리합니다.</p>
<button :disabled="busy">설정 저장</button></form>
<template v-if="selected.version">
<section><h2>배포 주소</h2><p><a :href="'/pms/'+selected.slug+'/'" target="_blank" rel="noopener">/pms/{{selected.slug}}/ ↗</a></p><button @click="route" :disabled="busy">홈페이지 주소 생성</button><p>새 주소는 GitHub Pages 배포 후 사용할 수 있습니다. 주소 생성은 프로젝트의 공개 범위를 바꾸지 않습니다.</p></section>
<section><h2>원본과 게시 이력</h2><button @click="checkTaskServer" :disabled="busy||!meta">작업 저장 경로 점검 (원본 변경 없음)</button><p>현재 게시본: {{meta?.current?decodeURIComponent(meta.current.name):'미등록 또는 연결 확인 필요'}}</p><label>엑셀 원본 게시<input type="file" accept=".xlsx,.xlsm" :disabled="busy||!meta" @change="upload"></label><p>원본은 비공개 GitHub 저장소에 버전별로 보존합니다. 8MB 이하, 사업 일정표와 기관별 시트로 구성된 PMOffice 엑셀 구조를 지원합니다.</p><p>이전 게시본 열기·복원은 프로젝트 화면의 ‘파일 게시’에서 이용하세요.</p></section>
<PmsGroups :project="selected.slug" :key="selected.slug" /><section><h2>변경 이력</h2><ol><li v-for="h in history" :key="h.id">{{new Date(h.created_at).toLocaleString('ko-KR')}} · {{h.action}}</li></ol></section>
</template>
</section><section v-else><h2>관리할 프로젝트를 선택하세요.</h2><p>새 프로젝트는 지정 그룹 전용 초안으로 시작하며 게시 전에는 관리자만 볼 수 있습니다.</p></section>
</div>
</main>
</div></div>
</template>
<style scoped>
.pms-admin-tabs{display:flex;gap:12px;padding:24px 32px 0;max-width:1440px;margin:auto;flex-wrap:wrap;align-items:center}.pms-admin-tabs .pms-member-info{border-color:#235fea;font-weight:750}.pms-admin-tabs button[aria-pressed=true]{background:#183a61;color:white}.pms-admin{max-width:1440px;padding:40px 32px 80px;margin:auto;color:#16334f}.pms-admin header{display:flex;justify-content:space-between;gap:20px;align-items:center}.pms-admin h1{font-size:34px;font-weight:750}.pms-admin h2{font-size:22px;font-weight:700;margin-bottom:16px}.pms-admin p{margin:12px 0;color:#596f85}.pms-admin-grid{display:grid;grid-template-columns:300px minmax(0,1fr);gap:28px;margin-top:24px}.pms-admin-grid section section,.pms-admin-grid section>form{padding:24px;border:1px solid #d5e0eb;border-radius:10px;margin-bottom:22px;background:white}.pms-fields{display:grid;grid-template-columns:1fr 1fr;gap:16px}.pms-admin label{display:flex;flex-direction:column;gap:7px;margin:10px 0}.pms-admin input,.pms-admin select,.pms-admin textarea{border:1px solid #b5c5d5;border-radius:6px;padding:10px;background:white;width:100%}.pms-admin .pms-check{flex-direction:row;align-items:center}.pms-check input{width:auto}.pms-admin button,.pms-admin-tabs button{border:1px solid #b5c5d5;border-radius:6px;padding:10px 14px;background:#edf3fa;font-weight:600}.pms-admin button:disabled{opacity:.45}.pms-project-row{display:flex;flex-direction:column;width:100%;text-align:left;margin-bottom:10px;gap:8px}.pms-admin li{padding:10px 0;overflow-wrap:anywhere}.pms-admin li button{margin-left:10px}.pms-admin input[type=file]{max-width:100%}@media(max-width:780px){.pms-admin-grid{grid-template-columns:1fr}.pms-fields{grid-template-columns:1fr}.pms-admin{padding:28px 16px}.pms-admin h1{font-size:28px}.pms-admin header{display:block}}
</style>


<style>
.admin-shell{display:grid;grid-template-columns:260px minmax(0,1fr);gap:24px;max-width:1680px;margin:auto;padding:32px 24px 60px;color:#16334f}.admin-shell-guest{display:block}.admin-sidebar{position:sticky;top:92px;align-self:start;max-height:calc(100vh - 110px);overflow:auto;border:1px solid #d7e1ed;border-radius:12px;background:#f5f8fc;padding:18px 12px}.admin-sidebar section+section{border-top:1px solid #d7e1ed;margin-top:18px;padding-top:16px}.admin-sidebar h2{font-size:14px;font-weight:750;line-height:1.6;margin:0 10px 8px}.admin-sidebar a{display:block;border-radius:6px;padding:10px 12px;line-height:1.5;font-size:14px}.admin-sidebar a:hover{background:#e4ecf7}.admin-sidebar a[aria-current=page]{background:#183a61;color:white;font-weight:700}.admin-home-link{font-weight:750;margin-bottom:18px}.admin-content{min-width:0}.admin-content>.member-page,.admin-content>.inquiry-admin,.admin-content>.pms-admin{padding:12px 10px 40px;max-width:none}.admin-content .pms-admin-grid{grid-template-columns:230px minmax(0,1fr)}.admin-content h1{line-height:1.4}.admin-content .member-history{overflow:auto}.admin-content a:focus-visible,.admin-sidebar a:focus-visible{outline:3px solid #2676bd;outline-offset:2px}@media(max-width:1050px){.admin-content .pms-admin-grid{grid-template-columns:1fr}}@media(max-width:780px){.admin-shell{grid-template-columns:1fr;padding:100px 14px 20px;gap:24px}.admin-sidebar{position:static;max-height:none}.admin-sidebar nav{display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(210px,1fr))}.admin-sidebar section+section{border:0;margin:0;padding:0}.admin-content>.member-page,.admin-content>.inquiry-admin,.admin-content>.pms-admin{padding:4px 0 30px}}
</style>
