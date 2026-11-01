<script setup>
import {MEMBER_VIEWS,memberViewColumns,memberViewLabel} from './member-views.js'
import {watchAdminChanges} from './change-events.js'
import {memberClient} from './member-service.js'
import {ref,computed,nextTick,onMounted,onUnmounted} from 'vue'
import MemberBulk from './MemberBulk.vue'
import MemberBulkControls from './MemberBulkControls.vue'
import MemberDetailTools from './MemberDetailTools.vue'
import {memberRpc,memberApi} from './member-service.js'
import {MEMBER_PAGE_SIZE,formatMemberDate,memberLoginLabel} from './member-table.js'
const education=ref([]),educationLoading=ref(false);let educationEpoch=0
async function loadEducation(user){const id=++educationEpoch;education.value=[];if(!user)return;educationLoading.value=true;try{const result=await memberRpc('member_admin_education',{p_user_id:user});if(id===educationEpoch)education.value=result}catch(e){if(id===educationEpoch)message.value=e.message}finally{if(id===educationEpoch)educationLoading.value=false}}
async function setEducation(kind,enabled){const user=selected.value?.id;if(!user)return;await run(async()=>{const result=await memberRpc('member_admin_set_education',{p_user_id:user,p_kind:kind,p_enabled:enabled});if(selected.value?.id===user)education.value=result;message.value='온라인 교육 권한을 저장했습니다.'});if(selected.value?.id===user)await loadEducation(user)}
const rows=ref([]),selected=ref(null),search=ref(''),appliedSearch=ref(''),page=ref(0),hasNext=ref(false),busy=ref(false),message=ref(''),password=ref(''),confirmWithdraw=ref(false),showBulk=ref(false),requestId=ref(crypto.randomUUID()),loaded=ref(false),updatedAt=ref(null),autoRefresh=ref(true),editorPanel=ref(null)
const view=ref('valid'),viewLabel=computed(()=>memberViewLabel(view.value)),columns=computed(()=>memberViewColumns(view.value))
let pendingView=null
function viewFromHash(){const value=new URLSearchParams(location.hash.split('?')[1]||'').get('view');return MEMBER_VIEWS.some(v=>v[0]===value)?value:'valid'}
function onViewRoute(){if(location.hash.split('?')[0]!=='#members')return;const value=viewFromHash();if(value!==view.value)changeView(value,false)}
async function changeView(value,writeHistory=true){if(busy.value){pendingView={value,writeHistory};return}view.value=value;page.value=0;checkedIds.value=[];selected.value=null;if(writeHistory)window.history.pushState(window.history.state,'','#members'+(value==='valid'?'':'?view='+value));await run(()=>load(0))}
const showAnswers=ref(false),answers=ref({}),answersLoading=ref(false),answersError=ref('');let answerEpoch=0
async function loadAnswers(){const id=++answerEpoch;answers.value={};answersError.value='';if(!showAnswers.value||!rows.value.length){answersLoading.value=false;return}answersLoading.value=true;try{const data=await memberRpc('member_admin_signup_answers',{p_users:rows.value.map(r=>r.id)});if(id===answerEpoch)answers.value=Object.fromEntries(data.map(r=>[r.user_id,r]))}catch(e){if(id===answerEpoch)answersError.value=e.message}finally{if(id===answerEpoch)answersLoading.value=false}}
function toggleAnswers(){showAnswers.value=!showAnswers.value;loadAnswers()}
function answerPairs(r){const a=answers.value[r.id];return a?.answers?Object.entries(a.answers):[['이름',r.display_name],['이메일',r.email],['직함',r.position],['회사·소속',r.company],['회원 구분',r.member_kind==='business'?'기업·기관 회원':'개인 회원']]}
function requestedNames(r){return answers.value[r.id]?.requested_names?.join(', ')||'신청 기록 없음'}
const checkedIds=ref([])
const checkedUsers=computed(()=>rows.value.filter(r=>checkedIds.value.includes(r.id)&&!r.system_admin))
const allChecked=computed(()=>rows.value.some(r=>!r.system_admin)&&rows.value.filter(r=>!r.system_admin).every(r=>checkedIds.value.includes(r.id)))
function checkAll(value){checkedIds.value=value?rows.value.filter(r=>!r.system_admin).map(r=>r.id):[]}
async function refreshAfterAction(){const id=selected.value?.id;checkedIds.value=[];await run(()=>load());if(id)selected.value=rows.value.find(r=>r.id===id)||null}
function onEscape(e){if(e.key==='Escape'&&!busy.value)selected.value=null}
const sortKey=ref('registered_at'),sortDirection=ref('desc');let stopChanges
async function sortMembers(e){sortKey.value=e.detail.key;sortDirection.value=e.detail.direction;checkedIds.value=[];await run(()=>load(0))}
let epoch=0,timer
async function run(fn,clearPassword=false){if(busy.value)return;busy.value=true;message.value='';try{await fn()}catch(e){message.value=e.message}finally{busy.value=false;if(clearPassword)password.value='';if(pendingView){const next=pendingView;pendingView=null;changeView(next.value,next.writeHistory)}}}
async function load(targetPage=page.value,query=appliedSearch.value){
 const id=++epoch
 try{const data=await memberRpc('member_admin_view_list',{p_search:query,p_offset:targetPage*MEMBER_PAGE_SIZE,p_sort:sortKey.value,p_direction:sortDirection.value,p_view:view.value});if(id!==epoch)return
 hasNext.value=data.length>MEMBER_PAGE_SIZE;rows.value=data.slice(0,MEMBER_PAGE_SIZE);page.value=targetPage;appliedSearch.value=query;loaded.value=true;updatedAt.value=new Date().toISOString();await loadAnswers()
 }catch(e){if(id===epoch){rows.value=[];hasNext.value=false;loaded.value=false;updatedAt.value=null}throw e}
}
function find(){if(!busy.value){checkedIds.value=[];run(()=>load(0,search.value))}}
function move(delta){if(busy.value||page.value+delta<0||(delta>0&&!hasNext.value))return;checkedIds.value=[];run(()=>load(page.value+delta))}
async function choose(row){selected.value=row?{...row}:{id:null,email:'',display_name:'',company:'',position:'',member_kind:'individual',status:'active'};password.value='';confirmWithdraw.value=false;requestId.value=crypto.randomUUID();loadEducation(selected.value.id);await nextTick();editorPanel.value?.focus({preventScroll:true});editorPanel.value?.scrollIntoView?.({block:'start',behavior:'auto'})}
async function save(){await run(async()=>{const s=selected.value;await memberApi({action:s.id?'update':'create',request_id:requestId.value,user_id:s.id,email:s.email,name:s.display_name,company:s.company,position:s.position||'',kind:s.member_kind,...(!s.id?{password:password.value}:{})});await load();message.value=s.id?'회원정보를 저장했습니다.':'회원을 등록했습니다. 회원에게 자동 메일은 발송하지 않습니다.';selected.value=null;requestId.value=crypto.randomUUID()},true)}
async function setPassword(){await run(async()=>{await memberApi({action:'password',request_id:crypto.randomUUID(),user_id:selected.value.id,password:password.value});message.value='PMOffice 비밀번호를 변경했습니다. 회원에게 자동 메일은 발송하지 않습니다.'},true)}
async function withdraw(){if(!confirmWithdraw.value)return;await run(async()=>{const result=await memberApi({action:'withdraw',request_id:crypto.randomUUID(),user_id:selected.value.id});await load();selected.value=null;message.value=result.warning||'탈퇴 처리했습니다. 기존 세션의 자료 접근도 차단됩니다.'},true)}
onMounted(()=>{view.value=viewFromHash();window.addEventListener('hashchange',onViewRoute);window.addEventListener('popstate',onViewRoute);document.addEventListener('keydown',onEscape);run(()=>load());stopChanges=watchAdminChanges(memberClient(),['members'],()=>{if(autoRefresh.value&&!busy.value)run(()=>load())})})
onUnmounted(()=>{pendingView=null;window.removeEventListener('hashchange',onViewRoute);window.removeEventListener('popstate',onViewRoute);document.removeEventListener('keydown',onEscape);++epoch;++answerEpoch;stopChanges?.();clearInterval(timer);rows.value=[];selected.value=null;password.value=''})
</script>
<template>
<main class="member-page member-admin">
 <p v-if="message" role="status" aria-live="polite">{{message}}</p>
 <MemberBulkControls v-if="checkedUsers.length" :users="checkedUsers" @updated="refreshAfterAction" />
 <section class="member-panel" :aria-label="viewLabel+' 목록'" :aria-busy="busy">
  <div class="member-view-picker"><label><span class="sr-only">회원 목록 선택</span><select :value="view" :disabled="busy" aria-label="회원 목록 선택" @change="changeView($event.target.value)"><option value="valid">유효 회원</option><option v-for="[key,label] in MEMBER_VIEWS" :key="key" :value="key">{{label}}</option></select></label><span class="member-count">{{rows.length}}명 표시</span><button :aria-expanded="showAnswers" aria-controls="member-list-body" @click="toggleAnswers">{{showAnswers?'답변 접기':'답변 보기'}}</button></div>
  <p v-if="busy" role="status">회원 목록을 불러오는 중입니다.</p>
  <div class="member-table-scroll" tabindex="0" role="region" aria-label="회원 상세 정보 표, 가로 스크롤 가능">
   <table :key="view" class="member-table" data-sort-managed @table-sort="sortMembers"  :aria-label="viewLabel" aria-describedby="member-login-note">

    <thead><tr><th scope="col"><input type="checkbox" :checked="allChecked" aria-label="현재 페이지 회원 전체 선택" @change="checkAll($event.target.checked)"></th><th v-for="[key,label] in columns" :key="key" scope="col" :data-sort-key="key" :aria-sort="sortKey===key?(sortDirection==='desc'?'descending':'ascending'):undefined">{{label}}</th><th scope="col">관리</th></tr></thead>
    <tbody id="member-list-body"><template v-for="r in rows" :key="r.id"><tr :class="{'member-selected':selected?.id===r.id}">
     <td><input v-model="checkedIds" type="checkbox" :value="r.id" :disabled="busy||r.system_admin" :aria-label="(r.display_name||r.email)+' 선택'"></td>
     <td v-for="[key] in columns" :key="key" :class="{'member-date':['registered_at','last_sign_in_at'].includes(key)}">
      <button v-if="key==='display_name'" class="member-name" @click="choose(r)">{{r.display_name||'이름 미입력'}}</button>
      <template v-else-if="key==='member_kind'">{{r.member_kind==='business'?'기업·기관':'개인'}}</template>
      <template v-else-if="key==='groups'"><template v-if="r.groups?.length"><div v-for="g in r.groups" :key="g.id">{{g.name}}<span v-if="!g.active"> (중지·제외)</span></div></template><template v-else>—</template></template>
      <template v-else-if="key==='services'"><div v-for="name in r.service_names||[]" :key="name">{{name}}</div><span v-if="!r.service_names?.length">—</span></template>
      <template v-else-if="key==='member_state'">{{r.member_state_label||'확인 필요'}}</template>
      <template v-else-if="key==='registered_at'">{{formatMemberDate(r.registered_at||r.created_at)}}</template>
      <template v-else-if="key==='last_sign_in_at'">{{r.last_sign_in_at?formatMemberDate(r.last_sign_in_at):'로그인 기록 없음'}}</template>
      <span v-else-if="key==='login_status'" class="member-login-state" :data-state="r.login_status||'unknown'">{{memberLoginLabel(r.login_status)}}</span>
      <template v-else>{{r[key]||'—'}}</template>
     </td><td><button class="member-row" :disabled="busy" :aria-label="(r.display_name||r.email)+' 회원정보 관리'" @click="choose(r)">관리</button></td>
    </tr><tr v-if="showAnswers" class="member-answer-row"><td :colspan="columns.length+2"><p v-if="answersLoading" role="status">가입 답변을 불러오는 중입니다.</p><p v-else-if="answersError" role="alert">{{answersError}} <button @click="loadAnswers">다시 시도</button></p><template v-else><strong>{{answers[r.id]?.original_recorded?'가입 답변':'가입 답변 기록 없음 · 현재 회원정보'}}</strong><dl><template v-for="[key,value] in answerPairs(r)" :key="key"><dt>{{key}}</dt><dd>{{value||'미입력'}}</dd></template><dt>신청 서비스</dt><dd>{{requestedNames(r)}}</dd></dl></template></td></tr></template><tr v-if="loaded&&!rows.length"><td :colspan="columns.length+2">{{appliedSearch?'검색 결과가 없습니다.':'해당하는 회원이 없습니다.'}}</td></tr><tr v-else-if="!loaded&&!busy"><td :colspan="columns.length+2">목록을 불러오지 못했습니다. 새로고침으로 다시 시도해 주세요.</td></tr></tbody>
   </table>
  </div>
  <nav class="member-actions" aria-label="회원 목록 페이지 이동"><button :disabled="busy||page===0" @click="move(-1)">이전</button><span>{{page+1}}페이지 · {{rows.length}}명 표시</span><button :disabled="busy||!hasNext" @click="move(1)">다음</button></nav>
 </section>
 <section class="member-panel member-admin-utilities" aria-label="회원 등록·검색·이용 안내">
 <h1>멤버십 현황</h1>
 <p>기본 화면은 신규 회원과 서비스 이용 중인 유효 회원입니다. 목록을 선택해 한 페이지에 100명씩 확인할 수 있습니다.</p>
 <div class="member-actions"><button :disabled="busy" @click="choose(null)">회원 직접 등록</button><button :disabled="busy" @click="showBulk=!showBulk">기업 회원 일괄 등록</button></div>
 <MemberBulk v-if="showBulk"/>
  <form @submit.prevent="find" class="member-form member-search"><label>회원 검색<input v-model="search" maxlength="200" placeholder="이메일, 이름, 회사명" :disabled="busy"></label><button :disabled="busy">검색·새로고침</button></form>
  <div class="member-actions member-refresh"><label class="member-check"><input type="checkbox" v-model="autoRefresh"><span>회원 정보 변경 시 자동 갱신</span></label><button :disabled="busy" @click="run(()=>load())">현재 목록 새로고침</button><span>최근 조회: {{formatMemberDate(updatedAt)}} (KST)</span></div>
  <p id="member-login-note" class="member-note">마지막 로그인은 인증 서버의 로그인 기록입니다. 로그인 상태는 서버에 유지된 유효한 세션 기준이며, 여러 기기 중 한 곳이라도 로그인되어 있으면 로그인 중으로 표시합니다. 브라우저를 닫아도 로그인이 유지될 수 있습니다. 날짜와 시간은 한국시간(KST)입니다.</p>
 </section>
 <section v-if="selected" ref="editorPanel" class="member-panel member-editor member-detail-drawer" tabindex="-1" aria-label="회원정보 관리"><button class="member-drawer-close" @click="selected=null" aria-label="회원 상세 정보 닫기">닫기 ×</button><h2>{{selected.id?'회원 상세 정보':'회원 직접 등록'}}</h2><MemberDetailTools v-if="selected.id" :user="selected" @updated="refreshAfterAction" /><form @submit.prevent="save" class="member-form"><label>회원 구분<select v-model="selected.member_kind"><option value="business">기업·기관 회원</option><option value="individual">개인 회원</option></select></label><label>이름<span class="member-required">*</span><input v-model="selected.display_name" required maxlength="120"></label><label>직함<span class="member-required">*</span><input required v-model="selected.position" maxlength="120"></label><label>회사명·소속<span class="member-required">*</span><input v-model="selected.company" required maxlength="200"></label><label>이메일<input v-model="selected.email" type="email" required maxlength="254"></label><label v-if="!selected.id">초기 비밀번호<input v-model="password" type="password" required minlength="8" maxlength="128" autocomplete="new-password"></label><p v-if="!selected.id" class="member-note">지정하신 비밀번호로 바로 로그인할 수 있습니다. 첫 로그인 비밀번호 변경 안내나 자동 이메일은 보내지 않습니다.</p><button :disabled="busy">{{selected.id?'회원정보 저장':'회원 등록'}}</button></form>
