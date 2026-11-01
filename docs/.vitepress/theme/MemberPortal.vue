<script setup>
import {ref,computed,onMounted,onUnmounted,watch} from 'vue'
import MemberServices from './MemberServices.vue'
import MemberSelfDetails from './MemberSelfDetails.vue'
import {memberClient,memberSession,memberAccount,initializeMember,refreshMember,memberApi,memberRpc,googleMemberLogin,safeMemberReturn,memberLogout} from './member-service.js'
const props=defineProps({mode:{default:'login'}})
const busy=ref(false),message=ref(''),name=ref(''),company=ref(''),position=ref(''),kind=ref('individual'),email=ref(''),password=ref(''),currentPassword=ref(''),accept=ref(false)
const requestedServices=ref([]),serviceCatalog=ref([])
function toggleService(item,checked){if(checked){if(item.id==='seedling'){requestedServices.value=['seedling'];return}requestedServices.value=requestedServices.value.filter(c=>c!=='seedling');if(['base','ai','msp','pm'].includes(item.kind))requestedServices.value=requestedServices.value.filter(c=>!serviceCatalog.value.some(x=>x.id===c&&x.kind===item.kind));requestedServices.value=[...requestedServices.value,item.id]}else requestedServices.value=requestedServices.value.filter(c=>c!==item.id)}
const next=ref('/account.html'),loaded=ref(''),accountTab=ref('profile')
function syncTab(){accountTab.value=location.hash==='#services'?'services':'profile'}
function selectTab(value){accountTab.value=value;const hash=value==='services'?'#services':'#profile';if(location.hash!==hash)history.pushState({...history.state},'',location.pathname+location.search+hash)}
onMounted(()=>{syncTab();window.addEventListener('hashchange',syncTab);window.addEventListener('popstate',syncTab)})
onUnmounted(()=>{window.removeEventListener('hashchange',syncTab);window.removeEventListener('popstate',syncTab)})
const completing=computed(()=>!!memberSession.value&&!memberAccount.value?.member)
const signup=computed(()=>props.mode==='signup'||completing.value)
const googleAccount=computed(()=>memberAccount.value?.google_account===true)
const editingProfile=computed(()=>signup.value||props.mode==='account')
watch(memberAccount,a=>{if(a?.profile&&loaded.value!==a.profile.id){loaded.value=a.profile.id;name.value=a.profile.display_name||'';company.value=a.profile.company||'';position.value=a.profile.position||'';kind.value=a.profile.member_kind||'individual';email.value=a.profile.email||''}},{immediate:true})
async function run(fn){if(busy.value)return;busy.value=true;message.value='';try{await fn()}catch(e){message.value=e.message}finally{busy.value=false;password.value='';currentPassword.value=''}}
async function submit(){await run(async()=>{
 if(props.mode==='account'&&!completing.value){
 await memberApi({action:'self-update',name:name.value,company:company.value,position:position.value,kind:kind.value,email:email.value,password:password.value||undefined,current_password:currentPassword.value||undefined});await refreshMember();message.value='회원정보를 저장했습니다.';return
 }
 if(completing.value){await memberRpc('member_complete_profile',{p_name:name.value,p_company:company.value,p_kind:kind.value,p_position:position.value,p_accept:accept.value,p_codes:requestedServices.value})}
 else if(signup.value){const result=await memberApi({action:'register',email:email.value,name:name.value,company:company.value,position:position.value,kind:kind.value,password:password.value,accept:accept.value,codes:requestedServices.value});const {error}=await memberClient().auth.setSession(result.session);if(error)throw Error('가입은 완료했으나 로그인이 필요합니다.')}
 else{const {error}=await memberClient().auth.signInWithPassword({email:email.value.trim(),password:password.value});if(error)throw Error('이메일과 비밀번호를 확인해 주세요.')}
 await refreshMember();if(memberAccount.value?.member)location.assign(next.value);else if(memberAccount.value?.profile?.status==='suspended'||memberAccount.value?.profile?.withdrawn_at){await memberClient().auth.signOut();throw Error('이용이 중지된 계정입니다. 관리자에게 문의해 주세요.')}
 })}
