<script setup>
import {ref,onMounted,onUnmounted} from 'vue'
import {client,call,labels,login,safeReturn} from './pms-client.js'
const props=defineProps({mode:{default:'catalog'},project:{default:''}})
const rows=ref([]),access=ref(null),account=ref(null),session=ref(null),error=ref(''),busy=ref(false),accept=ref(false)
let subscription,timer,epoch=0
async function load(){
 const id=++epoch
 try {
 const s=await client().auth.getSession();if(s.error)throw s.error
 const [a,r]=await Promise.all([call('pms_account'),props.mode==='project'?call('pms_access',{p_slug:props.project}):call('pms_catalog')])
 if(id!==epoch)return
 session.value=s.data.session;account.value=a;if(props.mode==='project')access.value=r;else rows.value=r;error.value=''
 }catch{if(id!==epoch)return;access.value=null;rows.value=[];error.value='프로젝트 서비스 연결을 확인하고 있습니다. 잠시 후 새로고침해 주세요.'}
}
async function signin(){busy.value=true;try{await login(location.pathname+location.hash)}catch(e){error.value=e.message;busy.value=false}}
async function signout(){++epoch;access.value=null;rows.value=[];account.value=null;session.value=null;await client().auth.signOut();await load()}
async function join(){if(!accept.value)return;busy.value=true;try{await call('accept_signup',{p_version:account.value.signup_version});await load()}catch(e){error.value=e.message}finally{busy.value=false}}
onMounted(async()=>{
 try{
 if(props.mode==='callback'){
 const code=new URLSearchParams(location.search).get('code')
 if(!code)throw Error('로그인이 취소되었거나 확인 코드가 없습니다.')
 const {error:e}=await client().auth.exchangeCodeForSession(code)
 history.replaceState(null,'','/pms/callback.html')
 if(e)throw e
 const next=safeReturn(sessionStorage.getItem('pms-return'));sessionStorage.removeItem('pms-return');location.replace(next);return
 }
 await load()
 subscription=client().auth.onAuthStateChange(event=>{if(event==='SIGNED_OUT'){++epoch;access.value=null;account.value=null;rows.value=[];session.value=null}else setTimeout(load,0)}).data.subscription
 timer=setInterval(load,30000)
 }catch(e){error.value=e.message}
})
onUnmounted(()=>{++epoch;subscription?.unsubscribe();clearInterval(timer)})
</script>
<template>
<main class="pms-portal">
<header class="pms-heading"><div><span class="pms-eyebrow">PMOFFICE · PROJECTS</span><h1>{{access?.project?.title||'고객 프로젝트'}}</h1><p>일정과 진행 현황을 확인하고 업무 보고서를 내려받으세요.</p></div><div class="pms-actions"><a v-if="mode==='project'" href="/pms/">프로젝트 목록</a><a v-if="account?.admin" href="/admin/#projects">시스템 관리</a><button v-if="session" @click="signout">로그아웃</button><button v-else :disabled="busy" @click="signin">Google로 계속하기</button></div></header>
<p v-if="error" role="alert">{{error}}</p>
<section v-if="mode==='callback'"><h2>로그인을 확인하고 있습니다.</h2><a href="/pms/">목록으로 돌아가기</a></section>
<template v-else>
<section v-if="session&&!account?.member&&!account?.admin" class="pms-notice">
<h2>회원 가입 확인</h2><p>Google로 확인한 계정으로 프로젝트 서비스를 이용합니다. 가입만으로 지정 회원 프로젝트의 권한이 부여되지는 않습니다.</p>
<p><a href="/pms/terms.html">서비스 이용 안내·개인정보 처리 안내</a></p>
<label><input type="checkbox" v-model="accept">안내를 확인했으며 회원 가입에 동의합니다.</label>
<button :disabled="!accept||busy" @click="join">회원 가입 완료</button>
</section>
<template v-if="mode==='project'">
<iframe v-if="access?.allowed" class="pms-frame" :src="'/pms/app/index.html?project='+encodeURIComponent(project)" title="프로젝트 현황과 보고서"></iframe>
<section v-else class="pms-notice"><h2>프로젝트 접근 확인</h2><p>{{access?.project?labels[access.project.access_mode]+' 프로젝트입니다.':'프로젝트가 게시되지 않았거나 접근 권한이 없습니다.'}}</p><p v-if="session">지정 회원 프로젝트는 운영자의 승인이 필요합니다.</p><button v-if="!session" :disabled="busy" @click="signin">Google로 계속하기</button><button @click="load">권한 다시 확인</button></section>
</template>
<section v-else class="pms-cards" aria-label="프로젝트 목록">
<a v-for="p in rows" :key="p.slug" :href="'/pms/'+p.slug+'/'" class="pms-card"><span>{{p.customer}}</span><h2>{{p.title}}</h2><p>{{p.description}}</p><strong>{{labels[p.access_mode]}}</strong><span v-if="p.status!=='published'"> · {{p.status==='draft'?'초안':'보관'}}</span><div class="pms-card-arrow">프로젝트 열기 →</div></a>
<p v-if="!rows.length&&!error">현재 표시할 프로젝트가 없습니다. 지정 회원은 로그인 후 확인해 주세요.</p>
</section>
</template>
</main>
</template>
<style>
.pms-portal{max-width:1440px;margin:auto;padding:56px 24px;color:#17314e}.pms-heading{display:flex;justify-content:space-between;gap:24px;align-items:center;margin-bottom:32px}.pms-eyebrow{font-size:12px;letter-spacing:.14em;color:#44698c}.pms-heading h1{font-size:34px;font-weight:750;line-height:1.3;margin:10px 0}.pms-heading p{color:#63748a}.pms-actions{display:flex;gap:12px;flex-wrap:wrap;align-items:center}.pms-portal button,.pms-actions a{border:1px solid #b9cbdc;border-radius:7px;padding:10px 15px;font-weight:600;background:#fff}.pms-portal button:disabled{opacity:.5}.pms-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:22px}.pms-card{border:1px solid #d8e2ed;border-radius:12px;padding:28px;background:#f8fafc;transition:border-color .2s}.pms-card:hover{border-color:#2563ad}.pms-card h2{font-size:23px;font-weight:700;margin:12px 0}.pms-card p{margin-bottom:22px;line-height:1.7}.pms-card strong{font-size:13px;background:#e2ecf9;padding:5px 10px;border-radius:20px}.pms-card-arrow{margin-top:30px;font-weight:650;color:#2260a6}.pms-notice{padding:28px;background:#f4f7fb;border:1px solid #d8e2ed;border-radius:10px;margin:20px 0}.pms-notice h2{font-size:24px;font-weight:700}.pms-notice p{margin:12px 0}.pms-notice button{margin:12px}.pms-frame{width:100%;height:calc(100vh - 170px);min-height:700px;border:1px solid #d8e2ed;border-radius:10px}button:focus-visible,a:focus-visible{outline:3px solid #2676bd;outline-offset:3px}@media(max-width:700px){.pms-heading{display:block}.pms-heading h1{font-size:27px}.pms-actions{margin-top:20px}.pms-portal{padding:30px 14px}.pms-frame{min-height:720px}}
</style>

