<script setup>
import {ref,nextTick,onMounted,onUnmounted} from 'vue'
import MemberBulk from './MemberBulk.vue'
import {memberRpc,memberApi} from './member-service.js'
import {MEMBER_PAGE_SIZE,formatMemberDate,memberLoginLabel} from './member-table.js'
const rows=ref([]),selected=ref(null),search=ref(''),appliedSearch=ref(''),page=ref(0),hasNext=ref(false),busy=ref(false),message=ref(''),password=ref(''),confirmWithdraw=ref(false),showBulk=ref(false),requestId=ref(crypto.randomUUID()),loaded=ref(false),updatedAt=ref(null),autoRefresh=ref(true),editorPanel=ref(null)
let epoch=0,timer
async function run(fn,clearPassword=false){if(busy.value)return;busy.value=true;message.value='';try{await fn()}catch(e){message.value=e.message}finally{busy.value=false;if(clearPassword)password.value=''}}
async function load(targetPage=page.value,query=appliedSearch.value){
 const id=++epoch
 try{const data=await memberRpc('member_admin_list',{p_search:query,p_offset:targetPage*MEMBER_PAGE_SIZE});if(id!==epoch)return
 hasNext.value=data.length>MEMBER_PAGE_SIZE;rows.value=data.slice(0,MEMBER_PAGE_SIZE);page.value=targetPage;appliedSearch.value=query;loaded.value=true;updatedAt.value=new Date().toISOString()
 }catch(e){if(id===epoch){rows.value=[];hasNext.value=false;loaded.value=false;updatedAt.value=null}throw e}
}
function find(){if(!busy.value)run(()=>load(0,search.value))}
function move(delta){if(busy.value||page.value+delta<0||(delta>0&&!hasNext.value))return;run(()=>load(page.value+delta))}
async function choose(row){selected.value=row?{...row}:{id:null,email:'',display_name:'',company:'',position:'',member_kind:'business',status:'active'};password.value='';confirmWithdraw.value=false;requestId.value=crypto.randomUUID();await nextTick();editorPanel.value?.focus({preventScroll:true});editorPanel.value?.scrollIntoView?.({block:'start',behavior:'auto'})}
async function save(){await run(async()=>{const s=selected.value;await memberApi({action:s.id?'update':'create',request_id:requestId.value,user_id:s.id,email:s.email,name:s.display_name,company:s.company,position:s.position||'',kind:s.member_kind,...(!s.id?{password:password.value}:{})});await load();message.value=s.id?'회원정보를 저장했습니다.':'회원을 등록했습니다. 회원에게 자동 메일은 발송하지 않습니다.';selected.value=null;requestId.value=crypto.randomUUID()},true)}
async function setPassword(){await run(async()=>{await memberApi({action:'password',request_id:crypto.randomUUID(),user_id:selected.value.id,password:password.value});message.value='PMOffice 비밀번호를 변경했습니다. 회원에게 자동 메일은 발송하지 않습니다.'},true)}
async function withdraw(){if(!confirmWithdraw.value)return;await run(async()=>{const result=await memberApi({action:'withdraw',request_id:crypto.randomUUID(),user_id:selected.value.id});await load();selected.value=null;message.value=result.warning||'탈퇴 처리했습니다. 기존 세션의 자료 접근도 차단됩니다.'},true)}
onMounted(()=>{run(()=>load());timer=setInterval(()=>{if(autoRefresh.value&&!busy.value&&document.visibilityState==='visible')run(()=>load())},30000)})
onUnmounted(()=>{++epoch;clearInterval(timer);rows.value=[];selected.value=null;password.value=''})
</script>
<template>
<main class="member-page member-admin">
 <h1>회원 관리</h1>
 <p>전체 회원을 한 페이지에 100명씩 표시합니다. 이용 중지·탈퇴 회원도 포함합니다.</p>
 <p role="status" aria-live="polite">{{message}}</p>
 <div class="member-actions"><button :disabled="busy" @click="choose(null)">회원 직접 등록</button><button :disabled="busy" @click="showBulk=!showBulk">기업 회원 일괄 등록</button></div>
 <MemberBulk v-if="showBulk"/>
 <section class="member-panel" aria-label="전체 회원 목록" :aria-busy="busy">
  <form @submit.prevent="find" class="member-form member-search"><label>회원 검색<input v-model="search" maxlength="200" placeholder="이메일, 이름, 회사명" :disabled="busy"></label><button :disabled="busy">검색·새로고침</button></form>
  <div class="member-actions member-refresh"><label class="member-check"><input type="checkbox" v-model="autoRefresh"><span>30초마다 로그인 상태 자동 갱신</span></label><button :disabled="busy" @click="run(()=>load())">현재 목록 새로고침</button><span>최근 조회: {{formatMemberDate(updatedAt)}} (KST)</span></div>
  <p id="member-login-note" class="member-note">마지막 로그인은 인증 서버의 로그인 기록입니다. 로그인 상태는 서버에 유지된 유효한 세션 기준이며, 여러 기기 중 한 곳이라도 로그인되어 있으면 로그인 중으로 표시합니다. 브라우저를 닫아도 로그인이 유지될 수 있습니다. 날짜와 시간은 한국시간(KST)입니다.</p>
  <p v-if="busy" role="status">회원 목록을 불러오는 중입니다.</p>
  <div class="member-table-scroll" tabindex="0" role="region" aria-label="회원 상세 정보 표, 가로 스크롤 가능">
   <table class="member-table" aria-describedby="member-login-note">
    <caption>전체 회원 목록 · 페이지당 100명</caption>
    <thead><tr><th scope="col">이름</th><th scope="col">이메일</th><th scope="col">회사/소속</th><th scope="col">직함</th><th scope="col">회원 구분</th><th scope="col">소속 그룹</th><th scope="col">이용 상태</th><th scope="col">가입일 (KST)</th><th scope="col">마지막 로그인 (KST)</th><th scope="col">현재 로그인 상태</th><th scope="col">관리</th></tr></thead>
    <tbody><tr v-for="r in rows" :key="r.id" :class="{'member-selected':selected?.id===r.id}">
     <td>{{r.display_name||'이름 미입력'}}</td><td>{{r.email||'—'}}</td><td>{{r.company||'—'}}</td><td>{{r.position||'—'}}</td><td>{{r.member_kind==='business'?'기업·기관':'개인'}}</td>
     <td><template v-if="r.groups?.length"><div v-for="g in r.groups" :key="g.id">{{g.name}}<span v-if="!g.active"> (중지·제외)</span></div></template><template v-else>—</template></td>
     <td>{{r.withdrawn_at?'탈퇴':r.status==='active'?'이용 중':'중지'}}</td><td class="member-date">{{formatMemberDate(r.registered_at||r.created_at)}}</td><td class="member-date">{{r.last_sign_in_at?formatMemberDate(r.last_sign_in_at):'로그인 기록 없음'}}</td>
     <td><span class="member-login-state" :data-state="r.login_status||'unknown'">{{memberLoginLabel(r.login_status)}}</span></td><td><button class="member-row" :disabled="busy" :aria-label="(r.display_name||r.email)+' 회원정보 관리'" @click="choose(r)">관리</button></td>
    </tr><tr v-if="loaded&&!rows.length"><td colspan="11">{{appliedSearch?'검색 결과가 없습니다.':'등록된 회원이 없습니다.'}}</td></tr><tr v-else-if="!loaded&&!busy"><td colspan="11">목록을 불러오지 못했습니다. 새로고침으로 다시 시도해 주세요.</td></tr></tbody>
   </table>
  </div>
  <nav class="member-actions" aria-label="회원 목록 페이지 이동"><button :disabled="busy||page===0" @click="move(-1)">이전</button><span>{{page+1}}페이지 · {{rows.length}}명 표시</span><button :disabled="busy||!hasNext" @click="move(1)">다음</button></nav>
 </section>
 <section v-if="selected" ref="editorPanel" class="member-panel member-editor" tabindex="-1" aria-label="회원정보 관리"><h2>{{selected.id?'회원정보 수정':'회원 직접 등록'}}</h2><form @submit.prevent="save" class="member-form"><label>회원 구분<select v-model="selected.member_kind"><option value="business">기업·기관 회원</option><option value="individual">개인 회원</option></select></label><label>이름<input v-model="selected.display_name" required maxlength="120"></label><label>직함<input v-model="selected.position" maxlength="120"></label><label>회사명·소속{{selected.member_kind==='individual'?' (선택)':''}}<input v-model="selected.company" :required="selected.member_kind==='business'" maxlength="200"></label><label>이메일<input v-model="selected.email" type="email" required maxlength="254"></label><label v-if="!selected.id">초기 비밀번호<input v-model="password" type="password" required minlength="8" maxlength="128" autocomplete="new-password"></label><p v-if="!selected.id" class="member-note">지정하신 비밀번호로 바로 로그인할 수 있습니다. 첫 로그인 비밀번호 변경 안내나 자동 이메일은 보내지 않습니다.</p><button :disabled="busy">{{selected.id?'회원정보 저장':'회원 등록'}}</button></form>