async function google(){await run(()=>googleMemberLogin(props.mode==='account'?'/account.html#'+accountTab.value:next.value))}
onMounted(async()=>{next.value=safeMemberReturn(new URLSearchParams(location.search).get('returnTo'));await initializeMember();if(props.mode==='signup'||completing.value){try{serviceCatalog.value=await memberRpc('member_service_catalog')}catch{message.value='서비스 신청 항목을 확인하지 못했습니다. 새로고침해 주세요.'}}
 if(props.mode==='callback'){await run(async()=>{const code=new URLSearchParams(location.search).get('code');history.replaceState(null,'',location.pathname);if(!code)throw Error('Google 로그인이 취소되었거나 만료되었습니다.');const {error}=await memberClient().auth.exchangeCodeForSession(code);if(error)throw Error('로그인을 완료하지 못했습니다. 다시 시도해 주세요.');await refreshMember();const target=safeMemberReturn(sessionStorage.getItem('member-return')||sessionStorage.getItem('pms-return'));sessionStorage.removeItem('member-return');sessionStorage.removeItem('pms-return');location.replace(memberAccount.value?.member?target:'/account.html?returnTo='+encodeURIComponent(target)+'#profile')})}
})
</script>
<template><main class="member-page" :class="mode==='account'?'member-account-layout':'member-narrow'"><aside v-if="mode==='account'" class="account-sidebar" aria-label="내 정보 메뉴"><span>MY PMOFFICE</span><h2>내 정보</h2><a id="profile" href="#profile" :aria-current="accountTab==='profile'?'page':undefined" @click.stop.prevent="selectTab('profile')">회원 가입 정보</a><a id="services" href="#services" :aria-current="accountTab==='services'?'page':undefined" @click.stop.prevent="selectTab('services')">멤버십 서비스</a></aside><div class="account-content">
<h1>{{mode==='callback'?'로그인 확인':mode==='account'?(accountTab==='services'?'가입 중인 서비스':'회원 가입 정보'):signup?'회원 가입':'로그인'}}</h1>
<div v-if="signup" class="signup-notices"><p>회원 가입 정보가 불분명하거나 잘못 입력되면, 가입이 거부될 수 있습니다.</p><p>Google 계정(Gmail 주소)으로 회원 가입을 하시는 분들은 로그인 후에 반드시 <a href="/account.html#profile"><strong>내 정보</strong></a> 메뉴로 이동하여 필수 정보를 입력해 주시기 바랍니다.</p></div><p v-if="message" role="status" aria-live="polite">{{message}}</p>
<MemberServices v-if="mode==='account'&&memberAccount?.member&&accountTab==='services'"/><template v-else><p v-if="mode==='callback'">로그인을 확인하고 있습니다. <a href="/login.html">다시 로그인</a></p>
<template v-else-if="mode==='account'&&!memberSession"><p>로그인 후 회원정보를 수정할 수 있습니다.</p><a class="member-button" :href="'/login.html?returnTo='+encodeURIComponent('/account.html#'+accountTab)">로그인</a></template>
<template v-else-if="mode!=='account'&&memberAccount?.member"><p>이미 로그인되어 있습니다.</p><a class="member-button" :href="next">계속 이용하기</a><a href="/account.html">내 정보</a></template>
<template v-else>
<button v-if="!memberSession||mode==='account'" class="member-button member-google" :disabled="busy" @click="google">{{mode==='account'?'Google로 다시 로그인':'Google 계정으로 계속하기'}}</button>
<MemberSelfDetails v-if="mode==='account'&&memberAccount?.member" />
<form @submit.prevent="submit" class="member-form" :class="{'member-profile-form':editingProfile}">
<template v-if="editingProfile"><label><span>회원 구분</span><select v-model="kind"><option value="individual">개인 회원</option><option value="business">기업·기관 회원</option></select></label><label><span>이름 <b class="member-required" aria-label="필수">*</b></span><input v-model="name" required maxlength="120" autocomplete="name"></label><label><span>직함 <b class="member-required" aria-label="필수">*</b></span><input v-model="position" required maxlength="120" autocomplete="organization-title"></label><label><span>회사명·소속 <b class="member-required" aria-label="필수">*</b></span><input v-model="company" required maxlength="200" autocomplete="organization"></label></template>
<label><span>이메일 <b v-if="!googleAccount" class="member-required" aria-label="필수">*</b></span><input v-model="email" type="email" :required="!googleAccount" maxlength="254" autocomplete="username" :readonly="completing||googleAccount"></label>
<label v-if="!completing&&!googleAccount"><span>{{mode==='account'?'새 비밀번호 (변경 시)':'비밀번호'}} <b v-if="mode!=='account'" class="member-required" aria-label="필수">*</b></span><input v-model="password" type="password" :required="mode!=='account'" minlength="8" maxlength="128" :autocomplete="signup||mode==='account'?'new-password':'current-password'"></label>
<label v-if="mode==='account'&&!completing&&!googleAccount"><span>현재 비밀번호 (인증 정보 변경 시)</span><input v-model="currentPassword" type="password" autocomplete="current-password" maxlength="128"></label>
<template v-if="mode==='account'&&googleAccount&&!completing"><label><span>PMOffice 비밀번호 (선택)</span><input v-model="password" type="password" minlength="8" maxlength="128" autocomplete="new-password"></label><p>PMOffice 비밀번호를 설정하려면 Google로 다시 로그인한 후 입력해 주세요.</p></template>
<fieldset v-if="signup" class="signup-service-options"><legend>신청할 서비스 종류 (복수 선택 가능)</legend><div class="signup-service-grid"><label v-for="item in serviceCatalog" :key="item.id" class="member-check"><input type="checkbox" :checked="requestedServices.includes(item.id)" @change="toggleService(item,$event.target.checked)"><span>{{item.name}}</span></label></div><p>신청 정보만 접수합니다. 신규 기본은 새싹멤버이며 실제 서비스와 등급은 관리자가 확인·설정합니다.</p></fieldset>
<label v-if="signup" class="member-check"><input v-model="accept" type="checkbox" required><span><a href="/pms/terms.html" target="_blank" rel="noopener">서비스 이용·개인정보 안내</a>를 확인하고 회원 가입에 동의합니다.</span></label>
<button class="member-button" :disabled="busy||signup&&!accept">{{busy?'처리 중':mode==='account'?'회원정보 저장':signup?'가입 완료':'로그인'}}</button>
</form>
<template v-if="mode==='account'"><button class="member-link" @click="memberLogout">로그아웃</button></template>

