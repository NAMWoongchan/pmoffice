<script setup>
import {ref,computed,onMounted,onUnmounted,watch} from 'vue'
import MemberServices from './MemberServices.vue'
import MemberSelfDetails from './MemberSelfDetails.vue'
import {memberClient,memberSession,memberAccount,initializeMember,refreshMember,memberApi,memberRpc,googleMemberLogin,safeMemberReturn,memberLogout} from './member-service.js'
const props=defineProps({mode:{default:'login'}})
const busy=ref(false),message=ref(''),name=ref(''),company=ref(''),position=ref(''),kind=ref('business'),email=ref(''),password=ref(''),currentPassword=ref(''),accept=ref(false)
const requestedServices=ref([]),serviceCatalog=ref([])
function toggleService(item,checked){if(checked){if(['base','ai','msp','pm'].includes(item.kind))requestedServices.value=requestedServices.value.filter(c=>!serviceCatalog.value.some(x=>x.id===c&&x.kind===item.kind));requestedServices.value=[...requestedServices.value,item.id]}else requestedServices.value=requestedServices.value.filter(c=>c!==item.id)}
const next=ref('/account.html'),loaded=ref(''),accountTab=ref('profile')
function syncTab(){accountTab.value=location.hash==='#services'?'services':'profile'}
function selectTab(value){accountTab.value=value;const hash=value==='services'?'#services':'#profile';if(location.hash!==hash)history.pushState({...history.state},'',location.pathname+location.search+hash)}
onMounted(()=>{syncTab();window.addEventListener('hashchange',syncTab);window.addEventListener('popstate',syncTab)})
onUnmounted(()=>{window.removeEventListener('hashchange',syncTab);window.removeEventListener('popstate',syncTab)})
const completing=computed(()=>!!memberSession.value&&!memberAccount.value?.member)
const signup=computed(()=>props.mode==='signup'||completing.value)
watch(memberAccount,a=>{if(a?.profile&&loaded.value!==a.profile.id){loaded.value=a.profile.id;name.value=a.profile.display_name||'';company.value=a.profile.company||'';position.value=a.profile.position||'';kind.value=a.profile.member_kind||'business';email.value=a.profile.email||''}},{immediate:true})
async function run(fn){if(busy.value)return;busy.value=true;message.value='';try{await fn()}catch(e){message.value=e.message}finally{busy.value=false;password.value='';currentPassword.value=''}}
async function submit(){await run(async()=>{const signingUp=signup.value&&props.mode!=='account';
 if(props.mode==='account'){
 await memberApi({action:'self-update',name:name.value,company:company.value,position:position.value,kind:kind.value,email:email.value,password:password.value||undefined,current_password:currentPassword.value||undefined});await refreshMember();message.value='회원정보를 저장했습니다.';return
 }
 if(completing.value){await memberRpc('member_complete_registration',{p_name:name.value,p_company:company.value,p_kind:kind.value,p_accept:accept.value})}
 else if(signup.value){const result=await memberApi({action:'register',email:email.value,name:name.value,company:company.value,kind:kind.value,password:password.value,accept:accept.value});const {error}=await memberClient().auth.setSession(result.session);if(error)throw Error('가입은 완료했으나 로그인이 필요합니다.')}
 else{const {error}=await memberClient().auth.signInWithPassword({email:email.value.trim(),password:password.value});if(error)throw Error('이메일과 비밀번호를 확인해 주세요.')}
 await refreshMember();if(signingUp&&memberAccount.value?.member){await memberRpc('member_signup_service_request',{p_codes:requestedServices.value,p_position:position.value})}if(memberAccount.value?.member)location.assign(next.value);else if(memberAccount.value?.profile?.status==='suspended'||memberAccount.value?.profile?.withdrawn_at){await memberClient().auth.signOut();throw Error('이용이 중지된 계정입니다. 관리자에게 문의해 주세요.')}
 })}
