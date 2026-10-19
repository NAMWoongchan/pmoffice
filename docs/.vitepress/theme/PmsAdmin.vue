<script setup>
import {ref,onMounted,onUnmounted} from 'vue'
import {call,action,client,labels} from './pms-client.js'
const allowed=ref(false),rows=ref([]),selected=ref(null),message=ref(''),busy=ref(false),members=ref([]),history=ref([]),matches=ref([]),search=ref(''),expires=ref(''),meta=ref(null),tab=ref(locationSafeHash())
function locationSafeHash(){return typeof location!=='undefined'&&location.hash==='#projects'?'projects':'inquiries'}
let sub,timer
const blank=()=>({slug:'',title:'',customer:'',description:'',access_mode:'assigned',status:'draft',listed:false,version:0})
async function verify(){try{allowed.value=await call('is_admin');if(allowed.value)rows.value=await call('pms_catalog');else clear()}catch{clear()}}
function clear(){allowed.value=false;rows.value=[];selected.value=null;members.value=[];history.value=[];matches.value=[];meta.value=null}
async function run(fn){if(busy.value)return;busy.value=true;message.value='';try{await fn()}catch(e){message.value=e.message}finally{busy.value=false}}
async function open(p){selected.value={...p};meta.value=null;matches.value=[];members.value=[];history.value=[];if(!p.version)return;await run(async()=>{[members.value,history.value]=await Promise.all([call('pms_admin_members',{p_slug:p.slug}),call('pms_history',{p_slug:p.slug})]);try{meta.value=await action(p.slug,'meta')}catch(e){message.value=e.message}})}
async function save(){await run(async()=>{const p=await call('pms_save_project',{p_project:selected.value,p_version:selected.value.version});selected.value=p;rows.value=await call('pms_catalog');message.value='설정을 저장했습니다. 새 프로젝트는 주소 생성을 실행하고 홈페이지 배포 완료 후 배포해 주세요.'})}
async function route(){await run(async()=>{const r=await action(selected.value.slug,'route',{method:'POST'});message.value=r.already_exists?'프로젝트 주소가 이미 등록되어 있습니다.':'주소를 등록했습니다. 홈페이지 배포 완료 후 접속해 주세요.'})}
async function find(){await run(async()=>{matches.value=await call('pms_find_members',{p_search:search.value})})}
async function grant(id,active){await run(async()=>{await call('pms_set_member',{p_slug:selected.value.slug,p_user:id,p_active:active,p_expires:expires.value?new Date(expires.value).toISOString():null});members.value=await call('pms_admin_members',{p_slug:selected.value.slug});message.value=active?'프로젝트 회원을 지정했습니다.':'프로젝트 접근을 회수했습니다.'})}
async function upload(event){const file=event.target.files?.[0];event.target.value='';if(!file)return;await run(async()=>{
 if(!/\.(xlsx|xlsm)$/i.test(file.name)||file.size>8*1024*1024)throw Error('8MB 이하의 xlsx·xlsm 파일을 선택해 주세요.')
 // Parse and validate all seven schedule sheets before publishing.
 const {parseBook,validateSchedules}=await import('../../../pms-app/lib/workbook')
 const bytes=new Uint8Array(await file.arrayBuffer());validateSchedules(parseBook(bytes,file.name))
 if(!meta.value)throw Error('최신 게시본 확인에 실패했습니다. 다시 선택해 주세요.')
 const r=await action(selected.value.slug,'publish',{method:'POST',headers:{'X-Filename':encodeURIComponent(file.name),'If-Match':meta.value.current?.etag||'seed','Content-Type':'application/octet-stream'},body:bytes})
 meta.value=await action(selected.value.slug,'meta');history.value=await call('pms_history',{p_slug:selected.value.slug})
 message.value=r.audit_recorded?'GitHub에 원본을 새 버전으로 저장했습니다.':'GitHub 저장은 완료했지만 DB 감사 기록 확인이 필요합니다.'
 })}