<template v-if="selected.id"><section aria-label="온라인 교육 권한"><h3>온라인 교육 서비스 권한</h3><p>MS Project 교육과 AI 교육을 각각 허용·해제할 수 있습니다. 변경은 즉시 저장되며 기존 강의 접근 권한에도 적용됩니다.</p><p v-if="educationLoading" role="status">교육 권한을 확인하고 있습니다.</p><label v-for="e in education" :key="e.kind" class="member-check"><input type="checkbox" :checked="e.enabled" :disabled="busy||educationLoading" @change="setEducation(e.kind,$event.target.checked)"><span>{{e.name}}</span></label></section><h3>가입 기록</h3><p>가입 경로: {{selected.registration_source}} · 등록 시각: {{selected.registered_at||selected.created_at}}</p><p>회원 본인 가입 동의: {{selected.signup_accepted_at||'기록 없음 (관리자 등록과 구분)'}}</p><h3>소속 그룹</h3><ul><li v-for="g in selected.groups" :key="g.id">{{g.name}} · {{g.active?'포함':'중지 또는 제외'}}</li></ul><h3>PMOffice 비밀번호 변경</h3><form @submit.prevent="setPassword" class="member-form"><label>새 비밀번호<input v-model="password" type="password" required minlength="8" maxlength="128" autocomplete="new-password"></label><button :disabled="busy">비밀번호 변경</button></form><h3>회원 탈퇴 처리</h3><p>회원정보와 처리 이력을 보존하고 사이트 이용을 중지합니다.</p><label class="member-check"><input v-model="confirmWithdraw" type="checkbox"><span>{{selected.display_name||selected.email}} 회원의 이용 중지 확인</span></label><button :disabled="busy||!confirmWithdraw||!!selected.withdrawn_at" @click="withdraw">탈퇴 처리</button></template></section>
 <p v-if="!selected" class="member-note">회원 이름 또는 관리 버튼을 누르면 오른쪽에서 상세 정보를 확인하고 수정할 수 있습니다.</p>
