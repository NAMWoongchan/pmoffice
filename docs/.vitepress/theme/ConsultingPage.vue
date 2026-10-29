<script setup>
import {memberAccount} from './member-service.js'
import {computed,ref,onMounted} from 'vue'
import {withBase} from 'vitepress'
import data from './consulting.json'
const labels=data.labels
const props=defineProps({page:{type:String,default:'home'}})
const p=computed(()=>data.pages[props.page]||data.pages.home)
const path=withBase
const img=(name)=>path('/images/consulting/'+name)
const dialog=ref(null),expanded=ref(''),expandedAlt=ref('')
function zoom(name,alt){expanded.value=name;expandedAlt.value=alt;dialog.value?.showModal()}
import InquiryPanel from './InquiryPanel.vue'
const groups=[['pm','PM 컨설팅','EPC · R&D · 글로벌 기업','관리 체계와 통합 일정, 실행과 보고를 연결합니다.','original-weight.webp'],['scheduling','공정표 작성 대행','입찰 · 발주처·감독기관 · 기업 통합','제출 목적과 일정의 논리를 갖춘 결과물을 만듭니다.','gantt-screen.webp'],['ai','AI 컨설팅','ChatGPT · Microsoft Copilot','적용 업무를 선정하고 검증과 운영까지 설계합니다.','report-dashboard.webp']]
const screen=(props.page==='pm'?'weight-screen.webp':props.page==='scheduling'?'excel-schedule.webp':'original-weight.webp')

const orderedKeys=['scheduling','pm','ai','chatgpt','copilot']
const services=computed(()=>orderedKeys.map(k=>data.pages[k]))
const serviceOutputs=computed(()=>[...new Set(p.value.sections.flatMap(s=>s.outputs))])
const serviceInputs=computed(()=>[...new Set(p.value.sections.flatMap(s=>s.inputs))])
const serviceChecks=computed(()=>[...new Set(p.value.sections.flatMap(s=>s.accept))])
const jumps=[['수행 범위','service-details'],['준비 자료','preparation'],['진행 절차','process'],['산출물','deliverables'],['검수 기준','acceptance'],['FAQ','faq']]
</script>
<template><div class="ai-academy consulting consulting-academy">
<section class="aa-hero"><div class="aa-wrap aa-detail-grid"><div><a v-if="page!=='home'" class="aa-back" :href="path('/consulting/')">← 컨설팅 전체 안내</a><span class="aa-eyebrow">PMOFFICE · PROJECT MANAGEMENT CONSULTING</span><p class="aa-kicker">{{labels[page]}}</p><h1 id="page-title">{{page==='home'?'공정표·진도 보고부터, 조직의 PM 체계와 AI 업무 적용까지.':p.title}}</h1><p class="aa-lead">{{p.intro}}</p><div class="aa-actions"><a class="aa-btn aa-primary" href="#consulting-inquiry">맞춤 컨설팅 상담 ↗</a><a class="aa-btn aa-ghost" :href="page==='home'?'#services':'#service-details'">수행 범위 살펴보기 ↓</a></div><div class="aa-tool-line">Microsoft Project · Excel · 프로젝트 관리 · AI</div></div><button class="academy-visual academy-zoom" type="button" @click="zoom(p.image,'Microsoft Project 공정표 및 보고서')" aria-label="공정표 및 보고서 화면 확대"><img :src="img(p.image)" alt="Microsoft Project 공정표 및 보고서" width="1144" height="761" fetchpriority="high"><span class="academy-visual-note"><span>PLAN · CONTROL · REPORT</span><strong>관리할 정보와 제출할 결과를, 목적에 맞게. ↗</strong></span></button></div></section>
<nav v-if="page!=='home'" class="aa-subnav" aria-label="컨설팅 상세 목차"><div class="aa-wrap"><a v-for="[label,id] in jumps" :key="id" :href="'#'+id">{{label}}</a><a class="aa-nav-inquiry" href="#consulting-inquiry">상담 문의 ↗</a></div></nav>
<template v-if="page==='home'">
 <section id="services" class="aa-section aa-wrap"><div class="aa-section-head"><span class="aa-eyebrow">FIND YOUR SERVICE</span><h2>지금 필요한 결과물에서<br>컨설팅을 선택하십시오.</h2><p>제출 공정표 제작부터 조직별 관리 체계와 AI 업무 적용까지.</p></div><div class="consult-academy-services"><a v-for="(s,i) in services" :key="s.key" :href="path(s.path)" class="consult-academy-card"><div class="consult-card-image"><img :src="img(s.image)" :alt="labels[s.key]+' 업무 화면'" loading="lazy" width="1144" height="761"><span>0{{i+1}}</span></div><div class="consult-card-copy"><h3>{{labels[s.key]}} ↗</h3><p>{{s.intro}}</p><strong>주요 산출물</strong><ul><li v-for="o in s.sections.flatMap(x=>x.outputs).slice(0,3)" :key="o">{{o}}</li></ul></div></a></div></section>
 <section class="aa-section aa-soft"><div class="aa-wrap"><div class="aa-section-head"><span class="aa-eyebrow">SERVICE GUIDE</span><h2>고객 과제와<br>제공 산출물을 비교하십시오.</h2></div><div class="aa-comparison" tabindex="0" aria-label="컨설팅 서비스 비교표"><table><thead><tr><th>필요한 업무</th><th>추천 서비스</th><th>주요 산출물</th></tr></thead><tbody><tr v-for="s in services" :key="s.key"><td>{{data.situations[s.key][0]}}</td><td><a :href="path(s.path)">{{labels[s.key]}} ↗</a></td><td>{{s.sections.flatMap(x=>x.outputs).slice(0,2).join(' · ')}}</td></tr></tbody></table></div></div></section>
 <section class="aa-section aa-dark"><div class="aa-wrap"><div class="aa-section-head"><span class="aa-eyebrow">WORKING DELIVERABLES</span><h2>계획과 실적을 확인하는<br>공정표와 보고 화면.</h2><p>작업의 선후행 관계, 주공정, 기간별 보할과 누적 진도를 관리 목적에 맞게 구성합니다.</p></div><div class="academy-screen-pair"><button v-for="name in ['original-gantt','original-weight']" :key="name" class="academy-zoom" @click="zoom(name+'.png','공정표와 누적 진도')" aria-label="공정표와 누적 진도 확대"><img :src="img(name+'.webp')" alt="공정표와 누적 진도" loading="lazy" width="1144" height="761"></button></div></div></section>