onMounted(async()=>{await verify();sub=client().auth.onAuthStateChange(e=>{if(e==='SIGNED_OUT')clear();else setTimeout(verify,0)}).data.subscription;timer=setInterval(verify,30000)})
onUnmounted(()=>{sub?.unsubscribe();clearInterval(timer)})
</script>
<template>
<nav class="pms-admin-tabs" aria-label="관리 기능"><button :aria-pressed="tab==='inquiries'" @click="tab='inquiries'">고객 문의</button><button v-if="allowed" :aria-pressed="tab==='projects'" @click="tab='projects'">프로젝트 관리</button><a href="/pms/">고객 프로젝트 목록 ↗</a></nav>
<InquiryAdmin v-if="tab==='inquiries'||!allowed" />
<main v-else class="pms-admin">
<header><div><span>PMOFFICE ADMIN</span><h1>프로젝트 관리</h1><p>기업별 프로젝트의 공개 범위, 회원 접근과 원본 게시를 관리합니다.</p></div><button @click="open(blank())" :disabled="busy">새 프로젝트</button></header>
<p role="status" aria-live="polite">{{message}}</p>
<div class="pms-admin-grid"><aside><button class="pms-project-row" v-for="p in rows" :key="p.slug" @click="open(p)" :disabled="busy"><strong>{{p.title}}</strong><span>{{p.customer}} · {{labels[p.access_mode]}}</span><small>/pms/{{p.slug}}/ · {{p.status}}</small></button></aside>
<section v-if="selected">
<form @submit.prevent="save"><h2>프로젝트 설정</h2><div class="pms-fields">
<label>주소 이름<input v-model="selected.slug" :disabled="selected.version>0" required pattern="[a-z][a-z0-9-]{1,47}" maxlength="48" placeholder="korail"></label>
<label>프로젝트명<input v-model="selected.title" required maxlength="160"></label>
<label>기업·기관<input v-model="selected.customer" maxlength="120"></label>
<label>공개 범위<select v-model="selected.access_mode"><option v-for="(label,key) in labels" :value="key">{{label}}</option></select></label>
<label>운영 상태<select v-model="selected.status"><option value="draft">초안</option><option value="published">게시</option><option value="archived">보관</option></select></label>
<label class="pms-check"><input type="checkbox" v-model="selected.listed">프로젝트 목록에 제목·설명 표시</label>
</div><label>소개<textarea v-model="selected.description" maxlength="1000" rows="3"></textarea></label>
<p v-if="selected.access_mode==='public'">전체 공개를 저장하면 로그인하지 않은 고객도 원본과 보고서를 볼 수 있습니다.</p>
<p v-else-if="selected.access_mode==='members'">Google로 가입을 완료한 모든 유효 회원이 볼 수 있습니다.</p><p v-else>아래에서 지정한 유효 회원만 볼 수 있습니다.</p>
<button :disabled="busy">설정 저장</button></form>
<template v-if="selected.version">
<section><h2>배포 주소</h2><p><a :href="'/pms/'+selected.slug+'/'" target="_blank" rel="noopener">/pms/{{selected.slug}}/ ↗</a></p><button @click="route" :disabled="busy">홈페이지 주소 생성</button><p>새 주소는 GitHub Pages 배포 후 사용할 수 있습니다. 주소 생성은 프로젝트의 공개 범위를 바꾸지 않습니다.</p></section>
<section><h2>원본과 게시 이력</h2><p>현재 게시본: {{meta?.current?decodeURIComponent(meta.current.name):'미등록 또는 연결 확인 필요'}}</p><label>엑셀 원본 게시<input type="file" accept=".xlsx,.xlsm" :disabled="busy||!meta" @change="upload"></label><p>원본은 비공개 GitHub 저장소에 버전별로 보존합니다. 8MB 이하, 사업 일정표와 기관별 시트로 구성된 PMOffice 엑셀 구조를 지원합니다.</p><p>이전 게시본 열기·복원은 프로젝트 화면의 ‘파일 게시’에서 이용하세요.</p></section>
<section><h2>지정 회원</h2><form @submit.prevent="find"><label>가입 회원 이메일 검색<input v-model="search" minlength="3" maxlength="120" placeholder="이메일 3자 이상"></label><button :disabled="busy">회원 찾기</button></form><label>접근 만료 일시(선택)<input v-model="expires" type="datetime-local"></label><ul><li v-for="u in matches" :key="u.id">{{u.email}} · {{u.status}} <button @click="grant(u.id,true)" :disabled="busy">접근 허용</button></li></ul>
<ul><li v-for="m in members" :key="m.user_id">{{m.email}} · {{m.active?'허용':'회수'}} · {{m.expires_at||'만료 없음'}} <button v-if="m.active" @click="grant(m.user_id,false)" :disabled="busy">접근 회수</button></li></ul></section>
<section><h2>변경 이력</h2><ol><li v-for="h in history" :key="h.id">{{new Date(h.created_at).toLocaleString('ko-KR')}} · {{h.action}}</li></ol></section>
</template>
</section><section v-else><h2>관리할 프로젝트를 선택하세요.</h2><p>새 프로젝트는 초안·지정 회원 상태로 시작합니다.</p></section>
</div>
</main>
</template>
<style scoped>
.pms-admin-tabs{display:flex;gap:12px;padding:24px 32px 0;max-width:1440px;margin:auto;flex-wrap:wrap;align-items:center}.pms-admin-tabs button[aria-pressed=true]{background:#183a61;color:white}.pms-admin{max-width:1440px;padding:40px 32px 80px;margin:auto;color:#16334f}.pms-admin header{display:flex;justify-content:space-between;gap:20px;align-items:center}.pms-admin h1{font-size:34px;font-weight:750}.pms-admin h2{font-size:22px;font-weight:700;margin-bottom:16px}.pms-admin p{margin:12px 0;color:#596f85}.pms-admin-grid{display:grid;grid-template-columns:300px minmax(0,1fr);gap:28px;margin-top:24px}.pms-admin-grid section section,.pms-admin-grid section>form{padding:24px;border:1px solid #d5e0eb;border-radius:10px;margin-bottom:22px;background:white}.pms-fields{display:grid;grid-template-columns:1fr 1fr;gap:16px}.pms-admin label{display:flex;flex-direction:column;gap:7px;margin:10px 0}.pms-admin input,.pms-admin select,.pms-admin textarea{border:1px solid #b5c5d5;border-radius:6px;padding:10px;background:white;width:100%}.pms-admin .pms-check{flex-direction:row;align-items:center}.pms-check input{width:auto}.pms-admin button,.pms-admin-tabs button{border:1px solid #b5c5d5;border-radius:6px;padding:10px 14px;background:#edf3fa;font-weight:600}.pms-admin button:disabled{opacity:.45}.pms-project-row{display:flex;flex-direction:column;width:100%;text-align:left;margin-bottom:10px;gap:8px}.pms-admin li{padding:10px 0;overflow-wrap:anywhere}.pms-admin li button{margin-left:10px}.pms-admin input[type=file]{max-width:100%}@media(max-width:780px){.pms-admin-grid{grid-template-columns:1fr}.pms-fields{grid-template-columns:1fr}.pms-admin{padding:28px 16px}.pms-admin h1{font-size:28px}.pms-admin header{display:block}}
</style>