</main>
</template>

<style>.member-view-picker{margin:0 0 18px}.member-view-picker label{display:flex;align-items:center;gap:10px}.member-view-picker select{padding:9px 12px;border:1px solid #adc0d5;border-radius:6px;background:white}.member-view-picker button[aria-pressed=true]{background:#1c3e63;color:white}.member-view-title{font-size:22px;font-weight:750;margin:16px 0}.member-detail-drawer{position:fixed;right:16px;top:92px;bottom:16px;z-index:100;width:min(520px,calc(100vw - 32px));overflow:auto;background:white!important;border:1px solid #d5e1ed!important;border-radius:14px;padding:24px!important;box-shadow:0 12px 50px #193b612e}.member-detail-drawer h2{font-size:24px;font-weight:750;margin:0 0 20px}.member-drawer-close{float:right;margin-left:12px}.member-admin .member-name{border:0;background:none;padding:0;color:#1d5e9f;text-decoration:underline;font-weight:650;text-align:left}.member-admin .member-table input[type=checkbox]{width:19px;height:19px}@media(max-width:780px){.member-detail-drawer{top:80px;right:8px;bottom:8px;width:calc(100vw - 16px);padding:20px!important}}</style>

<style scoped>
.member-admin{padding-top:10px}.member-admin>.member-panel{margin-top:0;padding:12px}.member-view-picker{display:flex;align-items:center;gap:10px;margin:0 0 8px;min-height:36px}.member-view-picker label{display:flex;margin:0}.member-view-picker select{font-weight:700;max-width:190px;padding:6px 10px}.member-view-picker button{margin-left:auto;padding:6px 12px}.member-count{font-size:12px;color:#61768d}.member-admin .member-table th,.member-admin .member-table td{padding:8px 10px}.member-admin .member-table{margin:0}.member-admin .member-table button.member-name{padding:0;border:0;background:transparent;white-space:nowrap;min-width:max-content;justify-content:flex-start}.member-admin .member-table button.member-row{padding:4px 8px}.member-admin>.member-admin-utilities{margin-top:24px;padding:20px}.member-admin-utilities h1{font-size:24px;margin:0 0 8px}.member-answer-row td{background:#f6f8fc}.member-answer-row strong{font-size:12px}.member-answer-row dl{display:grid;grid-template-columns:110px 1fr;gap:2px 12px;margin:6px 0;font-size:13px}.member-answer-row dt{color:#62758b}.member-answer-row dd{margin:0;overflow-wrap:anywhere}.member-required{color:#d12c37;margin-left:4px}.sr-only{position:absolute;width:1px;height:1px;padding:0;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
</style>
