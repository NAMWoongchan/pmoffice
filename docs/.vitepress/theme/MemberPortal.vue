<script setup>
import {ref,computed,onMounted,watch} from 'vue'
import {memberClient,memberSession,memberAccount,initializeMember,refreshMember,memberApi,memberRpc,googleMemberLogin,safeMemberReturn,memberLogout} from './member-service.js'
const props=defineProps({mode:{default:'login'}})
const busy=ref(false),message=ref(''),name=ref(''),company=ref(''),kind=ref('business'),email=ref(''),password=ref(''),currentPassword=ref(''),accept=ref(false)
const next=ref('/knowledge/index.html'),loaded=ref('')
const completing=computed(()=>!!memberSession.value&&!memberAccount.value?.member)
const signup=computed(()=>props.mode==='signup'||completing.value)
watch(memberAccount,a=>{if(a?.profile&&loaded.value!==a.profile.id){loaded.value=a.profile.id;name.value=a.profile.display_name||'';company.value=a.profile.company||'';kind.value=a.profile.member_kind||'business';email.value=a.profile.email||''}},{immediate:true})
async function run(fn){if(busy.value)return;busy.value=true;message.value='';try{await fn()}catch(e){message.value=e.message}finally{busy.value=false;password.value='';currentPassword.value=''}}
async function submit(){await run(async()=>{
 if(props.mode==='account'){
 await memberApi({action:'self-update',name:name.value,company:company.value,kind:kind.value,email:email.value,password:password.value||undefined,current_password:currentPassword.value||undefined});await refreshMember();message.value='회원정보를 저장했습니다.';return
 }
 if(completing.value){await memberRpc('member_complete_registration',{p_name:name.value,p_company:company.value,p_kind:kind.value,p_accept:accept.value})}
 else if(signup.value){const result=await memberApi({action:'register',email:email.value,name:name.value,company:company.value,kind:kind.value,password:password.value,accept:accept.value});const {error}=await memberClient().auth.setSession(result.session);if(error)throw Error('가입은 완료했으나 로그인이 필요합니다.')}
 else{const {error}=await memberClient().auth.signInWithPassword({email:email.value.trim(),password:password.value});if(error)throw Error('이메일과 비밀번호를 확인해 주세요.')}
 await refreshMember();if(memberAccount.value?.member)location.assign(next.value);else if(memberAccount.value?.profile?.status==='suspended'||memberAccount.value?.profile?.withdrawn_at){await memberClient().auth.signOut();throw Error('이용이 중지된 계정입니다. 관리자에게 문의해 주세요.')}
 })}
async function google(){await run(()=>googleMemberLogin(props.mode==='account'?'/account.html':next.value))}
onMounted(async()=>{next.value=safeMemberReturn(new URLSearchParams(location.search).get('returnTo'));await initializeMember();
 if(props.mode==='callback'){await run(async()=>{const code=new URLSearchParams(location.search).get('code');history.replaceState(null,'',location.pathname);if(!code)throw Error('Google 로그인이 취소되었거나 만료되었습니다.');const {error}=await memberClient().auth.exchangeCodeForSession(code);if(error)throw Error('로그인을 완료하지 못했습니다. 다시 시도해 주세요.');await refreshMember();const target=safeMemberReturn(sessionStorage.getItem('member-return')||sessionStorage.getItem('pms-return'));sessionStorage.removeItem('member-return');sessionStorage.removeItem('pms-return');location.replace(memberAccount.value?.member?target:'/signup.html?returnTo='+encodeURIComponent(target))})}
})
</script>
<template><main class="member-page member-narrow">
<h1>{{mode==='callback'?'로그인 확인':mode==='account'?'내 정보':signup?'회원 가입':'로그인'}}</h1>
<p role="status" aria-live="polite">{{message}}</p>
<p v-if="mode==='callback'">로그인을 확인하고 있습니다. <a href="/login.html">다시 로그인</a></p>
<template v-else-if="mode==='account'&&!memberAccount?.member"><p>로그인 후 회원정보를 수정할 수 있습니다.</p><a class="member-button" href="/login.html?returnTo=%2Faccount.html">로그인</a></template>
<template v-else-if="mode!=='account'&&memberAccount?.member"><p>이미 로그인되어 있습니다.</p><a class="member-button" :href="next">계속 이용하기</a><a href="/account.html">내 정보</a></template>
<template v-else>
<button v-if="!memberSession||mode==='account'" class="member-button member-google" :disabled="busy" @click="google">{{mode==='account'?'Google로 다시 로그인':'Google 계정으로 계속하기'}}</button>
<form @submit.prevent="submit" class="member-form">
<template v-if="signup||mode==='account'"><label>회원 구분<select v-model="kind"><option value="business">기업·기관 회원</option><option value="individual">개인 회원</option></select></label><label>이름<input v-model="name" required maxlength="120" autocomplete="name"></label><label>회사명·소속{{kind==='individual'?' (선택)':''}}<input v-model="company" :required="kind==='business'" maxlength="200" autocomplete="organization"></label></template>
<label>이메일<input v-model="email" type="email" required maxlength="254" autocomplete="username" :readonly="completing"></label>
<label v-if="!completing">{{mode==='account'?'새 비밀번호 (변경할 때만 입력)':'비밀번호'}}<input v-model="password" type="password" :required="mode!=='account'" minlength="8" maxlength="128" :autocomplete="signup||mode==='account'?'new-password':'current-password'"></label>
<label v-if="mode==='account'">현재 비밀번호 (이메일·비밀번호 변경 시)<input v-model="currentPassword" type="password" autocomplete="current-password" maxlength="128"></label>
<p v-if="mode==='account'">Google로 가입하셨다면 다시 로그인한 후 PMOffice 비밀번호를 설정할 수 있습니다.</p>
<label v-if="signup" class="member-check"><input v-model="accept" type="checkbox" required><span><a href="/pms/terms.html" target="_blank" rel="noopener">서비스 이용·개인정보 안내</a>를 확인하고 회원 가입에 동의합니다.</span></label>
<button class="member-button" :disabled="busy||signup&&!accept">{{busy?'처리 중':mode==='account'?'회원정보 저장':signup?'가입 완료':'로그인'}}</button>
</form>
<template v-if="mode==='account'"><button class="member-link" @click="memberLogout">로그아웃</button></template>
<p v-else>비밀번호를 잊으셨다면 <a href="mailto:nam@pmoffice.co.kr">관리자에게 문의해 주세요.</a></p>
<p v-if="mode!=='account'"><a :href="(signup?'/login.html':'/signup.html')+'?returnTo='+encodeURIComponent(next)">{{signup?'이미 가입하셨나요? 로그인':'처음 방문하셨나요? 가입'}}</a></p>
</template></main></template>