<p v-if="mode!=='account'"><a :href="(signup?'/login.html':'/signup.html')+'?returnTo='+encodeURIComponent(next)">{{signup?'이미 가입하셨나요? 로그인':'처음 방문하셨나요? 가입'}}</a></p>
</template></template></div></main></template>
<style scoped>.member-account-layout{display:grid;grid-template-columns:230px minmax(0,1fr);max-width:1300px;gap:48px}.account-sidebar{position:sticky;top:110px;align-self:start;padding:26px 18px;background:#f5f8fc;border:1px solid #e2eaf2;border-radius:12px}.account-sidebar>span{font-size:10px;letter-spacing:.17em;color:#66809a}.account-sidebar h2{font-size:23px;margin:14px 0 24px}.account-sidebar a{display:block;padding:13px 12px;border-radius:7px;margin:6px 0}.account-sidebar a[aria-current=page]{background:#e1edfc;color:#1e5f9f;font-weight:700}.account-content{min-width:0}.account-content>.member-form{max-width:650px}@media(max-width:760px){.member-account-layout{display:block}.account-sidebar{position:static;margin-bottom:30px}.account-sidebar a{display:inline-block;margin-right:8px}.account-sidebar h2{margin-bottom:12px}}</style>

<style scoped>.signup-service-options{border:1px solid #d7e2ef;border-radius:10px;padding:18px;margin:20px 0}.signup-service-options legend{font-weight:700}.signup-service-options p{line-height:1.7;margin:10px 0 18px}.signup-service-options .member-check{display:flex;align-items:center;gap:10px;margin:10px 0}.signup-service-options input{width:19px;height:19px}</style>

<style scoped>
.member-page{padding-top:calc(var(--vp-nav-height,64px) + 16px)}.member-page.member-narrow{max-width:780px;padding-top:calc(var(--vp-nav-height,64px) + 16px)}.account-content h1{margin-bottom:8px}.signup-notices p{font-size:13px;line-height:1.6;margin:4px 0}.member-profile-form{gap:8px!important;margin-top:8px}.account-content>.member-google{margin-bottom:0}.member-profile-form>label:not(.member-check){display:grid;grid-template-columns:145px minmax(0,1fr);align-items:center;gap:12px;margin:0}.member-profile-form>label>span{font-size:14px}.member-profile-form input:not([type=checkbox]),.member-profile-form select{padding:8px 10px;min-height:38px;margin:0}.member-required{color:#d12c37;font-weight:700}.signup-service-options{margin:8px 0;padding:10px 12px}.signup-service-options p{font-size:12px;margin:8px 0 0;line-height:1.5}.signup-service-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:5px 12px}.signup-service-options .member-check{margin:0;min-height:27px;font-size:13px}.signup-service-options legend{font-size:14px}.member-profile-form>.member-check{font-size:13px;margin:2px 0}.member-profile-form>.member-button{justify-self:start;margin-top:4px}@media(max-width:480px){.member-profile-form>label:not(.member-check){grid-template-columns:100px minmax(0,1fr);gap:8px}.member-profile-form>label>span{font-size:12px}.signup-service-grid{gap:5px}.signup-service-options .member-check{font-size:11px;gap:5px}.member-page.member-narrow{padding-top:calc(var(--vp-nav-height,64px) + 12px)}}
</style>