</template>
<template v-else>
 <section class="aa-section aa-wrap"><div class="aa-section-head"><span class="aa-eyebrow">IS THIS YOUR PROJECT?</span><h2>이런 과제가 있으신가요?</h2></div><div class="aa-needs"><article v-for="(n,i) in data.situations[page]" :key="n"><span>0{{i+1}}</span><h3>{{n}}</h3></article></div></section>
 <section id="service-details" class="aa-section aa-soft"><div class="aa-wrap"><div class="aa-section-head"><span class="aa-eyebrow">WHAT WE DO</span><h2>관리 대상과 수행 범위를<br>구체적으로 정합니다.</h2></div><article v-for="(s,i) in p.sections" :key="s.id" :id="s.id" class="consult-scope"><span class="aa-eyebrow">0{{i+1}} / SCOPE</span><h2>{{s.title}}</h2><p class="consult-scope-lead">{{s.lead}}</p><div class="aa-value-grid"><article v-for="item in s.items" :key="item.title"><h3>{{item.title}}</h3><p>{{item.text}}</p></article></div><a class="academy-inline-link" :href="'?service='+encodeURIComponent(s.title)+'#consulting-inquiry'">이 범위로 상담하기 ↗</a></article></div></section>
 <section id="preparation" class="aa-section aa-wrap"><div class="aa-environment-grid"><div class="aa-section-head"><span class="aa-eyebrow">BEFORE WE START</span><h2>먼저 확인할<br>자료와 조건.</h2><p>보유 자료와 제출 요구를 기준으로 수행 범위를 정합니다.</p></div><ul class="aa-check-list"><li v-for="item in serviceInputs" :key="item">{{item}}</li></ul></div></section>
