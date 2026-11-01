<script setup>
import {projectPublicPath} from './project-address.js'
import {ref,watch,onMounted,onUnmounted} from 'vue'
import {memberAccount,memberSession,memberRpc} from './member-service.js'
import MemberEbookWorkspace from './MemberEbookWorkspace.vue'
const services=ref(null),error=ref(''),loading=ref(false);let generation=0,timer
async function load(){const id=++generation;services.value=null;error.value='';if(!memberAccount.value?.member)return;loading.value=true;try{const data=await memberRpc('member_services');if(id===generation)services.value=data}catch(e){if(id===generation)error.value=e.message}finally{if(id===generation)loading.value=false}}
watch(()=>[memberAccount.value?.profile?.id,memberSession.value?.access_token],load,{immediate:true})
onMounted(()=>{timer=setInterval(load,30000)});onUnmounted(()=>{++generation;clearInterval(timer)})
</script>
<template><div class="membership-services"><p class="member-note">피엠오피스 회원님의 이용 권한과 연결된 서비스를 확인하세요.</p><p v-if="loading" role="status">가입 서비스를 확인하고 있습니다.</p><div v-else-if="error" role="alert"><p>{{error}}</p><button @click="load">다시 확인</button></div><template v-else-if="services">
<section class="member-panel"><span class="service-overline">ONLINE EDUCATION</span><h2>사용 중인 온라인 교육 서비스</h2><ul v-if="services.education.length" class="service-name-list"><li v-for="e in services.education" :key="e.kind"><span class="service-dot"></span><strong>{{e.name}}</strong><span>이용 가능</span></li></ul><p v-else>이용 중인 온라인 교육 없음</p></section>
<section class="member-panel"><span class="service-overline">E-BOOK</span><MemberEbookWorkspace :summary="services.ebook"/></section>
<section class="member-panel"><span class="service-overline">PROJECT ONLINE</span><h2>사용 중인 Project Online 서비스</h2><ul v-if="services.projects.length" class="service-project-list"><li v-for="p in services.projects" :key="p.slug"><div><small>{{p.customer}}</small><h3>{{p.title}}</h3></div><a class="member-button" :href="projectPublicPath(p.slug)">프로젝트 열기 →</a></li></ul><template v-else><p>이용 중인 Project Online 없음</p><a href="/project-online/">Project Online 소개 보기 →</a></template></section>
</template></div></template>
<style scoped>.membership-services{max-width:1000px}.membership-services>.member-panel{margin-bottom:20px}.membership-services h2{font-size:23px;margin:10px 0 22px}.service-overline{font-size:11px;letter-spacing:.16em;color:#537393}.service-name-list,.service-project-list{list-style:none;padding:0}.service-name-list li,.service-project-list li{display:flex;gap:15px;align-items:center;justify-content:space-between;padding:18px 0;border-bottom:1px solid #e2eaf3}.service-name-list li strong{flex:1}.service-name-list li>span:last-child{font-size:12px;color:#276044}.service-dot{width:8px;height:8px;border-radius:50%;background:#3b9475}.service-project-list h3{margin:6px 0;font-size:19px}.service-project-list small{color:#63768b}@media(max-width:600px){.service-project-list li{display:block}.service-project-list .member-button{display:inline-block;margin-top:14px}}</style>