<template v-if="selected.id"><h3>가입 기록</h3><p>가입 경로: {{selected.registration_source}} · 등록 시각: {{selected.registered_at||selected.created_at}}</p><p>회원 본인 가입 동의: {{selected.signup_accepted_at||'기록 없음 (관리자 등록과 구분)'}}</p><h3>소속 그룹</h3><ul><li v-for="g in selected.groups" :key="g.id">{{g.name}} · {{g.active?'포함':'중지 또는 제외'}}</li></ul><h3>PMOffice 비밀번호 변경</h3><form @submit.prevent="setPassword" class="member-form"><label>새 비밀번호<input v-model="password" type="password" required minlength="8" maxlength="128" autocomplete="new-password"></label><button :disabled="busy">비밀번호 변경</button></form><h3>회원 탈퇴 처리</h3><p>회원정보와 처리 이력을 보존하고 사이트 이용을 중지합니다.</p><label class="member-check"><input v-model="confirmWithdraw" type="checkbox"><span>{{selected.display_name||selected.email}} 회원의 이용 중지 확인</span></label><button :disabled="busy||!confirmWithdraw||!!selected.withdrawn_at" @click="withdraw">탈퇴 처리</button></template></section>
 <p v-if="!selected" class="member-note">회원의 관리 버튼을 누르면 아래에서 상세 정보를 수정할 수 있습니다.</p>
</main>
</template>
