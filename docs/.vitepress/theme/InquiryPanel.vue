<script setup>
import {ref,computed,onMounted,watch} from 'vue'
import aiEducation from './ai-education.json'
import education from './education.json'
import {rpc} from './inquiry-client.js'
const props=defineProps({initialService:{type:String,default:'MS Project 교육'}})
const allCourses=[...aiEducation.courses.map(c=>({...c,service:'AI 교육'})),...education.courses.filter(c=>c.path!=='ms-project/index').map(c=>({id:c.path,title:c.title,service:c.group==='ms'?'MS Project 교육':'PM 실무 교육'}))]
const options=['MS Project 교육','PM 실무 교육','프로젝트 관리 컨설팅','공정표 작성 대행','AI 교육','AI 컨설팅','ChatGPT 컨설팅','Microsoft Copilot 컨설팅']
const service=ref(props.initialService),courseId=ref(''),company=ref(''),person=ref(''),email=ref(''),phone=ref(''),goal=ref(''),output=ref(''),timing=ref(''),website=ref(''),status=ref(''),busy=ref(false),receipt=ref(''),ready=ref(false)
let requestId='',fingerprint='',started=Date.now()
const availableCourses=computed(()=>allCourses.filter(c=>c.service===service.value))
const selectedCourse=computed(()=>availableCourses.value.find(c=>c.id===courseId.value))
watch(service,()=>{if(!availableCourses.value.some(c=>c.id===courseId.value))courseId.value=''})
onMounted(async()=>{const q=new URLSearchParams(location.search),v=q.get('service');if(options.includes(v))service.value=v;const c=allCourses.find(c=>c.id===q.get('course')&&(!options.includes(v)||c.service===v));if(c){service.value=c.service;courseId.value=c.id}try{ready.value=await rpc('inquiry_health')}catch{}if(!ready.value)status.value='온라인 문의 접수를 준비하고 있습니다. 02-532-8060으로 문의해 주십시오.'})
const payload=computed(()=>({company:company.value.trim(),person:person.value.trim(),email:email.value.trim(),phone:phone.value.trim(),service:service.value,course:selectedCourse.value?.title||'',message:goal.value.trim(),environment:output.value.trim(),timing:timing.value.trim(),source:typeof location==='undefined'?'':location.pathname}))
const draft=computed(()=>Object.entries({'회사 이름':payload.value.company,'이름과 직함':payload.value.person,'이메일':payload.value.email,'전화번호':payload.value.phone,'관심 분야':payload.value.service,'교육 과정':payload.value.course,'문의 내용':payload.value.message,'필요 산출물·사용 환경':payload.value.environment,'희망 일정':payload.value.timing}).map(([k,v])=>k+': '+(v||'미입력')).join('\n'))
async function submit(){if(busy.value||receipt.value)return;busy.value=true;status.value='접수 중입니다.';try{const value=JSON.stringify(payload.value);if(value!==fingerprint){fingerprint=value;requestId=crypto.randomUUID()}const data=await rpc('submit_inquiry',{p_request_id:requestId,p_data:payload.value,p_website:website.value,p_elapsed_ms:Date.now()-started});receipt.value=data.receipt;status.value='문의가 접수되었습니다. 담당자가 확인 후 연락드리겠습니다.'}catch(e){status.value=e.message}finally{busy.value=false}}
function reset(){receipt.value='';goal.value='';output.value='';timing.value='';status.value='';requestId='';fingerprint='';started=Date.now()}
</script>
<template><section id="service-inquiry" class="inquiry-panel"><div class="section-inner release-section"><div class="release-heading"><span class="consult-eyebrow">교육·컨설팅 문의</span><h2>필요한 교육과 산출물,<br>희망 일정을 알려주십시오.</h2><p>현재 자료와 해결할 과제를 기준으로 지원 범위를 제안하겠습니다.</p></div>
<form class="inquiry-grid" @submit.prevent="submit"><fieldset class="inquiry-inputs" :disabled="busy||!!receipt"><legend class="inquiry-sr">문의 작성</legend>
<label>회사 이름 (필수)<input v-model="company" required maxlength="120" autocomplete="organization"></label>
<label>이름과 직함 (필수)<input v-model="person" required maxlength="120" autocomplete="name" placeholder="예: 홍길동 팀장"></label>
<label>이메일 (필수)<input v-model="email" required type="email" maxlength="254" autocomplete="email"></label>
<label>전화번호<input v-model="phone" type="tel" maxlength="40" autocomplete="tel" aria-describedby="phone-help"><small id="phone-help">전화번호를 남겨 주시면 자세한 상담 전화 드리겠습니다.</small></label>
<label>관심 분야<select v-model="service"><option v-for="o in options" :key="o">{{o}}</option></select></label>
<label v-if="availableCourses.length">관심 교육 과정<select v-model="courseId"><option value="">과정 선택·상담 시 협의</option><option v-for="c in availableCourses" :key="c.id" :value="c.id">{{c.title}}</option></select></label>
<label>문의 내용 (필수)<textarea v-model="goal" required maxlength="5000" rows="5" placeholder="해결할 과제, 교육 대상과 필요한 지원을 알려주십시오."></textarea></label>
<label>필요 산출물·사용 환경<input v-model="output" maxlength="500" placeholder="예: MS Project·Excel 공정표, 제출용 PDF"></label>
<label>희망 일정·제출일<input v-model="timing" maxlength="180" placeholder="정해지지 않았다면 비워두십시오."></label>
<label class="inquiry-trap" aria-hidden="true">웹사이트<input v-model="website" tabindex="-1" autocomplete="off"></label></fieldset>
<div class="inquiry-result"><h3>제출 내용 미리보기</h3><textarea readonly :value="draft" rows="18" aria-label="제출 내용 미리보기"></textarea><div class="actions"><button v-if="!receipt" type="submit" class="btn primary" :disabled="busy||!ready">{{busy?'접수 중…':'제출하기'}}</button><button v-else type="button" class="btn secondary" @click="reset">새 문의 작성</button></div><p role="status" aria-live="polite" class="inquiry-feedback">{{status}}</p><p v-if="receipt" class="inquiry-receipt">접수번호: <strong>{{receipt}}</strong></p><div class="contact-links"><a href="mailto:nam@pmoffice.co.kr">nam@pmoffice.co.kr</a><a href="tel:025328060">02-532-8060</a></div></div></form></div></section></template>
<style scoped>.inquiry-inputs{border:0;margin:0;padding:0;min-width:0}.inquiry-inputs small{display:block;line-height:1.6;font-size:13px;margin-top:8px}.inquiry-trap{position:absolute!important;left:-10000px!important}.inquiry-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}.inquiry-result{min-width:0}.inquiry-result textarea{width:100%;resize:vertical}.inquiry-result .actions{flex-wrap:wrap}.inquiry-feedback,.inquiry-receipt{overflow-wrap:anywhere}button:disabled{opacity:.55;cursor:wait}.inquiry-inputs input,.inquiry-inputs textarea{scroll-margin-top:110px}</style>