</template>
<section id="process" class="aa-section aa-soft"><div class="aa-wrap"><div class="aa-section-head"><span class="aa-eyebrow">HOW WE WORK</span><h2>진단·제작·검토부터<br>담당자 운영 인계까지.</h2></div><div class="aa-process consult-six-steps"><article v-for="(s,i) in data.process" :key="s[0]"><span>0{{i+1}}</span><h3>{{s[0]}}</h3><p>{{s[1]}}</p></article></div></div></section>
<template v-if="page!=='home'">
 <section id="deliverables" class="aa-section aa-dark"><div class="aa-wrap"><div class="aa-section-head"><span class="aa-eyebrow">YOUR DELIVERABLES</span><h2>완료 후 사용할<br>관리 자료와 운영 기준.</h2></div><div class="aa-output-grid"><article v-for="(s,i) in p.sections" :key="s.id"><small>OUTPUT 0{{i+1}}</small><h3>{{s.title}}</h3><ul class="aa-check-list"><li v-for="o in s.outputs" :key="o">{{o}}</li></ul></article></div><button class="academy-zoom academy-wide-screen" @click="zoom(screen,'Project 및 Excel 프로젝트 관리 화면')" aria-label="프로젝트 관리 화면 확대"><img :src="img(screen)" alt="Project 및 Excel 프로젝트 관리 화면" loading="lazy" width="1592" height="995"></button></div></section>
 <section id="acceptance" class="aa-section aa-wrap"><div class="aa-environment-grid"><div class="aa-section-head"><span class="aa-eyebrow">REVIEW & HANDOVER</span><h2>결과물은,<br>검수 기준으로 확인합니다.</h2><p>입력 자료와 요구사항, 계산 결과와 실제 사용 환경을 함께 검토합니다.</p></div><ul class="aa-check-list"><li v-for="item in serviceChecks" :key="item">{{item}}</li></ul></div></section>
</template>
<section v-if="page==='ai'" class="aa-section aa-soft"><div class="aa-wrap"><div class="aa-section-head"><span class="aa-eyebrow">AI APPLICATION</span><h2>업무별 AI 적용 과제.</h2></div><div class="aa-value-grid"><article v-for="f in data.aiFields" :key="f.title"><h3>{{f.title}}</h3><p>{{f.text}}</p></article></div><div class="aa-actions"><a class="aa-btn aa-primary" :href="path('/consulting/ai/chatgpt.html')">ChatGPT 컨설팅 ↗</a><a class="aa-btn academy-outline" :href="path('/consulting/ai/copilot.html')">Microsoft Copilot 컨설팅 ↗</a></div></div></section>
  <section id="membership" class="consult-membership"><div class="section-inner"><span class="consult-eyebrow">평생 지식 공유 멤버십</span><h2>{{data.membership.title}}</h2><p class="consult-member-lead">{{data.membership.lead}}</p><div class="consult-member-grid"><article v-for="(m,i) in data.membership.items" :key="m.title"><span>0{{i+1}}</span><h3>{{m.title}}</h3><p>{{m.text}}</p></article></div><p class="consult-member-terms">{{data.membership.terms}}</p><a v-if="memberAccount?.member" :href="path('/knowledge/index.html')" class="text-link">지식 공간 살펴보기 ↗</a></div></section>

<section id="faq" class="aa-section aa-wrap"><div class="aa-section-head"><span class="aa-eyebrow">FAQ</span><h2>상담 전에 궁금한 점.</h2></div><div class="aa-faq"><details v-for="f in p.faq" :key="f.q"><summary>{{f.q}}<span>+</span></summary><p>{{f.a}}</p></details></div></section>
<div id="consulting-inquiry"><InquiryPanel :initial-service="page==='scheduling'?'공정표 작성 대행':page==='ai'?'AI 컨설팅':page==='chatgpt'?'ChatGPT 컨설팅':page==='copilot'?'Microsoft Copilot 컨설팅':'프로젝트 관리 컨설팅'" /></div>

<section class="aa-section aa-wrap"><div class="aa-section-head"><h2>함께 확인할 교육과 실무 지식.</h2></div><div class="aa-actions"><a class="aa-btn academy-outline" :href="path('/ms-project/')">MS Project 교육 ↗</a><a class="aa-btn academy-outline" :href="path('/pm-practice/')">PM 실무 교육 ↗</a><a class="aa-btn academy-outline" :href="path('/ai-edu/')">AI 교육 ↗</a><a v-if="memberAccount?.member" class="aa-btn academy-outline" :href="path('/knowledge/index.html')">지식 공간 ↗</a></div></section>
<div v-if="page!=='home'" class="aa-mobile-inquiry"><span>{{labels[page]}}</span><a href="#consulting-inquiry">상담 문의 ↗</a></div>
  <dialog ref="dialog" class="consult-image-dialog" :aria-label="expandedAlt" @click="e=>{if(e.target===dialog)dialog.close()}"><button class="consult-dialog-close" type="button" @click="dialog.close()" aria-label="화면 확대 닫기">닫기 ×</button><div><img v-if="expanded" :src="img(expanded)" :alt="expandedAlt"></div></dialog>
</div></template>