async function google(){await run(()=>googleMemberLogin(props.mode==='account'?'/account.html#'+accountTab.value:next.value))}
onMounted(async()=>{next.value=safeMemberReturn(new URLSearchParams(location.search).get('returnTo'));await initializeMember();if(props.mode==='signup'||completing.value){try{serviceCatalog.value=await memberRpc('member_service_catalog')}catch{message.value='서비스 신청 항목을 확인하지 못했습니다. 새로고침해 주세요.'}}
 if(props.mode==='callback'){await run(async()=>{const code=new URLSearchParams(location.search).get('code');history.replaceState(null,'',location.pathname);if(!code)throw Error('Google 로그인이 취소되었거나 만료되었습니다.');const {error}=await memberClient().auth.exchangeCodeForSession(code);if(error)throw Error('로그인을 완료하지 못했습니다. 다시 시도해 주세요.');await refreshMember();const target=safeMemberReturn(sessionStorage.getItem('member-return')||sessionStorage.getItem('pms-return'));sessionStorage.removeItem('member-return');sessionStorage.removeItem('pms-return');location.replace(memberAccount.value?.member?target:'/signup.html?returnTo='+encodeURIComponent(target))})}
})
</script>
<template><main class="member-page" :class="mode==='account'?'member-account-layout':'member-narrow'"><aside v-if="mode==='account'" class="account-sidebar" aria-label="내 정보 메뉴"><span>MY PMOFFICE</span><h2>내 정보</h2><a id="profile" href="#profile" :aria-current="accountTab==='profile'?'page':undefined" @click.stop.prevent="selectTab('profile')">회원 가입 정보</a><a id="services" href="#services" :aria-current="accountTab==='services'?'page':undefined" @click.stop.prevent="selectTab('services')">멤버십 서비스</a></aside><div class="account-content">
<h1>{{mode==='callback'?'로그인 확인':mode==='account'?(accountTab==='services'?'가입 중인 서비스':'회원 가입 정보'):signup?'회원 가입':'로그인'}}</h1>
<p role="status" aria-live="polite">{{message}}</p>
<MemberServices v-if="mode==='account'&&memberAccount?.member&&accountTab==='services'"/><template v-else><p v-if="mode==='callback'">로그인을 확인하고 있습니다. <a href="/login.html">다시 로그인</a></p>
<template v-else-if="mode==='account'&&!memberAccount?.member"><p>로그인 후 회원정보를 수정할 수 있습니다.</p><a class="member-button" :href="'/login.html?returnTo='+encodeURIComponent('/account.html#'+accountTab)">로그인</a></template>
<template v-else-if="mode!=='account'&&memberAccount?.member"><p>이미 로그인되어 있습니다.</p><a class="member-button" :href="next">계속 이용하기</a><a href="/account.html">내 정보</a></template>
<template v-else>
<button v-if="!memberSession||mode==='account'" class="member-button member-google" :disabled="busy" @click="google">{{mode==='account'?'Google로 다시 로그인':'Google 계정으로 계속하기'}}</button>
<MemberSelfDetails v-if="mode==='account'&&memberAccount?.member" />
<form @submit.prevent="submit" class="member-form">
<template v-if="signup||mode==='account'"><label>회원 구분<select v-model="kind"><option value="business">기업·기관 회원</option><option value="individual">개인 회원</option></select></label><label>이름<input v-model="name" required maxlength="120" autocomplete="name"></label><label>직함<input v-model="position" maxlength="120"></label><label>회사명·소속{{kind==='individual'?' (선택)':''}}<input v-model="company" :required="kind==='business'" maxlength="200" autocomplete="organization"></label></template>
<label>이메일<input v-model="email" type="email" required maxlength="254" autocomplete="username" :readonly="completing"></label>
<label v-if="!completing">{{mode==='account'?'새 비밀번호 (변경할 때만 입력)':'비밀번호'}}<input v-model="password" type="password" :required="mode!=='account'" minlength="8" maxlength="128" :autocomplete="signup||mode==='account'?'new-password':'current-password'"></label>
<label v-if="mode==='account'">현재 비밀번호 (이메일·비밀번호 변경 시)<input v-model="currentPassword" type="password" autocomplete="current-password" maxlength="128"></label>
<p v-if="mode==='account'">Google로 가입하셨다면 다시 로그인한 후 PMOffice 비밀번호를 설정할 수 있습니다.</p>
<fieldset v-if="signup" class="signup-service-options"><legend>신청할 서비스 종류 (복수 선택)</legend><p>신청 정보만 접수합니다. 신규 기본은 새싹멤버이며 실제 서비스와 등급은 관리자가 확인·설정합니다.</p><label v-for="item in serviceCatalog" :key="item.id" class="member-check"><input type="checkbox" :checked="requestedServices.includes(item.id)" @change="toggleService(item,$event.target.checked)"><span>{{item.name}}</span></label></fieldset>
<label v-if="signup" class="member-check"><input v-model="accept" type="checkbox" required><span><a href="/pms/terms.html" target="_blank" rel="noopener">서비스 이용·개인정보 안내</a>를 확인하고 회원 가입에 동의합니다.</span></label>
<button class="member-button" :disabled="busy||signup&&!accept">{{busy?'처리 중':mode==='account'?'회원정보 저장':signup?'가입 완료':'로그인'}}</button>
</form>
<template v-if="mode==='account'"><button class="member-link" @click="memberLogout">로그아웃</button></template>
<p v-else>비밀번호를 잊으셨다면 <a href="mailto:nam@pmoffice.co.kr">관리자에게 문의해 주세요.</a></p>
<p v-if="mode!=='account'"><a :href="(signup?'/login.html':'/signup.html')+'?returnTo='+encodeURIComponent(next)">{{signup?'이미 가입하셨나요? 로그인':'처음 방문하셨나요? 가입'}}</a></p>
</template></template></div></main></template>
<style scoped>.member-account-layout{display:grid;grid-template-columns:230px minmax(0,1fr);max-width:1300px;gap:48px}.account-sidebar{position:sticky;top:110px;align-self:start;padding:26px 18px;background:#f5f8fc;border:1px solid #e2eaf2;border-radius:12px}.account-sidebar>span{font-size:10px;letter-spacing:.17em;color:#66809a}.account-sidebar h2{font-size:23px;margin:14px 0 24px}.account-sidebar a{display:block;padding:13px 12px;border-radius:7px;margin:6px 0}.account-sidebar a[aria-current=page]{background:#e1edfc;color:#1e5f9f;font-weight:700}.account-content{min-width:0}.account-content>.member-form{max-width:650px}@media(max-width:760px){.member-account-layout{display:block}.account-sidebar{position:static;margin-bottom:30px}.account-sidebar a{display:inline-block;margin-right:8px}.account-sidebar h2{margin-bottom:12px}}</style>

<style scoped>.signup-service-options{border:1px solid #d7e2ef;border-radius:10px;padding:18px;margin:20px 0}.signup-service-options legend{font-weight:700}.signup-service-options p{line-height:1.7;margin:10px 0 18px}.signup-service-options .member-check{display:flex;align-items:center;gap:10px;margin:10px 0}.signup-service-options input{width:19px;height:19px}</style>
